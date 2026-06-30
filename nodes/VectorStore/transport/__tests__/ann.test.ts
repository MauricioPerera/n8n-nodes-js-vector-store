import {
	assertIntAtLeast,
	defaultStages,
	hasIvfIndex,
	ivfIndexFile,
	parseCollections,
	parseStages,
} from '../ann';

/**
 * Property tests for the pure ANN/Matryoshka/SearchAcross helpers.
 *
 * The oracle is INDEPENDENT of the target: defaults and clamping are
 * re-derived inline in the tests (not by calling the functions), so a bug in
 * `ann.ts` is caught rather than mirrored. No I/O, no library imports.
 */
describe('ann helpers — ivfIndexFile / hasIvfIndex', () => {
	it('ivfIndexFile composes <collection>.ivf.json (exact, no path confusion)', () => {
		expect(ivfIndexFile('docs')).toBe('docs.ivf.json');
		expect(ivfIndexFile('docs2')).toBe('docs2.ivf.json');
		expect(ivfIndexFile('a.b')).toBe('a.b.ivf.json');
	});

	it('hasIvfIndex matches the exact filename and distinguishes prefixes', () => {
		const files = ['docs.ivf.json', 'docs.bin', 'docs2.ivf.json', 'docs.bm25.json'];
		expect(hasIvfIndex('docs', files)).toBe(true);
		expect(hasIvfIndex('docs2', files)).toBe(true);
		// 'docs3' has no ivf file; 'docs' must not match 'docs2.ivf.json'.
		expect(hasIvfIndex('docs3', files)).toBe(false);
		expect(hasIvfIndex('do', files)).toBe(false);
		expect(hasIvfIndex('docs', [])).toBe(false);
	});
});

describe('ann helpers — defaultStages', () => {
	it('produces increasing proportional fractions of dim, de-duplicated', () => {
		expect(defaultStages(16)).toEqual([4, 8, 16]);
		expect(defaultStages(8)).toEqual([2, 4, 8]);
		expect(defaultStages(768)).toEqual([192, 384, 768]);
		expect(defaultStages(100)).toEqual([25, 50, 100]);
	});

	it('drops fractions below 1 and de-duplicates small dims', () => {
		// dim 3 -> floor(0)=0 (dropped), floor(1)=1, 3 -> [1, 3]
		expect(defaultStages(3)).toEqual([1, 3]);
		expect(defaultStages(2)).toEqual([1, 2]);
		expect(defaultStages(1)).toEqual([1]);
	});

	it('is monotonically non-decreasing and every stage is in [1, dim]', () => {
		const dims = [1, 2, 3, 7, 8, 16, 64, 100, 384, 768, 1536];
		for (const d of dims) {
			const s = defaultStages(d);
			expect(s.length).toBeGreaterThan(0);
			for (const stage of s) {
				expect(stage).toBeGreaterThanOrEqual(1);
				expect(stage).toBeLessThanOrEqual(d);
			}
			for (let i = 1; i < s.length; i++) {
				expect(s[i]).toBeGreaterThan(s[i - 1]);
			}
		}
	});
});

describe('ann helpers — parseStages', () => {
	it('falls back to defaultStages(dim) for empty / missing / invalid input', () => {
		expect(parseStages(undefined, 16)).toEqual(defaultStages(16));
		expect(parseStages(null, 16)).toEqual(defaultStages(16));
		expect(parseStages('', 16)).toEqual(defaultStages(16));
		expect(parseStages('[]', 16)).toEqual(defaultStages(16));
		expect(parseStages([], 16)).toEqual(defaultStages(16));
		expect(parseStages('not-json', 16)).toEqual(defaultStages(16));
		expect(parseStages('"hello"', 16)).toEqual(defaultStages(16));
		expect(parseStages(5, 16)).toEqual(defaultStages(16)); // non-array scalar
	});

	it('parses a JSON string of ints and clamps each with Math.min(stage, dim)', () => {
		// dim 16: every stage clamped to <= 16, truncated, >= 1 kept.
		expect(parseStages('[4, 8, 16]', 16)).toEqual([4, 8, 16]);
		expect(parseStages('[2, 4, 8, 16, 32]', 16)).toEqual([2, 4, 8, 16, 16]);
		expect(parseStages('[100, 200]', 16)).toEqual([16, 16]);
	});

	it('parses a raw array of numbers, truncating fractional stages', () => {
		expect(parseStages([4.9, 8.1, 16], 16)).toEqual([4, 8, 16]);
		expect(parseStages([2, 4, 8], 8)).toEqual([2, 4, 8]);
	});

	it('drops non-finite and sub-1 elements, falling back to default when all drop', () => {
		expect(parseStages('[0, -3, NaN, Infinity]', 16)).toEqual(defaultStages(16));
		// Mix of valid and invalid: only valid survive.
		expect(parseStages('[0, 4, -2, 8]', 16)).toEqual([4, 8]);
	});

	it('clamps with Math.min(stage, dim) so out-of-range stages never exceed dim', () => {
		const stages = parseStages('[128, 384, 768]', 16);
		expect(Math.max(...stages)).toBeLessThanOrEqual(16);
		expect(stages).toEqual([16, 16, 16]);
	});

	it('returns a fresh array each call (no shared state)', () => {
		const a = parseStages('[4, 8]', 16);
		const b = parseStages('[4, 8]', 16);
		expect(a).not.toBe(b);
		expect(a).toEqual(b);
		a.push(99);
		expect(b).toEqual([4, 8]); // mutating a does not affect b
	});
});

describe('ann helpers — parseCollections', () => {
	it('splits a comma string, trims, drops blanks and de-duplicates', () => {
		expect(parseCollections('a,b,c')).toEqual(['a', 'b', 'c']);
		expect(parseCollections(' a , b , , c ')).toEqual(['a', 'b', 'c']);
		expect(parseCollections('a,a,b,a')).toEqual(['a', 'b']);
		expect(parseCollections(' ,, ')).toEqual([]);
		expect(parseCollections('')).toEqual([]);
	});

	it('accepts an array (multiOptions) preserving first-seen order', () => {
		expect(parseCollections(['x', 'y', 'x'])).toEqual(['x', 'y']);
		expect(parseCollections(['  x  ', 'y', ''])).toEqual(['x', 'y']);
	});

	it('drops non-string elements and returns [] for non-array/string input', () => {
		expect(parseCollections(['a', 5, true, 'b'])).toEqual(['a', 'b']);
		expect(parseCollections(undefined)).toEqual([]);
		expect(parseCollections(null)).toEqual([]);
		expect(parseCollections(42)).toEqual([]);
		expect(parseCollections({ a: 1 })).toEqual([]);
	});

	it('returns a fresh array each call (no shared state)', () => {
		const a = parseCollections('a,b');
		const b = parseCollections('a,b');
		expect(a).not.toBe(b);
		a.push('z');
		expect(b).toEqual(['a', 'b']);
	});
});

describe('ann helpers — assertIntAtLeast', () => {
	it('returns the truncated integer for valid finite values >= min', () => {
		expect(assertIntAtLeast(5, 'numClusters', 1)).toBe(5);
		expect(assertIntAtLeast(100.9, 'numClusters', 1)).toBe(100);
		expect(assertIntAtLeast(0, 'sampleDims', 0)).toBe(0);
		expect(assertIntAtLeast(10, 'numProbes', 1)).toBe(10);
	});

	it('throws a clear error naming the field when below min', () => {
		expect(() => assertIntAtLeast(0, 'numClusters', 1)).toThrow(/numClusters must be >= 1/i);
		expect(() => assertIntAtLeast(-5, 'numProbes', 1)).toThrow(/numProbes must be >= 1/i);
		expect(() => assertIntAtLeast(-1, 'sampleDims', 0)).toThrow(/sampleDims must be >= 0/i);
	});

	it('throws for non-numbers and non-finite values', () => {
		expect(() => assertIntAtLeast('5', 'numClusters', 1)).toThrow(/numClusters must be a finite integer/i);
		expect(() => assertIntAtLeast(NaN, 'numClusters', 1)).toThrow(/numClusters must be a finite integer/i);
		expect(() => assertIntAtLeast(Infinity, 'numProbes', 1)).toThrow(/numProbes must be a finite integer/i);
		expect(() => assertIntAtLeast(undefined, 'numClusters', 1)).toThrow(/numClusters must be a finite integer/i);
	});
});