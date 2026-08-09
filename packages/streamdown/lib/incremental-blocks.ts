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
 * Markdown that does not extend what came before is parsed in full, so a caller
 * that rewrites or truncates its text stays correct and gives up only the
 * reuse. Healing does rewrite the tail of a stream, and a check that tolerated
 * that measured no faster than this one.
 *
 * `<Streamdown>` uses this by default. It is exported for callers passing their
 * own `parseMarkdownIntoBlocksFn`, which replaces it: wrap one of these rather
 * than `parseMarkdownIntoBlocks` to keep the reuse. Each parser holds the state
 * of one stream, so give every component its own.
 */
export const createIncrementalBlockParser = () => {
  let previousMarkdown = "";
  let previousBlocks: string[] = [];

  const remember = (markdown: string, blocks: string[]) => {
    previousMarkdown = markdown;
    previousBlocks = blocks;
    return blocks;
  };

  return (markdown: string): string[] => {
    if (
      previousBlocks.length <= REPARSED_TRAILING_BLOCKS ||
      !markdown.startsWith(previousMarkdown)
    ) {
      return remember(markdown, parseMarkdownIntoBlocks(markdown));
    }

    const reused = previousBlocks.slice(0, -REPARSED_TRAILING_BLOCKS);
    const tail = markdown.slice(
      reused.reduce((length, block) => length + block.length, 0)
    );

    // A footnote anywhere in a document makes the whole of it one block, so a
    // tail that introduces one cannot be segmented on its own. The reused
    // blocks are known to be free of them, because a document with footnotes
    // never produces enough blocks to be reused in the first place. A footnote
    // cannot straddle the split either, since it contains no newline and block
    // boundaries fall between lines.
    if (hasFootnotes(tail)) {
      return remember(markdown, parseMarkdownIntoBlocks(markdown));
    }

    return remember(markdown, [...reused, ...parseMarkdownIntoBlocks(tail)]);
  };
};
