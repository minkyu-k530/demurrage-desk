"""CLAIM — 사후 체선료 청구 검토 (docs/domain/03 §5 흐름).

시효 → 서류 → NOR 유효성 → 재계산(CLOCK) → 차이 분해(waterfall) → 쟁점 범위 → 권고 → 회신 초안.
차이 분해는 선주 타임시트의 입장을 우리 계산에 하나씩 덧씌워(정책 override) 각 입장이 만든 금액을 잰다.
권고는 초안일 뿐이고 확정은 담당자가 한다(HITL).
"""
from __future__ import annotations

import copy
import json
from datetime import timedelta
from functools import lru_cache

from . import clock, drafts, golden, intake
from .rules import DATA
from .timeutil import fmt_h, fmt_ts, iso, round_usd, ts

STEP_ORDER = ["INTAKE", "TIME_BAR", "DOCUMENTS", "NOR", "RECALC", "VARIANCE", "DISPUTES", "RECOMMEND"]
DOC_LABEL = {"NOR": "NOR", "SOF_SIGNED": "3자 서명 SOF", "TIMESHEET": "타임시트", "PUMPING_LOG": "펌핑 로그",
             "LOP": "항의서(LOP)", "CP_RATE_EVIDENCE": "용선계약 요율 증빙"}
DOC_LABEL_EN = {"NOR": "Notice of Readiness", "SOF_SIGNED": "Statement of Facts signed by Master, Agent and Terminal",
                "TIMESHEET": "time sheet", "PUMPING_LOG": "pumping log (hourly manifold pressure)",
                "LOP": "letters of protest", "CP_RATE_EVIDENCE": "charter party rate evidence"}
SIGNATORIES = ["MASTER", "AGENT", "TERMINAL"]
SIGN_LABEL = {"MASTER": "선장", "AGENT": "대리점", "TERMINAL": "터미널"}
BASIS_KO = {"ALL_FAST": "접안 완료가 통지시간 만료보다 빨라 접안 시점부터", "NOTICE": "NOR 수령 + 통지시간 6h 만료 시점부터",
            "OPS_COMMENCED": "도착 전 NOR이 무효이고 재제출이 없어 하역 개시 시점부터", "RETENDER": "무효 NOR 뒤 재제출한 NOR + 통지시간부터",
            "LAYCAN": "레이캔 시작 전이라 레이캔 시작부터", "OVERRIDE": "수동 지정 시각부터",
            "NOR_AFTER_BERTH": "접안 완료 뒤 NOR이 나와 NOR 수령 시점부터"}
DISPUTE_EN = {
    "CHTR_SHIFT_EXCL": "time shifting from anchorage to berth while on demurrage should also be excluded",
    "CHTR_WEATHER_HALF": "demurrage resulting from the weather stoppage during laytime is payable at half rate",
}
REC = {
    "TIME_BARRED": ("시효 경과 — 전액 거절", "Rejected — time-barred"),
    "REJECT_ZERO": ("재계산 체선료 0 — 전액 거절", "Rejected — no demurrage due"),
    "COUNTER": ("부분 인정 — 재계산액으로 역제안", "Counter-proposal"),
    "ACCEPT": ("청구액 일치 — 승인 권고", "Accepted"),
    "REQUEST_DOCS": ("청구액 일치 — 서류 보완 후 지급", "Documents requested"),
}


@lru_cache(maxsize=1)
def _data():
    raw = json.loads((DATA / "claims" / "claims.json").read_text(encoding="utf-8"))
    return {c["call_id"]: c for c in raw["calls"]}, {c["claim_id"]: c for c in raw["claims"]}


def _en_ts(x):
    return ts(x).strftime("%H%M LT %d %b") if x else "-"


def _event(events, typ):
    return next((e for e in events if e["type"] == typ), None)


def _row(e):
    return f"SOF {e['row']}행" if e and e.get("row") else "SOF"


def _shift_laytime_h(st):
    return sum(s["hours"] for s in st["segments"] if s["kind"] == "SHIFT" and s["phase"] == "LAYTIME" and s["effect"] == "EXCLUDE")


def _pumping_ded_h(st):
    return sum(s["hours"] for s in st["segments"] if s["kind"] == "EXCESS_PUMPING" and s["effect"] == "EXCLUDE")


def _owner_ded(owner, *cats):
    return sum(d["hours"] for d in owner.get("deductions", []) if d["category"] in cats)


def story(st):
    """계산서를 문장으로. LLM 설명이 들어올 자리지만 숫자는 계산서에서만 가져온다."""
    if st.get("status") != "OK":
        return ["필수 SOF 이벤트가 없어 계산서를 만들 수 없다: " + ", ".join(st.get("missing", []))]
    out = [f"레이타임은 {fmt_ts(ts(st['laytime_start']))}에 시작했다 — {BASIS_KO.get(st['start_basis'], st['start_basis'])} ({', '.join(st['start_rules'])})."]
    if st["start_basis"] == "ALL_FAST":
        out[-1] += f" 통지시간 만료는 {fmt_ts(ts(st['notice_expiry']))}였다."
    if st["start_basis"] == "NOTICE":
        out[-1] += f" 접안 완료는 {fmt_ts(ts(st['all_fast']))}로 그보다 늦었다."
    ded = [f"{d['label']} {fmt_h(d['hours'])}({d['rule']})" for d in st["deductions"]]
    out.append("공제: " + ", ".join(ded) + "." if ded else "공제할 시간은 없다.")
    if st["demurrage_h"] > 1e-9:
        out.append(f"허용 {fmt_h(st['allowed_h'])}을 {fmt_ts(ts(st['demurrage_start']))}에 모두 써서 체선에 들어갔고, "
                   f"호스 분리 {fmt_ts(ts(st['laytime_end']))}까지 {fmt_h(st['demurrage_h'])}이 체선이다 (ASB-11-END-HOSES).")
        if st["half_h"] > 1e-9:
            halves = sorted({s["label"] for s in st["segments"] if s["effect"] == "HALF"})
            out.append(f"이 중 {fmt_h(st['half_h'])}은 {', '.join(halves)} 구간이라 반액이다 (ASB-08-HALF-RATE).")
        rate = st["rate_usd_day"]
        out.append(f"체선료 = 전액 {fmt_h(st['full_h'])} × {rate:,.0f}/24 + 반액 {fmt_h(st['half_h'])} × {rate:,.0f}/48 = USD {st['amount_usd']:,.2f}.")
    else:
        out.append(f"사용 {fmt_h(st['used_h'])} / 허용 {fmt_h(st['allowed_h'])} — 여유 {fmt_h(st['margin_h'])}, 체선료 없음.")
    n_disp = len([i for i in st["issues"] if i["severity"] in ("dispute", "critical")])
    if n_disp:
        out.append(f"쟁점·중대 플래그 {n_disp}건은 자동 판정하지 않고 대안 계산을 함께 둔다 (ENG-DISPUTE-NO-AUTO).")
    return out


def _time_bar(call, claim, events):
    days = call["contract"].get("time_bar_days", 90)
    end = _event(events, "HOSES_DISCONNECTED") or _event(events, "OPS_COMPLETED")
    base = ts(end["ts"])
    deadline = base + timedelta(days=days)
    received = ts(claim["received_at"])
    return {"days": days, "base": iso(base), "deadline": iso(deadline), "received_at": iso(received),
            "ok": received <= deadline, "days_used": (received - base).days, "rule": "RIDER-TIMEBAR-90"}


def _documents(call, claim, events):
    required = list(call["contract"].get("required_documents", []))
    has_stop = any(e["type"] == "OPS_STOPPED" for e in events)
    if "LOP" in required and not has_stop:
        required.remove("LOP")
    got = {d["type"]: d for d in claim.get("documents", [])}
    missing, labels, labels_en, notes = [], [], [], []
    for t in required:
        d = got.get(t)
        if d is None:
            missing.append(t)
            labels.append(DOC_LABEL.get(t, t))
            labels_en.append(DOC_LABEL_EN.get(t, t))
        elif t == "SOF_SIGNED":
            lack = [s for s in SIGNATORIES if s not in d.get("signed_by", [])]
            if lack:
                missing.append(t)
                labels.append(f"3자 서명 SOF — {'·'.join(SIGN_LABEL[s] for s in lack)} 서명 누락")
                labels_en.append(f"Statement of Facts countersigned by {' and '.join(s.capitalize() for s in lack)}")
    if "LOP" not in required:
        notes.append("하역 중단이 없어 항의서(LOP)는 필수 아님")
    return {"required": required, "received": list(got), "missing": missing, "missing_labels": labels,
            "missing_labels_en": labels_en, "notes": notes, "rule": "RIDER-DOCS"}


def _waterfall(events, terms, ctx, base_st, owner, base_date):
    """선주 입장을 START → END → SHIFT → PUMPING → HALF → RATE 순서로 하나씩 덧씌운다."""
    rows, pol, cur = [], {}, base_st
    rate = terms["rate_usd_day"]

    def step(code, title, rule, evidence, en, extra):
        nonlocal cur
        pol.update(extra)
        nxt = clock.compute(events, terms, ctx, dict(pol), alternatives=False)
        rows.append({"code": code, "title": title, "rule": rule, "delta_usd": round_usd(nxt["amount_usd"] - cur["amount_usd"]),
                     "cumulative_usd": nxt["amount_usd"], "evidence": evidence, "en": en})
        cur = nxt

    o_start = golden.resolve(owner["laytime_start"], base_date)
    if o_start != cur["laytime_start"]:
        nor_early = next((i for i in base_st["issues"] if i["code"] == "NOR_EARLY"), None)
        if nor_early and base_st["start_basis"] == "OPS_COMMENCED":
            anch, nor_e, oc = _event(events, "ANCHORED"), _event(events, "NOR_TENDERED"), _event(events, "OPS_COMMENCED")
            evidence = (f"{_row(nor_e)} NOR 송신 {fmt_ts(ts(nor_e['ts']))}(항해 중) / {_row(anch)} 투묘 {fmt_ts(ts(anch['ts']))} — 도착 전 NOR 무효(LAW-NOR-ARRIVAL). "
                        f"재제출 없음 → {_row(oc)} 하역 개시 {fmt_ts(ts(oc['ts']))}부터 레이타임(LAW-NOR-WAIVER)")
            en = (f"The NOR was tendered at {_en_ts(nor_e['ts'])} while the vessel was still underway, before arrival at the customary anchorage "
                  f"at {_en_ts(anch['ts'])}. An NOR tendered prior to arrival is invalid and was never re-tendered; laytime can only run from "
                  f"commencement of discharge at {_en_ts(oc['ts'])}, not from {_en_ts(o_start)}")
            title, rule = f"레이타임 개시 차이 — 선주 {fmt_ts(ts(o_start))} 개시(무효 NOR 기준), 재계산 {fmt_ts(ts(cur['laytime_start']))}", "LAW-NOR-ARRIVAL"
        else:
            evidence = f"재계산 개시 {fmt_ts(ts(cur['laytime_start']))} = min(NOR 수령+6h {fmt_ts(ts(cur['notice_expiry']))}, 접안 완료 {fmt_ts(ts(cur['all_fast']))})"
            en = f"Laytime commenced at {_en_ts(cur['laytime_start'])} under clause 6 (NOR + 6 hours or all fast, whichever first), not at {_en_ts(o_start)}"
            title, rule = f"레이타임 개시 차이 — 선주 {fmt_ts(ts(o_start))}, 재계산 {fmt_ts(ts(cur['laytime_start']))}", "ASB-06-NOR-START"
        step("START", title, rule, evidence, en, {"start_override": o_start})

    o_end = golden.resolve(owner["laytime_end"], base_date)
    if o_end != cur["laytime_end"]:
        hd = _event(events, "HOSES_DISCONNECTED")
        step("END_TIME", f"레이타임 종료 차이 — 선주 타임시트 호스 분리 {fmt_ts(ts(o_end))} vs SOF {fmt_ts(ts(cur['laytime_end']))}", "ASB-11-END-HOSES",
             f"{_row(hd)} 호스 분리 {fmt_ts(ts(hd['ts']))} (선장·대리점·터미널 3자 서명 SOF, 터미널 호스 기록과 일치)",
             f"Laytime ends on disconnection of hoses, which the signed SOF and terminal hose records show at {_en_ts(hd['ts'])}, "
             f"not {_en_ts(o_end)} as per your time sheet", {"end_override": o_end})

    ours_shift = _shift_laytime_h(cur)
    if _owner_ded(owner, "SHIFT") + 1e-6 < ours_shift:
        aw, af = _event(events, "ANCHOR_AWEIGH"), _event(events, "ALL_FAST")
        step("SHIFT", f"레이타임 중 이동 시간 {fmt_h(ours_shift - _owner_ded(owner, 'SHIFT'))} 미공제", "ASB-07-SHIFTING-EXCL",
             f"{_row(aw)} 양묘 {fmt_ts(ts(aw['ts']))} → {_row(af)} 접안 {fmt_ts(ts(af['ts']))} ({fmt_h(ours_shift)}) — 레이타임 진행 중 이동은 불산입",
             f"Time shifting from anchorage to berth ({_en_ts(aw['ts'])} to {_en_ts(af['ts'])}, {fmt_h(ours_shift)}) does not count as used laytime under clause 7",
             {"shift_in_laytime": "COUNT"})

    ours_pump = _pumping_ded_h(cur)
    if _owner_ded(owner, "PUMPING", "EXCESS_PUMPING") + 1e-6 < ours_pump:
        log = ctx.get("pumping_log") or {}
        oc, ocomp = _event(events, "OPS_COMMENCED"), _event(events, "OPS_COMPLETED")
        pump_h = cur["pumping_excess_h"] + terms["pumping_warranty_hours"]
        psi_req = terms.get("pumping_warranty_psi", 100)
        step("PUMPING", f"펌핑 보증 초과 {fmt_h(ours_pump)} 미공제", "RIDER-PUMPING",
             f"{_row(oc)} 하역 개시 {fmt_ts(ts(oc['ts']))} → {_row(ocomp)} 완료 {fmt_ts(ts(ocomp['ts']))}: 실하역 {fmt_h(pump_h)} > 보증 {terms['pumping_warranty_hours']}h, "
             f"평균 매니폴드 {log.get('avg_manifold_psi')} psi < {psi_req} psi, {log.get('evidence') or '육상 제한 없음'}",
             f"Discharge took {fmt_h(pump_h)} against the {terms['pumping_warranty_hours']}-hour pumping warranty, with average manifold pressure of "
             f"{log.get('avg_manifold_psi')} psi (warranted {psi_req} psi) and no shore restriction; the excess {fmt_h(ours_pump)} is for Owners' account",
             {"pumping_deduction": False})

    if cur["half_h"] > owner.get("half_rate_hours", 0) + 1e-6:
        halves = [s for s in cur["segments"] if s["effect"] == "HALF"]
        stop = _event(events, "OPS_STOPPED")
        span = f"{fmt_ts(ts(halves[0]['from']))}~{fmt_ts(ts(halves[-1]['to']))}" if halves else ""
        span_en = f"{_en_ts(halves[0]['from'])} to {_en_ts(halves[-1]['to'])}" if halves else ""
        step("HALF_RATE", f"반액 미적용 — 체선 중 기상 중단 {fmt_h(cur['half_h'])}", "ASB-08-HALF-RATE",
             f"{_row(stop)} 기상 중단 {span} ({fmt_h(cur['half_h'])}) 체선 중 발생 — 반액. 증빙: 터미널 중단 지시·KMA 관측·LOP",
             f"The stoppage due to weather from {span_en} ({fmt_h(cur['half_h'])}) occurred while the vessel was on demurrage and is payable at half rate under clause 8",
             {"half_rate": False})

    o_rate = owner.get("rate_usd_day")
    if o_rate and abs(o_rate - rate) > 0.01:
        step("RATE", f"요율 차이 — 청구 USD {o_rate:,.0f}/일 vs 계약 USD {rate:,.0f}/일", "ASB-08-RATE-PRORATA",
             f"계약 Part I 체선료율 USD {rate:,.0f}/일 (시간 비례)",
             f"The demurrage rate is USD {rate:,.0f} per day pro rata as per the Charter Party, not USD {o_rate:,.0f}", {"rate_override": o_rate})

    residual = round_usd(owner["amount_usd"] - cur["amount_usd"])
    if abs(residual) >= 0.01:
        rows.append({"code": "ARITHMETIC", "title": "산술 차이 (반올림·계산 오류)", "rule": "ASB-08-RATE-PRORATA", "delta_usd": residual,
                     "cumulative_usd": owner["amount_usd"], "evidence": "위 입장을 모두 반영해도 남는 차이",
                     "en": "The balance is an arithmetic difference in your calculation"})
    return rows, residual


def _cl6_en(st):
    waits = [s for s in st["segments"] if s["kind"] == "WAIT" and s["phase"] == "LAYTIME" and s["reason"] in ("NIGHT", "WEATHER")]
    causes = [c for r, c in (("NIGHT", "the night mooring restriction"), ("WEATHER", "weather")) if any(s["reason"] == r for s in waits)]
    hrs = sum(s["hours"] for s in waits)
    return (f"the waiting time of {fmt_h(hrs)} caused by {' and '.join(causes)}, with the berth available, "
            f"falls within the clause 6 exception and does not count as used laytime")


def _disputes(st):
    issue_of = {i["code"]: i for i in st["issues"]}
    out = []
    for a in st.get("alternatives", []):
        side = "CHARTERER" if a["code"].startswith("CHTR_") else "OWNER"
        en = _cl6_en(st) if a["code"] == "CHTR_CL6_EXC" else DISPUTE_EN.get(a["code"])
        out.append({"code": a["code"], "title": a["title"], "issue": a["issue"], "side": side,
                    "severity": issue_of.get(a["issue"], {}).get("severity"),
                    "alt_amount_usd": a["amount_usd"], "delta_usd": a["delta_usd"], "en": en})
    amounts = [st["amount_usd"]] + [d["alt_amount_usd"] for d in out]
    return out, {"min_usd": min(amounts), "max_usd": max(amounts)}


def _recommend(tb, docs, computed, claimed, variance, disputes, rng):
    if not tb["ok"]:
        code, amount = "TIME_BARRED", 0.0
        text = (f"양하 완료 {fmt_ts(ts(tb['base']))} + {tb['days']}일 = {fmt_ts(ts(tb['deadline']))} 기한을 {tb['days_used'] - tb['days']}일 넘겨 접수 "
                f"→ 청구권 소멸(RIDER-TIMEBAR-90). 금액 검토와 무관하게 전액 거절 통보")
    elif computed <= 0.005 < claimed:
        code, amount = "REJECT_ZERO", 0.0
        text = f"재계산 체선료 0 — 청구 USD {claimed:,.2f} 전액 거절"
    elif abs(variance) < 0.01:
        code, amount = ("REQUEST_DOCS" if docs["missing"] else "ACCEPT"), claimed
        text = f"청구액 USD {claimed:,.2f}과 재계산이 일치" + (" — 서류 보완 전 지급 보류" if docs["missing"] else " — 승인 권고")
    else:
        code, amount = "COUNTER", computed
        text = f"확정 차이 USD {variance:,.2f}을 반박하고 USD {computed:,.2f} 지급 제안"
    chtr = [d for d in disputes if d["side"] == "CHARTERER"]
    owner = [d for d in disputes if d["side"] == "OWNER"]
    if code != "TIME_BARRED":
        if chtr:
            text += f". 용선주 측 쟁점 {len(chtr)}건(인정 시 최저 USD {rng['min_usd']:,.2f})은 권리 유보 후 담당자 판단"
        if owner:
            text += f". 선주가 다툴 수 있는 쟁점 {len(owner)}건(인정 시 최대 USD {rng['max_usd']:,.2f})"
        if docs["missing"] and code != "REQUEST_DOCS":
            text += f". 서류 보완 요청: {', '.join(docs['missing_labels'])}"
    label, en = REC[code]
    if code == "COUNTER":
        en = f"Counter-proposal USD {amount:,.2f}"
    return {"code": code, "label": label, "en": en, "amount_usd": amount, "text": text + "."}


def _memo(review):
    c, rec = review["claim"], review["recommendation"]
    lines = [f"- 청구: {c['claimant']} · USD {review['claimed']['amount_usd']:,.2f} ({fmt_h(review['claimed']['demurrage_h'])}) · 접수 {fmt_ts(ts(c['received_at']))}",
             f"- 시효: 기한 {ts(review['time_bar']['deadline']).strftime('%Y-%m-%d %H:%M')} → {'기한 내' if review['time_bar']['ok'] else '경과'}",
             f"- 서류: {'완비' if not review['documents']['missing'] else '누락 ' + ', '.join(review['documents']['missing_labels'])}",
             f"- 재계산: USD {review['computed']['amount_usd']:,.2f} ({fmt_h(review['computed']['demurrage_h'])}), 차이 USD {review['variance_usd']:,.2f}"]
    lines += [f"  · {w['title']}: USD {w['delta_usd']:,.2f} ({w['rule']})" for w in review["waterfall"]]
    if review["disputes"]:
        lines.append(f"- 쟁점 범위: USD {review['range']['min_usd']:,.2f} ~ {review['range']['max_usd']:,.2f}")
        lines += [f"  · {d['title']}: USD {d['alt_amount_usd']:,.2f} ({'용선주' if d['side'] == 'CHARTERER' else '선주'} 측)" for d in review["disputes"]]
    lines.append(f"- 권고: {rec['label']} — {rec['text']}")
    body = f"트레이딩·용선 담당자님,\n\nMV {review['vessel']['name']} 체선료 청구 {c['claim_id']} 검토 요약입니다.\n\n" + "\n".join(lines) + \
           "\n\n회신 초안(영문)을 확인하고 승인해 주세요. 쟁점은 자동 판정하지 않았습니다.\n(체선료 데스크 — 초안)"
    return dict(drafts.GEN, to=["트레이딩·용선팀"], cc=[], subject=f"[클레임 검토] {c['claim_id']} MV {review['vessel']['name']} — {rec['label']}",
                body=body, lang="ko", kind="memo")


@lru_cache(maxsize=None)
def _review(claim_id):
    calls, claims = _data()
    if claim_id not in claims:
        raise KeyError(f"unknown claim_id: {claim_id}")
    claim = claims[claim_id]
    call = calls[claim["call_id"]]
    base = call["base_date"]
    parsed = intake.parse_sof(call["sof_text"], base)
    events = parsed["events"]
    terms = {k: golden.resolve(v, base) for k, v in call["contract"].items()}
    terms["operation"] = call["operation"]
    ctx = golden.build_context(call["context"], parsed["notes"], base)
    st = clock.compute(events, terms, ctx)
    st["story"] = story(st)
    owner = claim["owner_calc"]
    claimed = round_usd(owner["amount_usd"])
    computed = st["amount_usd"]
    variance = round_usd(claimed - computed)
    tb = _time_bar(call, claim, events)
    docs = _documents(call, claim, events)
    waterfall, residual = _waterfall(events, terms, ctx, st, owner, base)
    disputes, rng = _disputes(st)
    rec = _recommend(tb, docs, computed, claimed, variance, disputes, rng)

    errors = [c for c in parsed["checks"] if c["level"] == "error"]
    warns = [c for c in parsed["checks"] if c["level"] == "warning"]
    n_ev = len(events)
    n_derived = len([ln for ln in parsed["lines"] if ln["status"] == "derived"])
    nor_issues = [i for i in st["issues"] if i["code"] in ("NOR_EARLY", "WAIVER_RISK", "NOR_BEFORE_LAYCAN")]
    nor_status = "fail" if any(i["severity"] == "critical" for i in nor_issues) else ("warn" if nor_issues else "pass")
    anch = _event(events, "ANCHORED")
    nor_summary = ("; ".join(i["title"] for i in nor_issues) if nor_issues else
                   f"NOR {fmt_ts(ts(st['nor']['tendered']))} — 투묘 {fmt_ts(ts(anch['ts']))} 뒤 제출, 유효" if anch else "투묘 기록 없음 — 유효성 확인 불가")
    steps = [
        {"id": "INTAKE", "name": "SOF 파싱·검증", "status": "fail" if errors else ("warn" if warns else "pass"),
         "summary": f"SOF {len(parsed['lines'])}행 → 이벤트 {n_ev}개 (계산 항목 {n_derived}행 무시)" + (f", 검증 오류 {len(errors)}" if errors else "") + (f", 경고 {len(warns)}" if warns else ""),
         "rules": []},
        {"id": "TIME_BAR", "name": "시효", "status": "pass" if tb["ok"] else "fail",
         "summary": f"호스 분리 {fmt_ts(ts(tb['base']))} + {tb['days']}일 = 기한 {ts(tb['deadline']).strftime('%Y-%m-%d %H:%M')}, 접수 {ts(tb['received_at']).strftime('%Y-%m-%d')} ({tb['days_used']}일째)"
                    + ("" if tb["ok"] else " → 기한 경과"),
         "rules": ["RIDER-TIMEBAR-90"]},
        {"id": "DOCUMENTS", "name": "필수 서류", "status": "warn" if docs["missing"] else "pass",
         "summary": f"필수 {len(docs['required'])}종 중 " + (f"누락 {len(docs['missing'])}: {', '.join(docs['missing_labels'])}" if docs["missing"] else "모두 접수") + (f" ({'; '.join(docs['notes'])})" if docs["notes"] else ""),
         "rules": ["RIDER-DOCS"]},
        {"id": "NOR", "name": "NOR 유효성", "status": nor_status, "summary": nor_summary,
         "rules": sorted({r for i in nor_issues for r in i["rules"]}) or ["LAW-NOR-ARRIVAL", "ASB-06-NOR-START"]},
        {"id": "RECALC", "name": "레이타임 재계산", "status": "pass",
         "summary": f"개시 {fmt_ts(ts(st['laytime_start']))} · 종료 {fmt_ts(ts(st['laytime_end']))} · 사용 {fmt_h(st['used_h'])}/허용 {fmt_h(st['allowed_h'])} · 체선 {fmt_h(st['demurrage_h'])} · USD {computed:,.2f}",
         "rules": list(dict.fromkeys(st["start_rules"] + ["ASB-11-END-HOSES", "ASB-08-RATE-PRORATA"]))},
        {"id": "VARIANCE", "name": "청구 대 재계산", "status": "pass" if abs(variance) < 0.01 else "warn",
         "summary": f"청구 USD {claimed:,.2f} − 재계산 USD {computed:,.2f} = USD {variance:,.2f}" + (f": 차이 항목 {len(waterfall)}개, 잔차 USD {residual:,.2f}" if waterfall else " (차이 없음)"),
         "rules": list(dict.fromkeys(w["rule"] for w in waterfall))},
        {"id": "DISPUTES", "name": "쟁점 범위", "status": "warn" if disputes else "pass",
         "summary": (f"쟁점 {len(disputes)}건 — 결과 범위 USD {rng['min_usd']:,.2f} ~ {rng['max_usd']:,.2f} (자동 판정하지 않음)" if disputes else "쟁점 없음"),
         "rules": list(dict.fromkeys(["ENG-DISPUTE-NO-AUTO"] + [r for d in disputes for r in next(i["rules"] for i in st["issues"] if i["code"] == d["issue"])]))},
        {"id": "RECOMMEND", "name": "권고 (담당자 승인 필요)", "status": {"ACCEPT": "pass", "TIME_BARRED": "fail"}.get(rec["code"], "warn"),
         "summary": f"{rec['label']}: {rec['text']}", "rules": ["RIDER-TIMEBAR-90"] if rec["code"] == "TIME_BARRED" else ["ENG-DISPUTE-NO-AUTO"]},
    ]
    review = {
        "claim": claim,
        "call": {"call_id": call["call_id"], "berth_id": call["berth_id"], "operation": call["operation"], "cargo": call["cargo"],
                 "base_date": base, "case_id": call["case_id"], "quantity_bbl": call.get("quantity_bbl")},
        "vessel": call["vessel"],
        "contract": call["contract"],
        "sof_text": call["sof_text"],
        "parsed": {"lines": parsed["lines"], "checks": parsed["checks"], "warnings": parsed["warnings"], "notes": parsed["notes"]},
        "steps": steps,
        "time_bar": tb,
        "documents": docs,
        "statement": st,
        "computed": {"amount_usd": computed, "demurrage_h": st["demurrage_h"]},
        "claimed": {"amount_usd": claimed, "demurrage_h": owner.get("demurrage_hours")},
        "variance_usd": variance,
        "waterfall": waterfall,
        "residual_usd": residual,
        "disputes": disputes,
        "range": rng,
        "recommendation": rec,
    }
    review["drafts"] = [drafts.claim_reply(review), _memo(review)]
    return review


def review(claim_id):
    return copy.deepcopy(_review(claim_id))


def list_claims():
    _, claims = _data()
    rows = []
    for cid in claims:
        r = _review(cid)
        rows.append({"claim_id": cid, "call_id": r["call"]["call_id"], "vessel": r["vessel"]["name"], "claimant": r["claim"]["claimant"],
                     "received_at": r["claim"]["received_at"], "claimed_usd": r["claimed"]["amount_usd"], "computed_usd": r["computed"]["amount_usd"],
                     "variance_usd": r["variance_usd"], "recommended_usd": r["recommendation"]["amount_usd"],
                     "recommendation_code": r["recommendation"]["code"],
                     "recommendation_label": r["recommendation"]["label"], "status": "NEW"})
    return sorted(rows, key=lambda x: x["received_at"], reverse=True)
