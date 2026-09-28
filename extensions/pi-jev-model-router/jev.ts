import type { JevRouterConfig } from "./config";
import { TASK_KINDS } from "./kinds.ts";
import type { SpendSnapshot } from "./budget";

/**
 * Typed judgments asked of the judge for a single incoming request.
 *
 * Design note: the judge judges the *task* (what it is, how hard it is, how much
 * capability it deserves). Code judges *budget* (what we can afford right now).
 * Keeping those separate means the budget policy can change without invalidating
 * the judgment, and the judgment stays a pure semantic read of the request.
 *
 * The judge itself is a cascade of local models (`winnow:e4b` → `laya:latest`
 * → `nli:latest` by default): the next model is consulted only when the
 * current one fails (server down, timeout, billing errors like TypeSafe 402) or
 * answers with low kind confidence — the "if necessary" case.
 */

export interface RouteAnalysis {
  kind: string;
  kindConfidence: number;
  kindProbabilities: Record<string, number>;
  /** Probability-weighted 0..3 position on the complexity rubric. */
  complexity: number;
  complexityConfidence: number;
  /** Probability-weighted 0..3 position on "capability this deserves". */
  budgetIntensity: number;
  budgetIntensityConfidence: number;
  /** Probability this request needs extended reasoning rather than recall/short edits. */
  deepReasoning: number;
  latencyMs: number;
  /** Judge model that actually answered: the primary, or the fallback that won. */
  judgeModel: string;
  /** True when the winning answer came from a fallback model, not the primary. */
  escalated: boolean;
  /** Audit note when the cascade consulted more than one judge. */
  escalationNote?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface ClassifyInput {
  prompt: string;
  history?: string;
  cwd?: string;
  activeModel?: string;
  contextTokens?: number;
  spend: SpendSnapshot;
}

export class JevError extends Error {
  readonly status?: number;

  constructor(
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

function buildState(input: ClassifyInput): Record<string, unknown> {
  return {
    request: input.prompt,
    conversation_excerpt: input.history?.slice(-4000) ?? null,
    environment: {
      cwd: input.cwd ?? null,
      active_model: input.activeModel ?? null,
      context_tokens_used: input.contextTokens ?? null,
    },
    budget: {
      spent_today_usd: input.spend.today,
      spent_this_month_usd: input.spend.month,
      daily_cap_usd: input.spend.dailyCap ?? null,
      monthly_cap_usd: input.spend.monthlyCap ?? null,
      fraction_of_budget_used: input.spend.pressure,
    },
  };
}

function buildQuestions(): Record<string, unknown> {
  return {
    task_kind: {
      type: "choice",
      instructions:
        "Which single kind of work does `request` ask for? Judge the work the user wants done, not the topic they mention. Read `conversation_excerpt` when the request is a short follow-up that only makes sense in context. Pick the closest kind even when the request is ambiguous.",
      criteria: TASK_KINDS,
    },
    complexity: {
      type: "score",
      instructions:
        "How hard is `request` to do well, judged only on the work itself? Use the conversation excerpt and environment to judge scope. Ignore how much any model costs.",
      criteria: [
        "Trivial: one obvious step, no design decisions, answer is known or mechanical",
        "Moderate: a few dependent steps using familiar patterns, little ambiguity",
        "Complex: multiple files or interacting constraints, real tradeoffs to weigh",
        "Architectural: cross-cutting design, high stakes, long horizon, easy to get subtly wrong",
      ],
    },
    capability_deserved: {
      type: "score",
      instructions:
        "Setting price aside entirely, how much model capability does this request deserve to get a good outcome? Judge by stakes, difficulty, and how much a stronger model would measurably improve the result.",
      criteria: [
        "Minimal: any fast small model answers this just as well",
        "Standard: a competent mid-tier model is enough",
        "High: a strong frontier model materially improves the outcome",
        "Maximum: correctness matters more than cost; use the best available",
      ],
    },
    needs_deep_reasoning: {
      type: "noul",
      instructions:
        "Does answering `request` well require extended multi-step reasoning (algorithm design, subtle debugging, proof, careful long-horizon planning) rather than recall, lookup, or a short direct edit?",
      criteria: {
        true: "The work hinges on reasoning through non-obvious steps or edge cases",
        false: "The work is recall, lookup, formatting, or a short direct change",
      },
    },
  };
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseAnalysis(payload: unknown, latencyMs: number, model: string): RouteAnalysis {
  const root = payload as { answers?: Record<string, any>; usage?: { input_tokens?: number; output_tokens?: number } };
  const answers = root.answers ?? {};
  const kind = answers.task_kind ?? {};
  const complexity = answers.complexity ?? {};
  const capability = answers.capability_deserved ?? {};
  const reasoning = answers.needs_deep_reasoning ?? {};

  const chosenKind = typeof kind.choice === "string" ? kind.choice : "chat";
  if (!(chosenKind in TASK_KINDS)) {
    throw new JevError(`Jev returned an unknown task kind: ${chosenKind}`);
  }

  return {
    kind: chosenKind,
    kindConfidence: num(kind.confidence) ?? 0,
    kindProbabilities: (kind.probabilities ?? {}) as Record<string, number>,
    complexity: num(complexity.score) ?? 1,
    complexityConfidence: num(complexity.confidence) ?? 0,
    budgetIntensity: num(capability.score) ?? 1,
    budgetIntensityConfidence: num(capability.confidence) ?? 0,
    deepReasoning: num(reasoning.noul) ?? num(reasoning.noul_score) ?? 0,
    latencyMs,
    judgeModel: model,
    escalated: false,
    usage:
      root.usage && num(root.usage.input_tokens) !== undefined
        ? { input_tokens: root.usage.input_tokens ?? 0, output_tokens: root.usage.output_tokens ?? 0 }
        : undefined,
  };
}

async function postWithRetry(
  config: JevRouterConfig,
  apiKey: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal.aborted) throw new JevError("aborted");
    try {
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (res.status === 429 || res.status === 529) {
        throw new JevError(`TypeSafe overloaded (${res.status})`, res.status);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new JevError(`TypeSafe ${res.status}: ${detail.slice(0, 300)}`, res.status);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (error instanceof JevError && error.status !== 429 && error.status !== 529) throw error;
      if (signal.aborted) throw new JevError("aborted");
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new JevError("TypeSafe request failed");
}

/** Ask one judge model; returns the typed analysis or throws JevError. */
async function askModel(
  model: string,
  state: Record<string, unknown>,
  questions: Record<string, unknown>,
  config: JevRouterConfig,
  apiKey: string,
  externalSignal?: AbortSignal,
): Promise<RouteAnalysis> {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = externalSignal ? AbortSignal.any([timeout, externalSignal]) : timeout;
  const started = Date.now();
  const payload = await postWithRetry(config, apiKey, { state, model, questions }, signal);
  return parseAnalysis(payload, Date.now() - started, model);
}

/**
 * Run one evaluation with the judge cascade.
 *
 * Models are consulted in order — the primary (`jevModel`), then
 * `judgeFallbacks` — and the most confident kind answer wins:
 *
 * - a model that fails (server down, timeout, billing error like TypeSafe 402)
 *   is skipped and the cascade moves on;
 * - a model that answers with `kindConfidence` below
 *   `escalateBelowConfidence` is kept as candidate, but the next model is also
 *   consulted ("if necessary"); the best-confidence answer wins;
 * - the first answer that clears the floor short-circuits the cascade.
 *
 * All models live on the same `endpoint`: a fallback is a different model, not
 * a different server.
 */
export async function classifyRequest(
  input: ClassifyInput,
  config: JevRouterConfig,
  apiKey: string,
  externalSignal?: AbortSignal,
): Promise<RouteAnalysis> {
  const models = [config.jevModel, ...(config.judgeFallbacks ?? [])];
  const state = buildState(input);
  const questions = buildQuestions();
  const floor = config.escalateBelowConfidence ?? 0;

  let best: RouteAnalysis | undefined;
  let answered = 0;
  let failures = 0;
  let lastError: unknown;

  for (const model of models) {
    if (externalSignal?.aborted) throw new JevError("aborted");
    try {
      const analysis = await askModel(model, state, questions, config, apiKey, externalSignal);
      answered += 1;
      if (!best || analysis.kindConfidence > best.kindConfidence) best = analysis;
      if (best.kindConfidence >= floor) {
        best.escalated = best.judgeModel !== config.jevModel;
        if (best.escalated || answered > 1) {
          best.escalationNote =
            `cascade: ${best.judgeModel} answered (kind conf ${best.kindConfidence.toFixed(2)}); ` +
            `${answered} answered, ${failures} failed`;
        }
        return best;
      }
    } catch (error) {
      // Abort is the caller's call, not a judge failure: propagate immediately.
      if (error instanceof JevError && error.message === "aborted") throw error;
      failures += 1;
      lastError = error;
    }
  }

  if (best) {
    best.escalated = best.judgeModel !== config.jevModel;
    best.escalationNote =
      `below floor: ${answered} answered, ${failures} failed, none reached ${floor}; ` +
      `kept ${best.judgeModel} (kind conf ${best.kindConfidence.toFixed(2)})`;
    return best;
  }
  throw lastError instanceof Error ? lastError : new JevError("no judge answered");
}