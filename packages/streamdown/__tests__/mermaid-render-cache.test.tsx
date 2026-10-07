import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Streamdown } from "../index";
import { BlockIncompleteContext } from "../lib/block-incomplete-context";
import { Mermaid } from "../lib/mermaid";
import { renderMermaid } from "../lib/mermaid/render-cache";
import { PluginContext } from "../lib/plugin-context";
import type { DiagramPlugin, MermaidInstance } from "../lib/plugin-types";

// Embeds the render id the way Mermaid scopes its CSS and markers
const svgFor = (id: string) =>
  `<svg id="${id}"><style>#${id} .node{fill:red}</style><marker id="${id}_arrow"/></svg>`;

const createMockMermaidPlugin = (
  mockRender = vi.fn((id: string, _chart: string) =>
    Promise.resolve({ svg: svgFor(id) })
  )
) => {
  const mockMermaidInstance: MermaidInstance = {
    initialize: vi.fn(),
    render: mockRender,
  };
  const plugin: DiagramPlugin = {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid: vi.fn().mockReturnValue(mockMermaidInstance),
  };
  return { plugin, mockRender };
};

const SVG_ID_REGEX = /<svg id="([^"]+)"/;

const chart = "graph TD;\n    A-->B;\n    B-->C;";

describe("Mermaid render cache", () => {
  it("lays a diagram out once when a finished stream switches to static mode", async () => {
    const { plugin, mockRender } = createMockMermaidPlugin();
    const markdown = `Intro\n\n\`\`\`mermaid\n${chart}\n\`\`\`\n`;
    const rendersOf = (source: string) =>
      mockRender.mock.calls.filter(([, rendered]) => rendered.trim() === source)
        .length;

    const { container, rerender } = render(
      <Streamdown isAnimating mode="streaming" plugins={{ mermaid: plugin }}>
        {markdown.slice(0, 20)}
      </Streamdown>
    );
    for (let end = 30; end < markdown.length; end += 10) {
      rerender(
        <Streamdown isAnimating mode="streaming" plugins={{ mermaid: plugin }}>
          {markdown.slice(0, end)}
        </Streamdown>
      );
    }
    rerender(
      <Streamdown
        isAnimating={false}
        mode="streaming"
        plugins={{ mermaid: plugin }}
      >
        {markdown}
      </Streamdown>
    );
    await waitFor(() => expect(rendersOf(chart)).toBe(1));

    rerender(
      <Streamdown mode="static" plugins={{ mermaid: plugin }}>
        {markdown}
      </Streamdown>
    );
    await waitFor(() => {
      expect(
        container.querySelector('[role="img"] svg[id^="mermaid-"]')
      ).toBeTruthy();
    });
    expect(rendersOf(chart)).toBe(1);
  });

  it("keeps only the finished chart of a stream", async () => {
    const { plugin, mockRender } = createMockMermaidPlugin();
    const partial = "graph TD;\n    A-->B;";
    const streaming = (source: string, fenceOpen: boolean) => (
      <PluginContext.Provider value={{ mermaid: plugin }}>
        <BlockIncompleteContext.Provider value={fenceOpen}>
          <Mermaid chart={source} />
        </BlockIncompleteContext.Provider>
      </PluginContext.Provider>
    );

    const { rerender } = render(streaming(partial, true));
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(1));
    rerender(streaming(chart, false));
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(2));

    await renderMermaid(plugin, chart);
    expect(mockRender).toHaveBeenCalledTimes(2);
    await renderMermaid(plugin, partial);
    expect(mockRender).toHaveBeenCalledTimes(3);
  });

  it("gives every cached copy its own render id", async () => {
    const { plugin, mockRender } = createMockMermaidPlugin();

    const first = await renderMermaid(plugin, chart);
    const second = await renderMermaid(plugin, chart);

    expect(mockRender).toHaveBeenCalledTimes(1);
    const [firstId] = mockRender.mock.calls[0];
    const secondId = second.match(SVG_ID_REGEX)?.[1];
    expect(first).toBe(svgFor(firstId));
    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(firstId);
    expect(second).toBe(svgFor(secondId as string));
  });

  it("shares one layout between concurrent renders of the same chart", async () => {
    const { plugin, mockRender } = createMockMermaidPlugin();

    await Promise.all([
      renderMermaid(plugin, chart),
      renderMermaid(plugin, chart),
    ]);

    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it("renders again after a failure", async () => {
    const { plugin, mockRender } = createMockMermaidPlugin();
    mockRender.mockRejectedValueOnce(new Error("Parse error"));

    await expect(renderMermaid(plugin, chart)).rejects.toThrow("Parse error");
    await renderMermaid(plugin, chart);

    expect(mockRender).toHaveBeenCalledTimes(2);
  });

  it("renders again when the config changes", async () => {
    const { plugin, mockRender } = createMockMermaidPlugin();

    await renderMermaid(plugin, chart, { theme: "default" });
    await renderMermaid(plugin, chart, { theme: "dark" });
    await renderMermaid(plugin, chart, { theme: "dark" });

    expect(mockRender).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used chart", async () => {
    const { plugin, mockRender } = createMockMermaidPlugin();

    await renderMermaid(plugin, "graph TD; first");
    for (let i = 0; i < 32; i += 1) {
      await renderMermaid(plugin, `graph TD; filler${i}`);
    }
    await renderMermaid(plugin, "graph TD; first");

    expect(
      mockRender.mock.calls.filter(([, source]) => source === "graph TD; first")
    ).toHaveLength(2);
  });
});
