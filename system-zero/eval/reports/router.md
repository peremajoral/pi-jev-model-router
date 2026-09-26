# EVAL — router

Casos: 60 · needle respondió: 55 · Jev respondió: 60

| | acierto sobre lo respondido |
|---|---|
| needle | 9.1% |
| Jev | 43.3% |
| acuerdo needle–Jev | 5.5% |

Latencia media: needle 81 ms · Jev 324 ms

## Barrido de umbral

| umbral | cobertura | acierto al responder | falsos confiado-altos | systemAccuracy | escala a Jev |
|---|---|---|---|---|---|
| 0.50 | 88.3% (53/60) | 9.4% | 48 | 10.0% | 7 |
| 0.60 | 85.0% (51/60) | 9.8% | 46 | 11.7% | 9 |
| 0.70 | 78.3% (47/60) | 10.6% | 42 | 13.3% | 13 |
| 0.80 | 76.7% (46/60) | 10.9% | 41 | 15.0% | 14 |
| 0.85 | 73.3% (44/60) | 11.4% | 39 | 18.3% | 16 |
| 0.90 | 66.7% (40/60) | 12.5% | 35 | 18.3% | 20 |
| 0.95 | 61.7% (37/60) | 13.5% | 32 | 23.3% | 23 |

## Matriz de confusión (needle)

| etiqueta \ needle | chat | debug | explain | implement | operate | plan | research | review |
|---|---|---|---|---|---|---|---|---|
| chat | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| debug | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| explain | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| implement | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 8 |
| operate | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| plan | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 3 |
| research | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| review | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
