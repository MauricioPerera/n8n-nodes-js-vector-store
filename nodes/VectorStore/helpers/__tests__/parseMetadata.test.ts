import { parseMetadata } from '../validate';

/**
 * Frozen property-tests for `parseMetadata`. undefined/null -> {}; a plain
 * object passes; a JSON string must parse to a plain object; arrays,
 * primitives, and invalid JSON throw.
 */
describe('parseMetadata', () => {
	it('returns {} for undefined/null', () => {
		expect(parseMetadata(undefined)).toEqual({});
		expect(parseMetadata(null)).toEqual({});
	});

	it('returns a plain object as-is', () => {
		const obj = { a: 1, b: 'x', c: true };
		expect(parseMetadata(obj)).toEqual(obj);
		expect(parseMetadata({})).toEqual({});
	});

	it('parses a JSON string into a plain object', () => {
		expect(parseMetadata('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
		expect(parseMetadata('{}')).toEqual({});
	});

	it('throws on invalid JSON string', () => {
		expect(() => parseMetadata('{a:1}')).toThrow(/valid JSON/i);
		expect(() => parseMetadata('{"a":')).toThrow(/valid JSON/i);
	});

	it('throws when the value (or JSON) is an array', () => {
		expect(() => parseMetadata([1, 2])).toThrow(/JSON object/i);
		expect(() => parseMetadata('[1, 2, 3]')).toThrow(/JSON object/i);
	});

	it('throws when the value (or JSON) is a primitive', () => {
		expect(() => parseMetadata(42)).toThrow(/JSON object/i);
		expect(() => parseMetadata('42')).toThrow(/JSON object/i);
		expect(() => parseMetadata('"text"')).toThrow(/JSON object/i);
		expect(() => parseMetadata(true)).toThrow(/JSON object/i);
	});
});