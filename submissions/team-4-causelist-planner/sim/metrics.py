"""Judging metrics computed in DuckDB over simulation output."""
from __future__ import annotations

import duckdb
import pandas as pd

from .simulate import SimResult

METRICS_SQL = """
WITH h AS (SELECT * FROM hearings),
d AS (SELECT policy, behaviour, sum(sitting_minutes) AS sitting, sum(used_minutes) AS used
      FROM days GROUP BY policy, behaviour),
b AS (
  SELECT policy, behaviour,
         arg_min("4-5y" + "5y+", day) AS old_start, arg_max("4-5y" + "5y+", day) AS old_end,
         arg_min("5y+", day) AS y5_start, arg_max("5y+", day) AS y5_end
  FROM backlog GROUP BY policy, behaviour
)
SELECT h.policy, h.behaviour,
       count(*)                                                   AS listed,
       count(*) / count(DISTINCT h.day)                           AS listed_per_day,
       sum(heard::INT)                                            AS heard,
       sum(effective::INT)                                        AS effective,
       sum(disposed::INT)                                         AS disposed,
       round(any_value(d.used) / any_value(d.sitting), 3)         AS utilisation,
       round(sum(heard::INT) / count(*), 3)                       AS predictability,
       round(sum(effective::INT) / nullif(sum(heard::INT), 0), 3) AS substantiveness,
       round(sum((NOT reached)::INT) / count(*), 3)               AS not_reached_rate,
       any_value(b.old_start)                                     AS pending_4y_plus_start,
       any_value(b.old_end)                                       AS pending_4y_plus_end,
       any_value(b.y5_start)                                      AS pending_5y_plus_start,
       any_value(b.y5_end)                                        AS pending_5y_plus_end,
       round(avg(next_gap_days), 1)                               AS mean_next_gap_days,
       round(avg(abs(next_gap_days - ideal_gap_days)), 1)         AS mean_gap_error_days,
       round(count(*) / count(DISTINCT (h.advocate, h.day)), 2)   AS matters_per_advocate_trip,
       round(avg(CASE WHEN litigant_action <> '' THEN (litigant_action = 'appear' AND NOT heard)::INT END), 3)
                                                                  AS litigant_wasted_trip_rate,
       round(avg(CASE WHEN advocate_action <> '' THEN (advocate_action = 'seek_adjournment')::INT END), 3)
                                                                  AS adjournment_request_rate
FROM h JOIN d USING (policy, behaviour) JOIN b USING (policy, behaviour)
GROUP BY h.policy, h.behaviour
ORDER BY h.behaviour DESC, h.policy DESC
"""


def combine(*results: SimResult) -> SimResult:
    return SimResult(*(pd.concat([getattr(r, f) for r in results], ignore_index=True)
                       for f in ("hearings", "days", "backlog")))


def summary(res: SimResult) -> pd.DataFrame:
    con = duckdb.connect()
    con.register("hearings", res.hearings)
    con.register("days", res.days)
    con.register("backlog", res.backlog)
    return con.execute(METRICS_SQL).df()
