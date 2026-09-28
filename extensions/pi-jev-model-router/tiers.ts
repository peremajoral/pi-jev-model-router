/**
 * Tier ladder, dependency-free so router tests run under plain `node --test`.
 * `config.ts` re-exports these for compatibility.
 */
export type Tier = "quick" | "standard" | "high" | "premium";
export const TIERS: readonly Tier[] = ["quick", "standard", "high", "premium"] as const;