/**
 * Task kinds the router routes on.
 *
 * Kept in a dependency-free module so the judge cascade (`jev.ts`) and its
 * tests can run under plain `node --test`, without the pi runtime installed.
 * `config.ts` re-exports this for compatibility.
 */
export const TASK_KINDS: Record<string, string> = {
  plan: "Deciding what to build, sequencing work, or designing an approach before editing",
  implement: "Writing or changing code, scripts, or configuration to produce a concrete result",
  write: "Producing prose, documentation, comments, or other non-code content from scratch",
  debug: "Diagnosing a failure, error, or unexpected behavior and finding its root cause",
  refactor: "Restructuring existing code without changing intended behavior",
  review: "Auditing code, a diff, a document, or a plan for problems and risks",
  research: "Searching, reading, and synthesizing external information or unfamiliar APIs",
  explain: "Answering a question or explaining how something works",
  operate: "Running commands, tooling, git, deploys, or environment setup",
  chat: "Small talk, acknowledgements, or a request with no real work attached",
};