---
task: parse-collections
intent: Producir la lista de nombres de coleccion (trimeados, unicos, no-vacios) para Search Across desde input crudo del usuario (string comma-separado o array).
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/ann.ts
target_line: 146
language: typescript
signature: "parseCollections(value: unknown): string[]"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/__tests__/ann.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/ann.test.ts
deps_allowed: []
forbids:
  - no hacer I/O
  - no mutar el input ni devolver un array compartido entre llamadas
  - no dejar nombres vacios o solo-blancos
  - no dejar duplicados
  - no incluir elementos no-string del array
budget:
  cyclomatic: 11
  nesting: 4
  params: 6
  lines: 41
---

## Intent

Tomar el valor crudo de `collections` del usuario (string separado por comas o array de strings, tipicamente multiOptions) y producir la lista de nombres de coleccion que se pasa a `store.searchAcross`, trimeando cada nombre, descartando vacios/blancos y duplicados, preservando el orden de primera aparicion. Puro, sin I/O ni side effects.

## Interface

Entrada: `value: unknown` (string | string[] | undefined/null/otro).
Salida: `string[]` — nombres trimeados, no-vacios, unicos, orden de primera aparicion; `[]` si no hay ninguno valido.

## Invariants

- String -> `split(',')` y se procesa cada elemento.
- Array -> se procesa cada elemento (se descartan los no-string).
- `undefined` / `null` / otros tipos -> `[]`.
- Cada nombre: `trim()`; se descarta si queda vacio; se descarta si ya fue visto (dedupe).
- Orden preservado por primera aparicion.
- Devuelve un array fresco cada llamada.

## Examples

- `parseCollections('a,b,c')` -> `['a', 'b', 'c']`
- `parseCollections(' a , b , , c ')` -> `['a', 'b', 'c']`
- `parseCollections('a,a,b,a')` -> `['a', 'b']`
- `parseCollections(' ,, ')` -> `[]`
- `parseCollections('')` -> `[]`
- `parseCollections(['x', 'y', 'x'])` -> `['x', 'y']`
- `parseCollections(['  x  ', 'y', ''])` -> `['x', 'y']`
- `parseCollections(['a', 5, true, 'b'])` -> `['a', 'b']`
- `parseCollections(undefined)` -> `[]`
- `parseCollections(42)` -> `[]`

## Do / Don't

- DO: trim cada nombre y descartar vacios.
- DO: dedupe por primera aparicion.
- DO: aceptar string (comma-split) Y array (multiOptions).
- DON'T: hacer I/O, throw, o mutar el input.
- DON'T: incluir nombres vacios, duplicados, o no-string.

## Tests

Tests congelados en `nodes/VectorStore/transport/__tests__/ann.test.ts`. Cubre: split de string con trim, descarte de blanks, dedupe, string vacio -> [], array con orden y dedupe, descarte de no-string, tipos no-array/string -> [], array fresco por llamada. Oraculo independiente: valores esperados hard-codeados en el test.

## Constraints

- Budget: cyclomatic <= 11, nesting <= 4, params <= 6, lines <= 41.
- PARAR y reportar si: algun nombre devuelto es vacio, hay duplicados, o un no-string se cuela.