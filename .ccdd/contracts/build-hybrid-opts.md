---
task: build-hybrid-opts
intent: Producir el objeto HybridSearchOpts desde input crudo del usuario aplicando defaults del motor (fetchK=0 se omite para que aplique el default del motor).
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/hybrid.ts
target_line: 67
language: typescript
signature: "buildHybridOpts(input: object): HybridOpts"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/__tests__/hybrid.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/hybrid.test.ts
deps_allowed: []
forbids:
  - no hacer I/O
  - no pasar fetchK=0 al motor (debe omitirse para que aplique el default max(limit*3,50))
  - no mutar el input ni devolver un objeto compartido entre llamadas
  - no inventar defaults distintos de 0.5/0.5/60/cosine
budget:
  cyclomatic: 11
  nesting: 4
  params: 6
  lines: 41
---

## Intent

Tomar los valores crudos de opciones del usuario (pesos, rrfK, fetchK, metric) y producir el objeto `HybridSearchOpts` que se pasa a `HybridSearch.search`, aplicando los defaults del motor y la convencion especifica del nodo: `fetchK = 0` significa "dejar que el motor elija `max(limit*3, 50)`" -> se OMITE del resultado. Puro, sin I/O ni side effects.

## Interface

Entrada: `input: { vectorWeight?: unknown; textWeight?: unknown; rrfK?: unknown; fetchK?: unknown; metric?: unknown }`.
Salida: `{ vectorWeight: number; textWeight: number; rrfK: number; metric: string; fetchK?: number }`.

## Invariants

- Defaults cuando missing o no-finito: `vectorWeight=0.5`, `textWeight=0.5`, `rrfK=60`, `metric='cosine'`.
- `metric` no-string o string vacio -> `'cosine'`; string no-vacio -> pasa igual.
- `fetchK`: finite y `> 0` -> `Math.trunc(fetchK)`; `0`, negativo, no-finite, o no-number -> `undefined` (omitido).
- El motor NO normaliza los pesos; se pasan tal cual (validados solo como finitos).
- Devuelve un objeto fresco cada llamada (sin estado compartido).

## Examples

- `buildHybridOpts({})` -> `{ vectorWeight:0.5, textWeight:0.5, rrfK:60, metric:'cosine', fetchK:undefined }`
- `buildHybridOpts({ vectorWeight:0.2, textWeight:0.8, rrfK:100, metric:'dotProduct', fetchK:50 })` -> esos mismos valores con `fetchK:50`
- `buildHybridOpts({ fetchK:0 }).fetchK` -> `undefined`
- `buildHybridOpts({ fetchK:50.9 }).fetchK` -> `50`
- `buildHybridOpts({ vectorWeight:NaN, textWeight:Infinity, rrfK:'big' })` -> defaults `0.5/0.5/60/cosine`, `fetchK:undefined`

## Do / Don't

- DO: tratar `fetchK=0` como "omitir" (el motor default), NO como 0 literal.
- DO: truncar fetchK fraccional a entero.
- DO: validad finitud de pesos/rrfK con fallback al default.
- DON'T: hacer I/O ni mutar el input.
- DON'T: normalizar/clampear los pesos (el motor no lo hace; el nodo pasa lo que el usuario pide).

## Tests

Tests congelados en `nodes/VectorStore/transport/__tests__/hybrid.test.ts`. Cubre: defaults para input vacio, passthrough de valores, fetchK=0 -> undefined, fetchK negativo -> undefined, fetchK fraccional -> truncado, pesos/rrfK no-finitos -> defaults, metric vacio/no-string -> cosine, objeto fresco por llamada (no mutacion compartida). Oraculo independiente: defaults hard-codeados en el test.

## Constraints

- Budget: cyclomatic <= 11, nesting <= 4, params <= 6, lines <= 41.
- PARAR y reportar si: fetchK=0 pasa como 0 al motor, o los defaults no son 0.5/0.5/60/cosine.