#!/usr/bin/env node
/**
 * Drives the /bench harness through agent-browser and writes one JSON summary
 * per scenario, plus an optional Chrome trace for the scenarios that ask for it.
 *
 * Usage:
 *   node scripts/profile-stream.mjs [--url http://localhost:3001/bench]
 *                                   [--out ../../tmp/bench]
 *                                   [--only <scenario,scenario>]
 *                                   [--trace <scenario>]
 *                                   [--throttle <cpu slowdown multiplier>]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { throttleCpu } from "./cpu-throttle.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const url = readFlag("url", "http://localhost:3001/bench");
const outDir = resolve(here, readFlag("out", "../../../tmp/bench"));
const session = readFlag("session", "sd-perf");
const only = readFlag("only", "").split(",").filter(Boolean);
const traceScenario = readFlag("trace", "");
const throttle = Number(readFlag("throttle", "1"));

export const scenarios = [
  { label: "prose-20k", shape: "prose", chars: 20_000 },
  { label: "mixed-20k", shape: "mixed", chars: 20_000 },
  { label: "mixed-60k", shape: "mixed", chars: 60_000 },
  {
    label: "mixed-20k-no-animate",
    shape: "mixed",
    chars: 20_000,
    animated: false,
  },
  {
    label: "mixed-20k-no-remend",
    shape: "mixed",
    chars: 20_000,
    parseIncompleteMarkdown: false,
  },
  { label: "mixed-20k-dir-auto", shape: "mixed", chars: 20_000, dir: "auto" },
  {
    label: "mixed-60k-no-remend",
    shape: "mixed",
    chars: 60_000,
    parseIncompleteMarkdown: false,
  },
  { label: "mixed-60k-no-caret", shape: "mixed", chars: 60_000, caret: false },
  { label: "prose-60k", shape: "prose", chars: 60_000 },
  {
    label: "mixed-60k-incremental",
    shape: "mixed",
    chars: 60_000,
    incrementalBlocks: true,
  },
  { label: "code-20k", shape: "code", chars: 20_000 },
  { label: "code-20k-shiki", shape: "code", chars: 20_000, plugins: ["code"] },
  { label: "table-20k", shape: "table", chars: 20_000 },
];

const browser = (...commandArgs) =>
  execFileSync("agent-browser", ["--session", session, ...commandArgs], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

const evaluate = (source) =>
  execFileSync("agent-browser", ["--session", session, "eval", "--stdin"], {
    encoding: "utf8",
    input: source,
    maxBuffer: 256 * 1024 * 1024,
  });

const parseJson = (output, label) => {
  const start = output.indexOf("{");
  if (start === -1) {
    throw new Error(`no JSON in eval output for ${label}: ${output}`);
  }
  return JSON.parse(output.slice(start));
};

// Blocking sleep that idles the thread, so polling never competes with the
// browser for CPU while a run is being measured.
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => {
  Atomics.wait(sleeper, 0, 0, ms);
};

// Runs are polled rather than awaited so a long scenario cannot trip the
// eval command's own timeout.
const drive = (scenario) => {
  evaluate(
    `window.streamdownBench.run(${JSON.stringify(scenario)}); "started"`
  );
  for (let attempt = 0; attempt < 600; attempt += 1) {
    sleep(500);
    const state = evaluate("window.streamdownBench.state()");
    if (state.includes("done")) {
      return parseJson(
        evaluate("window.streamdownBench.last()"),
        scenario.label
      );
    }
  }
  throw new Error(`scenario ${scenario.label} never finished`);
};

mkdirSync(outDir, { recursive: true });

// A server left running against an older build keeps serving it, which silently
// invalidates a comparison. Timing remend in isolation identifies the build.
const fingerprint = () => {
  browser("open", url);
  const output = evaluate(`(() => {
    const bench = window.streamdownBench;
    const doc = bench.buildDocument("mixed", 60000, 42);
    return [10000, 30000, 60000].map((size) => {
      const input = doc.slice(0, size);
      bench.remend(input);
      const start = performance.now();
      for (let i = 0; i < 5; i += 1) { bench.remend(input); }
      return Math.round(((performance.now() - start) / 5) * 100) / 100;
    });
  })()`);
  return JSON.parse(output.slice(output.indexOf("[")));
};

// Emulation overrides are silently dropped if the CDP client detaches, and a
// run that lost its throttle is indistinguishable from one that never had it.
// Timing a fixed loop in the page makes the rate observable rather than assumed.
const spinMs = () => {
  const output = evaluate(`(() => {
    const start = performance.now();
    let total = 0;
    for (let i = 0; i < 20000000; i += 1) { total += i % 7; }
    return { ms: Math.round(performance.now() - start), total };
  })()`);
  return parseJson(output, "spin").ms;
};

const remendMs = fingerprint();
const unthrottledSpinMs = throttle === 1 ? null : spinMs();
process.stdout.write(
  `remend in isolation (10k/30k/60k chars): ${remendMs.join("ms / ")}ms\n` +
    `cpu throttling: ${throttle}x\n\n`
);

const selected = scenarios.filter(
  (scenario) => only.length === 0 || only.includes(scenario.label)
);

const summaries = [];
for (const scenario of selected) {
  const tracing = traceScenario === scenario.label;
  // Reload between scenarios so processor caches and shiki state start cold.
  browser("open", url);
  const throttling =
    throttle === 1 ? null : await throttleCpu({ session, url, rate: throttle });
  if (throttling) {
    process.stdout.write(
      `${scenario.label.padEnd(24)} fixed loop under ${throttle}x: ${spinMs()}ms ` +
        `(unthrottled ${unthrottledSpinMs}ms)\n`
    );
  }
  if (tracing) {
    // Only the categories the analyzer reads. The default set produces
    // multi-hundred-megabyte traces for a 15 second run.
    browser(
      "profiler",
      "start",
      "--categories",
      "disabled-by-default-v8.cpu_profiler,devtools.timeline,blink.user_timing"
    );
  }
  const summary = drive(scenario);
  if (tracing) {
    browser(
      "profiler",
      "stop",
      resolve(outDir, `${scenario.label}.trace.json`)
    );
  }
  throttling?.close();
  summaries.push(summary);
  process.stdout.write(
    `${scenario.label.padEnd(24)} fps=${String(summary.frames.fps).padStart(6)} ` +
      `p95=${String(summary.frames.p95).padStart(7)}ms dropped=${String(summary.frames.dropped).padStart(4)} ` +
      `longtasks=${String(summary.longTasks.count).padStart(4)} (${summary.longTasks.total}ms)\n`
  );
}

writeFileSync(
  resolve(outDir, "summaries.json"),
  `${JSON.stringify({ remendMs, throttle, summaries }, null, 2)}\n`
);
process.stdout.write(`\nwrote ${resolve(outDir, "summaries.json")}\n`);
