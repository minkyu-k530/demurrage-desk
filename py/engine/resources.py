"""RESOURCES — 자원·제약 뷰(로드맵 P4~P10). 계약: docs/api.md v3 → resources(t, scenario, policy).

scenario=None(BASE)이면 데스크의 현재 계획 이력, Sxx면 그 시나리오 세계를 policy의 결정 이력(리플레이)으로 돌린 실제 세계다.
제약마다 얼마나 묶였는지(binding_hours: 대기·감속·준비 지연 시간)와 그 제약이 없었다면 체선료가 얼마였는지
(cost_usd = 같은 계획 이력에서 그 제약만 풀고(world.relax) 다시 흘린 실제 체선료와의 차)를 낸다.
조석·파고·시정·탱크 수위·배관 유량·예선 사용은 시간 시계열로, 접·이안·제품 전환·검사 승인은 목록으로 준다.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from . import scenarios, sim
from .replay import LABEL, replay
from .timeutil import add_h, add_m, hours, iso, round_usd, ts
from .world import KnownEnv, TruthEnv

ROOT = Path(__file__).resolve().parent.parent
PRECOMPUTED = ROOT / "data" / "precomputed" / "validation.json"
POLICIES = ["CURRENT_RULE", "FCFS", "RATE", "LAYTIME_RISK", "OPTIMIZER", "RISK_AWARE"]
WAIT_KEYS = ["CONGESTION", "NIGHT", "WEATHER", "TIDE", "TUG", "TANK", "VETTING", "FOG", "WAVE", "OOS", "OTHER"]

# id, 영역(coverage), 로드맵 단계, 이름, 대표 룰, relax 토큰(sim이 무시하는 제약), 구현 위치
CONSTRAINTS = [
    ("BERTH_COMPAT", "E", "P4", "선석 적합성 (DWT·SBM 하한·흘수+UKC·LOA·화물·제품)", "ULS-DRAFT-UKC", None, "engine/sim.py compatibility"),
    ("NIGHT_DAYTIME", "E", "P4", "야간 계류 금지·주간 접안", "ULS-SBM-NIGHT", "NIGHT", "engine/sim.py _Checker.ok (NIGHT)"),
    ("BERTH_OOS", "E", "P4", "선석 정비·사용불가", "BERTH-OOS", "OOS", "engine/sim.py _Checker.ok (OOS)"),
    ("PRODUCT_CHANGEOVER", "F", "P5", "제품 전환·라인 치환", "PROD-CHANGEOVER", "CHANGEOVER", "engine/sim.py _berth_and_pump (manifold)"),
    ("PRODUCT_SAMPLING", "F", "P5", "샘플링·분석", "PROD-SAMPLING", "SAMPLING", "engine/sim.py _berth_and_pump"),
    ("SHORE_RATE", "G", "P6", "육상 수용률(탱크 배정)", "PLAN-PUMP-RATE", "SHORE_RATE", "engine/sim.py rate_at"),
    ("TANK_ULLAGE", "G", "P6", "탱크 공간(ullage)·재고", "TANK-ULLAGE", "TANK", "engine/sim.py _Farm·_Caps·_Checker (TANK)"),
    ("LINE_SHARED", "H", "P7", "공유 주배관 동시 유량", "LINE-SHARED-CAP", "LINE", "engine/sim.py _Usage·_Caps (PIPELINE)"),
    ("TUG_POOL", "I", "P8", "예선 가용·소요", "MAR-TUG-REQ", "TUG", "engine/sim.py _Book.blocked (TUG)"),
    ("PILOT_POOL", "I", "P8", "도선사 가용", "MAR-PILOT-REQ", "PILOT", "engine/sim.py _Book.blocked (PILOT)"),
    ("MOORING_MASTER", "I", "P8", "SBM 계류 감독(1인 공용)", "MAR-MOORING-MASTER", "MOORING_MASTER", "engine/sim.py _Book.blocked (MOORING_MASTER)"),
    ("WIND_LIMIT", "J", "P9", "풍속 한계(접·계류 15 / 하역 18·20 m/s)", "ULS-WEATHER-LIMIT", "WIND", "engine/sim.py _Checker.ok·_pump"),
    ("WAVE_LIMIT", "J", "P9", "SBM 파고 한계(계류 2.5 / 하역 3.0 m)", "ULS-WAVE-LIMIT", "WAVE", "engine/sim.py _Checker.ok (WAVE)·stopped"),
    ("TIDE_UKC", "J", "P9", "조석·UKC 창", "ULS-TIDE-UKC", "TIDE", "engine/sim.py _Checker.tide_ok"),
    ("FOG_CLOSURE", "K", "P10", "시정 불량 항만 통제", "ULS-FOG-CLOSURE", "FOG", "engine/sim.py _Checker.ok (FOG)·_unberth"),
    ("VETTING", "K", "P10", "선박 검사·승인(Vetting)", "VET-CLEARANCE", "VETTING", "engine/sim.py _Checker.ok (VETTING)"),
]

_PRE = {"loaded": False, "rows": {}}


def _precomputed_rows():
    """미리 계산한 자원·제약 시나리오의 정책별 계획 이력 — fingerprint가 맞을 때만."""
    if not _PRE["loaded"]:
        _PRE["loaded"] = True
        try:
            from .service import validation_fingerprint  # 순환 import 회피
            data = json.loads(PRECOMPUTED.read_text(encoding="utf-8"))
            if data.get("fingerprint") == validation_fingerprint():
                _PRE["rows"] = {r["id"]: r for r in data.get("constraint_scenarios", []) if r.get("histories")}
        except (OSError, ValueError, ImportError):
            _PRE["rows"] = {}
    return _PRE["rows"]


def _scenario_world(world, sid):
    key = ("world", sid)
    if key not in world._res_cache:
        if sid not in scenarios.BY_ID:
            raise ValueError(f"unknown scenario: {sid} (BASE, {', '.join(scenarios.BY_ID)})")
        world._res_cache[key] = scenarios.scenario_world(world, scenarios.BY_ID[sid])
    return world._res_cache[key]


def _policy_history(world, sw, sid, policy):
    key = ("hist", sid, policy)
    if key not in world._res_cache:
        hist = None
        if sid and getattr(world, "variant_label", None) is None:
            hist = (_precomputed_rows().get(sid) or {}).get("histories", {}).get(policy)
        if hist is None:
            hist = replay(sw, policy)["history"]
        world._res_cache[key] = hist
    return world._res_cache[key]


def _totals(w, hist):
    ev = w.evaluate(w.truth(hist), w.t_end, alternatives=False)
    per = {cid: c["statement"].get("amount_usd", 0.0) for cid, c in ev.items()}
    return round_usd(sum(per.values())), per, ev


def _relaxed_total(w, hist, token):
    def patch(x):
        x.relax.add(token)
    rw = w.variant(patch, label=f"relax-{token}")
    return _totals(rw, hist)[0]


def _call_stats(w, r):
    waits = {k: 0.0 for k in WAIT_KEYS}
    detail = {"TUG": 0.0, "PILOT": 0.0, "MOORING_MASTER": 0.0}
    for x in r["wait_reasons"]:
        h = hours(x["from"], x["to"])
        waits[x["reason"] if x["reason"] in waits else "OTHER"] += h
        if x["reason"] == "TUG":
            detail[x.get("detail") or "TUG"] += h
    stops = {"WIND": 0.0, "WAVE": 0.0, "SHORE_TANK": 0.0, "PIPELINE": 0.0}
    for a, b, c in r.get("stop_causes", []):
        stops[c] = stops.get(c, 0.0) + hours(a, b)
    vessel, call, berth = w.vessel_of(r["call_id"]), w.calls[r["call_id"]], w.berths[r["berth_id"]]
    pumping_h = sum(hours(a, b) for a, b, _ in r.get("flow", []))
    ideal = r["volume_m3"] / min(vessel["pump_m3h"] if call["operation"] == "DISCHARGE" else float("inf"), berth["max_rate_m3h"])
    shore_lost = max(0.0, pumping_h - ideal - sum(r.get("slow_h", {}).values())) if call["operation"] == "DISCHARGE" else 0.0
    return {"waits": waits, "detail": detail, "stops": stops, "shore_lost": shore_lost,
            "unberth": (r.get("unberth_delay_h") or 0.0, r.get("unberth_delay_reason"))}


def _binding_hours(cid_stats):
    tot = {c[0]: 0.0 for c in CONSTRAINTS}
    for st in cid_stats.values():
        w, d, s = st["waits"], st["detail"], st["stops"]
        ub_h, ub_r = st["unberth"]
        tot["NIGHT_DAYTIME"] += w["NIGHT"]
        tot["BERTH_OOS"] += w["OOS"]
        tot["PRODUCT_CHANGEOVER"] += st["prep"]["CHANGEOVER"]
        tot["PRODUCT_SAMPLING"] += st["prep"]["SAMPLING"]
        tot["SHORE_RATE"] += st["shore_lost"]
        tot["TANK_ULLAGE"] += w["TANK"] + st["slow"]["SHORE_TANK"] + s["SHORE_TANK"]
        tot["LINE_SHARED"] += st["slow"]["PIPELINE"] + s["PIPELINE"]
        tot["TUG_POOL"] += d["TUG"] + (ub_h if ub_r == "TUG" else 0.0)
        tot["PILOT_POOL"] += d["PILOT"] + (ub_h if ub_r == "PILOT" else 0.0)
        tot["MOORING_MASTER"] += d["MOORING_MASTER"] + (ub_h if ub_r == "MOORING_MASTER" else 0.0)
        tot["WIND_LIMIT"] += w["WEATHER"] + s["WIND"]
        tot["WAVE_LIMIT"] += w["WAVE"] + s["WAVE"]
        tot["TIDE_UKC"] += w["TIDE"]
        tot["FOG_CLOSURE"] += w["FOG"] + (ub_h if ub_r == "FOG" else 0.0)
        tot["VETTING"] += w["VETTING"]
    return tot


def _hourly(w, until=None):
    end = until or w.t_end
    n = int(hours(w.t0, end)) + 1
    return [add_h(w.t0, k) for k in range(n)]


def _farm_series(w, spec, truth, grid_h):
    t0, n = w.t0, sim.GRID_DAYS * 24 * 60 // sim.STEP_MIN
    f = sim._Farm(spec, t0, n)
    for cid, r in truth.items():
        if r.get("farm") == spec["id"]:
            f.add(r.get("flow", []), 1 if w.calls[cid]["operation"] == "DISCHARGE" else -1)
    f._calc()
    per_h = 60 // sim.STEP_MIN
    return [round(f.level[min(len(f.level) - 1, k * per_h)]) for k in range(len(grid_h))]


def _line_series(w, line, truth, grid_h):
    t0, n = w.t0, sim.GRID_DAYS * 24 * 60 // sim.STEP_MIN
    u = sim._Usage(t0, n)
    for r in truth.values():
        if r.get("line") == line["id"]:
            u.add(r.get("flow", []))
    per_h = 60 // sim.STEP_MIN
    out = []
    for k in range(len(grid_h)):
        part = u.u[k * per_h:(k + 1) * per_h]
        out.append(round(sum(part) / len(part)) if part else 0)
    return out


def _windows_where(times, ok):
    out = []
    for t, flag in zip(times, ok):
        if flag:
            if out and out[-1][1] == t:
                out[-1][1] = add_m(t, 15)
            else:
                out.append([t, add_m(t, 15)])
    return [{"from": iso(a), "to": iso(b)} for a, b in out]


def _note(cid, w, flags, rv, binding_h):
    if cid == "BERTH_COMPAT":
        return "배정 후보를 거르는 하드 제약 — 시간 비용 없음. 조석 접근 선석은 조위로 메울 수 있는 UKC 부족을 허용하고 조석 창을 SIM이 지킨다"
    if cid == "TANK_ULLAGE":
        bits = []
        for spec in rv.farms:
            load = flags["farm_load"].get(spec["id"], {})
            room = spec["max_m3"] - spec["level0_m3"]
            state = "구속 가능" if flags["farm_bind"].get(spec["id"]) else "비구속"
            bits.append(f"{spec['id']} 여유 {room:,.0f} m3 / 들어올 화물 {load.get('imports_m3', 0):,.0f} m3·나갈 화물 {load.get('exports_m3', 0):,.0f} m3 → {state}")
        return "; ".join(bits)
    if cid == "LINE_SHARED":
        return "; ".join(f"{x['id']} 한도 {x['capacity_m3h']:,} m3/h → {'구속 가능' if flags['line_bind'].get(x['id']) else '비구속(선석 최대 유량 합 이하)'}" for x in rv.lines)
    if cid == "TUG_POOL":
        low = min([rv.tug_fleet] + [n for _, _, n in rv.tug_cal])
        return (f"예선 풀 {rv.tug_fleet}척, 일정상 최소 {low}척 vs 선석별 최대 소요 합 {flags['tug_need']}척 → "
                f"{'구속 가능(모든 선석을 한 묶음으로 흘림)' if flags['tug_bind'] else '비구속'}")
    if cid == "PILOT_POOL":
        return f"도선사 {rv.pilot_pool}인 vs 최대 동시 소요 {flags['pilot_need']}인 → {'구속 가능' if flags['pilot_bind'] else '비구속'}"
    if cid == "MOORING_MASTER":
        return "1인 공용 — SK2B·SK3B 계류·해지 작업이 겹칠 수 없다" if flags["mm_on"] else "SBM별 1인(비활성) — S13에서 1인 공용"
    if cid == "WAVE_LIMIT":
        return "풍파 = 0.30 + 0.008×풍속² + 너울. 너울이 없으면 풍속 한계가 먼저 걸려 파고는 결과를 바꾸지 않는다" if not rv.swell_all_max else "너울 예보가 있어 파고가 풍속보다 먼저 걸릴 수 있다"
    if cid == "TIDE_UKC":
        return f"조석 접근 선석 {', '.join(b for b, x in w.berths.items() if x.get('tidal_access')) or '없음'} · 예상 최고 조위 {max((x.get('tide_max_m', 0) for x in w.berths.values()), default=0):.2f} m"
    if cid == "FOG_CLOSURE":
        return f"시정 1 km 미만 통제 구간 {len(rv.fog)}개" + ("" if rv.fog else " — 기준 시나리오는 안개 없음")
    if cid == "VETTING":
        pend = [c for c in w.calls if (rv._vet.get(c) or {}).get("status_initial") == "PENDING" or (rv._vet.get(c) or {}).get("status") == "PENDING"]
        return f"승인 보류 선박 {len(pend)}척" if pend else "모든 선박 승인 완료(조건부 포함)"
    if cid == "SHORE_RATE":
        return "선박 펌프보다 낮은 육상 수용률로 늘어난 하역 시간(탱크 레버 TK-104가 푸는 제약)"
    return ""


def _core(w, hist, scenario_id, policy):
    """t와 무관한 무거운 부분 — 실제 세계·제약 비용·시계열. 캐시한다."""
    key = ("core", json.dumps(hist, sort_keys=True, ensure_ascii=False), scenario_id, policy)
    if key in w._res_cache:
        return w._res_cache[key]
    truth = w.truth(hist)
    total, per_amount, ev = _totals(w, hist)
    rv, flags = w.resource_view(None), w.resource_flags()
    stats = {}
    for cid, r in truth.items():
        st = _call_stats(w, r)
        st["slow"], st["prep"] = r.get("slow_h") or {"PIPELINE": 0.0, "SHORE_TANK": 0.0}, r.get("prep_h") or {"CHANGEOVER": 0.0, "SAMPLING": 0.0}
        stats[cid] = st
    bind_h = _binding_hours(stats)
    active = {
        "BERTH_COMPAT": True, "NIGHT_DAYTIME": True, "SHORE_RATE": True, "WIND_LIMIT": True, "PRODUCT_CHANGEOVER": True,
        "PRODUCT_SAMPLING": True, "TANK_ULLAGE": bool(rv.farms), "LINE_SHARED": bool(rv.lines), "TUG_POOL": True, "PILOT_POOL": True,
        "MOORING_MASTER": flags["mm_on"], "WAVE_LIMIT": any(b["type"] == "SBM" for b in w.berths.values()),
        "TIDE_UKC": any(b.get("tidal_access") for b in w.berths.values()), "FOG_CLOSURE": True, "VETTING": True,
        "BERTH_OOS": any(w.oos_at(b, None) for b in w.berths),
    }
    rows = []
    for cid, dom, phase, label, rule, token, where in CONSTRAINTS:
        h = round(bind_h.get(cid, 0.0), 2)
        cost = 0.0
        if token and h > 0.01:
            cost = round_usd(total - _relaxed_total(w, hist, token))
        rows.append({"id": cid, "domain": dom, "phase": phase, "label": label, "rule": rule, "active": bool(active.get(cid)),
                     "binding": h > 0.01 or abs(cost) >= 1, "binding_hours": h, "cost_usd": cost, "where": where,
                     "relax": token, "note": _note(cid, w, flags, rv, h)})
    grid_h = _hourly(w)
    env = TruthEnv(w)
    core = {"truth": truth, "ev": ev, "total": total, "per_amount": per_amount, "stats": stats, "constraints": rows, "grid": grid_h,
            "tide": [round(rv.tide(h), 3) for h in grid_h],
            "wave": [round(rv.wave(h, env.wind(h)), 2) for h in grid_h],
            "tanks": [], "lines": []}
    for spec in rv.farms:
        calls = [cid for cid, r in truth.items() if r.get("farm") == spec["id"]]
        lost = sum(stats[c]["waits"]["TANK"] + stats[c]["slow"]["SHORE_TANK"] + stats[c]["stops"]["SHORE_TANK"] for c in calls)
        dur = sum(truth[c].get("capped_h", {}).get("SHORE_TANK", 0.0) + stats[c]["waits"]["TANK"] + stats[c]["stops"]["SHORE_TANK"] for c in calls)
        core["tanks"].append(dict({k: spec[k] for k in ("id", "label", "products", "berths", "capacity_m3", "max_m3", "min_m3", "level0_m3")},
                                  draw_m3h=spec.get("draw_m3h", 0), rundown_m3h=spec.get("rundown_m3h", 0), note=spec.get("note", ""),
                                  series={"start": iso(w.t0), "step_min": 60, "level_m3": _farm_series(w, spec, truth, grid_h)},
                                  binding_hours=round(dur, 2), lost_h=round(lost, 2), can_bind=bool(flags["farm_bind"].get(spec["id"])),
                                  calls=calls, load=flags["farm_load"].get(spec["id"], {})))
    for line in rv.lines:
        calls = [cid for cid, r in truth.items() if r.get("line") == line["id"]]
        dur = sum(truth[c].get("capped_h", {}).get("PIPELINE", 0.0) + stats[c]["stops"]["PIPELINE"] for c in calls)
        lost = sum(stats[c]["slow"]["PIPELINE"] + stats[c]["stops"]["PIPELINE"] for c in calls)
        core["lines"].append({"id": line["id"], "label": line["label"], "berths": line["berths"], "capacity_m3h": line["capacity_m3h"],
                              "allocation": line.get("allocation", "FIRST_BERTHED"), "note": line.get("note", ""),
                              "series": {"start": iso(w.t0), "step_min": 60, "used_m3h": _line_series(w, line, truth, grid_h)},
                              "binding_hours": round(dur, 2), "lost_h": round(lost, 2), "can_bind": bool(flags["line_bind"].get(line["id"])),
                              "calls": calls})
    w._res_cache[key] = core
    return core


def _marine(w, core, t):
    rv, flags, truth = w.resource_view(None), w.resource_flags(), core["truth"]
    known = w.resource_view(t)
    R = (w.resources.get("marine") or {})
    man = []
    for cid, r in truth.items():
        for m in r.get("maneuvers", []):
            man.append({"call_id": cid, "vessel": w.vessel_of(cid)["name"], "berth_id": r["berth_id"], "kind": m["kind"],
                        "from": iso(m["from"]), "to": iso(m["to"]), "tugs": m["tugs"], "pilots": m["pilots"],
                        "delay_h": round(r.get("unberth_delay_h") or 0.0, 2) if m["kind"] == "UNBERTHING" else None,
                        "delay_reason": r.get("unberth_delay_reason") if m["kind"] == "UNBERTHING" else None})
    man.sort(key=lambda x: (x["from"], x["berth_id"]))
    grid = core["grid"]
    avail, used = [], []
    spans = [(ts(m["from"]), ts(m["to"]), m["tugs"]) for m in man]
    for h in grid:
        avail.append(rv.tug_cap(h))
        peak = 0
        for q in range(4):
            p = add_m(h, 15 * q)
            peak = max(peak, sum(n for a, b, n in spans if a <= p < b))
        used.append(peak)
    cal = [{"id": x.get("id"), "from": x["from"], "to": x["to"], "available": x["available"], "reason": x.get("reason", ""),
            "issued_at": x.get("issued_at"), "known_at_t": ts(x.get("issued_at") or iso(w.t0)) <= t}
           for x in (R.get("tugs") or {}).get("calendar", [])]
    mm = R.get("mooring_master") or {}
    return {"tug_fleet": rv.tug_fleet, "tug_label": (R.get("tugs") or {}).get("label", ""), "tug_calendar": cal,
            "tug_requirements": (R.get("tugs") or {}).get("requirements", {}),
            "tug_series": {"start": iso(w.t0), "step_min": 60, "available": avail, "used_max": used},
            "tug_known_cap_at_t": known.tug_cap(t),
            "pilots": {"pool": rv.pilot_pool, "requirements": (R.get("pilots") or {}).get("requirements", {}),
                       "lead_minutes": (R.get("pilots") or {}).get("lead_minutes"), "calendar": (R.get("pilots") or {}).get("calendar", [])},
            "maneuvers": man,
            "mooring_master": {"berths": mm.get("berths", []), "enabled": bool(flags["mm_on"]), "note": mm.get("note", "")},
            "can_bind": {"tugs": flags["tug_bind"], "pilots": flags["pilot_bind"]}}


def _products(w, core):
    R = w.resources.get("products") or {}
    truth = core["truth"]
    applied = []
    order = list(w.berths)
    for cid, r in sorted(truth.items(), key=lambda kv: (order.index(kv[1]["berth_id"]), kv[1]["etb"])):
        prev = None
        for c2, r2 in truth.items():
            if (c2 != cid and r2["berth_id"] == r["berth_id"] and r2.get("manifold") == r.get("manifold") and r2["etb"] < r["etb"]
                    and (prev is None or r2["etb"] > truth[prev]["etb"])):
                prev = c2
        applied.append({"berth_id": r["berth_id"], "manifold": r.get("manifold"), "prev_call": prev,
                        "prev_vessel": w.vessel_of(prev)["name"] if prev else None, "next_call": cid, "next_vessel": w.vessel_of(cid)["name"],
                        "from": r.get("prev_product"), "to": r.get("product"), "minutes": r.get("changeover_min", 0),
                        "sampling_minutes": r.get("sampling_min", 0),
                        "prep_h": {k: round(v, 2) for k, v in (r.get("prep_h") or {}).items()}})
    return {"labels": R.get("labels", {}),
            "berth_products": [{"berth_id": b, "products": x.get("products") or [], "manifolds": x.get("manifolds") or []} for b, x in w.berths.items()],
            "changeover_minutes": R.get("changeover_minutes", []), "default_changeover_minutes": R.get("default_changeover_minutes"),
            "sampling_minutes": R.get("sampling_minutes", {}), "applied": applied, "note": R.get("note", "")}


def _vetting(w, t):
    real, known = w.resource_view(None), w.resource_view(t)
    out = []
    for cid in w.calls:
        v = (w.resources.get("vetting") or {}).get("calls", {}).get(cid) or {}
        st, cleared = real.vetting(cid)
        kst, kcl = known.vetting(cid)
        out.append({"call_id": cid, "vessel": w.vessel_of(cid)["name"], "status": v.get("status_initial") if v.get("status_initial") else st,
                    "final_status": st, "cleared_at": iso(cleared), "condition": v.get("condition"),
                    "known_at_t": {"status": "APPROVED" if kcl and kcl <= t else kst, "cleared_at": iso(kcl)},
                    "updates": v.get("updates", [])})
    return out


def _calls(w, core):
    out = []
    truth, stats, ev = core["truth"], core["stats"], core["ev"]
    labels = (w.resources.get("products") or {}).get("labels", {})
    for cid, r in truth.items():
        berth, vessel = w.berths[r["berth_id"]], w.vessel_of(cid)
        st = stats[cid]
        stm = ev[cid]["statement"]
        out.append({"call_id": cid, "vessel": vessel["name"], "vessel_type": vessel.get("type"), "berth_id": r["berth_id"],
                    "product": r.get("product"), "product_label": labels.get(r.get("product"), r.get("product")),
                    "operation": w.calls[cid]["operation"], "volume_m3": round(r["volume_m3"]),
                    "draft_m": vessel["draft_m"], "ukc_m": round(sim.ukc_m(vessel), 2),
                    "required_depth_m": round(vessel["draft_m"] + sim.ukc_m(vessel), 2), "berth_depth_m": berth["depth_m"],
                    "tide_needed_m": round(r.get("tide_needed_m", 0.0), 2), "tide_window": bool(r.get("tide_window")),
                    "farm": r.get("farm"), "line": r.get("line"),
                    "tugs": (r.get("maneuvers") or [{}])[0].get("tugs"), "pilots": (r.get("maneuvers") or [{}])[0].get("pilots"),
                    "waits_h": {k: round(v, 2) for k, v in st["waits"].items()},
                    "wait_detail_h": {k: round(v, 2) for k, v in st["detail"].items() if v},
                    "slow_h": {k: round(v, 2) for k, v in st["slow"].items()},
                    "prep_h": {k: round(v, 2) for k, v in st["prep"].items()},
                    "stops_h": {k: round(v, 2) for k, v in st["stops"].items()},
                    "shore_rate_lost_h": round(st["shore_lost"], 2),
                    "unberth_delay_h": round(st["unberth"][0], 2), "unberth_delay_reason": st["unberth"][1],
                    "etb": iso(r["etb"]), "etc": iso(r["etc"]), "etd": iso(r["etd"]),
                    "amount_usd": round_usd(stm.get("amount_usd", 0.0)), "demurrage_h": round(stm.get("demurrage_h", 0.0), 2)})
    return out


def _tide_block(w, core):
    rv = w.resource_view(None)
    R = w.resources.get("tide") or {}
    needs = []
    for cid, r in core["truth"].items():
        need = r.get("tide_needed_m", 0.0)
        if need <= 0:
            continue
        berth = w.berths[r["berth_id"]]
        q = [add_m(w.t0, 15 * k) for k in range(int(hours(w.t0, w.t_end) * 4) + 1)]
        needs.append({"call_id": cid, "vessel": w.vessel_of(cid)["name"], "berth_id": r["berth_id"], "tide_needed_m": round(need, 2),
                      "tidal_access": bool(berth.get("tidal_access")), "windows": _windows_where(q, [rv.tide(x) >= need for x in q])})
    return {"start": iso(w.t0), "step_min": 60, "values_m": core["tide"], "datum": R.get("datum", "약최저저조면(가정)"),
            "source": R.get("source", "KHOA 조석예보(가상)"), "max_m": max(core["tide"]) if core["tide"] else 0.0,
            "min_m": min(core["tide"]) if core["tide"] else 0.0, "needs": needs, "rule": "ULS-TIDE-UKC"}


def _wave_block(w, core, t):
    known = w.resource_view(t)
    env = KnownEnv(w, t)
    grid = core["grid"]
    R = w.resources.get("wave") or {}
    return {"start": iso(w.t0), "step_min": 60, "values_m": core["wave"],
            "known_at_t_m": [round(known.wave(h, env.wind(h)), 2) for h in grid],
            "limits": R.get("limits", {}), "model": R.get("model", {}), "swell": R.get("swell", []),
            "source": R.get("source", ""), "rule": "ULS-WAVE-LIMIT"}


def _visibility_block(w, t):
    R = w.resources.get("visibility") or {}
    real, known = w.resource_view(None), w.resource_view(t)
    return {"threshold_km": R.get("threshold_km", 1.0),
            "series": {"start": R.get("start", iso(w.t0)), "step_min": R.get("step_min", 60), "km": R.get("km", [])},
            "closures": [{"from": iso(a), "to": iso(b), "reason": "시정 1 km 미만 — 위험물 운반선 이동 통제"} for a, b in real.fog],
            "known_closures_at_t": [{"from": iso(a), "to": iso(b)} for a, b in known.fog],
            "advisories": R.get("advisories", []), "source": R.get("source", ""), "rule": "ULS-FOG-CLOSURE"}


def run(world, history, t, scenario_id=None, policy=None):
    """자원·제약 뷰. scenario_id=None이면 BASE(데스크의 계획 이력), 'Sxx'면 시나리오를 policy로 리플레이한 실제 세계."""
    t_start = time.perf_counter()
    t = ts(t) if t else world.t0
    sid = (scenario_id or "").upper() or None
    if sid == "BASE":
        sid = None
    pol = (policy or "").upper() or None
    if sid is None:
        w = world
        if pol in (None, "AS_IS"):
            pol, hist, title = "AS_IS", history, "기준 시나리오 — 데스크의 현재 계획 이력(승인 반영)"
        else:
            if pol not in POLICIES:
                raise ValueError(f"unknown policy: {pol} ({', '.join(['AS_IS'] + POLICIES)})")
            hist, title = _policy_history(world, world, None, pol), f"기준 시나리오 — {LABEL[pol]} 리플레이"
    else:
        pol = pol or "CURRENT_RULE"
        if pol not in POLICIES:
            raise ValueError(f"unknown policy: {pol} ({', '.join(POLICIES)})")
        w = _scenario_world(world, sid)
        hist = _policy_history(world, w, sid, pol)
        sc = scenarios.BY_ID[sid]
        title = f"{sid} {sc['title']} — {LABEL[pol]}"
    t = min(max(t, w.t0), w.t_end)
    core = _core(w, hist, sid, pol)
    out = {
        "t": iso(t), "scenario": sid or "BASE", "scenario_title": title, "policy": pol,
        "policy_label": "현재 계획 이력" if pol == "AS_IS" else LABEL.get(pol, pol),
        "scenario_desc": scenarios.BY_ID[sid]["desc"] if sid else "BASE: 새 자원·제약은 모두 켜져 있지만 비구속 기본값이라 숫자를 바꾸지 않는다(조석 부족 선박 없음, 탱크 여유 충분, 배관 한도 = 동시 최대 유량, 예선 풀 ≥ 최대 소요, 안개·너울 없음, 승인 완료).",
        "total_usd": core["total"],
        "constraints": core["constraints"],
        "tide": _tide_block(w, core),
        "wave": _wave_block(w, core, t),
        "visibility": _visibility_block(w, t),
        "tanks": core["tanks"],
        "lines": core["lines"],
        "marine": _marine(w, core, t),
        "products": _products(w, core),
        "vetting": _vetting(w, t),
        "calls": _calls(w, core),
        "groups": w.berth_groups(),
        "policies": [{"id": "AS_IS", "label": "현재 계획 이력 (BASE만)"}] + [{"id": p, "label": LABEL[p]} for p in POLICIES],
        "scenarios": [{"id": "BASE", "title": "기준 시나리오", "modeled": True, "focus": [], "desc": "데스크의 현재 계획 이력"}] +
                     [{"id": s["id"], "title": s["title"], "modeled": s["modeled"], "focus": s.get("focus", []), "desc": s["desc"],
                       "constraint": s["id"] in scenarios.V3_IDS} for s in scenarios.SCENARIOS],
        "note": ("cost_usd = 같은 계획 이력에서 그 제약만 풀고(world.relax) 다시 흘린 실제 체선료와의 차 — 계획은 그대로 두므로 "
                 "'이 제약이 이번 결과에 얼마를 물렸나'를 뜻한다(재최적화 효과 제외). binding_hours = 그 제약 때문에 생긴 대기·감속 손실·준비 지연·이안 지연 시간. "
                 "[가정]·[가상] 값은 data/live/resources.json."),
    }
    out["runtime_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
    return out
