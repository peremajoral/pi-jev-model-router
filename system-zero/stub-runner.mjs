#!/usr/bin/env node
/**
 * A stand-in for upstream's `needle --serve`, for tests. It copies the real
 * runner's contract — including its request-parsing quirks — so a test fails
 * if the client ever sends a form the real runner would silently misread.
 * Ported from needle.server's tests/stub_runner.py, same behaviors:
 *
 *   - compact JSON only: it does not find "input" when a space follows the colon
 *   - no \uXXXX decoding
 *   - exit 2 during startup when a tool is named REJECT (engine cannot load it)
 *   - STUB_CONFIDENCE env sets the reported calibrated score
 *   - input "CRASH" kills the process mid-run; "SLEEP:<ms>" stalls the answer
 *   - POST /reset clears the conversation; /complete records the turn
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}
if (!arg("serve")) process.exit(64);

const tools = JSON.parse(readFileSync(arg("tools"), "utf8"));
const system = readFileSync(arg("system"), "utf8");
if (tools.some((tool) => tool.name === "REJECT")) process.exit(2);
const confidence = process.env.STUB_CONFIDENCE === "null" ? null : Number(process.env.STUB_CONFIDENCE ?? "0.99");
const refuse = process.env.STUB_REFUSE === "1";
const delay = Number(process.env.STUB_START_DELAY ?? "0");
const turnDelay = Number(process.env.STUB_TURN_DELAY ?? "0");

const turns = [];
setTimeout(() => {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (request.url === "/reset") {
        turns.length = 0;
        response.end("{}");
        return;
      }
      // The real parser misses "input": "..." with a space, and does not decode \uXXXX.
      const text = raw.includes('"input":"')
        ? JSON.parse(raw).input.replace(/\\u[0-9a-fA-F]{4}/g, "")
        : "";
      if (text === "CRASH") process.exit(1);
      if (text.startsWith("SLEEP:")) {
        setTimeout(() => {
          response.end("{}");
        }, Number(text.split(":")[1]));
        return;
      }
      turns.push(text);
      const call = {
        name: tools[0].name,
        arguments: { input: text, turns: [...turns], system, tools: tools.map((tool) => tool.name), pid: process.pid },
      };
      const body = {
        type: "call",
        success: true,
        error: null,
        confidence,
        peak_ram_mb: 92.5,
        function_calls: refuse ? [] : [call],
        suppressed_calls: refuse ? [call] : [],
      };
      setTimeout(() => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(body));
      }, turnDelay);
    });
  });
  server.listen(Number(arg("port")), "127.0.0.1", () => {
    process.stdout.write(`stub runner serving on ${arg("port")}\n`);
  });
}, delay);