/**
 * Minimal local type declarations for `js-vector-store`.
 *
 * The package ships no `.d.ts` (it is plain vanilla JS). This ambient module
 * declaration covers only the surface the Vector Store node uses, typed
 * tightly enough to catch misuse at compile time without pretending to model
 * the whole library. Types here reflect the verified API from the spike
 * (`.audit/report7_advanced_spike.md`), not the (incomplete) README.
 *
 * `set()` accumulates into pending state; `flush()` persists to disk. The
 * library does NOT validate inputs — the node's `helpers/validate.ts` does.
 *
 * The library ships four ALTERNATIVE store classes (`VectorStore`,
 * `QuantizedStore`, `BinaryQuantizedStore`, `PolarQuantizedStore`) with the
 * SAME surface but different on-disk file suffixes (Float32 / Int8 / 1-bit /
 * 3-bit). They all satisfy `VectorStoreLike`, so the node holds a store via
 * that common interface and picks the concrete class from the credential's
 * `indexType` in `transport/store.ts`.
 */
declare module 'js-vector-store' {
	export interface VectorRecord {
		id: string;
		vector: number[];
		metadata?: Record<string, unknown>;
	}

	export interface SearchHit {
		id: string;
		score: number;
		metadata?: Record<string, unknown>;
	}

	/** Common surface every store class (`VectorStore` + the 3 quantized ones) implements. */
	export interface VectorStoreLike {
		set(
			collection: string,
			id: string,
			vector: number[],
			metadata?: Record<string, unknown>,
		): void;

		get(collection: string, id: string): VectorRecord | null;

		remove(collection: string, id: string): boolean;

		has(collection: string, id: string): boolean;

		count(collection: string): number;

		ids(collection: string): string[];

		drop(collection: string): void;

		/** Persist pending writes to disk. Mandatory after `set`/`remove`/`drop`. */
		flush(): void;

		collections(): string[];

		stats(): unknown;

		import(collection: string, records: VectorRecord[]): void;

		export(collection: string): VectorRecord[];

		search(
			collection: string,
			query: number[],
			limit?: number,
			dimSlice?: number,
			metric?: string,
			filter?: Record<string, unknown> | null,
		): SearchHit[];

		/**
		 * Cascade search across progressively wider dimensional slices
		 * (Matryoshka). `stages` default `[128, 384, 768]` assumes `dim = 768`;
		 * for another `dim` pass stages acords (each is clamped with
		 * `Math.min(stage, dim)`). Returns `{ id, score, metadata }` hits.
		 */
		matryoshkaSearch(
			collection: string,
			query: number[],
			limit?: number,
			stages?: number[],
			metric?: string,
		): SearchHit[];

		/**
		 * Search across multiple collections, min-max normalizing scores per
		 * collection and fusing into one global top-K. Returns
		 * `{ id, score, metadata }` hits — the originating collection is NOT
		 * labeled (spike §4); store it in metadata beforehand if needed.
		 */
		searchAcross(
			collections: string[],
			query: number[],
			limit?: number,
			metric?: string,
		): SearchHit[];
	}

	/** Options shared by the quantized store constructors. */
	export interface QuantizedStoreOptions {
		model?: string;
		/** Polar only: bits per angle (2-8, default 3). */
		bits?: number;
		/** Polar only: deterministic rotation seed (default 42). */
		seed?: number;
	}

	/**
	 * Internal base declaring the common store surface ONCE. The four real store
	 * classes extend it so their types include every method without repeating
	 * the declarations (and without class/interface declaration merging). Not
	 * exported — callers hold a store via the `VectorStoreLike` interface.
	 */
	class StoreBase implements VectorStoreLike {
		set(
			collection: string,
			id: string,
			vector: number[],
			metadata?: Record<string, unknown>,
		): void;

		get(collection: string, id: string): VectorRecord | null;

		remove(collection: string, id: string): boolean;

		has(collection: string, id: string): boolean;

		count(collection: string): number;

		ids(collection: string): string[];

		drop(collection: string): void;

		/** Persist pending writes to disk. Mandatory after `set`/`remove`/`drop`. */
		flush(): void;

		collections(): string[];

		stats(): unknown;

		import(collection: string, records: VectorRecord[]): void;

		export(collection: string): VectorRecord[];

		search(
			collection: string,
			query: number[],
			limit?: number,
			dimSlice?: number,
			metric?: string,
			filter?: Record<string, unknown> | null,
		): SearchHit[];

		matryoshkaSearch(
			collection: string,
			query: number[],
			limit?: number,
			stages?: number[],
			metric?: string,
		): SearchHit[];

		searchAcross(
			collections: string[],
			query: number[],
			limit?: number,
			metric?: string,
		): SearchHit[];
	}

	/** Float32 store -> `<col>.bin` + `<col>.json`. Exact, the default. */
	export class VectorStore extends StoreBase {
		constructor(dirPath: string, dim: number, maxCollections?: number, opts?: QuantizedStoreOptions);
	}

	/** Int8 quantized store -> `<col>.q8.bin` + `<col>.q8.json` (~3x smaller). */
	export class QuantizedStore extends StoreBase {
		constructor(dirPath: string, dim?: number, opts?: QuantizedStoreOptions);
	}

	/** 1-bit binary quantized store -> `<col>.b1.bin` + `<col>.b1.json` (~9x, dim >= 768). */
	export class BinaryQuantizedStore extends StoreBase {
		constructor(dirPath: string, dim?: number, opts?: QuantizedStoreOptions);
	}

	/** 3-bit polar quantized store -> `<col>.p3.bin` + `<col>.p3.json` (~21x, `dim` must be even). */
	export class PolarQuantizedStore extends StoreBase {
		constructor(dirPath: string, dim?: number, opts?: QuantizedStoreOptions);
	}

	/**
	 * Filesystem adapter used by both the store classes (internally) and by
	 * `BM25Index` for its own persistence. The store does NOT expose its adapter,
	 * so the node builds a second one over the SAME directory to persist BM25
	 * (spike §1: `new FileStorageAdapter(storeDirectory)`).
	 */
	export class FileStorageAdapter {
		constructor(storeDirectory: string);
		readJson<T = unknown>(filePath: string): T;
		writeJson(filePath: string, data: unknown): void;
		readBin(filePath: string): Float32Array;
		writeBin(filePath: string, data: Float32Array): void;
		delete(filePath: string): void;
	}

	/** Hit from a pure BM25 text search: no metadata (BM25 only indexes text). */
	export interface Bm25SearchHit {
		id: string;
		score: number;
	}

	/** Constructor options for `BM25Index` (all optional). */
	export interface BM25IndexOptions {
		k1?: number;
		b?: number;
		tokenizer?: unknown;
	}

	/**
	 * Lexical (BM25) index over per-collection documents. Independent of any
	 * `VectorStore`: shares the SAME directory via a separate `FileStorageAdapter`
	 * and writes `<col>.bm25.json`. Persistence is MANUAL and per-collection:
	 * `save(adapter, col)` writes, `load(adapter, col)` reads — there is NO
	 * autoreload, so the node must call `load` explicitly before a cross-process
	 * hybrid search (spike §1).
	 *
	 * `addDocument` is an upsert (reinserts if the id exists); `removeDocument`
	 * exists and is the sync hook for the node's Delete operation.
	 */
	export class BM25Index {
		constructor(opts?: BM25IndexOptions);
		addDocument(collection: string, id: string, text: string): void;
		removeDocument(collection: string, id: string): void;
		search(collection: string, query: string, limit?: number): Bm25SearchHit[];
		count(collection: string): number;
		vocabularySize(collection: string): number;
		save(adapter: FileStorageAdapter, collection: string): void;
		load(adapter: FileStorageAdapter, collection: string): void;
	}

	/** Options accepted by `HybridSearch.search` (all optional, engine-supplied defaults). */
	export interface HybridSearchOpts {
		vectorWeight?: number;
		textWeight?: number;
		rrfK?: number;
		/** Candidate pool size from the vector side. Omit to use the engine default `max(limit*3, 50)`. */
		fetchK?: number;
		metric?: string;
	}

	/**
	 * Fuses a `VectorStore` (semantic) with a `BM25Index` (lexical) into one
	 * ranked result. `mode` selects the fusion strategy:
	 *   `'rrf'`      -> Reciprocal Rank Fusion (rank-based, weight-agnostic).
	 *   `'weighted'` -> linear blend of normalized scores using the weights.
	 *
	 * Returns `{ id, score, metadata }` hits (metadata comes from the store), so
	 * the node reuses `toSearchItems`. Does NOT support a post-filter (spike §1);
	 * the node must post-filter the fused result if needed.
	 */
	export class HybridSearch {
		constructor(store: VectorStoreLike, bm25: BM25Index, mode?: 'rrf' | 'weighted');
		search(
			collection: string,
			vector: number[],
			text: string,
			limit?: number,
			opts?: HybridSearchOpts,
		): SearchHit[];
	}

	/** Result of `IVFIndex.build`: the cluster count actually used and vectors indexed. */
	export interface IvfBuildResult {
		numClusters: number;
		numVectors: number;
	}

	/** Result of `IVFIndex.indexStats`: `null` when no index is loaded for the collection. */
	export interface IvfStats {
		numClusters: number;
		numProbes: number;
	}

	/**
	 * IVF (Inverted File) ANN index built on top of any store class (Float32 or
	 * quantized). K-means clusters the vectors once (`build`, expensive:
	 * O(K·N·dim) — minutes at >10k vectors), then `search` probes only the
	 * nearest `numProbes` clusters. COSINE-ONLY (spike §2): `search` does NOT
	 * accept `metric` or `filter` — it computes `cosineSim` directly. The node
	 * must NOT auto-build; the index is a SNAPSHOT invalidated by later writes.
	 *
	 * Persists `<col>.ivf.json` under the store's directory and auto-loads it
	 * lazily on the first `search`/`hasIndex` of a process (spike §2: pass the
	 * same `numClusters`/`numProbes` to the ctor for coherence, but `search`
	 * reads `numProbes` from the file).
	 */
	export class IVFIndex {
		constructor(store: VectorStoreLike, numClusters?: number, numProbes?: number);
		/** Expensive one-time build. `sampleDims` = dims used for centroid distance. */
		build(collection: string, sampleDims?: number): IvfBuildResult;
		/** ANN search. COSINE-ONLY; throws if no index for the collection. */
		search(collection: string, query: number[], limit?: number): SearchHit[];
		/** True once `<col>.ivf.json` is loaded/present (lazy disk read). */
		hasIndex(collection: string): boolean;
		/** Delete `<col>.ivf.json` and forget the in-memory index. */
		dropIndex(collection: string): void;
		/** `{ numClusters, numProbes }` or `null` when no index. */
		indexStats(collection: string): IvfStats | null;
	}
}