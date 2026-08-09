import remend from "remend";
import { describe, expect, it } from "vitest";
import { createIncrementalBlockParser } from "../lib/incremental-blocks";
import { parseMarkdownIntoBlocks } from "../lib/parse-blocks";

interface Mismatch {
  chars: number;
  full: string[];
  incremental: string[];
}

// Reuse is only sound if it is indistinguishable from a full re-parse, so the
// cases below stream a document and compare the two at every step rather than
// asserting on the blocks themselves. That holds the property for markdown the
// tests never thought of, and it is what justifies the size of the window the
// parser re-lexes: shrinking it to one block fails here.
const firstMismatch = (
  markdown: string,
  chunkSize: number,
  heal: (prefix: string) => string = (prefix) => prefix
): Mismatch | null => {
  const parse = createIncrementalBlockParser();
  for (let chars = 1; chars <= markdown.length; chars += chunkSize) {
    const prefix = heal(markdown.slice(0, chars));
    const incremental = parse(prefix);
    const full = parseMarkdownIntoBlocks(prefix);
    if (JSON.stringify(incremental) !== JSON.stringify(full)) {
      return { chars, incremental, full };
    }
  }
  return null;
};

const BACKWARD_MERGES = {
  "a table growing out of a paragraph":
    "Intro paragraph.\n\nOne\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nAfter.",
  "a setext heading claiming the paragraph above it":
    "First.\n\nSecond.\n\nThird.\n\nHeading text\n===\n\nAfter.",
  "a setext subheading":
    "First.\n\nSecond.\n\nThird.\n\nHeading text\n---\n\nAfter.",
  "a lazy continuation extending a blockquote":
    "First.\n\nSecond.\n\nThird.\n\n> quoted\nlazy continuation\nmore lazy\n\nAfter.",
  "a list absorbing further items":
    "First.\n\nSecond.\n\nThird.\n\n- one\n- two\n- three\n- four\n\nAfter.",
  "a list item with a lazy continuation":
    "First.\n\nSecond.\n\nThird.\n\n- one\ncontinued\n- two\n\nAfter.",
  "an unclosed fence swallowing the rest":
    "First.\n\nSecond.\n\nThird.\n\n```js\nconst x = 1;\n\nnot really a paragraph\n",
  "a fence that closes":
    "First.\n\nSecond.\n\nThird.\n\n```js\nconst x = 1;\n```\n\nAfter.",
  "a math block spanning a blank line":
    "First.\n\nSecond.\n\nThird.\n\n$$\nx = 1\n\ny = 2\n$$\n\nAfter.",
  "an HTML block spanning several paragraphs":
    "First.\n\nSecond.\n\nThird.\n\n<div>\n\ninner paragraph\n\n</div>\n\nAfter.",
  "nested HTML of the same tag":
    "First.\n\nSecond.\n\nThird.\n\n<div>\n<div>\n\ninner\n\n</div>\n</div>\n\nAfter.",
  "a footnote reference arriving late":
    "First.\n\nSecond.\n\nThird.\n\nFourth.\n\nA claim[^1].\n\n[^1]: The support.\n",
  "a footnote in the very first block":
    "A claim[^1].\n\n[^1]: The support.\n\nSecond.\n\nThird.\n\nFourth.\n",
  "an indented code block":
    "First.\n\nSecond.\n\nThird.\n\n    indented\n    code\n\nAfter.",
  "a thematic break": "First.\n\nSecond.\n\nThird.\n\n---\n\nAfter.",
};

describe("createIncrementalBlockParser", () => {
  describe("matches a full re-parse character by character", () => {
    for (const [name, markdown] of Object.entries(BACKWARD_MERGES)) {
      it(name, () => {
        expect(firstMismatch(markdown, 1)).toBeNull();
      });
    }
  });

  it("matches a full re-parse when text arrives in larger chunks", () => {
    const markdown = Object.values(BACKWARD_MERGES).join("\n\n");

    expect(firstMismatch(markdown, 3)).toBeNull();
    expect(firstMismatch(markdown, 7)).toBeNull();
    expect(firstMismatch(markdown, 24)).toBeNull();
  });

  // Streamdown segments the healed markdown, and healing closes whatever is
  // open at the end of it. The text handed to the parser therefore has a tail
  // that is rewritten from one token to the next rather than simply appended
  // to, which is the case reuse has to survive to be worth anything.
  it("matches a full re-parse of healed markdown", () => {
    const markdown = Object.values(BACKWARD_MERGES).join("\n\n");

    expect(firstMismatch(markdown, 1, remend)).toBeNull();
    expect(firstMismatch(markdown, 7, remend)).toBeNull();
  });

  it("falls back to a full parse when the document is rewritten", () => {
    const parse = createIncrementalBlockParser();
    const rewritten = "Completely different.\n\nSecond.\n\nThird.\n\nFourth.";

    parse("One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.");

    expect(parse(rewritten)).toEqual(parseMarkdownIntoBlocks(rewritten));
  });

  it("falls back to a full parse when the document is truncated", () => {
    const parse = createIncrementalBlockParser();
    const shorter = "One.\n\nTwo.\n\nThree.";

    parse("One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.");

    expect(parse(shorter)).toEqual(parseMarkdownIntoBlocks(shorter));
  });

  it("returns the same blocks when called twice with the same text", () => {
    const parse = createIncrementalBlockParser();
    const markdown =
      "One.\n\nTwo.\n\nThree.\n\nFour.\n\n| a | b |\n| --- | --- |";

    parse(markdown.slice(0, 20));

    expect(parse(markdown)).toEqual(parse(markdown));
  });
});

const lehmer = (seed: number) => {
  let state = (seed % 2_147_483_646) + 1;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return state / 2_147_483_647;
  };
};

const BLOCK_SHAPES = [
  "A paragraph of ordinary prose that runs on for a while.",
  "# A heading",
  "Setext heading\n===",
  "Setext subheading\n---",
  "- one\n- two\n- three",
  "1. one\n2. two",
  "> quoted\nlazy continuation",
  "```js\nconst x = 1;\n```",
  "| a | b |\n| --- | --- |\n| 1 | 2 |",
  "---",
  "<div>\n\ninner\n\n</div>",
  "$$\nx = 1\n$$",
  "    indented code",
  "Text with `inline code` and **emphasis**.",
  "A claim[^1].\n\n[^1]: The support.",
];

const generateDocument = (seed: number) => {
  const random = lehmer(seed);
  const blocks: string[] = [];
  for (let i = 0; i < 24; i += 1) {
    blocks.push(BLOCK_SHAPES[Math.floor(random() * BLOCK_SHAPES.length)]);
  }
  return blocks.join("\n\n");
};

describe("createIncrementalBlockParser on generated documents", () => {
  it("matches a full re-parse for every prefix", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      expect(firstMismatch(generateDocument(seed), 7)).toBeNull();
    }
  });

  it("matches a full re-parse of every healed prefix", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      expect(firstMismatch(generateDocument(seed), 7, remend)).toBeNull();
    }
  });
});
