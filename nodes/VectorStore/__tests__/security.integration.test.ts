import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { flushStore, openStore } from '../transport/store';
import { run } from '../actions/router';
import { isWriteOperation } from '../actions/security';
import { VectorStore } from '../VectorStore.node';

/**
 * Security integration test for the Vector Store node's AI-agent exposure.
 *
 * Drives the REAL router (`run`) against `js-vector-store` on a temp dir via a
 * minimal `IExecuteFunctions` stub — no mock of the engine. Verifies:
 *  (a) readOnly=true  -> Search/Get/Count work; Upsert/Delete/Drop throw a
 *      clear NodeOperationError with itemIndex BEFORE touching the store.
 *  (b) readOnly=false (default) -> every operation works.
 *  (c) usableAsTool: true is present in the node description.
 *  (d) isWriteOperation classifies set/remove/drop as write and the rest as read.
 *
 * This is the safeguard against a prompt-injected AI agent mutating or
 * destroying the store it should only query.
 */

/** Minimal node stub for NodeOperationError construction (only `.name` is read). */
const NODE_STUB = { name: 'vectorStore' } as unknown as INode;

/**
 * Build an `IExecuteFunctions` stub that drives `run` for `items.length` items.
 * `params` maps parameter name -> value, shared across all items (node-level
 * toggles and a single operation per call are all these tests need).
 */
function makeExec(
	items: INodeExecutionData[],
	params: Record<string, unknown>,
	creds: { storeDirectory: string; dimension: number },
	continueOnFail = false,
): IExecuteFunctions {
	return {
		getInputData: () => items,
		getCredentials: async () => creds,
		getNodeParameter: (name: string) => params[name],
		continueOnFail: () => continueOnFail,
		getNode: () => NODE_STUB,
	} as unknown as IExecuteFunctions;
}

describe('Vector Store read-only guard (AI agent exposure)', () => {
	let dir: string;
	const dim = 8;
	const seedVector = [1, 0, 0, 0, 0, 0, 0, 0];

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-vs-sec-'));
		// Seed one vector so read operations have something to return.
		const store = openStore(dir, dim);
		store.set('docs', 't', seedVector, { tag: 'target' });
		flushStore(store);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	describe('readOnly = true', () => {
		const readOnly = true;

		it('Search works (read)', async () => {
			const exec = makeExec(
				[{ json: {} }],
				{
					readOnly,
					operation: 'search',
					collection: 'docs',
					queryVector: '[1, 0, 0, 0, 0, 0, 0, 0]',
					limit: 5,
					metric: 'cosine',
					filter: '',
					dimSlice: 0,
				},
				{ storeDirectory: dir, dimension: dim },
			);
			const out = await run.call(exec);
			expect(out[0]).toHaveLength(1);
			expect(out[0][0].json.id).toBe('t');
		});

		it('Get works (read)', async () => {
			const exec = makeExec(
				[{ json: {} }],
				{ readOnly, operation: 'get', collection: 'docs', id: 't' },
				{ storeDirectory: dir, dimension: dim },
			);
			const out = await run.call(exec);
			expect(out[0][0].json).toMatchObject({ id: 't', vector: seedVector });
		});

		it('Count works (read)', async () => {
			const exec = makeExec(
				[{ json: {} }],
				{ readOnly, operation: 'count', collection: 'docs' },
				{ storeDirectory: dir, dimension: dim },
			);
			const out = await run.call(exec);
			expect(out[0][0].json).toEqual({ collection: 'docs', count: 1 });
		});

		it('List Collections works (read)', async () => {
			const exec = makeExec(
				[{ json: {} }],
				{ readOnly, operation: 'collections' },
				{ storeDirectory: dir, dimension: dim },
			);
			const out = await run.call(exec);
			// The guard let the read through (no rejection). The library lists
			// only collections touched in the current instance, so we assert
			// the operation ran and returned an array, not its specific contents
			// (contents are covered by operations.integration.test.ts).
			expect(Array.isArray(out[0][0].json.collections)).toBe(true);
		});

		it('Upsert (set) is rejected before running with a clear error + itemIndex', async () => {
			const exec = makeExec(
				[{ json: {} }],
				{
					readOnly,
					operation: 'set',
					collection: 'docs',
					id: 'x',
					vector: '[1, 0, 0, 0, 0, 0, 0, 0]',
					metadata: '',
				},
				{ storeDirectory: dir, dimension: dim },
			);
			await expect(run.call(exec)).rejects.toThrow(/is a write and this node is in read-only mode/i);
			await expect(run.call(exec)).rejects.toMatchObject({
				context: { itemIndex: 0 },
			});
			// The store is untouched: 'x' was never written, 't' still there.
			const store = openStore(dir, dim);
			expect(store.get('docs', 'x')).toBeNull();
			expect(store.count('docs')).toBe(1);
		});

		it('Delete (remove) is rejected before running', async () => {
			const exec = makeExec(
				[{ json: {} }],
				{ readOnly, operation: 'remove', collection: 'docs', id: 't' },
				{ storeDirectory: dir, dimension: dim },
			);
			await expect(run.call(exec)).rejects.toThrow(/is a write and this node is in read-only mode/i);
			await expect(run.call(exec)).rejects.toMatchObject({ context: { itemIndex: 0 } });
			// 't' is still there — the delete never reached the engine.
			expect(openStore(dir, dim).count('docs')).toBe(1);
		});

		it('Drop is rejected before running', async () => {
			const exec = makeExec(
				[{ json: {} }],
				{ readOnly, operation: 'drop', collection: 'docs' },
				{ storeDirectory: dir, dimension: dim },
			);
			await expect(run.call(exec)).rejects.toThrow(/is a write and this node is in read-only mode/i);
			await expect(run.call(exec)).rejects.toMatchObject({ context: { itemIndex: 0 } });
			// The collection + its record still exist (read-by-name loads from
			// disk; the drop never reached the engine).
			const store = openStore(dir, dim);
			expect(store.get('docs', 't')).not.toBeNull();
			expect(store.count('docs')).toBe(1);
		});

		it('with continueOnFail: a write produces an { error } item instead of throwing', async () => {
			const exec = makeExec(
				[{ json: {} }],
				{
					readOnly,
					operation: 'set',
					collection: 'docs',
					id: 'x',
					vector: '[1, 0, 0, 0, 0, 0, 0, 0]',
					metadata: '',
				},
				{ storeDirectory: dir, dimension: dim },
				true, // continueOnFail
			);
			const out = await run.call(exec);
			expect(out[0]).toHaveLength(1);
			expect(out[0][0].json.error).toMatch(/is a write and this node is in read-only mode/i);
			expect(out[0][0].pairedItem).toEqual({ item: 0 });
		});
	});

	describe('readOnly = false (default)', () => {
		const readOnly = false;

		it('Upsert, Search, Delete, Drop all work', async () => {
			// upsert a second vector
			const upsertExec = makeExec(
				[{ json: {} }],
				{
					readOnly,
					operation: 'set',
					collection: 'docs',
					id: 's',
					vector: '[1, 0.1, 0, 0, 0, 0, 0, 0]',
					metadata: '',
				},
				{ storeDirectory: dir, dimension: dim },
			);
			const up = await run.call(upsertExec);
			expect(up[0][0].json).toEqual({ collection: 'docs', id: 's', upserted: true });

			// search returns both, 't' top-1
			const searchExec = makeExec(
				[{ json: {} }],
				{
					readOnly,
					operation: 'search',
					collection: 'docs',
					queryVector: '[1, 0, 0, 0, 0, 0, 0, 0]',
					limit: 5,
					metric: 'cosine',
					filter: '',
					dimSlice: 0,
				},
				{ storeDirectory: dir, dimension: dim },
			);
			const hits = await run.call(searchExec);
			expect(hits[0].map((h) => h.json.id).sort()).toEqual(['s', 't']);

			// delete 't'
			const delExec = makeExec(
				[{ json: {} }],
				{ readOnly, operation: 'remove', collection: 'docs', id: 't' },
				{ storeDirectory: dir, dimension: dim },
			);
			const del = await run.call(delExec);
			expect(del[0][0].json).toEqual({ collection: 'docs', id: 't', deleted: true });

			// drop the collection
			const dropExec = makeExec(
				[{ json: {} }],
				{ readOnly, operation: 'drop', collection: 'docs' },
				{ storeDirectory: dir, dimension: dim },
			);
			await run.call(dropExec);
			expect(openStore(dir, dim).collections()).not.toContain('docs');
		});
	});

	describe('node description', () => {
		// `description` is an instance property, so read it off a constructed node.
		const description = new VectorStore().description;

		it('exposes usableAsTool: true so an AI agent can call it', () => {
			expect(description.usableAsTool).toBe(true);
		});

		it('declares the readOnly toggle with default false', () => {
			const readOnlyProp = description.properties.find((p) => p.name === 'readOnly');
			expect(readOnlyProp).toBeDefined();
			expect(readOnlyProp?.type).toBe('boolean');
			expect(readOnlyProp?.default).toBe(false);
		});
	});

	describe('isWriteOperation classification (guard source of truth)', () => {
		it('set/remove/drop are writes; search/get/count/collections are reads', () => {
			expect(isWriteOperation('set')).toBe(true);
			expect(isWriteOperation('remove')).toBe(true);
			expect(isWriteOperation('drop')).toBe(true);
			expect(isWriteOperation('search')).toBe(false);
			expect(isWriteOperation('get')).toBe(false);
			expect(isWriteOperation('count')).toBe(false);
			expect(isWriteOperation('collections')).toBe(false);
		});
	});

	// Static type assertion: NodeOperationError is the rejection type the
	// router emits (imported above so a refactor away from it breaks the build).
	it('NodeOperationError is importable from n8n-workflow (guard error type)', () => {
		expect(new NodeOperationError(NODE_STUB, 'x') instanceof Error).toBe(true);
	});
});