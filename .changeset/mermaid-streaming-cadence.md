---
"streamdown": minor
---

While a Mermaid fence streams, render only the chart's complete lines, which skips most failed parses of charts cut mid-line. Add `mermaid.streaming` to render less often while a fence streams: `minInterval` sets a minimum time between renders, and `renderOnClose` waits for the fence to close.
