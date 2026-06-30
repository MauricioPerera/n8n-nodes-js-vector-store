import { isWriteOperation } from '../security';

/**
 * Frozen property-tests for `isWriteOperation` — the read-only guard's
 * single source of truth for which operation ids mutate the store.
 *
 * Independent oracle: imports nothing else from the target module, so a
 * regression that re-points the write set is caught here, not hidden by
 * shared state.
 */
describe('isWriteOperation', () => {
	it('classifies the three write operations as writes', () => {
		expect(isWriteOperation('set')).toBe(true);
		expect(isWriteOperation('remove')).toBe(true);
		expect(isWriteOperation('drop')).toBe(true);
	});

	it('classifies the ANN index build/drop as writes (they mutate <col>.ivf.json)', () => {
		expect(isWriteOperation('buildAnnIndex')).toBe(true);
		expect(isWriteOperation('dropAnnIndex')).toBe(true);
	});

	it('classifies the four read operations as reads', () => {
		expect(isWriteOperation('search')).toBe(false);
		expect(isWriteOperation('get')).toBe(false);
		expect(isWriteOperation('count')).toBe(false);
		expect(isWriteOperation('collections')).toBe(false);
	});

	it('classifies Matryoshka Search and Search Across as reads', () => {
		expect(isWriteOperation('matryoshkaSearch')).toBe(false);
		expect(isWriteOperation('searchAcross')).toBe(false);
	});

	it('defaults unknown ids to read (the router rejects unknowns separately)', () => {
		expect(isWriteOperation('')).toBe(false);
		expect(isWriteOperation('SET')).toBe(false);
		expect(isWriteOperation('upsert')).toBe(false);
		expect(isWriteOperation('delete')).toBe(false);
		expect(isWriteOperation('bogus')).toBe(false);
	});
});