"""L4 world model: a synthetic town whose disputes become court cases (see ``model.TownWorld``)."""
from .config import WorldConfig, load_world_config
from .model import FUNNEL, PERSON_STATES, Dispute, TownWorld

__all__ = ["TownWorld", "Dispute", "WorldConfig", "load_world_config", "FUNNEL", "PERSON_STATES"]
