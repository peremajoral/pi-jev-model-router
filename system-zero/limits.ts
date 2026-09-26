/**
 * Hard limits, copied from the measured upstream contracts — not invented here.
 * needle.server's config.py enforces these in front of the runner; in mode B
 * there is no front, so the CLIENT enforces them or the runner misbehaves:
 * an over-long input is never cut (half a command gives a confident wrong
 * call), it is refused and the request goes to Jev.
 *
 * Sources: needle.server llms.txt (limits table), config.py, worker.py.
 */

export const MAX_INPUT_CHARS = 2000;
export const MAX_TOTAL_CHARS = 4000; // input plus replayed history
export const MAX_HISTORY_TURNS = 6;
export const MAX_SYSTEM_CHARS = 500;
export const MAX_TOOLS = 20;
export const MAX_TOOLS_CHARS = 32000;
export const REQUEST_DEADLINE_MS = 5000;
export const SPAWN_TIMEOUT_MS = 30_000;
export const IDLE_STOP_MS = 10 * 60_000;
export const SIGTERM_GRACE_MS = 2000;

/** The pinned upstream artifacts (HF revision + sha256), as needle.server's setup.sh pins them. */
export const PINNED = {
  hfRepo: "Cactus-Compute/needle3",
  hfRevision: "9da75122d4ca11aa4a667281c9c8ba38a7eed679",
  weightsSha256: "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38",
  runnerSha256: {
    "macos-arm64": "4e308fc8da852fadeb19f47360ae29f17976863e335234fa129a7b3e8e172fba",
    "linux-x86_64": "e0510560249e945279801ec4386466a1f813caa9fe9f0137cf5fdd3859e03d57",
    "linux-arm64": "5dd87478b4719a9a38a6659a70c451e96e84356132c6613eb64aee160c2c19ab",
  },
} as const;

export type Platform = keyof (typeof PINNED)["runnerSha256"];