/**
 * Property tests for the pure `indexType` helpers (`transport/indexType.ts`).
 *
 * Independent oracle: expected suffixes are hard-coded here, NOT derived from
 * the target, so a wrong mapping in the target fails the test rather than
 * mirroring it. No I/O — these are pure functions.
 */
import {
	INDEX_TYPES,
	assertValidIndexType,
	detectCoherenceMismatch,
	expectedIndexFile,
	indexFileSuffix,
	type IndexType,
} from '../indexType';

/** Hard-coded ground truth: each indexType -> its on-disk binary suffix. */
const EXPECTED_SUFFIX: Record<IndexType, string> = {
	float32: '.bin',
	int8: '.q8.bin',
	binary: '.b1.bin',
	polar3: '.p3.bin',
};

describe('indexFileSuffix', () => {
	it.each(INDEX_TYPES as unknown as IndexType[])('returns the on-disk suffix for %s', (t) => {
		expect(indexFileSuffix(t)).toBe(EXPECTED_SUFFIX[t]);
	});

	it('throws on an unknown indexType', () => {
		// Cast bypasses the type to exercise the runtime default branch.
		expect(() => indexFileSuffix('uint16' as IndexType)).toThrow(/unknown indextype/i);
	});
});

describe('expectedIndexFile', () => {
	it.each(INDEX_TYPES as unknown as IndexType[])(
		'composes collection + suffix for %s',
		(t) => {
			expect(expectedIndexFile(t, 'docs')).toBe(`docs${EXPECTED_SUFFIX[t]}`);
		},
	);

	it('does not mutate or duplicate the collection name', () => {
		expect(expectedIndexFile('int8', 'my_col')).toBe('my_col.q8.bin');
	});
});

describe('assertValidIndexType', () => {
	it.each(INDEX_TYPES as unknown as IndexType[])('accepts the valid value %s', (t) => {
		expect(() => assertValidIndexType(t)).not.toThrow();
	});

	it.each([undefined, null, '', 'uint16', 8, 'Float32', 'INT8'])(
		'rejects invalid value %p',
		(v) => {
			expect(() => assertValidIndexType(v)).toThrow(/must be one of/i);
		},
	);
});

describe('detectCoherenceMismatch', () => {
	it('flags no mismatch when the declared type file is present', () => {
		const r = detectCoherenceMismatch('float32', 'docs', ['docs.bin', 'docs.json']);
		expect(r.mismatch).toBe(false);
		expect(r.declaredFile).toBe('docs.bin');
		expect(r.detectedType).toBeNull();
	});

	it('flags a mismatch when another type file exists but the declared does not', () => {
		const r = detectCoherenceMismatch('float32', 'docs', ['docs.q8.bin', 'docs.q8.json']);
		expect(r.mismatch).toBe(true);
		expect(r.detectedType).toBe('int8');
		expect(r.detectedFile).toBe('docs.q8.bin');
		expect(r.declaredFile).toBe('docs.bin');
	});

	it('detects a binary collection opened as int8', () => {
		const r = detectCoherenceMismatch('int8', 'docs', ['docs.b1.bin', 'docs.b1.json']);
		expect(r.mismatch).toBe(true);
		expect(r.detectedType).toBe('binary');
	});

	it('detects a float32 collection opened as polar3', () => {
		const r = detectCoherenceMismatch('polar3', 'docs', ['docs.bin', 'docs.json']);
		expect(r.mismatch).toBe(true);
		expect(r.detectedType).toBe('float32');
		expect(r.declaredFile).toBe('docs.p3.bin');
	});

	it('flags no mismatch for a brand-new collection (no files at all)', () => {
		const r = detectCoherenceMismatch('int8', 'docs', []);
		expect(r.mismatch).toBe(false);
		expect(r.detectedType).toBeNull();
	});

	it('flags no mismatch when the declared file coexists with an orphan of another type', () => {
		// Both docs.bin and docs.q8.bin present: the float32 store will load
		// docs.bin; the .q8.bin is an orphan, NOT the silent-empty case.
		const r = detectCoherenceMismatch('float32', 'docs', ['docs.bin', 'docs.q8.bin']);
		expect(r.mismatch).toBe(false);
	});

	it('only matches the exact filename (no prefix collision between collections)', () => {
		// 'docs' must not be confused with 'docs2' files.
		const r = detectCoherenceMismatch('float32', 'docs', ['docs2.bin', 'docs2.json']);
		expect(r.mismatch).toBe(false);
		expect(r.declaredFile).toBe('docs.bin');
	});

	it('ignores unrelated files in the directory', () => {
		const r = detectCoherenceMismatch('int8', 'docs', ['readme.txt', 'other.q8.json']);
		expect(r.mismatch).toBe(false);
	});
});