import { hasFootnotes, parseMarkdownIntoBlocks } from "./parse-blocks";

/**
 * How much of the tail is handed back to the lexer. Every boundary marked
 * decides reads at most through the first line of the block that follows it: a
 * delimiter row turns the line above it into a table, `---` turns the paragraph
 * above it into a setext heading, and a lazy continuation extends the list or
 * blockquote it follows. Constructs that reach further, an unclosed fence or an
 * open HTML tag, absorb every block after them and are therefore always the last
 * one, which is never settled. Two blocks would cover that reach. Three is
 * margin.
 */
const REPARSED_TRAILING_BLOCKS = 3;

/**
 * marked drops a link reference definition whose label it has already seen: it
 * consumes the text and pushes no token, so a document holding two `[a]:` lines
 * lexes to less text than it contains. A tail lexed on its own starts with an
 * empty label table, keeps the repeat, and diverges from a full parse for the
 * rest of the stream without ever failing the test that guards reuse.
 *
 * Every definition marked can match holds `]:` with nothing between the two
 * characters, so a substring test cannot be narrower than the grammar. Three
 * attempts to match that grammar more closely were each narrower than it: a
 * label may hold an escaped bracket, may run across a newline, and has no length
 * bound. The asymmetry is what makes the blunt test the right one. Matching text
 * that is not a definition costs one tick of reuse. Missing one that is costs
 * the rest of the stream.
 */
const LINK_DEFINITION_MARKER = "]:";

const firstLine = (text: string) => {
  const end = text.indexOf("\n");
  return end === -1 ? text : text.slice(0, end + 1);
};

/**
 * Segments a growing document without re-lexing the whole of it on every token.
 * Segmentation is otherwise quadratic in the length of the stream, which on a
 * long document is one of the larger costs of rendering it.
 *
 * Reuse asks for the settled blocks to still be at the head of the new markdown
 * and nothing more, because healing rewrites the tail of a stream from one token
 * to the next. Requiring the whole previous document to be a prefix gives up on
 * every tick where it did, which on a mixed document is most of the expensive
 * ones. Markdown that fails the test is parsed in full, so a caller that
 * rewrites or truncates its text stays correct and loses the reuse.
 *
 * `<Streamdown>` uses this by default. It is exported for callers passing their
 * own `parseMarkdownIntoBlocksFn`, which replaces it. Segmentation is always the
 * built-in one and cannot be swapped, because what makes the reuse sound is
 * marked's own behaviour. A caller post-processing those blocks can call this
 * and keep the reuse; a caller segmenting differently cannot. Each parser holds
 * the state of one stream, so give every component its own and keep it in a ref
 * rather than constructing one during render.
 */
export const createIncrementalBlockParser = () => {
  let reusableBlocks: string[] = [];
  let reusableText = "";
  let guardText = "";

  const settle = (blocks: string[]) => {
    reusableBlocks = blocks.slice(0, -REPARSED_TRAILING_BLOCKS);
    reusableText = reusableBlocks.join("");
    /**
     * Where the settled text ends was decided by the first line of the block
     * that follows it, so reuse has to see that line unchanged rather than only
     * the text above it. Markdown that rewrites the line instead of appending to
     * it otherwise keeps passing the prefix test while the blocks either side of
     * the boundary diverge, and nothing later in the stream recovers. Appending
     * cannot reach the line, since a settled block is followed by three others
     * and a complete line never changes, but nothing enforces that the caller
     * only appends.
     */
    guardText =
      reusableText + firstLine(blocks.at(-REPARSED_TRAILING_BLOCKS) ?? "");
    return blocks;
  };

  return (markdown: string): string[] => {
    if (reusableText.length === 0 || !markdown.startsWith(guardText)) {
      return settle(parseMarkdownIntoBlocks(markdown));
    }

    const tail = markdown.slice(reusableText.length);

    // A footnote anywhere in a document makes the whole of it one block, so a
    // tail that introduces one cannot be segmented on its own. Neither construct
    // can straddle the split: a block boundary never falls inside a line's
    // content, and the guard above holds the line the boundary sits on.
    if (hasFootnotes(tail) || tail.includes(LINK_DEFINITION_MARKER)) {
      return settle(parseMarkdownIntoBlocks(markdown));
    }

    return settle([...reusableBlocks, ...parseMarkdownIntoBlocks(tail)]);
  };
};
