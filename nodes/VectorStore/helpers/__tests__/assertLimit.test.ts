import { assertLimit } from '../validate';

/**
 * Frozen property-tests for `assertLimit`. Default is 5 (the library default);
 * finite numbers are truncated to an integer; integers < 1 and non-numbers
 * throw (the library heap crashes on limit = 0).
 */
describe('assertLimit', () => {
	it('defaults to 5 on undefined/null', () => {
		expect(assertLimit(undefined)).toBe(5);
		expect(assertLimit(null)).toBe(5);
	});

	it('returns a positive integer unchanged', () => {
		expect(assertLimit(1)).toBe(1);
		expect(assertLimit(5)).toBe(5);
		expect(assertLimit(100)).toBe(100);
	});

	it('truncates a finite float toward zero', () => {
		expect(assertLimit(3.9)).toBe(3);
		expect(assertLimit(1.5)).toBe(1);
		expect(assertLimit(10.999)).toBe(10);
	});

	it('throws on integers < 1', () => {
		expect(() => assertLimit(0)).toThrow(/>= 1/i);
		expect(() => assertLimit(-1)).toThrow(/>= 1/i);
		expect(() => assertLimit(0.9)).toThrow(/>= 1/i);
	});

	it('throws on non-numbers', () => {
		expect(() => assertLimit('5')).toThrow(/finite number/i);
		expect(() => assertLimit(true)).toThrow(/finite number/i);
		expect(() => assertLimit([5])).toThrow(/finite number/i);
	});

	it('throws on non-finite numbers', () => {
		expect(() => assertLimit(Infinity)).toThrow(/finite number/i);
		expect(() => assertLimit(NaN)).toThrow(/finite number/i);
	});
});