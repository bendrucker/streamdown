import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Streamdown } from "../index";

const COMMENT = /\/\*[\s\S]*?\*\//g;
const SUPPRESSION_RULE = /([^}]*)\{\s*content:\s*none;\s*\}/;

// Commas inside :is() and :has() do not separate selectors.
const splitTopLevel = (selectorList: string) => {
  const selectors: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of selectorList) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      selectors.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  selectors.push(current);
  return selectors;
};

// The caret is suppressed by styles.css rather than by a container class, so the
// assertions below run the shipped selectors against the rendered DOM. Reading
// them out of the stylesheet keeps the tests honest: a selector that stops
// matching what Streamdown renders fails here.
const CARET_SUPPRESSION_SELECTORS = (() => {
  const css = readFileSync(
    path.join(import.meta.dirname, "../styles.css"),
    "utf8"
  ).replace(COMMENT, "");
  const rule = SUPPRESSION_RULE.exec(css);
  if (!rule) {
    throw new Error("no caret suppression rule found in styles.css");
  }
  return splitTopLevel(rule[1])
    .map((selector) => selector.replace("::after", "").trim())
    .filter(Boolean);
})();

const isCaretSuppressed = () =>
  CARET_SUPPRESSION_SELECTORS.some((selector) =>
    document.querySelector(selector)
  );

const caretVariable = (container: HTMLElement) =>
  container
    .querySelector<HTMLElement>('[data-streamdown="container"]')
    ?.style.getPropertyValue("--streamdown-caret");

describe("caret suppression", () => {
  it("suppresses the caret while a code fence is incomplete", () => {
    render(
      <Streamdown caret="block" isAnimating={true}>
        {"```javascript\nconst x = 1;"}
      </Streamdown>
    );

    expect(isCaretSuppressed()).toBe(true);
  });

  it("restores the caret once the code fence completes", () => {
    const { rerender } = render(
      <Streamdown caret="block" isAnimating={true}>
        {"```javascript\nconst x = 1;"}
      </Streamdown>
    );

    expect(isCaretSuppressed()).toBe(true);

    rerender(
      <Streamdown caret="block" isAnimating={true}>
        {"```javascript\nconst x = 1;\n```"}
      </Streamdown>
    );

    expect(isCaretSuppressed()).toBe(false);
  });

  it("suppresses the caret when the last block is a table", () => {
    render(
      <Streamdown caret="block" isAnimating={true}>
        {"| Name | Age |\n| --- | --- |\n| Alice | 30 |"}
      </Streamdown>
    );

    expect(isCaretSuppressed()).toBe(true);
  });

  it("suppresses the caret while a table is still streaming", () => {
    render(
      <Streamdown caret="block" isAnimating={true}>
        {"| Name | Age |\n| --- | --- |"}
      </Streamdown>
    );

    expect(isCaretSuppressed()).toBe(true);
  });

  it("shows the caret when a table is followed by regular text", () => {
    render(
      <Streamdown caret="block" isAnimating={true}>
        {
          "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n\nText after the table"
        }
      </Streamdown>
    );

    expect(isCaretSuppressed()).toBe(false);
  });

  it("shows the caret after a completed code block", () => {
    render(
      <Streamdown caret="block" isAnimating={true}>
        {"```javascript\nconst x = 1;\n```"}
      </Streamdown>
    );

    expect(isCaretSuppressed()).toBe(false);
  });

  it("suppresses the caret when blocks are wrapped for text direction", () => {
    render(
      <Streamdown caret="block" dir="auto" isAnimating={true}>
        {"| Name | Age |\n| --- | --- |\n| Alice | 30 |"}
      </Streamdown>
    );

    expect(isCaretSuppressed()).toBe(true);
  });

  it("keeps the container's className and style constant across block types", () => {
    const chunks = [
      "Some prose to start with.",
      "Some prose to start with.\n\n```javascript\nconst x = 1;",
      "Some prose to start with.\n\n```javascript\nconst x = 1;\n```",
      "Some prose to start with.\n\n```javascript\nconst x = 1;\n```\n\n| Name | Age |\n| --- | --- |",
      "Some prose to start with.\n\n```javascript\nconst x = 1;\n```\n\n| Name | Age |\n| --- | --- |\n| Alice | 30 |",
      "Some prose to start with.\n\n```javascript\nconst x = 1;\n```\n\n| Name | Age |\n| --- | --- |\n| Alice | 30 |\n\nAnd some more prose.",
    ];

    const { container, rerender } = render(
      <Streamdown caret="block" isAnimating={true}>
        {chunks[0]}
      </Streamdown>
    );

    const wrapper = container.querySelector<HTMLElement>(
      '[data-streamdown="container"]'
    );
    const className = wrapper?.className;
    const style = wrapper?.getAttribute("style");

    expect(className).toBeTruthy();
    expect(caretVariable(container)).toBe('" ▋"');

    for (const chunk of chunks.slice(1)) {
      rerender(
        <Streamdown caret="block" isAnimating={true}>
          {chunk}
        </Streamdown>
      );

      const next = container.querySelector<HTMLElement>(
        '[data-streamdown="container"]'
      );
      expect(next?.className).toBe(className);
      expect(next?.getAttribute("style")).toBe(style);
    }
  });
});
