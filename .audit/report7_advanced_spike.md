# SPIKE de integración v1.1.0 — features avanzadas de `js-vector-store`

Spike desechable. Todos los números son **REALES**, medidos en:
- **Windows 11 Pro**, Node **v24.16.0**, PowerShell.
- `js-vector-store@1.0.0` (zero-dep, vanilla JS). Scripts en `.spike2/`.
- Firmas verificadas leyendo el fuente (`node_modules/js-vector-store/js-vector-store.js`, 2340 líneas) **y** ejecutando.

> Corrección sobre el spike previo (`.spike-report.md`): éste asumía que `BM25Index` **no** tenía `removeDocument`. **FALSO**: existe (línea 1868 del fuente) y funciona. Ver §1 SYNC.

---

## 1. HYBRID (BM25 + HybridSearch) — end-to-end, persistencia, sync

### Firmas EXACTAS verificadas

```js
// BM25
new BM25Index({ k1 = 1.5, b = 0.75, tokenizer? })            // opts opcional
bm25.addDocument(col, id, text)                              // upsert: si id existe, remueve antes
bm25.removeDocument(col, id)                                 // EXISTE — no asumir que falta
bm25.search(col, query, limit = 10) -> [{ id, score }]
bm25.count(col), bm25.vocabularySize(col)
bm25.save(adapter, col)                                      // writeJson(`<col>.bm25.json`)
bm25.load(adapter, col)                                      // readJson + importState

// HybridSearch
new HybridSearch(store, bm25, mode = 'rrf' | 'weighted')
hybrid.search(col, vector, text, limit = 5, opts = {}) ->
  opts: { vectorWeight=0.5, textWeight=0.5, rrfK=60, fetchK=max(limit*3,50), metric='cosine' }
  -> [{ id, score, metadata }]
```

### Snippet mínimo que funciona (`.spike2/01-hybrid-write.js`)

```js
import { VectorStore, BM25Index, HybridSearch, FileStorageAdapter } from 'js-vector-store';
const adapter = new FileStorageAdapter(DIR);          // MISMO dir que el store
const store   = new VectorStore(DIR, 8);
const bm25    = new BM25Index({ k1: 1.5, b: 0.75 });

for (const d of docs) {
  store.set(COL, d.id, d.vec, d.meta);                // vector
  bm25.addDocument(COL, d.id, d.text);                // texto
}
store.flush();
bm25.save(adapter, COL);                              // persistencia bm25

const hyb = new HybridSearch(store, bm25, 'rrf');
hybrid.search(COL, qVec, qText, 5, { fetchK: 50 });   // [{id, score, metadata}]
```

### Resultado REAL — mezcla semántico + keyword

Query vector = `doc-0` (`[1,0,0,0,0,0,0,0]`); query text = `"zafiro"` (keyword que **solo** tiene `doc-3`, cuyo vector es **ortogonal** al query → score vector 0.0).

```
pure vector search:  doc-0:1.0  doc-1:0.9949  doc-2:0.0  doc-3:0.0   <- doc-3 NO aparece arriba
pure BM25 search:    doc-3:1.0907                            <- solo doc-3

HYBRID RRF:          doc-3:0.0320  doc-0:0.0164  doc-1:0.0161  doc-2:0.0159   <- doc-3 TOP
HYBRID weighted 0.5/0.5: doc-0:0.5  doc-3:0.5  doc-1:0.497  doc-2:0.0
HYBRID weighted 0.2/0.8: doc-3:0.8  doc-0:0.2  doc-1:0.199  doc-2:0.0        <- texto domina
```

**Confirmado:** un doc que matchea por texto pero no por vector **sube al top** en RRF y en weighted cuando `textWeight` es alto. RRF siempre lo hace subir (rank fusion); weighted lo sube solo si `textWeight` le da peso (con 0.5/0.5 empata con el top vectorial porque su BM25 normalizado = 1.0).

### Persistencia (archivos + cross-proceso)

- **Archivos en disco** (colección `docs`, dim 8, 4 docs):
  - `docs.bin` 128 B (= 4·8·4, Float32 contiguo) — del **store**
  - `docs.json` 106 B — manifest del store
  - `docs.bm25.json` 402 B — del **BM25**
- **Adapter para BM25**: se pasa un `FileStorageAdapter` construido sobre el **mismo directorio** del store. No es "el adapter del store" (el store no expone su adapter público); se crea uno propio apuntando al mismo dir. BM25 escribe `<col>.bm25.json` ahí.
- **Cross-proceso (proceso NUEVO, `.spike2/01-hybrid-reload.js`):** **SÍ persiste.**
  - `store` se autorecarga al acceder (count=4).
  - `bm25` **requiere `bm25.load(adapter, col)` explícito** (no autorecarga). Tras load, count=4 y hybrid search idéntico al proceso original.
  - Resultado tras reload idéntico: `doc-3:0.0320, doc-0:0.0164, doc-1:0.0161, doc-2:0.0159`.

### SYNC — `remove` y BM25

- **`bm25.removeDocument(col, id)` EXISTE y funciona** (verificado: `typeof === 'function'`; tras remover `doc-3`, count=3 y `bm25.search('zafiro')` → `[]`).
- `addDocument` tiene semántica **upsert**: si el id ya existe, lo remueve antes de reinsertar (línea 1851). Re-upsertar un doc con texto nuevo no duplica.
- **Implicación nodo**: en `Delete`, además de `store.remove(col,id)+flush()`, llamar `bm25.removeDocument(col,id)` + `bm25.save(adapter,col)`. En `Upsert`, `store.set` + `bm25.addDocument` + `store.flush()` + `bm25.save()`. **No hace falta rebuild del BM25** — el sync es incremental y barato.

### Limitaciones

- `bm25.save()` **no flushea el store**; son persistencias independientes. El nodo debe llamar ambas.
- `bm25.load()` es **por colección** y **manual** (no se autodescubre al construir `BM25Index`). El nodo debe saber qué colecciones tienen BM25 y cargarlas al iniciar (o cargar lazy antes de una hybrid search).
- `fetchK` (default `max(limit*3,50)`) controla cuántos candidatos del vector search se fusionan. Con `limit` chico y `fetchK` default, docs fuera del top-vector pero con texto pueden igual entrar (RRF los añade desde BM25). Para weighted, los docs **fuera del fetchK vectorial** se añaden con `textWeight·normBm25` (línea 2099-2103) → también aparecen. OK.
- Hybrid **no soporta `filter`** (no pasa filter al store.search interno). Si se necesita filtro + híbrido, el nodo debe post-filtrar el resultado fusionado.

---

## 2. IVF — build, search, persistencia

### Firmas EXACTAS verificadas

```js
new IVFIndex(store, numClusters = 100, numProbes = 10)       // store: VectorStore | Quantized* (no Polar/Binary verificado)
ivf.build(col, sampleDims = 128) -> { numClusters, numVectors }   // expensive; K-means Float64
ivf.search(col, query, limit = 5) -> [{ id, score, metadata }]    // COSINE-ONLY (cosineSim hardcodeado)
ivf.hasIndex(col) -> bool
ivf.dropIndex(col)                                              // borra <col>.ivf.json
ivf.indexStats(col) -> { numClusters, numProbes } | null
ivf.matryoshkaSearch(col, query, limit=5, stages=[128,256,384])
```

- **`search` es cosine-only por firma**: `search(col, query, limit=5)` — **no acepta `metric`**. Pasar args extra (`...,'euclidean'`) **no throw, se ignoran** y sigue computando `cosineSim`. No hay modo de pedir euclidean/dot/manhattan en IVF.
- **Mapeo a ids del store**: `search` devuelve `{id, score, metadata}` con `id = entry.ids[idx]` y `metadata = entry.meta[idx]` del store. El mapeo idx→id es interno; el nodo recibe ids y metadata listos.

### Snippet mínimo (`.spike2/02-ivf-write.js`)

```js
const store = new VectorStore(DIR, 64);
// ...poblar N vectores...
store.flush();
const ivf = new IVFIndex(store, 50, 10);   // numClusters=50, numProbes=10
ivf.build(COL, 64);                        // sampleDims=64 (dim completa)
const res = ivf.search(COL, query, 10);    // [{id, score, metadata}]
```

### Resultado REAL — N=2000, dim 64, 10 clusters tight (datos clusterizados)

| métrica | valor |
|---|---|
| `build()` | **241.6 ms** (50 clusters, 2000 vecs, dim 64) |
| brute search top-10 | 0.2379 ms/query |
| IVF search top-10 | 0.2427 ms/query |
| **recall@10** | **1.0000** |
| speedup vs brute | **0.98x** (≈ ninguno a N=2000) |
| archivo índice | `vecs.ivf.json` 68 874 B |

**Lectura honesta:** a N=2000 dim 64 el brute-force ya es muy rápido (~0.24 ms) y IVF **no acelera** (el overhead de lookup + heap come el ahorro de saltar clusters). IVF sólo paga su coste a **N más grande** y con `numProbes` bajo. El spike previo ya mostró que el **speedup real aparece a ≥10k** y que el **build se vuelve prohibitivo** (22s@10k, 468s@50k, inviable a 50k/1536). El caso de uso de IVF es **read-heavy sobre colecciones grandes**; no tiene sentido en colecciones pequeñas.

### Persistencia cross-proceso (`.spike2/02-ivf-reload.js`)

- **Archivo:** `<col>.ivf.json` (centroids + assignments + sampleDims + numClusters + numProbes), escrito por `store._adapter.writeJson` en el **mismo dir del store**.
- **Cross-proceso SIN rebuild:** **SÍ**. Proceso nuevo: `new VectorStore(DIR,64)` (autorecarga) + `new IVFIndex(store, 50, 10)` → `ivf.hasIndex(COL)` → `true` (carga el `.ivf.json` vía `_loadIndex` lazy en el primer `search`). `indexStats` devuelve `{numClusters:50, numProbes:10}`. Search funciona sin llamar `build()`.
- `numClusters`/`numProbes` del ctor **sólo importan para `build()`**. En reload, `numProbes` se lee del `.ivf.json` para `search` (vía `indexStats` y `_getCandidates`); el del ctor se usa si el archivo no trae el valor. Recomendado: pasar los mismos valores en reload para coherencia.

### Limitaciones

- **Cosine-only** (firmado arriba). Brute-force sí soporta 4 métricas; IVF no.
- **`build()` es caro** y crece rápido (O(K·N·dim·iter), 20 iter max). No ejecutar por operación de search. Operación explícita.
- **No soporta `filter`** en search. Filtros → post-filtrar en el nodo.
- `build()` flushea el store internamente si hay pending (línea 1564), pero **no reescribe el store**; sólo lee. Seguro.
- El índice **se invalida** tras inserts/removes posteriores al build (los `assignments` quedan desactualizados). El nodo debe re-build tras writes masivos, o advertir que el índice es un snapshot. No hay reindex incremental.

---

## 3. CUANTIZACIÓN — Int8, Binary, vs Float32

### Firmas EXACTAS verificadas

```js
new QuantizedStore(dirOrAdapter, dim = 768, opts = {})         // Int8 -> <col>.q8.bin / <col>.q8.json
new BinaryQuantizedStore(dirOrAdapter, dim = 768, opts = {})   // 1-bit -> <col>.b1.bin / <col>.b1.json
new PolarQuantizedStore(dirOrAdapter, dim = 768, opts = {})    // 3-bit -> <col>.p3.bin / <col>.p3.json  (no testeado aquí)
// API idéntica a VectorStore: set/get/remove/drop/flush/count/ids/collections/stats/
// search(col,query,limit=5,dimSlice=0,metric='cosine',filter=null), matryoshkaSearch, searchAcross, import/export
```

- `Function.length` reporta 1 porque `dim` y `opts` tienen defaults (JS cuenta params hasta el primer default). La firma real es `(dirOrAdapter, dim=768, opts={})` — confirmado en fuente (líneas 578, 815, 1130).
- `QuantizedStore.prototype.set`/`search` existen → **misma superficie que VectorStore**.

### Resultado REAL — N=2000, dim 64, clustered (recall@10 vs Float32 brute)

| Store | disco | compresión | ms/query | recall@10 |
|---|---|---|---|---|
| Float32 (`docs.bin`) | 541.9 KB | 1x (ref) | 0.2155 | 1.0000 |
| **Int8** (`docs.q8.bin`) | 182.5 KB | **2.97x** | 1.3931 | **0.8240** |
| Binary 1-bit (`docs.b1.bin`) | 57.5 KB | **9.42x** | 0.0887 | **0.0700** |

- **Int8**: ~3x disco, recall 82.4% (no 99% como en el spike previo). La diferencia es el dataset: aquí clusters **tight** (ruido ±0.025) con recall@10 — los errores de cuantización Int8_flip near-tied rankings dentro de un cluster. Con embeddings reales (más separados) el recall sube; el dato real aquí es **82%**. **Más lento** que Float32 (1.39 ms vs 0.22 ms) por overhead de dequant por vec en cada search.
- **Binary**: 9.4x disco, recall **7%** (catastrófico en clusters tight dim 64). El signo de 64 floats pierde casi toda la estructura. Sólo útil con dim muy alta (768/1536) donde 1-bit type still separa. No recomendado como default.

### Persistencia cross-proceso

- **Archivos:** `<col>.q8.bin/json` (Int8), `<col>.b1.bin/json` (Binary). Mismo manifest pattern que Float32.
- **Cross-proceso (simulado reabriendo mismo dir):** **SÍ**. `new QuantizedStore(DIR,64)` → count=2000, search top-1 OK. `new BinaryQuantizedStore(DIR,64)` → count=2000, search OK. Autorecarga como VectorStore.

### DECISIÓN: clases ALTERNATIVAS — `indexType` es por-store

**SÍ, son alternativas, no modos mezclables.** Un store se instancia como `VectorStore` **O** `QuantizedStore` **O** `BinaryQuantizedStore` **O** `PolarQuantizedStore`. No hay `setQuantization()` en runtime; el tipo se fija al construir y determina los archivos en disco (`<col>.bin` vs `<col>.q8.bin` vs `<col>.b1.bin`). Una colección dada vive bajo un solo formato.

**Implicación diseño nodo:** el `indexType` (float32 / int8 / binary) es una **elección por base de datos / credencial**, no por operación. Debe ir en la **credencial** (junto al `dir` y `dim`), porque el motor con el que se instancian todos los stores de esa credencial depende de él. Mezclar tipos en el mismo `dir` funciona a nivel archivos (sufijos distintos) pero el nodo debe instanciar el constructor correcto según el `indexType` declarado — y validar que la colección que se accede fue creada con ese tipo (abrir un `<col>.q8.bin` con `VectorStore` no lo encuentra → count 0 / colección "vacía" silenciosa).

### Limitaciones

- Int8 **más lento** en search (dequant por vec) — no es gratis; es trade disco+recall por velocidad (y pierde velocidad a dim baja).
- Binary recall **muy malo** a dim baja/mediana; sólo justifica a dim alta.
- No hay migración Float32↔Int8 in-place; cambiar de tipo = reinsertar todo.
- IVF **puede** construirse sobre `QuantizedStore` (el `build()` lo soporta, dequantiza a Float64, líneas 1577-1591), pero no sobre Polar/Binary sin pasar por dequant (también soportado, 1569-1576). IVF sobre cuantizado = build más caro.

---

## 4. MATRYOSHKA + searchAcross (rápido)

### Firmas EXACTAS

```js
store.matryoshkaSearch(col, query, limit = 5, stages = [128, 384, 768], metric = 'cosine') -> [{id, score, metadata}]
store.searchAcross(collections, query, limit = 5, metric = 'cosine') -> [{id, score, metadata}]
```

### Resultado REAL (`.spike2/04-matryoshka-across.js`, dim 8, 2 colecciones)

```
matryoshkaSearch('c1', q, 2, [4,8], 'cosine') -> [ 'a:1.000', 'b:0.994' ]   // stages funcionan con dims < default
searchAcross(['c1','c2'], q, 3, 'cosine') ->
   {"id":"d","score":1,"metadata":{"src":"c2"}}
   {"id":"a","score":1,"metadata":{"src":"c1"}}
   {"id":"c","score":1,"metadata":{"src":"c2"}}
```

- `matryoshkaSearch`: cascade por stages (descarta por dims parciales, keepN decreciente). Trivial de exponer: par `stages` opcional (default `[128,384,768]` — **advertir**: el default supone dim 768; para dim 8/384/1536 el usuario debe pasar stages acordes o se clampa con `Math.min(stages[s], dim)`).
- `searchAcross`: **normaliza score min-max por colección** y fusiona en un top-K global. **NO etiqueta `collection`** en el resultado (sólo `{id, score, metadata}`). El nodo debe inyectar la colección en `metadata` antes de buscar, o añadirla al resultado, si el usuario necesita saber de qué colección viene cada hit.

### Limitaciones

- `searchAcross` pierde el origen (colección) del resultado salvo que esté en metadata.
- `matryoshkaSearch` default stages son para dim 768; con otra dim hay que pasar stages explícitos.

---

## 5. RECOMENDACIÓN DE DISEÑO para v1.1.0 del nodo

Criterio: **viable y limpio** = integración directa, baja superficie de bug, coherente con el modelo de persistencia (flush + cross-proceso). **Frágil** = depende de que el usuario haga step manual, o de invariantes que el motor no valida.

### 5.1 Hybrid Search — **viable y limpio, diferenciador fuerte**

- **Operación nueva `Hybrid Search`** (resource: search, operation: hybrid) con:
  - `vector` (obligatorio), `text` (obligatorio), `limit`, `mode` (`rrf` | `weighted`), y en weighted `vectorWeight`/`textWeight` (0-1, suma libre — el motor no normaliza los pesos), `rrfK` (default 60), `fetchK` (default `max(limit*3,50)`), `metric` (default cosine, se pasa al store.search interno).
- **Persistencia BM25 implícita:** el nodo mantiene un `BM25Index` por colección cuando el usuario activa hybrid. En **Upsert**, además de `store.set`+flush, llamar `bm25.addDocument(col,id,text)`+`bm25.save`. En **Delete**, `bm25.removeDocument`+save. En **startup** de una operación hybrid, `bm25.load(adapter,col)` lazy si no está en memoria.
  - ⚠️ Requiere que **Upsert tenga un campo `text` opcional**. Si el usuario quiere hybrid, debe suministrar texto en cada upsert. Si no hay texto, no se indexa BM25 para ese doc (hybrid lo excluye del lado textual).
  - ⚠️ **Frágil si se omite**: si el nodo flushea el store pero olvida `bm25.save`, el BM25 se pierde al reinicio. El wrapper debe tratar ambas persistencias como atómicas en escritura.
- **Limitación a documentar**: hybrid **no soporta `filter`**. Si el usuario combina filtro + híbrido, post-filtrar el resultado fusionado en el nodo (y subir `limit`/`fetchK` para compensar).

### 5.2 IVF ANN — **viable pero con UX de costo, no automático**

- **Operación nueva `Build ANN Index`** (acción explícita) con `numClusters`, `numProbes`, `sampleDims`. **Aviso de costo en `description`**: "Build es O(K·N·dim); puede tardar minutos a >10k vectores. Ejecutar sólo en colecciones read-heavy."
- **Opción `useIndex: boolean` en `Search`** (default false → brute-force). Si true y existe `<col>.ivf.json`, usa `IVFIndex.search`; si no existe índice, **error claro** ("no hay índice IVF, llamá a Build ANN Index") — no silent fallback a brute, para no confundir al usuario sobre qué se ejecutó.
- **Operación `Drop ANN Index`** (`ivf.dropIndex`) y mostrar `indexStats` en una operación `Stats`/`Collections`.
- **Limitaciones a documentar**: cosine-only (ignorar `metric` si useIndex=true, o invalidar la opción), no soporta filter, índice es snapshot (re-build tras writes masivos), sin speedup a colecciones pequeñas (<~5k).
- **Frágil si**: el nodo re-buildea automáticamente. **Nunca** auto-build.

### 5.3 Cuantización — **viable, `indexType` en la credencial**

- **Campo `indexType` en la credencial** (junto a `dir` y `dim`): `float32` (default) | `int8` | `binary` | `polar3`. El wrapper instancia `VectorStore` / `QuantizedStore` / `BinaryQuantizedStore` / `PolarQuantizedStore` según ese valor.
- **Validación necesaria**: al abrir una colección existente, verificar que los archivos en disco corresponden al `indexType` declarado (ej. si `indexType=int8` pero no existe `<col>.q8.bin` y sí `<col>.bin`, avisar "la colección fue creada con otro indexType"). Sin esto, count=0 silencioso.
- **Default `float32`**: Int8 pierde recall y velocidad a dim baja; binary sólo a dim alta. No forzar cuantización por defecto.
- **Limitaciones a documentar**: cambio de tipo = reinsertar; Int8 search más lento a dim baja; binary recall malo a dim < 768.

### 5.4 Matryoshka / searchAcross — **triviales de exponer, viables**

- **`Matryoshka Search`** como operación (o opción `matryoshka: true` en Search) con `stages` (array de ints, default `[128,384,768]`). Advertir que el default supone dim 768.
- **`Search Across`** como operación con `collections` (multi-select / array), `limit`, `metric`. Documentar que el resultado **no incluye la colección de origen** salvo que el usuario la guarde en metadata.

### 5.5 Síntesis de viabilidad

| Feature | Viabilidad | Recomendación |
|---|---|---|
| Hybrid Search | **Limpio** (con `text` en Upsert + persistencia BM25 atómica) | Operación nueva + campo `text` opcional en Upsert. Diferenciador. |
| IVF ANN | **Limpio si es explícito**; frágil si auto-build | Op `Build ANN Index` + `useIndex` en Search. Aviso de costo. |
| Cuantización | **Limpio** como elección por-credencial | `indexType` en credencial + validación de coherencia disco. Default float32. |
| Matryoshka | **Trivial** | Operación/opción con `stages`. |
| searchAcross | **Trivial** | Operación con `collections`. Documentar ausencia de `collection` en output. |

### 5.6 Invariantes no negociables que el wrapper ya debe cumplir (reconfirmados)

- `flush()` tras toda escritura (store). Para hybrid, **además `bm25.save()`**.
- `bm25.load(adapter,col)` explícito en reload (no autorecarga).
- Validación de `dim` estricta (la lib corrompe silencioso — spike previo §8).
- `limit >= 1` (la lib crashea con limit=0 — spike previo §8).
- IVF: no auto-build, no `metric` (cosine-only), no `filter`.
- `indexType` coherente con los archivos en disco.

---

## 6. Código del spike (referencia)

En `.spike2/`:
- `01-hybrid-write.js` / `01-hybrid-reload.js` — hybrid end-to-end + sync (removeDocument) + persistencia cross-proceso.
- `02-ivf-write.js` / `02-ivf-reload.js` — IVF build/search/timing/recall + persistencia sin rebuild.
- `03-quant.js` — Int8/Binary vs Float32: disco, recall, cross-proceso, firmas.
- `04-matryoshka-across.js` — matryoshkaSearch + searchAcross firmas.

Datos de test en `.spike2/data-*` (desechables).