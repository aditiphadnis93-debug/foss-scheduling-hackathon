# L3 agents with Laya (proof of concept)

The brief's top level, "model the people inside the court": a judge, advocates and litigants act as agents. Each makes a typed decision with calibrated probabilities. The decisions come from **Laya** (Apache-2.0, `pip install laya`), an open "System One" model that speaks TypeSafe Jev's `/v1/systemone` wire protocol. Every agent has an explainable rule fallback.

## The loop, per sitting day

```
judge agent lists  →  advocates and litigants act on the causelist  →  judge rules in court  →  next date  →  memory
   (stage 2 swap)        (appear? ready? seek adjournment?)            (grant / refuse / costs)   (gap band)    (feeds tomorrow)
```

1. **The judge agent lists** (policy `l3` only). Eligibility gives the pool. The rule score pre-ranks it and keeps a shortlist worth about twice the day's minutes. The judge agent answers `list_today | defer` for each shortlisted case, given its facts and the judge's **style** (their own words, `style:` in `presets/*.yaml`). P(list_today) becomes the stage-2 score. Booked cases, the starvation guard and the locked ageing quota are placed before any score is read, and the listing-factor ceiling bounds the day. So a judge agent cannot break a locked rule however it answers. `tests/test_agents.py` checks this with a contrarian judge that ranks every 4y+ case last.
2. **Advocates** answer `ready | unprepared | seek_adjournment | absent`, and **litigants** answer `appear | stay_away`. They see their persona and the case, and the levers the court uses:
   - an appearance window vs "all day"
   - an SMS reminder with the checklist
   - the cover-page rule
   - costs for adjournments

   The situation also covers:
   - a clash in another courtroom
   - their other matters here today
   - how much notice the date gave
   - earlier wasted trips

   Evidence hearings need the party present.
3. **The judge rules** when counsel seeks an adjournment or is unprepared: `grant | refuse_proceed | grant_with_costs`. Costs mark the advocate, who is then less likely to ask again. Under `l1` and the status quo the court behaves as today: it adjourns on request and proceeds with the unready.
4. **Next date.** The judge agent picks `short | ideal | long`. That maps to the min, ideal or 2× ideal gap from the hearing-type table, and `next_date.recommend` still clamps it to the procedural minimum and to days with room.
5. **Memory.** Wasted trips per litigant, costs per advocate, and when each next date was fixed all feed the next day's situations.

A heard hearing is effective only if counsel came ready and prerequisites are met. It then succeeds with the table's `p_effective` + 0.25 (`READY_LIFT`), because unpreparedness is now modelled explicitly instead of hidden in the rate.

## Code

| File | What |
| --- | --- |
| `agents/situation.py` | `Situation` (the facts, bucketed so identical situations share one decision), the questions, the narrative Laya reads |
| `agents/decide.py` | `RuleDecider` (softmax over named terms), `LayaDecider` (HTTP to the sidecar, on-disk memo, call budget, fallback) |
| `agents/judge.py` | the judge agent's listing scorer (`scheduler.assign.Scorer`), ruling and next-date situations, `style_text` |
| `agents/outcomes.py` | `Levers`, `Agents`: a day's decisions in one batch, sampled with the simulation's seeded rng |
| `agents/personas.py` | synthetic traits, derived deterministically from ids until the datasets say more |
| `sim/simulate.py` | `simulate(..., agents=)` and policy `l3`; `behaviour` = `fixed` or `agents` in every row |
| `views/agents.py` | the **Agents (L3)** tab in the judge's view |

Fixed behaviour is unchanged: the same seeds give byte-identical L1 and status-quo hearings to before the seam was added.

## Running it

```bash
docker compose --profile agents up -d --build laya app   # Laya sidecar (CPU) + app; the model (~420M) downloads once into data/models
docker compose exec -T app python -m agents probe        # one decision from Laya next to the rule fallback
docker compose exec -T app python -m agents warm --judge sehgal   # 10 days, all three policies → data/laya_decisions.json
```

The judge's `style:` text travels preset → `datagen` → `scheduling_preset.additional_details` → `JudgeConfig.style`. A dataset generated before this change has no style, and the judge agent then reads a description built from the preset's blocks. Regenerate (`python -m datagen generate`) and use **Dataset → Reload** to give the judge agent their own words. The cached judge decisions are keyed by that text, so they get asked again.

The app runs without the sidecar: the Agents tab then uses the rules. Every decision records its source (`laya`, `rules`, `rules (laya unavailable)`, `rules (budget spent)`).

## What we found

These are from Justice Sehgal's courtroom on the generated dataset: 10 sitting days, seed 11, levers on except costs, and the status quo with no levers.

| | Heard ÷ listed | Effective ÷ heard | Adjournment requests | Litigant came, not heard | Mean next gap |
| --- | --- | --- | --- | --- | --- |
| Status quo · Laya agents | 0.32 | 0.48 | 0.38 | 0.50 | 60.6 d |
| L1 · Laya agents | 0.54 | 0.57 | 0.29 | 0.31 | 19.1 d |
| L3 judge agent · Laya agents | 0.43 | 0.67 | 0.28 | 0.41 | 15.1 d |
| Status quo · rule agents | 0.36 | 0.48 | 0.16 | 0.39 | 60.6 d |
| L1 · rule agents | 0.66 | 0.62 | 0.14 | 0.29 | 23.8 d |
| L3 judge agent · rule agents | 0.64 | 0.70 | 0.13 | 0.31 | 22.3 d |

- **The status quo is reproduced unprompted.** With Laya agents and no levers, 32% of listed hearings are heard, close to the brief's 20 of 60. The scheduler's windows, reminders and cover pages lift that to 54% under L1.
- **The Laya judge trades predictability for substance.** Its listings are heard less often than L1's (0.43 vs 0.54). But more of the hearings that happen move the case on (0.67 vs 0.57), more cases were disposed (3 vs 1), and it asks for shorter next dates.
- **Laya advocates ask for time far more than the rule fallback assumes** (28–38% of hearings vs 13–16%). Laya follows the persona strongly: a habitual adjourner with a clash seeks an adjournment 86% of the time.
- **Some levers barely register zero-shot.** A litigant's P(appear) with or without a time window moves by under 0.1. The rule fallback encodes the intended lever effects explicitly. Fine-tuning Laya on real attendance data (it ships a fine-tuning notebook) is the path to trusting its lever responses.
- **Speed.** About 1.25 s per new decision on a 12-core CPU, not the 33 ms quoted for a T4 GPU. Warming that courtroom (10 days, three policies) took 606 new decisions and 13 minutes; the same run then replays from the cache in under a second. Advocate situations are most of the cache (449 of 750), even with coarse age and adjournment buckets. A GPU, or Laya's ONNX path, would make live runs practical.

## Deferred

- Cross-courtroom clashes come from each advocate's persona, not from the other courtrooms' actual causelists (the simulator runs one courtroom at a time).
- Agents don't yet react to the next date offered (accept or ask for another), or to fees.
- Laya's `predict_batch` is not exposed by `laya-serve`; each situation is one HTTP call.
