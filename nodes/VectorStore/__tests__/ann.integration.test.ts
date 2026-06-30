import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { IExecuteFunctions, INode, INodeExecutionData } from 'n8n-workflow';

import { run } from '../actions/router';
import { openStore } from '../transport/store';

/**
 * Real integration test of the IVF ANN, Matryoshka and Search Across features
 * against `js-vector-store` on a temp directory. Drives the REAL router (`run`)
 * via a minimal `IExecuteFunctions` stub — no mock of the engine, no mock of
 * IVFIndex. Population uses the library directly (fast bulk insert + one
 * flush); the operations under test all go through the router.
 *
 * Vector layout (dim 16, cosine): four tight clusters around the basis axes.
 *   cluster k -> 50 vectors, id `<k>-<i>`, where `<k>-0` is the EXACT basis
 *   vector (unit at dim k) and `<k>-<i>` for i>0 adds ±0.01 noise. The query is
 *   the basis vector of cluster 0, so the brute-force top-1 is `0-0` (cosine 1.0)
 *   and IVF (probing the nearest centroid's cluster) must agree.
 */
describe('Vector Store ANN / Matryoshka / Search Across integration', () => {
	let dir: string;
	const dim = 16;
	const NODE_STUB = { name: 'vectorStore' } as unknown as INode;

	/** Deterministic PRNG so the clustered dataset is stable across runs. */
	function mulberry32(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	/** Build an `IExecuteFunctions` stub that drives `run` for one item. */
	function makeExec(params: Record<string, unknown>, continueOnFail = false): IExecuteFunctions {
		return {
			getInputData: () => [{ json: {} }] as INodeExecutionData[],
			getCredentials: async () => ({ storeDirectory: dir, dimension: dim }),
			getNodeParameter: (name: string) => params[name],
			continueOnFail: () => continueOnFail,
			getNode: () => NODE_STUB,
		} as unknown as IExecuteFunctions;
	}

	/** Populate `collection` with `nClusters` tight clusters of `nPer` vectors. */
	function populateClustered(collection: string, nPer = 50, nClusters = 4): void {
		const store = openStore(dir, dim);
		const rng = mulberry32(1234);
		for (let k = 0; k < nClusters; k++) {
			for (let i = 0; i < nPer; i++) {
				const vec = new Array<number>(dim).fill(0);
				vec[k] = 1; // basis axis = cluster center
				if (i > 0) {
					for (let d = 0; d < dim; d++) {
						vec[d] += (rng() - 0.5) * 0.02; // ±0.01 noise
					}
				}
				store.set(collection, `${k}-${i}`, vec, { cluster: k });
			}
		}
		store.flush();
	}

	/** Upsert a single vector (with metadata) via the library, flushed. */
	function put(collection: string, id: string, vector: number[], metadata: Record<string, unknown> = {}): void {
		const store = openStore(dir, dim);
		store.set(collection, id, vector, metadata);
		store.flush();
	}

	async function buildAnn(
		collection: string,
		numClusters = 4,
		numProbes = 2,
		sampleDims = 0,
	) {
		return run.call(
			makeExec({
				readOnly: false,
				operation: 'buildAnnIndex',
				collection,
				numClusters,
				numProbes,
				sampleDims,
			}),
		);
	}

	async function dropAnn(collection: string) {
		return run.call(makeExec({ readOnly: false, operation: 'dropAnnIndex', collection }));
	}

	async function search(
		collection: string,
		queryVector: number[],
		opts: { useIndex?: boolean; limit?: number; metric?: string; filter?: string } = {},
	) {
		return run.call(
			makeExec({
				readOnly: false,
				operation: 'search',
				collection,
				queryVector: JSON.stringify(queryVector),
				limit: opts.limit ?? 5,
				metric: opts.metric ?? 'cosine',
				filter: opts.filter ?? '',
				dimSlice: 0,
				useIndex: opts.useIndex ?? false,
			}),
		);
	}

	async function matryoshka(
		collection: string,
		queryVector: number[],
		opts: { stages?: string; limit?: number; metric?: string } = {},
	) {
		return run.call(
			makeExec({
				readOnly: false,
				operation: 'matryoshkaSearch',
				collection,
				queryVector: JSON.stringify(queryVector),
				limit: opts.limit ?? 5,
				stages: opts.stages ?? '[]',
				metric: opts.metric ?? 'cosine',
			}),
		);
	}

	async function across(
		collections: string,
		queryVector: number[],
		opts: { limit?: number; metric?: string } = {},
	) {
		return run.call(
			makeExec({
				readOnly: false,
				operation: 'searchAcross',
				collections,
				queryVector: JSON.stringify(queryVector),
				limit: opts.limit ?? 5,
				metric: opts.metric ?? 'cosine',
			}),
		);
	}

	/** The basis vector of cluster 0 — the query used throughout. */
	const query = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-vs-ann-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	// (a) Populate ~200 clustered vectors, build ANN -> {built:true}, <col>.ivf.json on disk.
	it('builds an ANN index and persists <collection>.ivf.json', async () => {
		populateClustered('docs');
		const out = await buildAnn('docs', 4, 2, 0);
		expect(out[0][0].json).toEqual({ collection: 'docs', numClusters: 4, numVectors: 200, built: true });
		expect(fs.existsSync(path.join(dir, 'docs.ivf.json'))).toBe(true);
		expect(fs.existsSync(path.join(dir, 'docs.bin'))).toBe(true);
	});

	// (b) Search with useIndex=true returns results and the top-1 matches brute-force (recall@1).
	it('ANN search top-1 agrees with brute-force on the exact-center query', async () => {
		populateClustered('docs');
		await buildAnn('docs', 4, 2, 0);

		const brute = await search('docs', query, { useIndex: false, limit: 1 });
		const ann = await search('docs', query, { useIndex: true, limit: 1 });

		expect(brute[0].length).toBe(1);
		expect(ann[0].length).toBe(1);
		// Brute top-1 is the exact center 0-0 (cosine 1.0).
		expect(brute[0][0].json.id).toBe('0-0');
		// ANN must agree (recall@1 = 1 with 4 clusters probed).
		expect(ann[0][0].json.id).toBe(brute[0][0].json.id);
		expect(ann[0][0].json.score).toBeCloseTo(1.0, 5);
		expect(ann[0][0].pairedItem).toEqual({ item: 0 });
	});

	// (c) Search with useIndex=true on a collection WITHOUT an index -> clear error.
	it('ANN search on a collection without an index throws a clear error', async () => {
		populateClustered('noidx');
		expect(fs.existsSync(path.join(dir, 'noidx.ivf.json'))).toBe(false);

		await expect(search('noidx', query, { useIndex: true, limit: 5 })).rejects.toThrow(
			/no ANN index for collection "noidx"; run Build ANN Index first/i,
		);
	});

	// (d) Drop ANN Index -> hasIndex false (a later useIndex search errors again).
	it('drops the ANN index so a later useIndex search errors', async () => {
		populateClustered('docs');
		await buildAnn('docs', 4, 2, 0);
		expect(fs.existsSync(path.join(dir, 'docs.ivf.json'))).toBe(true);

		const dropped = await dropAnn('docs');
		expect(dropped[0][0].json).toEqual({ collection: 'docs', dropped: true });
		expect(fs.existsSync(path.join(dir, 'docs.ivf.json'))).toBe(false);

		// Dropping again reports dropped:false (idempotent, no file to remove).
		const droppedAgain = await dropAnn('docs');
		expect(droppedAgain[0][0].json).toEqual({ collection: 'docs', dropped: false });

		// useIndex search now errors — the index is gone.
		await expect(search('docs', query, { useIndex: true, limit: 5 })).rejects.toThrow(
			/no ANN index for collection "docs"; run Build ANN Index first/i,
		);
	});

	// (e) Matryoshka Search with explicit stages -> an identical vector is top-1 (score 1.0).
	it('matryoshka search ranks an identical vector at top-1 with explicit stages', async () => {
		// 'mat' has the exact query as 't' plus orthogonal distractors.
		const distractor = (d: number) => {
			const v = new Array<number>(dim).fill(0);
			v[d] = 1;
			return v;
		};
		put('mat', 't', query.slice(), { label: 'target' });
		put('mat', 'd1', distractor(5), { label: 'd1' });
		put('mat', 'd2', distractor(8), { label: 'd2' });

		const out = await matryoshka('mat', query, { stages: '[4, 8, 16]', limit: 5 });
		expect(out[0][0].json.id).toBe('t');
		expect(out[0][0].json.score).toBeCloseTo(1.0, 5);
		expect(out[0].length).toBe(3);
		expect(out[0].every((h) => h.pairedItem !== undefined)).toBe(true);
	});

	// (f) Search Across over 2 collections fuses and returns hits from BOTH.
	it('search across fuses two collections and returns hits from each', async () => {
		// Each collection has an exact match for the query (distinct ids) + a distractor.
		// metadata.src records the origin since the engine result does NOT label it.
		const distractor = (d: number) => {
			const v = new Array<number>(dim).fill(0);
			v[d] = 1;
			return v;
		};
		put('ca', 'a-hit', query.slice(), { src: 'ca' });
		put('ca', 'a-miss', distractor(7), { src: 'ca' });
		put('cb', 'b-hit', query.slice(), { src: 'cb' });
		put('cb', 'b-miss', distractor(9), { src: 'cb' });

		const out = await across('ca, cb', query, { limit: 5 });
		const ids = out[0].map((h) => h.json.id as string);

		// Both collections' exact matches are present in the fused result.
		expect(ids).toContain('a-hit');
		expect(ids).toContain('b-hit');
		// Each exact match scores 1.0 (per-collection min-max normalization).
		const byId = new Map(out[0].map((h) => [h.json.id as string, h.json.score as number]));
		expect(byId.get('a-hit')).toBeCloseTo(1.0, 5);
		expect(byId.get('b-hit')).toBeCloseTo(1.0, 5);
		expect(out[0].every((h) => h.pairedItem !== undefined)).toBe(true);
	});

	// Guard: Build ANN Index with numClusters < 1 is rejected before the expensive build.
	it('build ANN index rejects numClusters < 1 before building', async () => {
		populateClustered('docs');
		await expect(buildAnn('docs', 0, 2, 0)).rejects.toThrow(/numClusters must be >= 1/i);
		expect(fs.existsSync(path.join(dir, 'docs.ivf.json'))).toBe(false);
	});

	// Guard: Search Across with no collections is rejected.
	it('search across rejects an empty collection list', async () => {
		await expect(across(' , ', query, { limit: 5 })).rejects.toThrow(
			/search across requires at least one collection name/i,
		);
	});

	// Guard: read-only mode rejects Build/Drop ANN Index (they mutate <col>.ivf.json).
	it('read-only mode rejects Build and Drop ANN Index', async () => {
		populateClustered('docs');
		await expect(
			run.call(makeExec({ readOnly: true, operation: 'buildAnnIndex', collection: 'docs', numClusters: 4, numProbes: 2, sampleDims: 0 })),
		).rejects.toThrow(/is a write and this node is in read-only mode/i);
		await expect(
			run.call(makeExec({ readOnly: true, operation: 'dropAnnIndex', collection: 'docs' })),
		).rejects.toThrow(/is a write and this node is in read-only mode/i);
	});
});