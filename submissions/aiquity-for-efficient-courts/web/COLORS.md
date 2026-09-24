# Colour guide

**Replaces the colour and theme sections of `DESIGN.md`.** Motion, layout and 3D guidance there still apply.

The look is **plain and clean**: white surfaces, slate greys, one confident blue, and a green that
means "moved forward". Light is the default. Dark is a faithful inversion, not a neon skin. No gradients
on UI chrome, no glow on text, and no decorative colour: every colour carries a meaning.

## 1. Tokens (define once in `src/app/theme.css`; everything else uses these variables)

### Light (default)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | page |
| `--surface` | `#F9FAFB` | cards, panels |
| `--surface-2` | `#F1F5F9` | inset / hover / table stripes |
| `--border` | `#E1E7EF` | hairlines, card borders |
| `--text` | `#111827` | body and headings |
| `--text-muted` | `#65758B` | secondary text, axis labels |
| `--text-faint` | `#9CA3B0` | captions, disabled |
| `--primary` | `#2463EB` | primary actions, links, **ours / recommended** |
| `--primary-hover` | `#3C83F6` | hover |
| `--primary-strong` | `#1E3B8A` | headings accents, active nav |
| `--primary-subtle` | `#F0F6FF` | selected rows, highlight backgrounds |
| `--primary-soft` | `#DCEBFE` | chips, soft fills |
| `--green` | `#10B77F` | **substantive / moved forward**, success |
| `--green-strong` | `#059467` | green text on white |
| `--green-subtle` | `#EDFDF5` | green backgrounds |

### Dark
| Token | Hex |
|---|---|
| `--bg` | `#030711` |
| `--surface` | `#080C16` |
| `--surface-2` | `#1A2333` |
| `--border` | `#222F44` |
| `--text` | `#F9FAFB` |
| `--text-muted` | `#94A3B8` |
| `--text-faint` | `#6B7280` |
| `--primary` | `#3C83F6` |
| `--primary-hover` | `#61A6FA` |
| `--primary-strong` | `#BEDBFE` |
| `--primary-subtle` | `#172554` |
| `--primary-soft` | `#1E3B8A` |
| `--green` | `#36D399` |
| `--green-strong` | `#36D399` |
| `--green-subtle` | `#064C39` |

## 2. Meaning colours (identical names in both themes; dark values in brackets)
| Meaning | Token | Hex |
|---|---|---|
| Ours / recommended plan | `--c-ours` | `#2463EB` (`#3C83F6`) |
| Today's practice (baseline) | `--c-baseline` | `#9CA3B0` (`#6B7280`) |
| Moved forward (substantive) | `--c-substantive` | `#10B77F` (`#36D399`) |
| Adjourned | `--c-adjourned` | `#F59F0A` (`#FAB338`) |
| Not reached (day ran out) | `--c-not-reached` | `#C678DD` (`#C678DD`) |
| Not ready (prerequisite pending) | `--c-not-ready` | `#274754` (`#7AA6B8`) |
| Old case, 4+ years | `--c-old` | `#E76E50` (`#E76E50`) |
| Error / breach of a floor | `--c-danger` | `#EF4343` (`#EF4343`) |

Age buckets for backlog charts, youngest to oldest (a single blue ramp, with the oldest in the old-case coral):
`<1y #BEDBFE`, `1–2y #91C3FD`, `2–3y #61A6FA`, `3–4y #2463EB`, `4–5y #1E3B8A`, `5y+ #E76E50`.

## 3. Type
- UI and body: **Inter** (`next/font/google`, variable). Tabular numerals (`font-variant-numeric: tabular-nums`) for every number.
- Display (hero, page titles, big metric numbers): **Sora** 700/800. For a more technical feel on big stat numbers, **Space Grotesk** 700 is allowed.
- Mono (ids like case numbers, formulas): JetBrains Mono, small, `--text-muted`.
- Scale: 12 / 14 / 16 / 20 / 28 / 40 / 56. Headings use `--text`, not coloured, except one accent word allowed in `--primary`.

## 4. Shape and surfaces
- Radius **8px** (cards 12px, pills fully rounded). 1px `--border` borders. Shadows only on floating layers (`0 1px 2px rgba(17,24,39,.06), 0 8px 24px rgba(17,24,39,.06)`).
- Cards on `--surface` over `--bg`. Selected state = `--primary-subtle` background + a 2px left `--primary` bar.
- Buttons: primary = `--primary` filled with white text; secondary = white with `--border` and `--text`; ghost = text only.

## 5. Charts
- Gridlines `--border`, axes `--text-muted` 12px, no chart borders, no 3D, no drop shadows.
- Ours vs baseline: always `--c-ours` vs `--c-baseline`. Outcomes always use the meaning colours.
- Every chart carries a one-line takeaway above it in `--text` 14px.

## 6. The 3D world (`/world`)
The world can stay a night scene for cinema, but in this palette: sky/fog `#030711` → `#172554`,
ground `#080C16`, roads `#1A2333`, buildings `#222F44` with `#384252` roofs, the court in white `#F9FAFB`
with a **blue `#3C83F6` dome**, people in the person-state colours of §7 (never the outcome colours),
dispute arcs `#DB2777` (the in-dispute colour), filing light `#61A6FA`.
Bloom subtle (intensity ≤ 0.6). A **day mode** (light sky `#F0F6FF`, ground `#F3F4F6`, buildings white) is
the default for the page; night mode is a toggle for cinema.

## 7. People states vs hearing outcomes (never share a colour)
People (town, observatory, people boards) use their own family, distinct from hearing outcomes:
| Person state | Hex (light / dark) |
|---|---|
| Calm (no open dispute) | `#94A3B8` / `#94A3B8` |
| In a dispute (quarrel or notice) | `#DB2777` / `#F472B6` |
| In court (case pending) | `#4338CA` / `#818CF8` |
| Resolved (settled or decided) | `#0E7490` / `#22D3EE` |
Hearing outcomes stay: moved forward `#10B77F`, adjourned `#F59F0A`, not reached `#C678DD`, not ready `#274754`.
People are drawn as filled capsules; outcomes appear as rings/bars, so shape also separates them.
