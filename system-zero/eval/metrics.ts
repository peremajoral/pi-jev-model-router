/**
 * EVAL metrics (jev-4y5.13).
 *
 * The question is not "does needle agree with Jev" — it is "can needle answer
 * this consumer's question well enough that we stop paying Jev for it, and at
 * what threshold". So the numbers are computed against the LABEL:
 *
 *   - coverage(thr): fraction of cases needle answered with confidence >= thr.
 *     Everything below thr escalates to Jev, so coverage is the saving.
 *   - accuracy@answered(thr): needle's accuracy on the cases it answered.
 *     This is the risk the threshold accepts.
 *   - highConfFalse(thr): labelled-wrong calls with confidence >= thr. The
 *     number that actually hurts: a confident wrong answer never reaches Jev.
 *   - systemAccuracy(thr): needle answers correctly, or escalates and Jev is
 *     right. The end-to-end quality of the hybrid.
 *   - agreement: needle vs Jev on the same input (informative, not decisive).
 */

export const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95] as const;

export interface CaseOutcome {
  id: string;
  /** The primary label: the row of the confusion matrix. */
  label: string;
  /** Every defensible answer for this case (defaults to the label alone). A vague message
   *  can accept both needs_review and request_information without either being "wrong". */
  accept: string[];
  needle: { choice: string | null; confidence: number | null; latencyMs: number; error?: string };
  jev: { choice: string | null; confidence: number | null; latencyMs: number; error?: string } | null;
}

function isCorrect(outcome: CaseOutcome, side: "needle" | "jev"): boolean {
  const choice = outcome[side]?.choice;
  return choice !== null && choice !== undefined && outcome.accept.includes(choice);
}

export interface ThresholdRow {
  threshold: number;
  covered: number;
  coverage: number;
  answeredCorrect: number;
  answeredWrong: number;
  accuracyAnswered: number | null;
  highConfFalse: number;
  systemCorrect: number;
  systemAccuracy: number;
  escalated: number;
}

export interface EvalReport {
  bank: string;
  cases: number;
  labels: string[];
  needleAvailable: number;
  jevAvailable: number;
  agreement: number | null;
  confusionNeedle: Record<string, Record<string, number>>;
  confusionJev: Record<string, Record<string, number>>;
  accuracyNeedle: number | null;
  accuracyJev: number | null;
  thresholds: ThresholdRow[];
  latency: { needleMs: number | null; jevMs: number | null };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function confusion(outcomes: CaseOutcome[], side: "needle" | "jev"): Record<string, Record<string, number>> {
  const table: Record<string, Record<string, number>> = {};
  for (const outcome of outcomes) {
    const picked = outcome[side]?.choice;
    if (picked === null || picked === undefined) continue;
    table[outcome.label] ??= {};
    table[outcome.label]![picked] = (table[outcome.label]![picked] ?? 0) + 1;
  }
  return table;
}

function accuracy(outcomes: CaseOutcome[], side: "needle" | "jev"): number | null {
  const answered = outcomes.filter((outcome) => outcome[side]?.choice);
  if (answered.length === 0) return null;
  return answered.filter((outcome) => isCorrect(outcome, side)).length / answered.length;
}

export function buildReport(bank: string, outcomes: CaseOutcome[]): EvalReport {
  const withNeedle = outcomes.filter((outcome) => outcome.needle.choice);
  const withJev = outcomes.filter((outcome) => outcome.jev?.choice);
  const both = outcomes.filter((outcome) => outcome.needle.choice && outcome.jev?.choice);
  const agreement = both.length === 0 ? null : both.filter((outcome) => outcome.needle.choice === outcome.jev!.choice).length / both.length;

  const thresholds: ThresholdRow[] = THRESHOLDS.map((threshold) => {
    const covered = outcomes.filter(
      (outcome) => outcome.needle.choice && (outcome.needle.confidence ?? 0) >= threshold,
    );
    const answeredCorrect = covered.filter((outcome) => isCorrect(outcome, "needle")).length;
    const answeredWrong = covered.length - answeredCorrect;
    const escalated = outcomes.length - covered.length;
    // End-to-end: needle correct when it acts; otherwise the case is Jev's to win.
    const escalatedCorrect = outcomes.filter(
      (outcome) =>
        !(outcome.needle.choice && (outcome.needle.confidence ?? 0) >= threshold) &&
        isCorrect(outcome, "jev"),
    ).length;
    return {
      threshold,
      covered: covered.length,
      coverage: covered.length / outcomes.length,
      answeredCorrect,
      answeredWrong,
      accuracyAnswered: covered.length === 0 ? null : answeredCorrect / covered.length,
      highConfFalse: answeredWrong,
      systemCorrect: answeredCorrect + escalatedCorrect,
      systemAccuracy: (answeredCorrect + escalatedCorrect) / outcomes.length,
      escalated,
    };
  });

  return {
    bank,
    cases: outcomes.length,
    labels: [...new Set(outcomes.map((outcome) => outcome.label))].sort(),
    needleAvailable: withNeedle.length,
    jevAvailable: withJev.length,
    agreement,
    confusionNeedle: confusion(outcomes, "needle"),
    confusionJev: confusion(outcomes, "jev"),
    accuracyNeedle: accuracy(outcomes, "needle"),
    accuracyJev: accuracy(outcomes, "jev"),
    thresholds,
    latency: {
      needleMs: mean(withNeedle.map((outcome) => outcome.needle.latencyMs)),
      jevMs: mean(withJev.map((outcome) => outcome.jev!.latencyMs)),
    },
  };
}

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function renderReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# EVAL — ${report.bank}`);
  lines.push("");
  lines.push(`Casos: ${report.cases} · needle respondió: ${report.needleAvailable} · Jev respondió: ${report.jevAvailable}`);
  lines.push("");
  lines.push(`| | acierto sobre lo respondido |`);
  lines.push(`|---|---|`);
  lines.push(`| needle | ${pct(report.accuracyNeedle)} |`);
  lines.push(`| Jev | ${pct(report.accuracyJev)} |`);
  lines.push(`| acuerdo needle–Jev | ${pct(report.agreement)} |`);
  lines.push("");
  lines.push(`Latencia media: needle ${report.latency.needleMs?.toFixed(0) ?? "—"} ms · Jev ${report.latency.jevMs?.toFixed(0) ?? "—"} ms`);
  lines.push("");
  lines.push("## Barrido de umbral");
  lines.push("");
  lines.push("| umbral | cobertura | acierto al responder | falsos confiado-altos | systemAccuracy | escala a Jev |");
  lines.push("|---|---|---|---|---|---|");
  for (const row of report.thresholds) {
    lines.push(
      `| ${row.threshold.toFixed(2)} | ${pct(row.coverage)} (${row.covered}/${report.cases}) | ${pct(row.accuracyAnswered)} | ${row.highConfFalse} | ${pct(row.systemAccuracy)} | ${row.escalated} |`,
    );
  }
  lines.push("");
  lines.push("## Matriz de confusión (needle)");
  lines.push("");
  const labels = report.labels;
  lines.push(`| etiqueta \\ needle | ${labels.join(" | ")} |`);
  lines.push(`|---|${labels.map(() => "---").join("|")}|`);
  for (const label of labels) {
    const row = report.confusionNeedle[label] ?? {};
    lines.push(`| ${label} | ${labels.map((picked) => row[picked] ?? 0).join(" | ")} |`);
  }
  return lines.join("\n");
}

function outcomes_of(report: EvalReport): string[] {
  return Object.keys(report.confusionNeedle);
}