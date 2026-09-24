---
name: Court process signals
description: Interpretation of case readiness and latest-hearing data in Court Time Planner.
---

Treat the absence of a process warning as “no warning found,” not confirmation that a case is ready to be listed. The latest-hearing value is narrative case history, not a calendar date. In automatic previews, an inferred pending-process warning is a provisional hold until the roster is updated; it is not a verified legal disqualification.

**Why:** The roster data infers process status from hearing summaries, without verified service records. Presenting that inference as verified readiness or a definitive legal bar, or formatting the narrative as a date, can mislead a court user.

**How to apply:** In case views, filters, exports, and scheduling explanations, preserve the provisional wording. Never list a provisionally held case and label it held in the same preview. Render the latest-hearing value as text unless a separate verified date field is available.