import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { flushStore, openStore } from '../transport/store';
import * as ops from './operations';
import { isWriteOperation } from './security';

/**
 * Execute engine for the Vector Store node.
 *
 * - Reads the `vectorStoreApi` credential ONCE (`storeDirectory` + `dimension`)
 *   and opens a single `js-vector-store` instance reused across all items.
 * - Reads the `readOnly` node toggle ONCE: when on, write operations
 *   (set/remove/drop) are rejected with a `NodeOperationError` BEFORE reaching
 *   the engine — a guard against prompt-injected AI agents mutating the store.
 * - Loops input items, reads `operation` (+ per-op params) at the correct item
 *   index, dispatches to the matching operation handler, and accumulates output
 *   items with `pairedItem` set.
 * - Flushes after every write operation (set/remove/drop).
 * - Per-item error handling honoring `continueOnFail()`: on continue, pushes an
 *   `{ error }` item paired to the failing input; otherwise throws a
 *   `NodeOperationError` with `itemIndex` so n8n points the user at the item.
 *
 * `this` is bound to the `IExecuteFunctions` by the node's `execute` method.
 */
export async function run(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];

	const credentials = (await this.getCredentials('vectorStoreApi')) as unknown as {
		storeDirectory: string;
		dimension: number;
	};
	const storeDirectory = credentials.storeDirectory;
	const dimension = credentials.dimension;
	const store = openStore(storeDirectory, dimension);

	// Node-level toggle (constant across items): when on, the store is exposed
	// read-only and write operations are rejected before reaching the engine.
	const readOnly = this.getNodeParameter('readOnly', 0) as boolean;

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const operation = this.getNodeParameter('operation', itemIndex) as string;

			if (readOnly && isWriteOperation(operation)) {
				throw new NodeOperationError(
					this.getNode(),
					`Operation '${operation}' is a write and this node is in read-only mode.`,
					{ itemIndex },
				);
			}

			let out: INodeExecutionData[];

			switch (operation) {
				case 'set': {
					out = ops.upsert(
						store,
						{
							collection: this.getNodeParameter('collection', itemIndex) as string,
							id: this.getNodeParameter('id', itemIndex) as string,
							vector: this.getNodeParameter('vector', itemIndex),
							metadata: this.getNodeParameter('metadata', itemIndex),
							dimension,
						},
						itemIndex,
					);
					break;
				}
				case 'search': {
					out = ops.search(
						store,
						{
							collection: this.getNodeParameter('collection', itemIndex) as string,
							queryVector: this.getNodeParameter('queryVector', itemIndex),
							limit: this.getNodeParameter('limit', itemIndex),
							metric: this.getNodeParameter('metric', itemIndex) as string,
							filter: this.getNodeParameter('filter', itemIndex),
							dimSlice: this.getNodeParameter('dimSlice', itemIndex),
							dimension,
						},
						itemIndex,
					);
					break;
				}
				case 'get': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					const id = this.getNodeParameter('id', itemIndex) as string;
					out = ops.get(store, collection, id, itemIndex);
					break;
				}
				case 'remove': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					const id = this.getNodeParameter('id', itemIndex) as string;
					out = ops.remove(store, collection, id, itemIndex);
					break;
				}
				case 'count': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					out = ops.count(store, collection, itemIndex);
					break;
				}
				case 'drop': {
					const collection = this.getNodeParameter('collection', itemIndex) as string;
					out = ops.drop(store, collection, itemIndex);
					break;
				}
				case 'collections': {
					out = ops.collections(store, itemIndex);
					break;
				}
				default: {
					throw new Error(`Unknown Vector Store operation: "${operation}"`);
				}
			}

			if (isWriteOperation(operation)) {
				flushStore(store);
			}

			returnData.push(...out);
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: itemIndex },
				});
				continue;
			}
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
		}
	}

	return [returnData];
}