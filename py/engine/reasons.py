"""체선사유 분류 — 계산서 구간을 사유 코드로 묶고, 사유별 시간·체선료 기여(그 사유가 없었다면)를 계산한다.

코드표는 가상이다. 실제 SEAGATE Report > 체선사유 코드표를 받으면 CODE만 바꾼다(diagnosis §7 질문 2).
"""
from __future__ import annotations

from . import clock
from .clock import reason_key
from .timeutil import round_usd

CODES = {
    "WAIT:CONGESTION": ("R01", "선석 점유 대기"),
    "WAIT:NIGHT": ("R02", "야간 계류·접안 제한"),
    "WAIT:WEATHER": ("R03", "기상 — 접안 불가"),
    "STOP:WEATHER": ("R03", "기상 — 하역 중단"),
    "STOP:SHORE_TANK": ("R04", "육상 탱크"),
    "STOP:SHORE_EQUIPMENT": ("R04", "육상 설비 고장"),
    "SHORE_RATE": ("R04", "육상 수용률 제한(하역 지연)"),
    "STOP:SHIP_EQUIPMENT": ("R05", "선박 설비"),
    "EXCESS_PUMPING": ("R05", "선박 펌핑 성능"),
    "STOP:DOCUMENTS": ("R06", "서류"),
    "WAIT:OOS": ("R07", "선석 정비·사용불가"),
    "SHIFT": ("R08", "이동(shifting)"),
    "WAIT:OTHER": ("R99", "기타 대기"),
    "WAIT:UNKNOWN": ("R99", "사유 미상"),
    # v3 자원·제약 (data/live/resources.json)
    "WAIT:TIDE": ("R09", "조석·UKC 창 대기"),
    "WAIT:TUG": ("R10", "예선·도선·계류 감독 대기"),
    "WAIT:VETTING": ("R11", "선박 검사·승인 대기"),
    "WAIT:FOG": ("R12", "시정 불량 항만 통제"),
    "WAIT:WAVE": ("R03", "파고 — 접안 불가"),
    "WAIT:TANK": ("R04", "탱크 공간 부족 — 접안 보류"),
    "STOP:PIPELINE": ("R14", "공유 배관 — 하역 중단"),
    "PIPELINE": ("R14", "공유 배관 한도(하역 지연)"),
    "SHORE_TANK_SLOW": ("R04", "탱크 공간 부족(하역 지연)"),
    "CHANGEOVER": ("R15", "제품 전환·라인 치환"),
    "SAMPLING": ("R16", "샘플링·분석 대기"),
}
# 계산서 구간 안에 묻혀 있어 SIM 결과로 추정하는 v3 사유: (sim 키, 하위 키, 사유 키, 설명)
SIM_ESTIMATES = [("slow_h", "PIPELINE", "PIPELINE", "공유 주배관 잔여 용량만큼만 하역 (먼저 접안한 선박 우선)"),
                 ("slow_h", "SHORE_TANK", "SHORE_TANK_SLOW", "탱크가 상한에 닿아 공정 투입 속도만큼만 하역"),
                 ("prep_h", "CHANGEOVER", "CHANGEOVER", "호스 연결 후 라인 치환이 끝나야 하역 개시"),
                 ("prep_h", "SAMPLING", "SAMPLING", "샘플 분석이 끝나야 하역 개시")]
SKIP = {"BERTH_PREP", "PUMPING", "POST_OPS"}
NOTE = ("기여액 = 그 사유의 시간만 없었다고 보고 다시 계산한 체선료 감소분(단독 제거 효과). "
        "사유끼리 겹치므로 기여액의 합은 총 체선료와 같지 않다. 코드표는 가상 — SEAGATE 체선사유 코드표로 교체 필요.")


def classify(events, terms, context, statement, sim_result=None, vessel=None):
    rows = {}
    for s in statement["segments"]:
        if s["kind"] in SKIP:
            continue
        key = reason_key(s["kind"], s["reason"])
        if key not in CODES:
            key = "WAIT:OTHER" if s["kind"] == "WAIT" else key
        code, label = CODES.get(key, ("R99", s["label"]))
        r = rows.setdefault(key, {"key": key, "code": code, "label": label, "hours": 0.0, "laytime_h": 0.0, "demurrage_h": 0.0, "excluded_h": 0.0})
        r["hours"] += s["hours"]
        if s["effect"] == "EXCLUDE":
            r["excluded_h"] += s["hours"]
        elif s["phase"] == "DEMURRAGE":
            r["demurrage_h"] += s["hours"]
        else:
            r["laytime_h"] += s["hours"]
    base = statement["amount_usd"]
    for key, r in rows.items():
        if base > 0 and key not in ("SHIFT", "EXCESS_PUMPING"):
            alt = clock.compute(events, terms, context, {"exclude_reasons": [key]}, alternatives=False)
            r["marginal_usd"] = round_usd(base - alt["amount_usd"])
        else:
            r["marginal_usd"] = 0.0
    rate = statement.get("rate_usd_day") or 0.0
    v3_slow = 0.0
    if sim_result:
        for field, sub, key, detail in SIM_ESTIMATES:
            h = float((sim_result.get(field) or {}).get(sub, 0.0))
            if field == "slow_h":
                v3_slow += h
            if h < 0.25:
                continue
            rows[key] = {"key": key, "code": CODES[key][0], "label": CODES[key][1], "hours": h,
                         "laytime_h": 0.0, "demurrage_h": 0.0, "excluded_h": 0.0, "estimated": True,
                         "marginal_usd": round_usd(min(min(h, statement["demurrage_h"]) * rate / 24, statement["amount_usd"])),
                         "detail": f"{detail} (SIM 추정, 총액 상한)"}
    if sim_result and vessel and terms.get("operation") == "DISCHARGE":
        ideal_h = sim_result["volume_m3"] / vessel["pump_m3h"]
        pumping_h = sum(s["hours"] for s in statement["segments"] if s["kind"] in ("PUMPING", "EXCESS_PUMPING"))
        lost = pumping_h - ideal_h - v3_slow
        if lost > 0.25:
            rows["SHORE_RATE"] = {"key": "SHORE_RATE", "code": "R04", "label": CODES["SHORE_RATE"][1], "hours": lost,
                                  "laytime_h": 0.0, "demurrage_h": 0.0, "excluded_h": 0.0, "estimated": True,
                                  "marginal_usd": round_usd(min(min(lost, statement["demurrage_h"]) * rate / 24, statement["amount_usd"])),
                                  "detail": f"선박 펌프 {vessel['pump_m3h']:,} m3/h 대비 육상 {sim_result['rate_m3h']:,.0f} m3/h (단순 추정, 총액 상한)"}
    out = sorted(rows.values(), key=lambda r: (-r["marginal_usd"], -r["hours"]))
    return [r for r in out if r["hours"] >= 0.25]
