# EVAL — sayago

Casos: 42 · needle respondió: 35 · Jev respondió: 42

| | acierto sobre lo respondido |
|---|---|
| needle | 31.4% |
| Jev | 47.6% |
| acuerdo needle–Jev | 22.9% |

Latencia media: needle 72 ms · Jev 323 ms

## Barrido de umbral

| umbral | cobertura | acierto al responder | falsos confiado-altos | systemAccuracy | escala a Jev |
|---|---|---|---|---|---|
| 0.50 | 83.3% (35/42) | 31.4% | 24 | 31.0% | 7 |
| 0.60 | 78.6% (33/42) | 33.3% | 22 | 35.7% | 9 |
| 0.70 | 78.6% (33/42) | 33.3% | 22 | 35.7% | 9 |
| 0.80 | 76.2% (32/42) | 34.4% | 21 | 38.1% | 10 |
| 0.85 | 73.8% (31/42) | 35.5% | 20 | 40.5% | 11 |
| 0.90 | 71.4% (30/42) | 36.7% | 19 | 40.5% | 12 |
| 0.95 | 66.7% (28/42) | 35.7% | 18 | 38.1% | 14 |

## Matriz de confusión (needle)

| etiqueta \ needle | needs_review | route_to_gestoria | route_to_payroll |
|---|---|---|---|
| needs_review | 0 | 1 | 0 |
| route_to_gestoria | 0 | 3 | 0 |
| route_to_payroll | 0 | 0 | 0 |
