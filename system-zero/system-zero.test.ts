/**
 * system-zero tests (jev-4y5.2). Acceptance:
 *   1. the module starts a runner, makes a real call, and dies clean;
 *   2. the confidence gate and the Jev fallback are covered;
 *   3. input over 2000 chars never reaches needle;
 *   4. runner+weights are pinned by checksum;
 *   5. the client has no external dependencies.
 *
 * Most tests run against stub-runner.mjs, which copies the real runner's
 * contract (its parsing quirks included). The pinned-runner integration test
 * runs only when ./setup.sh has fetched engine/needle + engine/needle3.cact.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { SystemZero, type Transport } from "./client.ts";
import { HttpTransport } from "./http.ts";
import { MAX_INPUT_CHARS } from "./limits.ts";
import { ChildTransport } from "./runner.ts";
import type { Toolset } from "./types.ts";

const TOOLSET: Toolset = {
  key: "clasifica",
  tools: [
    {
      name: "rank_candidate",
      description: "Record the relevance of a file for a search task",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          relevance: { type: "string", enum: ["alta", "media", "baja"] },
        },
        required: ["path", "relevance"],
      },
    },
  ],
  system: "locale: es-ES",
};

function stubTransport(
  overrides: { confidence?: string; refuse?: string; requestDeadlineMs?: number; turnDelayMs?: number } = {},
): ChildTransport {
  const stateDir = mkdtempSync(join(tmpdir(), "system-zero-"));
  process.env.STUB_CONFIDENCE = overrides.confidence ?? "0.99";
  if (overrides.refuse) process.env.STUB_REFUSE = overrides.refuse;
  else delete process.env.STUB_REFUSE;
  if (overrides.turnDelayMs) process.env.STUB_TURN_DELAY = String(overrides.turnDelayMs);
  else delete process.env.STUB_TURN_DELAY;
  return new ChildTransport({
    bin: process.execPath,
    weights: "unused-by-stub",
    stateDir,
    pins: {}, // stub: no checksums to enforce
    ...(overrides.requestDeadlineMs ? { requestDeadlineMs: overrides.requestDeadlineMs } : {}),
    command: (toolsPath, systemPath, port) => [
      process.execPath,
      join(import.meta.dirname, "stub-runner.mjs"),
      "--tools",
      toolsPath,
      "--system",
      systemPath,
      "--serve",
      "--port",
      String(port),
    ],
  });
}

function recorder<TJev>(verdict: TJev) {
  const inputs: string[] = [];
  return {
    inputs,
    jev: async (input: string) => {
      inputs.push(input);
      return verdict;
    },
  };
}

/** Signal 0 probes existence without delivering a signal; ESRCH means it is gone. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("system-zero gate and fallback", () => {
  const transports: ChildTransport[] = [];
  after(async () => {
    for (const transport of transports) await transport.stop();
  });

  test("needle answers above the threshold; Jev is never called", async () => {
    const transport = stubTransport({ confidence: "0.99" });
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const result = await sz.complete({ input: "src/foo.ts es relevance alta", toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "needle");
    assert.equal(result.call?.name, "rank_candidate");
    assert.equal(result.confidence, 0.99);
    assert.deepEqual(jev.inputs, []);
  });

  test("below the threshold the decision goes to Jev, with the reason and the raw envelope", async () => {
    const transport = stubTransport({ confidence: "0.3" });
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const result = await sz.complete({ input: "src/foo.ts", toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "jev");
    assert.equal(result.reason, "threshold");
    assert.equal(result.confidence, 0.3);
    assert.deepEqual(jev.inputs, ["src/foo.ts"]);
    assert.deepEqual(result.jev, { verdict: "jev" });
  });

  test("a refusal (empty function_calls) escalates to Jev", async () => {
    const transport = stubTransport({ refuse: "1" });
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const result = await sz.complete({ input: "hace frio hoy", toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "jev");
    assert.equal(result.reason, "refusal");
  });

  test("weights without a confidence head escalate: no calibrated score means no needle decision", async () => {
    const transport = stubTransport({ confidence: "null" });
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const result = await sz.complete({ input: "src/foo.ts", toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "jev");
    assert.equal(result.reason, "no_confidence");
    assert.equal(result.confidence, null);
  });

  test("a deadline overrun kills the runner, is audited as deadline, and escalates", async () => {
    const transport = stubTransport({ requestDeadlineMs: 200, turnDelayMs: 2000 });
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const result = await sz.complete({ input: "src/tarde.ts", toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "jev");
    assert.equal(result.reason, "deadline");
  });

  test("input over 2000 characters never reaches needle: straight to Jev", async () => {
    const calls: string[] = [];
    const transport: Transport = {
      async complete(_toolset, input) {
        calls.push(input);
        throw new Error("must not be called");
      },
      async stop() {},
    };
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const long = "x".repeat(MAX_INPUT_CHARS + 1);
    const result = await sz.complete({ input: long, toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "jev");
    assert.equal(result.reason, "oversize");
    assert.deepEqual(calls, [], "the transport must not see the input");
  });

  test("a checksum mismatch means needle never runs and every request escalates", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "system-zero-"));
    let spawns = 0;
    const transport = new ChildTransport({
      bin: process.execPath,
      weights: "unused-by-stub",
      stateDir,
      pins: { bin: "deadbeef", weights: "deadbeef" },
      command: () => {
        spawns++;
        throw new Error("must not spawn");
      },
    });
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const result = await sz.complete({ input: "src/foo.ts", toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "jev");
    assert.equal(result.reason, "unavailable");
    assert.equal(spawns, 0);
  });

  test("a rejected toolset (engine exit 2) escalates instead of guessing", async () => {
    const transport = stubTransport();
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const result = await sz.complete({
      input: "clasifica",
      toolset: { ...TOOLSET, key: "rechazado", tools: [{ ...TOOLSET.tools[0]!, name: "REJECT" }] },
      threshold: 0.7,
    });
    assert.equal(result.origin, "jev");
    assert.equal(result.reason, "rejected");
  });

  test("the runner's parsing quirks are respected: control characters never reach it", async () => {
    const transport = stubTransport();
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const result = await sz.complete({ input: "src/foo\u0001.ts", toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "needle");
    assert.equal(result.call?.arguments.input, "src/foo .ts");
  });

  test("concurrent requests are serialized: one envelope never sees another's turns", async () => {
    const transport = stubTransport();
    transports.push(transport);
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    const [a, b, c] = await Promise.all([
      sz.complete({ input: "uno", toolset: TOOLSET, threshold: 0.7 }),
      sz.complete({ input: "dos", toolset: TOOLSET, threshold: 0.7 }),
      sz.complete({ input: "tres", toolset: TOOLSET, threshold: 0.7 }),
    ]);
    assert.equal(a.call?.arguments.turns.length, 1);
    assert.equal(b.call?.arguments.turns.length, 1);
    assert.equal(c.call?.arguments.turns.length, 1);
    // The engine conversation is reset between calls: no cross-contamination.
    assert.equal(a.call?.arguments.turns[0], "uno");
  });

  test("stop() kills the runner and leaves no state behind", async () => {
    const transport = stubTransport();
    const sz = new SystemZero(transport, async () => ({ verdict: "jev" }));
    const result = await sz.complete({ input: "src/foo.ts", toolset: TOOLSET, threshold: 0.7 });
    const pid = result.call?.arguments.pid as number;
    assert.ok(pid, "a real runner process answered");
    assert.equal(alive(pid), true, "the runner is alive before stop()");
    await sz.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(alive(pid), false, `process ${pid} must be dead after stop()`);
  });

  test("a Jev failure propagates untouched: the consumer's fail-closed is its own", async () => {
    const transport = stubTransport({ confidence: "0.2" });
    transports.push(transport);
    const sz = new SystemZero(transport, async () => {
      throw Object.assign(new Error("jev_unavailable"), { status: 401 });
    });
    await assert.rejects(
      sz.complete({ input: "src/foo.ts", toolset: TOOLSET, threshold: 0.7 }),
      /jev_unavailable/,
    );
  });
});

describe("system-zero mode C (fetch)", () => {
  test("http transport posts the toolset and enforces the client-side limits", async () => {
    const seen: Array<Record<string, unknown>> = [];
    let busy = false;
    const server = (await import("node:http")).createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        seen.push(body);
        if (busy) {
          response.statusCode = 429;
          response.end(JSON.stringify({ error: { code: "queue_full", message: "busy" } }));
          return;
        }
        response.end(
          JSON.stringify({
            type: "call",
            success: true,
            confidence: 0.9,
            function_calls: [{ name: body.tools[0].name, arguments: { ok: true } }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const transport = new HttpTransport({ baseUrl });
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);

    const result = await sz.complete({ input: "clasifica src/foo.ts", toolset: TOOLSET, threshold: 0.7 });
    assert.equal(result.origin, "needle");
    assert.equal(seen[0]?.input, "clasifica src/foo.ts");
    assert.equal(seen[0]?.tools[0]?.name, "rank_candidate");

    const busyOutcome = await (async () => {
      busy = true;
      const outcome = await transport.complete(TOOLSET, "x");
      busy = false;
      return outcome;
    })();
    assert.ok(!busyOutcome.ok && busyOutcome.failure.kind === "unavailable", "429 is a fallback, not a guess");

    const oversize = await transport.complete(TOOLSET, "x".repeat(MAX_INPUT_CHARS + 1));
    assert.ok(!oversize.ok && oversize.failure.kind === "oversize");

    server.close();
  });
});

describe("system-zero pinned runner (integration)", () => {
  const bin = join(import.meta.dirname, "engine", "needle");
  const weights = join(import.meta.dirname, "engine", "needle3.cact");

  test("the pinned runner answers a real call and dies clean", { skip: !existsSync(bin) }, async () => {
    const transport = new ChildTransport({ bin, weights });
    const jev = recorder({ verdict: "jev" });
    const sz = new SystemZero(transport, jev.jev);
    try {
      const result = await sz.complete({
        input: "clasifica src/foo.ts como relevance alta",
        toolset: TOOLSET,
        threshold: 0.7,
      });
      assert.equal(result.origin, "needle");
      assert.equal(result.call?.name, "rank_candidate");
      assert.equal(result.call?.arguments.relevance, "alta");
      assert.ok(typeof result.confidence === "number" && result.confidence >= 0.7, `confidence ${result.confidence}`);
      assert.deepEqual(jev.inputs, []);
    } finally {
      await sz.stop();
    }
  });
});