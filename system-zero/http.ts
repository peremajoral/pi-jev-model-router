/**
 * Mode C transport: needle.server behind a private-network gateway.
 *
 * The contract is needle.server's own (llms.txt), which is upstream's envelope
 * plus a `server` object. The toolset travels with every request — the server
 * manages engine pools per toolset — and the same hard limits are enforced
 * CLIENT-side so a misconfigured server can never make us send what the engine
 * would misread. No auth by design: the URL must be a private-network address.
 *
 * This is the variant Workers and remote agents use; mode B users never load it.
 */

import {
  MAX_HISTORY_TURNS,
  MAX_INPUT_CHARS,
  MAX_SYSTEM_CHARS,
  MAX_TOOLS,
  MAX_TOOLS_CHARS,
  MAX_TOTAL_CHARS,
  REQUEST_DEADLINE_MS,
} from "./limits.ts";
import type { HttpTransportOptions, NeedleEnvelope, NeedleOutcome, Toolset } from "./types.ts";
import { sanitizeInput } from "./runner.ts";

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly deadlineMs: number;

  constructor(options: HttpTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.deadlineMs = options.deadlineMs ?? REQUEST_DEADLINE_MS;
  }

  private validate(toolset: Toolset, input: string, history: string[] = []): string | null {
    if (!Array.isArray(toolset.tools) || toolset.tools.length < 1) return "tools: at least one required";
    if (toolset.tools.length > MAX_TOOLS) return `tools: at most ${MAX_TOOLS}`;
    if (JSON.stringify(toolset.tools).length > MAX_TOOLS_CHARS) return `tools: over ${MAX_TOOLS_CHARS} characters`;
    if (toolset.system && toolset.system.length > MAX_SYSTEM_CHARS) return `system: over ${MAX_SYSTEM_CHARS} characters`;
    if (history.length > MAX_HISTORY_TURNS) return `history: over ${MAX_HISTORY_TURNS} turns`;
    const replayed = Math.min(history.length, MAX_HISTORY_TURNS);
    const total = input.length + history.slice(history.length - replayed).reduce((sum, turn) => sum + turn.length, 0);
    if (total > MAX_TOTAL_CHARS) return `input+history: over ${MAX_TOTAL_CHARS} characters`;
    return null;
  }

  async complete(toolset: Toolset, input: string, history: string[] = []): Promise<NeedleOutcome> {
    const text = sanitizeInput(input);
    const invalid = this.validate(toolset, text, history);
    if (invalid) return { ok: false, failure: { kind: "invalid_toolset", reason: invalid } };
    if (text.length > MAX_INPUT_CHARS) return { ok: false, failure: { kind: "oversize", chars: text.length } };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deadlineMs);
    try {
      const response = await fetch(`${this.baseUrl}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text, tools: toolset.tools, system: toolset.system, history }),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status === 503 || response.status === 504) {
        return { ok: false, failure: { kind: "unavailable" } };
      }
      if (!response.ok) return { ok: false, failure: { kind: "unavailable" } };
      const envelope = (await response.json()) as NeedleEnvelope;
      if (envelope.error) return { ok: false, failure: { kind: "unavailable" } };
      return { ok: true, envelope };
    } catch {
      return { ok: false, failure: { kind: "deadline" } };
    } finally {
      clearTimeout(timer);
    }
  }

  async stop(): Promise<void> {
    // Stateless: nothing to stop.
  }
}