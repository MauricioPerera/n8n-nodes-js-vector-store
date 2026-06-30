---
task: assert-vector
intent: Validar que un valor es un array de numbers finitos de longitud dim.
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/helpers/validate.ts
target_line: 20
language: typescript
signature: "assertVector(value: unknown, dim: number): number[]"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/helpers/__tests__/assertVector.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/assertVector.test.ts
deps_allowed: []
forbids:
  - no aceptar arrays de longitud != dim
  - no aceptar elementos no finitos (NaN, Infinity)
  - no aceptar elementos no numericos
  - no mutar el input
budget:
  cyclomatic: 8
  nesting: 3
  params: 2
  lines: 20
---

## Intent

Validar que un valor es un array de numbers finitos de longitud exactamente `dim` y devolverlo tipado como `number[]`. Es el gate obligatorio antes de pasar un vector a `js-vector-store`, que NO valida y corrompe silenciosamente si la dim no coincide (spike §8).

## Interface

Entrada: `value: unknown`, `dim: number`.
Salida: `number[]` (el mismo array, tipado).

## Invariants

- No array -> lanza `Error` con mensaje que menciona "array of numbers".
- Array de longitud != dim -> lanza `Error` con "expected N, got M" (N=dim, M=length).
- Elemento no `number` o no finito (NaN/Infinity/-Infinity) -> lanza `Error` mencionando el índice.
- Array valido -> devuelve el mismo array (identidad), sin mutar.

## Examples

- `assertVector([1,2,3], 3)` -> `[1,2,3]`
- `assertVector([1,2,3], 8)` -> lanza (/expected 8, got 3/i)
- `assertVector([1,NaN,3], 3)` -> lanza (/index 1/i)
- `assertVector("x", 3)` -> lanza (/array of numbers/i)

## Do / Don't

- DO: usar `Array.isArray` + `Number.isFinite`.
- DO: reportar expected vs received en el mismatch de dim.
- DON'T: validar dim positiva (eso es de `openStore`/credencial).
- DON'T: mutar el input.

## Tests

Tests congelados en `nodes/VectorStore/helpers/__tests__/assertVector.test.ts`. Cubre array valida, non-array, mismatch de dim (incluyendo vacio), elementos no finitos, elementos no numericos, y no-mutacion.

## Constraints

- Budget: cyclomatic <= 8, nesting <= 3, params <= 2, lines <= 20.
- PARAR y reportar si: un array valido lanza, o un array invalido no lanza, o el input es mutado.