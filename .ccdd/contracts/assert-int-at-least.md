---
task: assert-int-at-least
intent: Validar que un valor numerico del usuario sea entero finite >= min, devolviendolo truncado o lanzando un Error que nombra el campo ofensor.
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/ann.ts
target_line: 175
language: typescript
signature: "assertIntAtLeast(value: unknown, name: string, min: number): number"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/__tests__/ann.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/ann.test.ts
deps_allowed: []
forbids:
  - no hacer I/O
  - no aceptar no-numeros, NaN o Infinity como validos
  - no devolver un valor < min
  - no omitir `name` en el mensaje de error
budget:
  cyclomatic: 11
  nesting: 4
  params: 6
  lines: 41
---

## Intent

Validar `numClusters` / `numProbes` / `sampleDims` (parametros del build IVF) como enteros finite dentro de rango ANTES de llamar al caro `IVFIndex.build`. La libreria NO valida estos valores; el build es O(K·N·dim) y falla o comporta mal con valores invalidos, asi que el gate debe fallar fuerte y temprano con un Error que nombre el campo ofensor. Puro, sin I/O ni side effects (solo throw).

## Interface

Entrada: `value: unknown`, `name: string` (nombre del campo para el mensaje), `min: number` (inclusive).
Salida: `number` — el entero truncado `>= min`.
Throws: `Error` si `value` no es finite number, o si `Math.trunc(value) < min`.

## Invariants

- No-number, NaN, Infinity, undefined, null, string -> throw `<name> must be a finite integer >= <min>, got: <value>`.
- Finite number con `Math.trunc(value) < min` -> throw `<name> must be >= <min>, got: <value>`.
- Finite number con `Math.trunc(value) >= min` -> devuelve `Math.trunc(value)`.
- `name` siempre aparece en el mensaje de error.

## Examples

- `assertIntAtLeast(5, 'numClusters', 1)` -> `5`
- `assertIntAtLeast(100.9, 'numClusters', 1)` -> `100`
- `assertIntAtLeast(0, 'sampleDims', 0)` -> `0`
- `assertIntAtLeast(0, 'numClusters', 1)` -> throw `/numClusters must be >= 1/`
- `assertIntAtLeast(-1, 'sampleDims', 0)` -> throw `/sampleDims must be >= 0/`
- `assertIntAtLeast('5', 'numClusters', 1)` -> throw `/numClusters must be a finite integer/`
- `assertIntAtLeast(NaN, 'numClusters', 1)` -> throw `/numClusters must be a finite integer/`
- `assertIntAtLeast(Infinity, 'numProbes', 1)` -> throw `/numProbes must be a finite integer/`

## Do / Don't

- DO: truncar a entero antes de comparar y devolver.
- DO: incluir `name` y `min` en el mensaje.
- DO: rechazar NaN/Infinity/no-number.
- DON'T: hacer I/O o mutar nada.
- DON'T: devolver un valor < min o aceptar no-finitos.

## Tests

Tests congelados en `nodes/VectorStore/transport/__tests__/ann.test.ts`. Cubre: valores validos pasan (entero y fraccional truncado, min=0 para sampleDims); below-min throw con nombre; no-number/NaN/Infinity/undefined throw con nombre. Oraculo independiente: mensajes esperados hard-codeados.

## Constraints

- Budget: cyclomatic <= 11, nesting <= 4, params <= 6, lines <= 41.
- PARAR y reportar si: un no-finito pasa, o un valor < min devuelve en vez de throw, o el mensaje no incluye `name`.