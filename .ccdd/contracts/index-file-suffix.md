---
task: index-file-suffix
intent: Mapear un indexType (float32/int8/binary/polar3) al sufijo de archivo binario en disco que usa su store class.
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/indexType.ts
target_line: 36
language: typescript
signature: "indexFileSuffix(indexType: IndexType): string"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/__tests__/indexType.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/indexType.test.ts
deps_allowed: []
forbids:
  - no devolver un sufijo que no sea uno de los 4 exactos
  - no aceptar un indexType invalido sin lanzar
  - no hacer I/O
budget:
  cyclomatic: 11
  nesting: 4
  params: 6
  lines: 41
---

## Intent

Mapear un `indexType` valido (`float32` | `int8` | `binary` | `polar3`) al sufijo del archivo binario que su store class lee/escribe en disco (`.bin`, `.q8.bin`, `.b1.bin`, `.p3.bin`). Puro, sin I/O. Es la base para instanciar la clase correcta y para detectar colision cross-type.

## Interface

Entrada: `indexType: IndexType`.
Salida: `string` (el sufijo, p.ej. `.q8.bin`).

## Invariants

- `float32` -> `.bin`
- `int8` -> `.q8.bin`
- `binary` -> `.b1.bin`
- `polar3` -> `.p3.bin`
- Cualquier otro valor (runtime, fuera del union) -> lanza (`/unknown indextype/i`).

## Examples

- `indexFileSuffix('float32')` -> `.bin`
- `indexFileSuffix('int8')` -> `.q8.bin`
- `indexFileSuffix('binary')` -> `.b1.bin`
- `indexFileSuffix('polar3')` -> `.p3.bin`
- `indexFileSuffix('uint16' as IndexType)` -> lanza (/unknown indextype/i)

## Do / Don't

- DO: switch exhaustivo sobre los 4 valores.
- DO: default que lanza con mensaje claro.
- DON'T: hacer I/O ni leer el filesystem.
- DON'T: devolver un sufijo ambiguo (prefijo de otro, p.ej. `.bin` debe ser exacto para float32).

## Tests

Tests congelados en `nodes/VectorStore/transport/__tests__/indexType.test.ts`. Cubre los 4 valores validos (tabla) + el caso invalido que lanza. Oraculo independiente: los sufijos esperados estan hard-codeados en el test, no derivados del target.

## Constraints

- Budget: cyclomatic <= 11, nesting <= 4, params <= 6, lines <= 41.
- PARAR y reportar si: un indexType valido devuelve un sufijo equivocado, o un valor invalido no lanza.