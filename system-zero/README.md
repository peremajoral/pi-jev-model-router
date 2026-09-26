# system-zero — capa-0 bajo el juez Jev

`needle` clasifica y estructura. `Jev` juzga. **needle nunca aprueba un gate ni
muta nada**: decide qué NO necesita Jev. Si su confianza calibrada no llega al
umbral, si se niega, o si no está disponible, la decisión sube al puerto Jev que
cada consumidor ya tiene. Si Jev falla, el fail-closed de ese consumidor sigue
intacto — este módulo no lo toca.

Umbral: **lo fija el EVAL por consumidor** (`jev-4y5.13`). No se hereda del
umbral de Jev: la head de confianza de needle está calibrada para tool-calling
y los dos números no son comparables.

## Los tres modos, un solo contrato

| Modo | Transporte | Para |
|---|---|---|
| **A** — SDK Python (`pip install cactus-needle`) | `needle.Needle(tools=…).complete(text)` en proceso | consumidores Python (p. ej. musibal-robot). Fuera de este módulo TS. |
| **B** — runner nativo como child process | `ChildTransport` (este repo) | herramientas Node: stanley, agent-jev, el router. Cada herramienta es dueña de su runner; sin FastAPI, sin puerto compartido, sin auth. |
| **C** — `needle.server` tras un gateway privado | `HttpTransport` (este repo) | Workers y agentes remotos; el toolset viaja con cada request. |

El contrato de respuesta es el de upstream (`type`, `function_calls`,
`confidence`, `suppressed_calls`, `reasoning`), así que cambiar de modo es
cambiar el transporte: ni el gate ni el fallback se reescriben.

## Uso (modo B)

```ts
import { SystemZero, ChildTransport } from "./system-zero/client.ts";

const transport = new ChildTransport({
  bin: "system-zero/engine/needle",
  weights: "system-zero/engine/needle3.cact",
});
const sz = new SystemZero(transport, async (input, { toolset }) => {
  // El puerto Jev que YA tiene el consumidor; el shape del veredicto es suyo.
  return askJev(input);
});

const result = await sz.complete({ input, toolset, threshold: 0.85 });
// result.origin: "needle" | "jev"
// result.call / result.calls / result.confidence / result.raw
// result.reason: threshold | refusal | oversize | empty_input | invalid_toolset | unavailable | no_confidence
// result.jev: el veredicto del juez cuando la decisión fue suya

await sz.stop(); // mata todos los runners
```

## Límites duros (los mide el cliente, no se inventan)

Copiados de `needle.server` (`config.py`, `llms.txt`), que frontea el mismo
binario:

- `input` ≤ 2000 caracteres: por encima **no se envía a needle** (nunca se
  corta: media orden da una llamada confiada y equivocada) → Jev.
- `tools` 1–20, ≤ 32 000 caracteres de JSON; `system` ≤ 500 caracteres.
- deadline 5 s por petición; el runner que lo sobrepasa se mata y el siguiente
  request arranca uno nuevo.
- Un request por conexión (`agent: false`): el runner no honra
  `Connection: close` y Node reutilizaría el socket (ECONNRESET).
- JSON compacto y UTF-8 crudo: el parser del runner no lee `"input": ` con
  espacio ni decodifica `\uXXXX`; los caracteres de control se limpian antes.

## Pinning

`setup.sh` descarga el runner y los pesos de una **revisión fija** de Hugging
Face con `sha256` (misma disciplina que `setup.sh` de needle.server):

```sh
./system-zero/setup.sh   # engine/needle + engine/needle3.cact
```

`ChildTransport` **re-verifica los checksums** antes del primer arranque: un
binario o unos pesos cambiados significan que needle no corre y todo sube a
Jev. El pin está en `limits.ts` (`PINNED`), una sola fuente.

## Tests

```sh
node --test system-zero/system-zero.test.ts
```

`stub-runner.mjs` copia el contrato del runner real, incluidas sus rarezas de
parsing; la integración con el binario pineado corre si `setup.sh` se ha
ejecutado. Sin dependencias externas: solo `node:`.
