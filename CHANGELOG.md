# Changelog

## 1.1.0

Advanced retrieval features (all backed by `js-vector-store`, still zero-dependency):

- **Hybrid Search** — fuse semantic vector search with BM25 lexical search (`rrf` or `weighted`). Add an optional **Text** field on Upsert to index documents for hybrid; the BM25 index is persisted alongside the vectors and kept in sync on delete.
- **Quantization** — `indexType` on the credential: `float32` (default), `int8` (~3x smaller), `binary` (~9x), `polar3` (~21x). Coherence is validated to avoid silently opening a collection with the wrong format.
- **ANN index (IVF)** — `Build ANN Index` / `Drop ANN Index` operations and a `useIndex` option on Search for approximate nearest-neighbour on large collections (cosine-only; build is explicit and can be costly).
- **Matryoshka Search** — progressive multi-stage dimensional search.
- **Search Across** — query multiple collections at once with normalized scores.

Backward compatible: existing workflows keep working unchanged (default `float32`, vector-only upsert creates no BM25 files).

## 1.0.0

Initial release.

- Vector store node backed by [`js-vector-store`](https://www.npmjs.com/package/js-vector-store) (zero-dependency, pure JS — no native binary).
- Operations: **Upsert**, **Search** (cosine / euclidean / dotProduct / manhattan, metadata filters, `dimSlice`), **Get**, **Delete**, **Count**, **Drop Collection**, **List Collections**.
- Strict input validation (vector dimension, non-empty/array, `limit >= 1`) and explicit `flush()` after every write.
- AI tool support (`usableAsTool`) with a **Read-only** mode that rejects write operations — safe for RAG retrieval by an AI agent.
- Persists to a directory on the host filesystem. Self-hosted only.
