"""ASSURANCE — Phase 28 검증 KPI · Phase 30 Shadow Mode·파일럿·거버넌스.

- KPI는 검증(정책 경쟁·Historical Replay·시나리오·민감도) 결과로 계산한다 → basis VIRTUAL(가상 사례 1주). 목표값은 합의 전이라 [가정].
- Shadow Mode = 현업 경로(기준 계획 유지)는 그대로 두고, 같은 결정 시점에 에이전트가 냈을 1순위 후보를 나란히 기록·비교한다.
  human_usd·agent_usd는 그 시점 정보로 본 예상 체선료, cost_delta_usd는 1순위 후보를 모두 승인했을 때의 실제(가상) 차이.
- Acceptance·Override Rate는 감사 로그의 사람 결정으로만 계산한다. 데모 화면 결정은 현업 실측이 아니다.
"""
from __future__ import annotations

import json

from .diagnosis import POLICY_LABEL, usd
from .timeutil import fmt_h, iso, round_usd, ts

GROUPS = ["Financial", "Operational", "Risk", "Decision Quality", "Agent"]
SAVING_TARGET_PCT = 10.0      # 비즈니스 케이스 보수 가정 절감률과 맞춘다 [가정]
UTIL_WARN = 0.85              # 선석 점유율 혼잡 경고선 [가정]
REGRET_SHARE = 0.05           # 사후 최적 대비 후회 허용: 현업 Rule 총액의 5% [가정]
GAP_CLEAR_USD = 10000         # 1·2순위 후보 차이가 이보다 크면 1순위가 뚜렷 [가정] (에이전트 후보 임계값과 같은 크기)
STABILITY_TARGET = 0.7        # 민감도 수준 중 최적안 유지 비율 [가정]
COMPUTE_TARGET_MS = 60000     # 결정 시점당 추천 생성 1분 이내 [가정]
_CACHE = {}

PILOT = [
    {"stage": "PoC", "goal": "가상 시나리오로 계산 정확도·후보 생성·설명 형식을 시연하고 문제 정의·KPI를 멘토와 합의",
     "entry": "프로토타입 동작, Golden Set 정답 재현", "exit": "KPI·목표값 합의, 실제 어려웠던 하루 1~3건 확보",
     "duration": "지금 ~ 2주 [가정]", "owner": "프로젝트 팀", "risk": "가상 데이터라 효과 수치가 과장될 수 있다 — 숫자 대신 구조로 설명", "status": "NOW"},
    {"stage": "Shadow Mode", "goal": "운영에 영향 없이 결정 시점마다 에이전트 후보를 현업 결정과 나란히 기록 — 일치율·비용 차이·오탐 측정",
     "entry": "SEAGATE 내보내기(Berthing Schedule·ETB Change Log·Cargo Working) 읽기 전용 연동, 계약 조건 입력",
     "exit": "결정 시점 30회 이상 비교, 계산 오류 0건, 현업이 후보 근거를 이해 [가정]", "duration": "4~8주 [가정]",
     "owner": "생산조정팀(검토) · 프로젝트 팀(운영)", "risk": "기록 부담 — 감사 로그 자동 기록, 데이터 지연 — 시각 표시", "status": "NEXT"},
    {"stage": "Pilot", "goal": "작업함에서 담당자가 후보를 승인·반려해 실제 결정에 사용 — SBM 원유선으로 범위 제한",
     "entry": "Shadow 결과 승인, 권한·책임 합의(거버넌스 표)", "exit": "Acceptance·Override Rate, 같은 기간 체선료 비교, 사용자 만족",
     "duration": "2~3개월 [가정]", "owner": "생산조정팀", "risk": "잘못된 후보 승인 — 승인 직전 Hard 제약 재검증·이전 계획 버전으로 되돌리기", "status": "LATER"},
    {"stage": "Partial Adoption", "goal": "원유선 전체 + 레이타임 계산서·클레임 검토로 확대",
     "entry": "Pilot KPI 달성", "exit": "업무 절차서·분장 반영", "duration": "3~6개월 [가정]",
     "owner": "생산조정팀 · 원유 구매", "risk": "업무 분장 변경 저항 — RACI 재합의", "status": "LATER"},
    {"stage": "Integration", "goal": "SEAGATE 메뉴 안으로 통합(읽기·쓰기 API), 알림·메일 연동으로 이중 입력 제거",
     "entry": "SK AX 연동·보안 검토 승인", "exit": "이중 입력 0, 장애 시 수동 절차 확보", "duration": "3~6개월 [가정]",
     "owner": "SK AX", "risk": "시스템 변경 비용·보안 — MCP·API는 읽기 전용부터", "status": "LATER"},
    {"stage": "Scale-up", "goal": "제품선·다른 사업장으로 확장, 규칙 표(DL-xx)를 사업장별로 관리",
     "entry": "울산 효과 검증", "exit": "표준 모델·운영 조직", "duration": "[가정] 미정",
     "owner": "AX 추진 조직 [가정]", "risk": "사업장별 규칙·계약 차이", "status": "LATER"},
]

GOVERNANCE = [
    {"question": "추천 결과의 책임은 누구에게 있는가?", "answer": "승인한 담당자(사람). 에이전트는 후보·근거만 내고, 승인 없이는 계획·발송이 바뀌지 않는다", "basis": "문서"},
    {"question": "에이전트의 권한은 어디까지인가?", "answer": "읽기·계산·초안 작성까지. 확정·발송·계획 반영은 승인 후. MCP 도구는 읽기 전용", "basis": "문서"},
    {"question": "최종 승인권자는 누구인가?", "answer": "선석 계획 = 생산조정팀, 레이타임·체선료 정산 = 원유 구매 담당 (stakeholders RACI의 A)", "basis": "가정"},
    {"question": "쟁점(분쟁) 판단은 자동인가?", "answer": "아니오 — 기본 계산과 대안 계산(선주·용선주 주장)을 함께 보여 주고 담당자가 정한다(ENG-DISPUTE-NO-AUTO)", "basis": "문서"},
    {"question": "모델이 틀리면 어떻게 하는가?", "answer": "후보마다 확인한 규칙·가정·스트레스 테스트를 표시하고, 승인 직전 Hard 제약을 다시 검증한다. 문제가 생기면 이전 계획 버전으로 되돌리고 감사 로그에 남긴다", "basis": "가정"},
    {"question": "데이터가 틀리면 어떻게 하는가?", "answer": "SOF와 터미널 기록이 10분 이상 다르면 플래그(ENG-RECONCILE), 도착 전 NOR은 AIS로 대조(LAW-NOR-ARRIVAL) — 자동으로 고치지 않고 담당자에게 넘긴다", "basis": "문서"},
    {"question": "결정 기록은 어떻게 남기는가?", "answer": "승인·반려·발송을 감사 로그(누가·언제·어떤 후보·메모)로 남긴다 — Shadow Mode 비교와 Acceptance·Override Rate의 원자료", "basis": "문서"},
    {"question": "사람이 반드시 개입하는 결정은?", "answer": "계획 변경, NOR 회신, 클레임 회신, 탱크 레버(생산 영향), 안전 예외 — 전부 승인 필요", "basis": "가정"},
    {"question": "누가 운영하는가?", "answer": "현업 운영 = 생산조정팀, 시스템 운영 = SK AX, 규칙·가정 관리 = 생산조정팀(규칙 표 DL-xx)", "basis": "가정"},
    {"question": "회사 AI 원칙과 맞는가?", "answer": "SK이노베이션 울산CLX '듀얼 브레인'(AI가 제안하고 숙련자가 최종 판단·실행)과 같은 구조 [사실: 기사 2026-09, Case G]", "basis": "문서"},
]


def _replay(val):
    return {r.get("policy"): r for r in (val or {}).get("replay") or [] if isinstance(r, dict) and r.get("policy")}


def _kpi(group, key, label, value, unit, target, ok, basis="VIRTUAL", note=""):
    status = "NA" if value is None or ok is None else ("OK" if ok else "WARN")
    return {"group": group, "key": key, "label": label, "value": value, "unit": unit, "target": target, "status": status,
            "basis": "NA" if value is None else basis, "note": note}


def _n_calls(reps):
    for r in reps.values():
        if r.get("per_call"):
            return len(r["per_call"])
    return None


def _golden_rate(golden):
    if golden and golden.get("total"):
        return golden["passed"], golden["total"]
    from . import golden as golden_mod
    passed, cases = 0, golden_mod.cases()[1]
    for case in cases:
        _, _, st = golden_mod.run_case(case["id"])
        if st.get("status") == "OK" and abs(st["amount_usd"] - case["expected"]["amount_usd"]) < 0.01:
            passed += 1
    return passed, len(cases)


def _scenario_values(val, pid):
    out = []
    for s in (val or {}).get("scenarios") or []:
        if not s.get("modeled"):
            continue
        res = {x.get("policy"): x.get("total_usd") for x in s.get("results") or [] if isinstance(x, dict)}
        if res.get(pid) is not None:
            out.append((s.get("id"), float(res[pid])))
    return out


def _p95(values):
    xs = sorted(values)
    if not xs:
        return None
    k = max(0, -(-95 * len(xs) // 100) - 1)  # nearest-rank
    return xs[k]


def _stability(sens):
    levels = [lv for f in (sens or {}).get("factors") or [] for lv in f.get("levels") or []]
    if not levels:
        return None, 0
    keep = sum(1 for lv in levels if not lv.get("flip"))
    return keep / len(levels), len(levels)


def _decisions(audit):
    rows = [a for a in audit or [] if a.get("decision") in ("APPROVE_OPTION", "REJECT") and a.get("actor") != "validation"]
    return rows


# ---------------------------------------------------------------- Shadow Mode
def _shadow(val, world=None, agent=None):
    key = json.dumps([(val or {}).get("fingerprint"), (val or {}).get("computed_at"), (val or {}).get("decision_points")],
                     sort_keys=True, ensure_ascii=False, default=str)
    if key in _CACHE:
        return _CACHE[key]
    if world is None:
        from .casestudy import shared
        world, shared_agent = shared()
        agent = agent or shared_agent
    if agent is None:
        from .agent import Agent
        agent = Agent(world)
    base = world.base_history()
    items = agent.timeline(base)["items"]
    dps = (val or {}).get("decision_points") or []
    if not dps:
        from .replay import decision_points
        dps = [{"t": iso(d["t"]), "trigger": d["trigger"], "label": d["label"]} for d in decision_points(world)]
    rows, options = [], []
    for dp in dps:
        t = ts(dp["t"])
        item = next((i for i in items if ts(i["created_at"]) == t and i["kind"] in ("BASELINE", "IMPACT")), None)
        opt = (item or {}).get("options") or {}
        best = opt.get("best") or []
        human_usd = opt.get("baseline_usd")
        if human_usd is None and item is not None:
            human_usd = item.get("total_after") if item.get("total_after") is not None else sum(
                x.get("amount_usd") or 0 for x in item.get("exposure") or [])
        top = best[0] if best else None
        agent_usd = top.get("total_usd") if top else human_usd
        gap = (best[0].get("saving_usd") or 0) - (best[1].get("saving_usd") or 0) if len(best) > 1 else None
        rows.append({"t": iso(t), "trigger": dp["trigger"], "label": dp.get("label", ""), "item_id": (item or {}).get("id"),
                     "human": "계획 유지 (현업 Rule)", "agent": top["title"] if top else "계획 유지 — 임계값을 넘는 후보 없음",
                     "agree": top is None, "candidates": len(best), "gap_usd": None if gap is None else round_usd(gap),
                     "human_usd": None if human_usd is None else round_usd(human_usd),
                     "agent_usd": None if agent_usd is None else round_usd(agent_usd),
                     "delta_usd": None if (human_usd is None or agent_usd is None) else round_usd(human_usd - agent_usd)})
        options += best
    out = {"rows": rows, "options": options}
    _CACHE[key] = out
    return out


def run(validation, audit=None, golden=None, world=None, agent=None):
    val = validation or {}
    reps = _replay(val)
    cur, agt = reps.get("CURRENT_RULE") or {}, reps.get("AGENT_HITL") or reps.get("OPTIMIZER") or {}
    agt_pid = "AGENT_HITL" if reps.get("AGENT_HITL") else ("OPTIMIZER" if reps.get("OPTIMIZER") else None)
    cur_usd, agt_usd = cur.get("total_usd"), agt.get("total_usd")
    n = _n_calls(reps)
    dps = val.get("decision_points") or []
    k = []
    # Financial
    k.append(_kpi("Financial", "total_demurrage", "총 체선료 (에이전트 경로)", agt_usd, "USD", "현업 Rule보다 낮게 [가정]",
                  None if agt_usd is None or cur_usd is None else agt_usd < cur_usd,
                  note=f"현업 Rule {usd(cur_usd)} → {'에이전트 1순위 승인' if agt_pid == 'AGENT_HITL' else 'Optimizer'} {usd(agt_usd)} (가상 1주)"))
    pct = None if not cur_usd or agt_usd is None else round((cur_usd - agt_usd) / cur_usd * 100, 1)
    k.append(_kpi("Financial", "saving_pct", "체선료 절감률 (현업 Rule 대비)", pct, "%", f"≥ {SAVING_TARGET_PCT:.0f}% [가정 — 비즈니스 케이스 보수 가정]",
                  None if pct is None else pct >= SAVING_TARGET_PCT, note="가상 스트레스 1주 — 연간 절감률로 쓰지 않는다"))
    per = None if agt_usd is None or not n else round_usd(agt_usd / n)
    per_cur = None if cur_usd is None or not n else round_usd(cur_usd / n)
    k.append(_kpi("Financial", "per_vessel", "척당 체선료", per, "USD", f"현업 Rule 척당 {usd(per_cur)} 미만 [가정]",
                  None if per is None or per_cur is None else per < per_cur, note=f"{n or '?'}척 기준"))
    # Operational
    w_agt = None if agt.get("waiting_h") is None or not n else round(agt["waiting_h"] / n, 2)
    w_cur = None if cur.get("waiting_h") is None or not n else round(cur["waiting_h"] / n, 2)
    k.append(_kpi("Operational", "avg_wait", "척당 평균 대기", w_agt, "h", f"현업 Rule {fmt_h(w_cur) if w_cur is not None else '—'} 이하 [가정]",
                  None if w_agt is None or w_cur is None else w_agt <= w_cur, note="묘박·야간·기상 대기 합 ÷ 척수 (가상)"))
    k.append(_kpi("Operational", "port_stay", "평균 Port Stay", None, "h", "현업 Rule 이하 [가정]", None,
                  note="검증 결과에 선박별 출항 시각 요약이 없다 — 기준 계획 값은 진단 탭 KPI 참고"))
    util = agt.get("utilization") or {}
    u_max = max(util.values()) if util else None
    k.append(_kpi("Operational", "utilization_peak", "최대 선석 점유율", None if u_max is None else round(u_max * 100, 1), "%",
                  f"≤ {UTIL_WARN * 100:.0f}% (혼잡 경고선) [가정]", None if u_max is None else u_max <= UTIL_WARN,
                  note=(" · ".join(f"{b} {v * 100:.0f}%" for b, v in util.items()) if util else "")))
    ch = agt.get("plan_changes")
    k.append(_kpi("Operational", "schedule_changes", "계획 변경 횟수 (Schedule Stability)", ch, "count",
                  f"≤ 결정 시점 수 {len(dps)} [가정]", None if ch is None or not dps else ch <= len(dps),
                  note="대리점·도선 재통지 부담 — 비용과 함께 본다(Case E: 원계획 준수 지표)"))
    # Risk
    viol = sum(int(r.get("violations") or 0) for r in reps.values()) if reps else None
    k.append(_kpi("Risk", "violations", "제약 위반 (전 정책)", viol, "count", "0", None if viol is None else viol == 0,
                  note="같은 실제 세계(truth)로 채점한 Hard 제약 위반"))
    best_pid = (val.get("headline") or {}).get("best_policy") or agt_pid
    sv = _scenario_values(val, best_pid) if best_pid else []
    sv_cur = _scenario_values(val, "CURRENT_RULE")
    worst = max((v for _, v in sv), default=None)
    worst_cur = max((v for _, v in sv_cur), default=None)
    k.append(_kpi("Risk", "worst_case", f"최악 시나리오 체선료 ({POLICY_LABEL.get(best_pid, best_pid) if best_pid else '—'})",
                  None if worst is None else round_usd(worst), "USD",
                  f"현업 Rule 최악 {usd(worst_cur)} 미만 [가정]", None if worst is None or worst_cur is None else worst < worst_cur,
                  note=f"모델링된 시나리오 {len(sv)}개 중 최댓값"))
    p95 = _p95([v for _, v in sv])
    k.append(_kpi("Risk", "p95_cost", "시나리오 P95 체선료", None if p95 is None else round_usd(p95), "USD", "참고 — 시나리오 집합의 상위값",
                  None if p95 is None else True, note=f"시나리오 {len(sv)}개(확률분포가 아님, nearest-rank)"))
    # Decision Quality
    fcfs = (reps.get("FCFS") or {}).get("total_usd")
    p_f = None if not fcfs or agt_usd is None else round((fcfs - agt_usd) / fcfs * 100, 1)
    k.append(_kpi("Decision Quality", "saving_vs_fcfs", "FCFS 대비 절감률", p_f, "%", "> 0% [가정]", None if p_f is None else p_f > 0,
                  note=f"FCFS {usd(fcfs)}"))
    hind = (val.get("hindsight") or {}).get("total_usd")
    regret = None if hind is None or agt_usd is None else round_usd(agt_usd - hind)
    k.append(_kpi("Decision Quality", "regret", "사후 최적 대비 후회(regret)", regret, "USD",
                  f"≤ 현업 Rule의 {REGRET_SHARE * 100:.0f}% [가정]", None if regret is None or cur_usd is None else regret <= cur_usd * REGRET_SHARE,
                  note=f"사후 최적(미래를 아는 하한) {usd(hind)} — 차이 = 정보 부족으로 잃은 몫"))
    stab, n_lv = _stability(val.get("sensitivity"))
    k.append(_kpi("Decision Quality", "stability", "입력 변화 시 최적안 유지율", None if stab is None else round(stab * 100, 1), "%",
                  f"≥ {STABILITY_TARGET * 100:.0f}% [가정]", None if stab is None else stab >= STABILITY_TARGET,
                  note=f"민감도 수준 {n_lv}개 중 최적안이 안 바뀐 비율"))
    # Agent
    passed, total = _golden_rate(golden)
    acc = None if not total else round(passed / total * 100, 1)
    k.append(_kpi("Agent", "calc_accuracy", "레이타임·체선료 계산 정확도 (Golden Set)", acc, "%", "100%", None if acc is None else passed == total,
                  note=f"TC {passed}/{total}건 정답 일치 (문서 04 예제 기준)"))
    ms = (reps.get("OPTIMIZER") or {}).get("compute_ms")
    per_dp = None if ms is None or not dps else round(ms / len(dps), 1)
    k.append(_kpi("Agent", "compute_ms", "추천 생성 시간 (결정 시점당)", per_dp, "ms", f"< {COMPUTE_TARGET_MS:,} ms [가정]",
                  None if per_dp is None else per_dp < COMPUTE_TARGET_MS, note="소규모(6척) 완전 탐색 기준 — 실규모는 솔버 교체"))
    shadow = _shadow(val, world, agent)
    opts = shadow["options"]
    full = sum(1 for o in opts if o.get("reason") and o.get("rules_checked") and o.get("assumptions"))
    expl = None if not opts else round(full / len(opts) * 100, 1)
    k.append(_kpi("Agent", "explainability", "근거(사유·확인 규칙·가정)를 갖춘 후보 비율", expl, "%", "100%", None if expl is None else full == len(opts),
                  note=f"후보 {len(opts)}개 — 선박별 체선료 변화·스트레스 테스트 포함"))
    worst_s = min(((o.get("risk") or {}).get("worst_saving_usd") for o in opts if (o.get("risk") or {}).get("worst_saving_usd") is not None), default=None)
    k.append(_kpi("Agent", "stress_worst_saving", "스트레스 테스트 최악 절감 (후보 전체)", None if worst_s is None else round_usd(worst_s), "USD", "> $0",
                  None if worst_s is None else worst_s > 0, note="기상 +3h·ETA ±3h에서도 절감이 남는가"))
    dec = _decisions(audit)
    if dec:
        appr = [a for a in dec if a["decision"] == "APPROVE_OPTION"]
        over = [a for a in dec if a["decision"] == "REJECT" or (a["decision"] == "APPROVE_OPTION" and a.get("option_id") not in (None, "OPT1"))]
        k.append(_kpi("Agent", "acceptance_rate", "현업 Acceptance Rate", round(len(appr) / len(dec) * 100, 1), "%", "참고 — 파일럿에서 목표 합의",
                      True, note=f"데모 화면 결정 {len(dec)}건 — 현업 실측 아님"))
        k.append(_kpi("Agent", "override_rate", "Override Rate (반려·2순위 이하 선택)", round(len(over) / len(dec) * 100, 1), "%",
                      "참고 — 파일럿에서 목표 합의", True, note=f"데모 화면 결정 {len(dec)}건 — 현업 실측 아님"))
    else:
        k.append(_kpi("Agent", "acceptance_rate", "현업 Acceptance Rate", None, "%", "파일럿에서 측정", None, note="아직 사람 결정 기록 없음"))
        k.append(_kpi("Agent", "override_rate", "Override Rate (반려·2순위 이하 선택)", None, "%", "파일럿에서 측정", None, note="아직 사람 결정 기록 없음"))

    rows = shadow["rows"]
    agree = sum(1 for r in rows if r["agree"])
    delta = None if cur_usd is None or agt_usd is None else round_usd(cur_usd - agt_usd)
    gap = next((r["gap_usd"] for r in reversed(rows) if r.get("gap_usd") is not None), None)
    k.insert(next(i for i, x in enumerate(k) if x["key"] == "stability"),
             _kpi("Decision Quality", "best_gap", "1·2순위 후보 차이 (최근 결정)", gap, "USD", f"≥ {usd(GAP_CLEAR_USD)}이면 1순위가 뚜렷 [가정]",
                  None if gap is None else gap >= GAP_CLEAR_USD, note="차이가 작으면 사람 판단(협의 비용·위험) 비중이 커진다"))
    return {
        "kpis": k,
        "shadow": {"decision_points": rows, "agreement_rate": None if not rows else round(agree / len(rows), 3),
                   "cost_delta_usd": delta,
                   "note": ("현업 경로(기준 계획 유지)는 그대로 두고 같은 시점 에이전트 1순위 후보를 나란히 기록 — human_usd·agent_usd는 그 시점 정보로 본 "
                            "예상 체선료(가상). cost_delta_usd = 1순위 후보를 모두 승인했을 때 실제(가상) 체선료 차이. 일치 = 에이전트도 '변경 없음'.")},
        "pilot": PILOT, "governance": GOVERNANCE,
        "summary": {"ok": sum(1 for x in k if x["status"] == "OK"), "warn": sum(1 for x in k if x["status"] == "WARN"),
                    "na": sum(1 for x in k if x["status"] == "NA"), "groups": GROUPS},
        "basis_note": "VIRTUAL = 가상 사례 1주 · ASSUMED = 가정값 · NA = 아직 측정 불가. 목표값은 전부 [가정]이며 멘토·현업 합의 후 바꾼다.",
    }

