/**
 * Quantization (`indexType`) helpers for the Vector Store node.
 *
 * `js-vector-store` ships four ALTERNATIVE store classes with the same API but
 * different on-disk file suffixes (spike §3, `.audit/report7_advanced_spike.md`):
 *
 *   - `VectorStore`            -> `<col>.bin`    (Float32, exact, default)
 *   - `QuantizedStore`         -> `<col>.q8.bin` (Int8, ~3x smaller)
 *   - `BinaryQuantizedStore`   -> `<col>.b1.bin` (1-bit, ~9x smaller, dim >= 768)
 *   - `PolarQuantizedStore`    -> `<col>.p3.bin` (3-bit, ~21x smaller, even dim)
 *
 * They are per-store: a collection lives under ONE format, fixed at construction.
 * Opening an existing collection with the WRONG class is the silent-failure case
 * the spike flags — the class looks for its own suffix, does not find it, and
 * reports `count = 0` without error. The helpers here map an `indexType` to its
 * file suffix and detect that mismatch from the directory listing so the node
 * can fail loudly instead of silently.
 *
 * All functions here are PURE (no I/O, no side effects) so they can be
 * property-tested and gated independently. The router reads the directory and
 * feeds the basenames to `detectCoherenceMismatch`.
 */

/** Quantization strategy a credential declares for its store. */
export type IndexType = 'float32' | 'int8' | 'binary' | 'polar3';

/** The four valid `indexType` values, in canonical order. */
export const INDEX_TYPES: readonly IndexType[] = ['float32', 'int8', 'binary', 'polar3'];

/**
 * The on-disk binary-file suffix a store class writes for a collection.
 *
 * `<collection>` + this suffix = the full filename the matching class reads.
 * Used both to instantiate the right class and to detect cross-type collisions.
 */
export function indexFileSuffix(indexType: IndexType): string {
	switch (indexType) {
		case 'float32':
			return '.bin';
		case 'int8':
			return '.q8.bin';
		case 'binary':
			return '.b1.bin';
		case 'polar3':
			return '.p3.bin';
		default:
			throw new Error(`Unknown indexType: ${indexType as string}`);
	}
}

/**
 * The full binary filename a store of `indexType` reads/writes for `collection`.
 *
 * Pure composition of `collection + indexFileSuffix(indexType)`.
 */
export function expectedIndexFile(indexType: IndexType, collection: string): string {
	return `${collection}${indexFileSuffix(indexType)}`;
}

/** Result of checking a directory's files against the declared `indexType`. */
export interface CoherenceResult {
	/** True when another type's file exists for the collection but the declared type's does NOT. */
	mismatch: boolean;
	/** The file the declared `indexType` expects for this collection. */
	declaredFile: string;
	/** The other `indexType` detected on disk, if `mismatch` is true. */
	detectedType: IndexType | null;
	/** The other type's file found on disk, if `mismatch` is true. */
	detectedFile: string | null;
}

/**
 * Detect whether an existing collection on disk was created with a different
 * `indexType` than the credential declares — the silent-empty case.
 *
 * - If the declared type's file is present, there is no mismatch: the matching
 *   store class will load it. (Other-type files for the same collection are
 *   harmless orphans, not the dangerous case.)
 * - If the declared type's file is absent BUT another type's file is present,
 *   the declared store class would open the collection as `count = 0` silently:
 *   `mismatch` is true with the `detectedType`/`detectedFile` filled in.
 * - If no type's file is present, the collection is new (or absent): no mismatch.
 *
 * `presentFiles` are directory basenames (e.g. from `fs.readdirSync`).
 */
export function detectCoherenceMismatch(
	declared: IndexType,
	collection: string,
	presentFiles: readonly string[],
): CoherenceResult {
	const declaredFile = expectedIndexFile(declared, collection);
	if (presentFiles.includes(declaredFile)) {
		return { mismatch: false, declaredFile, detectedType: null, detectedFile: null };
	}
	for (const candidate of INDEX_TYPES) {
		if (candidate === declared) continue;
		const candidateFile = expectedIndexFile(candidate, collection);
		if (presentFiles.includes(candidateFile)) {
			return { mismatch: true, declaredFile, detectedType: candidate, detectedFile: candidateFile };
		}
	}
	return { mismatch: false, declaredFile, detectedType: null, detectedFile: null };
}

/**
 * Assert that `value` is one of the four valid `indexType` values.
 *
 * The credential options restrict to these, but the runtime must not trust the
 * credential definition alone — re-validate before constructing a store.
 */
export function assertValidIndexType(value: unknown): asserts value is IndexType {
	if (typeof value !== 'string' || !(INDEX_TYPES as readonly string[]).includes(value)) {
		throw new Error(
			`Vector Store indexType must be one of ${INDEX_TYPES.join(', ')}, got: ${value}`,
		);
	}
}