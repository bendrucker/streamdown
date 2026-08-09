---
"streamdown": patch
---

Segment a growing document into blocks incrementally. Every token previously re-lexed the whole document, which made segmentation quadratic in the length of the stream. Blocks before a small trailing window are now reused whenever the new markdown extends the old, and any other change still falls back to a full parse.
