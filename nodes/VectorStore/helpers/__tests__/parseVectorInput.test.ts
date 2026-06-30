import { parseVectorInput } from '../validate';

/**
 * Frozen property-tests for `parseVectorInput`. Does NOT exercise dimension
 * validation (that is `assertVector`'s job); only array-of-finite-numbers
 * parsing from a literal array or a JSON string.
 */
describe('parseVectorInput', () => {
	it('returns a literal array of numbers as-is', () => {
		expect(parseVectorInput([1, 2.5, -3])).toEqual([1, 2.5, -3]);
		expect(parseVectorInput([0])).toEqual([0]);
	});

	it('parses a JSON string of an array of numbers', () => {
		expect(parseVectorInput('[1, 2, 3]')).toEqual([1, 2, 3]);
		expect(parseVectorInput('[-1.5, 0, 2.25]')).toEqual([-1.5, 0, 2.25]);
	});

	it('throws on a non-string, non-array value', () => {
		expect(() => parseVectorInput(42)).toThrow(/array of numbers/i);
		expect(() => parseVectorInput(null)).toThrow(/array of numbers/i);
		expect(() => parseVectorInput({})).toThrow(/array of numbers/i);
	});

	it('throws on a string that is not valid JSON', () => {
		expect(() => parseVectorInput('1,2,3')).toThrow(/valid JSON/i);
		expect(() => parseVectorInput('[1, 2,')).toThrow(/valid JSON/i);
	});

	it('throws when JSON parses to a non-array', () => {
		expect(() => parseVectorInput('{"a":1}')).toThrow(/parse to an array/i);
		expect(() => parseVectorInput('42')).toThrow(/parse to an array/i);
		expect(() => parseVectorInput('"abc"')).toThrow(/parse to an array/i);
	});

	it('throws on a non-finite or non-number element (from array or JSON)', () => {
		// literal array: NaN is a non-finite element
		expect(() => parseVectorInput([1, NaN, 3])).toThrow(/index 1/i);
		// JSON string: a string element is a non-number
		expect(() => parseVectorInput('[1, "x", 3]')).toThrow(/index 1/i);
		// JSON cannot represent Infinity, so '[1, 2, Infinity]' is invalid JSON
		// and is rejected by the JSON.parse branch, not the element branch.
		expect(() => parseVectorInput('[1, 2, Infinity]')).toThrow(/valid JSON/i);
	});

	it('accepts an empty array (dimension is validated elsewhere)', () => {
		expect(parseVectorInput([])).toEqual([]);
		expect(parseVectorInput('[]')).toEqual([]);
	});
});