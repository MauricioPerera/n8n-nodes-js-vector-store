/**
 * Minimal local type declarations for `js-vector-store`.
 *
 * The package ships no `.d.ts` (it is plain vanilla JS). This ambient module
 * declaration covers only the surface the Vector Store node uses, typed
 * tightly enough to catch misuse at compile time without pretending to model
 * the whole library. Types here reflect the verified API from the spike
 * (`.spike-report.md`), not the (incomplete) README.
 *
 * `set()` accumulates into pending state; `flush()` persists to disk. The
 * library does NOT validate inputs — the node's `helpers/validate.ts` does.
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

	export class VectorStore {
		constructor(dirPath: string, dim: number, maxCollections?: number);

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
	}
}