# Plan: independencia de pi-jev-model-router respecto al upstream oficial

## Contexto y problema

- La extensión está instalada como `npm:pi-jev-model-router` (entrada en
  `~/.pi/agent/settings.json` → `packages`), materializada en
  `~/.pi/agent/npm/node_modules/pi-jev-model-router` (v0.3.0).
- `~/.pi/agent/npm/package.json` declara `"pi-jev-model-router": "^0.3.0"` (rango caret).
- El upstream oficial (`da-vinci-noob/pi-jev-model-router`) publicó **0.5.0 en npm**
  (2026-09-28). Cualquier `pi update --extensions` resolvería `^0.3.0` → 0.5.0
  y **sobrescribiría** la copia parcheada de node_modules.
- La copia de node_modules es idéntica al HEAD del fork propio
  `peremajoral/pi-jev-model-router` (ad2ffe6, verificado fichero a fichero):
  round-robin `rotationCursor` en router.ts, key `rotation` en config,
  flag `fallback` en entradas de routes, `tiers.ts`. Ninguna de las tres
  features existe en upstream 0.5.0 (upstream tiene `priority` #8, xpremium
  #10, free pool #3 — mecanismos distintos).
- El fork local está **8 commits por delante de origin/main** (no empujado).

## Objetivo

Que la extensión instalada provenga SOLO del fork propio, de forma que
`pi update --extensions` nunca pueda traer código del upstream oficial, y que
las customizaciones (rotación, fallback flag, winnow jev) no se pierdan.

## Pasos

0. **Decisiones previas (F4)**: la sintaxis de `pi install` soporta refs en fuentes
   git (`parseGitUrl` con `@ref`, verificado en el bundle de pi). Se decide:
   - Instalar desde rama dedicada `release` del fork (creada en ad2ffe6), NO desde
     `main`: la fuente git trackea HEAD de la rama instalada, así los pushes a
     `main` (desarrollo) nunca despliegan solos; solo moviendo `release` se
     actualiza la extensión, y siempre con código nuestro.
   - Pin adicional por tag: `git:github.com:peremajoral/pi-jev-model-router@v0.3.0-fork`
     si pi lo resuelve; si no, la rama `release` es el pin.
   - Corregir `repository.url` y `version` del package.json del fork al tagear
     (minor, aprobado por Stanley como no bloqueante).

1. **Empujar el fork** (protección de trabajo):
   `git push origin main` en `/Users/pere/proyectos/pi-jev-model-router`
   (ad2ffe6 → origin/main).
2. **Tagear y crear rama release**: `git tag v0.3.0-fork ad2ffe6` + push del tag;
   `git branch release ad2ffe6` + push de la rama.
3. **Quitar la fuente npm**:
   - `pi remove npm:pi-jev-model-router` (o `pi uninstall`), lo que debe limpiar
     la entrada en settings.json y la dependencia en `~/.pi/agent/npm/package.json`.
   - Verificar que `~/.pi/agent/npm/node_modules/pi-jev-model-router` ya no se
     resuelve desde npm.
4. **Instalar desde el fork por git**:
   `pi install git:github.com:peremajoral/pi-jev-model-router` (checkout en
   `~/.pi/agent/git/...`).
   - El updater de pi para fuentes git compara HEAD local contra HEAD del
     remote **del propio repo instalado** (verificado en el bundle de pi:
     `gitHasAvailableUpdate` usa `git ls-remote origin HEAD` del checkout).
     Con origin = peremajoral, el upstream da-vinci-noob jamás entra.
   - Pinned opcional con `@v0.3.0-fork` si pi soporta ref en la fuente.
5. **Verificación post-instalación**:
   - La extensión carga: `/jev-router` responde; rutas quick/standard/high/premium
     con `fallback: true` se respetan; `rotation: ["quick"]` activa el round-robin.
   - Tests del fork pasan: `npm test` (14 suites).
   - `~/.pi/agent/npm/package.json` ya no contiene pi-jev-model-router.
   - `pi list` muestra la extensión con fuente git peremajoral.
6. **Respaldo documental**: los `.bak-orig`/`.bak.*` dentro de node_modules se
   pierden al desinstalar; son redundantes (contenido == fork HEAD o upstream
   0.3.0 original) pero se copian a `investigaciones/` antes del paso 3.
7. **Rollback (F3/R5)**: si el paso 4 (install) falla tras el paso 3 (remove),
   restaurar inmediatamente con `pi install /Users/pere/proyectos/pi-jev-model-router`
   (checkout local) o re-añadiendo la entrada npm. El swap se ejecuta FUERA de
   cualquier sesión viva que dependa de la extensión.
8. **Tests de la extensión (F1)**: `node --test extensions/pi-jev-model-router/*.test.ts`
   (router.test.ts: decide()/rotation/fallback; jev.test.ts) — NO basta `npm test`,
   que solo ejecuta system-zero/system-zero.test.ts. La cifra "14 suites" de los
   backups es imprecisa: contar los tests reales al ejecutar.

## Criterios de aceptación

- AC1: `~/.pi/agent/settings.json` no contiene `npm:pi-jev-model-router`; sí
  una fuente git del fork peremajoral.
- AC2: `~/.pi/agent/npm/package.json` no tiene la dependencia
  pi-jev-model-router.
- AC3: `pi update --extensions` ya no puede sustituir la extensión por código
  del upstream oficial (la fuente rastreada es solo peremajoral).
- AC4: `rotationCursor` (round-robin), flag `fallback` y key `rotation` siguen
  presentes y operativos en la extensión instalada.
- AC5: fork empujado a origin/main con tag v0.3.0-fork.
- AC6: tests de la EXTENSIÓN en verde tras la reinstalación:
  `node --test extensions/pi-jev-model-router/*.test.ts` (router + jev),
  ejecutados sobre el checkout instalado.
- AC7: el checkout git instalado satisface `git rev-parse HEAD` == ad2ffe6
  (o el tag v0.3.0-fork), y `git -C <checkout> remote -v` no muestra ninguna
  URL de da-vinci-noob.
- AC8: demostración explícita de AC3: `pi update --extensions` reporta no-op
  (nada disponible) tras la instalación.

## Riesgos y mitigaciones

- R1: pi remove podría eliminar también preferencias. Mitigación: backup de
  settings.json y pi-jev-model-router.json antes (hay .bak previos de todos modos).
- R2: checkout git podría quedar en ref mobile (main). Aceptable: origin es el
  fork propio; solo nosotros publicamos ahí. Tag pin como endurecimiento.
- R3: sintaxis `git:github.com:user/repo` sin protocolo — usar la forma literal
  del `pi install --help` (`git:github.com/user/repo`).
- R4: config activa (`~/.pi/agent/pi-jev-model-router.json`) es externa al
  paquete y no debe tocarse.
- R5: hueco operativo remove→install (ver paso 7: rollback + swap fuera de
  sesión viva).