import type { IvfBuildResult, IvfStats, IVFIndex, SearchHit, VectorStoreLike } from 'js-vector-store';

/**
 * Pure helpers for the IVF ANN, Matryoshka and Search Across features.
 *
 * `js-vector-store` ships `IVFIndex` as a SEPARATE object from the store (spike
 * §2, `.audit/report7_advanced_spike.md`): it persists to `<col>.ivf.json` under
 * the SAME directory, lazy-loads on first access, is COSINE-ONLY, does NOT
 * accept `metric`/`filter`, and is a SNAPSHOT (no auto-rebuild). The store
 * classes also expose `matryoshkaSearch` (cascade over dimensional slices) and
 * `searchAcross` (fuses multiple collections, no origin label — spike §4).
 *
 * The router owns the stateful `IVFIndex` lifecycle. The functions HERE are PURE
 * (no I/O, no side effects) so they can be property-tested and gated
 * independently:
 *
 *   - `ivfIndexFile` / `hasIvfIndex`: locate the IVF persistence file for a
 *     collection from a directory listing (mirror of `hybrid.ts` for BM25).
 *   - `defaultStages` / `parseStages`: turn the user `stages` input into a
 *     validated, dim-clamped, ascending list of positive ints, falling back to
 *     dim-derived defaults when empty/invalid.
 *   - `parseCollections`: turn the user `collections` input (comma string or
 *     array) into a trimmed, de-duplicated list of non-empty names.
 *   - `assertIntAtLeast`: validate `numClusters` / `numProbes` / `sampleDims`
 *     as finite integers within range (the library does NOT validate and the
 *     build is expensive — fail loudly before reaching it).
 *
 * The stateful wrappers (`runAnnBuild`, `runAnnSearch`, `runMatryoshkaSearch`,
 * `runSearchAcross`) live in `actions/operations.ts`; they call these helpers
 * for input shaping and the library for the actual work.
 */

/** The on-disk JSON file an `IVFIndex` writes for `collection`. */
export function ivfIndexFile(collection: string): string {
	return `${collection}.ivf.json`;
}

/**
 * Whether an IVF index file for `collection` is present in `presentFiles`.
 *
 * Pure: receives directory basenames (e.g. from `fs.readdirSync`), never touches
 * the filesystem. Exact filename match — `docs` is not confused with `docs2`.
 * Used by the router/integration tests to reason about index presence without
 * constructing an `IVFIndex`; the live `hasIndex` check in the search path uses
 * the real `IVFIndex.hasIndex` (lazy disk read) so it reflects in-run builds.
 */
export function hasIvfIndex(collection: string, presentFiles: readonly string[]): boolean {
	return presentFiles.includes(ivfIndexFile(collection));
}

/**
 * Default Matryoshka stages derived from the vector dimension: increasing
 * fractions `[floor(dim/4), floor(dim/2), dim]`, filtered to `>= 1` and
 * de-duplicated while preserving order.
 *
 * The engine default `[128, 384, 768]` assumes `dim = 768`; for any other dim
 * we derive stages proportional to it (spike §4: out-of-range stages are
 * clamped with `Math.min(stage, dim)` anyway, but proportional defaults give a
 * meaningful cascade rather than a single-stage degeneration).
 *
 *   dim 16  -> [4, 8, 16]
 *   dim 8   -> [2, 4, 8]
 *   dim 768 -> [192, 384, 768]
 *   dim 1   -> [1]
 */
export function defaultStages(dim: number): number[] {
	const safe = Math.max(1, Math.floor(dim));
	const fractions = [Math.floor(safe / 4), Math.floor(safe / 2), safe];
	const out: number[] = [];
	for (const s of fractions) {
		if (s >= 1 && !out.includes(s)) out.push(s);
	}
	return out;
}

/**
 * Coerce a raw user value into a cleaned array of finite numbers, or `null`
 * when the input is not a recognizable array of numbers.
 *
 * - `undefined` / `null` / `''` / invalid JSON / a non-array JSON value -> `null`
 *   (caller falls back to defaults).
 * - An array (or a JSON string parsing to one) -> the finite-number elements
 *   kept in order; non-finite elements are dropped (lenient, mirrors
 *   `buildHybridOpts` rather than throwing on bad opts).
 */
function toNumberArray(value: unknown): number[] | null {
	let arr: unknown;
	if (value === undefined || value === null || value === '') return null;
	if (Array.isArray(value)) {
		arr = value;
	} else if (typeof value === 'string') {
		try {
			arr = JSON.parse(value.trim());
		} catch {
			return null;
		}
	} else {
		return null;
	}
	if (!Array.isArray(arr)) return null;
	const out: number[] = [];
	for (const el of arr) {
		if (typeof el === 'number' && Number.isFinite(el)) out.push(el);
	}
	return out;
}

/**
 * Parse the user `stages` input into a validated Matryoshka stages list.
 *
 * - Accepts an array of numbers or a JSON string encoding one.
 * - Each element is truncated to an integer and clamped with
 *   `Math.min(stage, dim)` (the engine clamps anyway, but we do it up front so
 *   the value is honest); elements `< 1` are dropped.
 * - Empty / missing / invalid input -> `defaultStages(dim)` (proportional to
 *   dim). An explicitly-empty array (`[]`) also falls back to the default.
 *
 * Pure: no I/O, no side effects. Returns a fresh array every call.
 */
export function parseStages(value: unknown, dim: number): number[] {
	const raw = toNumberArray(value);
	const stages = raw === null ? defaultStages(dim) : raw;
	const safeDim = Math.max(1, Math.floor(dim));
	const out: number[] = [];
	for (const s of stages) {
		if (typeof s !== 'number' || !Number.isFinite(s)) continue;
		const n = Math.min(Math.trunc(s), safeDim);
		if (n >= 1) out.push(n);
	}
	return out.length > 0 ? out : defaultStages(dim);
}

/**
 * Parse the user `collections` input for Search Across into a trimmed,
 * de-duplicated list of non-empty collection names.
 *
 * - A string is split on commas (the node offers a comma-separated input).
 * - An array (multiOptions) is taken as-is.
 * - Non-string elements are dropped; empty/blank names are dropped; duplicates
 *   are removed preserving first-seen order.
 * - `undefined` / `null` / other types -> `[]` (the caller validates that at
 *   least one collection remains before calling the engine).
 *
 * Pure: no I/O, no side effects.
 */
export function parseCollections(value: unknown): string[] {
	let arr: unknown[];
	if (Array.isArray(value)) {
		arr = value;
	} else if (typeof value === 'string') {
		arr = value.split(',');
	} else {
		return [];
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const el of arr) {
		if (typeof el !== 'string') continue;
		const name = el.trim();
		if (name.length === 0 || seen.has(name)) continue;
		seen.add(name);
		out.push(name);
	}
	return out;
}

/**
 * Assert that `value` is a finite integer `>= min`, returning it truncated.
 *
 * Used for `numClusters` (`min = 1`), `numProbes` (`min = 1`) and `sampleDims`
 * (`min = 0`). The IVF build is expensive and the library does NOT validate
 * these, so a clear Error before reaching `build()` is mandatory. `name` is
 * included in the message so the user knows which field to fix.
 */
export function assertIntAtLeast(value: unknown, name: string, min: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${name} must be a finite integer >= ${min}, got: ${value}`);
	}
	const n = Math.trunc(value);
	if (n < min) {
		throw new Error(`${name} must be >= ${min}, got: ${value}`);
	}
	return n;
}

// Re-export the library types the operations module builds on, so callers have
// a single import surface for the ANN feature.
export type { IvfBuildResult, IvfStats, IVFIndex, SearchHit, VectorStoreLike };