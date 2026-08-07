#!/usr/bin/env node
/**
 * Attributes main-thread CPU time from a Chrome trace to the packages in the
 * streaming render path, then to individual functions.
 *
 * Sampled frames point at minified chunks, so frames are resolved back through
 * the build's source maps (`productionBrowserSourceMaps`) before bucketing.
 *
 * Usage: node --max-old-space-size=8192 scripts/analyze-trace.mjs <trace.json> [--top 30]
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

const CHUNK_URL_PATTERN = /\/_next\/(.*\.js)(\?|$)/;
const SOURCE_MAPPING_PATTERN = /sourceMappingURL=(\S+)/;
const NODE_MODULES_PREFIX = /^.*node_modules\//;
const PACKAGES_PREFIX = /^.*\/packages\//;

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../.next");

const [tracePath, ...rest] = process.argv.slice(2);
if (!tracePath) {
  process.stderr.write("usage: analyze-trace.mjs <trace.json> [--top N]\n");
  process.exit(1);
}
const topIndex = rest.indexOf("--top");
const top = topIndex === -1 ? 30 : Number(rest[topIndex + 1]);

const trace = JSON.parse(readFileSync(tracePath, "utf8"));
const events = Array.isArray(trace) ? trace : trace.traceEvents;

const traceMaps = new Map();
const mapFor = (url) => {
  if (traceMaps.has(url)) {
    return traceMaps.get(url);
  }
  let map = null;
  const match = url.match(CHUNK_URL_PATTERN);
  if (match) {
    try {
      // Turbopack names map files independently of their chunk, so the chunk's
      // own sourceMappingURL comment is the only reliable link.
      const chunkPath = resolve(staticRoot, match[1]);
      const tail = readFileSync(chunkPath, "utf8").slice(-2048);
      const mapName = tail.match(SOURCE_MAPPING_PATTERN)?.[1];
      if (mapName) {
        map = new TraceMap(
          readFileSync(resolve(dirname(chunkPath), mapName), "utf8")
        );
      }
    } catch {
      map = null;
    }
  }
  traceMaps.set(url, map);
  return map;
};

/** Minified chunk frame -> original source path, when a source map covers it. */
const originalSource = (url, line, column) => {
  const map = mapFor(url);
  if (!map) {
    return null;
  }
  const position = originalPositionFor(map, {
    line: (line ?? 0) + 1,
    column: column ?? 0,
  });
  return position.source ?? null;
};

// Ordered: the first matching pattern wins, so specific packages are listed
// before the generic runtimes that call them.
const buckets = [
  ["remend", /(^|\/)remend\//],
  [
    "marked (parse-blocks)",
    /node_modules\/marked|streamdown\/lib\/parse-blocks/,
  ],
  ["shiki", /shiki|oniguruma|vscode-textmate/],
  ["katex", /katex/],
  ["mermaid", /mermaid/],
  ["micromark (markdown parse)", /micromark|mdast-util-from-markdown/],
  ["remark plugins", /remark-gfm|mdast-util-gfm|remark-parse/],
  ["mdast -> hast", /remark-rehype|mdast-util-to-hast/],
  ["rehype-raw / parse5", /rehype-raw|hast-util-raw|parse5/],
  ["rehype sanitize", /rehype-sanitize|hast-util-sanitize/],
  ["rehype-harden", /rehype-harden/],
  ["hast -> jsx", /hast-util-to-jsx-runtime/],
  ["unified / unist", /node_modules\/unified|unist-util|node_modules\/vfile/],
  ["streamdown", /streamdown/],
  ["react-dom + scheduler", /react-dom|node_modules\/scheduler/],
  ["react", /node_modules\/react\//],
  ["tailwind-merge / clsx", /tailwind-merge|clsx/],
  ["next runtime", /node_modules\/next\//],
  ["bench harness", /app\/bench\//],
];

const bucketFor = (source, url, functionName) => {
  if (source) {
    for (const [name, pattern] of buckets) {
      if (pattern.test(source)) {
        return name;
      }
    }
    return `other: ${source
      .replace(NODE_MODULES_PREFIX, "")
      .split("/")
      .slice(0, 2)
      .join("/")}`;
  }
  if (!url) {
    return functionName.startsWith("RegExp:")
      ? "engine: regexp"
      : "engine / gc / internal";
  }
  return "unmapped chunk";
};

let totalSelf = 0;
let attributedSelf = 0;
const nodeIndex = new Map();
const byBucket = new Map();
const byFunction = new Map();

const addSelf = (map, key, ms) => {
  map.set(key, (map.get(key) ?? 0) + ms);
};

const IDLE_FRAMES = new Set(["(idle)", "(program)", "(root)"]);

for (const event of events) {
  if (event.name !== "Profile" && event.name !== "ProfileChunk") {
    continue;
  }
  const profile = event.args?.data?.cpuProfile;
  const timeDeltas = event.args?.data?.timeDeltas;
  if (!(profile && timeDeltas)) {
    continue;
  }
  for (const node of profile.nodes ?? []) {
    nodeIndex.set(node.id, node);
  }

  const samples = profile.samples ?? [];
  for (let i = 0; i < samples.length; i += 1) {
    const node = nodeIndex.get(samples[i]);
    const deltaMs = (timeDeltas[i] ?? 0) / 1000;
    if (!(node && deltaMs > 0)) {
      continue;
    }
    const frame = node.callFrame ?? {};
    const name = frame.functionName || "(anonymous)";
    totalSelf += deltaMs;
    if (IDLE_FRAMES.has(name)) {
      continue;
    }
    attributedSelf += deltaMs;

    const url = frame.url ?? "";
    const source = originalSource(url, frame.lineNumber, frame.columnNumber);
    addSelf(byBucket, bucketFor(source, url, name), deltaMs);
    const location = source
      ? source.replace(NODE_MODULES_PREFIX, "").replace(PACKAGES_PREFIX, "")
      : url.split("/").pop() || "engine";
    addSelf(byFunction, `${name} — ${location}`, deltaMs);
  }
}

/**
 * Stalls are not always JavaScript. Chrome reports style recalculation and
 * layout as their own timeline events, and a whole-document recalculation
 * shows up here rather than in any package's sampled time.
 */
const slowEvents = (thresholdMs) => {
  const byName = new Map();
  for (const event of events) {
    const ms = (event.dur ?? 0) / 1000;
    if (event.ph !== "X" || ms < thresholdMs) {
      continue;
    }
    const entry = byName.get(event.name) ?? {
      count: 0,
      ms: 0,
      worst: 0,
      elements: 0,
    };
    entry.count += 1;
    entry.ms += ms;
    if (ms > entry.worst) {
      entry.worst = ms;
      entry.elements =
        event.args?.elementCount ?? event.args?.beginData?.elementCount ?? 0;
    }
    byName.set(event.name, entry);
  }
  return byName;
};

const rows = (map) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, ms]) => ({ key, ms, share: (ms / attributedSelf) * 100 }));

const render = (title, entries, limit) => {
  process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
  for (const row of entries.slice(0, limit)) {
    process.stdout.write(
      `${row.share.toFixed(1).padStart(5)}%  ${row.ms.toFixed(0).padStart(7)}ms  ${row.key}\n`
    );
  }
};

process.stdout.write(
  `sampled main-thread time: ${totalSelf.toFixed(0)}ms (${attributedSelf.toFixed(0)}ms busy, ${(totalSelf - attributedSelf).toFixed(0)}ms idle)\n` +
    "shares below are of busy time\n"
);
render("By package (self time)", rows(byBucket), 40);
render("By function (self time)", rows(byFunction), top);

const slow = slowEvents(50);
if (slow.size > 0) {
  process.stdout.write(
    "\nTimeline events over 50ms\n-------------------------\n"
  );
  for (const [name, entry] of [...slow.entries()].sort(
    (a, b) => b[1].ms - a[1].ms
  )) {
    const elements = entry.elements
      ? `, worst touched ${entry.elements} elements`
      : "";
    process.stdout.write(
      `${String(entry.count).padStart(5)}x  ${entry.ms.toFixed(0).padStart(7)}ms  ${name} (worst ${entry.worst.toFixed(0)}ms${elements})\n`
    );
  }
}
