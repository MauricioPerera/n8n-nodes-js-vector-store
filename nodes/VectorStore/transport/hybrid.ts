import type { HybridSearchOpts } from 'js-vector-store';

/**
 * Pure helpers for the Hybrid Search (BM25 + vector) feature.
 *
 * `js-vector-store` ships `BM25Index` + `HybridSearch` as SEPARATE objects from
 * the `VectorStore` (spike §1, `.audit/report7_advanced_spike.md`): BM25 persists
 * to `<col>.bm25.json` under the SAME directory via its own `FileStorageAdapter`,
 * loads MANUALLY (no autoreload), and `HybridSearch` fuses the two rankings.
 *
 * The router owns the stateful `BM25Index` / adapter lifecycle (lazy load per
 * collection, save after writes). The functions HERE are PURE (no I/O, no side
 * effects) so they can be property-tested and gated independently:
 *
 *   - `bm25IndexFile` / `hasBm25Index`: locate the BM25 persistence file for a
 *     collection from a directory listing (the router feeds `fs.readdirSync`).
 *   - `buildHybridOpts`: turn raw user option values into the validated opts
 *     object passed to `HybridSearch.search`, applying engine defaults and the
 *     `fetchK = 0` -> "use engine default" convention.
 */

/** Engine defaults mirrored from `HybridSearch.search` (spike §1). */
const DEFAULT_VECTOR_WEIGHT = 0.5;
const DEFAULT_TEXT_WEIGHT = 0.5;
const DEFAULT_RRF_K = 60;
const DEFAULT_METRIC = 'cosine';

/** The on-disk JSON file a `BM25Index` writes for `collection`. */
export function bm25IndexFile(collection: string): string {
	return `${collection}.bm25.json`;
}

/**
 * Whether a BM25 index file for `collection` is present in `presentFiles`.
 *
 * Pure: receives the directory basenames (e.g. from `fs.readdirSync`), never
 * touches the filesystem. Exact filename match — `docs` is not confused with
 * `docs2`. Used by the router to decide lazy `bm25.load` and to reject hybrid
 * search on a collection that was never given a `text` field.
 */
export function hasBm25Index(collection: string, presentFiles: readonly string[]): boolean {
	return presentFiles.includes(bm25IndexFile(collection));
}

/** Pick a finite number or fall back to `fallback` (non-finite/missing -> default). */
function pickFinite(value: unknown, fallback: number): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	return fallback;
}

/**
 * Build the `HybridSearchOpts` object from raw user input, applying defaults.
 *
 * - `vectorWeight` / `textWeight` / `rrfK`: default to the engine defaults when
 *   missing or non-finite; otherwise passed through (the engine does NOT
 *   normalize the weights — spike §1).
 * - `metric`: default `'cosine'`; a non-empty string is passed through.
 * - `fetchK`: `0` (the node default) means "let the engine pick
 *   `max(limit*3, 50)`" -> OMITTED from the result so the engine default
 *   applies. A finite integer `> 0` is passed through (truncated). Non-finite
 *   or `<= 0` -> omitted.
 *
 * Pure: no I/O, no side effects. Returns a fresh object every call.
 */
export function buildHybridOpts(input: {
	vectorWeight?: unknown;
	textWeight?: unknown;
	rrfK?: unknown;
	fetchK?: unknown;
	metric?: unknown;
}): Required<Pick<HybridSearchOpts, 'vectorWeight' | 'textWeight' | 'rrfK' | 'metric'>> &
	Pick<HybridSearchOpts, 'fetchK'> {
	const metric =
		typeof input.metric === 'string' && input.metric.length > 0 ? input.metric : DEFAULT_METRIC;
	const fetchK =
		typeof input.fetchK === 'number' && Number.isFinite(input.fetchK) && input.fetchK > 0
			? Math.trunc(input.fetchK)
			: undefined;
	return {
		vectorWeight: pickFinite(input.vectorWeight, DEFAULT_VECTOR_WEIGHT),
		textWeight: pickFinite(input.textWeight, DEFAULT_TEXT_WEIGHT),
		rrfK: pickFinite(input.rrfK, DEFAULT_RRF_K),
		metric,
		fetchK,
	};
}