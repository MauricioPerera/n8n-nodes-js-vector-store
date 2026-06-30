# Changelog

## 1.0.0

Initial release.

- Vector store node backed by [`js-vector-store`](https://www.npmjs.com/package/js-vector-store) (zero-dependency, pure JS — no native binary).
- Operations: **Upsert**, **Search** (cosine / euclidean / dotProduct / manhattan, metadata filters, `dimSlice`), **Get**, **Delete**, **Count**, **Drop Collection**, **List Collections**.
- Strict input validation (vector dimension, non-empty/array, `limit >= 1`) and explicit `flush()` after every write.
- AI tool support (`usableAsTool`) with a **Read-only** mode that rejects write operations — safe for RAG retrieval by an AI agent.
- Persists to a directory on the host filesystem. Self-hosted only.
