import type { INodeProperties, ICredentialType } from 'n8n-workflow';

/**
 * Credentials for the Vector Store (js-vector-store) node.
 *
 * Holds the absolute filesystem path to the store directory, the fixed vector
 * dimension, and the quantization `indexType`. There is no network
 * authentication here — the "credential" is a stable, reusable place to store
 * these so multiple nodes/operations can share the same store.
 *
 * The `indexType` selects which `js-vector-store` class backs the store
 * (Float32/Int8/Binary/Polar); it is fixed per store and validated against the
 * on-disk files at runtime to avoid the silent-empty failure mode.
 *
 * All three fields are re-validated at runtime in `openStore` (never trust only
 * the credential definition), so this definition only declares the fields.
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
		{
			displayName: 'Index Type',
			name: 'indexType',
			type: 'options',
			default: 'float32',
			options: [
				{
					name: 'Float32',
					value: 'float32',
					description:
						'Exact Float32 storage (default). No quantization, full recall, fastest search at low dim. Use unless you need smaller disk footprint.',
				},
				{
					name: 'Int8',
					value: 'int8',
					description:
						'Int8 quantization (~3x smaller on disk). Lower recall and slower search at low dim; the trade pays off at higher dim. Changing type requires re-inserting every vector.',
				},
				{
					name: 'Binary (1-bit)',
					value: 'binary',
					description:
						'1-bit binary quantization (~9x smaller). Recall is poor below dim ~768; only useful with high-dimensional embeddings. Changing type requires re-inserting every vector.',
				},
				{
					name: 'Polar (3-bit)',
					value: 'polar3',
					description:
						'3-bit polar quantization (~21x smaller). Requires an EVEN dimension. Changing type requires re-inserting every vector.',
				},
			],
			description:
				'Quantization strategy for this store. Fixed per store: a collection lives under one type, set at creation. Opening an existing collection with a different type fails loudly (the node detects the file-type mismatch) instead of silently appearing empty.',
		},
	];
}