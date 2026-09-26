# EVAL — find

Casos: 17 · needle respondió: 10 · Jev respondió: 17

| | acierto sobre lo respondido |
|---|---|
| needle | 0.0% |
| Jev | 100.0% |
| acuerdo needle–Jev | 0.0% |

Latencia media: needle 532 ms · Jev 330 ms

## Barrido de umbral

| umbral | cobertura | acierto al responder | falsos confiado-altos | systemAccuracy | escala a Jev |
|---|---|---|---|---|---|
| 0.50 | 35.3% (6/17) | 0.0% | 6 | 64.7% | 11 |
| 0.60 | 17.6% (3/17) | 0.0% | 3 | 82.4% | 14 |
| 0.70 | 11.8% (2/17) | 0.0% | 2 | 88.2% | 15 |
| 0.80 | 11.8% (2/17) | 0.0% | 2 | 88.2% | 15 |
| 0.85 | 11.8% (2/17) | 0.0% | 2 | 88.2% | 15 |
| 0.90 | 5.9% (1/17) | 0.0% | 1 | 94.1% | 16 |
| 0.95 | 5.9% (1/17) | 0.0% | 1 | 94.1% | 16 |

## Matriz de confusión (needle)

| etiqueta \ needle | adapters/config.ts | adapters/dependencies.ts | adapters/fake-jev.ts | adapters/jev.ts | adapters/recorder.ts | adapters/redact.ts | adapters/verdict-cache.ts | cli/judge.ts | cli/router.ts | core/budget.ts | core/executor.ts | core/frame.ts | core/hash.ts | core/questions.ts | core/validation.ts | workflows/common.ts | workflows/run.ts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| adapters/config.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adapters/dependencies.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adapters/fake-jev.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adapters/jev.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adapters/recorder.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adapters/redact.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| adapters/verdict-cache.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cli/judge.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cli/router.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| core/budget.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| core/executor.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| core/frame.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| core/hash.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| core/questions.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| core/validation.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| workflows/common.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| workflows/run.ts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
