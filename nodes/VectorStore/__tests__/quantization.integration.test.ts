import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { flushStore, openStore } from '../transport/store';
import {
	detectCoherenceMismatch,
	expectedIndexFile,
	type IndexType,
} from '../transport/indexType';

/**
 * Real integration test of quantization (`indexType`) against js-vector-store
 * on disk. For each indexType: open a store in a temp dir, insert controlled
 * dim-8 vectors, flush, then verify (a) the on-disk file uses the type's
 * suffix, (b) count + search round-trip work, and (c) int8 survives a fresh
 * store instance (cross-process persistence). Also verifies the coherence
 * helper catches the silent-empty case end-to-end.
 *
 * dim 8 is even so PolarQuantizedStore (which rejects odd dim) is exercised too.
 *
 * Vector layout (dim 8, cosine):
 *   t = [1,0,0,0,0,0,0,0]   (target, identical to query -> top-1)
 *   s = [1,0.1,0,0,0,0,0,0] (similar)
 *   o = [0,0,0,0,0,0,0,1]   (orthogonal)
 */
describe('Vector Store quantization integration', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-vs-quant-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const target = [1, 0, 0, 0, 0, 0, 0, 0];
	const similar = [1, 0.1, 0, 0, 0, 0, 0, 0];
	const orthog = [0, 0, 0, 0, 0, 0, 0, 1];

	/** Insert the 3 controlled vectors into `docs`, flush, return the store. */
	function seed(indexType: IndexType) {
		const store = openStore(dir, 8, indexType);
		store.set('docs', 't', target, { tag: 'target' });
		store.set('docs', 's', similar, { tag: 'similar' });
		store.set('docs', 'o', orthog, { tag: 'orthog' });
		flushStore(store);
		return store;
	}

	it.each([
		['int8', 'docs.q8.bin'] as const,
		['binary', 'docs.b1.bin'] as const,
		['polar3', 'docs.p3.bin'] as const,
	])(
		'indexType %s round-trips and writes the matching file %s on disk',
		(indexType, expectedFile) => {
			const store = seed(indexType);

			// the binary file with the type's suffix exists on disk
			const files = fs.readdirSync(dir);
			expect(files).toContain(expectedFile);
			expect(files).toContain(expectedIndexFile(indexType, 'docs'));

			// count reflects the 3 flushed inserts
			expect(store.count('docs')).toBe(3);

			// search returns all 3 hits. Quantization is lossy: at dim 8 the
			// exact top-1 ranking is NOT guaranteed (polar3 reorders t/s), so we
			// assert recall (the identical vector is among the hits) rather than
			// strict ordering. Round-trip OK = count + search work end-to-end.
			const hits = store.search('docs', target, 3);
			expect(hits).toHaveLength(3);
			expect(hits.map((h) => h.id).sort()).toEqual(['o', 's', 't']);
		},
	);

	it('indexType float32 round-trips with EXACT ranking and writes docs.bin on disk', () => {
		const store = seed('float32');

		expect(fs.readdirSync(dir)).toContain('docs.bin');
		expect(store.count('docs')).toBe(3);

		// Float32 is exact: identical vector is top-1, score ~1, full ordering.
		const hits = store.search('docs', target, 3);
		expect(hits).toHaveLength(3);
		expect(hits[0].id).toBe('t');
		expect(hits[0].score).toBeCloseTo(1, 5);
		expect(hits[1].id).toBe('s');
		expect(hits[2].id).toBe('o');
	});

	it('int8 persists across a fresh store instance (cross-process reload)', () => {
		seed('int8');

		// A brand-new QuantizedStore on the same dir must auto-reload the data.
		const reloaded = openStore(dir, 8, 'int8');
		expect(reloaded.count('docs')).toBe(3);

		const hits = reloaded.search('docs', target, 3);
		expect(hits).toHaveLength(3);
		expect(hits[0].id).toBe('t');
	});

	it('float32 is the default when indexType is omitted (retrocompatible)', () => {
		const store = openStore(dir, 8);
		store.set('docs', 't', target);
		flushStore(store);

		expect(fs.readdirSync(dir)).toContain('docs.bin');
		expect(store.count('docs')).toBe(1);
	});

	it('openStore rejects an invalid indexType at runtime', () => {
		expect(() => openStore(dir, 8, 'uint16' as IndexType)).toThrow(/must be one of/i);
	});

	it('polar3 rejects an odd dimension (library invariant surfaces)', () => {
		expect(() => openStore(dir, 7, 'polar3')).toThrow(/even/i);
	});

	describe('coherence (silent-empty guard)', () => {
		it('opening an int8 collection as float32 yields count 0 silently — the danger the guard catches', () => {
			seed('int8');
			// The wrong class does NOT find the .q8.bin file -> empty, no error.
			const wrong = openStore(dir, 8, 'float32');
			expect(wrong.count('docs')).toBe(0);
		});

		it('detectCoherenceMismatch flags the int8-as-float32 mismatch from the real dir', () => {
			seed('int8');
			const files = fs.readdirSync(dir);
			const r = detectCoherenceMismatch('float32', 'docs', files);
			expect(r.mismatch).toBe(true);
			expect(r.detectedType).toBe('int8');
			expect(r.detectedFile).toBe('docs.q8.bin');
		});

		it('detectCoherenceMismatch reports no mismatch when the declared type matches the dir', () => {
			seed('int8');
			const files = fs.readdirSync(dir);
			const r = detectCoherenceMismatch('int8', 'docs', files);
			expect(r.mismatch).toBe(false);
		});
	});
});