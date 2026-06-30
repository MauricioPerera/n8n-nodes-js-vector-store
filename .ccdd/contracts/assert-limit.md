---
task: assert-limit
intent: Coercer un limit de busqueda a un entero >= 1 con default 5.
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/helpers/validate.ts
target_line: 87
language: typescript
signature: "assertLimit(value: unknown): number"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/helpers/__tests__/assertLimit.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/assertLimit.test.ts
deps_allowed: []
forbids:
  - no devolver < 1
  - no devolver no entero
  - no aceptar NaN / Infinity
budget:
  cyclomatic: 5
  nesting: 2
  params: 1
  lines: 13
---

## Intent

Coercer un `limit` de busqueda a un entero >= 1. Default 5 cuando es undefined/null. Trunca floats hacia cero (`Math.trunc`). Lanza si < 1 o no es number finito (la lib crashea el heap con limit=0, spike §8).

## Interface

Entrada: `value: unknown`.
Salida: `number` (entero >= 1).

## Invariants

- `undefined`/`null` -> `5` (default documentado, igual que la lib).
- Number finito entero >= 1 -> devuelto igual.
- Number finito float >= 1 -> truncado a entero (`3.9` -> `3`).
- Number < 1 (incluyendo 0, negativos, `0.9`) -> lanza (/>= 1/i).
- Non-number (string, bool, array, objeto) -> lanza (/finite number/i).
- Non-finite (`Infinity`, `NaN`) -> lanza (/finite number/i).

## Examples

- `assertLimit(undefined)` -> `5`
- `assertLimit(5)` -> `5`
- `assertLimit(3.9)` -> `3`
- `assertLimit(0)` -> lanza (/>= 1/i)
- `assertLimit("5")` -> lanza (/finite number/i)

## Do / Don't

- DO: default 5 para nullish.
- DO: `Math.trunc` para normalizar floats.
- DON'T: clamp superior (la lib capea al count de la coleccion).
- DON'T: aceptar 0 (crashea el heap).

## Tests

Tests congelados en `nodes/VectorStore/helpers/__tests__/assertLimit.test.ts`. Cubre default nullish, entero positivo, truncado de float, < 1, non-number, non-finite.

## Constraints

- Budget: cyclomatic <= 5, nesting <= 2, params <= 1, lines <= 13.
- PARAR y reportar si: un entero >= 1 lanza, o un < 1 / no-finite no lanza.