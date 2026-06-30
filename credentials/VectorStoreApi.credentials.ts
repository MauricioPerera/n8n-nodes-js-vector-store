import type { INodeProperties, ICredentialType } from 'n8n-workflow';

/**
 * Credentials for the Vector Store (js-vector-store) node.
 *
 * Holds the absolute filesystem path to the store directory and the fixed
 * vector dimension. There is no network authentication here — the "credential"
 * is a stable, reusable place to store these so multiple nodes/operations can
 * share the same store.
 *
 * Both fields are re-validated at runtime in `openStore` (never trust only the
 * credential definition), so this definition only declares the fields.
 */
export class VectorStoreApi implements ICredentialType {
	name = 'vectorStoreApi';

	displayName = 'Vector Store API';

	/**
	 * kebab-case identifier used in the project setup docs; points users at
	 * the README rather than a remote URL.
	 */
	documentationUrl = 'vector-store';

	properties: INodeProperties[] = [
		{
			displayName: 'Store Directory',
			name: 'storeDirectory',
			type: 'string',
			default: '',
			placeholder: '/absolute/path/to/vector-store',
			description:
				'Absolute path to the directory where the vector store persists on the n8n host filesystem',
		},
		{
			displayName: 'Dimension',
			name: 'dimension',
			type: 'number',
			default: 768,
			description:
				'Fixed vector dimension for this store (must match the embeddings you store)',
		},
	];
}