import path from 'node:path';
import { VectorStore } from 'js-vector-store';

/**
 * Validate that `storeDirectory` is a non-empty absolute filesystem path.
 *
 * Re-validated here at runtime on every open — the credential definition only
 * declares the field, it must not be trusted as the sole gate.
 */
function assertAbsoluteStoreDirectory(storeDirectory: unknown): asserts storeDirectory is string {
	if (typeof storeDirectory !== 'string' || storeDirectory.length === 0) {
		throw new Error(
			`Vector Store storeDirectory must be a non-empty string, got: ${typeof storeDirectory}`,
		);
	}
	if (!path.isAbsolute(storeDirectory)) {
		throw new Error(
			`Vector Store storeDirectory must be an absolute path, got: "${storeDirectory}"`,
		);
	}
}

/**
 * Validate that `dimension` is a positive integer.
 *
 * `dim` is fixed per store and used to validate every vector later; a bad
 * value here would corrupt the whole collection.
 */
function assertPositiveIntegerDimension(dimension: unknown): asserts dimension is number {
	if (
		typeof dimension !== 'number' ||
		!Number.isFinite(dimension) ||
		!Number.isInteger(dimension) ||
		dimension < 1
	) {
		throw new Error(
			`Vector Store dimension must be a positive integer, got: ${dimension}`,
		);
	}
}

/**
 * Open (or create) a js-vector-store `VectorStore` rooted at `storeDirectory`
 * with the fixed vector `dimension`.
 *
 * - Validates the directory is absolute and the dimension is a positive
 *   integer at runtime (never trusts the credential only).
 * - Passing a string path makes js-vector-store build a `FileStorageAdapter`
 *   internally, persisting `<col>.bin` + `<col>.json` under that directory.
 * - The caller owns the lifecycle and MUST call `flushStore(store)` after
 *   writes: `set()` only accumulates in pending; without `flush()` changes do
 *   not reach disk and are lost when the n8n process restarts.
 */
export function openStore(storeDirectory: string, dimension: number): VectorStore {
	assertAbsoluteStoreDirectory(storeDirectory);
	assertPositiveIntegerDimension(dimension);
	return new VectorStore(storeDirectory, dimension);
}

/**
 * Flush a VectorStore's pending writes to disk.
 *
 * Wraps `store.flush()` so the node has a single, explicit persistence point
 * and a clear error path — never swallows the flush error silently. Safe to
 * call on a store with no pending writes.
 */
export function flushStore(store: VectorStore): void {
	store.flush();
}