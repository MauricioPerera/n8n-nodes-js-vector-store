---
task: parse-stages
intent: Producir la lista validada de stages Matryoshka (enteros en [1, dim], truncados) desde input crudo del usuario, cayendo a defaultStages(dim) cuando el input esta vacio o es invalido.
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/ann.ts
target_line: 120
language: typescript
signature: "parseStages(value: unknown, dim: number): number[]"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/__tests__/ann.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/ann.test.ts
deps_allowed: []
forbids:
  - no hacer I/O
  - no mutar el input ni devolver un array compartido entre llamadas
  - no dejar stages > dim (deben clampearse con Math.min(stage, dim))
  - no dejar stages < 1 (deben descartarse)
  - no inventar defaults distintos de defaultStages(dim)
budget:
  cyclomatic: 11
  nesting: 4
  params: 6
  lines: 41
---

## Intent

Tomar el valor crudo de `stages` del usuario (array de numeros o string JSON de un array) y producir la lista de stages que se pasa a `store.matryoshkaSearch`, truncando a entero, clampeando con `Math.min(stage, dim)`, descartando `< 1`, y cayendo a `defaultStages(dim)` cuando el input es vacio/missing/invalido o cuando todos los elementos se descartan. Puro, sin I/O ni side effects.

## Interface

Entrada: `value: unknown` (array | string JSON | undefined/null/'' ), `dim: number` (dimension del store, >= 1).
Salida: `number[]` — stages enteros, cada uno en `[1, dim]`, orden preservado; nunca vacio (siempre cae a default).

## Invariants

- `undefined` / `null` / `''` / `'[]'` / `[]` / JSON invalido / JSON no-array / escalar no-array -> `defaultStages(dim)`.
- Cada elemento finite: `Math.trunc(s)` luego `Math.min(n, dim)`; si `>= 1` se mantiene, sino se descarta.
- Elementos no-finite (NaN/Infinity) o no-number: se descartan (leniente, no throw).
- Si tras procesar todo la lista queda vacia -> `defaultStages(dim)`.
- Devuelve un array fresco cada llamada (sin estado compartido).

## Examples

- `parseStages(undefined, 16)` -> `defaultStages(16)` = `[4, 8, 16]`
- `parseStages('[4, 8, 16]', 16)` -> `[4, 8, 16]`
- `parseStages([4.9, 8.1, 16], 16)` -> `[4, 8, 16]` (truncado)
- `parseStages('[2, 4, 8, 16, 32]', 16)` -> `[2, 4, 8, 16, 16]` (clampeado a dim)
- `parseStages('[128, 384, 768]', 16)` -> `[16, 16, 16]`
- `parseStages('[0, -3, NaN, Infinity]', 16)` -> `defaultStages(16)`
- `parseStages('[0, 4, -2, 8]', 16)` -> `[4, 8]`

## Do / Don't

- DO: clamear con `Math.min(stage, dim)` ANTES de devolver.
- DO: truncar stages fraccionales a entero.
- DO: caer a `defaultStages(dim)` cuando el resultado seria vacio.
- DON'T: hacer I/O, throw, o mutar el input.
- DON'T: devolver stages > dim o < 1.

## Tests

Tests congelados en `nodes/VectorStore/transport/__tests__/ann.test.ts`. Cubre: fallback a default para undefined/null/''/[]/'[]'/'not-json'/escalar; parseo de string JSON y array; truncado fraccional; clampeo a dim; descarte de sub-1 y no-finite; fallback cuando todos se descartan; array fresco por llamada (no mutacion compartida). Oraculo independiente: defaults y clampeo re-derivados inline en el test.

## Constraints

- Budget: cyclomatic <= 11, nesting <= 4, params <= 6, lines <= 41.
- PARAR y reportar si: algun stage devuelto es > dim o < 1, o el resultado es vacio, o un input invalido no cae a default.