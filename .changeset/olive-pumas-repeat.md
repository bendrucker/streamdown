---
"streamdown": minor
---

Segment a growing document into blocks incrementally. Every token previously re-lexed the whole document, which made segmentation quadratic in the length of the stream. Blocks before a small trailing window are now reused whenever the new markdown extends the old, and any other change still falls back to a full parse.

Adds `createIncrementalBlockParser` to the public API. `<Streamdown>` builds one for itself, so this is only needed when passing `parseMarkdownIntoBlocksFn`, which replaces it. It segments with the built-in parser and cannot be pointed at another one, because the reuse it does is only sound for marked's semantics. A `parseMarkdownIntoBlocksFn` that post-processes the built-in segmentation can call one of these and keep the reuse. One that segments differently cannot. Each holds the state of a single stream, so give every component its own and keep it in a ref rather than constructing it during render.
