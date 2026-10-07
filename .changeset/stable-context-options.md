---
"streamdown": patch
---

perf: keep the context value stable when `mermaid`, `controls`, `linkSafety`, or `shikiTheme` are passed as inline objects, so finished blocks no longer re-render on every streamed token
