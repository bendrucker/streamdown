import { render } from "@testing-library/react";
import { type ComponentProps, useContext } from "react";
import { describe, expect, it } from "vitest";
import {
  type LinkSafetyConfig,
  Streamdown,
  StreamdownContext,
  type StreamdownContextType,
} from "../index";

const MermaidError = () => <div>error</div>;

// Inline option objects get a new identity on every parent render. Before
// structural stabilization, each streamed token produced a new context value,
// which re-rendered every context consumer, including finished blocks that
// Block's memo would otherwise skip.
describe("Streamdown context stability with inline option objects", () => {
  const renderCounts = new Map<string, number>();

  const CountingCode = ({ children }: ComponentProps<"code">) => {
    useContext(StreamdownContext);
    const key = String(children);
    renderCounts.set(key, (renderCounts.get(key) ?? 0) + 1);
    return <code>{children}</code>;
  };

  const components = { code: CountingCode };

  const Parent = ({ markdown }: { markdown: string }) => (
    <Streamdown
      components={components}
      controls={{ mermaid: { download: false }, code: { copy: true } }}
      isAnimating
      linkSafety={{ enabled: false }}
      mermaid={{ errorComponent: MermaidError, config: { theme: "dark" } }}
      mode="streaming"
      shikiTheme={["github-light", "github-dark"]}
    >
      {markdown}
    </Streamdown>
  );

  it("does not re-render a finished code block while a later paragraph streams", () => {
    renderCounts.clear();
    const head = "```js\nconst done = true;\n```\n\n";
    const { rerender } = render(<Parent markdown={`${head}Streaming`} />);

    const finished = "const done = true;\n";
    const initial = renderCounts.get(finished) ?? 0;
    expect(initial).toBeGreaterThan(0);

    for (const token of [" more", " text", " arrives"]) {
      rerender(<Parent markdown={`${head}Streaming${token}`} />);
    }

    expect(renderCounts.get(finished)).toBe(initial);
  });

  it.each<{
    name: string;
    before: LinkSafetyConfig;
    after: LinkSafetyConfig;
  }>([
    {
      name: "a changed value",
      before: { enabled: true },
      after: { enabled: false },
    },
    {
      name: "a new callback",
      before: { enabled: true, onLinkCheck: () => true },
      after: { enabled: true, onLinkCheck: () => false },
    },
  ])("propagates $name in an option object", ({ before, after }) => {
    const seen: StreamdownContextType["linkSafety"][] = [];
    const Probe = ({ children }: ComponentProps<"code">) => {
      seen.push(useContext(StreamdownContext).linkSafety);
      return <code>{children}</code>;
    };
    const probeComponents = { code: Probe };

    const { rerender } = render(
      <Streamdown components={probeComponents} linkSafety={{ ...before }}>
        {"`x`"}
      </Streamdown>
    );
    rerender(
      <Streamdown components={probeComponents} linkSafety={{ ...after }}>
        {"`x`"}
      </Streamdown>
    );

    expect(seen.at(-1)).toEqual(after);
  });
});
