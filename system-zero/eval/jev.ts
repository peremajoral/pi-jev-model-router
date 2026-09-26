/**
 * Minimal raw Jev client for the EVAL (jev-4y5.13).
 *
 * Same contract sayago's production requestSystemOne uses — POST
 * https://api.typesafe.ai/v1/systemone with {state, model, questions} — so the
 * comparison is against the SAME judge the consumers call, not a proxy. No SDK
 * dependency: the EVAL runs under plain node.
 */

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";

export interface ChoiceQuestion {
  /** The answer key inside `answers` (e.g. "action"). */
  key: string;
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevVerdict {
  choice: string | null;
  confidence: number | null;
  latencyMs: number;
  error?: string;
}

export async function askJev(
  input: string,
  question: ChoiceQuestion,
  options: { apiKey?: string; model?: string; timeoutMs?: number } = {},
): Promise<JevVerdict> {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY?.trim();
  const startedAt = Date.now();
  if (!apiKey) return { choice: null, confidence: null, latencyMs: 0, error: "missing_api_key" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        state: input,
        model: options.model ?? "jev-latest",
        questions: {
          [question.key]: { type: "choice", instructions: question.instructions, criteria: question.criteria },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { choice: null, confidence: null, latencyMs: Date.now() - startedAt, error: `http_${response.status}` };
    }
    const payload = (await response.json()) as { answers?: Record<string, { choice?: string; confidence?: number }> };
    const answer = payload.answers?.[question.key];
    return {
      choice: typeof answer?.choice === "string" ? answer.choice : null,
      confidence: typeof answer?.confidence === "number" ? answer.confidence : null,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      choice: null,
      confidence: null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.name : "request_error",
    };
  } finally {
    clearTimeout(timer);
  }
}