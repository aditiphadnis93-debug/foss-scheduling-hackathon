"""Rules and rulesets routes (HTTP only)."""
from __future__ import annotations

from fastapi import APIRouter, Response

from ..schemas.requests import ActivateIn, RulesetIn, RulesetUpdate
from ..services import rules_service

router = APIRouter()


@router.get("/rules/presets")
def presets():
    return rules_service.presets()


@router.get("/rulesets")
def list_rulesets():
    return rules_service.list_()


@router.post("/rulesets")
def create(body: RulesetIn):
    return rules_service.create(body.name, body.rules)


@router.get("/rulesets/{rid}")
def get(rid: int):
    return rules_service.get(rid)


@router.put("/rulesets/{rid}")
def update(rid: int, body: RulesetUpdate):
    return rules_service.update(rid, body.name, body.rules)


@router.delete("/rulesets/{rid}", status_code=204)
def delete(rid: int):
    rules_service.delete(rid)
    return Response(status_code=204)


@router.put("/rules/active")
def activate(body: ActivateIn):
    return rules_service.activate(body.ruleset_id, body.replan_from)
