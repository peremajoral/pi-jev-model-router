/**
 * decide() guard tests: sentiment elevation, premium-by-bonus guard, and the
 * kind-probability confidence bar. These guards were measured on 457 real
 * decisions (research-11, sondas/olla-bench) — the tests pin their behavior.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { decide, type AvailableModel } from "./router.ts";
import type { JevRouterConfig, RouteChain } from "./config.ts";
import type { RouteAnalysis } from "./jev.ts";
import { TIERS, type Tier } from "./tiers.ts";

function routesFor(onePerTier: string): Record<Tier, RouteChain> {
  const out = {} as Record<Tier, RouteChain>;
  TIERS.forEach((tier, i) => {
    out[tier] = [{ provider: "test", model: `${onePerTier}-${i}` }];
  });
  return out;
}

function config(overrides: Partial<JevRouterConfig> = {}): JevRouterConfig {
  return {
    confidenceThreshold: 0.34,
    sentimentThreshold: 0.65,
    sentimentBoost: 0.6,
    reasoning: { threshold: 0.65, bonus: 0.75, floor: 0.2, penalty: 0.25 },
    kindMinimumTier: { implement: "standard", review: "high" },
    kindModels: {},
    routes: routesFor("m"),
    budget: { softRatio: 0.7, hardRatio: 0.9 },
    cache: { aware: true, deadband: 0.25, maxPenaltyUsd: 0.05, bypassTierDelta: 2 },
    rotation: "first",
    ...overrides,
  } as unknown as JevRouterConfig;
}

function modelsFor(cfg: JevRouterConfig): AvailableModel[] {
  return Object.values(cfg.routes).flatMap((chain) =>
    chain.map((t) => ({ provider: t.provider, id: t.model })),
  );
}

function analysis(overrides: Partial<RouteAnalysis> = {}): RouteAnalysis {
  return {
    kind: "implement",
    kindConfidence: 0.9,
    kindProbabilities: { implement: 0.9 },
    complexity: 2,
    complexityConfidence: 0.8,
    budgetIntensity: 2,
    budgetIntensityConfidence: 0.8,
    deepReasoning: 0.3,
    sentiment: 0.1,
    latencyMs: 0,
    judgeModel: "winnow:e4b",
    escalated: false,
    ...overrides,
  };
}

const SPEND = { today: 0, month: 0, pressure: 0 };

test("sentiment above threshold elevates demand and notes it", () => {
  const cfg = config();
  const calm = decide(analysis({ sentiment: 0.1 }), cfg, { models: modelsFor(cfg), spend: SPEND });
  const angry = decide(analysis({ sentiment: 0.9 }), cfg, { models: modelsFor(cfg), spend: SPEND });
  assert.ok(calm && angry);
  assert.equal(angry.notes.some((n) => n.includes("sentiment")), true);
  // base demand 2.0 (high); calm stays high, angry 2.0+0.6=2.6 → premium (base 2.0 < 2.5 → guard drops to high)
  assert.equal(calm.tier, "high");
  assert.equal(angry.tier, "high"); // elevated by sentiment, held from premium by the base guard
  assert.equal(angry.demandScore > calm.demandScore, true);
});

test("reasoning bonus never buys premium: base demand < 2.5 stays high", () => {
  const cfg = config();
  // base 2.2 + reasoning 0.75 = 2.95 → premium by score, but demandBase 2.2 < 2.5 → high
  const result = decide(
    analysis({ complexity: 2.2, budgetIntensity: 2.2, deepReasoning: 0.9 }),
    cfg,
    { models: modelsFor(cfg), spend: SPEND },
  );
  assert.ok(result);
  assert.equal(result.tier, "high");
  assert.equal(result.notes.some((n) => n.includes("premium exige demanda base")), true);
});

test("real difficulty does buy premium", () => {
  const cfg = config();
  // base 2.6, deepReasoning low → no bonus: 2.6 → premium, base ≥ 2.5, confident
  const result = decide(
    analysis({ complexity: 2.8, budgetIntensity: 2.4, deepReasoning: 0.3, kind: "plan", kindProbabilities: { plan: 0.9 } }),
    { ...cfg, kindMinimumTier: { ...cfg.kindMinimumTier, plan: "high" } },
    { models: modelsFor(cfg), spend: SPEND },
  );
  assert.ok(result);
  assert.equal(result.tier, "premium");
});

test("confidence bar thresholds the chosen option's probability, higher for premium", () => {
  const cfg = config({ confidenceThreshold: 0.34 });
  // high-tier demand (2.0), kind probability 0.3 < 0.34 → demoted to standard
  const demoted = decide(
    analysis({ kindProbabilities: { implement: 0.3 }, kindConfidence: 0.2 }),
    cfg,
    { models: modelsFor(cfg), spend: SPEND },
  );
  assert.ok(demoted);
  assert.equal(demoted.tier, "standard");
  assert.equal(demoted.lowConfidenceFallback, true);

  // premium bar: 0.3 < 0.34+0.25 → demoted even at premium demand
  const premiumDemoted = decide(
    analysis({ complexity: 2.8, budgetIntensity: 2.6, deepReasoning: 0.3, kind: "plan", kindProbabilities: { plan: 0.3 } }),
    { ...cfg, kindMinimumTier: { ...cfg.kindMinimumTier, plan: "high" } },
    { models: modelsFor(cfg), spend: SPEND },
  );
  assert.ok(premiumDemoted);
  assert.equal(premiumDemoted.tier, "standard");
  assert.equal(premiumDemoted.notes.some((n) => n.includes("probability 0.30 < 0.59")), true);
});