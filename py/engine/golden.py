"""Golden Set(TC-01~05) 로더. 테스트·계산기 프리셋·MCP가 같은 입력을 쓴다."""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

from . import clock, intake
from .rules import DATA
from .timeutil import iso

_REL = re.compile(r"^D(\d+)\s+(\d{1,2}):(\d{2})$")


def resolve(value, base_date):
    """'D2 06:00' → 기준일 기준 datetime ISO. 절대 시각이면 그대로."""
    if not isinstance(value, str):
        return value
    m = _REL.match(value.strip())
    if not m:
        return value
    base = datetime.strptime(base_date, "%Y-%m-%d")
    return iso(base + timedelta(days=int(m.group(1)) - 1, hours=int(m.group(2)), minutes=int(m.group(3))))


def cases():
    raw = json.loads((DATA / "golden" / "cases.json").read_text(encoding="utf-8"))
    return raw["_meta"]["base_date"], raw["cases"]


def build_context(base_context, notes, base_date):
    ctx = {k: resolve(v, base_date) for k, v in (base_context or {}).items()}
    if notes.get("berth_free_on_arrival"):
        ctx["berth_free_on_arrival"] = True
    if notes.get("pumping_log") and not ctx.get("pumping_log"):
        ctx["pumping_log"] = notes["pumping_log"]
    return ctx


def run(sof_text, terms, context, base_date):
    parsed = intake.parse_sof(sof_text, base_date)
    terms = {k: resolve(v, base_date) for k, v in terms.items()}
    ctx = build_context(context, parsed["notes"], base_date)
    return parsed, clock.compute(parsed["events"], terms, ctx)


def run_case(case_id):
    base, all_cases = cases()
    case = next(c for c in all_cases if c["id"] == case_id)
    parsed, st = run(case["sof_text"], case["terms"], case["context"], base)
    return case, parsed, st
