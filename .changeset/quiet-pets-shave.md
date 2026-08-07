---
"streamdown": patch
---

Suppress the streaming caret after a code block or table from `styles.css` instead of from the container's class list. The container's className and inline style no longer change as blocks stream in, which removes the whole-document style recalculation that each change triggered.
