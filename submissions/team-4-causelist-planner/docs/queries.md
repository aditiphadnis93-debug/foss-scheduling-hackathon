**Pauses**: From one sitting, is there a gap till the next stting? Like a cool-down period between hearings



3. Scheduling
The **judge and their court staff** then decide which cases to hear on which day, and how many cases can realistically be packed into a
day so that the maximum number of cases can be heard and moved forward. The causelist is the resulting schedule of hearings for the
day.

**query**: Is the `court staff` same as the `court master`.

## Domain model (from `docs/court-domain-model.md` §13)

**query**: Is a permanent bench (e.g. Nagpur) a separate DRISTI tenant, or an establishment under one High Court tenant?

**query**: Does the roster dataset carry party IDs, or only advocate IDs? Does it carry a stage / sub-stage, or only the purpose of the next hearing?

**query**: Which stage, sub-stage and causelist-section vocabulary does the target High Court use (fresh, after notice, for orders, final hearing, part-heard, ...)?

**query**: Will the hearing-failure distribution come with reason codes (party absent, not reached, service pending, ...) that we can match one-to-one?

**query**: Is "one judge's roster" the output of a roster assignment (bench × case types × stage) we should respect, or a flat list of cases?

**query**: Are prerequisites (service of notice, records received, pleadings complete) given per case, or only as an overall rate?
