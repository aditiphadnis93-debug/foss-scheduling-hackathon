# Visual language (shared by every page)

> **Colours and theme are superseded by [`COLORS.md`](COLORS.md)** (plain, clean, light-first palette). Motion, layout and 3D guidance below still apply.


Audience: a High Court judge and court staff (must be instantly legible) **and** a public audience
watching a short screen-recorded video (must look alive and cinematic). One system serves both.

- **Theme:** dark "court control room" by default with a light toggle. Background deep ink
  `#0B1020`, surfaces `#121A2F` / `#18223C`, hairlines `#26324F`, text `#E8ECF6` / muted `#9AA6C2`.
- **Accent semantics (use consistently everywhere):**
  - ours / optimal: saffron-amber `#F5A524`
  - today's practice (baseline): slate `#7C8AA8`
  - substantive / moved forward: emerald `#2BD99F`
  - adjourned: amber-red `#F2704F`
  - not reached: violet `#8B7CF6`
  - not ready (prerequisite): steel blue `#4EA8DE`
  - old cases (4+ yrs): rose `#FF5C8A` — old cases are a moral priority, so they must stand out
- **Type:** Inter (UI) + JetBrains Mono for numbers/ids (via `next/font/google`). Big tabular numerals for metrics.
- **Motion:** framer-motion. Numbers count up, bars grow, the day's causelist plays out like a clock
  (a playhead moves through the day, each hearing lights up with its outcome colour). Respect `prefers-reduced-motion`.
- **3D (world, court):** react-three-fiber + drei; low-poly stylised town, soft lighting, bloom via
  @react-three/postprocessing, dispute arcs as glowing curves, people as small capsules walking to the
  court building. 60 fps on a laptop; degrade gracefully.
- **Layout:** left rail navigation (Home, How it works, Scorecard, Court day, What-if, Backlog, People, World),
  content max 1280px; every chart has a one-line takeaway written for a judge.
- No emoji. No stock icons beyond lucide-react.
