---
task: is-write-operation
intent: Clasificar un id de operacion del Vector Store como escritura o lectura.
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/actions/security.ts
target_line: 27
language: typescript
signature: "isWriteOperation(operation: string): boolean"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/actions/__tests__/isWriteOperation.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/isWriteOperation.test.ts
deps_allowed: []
forbids:
  - clasificar search/get/count/collections como escritura
  - clasificar set/remove/drop/buildAnnIndex/dropAnnIndex como lectura
  - mutar el argumento
budget:
  cyclomatic: 5
  nesting: 2
  params: 1
  lines: 13
---

## Intent

Único fuente de verdad para qué operation ids del Vector Store mutan el store.
Usado por (a) el guard de `readOnly` del router para rechazar escrituras antes
de ejecutarlas y (b) la lógica de flush-after-write del router. Sin esta
función, ambos sitios duplicarían el set de ids de escritura y podrían
divergir silenciosamente, dejando pasar una escritura en read-only o
saltándose un flush.

## Interface

Entrada: `operation: string` (un id de operación del nodo: `set`, `search`,
`get`, `remove`, `count`, `drop`, `collections`, o cualquier otro string).
Salida: `boolean` — `true` si muta el store en disco, `false` si es lectura
o desconocido.

## Invariants

- `set` (Upsert), `remove` (Delete), `drop` (Drop Collection), `buildAnnIndex` (writes `<col>.ivf.json`), `dropAnnIndex` (deletes it) -> `true`.
- `search`, `get`, `count`, `collections`, `matryoshkaSearch`, `searchAcross` -> `false`.
- Id desconocido (incluyendo `''`, mayúsculas como `SET`, sinónimos como
  `upsert`/`delete`) -> `false` (default a lectura; el branch `default` del
  router rechaza ids desconocidos por separado, así que un desconocido
  mal clasificado nunca llega al engine).
- No muta el argumento; función pura sin estado.

## Examples

- `isWriteOperation('set')` -> `true`
- `isWriteOperation('remove')` -> `true`
- `isWriteOperation('drop')` -> `true`
- `isWriteOperation('buildAnnIndex')` -> `true`
- `isWriteOperation('dropAnnIndex')` -> `true`
- `isWriteOperation('matryoshkaSearch')` -> `false`
- `isWriteOperation('searchAcross')` -> `false`
- `isWriteOperation('search')` -> `false`
- `isWriteOperation('collections')` -> `false`
- `isWriteOperation('')` -> `false`

## Do / Don't

- DO: un único `Set` de ids de escritura como fuente de verdad.
- DO: default a `false` para ids desconocidos.
- DON'T: duplicar el set de escritura en el router (importa esta función).
- DON'T: aceptar mayúsculas como equivalentes (el router ya normaliza vía el
  `options` del nodo; aquí se compara exacto).

## Tests

Tests congelados en
`nodes/VectorStore/actions/__tests__/isWriteOperation.test.ts`. Cubre los 3
writes, los 4 reads, y unknowns (vacío, mayúsculas, sinónimos, bogus) -> false.

## Constraints

- Budget: cyclomatic <= 5, nesting <= 2, params <= 1, lines <= 13.
- PARAR y reportar si: un write devuelve `false`, o un read/unknown devuelve
  `true`, o la función muta su argumento.