import path from 'node:path';
import {
	BinaryQuantizedStore,
	PolarQuantizedStore,
	QuantizedStore,
	VectorStore,
} from 'js-vector-store';
import type { VectorStoreLike } from 'js-vector-store';

import { assertValidIndexType, type IndexType } from './indexType';

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
 * Open (or create) a `js-vector-store` instance rooted at `storeDirectory`
 * with the fixed vector `dimension`, using the quantization `indexType`.
 *
 * - Validates the directory is absolute, the dimension is a positive integer,
 *   and the `indexType` is one of the four valid values at runtime (never
 *   trusts the credential only).
 * - Picks the concrete class from `indexType`:
 *     `float32` -> `VectorStore`            (`<col>.bin`)
 *     `int8`    -> `QuantizedStore`         (`<col>.q8.bin`)
 *     `binary`  -> `BinaryQuantizedStore`   (`<col>.b1.bin`)
 *     `polar3`  -> `PolarQuantizedStore`    (`<col>.p3.bin`)
 *   All share the `VectorStoreLike` surface, so callers treat them identically.
 * - Passing a string path makes js-vector-store build a `FileStorageAdapter`
 *   internally, persisting under that directory with the type's suffix.
 * - The caller owns the lifecycle and MUST call `flushStore(store)` after
 *   writes: `set()` only accumulates in pending; without `flush()` changes do
 *   not reach disk and are lost when the n8n process restarts.
 *
 * Default `indexType = 'float32'` preserves the pre-1.1 behavior exactly.
 *
 * Note: `polar3` requires an even `dim`; the library throws otherwise.
 */
export function openStore(
	storeDirectory: string,
	dimension: number,
	indexType: IndexType = 'float32',
): VectorStoreLike {
	assertAbsoluteStoreDirectory(storeDirectory);
	assertPositiveIntegerDimension(dimension);
	assertValidIndexType(indexType);
	switch (indexType) {
		case 'float32':
			return new VectorStore(storeDirectory, dimension);
		case 'int8':
			return new QuantizedStore(storeDirectory, dimension);
		case 'binary':
			return new BinaryQuantizedStore(storeDirectory, dimension);
		case 'polar3':
			return new PolarQuantizedStore(storeDirectory, dimension);
		default:
			throw new Error(`Unknown indexType: ${indexType as string}`);
	}
}

/**
 * Flush a store's pending writes to disk.
 *
 * Wraps `store.flush()` so the node has a single, explicit persistence point
 * and a clear error path — never swallows the flush error silently. Safe to
 * call on a store with no pending writes. Accepts any `VectorStoreLike`.
 */
export function flushStore(store: VectorStoreLike): void {
	store.flush();
}