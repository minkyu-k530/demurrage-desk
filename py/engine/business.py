"""BUSINESS CASE — 로드맵 Phase 29: Annual → Addressable → Saving → Cost → Net Benefit · ROI · Payback.

입력은 전부 가정이다. 비율 기본값만 가상 시나리오의 진단(Value at Stake)·검증(Historical Replay)에서 가져온다 —
폭풍·SBM 1기 주간 1건의 절감률을 연간 전체에 적용하는 것은 강한 가정이라 화면과 notes에 그렇게 적는다.
"""
from __future__ import annotations

from .diagnosis import as_fraction, policy_totals, usd

PARAMS = [
    # key, label, default, min, max, step, unit, basis
    ("annual_calls", "연간 입항 척수", 600, 50, 3000, 10, "척",
     "가정 — 울산CLX SK 부두 연간 탱커 입항 척수 미확인(멘토 확인)"),
    ("avg_demurrage_per_call_usd", "척당 평균 체선료", 10000, 0, 100000, 500, "USD",
     "가정 — 가상 시나리오 주간 평균 $41,958은 폭풍·SBM 1기 스트레스 상황이라 상한 참고로만 쓰고, 평시는 보수적으로 1만 달러"),
    ("addressable_share", "운영적으로 개선 가능한 비율", 50, 0, 100, 1, "%",
     "가정(보수 기본값) — 가상 진단 Value at Stake 비율은 '가상 시나리오 비율' 프리셋"),
    ("reduction_pct", "Scheduling 절감률", 10, 0, 100, 1, "%",
     "가정(보수 기본값) — 가상 검증 headline(스트레스 1주) 비율은 프리셋, 평시엔 훨씬 낮을 수 있음"),
    ("agent_reduction_pct", "에이전트(후보+사람 승인) 절감률", 8, 0, 100, 1, "%",
     "가정(보수 기본값) — 가상 검증 AGENT_HITL 비율은 프리셋"),
    ("adoption_rate", "현업 채택률", 50, 0, 100, 5, "%", "가정 — Shadow Mode의 Acceptance Rate로 교체"),
    ("build_cost_krw", "구축비(1회)", 300_000_000, 0, 3_000_000_000, 10_000_000, "KRW", "가정 — PoC→Pilot 연동·개발 포함"),
    ("annual_run_cost_krw", "연간 운영비", 120_000_000, 0, 1_000_000_000, 10_000_000, "KRW", "가정 — 인프라·LLM·유지보수"),
    ("fx_krw_per_usd", "환율", 1400, 1000, 2000, 10, "KRW/USD", "가정"),
]
FALLBACK = {"addressable_share": 50.0, "reduction_pct": 20.0, "agent_reduction_pct": 15.0}


def _num(x, default):
    if x is None or x == "":
        return default
    try:
        return float(str(x).replace(",", ""))
    except ValueError:
        return default


def derived_defaults(diag_base, validation):
    out, src = {}, {}
    steps = {s["key"]: s for s in ((diag_base or {}).get("value_at_stake") or {}).get("steps", [])}
    total = (steps.get("TOTAL") or {}).get("usd")
    op = (steps.get("OPERATIONALLY_ADDRESSABLE") or {}).get("usd")
    if total and op is not None:
        out["addressable_share"] = round(op / total * 100, 1)
        src["addressable_share"] = f"진단 Value at Stake: 운영 개선 가능 {usd(op)} ÷ 총 {usd(total)} (가상)"
    head = (validation or {}).get("headline") or {}
    frac = as_fraction(head.get("saving_pct"))
    totals = policy_totals(validation)
    if frac is not None:
        out["reduction_pct"] = round(frac * 100, 1)
        src["reduction_pct"] = f"검증 headline: {head.get('best_policy')} vs {head.get('vs', 'CURRENT_RULE')} (가상 1주)"
    elif totals.get("CURRENT_RULE"):
        best = min(totals.values())
        out["reduction_pct"] = round((1 - best / totals["CURRENT_RULE"]) * 100, 1)
        src["reduction_pct"] = "검증 replay 최저 정책 vs 현업 Rule (가상 1주)"
    if totals.get("CURRENT_RULE") and totals.get("AGENT_HITL") is not None:
        out["agent_reduction_pct"] = round((1 - totals["AGENT_HITL"] / totals["CURRENT_RULE"]) * 100, 1)
        src["agent_reduction_pct"] = f"검증 replay: Agent+사람 승인 {usd(totals['AGENT_HITL'])} vs 현업 Rule {usd(totals['CURRENT_RULE'])} (가상 1주)"
    for k, v in FALLBACK.items():
        if k not in out:
            out[k] = v
            src[k] = "검증·진단 결과 없음 — 임의 가정값"
    return out, src


def run(params=None, diag_base=None, validation=None):
    params = params or {}
    derived, sources = derived_defaults(diag_base, validation)
    p, plist = {}, []
    for key, label, default, lo, hi, step, unit, basis in PARAMS:
        base = default  # 기본은 보수 가정. 가상 시나리오에서 나온 비율(derived)은 프리셋과 derived_from으로만 보여 준다
        value = _num(params.get(key), base)
        value = max(lo, min(hi, value))
        p[key] = value
        scenario_value = derived.get(key)
        plist.append({"key": key, "label": label, "value": value, "default": base, "min": lo, "max": hi, "step": step, "unit": unit,
                      "basis": basis, "derived_from": (f"{sources[key]} → {scenario_value}{unit}" if key in sources else None)})
    fx = p["fx_krw_per_usd"] or 1400.0
    annual = p["annual_calls"] * p["avg_demurrage_per_call_usd"]
    op = annual * p["addressable_share"] / 100
    sched = min(op, annual * p["reduction_pct"] / 100)
    agent = min(sched, annual * p["agent_reduction_pct"] / 100)
    expected = agent * p["adoption_rate"] / 100
    build_usd, run_usd = p["build_cost_krw"] / fx, p["annual_run_cost_krw"] / fx
    cost = build_usd + run_usd
    net = expected - cost
    roi = net / cost if cost else None
    monthly = (expected - run_usd) / 12
    payback = build_usd / monthly if monthly > 0 else None
    steps = [
        {"key": "ANNUAL_TOTAL", "label": "연간 총 체선료", "usd": annual, "note": f"{p['annual_calls']:,.0f}척 × {usd(p['avg_demurrage_per_call_usd'])}"},
        {"key": "OPERATIONALLY_ADDRESSABLE", "label": "운영적으로 개선 가능", "usd": op, "note": f"× {p['addressable_share']:.1f}%"},
        {"key": "SCHEDULING_ADDRESSABLE", "label": "Scheduling Addressable", "usd": sched, "note": f"총액 × {p['reduction_pct']:.1f}% (운영 개선 가능액 상한)"},
        {"key": "AGENT_ADDRESSABLE", "label": "Agent Addressable", "usd": agent, "note": f"총액 × {p['agent_reduction_pct']:.1f}% (Scheduling 상한)"},
        {"key": "EXPECTED_SAVING", "label": "연간 기대 절감", "usd": expected, "note": f"× 채택률 {p['adoption_rate']:.0f}%"},
        {"key": "COST", "label": "1년차 비용(구축+운영)", "usd": cost, "note": f"({p['build_cost_krw'] / 1e8:.1f}억 + {p['annual_run_cost_krw'] / 1e8:.1f}억) ÷ {fx:,.0f}"},
        {"key": "NET_BENEFIT", "label": "1년차 순효과", "usd": net, "note": "기대 절감 − 1년차 비용"},
    ]
    for s in steps:
        s["usd"] = round(s["usd"], 2)
        s["krw"] = round(s["usd"] * fx)
    presets = [
        {"id": "conservative", "label": "보수(평시 가정)", "basis": "가정 — 스트레스 주간이 아닌 평시를 가정",
         "params": {"addressable_share": 50, "reduction_pct": 10, "agent_reduction_pct": 8, "adoption_rate": 50}},
        {"id": "scenario", "label": "가상 시나리오 비율 그대로", "basis": "가상 1주(폭풍·SBM 1기)의 진단·검증 비율 — 상한성",
         "params": {k: derived[k] for k in ("addressable_share", "reduction_pct", "agent_reduction_pct")} | {"adoption_rate": 70}},
    ]
    return {
        "params": plist, "steps": steps, "presets": presets,
        "annual_saving_usd": round(expected, 2), "net_benefit_usd": round(net, 2),
        "roi": None if roi is None else round(roi, 4),
        "payback_months": None if payback is None else round(payback, 1),
        "fx_krw_per_usd": fx,
        "krw": {"annual_saving": round(expected * fx), "net_benefit": round(net * fx), "cost": round(cost * fx)},
        "sources": sources,
        "notes": ["모든 값은 가정이다 — 연간 척수·척당 체선료·비용을 현업 수치로 바꿔야 의미가 있다.",
                  "기본값은 보수 가정(운영 개선 가능 50%, Scheduling 절감 10%, 에이전트 8%, 채택 50%)이다. "
                  "가상 시나리오(폭풍·SBM 1기 1주)의 절감률은 '가상 시나리오 비율' 프리셋으로만 제공한다 — 스트레스 1주를 연간에 적용하는 상한성 가정.",
                  "ROI = 1년차 순효과 ÷ 1년차 비용, 회수 기간 = 구축비 ÷ (월 기대 절감 − 월 운영비)."],
        "status": "VIRTUAL",
    }
