"""SCENARIOS — 시나리오 분석(Phase 23)과 민감도 분석(Phase 24).

시나리오는 기준 세계를 World.variant로 복사해 입력만 바꾼다. 대리 표현(설비 고장 = 선석 사용불가 창, 긴급 출하 = 높은 요율)은
desc에 밝힌다. v3부터 조석 창(S04)·탱크 공간(S05)·배관 충돌(S06)·예선 부족(S13)·제품 전환(S14)·안개(S15)·검사 승인(S16)·
너울(S17)을 자원·제약 모델(data/live/resources.json, engine/sim.py)로 계산한다.
시나리오 표(scenarios)는 S01~S17 전부를 계산한다. constraint_scenarios는 그중 자원·제약 8개의 정책별 계획 이력을 담아
자원·제약 뷰(engine/resources.py)의 미리 계산본으로 쓴다.
"""
from __future__ import annotations

import json

from .optimize import Evaluator, lever_options, optimize, rule_sequence
from .replay import LABEL, ShiftedEnv, diff_plan, replay, state_at, storm_override
from .timeutil import add_h, hours, iso, round_usd, ts
from .world import KnownEnv

SCENARIO_POLICIES = ["CURRENT_RULE", "FCFS", "RATE", "LAYTIME_RISK", "OPTIMIZER", "RISK_AWARE"]

C1, C2, C3, C4, C5, C6 = (f"ULS-2026-11-010{i}" for i in range(1, 7))


def _calm(w):
    calm = dict(w.forecasts[0][1])
    w.obs = dict(calm)
    w.forecasts = [(t, dict(calm), dict(meta, summary="특보 없음 (정상 시나리오)")) for t, _, meta in w.forecasts]


def _set_eta(w, cid, eta, issued_at=None, source="AGENT ETA 갱신"):
    if issued_at is None:
        for u in w.calls[cid]["eta_updates"]:
            u["eta"] = eta
    else:
        w.calls[cid]["eta_updates"].append({"issued_at": issued_at, "eta": eta, "source": source})


def _add_call(w, vessel, call, contract):
    w.vessels[vessel["id"]] = vessel
    w.calls[call["call_id"]] = call
    w.contracts[call["call_id"]] = contract
    w.sof_reports[call["call_id"]] = {"from": call.get("agent"), "signed_by": ["MASTER", "AGENT"], "diffs": []}


def _simultaneous(w):
    _set_eta(w, C5, "2026-11-04T05:30")


def _high_rate_late(w):
    w.contracts[C5]["rate_usd_day"] = 180000


def _tank_shortage(w):
    """탱크 공간 모델(TANK-ULLAGE): 원유 재고가 쌓인 데다 CDU 감산으로 공정 투입(draw)이 줄었다."""
    f = next(x for x in w.resources["tanks"] if x["id"] == "TF-CRUDE-A")
    f["level0_m3"] = 1400000
    f["draw_m3h"] = 2000
    f["note"] = "S05: 원유 재고 적체(초기 1,400,000 m3) + CDU 감산으로 투입 2,600 → 2,000 m3/h [가상]"


def _tide_window(w):
    """JANGSAENGPO GRACE가 만재 흘수 16.7 m로 도착 — SK8 수심 18 m에 UKC 1.67 m를 더하면 조위 0.37 m 이상일 때만 들어간다."""
    w.vessels["V4"]["draft_m"] = 16.7


def _pipeline_conflict(w):
    """SK3B 정비가 없어 두 SBM을 함께 쓰지만, 공유 주배관(TL-SBM) 한도가 15,000 m3/h라 동시 하역이 서로를 늦춘다."""
    w.berths["SK3B"]["oos"] = []
    w.constraint_updates = [u for u in w.constraint_updates if u["berth_id"] != "SK3B"]
    line = next(x for x in w.resources["lines"] if x["id"] == "TL-SBM")
    line["capacity_m3h"] = 15000
    line["note"] = "S06: 부스터 펌프 1기 정비로 공유 한도 24,000 → 15,000 m3/h [가상]"


def _tug_shortage(w):
    """예선 2척 수리 입고 + 온산항 VLCC 지원으로 SK 배정 가능 예선이 3척, SBM 계류 감독도 1인 공용."""
    w.resources["marine"]["tugs"]["calendar"].append(
        {"id": "TUG-1103-12", "issued_at": "2026-11-03T12:00", "from": "2026-11-04T06:00", "to": "2026-11-05T18:00", "available": 3,
         "reason": "예선 2척 수리 입고 + 온산항 VLCC 지원 (가상)"})
    w.resources["marine"]["mooring_master"]["enabled"] = True


def _product_changeover(w):
    """JANGSAENGPO GRACE 화물을 나프타 수입으로 바꿈 — SK8 제품 라인(경유 잔류)을 치환하고 first-foot 분석을 마쳐야 본 하역."""
    c = w.calls[C4]
    c.update({"cargo": "나프타 (수입, 가상)", "cargo_class": "OIL", "product": "NAPHTHA"})


def _fog(w):
    """11/03 13~19시 짙은 안개(시정 1 km 미만) — 10:00 안개 주의보로 미리 안다. 그동안 접·이안 통제."""
    vis = w.resources["visibility"]
    start = ts(vis["start"])
    for i in range(len(vis["km"])):
        h = add_h(start, i)
        if ts("2026-11-03T13:00") <= h < ts("2026-11-03T20:00"):
            vis["km"][i] = [0.6, 0.4, 0.3, 0.3, 0.5, 0.7, 0.9][min(6, int(hours(ts("2026-11-03T13:00"), h)))]
    vis["advisories"].append({"id": "FOG-1103-10", "issued_at": "2026-11-03T10:00", "from": "2026-11-03T13:00", "to": "2026-11-03T20:00",
                              "summary": "동해남부 연안 안개 주의보: 11/03 13~20시 시정 1 km 미만 — 위험물 운반선 이동 통제 (가상)"})


def _vetting(w):
    """TAEHWA HARMONY 선박 승인(Vetting) 보류 — SIRE 관찰사항 보완 서류 검토로 승인이 11/03 13:00으로 밀린다(05:00 통보)."""
    v = w.resources["vetting"]["calls"][C1]
    v.update({"status": "APPROVED", "cleared_at": "2026-11-03T13:00", "status_initial": "PENDING", "expected_initial": "2026-11-03T06:00",
              "updates": [{"id": "VET-1103-05", "issued_at": "2026-11-03T05:00", "expected": "2026-11-03T13:00", "status": "PENDING",
                           "summary": "TAEHWA HARMONY 승인 보류: SIRE 관찰사항 보완 서류 검토 — 승인 예정 11/03 13:00 (가상)"}]})


def _swell(w):
    """폭풍 뒤 동해 먼바다 너울 +1.4 m가 11/05 06~17시 유입(11/04 20:00 예보) — SBM 계류 2.5 m·하역 3.0 m 한계에 걸린다."""
    w.resources["wave"]["swell"].append({"id": "SWELL-1104-20", "issued_at": "2026-11-04T20:00", "from": "2026-11-05T06:00",
                                         "to": "2026-11-05T17:00", "add_m": 1.4,
                                         "summary": "너울 예보: 11/05 06~17시 +1.4 m (동해 먼바다 저기압, 가상)"})


def _eta_delay(w):
    _set_eta(w, C2, "2026-11-04T17:30", "2026-11-03T18:00", "AGENT ETA 갱신 (기관 정비로 12h 지연)")


def _eta_early(w):
    _set_eta(w, C5, "2026-11-04T15:00", "2026-11-04T00:00", "AGENT ETA 갱신 (속력 증가로 12h 조기)")


def _equipment_failure(w):
    w.constraint_updates.append({"id": "BC-1105-10", "issued_at": "2026-11-05T10:00", "berth_id": "SK2B", "source": "SEAGATE 부두제약관리 (가상)",
                                 "oos": [{"from": "2026-11-05T10:00", "to": "2026-11-05T22:00", "reason": "SBM 호스 손상 (가상)"}],
                                 "summary": "SK2B 호스 손상: 11/05 22:00까지 사용 불가"})


def _emergency_export(w):
    _add_call(w, {"id": "V7", "imo": "9901078", "name": "HWAAM SWIFT", "type": "MR", "dwt": 47500, "gt": 28900, "loa_m": 183,
                  "beam_m": 32, "draft_m": 6.6, "pump_m3h": 4000, "flag": "Korea (가상)"},
              {"call_id": "ULS-2026-11-0107", "vessel_id": "V7", "operation": "LOAD", "cargo": "경유 (긴급 수출, 가상)", "cargo_class": "OIL",
               "quantity_bbl": 250000, "shore_rate_m3h": 3500, "agent": "Daewang Shipping (가상)",
               "eta_updates": [{"issued_at": "2026-11-01T09:00", "eta": "2026-11-04T09:00", "source": "AGENT 72h 통지"}]},
              {"layer": "SALES_CONTRACT", "form": "GTC_FOB", "sk_role": "SELLER_FOB", "counterparty": "Buyer: Emergency Fuel Trading (가상)",
               "laytime_hours": 24, "notice_hours": 6, "rate_usd_day": 90000, "time_bar_days": 90,
               "required_documents": ["NOR", "SOF_SIGNED", "TIMESHEET"]})


def _high_occupancy(w):
    _add_call(w, {"id": "V8", "imo": "9901080", "name": "ONSAN TITAN", "type": "VLCC", "dwt": 300000, "gt": 160000, "loa_m": 333,
                  "beam_m": 60, "draft_m": 20.5, "pump_m3h": 15000, "flag": "Marshall Is. (가상)"},
              {"call_id": "ULS-2026-11-0108", "vessel_id": "V8", "operation": "DISCHARGE", "cargo": "원유 E (가상)", "cargo_class": "CRUDE",
               "quantity_bbl": 1900000, "agent": "Hanbada Shipping Agency (가상)",
               "eta_updates": [{"issued_at": "2026-11-01T18:00", "eta": "2026-11-04T18:00", "source": "AGENT 72h 통지"}]},
              {"layer": "CHARTER_PARTY", "form": "ASBATANKVOY", "sk_role": "CHARTERER", "counterparty": "Owner: Onsan Tankers (가상)",
               "laytime_hours": 36, "notice_hours": 6, "rate_usd_day": 110000, "time_bar_days": 90,
               "required_documents": ["NOR", "SOF_SIGNED", "TIMESHEET", "PUMPING_LOG"]})
    _add_call(w, {"id": "V9", "imo": "9901092", "name": "SEOSAENG PIONEER", "type": "Aframax", "dwt": 108000, "gt": 59000, "loa_m": 246,
                  "beam_m": 42, "draft_m": 14.6, "pump_m3h": 9000, "flag": "Panama (가상)"},
              {"call_id": "ULS-2026-11-0109", "vessel_id": "V9", "operation": "DISCHARGE", "cargo": "원유 F (가상)", "cargo_class": "CRUDE",
               "quantity_bbl": 720000, "shore_rate_m3h": 6000, "agent": "Taehwa Marine Agency (가상)",
               "eta_updates": [{"issued_at": "2026-11-02T02:00", "eta": "2026-11-05T02:00", "source": "AGENT 72h 통지"}]},
              {"layer": "CHARTER_PARTY", "form": "ASBATANKVOY", "sk_role": "CHARTERER", "counterparty": "Owner: Seosaeng Shipping (가상)",
               "laytime_hours": 30, "notice_hours": 6, "rate_usd_day": 52000, "time_bar_days": 90,
               "required_documents": ["NOR", "SOF_SIGNED", "TIMESHEET"]})


SCENARIOS = [
    {"id": "S01", "title": "정상", "modeled": True, "patch": _calm,
     "desc": "폭풍 없음 — 관측·예보 모두 평온(6~10 m/s). SK3B 정비·탱크 제약·ETA는 기준과 같다."},
    {"id": "S02", "title": "선박 동시 도착", "modeled": True, "patch": _simultaneous,
     "desc": "BANGEOJIN TRADER가 MUNSU PEARL과 같은 11/04 05:30에 도착 — SBM 대상 2척이 동시에 대기."},
    {"id": "S03", "title": "고체선료 선박 후착", "modeled": True, "patch": _high_rate_late,
     "desc": "나중에 오는 BANGEOJIN TRADER의 요율을 180,000달러/일로 올림(먼저 온 MUNSU PEARL 115,000)."},
    {"id": "S04", "title": "Tide Window", "modeled": True, "patch": _tide_window, "focus": ["TIDE_UKC"],
     "desc": "흘수 제한 선박이 조위가 높은 시간에만 접안 — JANGSAENGPO GRACE 흘수 14.8 → 16.7 m. SK8(수심 18 m)은 조위 0.37 m 이상인 동안에만 입항 이동(ULS-TIDE-UKC, KHOA 조석 가상)."},
    {"id": "S05", "title": "Tank Shortage", "modeled": True, "patch": _tank_shortage, "focus": ["TANK_ULLAGE"],
     "desc": "원유 탱크군 A 재고 적체(초기 1,400,000 m3, 여유 500,000 m3) + CDU 감산(투입 2,600 → 2,000 m3/h). 여유가 화물 절반보다 작으면 접안 보류, 상한에 닿으면 하역 속도 = 공정 투입 속도(TANK-ULLAGE)."},
    {"id": "S06", "title": "Pipeline Conflict", "modeled": True, "patch": _pipeline_conflict, "focus": ["LINE_SHARED"],
     "desc": "공유 배관을 쓰는 두 선박의 하역이 겹침 — SK3B 정비 없음(두 SBM 가용) + 공유 주배관 TL-SBM 한도 15,000 m3/h. 먼저 접안한 선박이 우선, 나중 선박은 잔여 용량(LINE-SHARED-CAP)."},
    {"id": "S07", "title": "Weather Disruption", "modeled": True, "patch": None,
     "desc": "기준 시나리오 그대로 — 11/04 08:00 예보 발행, 11/04 17시~11/05 09시 폭풍(관측은 예보보다 1시간 길다)."},
    {"id": "S08", "title": "ETA Delay", "modeled": True, "patch": _eta_delay,
     "desc": "11/03 18:00 통지로 MUNSU PEARL ETA 11/04 05:30 → 17:30 (12h 지연)."},
    {"id": "S09", "title": "ETA Early Arrival", "modeled": True, "patch": _eta_early,
     "desc": "11/04 00:00 통지로 BANGEOJIN TRADER ETA 11/05 03:00 → 11/04 15:00 (12h 조기)."},
    {"id": "S10", "title": "Equipment Failure", "modeled": True, "patch": _equipment_failure,
     "desc": "대리 표현: SK2B 호스 손상으로 11/05 10:00~22:00 사용 불가(같은 시각 부두제약 통보). 하역 중 설비 고장은 sim이 지원하지 않아 선석 사용불가 창으로 표현했다."},
    {"id": "S11", "title": "Emergency Export", "modeled": True, "patch": _emergency_export,
     "desc": "대리 표현: 긴급 경유 수출선 HWAAM SWIFT(MR, 가상)가 11/04 09:00 도착. 우선순위를 요율 90,000달러/일로 표현했다(실제로는 출하 기한·위약 조건이 필요)."},
    {"id": "S12", "title": "High Berth Occupancy", "modeled": True, "patch": _high_occupancy,
     "desc": "VLCC ONSAN TITAN(11/04 18:00 도착)과 아프라막스 SEOSAENG PIONEER(11/05 02:00 도착)를 추가 — SBM·SK8 점유율이 올라간다."},
    {"id": "S13", "title": "예선·도선 부족", "modeled": True, "patch": _tug_shortage, "focus": ["TUG_POOL", "MOORING_MASTER"],
     "desc": "11/04 06:00~11/05 18:00 SK 배정 가능 예선 16 → 3척(11/03 12:00 통보) + SBM 계류 감독 1인 공용. VLCC·수에즈막스(4척 필요)는 그동안 접·이안 불가, 겹치는 이동은 먼저 움직이는 선박부터(MAR-TUG-REQ)."},
    {"id": "S14", "title": "제품 전환", "modeled": True, "patch": _product_changeover, "focus": ["PRODUCT_CHANGEOVER", "PRODUCT_SAMPLING"],
     "desc": "JANGSAENGPO GRACE 화물을 나프타 수입으로 바꿈 — SK8 제품 라인(경유 잔류) 치환 180분 뒤 first-foot 샘플 분석 90분이 끝나야 본 하역(PROD-CHANGEOVER·PROD-SAMPLING)."},
    {"id": "S15", "title": "시정 불량(안개)", "modeled": True, "patch": _fog, "focus": ["FOG_CLOSURE"],
     "desc": "11/03 13~20시 시정 1 km 미만(10:00 안개 주의보) — 위험물 운반선 접·이안 통제(ULS-FOG-CLOSURE). 하역은 계속된다."},
    {"id": "S16", "title": "선박 검사·승인 대기", "modeled": True, "patch": _vetting, "focus": ["VETTING"],
     "desc": "TAEHWA HARMONY 승인(Vetting) 보류 — 11/03 05:00 통보로 승인 예정 06:00 → 13:00. 승인 전 입항 이동 불가(VET-CLEARANCE). SK 측 승인 지연이라 대기는 레이타임 산입."},
    {"id": "S17", "title": "너울 유입(파고)", "modeled": True, "patch": _swell, "focus": ["WAVE_LIMIT"],
     "desc": "폭풍 뒤 너울 +1.4 m가 11/05 06~17시 유입(11/04 20:00 예보). SBM 유의파고 2.5 m 이상 계류 불가·3.0 m 이상 하역 중단(ULS-WAVE-LIMIT)."},
]
V2_IDS = [f"S{i:02d}" for i in range(1, 13)]
V3_IDS = ["S04", "S05", "S06", "S13", "S14", "S15", "S16", "S17"]
ALL_IDS = [sc["id"] for sc in SCENARIOS]
BY_ID = {sc["id"]: sc for sc in SCENARIOS}


def scenario_world(world, sc):
    w = world.variant(sc["patch"], label=sc["id"])
    w.plan_v1["sequence"] = rule_sequence(w)
    return w


def run_scenarios(world, policies=None, ids=None, placeholders=None, cache=None, keep_history=False):
    """ids 순서대로 시나리오 표를 만든다(기본: S01~S17 전부). placeholders = {id: 메모}면 그 시나리오는 계산하지 않고 자리만 둔다.
    cache = {id: row}로 같은 계산을 한 번만 한다.
    keep_history=True면 정책별 계획 이력(history)을 행에 남긴다 — 자원·제약 뷰(engine/resources.py)가 미리 계산본으로 쓴다."""
    policies = policies or SCENARIO_POLICIES
    ids = ALL_IDS if ids is None else ids
    placeholders = placeholders or {}
    cache = {} if cache is None else cache
    out = []
    for sid in ids:
        sc = BY_ID[sid]
        if sid in placeholders:
            out.append({"id": sid, "title": sc["title"], "modeled": False, "desc": sc["desc"], "results": [], "note": placeholders[sid]})
            continue
        if sid in cache:
            out.append(cache[sid] if keep_history else {k: v for k, v in cache[sid].items() if k != "histories"})
            continue
        row = {"id": sc["id"], "title": sc["title"], "modeled": sc["modeled"], "desc": sc["desc"], "results": [], "note": sc.get("note", "")}
        if sc.get("focus"):
            row["focus"] = list(sc["focus"])
        if sc["modeled"]:
            w = scenario_world(world, sc)
            for pid in policies:
                r = replay(w, pid)
                row["results"].append({"policy": pid, "label": LABEL[pid], "total_usd": r["total_usd"], "waiting_h": r["waiting_h"],
                                       "plan_changes": r["plan_changes"], "violations": r["violations"]})
                if keep_history:
                    row.setdefault("histories", {})[pid] = r["history"]
            base = next(x for x in row["results"] if x["policy"] == "CURRENT_RULE")["total_usd"]
            best = min(row["results"], key=lambda x: (x["total_usd"], SCENARIO_POLICIES.index(x["policy"])))
            row["best_policy"] = best["policy"]
            row["saving_vs_rule_usd"] = round_usd(base - best["total_usd"])
            if not row["note"]:
                row["note"] = (f"최선 {best['label']} ${best['total_usd']:,.0f} — 현업 Rule ${base:,.0f} 대비 ${base - best['total_usd']:,.0f} 절감"
                               if base - best["total_usd"] >= 1 else f"현업 Rule(${base:,.0f})과 최선 정책의 차이가 없다")
        cache[sid] = row
        out.append(row)
    return out


# ---------- 민감도 ----------
def _signature(plan):
    return json.dumps(plan["sequence"], sort_keys=True), tuple(sorted(x.get("id", "") for x in plan.get("levers", [])))


def _scaled_world(world, factor=None, shore_only=None, rate=None):
    def patch(w):
        if factor is not None:
            for v in w.vessels.values():
                v["pump_m3h"] = v["pump_m3h"] * factor
            for b in w.berths.values():
                b["max_rate_m3h"] = b["max_rate_m3h"] * factor
            for c in w.calls.values():
                if c.get("shore_rate_m3h"):
                    c["shore_rate_m3h"] = c["shore_rate_m3h"] * factor
            for o in w.plan_v1.get("shore_options", []):
                o["shore_rate_m3h"] = o["shore_rate_m3h"] * factor
            for line in w.resources.get("lines", []):
                line["capacity_m3h"] = line["capacity_m3h"] * factor  # 배관 한도도 같은 비율 (하역 속도 요인)
        if shore_only is not None:
            for c in w.calls.values():
                if c["operation"] == "DISCHARGE":
                    c["shore_rate_m3h"] = (c.get("shore_rate_m3h") or w.vessels[c["vessel_id"]]["pump_m3h"]) * shore_only
            for o in w.plan_v1.get("shore_options", []):
                o["shore_rate_m3h"] = o["shore_rate_m3h"] * shore_only
        if rate is not None:
            for k in w.contracts.values():
                k["rate_usd_day"] = k["rate_usd_day"] * rate
    return world.variant(patch, label="sensitivity")


def _scale_levers(plan, k):
    if k == 1:
        return plan
    return {"sequence": plan["sequence"], "levers": [dict(x, shore_rate_m3h=x["shore_rate_m3h"] * k) for x in plan["levers"]]}


def sensitivity(world, at="2026-11-04T08:00", policy="OPTIMIZER"):
    """at 시점에 정책이 고른 계획이 입력 오차에 얼마나 민감한지 — 비용 변화와 최적안 뒤집힘(flip)."""
    t = ts(at)
    hist = replay(world, policy, stop_before=t)["history"]
    st = state_at(world, hist, t)
    pins, current, movable = st["pins"], st["current"], st["movable"]
    env = KnownEnv(world, t)
    base_opt = optimize(world, t, [(Evaluator(world, t, env, pins), 1.0)], current, movable,
                        lever_options(world, t, current.get("levers", []), st["done"]))
    chosen = base_opt["plan"]
    base_usd = base_opt["cost"]
    arrived = {c for c in world.calls if "ANCHORED" in pins.get(c, {})}

    def level(label, w=world, e=env, k=1.0):
        ev = Evaluator(w, t, e, pins)
        plan_k, cur_k = _scale_levers(chosen, k), _scale_levers(current, k)
        usd = ev.plan(plan_k["sequence"], plan_k["levers"])[0]
        best = optimize(w, t, [(ev, 1.0)], cur_k, movable, lever_options(w, t, cur_k.get("levers", []), st["done"]))
        flip = _signature(best["plan"])[0] != _signature(plan_k)[0] or _signature(best["plan"])[1] != _signature(plan_k)[1]
        moves, levers = diff_plan(w, plan_k, best["plan"]) if flip else ([], [])
        return {"label": label, "usd": usd, "flip": flip, "best_usd": best["cost"],
                "best_change": "; ".join(moves + levers) if flip else ""}

    factors = []
    pending = [c for c in movable if c not in arrived]
    factors.append({"factor": "ETA", "label": f"도착 전 선박 ETA 오차 ({len(pending)}척)",
                    "levels": [level(f"{d:+d}h", e=ShiftedEnv(env, d, arrived)) for d in (-6, -3, -1, 1, 3, 6)]})
    factors.append({"factor": "OPS_RATE", "label": "하역 속도(펌프·육상 수용률·배관 한도)",
                    "levels": [level(f"{p:+d}%", w=_scaled_world(world, factor=1 + p / 100), k=1 + p / 100) for p in (-20, -10, 10, 20)]})
    storm_levels = []
    for d in (-6, -3, 3, 6):
        o = storm_override(env, t, d)
        if o:
            storm_levels.append(level(f"{d:+d}h", e=ShiftedEnv(env, wind_override=o)))
    factors.append({"factor": "WEATHER", "label": "폭풍 종료 시각", "levels": storm_levels})
    factors.append({"factor": "TANK", "label": "육상 탱크 수용률", "levels": [level("−20%", w=_scaled_world(world, shore_only=0.8), k=0.8)]})
    factors.append({"factor": "RATE", "label": "체선료율 (일괄)",
                    "levels": [level(f"{p:+d}%", w=_scaled_world(world, rate=1 + p / 100)) for p in (-20, 20)]})

    def swing(f):
        vals = [x["usd"] for x in f["levels"]] + [base_usd]
        return max(vals) - min(vals)

    for f in factors:
        f["swing_usd"] = round_usd(swing(f)) if f["levels"] else 0.0
    ranked = sorted([f for f in factors if f["levels"]], key=lambda f: -f["swing_usd"])
    most = ranked[0]
    keep, flips = [], []
    for f in factors:
        flipped = [x["label"] for x in f["levels"] if x["flip"]]
        if not f["levels"]:
            continue
        if flipped:
            flips.append(f"{f['label']} {', '.join(flipped)}")
        else:
            keep.append(f"{f['label']} {f['levels'][0]['label']}~{f['levels'][-1]['label']}" if len(f["levels"]) > 1 else f"{f['label']} {f['levels'][0]['label']}")
    keep_txt = ("같은 계획이 최적으로 유지: " + "; ".join(keep)) if keep else "모든 요인에서 최적안이 바뀐다"
    if flips:
        keep_txt += " | 최적안이 바뀌는 지점: " + "; ".join(flips) + " — 이때는 재최적화가 필요하다"
    moves, levers = diff_plan(world, current, chosen)
    return {"policy": policy, "label": LABEL[policy], "at": iso(t), "base_usd": base_usd,
            "chosen_plan": "; ".join(moves + levers) or "직전 계획 유지",
            "factors": factors,
            "most_sensitive": f"{most['label']} — 체선료 변동 폭 ${most['swing_usd']:,.0f}",
            "keep_plan_within": keep_txt}
