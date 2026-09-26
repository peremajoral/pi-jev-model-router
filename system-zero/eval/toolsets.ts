/**
 * Bank toolsets for the EVAL. Each one restates the consumer's task the way
 * needle is designed to be used: ONE TOOL PER ACTION, named the way a user
 * would say it. That is not a detail — a single `clasificar_evento` tool with an
 * enum sends the enum value as an UNGROUNDED argument (needle withholds it) and
 * makes the tool name the only clue, which measured 8% accuracy. Four action
 * tools let needle pick by meaning, which is what it is trained to do.
 *
 * The production Jev question is carried verbatim so the comparison is the
 * consumer's own question, not a paraphrase.
 */

import type { NeedleTool, Toolset } from "../types.ts";
import type { ChoiceQuestion } from "./jev.ts";

export interface BankSpec {
  toolset: Toolset;
  /** Which argument carries the label; "$name" means the tool's own name is the class. */
  answerKey: string;
  /** Classification into an enum: read needle's withheld call (grounding gate). */
  acceptSuppressed: boolean;
  jev: ChoiceQuestion;
  /** Jev state builder when the consumer's state is not the raw text (the router sends JSON). */
  stateFor?: (input: string) => string;
  /** Where the labels come from. Documented per the bead's acceptance criteria. */
  source: string;
}

/** A no-argument action tool: the call cannot be ungrounded, so nothing is withheld. */
function action(name: string, description: string): NeedleTool {
  return { name, description, parameters: { type: "object", properties: {}, required: [] } };
}

const sayagoTools: NeedleTool[] = [
  action(
    "route_to_gestoria",
    "Enviar a la gestoría un parte de personal explícito: un alta, una baja o unas vacaciones.",
  ),
  action(
    "route_to_payroll",
    "Enviar a nóminas un parte explícito de nómina (payroll), con su importe o periodo si aparecen.",
  ),
  action(
    "request_information",
    "El evento no trae el dato imprescindible (fecha, persona, tipo); hay que pedir esa información.",
  ),
  action(
    "needs_review",
    "El evento es ambiguo, mezcla varios tipos o no encaja en ninguna acción; una persona debe revisarlo.",
  ),
];

const altasTools: NeedleTool[] = [
  action("recuperar_pdf", "El PDF del justificante se puede recuperar del almacén y la entrega reintentar."),
  action(
    "anotar_cancelacion",
    "Existe constancia de cancelación del alta: dejar el borrador y anotarlo en la ficha del artista.",
  ),
  action(
    "revision_humana",
    "El circuito no puede resolverlo solo con un reintento; una persona debe revisarlo a mano.",
  ),
];

/** The router's task kinds, verbatim from config.ts TASK_KINDS. */
const TASK_KINDS: Record<string, string> = {
  plan: "Deciding what to build, sequencing work, or designing an approach before editing",
  implement: "Writing or changing code, scripts, or configuration to produce a concrete result",
  write: "Producing prose, documentation, comments, or other non-code content from scratch",
  debug: "Diagnosing a failure, error, or unexpected behavior and finding its root cause",
  refactor: "Restructuring existing code without changing intended behavior",
  review: "Auditing code, a diff, a document, or a plan for problems and risks",
  research: "Searching, reading, and synthesizing external information or unfamiliar APIs",
  explain: "Answering a question or explaining how something works",
  operate: "Running commands, tooling, git, deploys, or environment setup",
  chat: "Small talk, acknowledgements, or a request with no real work attached",
};

const routerTools: NeedleTool[] = Object.entries(TASK_KINDS).map(([kind, description]) => action(kind, description));

const findTools: NeedleTool[] = [
  {
    name: "elegir_archivo",
    description: "Elige el candidato que implementa exactamente lo que pide la tarea.",
    parameters: {
      type: "object",
      properties: { archivo: { type: "string", description: "Ruta del candidato elegido, copiada literalmente del input" } },
      required: ["archivo"],
    },
  },
];

export const TOOLSETS: Record<string, BankSpec> = {
  router: {
    toolset: {
      key: "eval_router",
      tools: routerTools,
      system: "locale: es-ES; assistant: clasificador del tipo de trabajo que pide una petición",
    },
    answerKey: "$name",
    acceptSuppressed: true,
    jev: {
      key: "task_kind",
      instructions:
        "Which single kind of work does `request` ask for? Judge the work the user wants done, not the topic they mention. Pick the closest kind even when the request is ambiguous.",
      criteria: TASK_KINDS,
    },
    // Same state shape the production router sends (buildState in jev.ts).
    stateFor: (input) =>
      JSON.stringify({
        request: input,
        conversation_excerpt: null,
        environment: { cwd: null, active_model: null, context_tokens_used: null },
        budget: {
          spent_today_usd: 0,
          spent_this_month_usd: 0,
          daily_cap_usd: null,
          monthly_cap_usd: null,
          fraction_of_budget_used: 0,
        },
      }),
    source:
      "prompts reales de sesiones pi, etiquetados por el agente segun TASK_KINDS de extensions/pi-jev-model-router/config.ts",
  },
  find: {
    toolset: {
      key: "eval_find",
      tools: findTools,
      system: "locale: es-ES; assistant: juez de relevancia de candidatos para una busqueda de codigo",
    },
    answerKey: "archivo",
    acceptSuppressed: true,
    jev: { key: "candidato", instructions: "placeholder", criteria: {} },
    // Per case: the two candidate paths are the choice.
    jevFor: (input) => {
      const paths = [...input.matchAll(/Candidato [AB] \(([^)]+)\)/g)].map((match) => match[1]!);
      return {
        key: "candidato",
        instructions: "Elige el candidato que implementa exactamente lo que pide la tarea.",
        criteria: Object.fromEntries(paths.map((path) => [path, `El fichero ${path} implementa lo que pide la tarea.`])),
      };
    },
    source: "stanley-code src/ (commit f65d3c8): tarea derivada del rol del fichero + excerpts reales (12 lineas)",
  },
  sayago: {
    toolset: {
      key: "eval_sayago_v2",
      tools: sayagoTools,
      system: "locale: es-ES; device: webhook; assistant: clasificador de eventos laborales",
    },
    answerKey: "$name",
    acceptSuppressed: true,
    // The production question, verbatim from src/classification.ts.
    jev: {
      key: "action",
      instructions: "Choose exactly one action for this verified event.",
      criteria: {
        needs_review: "The report is ambiguous or requires human review.",
        request_information: "Required information is missing; ask for it.",
        route_to_gestoria: "Route an explicit personnel report to the gestoría.",
        route_to_payroll: "Route an explicit payroll report to payroll.",
      },
    },
    source: "sayago src/classification.ts (reglas + deterministicAction) y src/classification.test.ts",
  },
  "altas-ss": {
    toolset: {
      key: "eval_altas_ss_v2",
      tools: altasTools,
      system: "locale: es-ES; assistant: clasificador de fallos de entrega de justificantes",
    },
    answerKey: "$name",
    acceptSuppressed: true,
    jev: {
      key: "resolucion",
      instructions: "Elige una sola clase para esta fila de fallo de entrega.",
      criteria: {
        recuperable_pdf: "El PDF se puede recuperar y la entrega reintentar.",
        registro_cancelacion: "Existe constancia de cancelación; dejar el borrador y anotarlo.",
        terminal_humano: "El circuito no puede resolverlo solo; revisión humana.",
      },
    },
    source:
      "musibal-cloudflare workers/altas-ss/src/jev-clasificar-fallo.ts (TABLA de motivos medidos 2026-09-21) y su test",
  },
};