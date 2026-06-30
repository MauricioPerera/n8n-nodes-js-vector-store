---
task: parse-metadata
intent: Parsear metadata desde input de usuario (objeto o string JSON de objeto).
target: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/helpers/validate.ts
target_line: 111
language: typescript
signature: "parseMetadata(value: unknown): Record<string, unknown>"
tests: D:/Repo/sqlite node/n8n-nodes-js-vector-store/nodes/VectorStore/helpers/__tests__/parseMetadata.test.ts
test_command: node ../../../node_modules/jest/bin/jest.js --config ../../../jest.config.js --runTestsByPath __tests__/parseMetadata.test.ts
deps_allowed: []
forbids:
  - no devolver arrays
  - no devolver primitivas
  - no aceptar JSON invalido
budget:
  cyclomatic: 5
  nesting: 2
  params: 1
  lines: 17
---

## Intent

Parsear metadata desde input de usuario: un objeto plain o un string JSON que decodea a un objeto plain. undefined/null -> {}. Lanza si el resultado no es un objeto (array o primitiva) o si el JSON es invalido. La metadata debe ser un record, no una lista ni un escalar.

## Interface

Entrada: `value: unknown`.
Salida: `Record<string, unknown>`.

## Invariants

- `undefined`/`null` -> `{}`.
- Objeto plain -> devuelto tal cual (mismo objeto).
- String JSON que decodea a objeto plain -> devuelto.
- String no JSON valido -> lanza (/valid JSON/i).
- Array (literal o JSON) -> lanza (/JSON object/i).
- Primitiva (number, bool, string que no es JSON de objeto) -> lanza (/JSON object/i).

## Examples

- `parseMetadata(undefined)` -> `{}`
- `parseMetadata({a:1})` -> `{a:1}`
- `parseMetadata('{"a":1}')` -> `{a:1}`
- `parseMetadata('[1,2]')` -> lanza (/JSON object/i)
- `parseMetadata('{a:1}')` -> lanza (/valid JSON/i)
- `parseMetadata(42)` -> lanza (/JSON object/i)

## Do / Don't

- DO: usar `typeof === 'object'` + `!Array.isArray` para distinguir record.
- DO: envolver `JSON.parse` en try/catch.
- DON'T: aceptar arrays como metadata.
- DON'T: aceptar primitivas como metadata.

## Tests

Tests congelados en `nodes/VectorStore/helpers/__tests__/parseMetadata.test.ts`. Cubre nullish->{}, objeto plain, JSON string valido, JSON invalido, array (literal y JSON), primitivas.

## Constraints

- Budget: cyclomatic <= 5, nesting <= 2, params <= 1, lines <= 17.
- PARAR y reportar si: un objeto valido lanza, o un array/primitiva/JSON-invalido no lanza.