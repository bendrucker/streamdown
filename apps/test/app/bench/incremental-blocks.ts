import { parseMarkdownIntoBlocks } from "streamdown";

export interface IncrementalStats {
  calls: number;
  /** Characters a full re-parse would have lexed, summed over all calls. */
  charsFull: number;
  /** Characters actually handed to the lexer, summed over all calls. */
  charsLexed: number;
  /** Calls whose incremental result differed from a full re-parse. */
  mismatches: number;
  reused: number;
}

/**
 * Prototype of segmenting an append-only stream without re-lexing the whole
 * document each time. Blocks before the trailing window are reused verbatim;
 * only the tail is handed back to the lexer.
 *
 * The trailing window is more than one block because appended text can still
 * merge backwards: a delimiter row turns a paragraph into a table, `---` turns
 * it into a setext heading, and a lazy continuation line extends a list item.
 */
export const createIncrementalBlockParser = (
  trailingBlocks = 3,
  verify = false
) => {
  let previousText = "";
  let previousBlocks: string[] = [];
  const stats: IncrementalStats = {
    calls: 0,
    reused: 0,
    mismatches: 0,
    charsLexed: 0,
    charsFull: 0,
  };

  const parse = (markdown: string): string[] => {
    stats.calls += 1;
    stats.charsFull += markdown.length;

    const canReuse =
      previousBlocks.length > trailingBlocks &&
      markdown.length >= previousText.length &&
      markdown.startsWith(previousText);

    if (!canReuse) {
      stats.charsLexed += markdown.length;
      previousText = markdown;
      previousBlocks = parseMarkdownIntoBlocks(markdown);
      return previousBlocks;
    }

    const keep = previousBlocks.slice(0, -trailingBlocks);
    const prefixLength = keep.reduce((sum, block) => sum + block.length, 0);
    const tail = markdown.slice(prefixLength);
    stats.charsLexed += tail.length;
    stats.reused += 1;

    const blocks = [...keep, ...parseMarkdownIntoBlocks(tail)];

    if (verify) {
      const full = parseMarkdownIntoBlocks(markdown);
      if (
        full.length !== blocks.length ||
        full.some((b, i) => b !== blocks[i])
      ) {
        stats.mismatches += 1;
      }
    }

    previousText = markdown;
    previousBlocks = blocks;
    return blocks;
  };

  return { parse, stats };
};
