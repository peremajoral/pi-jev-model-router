/**
 * Mode B transport: each tool owns its runner.
 *
 * One upstream `needle --serve` child process per toolset (toolset + system
 * identify an engine), on a private localhost port, no auth, no shared state.
 * The spawn contract is copied verbatim from needle.server's worker.py, which
 * fronts the same binary and already carries its quirks:
 *
 *   needle --model <weights> --tools <file> --system <file> --serve --port N --fail-input-overflow
 *
 *   - The runner's request parser is hand-rolled: compact JSON only (no space
 *     after the colon) and raw UTF-8 (no \uXXXX escapes). Control characters
 *     that JSON.stringify would escape are stripped before sending.
 *   - One request per connection, `Connection: close`; requests are serialized
 *     per runner (the engine conversation is stateful).
 *   - `/reset` clears the conversation; we reset before every call so one
 *     classification can never read another's turns.
 *   - Exit code 2 during startup means the engine rejected the schemas.
 *   - Stop: SIGTERM, 2 s grace, SIGKILL — the runner ignores SIGTERM inside
 *     an engine call, so a request that overruns the deadline kills the child
 *     and the next call spawns a fresh one.
 *
 * Pinning: bin and weights are hashed once per transport before the first
 * spawn; a mismatch means needle never runs and every request escalates to
 * Jev. The setup script downloads the pinned revision; this re-checks it.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import {
  IDLE_STOP_MS,
  MAX_SYSTEM_CHARS,
  MAX_TOOLS,
  MAX_TOOLS_CHARS,
  PINNED,
  REQUEST_DEADLINE_MS,
  SIGTERM_GRACE_MS,
  SPAWN_TIMEOUT_MS,
} from "./limits.ts";
import type { ChildTransportOptions, NeedleEnvelope, NeedleOutcome, Toolset } from "./types.ts";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
      server.close();
    });
    server.on("error", reject);
  });
}

async function sha256File(path: string): Promise<string> {
  const buffer = await readFile(path);
  return createHash("sha256").update(buffer).digest("hex");
}

/** Strip the control characters JSON.stringify would escape as \uXXXX (the runner does not decode them). */
export function sanitizeInput(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

interface Runner {
  key: string;
  port: number;
  child: ChildProcess;
  queue: Promise<unknown>;
  idleTimer?: NodeJS.Timeout;
}

export class ChildTransport {
  private readonly bin: string;
  private readonly weights: string;
  private readonly stateDir: string;
  private readonly pins: { bin?: string; weights?: string };
  private readonly spawnTimeoutMs: number;
  private readonly requestDeadlineMs: number;
  private readonly idleStopMs: number;
  private readonly command?: ChildTransportOptions["command"];
  private runners = new Map<string, Runner>();
  private pinnedCheck: Promise<boolean> | null = null;
  private stopped = false;

  constructor(options: ChildTransportOptions) {
    this.bin = options.bin;
    this.weights = options.weights;
    this.stateDir = options.stateDir ?? join(import.meta.dirname ?? ".", "state");
    // Default: enforce the pinned upstream revision. An explicit `pins` object
    // REPLACES the defaults entirely (absent keys are simply not checked), so
    // tests can pass {} for a stub and a real setup cannot weaken the pin
    // without writing its intention down.
    this.pins = options.pins ?? {
      bin: PINNED.runnerSha256["macos-arm64"],
      weights: PINNED.weightsSha256,
    };
    this.spawnTimeoutMs = options.spawnTimeoutMs ?? SPAWN_TIMEOUT_MS;
    this.requestDeadlineMs = options.requestDeadlineMs ?? REQUEST_DEADLINE_MS;
    this.idleStopMs = options.idleStopMs ?? IDLE_STOP_MS;
    this.command = options.command;
  }

  /** Hash the pinned files once; false = never spawn, every request escalates. */
  private verifyPinned(): Promise<boolean> {
    this.pinnedCheck ??= (async () => {
      try {
        if (this.pins.bin && (await sha256File(this.bin)) !== this.pins.bin) return false;
        if (this.pins.weights && (await sha256File(this.weights)) !== this.pins.weights) return false;
        return true;
      } catch {
        return false;
      }
    })();
    return this.pinnedCheck;
  }

  private validate(toolset: Toolset): string | null {
    if (!Array.isArray(toolset.tools) || toolset.tools.length < 1) return "tools: at least one required";
    if (toolset.tools.length > MAX_TOOLS) return `tools: at most ${MAX_TOOLS}`;
    if (JSON.stringify(toolset.tools).length > MAX_TOOLS_CHARS) return `tools: over ${MAX_TOOLS_CHARS} characters`;
    if (toolset.system && toolset.system.length > MAX_SYSTEM_CHARS) return `system: over ${MAX_SYSTEM_CHARS} characters`;
    return null;
  }

  private async spawn(toolset: Toolset): Promise<Runner> {
    const previous = this.runners.get(toolset.key);
    if (previous) await this.kill(previous);
    await mkdir(this.stateDir, { recursive: true });
    const toolsPath = join(this.stateDir, `${toolset.key}.tools.json`);
    const systemPath = join(this.stateDir, `${toolset.key}.system.txt`);
    await writeFile(toolsPath, JSON.stringify(toolset.tools), "utf8");
    await writeFile(systemPath, toolset.system ?? "", "utf8");
    const port = await freePort();
    const command = this.command
      ? this.command(toolsPath, systemPath, port)
      : [
          this.bin,
          "--model",
          this.weights,
          "--tools",
          toolsPath,
          "--system",
          systemPath,
          "--serve",
          "--port",
          String(port),
          "--fail-input-overflow",
        ];
    const child = spawn(command[0]!, command.slice(1), {
      env: { ...process.env, NEEDLE_TELEMETRY: "0", DO_NOT_TRACK: "1" },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const runner: Runner = { key: toolset.key, port, child, queue: Promise.resolve() };
    this.runners.set(toolset.key, runner);
    const deadline = Date.now() + this.spawnTimeoutMs;
    while (true) {
      if (child.exitCode !== null) {
        const rejected = child.exitCode === 2;
        await this.kill(runner);
        throw Object.assign(new Error(`runner exited with code ${child.exitCode} during startup`), { rejected });
      }
      try {
        await this.post(runner, "/reset", "{}");
        return runner;
      } catch {
        // Not ready yet.
      }
      if (Date.now() > deadline) {
        await this.kill(runner);
        throw Object.assign(new Error(`runner not ready after ${this.spawnTimeoutMs} ms`), { rejected: false });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** One request per connection, compact JSON, Connection: close — the runner's only accepted form. */
  private post(runner: Runner, path: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (runner.child.exitCode !== null) {
        reject(new Error("runner exited"));
        return;
      }
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: runner.port,
          path,
          method: "POST",
          // The runner answers ONE request per connection and does not honour
          // `Connection: close`; Node's global agent would pool and reuse the
          // socket, and the runner resets it (ECONNRESET). Fresh socket per
          // request, exactly like needle.server's max_keepalive_connections=0.
          agent: false,
          headers: { "Content-Type": "application/json", Connection: "close" },
        },
        (response) => {
          let data = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (data += chunk));
          response.on("end", () =>
            response.statusCode === 200 ? resolve(data) : reject(new Error(`HTTP ${response.statusCode}`)),
          );
        },
      );
      request.on("error", reject);
      request.end(body);
    });
  }

  private async kill(runner: Runner): Promise<void> {
    if (runner.idleTimer) clearTimeout(runner.idleTimer);
    this.runners.delete(runner.key);
    const child = runner.child;
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const grace = setTimeout(() => child.kill("SIGKILL"), SIGTERM_GRACE_MS);
    await exited;
    clearTimeout(grace);
  }

  /** Stop every runner and remove the state dir. The module dies clean. */
  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.runners.values()].map((runner) => this.kill(runner)));
    await rm(this.stateDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private scheduleIdleStop(runner: Runner): void {
    if (runner.idleTimer) clearTimeout(runner.idleTimer);
    runner.idleTimer = setTimeout(() => {
      void this.kill(runner);
    }, this.idleStopMs);
    runner.idleTimer.unref();
  }

  /**
   * One classification against one toolset. Serialized per runner: the engine
   * conversation is stateful, and it is reset before every call so requests
   * stay independent. A deadline overrun kills the runner — the engine call
   * cannot be cancelled, only the process can — and the next call respawns.
   */
  async complete(toolset: Toolset, input: string): Promise<NeedleOutcome> {
    if (this.stopped) return { ok: false, failure: { kind: "unavailable" } };
    const invalid = this.validate(toolset);
    if (invalid) return { ok: false, failure: { kind: "invalid_toolset", reason: invalid } };
    if (!(await this.verifyPinned())) return { ok: false, failure: { kind: "unavailable" } };

    const text = sanitizeInput(input);
    const body = JSON.stringify({ input: text }); // compact separators, raw UTF-8: the runner's only form

    let runner = this.runners.get(toolset.key);
    if (!runner || runner.child.exitCode !== null) {
      try {
        runner = await this.spawn(toolset);
      } catch (error) {
        const rejected = (error as { rejected?: boolean }).rejected === true;
        return { ok: false, failure: { kind: rejected ? "rejected" : "unavailable" } };
      }
    }

    const active = runner;
    const run = active.queue.then(async (): Promise<NeedleOutcome> => {
      active.idleTimer ? clearTimeout(active.idleTimer) : undefined;
      this.scheduleIdleStop(active);
      try {
        await this.post(active, "/reset", "{}");
      } catch {
        await this.kill(active);
        return { ok: false, failure: { kind: "unavailable" } };
      }
      let timer: NodeJS.Timeout | undefined;
      try {
        const response = await Promise.race([
          this.post(active, "/complete", body),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("deadline_exceeded")), this.requestDeadlineMs);
          }),
        ]);
        const envelope = response ? (JSON.parse(response) as NeedleEnvelope) : null;
        if (!envelope || envelope.error) {
          await this.kill(active);
          return { ok: false, failure: { kind: "unavailable" } };
        }
        return { ok: true, envelope };
      } catch {
        // Deadline or transport error: this runner is never trusted again; the next call respawns.
        await this.kill(active);
        return { ok: false, failure: { kind: "deadline" } };
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
    active.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}