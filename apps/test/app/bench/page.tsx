"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import {
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import remend from "remend";
import {
  createIncrementalBlockParser,
  parseMarkdownIntoBlocks,
  Streamdown,
} from "streamdown";
import "streamdown/styles.css";
import { buildDocument, type DocumentShape } from "./document";
import { Recorder, type RunSummary } from "./metrics";

interface RunConfig {
  animated?: boolean;
  caret?: boolean;
  chars?: number;
  /** Characters appended per tick. */
  chunk?: number;
  dir?: "auto" | "ltr" | "rtl";
  /** Segment blocks by re-lexing only the tail of an append-only stream. */
  incrementalBlocks?: boolean;
  /** Milliseconds between ticks. 0 streams as fast as animation frames allow. */
  interval?: number;
  label?: string;
  mode?: "streaming" | "static";
  parseIncompleteMarkdown?: boolean;
  plugins?: ("code" | "math" | "mermaid" | "cjk")[];
  seed?: number;
  shape?: DocumentShape;
  /** Emit performance.measure entries so phases show on a Chrome trace timeline. */
  userTiming?: boolean;
}

interface ResolvedConfig extends Required<Omit<RunConfig, "label">> {
  label: string;
}

const defaults: ResolvedConfig = {
  label: "default",
  shape: "mixed",
  chars: 20_000,
  chunk: 24,
  interval: 16,
  animated: true,
  caret: true,
  dir: "ltr",
  plugins: [],
  mode: "streaming",
  parseIncompleteMarkdown: true,
  seed: 42,
  userTiming: false,
  incrementalBlocks: false,
};

const pluginRegistry = { code, math, mermaid, cjk };

declare global {
  interface Window {
    streamdownBench?: {
      run: (config?: RunConfig) => Promise<RunSummary>;
      state: () => "idle" | "running" | "done";
      last: () => RunSummary | null;
      /** Exposed so a driver can time healing in isolation from rendering. */
      remend: typeof remend;
      buildDocument: typeof buildDocument;
    };
  }
}

const recorder = new Recorder();

const BenchPage = () => {
  const [text, setText] = useState("");
  const [config, setConfig] = useState<ResolvedConfig>(defaults);
  const [isStreaming, setIsStreaming] = useState(false);
  const incrementalRef = useRef<ReturnType<
    typeof createIncrementalBlockParser
  > | null>(null);

  const incremental = useMemo(
    () => (config.incrementalBlocks ? createIncrementalBlockParser() : null),
    [config.incrementalBlocks]
  );
  incrementalRef.current = incremental;

  // Streamdown segments incrementally on its own, but only when it is left to
  // pick the segmenter. Timing the phase means supplying one, so the harness
  // supplies whichever side of the comparison the scenario asks for.
  const instrumentedParseBlocks = useCallback((markdown: string) => {
    const parser = incrementalRef.current;
    return recorder.phase("parseBlocks", () =>
      parser ? parser(markdown) : parseMarkdownIntoBlocks(markdown)
    );
  }, []);

  const healed = useMemo(() => {
    if (!(config.parseIncompleteMarkdown && config.mode === "streaming")) {
      return text;
    }
    return recorder.phase("remend", () => remend(text));
  }, [text, config.parseIncompleteMarkdown, config.mode]);

  const activePlugins = useMemo(() => {
    if (config.plugins.length === 0) {
      return;
    }
    return Object.fromEntries(
      config.plugins.map((name) => [name, pluginRegistry[name]])
    );
  }, [config.plugins]);

  const onRender = useCallback(
    (
      _id: string,
      _phase: "mount" | "update" | "nested-update",
      actualDuration: number
    ) => {
      recorder.commit(actualDuration);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    let lastSummary: RunSummary | null = null;
    let benchState: "idle" | "running" | "done" = "idle";

    const run = (input: RunConfig = {}) => {
      const resolved: ResolvedConfig = {
        ...defaults,
        ...input,
        label: input.label ?? "default",
      };
      const document = buildDocument(
        resolved.shape,
        resolved.chars,
        resolved.seed
      );

      setConfig(resolved);
      setText("");
      setIsStreaming(true);

      return new Promise<RunSummary>((resolve) => {
        // One frame of settle time so the reset commit is not measured.
        requestAnimationFrame(() => {
          recorder.start({ userTiming: resolved.userTiming });
          let cursor = 0;

          const finish = () => {
            recorder.stop();
            setIsStreaming(false);
            const summary = recorder.summary(
              resolved.label,
              { ...resolved },
              document.length
            );
            lastSummary = summary;
            benchState = "done";
            resolve(summary);
          };

          const step = () => {
            if (cancelled) {
              finish();
              return;
            }
            cursor = Math.min(document.length, cursor + resolved.chunk);
            recorder.tick();
            setText(document.slice(0, cursor));

            if (cursor >= document.length) {
              // Let the final commit paint before sealing the numbers.
              requestAnimationFrame(() => requestAnimationFrame(finish));
              return;
            }

            if (resolved.interval > 0) {
              setTimeout(step, resolved.interval);
            } else {
              requestAnimationFrame(step);
            }
          };

          benchState = "running";
          step();
        });
      });
    };

    window.streamdownBench = {
      run,
      state: () => benchState,
      last: () => lastSummary,
      remend,
      buildDocument,
    };

    return () => {
      cancelled = true;
      window.streamdownBench = undefined;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div
        className="fixed top-2 right-2 rounded bg-black/80 px-2 py-1 font-mono text-white text-xs"
        data-testid="bench-status"
      >
        {isStreaming ? "streaming" : "idle"} · {text.length} chars
      </div>
      <Profiler id="streamdown" onRender={onRender}>
        <Streamdown
          animated={config.animated}
          caret={config.caret ? "block" : undefined}
          dir={config.dir}
          isAnimating={isStreaming}
          mode={config.mode}
          parseIncompleteMarkdown={false}
          parseMarkdownIntoBlocksFn={instrumentedParseBlocks}
          plugins={activePlugins}
        >
          {healed}
        </Streamdown>
      </Profiler>
    </div>
  );
};

export default BenchPage;
