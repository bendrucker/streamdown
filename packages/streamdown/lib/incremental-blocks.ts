import { hasFootnotes, parseMarkdownIntoBlocks } from "./parse-blocks";

/**
 * How much of the tail is handed back to the lexer. Appended text can still
 * reach backwards and change the block above it: a delimiter row turns the
 * preceding line into a table, `---` turns the paragraph above it into a setext
 * heading, and a lazy continuation extends the list or blockquote it follows.
 * Each of those reaches back one block. Two is the smallest window the tests in
 * `__tests__/incremental-blocks.test.ts` accept, and the third is margin against
 * constructs they do not generate; a block of extra lexing per token is cheap
 * next to the document it avoids.
 */
const REPARSED_TRAILING_BLOCKS = 3;

/**
 * Segments a growing document without re-lexing the whole of it on every token.
 * Segmentation is otherwise quadratic in the length of the stream, which on a
 * long document is one of the larger costs of rendering it.
 *
 * Reuse asks for the settled blocks to still be at the head of the new markdown
 * and nothing more, because healing rewrites the tail of a stream from one
 * token to the next. Requiring the whole previous document to be a prefix gives
 * up on every tick where it did, which on a mixed document is most of the
 * expensive ones. Markdown that fails even this test is parsed in full, so a
 * caller that rewrites or truncates its text stays correct and loses the reuse.
 *
 * `<Streamdown>` uses this by default. It is exported for callers passing their
 * own `parseMarkdownIntoBlocksFn`, which replaces it: wrap one of these rather
 * than `parseMarkdownIntoBlocks` to keep the reuse. Each parser holds the state
 * of one stream, so give every component its own.
 */
export const createIncrementalBlockParser = () => {
  let reusableBlocks: string[] = [];
  let reusableText = "";

  const settle = (blocks: string[]) => {
    reusableBlocks = blocks.slice(0, -REPARSED_TRAILING_BLOCKS);
    reusableText = reusableBlocks.join("");
    return blocks;
  };

  return (markdown: string): string[] => {
    if (reusableText.length === 0 || !markdown.startsWith(reusableText)) {
      return settle(parseMarkdownIntoBlocks(markdown));
    }

    const reused = reusableBlocks;
    const tail = markdown.slice(reusableText.length);

    // A footnote anywhere in a document makes the whole of it one block, so a
    // tail that introduces one cannot be segmented on its own. The reused
    // blocks are known to be free of them, because a document with footnotes
    // never produces enough blocks to be reused in the first place. A footnote
    // cannot straddle the split either, since it contains no newline and block
    // boundaries fall between lines.
    if (hasFootnotes(tail)) {
      return settle(parseMarkdownIntoBlocks(markdown));
    }

    const tailBlocks = parseMarkdownIntoBlocks(tail);
    const blocks = [...reused, ...tailBlocks];

    // Rebuilding the settled text would copy the whole document every tick,
    // which is the cost this exists to avoid. The blocks the tail pushed out of
    // the window are the only ones that became settled, so append those.
    if (tailBlocks.length <= REPARSED_TRAILING_BLOCKS) {
      return settle(blocks);
    }
    const settled = tailBlocks.slice(0, -REPARSED_TRAILING_BLOCKS);
    reusableBlocks = [...reused, ...settled];
    reusableText += settled.join("");
    return blocks;
  };
};
