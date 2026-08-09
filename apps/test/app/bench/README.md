# Streaming Bench Harness

A repeatable way to measure what streaming markdown costs in a real browser:
frame drops, long tasks, per-phase CPU, and where the main thread actually goes.

`/bench` renders a generated document through `<Streamdown>` one chunk at a
time, on a fixed cadence, while recording frame intervals, long tasks, React
commits, and the time spent in healing and block segmentation. A driver script
runs scenarios through agent-browser and can capture a Chrome trace.

## Running

```bash
# Build apps/test and (re)start the production server the harness measures.
apps/test/scripts/bench-server.sh

# Run every scenario.
cd apps/test && node scripts/profile-stream.mjs

# Run some scenarios and capture a trace for one of them.
node scripts/profile-stream.mjs --only mixed-60k --trace mixed-60k

# Attribute the trace's main-thread time to packages and functions.
node --max-old-space-size=8192 scripts/analyze-trace.mjs ../../tmp/bench/mixed-60k.trace.json

# Run a scenario with the CPU slowed to a quarter of this machine's speed.
node scripts/profile-stream.mjs --only mixed-60k --throttle 4
```

Summaries land in `tmp/bench/summaries.json`. Scenarios live at the top of
`scripts/profile-stream.mjs`.

## Measuring in Production Mode

Numbers come from a production build, not `next dev`. React's development build
changes the render cost enough to move conclusions. `apps/test/next.config.ts`
turns on `reactProductionProfiling` so `<Profiler>` still reports commit
durations, and `productionBrowserSourceMaps` so sampled frames resolve back to
their package instead of a minified chunk name.

Streamdown's own bundle needs `STREAMDOWN_SOURCEMAP=1 pnpm --filter streamdown
build` to appear in the attribution.

## Trusting a Comparison

A Next server left running keeps serving its previous build, which silently
turns an A/B comparison into two copies of A. The driver guards against this by
timing `remend` in isolation before each run and printing the result, so a
build swap is visible in the output. `bench-server.sh` clears the port and
Turbopack's cache before starting, since that cache survives a change to a
workspace dependency and the isolation timing cannot tell you about a build you
never produced.

## Throttling the CPU

A development machine has far more headroom than the devices that struggle with
streaming markdown, and at full speed a change can remove real work without
moving a single dropped frame. `--throttle 4` runs the scenario with Chrome's
CPU slowed fourfold, which is where that work starts to cost frames.

The driver times a fixed loop in the page under throttling and prints it next
to the unthrottled time, because Chrome discards the override if its client
detaches and nothing else in the output distinguishes a run that lost its
throttle from one that never had it.

## What the Numbers Mean

- `frames.dropped` counts intervals longer than 1.5x the run's median frame.
  It is the closest thing here to what a viewer perceives.
- `longTasks` come from `PerformanceObserver`. Tasks over 50ms are what read as
  a visible stall. They are not always JavaScript, so check the trace's
  `UpdateLayoutTree` events before assuming a JS cause.
- `phases` are direct wall-clock measurements around healing and block
  segmentation, not sampled estimates. Prefer them over trace attribution when
  the two disagree.
- `commits` come from React's `<Profiler>`. Commits per tick above one means
  a token produces more than one render pass.

## Instrumentation Cost

Phase timing uses two `performance.now()` calls. `performance.mark` and
`performance.measure` cost roughly as much as the cheaper phases they wrap, so
they are off unless a scenario sets `userTiming: true` to put phases on the
trace timeline.
