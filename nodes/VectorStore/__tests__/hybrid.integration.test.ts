import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';

import { run } from '../actions/router';

/**
 * Real integration test of the Hybrid Search (BM25 + vector) feature against
 * `js-vector-store` on a temp directory. Drives the REAL router (`run`) via a
 * minimal `IExecuteFunctions` stub — no mock of the engine, no mock of BM25.
 *
 * Vector layout (dim 8, cosine):
 *   a = [1,0,0,0,0,0,0,0]   text "alpha beta"          (matches the query vector)
 *   b = [0,0,0,0,0,0,0,1]   text "zafiro unico gamma"  (ORTHOGONAL to the query vector, matches the query text "zafiro")
 *   c = [1,0.1,0,0,0,0,0,0] text "gamma delta"         (similar to the query vector)
 *   d = [0,0,0,0,0,0,1,0]   text "epsilon"             (orthogonal, no text match)
 *
 * Query vector = a's vector; query text = "zafiro" (only in b). So b matches
 * ONLY by text (its vector is orthogonal), a/c match ONLY by vector. Hybrid
 * fusion must surface b at the top alongside the vector matches.
 */
describe('Vector Store hybrid search integration', () => {
	let dir: string;
	const dim = 8;

	/** Minimal node stub for NodeOperationError construction (only `.name` is read). */
	const NODE_STUB = { name: 'vectorStore' } as unknown as INode;

	/** Build an `IExecuteFunctions` stub that drives `run` for one item with the given params. */
	function makeExec(
		params: Record<string, unknown>,
		continueOnFail = false,
	): IExecuteFunctions {
		return {
			getInputData: () => [{ json: {} }] as INodeExecutionData[],
			getCredentials: async () => ({ storeDirectory: dir, dimension: dim }),
			getNodeParameter: (name: string) => params[name],
			continueOnFail: () => continueOnFail,
			getNode: () => NODE_STUB,
		} as unknown as IExecuteFunctions;
	}

	/** Upsert a vector (and optional text) via the real router. */
	async function upsert(collection: string, id: string, vector: number[], text = '', metadata = '') {
		return run.call(
			makeExec({
				readOnly: false,
				operation: 'set',
				collection,
				id,
				vector: JSON.stringify(vector),
				metadata,
				text,
			}),
		);
	}

	/** Hybrid search via the real router. */
	async function hybrid(
		collection: string,
		queryVector: number[],
		queryText: string,
		opts: {
			limit?: number;
			mode?: 'rrf' | 'weighted';
			vectorWeight?: number;
			textWeight?: number;
			rrfK?: number;
			fetchK?: number;
			metric?: string;
		} = {},
	) {
		return run.call(
			makeExec({
				readOnly: false,
				operation: 'hybridSearch',
				collection,
				queryVector: JSON.stringify(queryVector),
				queryText,
				limit: opts.limit ?? 5,
				mode: opts.mode ?? 'rrf',
				vectorWeight: opts.vectorWeight ?? 0.5,
				textWeight: opts.textWeight ?? 0.5,
				rrfK: opts.rrfK ?? 60,
				fetchK: opts.fetchK ?? 0,
				metric: opts.metric ?? 'cosine',
			}),
		);
	}

	/** Delete a vector via the real router (also syncs the BM25 index). */
	async function remove(collection: string, id: string) {
		return run.call(makeExec({ readOnly: false, operation: 'remove', collection, id }));
	}

	const docs = [
		{ id: 'a', vec: [1, 0, 0, 0, 0, 0, 0, 0], text: 'alpha beta' },
		{ id: 'b', vec: [0, 0, 0, 0, 0, 0, 0, 1], text: 'zafiro unico gamma' },
		{ id: 'c', vec: [1, 0.1, 0, 0, 0, 0, 0, 0], text: 'gamma delta' },
		{ id: 'd', vec: [0, 0, 0, 0, 0, 0, 1, 0], text: 'epsilon' },
	];
	const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
	const queryText = 'zafiro';

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-vs-hyb-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	// (a) Upsert 4 docs with vector + text -> creates <col>.bm25.json on disk.
	it('upsert with text persists a BM25 index file on disk', async () => {
		for (const d of docs) {
			const out = await upsert('docs', d.id, d.vec, d.text, `{"idx":"${d.id}"}`);
			expect(out[0][0].json).toEqual({ collection: 'docs', id: d.id, upserted: true });
		}
		expect(fs.existsSync(path.join(dir, 'docs.bm25.json'))).toBe(true);
		expect(fs.existsSync(path.join(dir, 'docs.bin'))).toBe(true);
	});

	// (b) RRF: a text-only match (orthogonal vector) rises to the top; vector
	//     and text matches fuse into one result set.
	it('RRF surfaces a text-only match (orthogonal vector) at the top and fuses sides', async () => {
		for (const d of docs) await upsert('docs', d.id, d.vec, d.text);

		const out = await hybrid('docs', queryVec, queryText, { mode: 'rrf', limit: 5 });
		const ids = out[0].map((h) => h.json.id as string);

		// b matches the query text only (its vector is orthogonal) -> RRF lifts it to #1.
		expect(ids[0]).toBe('b');
		// Fusion: both the vector match (a) and the text match (b) appear together.
		expect(ids).toContain('a');
		expect(ids).toContain('b');
		expect(ids).toContain('c');
		// Every result is its own item with pairedItem set to the input item.
		expect(out[0].every((h) => h.pairedItem !== undefined)).toBe(true);
		expect(out[0][0].pairedItem).toEqual({ item: 0 });
	});

	// (c) Weighted with high textWeight: the text match dominates.
	it('weighted mode with high textWeight lets the text match dominate', async () => {
		for (const d of docs) await upsert('docs', d.id, d.vec, d.text);

		const out = await hybrid('docs', queryVec, queryText, {
			mode: 'weighted',
			vectorWeight: 0.2,
			textWeight: 0.8,
			limit: 5,
		});
		const hits = out[0];
		const byId = new Map(hits.map((h) => [h.json.id as string, h.json.score as number]));

		expect(hits[0].json.id).toBe('b');
		// b (text-dominated) outscores a (vector-dominated) with textWeight=0.8.
		expect(byId.get('b') as number).toBeGreaterThan(byId.get('a') as number);
	});

	// (d) Cross-instance: a fresh run reopens the store + lazy-loads the BM25
	//     index from disk; hybrid search still works.
	it('survives a cross-instance reopen (bm25.load)', async () => {
		for (const d of docs) await upsert('docs', d.id, d.vec, d.text);

		// A new run call builds a brand-new store + BM25Index; the router lazy-loads docs.bm25.json.
		const out = await hybrid('docs', queryVec, queryText, { mode: 'rrf', limit: 5 });
		const ids = out[0].map((h) => h.json.id as string);
		expect(ids[0]).toBe('b');
		expect(ids).toContain('a');
	});

	// (e) Delete removes the doc from both the store and the BM25 index; hybrid
	//     no longer returns it.
	it('delete removes the document from the BM25 index (hybrid no longer returns it)', async () => {
		for (const d of docs) await upsert('docs', d.id, d.vec, d.text);

		const before = await hybrid('docs', queryVec, queryText, { mode: 'rrf', limit: 5 });
		expect(before[0].map((h) => h.json.id)).toContain('b');

		const del = await remove('docs', 'b');
		expect(del[0][0].json).toEqual({ collection: 'docs', id: 'b', deleted: true });

		const after = await hybrid('docs', queryVec, queryText, { mode: 'rrf', limit: 5 });
		expect(after[0].map((h) => h.json.id)).not.toContain('b');
	});

	// (f) Hybrid on a collection that was never given a text field -> clear error.
	it('rejects hybrid search on a collection without a BM25 index', async () => {
		// Upsert vectors with NO text -> no <col>.bm25.json is created.
		for (const d of docs) await upsert('vonly', d.id, d.vec, '');

		expect(fs.existsSync(path.join(dir, 'vonly.bm25.json'))).toBe(false);

		await expect(hybrid('vonly', queryVec, queryText)).rejects.toThrow(/no hybrid index for collection "vonly"/i);
		await expect(hybrid('vonly', queryVec, queryText)).rejects.toMatchObject({
			context: { itemIndex: 0 },
		});
	});

	// Guard: upsert without text never creates a BM25 file (pre-hybrid behavior preserved).
	it('upsert without text does not create a BM25 index file', async () => {
		await upsert('plain', 'x', queryVec, '');
		expect(fs.existsSync(path.join(dir, 'plain.bm25.json'))).toBe(false);
		expect(fs.existsSync(path.join(dir, 'plain.bin'))).toBe(true);
	});

	// Guard: hybrid without a query vector (wrong dim) still validates via the shared gate.
	it('hybrid search validates the query vector dimension', async () => {
		for (const d of docs) await upsert('docs', d.id, d.vec, d.text);
		await expect(hybrid('docs', [1, 0, 0], queryText)).rejects.toThrow(/dimension mismatch: expected 8, got 3/i);
	});

	// Guard: hybrid with limit < 1 throws (library heap guard, shared with Search).
	it('hybrid search rejects limit < 1', async () => {
		for (const d of docs) await upsert('docs', d.id, d.vec, d.text);
		await expect(hybrid('docs', queryVec, queryText, { limit: 0 })).rejects.toThrow(/limit must be >= 1/i);
	});

	// Guard: a text-only match dominates weighted even when the vector is orthogonal.
	it('weighted 0.5/0.5 still surfaces the orthogonal text match (fusion)', async () => {
		for (const d of docs) await upsert('docs', d.id, d.vec, d.text);
		const out = await hybrid('docs', queryVec, queryText, {
			mode: 'weighted',
			vectorWeight: 0.5,
			textWeight: 0.5,
			limit: 5,
		});
		const ids = out[0].map((h) => h.json.id as string);
		expect(ids).toContain('b');
		expect(ids).toContain('a');
	});
});