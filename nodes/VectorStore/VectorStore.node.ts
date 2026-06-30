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
					{ name: 'Count', value: 'count', description: 'Count vectors in a collection', action: 'Count vectors' },
					{ name: 'Delete', value: 'remove', description: 'Delete a vector by ID', action: 'Delete a vector' },
					{ name: 'Drop Collection', value: 'drop', description: 'Remove an entire collection', action: 'Drop a collection' },
					{ name: 'Get', value: 'get', description: 'Get a single vector by ID', action: 'Get a vector' },
					{ name: 'List Collections', value: 'collections', description: 'List all collections in the store', action: 'List collections' },
					{ name: 'Search', value: 'search', description: 'Search for the nearest vectors to a query', action: 'Search vectors' },
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
				displayOptions: { show: { operation: ['set', 'search', 'get', 'remove', 'count', 'drop'] } },
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
				displayName: 'Query Vector',
				name: 'queryVector',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { operation: ['search'] } },
				placeholder: '[1, 0, 0, ...]',
				description: 'Array of numbers, or a JSON string of an array of numbers. Must match the credential dimension.',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 50,
				displayOptions: { show: { operation: ['search'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Metric',
				name: 'metric',
				type: 'options',
				default: 'cosine',
				displayOptions: { show: { operation: ['search'] } },
				options: [
					{ name: 'Cosine', value: 'cosine' },
					{ name: 'Dot Product', value: 'dotProduct' },
					{ name: 'Euclidean', value: 'euclidean' },
					{ name: 'Manhattan', value: 'manhattan' },
				],
				description: 'Distance/similarity metric used for ranking',
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