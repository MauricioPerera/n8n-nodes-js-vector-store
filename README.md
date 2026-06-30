# n8n-nodes-js-vector-store

An [n8n](https://n8n.io/) community node to **store, search and manage vector embeddings** directly from your workflows — backed by [`js-vector-store`](https://www.npmjs.com/package/js-vector-store), a zero-dependency pure-JS vector store.

No native binary, no external database: vectors persist to a directory on the n8n host. Great for semantic search / RAG over your own data (catalogs, docs, support tickets, spreadsheets migrated to structured data).

> This node **stores and searches** vectors — it does **not** generate embeddings. Produce embeddings with an embeddings node (OpenAI, Cohere, Workers AI, etc.) and pass the vector in.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [AI / tool use](#ai--tool-use) · [Notes](#notes)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install `n8n-nodes-js-vector-store`.

> **Self-hosted only.** The node reads/writes a vector store **directory on the host filesystem**, so it requires a self-hosted / Docker n8n (n8n Cloud has no persistent local filesystem).

## Operations

- **Upsert** — insert or update a vector by id, with optional metadata.
- **Search** — k-nearest neighbours for a query vector. Metric (cosine/euclidean/dotProduct/manhattan), `limit`, optional Mongo-style **metadata filter**, optional `dimSlice` (Matryoshka).
- **Get** — fetch a vector + metadata by id.
- **Delete** — remove a vector by id.
- **Count** — number of vectors in a collection.
- **Drop Collection** — delete a whole collection.
- **List Collections** — list collection names in the store.

Vectors and metadata are validated (dimension must match the credential; `limit >= 1`) and writes are flushed to disk automatically.

## Credentials

A single credential **Vector Store API**:

- **Store Directory** — absolute path on the n8n host where the store persists (e.g. `/data/vectors`).
- **Dimension** — vector length (fixed per store; every vector must match it).

## AI / tool use

The node is enabled as an **AI tool** (`usableAsTool`). Turn on **Read-only** to let an AI agent **query** the store (Search/Get/Count/List) while write operations (Upsert/Delete/Drop) are rejected — safe for RAG retrieval.

## Notes

- Default search is exact (brute-force): fast up to tens of thousands of vectors. For larger sets, approximate indexing (IVF) and quantization are on the roadmap.
- Metadata filters are applied **after** scoring; with very selective filters raise `limit`.

## License

[MIT](LICENSE.md)
