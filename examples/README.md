# Example workflows

Importable n8n workflow templates for the **Vector Store** node (`n8n-nodes-js-vector-store`).

## How to import

1. In n8n: **Workflows → ⋮ → Import from File…** and pick a `.json`.
2. Open each **Vector Store** node and select your **Vector Store API** credential.
   - **Store Directory**: an absolute path on the n8n host (e.g. `/data/vectors`).
   - **Dimension**: must match the vectors in the workflow (the toy examples use **4**; real embeddings use 768/1536/…).
3. Click **Execute Workflow**.

## Templates

| File | What it shows |
|------|---------------|
| `01-index-and-search.json` | Upsert toy vectors with metadata, then a similarity **Search** (top-1 = exact match). Self-contained, runnable. |
| `02-filtered-search.json` | Search combined with a **Mongo-style metadata filter** (`category` + `price < 100`). Self-contained, runnable. |
| `03-rag-retrieval.json` | **RAG retrieval pattern**: embed a query string via your embeddings provider → Vector Store Search. Skeleton — fill in your embeddings API + matching Dimension. |

## Notes

- This node **stores and searches** vectors; it does **not** generate embeddings — use an embeddings node / API and pass the `vector` in.
- For AI agents, enable **Read-only** on the node so writes are rejected.
- Filters are applied **after** scoring; raise `limit` when filters are selective.
- Self-hosted only (the store is a directory on the host filesystem).
