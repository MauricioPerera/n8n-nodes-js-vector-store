import * as fs from 'node:fs';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { BM25Index, FileStorageAdapter } from 'js-vector-store';

import { detectCoherenceMismatch, type IndexType } from '../transport/indexType';
import { hasBm25Index } from '../transport/hybrid';
import { flushStore, openStore } from '../transport/store';
import * as ops from './operations';
import { isWriteOperation } from './security';

/**
 * Execute engine for the Vector Store node.
 *
 * - Reads the `vectorStoreApi` credential ONCE (`storeDirectory` + `dimension`
 *   + `indexType`) and opens a single `js-vector-store` instance reused across
 *   all items. The `indexType` selects the concrete store class (Float32/Int8/
 *   Binary/Polar); default `float32` preserves pre-1.1 behavior.
 * - Reads the `readOnly` node toggle ONCE: when on, write operations
 *   (set/remove/drop) are rejected with a `NodeOperationError` BEFORE reaching
 *   the engine — a guard against prompt-injected AI agents mutating the store.
 * - Before operating on a collection that already exists on disk, checks that
 *   its on-disk file suffix matches the declared `indexType`. Opening an
 *   existing collection with the wrong class is the silent-empty case (count 0
 *   with no error): a clear `NodeOperationError` is thrown instead. The
 *   directory is listed ONCE per run; brand-new collections are not flagged.
 * - Loops input items, reads `operation` (+ per-op params) at the correct item
 *   index, dispatches to the matching operation handler, and accumulates output
 *   items with `pairedItem` set.
 * - Flushes after every write operation (set/remove/drop).
 * - Per-item error handling honoring `continueOnFail()`: on continue, pushes an
 *   `{ error }` item paired to the failing input; otherwise throws a
 *   `NodeOperationError` with `itemIndex` so n8n points the user at the item.
 *
 * `this` is bound to the `IExecuteFunctions` by the node's `execute` method.
 */
export async function run(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];

	const credentials = (await this.getCredentials('vectorStoreApi')) as unknown as {
		storeDirectory: string;
		dimension: number;
		indexType?: IndexType;
	};
	const storeDirectory = credentials.storeDirectory;
	const dimension = credentials.dimension;
	const indexType = credentials.indexType ?? 'float32';
	const store = openStore(storeDirectory, dimension, indexType);

	// Snapshot the directory ONCE for the indexType coherence check. Mismatch
	// only matters for collections that existed BEFORE this run; collections
	// created during the run use the declared type by construction. A missing
	// directory (first-ever run) yields an empty list -> no false positives.
	const presentFiles = readDirSafe(storeDirectory);
	const checkedCollections = new Set<string>();

	// Node-level toggle (constant across items): when on, the store is exposed
	// read-only and write operations are rejected before reaching the engine.
	const readOnly = this.getNodeParameter('readOnly', 0) as boolean;

	// Hybrid Search (BM25 + vector) state, owned by the router for the whole
	// run. `js-vector-store`'s `BM25Index` is a SEPARATE object from the store:
	// it persists to `<col>.bm25.json` under the SAME directory via its own
	// `FileStorageAdapter`, and loads MANUALLY (no autoreload — spike §1). A
	// single `BM25Index` holds every collection's text index; we track which
	// collections are already loaded in memory so we `load` once per run.
	const bm25Adapter = new FileStorageAdapter(storeDirectory);
	const bm25 = new BM25Index({ k1: 1.5, b: 0.75 });
	const loadedBm25Cols = new Set<string>();

	/** Load `<col>.bm25.json` into the shared BM25 index if it exists on disk and is not yet loaded. */
	const ensureBm25Loaded = (collection: string): void => {
		if (loadedBm25Cols.has(collection)) return;
		if (hasBm25Index(collection, presentFiles)) {
			bm25.load(bm25Adapter, collection);
			loadedBm25Cols.add(collection);
		}
	};

	/**
	 * Index a document's text into BM25 and persist. Loads any pre-existing
	 * index for the collection FIRST (so `save` does not clobber prior docs),
	 * then `addDocument` (upsert semantics), `save`, and mark the collection
	 * loaded. Called from Upsert only when `text` is non-empty.
	 */
	const indexBm25Doc = (collection: string, id: string, text: string): void => {
		ensureBm25Loaded(collection);
		bm25.addDocument(collection, id, text);
		bm25.save(bm25Adapter, collection);
		loadedBm25Cols.add(collection);
	};

	/**
	 * Remove a document's text from BM25 and persist, if the collection has a
	 * BM25 index. No-op when the collection was never given a `text` field (no
	 * `<col>.bm25.json` on disk and not loaded this run) — keeps Delete on a
	 * vector-only collection side-effect free. Called from Delete.
	 */
	const removeBm25Doc = (collection: string, id: string): void => {
		ensureBm25Loaded(collection);
		if (!loadedBm25Cols.has(collection)) return;
		bm25.removeDocument(collection, id);
		bm25.save(bm25Adapter, collection);
	};

	/**
	 * Ensure the collection has a BM25 index loaded for a hybrid search, or
	 * throw a clear `NodeOperationError`. Hybrid search on a collection that
	 * was never given a `text` field has no lexical side to fuse; the engine
	 * would silently return only vector hits, so the node fails loudly instead.
	 */
	const ensureBm25ForSearch = (collection: string, itemIndex: number): void => {
		ensureBm25Loaded(collection);
		if (!loadedBm25Cols.has(collection)) {
			throw new NodeOperationError(
				this.getNode(),
				`No hybrid index for collection "${collection}"; upsert documents with a 'text' field first.`,
				{ itemIndex },
			);
		}
	};

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const operation = this.getNodeParameter('operation', itemIndex) as string;

			if (readOnly && isWriteOperation(operation)) {
				throw new NodeOperationError(
					this.getNode(),
					`Operation '${operation}' is a write and this node is in read-only mode.`,
					{ itemIndex },
				);
			}

			// Coherence check: for operations targeting a single collection, verify
			// the collection's on-disk file matches the declared indexType. Done
			// once per collection per run. `collections` has no target collection;
			// `searchAcross` targets a LIST (read separately as `collections`), so
			// neither runs this check. Throws a clear error (honoring
			// continueOnFail via the surrounding try/catch) instead of letting the
			// wrong store class open it as count = 0 silently.
			if (operation !== 'collections' && operation !== 'searchAcross') {
				const collection = this.getNodeParameter('collection', itemIndex) as string;
				if (!checkedCollections.has(collection)) {
					checkedCollections.add(collection);
					const coherence = detectCoherenceMismatch(indexType, collection, presentFiles);
					if (coherence.mismatch) {
						throw new NodeOperationError(
							this.getNode(),
							`Collection "${collection}" was created with indexType "${coherence.detectedType}" (file "${coherence.detectedFile}") but the credential declares indexType "${indexType}". Reopen this node with the matching indexType, or the collection appears empty. Expected file: "${coherence.declaredFile}".`,
							{ itemIndex },
						);
					}
				}
			}

			let out: INodeExecutionData[];

			switch (operation) {
				case 'set': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					const id = this.getNodeParameter('id', itemIndex) as string;
					out = ops.upsert(
						store,
						{
							collection,
							id,
							vector: this.getNodeParameter('vector', itemIndex),
							metadata: this.getNodeParameter('metadata', itemIndex, ''),
							dimension,
						},
						itemIndex,
					);
					// Optional `text`: when non-empty, also index the document
					// into BM25 and persist (enables Hybrid Search). Empty text
					// keeps the pre-hybrid behavior exactly — no `<col>.bm25.json`
					// is created (spike §1: store.flush and bm25.save are
					// independent; the router flushes the store below).
					const text = this.getNodeParameter('text', itemIndex, '');
					const textStr = typeof text === 'string' ? text : '';
					if (textStr.length > 0) {
						indexBm25Doc(collection, id, textStr);
					}
					break;
				}
				case 'search': {
					out = ops.search(
						store,
						{
							collection: this.getNodeParameter('collection', itemIndex) as string,
							queryVector: this.getNodeParameter('queryVector', itemIndex),
							limit: this.getNodeParameter('limit', itemIndex, 50),
							metric: this.getNodeParameter('metric', itemIndex, 'cosine') as string,
							filter: this.getNodeParameter('filter', itemIndex, ''),
							dimSlice: this.getNodeParameter('dimSlice', itemIndex, 0),
							useIndex: this.getNodeParameter('useIndex', itemIndex, false) as boolean,
							dimension,
						},
						itemIndex,
					);
					break;
				}
				case 'get': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					const id = this.getNodeParameter('id', itemIndex) as string;
					out = ops.get(store, collection, id, itemIndex);
					break;
				}
				case 'remove': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					const id = this.getNodeParameter('id', itemIndex) as string;
					out = ops.remove(store, collection, id, itemIndex);
					// Keep the BM25 index in sync: if the collection has a text
					// index, drop the document from it and persist. No-op for a
					// vector-only collection.
					removeBm25Doc(collection, id);
					break;
				}
				case 'count': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					out = ops.count(store, collection, itemIndex);
					break;
				}
				case 'drop': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					out = ops.drop(store, collection, itemIndex);
					break;
				}
				case 'collections': {
					out = ops.collections(store, itemIndex);
					break;
				}
				case 'hybridSearch': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					ensureBm25ForSearch(collection, itemIndex);
					out = ops.hybridSearch(
						store,
						bm25,
						{
							collection,
							queryVector: this.getNodeParameter('queryVector', itemIndex),
							queryText: this.getNodeParameter('queryText', itemIndex, ''),
							limit: this.getNodeParameter('limit', itemIndex, 50),
							mode: this.getNodeParameter('mode', itemIndex, 'rrf') as 'rrf' | 'weighted',
							vectorWeight: this.getNodeParameter('vectorWeight', itemIndex, 0.5),
							textWeight: this.getNodeParameter('textWeight', itemIndex, 0.5),
							rrfK: this.getNodeParameter('rrfK', itemIndex, 60),
							fetchK: this.getNodeParameter('fetchK', itemIndex, 0),
							metric: this.getNodeParameter('metric', itemIndex, 'cosine'),
							dimension,
						},
						itemIndex,
					);
					break;
				}
				case 'buildAnnIndex': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					out = ops.buildAnnIndex(
						store,
						{
							collection,
							numClusters: this.getNodeParameter('numClusters', itemIndex, 100),
							numProbes: this.getNodeParameter('numProbes', itemIndex, 10),
							sampleDims: this.getNodeParameter('sampleDims', itemIndex, 0),
							dimension,
						},
						itemIndex,
					);
					break;
				}
				case 'dropAnnIndex': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					out = ops.dropAnnIndex(store, collection, itemIndex);
					break;
				}
				case 'matryoshkaSearch': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					out = ops.matryoshkaSearch(
						store,
						{
							collection,
							queryVector: this.getNodeParameter('queryVector', itemIndex),
							limit: this.getNodeParameter('limit', itemIndex, 50),
							stages: this.getNodeParameter('stages', itemIndex, '[]'),
							metric: this.getNodeParameter('metric', itemIndex, 'cosine'),
							dimension,
						},
						itemIndex,
					);
					break;
				}
				case 'searchAcross': {
					out = ops.searchAcross(
						store,
						{
							collections: this.getNodeParameter('collections', itemIndex, ''),
							queryVector: this.getNodeParameter('queryVector', itemIndex),
							limit: this.getNodeParameter('limit', itemIndex, 50),
							metric: this.getNodeParameter('metric', itemIndex, 'cosine'),
							dimension,
						},
						itemIndex,
					);
					break;
				}
				default: {
					throw new Error(`Unknown Vector Store operation: "${operation}"`);
				}
			}

			if (isWriteOperation(operation)) {
				flushStore(store);
			}

			returnData.push(...out);
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: itemIndex },
				});
				continue;
			}
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
		}
	}

	return [returnData];
}

/**
 * Read a directory's basenames, returning `[]` if the directory does not exist
 * or cannot be read (e.g. first-ever run before any file is created).
 *
 * Pure-ish I/O helper used once per run to feed `detectCoherenceMismatch`.
 * Never throws — a missing directory simply means no pre-existing collections
 * to check, so there is no silent-empty risk to flag yet.
 */
function readDirSafe(dir: string): string[] {
	try {
		return fs.readdirSync(dir);
	} catch {
		return [];
	}
}