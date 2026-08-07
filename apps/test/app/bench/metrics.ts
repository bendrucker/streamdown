import type { IncrementalStats } from "./incremental-blocks";

export interface PhaseStats {
  calls: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  total: number;
}

export interface FrameStats {
  /** Frames whose interval exceeded two display intervals, i.e. at least one missed paint. */
  dropped: number;
  droppedRatio: number;
  durationMs: number;
  fps: number;
  frames: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface RunSummary {
  blockParser?: IncrementalStats;
  chars: number;
  commits: { count: number; actualTotal: number; actualMax: number };
  config: Record<string, unknown>;
  frames: FrameStats;
  label: string;
  longTasks: { count: number; total: number; max: number };
  phases: Record<string, PhaseStats>;
  ticks: number;
}

const percentile = (sorted: number[], q: number) => {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((q / 100) * sorted.length) - 1)
  );
  return sorted[index];
};

const summarize = (samples: number[]): PhaseStats => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    calls: samples.length,
    total: samples.reduce((sum, value) => sum + value, 0),
    max: sorted.at(-1) ?? 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
};

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const roundPhase = (stats: PhaseStats): PhaseStats => ({
  calls: stats.calls,
  total: round(stats.total),
  max: round(stats.max),
  p50: round(stats.p50),
  p95: round(stats.p95),
  p99: round(stats.p99),
});

export class Recorder {
  private frameTimes: number[] = [];
  private lastFrame = 0;
  private startedAt = 0;
  private endedAt = 0;
  private rafHandle = 0;
  private longTaskObserver: PerformanceObserver | null = null;
  private longTasks: number[] = [];
  private readonly phaseSamples = new Map<string, number[]>();
  private commitCount = 0;
  private commitActual = 0;
  private commitActualMax = 0;
  private ticks = 0;
  private recording = false;
  private emitUserTiming = false;

  start(options: { userTiming?: boolean } = {}) {
    this.emitUserTiming = options.userTiming ?? false;
    this.frameTimes = [];
    this.longTasks = [];
    this.phaseSamples.clear();
    this.commitCount = 0;
    this.commitActual = 0;
    this.commitActualMax = 0;
    this.ticks = 0;
    this.lastFrame = 0;
    this.startedAt = performance.now();
    this.endedAt = 0;
    this.recording = true;

    if (typeof PerformanceObserver !== "undefined") {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.longTasks.push(entry.duration);
          }
        });
        this.longTaskObserver.observe({ entryTypes: ["longtask"] });
      } catch {
        this.longTaskObserver = null;
      }
    }

    const onFrame = (timestamp: number) => {
      if (!this.recording) {
        return;
      }
      if (this.lastFrame > 0) {
        this.frameTimes.push(timestamp - this.lastFrame);
      }
      this.lastFrame = timestamp;
      this.rafHandle = requestAnimationFrame(onFrame);
    };
    this.rafHandle = requestAnimationFrame(onFrame);
  }

  stop() {
    this.recording = false;
    this.endedAt = performance.now();
    cancelAnimationFrame(this.rafHandle);
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
  }

  tick() {
    this.ticks += 1;
  }

  /**
   * User-timing entries cost roughly as much as the cheaper phases they
   * measure, so they are only emitted when a run explicitly wants them on the
   * trace timeline.
   */
  phase<T>(name: string, fn: () => T): T {
    if (!this.recording) {
      return fn();
    }
    const start = performance.now();
    try {
      if (this.emitUserTiming) {
        performance.mark(`${name}-start`);
      }
      return fn();
    } finally {
      const duration = performance.now() - start;
      const samples = this.phaseSamples.get(name);
      if (samples) {
        samples.push(duration);
      } else {
        this.phaseSamples.set(name, [duration]);
      }
      if (this.emitUserTiming) {
        performance.measure(name, `${name}-start`);
        performance.clearMarks(`${name}-start`);
        performance.clearMeasures(name);
      }
    }
  }

  commit(actualDuration: number) {
    if (!this.recording) {
      return;
    }
    this.commitCount += 1;
    this.commitActual += actualDuration;
    this.commitActualMax = Math.max(this.commitActualMax, actualDuration);
  }

  summary(label: string, config: Record<string, unknown>, chars: number) {
    const durationMs = (this.endedAt || performance.now()) - this.startedAt;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = percentile(sorted, 50) || 16.7;
    const dropThreshold = median * 1.5;
    const dropped = this.frameTimes.filter(
      (delta) => delta > dropThreshold
    ).length;

    const phases: Record<string, PhaseStats> = {};
    for (const [name, samples] of this.phaseSamples) {
      phases[name] = roundPhase(summarize(samples));
    }

    const summary: RunSummary = {
      label,
      config,
      chars,
      ticks: this.ticks,
      frames: {
        frames: this.frameTimes.length,
        durationMs: round(durationMs),
        fps: round((this.frameTimes.length / durationMs) * 1000),
        p50: round(percentile(sorted, 50)),
        p95: round(percentile(sorted, 95)),
        p99: round(percentile(sorted, 99)),
        max: round(sorted.at(-1) ?? 0),
        dropped,
        droppedRatio: round(dropped / Math.max(1, this.frameTimes.length), 4),
      },
      longTasks: {
        count: this.longTasks.length,
        total: round(this.longTasks.reduce((sum, value) => sum + value, 0)),
        max: round(Math.max(0, ...this.longTasks)),
      },
      phases,
      commits: {
        count: this.commitCount,
        actualTotal: round(this.commitActual),
        actualMax: round(this.commitActualMax),
      },
    };

    return summary;
  }
}
