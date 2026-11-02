"""VALIDATE — 검증 묶음(Phase 21~24)의 진입점. 계약: docs/api.md v2 → validation().

run(world)은 기준 세계에서 정책 7개를 리플레이하고(결정 시점마다 그때 알던 정보만), 사후 최적(하한),
헤드라인, 시나리오 17개(S01~S17 — 자원·제약 8개 S04·S05·S06·S13~S17 포함), 민감도를 한 번에 만든다.
constraint_scenarios = 자원·제약 8개의 정책별 계획 이력(자원·제약 뷰가 미리 계산본으로 쓴다).
quick=True면 시나리오·민감도를 건너뛴다.
"""
from __future__ import annotations

import time
from datetime import datetime

from .replay import POLICIES, agent_hitl, decision_points, hindsight, public, replay
from .scenarios import V3_IDS, run_scenarios, sensitivity
from .timeutil import iso, round_usd

REALISTIC = ["FCFS", "RATE", "LAYTIME_RISK", "OPTIMIZER", "RISK_AWARE", "AGENT_HITL"]


def headline(results, hind):
    by = {r["policy"]: r for r in results}
    base = by["CURRENT_RULE"]["total_usd"]
    order = [p["id"] for p in POLICIES]
    cands = [by[p] for p in REALISTIC if p in by]
    best = min(cands, key=lambda r: (r["total_usd"], r["plan_changes"], order.index(r["policy"])))
    saving = round_usd(base - best["total_usd"])
    pct = round(saving / base * 100, 1) if base else 0.0
    ties = [r["label"] for r in cands if abs(r["total_usd"] - best["total_usd"]) < 1 and r is not best]
    text = (f"{best['label']}이(가) 현업 Rule 대비 실제 체선료를 ${saving:,.0f}({pct:.1f}%) 줄였다 "
            f"(${base:,.0f} → ${best['total_usd']:,.0f}). 결정 시점마다 그때 알던 정보만 썼다.")
    if ties:
        text += f" 같은 결과: {', '.join(ties)}."
    text += f" 사후 최적(미래를 아는 하한)은 ${hind['total_usd']:,.0f}. [가상 시나리오]"
    return {"best_policy": best["policy"], "best_label": best["label"], "vs": "CURRENT_RULE", "base_usd": base,
            "best_usd": best["total_usd"], "saving_usd": saving, "saving_pct": pct, "hindsight_usd": hind["total_usd"], "text": text}


def run(world=None, quick=False):
    from .world import World
    t_start = time.perf_counter()
    world = world or World()
    is_base = getattr(world, "variant_label", None) is None
    results = []
    for p in POLICIES:
        if p["id"] == "AGENT_HITL":
            if is_base:
                results.append(public(agent_hitl(world)))
            continue
        results.append(public(replay(world, p["id"])))
    hind = hindsight(world)
    out = {
        "computed_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "source": "live",
        "policies": [p for p in POLICIES if p["id"] != "AGENT_HITL" or is_base],
        "decision_points": [{"t": iso(d["t"]), "trigger": d["trigger"], "label": d["label"]} for d in decision_points(world)],
        "replay": results,
        "hindsight": hind,
        "headline": headline(results, hind),
        "no_lookahead": ("각 결정 시점 t에는 t까지 발행된 ETA·예보·부두제약·자원 통보(예선 배정·검사 승인 갱신·안개 주의보·너울 예보)와 "
                         "t까지의 관측·실제 사건만 쓴다(KnownEnv). 채점만 실제 세계(truth)로 한다."),
        "scenarios": [],
        "constraint_scenarios": [],
        "sensitivity": None if quick else sensitivity(world),
    }
    if not quick:
        cache = {}
        out["constraint_scenarios"] = run_scenarios(world, ids=V3_IDS, placeholders={}, cache=cache, keep_history=True)
        out["scenarios"] = run_scenarios(world, cache=cache)
    out["runtime_s"] = round(time.perf_counter() - t_start, 2)
    return out
