"""INTAKE — SOF 텍스트 → 표준 이벤트(docs/domain/06 §6) + 검증.

규칙 기반 파서다. 실제 제품에서는 PDF·메일 SOF를 LLM이 같은 출력 스키마로 추출하고,
아래 validate()가 그대로 적용된다(LLM 출력도 결정론적 검증을 통과해야 계산에 쓴다).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from .timeutil import iso, ts

EVENT_LABEL = {
    "EOSP": "항해 종료", "ANCHORED": "묘박지 투묘(도착)", "NOR_TENDERED": "NOR 제출", "NOR_RECEIVED": "NOR 수령",
    "NOR_RETENDERED": "NOR 재제출", "FREE_PRATIQUE": "검역 허가", "BERTH_VACATED": "앞 선박 이안(선석 비움)",
    "PILOT_ON_BOARD": "도선사 승선", "ANCHOR_AWEIGH": "양묘·이동 시작", "ALL_FAST": "접안·계류 완료",
    "HOSES_CONNECTED": "호스 연결", "OPS_COMMENCED": "하역 개시", "OPS_STOPPED": "하역 중단", "OPS_RESUMED": "하역 재개",
    "OPS_COMPLETED": "하역 완료", "HOSES_DISCONNECTED": "호스 분리", "DOCS_ON_BOARD": "서류 완료",
    "LAST_LINE": "이안(마지막 줄)", "COSP": "출항",
}

_RULES = [
    ("EOSP", r"\bEOSP\b|end of sea passage|항해 종료"),
    ("ANCHORED", r"\banchored\b|dropped anchor|투묘|묘박지 도착|arrived (at )?(the )?anchorage"),
    ("NOR_RETENDERED", r"re-?tender|NOR[^,.;\n]*(재제출|재송신)|(재제출|재송신)[^,.;\n]*NOR"),
    ("NOR_TENDERED", r"NOR\s*(was\s*)?(tendered|송신|제출)|notice of readiness tendered"),
    # '수령'은 NOR과 같은 구절에 있을 때만 (예: 'B/L 서류 수령'을 NOR 수령으로 읽지 않게)
    ("NOR_RECEIVED", r"NOR\s*(was\s*)?(received|accepted)|notice of readiness (received|accepted)|NOR[^,.;\n]*(수령|접수)"),
    ("FREE_PRATIQUE", r"free pratique|검역 허가"),
    ("BERTH_VACATED", r"앞 선박 이안|previous vessel (sailed|unberthed|departed|cast off)|berth vacated"),
    ("PILOT_ON_BOARD", r"pilot on board|\bPOB\b|도선사 승선"),
    ("ANCHOR_AWEIGH", r"anchor aweigh|anchor up|heav(e|ing) up anchor|양묘"),
    ("ALL_FAST", r"all fast|finished mooring|\bmoored\b|접안 완료|계류 완료"),
    ("HOSES_CONNECTED", r"hoses? connected|호스 연결"),
    ("OPS_COMMENCED", r"commenced (discharg|load)|(discharg|load)ing commenced|양하 개시|선적 개시|하역 개시"),
    ("OPS_RESUMED", r"\bresumed\b|재개"),
    ("OPS_STOPPED", r"\bstopped\b|\bsuspended\b|중단"),
    ("OPS_COMPLETED", r"completed (discharg|load)|(discharg|load)ing completed|양하 완료|선적 완료|하역 완료"),
    ("HOSES_DISCONNECTED", r"hoses? disconnected|호스 분리"),
    ("DOCS_ON_BOARD", r"documents on board|docs on board|서류 완료"),
    ("LAST_LINE", r"last line|unberthed|cast off|이안"),
    ("COSP", r"\bCOSP\b|commenced sea passage|출항"),
]
_COMPILED = [(t, re.compile(p, re.I)) for t, p in _RULES]

_DERIVED = re.compile(r"통지시간 만료|레이타임 (개시|소진)|체선 개시|notice time (expired|expiry)|laytime (commenced|expired)", re.I)

_STOP_REASONS = [
    ("WEATHER", r"강풍|기상|너울|파고|폭풍|weather|\bwinds?\b|swell|storm|\bgale\b"),
    ("STRIKE", r"파업|strike"),
    ("SHIP_EQUIPMENT", r"선박 (펌프|설비|기관)|선박측|ship'?s? (pump|equipment|breakdown)|vessel'?s? (pump|breakdown)"),
    ("SHORE_TANK", r"육상 탱크|탱크 (여유|부족)|shore tank|ullage"),
    ("SHORE_EQUIPMENT", r"육상 설비|터미널 설비|shore (pump|equipment|line)|plant breakdown"),
    ("DOCUMENTS", r"서류|documents?"),
    ("SAFETY", r"안전|safety"),
]
_STOP_COMPILED = [(r, re.compile(p, re.I)) for r, p in _STOP_REASONS]

_T_REL = re.compile(r"^\s*D(\d+)\s+(\d{1,2}):(\d{2})\s*(.*)$")
_T_ABS = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})\s*(.*)$")
_T_MD = re.compile(r"^\s*(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(.*)$")
_PSI = re.compile(r"(\d+(?:\.\d+)?)\s*psi", re.I)
_NO_SHORE_LIMIT = re.compile(r"육상 (배압 )?제한 없음|no shore restriction|without shore restriction", re.I)
_SHORE_LIMIT = re.compile(r"육상 (배압 )?제한 (있음|발생)|shore restriction (applied|imposed)|back ?pressure restriction", re.I)
_BERTH_FREE = re.compile(r"선석 비어 있음|berth (was )?(free|vacant|available)", re.I)
_ENGINE_STOP = re.compile(r"engines? (were |was )?stopped|기관 정지|엔진 정지", re.I)
_TIMEISH = re.compile(r"\d{1,2}:\d{2}")


def _base_date(base_date):
    if base_date in (None, ""):
        return None
    if isinstance(base_date, str):
        return ts(base_date).date() if len(base_date) > 10 else datetime.strptime(base_date, "%Y-%m-%d").date()
    return base_date

SINGLE = {"ANCHORED", "NOR_TENDERED", "NOR_RECEIVED", "ALL_FAST", "HOSES_CONNECTED", "OPS_COMMENCED", "OPS_COMPLETED", "HOSES_DISCONNECTED"}


def _split_time(line, base_date):
    """줄 앞부분의 시각을 읽는다. 'D1 02:00', '2026-11-03 02:00', '11/03 02:00' 지원."""
    line = line.strip()
    if line.startswith("|"):
        cells = [c.strip() for c in line.strip("|").split("|")]
        line = " ".join(c for c in cells if c)
    line = line.replace("**", "")
    m = _T_REL.match(line)
    if m:
        if base_date is None:
            return None, line, "상대 표기(D1)는 기준일이 필요"
        d = int(m.group(1))
        dt = datetime.combine(base_date, datetime.min.time()) + timedelta(days=d - 1, hours=int(m.group(2)), minutes=int(m.group(3)))
        return dt, m.group(4), None
    m = _T_ABS.match(line)
    if m:
        y, mo, d, hh, mm, rest = m.groups()
        return datetime(int(y), int(mo), int(d), int(hh), int(mm)), rest, None
    m = _T_MD.match(line)
    if m and base_date is not None:
        mo, d, hh, mm, rest = m.groups()
        return datetime(base_date.year, int(mo), int(d), int(hh), int(mm)), rest, None
    return None, line, None


def _stop_reason(text):
    for reason, rx in _STOP_COMPILED:
        if rx.search(text):
            return reason
    return "OTHER"


def parse_sof(text, base_date=None, source="SOF"):
    base = _base_date(base_date)
    events, lines, notes, warnings = [], [], {"berth_free_on_arrival": False, "pumping_log": None, "berth_vacated": None}, []
    psi, shore = None, None
    for no, raw in enumerate((text or "").splitlines(), start=1):
        if not raw.strip() or set(raw.strip()) <= set("|-: "):
            continue
        dt, rest, err = _split_time(raw, base)
        if err:
            warnings.append(f"{no}행: {err}")
        if dt is None:
            if not err and _TIMEISH.search(raw):
                warnings.append(f"{no}행: 시각 형식을 읽지 못해 건너뜀 — 지원 형식: D1 02:00 · 2026-11-03 02:00 · 11/03 02:00(기준일 필요)")
            lines.append({"no": no, "raw": raw.strip(), "status": "ignored", "events": []})
            continue
        hits = [t for t, rx in _COMPILED if rx.search(rest)]
        if _DERIVED.search(rest):
            if hits:
                warnings.append(f"{no}행: 계산 항목(통지시간 만료·레이타임 개시 등)으로 보고 건너뜀 — 이벤트({', '.join(hits)})가 섞여 있으면 행을 나눠 주세요")
            lines.append({"no": no, "raw": raw.strip(), "status": "derived", "events": [], "ts": iso(dt)})
            continue
        if "OPS_STOPPED" in hits and _ENGINE_STOP.search(rest):
            hits.remove("OPS_STOPPED")
        if "BERTH_VACATED" in hits and "LAST_LINE" in hits:
            hits.remove("LAST_LINE")
        if "OPS_RESUMED" in hits and "OPS_STOPPED" in hits:
            hits.remove("OPS_STOPPED")
        if "NOR_RETENDERED" in hits and "NOR_TENDERED" in hits:
            hits.remove("NOR_TENDERED")
        if "OPS_STOPPED" in hits and ("OPS_COMPLETED" in hits or "OPS_COMMENCED" in hits):
            hits.remove("OPS_STOPPED")
        if _BERTH_FREE.search(rest):
            notes["berth_free_on_arrival"] = True
        m = _PSI.search(rest)
        if m:
            psi = float(m.group(1))
        if _NO_SHORE_LIMIT.search(rest):
            shore = False
        elif _SHORE_LIMIT.search(rest):
            shore = True
        for t in hits:
            e = {"type": t, "ts": iso(dt), "row": no, "text": rest.strip(), "source": source}
            if t == "OPS_STOPPED":
                e["reason"] = _stop_reason(rest)
            if t == "BERTH_VACATED":
                notes["berth_vacated"] = iso(dt)
            events.append(e)
        lines.append({"no": no, "raw": raw.strip(), "status": "parsed" if hits else "unrecognized", "events": hits, "ts": iso(dt)})
        if not hits:
            warnings.append(f"{no}행: 시각은 있으나 이벤트를 알아보지 못함 — '{rest.strip()[:40]}'")
    if psi is not None or shore is not None:
        notes["pumping_log"] = {"avg_manifold_psi": psi, "shore_restriction": bool(shore),
                                "evidence": "SOF 비고: 육상 배압 제한 없음" if shore is False else ("SOF 비고: 육상 제한 있음" if shore else None)}
    return {"events": events, "lines": lines, "notes": notes, "warnings": warnings, "checks": validate(events)}


_SEQUENCE = ["ANCHORED", "ANCHOR_AWEIGH", "ALL_FAST", "HOSES_CONNECTED", "OPS_COMMENCED", "OPS_COMPLETED", "HOSES_DISCONNECTED"]


def validate(events):
    """계산 전에 반드시 통과해야 하는 결정론적 검증. LLM 추출 결과에도 똑같이 적용한다."""
    out = []
    by_type = {}
    for e in events:
        by_type.setdefault(e["type"], []).append(e)
    for t in ("NOR_TENDERED", "ALL_FAST", "HOSES_DISCONNECTED"):
        if t not in by_type and not (t == "NOR_TENDERED" and "NOR_RECEIVED" in by_type):
            out.append({"level": "error", "msg": f"필수 이벤트 없음: {EVENT_LABEL[t]} ({t})"})
    for t, why in (("ANCHORED", "NOR 유효성(도착 전 NOR) 판단"), ("ANCHOR_AWEIGH", "이동 시간 공제"),
                   ("OPS_COMMENCED", "무효 NOR 시 개시 시점·펌핑 보증"), ("OPS_COMPLETED", "펌핑 보증 계산")):
        if t not in by_type:
            out.append({"level": "warning", "msg": f"권장 이벤트 없음: {EVENT_LABEL[t]} — {why}에 필요"})
    for t in SINGLE:
        if len(by_type.get(t, [])) > 1:
            out.append({"level": "warning", "msg": f"{EVENT_LABEL[t]}가 {len(by_type[t])}번 — 첫 번째만 사용"})
    seq = [(t, ts(by_type[t][0]["ts"])) for t in _SEQUENCE if t in by_type]
    for (t1, a), (t2, b) in zip(seq, seq[1:]):
        if b < a:
            out.append({"level": "error", "msg": f"시각 순서 오류: {EVENT_LABEL[t2]} {iso(b)} < {EVENT_LABEL[t1]} {iso(a)}"})
    n_stop, n_res = len(by_type.get("OPS_STOPPED", [])), len(by_type.get("OPS_RESUMED", []))
    if n_stop != n_res:
        out.append({"level": "warning", "msg": f"하역 중단 {n_stop}건 / 재개 {n_res}건 — 짝이 맞지 않음(미재개는 하역 완료로 닫음)"})
    return out
