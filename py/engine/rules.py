"""룰 레지스트리 로더. 엔진은 rule_id 문자열만 쓰고, 오타는 여기서 바로 잡힌다."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


@lru_cache(maxsize=1)
def registry():
    raw = json.loads((DATA / "rules.json").read_text(encoding="utf-8"))
    return {r["id"]: r for r in raw["rules"]}


def rule(rule_id):
    reg = registry()
    if rule_id not in reg:
        raise KeyError(f"unknown rule_id: {rule_id}")
    return reg[rule_id]


def param(rule_id, key):
    return rule(rule_id)["params"][key]


def check(*rule_ids):
    for r in rule_ids:
        rule(r)
    return list(rule_ids)
