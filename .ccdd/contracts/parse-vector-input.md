---
task: parse-vector-input
intent: Parsear un vector desde input de usuario (array de numbers o string JSON de array de numbers).
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/helpers/validate.ts
target_line: 48
language: typescript
signature: "parseVectorInput(value: unknown): number[]"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/helpers/__tests__/parseVectorInput.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/parseVectorInput.test.ts
deps_allowed: []
forbids:
  - no validar dim aca (es job de assertVector)
  - no aceptar JSON que no parsea a array
  - no aceptar elementos no finitos
  - no mutar el input
budget:
  cyclomatic: 9
  nesting: 3
  params: 1
  lines: 28
---

## Intent

Parsear un vector desde input de usuario: un array literal de numbers o un string JSON que decodea a un array de numbers. No valida dimension (eso lo hace `assertVector`); solo valida que el resultado es un array de numbers finitos.

## Interface

Entrada: `value: unknown`.
Salida: `number[]`.

## Invariants

- Array de numbers finitos -> devuelto tal cual.
- String JSON que decodea a array de numbers finitos -> devuelto.
- String no JSON valido -> lanza (/valid JSON/i).
- JSON que decodea a no-array (objeto, numero, string) -> lanza (/parse to an array/i).
- Array o JSON con elemento no finito / no number -> lanza (/index i/i).
- Tipo no array ni string -> lanza (/array of numbers/i).
- Array vacio -> devuelto (la dim se valida en `assertVector`).

## Examples

- `parseVectorInput([1,2,3])` -> `[1,2,3]`
- `parseVectorInput('[1, 2, 3]')` -> `[1,2,3]`
- `parseVectorInput('1,2,3')` -> lanza (/valid JSON/i)
- `parseVectorInput('{"a":1}')` -> lanza (/parse to an array/i)
- `parseVectorInput(42)` -> lanza (/array of numbers/i)

## Do / Don't

- DO: ramificar por `Array.isArray` luego `typeof === 'string'`.
- DO: envolver `JSON.parse` en try/catch con mensaje claro.
- DON'T: validar dim (job de `assertVector`).
- DON'T: aceptar arrays con elementos no finitos.

## Tests

Tests congelados en `nodes/VectorStore/helpers/__tests__/parseVectorInput.test.ts`. Cubre array literal, JSON string valido, non-string/non-array, JSON invalido, JSON non-array, elementos no finitos, y array vacio.

## Constraints

- Budget: cyclomatic <= 9, nesting <= 3, params <= 1, lines <= 28.
- PARAR y reportar si: un input valido lanza, o un input invalido no lanza.