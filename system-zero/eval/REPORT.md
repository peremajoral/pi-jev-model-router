# EVAL — needle vs Jev sobre datos nuestros (jev-4y5.13)

Decisión que responde: **¿puede needle ser la capa-0 de clasificación de algún
consumidor, y con qué umbral?** La respuesta se mide contra etiquetas, no contra
intuición (regla de la skill jev). Umbrales de needle **no** se heredan de Jev:
su head de confianza está calibrada para tool-calling.

Arnés: `run-eval.ts` corre **el cliente real** (`SystemZero`: gate, lectura de
`suppressed_calls`, escalado por ambigüedad) y, con `--jev`, la **misma pregunta
que produce el consumidor en producción** contra `api.typesafe.ai/v1/systemone`.
Métrica principal del híbrido: `systemAccuracy` = needle acierta cuando actúa, o
escala y acierta Jev. `falsos confiado-altos` = llamada equivocada con confianza
≥ umbral: la que nunca llega a Jev.

## Resultados (bancos en `banks/`, fuentes documentadas por línea)

| Consumidor | casos | needle acierta | Jev acierta | acuerdo | cobertura needle | falsos confiado-altos | ¿adopta? |
|---|---|---|---|---|---|---|---|
| **sayago** (action de parte laboral) | 42 | **31.4%** | 45.2% | 25.7% | 83% | 24 (≥0.50) | **NO** |
| **altas-ss** (clase de fallo de entrega) | 20 | **0.0%** | 35.0% | 0.0% | 95% | 19 | **NO** |
| **router** (task_kind de la petición) | 60 | **9.1%** | 43.3% | 5.5% | 88% | 48 | **NO** |
| **find** (candidato correcto, 2 opciones) | 17 | **0.0%** | **100%** | 0.0% | 59% | 6 | **NO** |

Conclusión: **ningún consumidor adopta needle**. En los cuatro, el híbrido
needle-first (`systemAccuracy` en el mejor umbral) es **peor o igual que Jev
solo**, y needle responde con confianza alta estando equivocado en decenas de
casos. El `--jev` del router y de sayago confirma que el juez actual acierta más
que needle incluso viendo el texto crudo.

## Lo que sí se ha aprendido (queda escrito para no repetirlo)

1. **needle clasifica por acto de habla, no por clase.** "Alta laboral de José"
   no es una orden: needle elige `request_information` (pedir datos) con 0.99.
   Es un modelo de tool-calling: acierta cuando la petición *pide una acción* y
   los argumentos están literalmente en el texto.
2. **El gate de grounding tira las clases abstractas.** Un enum cuyo valor no
   aparece en el texto va a `suppressed_calls` (con `function_calls` vacío). Hay
   que leerlo (`acceptSuppressed`), pero hacerlo no lo hace acertar: mide mal.
3. **No copia valores literalmente.** En find, con las dos rutas escritas en el
   input, devolvió `"BudgetLimits"`, `"stableIds"`, `"Latest"` en vez de una
   ruta. Jev acertó 17/17.
4. **La latencia es real pero irrelevante si la respuesta es mala**: needle 60-530 ms
   contra Jev 307-320 ms. El ahorro de coste no compensa perder la decisión.

## Consecuencia para el programa (`jev-4y5`)

- `4y5.7` (router needle-first), `4y5.8` (stanley needle etapa-1), `4y5.11`
  (sayago), `4y5.12` (altas-ss): **no se activan**. Quedan cerrados como "no
  adopta" con este informe.
- `4y5.10` (needle.server en VPS): sin consumidor que lo use, no se despliega.
- Lo que **sí** reduce coste sin tocar la calidad y ya está en marcha: caché de
  veredictos (`4y5.3`: 42.653 → 0 tokens en el re-run idéntico), ledger+rollup de
  coste (`4y5.6`) y caps mecánicos/destilado de estado (`4y5.4`).

## Limitaciones del EVAL (honestas)

- Los bancos son pequeños (17-60 casos) y las etiquetas son la política revisada
  de cada app (documentada en cada línea) o anotación del agente para el router;
  no son ground truth de negocio a gran escala. Para una adopción sí lo serían.
- El estado que se envía a Jev es el texto crudo, no la proyección saneada de
  producción: el EVAL mide capacidad de clasificación, no el pipeline completo.
- `altas-ss` etiqueta motivos que la tabla determinista ya resuelve; en producción
  esos no llegan a Jev. Mide la comparación, no el ahorro del fast-path.
- Un solo modelo de herramienta por consumidor; diseños alternativos (4 tools de
  acción, extracción con enum, input imperativo) se sondearon en
  `probe-framing.ts` y el mejor fue 31%.

Reproducir: `node system-zero/eval/run-eval.ts <sayago|altas-ss|router|find> --jev --out <dir>`.
