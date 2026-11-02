"""CLOCK — 레이타임 계산서 엔진 (Asbatankvoy 기준, docs/domain/03 §6 알고리즘).

입력은 SOF 이벤트 목록 + 계약 조건 + 맥락(선석 점유·야간 규칙·펌핑 로그)이고,
출력은 계산서(개시·공제·체선·금액)와 구간 목록, 쟁점 플래그, 대안 계산이다.
쟁점은 자동 판정하지 않는다(ENG-DISPUTE-NO-AUTO): 기본 계산 + 대안 계산을 함께 낸다.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from . import rules
from .timeutil import DayWindow, add_h, add_m, fmt_h, fmt_ts, hours, iso, round_usd, ts

EVENT_ORDER = [
    "EOSP", "ANCHORED", "NOR_TENDERED", "NOR_RECEIVED", "NOR_RETENDERED", "FREE_PRATIQUE",
    "BERTH_VACATED", "PILOT_ON_BOARD", "ANCHOR_AWEIGH", "ALL_FAST", "HOSES_CONNECTED",
    "OPS_COMMENCED", "OPS_STOPPED", "OPS_RESUMED", "OPS_COMPLETED", "HOSES_DISCONNECTED",
    "DOCS_ON_BOARD", "LAST_LINE", "COSP",
]
_ORDER = {t: i for i, t in enumerate(EVENT_ORDER)}

HALF_RATE_REASONS = {"WEATHER", "STRIKE", "SHORE_EQUIPMENT", "FIRE", "EXPLOSION"}

KIND_LABEL = {
    "WAIT": "묘박 대기", "SHIFT": "이동(shifting)", "BERTH_PREP": "접안·호스 연결",
    "PUMPING": "하역", "STOP": "하역 중단", "POST_OPS": "호스 분리", "EXCESS_PUMPING": "펌핑 보증 초과",
}
WAIT_LABEL = {
    "CONGESTION": "선석 점유", "OOS": "선석 정비", "NIGHT": "야간 계류·접안 제한",
    "WEATHER": "기상(접안 불가)", "OTHER": "기타 대기", "UNKNOWN": "사유 미상", "PRE_ARRIVAL": "도착 전",
    "TIDE": "조석·UKC 창", "TUG": "예선·도선·계류 감독", "VETTING": "선박 검사·승인", "FOG": "시정 불량 항만 통제",
    "WAVE": "파고(접안 불가)", "TANK": "탱크 공간 부족(접안 보류)",
}
STOP_LABEL = {
    "WEATHER": "기상", "SHORE_TANK": "육상 탱크", "SHORE_EQUIPMENT": "육상 설비 고장",
    "SHIP_EQUIPMENT": "선박 설비", "DOCUMENTS": "서류", "SAFETY": "안전", "STRIKE": "파업", "OTHER": "기타",
    "PIPELINE": "공유 배관 한도",
}
# cl.6 예외 주장(WAIT_NIGHT_WEATHER)에 함께 묶는 '선석은 비었지만 자연 조건으로 못 붙은' 대기
NATURAL_WAIT = ("NIGHT", "WEATHER", "TIDE", "FOG", "WAVE")

DEFAULT_POLICY = {
    "nor": "AUTO",                      # AUTO: 유효성 판정 / VALID: 선주 입장(유효 간주)
    "start_override": None,
    "end_override": None,
    "shift_in_laytime": "EXCLUDE",      # ASB-07-SHIFTING-EXCL
    "shift_in_demurrage": "COUNT",      # LAW-ONCE-ON-DEM (기본=산입, 대안=공제)
    "night_wait_in_laytime": "COUNT",   # ASB-09-REACHABLE (기본) / EXCLUDE = cl.6 예외 주장
    "weather_wait_in_laytime": "COUNT",
    "half_rate": True,                  # ASB-08-HALF-RATE (선주 청구가 반액을 빼먹는 경우 False)
    "weather_laytime_half": False,      # 쟁점: 레이타임 중 폭풍 중단이 만든 체선도 반액인가
    "pumping_deduction": True,          # RIDER-PUMPING
    "rate_override": None,
    "exclude_reasons": (),              # 체선사유 기여도 계산용: 해당 사유 시간을 없다고 보고 재계산
}

SEVERITY_RANK = {"error": 0, "critical": 1, "dispute": 2, "warning": 3, "info": 4}


def _norm_events(events):
    out = []
    for i, e in enumerate(events):
        d = dict(e)
        d["ts"] = ts(d["ts"])
        d.setdefault("row", i + 1)
        out.append(d)
    out.sort(key=lambda e: (e["ts"], _ORDER.get(e["type"], 99)))
    for i, e in enumerate(out):
        e["idx"] = i
    return out


def _first(evs, typ, after=None):
    for e in evs:
        if e["type"] == typ and (after is None or e["ts"] >= after):
            return e
    return None


def _last_before(evs, typ, before):
    hit = None
    for e in evs:
        if e["type"] == typ and e["ts"] <= before:
            hit = e
    return hit


def _num(x):
    return None if x in (None, "") else float(x)


def _stops(evs, ops_from, ops_to):
    """하역 창 [하역 개시, 하역 완료] 안의 OPS_STOPPED/OPS_RESUMED 쌍. 짝이 없으면 창 끝으로 닫는다.
    창 밖 이벤트(예: 'engines stopped')가 짝짓기를 가로채지 않게 먼저 걸러낸다."""
    lo = ops_from["ts"] if ops_from else None
    hi = ops_to["ts"] if ops_to else None
    pairs, open_stop = [], None
    for e in evs:
        if e["type"] not in ("OPS_STOPPED", "OPS_RESUMED"):
            continue
        if (lo is not None and e["ts"] < lo) or (hi is not None and e["ts"] > hi):
            continue
        if e["type"] == "OPS_STOPPED" and open_stop is None:
            open_stop = e
        elif e["type"] == "OPS_RESUMED" and open_stop is not None:
            pairs.append((open_stop, e))
            open_stop = None
    if open_stop is not None and ops_to is not None:
        pairs.append((open_stop, {"ts": ops_to["ts"], "idx": ops_to["idx"], "row": ops_to["row"], "type": ops_to["type"]}))
    return pairs


def _seg(a, b, kind, reason=None, refs=()):
    return {"from": a, "to": b, "kind": kind, "reason": reason, "refs": [r for r in refs if r is not None]}


def _physical_segments(evs, k):
    segs = []
    anch, aweigh, af, oc, ocomp, hd = k["anchored"], k["aweigh"], k["all_fast"], k["ops_commenced"], k["ops_completed"], k["hoses_off"]
    t_anchor = anch["ts"] if anch else None
    t_shift = aweigh["ts"] if aweigh else (af["ts"] if af else None)
    if t_anchor and t_shift and t_anchor < t_shift:
        segs.append(_seg(t_anchor, t_shift, "WAIT", None, [anch and anch["row"], aweigh and aweigh["row"]]))
    if t_shift and af and t_shift < af["ts"]:
        segs.append(_seg(t_shift, af["ts"], "SHIFT", None, [aweigh and aweigh["row"], af["row"]]))
    if af:
        # 하역 개시가 없으면 하역 완료(또는 호스 분리)까지를 접안·준비로 본다 — POST_OPS와 겹치지 않게.
        prep_end = oc or ocomp or hd
        if prep_end and af["ts"] < prep_end["ts"]:
            segs.append(_seg(af["ts"], prep_end["ts"], "BERTH_PREP", None, [af["row"], k["hoses_on"] and k["hoses_on"]["row"], oc and oc["row"]]))
    ops_end = ocomp or hd
    if oc and ops_end:
        cursor, cursor_ref = oc["ts"], oc["row"]
        for a, b in k["stops"]:
            a_t, b_t = max(a["ts"], cursor), min(b["ts"], ops_end["ts"])
            if a_t > cursor:
                segs.append(_seg(cursor, a_t, "PUMPING", None, [cursor_ref, a["row"]]))
            if a_t < b_t:
                segs.append(_seg(a_t, b_t, "STOP", a.get("reason") or "OTHER", [a["row"], b["row"]]))
            cursor, cursor_ref = max(cursor, b_t), b["row"]
        if cursor < ops_end["ts"]:
            segs.append(_seg(cursor, ops_end["ts"], "PUMPING", None, [cursor_ref, ops_end["row"]]))
    if ocomp and hd and ocomp["ts"] < hd["ts"]:
        segs.append(_seg(ocomp["ts"], hd["ts"], "POST_OPS", None, [ocomp["row"], hd["row"]]))
    return segs


def _clip(segs, start, end):
    out = []
    for s in segs:
        a, b = max(s["from"], start), min(s["to"], end)
        if a < b:
            d = dict(s)
            d["from"], d["to"] = a, b
            out.append(d)
    return out


def reason_key(kind, reason):
    return f"{kind}:{reason}" if reason else kind


def _day_boundaries(a, b, window):
    out, day = [], a.date()
    while day <= b.date():
        for t in (window.start, window.end):
            x = datetime.combine(day, t)
            if a < x < b:
                out.append(x)
        day += timedelta(days=1)
    return out


def _wait_reason_split(seg, ctx, evs):
    """대기 구간을 사유별로 쪼갠다. SIM이 사유를 주면 그대로, 아니면 선석 점유·주간 창·풍속으로 판정."""
    a, b = seg["from"], seg["to"]
    given = ctx.get("wait_reasons")
    if given:
        pieces, cursor = [], a
        for w in sorted(given, key=lambda w: ts(w["from"])):
            wa, wb = max(ts(w["from"]), a), min(ts(w["to"]), b)
            if wa >= wb:
                continue
            if cursor < wa:
                pieces.append((cursor, wa, "OTHER"))
            pieces.append((wa, wb, w["reason"]))
            cursor = wb
        if cursor < b:
            pieces.append((cursor, b, "OTHER"))
    else:
        turnover = ctx.get("turnover_minutes", rules.param("PLAN-TURNOVER", "minutes"))
        occupied = ts(ctx.get("berth_occupied_until"))
        vacated = _first(evs, "BERTH_VACATED")
        if vacated and not occupied:
            occupied = vacated["ts"]
        if occupied:
            avail = add_m(occupied, turnover)
        elif ctx.get("berth_free_on_arrival"):
            avail = datetime.min
        else:
            avail = None
        window = DayWindow(**ctx["daytime"]) if ctx.get("daytime") else DayWindow()
        wind = ctx.get("wind") or {}
        limit = ctx.get("mooring_wind_ms", rules.param("ULS-WEATHER-LIMIT", "mooring_ms"))
        cuts = {a, b}
        if avail and a < avail < b:
            cuts.add(avail)
        cuts.update(_day_boundaries(a, b, window))
        if wind:
            h = a.replace(minute=0)
            while h < b:
                if a < h:
                    cuts.add(h)
                h += timedelta(hours=1)
        pts = sorted(cuts)
        pieces = []
        for x, y in zip(pts, pts[1:]):
            mid = x + (y - x) / 2
            if avail is None:
                reason = "UNKNOWN"
            elif mid < avail:
                reason = "CONGESTION"
            elif ctx.get("daytime_rule") and not window.contains(mid):
                reason = "NIGHT"
            elif wind.get(iso(mid.replace(minute=0)), 0) >= limit:
                reason = "WEATHER"
            else:
                reason = "OTHER"
            pieces.append((x, y, reason))
    merged = []
    for x, y, r in pieces:
        if merged and merged[-1][2] == r and merged[-1][1] == x:
            merged[-1] = (merged[-1][0], y, r)
        else:
            merged.append((x, y, r))
    return [dict(seg, **{"from": x, "to": y, "reason": r}) for x, y, r in merged]


def _apply_pumping(segs_all, segs, terms, ctx, policy, issues, k):
    """펌핑 보증(RIDER-PUMPING) 초과분을 하역 구간 끝에서부터 '공제' 구간으로 바꾼다.
    공제는 증거가 다 있을 때만: 하역 개시·완료 시각, 펌핑 로그, 압력 < 보증 psi, 육상 제한 없음."""
    warranty = _num(terms.get("pumping_warranty_hours"))
    if not warranty or terms.get("operation", "DISCHARGE") != "DISCHARGE":
        return segs, 0.0
    if not (k["ops_commenced"] and k["ops_completed"]):
        issues.append(_issue("PUMPING_DATA_MISSING", "info", "하역 개시·완료 시각이 없어 펌핑 보증을 판단할 수 없음",
                             "SOF에 하역 개시(OPS_COMMENCED)·하역 완료(OPS_COMPLETED)가 있어야 실하역 시간을 잰다", ["RIDER-PUMPING"]))
        return segs, 0.0
    pumping_h = sum(hours(s["from"], s["to"]) for s in segs_all if s["kind"] == "PUMPING")
    log = ctx.get("pumping_log")
    psi_req = _num(terms.get("pumping_warranty_psi")) or rules.param("RIDER-PUMPING", "psi")
    if pumping_h <= warranty:
        return segs, 0.0
    if not log:
        issues.append(_issue("PUMPING_DATA_MISSING", "info", "펌핑 보증 초과 가능성 — 펌핑 로그가 없어 공제를 판단할 수 없음",
                             f"실하역 {fmt_h(pumping_h)} > 보증 {warranty}h. 매니폴드 압력 기록과 육상 제한 여부가 있어야 공제 가능", ["RIDER-PUMPING"]))
        return segs, 0.0
    if log.get("shore_restriction"):
        issues.append(_issue("PUMPING_SHORE_RESTRICTED", "warning", "육상 제한 기록이 있어 펌핑 초과 공제 불가",
                             log.get("evidence") or "터미널 배압·수용 제한 기록", ["RIDER-PUMPING"]))
        return segs, 0.0
    psi = _num(log.get("avg_manifold_psi"))
    if psi is None:
        issues.append(_issue("PUMPING_DATA_MISSING", "info", "펌핑 보증 초과 가능성 — 매니폴드 압력 기록이 없어 공제 불가",
                             f"실하역 {fmt_h(pumping_h)} > 보증 {warranty:g}h. 보증은 '24h 또는 {psi_req:g} psi' 중 하나라 압력 미달 입증이 필요",
                             ["RIDER-PUMPING"]))
        return segs, 0.0
    if psi >= psi_req:
        return segs, 0.0
    excess = pumping_h - warranty
    if not policy["pumping_deduction"]:
        return segs, excess
    remaining = excess
    out = list(segs)
    for i in range(len(out) - 1, -1, -1):
        s = out[i]
        if remaining <= 1e-9 or s["kind"] != "PUMPING":
            continue
        dur = hours(s["from"], s["to"])
        take = min(dur, remaining)
        cut = add_h(s["to"], -take)
        tail = dict(s, **{"from": cut, "kind": "EXCESS_PUMPING", "reason": None})
        if take < dur:
            head = dict(s, **{"to": cut})
            out[i:i + 1] = [head, tail]
        else:
            out[i] = tail
        remaining -= take
    return out, excess


def _effect(seg, phase, policy):
    kind, reason = seg["kind"], seg["reason"]
    if reason_key(kind, reason) in policy["exclude_reasons"]:
        return "EXCLUDE", "ENG-DISPUTE-NO-AUTO"
    if kind == "EXCESS_PUMPING":
        return "EXCLUDE", "RIDER-PUMPING"
    if kind == "STOP" and reason == "SHIP_EQUIPMENT":
        return "EXCLUDE", "ASB-07-VESSEL-FAULT"
    if phase == "LAYTIME":
        if kind == "SHIFT":
            return ("EXCLUDE" if policy["shift_in_laytime"] == "EXCLUDE" else "COUNT"), "ASB-07-SHIFTING-EXCL"
        if kind == "WAIT":
            if reason == "NIGHT" and policy["night_wait_in_laytime"] == "EXCLUDE":
                return "EXCLUDE", "ASB-06-BERTH-DELAY-EXC"
            if reason in ("WEATHER", "TIDE", "FOG", "WAVE") and policy["weather_wait_in_laytime"] == "EXCLUDE":
                return "EXCLUDE", "ASB-06-BERTH-DELAY-EXC"
            return "COUNT", "ASB-09-REACHABLE"
        return "COUNT", "ASB-07-HOURS"
    if kind == "SHIFT":
        return ("FULL" if policy["shift_in_demurrage"] == "COUNT" else "EXCLUDE"), "LAW-ONCE-ON-DEM"
    if kind == "STOP" and reason in HALF_RATE_REASONS and policy["half_rate"]:
        return "HALF", "ASB-08-HALF-RATE"
    return "FULL", "ASB-08-RATE-PRORATA"


def _walk(segs, allowed, policy):
    cum, phase, dem_start, out = 0.0, "LAYTIME", None, []
    eps = 1e-9
    if allowed <= eps and segs:
        phase, dem_start = "DEMURRAGE", segs[0]["from"]
    for s in segs:
        a, b = s["from"], s["to"]
        while a < b:
            if phase == "LAYTIME":
                eff, rid = _effect(s, phase, policy)
                if eff == "COUNT":
                    dur, room = hours(a, b), allowed - cum
                    if dur <= room + eps:
                        out.append(dict(s, **{"from": a, "to": b, "phase": phase, "effect": eff, "rule": rid}))
                        cum += dur
                        a = b
                    else:
                        cut = add_h(a, room)
                        out.append(dict(s, **{"from": a, "to": cut, "phase": phase, "effect": eff, "rule": rid}))
                        cum, a = allowed, cut
                    if cum >= allowed - eps:
                        phase, dem_start = "DEMURRAGE", a
                else:
                    out.append(dict(s, **{"from": a, "to": b, "phase": phase, "effect": eff, "rule": rid}))
                    a = b
            else:
                eff, rid = _effect(s, phase, policy)
                out.append(dict(s, **{"from": a, "to": b, "phase": phase, "effect": eff, "rule": rid}))
                a = b
    for s in out:
        s["hours"] = hours(s["from"], s["to"])
    return out, cum, dem_start


def _issue(code, severity, title, detail, rule_ids, alt=None):
    return {"code": code, "severity": severity, "title": title, "detail": detail, "rules": rules.check(*rule_ids), "alt": alt}


def _key_events(evs):
    anch = _first(evs, "ANCHORED")
    nor_t = _first(evs, "NOR_TENDERED")
    nor_r = _first(evs, "NOR_RECEIVED")
    nor_re = _first(evs, "NOR_RETENDERED")
    af = _first(evs, "ALL_FAST")
    aweigh = _last_before(evs, "ANCHOR_AWEIGH", af["ts"]) if af else _first(evs, "ANCHOR_AWEIGH")
    oc = _first(evs, "OPS_COMMENCED")
    ocomp = _first(evs, "OPS_COMPLETED")
    hd = _first(evs, "HOSES_DISCONNECTED")
    k = {
        "anchored": anch, "nor_tendered": nor_t, "nor_received": nor_r, "nor_retendered": nor_re,
        "aweigh": aweigh, "all_fast": af, "hoses_on": _first(evs, "HOSES_CONNECTED"),
        "ops_commenced": oc, "ops_completed": ocomp, "hoses_off": hd,
        "docs": _first(evs, "DOCS_ON_BOARD"), "last_line": _first(evs, "LAST_LINE"),
    }
    k["stops"] = _stops(evs, oc, ocomp or hd)
    return k


def compute(events, terms, context=None, policy=None, alternatives=True):
    ctx = dict(context or {})
    pol = dict(DEFAULT_POLICY)
    pol.update(policy or {})
    pol["exclude_reasons"] = tuple(pol["exclude_reasons"] or ())
    evs = _norm_events(events)
    k = _key_events(evs)
    issues = []
    allowed = float(terms["laytime_hours"])
    notice_h = 6.0 if _num(terms.get("notice_hours")) is None else _num(terms["notice_hours"])
    rate = float(pol["rate_override"] or terms["rate_usd_day"])

    nor_evt = k["nor_received"] or k["nor_tendered"]
    tender_evt = k["nor_tendered"] or k["nor_received"]
    missing = [name for name, e in (("NOR", nor_evt), ("ALL_FAST", k["all_fast"]), ("HOSES_DISCONNECTED", k["hoses_off"])) if e is None]
    if missing:
        return {"status": "INCOMPLETE", "missing": missing, "issues": [_issue(
            "MISSING_EVENT", "error", "필수 SOF 이벤트 누락: " + ", ".join(missing),
            "레이타임 개시·종료를 정할 수 없다", ["ASB-06-NOR-START", "ASB-11-END-HOSES"])], "events": _events_json(evs)}

    # 1) NOR 유효성 (LAW-NOR-ARRIVAL) — 도착 전에 낸 NOR은 무효
    nor_valid = True
    nor_time = nor_evt["ts"]
    start_basis, start_rules = None, ["ASB-06-NOR-START"]
    start = None
    retendered = False
    if k["anchored"] and tender_evt["ts"] < k["anchored"]["ts"]:
        nor_valid = False
        gap = hours(tender_evt["ts"], k["anchored"]["ts"])
        if pol["nor"] == "VALID":
            pass
        elif k["nor_retendered"] and k["nor_retendered"]["ts"] >= k["anchored"]["ts"]:
            nor_time = k["nor_retendered"]["ts"]
            retendered = True
            issues.append(_issue("NOR_EARLY", "critical", "도착 전 NOR — 재제출 NOR 기준으로 개시",
                                 f"NOR {fmt_ts(tender_evt['ts'])}이 투묘 {fmt_ts(k['anchored']['ts'])}보다 {fmt_h(gap)} 빠름. 재제출 {fmt_ts(nor_time)} 적용",
                                 ["LAW-NOR-ARRIVAL"], alt={"code": "OWNER_FIRST_NOR", "title": "선주 주장: 첫 NOR 유효", "policy": {"nor": "VALID"}}))
        elif k["ops_commenced"]:
            start = k["ops_commenced"]["ts"]
            start_basis, start_rules = "OPS_COMMENCED", ["LAW-NOR-ARRIVAL", "LAW-NOR-WAIVER"]
            issues.append(_issue("NOR_EARLY", "critical", "도착 전 NOR — 무효, 재제출 없음 → 하역 개시부터 레이타임",
                                 f"NOR {fmt_ts(tender_evt['ts'])}이 투묘 {fmt_ts(k['anchored']['ts'])}보다 {fmt_h(gap)} 빠름",
                                 ["LAW-NOR-ARRIVAL", "LAW-NOR-WAIVER"], alt={"code": "OWNER_NOR_VALID", "title": "선주 주장: NOR 유효", "policy": {"nor": "VALID"}}))
            receipt = (ctx.get("nor_receipt") or "RECEIVED").upper()
            if receipt in ("RECEIVED", "ACCEPTED"):
                issues.append(_issue("WAIVER_RISK", "dispute", "대리점 NOR 수령 서명이 하자 포기로 해석될 위험",
                                     "수령 문구에 'validity reserved'가 없음. 선주는 수락으로 무효가 치유됐다고 주장할 수 있다",
                                     ["LAW-NOR-WAIVER", "ENG-DISPUTE-NO-AUTO"], alt={"code": "OWNER_NOR_VALID", "title": "하자 포기 인정 시", "policy": {"nor": "VALID"}}))
        else:
            issues.append(_issue("NOR_EARLY", "critical", "도착 전 NOR — 재제출·하역 개시 기록이 없어 무효 NOR 기준으로 임시 계산",
                                 f"NOR {fmt_ts(tender_evt['ts'])}이 투묘 {fmt_ts(k['anchored']['ts'])}보다 {fmt_h(gap)} 빠름. 재제출 NOR 또는 하역 개시 기록을 확인할 것",
                                 ["LAW-NOR-ARRIVAL"]))
    notice_expiry = add_h(nor_time, notice_h)
    af_t = k["all_fast"]["ts"]
    if start is None:
        if af_t < nor_time:
            start, start_basis = nor_time, "NOR_AFTER_BERTH"
            issues.append(_issue("NOR_AFTER_BERTH", "info", "접안 완료 후 NOR — NOR 수령 시점부터 개시",
                                 f"접안 {fmt_ts(af_t)} 뒤 NOR {fmt_ts(nor_time)}. 레이타임은 NOR 전에 개시되지 않는다", ["ASB-06-NOR-START"]))
        elif af_t <= notice_expiry:
            start, start_basis = af_t, "ALL_FAST"
        else:
            start, start_basis = notice_expiry, "RETENDER" if retendered else "NOTICE"
    laycan_from = ts(terms.get("laycan_from"))
    if laycan_from and start < laycan_from:
        start, start_basis = laycan_from, "LAYCAN"
        start_rules = start_rules + ["ASB-05-LAYCAN"]
        issues.append(_issue("NOR_BEFORE_LAYCAN", "info", "레이캔 전 도착 — 레이캔 시작부터 개시",
                             f"레이캔 시작 {fmt_ts(laycan_from)}", ["ASB-05-LAYCAN"]))
    if pol["start_override"]:
        start, start_basis = ts(pol["start_override"]), "OVERRIDE"
    end = ts(pol["end_override"]) if pol["end_override"] else k["hoses_off"]["ts"]

    # 2) 구간 분할 → 대기 사유 → 펌핑 보증 → 레이타임/체선 걷기
    phys = _physical_segments(evs, k)
    if phys and start < phys[0]["from"]:
        # 투묘 기록이 있으면 그 전은 '도착 전', 없으면 도착 시각을 모르는 대기로 본다.
        phys.insert(0, _seg(start, phys[0]["from"], "WAIT", "PRE_ARRIVAL" if k["anchored"] else None, [tender_evt["row"]]))
    segs = []
    for s in _clip(phys, start, end):
        segs.extend(_wait_reason_split(s, ctx, evs) if s["kind"] == "WAIT" and s["reason"] is None else [s])
    if end > (segs[-1]["to"] if segs else start):
        segs.append(_seg(segs[-1]["to"] if segs else start, end, "POST_OPS", None, []))
    segs, pumping_excess = _apply_pumping(phys, segs, terms, ctx, pol, issues, k)
    walked, laytime_used, dem_start = _walk(segs, allowed, pol)

    full_h = sum(s["hours"] for s in walked if s["effect"] == "FULL")
    half_h = sum(s["hours"] for s in walked if s["effect"] == "HALF")
    excluded_h = sum(s["hours"] for s in walked if s["effect"] == "EXCLUDE")
    weather_laytime_h = sum(s["hours"] for s in walked if s["phase"] == "LAYTIME" and s["kind"] == "STOP" and s["reason"] == "WEATHER")
    if pol["weather_laytime_half"]:
        shift_h = min(weather_laytime_h, full_h)
        full_h, half_h = full_h - shift_h, half_h + shift_h
    elapsed = hours(start, end)
    used = elapsed - excluded_h
    dem_h = full_h + half_h
    amount = round_usd(full_h * rate / 24 + half_h * rate / 48)
    margin = allowed - used if dem_h <= 1e-9 else 0.0

    # 3) 쟁점·경고
    if dem_h <= 1e-9 and margin < rules.param("ENG-LOW-MARGIN", "hours"):
        issues.append(_issue("LOW_MARGIN", "warning", f"레이타임 여유 {fmt_h(margin)} — 추가 지연은 곧바로 체선료",
                             f"사용 {fmt_h(used)} / 허용 {fmt_h(allowed)}", ["ENG-LOW-MARGIN"]))
    if any(s["kind"] == "SHIFT" and s["phase"] == "DEMURRAGE" and s["effect"] == "FULL" for s in walked):
        sh = sum(s["hours"] for s in walked if s["kind"] == "SHIFT" and s["phase"] == "DEMURRAGE")
        issues.append(_issue("SHIFT_DURING_DEMURRAGE", "dispute", f"체선 중 이동 {fmt_h(sh)} 산입 여부",
                             "cl.7은 used laytime만 언급 — once on demurrage 원칙상 산입(기본 계산), 용선주는 공제 주장 가능",
                             ["ASB-07-SHIFTING-EXCL", "LAW-ONCE-ON-DEM", "ENG-DISPUTE-NO-AUTO"],
                             alt={"code": "CHTR_SHIFT_EXCL", "title": "용선주 주장: 체선 중 이동도 공제", "policy": {"shift_in_demurrage": "EXCLUDE"}}))
    nw = [s for s in walked if s["kind"] == "WAIT" and s["phase"] == "LAYTIME" and s["reason"] in NATURAL_WAIT and s["effect"] == "COUNT"]
    if nw and dem_h > 1e-9:
        tot = sum(s["hours"] for s in nw)
        labels = sorted({WAIT_LABEL[s["reason"]] for s in nw})
        issues.append(_issue("WAIT_NIGHT_WEATHER", "dispute", f"{'·'.join(labels)} 대기 {fmt_h(tot)}의 부담 주체",
                             "선석은 비어 있었으나 야간 계류 금지·기상으로 대기. 판례 흐름은 reachable on arrival로 용선주 부담(기본 계산), 용선주는 cl.6 예외 주장 가능",
                             ["ASB-09-REACHABLE", "ASB-06-BERTH-DELAY-EXC", "ENG-DISPUTE-NO-AUTO"],
                             alt={"code": "CHTR_CL6_EXC", "title": "용선주 주장: 야간·기상 대기는 cl.6 예외", "policy": {"night_wait_in_laytime": "EXCLUDE", "weather_wait_in_laytime": "EXCLUDE"}}))
    if weather_laytime_h > 1e-9 and full_h > 1e-9 and not pol["weather_laytime_half"]:
        issues.append(_issue("WEATHER_STOP_IN_LAYTIME", "dispute", f"레이타임 중 기상 중단 {fmt_h(weather_laytime_h)}이 만든 체선의 반액 여부",
                             "레이타임 중 중단은 그대로 산입(cl.7). 그 중단 때문에 생긴 체선을 반액으로 볼지는 해석이 갈림",
                             ["ASB-08-HALF-RATE", "ENG-DISPUTE-NO-AUTO"],
                             alt={"code": "CHTR_WEATHER_HALF", "title": "용선주 주장: 해당 체선 반액", "policy": {"weather_laytime_half": True}}))
    if pumping_excess > 1e-9 and pol["pumping_deduction"]:
        log = ctx.get("pumping_log") or {}
        issues.append(_issue("PUMPING_EXCESS_DEDUCTED", "info", f"펌핑 보증 초과 {fmt_h(pumping_excess)} 공제",
                             f"평균 매니폴드 {log.get('avg_manifold_psi')} psi < {terms.get('pumping_warranty_psi', 100)} psi, {log.get('evidence') or '육상 제한 없음'}",
                             ["RIDER-PUMPING"], alt={"code": "OWNER_NO_PUMPING", "title": "선주 주장: 펌핑 공제 없음", "policy": {"pumping_deduction": False}}))
    if k["docs"] and hours(k["hoses_off"]["ts"], k["docs"]["ts"]) > 3:
        issues.append(_issue("DOCS_WAIT", "info", f"호스 분리 후 서류 대기 {fmt_h(hours(k['hoses_off']['ts'], k['docs']['ts']))}",
                             "서식에 따라 3시간 초과분을 산입하는 조항이 있음 — 계약 문구 확인", ["ASB-11-END-HOSES"]))

    result = {
        "status": "OK",
        "nor": {"tendered": iso(tender_evt["ts"]), "received": iso(nor_evt["ts"]), "effective": iso(nor_time), "valid": nor_valid},
        "notice_expiry": iso(notice_expiry),
        "all_fast": iso(af_t),
        "laytime_start": iso(start), "start_basis": start_basis, "start_rules": start_rules,
        "laytime_end": iso(end), "end_rules": ["ASB-11-END-HOSES"],
        "elapsed_h": elapsed, "excluded_h": excluded_h, "used_h": used, "allowed_h": allowed,
        "demurrage_h": dem_h, "full_h": full_h, "half_h": half_h, "demurrage_start": iso(dem_start) if dem_h > 1e-9 else None,
        "laytime_expiry": iso(dem_start) if dem_start else None,
        "margin_h": margin, "rate_usd_day": rate, "amount_usd": amount,
        "pumping_excess_h": pumping_excess,
        "deductions": _deductions(walked),
        "segments": [_seg_json(s) for s in walked],
        "issues": sorted(issues, key=lambda i: SEVERITY_RANK[i["severity"]]),
        "events": _events_json(evs),
        "projected_end": bool(k["hoses_off"].get("projected")),
    }
    result["rows"] = _rows(result, k, terms)
    if alternatives:
        seen, alts = set(), []
        for iss in result["issues"]:
            alt = iss.get("alt")
            if not alt or alt["code"] in seen:
                continue
            seen.add(alt["code"])
            r = compute(events, terms, ctx, dict(policy or {}, **alt["policy"]), alternatives=False)
            if r["status"] == "OK":
                alts.append({"code": alt["code"], "title": alt["title"], "issue": iss["code"], "amount_usd": r["amount_usd"],
                             "demurrage_h": r["demurrage_h"], "delta_usd": round_usd(r["amount_usd"] - amount)})
        result["alternatives"] = alts
    return result


def _deductions(walked):
    groups = {}
    for s in walked:
        if s["effect"] != "EXCLUDE":
            continue
        key = (s["kind"], s["reason"], s["rule"])
        g = groups.setdefault(key, {"kind": s["kind"], "reason": s["reason"], "rule": s["rule"], "hours": 0.0, "spans": []})
        g["hours"] += s["hours"]
        g["spans"].append([iso(s["from"]), iso(s["to"])])
    return [dict(g, label=_label(g["kind"], g["reason"])) for g in groups.values()]


def _label(kind, reason):
    if kind == "WAIT":
        return f"대기 — {WAIT_LABEL.get(reason, reason)}"
    if kind == "STOP":
        return f"하역 중단 — {STOP_LABEL.get(reason, reason)}"
    return KIND_LABEL.get(kind, kind)


def _seg_json(s):
    return {"from": iso(s["from"]), "to": iso(s["to"]), "kind": s["kind"], "reason": s["reason"], "label": _label(s["kind"], s["reason"]),
            "phase": s["phase"], "effect": s["effect"], "rule": s["rule"], "hours": s["hours"], "refs": s["refs"]}


def _events_json(evs):
    return [{"type": e["type"], "ts": iso(e["ts"]), "row": e["row"], "reason": e.get("reason"), "text": e.get("text"),
             "source": e.get("source"), "projected": bool(e.get("projected"))} for e in evs]


def _rows(r, k, terms):
    """docs/domain/04 §0 계산서 템플릿 순서 그대로."""
    def ded(cat):
        return sum(d["hours"] for d in r["deductions"] if d["kind"] == cat)
    other_ded = sum(d["hours"] for d in r["deductions"] if d["kind"] not in ("SHIFT",))
    basis_txt = {"ALL_FAST": "접안 완료가 먼저", "NOTICE": "통지시간 만료가 먼저", "OPS_COMMENCED": "무효 NOR → 하역 개시",
                 "RETENDER": "재제출 NOR + 통지시간", "LAYCAN": "레이캔 시작", "OVERRIDE": "수동 지정",
                 "NOR_AFTER_BERTH": "접안 후 NOR → NOR 수령 시점"}[r["start_basis"]]
    notice = _num(terms.get("notice_hours"))
    rows = [
        ("NOR 제출·수령", f"{fmt_ts(ts(r['nor']['tendered']))} / {fmt_ts(ts(r['nor']['received']))}" + ("" if r["nor"]["valid"] else " (무효)"), ["LAW-NOR-ARRIVAL"] if not r["nor"]["valid"] else [], [k["nor_tendered"] and k["nor_tendered"]["row"]]),
        (f"통지시간 만료 (NOR+{6 if notice is None else notice:g}h)", fmt_ts(ts(r["notice_expiry"])), ["ASB-06-NOR-START"], []),
        ("접안 완료 (all fast)", fmt_ts(ts(r["all_fast"])), [], [k["all_fast"]["row"]]),
        ("레이타임 개시", f"{fmt_ts(ts(r['laytime_start']))} ({basis_txt})", r["start_rules"], []),
        ("호스 분리 = 레이타임 종료", fmt_ts(ts(r["laytime_end"])) + (" (예측)" if r["projected_end"] else ""), ["ASB-11-END-HOSES"], [k["hoses_off"]["row"]]),
        ("경과 시간", fmt_h(r["elapsed_h"]), [], []),
        ("(−) 이동 shifting", fmt_h(ded("SHIFT")), ["ASB-07-SHIFTING-EXCL"], []),
        ("(−) 선박 귀책·펌핑 초과·기타 공제", fmt_h(other_ded), ["ASB-07-VESSEL-FAULT", "RIDER-PUMPING"], []),
        ("사용 시간", fmt_h(r["used_h"]), [], []),
        ("허용 시간", fmt_h(r["allowed_h"]), ["ASB-07-HOURS"], []),
        ("체선 시간", fmt_h(r["demurrage_h"]), [], []),
        ("체선 개시 시각", fmt_ts(ts(r["demurrage_start"])), [], []),
        ("반액 구간", fmt_h(r["half_h"]), ["ASB-08-HALF-RATE"], []),
        ("요율", f"USD {r['rate_usd_day']:,.0f}/일", ["ASB-08-RATE-PRORATA"], []),
        ("체선료", f"USD {r['amount_usd']:,.2f}", ["ASB-08-RATE-PRORATA"], []),
    ]
    return [{"label": a, "value": b, "rules": c, "refs": [x for x in d if x]} for a, b, c, d in rows]
