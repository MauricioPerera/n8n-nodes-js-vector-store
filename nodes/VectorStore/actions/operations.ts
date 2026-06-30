import type { INodeExecutionData } from 'n8n-workflow';

import { HybridSearch, IVFIndex, type BM25Index, type VectorStoreLike } from 'js-vector-store';
import { assertLimit, assertVector, parseMetadata, parseVectorInput } from '../helpers/validate';
import { assertIntAtLeast, parseCollections, parseStages } from '../transport/ann';
import { buildHybridOpts } from '../transport/hybrid';
import { toSearchItems } from './shape';

/**
 * Per-operation handlers for the Vector Store node.
 *
 * Each function takes an already-open `js-vector-store` instance plus the
 * parsed primitive parameters for one input item (bundled in a params object
 * for the wide ones), performs the library call (validating inputs via
 * `helpers/validate` first — the library does NOT validate and corrupts
 * silently on bad dimension / crashes on `limit < 1`), and returns n8n output
 * items with `pairedItem` set.
 *
 * These functions do NOT call `flush()`. Persistence is the router's
 * responsibility (one flush after write operations), so read operations never
 * flush and write operations flush once per item from the router.
 */

/** Parameters for the Upsert (`set`) operation. */
export interface UpsertParams {
	collection: string;
	id: string;
	vector: unknown;
	metadata: unknown;
	dimension: number;
}

/** Parameters for the Search operation. */
export interface SearchParams {
	collection: string;
	queryVector: unknown;
	limit: unknown;
	metric: string;
	filter: unknown;
	dimSlice: unknown;
	dimension: number;
	/** When true, use the IVF ANN index (cosine-only; metric/filter/dimSlice ignored). */
	useIndex: boolean;
}

/** Parameters for the Hybrid Search operation. */
export interface HybridSearchParams {
	collection: string;
	queryVector: unknown;
	queryText: unknown;
	limit: unknown;
	mode: 'rrf' | 'weighted';
	vectorWeight: unknown;
	textWeight: unknown;
	rrfK: unknown;
	fetchK: unknown;
	metric: unknown;
	dimension: number;
}

/** Parameters for the Build ANN Index operation. */
export interface BuildAnnIndexParams {
	collection: string;
	numClusters: unknown;
	numProbes: unknown;
	sampleDims: unknown;
	dimension: number;
}

/** Parameters for the Matryoshka Search operation. */
export interface MatryoshkaSearchParams {
	collection: string;
	queryVector: unknown;
	limit: unknown;
	stages: unknown;
	metric: unknown;
	dimension: number;
}

/** Parameters for the Search Across operation. */
export interface SearchAcrossParams {
	collections: unknown;
	queryVector: unknown;
	limit: unknown;
	metric: unknown;
	dimension: number;
}

/** Coerce an empty/blank user string into `undefined` so `parseMetadata` treats it as "no metadata". */
function emptyToUndefined(value: unknown): unknown {
	if (value === '' || value === undefined || value === null) return undefined;
	return value;
}

/** Coerce an empty/blank user string into `null` (search filter: null = no filter). */
function emptyToNull(value: unknown): unknown {
	if (value === '' || value === undefined || value === null) return null;
	return value;
}

/** Coerce `dimSlice` into a non-negative integer, defaulting to 0 (use all dims). */
function coerceDimSlice(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
	const n = Math.trunc(value);
	return n < 0 ? 0 : n;
}

/** Upsert (`set`): validate vector against the credential dimension, then store + return receipt. */
export function upsert(
	store: VectorStoreLike,
	params: UpsertParams,
	itemIndex: number,
): INodeExecutionData[] {
	const vector = assertVector(parseVectorInput(params.vector), params.dimension);
	const metadata = parseMetadata(emptyToUndefined(params.metadata));
	store.set(params.collection, params.id, vector, metadata);
	return [
		{ json: { collection: params.collection, id: params.id, upserted: true }, pairedItem: { item: itemIndex } },
	];
}

/**
 * Search: validate query + limit, then either brute-force search (default) or
 * ANN search over the IVF index when `useIndex` is on.
 *
 * `useIndex = true` switches to `IVFIndex.search`, which is COSINE-ONLY and
 * does NOT accept `metric` / `filter` / `dimSlice` (spike §2) — those are
 * ignored by design. A clear Error is thrown when the collection has no IVF
 * index on disk (no silent fallback to brute-force, so the user is never
 * confused about which path ran). `useIndex = false` is the pre-1.1 brute-force
 * path, unchanged.
 */
export function search(
	store: VectorStoreLike,
	params: SearchParams,
	itemIndex: number,
): INodeExecutionData[] {
	const query = assertVector(parseVectorInput(params.queryVector), params.dimension);
	const limit = assertLimit(params.limit);
	if (params.useIndex) {
		const ivf = new IVFIndex(store);
		if (!ivf.hasIndex(params.collection)) {
			throw new Error(
				`No ANN index for collection "${params.collection}"; run Build ANN Index first.`,
			);
		}
		const hits = ivf.search(params.collection, query, limit);
		return toSearchItems(hits, itemIndex);
	}
	const filter = emptyToNull(params.filter);
	const filterObj = filter === null ? null : parseMetadata(filter);
	const dimSlice = coerceDimSlice(params.dimSlice);
	const hits = store.search(params.collection, query, limit, dimSlice, params.metric, filterObj);
	return toSearchItems(hits, itemIndex);
}

/** Get: return the stored record, or `{ found: false }` when the id is absent. */
export function get(
	store: VectorStoreLike,
	collection: string,
	id: string,
	itemIndex: number,
): INodeExecutionData[] {
	const record = store.get(collection, id);
	if (record === null) {
		return [{ json: { collection, id, found: false }, pairedItem: { item: itemIndex } }];
	}
	return [
		{
			json: { id: record.id, vector: record.vector, metadata: record.metadata ?? {} },
			pairedItem: { item: itemIndex },
		},
	];
}

/** Delete (`remove`): return whether the id was present and removed. */
export function remove(
	store: VectorStoreLike,
	collection: string,
	id: string,
	itemIndex: number,
): INodeExecutionData[] {
	const deleted = store.remove(collection, id);
	return [{ json: { collection, id, deleted }, pairedItem: { item: itemIndex } }];
}

/** Count: return the number of vectors in the collection. */
export function count(store: VectorStoreLike, collection: string, itemIndex: number): INodeExecutionData[] {
	return [{ json: { collection, count: store.count(collection) }, pairedItem: { item: itemIndex } }];
}

/** Drop Collection: remove the whole collection. */
export function drop(store: VectorStoreLike, collection: string, itemIndex: number): INodeExecutionData[] {
	store.drop(collection);
	return [{ json: { collection, dropped: true }, pairedItem: { item: itemIndex } }];
}

/** List Collections: return a single item with the list of collection names. */
export function collections(store: VectorStoreLike, itemIndex: number): INodeExecutionData[] {
	return [{ json: { collections: store.collections() }, pairedItem: { item: itemIndex } }];
}

/**
 * Hybrid Search: fuse the vector store (semantic) with a BM25 index (lexical)
 * via `HybridSearch`, returning one item per hit `{ id, score, metadata }`.
 *
 * The router owns the `BM25Index` lifecycle and guarantees it is LOADED for the
 * collection before calling this handler (a hybrid search on a collection
 * without a BM25 index is rejected by the router with a clear error). The
 * handler validates the query vector + limit, builds the engine opts via the
 * pure `buildHybridOpts`, constructs a fresh `HybridSearch(store, bm25, mode)`,
 * and maps hits with `toSearchItems`. Hybrid does NOT support a post-filter
 * (spike §1); filtering must happen downstream.
 */
export function hybridSearch(
	store: VectorStoreLike,
	bm25: BM25Index,
	params: HybridSearchParams,
	itemIndex: number,
): INodeExecutionData[] {
	const query = assertVector(parseVectorInput(params.queryVector), params.dimension);
	const limit = assertLimit(params.limit);
	const text = typeof params.queryText === 'string' ? params.queryText : '';
	const opts = buildHybridOpts({
		vectorWeight: params.vectorWeight,
		textWeight: params.textWeight,
		rrfK: params.rrfK,
		fetchK: params.fetchK,
		metric: params.metric,
	});
	const hybrid = new HybridSearch(store, bm25, params.mode);
	const hits = hybrid.search(params.collection, query, text, limit, opts);
	return toSearchItems(hits, itemIndex);
}

/**
 * Build ANN Index: run the (expensive) one-time IVF K-means build for a
 * collection and persist `<col>.ivf.json`.
 *
 * `numClusters` / `numProbes` must be finite integers `>= 1`; `sampleDims` is a
 * finite integer `>= 0` where `0` means "use the credential dimension". The
 * library does NOT validate these and the build is O(K·N·dim) (minutes at
 * >10k vectors — spike §2), so they are gated up front. The build is a SNAPSHOT:
 * it is invalidated by later writes and must be re-run manually. The router
 * flushes after this write.
 */
export function buildAnnIndex(
	store: VectorStoreLike,
	params: BuildAnnIndexParams,
	itemIndex: number,
): INodeExecutionData[] {
	const numClusters = assertIntAtLeast(params.numClusters, 'numClusters', 1);
	const numProbes = assertIntAtLeast(params.numProbes, 'numProbes', 1);
	const sampleDimsRaw = assertIntAtLeast(params.sampleDims, 'sampleDims', 0);
	const sampleDims = sampleDimsRaw === 0 ? params.dimension : sampleDimsRaw;
	const ivf = new IVFIndex(store, numClusters, numProbes);
	const res = ivf.build(params.collection, sampleDims);
	return [
		{
			json: {
				collection: params.collection,
				numClusters: res.numClusters,
				numVectors: res.numVectors,
				built: true,
			},
			pairedItem: { item: itemIndex },
		},
	];
}

/**
 * Drop ANN Index: delete `<col>.ivf.json` and forget the in-memory index.
 *
 * Returns `{ dropped: bool }` reflecting whether an index existed before the
 * call. `dropIndex` is safe on a collection with no index (the adapter delete is
 * guarded), so `dropped` is computed from `hasIndex` first. The router flushes
 * after this write.
 */
export function dropAnnIndex(
	store: VectorStoreLike,
	collection: string,
	itemIndex: number,
): INodeExecutionData[] {
	const ivf = new IVFIndex(store);
	const had = ivf.hasIndex(collection);
	ivf.dropIndex(collection);
	return [
		{ json: { collection, dropped: had }, pairedItem: { item: itemIndex } },
	];
}

/**
 * Matryoshka Search: cascade search over progressively wider dimensional slices.
 *
 * Validates the query + limit, parses `stages` into a dim-clamped list (falling
 * back to dim-proportional defaults when empty), and defaults `metric` to
 * `'cosine'`. Returns one item per hit with `pairedItem`.
 */
export function matryoshkaSearch(
	store: VectorStoreLike,
	params: MatryoshkaSearchParams,
	itemIndex: number,
): INodeExecutionData[] {
	const query = assertVector(parseVectorInput(params.queryVector), params.dimension);
	const limit = assertLimit(params.limit);
	const stages = parseStages(params.stages, params.dimension);
	const metric =
		typeof params.metric === 'string' && params.metric.length > 0 ? params.metric : 'cosine';
	const hits = store.matryoshkaSearch(params.collection, query, limit, stages, metric);
	return toSearchItems(hits, itemIndex);
}

/**
 * Search Across: fuse multiple collections into one global top-K.
 *
 * Parses `collections` (comma string or array) into a trimmed, de-duplicated
 * list and requires at least one name. The engine result does NOT label the
 * originating collection (spike §4) — the node description documents that the
 * user must store the collection in metadata if they need the origin. Returns
 * one item per hit with `pairedItem`.
 */
export function searchAcross(
	store: VectorStoreLike,
	params: SearchAcrossParams,
	itemIndex: number,
): INodeExecutionData[] {
	const collections = parseCollections(params.collections);
	if (collections.length === 0) {
		throw new Error('Search Across requires at least one collection name');
	}
	const query = assertVector(parseVectorInput(params.queryVector), params.dimension);
	const limit = assertLimit(params.limit);
	const metric =
		typeof params.metric === 'string' && params.metric.length > 0 ? params.metric : 'cosine';
	const hits = store.searchAcross(collections, query, limit, metric);
	return toSearchItems(hits, itemIndex);
}