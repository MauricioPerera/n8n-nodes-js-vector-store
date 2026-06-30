import { assertVector } from '../validate';

/**
 * Frozen property-tests for `assertVector`. Independent oracle: the expected
 * outcomes are hand-derived from the contract, not from the implementation.
 */
describe('assertVector', () => {
	it('returns the array typed as number[] when shape is valid', () => {
		const v = [1, 2.5, -3, 0];
		expect(assertVector(v, 4)).toBe(v);
		expect(assertVector([0], 1)).toEqual([0]);
	});

	it('throws on a non-array value', () => {
		expect(() => assertVector('1,2,3', 3)).toThrow(/array of numbers/i);
		expect(() => assertVector(null, 3)).toThrow(/array of numbers/i);
		expect(() => assertVector({}, 3)).toThrow(/array of numbers/i);
	});

	it('throws a dimension-mismatch error naming expected and received dim', () => {
		expect(() => assertVector([1, 2, 3], 8)).toThrow(/expected 8, got 3/i);
		expect(() => assertVector([], 3)).toThrow(/expected 3, got 0/i);
		expect(() => assertVector([1, 2, 3, 4], 3)).toThrow(/expected 3, got 4/i);
	});

	it('throws on non-finite elements (NaN, Infinity, -Infinity)', () => {
		expect(() => assertVector([1, NaN, 3], 3)).toThrow(/index 1/i);
		expect(() => assertVector([Infinity, 0, 0], 3)).toThrow(/index 0/i);
		expect(() => assertVector([-Infinity, 0], 2)).toThrow(/index 0/i);
	});

	it('throws on non-number elements', () => {
		expect(() => assertVector([1, '2', 3], 3)).toThrow(/index 1/i);
		expect(() => assertVector([true, 0], 2)).toThrow(/index 0/i);
		expect(() => assertVector([null, 0], 2)).toThrow(/index 0/i);
	});

	it('does not mutate the input', () => {
		const v = [1, 2, 3];
		assertVector(v, 3);
		expect(v).toEqual([1, 2, 3]);
	});
});