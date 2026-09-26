# Competidores de Jev (TypeSafe System One) y de Needle (Cactus, on-device) — 2026-09-26

**Método.** Cada afirmación va con fuente fetchada hoy (URL al final). Cuando algo es contexto
conocido y no lo he podido verificar por fetch, va marcado `[sin verificar]`. Las cifras propias de
needle salen del EVAL medido en `system-zero/eval/REPORT.md` (no de folletos).

**Qué es cada uno, para fijar el eje de comparación**
- **Jev / System One**: servicio de juicio. Le mandas un `state` + preguntas **tipadas**
  (`choice` con criterios, `score` por niveles, `noul`) y devuelve, por pregunta, etiqueta/nivel +
  `confidence`. El veredicto lo deriva **código** (`agent-jev/nucleo/juicio.mjs`), con umbral de
  confianza y caps deterministas; fail-closed (sin clave → error, nunca `pass`).
- **Needle**: modelo on-device de 29–121M con tool-calling nativo, cabezas de `confidence` y de
  grounding (`suppressed_calls`), ~84–112 ms y ~92 MB de RAM medidos en la Mac; runner nativo
  local (modo B) verificado, checksums pineados.

---

## Parte 1 — Competidores de Jev

### 1.A Plataformas de evaluación con "LLM-as-a-judge" (competencia directa por función)

| Producto | Qué es | Diferencia clave con Jev |
|---|---|---|
| **Braintrust / Autoevals** | Librería de evals con LLM-as-a-judge + heurísticas + estadísticos (BLEU…), adaptada de OpenAI evals | El juez es **un prompt tuyo** que devuelve un número/texto libre. Sin primitivas tipadas, sin validación estricta, sin confianza calibrada, sin veredicto derivado en código |
| **DeepEval + Confident AI** | Framework de evaluación estilo pytest (GEval, faithfulness, relevancy…), SaaS Confident AI | Igual: *métricas* de calidad, no un contrato de veredicto; tú eliges y pagas el modelo juez |
| **promptfoo** | Red-teaming + asserts de eval (`llm-rubric`) en CI | Foco en test de prompts, no en gate de artefactos con fail-closed |
| **LangSmith / Arize Phoenix / W&B Weave / Galileo** | Observabilidad + evals con jueces LLM | Plataforma pesada; el juicio no es un primitivo embebible ni tipado |

**Lectura**: esta categoría es *scaffolding*. Te da el cómo preguntar, no la disciplina de qué es una
respuesta válida. Con Jev, una respuesta fuera de los criterios ofrecidos **muere** (juez caído); con
estos frameworks, un score de 0.7 en prosa se te cuela como verdad.

### 1.B Modelos juez especializados

| Producto | Datos verificados | Diferencia |
|---|---|---|
| **Prometheus 2** | 7B y 8×7B, base Mistral-Instruct, fine-tune sobre 100K Feedback + 200K Preference; grading absoluto **y** pairwise; apache-2.0 | Modelo juez open y bueno, pero salida = score + rationale; sin primitivas tipadas ni confianza calibrada por pregunta; necesita GPU para servir |
| **Patronus (Lynx 8B + API)** | El sitio se anuncia como "Simulating the World's Intelligence"; la model card de Lynx-8B en HF está **gated** (no verificable hoy) `[sin verificar: capacidades]` | Es el análogo comercial más cercano: evaluación como servicio + guardrails. Mismo hueco: juez genérico, no contrato tipado |
| **JudgeLM / Skywork-Critic / ArmoRM** | Jueces/reward models fine-tuned `[sin verificar hoy]` | Compiten por "juzgar con un modelo abierto", no por el contrato de decisión |
| **GPT-4o/claude como juez** | Práctica estándar de la industria | Es el competidor real por defecto: caro, en la nube, y sin garantías de forma salvo que le montes el tipado tú |

**Ventaja de Jev aquí**: juicio **tipado y validado**, con `confidence` por pregunta y veredicto
derivado en código. **Desventaja**: servicio propietario; Prometheus/Lynx te los puedes auto-hospedar.

### 1.C Guardrails, validación y "contrato tipado DIY"

| Producto | Datos verificados | Relación con Jev |
|---|---|---|
| **Guardrails AI** | Framework Python de Guards de entrada/salida + generación de datos estructurados. Aviso propio (jul-2026): validadores pasan a PyPI estándar y **se discontinúa la inferencia remota hospedada** (corte 25-ago-2026) | El re-ask al LLM para cumplir un schema es el primo caro de "código valida, juez responde". El propio mercado hosted se está apagando |
| **NVIDIA NeMo Guardrails** | Rails programables (Colang) | Guardrail conversacional, no veredicto de artefacto |
| **Llama Guard / ShieldGemma** | Clasificadores de política | Especialistas de seguridad, no jueces generales; sin confianza calibrada por dimensión |
| **Outlines / XGrammar / llama.cpp GBNF / instructor** | Decodificación restringida por gramática/schema | **Esto es el "DIY Jev"**: garantizan la FORMA sobre cualquier modelo. Lo que no dan es la semántica ni la confianza. Nuestro EVAL lo demuestra: el problema de needle no era el formato, era el juicio |

### 1.D Revisión de código como juez (el caso de uso de agent-jev)

| Producto | Datos verificados | Diferencia |
|---|---|---|
| **CodeRabbit** | "AI-first pull request reviewer with context-aware feedback, line-by-line code suggestions, and real-time chat" | Juez de PR integrado en GitHub/GitLab; opinión en comentarios, no un veredicto tipado embebible en tu gate |
| **PR-Agent** | Repo `The-PR-Agent/pr-agent` (13.153★; el path viejo `QodoAI/pr-agent` da 404 — el proyecto se movió): "The Original Open-Source PR Reviewer" | Open source, auto-hospedable, pero igual: revisión en prosa/etiquetas |
| **Greptile / Copilot code review** | Productos comerciales `[sin verificar hoy]` | Contexto de repo completo; siguen sin contrato de decisión ni fail-closed |
| **Incumbentes deterministas: Semgrep, CodeQL, linters** | — | Para "¿este diff rompe algo?" lo barato y determinista ya existe; la filosofía de Jev ("el código filtra primero") es exactamente esto |

### 1.E Dónde gana/pierde Jev

| Eje | Jev | La competencia |
|---|---|---|
| Salida tipada con criterios validados | ✅ (falla cerrado si el juez se sale) | ❌ (prosa/score libre) |
| Confianza calibrada por pregunta + umbral | ✅ | ❌ (a lo sumo logprobs) |
| Veredicto derivado en código, no en el prompt | ✅ (medido: la pregunta compuesta fallaba donde las atómicas acertaban) | ❌ |
| Fail-closed real | ✅ | ❌ (típicamente fail-open a score) |
| Auto-hospedaje / elección de modelo | ❌ | ✅ |
| Ecosistema, PRs, dashboards | ❌ | ✅ |
| Coste por juicio | Servicio (60,25M tokens de entrada acumulados en stanley) | Prometheus/Lynx on-prem; frameworks = pagas tu propio modelo |

**Conclusión Jev**: su foso no es "juzgar" (todos juzgan) sino el **contrato**: tipado + validación +
confianza + veredicto en código + fail-closed. Lo replicable hoy es la forma (gramáticas), no la
disciplina de decisión. Los competidores que más se le acercan son **Patronus** (comercial) y
**Prometheus 2** (open) — ninguno entrega el contrato completo.

---

## Parte 2 — Competidores de Needle

### 2.A Modelos pequeños con function-calling nativo

| Modelo | Params | Licencia | Datos verificados | vs needle |
|---|---|---|---|---|
| **Hammer 2.1-0.5b** (MadeAgents) | 0.5B | cc-by-nc-4.0 (no comercial) | Base Qwen2.5-Coder-0.5B; datasets xLAM function-calling; evaluado en BFCL-v3; **integrado en Google AI Edge / MediaPipe (function calling on-device en Android, jun-2025)** | El competidor más directo: ~4-10× más params, mucha más semántica, **pero 0.5B no son 92 MB**: otro orden de RAM/latencia, y licencia NC |
| **Qwen3-0.6B** | 0.6B | apache-2.0 | "agent capabilities… precise integration with external tools"; thinking/no-thinking conmutable | Tool-calling generalista fuerte; sin cabeza de confianza; ~1 GB en cuantización |
| **Granite 4.0-H-Micro** (IBM) | 3B | apache-2.0 | "improved instruction following and tool-calling"; schema OpenAI | Calidad enterprise, pero 3B: fuera de la liga de needle |
| **SmolLM3-3B** (HF) | 3B | apache-2.0 | Multilingüe, entrenado con datos de function calling | 3B |
| **Llama 3.2 1B/3B** | 1B/3B | Llama license | Tool calling vía template `[sin verificar hoy]` | 1B+ |
| **Salesforce xLAM-1b-fc-r** | 1B | `[sin verificar]` | Existe en HF (5.1k descargas) | 1B |
| **Functionary small** (MeetKai) | 8B ("small") | — | `meetkai/functionary-small-v3.2` en HF | 8B: no es la misma categoría |

**Lo único de needle en este cuadro**: 29–121M, ~92 MB, ~100 ms, tool-calling + **cabeza de
confianza calibrada** + grounding (`suppressed_calls`). Nadie más en la tabla da confianza nativa a
ese tamaño. Pero — medido en nuestro EVAL — esa ventaja **no produjo precisión**: 31,4% / 0% / 9,1% /
0% vs Jev 45,2% / 35% / 43,3% / 100% en sayago, altas-ss, router y find.

### 2.B Plataformas on-device y runtimes

| Producto | Datos verificados | Nota |
|---|---|---|
| **Apple Foundation Models** | Doc oficial (fetchada): "Perform tasks with models that specialize in language understanding, **structured output**, and **tool calling**"; el artículo de Apple describe el modelo **~3B on-device** + modelo servidor con Private Cloud Compute | El competidor más serio para tu Mac: gratis, local, tipado por *guided generation*, con tool calling. Pero ~3B (no 92 MB), framework Apple, y sin confianza calibrada |
| **Google Gemini Nano / Android AICore** | On-device Android `[sin verificar hoy]` | Fuera de tu stack |
| **Cactus Engine** (los de needle) | "Hybrid edge-cloud AI engine for mobile devices & wearables", APIs compatibles OpenAI para texto/voz/visión, con Cactus Graph/Kernels/Quants | No es competidor de needle: **es su envoltorio comercial** |
| **llama.cpp / Ollama / MLX / ExecuTorch** | llama.cpp: gramáticas **GBNF** y server; Ollama: API con `tools` y `tool_calls` (docs fetchadas) | El camino "DIY capa-0": modelo pequeño + runtime + gramática. Más RAM y latencia que needle, pero ecosistema y control total |

### 2.C Decodificación restringida (el "formato garantizado" sin needle)

**XGrammar** (usado por SGLang y llama.cpp), **Outlines**, **GBNF**, **instructor**, **LM Format
Enforcer**. Dan salida con forma garantizada sobre cualquier modelo. Nuestro EVAL demuestra que
**no es el cuello de botella**: needle ya devolvía JSON válido; lo que fallaba era el juicio
(devolvió `"BudgetLimits"`, `"stableIds"`, `"Latest"` donde Jev acertó 17/17).

### 2.D Sustitutos económicos del "carril barato"

| Vía | Por qué compite |
|---|---|
| **Clasificador fino (DistilBERT/miniLM/regresión sobre embeddings)** | Para enums fijos (p. ej. `task_kind` del router, 60 casos etiquetados ya en el banco): latencia sub-ms, probabilidad real, gratis. Es el competidor honesto que no probamos |
| **Cloud barato (Cloudflare Workers AI con function calling — docs verificadas; Flash-Lite/4o-mini/Groq)** | Para tu stack Cloudflare, "capa-0" puede ser el edge a céntimos en vez de un modelo local a 0 € pero con peor juicio |
| **Regex/triggers deterministas** (lo que needle.server llama *triggers*) | Un fast-path determinista no necesita modelo |

---

## Parte 3 — Mapa de amenazas para TU stack, en una página

1. **Jev no está amenazado por "juzgar con LLM"** — eso ya lo haces con Jev y mide mejor que la
   alternativa pequeña. Lo que sí amenaza su coste: (a) los caps mecánicos y la caché (ya
   entregados: 42.653 → **0 tokens** en re-juicio idéntico); (b) para el caso "juzga mi diff",
   CodeRabbit/PR-Agent cubren el 80% funcional **pero sin contrato** — y ninguno es fail-closed.
2. **La lección del EVAL se generaliza**: el formato lo replica cualquiera (gramáticas); el juicio y
   la confianza no. Cualquier candidato "capa-0" se mide **con banco etiquetado antes de producción**.
3. **Para el router, el candidato serio no es needle**: es un **clasificador fino de `task_kind`**
   (enums fijos, 60 casos etiquetados disponibles) y/o un modelo 0.5B (Hammer) con gramática. Antes
   de eso: arreglar el mapeo del router (bead `jev-xyy`: la señal `deepReasoning` es inerte en
   0.2–0.65 y la penalización nunca cambia de tier).
4. **Para on-device Mac**, el rival real de needle es **Apple Foundation Models** (~3B, guided
   generation, tool calling, gratis, privado). Probar si su `structured output` da la precisión que
   needle no dio — con el banco del EVAL — es la única comparación que falta.
5. **Needle se queda donde está** (system-zero implementado y pineado, modos A/B/C): disponible si
   aparece un caso con banco que lo justifique, sin tocar producción mientras no lo haga.

## Fuentes fetchadas (2026-09-26)
- Autoevals: https://raw.githubusercontent.com/braintrustdata/autoevals/main/README.md
- DeepEval: https://raw.githubusercontent.com/confident-ai/deepeval/main/README.md
- Prometheus 2: https://huggingface.co/prometheus-eval/prometheus-7b-v2.0/raw/main/README.md
- Guardrails AI (aviso jul-2026): https://raw.githubusercontent.com/guardrails-ai/guardrails/main/README.md
- CodeRabbit: https://www.coderabbit.ai · PR-Agent: https://api.github.com/repos/qodo-ai/pr-agent → `The-PR-Agent/pr-agent`
- OpenRouter: https://openrouter.ai · Not Diamond: https://www.notdiamond.ai
- RouteLLM: https://raw.githubusercontent.com/lm-sys/RouteLLM/main/README.md
- Cactus: https://raw.githubusercontent.com/cactus-compute/cactus/main/README.md
- Hammer2.1-0.5b: https://huggingface.co/MadeAgents/Hammer2.1-0.5b/raw/main/README.md
- Qwen3-0.6B: https://huggingface.co/Qwen/Qwen3-0.6B/raw/main/README.md
- Granite 4.0-H-Micro: https://huggingface.co/ibm-granite/granite-4.0-h-micro/raw/main/README.md · SmolLM3-3B: https://huggingface.co/HuggingFaceTB/SmolLM3-3B/raw/main/README.md
- Apple: https://machinelearning.apple.com/research/introducing-apple-foundation-models · framework: https://developer.apple.com/tutorials/data/documentation/foundationmodels.json
- Ollama (tools): https://raw.githubusercontent.com/ollama/ollama/main/docs/api.md · llama.cpp (GBNF): https://raw.githubusercontent.com/ggml-org/llama.cpp/master/README.md
- Cloudflare Workers AI function calling: https://developers.cloudflare.com/workers-ai/features/function-calling/
- Evidencia propia: `system-zero/eval/REPORT.md` (needle vs Jev por consumidor)
