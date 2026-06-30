import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { flushStore, openStore } from '../transport/store';
import type { VectorStoreLike } from 'js-vector-store';
import * as ops from '../actions/operations';
import type { SearchParams, UpsertParams } from '../actions/operations';

/**
 * Real integration test of the operation layer against `js-vector-store` on a
 * temp directory. No mocks of the engine: every path exercises the actual
 * library on disk.
 *
 * Vector layout (dim 8, cosine):
 *   t = [1,0,0,0,0,0,0,0]   (target, identical to query -> top-1 score ~1)
 *   s = [1,0.1,0,0,0,0,0,0] (similar, cosine ~0.994)
 *   o = [0,0,0,0,0,0,0,1]   (orthogonal, cosine 0)
 */
describe('Vector Store operations integration', () => {
	let dir: string;
	let store: VectorStoreLike;
	const dim = 8;

	/** Upsert helper: builds UpsertParams from raw inputs. */
	function upsert(collection: string, id: string, vector: unknown, metadata: unknown, itemIndex = 0) {
		const params: UpsertParams = { collection, id, vector, metadata, dimension: dim };
		return ops.upsert(store, params, itemIndex);
	}

	/** Search helper: builds SearchParams from raw inputs. */
	function search(
		collection: string,
		queryVector: unknown,
		limit: unknown,
		metric: string,
		filter: unknown,
		dimSlice: unknown = 0,
		itemIndex = 0,
	) {
		const params: SearchParams = {
			collection,
			queryVector,
			limit,
			metric,
			filter,
			dimSlice,
			useIndex: false,
			dimension: dim,
		};
		return ops.search(store, params, itemIndex);
	}

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-vs-ops-'));
		store = openStore(dir, dim);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('round-trips: upsert -> search ranking -> get -> count -> delete -> count -> drop -> collections', () => {
		const target = [1, 0, 0, 0, 0, 0, 0, 0];
		const similar = [1, 0.1, 0, 0, 0, 0, 0, 0];
		const orthog = [0, 0, 0, 0, 0, 0, 0, 1];

		// upsert 3 vectors (flush is the router's job; we mimic it here)
		upsert('docs', 't', target, { idx: 0, tag: 'target' });
		upsert('docs', 's', similar, { idx: 1, tag: 'similar' });
		upsert('docs', 'o', orthog, { idx: 2, tag: 'orthog' });
		flushStore(store);

		// count reflects the 3 flushed inserts
		const counted = ops.count(store, 'docs', 0);
		expect(counted).toHaveLength(1);
		expect(counted[0].json).toEqual({ collection: 'docs', count: 3 });
		expect(counted[0].pairedItem).toEqual({ item: 0 });

		// search: identical vector is top-1 score ~1, similar before orthogonal
		const hits = search('docs', target, 3, 'cosine', null);
		expect(hits).toHaveLength(3);
		expect(hits[0].json.id).toBe('t');
		expect(hits[0].json.score).toBeCloseTo(1, 5);
		expect(hits[0].pairedItem).toEqual({ item: 0 });
		expect(hits[1].json.id).toBe('s');
		expect(hits[2].json.id).toBe('o');
		expect(hits[1].json.score as number).toBeGreaterThan(hits[2].json.score as number);

		// get returns the exact stored vector + metadata
		const got = ops.get(store, 'docs', 't', 0);
		expect(got).toHaveLength(1);
		expect(got[0].json).toEqual({
			id: 't',
			vector: target,
			metadata: { idx: 0, tag: 'target' },
		});

		// get on a missing id returns { found: false }
		const missing = ops.get(store, 'docs', 'nope', 0);
		expect(missing[0].json).toEqual({ collection: 'docs', id: 'nope', found: false });

		// delete -> count 2, get null
		const removed = ops.remove(store, 'docs', 't', 0);
		expect(removed[0].json).toEqual({ collection: 'docs', id: 't', deleted: true });
		flushStore(store);
		expect(ops.count(store, 'docs', 0)[0].json.count).toBe(2);
		expect(ops.get(store, 'docs', 't', 0)[0].json).toMatchObject({ found: false });

		// drop -> collections no longer lists it
		const dropped = ops.drop(store, 'docs', 0);
		expect(dropped[0].json).toEqual({ collection: 'docs', dropped: true });
		flushStore(store);
		const listed = ops.collections(store, 0);
		expect(listed).toHaveLength(1);
		expect(Array.isArray(listed[0].json.collections)).toBe(true);
		expect(listed[0].json.collections).not.toContain('docs');
	});

	it('search applies a Mongo-style post-filter (matched hits may have score 0)', () => {
		const v = (n: number) => [n, 0, 0, 0, 0, 0, 0, 0];
		upsert('f', 'a', v(1), { cat: 'x', price: 10 });
		upsert('f', 'b', v(1), { cat: 'x', price: 80 });
		upsert('f', 'c', v(0), { cat: 'y', price: 5 });
		flushStore(store);

		// filter { cat: 'x' } -> only a and b (c is excluded regardless of score)
		const onlyX = search('f', v(1), 5, 'cosine', { cat: 'x' });
		expect(onlyX.map((h) => h.json.id).sort()).toEqual(['a', 'b']);

		// post-filter with price > 50 returns b (cat x, price 80) even though
		// its vector is identical to a; selective filter -> raise limit.
		const pricey = search('f', v(1), 5, 'cosine', { price: { $gt: 50 } });
		expect(pricey.map((h) => h.json.id)).toEqual(['b']);
	});

	it('search supports the euclidean metric', () => {
		const target = [1, 0, 0, 0, 0, 0, 0, 0];
		upsert('e', 't', target, {});
		upsert('e', 'o', [0, 0, 0, 0, 0, 0, 0, 1], {});
		flushStore(store);

		const hits = search('e', target, 2, 'euclidean', null);
		expect(hits[0].json.id).toBe('t');
		// euclidean score = 1 / (1 + dist); identical -> 1
		expect(hits[0].json.score).toBeCloseTo(1, 5);
		expect(hits[1].json.id).toBe('o');
	});

	it('upsert with a wrong-dimension vector throws (corruption guard)', () => {
		expect(() => upsert('docs', 'bad', '[1, 2, 3]', undefined)).toThrow(
			/dimension mismatch: expected 8, got 3/i,
		);
	});

	it('search with limit < 1 throws (library heap guard)', () => {
		expect(() => search('docs', '[1,0,0,0,0,0,0,0]', 0, 'cosine', null)).toThrow(
			/limit must be >= 1/i,
		);
	});

	it('search on a non-existent collection returns no items (does not crash)', () => {
		const hits = search('ghost', '[1,0,0,0,0,0,0,0]', 5, 'cosine', null);
		expect(hits).toEqual([]);
	});

	it('upsert accepts JSON-string vectors and metadata, and empty metadata is tolerated', () => {
		const out = upsert('j', 'k', '[1, 0, 0, 0, 0, 0, 0, 0]', '{"tag": "x"}');
		expect(out[0].json).toEqual({ collection: 'j', id: 'k', upserted: true });
		flushStore(store);
		const got = ops.get(store, 'j', 'k', 0);
		expect(got[0].json.metadata).toEqual({ tag: 'x' });

		// empty metadata string -> {} (no error)
		const out2 = upsert('j', 'k2', '[1, 0, 0, 0, 0, 0, 0, 0]', '');
		expect(out2[0].json.upserted).toBe(true);
		flushStore(store);
		expect(ops.get(store, 'j', 'k2', 0)[0].json.metadata).toEqual({});
	});
});