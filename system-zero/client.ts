/**
 * system-zero — la capa-0 bajo el juez Jev (jev-4y5.2).
 *
 * El cliente aplica el gate y ES dueño de una sola regla: needle decide qué NO
 * necesita Jev. Nada más. La secuencia de complete():
 *
 *   1. Input >2000 chars → Jev (nunca se envía a needle; jamás se corta).
 *   2. Transport (modo B: child process propio; modo C: fetch a needle.server).
 *      Cualquier fallo (binario ausente, checksum drift, crash, deadline,
 *      toolset rechazado) → Jev con su reason. Nunca un "mejor intento".
 *   3. needle se niega (function_calls vacío) → Jev. La negativa es válida
 *      (el input no es de este toolset) pero la decisión es del juez.
 *   4. confianza < umbral → Jev. El umbral lo fija el EVAL por consumidor;
 *      no se hereda del umbral de Jev porque la head de needle está calibrada
 *      para tool-calling, no son números comparables.
 *   5. confianza >= umbral → origin "needle", con el call y el raw enteros.
 *
 * Si Jev falla a su vez, la excepción sube sin tocar: el fail-closed de cada
 * consumidor (needs_review, jev_unavailable…) sigue siendo el suyo.
 */

import { MAX_INPUT_CHARS } from "./limits.ts";
import type {
  CompleteOptions,
  NeedleEnvelope,
  NeedleOutcome,
  SystemZeroResult,
  Toolset,
} from "./types.ts";

/** Either transport, same shape: one complete(), one stop(). */
export interface Transport {
  complete(toolset: Toolset, input: string): Promise<NeedleOutcome>;
  stop(): Promise<void>;
}

export type { ChildTransportOptions, HttpTransportOptions } from "./types.ts";
export { ChildTransport } from "./runner.ts";
export { HttpTransport } from "./http.ts";

export { PINNED, MAX_INPUT_CHARS } from "./limits.ts";
export type * from "./types.ts";

/**
 * The Jev port, as each consumer already has it: a function that takes the
 * input and returns ITS OWN verdict shape. system-zero is generic over it —
 * it never dictates the Jev request; the consumer's existing port is the port.
 */
export type JevFallback<TJev> = (input: string, context: { toolset: Toolset }) => Promise<TJev>;

export class SystemZero<TJev> {
  private readonly transport: Transport;
  private readonly jev: JevFallback<TJev>;

  constructor(transport: Transport, jev: JevFallback<TJev>) {
    this.transport = transport;
    this.jev = jev;
  }

  async complete(options: CompleteOptions): Promise<SystemZeroResult<TJev>> {
    const { input, toolset, threshold } = options;

    // 1. The hard limit: never sent, never cut. Half a command gives a confident wrong call.
    if (input.length > MAX_INPUT_CHARS) {
      return await this.escalate(input, toolset, "oversize", null, null);
    }
    if (input.trim().length === 0) {
      return await this.escalate(input, toolset, "empty_input", null, null);
    }

    // 2-3. Transport and refusal.
    const outcome = await this.transport.complete(toolset, input);
    if (!outcome.ok) {
      const kind = outcome.failure.kind;
      if (kind === "oversize") {
        return await this.escalate(input, toolset, "oversize", null, null);
      }
      if (kind === "invalid_toolset") {
        return await this.escalate(input, toolset, "invalid_toolset", null, null);
      }
      // Preserve why needle did not answer: an audit needs the cause, not just "not needle".
      if (kind === "deadline" || kind === "rejected") {
        return await this.escalate(input, toolset, kind, null, null);
      }
      return await this.escalate(input, toolset, "unavailable", null, null);
    }
    const envelope = outcome.envelope;
    const calls = envelope.function_calls ?? [];
    if (calls.length === 0) {
      return await this.escalate(input, toolset, "refusal", null, envelope);
    }

    // 4. The calibrated gate.
    if (typeof envelope.confidence !== "number" || envelope.confidence === null) {
      return await this.escalate(input, toolset, "no_confidence", null, envelope);
    }
    if (envelope.confidence < threshold) {
      return await this.escalate(input, toolset, "threshold", envelope.confidence, envelope);
    }

    // 5. needle's answer, fully auditable.
    return {
      origin: "needle",
      call: calls[0] ?? null,
      calls,
      confidence: envelope.confidence,
      raw: envelope,
    };
  }

  private async escalate(
    input: string,
    toolset: Toolset,
    reason: SystemZeroResult<TJev>["reason"],
    confidence: number | null,
    raw: NeedleEnvelope | null,
  ): Promise<SystemZeroResult<TJev>> {
    const jev = await this.jev(input, { toolset });
    return {
      origin: "jev",
      call: null,
      calls: [],
      confidence,
      raw: raw ?? undefined,
      reason,
      jev,
    };
  }

  /** Kill every runner (mode B); safe on mode C. */
  async stop(): Promise<void> {
    await this.transport.stop();
  }
}