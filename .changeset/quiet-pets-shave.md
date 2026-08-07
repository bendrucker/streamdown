---
"streamdown": patch
---

Suppress the streaming caret by marking the element it decorates rather than the container that holds the document. The container's className and inline style no longer change as blocks stream in, which removes the whole-document style recalculation each change triggered.

Server-rendered markup leaves the caret off entirely while a table or an open fence trails the document, since the mark is applied after the commit and the server never gets one.
