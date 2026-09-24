"""Reference tables: durations, gaps, p_substantive and failure-reason distributions (sections 2.4-2.6)."""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from .enums import DROPPED_REASONS, REASON_GROUPS, HearingType, ReasonGroup, normalise_type
from . import loaders


@dataclass(frozen=True)
class TypeRef:
    type: HearingType
    duration_min: float
    reference_gap_days: int
    p_substantive: float  # 0..1
    min_h: int
    max_h: int
    mean_h: float
    median_h: float
    source_p_substantive: str  # "real" | "estimated"
    source_failures: str
    failure_counts: dict[str, float]  # label -> count, dropped reasons removed
    group_shares: dict[ReasonGroup, float]  # share of failures per group (sums to 1)
    labels_by_group: dict[ReasonGroup, dict[str, float]]  # group -> {label: count}
    p_show_base: float


@dataclass
class Reference:
    types: dict[HearingType, TypeRef]
    pooled_group_shares: dict[ReasonGroup, float] = field(default_factory=dict)
    pooled_labels_by_group: dict[ReasonGroup, dict[str, float]] = field(default_factory=dict)
    cache: dict = field(default_factory=dict, repr=False, compare=False)  # derived per-type values

    def __getitem__(self, h: HearingType) -> TypeRef:
        return self.types[h]

    def duration(self, h: HearingType) -> float:
        return self.types[h].duration_min

    def gap(self, h: HearingType) -> int:
        return self.types[h].reference_gap_days

    def p_sub(self, h: HearingType) -> float:
        return self.types[h].p_substantive

    def p_show_base(self, h: HearingType) -> float:
        return self.types[h].p_show_base

    def labels(self, h: HearingType, group: ReasonGroup) -> dict[str, float]:
        """Reason labels within a group for a type, falling back to the pooled distribution."""
        own = self.types[h].labels_by_group.get(group, {})
        if sum(own.values()) > 0:
            return own
        pooled = self.pooled_labels_by_group.get(group, {})
        if sum(pooled.values()) > 0:
            return pooled
        return {group.value.title(): 1.0}


def _source(value) -> str:
    return "real" if str(value).strip().lower().startswith("real") else "estimated"


def _group(counts: dict[str, float]) -> tuple[dict[ReasonGroup, float], dict[ReasonGroup, dict[str, float]]]:
    by_group: dict[ReasonGroup, dict[str, float]] = {g: {} for g in ReasonGroup}
    for label, n in counts.items():
        by_group[REASON_GROUPS[label]][label] = n
    total = sum(counts.values())
    shares = {g: (sum(v.values()) / total if total else 0.0) for g, v in by_group.items()}
    return shares, by_group


def build_reference(tables: dict[str, pd.DataFrame]) -> Reference:
    ref_df = tables["reference"]
    sub_df = tables["substantiveness"]
    fail_df = tables["failures"]

    reason_cols = [c for c in REASON_GROUPS]
    sub = {normalise_type(r["hearingType"]): r for _, r in sub_df.iterrows()}
    fail = {normalise_type(r["hearingType"]): r for _, r in fail_df.iterrows()}

    pooled_counts = {c: float(fail_df[c].sum()) for c in reason_cols}
    pooled_shares, pooled_labels = _group(pooled_counts)

    types: dict[HearingType, TypeRef] = {}
    for _, r in ref_df.iterrows():
        h = normalise_type(r["Hearing Purpose"])
        p_sub = float(sub[h]["Substantive Hearings (percentage probability)"]) / 100.0
        frow = fail.get(h)
        counts = {c: float(frow[c]) for c in reason_cols} if frow is not None else {}
        if sum(counts.values()) > 0:
            shares, labels = _group(counts)
        else:  # zero failure counts -> pooled distribution
            shares, labels = pooled_shares, pooled_labels
        # Share of *all* hearings that fail through absence.
        p_show = 1.0 - (1.0 - p_sub) * shares[ReasonGroup.ABSENCE]
        types[h] = TypeRef(
            type=h,
            duration_min=float(r["Time it takes for hearing (mins) - estimated"]),
            reference_gap_days=int(r["Time to next hearing given this is the purpose (days)"]),
            p_substantive=p_sub,
            min_h=int(r["Min Hearings per Case"]),
            max_h=int(r["Max Hearings per Case"]),
            mean_h=float(r["Mean Hearings per Case"]),
            median_h=float(r["Median Hearings per Case"]),
            source_p_substantive=_source(sub[h]["source"]),
            source_failures=_source(frow["source"]) if frow is not None else "estimated",
            failure_counts=counts,
            group_shares=shares,
            labels_by_group=labels,
            p_show_base=p_show,
        )
    missing = [h for h in HearingType if h not in types]
    if missing:
        raise ValueError(f"Reference table is missing hearing types: {missing}")
    _ = DROPPED_REASONS  # documented: dropped by construction (not in REASON_GROUPS)
    return Reference(types=types, pooled_group_shares=pooled_shares, pooled_labels_by_group=pooled_labels)


def load_reference(data_dir=None) -> Reference:
    return build_reference(loaders.load_reference_tables(data_dir))
