"""DIAGNOSIS — 로드맵 Phase 13~17: Baseline KPI · Pareto · Root Cause · Controllability · Value at Stake.

숫자는 모두 가상 시나리오(data/live)에서 나온 VIRTUAL 값이다. 실제 터미널 데이터(항차 실적·SOF·계약)를 같은
형식으로 넣으면 같은 함수가 그대로 돈다. 원인별 비용은 '단독 제거 효과(기여액)'가 서로 겹치므로, 총액과 맞추려면
기여액 비례로 배분한다(가정).
"""
from __future__ import annotations

import json
import math
from functools import lru_cache

from . import golden, reasons, sim
from .agent import Agent
from .rules import DATA, param
from .timeutil import add_h, fmt_h, fmt_ts, hours, iso, round_usd, ts

ADOPTION_DEFAULT = 0.7
SKIP_ALLOC = {"SHIFT", "EXCESS_PUMPING"}
CLASS_LABEL = {"A": "A. 통제 가능 → Optimization Decision", "B": "B. 통제 불가·예측 가능 → Scheduling Constraint",
               "C": "C. 통제 불가·불확실 → Scenario / Risk", "D": "D. 사실상 대응 불가 → Scope Outside"}
OP_LABEL = {"DISCHARGE": "수입(양하)", "LOAD": "수출(선적)"}
POLICY_LABEL = {"CURRENT_RULE": "현업 Rule", "FCFS": "FCFS", "RATE": "요율 우선", "LAYTIME_RISK": "레이타임 위험 우선",
                "OPTIMIZER": "Optimizer", "RISK_AWARE": "Risk-aware Optimizer", "AGENT_HITL": "Agent + 사람 승인"}


def usd(x):
    return "—" if x is None else f"${x:,.0f}"


def pct(x):
    return "—" if x is None else f"{x * 100:.0f}%"


@lru_cache(maxsize=1)
def controllability_table():
    return json.loads((DATA / "discovery" / "controllability.json").read_text(encoding="utf-8"))["causes"]


def _first(events, typ):
    return next((e["ts"] for e in events if e["type"] == typ), None)


def _hm(level):
    return level


def policy_totals(validation):
    """validation.replay → {policy: total_usd}. 검증 결과가 없거나 형식이 다르면 {}."""
    out = {}
    for r in (validation or {}).get("replay") or []:
        if isinstance(r, dict) and r.get("policy") is not None and r.get("total_usd") is not None:
            out[r["policy"]] = float(r["total_usd"])
    return out


def as_fraction(x):
    """검증 headline의 saving_pct가 0~1(비율)인지 0~100(퍼센트)인지 모르므로 비율로 맞춘다."""
    if x is None:
        return None
    x = float(x)
    return x / 100.0 if x > 1.0 else x


# ---------------------------------------------------------------- per call
def _per_call(world, te):
    rows, reason_rows = [], {}
    for cid, c in te.items():
        st, r = c["statement"], c["sim"]
        vessel, call, con = world.vessel_of(cid), world.calls[cid], world.contracts[cid]
        ev = c["events"]
        anch, aweigh, af = _first(ev, "ANCHORED"), _first(ev, "ANCHOR_AWEIGH"), _first(ev, "ALL_FAST")
        oc, ocomp, hd, ll = _first(ev, "OPS_COMMENCED"), _first(ev, "OPS_COMPLETED"), _first(ev, "HOSES_DISCONNECTED"), _first(ev, "LAST_LINE")
        stop_h = sum(hours(a, b) for a, b in r["stops"])
        port_stay = hours(anch, ll)
        wait = hours(anch, aweigh) if aweigh else 0.0
        shift = hours(aweigh, af) if aweigh else 0.0
        berth_wait = hours(af, oc)
        operation = hours(oc, ocomp) - stop_h
        idle = port_stay - wait - shift - operation
        rs = reasons.classify(ev, world.terms(cid), world.context_for(r), st, r, vessel) if st.get("status") == "OK" else []
        reason_rows[cid] = rs
        rows.append({
            "call_id": cid, "vessel": vessel["name"], "vessel_type": vessel["type"], "berth_id": r["berth_id"], "seq": r["seq"],
            "layer": con["layer"], "operation": call["operation"], "rate_usd_day": con["rate_usd_day"], "dwt": vessel["dwt"],
            "amount_usd": round_usd(st.get("amount_usd", 0.0)), "demurrage_h": st.get("demurrage_h", 0.0),
            "port_stay_h": port_stay, "anchorage_wait_h": wait, "shift_h": shift, "berth_wait_h": berth_wait,
            "operation_h": operation, "stop_h": stop_h, "idle_h": idle,
            "anchored": iso(anch), "all_fast": iso(af), "hoses_off": iso(hd), "last_line": iso(ll),
            "issues": [i["code"] for i in st.get("issues", [])],
        })
    return rows, reason_rows


def _allocate(per_call, reason_rows):
    """콜별 체선료를 원인 기여액 비례로 배분 → 원인별 합 = 총 체선료."""
    alloc = {}
    for row in per_call:
        amount = row["amount_usd"]
        if amount <= 0:
            continue
        weights = {r["key"]: r["marginal_usd"] for r in reason_rows[row["call_id"]]
                   if r["key"] not in SKIP_ALLOC and r["marginal_usd"] > 0}
        total_w = sum(weights.values())
        if total_w <= 0:
            weights, total_w = {"UNCLASSIFIED": 1.0}, 1.0
        for key, w in weights.items():
            alloc.setdefault(key, {})[row["call_id"]] = amount * w / total_w
    return alloc


# ---------------------------------------------------------------- KPI
def _kpi(world, agent, history, te, per_call):
    n = len(per_call)
    total = sum(r["amount_usd"] for r in per_call)
    amounts = sorted((r["amount_usd"] for r in per_call), reverse=True)
    top_n = max(1, math.ceil(n * 0.1))
    with_dem = sum(1 for a in amounts if a > 0)
    avg = (lambda key: sum(r[key] for r in per_call) / n if n else 0.0)

    horizon = hours(world.t0, world.t_end)
    util = {}
    for bid in world.berths:
        occ = sum(hours(ts(r["all_fast"]), min(ts(r["last_line"]), world.t_end)) for r in per_call if r["berth_id"] == bid)
        util[bid] = occ / horizon
    used_berths = {r["berth_id"] for r in per_call}
    util_used = [util[b] for b in used_berths]

    # Schedule adherence: t0에 기준 계획으로 예측한 ETB 대비 실제 접안
    v0 = agent.view(history, world.t0)
    etb_err = [abs(hours(v0["calls"][r["call_id"]]["sim"]["etb"], ts(r["all_fast"]))) for r in per_call]

    tl = agent.timeline(history)
    etb_changes = sum(1 for it in tl["items"] if it["kind"] in ("IMPACT", "PLAN_APPLIED")
                      for ch in it.get("changes", []) if abs(ch.get("etb_delta_min") or 0) >= param("ENG-ETB-CHANGE", "etb_minutes"))
    plan_versions = len(history)

    # ETA: 최초 통지 ETA vs 실제 투묘
    eta_err = []
    for r in per_call:
        first_eta = ts(world.calls[r["call_id"]]["eta_updates"][0]["eta"])
        eta_err.append(hours(first_eta, ts(r["anchored"])))
    # 하역 종료 예측 오차: 접안 완료 시점에 예측한 호스 분리 vs 실제
    ops_err = []
    for r in per_call:
        t_af = ts(r["all_fast"])
        if t_af > world.t_end:
            continue
        proj = agent.view(history, t_af)["calls"][r["call_id"]]["sim"]["etc"]
        ops_err.append(abs(hours(proj, ts(r["hoses_off"]))))
    wf = weather_forecast_error(world)

    def k(key, label, value, unit, note=""):
        return {"key": key, "label": label, "value": value, "unit": unit, "note": note}

    util_note = " · ".join(f"{b} {util[b] * 100:.0f}%" for b in world.berths)
    return {
        "financial": [
            k("total_usd", "총 체선료", round_usd(total), "USD", "가상 시나리오 1주(11/03~11/08) 실제 결과"),
            k("per_vessel_usd", "척당 평균 체선료", round_usd(total / n) if n else 0.0, "USD", f"{n}척 기준"),
            k("share_with_demurrage", "체선 발생 선박 비율", with_dem / n * 100 if n else 0.0, "%", f"{with_dem}/{n}척"),
            k("top_share", "상위 10% 선박 비용 비중", sum(amounts[:top_n]) / total * 100 if total else 0.0, "%", f"상위 {top_n}척"),
        ],
        "time": [
            k("port_stay_h", "평균 Port Stay", avg("port_stay_h"), "h", "투묘 → 이안"),
            k("anchorage_wait_h", "평균 묘박 대기", avg("anchorage_wait_h"), "h", "투묘 → 양묘"),
            k("berth_wait_h", "평균 접안 후 대기", avg("berth_wait_h"), "h", "접안 완료 → 하역 개시(호스 연결·준비)"),
            k("operation_h", "평균 하역 시간", avg("operation_h"), "h", "하역 개시 → 완료, 중단 제외"),
            k("idle_h", "평균 Idle", avg("idle_h"), "h", "Port Stay − 대기 − 이동 − 하역(준비·중단·서류·이안 포함)"),
        ],
        "operational": [
            k("utilization", "선석 점유율(사용 선석 평균)", sum(util_used) / len(util_used) * 100 if util_used else 0.0, "%", util_note),
            k("throughput", "처리 척수", float(sum(1 for r in per_call if r["hoses_off"] and ts(r["hoses_off"]) <= world.t_end)), "척",
              f"{sum(world.calls[r['call_id']]['quantity_bbl'] for r in per_call) / 1e6:.2f}M bbl"),
            k("schedule_adherence_h", "계획 대비 접안 오차(평균)", sum(etb_err) / len(etb_err) if etb_err else 0.0, "h",
              f"t0 계획 ETB 대비 실제 접안, 최대 {fmt_h(max(etb_err)) if etb_err else '—'}"),
            k("replans", "재계획 횟수", float(plan_versions - 1 + etb_changes), "count",
              f"계획 버전 {plan_versions - 1}회 + ETB 30분 이상 변경 {etb_changes}건"),
        ],
        "reliability": [
            k("eta_error_h", "ETA 오차(최초 통지 vs 실제)", sum(abs(x) for x in eta_err) / len(eta_err) if eta_err else 0.0, "h",
              f"최대 {max((abs(x) for x in eta_err), default=0):.1f}h · 변경 {sum(1 for c in world.calls.values() if len(c['eta_updates']) > 1)}척"),
            k("ops_forecast_error_h", "하역 종료 예측 오차", sum(ops_err) / len(ops_err) if ops_err else 0.0, "h",
              f"접안 시점 예측 vs 실제 호스 분리, 최대 {max(ops_err, default=0):.1f}h"),
            k("weather_forecast_error", "기상 예보 오차(폭풍 시간대)", wf["first"]["max_abs_ms"], "m/s",
              f"{wf['first']['id']}: 18 m/s 이상 {wf['first']['missed_ops_hours']}시간 놓침 · "
              f"{wf['latest']['id']}: 최대 오차 {wf['latest']['max_abs_ms']:.1f} m/s, 놓친 시간 {wf['latest']['missed_ops_hours']}"),
        ],
    }, util


def weather_forecast_error(world):
    """폭풍 시간대(관측 ≥ 접안 한계)의 예보 오차. 첫 예보와 마지막 예보를 각각."""
    limit_moor = param("ULS-WEATHER-LIMIT", "mooring_ms")
    limit_ops = param("ULS-WEATHER-LIMIT", "ops_sbm_ms")
    storm = [h for h, v in world.obs.items() if v >= limit_moor]
    out = {}
    for tag, (issued, series, raw) in (("first", world.forecasts[0]), ("latest", world.forecasts[-1])):
        errs = [abs(series.get(h, 0.0) - world.obs[h]) for h in storm]
        out[tag] = {"id": raw["id"], "issued_at": iso(issued), "max_abs_ms": round(max(errs), 1) if errs else 0.0,
                    "missed_ops_hours": sum(1 for h in storm if world.obs[h] >= limit_ops and series.get(h, 0.0) < limit_ops)}
    first_storm = min((ts(h) for h, v in world.obs.items() if v >= limit_ops), default=None)
    out["storm_start"] = iso(first_storm)
    out["lead_h"] = hours(world.forecasts[-1][0], first_storm) if first_storm else None
    out["storm_hours"] = len(storm)
    return out


# ---------------------------------------------------------------- Pareto
def _pareto_rows(groups, total_cost_key="cost_usd"):
    rows = sorted(groups, key=lambda g: (-g["cost_usd"], -g["duration_h"]))
    total = sum(g["cost_usd"] for g in rows)
    cum = 0.0
    for g in rows:
        g["cost_usd"] = round_usd(g["cost_usd"])
        g["share"] = g["cost_usd"] / total if total else 0.0
        cum += g["share"]
        g["cum_share"] = min(cum, 1.0)
    return rows


def _pareto(world, per_call, reason_rows, alloc):
    by_cause = {}
    for cid, rs in reason_rows.items():
        for r in rs:
            g = by_cause.setdefault(r["key"], {"key": r["key"], "code": r["code"], "label": r["label"], "frequency": 0,
                                               "duration_h": 0.0, "cost_usd": 0.0, "marginal_usd": 0.0})
            if r["hours"] >= 0.25:
                g["frequency"] += 1
            g["duration_h"] += r["hours"]
            g["marginal_usd"] = round_usd(g["marginal_usd"] + r["marginal_usd"])
    for key, calls in alloc.items():
        g = by_cause.setdefault(key, {"key": key, "code": controllability_table().get(key, {}).get("code", "—"),
                                      "label": controllability_table().get(key, {}).get("label", key),
                                      "frequency": len(calls), "duration_h": 0.0, "cost_usd": 0.0, "marginal_usd": 0.0})
        g["cost_usd"] += sum(calls.values())

    def group(key_fn, label_fn):
        out = {}
        for r in per_call:
            k = key_fn(r)
            g = out.setdefault(k, {"key": k, "label": label_fn(r), "frequency": 0, "duration_h": 0.0, "cost_usd": 0.0, "calls": 0})
            g["calls"] += 1
            if r["amount_usd"] > 0:
                g["frequency"] += 1
            g["duration_h"] += r["demurrage_h"]
            g["cost_usd"] += r["amount_usd"]
        return list(out.values())

    def rate_band(r):
        x = r["rate_usd_day"]
        return "≥$100k/일" if x >= 100000 else ("$50k~100k/일" if x >= 50000 else "<$50k/일")

    def size_band(r):
        x = r["dwt"]
        return "≥200k DWT (VLCC)" if x >= 200000 else ("120k~200k DWT" if x >= 120000 else ("60k~120k DWT" if x >= 60000 else "<60k DWT"))

    return {
        "by_cause": _pareto_rows(list(by_cause.values())),
        "by_berth": _pareto_rows(group(lambda r: r["berth_id"], lambda r: f"{r['berth_id']} {world.berths[r['berth_id']]['name']}")),
        "by_vessel_type": _pareto_rows(group(lambda r: r["vessel_type"], lambda r: r["vessel_type"])),
        "by_operation": _pareto_rows(group(lambda r: r["operation"], lambda r: OP_LABEL.get(r["operation"], r["operation"]))),
        "by_rate": _pareto_rows(group(rate_band, rate_band)),
        "by_size": _pareto_rows(group(size_band, size_band)),
        "notes": ["원인별 cost_usd = 콜별 체선료를 원인 기여액(단독 제거 효과) 비례로 배분한 값 — 합계가 총 체선료와 같다 [가정].",
                  "marginal_usd = 그 원인 시간만 없었다고 보고 다시 계산한 감소분. 원인끼리 겹쳐 합계가 총액보다 크다.",
                  "선석·선종·수출입·요율·크기별 frequency = 체선이 난 척수, duration_h = 체선 시간 합."],
    }


# ---------------------------------------------------------------- Root cause
def _option_for(agent, history, cid):
    """이 선박의 비용을 가장 많이 줄인 에이전트 후보(1~3순위)."""
    best = None
    for it in agent.timeline(history)["items"]:
        opts = it.get("options") or {}
        for o in opts.get("best", []):
            d = next((p["delta"] for p in o.get("per_call", []) if p["call_id"] == cid), 0.0)
            if d < -1 and (best is None or d < best[2]):
                best = (it["id"], o, d)
    if not best:
        return None
    item_id, o, d = best
    return {"item_id": item_id, "option_id": o["id"], "title": o["title"], "delta_usd": round_usd(d),
            "text": f"{item_id} {o['id']}: {o['title']} → 이 선박 {usd(d).replace('$-', '−$')}"}


def _predecessor(te, cid):
    r = te[cid]["sim"]
    for other, c in te.items():
        s = c["sim"]
        if s["berth_id"] == r["berth_id"] and s["seq"] == r["seq"] - 1:
            return other
    return None


def _drivers(world, te, cid, depth):
    """선박 cid의 종료를 늦춘 요인(앞 선박 분석용)."""
    c, out = te[cid], []
    r, vessel = c["sim"], world.vessel_of(cid)
    name = vessel["name"]
    stop_h = sum(hours(a, b) for a, b in r["stops"])
    berth = world.berths[r["berth_id"]]
    if stop_h >= 0.5:
        a = min(a for a, _ in r["stops"])
        b = max(b for _, b in r["stops"])
        peak = max((world.obs.get(iso(h), 0) for h in _hours_between(a, b)), default=0)
        out.append({"level": depth, "text": f"{name} 하역 중단 {fmt_h(stop_h)} — 폭풍 {fmt_ts(a)}~{fmt_ts(b)}", "rule": "ULS-WEATHER-LIMIT"})
        out.append({"level": depth + 1, "text": f"{berth['id']} 하역 중단 한계 {berth['ops_stop_wind_ms']} m/s 초과 (관측 최대 {peak:.1f} m/s, 한계값은 가정)",
                    "rule": "ULS-WEATHER-LIMIT"})
    if world.calls[cid]["operation"] == "DISCHARGE" and r["rate_m3h"] < vessel["pump_m3h"]:
        lost = r["volume_m3"] / r["rate_m3h"] - r["volume_m3"] / vessel["pump_m3h"]
        out.append({"level": depth, "text": f"{name} 육상 수용률 {r['rate_m3h']:,.0f} < 선박 펌프 {vessel['pump_m3h']:,} m3/h → 하역 +{fmt_h(lost)}",
                    "rule": "PLAN-PUMP-RATE"})
        out.append({"level": depth + 1, "text": "탱크 배정 제약(생산조정팀·원유재고예측) — 추가 배정 레버가 있으면 줄일 수 있음", "rule": "PLAN-PUMP-RATE"})
    waits = {}
    for w in r["wait_reasons"]:
        waits[w["reason"]] = waits.get(w["reason"], 0.0) + hours(w["from"], w["to"])
    if waits.get("CONGESTION", 0) >= 1:
        pred = _predecessor(te, cid)
        out.append({"level": depth, "text": f"{name} 자신도 선석 점유로 {fmt_h(waits['CONGESTION'])} 대기"
                    + (f" (앞 선박 {world.vessel_of(pred)['name']})" if pred else ""), "rule": "ASB-09-REACHABLE"})
    return out


def _hours_between(a, b):
    h = a.replace(minute=0, second=0, microsecond=0)
    while h < b:
        yield h
        h = add_h(h, 1)


def _root_causes(world, agent, history, te, per_call, reason_rows):
    out = []
    oos_by_berth = {bid: world.oos_at(bid, None) for bid in world.berths}
    for row in sorted(per_call, key=lambda r: -r["amount_usd"]):
        if row["amount_usd"] <= 0:
            continue
        cid = row["call_id"]
        c = te[cid]
        r = c["sim"]
        chain = [{"level": 0, "text": f"{row['vessel']} 체선 {fmt_h(row['demurrage_h'])} · {usd(row['amount_usd'])} ({row['berth_id']} #{row['seq']})",
                  "rule": "ASB-08-RATE-PRORATA"}]
        rs = sorted([x for x in reason_rows[cid] if x["key"] not in SKIP_ALLOC],
                    key=lambda x: (-x["marginal_usd"], -x["hours"]))[:2]
        top_key = rs[0]["key"] if rs else "UNCLASSIFIED"
        for x in rs:
            key = x["key"]
            if key == "WAIT:CONGESTION":
                pred = _predecessor(te, cid)
                pred_ll = _first(te[pred]["events"], "LAST_LINE") if pred else None
                chain.append({"level": 1, "text": f"선석 점유 대기 {fmt_h(x['hours'])}"
                              + (f" — 앞 선박 {world.vessel_of(pred)['name']} 이안 {fmt_ts(pred_ll)}" if pred else ""), "rule": "ASB-09-REACHABLE"})
                if world.berths[r["berth_id"]]["type"] == "SBM":
                    others = [b for b, x2 in world.berths.items() if x2["type"] == "SBM" and b != r["berth_id"]]
                    for b in others:
                        win = oos_by_berth[b]
                        anch = ts(row["anchored"])
                        if win and any(ts(w["from"]) <= anch < ts(w["to"]) for w in win):
                            end = max(ts(w["to"]) for w in win)
                            chain.append({"level": 2, "text": f"{b} 정비(~{fmt_ts(end)})로 SBM 1기 운영 — VLCC·수에즈막스가 한 선석에 줄을 섬",
                                          "rule": "BERTH-OOS"})
                if pred:
                    chain.extend(_drivers(world, te, pred, 2))
            elif key == "WAIT:NIGHT":
                chain.append({"level": 1, "text": f"야간 계류·접안 제한 대기 {fmt_h(x['hours'])} — 선석이 비었지만 주간 창(07:00~17:30, 가정) 밖",
                              "rule": r["daytime_rule_id"]})
                chain.append({"level": 2, "text": f"선석이 비는 시각 {fmt_ts(r['berth_free_from'])} — 앞 선박 종료가 야간에 걸림", "rule": "PLAN-TURNOVER"})
            elif key == "WAIT:WEATHER":
                chain.append({"level": 1, "text": f"강풍 접안 불가 {fmt_h(x['hours'])}", "rule": "ULS-WEATHER-LIMIT"})
                chain.append({"level": 2, "text": f"접·계류 한계 {param('ULS-WEATHER-LIMIT', 'mooring_ms')} m/s 이상 바람(한계값 가정)", "rule": "ULS-WEATHER-LIMIT"})
            elif key == "STOP:WEATHER":
                chain.extend(_drivers(world, te, cid, 1)[:2])
            elif key == "SHORE_RATE":
                vessel = world.vessel_of(cid)
                chain.append({"level": 1, "text": f"육상 수용률 {r['rate_m3h']:,.0f} < 선박 펌프 {vessel['pump_m3h']:,} m3/h → 하역 +{fmt_h(x['hours'])}",
                              "rule": "PLAN-PUMP-RATE"})
                chain.append({"level": 2, "text": "탱크 배정 제약(생산조정팀) — 하역이 길어지면 뒤 선박 대기로 전이", "rule": "PLAN-PUMP-RATE"})
            elif key == "WAIT:OOS":
                chain.append({"level": 1, "text": f"선석 정비 대기 {fmt_h(x['hours'])}", "rule": "BERTH-OOS"})
            else:
                chain.append({"level": 1, "text": f"{x['label']} {fmt_h(x['hours'])}", "rule": None})
        dedup, seen = [], set()
        for step in chain:
            if step["text"] not in seen:
                seen.add(step["text"])
                dedup.append(step)
        chain = [s for s in dedup if s["level"] <= 3]
        weather = top_key in ("STOP:WEATHER", "WAIT:WEATHER") or any("폭풍" in s["text"] for s in chain)
        wf = weather_forecast_error(world)
        if top_key == "WAIT:NIGHT":
            pred_txt = "항상 예측 가능 — 규정(주간 창)과 앞 선박 종료 예측만 있으면 된다"
        elif weather:
            pred_txt = (f"부분 — 폭풍은 {wf['latest']['id']}(발행 {fmt_ts(ts(wf['latest']['issued_at']))})로 약 {wf['lead_h']:.0f}시간 전에 알 수 있었고,"
                        f" 첫 예보 {wf['first']['id']}에는 없었다")
        elif top_key == "SHORE_RATE":
            pred_txt = "예측 가능 — 탱크 배정은 입항 전에 정해진다"
        else:
            pred_txt = "예측 가능 — 계획 수립 시점(t0)에 앞 선박 종료와 대기를 계산할 수 있다"
        alt = _option_for(agent, history, cid)
        out.append({"call_id": cid, "vessel": row["vessel"], "amount_usd": row["amount_usd"], "top_cause": top_key,
                    "chain": chain, "structural": not (top_key in ("STOP:WEATHER", "WAIT:WEATHER")),
                    "predictable": pred_txt,
                    "decision_alternative": alt["text"] if alt else "에이전트 후보 없음 — 같은 시점에 바꿀 수 있는 결정이 없었음",
                    "alternative": alt})
    return out


# ---------------------------------------------------------------- Controllability
def _level_share(x):
    return "H" if x >= 0.3 else ("M" if x >= 0.1 else "L")


def _controllability(alloc, reason_rows, per_call, nor_calls):
    table = controllability_table()
    total = sum(r["amount_usd"] for r in per_call) or 1.0
    n = len(per_call) or 1
    keys = set(alloc)
    for rs in reason_rows.values():
        keys.update(x["key"] for x in rs if x["hours"] >= 0.25)
    keys.add("NOR_TIMING")
    out = []
    for key in keys:
        base = table.get(key) or table["UNCLASSIFIED"]
        cost = sum(alloc.get(key, {}).values())
        if key == "NOR_TIMING":
            freq = len(nor_calls)
        else:
            freq = sum(1 for rs in reason_rows.values() if any(x["key"] == key and x["hours"] >= 0.25 for x in rs)) or len(alloc.get(key, {}))
        scores = dict(base["scores"])
        scores["cost_impact"] = _level_share(cost / total)
        scores["frequency"] = "H" if freq / n >= 0.5 else ("M" if freq / n >= 0.25 else "L")
        out.append({"key": key, "code": base["code"], "label": base["label"], "cost_usd": round_usd(cost), "frequency": freq,
                    "scores": scores, "class": base["class"], "class_label": CLASS_LABEL[base["class"]],
                    "solution": base.get("solution"), "rationale": base["rationale"], "basis": "가정"})
    out.sort(key=lambda x: (-x["cost_usd"], x["class"], x["key"]))
    return out


def class_shares(ctrl):
    total = sum(x["cost_usd"] for x in ctrl)
    shares = {c: 0.0 for c in "ABCD"}
    for x in ctrl:
        shares[x["class"]] += x["cost_usd"]
    return {c: {"usd": round_usd(v), "share": (v / total if total else 0.0)} for c, v in shares.items()}


# ---------------------------------------------------------------- Value at Stake
def _value_at_stake(per_call, ctrl, validation, adoption=ADOPTION_DEFAULT):
    total = round_usd(sum(r["amount_usd"] for r in per_call))
    unavoidable = round_usd(sum(x["cost_usd"] for x in ctrl if x["class"] in ("C", "D")))
    op_addr = round_usd(max(0.0, total - unavoidable))
    totals = policy_totals(validation)
    steps = [
        {"key": "TOTAL", "label": "총 체선료", "usd": total, "kind": "total", "note": "가상 시나리오 실제 결과"},
        {"key": "UNAVOIDABLE", "label": "통제 불가·불확실 원인 제외(C·D)", "usd": -unavoidable, "kind": "minus",
         "note": "기상(불확실)·이동·선박 귀책 등 — 보수적으로 전부 제외"},
        {"key": "OPERATIONALLY_ADDRESSABLE", "label": "운영적으로 개선 가능", "usd": op_addr, "kind": "subtotal",
         "note": "A(통제 가능)+B(예측 가능 제약) 원인 비용"},
    ]
    assumptions = ["원인별 비용은 단독 제거 효과(기여액) 비례 배분 [가정]",
                   "C(불확실)·D(대응 불가)는 Unavoidable로 보수적 제외 — 실제로는 예보에 대응해 일부 피할 수 있다(예: 폭풍 전 하역 종료)",
                   "통제가능성 점수는 팀 가정(data/discovery/controllability.json) — 현업 검증 전"]
    if totals:
        best_policy = min(totals, key=totals.get)
        sched = round_usd(min(op_addr, max(0.0, total - totals[best_policy])))
        steps.append({"key": "SCHEDULING_ADDRESSABLE", "label": "Scheduling으로 줄일 수 있는 부분", "usd": sched, "kind": "subtotal",
                      "note": f"이 결과 − 검증 정책 중 최저({POLICY_LABEL.get(best_policy, best_policy)} {usd(totals[best_policy])}), 당시 정보만 사용 · 운영 개선 가능액 상한"})
        assumptions.append("Scheduling Addressable = 이 결과 − Historical Replay 정책 중 최저 비용(미래 정보 미사용)")
        if "AGENT_HITL" in totals:
            agent_addr = round_usd(min(sched, max(0.0, total - totals["AGENT_HITL"])))
            steps.append({"key": "AGENT_ADDRESSABLE", "label": "Agent(후보 제시+사람 승인)로 줄일 수 있는 부분", "usd": agent_addr, "kind": "subtotal",
                          "note": f"이 결과 − 에이전트 1순위 후보 승인 경로({usd(totals['AGENT_HITL'])}) · Scheduling 상한"})
            assumptions.append("Agent Addressable = 이 결과 − 작업함 1순위 옵션을 제시 시점에 승인한 경로")
        else:
            agent_addr = None
            steps.append({"key": "AGENT_ADDRESSABLE", "label": "Agent로 줄일 수 있는 부분", "usd": None, "kind": "subtotal", "note": "검증 결과 없음(AGENT_HITL)"})
        expected = round_usd(agent_addr * adoption) if agent_addr is not None else None
        steps.append({"key": "EXPECTED_SAVING", "label": "기대 절감액", "usd": expected, "kind": "result",
                      "note": f"Agent Addressable × 채택률 {adoption:.0%} [가정]" if expected is not None else "검증 결과 없음"})
        assumptions.append(f"채택률 {adoption:.0%} [가정] — Shadow Mode에서 Acceptance Rate로 교체")
    else:
        for key, label, kind in (("SCHEDULING_ADDRESSABLE", "Scheduling으로 줄일 수 있는 부분", "subtotal"),
                                 ("AGENT_ADDRESSABLE", "Agent로 줄일 수 있는 부분", "subtotal"), ("EXPECTED_SAVING", "기대 절감액", "result")):
            steps.append({"key": key, "label": label, "usd": None, "kind": kind, "note": "검증 결과 없음"})
    return {"steps": steps, "assumptions": assumptions}


# ---------------------------------------------------------------- facts (discovery 자동 답변용)
def _facts(world, agent, history, te, per_call, reason_rows, wf):
    facts = {}
    compat = []
    for cid in world.calls:
        v, call = world.vessel_of(cid), world.calls[cid]
        ok = [bid for bid, b in world.berths.items() if sim.compatibility(b, v, call)[0]]
        compat.append({"vessel": v["name"], "type": v["type"], "berths": ok})
    facts["compatibility"] = compat
    night_free = weather_free = 0.0
    per = []
    for cid, c in te.items():
        for w in c["sim"]["wait_reasons"]:
            h = hours(w["from"], w["to"])
            if w["reason"] == "NIGHT":
                night_free += h
                per.append((world.vessel_of(cid)["name"], "야간", h))
            elif w["reason"] == "WEATHER":
                weather_free += h
                per.append((world.vessel_of(cid)["name"], "강풍", h))
    facts["berth_free_wait"] = {"night_h": night_free, "weather_h": weather_free, "detail": per}
    facts["weather"] = wf
    tl = agent.timeline(history)
    facts["weather_items"] = [it["id"] for it in tl["items"] if any(t["kind"] == "FORECAST" for t in it.get("trigger", []))]
    facts["impact_items"] = [{"id": it["id"], "title": it["title"], "delta_usd": it.get("delta_usd"),
                              "options": [{"id": o["id"], "title": o["title"], "saving_usd": o["saving_usd"]} for o in (it.get("options") or {}).get("best", [])]}
                             for it in tl["items"] if it["kind"] in ("IMPACT", "BASELINE")]
    facts["absorbed"] = [a["text"] for it in tl["items"] for a in it.get("absorbed", [])][:3]
    facts["cascade"] = [ch["text"] for it in tl["items"] if it["kind"] == "IMPACT" for ch in it.get("changes", [])
                        if "앞 선박 이안" in ch.get("text", "")][:3]
    facts["plan_v1"] = {b: [world.vessel_of(c)["name"] for c in seq] for b, seq in world.plan_v1["sequence"].items() if seq}
    facts["forecasts"] = [{"id": raw["id"], "issued_at": iso(issued), "summary": raw["summary"]} for issued, _, raw in world.forecasts]
    facts["info_changes"] = [{"t": iso(e["t"]), "kind": e["kind"], "label": e.get("label") or ""} for e in world.info_events(history)
                             if e["kind"] in ("ETA", "FORECAST", "CONSTRAINT")]
    facts["eta_updates"] = sum(len(c["eta_updates"]) - 1 for c in world.calls.values())
    facts["eta_revised_calls"] = sum(1 for c in world.calls.values() if len(c["eta_updates"]) > 1)
    facts["eta_changes"] = [{"vessel": world.vessel_of(cid)["name"], "first_eta": c["eta_updates"][0]["eta"], "last_eta": c["eta_updates"][-1]["eta"],
                             "revisions": len(c["eta_updates"]) - 1, "shift_h": hours(ts(c["eta_updates"][0]["eta"]), ts(c["eta_updates"][-1]["eta"]))}
                            for cid, c in world.calls.items() if len(c["eta_updates"]) > 1]
    facts["vessel_types"] = {}
    for cid in world.calls:
        t = world.vessel_of(cid)["type"]
        facts["vessel_types"][t] = facts["vessel_types"].get(t, 0) + 1
    facts["calls"] = len(world.calls)
    facts["shore_rate"] = [{"vessel": r["vessel"], "hours": x["hours"], "marginal_usd": x["marginal_usd"]}
                           for r in per_call for x in reason_rows[r["call_id"]] if x["key"] == "SHORE_RATE"]
    facts["nor_early"] = [r["vessel"] for r in per_call if "NOR_EARLY" in r["issues"]]
    try:
        from . import claims
        rows = claims.list_claims()
        facts["claims"] = {"count": len(rows), "with_variance": sum(1 for r in rows if abs(r["variance_usd"]) >= 1),
                           "variance_usd": round_usd(sum(r["variance_usd"] for r in rows)),
                           "rows": [{"claim_id": r["claim_id"], "vessel": r["vessel"], "claimed_usd": r["claimed_usd"],
                                     "computed_usd": r["computed_usd"], "code": r["recommendation_code"]} for r in rows]}
    except Exception:  # noqa: BLE001 — 클레임 모듈이 없어도 진단은 돈다
        facts["claims"] = None
    passed, cases = 0, golden.cases()[1]
    for case in cases:
        _, _, st = golden.run_case(case["id"])
        if st.get("status") == "OK" and abs(st["amount_usd"] - case["expected"]["amount_usd"]) < 0.01:
            passed += 1
    facts["golden"] = {"passed": passed, "total": len(cases)}
    return facts


# ---------------------------------------------------------------- entry
def run(world, history=None, validation=None, agent=None, case=None, adoption=ADOPTION_DEFAULT):
    history = history or world.base_history()
    agent = agent or Agent(world)
    case = case or ("base" if len(history) == 1 else "current")
    te = agent.truth_eval(history)
    per_call, reason_rows = _per_call(world, te)
    kpi, util = _kpi(world, agent, history, te, per_call)
    alloc = _allocate(per_call, reason_rows)
    pareto = _pareto(world, per_call, reason_rows, alloc)
    roots = _root_causes(world, agent, history, te, per_call, reason_rows)
    nor_calls = [r["call_id"] for r in per_call if "NOR_EARLY" in r["issues"]]
    ctrl = _controllability(alloc, reason_rows, per_call, nor_calls)
    vas = _value_at_stake(per_call, ctrl, validation, adoption)
    wf = weather_forecast_error(world)
    label = ("기준 계획(SEAGATE v1)을 그대로 따른 실제 결과 (가상)" if case == "base"
             else f"지금까지 승인 반영(계획 v{history[-1]['version']})의 실제 결과 (가상)")
    return {
        "case": case, "label": label, "plan_versions": len(history), "status": "VIRTUAL",
        "kpi": kpi, "utilization": {b: round(u, 4) for b, u in util.items()},
        "per_call": [{k: r[k] for k in ("call_id", "vessel", "vessel_type", "berth_id", "layer", "amount_usd", "demurrage_h", "port_stay_h",
                                        "anchorage_wait_h", "operation_h", "idle_h", "operation", "shift_h", "berth_wait_h", "stop_h")} for r in per_call],
        "pareto": pareto, "root_causes": roots, "controllability": ctrl, "class_shares": class_shares(ctrl),
        "value_at_stake": vas,
        "facts": _facts(world, agent, history, te, per_call, reason_rows, wf),
        "validation_available": bool(policy_totals(validation)),
        "notes": ["모든 값은 가상 시나리오에서 계산한 VIRTUAL 값이다 — 실제 운영 데이터가 아니다.",
                  "원인 비용 배분·통제가능성 점수·채택률은 가정이다."],
    }
