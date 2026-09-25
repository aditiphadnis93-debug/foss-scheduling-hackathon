"""L3 behavioural agents: a judge who lists and rules, advocates and litigants who act on the causelist.

Every decision is a typed choice with calibrated probabilities, asked of Laya (a FOSS, Jev-compatible
"System One" model running as a sidecar) or answered by the explainable rule fallback in `decide.py`.
The scheduler's rule stages never read an agent: the judge agent only replaces stage 2 (scoring) and
the next-date gap, so the locked rules still clamp everything it asks for.
"""
