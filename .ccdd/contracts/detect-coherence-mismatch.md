---
task: detect-coherence-mismatch
intent: Detectar si una coleccion existente en disco fue creada con un indexType distinto al declarado (el caso silencioso de count 0).
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/indexType.ts
target_line: 86
language: typescript
signature: "detectCoherenceMismatch(declared: IndexType, collection: string, presentFiles: readonly string[]): CoherenceResult"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/transport/__tests__/indexType.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/indexType.test.ts
deps_allowed: []
forbids:
  - no hacer I/O ni leer el filesystem (recibe la lista de archivos)
  - no devolver mismatch=true cuando el archivo declarado SI esta presente
  - no devolver mismatch=true cuando no hay ningun archivo de ningun tipo
  - no confundir colecciones por prefijo de nombre (match exacto de filename)
budget:
  cyclomatic: 11
  nesting: 4
  params: 6
  lines: 41
---

## Intent

Detectar, a partir de la lista de archivos presentes en el directorio del store, si una coleccion fue creada con un `indexType` DISTINTO al que la credencial declara. Eso es el caso de fallo silencioso: abrir un `<col>.q8.bin` con `VectorStore` (float32) no lo encuentra y devuelve `count = 0` sin error. Puro: recibe `presentFiles` (basenames), no hace I/O.

## Interface

Entrada: `declared: IndexType`, `collection: string`, `presentFiles: readonly string[]` (basenames del dir).
Salida: `CoherenceResult { mismatch: boolean; declaredFile: string; detectedType: IndexType | null; detectedFile: string | null }`.

## Invariants

- Archivo declarado presente (`<col>` + sufijo de `declared`) -> `mismatch = false` (la store class correcta lo carga; otros archivos del mismo `<col>` son orphans inofensivos).
- Archivo declarado ausente PERO otro tipo SI presente -> `mismatch = true`, `detectedType` = ese tipo, `detectedFile` = ese archivo.
- Ningun archivo de ningun tipo presente -> `mismatch = false` (coleccion nueva/ausente, no es el caso peligroso).
- Match exacto de filename: `docs` no se confunde con `docs2`.
- Archivos no relacionados (`readme.txt`, etc.) -> ignorados, `mismatch = false`.

## Examples

- `detectCoherenceMismatch('float32', 'docs', ['docs.bin','docs.json'])` -> mismatch false, declaredFile `docs.bin`
- `detectCoherenceMismatch('float32', 'docs', ['docs.q8.bin','docs.q8.json'])` -> mismatch true, detectedType `int8`, detectedFile `docs.q8.bin`
- `detectCoherenceMismatch('int8', 'docs', ['docs.b1.bin'])` -> mismatch true, detectedType `binary`
- `detectCoherenceMismatch('int8', 'docs', [])` -> mismatch false
- `detectCoherenceMismatch('float32', 'docs', ['docs.bin','docs.q8.bin'])` -> mismatch false (declarado presente, .q8.bin es orphan)
- `detectCoherenceMismatch('float32', 'docs', ['docs2.bin'])` -> mismatch false (no confunde por prefijo)

## Do / Don't

- DO: usar `expectedIndexFile` para calcular el filename de cada tipo.
- DO: match exacto con `presentFiles.includes(...)`.
- DON'T: hacer I/O (fs). Recibe la lista.
- DON'T: devolver mismatch cuando el archivo declarado esta presente.

## Tests

Tests congelados en `nodes/VectorStore/transport/__tests__/indexType.test.ts`. Cubre: declarado presente (no mismatch), otro tipo presente y declarado ausente (mismatch + tipo detectado), coleccion nueva (no mismatch), orphan coexistente (no mismatch), colision de prefijo `docs`/`docs2` (no mismatch), archivos no relacionados ignorados.

## Constraints

- Budget: cyclomatic <= 11, nesting <= 4, params <= 6, lines <= 41.
- PARAR y reportar si: mismatch=true cuando el declarado esta presente, o mismatch=false cuando otro tipo esta presente y el declarado no.