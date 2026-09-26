/**
 * EVAL harness (jev-4y5.13): run a labelled bank through needle and Jev and
 * print the report. The threshold each consumer should adopt comes from THESE
 * numbers, never from Jev's threshold and never from intuition.
 *
 *   node system-zero/eval/run-eval.ts <bank> [--jev] [--out <dir>]
 *
 * The needle side runs THE REAL CLIENT (SystemZero): gate, suppressed-call
 * handling, ambiguity escalation — the same code the consumers will call. The
 * Jev side asks the production endpoint with the consumer's own question.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SystemZero } from "../client.ts";
import { ChildTransport } from "../runner.ts";
import { type CaseOutcome, buildReport, renderReport } from "./metrics.ts";
import { askJev } from "./jev.ts";
import { TOOLSETS } from "./toolsets.ts";

interface BankCase {
  id: string;
  input: string;
  label: string;
  /** Defensible alternatives to the primary label (see metrics.ts CaseOutcome.accept). */
  accept?: string[];
  source: string;
}

function loadBank(path: string): BankCase[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as BankCase);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const bankArg = process.argv[2];
const spec = bankArg ? TOOLSETS[bankArg] : undefined;
if (!bankArg || !spec) {
  console.error(`uso: run-eval.ts <${Object.keys(TOOLSETS).join("|")}> [--jev] [--out dir]`);
  process.exit(2);
}
const cases = loadBank(join(import.meta.dirname, "banks", `${bankArg}.jsonl`));
const withJev = process.argv.includes("--jev");
const outDir = arg("out");
/** The EVAL's threshold sweep starts at 0.5; the gate here only decides needle vs escalation. */
const EVAL_THRESHOLD = 0;

const transport = new ChildTransport({
  bin: join(import.meta.dirname, "..", "engine", "needle"),
  weights: join(import.meta.dirname, "..", "engine", "needle3.cact"),
});
// The client's Jev branch IS the Jev comparison: no double call. Without --jev
// the fallback returns null (the client treats it as "no Jev verdict", which is
// exactly what the needle-only run measures).
// The client's Jev branch is not the baseline: the baseline answers EVERY case
// (that is what a full-Jev pipeline would cost and score), so it is asked here.
const jevFallback = async (): Promise<null> => null;
const sz = new SystemZero(transport, jevFallback);

const outcomes: CaseOutcome[] = [];
for (const [index, item] of cases.entries()) {
  let needleChoice: string | null = null;
  let confidence: number | null = null;
  let reason: string | null = null;
  const startedAt = Date.now();
  // The real client decides; a Jev escalation is expected and handled at bank level.
  const result = await sz
    .complete({
      input: item.input,
      toolset: spec.toolset,
      threshold: EVAL_THRESHOLD,
      acceptSuppressed: spec.acceptSuppressed,
    })
    .catch(() => null);
  const latencyMs = Date.now() - startedAt;
  if (result?.origin === "needle") {
    needleChoice = result.call
      ? spec.answerKey === "$name"
        ? result.call.name
        : String(result.call.arguments[spec.answerKey] ?? "") || null
      : null;
    confidence = result.confidence;
  } else {
    reason = result?.reason ?? "unavailable";
  }
  const jev = withJev
    ? await askJev(spec.stateFor ? spec.stateFor(item.input) : item.input, spec.jevFor?.(item.input) ?? spec.jev, {
        timeoutMs: 20_000,
      })
    : null;
  outcomes.push({
    id: item.id,
    label: item.label,
    accept: item.accept ?? [item.label],
    needle: { choice: needleChoice, confidence, latencyMs, ...(reason ? { error: reason } : {}) },
    jev,
  });
  const ok = needleChoice !== null && (item.accept ?? [item.label]).includes(needleChoice);
  const mark = ok ? "✓" : needleChoice ? "✗" : "·";
  process.stderr.write(
    `[${index + 1}/${cases.length}] ${item.id} ${mark} needle=${needleChoice}@${confidence?.toFixed(2) ?? reason}${jev ? ` jev=${jev.choice}@${jev.confidence?.toFixed(2) ?? jev.error ?? "—"}` : ""}\n`,
  );
}
await transport.stop();

const report = buildReport(bankArg, outcomes);
const markdown = renderReport(report);
console.log(markdown);
if (outDir) {
  writeFileSync(join(outDir, `${bankArg}.json`), `${JSON.stringify({ report, outcomes }, null, 2)}\n`);
  writeFileSync(join(outDir, `${bankArg}.md`), `${markdown}\n`);
  console.error(`informe escrito en ${outDir}/${bankArg}.{json,md}`);
}