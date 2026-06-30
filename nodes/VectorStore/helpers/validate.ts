/**
 * Pure input-validation helpers for the Vector Store node.
 *
 * `js-vector-store` does NOT validate its inputs (spike §8): a vector of the
 * wrong dimension is stored silently and corrupts the collection, an empty
 * vector is accepted, `limit < 1` crashes the internal heap, and a null query
 * throws an opaque `TypeError`. These functions are the mandatory gate before
 * any value reaches the library. They are pure and side-effect free so they
 * can be property-tested and gated independently.
 */

/**
 * Assert that `value` is an array of finite numbers exactly `dim` long, and
 * return it typed as `number[]`.
 *
 * Throws a clear Error describing the mismatch (wrong type, wrong length, or
 * a non-finite element). Length errors report both the expected and received
 * dimension so the user can fix the embedding size mismatch.
 */
export function assertVector(value: unknown, dim: number): number[] {
	if (!Array.isArray(value)) {
		throw new Error(`Vector must be an array of numbers, got ${typeof value}`);
	}
	if (value.length !== dim) {
		throw new Error(
			`Vector dimension mismatch: expected ${dim}, got ${value.length}`,
		);
	}
	for (let i = 0; i < value.length; i++) {
		const el = value[i];
		if (typeof el !== 'number' || !Number.isFinite(el)) {
			throw new Error(
				`Vector element at index ${i} must be a finite number, got ${typeof el === 'number' ? el : typeof el}`,
			);
		}
	}
	return value as number[];
}

/**
 * Parse a vector from user input: either an array of numbers or a JSON string
 * encoding an array of numbers.
 *
 * Does NOT validate dimension — that is the job of `assertVector`. Only
 * validates that the result is an array of finite numbers. Throws on invalid
 * JSON, a JSON value that is not an array, or any non-finite element.
 */
export function parseVectorInput(value: unknown): number[] {
	let arr: unknown;
	if (Array.isArray(value)) {
		arr = value;
	} else if (typeof value === 'string') {
		try {
			arr = JSON.parse(value);
		} catch {
			throw new Error('Vector input string is not valid JSON');
		}
	} else {
		throw new Error(
			'Vector input must be an array of numbers or a JSON string of an array of numbers',
		);
	}
	if (!Array.isArray(arr)) {
		throw new Error('Vector input must parse to an array of numbers');
	}
	for (let i = 0; i < arr.length; i++) {
		const el = arr[i];
		if (typeof el !== 'number' || !Number.isFinite(el)) {
			throw new Error(
				`Vector element at index ${i} must be a finite number, got ${typeof el === 'number' ? el : typeof el}`,
			);
		}
	}
	return arr as number[];
}

/**
 * Assert/coerce a search `limit` into an integer >= 1.
 *
 * - `undefined`/`null` -> default `5` (the library default).
 * - A finite number is truncated to an integer (`Math.trunc`) and must be
 *   `>= 1`. There is no upper clamp — the library caps results at the
 *   collection size, so any positive integer is safe.
 * - Throws on non-numbers, non-finite values, or integers `< 1` (the library
 *   heap crashes on `limit = 0`).
 */
export function assertLimit(value: unknown): number {
	if (value === undefined || value === null) {
		return 5;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`Limit must be a finite number, got ${typeof value}`);
	}
	const n = Math.trunc(value);
	if (n < 1) {
		throw new Error(`Limit must be >= 1, got ${value}`);
	}
	return n;
}

/**
 * Parse metadata from user input: a plain object, or a JSON string encoding
 * one.
 *
 * - `undefined`/`null` -> `{}` (no metadata).
 * - A plain object is returned as-is.
 * - A JSON string is parsed and must yield a plain object.
 * - Throws on invalid JSON, arrays, or non-object primitives — metadata must
 *   be a record, not a list or scalar.
 */
export function parseMetadata(value: unknown): Record<string, unknown> {
	if (value === undefined || value === null) {
		return {};
	}
	let obj: unknown = value;
	if (typeof value === 'string') {
		try {
			obj = JSON.parse(value);
		} catch {
			throw new Error('Metadata string is not valid JSON');
		}
	}
	if (typeof obj !== 'object' || Array.isArray(obj)) {
		throw new Error('Metadata must be a JSON object, not an array or primitive');
	}
	return obj as Record<string, unknown>;
}