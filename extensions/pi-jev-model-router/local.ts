import type { JevRouterConfig } from "./config.ts";

/**
 * Local-judge plumbing, dependency-free so it is testable with plain
 * `node --test`. A judge running on this machine (Ollaya on 11435) issues no
 * credentials, exactly like Stanley's local judge: the request carries a
 * placeholder key so it is never credential-less.
 */

/** Hosts that mean "this machine": a judge running here issues no credentials. */
export const LOCAL_HOSTS: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
  "::1": true,
  "[::1]": true,
};

/** The key the local judge ignores; sent so the request is never credential-less. */
export const LOCAL_JUDGE_KEY = "local-judge";

/** Host of a base URL, or "" when it is not one: an unparseable value counts as remote, so the key is required. */
export function hostOf(value: string | undefined): string {
  try {
    return new URL(value?.trim() ?? "").hostname;
  } catch {
    return "";
  }
}

/** True when the configured endpoint is a judge on this machine. No API key is needed then. */
export function isLocalEndpoint(endpoint: string | undefined): boolean {
  return Boolean(LOCAL_HOSTS[hostOf(endpoint)]);
}

export function hasApiKey(config: JevRouterConfig): boolean {
  if (isLocalEndpoint(config.endpoint)) return true;
  if (config.apiKey && config.apiKey.trim().length > 0) return true;
  const value = process.env[config.apiKeyEnv];
  return typeof value === "string" && value.trim().length > 0;
}

export function apiKeyFor(config: JevRouterConfig): string {
  if (isLocalEndpoint(config.endpoint)) return config.apiKey?.trim() || LOCAL_JUDGE_KEY;
  return config.apiKey?.trim() || process.env[config.apiKeyEnv]?.trim() || "";
}