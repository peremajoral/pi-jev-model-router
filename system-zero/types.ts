/**
 * system-zero types — capa-0 bajo el juez Jev.
 *
 * needle clasifica y estructura; NUNCA aprueba gates ni muta. Si su confianza
 * calibrada no llega al umbral (fijado EMPÍRICAMENTE por el EVAL, nunca
 * heredado del umbral de Jev), si se niega (empty calls), o si no está
 * disponible, la decisión sube al puerto Jev existente. Si Jev también falla,
 * el fail-closed de cada consumidor sigue intacto: este módulo no lo toca.
 */

/** A tool schema as the engine consumes it (raw JSON-schema dict). */
export interface NeedleTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Case-insensitive regexes: a matching request always produces a call, even below the confidence floor. */
  triggers?: string[];
}

/** A toolset plus its system facts identify one engine session; keep them stable to stay warm. */
export interface Toolset {
  /** Stable identifier: one engine per key. */
  key: string;
  tools: NeedleTool[];
  /** Environment FACTS ("locale: es-ES"), never instructions. */
  system?: string;
}

export interface NeedleCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** The engine's own envelope, unchanged (needle.server returns it plus a `server` object). */
export interface NeedleEnvelope {
  type: "call" | "respond";
  success?: boolean;
  error?: string | null;
  error_code?: string | null;
  function_calls?: NeedleCall[];
  suppressed_calls?: NeedleCall[];
  reasoning?: string;
  /** Calibrated score in [0,1]; null when the loaded weights have no confidence head (never true for the pinned base). */
  confidence?: number | null;
  validation?: { ungrounded?: string[]; negation?: boolean };
  peak_ram_mb?: number;
  prefill_tps?: number;
  decode_tps?: number;
}

/** How a transport can fail; every failure mode ends in the Jev branch, never in a guessed answer. */
export type NeedleFailure =
  | { kind: "unavailable" } // runner not installed, crashed, or the spawn failed
  | { kind: "rejected" } // the engine refused the tool schemas (exit 2)
  | { kind: "deadline" } // the engine did not answer in time; the runner is killed
  | { kind: "oversize"; chars: number } // input over MAX_INPUT_CHARS: never sent, never cut
  | { kind: "invalid_toolset"; reason: string };

export type NeedleOutcome =
  | { ok: true; envelope: NeedleEnvelope }
  | { ok: false; failure: NeedleFailure };

/** Mode B: each tool owns its runner (child process, private port, no auth, no shared state). */
export interface ChildTransportOptions {
  bin: string;
  weights: string;
  /** Where tools/system temp files and stub artifacts live. Default: <repo>/system-zero/state */
  stateDir?: string;
  /** sha256 pins; checked once per transport before the first spawn. Default: PINNED from limits.ts. */
  pins?: { bin?: string; weights?: string };
  spawnTimeoutMs?: number;
  /** Per-request deadline; the runner is killed on overrun. Default: REQUEST_DEADLINE_MS (5 s). */
  requestDeadlineMs?: number;
  idleStopMs?: number;
  /** Test hook: override the spawn command (first element is the binary). */
  command?: (toolsPath: string, systemPath: string, port: number) => string[];
}

/** Mode C: needle.server behind a private-network gateway; the toolset travels with each request. */
export interface HttpTransportOptions {
  baseUrl: string;
  deadlineMs?: number;
}

/** Why the decision went where it went. Auditability over silence. */
export type EscalationReason =
  | "threshold" // needle answered but below the calibrated umbral
  | "refusal" // needle's empty function_calls: it says the input is not its job
  | "oversize" // input over the 2000-char hard limit; never sent to needle
  | "empty_input"
  | "invalid_toolset"
  | "deadline" // the engine did not answer in time; its runner was killed
  | "rejected" // the engine refused the tool schemas (exit 2)
  | "unavailable" // needle could not run at all (missing, crashed, hash mismatch)
  | "no_confidence"; // the envelope had no calibrated score (weights without the head)

export interface SystemZeroResult<TJev> {
  /** The origin for the pilots' audit field: `determinista` is written by consumers' fast-paths, never here. */
  origin: "needle" | "jev";
  /** needle's first call (null on refusal or escalation). */
  call: NeedleCall | null;
  /** All calls when needle answered several (run them in order); empty otherwise. */
  calls: NeedleCall[];
  /** needle's calibrated score, when it answered. */
  confidence: number | null;
  /** The full envelope for logs and EVAL; never the basis of a silent decision. */
  raw?: NeedleEnvelope;
  /** Why it escalated to Jev, when it did. */
  reason?: EscalationReason;
  /** The Jev verdict, when the decision went to the judge. */
  jev?: TJev;
}

export interface CompleteOptions {
  input: string;
  toolset: Toolset;
  /** Calibrated per consumer by the EVAL (jev-4y5.13). NOT Jev's threshold. */
  threshold: number;
}