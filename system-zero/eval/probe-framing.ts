/**
 * Probe: which framing lets needle classify at all? (jev-4y5.13)
 *
 * needle is a TOOL-CALLING model: it picks the function that matches what the
 * user asks. A labour report ("Alta laboral de José") is not a request, so the
 * action-tool framing makes it answer the speech act, not the class. Upstream
 * says structured extraction generalises to classification, so this probe
 * compares framings on the same labelled cases before the EVAL commits to one.
 *
 *   node system-zero/eval/probe-framing.ts <bank>
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChildTransport } from "../runner.ts";
import type { NeedleTool, Toolset } from "../types.ts";
import { TOOLSETS } from "./toolsets.ts";

interface BankCase {
  id: string;
  input: string;
  label: string;
  accept?: string[];
}

const bank = process.argv[2] ?? "sayago";
const cases: BankCase[] = readFileSync(join(import.meta.dirname, "banks", `${bank}.jsonl`), "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as BankCase);
const spec = TOOLSETS[bank]!;
const classes = bank === "sayago"
  ? ["route_to_gestoria", "route_to_payroll", "request_information", "needs_review"]
  : ["recuperable_pdf", "registro_cancelacion", "revision_humana"];

const enumTool: NeedleTool = {
  name: bank === "sayago" ? "extraer_accion_laboral" : "extraer_clase_fallo",
  description:
    bank === "sayago"
      ? "Extrae del mensaje la acción de enrutado que le corresponde (dentro del enum)."
      : "Extrae de la fila la clase de resolución que le corresponde (dentro del enum).",
  parameters: {
    type: "object",
    properties: { accion: { type: "string", enum: classes } },
    required: ["accion"],
  },
};

const framings: Array<{ name: string; key: string; toolset: Toolset; wrap: (text: string) => string }> = [
  {
    name: "A: 4 tools de acción (v2)",
    key: "$name",
    toolset: spec.toolset,
    wrap: (text) => text,
  },
  {
    name: "B: 1 tool extracción + enum",
    key: "accion",
    toolset: { key: "probe_b", tools: [enumTool], system: spec.toolset.system },
    wrap: (text) => text,
  },
  {
    name: "C: 1 tool extracción + enum, input imperativo",
    key: "accion",
    toolset: { key: "probe_c", tools: [enumTool], system: spec.toolset.system },
    wrap: (text) => `Clasifica este mensaje y registra la acción que le corresponde.\n\n Mensaje: ${text}`,
  },
  {
    name: "D: 4 tools de acción, input imperativo",
    key: "$name",
    toolset: spec.toolset,
    wrap: (text) => `Clasifica este mensaje y ejecuta la acción que le corresponde.\n\n Mensaje: ${text}`,
  },
];

const transport = new ChildTransport({
  bin: join(import.meta.dirname, "..", "engine", "needle"),
  weights: join(import.meta.dirname, "..", "engine", "needle3.cact"),
});

for (const framing of framings) {
  let answered = 0;
  let correct = 0;
  let highConfFalse = 0;
  for (const item of cases) {
    const outcome = await transport.complete(framing.toolset, framing.wrap(item.input));
    if (!outcome.ok) continue;
    const grounded = outcome.envelope.function_calls ?? [];
    const withheld = outcome.envelope.suppressed_calls ?? [];
    const calls = grounded.length > 0 ? grounded : withheld;
    if (calls.length !== 1) continue;
    const call = calls[0]!;
    const choice = framing.key === "$name" ? call.name : String(call.arguments[framing.key] ?? "");
    const confidence = outcome.envelope.confidence ?? 0;
    const accept = item.accept ?? [item.label];
    if (!choice) continue;
    answered++;
    const ok = accept.includes(choice);
    if (ok) correct++;
    else if (confidence >= 0.8) highConfFalse++;
  }
  console.log(
    `${framing.name}: respondidos ${answered}/${cases.length} · acierto ${(100 * correct / Math.max(1, answered)).toFixed(1)}% · falsos confiado-altos(≥0.8) ${highConfFalse}`,
  );
}
await transport.stop();
