import { toSearchItems } from '../shape';
import type { SearchHit } from 'js-vector-store';

/**
 * Property tests for `toSearchItems` — the only pure transformation in the
 * actions layer. Independent of the store; exercises shape + pairedItem only.
 */
describe('toSearchItems', () => {
	it('returns no items for an empty hit list (empty/non-existent collection)', () => {
		expect(toSearchItems([], 0)).toEqual([]);
	});

	it('returns one item per hit, preserving id, score and metadata', () => {
		const hits: SearchHit[] = [
			{ id: 'a', score: 1, metadata: { tag: 'x' } },
			{ id: 'b', score: 0.5, metadata: {} },
		];
		const out = toSearchItems(hits, 3);
		expect(out).toHaveLength(2);
		expect(out[0].json).toEqual({ id: 'a', score: 1, metadata: { tag: 'x' } });
		expect(out[0].pairedItem).toEqual({ item: 3 });
		expect(out[1].json).toEqual({ id: 'b', score: 0.5, metadata: {} });
		expect(out[1].pairedItem).toEqual({ item: 3 });
	});

	it('defaults missing metadata to an empty object', () => {
		const hits: SearchHit[] = [{ id: 'a', score: 0.9 }];
		const out = toSearchItems(hits, 7);
		expect(out[0].json.metadata).toEqual({});
	});

	it('propagates the input item index to every emitted item', () => {
		const hits: SearchHit[] = [
			{ id: 'a', score: 1 },
			{ id: 'b', score: 0.8 },
			{ id: 'c', score: 0.6 },
		];
		const out = toSearchItems(hits, 11);
		expect(out.every((item) => (item.pairedItem as { item: number }).item === 11)).toBe(true);
	});

	it('does not mutate the input hits', () => {
		const hits: SearchHit[] = [{ id: 'a', score: 1, metadata: { k: 'v' } }];
		const snapshot = JSON.stringify(hits);
		toSearchItems(hits, 0);
		expect(JSON.stringify(hits)).toBe(snapshot);
	});
});