/**
 * Property tests for the pure hybrid helpers (`transport/hybrid.ts`).
 *
 * Independent oracle: expected file names and option defaults are hard-coded
 * here, NOT derived from the target, so a wrong mapping/default in the target
 * fails the test rather than mirroring it. No I/O — these are pure functions.
 */
import { buildHybridOpts, bm25IndexFile, hasBm25Index } from '../hybrid';

describe('bm25IndexFile', () => {
	it('composes <collection>.bm25.json', () => {
		expect(bm25IndexFile('docs')).toBe('docs.bm25.json');
	});

	it('does not mutate or duplicate the collection name', () => {
		expect(bm25IndexFile('my_col')).toBe('my_col.bm25.json');
	});
});

describe('hasBm25Index', () => {
	it('is true when <collection>.bm25.json is present', () => {
		expect(hasBm25Index('docs', ['docs.bin', 'docs.json', 'docs.bm25.json'])).toBe(true);
	});

	it('is false when the bm25 file is absent', () => {
		expect(hasBm25Index('docs', ['docs.bin', 'docs.json'])).toBe(false);
	});

	it('is false for an empty directory', () => {
		expect(hasBm25Index('docs', [])).toBe(false);
	});

	it('matches the exact filename (no prefix collision between collections)', () => {
		// 'docs' must not be confused with 'docs2'.
		expect(hasBm25Index('docs', ['docs2.bm25.json'])).toBe(false);
	});

	it('ignores unrelated files', () => {
		expect(hasBm25Index('docs', ['readme.txt', 'other.bm25.json'])).toBe(false);
	});
});

describe('buildHybridOpts', () => {
	it('applies engine defaults for empty input', () => {
		expect(buildHybridOpts({})).toEqual({
			vectorWeight: 0.5,
			textWeight: 0.5,
			rrfK: 60,
			metric: 'cosine',
			fetchK: undefined,
		});
	});

	it('passes through provided weights, rrfK and metric', () => {
		expect(
			buildHybridOpts({
				vectorWeight: 0.2,
				textWeight: 0.8,
				rrfK: 100,
				metric: 'dotProduct',
				fetchK: 50,
			}),
		).toEqual({
			vectorWeight: 0.2,
			textWeight: 0.8,
			rrfK: 100,
			metric: 'dotProduct',
			fetchK: 50,
		});
	});

	it('treats fetchK = 0 as "use engine default" (omitted)', () => {
		expect(buildHybridOpts({ fetchK: 0 }).fetchK).toBeUndefined();
	});

	it('treats a negative fetchK as omitted', () => {
		expect(buildHybridOpts({ fetchK: -5 }).fetchK).toBeUndefined();
	});

	it('truncates a fractional fetchK to an integer', () => {
		expect(buildHybridOpts({ fetchK: 50.9 }).fetchK).toBe(50);
	});

	it('falls back to defaults for non-finite weights/rrfK', () => {
		expect(
			buildHybridOpts({ vectorWeight: NaN, textWeight: Infinity, rrfK: 'big' }),
		).toEqual({
			vectorWeight: 0.5,
			textWeight: 0.5,
			rrfK: 60,
			metric: 'cosine',
			fetchK: undefined,
		});
	});

	it('falls back to the default metric for a non-string or empty metric', () => {
		expect(buildHybridOpts({ metric: '' }).metric).toBe('cosine');
		expect(buildHybridOpts({ metric: 8 }).metric).toBe('cosine');
	});

	it('returns a fresh object every call (no shared mutation)', () => {
		const a = buildHybridOpts({ fetchK: 30 });
		const b = buildHybridOpts({});
		expect(a.fetchK).toBe(30);
		expect(b.fetchK).toBeUndefined();
	});
});