import spec from "commonmark-spec";
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
  // parseMarkdownIntoBlocks re-merges blocks around `$$`, and the merge is
  // suppressed after a code block. Both seams are sound and neither was covered.
  "an odd $$ inside a settled fence":
    "```\n$$\n```\n\nx\n\ny\n\nz\n\n$$\nmath\n$$\n",
  "a paragraph absorbing a fence between two $$":
    "text $$\n```\ncode\n```\nx\n\ny\n\nz\n\nw $$ close\n",
  "a link definition and its reference":
    "See [the docs][a].\n\nSecond.\n\nThird.\n\nFourth.\n\n[a]: /one\n\nAfter.",
  // marked discards a definition whose label it has already seen, so a full
  // parse of this document returns less text than the document holds. A tail
  // lexed on its own has no record of the first label and keeps the second,
  // which diverged from a full parse and, because the reused text still matched
  // the markdown, never fell back.
  "a link definition repeated far below the first":
    "Intro.\n\n[a]: /one\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\n[a]: /two\n\nSix.",
  "a link definition repeated immediately":
    "First.\n\nSecond.\n\nThird.\n\n[a]: /one\n[a]: /two\n\nAfter.",
  // Three successive detectors for this construct were each narrower than
  // marked's own grammar, so the cases below pin every way the grammar is wider
  // than it looks. A label may hold an escaped bracket, may run across a
  // newline, and has no length bound at all.
  "a link definition whose label holds an escaped bracket":
    "Intro.\n\n[a\\]b]: /one\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\n[a\\]b]: /two\n\nSix.",
  // marked collapses whitespace runs when it keys a label, so `[foo\nbar]` and
  // `[foo bar]` are the same definition and the second is dropped.
  "a link definition whose label spans a newline":
    "[foo bar]: /one\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\n[foo\nbar]: /two\n\nSix.",
  "a link definition with a label longer than any bound":
    `[${"a".repeat(250)}]: /one\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\n[${"a".repeat(250)}]: /two\n\nSix.`,
  // marked allows the destination on the line after the label.
  "a link definition whose href is on the next line":
    "[a]:\n  /one\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\n[a]:\n  /two\n\nSix.",
};

// Reuse freezes a block boundary, and that boundary was decided by the first
// line of the block after it. Appending cannot reach that line, but markdown
// arrives as an arbitrary prop and this parser is exported, so nothing enforces
// appending. Each sequence below rewrites the frozen line while leaving the text
// above it intact, which is exactly what the prefix test alone cannot see.
const REWRITTEN_SEAMS: Record<string, [string, string]> = {
  "a lazy continuation absorbing the line above": [
    "hello\n# a\n***\nb",
    "hello\nworld",
  ],
  "a setext underline claiming the line above": [
    "hello\n# a\n***\nb",
    "hello\n===",
  ],
  "a delimiter row turning the line above into a table": [
    "a | b\n# a\n***\nb",
    "a | b\n--- | ---\n1 | 2",
  ],
  "a footnote completed across the boundary": [
    "abc [^\n\n# a\n***",
    "abc [^1] hi",
  ],
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

  describe("matches a full re-parse when the settled boundary is rewritten", () => {
    for (const [name, [first, second]] of Object.entries(REWRITTEN_SEAMS)) {
      it(name, () => {
        const parse = createIncrementalBlockParser();

        parse(first);

        expect(parse(second)).toEqual(parseMarkdownIntoBlocks(second));
      });
    }
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

  // marked normalizes line endings before lexing, so the blocks it returns for
  // CRLF markdown never match the text they came from and no prefix of it is
  // ever reusable. Correctness is what matters here. The stream pays the full
  // parse it would have paid anyway.
  it("matches a full re-parse of markdown with CRLF line endings", () => {
    const markdown = Object.values(BACKWARD_MERGES)
      .join("\n\n")
      .replaceAll("\n", "\r\n");

    expect(firstMismatch(markdown, 7)).toBeNull();
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
  // Drawn repeatedly within a document, so generated documents carry the
  // duplicate labels that make a full parse lossy.
  "[a]: /one",
  "See [the docs][a].",
  "[a\\]b]: /escaped",
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

// The shapes above are a list of constructs someone thought to write down, and
// every bug found in this parser so far was a construct nobody had. The spec's
// examples are the one corpus where somebody already enumerated the grammar's
// edges adversarially: they hold definition labels repeated within a single
// example, labels containing escaped brackets, and labels spanning a newline,
// which between them are every case that has broken reuse.
const EXAMPLES_PER_DOCUMENT = 15;

// The shipped package leaves the spec's visible tab arrows in place.
const specExamples = spec.tests.map((example) => ({
  number: example.number,
  markdown: example.markdown.replaceAll("→", "\t"),
}));

/**
 * Shuffling matters because the spec groups its definition examples into one
 * section, where every neighbour is itself a definition and forces the fallback
 * that would have hidden a broken detector. Doubling matters because a label
 * defined for the first time parses the same alone as in context, so only a
 * repeat is observable, and most of these labels appear once in the whole spec.
 * Without both, this corpus catches the first bug found here and misses the rest.
 */
const buildCorpusDocuments = (seed: number) => {
  const random = lehmer(seed);
  const pool = [...specExamples];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const documents: { numbers: number[]; markdown: string }[] = [];
  for (let i = 0; i < pool.length; i += EXAMPLES_PER_DOCUMENT) {
    const group = pool.slice(i, i + EXAMPLES_PER_DOCUMENT);
    const body = group.map((example) => example.markdown).join("\n");
    documents.push({
      numbers: group.map((example) => example.number),
      markdown: `${body}\n${body}`,
    });
  }
  return documents;
};

const expectCorpusMatches = (
  seed: number,
  heal?: (prefix: string) => string
) => {
  for (const { numbers, markdown } of buildCorpusDocuments(seed)) {
    const mismatch = firstMismatch(markdown, 7, heal);
    expect(
      mismatch,
      `spec examples ${numbers.join(", ")} diverged at character ${mismatch?.chars}`
    ).toBeNull();
  }
};

describe("createIncrementalBlockParser on the CommonMark spec", () => {
  for (const seed of [1, 2, 3]) {
    it(`matches a full re-parse for every prefix (seed ${seed})`, () => {
      expectCorpusMatches(seed);
    });
  }

  it("matches a full re-parse of every healed prefix", () => {
    expectCorpusMatches(1, remend);
  });
});
