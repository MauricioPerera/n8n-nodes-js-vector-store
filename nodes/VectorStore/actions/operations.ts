import type { INodeExecutionData } from 'n8n-workflow';

import type { VectorStore as JSVectorStore } from 'js-vector-store';
import { assertLimit, assertVector, parseMetadata, parseVectorInput } from '../helpers/validate';
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
	store: JSVectorStore,
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

/** Search: validate query + limit, pass the post-filter through, return one item per hit. */
export function search(
	store: JSVectorStore,
	params: SearchParams,
	itemIndex: number,
): INodeExecutionData[] {
	const query = assertVector(parseVectorInput(params.queryVector), params.dimension);
	const limit = assertLimit(params.limit);
	const filter = emptyToNull(params.filter);
	const filterObj = filter === null ? null : parseMetadata(filter);
	const dimSlice = coerceDimSlice(params.dimSlice);
	const hits = store.search(params.collection, query, limit, dimSlice, params.metric, filterObj);
	return toSearchItems(hits, itemIndex);
}

/** Get: return the stored record, or `{ found: false }` when the id is absent. */
export function get(
	store: JSVectorStore,
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
	store: JSVectorStore,
	collection: string,
	id: string,
	itemIndex: number,
): INodeExecutionData[] {
	const deleted = store.remove(collection, id);
	return [{ json: { collection, id, deleted }, pairedItem: { item: itemIndex } }];
}

/** Count: return the number of vectors in the collection. */
export function count(store: JSVectorStore, collection: string, itemIndex: number): INodeExecutionData[] {
	return [{ json: { collection, count: store.count(collection) }, pairedItem: { item: itemIndex } }];
}

/** Drop Collection: remove the whole collection. */
export function drop(store: JSVectorStore, collection: string, itemIndex: number): INodeExecutionData[] {
	store.drop(collection);
	return [{ json: { collection, dropped: true }, pairedItem: { item: itemIndex } }];
}

/** List Collections: return a single item with the list of collection names. */
export function collections(store: JSVectorStore, itemIndex: number): INodeExecutionData[] {
	return [{ json: { collections: store.collections() }, pairedItem: { item: itemIndex } }];
}