import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { run } from './actions/router';

/**
 * Programmatic Vector Store node backed by `js-vector-store`.
 *
 * Declarative-style does not fit: each operation is a local filesystem call on
 * a stateful, long-lived `VectorStore` instance (open once, reuse across
 * items, flush after writes), with per-operation input validation the library
 * itself does not perform. That requires a manual `execute` loop, so this is
 * programmatic-style.
 *
 * Single conceptual resource ("collection") with seven operations. Per
 * `.agents/nodes.md`, the resource+operation convention may be skipped when it
 * is not applicable — a single-resource node with one fixed resource value
 * adds noise without aiding the UI, so only an `operation` parameter is
 * exposed.
 */
export class VectorStore implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Vector Store',
		name: 'vectorStore',
		icon: { light: 'file:icon.svg', dark: 'file:icon.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Store, search and manage vectors on the n8n host filesystem via js-vector-store',
		defaults: { name: 'Vector Store' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		// Expose this node as a tool an AI agent can call for semantic
		// retrieval (Search/Get/Count/List Collections) over the vector store.
		// Pair with the `readOnly` toggle below to keep an agent from mutating
		// the store via prompt injection.
		usableAsTool: true,
		credentials: [{ name: 'vectorStoreApi', required: true }],
		properties: [
			{
				displayName: 'Read Only',
				name: 'readOnly',
				type: 'boolean',
				default: false,
				description:
					'Whether to allow only read operations (Search, Get, Count, List Collections) and reject write operations (Upsert, Delete, Drop) before running. Recommended when exposing this node to an AI agent that should only query.',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Build ANN Index', value: 'buildAnnIndex', description: 'Build an IVF approximate-nearest-neighbour index for a collection (expensive one-time K-means; cosine-only at search time)', action: 'Build ANN index' },
					{ name: 'Count', value: 'count', description: 'Count vectors in a collection', action: 'Count vectors' },
					{ name: 'Delete', value: 'remove', description: 'Delete a vector by ID', action: 'Delete a vector' },
					{ name: 'Drop ANN Index', value: 'dropAnnIndex', description: 'Delete the IVF ANN index file for a collection', action: 'Drop ANN index' },
					{ name: 'Drop Collection', value: 'drop', description: 'Remove an entire collection', action: 'Drop a collection' },
					{ name: 'Get', value: 'get', description: 'Get a single vector by ID', action: 'Get a vector' },
					{ name: 'Hybrid Search', value: 'hybridSearch', description: 'Fuse semantic vector search with BM25 lexical search over a text field', action: 'Hybrid search vectors' },
					{ name: 'List Collections', value: 'collections', description: 'List all collections in the store', action: 'List collections' },
					{ name: 'Matryoshka Search', value: 'matryoshkaSearch', description: 'Cascade search over progressively wider dimensional slices (Matryoshka representation)', action: 'Matryoshka search vectors' },
					{ name: 'Search', value: 'search', description: 'Search for the nearest vectors to a query', action: 'Search vectors' },
					{ name: 'Search Across', value: 'searchAcross', description: 'Search and fuse results across multiple collections into one ranked list', action: 'Search across collections' },
					{ name: 'Upsert', value: 'set', description: 'Insert or update a vector by ID', action: 'Upsert a vector' },
				],
				default: 'set',
			},
			{
				displayName: 'Collection',
				name: 'collection',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['set', 'search', 'hybridSearch', 'get', 'remove', 'count', 'drop', 'buildAnnIndex', 'dropAnnIndex', 'matryoshkaSearch'] } },
				description: 'Collection name to operate on',
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['set', 'get', 'remove'] } },
				description: 'Vector ID',
			},
			{
				displayName: 'Vector',
				name: 'vector',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['set'] } },
				placeholder: '[1, 0, 0, ...]',
				description: 'Array of numbers, or a JSON string of an array of numbers. Must match the credential dimension.',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['set'] } },
				placeholder: '{"tag": "x", "price": 10}',
				description: 'Optional JSON object string to store alongside the vector',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['set'] } },
				placeholder: 'The quick brown fox...',
				description:
					'Optional text to index for Hybrid Search (BM25). When non-empty, the document is added to a lexical index persisted as <collection>.bm25.json alongside the vector. Leave empty for vector-only upsert (no BM25 file is created).',
			},
			{
				displayName: 'Query Vector',
				name: 'queryVector',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['search', 'hybridSearch', 'matryoshkaSearch', 'searchAcross'] } },
				placeholder: '[1, 0, 0, ...]',
				description: 'Array of numbers, or a JSON string of an array of numbers. Must match the credential dimension.',
			},
			{
				displayName: 'Query Text',
				name: 'queryText',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['hybridSearch'] } },
				placeholder: 'quick brown fox',
				description: 'The lexical query fused with the vector query via BM25. Leave empty to rank by vector only (degenerates to pure vector search).',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 50,
				displayOptions: { show: { operation: ['search', 'hybridSearch', 'matryoshkaSearch', 'searchAcross'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Metric',
				name: 'metric',
				type: 'options',
				default: 'cosine',
				displayOptions: { show: { operation: ['search', 'hybridSearch', 'matryoshkaSearch', 'searchAcross'] } },
				options: [
					{ name: 'Cosine', value: 'cosine' },
					{ name: 'Dot Product', value: 'dotProduct' },
					{ name: 'Euclidean', value: 'euclidean' },
					{ name: 'Manhattan', value: 'manhattan' },
				],
				description: 'Distance/similarity metric used for ranking (ignored by Search when Use ANN Index is on — IVF is cosine-only)',
			},
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				default: 'rrf',
				displayOptions: { show: { operation: ['hybridSearch'] } },
				options: [
					{ name: 'RRF', value: 'rrf', description: 'Reciprocal Rank Fusion: blend by rank position (weight-agnostic).' },
					{ name: 'Weighted', value: 'weighted', description: 'Linear blend of normalized scores using Vector Weight / Text Weight.' },
				],
				description: 'Fusion strategy combining the vector and BM25 rankings',
			},
			{
				displayName: 'Vector Weight',
				name: 'vectorWeight',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 1 },
				default: 0.5,
				displayOptions: { show: { operation: ['hybridSearch'], mode: ['weighted'] } },
				description: 'Weight of the vector (semantic) score in weighted mode. The engine does not normalize, so the pair controls the blend ratio.',
			},
			{
				displayName: 'Text Weight',
				name: 'textWeight',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 1 },
				default: 0.5,
				displayOptions: { show: { operation: ['hybridSearch'], mode: ['weighted'] } },
				description: 'Weight of the BM25 (lexical) score in weighted mode. Raise this to let keyword matches dominate.',
			},
			{
				displayName: 'RRF K',
				name: 'rrfK',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 60,
				displayOptions: { show: { operation: ['hybridSearch'] } },
				description: 'RRF smoothing constant (used in rrf mode). Higher values flatten the rank contribution.',
			},
			{
				displayName: 'Fetch K',
				name: 'fetchK',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				displayOptions: { show: { operation: ['hybridSearch'] } },
				description: 'Candidate pool size pulled from the vector side before fusion. 0 = use the engine default (max(limit*3, 50)). Raise to let more vector candidates compete with text matches.',
			},
			{
				displayName: 'Filter',
				name: 'filter',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['search'] } },
				placeholder: '{"cat": "x"}',
				description:
					'Optional Mongo-style post-filter as a JSON object string. Applied AFTER scoring, so matched hits may have a score of 0. Use a larger Limit if selective.',
			},
			{
				displayName: 'Dimension Slice',
				name: 'dimSlice',
				type: 'number',
				default: 0,
				displayOptions: { show: { operation: ['search'] } },
				description: 'Use only the first N dimensions for ranking (0 = use all dimensions)',
			},
			{
				displayName: 'Use ANN Index',
				name: 'useIndex',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['search'] } },
				description:
					'When on, search runs against the IVF approximate-nearest-neighbour index instead of brute force. COSINE-ONLY: Metric, Filter and Dimension Slice are ignored. Requires a built index for the collection — run Build ANN Index first or the node errors. The index is a snapshot; rebuild it after bulk inserts/removes.',
			},
			{
				displayName: 'Num Clusters',
				name: 'numClusters',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 100,
				displayOptions: { show: { operation: ['buildAnnIndex'] } },
				description: 'Number of IVF clusters (K-means K). Lower values probe fewer, larger clusters.',
			},
			{
				displayName: 'Num Probes',
				name: 'numProbes',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 10,
				displayOptions: { show: { operation: ['buildAnnIndex'] } },
				description: 'Clusters probed per search. Higher improves recall at the cost of speed.',
			},
			{
				displayName: 'Sample Dims',
				name: 'sampleDims',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				displayOptions: { show: { operation: ['buildAnnIndex'] } },
				description: 'Dimensions used for centroid distance during K-means (0 = use the credential dimension).',
			},
			{
				displayName: 'Stages',
				name: 'stages',
				type: 'string',
				default: '[]',
				displayOptions: { show: { operation: ['matryoshkaSearch'] } },
				placeholder: '[128, 384, 768]',
				description:
					'JSON array of increasing dimensional slices to cascade through. Empty ([]) uses dim-proportional defaults ([floor(dim/4), floor(dim/2), dim]). Each stage is clamped with Math.min(stage, dim); the engine default [128, 384, 768] assumes dim 768 — pass stages matching your dimension.',
			},
			{
				displayName: 'Collections',
				name: 'collections',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['searchAcross'] } },
				placeholder: 'docs, news, archive',
				description:
					'Comma-separated list of collections to search and fuse into one ranked list. The result does NOT label the originating collection — store it in each document\'s metadata beforehand if you need the origin per hit.',
			},
		],
	};

	// `continueOnFail()` is handled per-item inside `actions/router.ts` (the
	// engine this method delegates to via `run.call(this)`). The rule's static
	// check only inspects this method's body and cannot see across the call, so
	// it is disabled here deliberately — the behavior IS implemented.
	// eslint-disable-next-line @n8n/community-nodes/require-continue-on-fail
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return run.call(this);
	}
}