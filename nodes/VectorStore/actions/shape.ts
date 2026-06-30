import type { INodeExecutionData } from 'n8n-workflow';

import type { SearchHit } from 'js-vector-store';

/**
 * Map raw `js-vector-store` search hits into n8n output items.
 *
 * Pure: no store access, no I/O. One output item per hit (so each result is
 * its own item in the output array, with `pairedItem` pointing at the input
 * item that produced the search). `metadata` defaults to `{}` when the library
 * omits it, so downstream nodes always see a record.
 *
 * `search()` may return `[]` (empty / non-existent collection): this returns
 * `[]`, i.e. no output items for that input — by design, not a crash.
 */
export function toSearchItems(hits: SearchHit[], itemIndex: number): INodeExecutionData[] {
	return hits.map((hit) => ({
		json: {
			id: hit.id,
			score: hit.score,
			metadata: hit.metadata ?? {},
		},
		pairedItem: { item: itemIndex },
	}));
}