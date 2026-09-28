/**
 * Cascade tests for the local judge path (winnow → laya → nli).
 *
 * Plain `node --test`: no pi runtime required — jev.ts only imports types
 * from config.ts and TASK_KINDS from kinds.ts, so the whole judge path is
 * testable with a mocked global fetch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, JevError } from "./jev.ts";
import { apiKeyFor, hasApiKey, isLocalEndpoint, LOCAL_JUDGE_KEY } from "./local.ts";
import type { JevRouterConfig } from "./config.ts";

/** A valid systemone answer payload for the router's four questions. */
function answerPayload(model: string, kind: string, kindConfidence: number): unknown {
  return {
    model,
    answers: {
      task_kind: { type: "choice", choice: kind, confidence: kindConfidence, probabilities: { [kind]: kindConfidence } },
      complexity: { type: "score", score: 1.2, confidence: 0.5, probabilities: {} },
      capability_deserved: { type: "score", score: 0.9, confidence: 0.4, probabilities: {} },
      needs_deep_reasoning: { type: "noul", noul: 0.2 },
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  };
}

/** Config fixture: local endpoint, winnow primary, laya + nli fallbacks, floor 0.5. */
function config(overrides: Partial<JevRouterConfig> = {}): JevRouterConfig {
  return {
    endpoint: "http://127.0.0.1:11435/v1/systemone",
    jevModel: "winnow:e4b",
    judgeFallbacks: ["laya:latest", "nli:latest"],
    escalateBelowConfidence: 0.5,
    timeoutMs: 200,
    apiKeyEnv: "TYPESAFE_API_KEY",
    ...overrides,
  } as unknown as JevRouterConfig;
}

const INPUT = {
  prompt: "arregla el bug del parser cuando el input está vacío",
  spend: { today: 0, month: 0, pressure: 0 },
};

interface Recorded {
  url: string;
  body: { model: string; questions: unknown; state: unknown };
}

/** Mock global fetch with one handler per call, in order. */
function mockFetch(handlers: Array<(recorded: Recorded) => Response>): { calls: Recorded[]; restore: () => void } {
  const calls: Recorded[] = [];
  let index = 0;
  const original = globalThis.fetch;
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Recorded["body"];
    const recorded: Recorded = { url: String(input), body };
    calls.push(recorded);
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return handler(recorded);
  }) as typeof fetch;
  globalThis.fetch = fake;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("primary answers confidently: one call, no escalation", async () => {
  const mock = mockFetch([() => new Response(JSON.stringify(answerPayload("winnow:e4b", "debug", 0.9)), { status: 200 })]);
  try {
    const analysis = await classifyRequest(INPUT, config(), LOCAL_JUDGE_KEY);
    assert.equal(analysis.kind, "debug");
    assert.equal(analysis.judgeModel, "winnow:e4b");
    assert.equal(analysis.escalated, false);
    assert.equal(analysis.escalationNote, undefined);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].body.model, "winnow:e4b");
    assert.equal(mock.calls[0].url, "http://127.0.0.1:11435/v1/systemone");
  } finally {
    mock.restore();
  }
});

test("TypeSafe 402 (no credits) on the primary: laya answers, escalated", async () => {
  const mock = mockFetch([
    () => new Response('{"detail":{"error_type":"billing_error"}}', { status: 402 }),
    () => new Response(JSON.stringify(answerPayload("laya:latest", "debug", 0.74)), { status: 200 }),
  ]);
  try {
    const analysis = await classifyRequest(INPUT, config(), LOCAL_JUDGE_KEY);
    assert.equal(analysis.judgeModel, "laya:latest");
    assert.equal(analysis.escalated, true);
    assert.match(analysis.escalationNote ?? "", /cascade: laya:latest answered/);
    assert.match(analysis.escalationNote ?? "", /1 failed/);
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[1].body.model, "laya:latest");
  } finally {
    mock.restore();
  }
});

test("primary below the confidence floor: laya wins with higher confidence", async () => {
  const mock = mockFetch([
    () => new Response(JSON.stringify(answerPayload("winnow:e4b", "implement", 0.2)), { status: 200 }),
    () => new Response(JSON.stringify(answerPayload("laya:latest", "debug", 0.8)), { status: 200 }),
  ]);
  try {
    const analysis = await classifyRequest(INPUT, config(), LOCAL_JUDGE_KEY);
    assert.equal(analysis.kind, "debug");
    assert.equal(analysis.judgeModel, "laya:latest");
    assert.equal(analysis.escalated, true);
    assert.equal(mock.calls.length, 2);
  } finally {
    mock.restore();
  }
});

test("fallback worse than primary: primary answer is kept", async () => {
  const mock = mockFetch([
    () => new Response(JSON.stringify(answerPayload("winnow:e4b", "implement", 0.3)), { status: 200 }),
    () => new Response(JSON.stringify(answerPayload("laya:latest", "chat", 0.25)), { status: 200 }),
    () => new Response(JSON.stringify(answerPayload("nli:latest", "chat", 0.22)), { status: 200 }),
  ]);
  try {
    const analysis = await classifyRequest(INPUT, config(), LOCAL_JUDGE_KEY);
    assert.equal(analysis.kind, "implement");
    assert.equal(analysis.judgeModel, "winnow:e4b");
    assert.equal(analysis.escalated, false);
    assert.match(analysis.escalationNote ?? "", /below floor: 3 answered/);
    assert.equal(mock.calls.length, 3);
  } finally {
    mock.restore();
  }
});

test("unknown task kind from the primary is a judge failure: cascade continues", async () => {
  const mock = mockFetch([
    () => new Response(JSON.stringify(answerPayload("winnow:e4b", "quantum-surgery", 0.9)), { status: 200 }),
    () => new Response(JSON.stringify(answerPayload("laya:latest", "debug", 0.7)), { status: 200 }),
  ]);
  try {
    const analysis = await classifyRequest(INPUT, config(), LOCAL_JUDGE_KEY);
    assert.equal(analysis.kind, "debug");
    assert.equal(analysis.judgeModel, "laya:latest");
    assert.equal(analysis.escalated, true);
    assert.equal(mock.calls.length, 2);
  } finally {
    mock.restore();
  }
});

test("every judge fails: JevError with the last failure", async () => {
  const mock = mockFetch([() => new Response("no credits", { status: 402 })]);
  try {
    await assert.rejects(classifyRequest(INPUT, config(), LOCAL_JUDGE_KEY), (error: unknown) => {
      assert.ok(error instanceof JevError);
      assert.match(error.message, /402/);
      return true;
    });
    assert.equal(mock.calls.length, 3);
  } finally {
    mock.restore();
  }
});

test("empty judgeFallbacks disables the cascade", async () => {
  const mock = mockFetch([
    () => new Response(JSON.stringify(answerPayload("winnow:e4b", "implement", 0.2)), { status: 200 }),
  ]);
  try {
    const analysis = await classifyRequest(INPUT, config({ judgeFallbacks: [] }), LOCAL_JUDGE_KEY);
    assert.equal(analysis.kind, "implement");
    assert.equal(analysis.judgeModel, "winnow:e4b");
    assert.match(analysis.escalationNote ?? "", /below floor: 1 answered/);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

test("escalateBelowConfidence 0: first success returns immediately", async () => {
  const mock = mockFetch([
    () => new Response(JSON.stringify(answerPayload("winnow:e4b", "implement", 0.05)), { status: 200 }),
  ]);
  try {
    const analysis = await classifyRequest(INPUT, config({ escalateBelowConfidence: 0 }), LOCAL_JUDGE_KEY);
    assert.equal(analysis.judgeModel, "winnow:e4b");
    assert.equal(analysis.escalated, false);
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

test("local endpoint needs no API key; remote still does", () => {
  delete process.env.TYPESAFE_API_KEY;
  const local = config();
  assert.equal(isLocalEndpoint(local.endpoint), true);
  assert.equal(hasApiKey(local), true);
  assert.equal(apiKeyFor(local), LOCAL_JUDGE_KEY);

  const remote = config({ endpoint: "https://api.typesafe.ai/v1/systemone" });
  assert.equal(isLocalEndpoint(remote.endpoint), false);
  assert.equal(hasApiKey(remote), false);

  process.env.TYPESAFE_API_KEY = "sk-test";
  assert.equal(hasApiKey(remote), true);
  assert.equal(apiKeyFor(remote), "sk-test");
  delete process.env.TYPESAFE_API_KEY;
});

test("an explicit apiKey wins over the local placeholder", () => {
  const local = config({ apiKey: "sk-explicit" });
  assert.equal(apiKeyFor(local), "sk-explicit");
});