---
task: has-bm25-index
intent: Decidir si una coleccion tiene indice BM25 en disco a partir del listado de archivos, para cargar lazy el bm25 o rechazar hybrid search sobre una coleccion sin texto indexado.
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/hybrid.ts
target_line: 41
language: typescript
signature: "hasBm25Index(collection: string, presentFiles: readonly string[]): boolean"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/__tests__/hybrid.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/hybrid.test.ts
deps_allowed: []
forbids:
  - no hacer I/O ni leer el filesystem (recibe la lista de archivos)
  - no confundir colecciones por prefijo de nombre (match exacto de filename: docs != docs2)
  - no devolver false cuando <col>.bm25.json SI esta presente
  - no devolver true cuando el archivo presente es de otra coleccion o no relacionado
budget:
  cyclomatic: 11
  nesting: 4
  params: 6
  lines: 41
---

## Intent

Determinar, a partir de la lista de basenames del directorio del store, si una coleccion tiene un indice BM25 persistido (`<col>.bm25.json`). El router lo usa para (a) cargar lazy el `BM25Index` antes de mutar/buscar y (b) rechazar hybrid search sobre una coleccion a la que nunca se le indexo texto. Puro: recibe `presentFiles`, no hace I/O.

## Interface

Entrada: `collection: string`, `presentFiles: readonly string[]` (basenames del dir).
Salida: `boolean` — true si y solo si `presentFiles` incluye exactamente `<collection>.bm25.json`.

## Invariants

- `<col>.bm25.json` presente -> `true`.
- Ausente (dir vacio, o solo archivos del store/otros) -> `false`.
- Match exacto de filename: `docs` no se confunde con `docs2.bm25.json`.
- Archivos no relacionados (`readme.txt`, `other.bm25.json`) -> `false`.

## Examples

- `hasBm25Index('docs', ['docs.bin','docs.json','docs.bm25.json'])` -> `true`
- `hasBm25Index('docs', ['docs.bin','docs.json'])` -> `false`
- `hasBm25Index('docs', [])` -> `false`
- `hasBm25Index('docs', ['docs2.bm25.json'])` -> `false`
- `hasBm25Index('docs', ['readme.txt','other.bm25.json'])` -> `false`

## Do / Don't

- DO: componer el filename como `collection + '.bm25.json'` (via `bm25IndexFile`).
- DO: match exacto con `presentFiles.includes(...)`.
- DON'T: hacer I/O (fs). Recibe la lista.
- DON'T: matchear por prefijo o substring.

## Tests

Tests congelados en `nodes/VectorStore/transport/__tests__/hybrid.test.ts`. Cubre: archivo presente (true), ausente (false), dir vacio (false), colision de prefijo `docs`/`docs2` (false), archivos no relacionados ignorados (false), y `bm25IndexFile` compone `<col>.bm25.json` sin mutar el nombre. Oraculo independiente: el filename esperado esta hard-codeado en el test.

## Constraints

- Budget: cyclomatic <= 11, nesting <= 4, params <= 6, lines <= 41.
- PARAR y reportar si: devuelve false cuando el archivo SI esta presente, o true para una coleccion distinta por prefijo.