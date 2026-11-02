"""COMMS — 회신·통보·메모 초안. 지금은 템플릿이고, 이 파일이 LLM으로 바꿀 자리다.

입력은 항상 엔진이 만든 구조화 결과(숫자·룰 ID·시각)이고, 초안은 그 숫자를 바꾸지 않는다.
LLM으로 교체해도 같은 입력 → 문장만 생성, 숫자는 검증 후 그대로 삽입하는 방식을 유지한다.
"""
from __future__ import annotations

from .timeutil import fmt_h, fmt_ts, ts

GEN = {"generated_by": "template", "llm_slot": "engine/drafts.py — 구조화 결과를 받아 문장만 생성"}


def _d(to, subject, body, lang, cc=None, kind="email"):
    return dict(GEN, to=to, cc=cc or [], subject=subject, body=body.strip(), lang=lang, kind=kind)


def _en(dt):
    return ts(dt).strftime("%H%M LT %d %b %Y") if dt else "-"


def nor_reply(vessel, call, nor_at, arrived, anchored_at, berth_note, retender=False):
    name = vessel["name"]
    if not arrived:
        body = f"""
Dear Sirs,

MV {name} / Ulsan CLX / {call['call_id']}

We acknowledge receipt of the vessel's Notice of Readiness timed {_en(nor_at)}.
According to AIS, the vessel had not yet arrived at the customary anchorage at that time.
A Notice of Readiness tendered prior to arrival is not valid. Charterers/Receivers reject the NOR as tendered
and request the Master to re-tender NOR upon arrival at the customary anchorage.

Laytime will commence in accordance with the Charter Party terms on a valid NOR only.
All rights reserved.

Best regards,
Ulsan CLX Marine Terminal — Demurrage Desk (draft · fictional demo)
"""
        return _d([call.get("agent", "Agent")], f"MV {name} — NOR tendered prior to arrival / Re-tender required", body, "en")
    body = f"""
Dear Sirs,

MV {name} / Ulsan CLX / {call['call_id']}

Notice of Readiness {'re-' if retender else ''}tendered {_en(nor_at)} is received, validity reserved.
Vessel anchored at the customary anchorage at {_en(anchored_at)} (AIS).
{berth_note}

Laytime to count as per Charter Party terms. This receipt does not constitute acceptance of the NOR's validity.

Best regards,
Ulsan CLX Marine Terminal — Demurrage Desk (draft · fictional demo)
"""
    return _d([call.get("agent", "Agent")], f"MV {name} — NOR {'re-' if retender else ''}received, validity reserved", body, "en")


def etb_notice(changes, title):
    lines = []
    for c in changes:
        if c.get("etb_before") and c.get("etb_after") and c["etb_before"] != c["etb_after"]:
            lines.append(f"- MV {c['vessel']}: berth {c['berth_after']}, ETB {_en(c['etb_before'])} -> {_en(c['etb_after'])}")
        elif c.get("berth_before") != c.get("berth_after"):
            lines.append(f"- MV {c['vessel']}: berth {c['berth_before']} -> {c['berth_after']}, ETB {_en(c['etb_after'])}")
    if not lines:
        return None
    body = "Dear Sirs,\n\nPlease note the revised berthing schedule at Ulsan CLX:\n\n" + "\n".join(lines) + """

Pilot and mooring arrangements will follow. Times are estimates and subject to weather and terminal conditions.

Best regards,
Ulsan CLX Marine Terminal — Demurrage Desk (draft · fictional demo)
"""
    return _d(sorted({c["agent"] for c in changes if c.get("agent")}), f"Ulsan CLX — revised berthing schedule ({title})", body, "en", cc=["Ulsan Pilot"])


def memo_lever(lever, saving, detail_lines):
    body = f"""
생산조정팀 담당자님,

{lever['title']}을 요청드립니다.

- 사유: {lever.get('reason', '폭풍 예보로 SBM 하역 중단이 예상되어, 중단 전에 하역을 끝내면 체선료 노출이 줄어듭니다.')}
- 적용 시점: {fmt_ts(ts(lever['effective_from']))}부터
- 예상 효과: 체선료 노출 약 USD {saving:,.0f} 감소 (에이전트 계산, 가정 포함)
{chr(10).join('  · ' + x for x in detail_lines)}
- 확인 요청: {lever.get('note', '')}

승인되면 SEAGATE 원유재고예측·접안계획에 반영 부탁드립니다.
(체선료 데스크 — 초안)
"""
    return _d(["생산조정팀"], f"[요청] {lever['title']}", body, "ko", kind="memo")


def memo_oos(berth, call_name, exposure, window):
    body = f"""
정비팀·생산조정팀 담당자님,

{berth['name']}({berth['id']}) 정비({window})로 SBM이 1기만 운영되어 {call_name}의 체선료 노출이 약 USD {exposure:,.0f}로 계산됩니다.
다른 선석은 선박 제원상 배정이 불가합니다(아래 근거).

정비 일정을 앞당길 수 있는지, 가능하다면 사용 가능 시점을 알려 주시면 영향(돈)을 다시 계산해 드리겠습니다.

(체선료 데스크 — 초안)
"""
    return _d(["정비팀", "생산조정팀"], f"[문의] {berth['id']} 정비 일정 조기화 가능 여부", body, "ko", kind="memo")


def statement_cover(vessel, call, contract, st, recon_delta, reasons):
    top = ", ".join(f"{r['label']} {fmt_h(r['hours'])}" for r in reasons[:3]) or "없음"
    body = f"""
트레이딩·용선 담당자님,

MV {vessel['name']} ({call['call_id']}) 레이타임 계산서 초안입니다.

- 계약: {contract['form']} / {contract['layer']} / {contract['counterparty']}
- 레이타임: {fmt_ts(ts(st['laytime_start']))} 개시 ~ {fmt_ts(ts(st['laytime_end']))} 종료, 사용 {fmt_h(st['used_h'])} / 허용 {fmt_h(st['allowed_h'])}
- 체선: {fmt_h(st['demurrage_h'])} (반액 {fmt_h(st['half_h'])}) → USD {st['amount_usd']:,.2f}
- 주요 체선사유: {top}
- SOF 대조: 대리점 SOF 그대로 계산하면 USD {recon_delta:+,.2f} 차이 → 터미널 기록 기준으로 작성
- 쟁점: {len([i for i in st['issues'] if i['severity'] == 'dispute'])}건 (계산서 '쟁점' 표 참조, 자동 판정하지 않음)

선주·상대방 청구가 들어오면 이 계산서와 대조합니다.
(체선료 데스크 — 초안)
"""
    return _d(["트레이딩·용선팀"], f"[계산서 초안] MV {vessel['name']} — USD {st['amount_usd']:,.0f}", body, "ko", kind="memo")


def claim_reply(review):
    c, v = review["claim"], review["vessel"]
    rec = review["recommendation"]
    lines = [f"Dear Sirs,\n\nMV {v['name']} / {review['call']['call_id']} / Demurrage claim {c['claim_id']}\n"]
    if rec["code"] == "TIME_BARRED":
        lines.append(f"We refer to your claim received on {ts(c['received_at']).strftime('%d %b %Y')}. "
                     f"Under the Charter Party, claims must be presented with supporting documents within {review['time_bar']['days']} days "
                     f"of completion of discharge ({ts(review['time_bar']['base']).strftime('%d %b %Y')}). "
                     f"The time limit expired on {ts(review['time_bar']['deadline']).strftime('%d %b %Y')}. Charterers are therefore discharged from liability and the claim is rejected.")
    else:
        computed = review["computed"]["amount_usd"]
        lines.append(f"We have reviewed your claim of USD {c['owner_calc']['amount_usd']:,.2f} against the signed SOF and terminal records. "
                     f"Our calculation is USD {computed:,.2f}.\n")
        for i, w in enumerate(review["waterfall"], start=1):
            lines.append(f"{i}. {w['en']}. (reduces the claim by USD {w['delta_usd']:,.2f})")
        reserved = [d for d in review.get("disputes", []) if d.get("side") == "CHARTERER" and d.get("en")]
        if reserved and rec["code"] != "REJECT_ZERO":
            lines.append("\nWithout prejudice to the above, Charterers reserve their position that " +
                         "; and that ".join(d["en"] for d in reserved) + ".")
        if review["documents"]["missing"]:
            labels = review["documents"].get("missing_labels_en") or review["documents"]["missing_labels"]
            lines.append("\nPlease also provide the following outstanding documents: " + "; ".join(labels) + ".")
        if rec["code"] == "REJECT_ZERO":
            lines.append("\nOn this basis no demurrage is due and the claim is rejected.")
        elif rec["code"] == "ACCEPT":
            lines.append(f"\nWe accept the claim at USD {computed:,.2f}; payment will be arranged upon receipt of your invoice.")
        elif rec["code"] == "REQUEST_DOCS":
            lines.append(f"\nPayment of USD {computed:,.2f} will be arranged upon receipt of the outstanding documents.")
        else:
            lines.append(f"\nWe are prepared to settle at USD {computed:,.2f} in full and final settlement.")
    lines.append("\nAll rights reserved.\n\nBest regards,\nDemurrage Desk (draft · fictional demo)")
    return _d([c["claimant"]], f"MV {v['name']} — Demurrage claim {c['claim_id']} — {rec['en']}", "\n".join(lines), "en")


def seagate_reason_entry(call, reasons):
    rows = [{"code": r["code"], "label": r["label"], "hours": round(r["hours"], 2), "marginal_usd": r["marginal_usd"]} for r in reasons]
    return {"kind": "seagate_entry", "target": "SEAGATE Report > 체선사유 (가상 코드표)", "call_id": call["call_id"], "rows": rows,
            "generated_by": "engine"}
