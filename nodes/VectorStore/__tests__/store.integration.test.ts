import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { flushStore, openStore } from '../transport/store';
import { assertVector } from '../helpers/validate';

/**
 * Real integration test against js-vector-store on disk: open a store in a
 * temp directory, insert 3 controlled dim-8 vectors with metadata, flush,
 * then verify search ranking (the identical vector returns top-1 score ~1),
 * count, get, and remove. Cleans up the temp dir in afterEach.
 *
 * Vector layout (dim 8, cosine):
 *   t = [1,0,0,0,0,0,0,0]   (target)
 *   s = [1,0.1,0,0,0,0,0,0] (similar, cosine ~0.994)
 *   o = [0,0,0,0,0,0,0,1]   (orthogonal, cosine 0)
 */
describe('Vector Store integration', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-vs-int-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('round-trips vectors: set + flush + search ranking + count + get + remove', () => {
		const store = openStore(dir, 8);

		const target = [1, 0, 0, 0, 0, 0, 0, 0];
		const similar = [1, 0.1, 0, 0, 0, 0, 0, 0];
		const orthog = [0, 0, 0, 0, 0, 0, 0, 1];

		store.set('docs', 't', target, { idx: 0, tag: 'target' });
		store.set('docs', 's', similar, { idx: 1, tag: 'similar' });
		store.set('docs', 'o', orthog, { idx: 2, tag: 'orthog' });
		flushStore(store);

		// count reflects the 3 flushed inserts
		expect(store.count('docs')).toBe(3);

		// get returns the exact stored vector + metadata
		const got = store.get('docs', 't');
		expect(got).not.toBeNull();
		expect(got?.id).toBe('t');
		expect(got?.vector).toEqual(target);
		expect(got?.metadata).toEqual({ idx: 0, tag: 'target' });

		// search with the target query: identical vector is top-1, score ~1
		const hits = store.search('docs', target, 3);
		expect(hits).toHaveLength(3);
		expect(hits[0].id).toBe('t');
		expect(hits[0].score).toBeCloseTo(1, 5);
		// ranking: similar before orthogonal (higher cosine)
		expect(hits[1].id).toBe('s');
		expect(hits[1].score).toBeGreaterThan(hits[2].score);
		expect(hits[2].id).toBe('o');

		// remove works and persists after flush
		expect(store.remove('docs', 't')).toBe(true);
		flushStore(store);
		expect(store.count('docs')).toBe(2);
		expect(store.get('docs', 't')).toBeNull();
	});

	it('openStore rejects a relative directory', () => {
		expect(() => openStore('relative/dir', 8)).toThrow(/absolute/i);
	});

	it('openStore rejects a non-positive dimension', () => {
		expect(() => openStore(dir, 0)).toThrow(/positive integer/i);
		expect(() => openStore(dir, -4)).toThrow(/positive integer/i);
		expect(() => openStore(dir, 2.5)).toThrow(/positive integer/i);
	});

	it('assertVector throws on a wrong-dimension vector (corruption guard)', () => {
		// A dim-3 vector must be rejected before it reaches the dim-8 store,
		// otherwise js-vector-store stores it silently and corrupts the buffer.
		expect(() => assertVector([1, 2, 3], 8)).toThrow(/expected 8, got 3/i);
	});
});