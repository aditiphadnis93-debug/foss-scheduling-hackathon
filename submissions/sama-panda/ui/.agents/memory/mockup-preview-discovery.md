---
name: Mockup preview discovery
description: Transient blank captures just after adding mockup sandbox components
---

New mockup-sandbox component previews can briefly show an empty page immediately after file creation even though the route returns HTTP 200 and no browser error is logged.

**Why:** The generated component registry and asynchronous module loading can lag behind a newly added preview file; the renderer is empty until discovery settles.

**How to apply:** When a newly created preview captures blank but typecheck and route responses are healthy, check whether the registry contains the component and retry once after the sandbox watcher updates before changing component code.