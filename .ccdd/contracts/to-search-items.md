---
task: to-search-items
intent: Mapear hits de search de js-vector-store a items de salida n8n, uno por hit, con pairedItem.
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/actions/shape.ts
target_line: 16
language: typescript
signature: "toSearchItems(hits: SearchHit[], itemIndex: number): INodeExecutionData[]"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/actions/__tests__/shape.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/shape.test.ts
deps_allowed: []
forbids:
  - no mutar los hits de entrada
  - no omitir pairedItem
  - no descartar hits (uno por hit)
budget:
  cyclomatic: 5
  nesting: 2
  params: 2
  lines: 12
---

## Intent

Transformar el array de `SearchHit` que devuelve `js-vector-store.search(...)` en items de salida n8n (`INodeExecutionData[]`), un item por hit, cada uno con `pairedItem = { item: itemIndex }` apuntando al item de entrada que produjo la busqueda. Pure: sin store, sin I/O.

## Interface

Entrada: `hits: SearchHit[]` (puede ser `[]`), `itemIndex: number`.
Salida: `INodeExecutionData[]`, un item por hit.

Cada item:
```
{ json: { id, score, metadata }, pairedItem: { item: itemIndex } }
```
`metadata` defaults a `{}` cuando el hit no lo trae.

## Invariants

- `hits = []` -> `[]` (coleccion vacia/inexistente: sin items, no crashea).
- N hits -> exactamente N items, en el mismo orden.
- Cada item tiene `pairedItem.item === itemIndex`.
- `metadata` ausente en el hit -> `{}` en el item.
- `metadata` presente -> se preserva tal cual.
- `id` y `score` se copian sin alterar.
- No muta el array `hits` ni sus elementos.

## Examples

- `toSearchItems([], 0)` -> `[]`
- `toSearchItems([{id:'a',score:1,metadata:{k:'v'}}], 3)` -> `[{ json:{id:'a',score:1,metadata:{k:'v'}}, pairedItem:{item:3} }]`
- `toSearchItems([{id:'a',score:0.9}], 7)` -> metadata `{}`

## Do / Don't

- DO: un item por hit.
- DO: `pairedItem` en todos los items.
- DO: default `{}` para metadata ausente.
- DON'T: mutar la entrada.
- DON'T: descartar hits ni colapsar en un solo item.

## Tests

Tests congelados en `nodes/VectorStore/actions/__tests__/shape.test.ts`. Cubre: empty -> [], un item por hit con id/score/metadata preservados, pairedItem correcto, default `{}` para metadata ausente, propagacion de itemIndex a todos los items, no-mutacion de la entrada.

## Constraints

- Budget: cyclomatic <= 5, nesting <= 2, params <= 2, lines <= 12.
- PARAR y reportar si: un hit se descarta, pairedItem falta, o la entrada se muta.