"""DISCOVERY — 로드맵 7개 Main Question · Coverage Map(A~T) · Phase(P0~P30) · Discovery Question Sheet · Evidence Chain.

질문표(data/discovery/questions.json)는 사용자 로드맵의 질문을 그대로 옮긴 것이다. `auto` 키가 있는 행은 진단·검증
결과(가상 시나리오)에서 숫자를 채워 VIRTUAL(가상 검증)로 올린다. CONFIRMED(현업 확인)는 엔진이 만들지 않는다 —
멘토 인터뷰·실데이터로만 바뀐다.

v3: 벤치마크(P18)·판단 로직(P11)·이해관계자·Process Map(P1)·해결안 비교(P19) 파일과 사례 복원(P12, engine/casestudy.py)·
도입 검증(P28·P30, engine/assurance.py)으로 답을 만든다. 문서·가정에서 온 답은 HYPOTHESIS, 계산한 답은 VIRTUAL.
"""
from __future__ import annotations

import copy
import json
import re
from functools import lru_cache

from . import business
from .diagnosis import POLICY_LABEL, as_fraction, policy_totals, usd
from .rules import DATA, param
from .timeutil import fmt_h, fmt_ts, ts

STATUS_LABELS = {"OPEN": "미확인", "HYPOTHESIS": "가설", "VIRTUAL": "가상 검증", "CONFIRMED": "확인"}
STATUSES = list(STATUS_LABELS)
# v3 시나리오(WP-M) focus 제약 → 질문표 제약 코드. focus가 없으면 제목 키워드로 찾는다.
FOCUS_CODE = {"TIDE_UKC": "TIDE", "TANK_ULLAGE": "TANK", "LINE_SHARED": "PIPELINE", "TUG_POOL": "TUG", "MOORING_MASTER": "TUG",
              "PRODUCT_CHANGEOVER": "CHANGEOVER", "PRODUCT_SAMPLING": "SAMPLING", "FOG_CLOSURE": "FOG", "VETTING": "VETTING", "WAVE_LIMIT": "WAVE"}
TITLE_CODE = {"TIDE": ("tide", "조석"), "TANK": ("tank", "탱크"), "PIPELINE": ("pipeline", "배관"), "TUG": ("tug", "예선", "도선"),
              "CHANGEOVER": ("changeover", "제품 전환"), "SAMPLING": ("sampling", "샘플"), "FOG": ("fog", "시정", "안개"),
              "VETTING": ("vetting", "검사"), "WAVE": ("wave", "swell", "파고", "너울")}
PHASE_CODES = {"P5": ("CHANGEOVER", "SAMPLING"), "P6": ("TANK",), "P7": ("PIPELINE",), "P8": ("TUG",), "P9": ("TIDE", "FOG", "WAVE"), "P10": ("VETTING",)}
CODE_LABEL = {"TIDE": "조석·UKC 창", "TANK": "탱크 공간", "PIPELINE": "공유 배관", "TUG": "예선·도선", "CHANGEOVER": "제품 전환",
              "SAMPLING": "샘플링", "FOG": "시정", "VETTING": "검사·승인", "WAVE": "파고"}
_CASE, _ASR = {}, {}


@lru_cache(maxsize=1)
def _framework():
    return json.loads((DATA / "discovery" / "framework.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _questions():
    return json.loads((DATA / "discovery" / "questions.json").read_text(encoding="utf-8"))["questions"]


@lru_cache(maxsize=None)
def _data(name):
    """v3 지식 파일(benchmark·decision_logic·stakeholders·solution_matrix·process_map). 없으면 빈 dict."""
    p = DATA / "discovery" / f"{name}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _vkey(val):
    v = val or {}
    return json.dumps([v.get("fingerprint"), v.get("computed_at"), v.get("decision_points"), policy_totals(val)], sort_keys=True, default=str)


def _case_for(val, world=None, agent=None):
    """체선료가 가장 큰 사례의 복원(P12). 엔진 쪽 오류는 질문표를 깨지 않게 빈 dict로."""
    key = _vkey(val)
    if key not in _CASE:
        try:
            from . import casestudy
            w, ag = (world, agent) if (world is not None and agent is not None) else casestudy.shared()
            idx = casestudy.index(w, None, ag)
            _CASE[key] = casestudy.run(w, w.base_history(), idx[0]["call_id"], ag, val) if idx else {}
        except Exception:  # noqa: BLE001
            _CASE[key] = {}
    return _CASE[key]


def _asr_for(val, world=None, agent=None):
    key = _vkey(val)
    if key not in _ASR:
        try:
            from . import assurance
            _ASR[key] = assurance.run(val, [], None, world=world, agent=agent)
        except Exception:  # noqa: BLE001
            _ASR[key] = {}
    return _ASR[key]


def _pct(x):
    return "—" if x is None else f"{x * 100:.0f}%"


def _signed(x):
    return "—" if x is None else ("−" if x < 0 else "+") + f"${abs(x):,.0f}"


class _Ctx:
    def __init__(self, diag, val, world=None, agent=None):
        self.world, self.agent = world, agent
        self.diag = diag or {}
        self.val = val or {}
        self.facts = self.diag.get("facts") or {}
        self.totals = policy_totals(val)
        self.labels = {p["id"]: p.get("label", p["id"]) for p in self.val.get("policies") or []}
        self.vas = {s["key"]: s for s in (self.diag.get("value_at_stake") or {}).get("steps", [])}
        self._biz = None
        self._sm = None

    def case(self):
        return _case_for(self.val if self.val else None, self.world, self.agent) or None

    def asr(self):
        return _asr_for(self.val if self.val else None, self.world, self.agent) or None

    def scen(self, code):
        """code(TIDE·TANK·…)를 구속하는 모델링된 시나리오 목록 — WP-M 시나리오가 없거나 모델 밖이면 []."""
        out = []
        for s in self.val.get("scenarios") or []:
            if not s.get("modeled"):
                continue
            focus = {FOCUS_CODE.get(f) for f in s.get("focus") or []}
            title = (s.get("title") or "").lower()
            if code in focus or (not s.get("focus") and any(k in title for k in TITLE_CODE.get(code, ()))):
                out.append(s)
        return out

    def solution(self):
        if self._sm is None:
            self._sm = _solution_matrix(self)
        return self._sm

    def kpi(self, key):
        for group in (self.diag.get("kpi") or {}).values():
            for k in group:
                if k["key"] == key:
                    return k
        return None

    def pareto(self, name):
        return (self.diag.get("pareto") or {}).get(name) or []

    def label(self, pid):
        return self.labels.get(pid) or POLICY_LABEL.get(pid, pid)

    def biz(self):
        if self._biz is None:
            self._biz = business.run({}, self.diag, self.val)
        return self._biz

    def replay(self, pid):
        return next((r for r in self.val.get("replay") or [] if r.get("policy") == pid), None)


def _fmt_kpi(k):
    v, u = k["value"], k["unit"]
    if u == "USD":
        s = usd(v)
    elif u == "h":
        s = fmt_h(v)
    elif u == "%":
        s = f"{v:.0f}%"
    elif u == "m/s":
        s = f"{v:.1f} m/s"
    else:
        s = f"{v:,.0f}{'' if u == 'count' else ' ' + u}"
    return s


def _pareto_text(rows, n=5, dur=False):
    out = []
    for r in rows[:n]:
        extra = f", {fmt_h(r['duration_h'])}" if dur else ""
        out.append(f"{r['label']} {usd(r['cost_usd'])}({r['share'] * 100:.0f}%{extra})")
    return " · ".join(out)


# ---------------------------------------------------------------- auto resolvers
def _resolve(key, c):
    """auto 키 → (answer, evidence, insight[, status[, source]]) 또는 None(데이터 없음). status 기본값 VIRTUAL."""
    if key.split(".", 1)[0] in V3_PREFIX:
        return _resolve_v3(key, c)
    f, d = c.facts, c.diag
    if key.startswith("kpi."):
        k = c.kpi(key[4:])
        return (f"{k['label']}: {_fmt_kpi(k)}", f"진단 KPI — {k['note']}", "가상 시나리오 1주 값 — 실제 1~2년치 실적으로 다시 계산") if k else None
    if key.startswith("pareto."):
        rows = c.pareto(key.split(".", 1)[1])
        if not rows:
            return None
        return (_pareto_text(rows, dur=key.endswith("by_cause")), "진단 Pareto (비용 순, 비례 배분)",
                f"최대 집중: {rows[0]['label']} {rows[0]['share'] * 100:.0f}%")
    roots = d.get("root_causes") or []
    ctrl = d.get("controllability") or []
    if key == "pareto_causes":
        rows = c.pareto("by_cause")
        return (_pareto_text([r for r in rows if r["cost_usd"] > 0], n=6), "진단 Pareto(원인별)", "원인 기여액을 비례 배분한 값") if rows else None
    if key == "pareto_frequency":
        rows = sorted(c.pareto("by_cause"), key=lambda r: -r["frequency"])
        return (f"{rows[0]['label']} — {rows[0]['frequency']}척", "진단 Pareto(원인별 빈도)", "빈도 1위와 비용 1위가 다를 수 있다") if rows else None
    if key == "pareto_duration":
        rows = sorted(c.pareto("by_cause"), key=lambda r: -r["duration_h"])
        return (f"{rows[0]['label']} — 합계 {fmt_h(rows[0]['duration_h'])}", "진단 Pareto(원인별 시간)", "") if rows else None
    if key == "pareto_cost":
        rows = c.pareto("by_cause")
        return (f"{rows[0]['label']} — {usd(rows[0]['cost_usd'])} ({rows[0]['share'] * 100:.0f}%)", "진단 Pareto(원인별 비용)", "") if rows else None
    if key in ("controllability_predictable", "ctrl.predictability"):
        if not ctrl:
            return None
        return (" · ".join(f"{x['label']} {x['scores']['predictability']}" for x in ctrl if x["cost_usd"] > 0 or x["key"] == "NOR_TIMING"),
                "통제가능성 표 Predictability (가정 점수)", "H=사전에 안다, M=예보 수준, L=거의 모름")
    if key == "ctrl.control":
        return (" · ".join(f"{x['label']} {x['scores']['control']}/{x['scores']['influence']}" for x in ctrl if x["cost_usd"] > 0),
                "통제가능성 표 Control/Influence (가정)", "Y/PARTIAL/N — 직접 통제/협의") if ctrl else None
    if key == "ctrl.scheduling_impact":
        return (" · ".join(f"{x['label']} {x['scores']['scheduling_impact']}" for x in ctrl if x["cost_usd"] > 0),
                "통제가능성 표 Scheduling Impact (가정)", "") if ctrl else None
    if key == "ctrl.cost_impact":
        cs = d.get("class_shares") or {}
        if not cs:
            return None
        return (" · ".join(f"{k} {usd(v['usd'])}({v['share'] * 100:.0f}%)" for k, v in cs.items()),
                "원인 비용을 A~D로 합산 (비례 배분·가정 점수)", "A 통제 가능 · B 예측 가능 제약 · C 불확실 · D 대응 불가")
    if key == "cascade":
        items = f.get("cascade") or []
        absorbed = f.get("absorbed") or []
        if not items and not absorbed:
            return None
        return ("예 — " + " / ".join(items[:2] + absorbed[:1]), "에이전트 영향 설명(앞 선박 이안 → 다음 선박 접안)",
                "앞 배 종료가 늦으면 뒷 배 접안이 밀리고, 야간 계류 금지가 지연을 키우거나 흡수한다")
    if key == "shore_rate":
        rows = f.get("shore_rate") or []
        if not rows:
            return None
        cost = next((r["cost_usd"] for r in c.pareto("by_cause") if r["key"] == "SHORE_RATE"), None)
        return ("가상 사례에서는 탱크가 접안을 막지는 않았지만, 육상 수용률 제한이 하역을 늘려 뒤 선박 대기로 전이됐다 — "
                + " · ".join(f"{r['vessel']} +{fmt_h(r['hours'])}" for r in rows if r["hours"] >= 1),
                f"진단: 원인 배분 {usd(cost)}" if cost is not None else "진단 체선사유(R04)", "TK-104 추가 배정 레버로 폭풍 전 하역 종료 — Tank를 결정변수(레버)로 포함할 근거")
    if key == "claims_variance":
        cl = f.get("claims")
        if not cl:
            return None
        return (f"가상 청구 {cl['count']}건 중 {cl['with_variance']}건에서 청구액 ≠ 재계산액, 차이 합 {usd(cl['variance_usd'])}",
                "클레임 검토(호스 분리 시각·반액 누락·이동 공제·펌핑 보증·NOR 유효성)", "실제 청구서 샘플로 같은 검증 필요")
    if key == "eta_revisions":
        ch = f.get("eta_changes") or []
        return (f"{f.get('calls', '?')}척 중 {f.get('eta_revised_calls', 0)}척이 {f.get('eta_updates', 0)}회 갱신"
                + (" — " + ", ".join(f"{x['vessel']} {x['first_eta'][5:].replace('T', ' ')} → {x['last_eta'][5:].replace('T', ' ')}" for x in ch) if ch else ""),
                "calls.json eta_updates (가상)", "가상 데이터는 갱신이 적다 — 실제 ETA 이력 필요")
    if key == "eta_error":
        k = c.kpi("eta_error_h")
        return (f"평균 {fmt_h(k['value'])} ({k['note']})", "최초 통지 ETA vs 실제 투묘 (가상)", "") if k else None
    if key == "compatibility":
        comp = f.get("compatibility") or []
        if not comp:
            return None
        by_type = {}
        for x in comp:
            by_type.setdefault(x["type"], set()).update(x["berths"])
        return (" · ".join(f"{t} → {', '.join(sorted(b)) or '없음'}" for t, b in by_type.items()),
                "선석 적합성(DWT·UKC·LOA·화물·SBM 하한)", "SBM 하한·UKC는 가정값")
    if key == "utilization_avg":
        k = c.kpi("utilization")
        return (f"사용 선석 평균 {k['value']:.0f}% ({k['note']})", "ALL_FAST→LAST_LINE ÷ 시나리오 기간", "") if k else None
    if key == "utilization_peak":
        u = d.get("utilization") or {}
        if not u:
            return None
        b = max(u, key=u.get)
        return (f"{b} {u[b] * 100:.0f}% (가상 1주)", "선석별 점유율", "SBM 1기에 VLCC·수에즈막스가 몰림")
    if key == "berth_free_wait":
        w = f.get("berth_free_wait")
        if not w:
            return None
        return (f"있음 — 선석이 비었는데 야간 {fmt_h(w['night_h'])}·강풍 {fmt_h(w['weather_h'])} 대기 (가상 1주)", "대기 사유 분류(NIGHT·WEATHER)",
                "체선료 쟁점(야간·기상 대기의 부담 주체)과도 직결")
    if key == "berth_free_wait_reason":
        return ("SBM 야간 계류 금지·SK3~8 대형선 주간 접안(공개 규정)과 접안 풍속 한계(가정) — 앞 배가 밤에 끝나면 다음 배는 아침까지 기다린다",
                "ULS-SBM-NIGHT · ULS-SK38-DAYTIME · ULS-WEATHER-LIMIT", "'주간' 정의(07:00~17:30)는 가정")
    if key == "forecast_lead":
        w = f.get("weather") or {}
        if w.get("lead_h") is None:
            return None
        return (f"폭풍 예보({w['latest']['id']})는 하역 중단 약 {w['lead_h']:.0f}시간 전에 발행됐고, 첫 예보({w['first']['id']})에는 없었다",
                "weather.json 예보 발행 이력 (가상)", "리드타임 안에 결정(탱크 레버)해야 효과가 있다")
    if key == "forecast_error":
        w = f.get("weather") or {}
        if not w:
            return None
        return (f"첫 예보 최대 {w['first']['max_abs_ms']} m/s 오차·18 m/s 이상 {w['first']['missed_ops_hours']}시간 놓침, "
                f"갱신 예보 최대 {w['latest']['max_abs_ms']} m/s·{w['latest']['missed_ops_hours']}시간 놓침", "예보 vs 관측 (폭풍 시간대, 가상)",
                "예보 꼬리 오차 1시간이 MUNSU PEARL 접안을 1시간 더 밀었다")
    if key == "weather_replans":
        ids = set(f.get("weather_items") or [])
        items = [x for x in f.get("impact_items") or [] if x["id"] in ids]
        if not items:
            return None
        return (" · ".join(f"{x['title']}" for x in items), "에이전트 영향 설명 항목(예보 트리거)", "예보 갱신 1회가 여러 선박 ETB를 동시에 바꾼다")
    if key == "case_vessels":
        vt = f.get("vessel_types") or {}
        return (f"{f.get('calls', '?')}척 ({', '.join(f'{k} {v}' for k, v in vt.items())}) — SK3B 정비로 SBM 1기 운영 [가상 사례]",
                "data/live/vessels.json·berths.json", "실제 사례 1~3건으로 교체할 자리") if vt else None
    if key == "case_plan":
        pv = f.get("plan_v1")
        return ("; ".join(f"{b}: {' → '.join(v)}" for b, v in pv.items()) + " [가상]", "SEAGATE Berthing Schedule v1 대역(plan.json)", "") if pv else None
    if key == "case_forecast":
        fc = f.get("forecasts")
        return (" → ".join(f"{x['id']}({x['issued_at'][5:].replace('T', ' ')}): {x['summary']}" for x in fc), "weather.json (가상)", "") if fc else None
    if key == "case_changes":
        ch = f.get("info_changes")
        return (" · ".join(f"{x['t'][5:].replace('T', ' ')} {x['label']}" for x in ch), "정보 이벤트(ETA·예보·부두제약, 가상)", "") if ch else None
    if key == "case_options":
        items = [x for x in f.get("impact_items") or [] if x["options"]]
        if not items:
            return None
        return (" · ".join(f"{x['id']}: " + "; ".join(f"{o['id']} {o['title']} {_signed(-o['saving_usd'])}" for o in x["options"]) for x in items),
                "에이전트 후보 비교(작업함)", "가상 사례에서 에이전트가 낸 선택지 — 실제 담당자 선택지와 비교 필요")
    if key == "case_missing_info":
        ch = f.get("info_changes") or []
        late = [x for x in ch if x["kind"] in ("FORECAST", "CONSTRAINT")]
        return ("T-72h 계획 때는 몰랐던 정보: " + " · ".join(f"{x['label']}({x['t'][5:].replace('T', ' ')} 발행)" for x in late),
                "정보 이벤트 발행 시각 (가상)", "Value of Information — 일찍 알았다면 무엇이 달라졌나") if late else None
    if key == "case_wait":
        k = c.kpi("anchorage_wait_h")
        return (f"묘박 대기 평균 {fmt_h(k['value'])} (기준 계획 그대로, 가상)", "진단 KPI", "") if k else None
    if key == "case_demurrage":
        k = c.kpi("total_usd")
        if not k:
            return None
        alt = c.totals.get("AGENT_HITL")
        return (f"{usd(k['value'])} (기준 계획 그대로)" + (f" — 에이전트 후보 승인 시 {usd(alt)}" if alt is not None else "") + " [가상]",
                "진단·검증 (truth 채점)", "")
    if key.startswith("root."):
        if not roots:
            return None
        top = roots[0]
        part = key.split(".", 1)[1]
        if part == "phenomenon":
            return (" · ".join(r["chain"][0]["text"] for r in roots[:3]), "근본원인 체인 level 0", "")
        if part == "direct":
            return (" · ".join(s["text"] for s in top["chain"] if s["level"] == 1), f"{top['vessel']} 체인 level 1", "")
        if part == "why":
            return (" · ".join(s["text"] for s in top["chain"] if s["level"] >= 2), f"{top['vessel']} 체인 level 2~3", "")
        if part == "structural":
            n_s = sum(1 for r in roots if r["structural"])
            return (f"체선 선박 {len(roots)}척 중 {n_s}척은 구조적(선석 점유·야간 제한·수용률), {len(roots) - n_s}척은 기상 등 일회성 주도",
                    "근본원인 분류", "구조적 원인은 반복된다 — 최적화·규칙 대상")
        if part == "predictable":
            return (" · ".join(f"{r['vessel']}: {r['predictable']}" for r in roots[:3]), "근본원인 분석", "")
        if part == "alternative":
            return (" · ".join(f"{r['vessel']}: {r['decision_alternative']}" for r in roots[:3]), "에이전트 후보와 연결", "")
        if part == "counterfactual":
            cur, best = c.totals.get("CURRENT_RULE"), min(c.totals.values()) if c.totals else None
            if cur is None:
                return None
            return (f"예 — 현업 Rule {usd(cur)} → 최선 정책 {usd(best)} ({_signed(best - cur)}), 당시 정보만으로", "Historical Replay (가상)", "")
        if part == "shift":
            r = c.replay("OPTIMIZER")
            if not r:
                return None
            left = [p for p in r.get("per_call", []) if p.get("amount_usd", 0) > 0]
            return ("일부 남음 — Optimizer 경로에서도 " + ", ".join(f"{p['vessel']} {usd(p['amount_usd'])}" for p in left)
                    + " 체선이 남는다(대기는 줄었지만 하역 속도·야간 제한이 남은 병목)", "Historical Replay 선박별 결과 (가상)",
                    "문제가 사라진 것인지 다른 병목으로 옮겨 간 것인지 선박별로 본다")
    if key.startswith("vas."):
        part = key.split(".", 1)[1]
        m = {"total": "TOTAL", "operational": "OPERATIONALLY_ADDRESSABLE", "scheduling": "SCHEDULING_ADDRESSABLE", "expected": "EXPECTED_SAVING"}
        if part in m:
            s = c.vas.get(m[part])
            if not s or s["usd"] is None:
                return None
            return (f"{s['label']}: {usd(s['usd'])}", f"Value at Stake — {s['note']}", "가상 시나리오·가정 분류 기반")
        if part == "external":
            cs = (d.get("class_shares") or {}).get("C")
            return (f"{usd(cs['usd'])} ({cs['share'] * 100:.0f}%) — 기상 하역 중단·접안 불가 등 통제 불가·불확실(C)", "통제가능성 분류", "") if cs else None
        if part == "optimizer":
            r = c.replay("OPTIMIZER")
            cur = c.totals.get("CURRENT_RULE")
            if not r or cur is None:
                return None
            return (f"{usd(cur - r['total_usd'])} — Optimizer가 다루는 결정(선석·순서·탱크 레버)으로 줄인 몫", "Historical Replay OPTIMIZER (가상)",
                    "탱크 재고·배관·조석은 아직 결정변수가 아니다")
    if key.startswith("replay."):
        part = key.split(".", 1)[1]
        if part == "known_info":
            txt = c.val.get("no_lookahead")
            return ("예 — " + txt, "validate.py KnownEnv", "") if txt else None
        if part == "no_lookahead":
            h = (c.val.get("hindsight") or {}).get("total_usd")
            best = min(c.totals.values()) if c.totals else None
            if best is None:
                return None
            dps = c.val.get("decision_points") or []
            gap = None if h is None else best - h
            return (f"결정 시점 {len(dps)}회({', '.join(x['trigger'] for x in dps)}) 모두 당시 발행 정보만 사용. 사후 최적(미래를 아는 하한) {usd(h)}"
                    + (f" — 차이 {usd(gap)}" if gap is not None else ""), "Historical Replay vs Hindsight (가상)",
                    "차이 = 정보 가치(Value of Information)의 상한")
        if part == "same_conditions":
            viol = sum(int(r.get("violations") or 0) for r in c.val.get("replay") or [])
            return (f"예 — 모든 정책을 같은 실제 세계(truth)로 채점, 제약 위반 {viol}건", "Historical Replay", "") if c.totals else None
        tot = c.totals.get(part)
        cur = c.totals.get("CURRENT_RULE")
        if tot is None:
            return None
        return (f"{c.label(part)} {usd(tot)}" + (f" — 현업 Rule 대비 {_signed(tot - cur)}" if cur is not None and part != "CURRENT_RULE" else ""),
                "Historical Replay (당시 정보만, 가상 1주)", "단일 가상 사례 — 정책 우열의 근거로는 부족")
    if key.startswith("sens."):
        s = c.val.get("sensitivity") or {}
        if not s:
            return None
        part = key.split(".", 1)[1]
        if part == "most_sensitive":
            return (s.get("most_sensitive", ""), f"민감도 ({s.get('at', '')} 결정 시점)", "")
        if part == "flips":
            fs = s.get("factors") or []
            flips = [f"{x['label']} {lv['label']}" for x in fs for lv in x.get("levels", []) if lv.get("flip")]
            return (f"{len(fs)}개 요인 중 {len({x['factor'] for x in fs if any(lv.get('flip') for lv in x.get('levels', []))})}개에서 최적안이 바뀜: "
                    + (", ".join(flips) or "없음"), "민감도 분석", "")
        if part == "keep":
            return (s.get("keep_plan_within", ""), "민감도 분석", "")
    if key.startswith("validation."):
        part = key.split(".", 1)[1]
        head = c.val.get("headline") or {}
        if part == "saving_pct":
            return (head.get("text"), "검증 headline", "") if head.get("text") else None
        if part == "violations":
            viol = sum(int(r.get("violations") or 0) for r in c.val.get("replay") or [])
            return (f"정책 경쟁 전체 제약 위반 {viol}건", "Historical Replay", "") if c.totals else None
        if part == "golden":
            g = f.get("golden")
            return (f"Golden Set TC-01~05 {g['passed']}/{g['total']}건 정답 일치", "tests/test_golden.py", "문서 04 예제 기준") if g else None
        if part == "compute_ms":
            ms = {r["policy"]: r.get("compute_ms") for r in c.val.get("replay") or [] if r.get("compute_ms") is not None}
            if not ms:
                return None
            return (" · ".join(f"{c.label(k)} {v:.0f}ms" for k, v in ms.items()) + f" (전체 검증 {c.val.get('runtime_s', '?')}s)",
                    "Historical Replay compute_ms", "소규모(6척) 완전 탐색 기준 — 실제 규모는 CP-SAT 등으로 교체")
    if key == "business.default":
        b = c.biz()
        return (f"연간 기대 절감 {usd(b['annual_saving_usd'])} · 1년차 순효과 {usd(b['net_benefit_usd'])} · ROI {_pct(b['roi'])} · "
                f"회수 {b['payback_months'] if b['payback_months'] is not None else '—'}개월", "비즈니스 케이스 기본 가정",
                "연간 척수·척당 체선료·비용이 전부 가정 — 멘토 확인 전에는 숫자보다 구조를 본다")
    return None


V3_PREFIX = {"bench", "cs", "asr", "sol", "dl", "pm", "sh", "scen"}


def _kpi_text(k):
    v, u = k["value"], k["unit"]
    if u == "USD":
        return usd(v)
    if u == "h":
        return fmt_h(v)
    if u == "%":
        return f"{v:.1f}%"
    if u == "ms":
        return f"{v:,.1f} ms"
    return f"{v:,.0f}"


def _one_line(text, n=170):
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _resolve_v3(key, c):
    """v3 지식 블록(벤치마크·사례 복원·도입 검증·해결안·판단 로직·Process Map·이해관계자·시나리오)에서 답을 만든다."""
    head, part = key.split(".", 1)
    if head == "bench":
        case = next((x for x in _data("benchmark").get("cases") or [] if x["id"] == part), None)
        if not case:
            return None
        src = "; ".join(f"{s['title']} — {s['url']}" for s in case.get("sources") or [])
        return (f"[{case['evidence']}·{case['verified_on']} 확인] {case['title']} ({case['organization']}, {case['country']}, {case['year']}) — "
                + _one_line(case["result"], 220), f"출처: {src}", _one_line(case["what_not_to_copy"], 200), "HYPOTHESIS",
                "data/discovery/benchmark.json")
    if head == "scen":
        hits = c.scen(part)
        if not hits:
            return None
        txt = []
        for s in hits:
            res = {x.get("policy"): x.get("total_usd") for x in s.get("results") or [] if isinstance(x, dict)}
            best = min((v for v in res.values() if v is not None), default=None)
            txt.append(f"시나리오 {s['id']} '{s['title']}': 현업 Rule {usd(res.get('CURRENT_RULE'))} → 최선 {usd(best)}")
        note = next((s.get("desc") for s in hits if s.get("desc")), "")
        return (f"[가상] {CODE_LABEL.get(part, part)} 제약을 시나리오에서 구속해 계산 — " + " / ".join(txt) + (f" · {_one_line(note, 140)}" if note else ""),
                f"검증 시나리오 {', '.join(s['id'] for s in hits)} (가상, 기본 시나리오에서는 비구속)", "제약 수치는 가정 — 실제 값은 현업 확인")
    if head == "cs":
        return _resolve_case(part, c)
    if head == "asr":
        return _resolve_asr(part, c)
    if head == "sol":
        return _resolve_solution(part, c)
    if head == "dl":
        return _resolve_logic(part, c)
    if head in ("pm", "sh"):
        return _resolve_process(head, part)
    return None


def _resolve_case(part, c):
    cs = c.case()
    if not cs:
        return None
    snaps = {s["key"]: s for s in cs["snapshots"]}
    res, vessel = cs["result"], cs["vessel"]
    dps = [d for d in cs["decision_points"] if len(d["options"]) > 1]
    pick = max(dps, key=lambda d: max(o["saving_usd"] for o in d["options"][1:]), default=None)
    ev = f"사례 복원 — {vessel} (known-at-t, 가상)"
    if part == "eta":
        s72, arr = snaps["T-72h"], snaps["ARRIVAL"]
        return (f"{vessel}: 72h 통지 ETA {fmt_ts(ts(s72['known']['eta']))} (통지 {fmt_ts(ts(s72['t']))}) → 실제 투묘 {fmt_ts(ts(arr['known']['ata']))}",
                ev + " · calls.json eta_updates", "ETA 갱신이 적은 가상 데이터 — 실제 통지 이력 필요")
    if part == "replanned":
        return (f"아니오 — 현업 Rule 경로는 계획 v1을 끝까지 유지 [가정]. 같은 기간 에이전트 후보가 있었던 결정 시점 {len(dps)}회"
                + (f"({', '.join(fmt_ts(ts(d['t'])) for d in dps)})" if dps else ""), ev + " · 결정 시점", "후보가 있었는데 계획이 그대로였다 = Shadow Mode 불일치")
    if part == "why":
        return ("[가정] 수정하지 않음 — 현업 Rule은 게시한 계획을 바꾸지 않는다고 가정(DL-03). 실제 이유는 스케줄러 인터뷰로 확인",
                "decision_logic DL-03 · 사례 복원", "", "HYPOTHESIS", "data/discovery/decision_logic.json")
    if part == "final_order":
        s = snaps["T-24h"]
        k = s["known"]
        if not k.get("berth_id"):
            return None
        return (f"{k['berth_id']}: {' → '.join(k['berth_queue'])} (T-24h {fmt_ts(ts(s['t']))}, 계획 v{k['plan_version']}) · {vessel} 접안 예상 {fmt_ts(ts(k['etb']))}",
                ev + " · T-24h", "")
    if part == "risks":
        s = snaps["T-24h"]
        return (" · ".join(s["risks"]), ev + " · T-24h 위험", "그 시점에 이미 보였던 위험만 — 폭풍은 아직 예보에 없었다")
    if part == "arrival_gap":
        T, ata = ts(cs["reference"]["T"]), ts(snaps["ARRIVAL"]["known"]["ata"])
        if not ata:
            return None
        return (f"최초 통지 ETA {fmt_ts(T)} vs 실제 투묘 {fmt_ts(ata)} — 차이 {fmt_h((ata - T).total_seconds() / 3600)}", ev, "")
    if part == "nor":
        nor = cs.get("nor") or {}
        if not nor.get("tendered"):
            return None
        return (f"NOR 제출 {fmt_ts(ts(nor['tendered']))} · 수령 {fmt_ts(ts(nor.get('received')))} · {'유효' if nor.get('valid') else '무효(재제출 필요)'} → "
                f"레이타임 개시 {fmt_ts(ts(nor.get('laytime_start')))}", ev + " · 계산서", "")
    if part == "why_wait":
        rows = res.get("wait_by_reason") or []
        if not rows:
            return None
        prev = next((r for k in ("DECISION", "ARRIVAL", "T-24h") for r in snaps[k]["risks"] if r.startswith("앞 선박")), None)
        return (f"대기 {fmt_h(res['wait_h'])} — " + " · ".join(f"{x['label']} {fmt_h(x['hours'])}" for x in rows)
                + (f". {prev}" if prev else ""), ev + " · 대기 사유", "")
    if part == "why_chosen" and pick:
        why = pick["why"].replace("[가정] ", "", 1)
        return (f"[가정] 계획 유지 — {why}", "사례 복원 결정 시점 (현업 선택은 가정)", "", "HYPOTHESIS", "engine/casestudy.py (현업 선택 [가정])")
    if part == "why_rejected" and pick:
        return (" / ".join(_one_line(x, 160) for x in pick["rejected_why"][:2]), f"사례 복원 {fmt_ts(ts(pick['t']))} 후보",
                "후보 실행에 필요한 협의(생산조정팀·대리점)가 실제 제외 이유일 수 있다 [추론]", "HYPOTHESIS", "engine/casestudy.py (현업 선택 [가정])")
    if part == "plan_vs_actual":
        return (res["plan_vs_actual"], ev + " · 계획 시점 예측 vs 실제", "")
    if part == "again":
        return (res["would_decide_again"], ev + " · 당시 정보만의 후보", "사후 정보 없이 판단 — Historical Replay와 같은 규칙")
    return None


def _resolve_asr(part, c):
    a = c.asr()
    if not a:
        return None
    gov = {g["question"]: g for g in a.get("governance") or []}
    gmap = {"gov.ops": "누가 운영하는가?", "gov.owner": "추천 결과의 책임은 누구에게 있는가?", "gov.model": "모델이 틀리면 어떻게 하는가?",
            "gov.data": "데이터가 틀리면 어떻게 하는가?"}
    if part in gmap and gmap[part] in gov:
        g = gov[gmap[part]]
        return (f"[{'추천' if g['basis'] == '가정' else '문서'}] {g['answer']}", f"도입 검증 거버넌스 ({g['basis']})", "", "HYPOTHESIS",
                "engine/assurance.py 거버넌스")
    if part in ("pilot", "integration"):
        stages = {p["stage"]: p for p in a.get("pilot") or []}
        sh = a.get("shadow") or {}
        rate = sh.get("agreement_rate")
        if part == "pilot":
            s = stages.get("Shadow Mode") or {}
            ans = (f"[추천] PoC(지금) → Shadow Mode {s.get('duration', '')}: {s.get('goal', '')} → Pilot(작업함 승인·반려) → 확대"
                   + (f". 가상 Shadow: 결정 시점 {len(sh.get('decision_points') or [])}회 일치율 {rate * 100:.0f}%, 1순위 후보 승인 시 {usd(sh.get('cost_delta_usd'))} 차이"
                      if rate is not None else ""))
        else:
            s, i = stages.get("Shadow Mode") or {}, stages.get("Integration") or {}
            ans = f"[추천] 처음에는 연결하지 않고 읽기 전용 — {s.get('entry', '')}. 통합은 Integration 단계: {i.get('goal', '')}"
        return (ans, "도입 검증 파일럿 단계 [가정] · Shadow Mode(가상)", "", "HYPOTHESIS", "engine/assurance.py 파일럿")
    k = next((x for x in a.get("kpis") or [] if x["key"] == part), None)
    if not k or k["status"] == "NA" or k["value"] is None:
        return None
    return (f"{k['label']}: {_kpi_text(k)} — 목표 {k['target']} → {k['status']}", f"도입 검증 KPI({k['group']}) — {k['note']}", "목표값은 [가정] — 멘토 합의 후 교체")


def _solution_matrix(c):
    sm = copy.deepcopy(_data("solution_matrix"))
    if not sm:
        return {}
    reps = {r.get("policy"): r for r in c.val.get("replay") or [] if isinstance(r, dict)}
    cur = c.totals.get("CURRENT_RULE")
    for o in sm.get("options") or []:
        o["total"] = sum(int(v["score"]) for v in o["scores"].values())
        cands = [p for p in o.get("policies") or [] if p in c.totals]
        if not cands:
            o["computed"] = {}
            continue
        pid = min(cands, key=lambda p: c.totals[p])
        r = reps.get(pid) or {}
        o["computed"] = {"policy": pid, "label": c.label(pid), "total_usd": c.totals[pid],
                         "saving_vs_current_usd": None if cur is None else round(cur - c.totals[pid], 2),
                         "plan_changes": r.get("plan_changes"), "violations": r.get("violations"), "compute_ms": r.get("compute_ms"),
                         "range_usd": [min(c.totals[p] for p in cands), max(c.totals[p] for p in cands)] if len(cands) > 1 else None,
                         "basis": "VIRTUAL"}
    opts = sm.get("options") or []
    if opts:
        top = max(opts, key=lambda o: (o["total"], o["id"]))
        comp = top.get("computed") or {}
        sm["recommendation"] = (f"[추천] Option {top['id']}({top['label']}) — 가정 점수 {top['total']}/{9 * 5}"
                                + (f", 가상 체선료 {usd(comp['total_usd'])}(현업 Rule 대비 {_signed(-comp['saving_vs_current_usd'])})"
                                   if comp.get("saving_vs_current_usd") is not None else "")
                                + ". 점수는 가정, 비용은 가상 1주 — 실제 사례 Replay·Shadow Mode로 다시 평가")
    return sm


def _resolve_solution(crit, c):
    sm = c.solution()
    opts = sm.get("options") or []
    if not opts or crit not in opts[0]["scores"]:
        return None
    e = next((o for o in opts if o["id"] == "E"), opts[-1])
    ans = f"[가정 점수 1~5] " + " · ".join(f"{o['id']} {o['scores'][crit]['score']}" for o in opts) + f" — E: {e['scores'][crit]['rationale']}"
    ev, status = "solution_matrix.json (가정 평가)", "HYPOTHESIS"
    comp = [(o["id"], o.get("computed") or {}) for o in opts]
    if crit == "cost_effect" and all(x.get("total_usd") is not None for _, x in comp):
        ev += " · 가상 체선료 " + " · ".join(f"{i} {usd(x['total_usd'])}" for i, x in comp)
        status = "VIRTUAL"
    elif crit == "safety" and all(x.get("violations") is not None for _, x in comp):
        ev += " · 제약 위반 " + " · ".join(f"{i} {x['violations']}건" for i, x in comp)
        status = "VIRTUAL"
    elif crit == "replan" and all(x.get("plan_changes") is not None for _, x in comp):
        ev += " · 계획 변경 " + " · ".join(f"{i} {x['plan_changes']}회" for i, x in comp)
        status = "VIRTUAL"
    return (ans, ev, "점수는 멘토 검토 전 가정", status, "data/discovery/solution_matrix.json")


def _resolve_logic(part, c):
    dl = _data("decision_logic")
    rules = {r["id"]: r for r in dl.get("rules") or []}
    if not rules:
        return None
    t = c.totals

    def rule(i):
        r = rules[i]
        return f"{i} {r['condition']} → {r['action']}"
    src = "data/discovery/decision_logic.json"
    vs = (lambda p: f" — 가상 검증: {c.label(p)} {usd(t[p])}" + (f"(현업 Rule {usd(t['CURRENT_RULE'])} 대비 {_signed(t[p] - t['CURRENT_RULE'])})" if "CURRENT_RULE" in t and p != "CURRENT_RULE" else "")
          if p in t else "")
    m = {
        "first_info": ("[가정] SEAGATE Berthing Schedule, 대리점 ETA·NOR 메일, 부두제약(정비), 기상 예보 — 프로토타입 작업함이 받는 정보 이벤트와 같은 목록", ""),
        "n_vessels": (f"[가정] 가상 사례는 1주 {c.facts.get('calls', '?')}척 — 실제 일 평균 입항·대기 척수는 확인 필요", ""),
        "two_waiting": ("[가정] ① 제원상 들어갈 수 있는 선석인가(" + rule("DL-04") + ") ② 통지 ETA 순(" + rule("DL-02") + ")", ""),
        "exclude": ("[가정] 제원상 불가 선석부터 뺀다(DL-04) — 에이전트 후보 카드도 같은 순서로 '제외 사유'(DWT·흘수+UKC·화물)를 보여 준다", ""),
        "eta_first": ("[가정] 같은 선석 안에서는 예(선착순, DL-02). 단 Hard 제약(DL-04~08)이 먼저", vs("FCFS")),
        "rate_first": ("[가정] 아니오로 가정 — 요율 우선(DL-09)은 비교용 규칙", vs("RATE")),
        "laytime_first": ("[가정] 확인 필요 — 체선 진입 시각 우선(DL-10)은 비교용 규칙", vs("LAYTIME_RISK")),
        "production": ("[가정] 생산계획은 생산조정팀 결정 — 에이전트는 탱크 추가 배정 같은 레버를 '요청 후보'로만 낸다(DL-17)", vs("OPTIMIZER")),
        "break_fcfs": ("[가정] 후보 조건: " + " · ".join(f"{i} {rules[i]['condition']}" for i in ("DL-09", "DL-10", "DL-11", "DL-12", "DL-13", "DL-14") if i in rules)
                       + " — 엔진에는 DL-09·10만 비교용으로 구현", ""),
        "change_plan": ("[가정] 현업 Rule은 바꾸지 않는다(DL-03). 재계획 규칙 후보: " + " · ".join(rules[i]["condition"] for i in ("DL-15", "DL-16", "DL-17") if i in rules), ""),
        "tradeoff": ("[가정] " + " / ".join(_tradeoffs(c)[:3]), ""),
    }
    if part not in m:
        return None
    ans, extra = m[part]
    return (ans + extra, "현업 판단 로직 규칙 표 [가정·문서]" + (" + 정책 경쟁(가상)" if extra else ""), "스케줄러 인터뷰로 확정할 가설", "HYPOTHESIS", src)


def _tradeoffs(c):
    t = c.totals
    out = list(_data("decision_logic").get("tradeoffs") or [])
    if {"CURRENT_RULE", "FCFS", "RATE"} <= set(t):
        out[0] = (f"선착순 공정성 vs 체선료 — 계획 유지(현업 Rule) {usd(t['CURRENT_RULE'])} · 재계획하는 FCFS {usd(t['FCFS'])} · "
                  f"요율 우선 {usd(t['RATE'])}({_signed(t['RATE'] - t['CURRENT_RULE'])}) (가상)")
    agent = c.replay("AGENT_HITL") or {}
    if agent.get("plan_changes") is not None and "AGENT_HITL" in t and "CURRENT_RULE" in t and len(out) > 1:
        out[1] = (f"계획 안정성 vs 비용 — 에이전트 경로는 계획 변경 {agent['plan_changes']}회로 {usd(t['CURRENT_RULE'] - t['AGENT_HITL'])} 절감, "
                  "변경마다 대리점·도선 재통지 (가상)")
    if {"LAYTIME_RISK", "OPTIMIZER"} <= set(t) and len(out) > 2:
        out[2] = f"레이타임 임박 우선 {usd(t['LAYTIME_RISK'])} vs 전체 최적 {usd(t['OPTIMIZER'])} — 임박 선박만 보면 다른 선박 체선이 커질 수 있다 (가상)"
    return out


def _resolve_process(head, part):
    if head == "pm":
        stages = _data("process_map").get("stages") or []
        if not stages or part not in stages[0]:
            return None
        pick = [s for s in stages if s.get(part) and s[part] != "—"]
        sample = " · ".join(f"{s['stage']}: {_one_line(s[part], 60)}" for s in pick[:5])
        return (f"[가정] Port Call {len(stages)}단계별 {part} 열(process_map) — 예: {sample}", "Process Map 20단계 × 9렌즈 [가정]",
                "단계마다 인터뷰·섀도잉으로 확인", "HYPOTHESIS", "data/discovery/process_map.json")
    sh = _data("stakeholders")
    people = sh.get("stakeholders") or []
    if not people:
        return None
    tasks = (sh.get("_meta") or {}).get("tasks") or []
    by_letter = lambda task, L: [p["name"] for p in people if p["raci"].get(task) == L]  # noqa: E731
    if part == "performers":
        ans = " · ".join(f"{t}: {', '.join(by_letter(t, 'R') or by_letter(t, 'A'))}" for t in tasks)
    elif part == "approvers":
        ans = " · ".join(f"{t}: {', '.join(by_letter(t, 'A')) or '미정'}" for t in tasks)
    elif part == "requesters":
        ans = "대리점(ETA·NOR·도선 주문) · 선장(NOR) · 제품 출하·영업(긴급 출하) · 선주(체선료 청구) · 생산조정팀(탱크 레버 협의)"
    elif part == "orgs":
        inner = [p["name"] for p in people if p["org"] == "내부"]
        outer = [p["name"] for p in people if p["org"] == "외부"]
        ans = f"내부 {len(inner)}곳({', '.join(inner)}) · 외부 {len(outer)}곳({', '.join(outer)})"
    elif part == "multi":
        busy = [(t, [p["name"] for p in people if t in p["raci"]]) for t in tasks]
        busy = [x for x in busy if len(x[1]) >= 4]
        ans = "예 — " + " · ".join(f"{t} {len(n)}곳" for t, n in busy)
    else:
        return None
    return (f"[가정] {ans}", "Stakeholder RACI [가정] (R 수행·A 최종 책임·C 협의·I 통보)", "업무 분장표·조직도로 확인", "HYPOTHESIS",
            "data/discovery/stakeholders.json")


def _fill_questions(c):
    rows = copy.deepcopy(_questions())
    scen = {s["title"]: s for s in c.val.get("scenarios") or []}
    for r in rows:
        if r.get("auto"):
            got = _resolve(r["auto"], c)
            if got:
                ans, ev, ins = got[:3]
                status = got[3] if len(got) > 3 else "VIRTUAL"
                r["status"], r["answer"], r["evidence"] = status, ans, ev
                r["insight"] = ins or r.get("insight", "")
                r["source"] = "prototype" if status == "VIRTUAL" else (got[4] if len(got) > 4 else "prototype")
            elif not r.get("insight"):
                r["insight"] = "검증·진단 결과 없음 — 자동 답변 대기"
        if r["phase"] == "P23":
            m = re.search(r"'(.+?)'", r["question"])
            s = scen.get(m.group(1)) if m else None
            if s:
                if s.get("modeled"):
                    res = {x["policy"]: x.get("total_usd") for x in s.get("results", [])}
                    best = min((v for v in res.values() if v is not None), default=None)
                    r.update(status="VIRTUAL", source="prototype",
                             answer=f"현업 Rule {usd(res.get('CURRENT_RULE'))} → 최선 {usd(best)} · FCFS {usd(res.get('FCFS'))}",
                             evidence=f"시나리오 {s['id']} (가상)", insight=s.get("note", ""))
                else:
                    r["insight"] = s.get("note", "모델 밖")
    return rows


def _coverage(rows):
    out = []
    for cov in _framework()["coverage"]:
        mine = [r for r in rows if r["domain"] == cov["id"]]
        by = {s: sum(1 for r in mine if r["status"] == s) for s in STATUSES}
        out.append(dict(cov, total=len(mine), by_status=by))
    return out


def _phases(rows, c=None):
    out = []
    for ph in _framework()["phases"]:
        mine = [r for r in rows if r["phase"] == ph["id"]]
        row = dict(ph, total=len(mine), by_status={s: sum(1 for r in mine if r["status"] == s) for s in STATUSES})
        codes = PHASE_CODES.get(ph["id"])
        hits = sorted({s["id"] for code in codes for s in c.scen(code)}) if (codes and c is not None) else []
        if hits:  # v3 제약을 시나리오에서 구속해 계산했다 — 기본 시나리오는 비구속이므로 PARTIAL까지만 올린다
            proto = dict(ph["prototype"])
            if proto["status"] == "NONE":
                proto["status"] = "PARTIAL"
            proto["where"] = f"{proto['where']} · 검증 탭 시나리오 {', '.join(hits)} · 자원·제약 탭"
            proto["note"] = (f"{proto['note']} — {'·'.join(CODE_LABEL[x] for x in codes)} 제약은 시나리오 {', '.join(hits)}에서 구속해 계산"
                             "(가상, 기본 시나리오는 비구속)")
            row["prototype"] = proto
        out.append(row)
    return out


# ---------------------------------------------------------------- 7 Main Questions · Evidence Chain
def _main_and_chains(c):
    d, f = c.diag, c.facts
    total = (c.vas.get("TOTAL") or {}).get("usd")
    by_berth, by_cause = c.pareto("by_berth"), [r for r in c.pareto("by_cause") if r["cost_usd"] > 0]
    roots = d.get("root_causes") or []
    cs = d.get("class_shares") or {}
    cur, best_pid = c.totals.get("CURRENT_RULE"), (min(c.totals, key=c.totals.get) if c.totals else None)
    best = c.totals.get(best_pid) if best_pid else None
    hind = (c.val.get("hindsight") or {}).get("total_usd")
    b = c.biz()
    wf = f.get("weather") or {}
    answers, chains = {}, []

    if total is not None and by_berth and by_cause:
        a1 = (f"가상 1주(SBM 1기·폭풍) 실제 체선료 {usd(total)}. 선석은 {by_berth[0]['label']} {usd(by_berth[0]['cost_usd'])}"
              f"({by_berth[0]['share'] * 100:.0f}%), 원인은 {by_cause[0]['label']} {by_cause[0]['share'] * 100:.0f}%"
              + (f"·{by_cause[1]['label']} {by_cause[1]['share'] * 100:.0f}%" if len(by_cause) > 1 else ""))
        answers["Q1"] = ("VIRTUAL", a1, ["EC-01"])
        chains.append({"id": "EC-01", "main_question": "Q1", "question": "체선료는 정확히 어디에서 발생하는가?", "evidence": a1,
                       "insight": "SBM(VLCC·수에즈막스 전용)이 병목 — SBM이 1기만 운영되면 대형선이 한 선석에 줄을 서고 비용이 거기 몰린다",
                       "decision": "SBM 배정·정비 일정과 선석 간 재배정을 Scope에 넣는다",
                       "requirement": "부두제약관리(정비) 이벤트 수신, 선석 이동 후보의 체선료 비교", "basis": "VIRTUAL",
                       "link": {"tab": "diagnosis", "anchor": "pareto"}})
    if roots:
        top = roots[0]
        a2 = " → ".join(s["text"] for s in top["chain"] if s["level"] <= 2)[:300]
        answers["Q2"] = ("VIRTUAL", f"{top['vessel']}: {a2}", ["EC-02"])
        chains.append({"id": "EC-02", "main_question": "Q2", "question": "왜 기다렸는가?", "evidence": f"{top['vessel']}: {a2}",
                       "insight": "앞 선박 종료 지연(폭풍 중단·육상 수용률)이 다음 선박 접안으로 연쇄되고, 야간 계류 금지가 지연을 키우거나 흡수한다",
                       "decision": "선석만이 아니라 하역 속도(탱크)와 기상까지 한 모델에서 본다",
                       "requirement": "앞 선박 종료 예측(ETC) + 주간 창 + 기상 예보를 함께 쓰는 재계산", "basis": "VIRTUAL",
                       "link": {"tab": "diagnosis", "anchor": "root"}})
    if cs:
        a3 = (f"A 통제 가능 {cs['A']['share'] * 100:.0f}% · B 예측 가능 제약 {cs['B']['share'] * 100:.0f}% · "
              f"C 불확실 {cs['C']['share'] * 100:.0f}% · D 대응 불가 {cs['D']['share'] * 100:.0f}% (가정 점수·비례 배분)")
        answers["Q3"] = ("VIRTUAL", a3, ["EC-03"])
        chains.append({"id": "EC-03", "main_question": "Q3", "question": "그중 통제·대응할 수 있는 것은?", "evidence": a3,
                       "insight": "가상 사례 비용의 대부분이 선석 점유·탱크 수용률(A)과 야간 규정(B)에서 나온다",
                       "decision": "MVP 결정변수 = 선석·순서·탱크 레버(A), Hard Constraint = 주간·정비·풍속(B·C)",
                       "requirement": "통제가능성 점수를 현업 인터뷰로 검증", "basis": "VIRTUAL", "link": {"tab": "diagnosis", "anchor": "controllability"}})
    if cur is not None and best is not None:
        r = c.replay(best_pid) or {}
        dec = [x["summary"] for x in r.get("decisions", []) if x.get("summary") and x["summary"] != "변경 없음"]
        a4 = (f"{c.label(best_pid)}: {usd(cur)} → {usd(best)} ({_signed(best - cur)}) — 바꾼 결정: " + ("; ".join(dec) or "없음"))
        answers["Q4"] = ("VIRTUAL", a4, ["EC-04"])
        chains.append({"id": "EC-04", "main_question": "Q4", "question": "어떤 의사결정을 바꾸면 비용을 줄일 수 있는가?", "evidence": a4,
                       "insight": "폭풍 전에 하역을 끝내는 탱크 레버와 SBM 재배정이 가장 큰 레버다(가상)",
                       "decision": "Decision Model = 선석·순서 + 운영 레버(탱크 추가 배정)", "requirement": "레버 목록(생산조정팀)과 승인 워크플로",
                       "basis": "VIRTUAL", "link": {"tab": "validation", "anchor": "replay"}})
    if best is not None:
        voi = None if hind is None else best - hind
        a5 = (f"당시 정보로 최선 {usd(best)} vs 미래를 아는 사후 최적 {usd(hind)} → 정보 가치 {usd(voi)}. "
              f"폭풍 예보 리드타임 약 {wf.get('lead_h', 0) or 0:.0f}h. 필요 데이터: 계약 조건(SEAGATE에 없음)·예보·부두제약·탱크 가용")
        answers["Q5"] = ("VIRTUAL", a5, ["EC-05"])
        chains.append({"id": "EC-05", "main_question": "Q5", "question": "더 좋은 판단을 위해 어떤 정보가 필요한가?", "evidence": a5,
                       "insight": ("이 사례에서는 예보 갱신 직후 재계산해 사후 최적에 도달했다 — 정보가 '언제' 오는지가 핵심" if voi is not None and voi < 1
                                   else "예보·부두제약이 늦게 오면 최적화해도 손실이 남는다"),
                       "decision": "예보 발행·부두제약 변경·ETA 갱신을 재계산 Trigger로", "requirement": "KMA API·부두제약관리 이벤트·대리점 ETA 통지 수신",
                       "basis": "VIRTUAL", "link": {"tab": "validation", "anchor": "hindsight"}})
    if c.totals:
        a6 = " · ".join(f"{c.label(p)} {usd(v)}" for p, v in sorted(c.totals.items(), key=lambda kv: kv[1]))
        answers["Q6"] = ("VIRTUAL", a6 + " (가상 1주)", ["EC-06"])
        chains.append({"id": "EC-06", "main_question": "Q6", "question": "어떤 방식으로 해결하는 것이 가장 적절한가?", "evidence": a6,
                       "insight": "단순 우선순위 규칙은 줄이는 폭이 작거나(요율 우선은 오히려 증가) 들쭉날쭉 — 최적화+사람 승인이 가장 낮다(가상)",
                       "decision": "Option E(Optimization + Agent) 가설 유지, 실제 Replay로 검증", "requirement": "실제 사례 1~3건의 결정 시점별 정보",
                       "basis": "VIRTUAL", "link": {"tab": "validation", "anchor": "baselines"}})
    presets = {p["id"]: p["params"] for p in b["presets"]}
    cons = business.run(presets["conservative"], d, c.val)
    scen = business.run(presets["scenario"], d, c.val)
    payback = f"회수 {cons['payback_months']}개월" if cons.get("payback_months") is not None else "회수 불가"
    a7 = (f"보수 가정(운영 개선 50%·절감률 10%·에이전트 8%·채택 50%)이면 연간 기대 절감 {usd(cons['annual_saving_usd'])}"
          f"(1년차 ROI {_pct(cons['roi'])}, {payback}). 가상 1주의 절감률을 연간에 그대로 쓰면 {usd(scen['annual_saving_usd'])}"
          f"(ROI {_pct(scen['roi'])}) — 상한성 추정. 연간 척수·척당 체선료·비용 모두 가정")
    answers["Q7"] = ("VIRTUAL", a7, ["EC-07"])
    chains.append({"id": "EC-07", "main_question": "Q7", "question": "실제로 얼마의 효과가 있는가?", "evidence": a7,
                   "insight": "결과가 연간 척수·척당 체선료 가정에 거의 비례 — 실제 연간 체선료 규모 확인이 먼저", "decision": "멘토 인터뷰 1순위: 연간 체선료·척수",
                   "requirement": "1~2년치 체선료 정산 데이터", "basis": "VIRTUAL", "link": {"tab": "business", "anchor": "steps"}})
    chains += [
        {"id": "EC-D1", "main_question": "Q4", "question": "NOR는 언제 유효하고 레이타임은 언제 시작하는가?",
         "evidence": "Asbatankvoy cl.6: NOR 수령+6h 또는 접안 완료 중 먼저. 도착 전 NOR은 무효(The Mexico I) — docs/domain/05 §2, 07 §2 [원문 대조 전]",
         "insight": "NOR 시점 하나가 청구액을 $0~$3,792로 바꾼다(문서 04 예제 5)", "decision": "NOR 수신 즉시 AIS 도착 대조·'validity reserved' 회신을 에이전트 기능으로",
         "requirement": "AIS 투묘 시각, NOR 수신 시각, 대리점 수령 문구", "basis": "DOC", "link": {"tab": "inbox", "anchor": "NOR"}},
        {"id": "EC-D2", "main_question": "Q6", "question": "SEAGATE에 이미 있는 것은 무엇인가?",
         "evidence": "로그인 메뉴: Berth Optimization·Berthing Simulation·체선 리포트 4종·Demurrage 요약 — docs/seagate-diagnosis.md §1-2",
         "insight": "대시보드·솔버를 새로 만들면 겹친다", "decision": "기록(시간)과 계약(돈) 사이의 판단 지원에 집중, Optimizer는 비교·설명·검증용으로",
         "requirement": "SEAGATE 내보내기(Berthing Schedule·ETB Change Log·Cargo Working) 어댑터", "basis": "DOC", "link": {"tab": "guide", "anchor": ""}},
    ]
    chains += _v3_chains(c, answers)
    return answers, chains


def _v3_chains(c, answers):
    """v3 Evidence Chain — P18 벤치마크·P12 사례 복원·P11 판단 로직·P19 해결안·P28/P30 도입 검증. 답이 있는 Main Question에만 근거로 붙인다."""
    out = []
    cases = _data("benchmark").get("cases") or []
    if cases:
        out.append({"id": "EC-08", "main_question": "Q6", "question": "다른 터미널은 같은 문제를 어떻게 풀었는가? (P18)",
                    "evidence": f"공개 사례 {len(cases)}건 — " + " · ".join(f"{x['id']} {x['title'].split(' — ')[0]}" for x in cases),
                    "insight": "대부분 '최적화(MILP·휴리스틱) + 사람이 규칙·확정을 관리' 구조. 업체 발표 % 수치(A·F)는 독립 검증이 없고, 목적함수는 체선료가 아니라 체류·대기시간이 많다",
                    "decision": "Option E(최적화 + 에이전트 + 사람 승인) 가설 유지 — 효과는 Shadow Mode로만 주장",
                    "requirement": "울산 제품·선석·배관 매핑, 계약의 Virtual Arrival·JIT 조항 유무, 터미널 안전 규칙 목록", "basis": "DOC",
                    "link": {"tab": "benchmark", "anchor": ""}})
    cs = c.case()
    if cs:
        dps = [d for d in cs["decision_points"] if len(d["options"]) > 1]
        best = max((o["saving_usd"] for d in dps for o in d["options"][1:]), default=0.0)
        out.append({"id": "EC-09", "main_question": "Q4", "question": "실제 어려웠던 하루에 무엇을 결정할 수 있었는가? (P12)",
                    "evidence": f"{cs['vessel']}: 결정 시점 {len(cs['decision_points'])}회 중 에이전트 후보 {len(dps)}회, 그때 정보만으로 최대 {usd(best)} 절감 후보 — "
                                f"{cs['result']['plan_vs_actual']}",
                    "insight": next((x for x in cs["lessons"] if x.startswith("[추론] 결정 창")), cs["lessons"][0] if cs["lessons"] else "—"),
                    "decision": "예보 갱신·부두제약 해제를 재계산 Trigger로 두고(P25), 결정 시점마다 후보와 현업 선택을 기록",
                    "requirement": "실제 사례 1~3건의 T-72h~Result 기록(ETB Change Log·메일·SOF)", "basis": "VIRTUAL",
                    "link": {"tab": "casestudy", "anchor": cs["call_id"]}})
    dl = _data("decision_logic")
    if dl.get("rules"):
        rs = dl["rules"]
        own = [r["id"] for r in rs if "CURRENT_RULE" in r["used_by_policy"] and r["priority"] > 1]
        hard = [r["id"] for r in rs if r["priority"] == 1]
        out.append({"id": "EC-10", "main_question": "Q4", "question": "현업은 지금 어떤 규칙으로 순서를 정하는가? (P11)",
                    "evidence": f"규칙 {len(rs)}개(가정 {sum(r['source'] == '가정' for r in rs)} · 문서 {sum(r['source'] == '문서' for r in rs)}) — "
                                f"가정한 현업 Rule = {', '.join(own)} + 모든 정책 공통 Hard 제약 {', '.join(hard)} · 엔진에 없는 예외: "
                                + ", ".join(r["id"] for r in rs if not r["used_by_policy"]),
                    "insight": _tradeoffs(c)[0], "decision": "인터뷰로 FCFS를 깨는 조건(DL-09~14)을 확정해 Rule 후보·Optimizer 목적함수·설명 문구에 반영",
                    "requirement": "스케줄러 인터뷰·섀도잉(질문 DQ-212~229)", "basis": "DOC", "link": {"tab": "validation", "anchor": "decision_logic"}})
    sm = c.solution()
    if sm.get("options"):
        opts = sm["options"]
        costs = [f"{o['id']} {usd(o['computed']['total_usd'])}" for o in opts if (o.get("computed") or {}).get("total_usd") is not None]
        out.append({"id": "EC-11", "main_question": "Q6", "question": "Agent가 정말 최선인가? — Option A~E 비교 (P19)",
                    "evidence": "가정 점수(45점 만점) " + " · ".join(f"{o['id']} {o['total']}" for o in opts) + (" · 가상 체선료 " + " · ".join(costs) if costs else ""),
                    "insight": "비용은 C·D·E가 같고(가상), 차이는 설명·Workflow·재계획 — 에이전트 층이 더하는 값은 '같은 최적안을 현업이 쓰게 만드는 것'",
                    "decision": sm.get("recommendation", ""), "requirement": "멘토 평가로 점수 교체, 실제 사례 Replay로 비용 재계산",
                    "basis": "VIRTUAL" if costs else "DOC", "link": {"tab": "validation", "anchor": "solution_matrix"}})
    a = c.asr()
    if a:
        s, sh = a["summary"], a["shadow"]
        rate = sh.get("agreement_rate")
        out.append({"id": "EC-12", "main_question": "Q7", "question": "도입하면 무엇으로 효과를 증명하는가? (P28·P30)",
                    "evidence": f"KPI {len(a['kpis'])}개(OK {s['ok']}·WARN {s['warn']}·측정 불가 {s['na']}) · Shadow: 결정 시점 {len(sh['decision_points'])}회"
                                + (f" 일치율 {rate * 100:.0f}%" if rate is not None else "") + f", 1순위 후보 승인 시 {usd(sh.get('cost_delta_usd'))} 차이 (가상)",
                    "insight": "Acceptance·Override Rate와 실제 절감은 파일럿에서만 잴 수 있다 — 가상 숫자로 연간 효과를 주장하지 않는다",
                    "decision": "다음 단계 = Shadow Mode 4~8주(읽기 전용 연동), 통과 기준을 미리 합의", "requirement": "SEAGATE 내보내기 읽기 전용, 감사 로그, 목표값 합의",
                    "basis": "VIRTUAL", "link": {"tab": "assurance", "anchor": ""}})
    links = {"Q4": ["EC-09", "EC-10"], "Q6": ["EC-08", "EC-11"], "Q7": ["EC-12"], "Q5": ["EC-09"]}
    have = {e["id"] for e in out}
    for q, ids in links.items():
        if q in answers and answers[q][0] != "OPEN":
            st, ans, ev = answers[q]
            answers[q] = (st, ans, ev + [i for i in ids if i in have and i not in ev])
    return out


def _hypotheses(c):
    d, f = c.diag, c.facts
    shore = next((r for r in c.pareto("by_cause") if r["key"] == "SHORE_RATE"), None)
    night = next((r for r in c.pareto("by_cause") if r["key"] == "WAIT:NIGHT"), None)
    fcfs, cur, opt = c.totals.get("FCFS"), c.totals.get("CURRENT_RULE"), c.totals.get("OPTIMIZER")
    hs = [
        {"id": "H1", "statement": "기록은 하지만 행동으로 이어지지 않는다 — 체선사유가 사후 리포트로만 쓰인다", "test": "체선사유는 누가 언제 입력하고 무엇을 결정하는가(진단 §7 Q2)",
         "status": "HYPOTHESIS", "source": "docs/seagate-diagnosis.md §3 H1", "evidence": "Report 메뉴에 체선 리포트 4종 존재(사이트맵)"},
        {"id": "H2", "statement": "기능이 화면별로 쪼개져 있다 — 재고예측·스케줄·Demurrage가 다른 메뉴", "test": "ETB 변경 1건 처리에 몇 화면을 오가는가(진단 §7 Q4)",
         "status": "HYPOTHESIS", "source": "docs/seagate-diagnosis.md §3 H2", "evidence": "사이트맵 메뉴 구조"},
        {"id": "H3", "statement": "입력이 비정형이다 — NOR·SOF·ETA가 메일·PDF·VHF로 들어온다", "test": "NOR·SOF 경로와 SEAGATE 대조 여부(진단 §7 Q5)",
         "status": "HYPOTHESIS", "source": "docs/seagate-diagnosis.md §3 H3", "evidence": "업계 일반"},
        {"id": "H4", "statement": "체선 '시간'과 체선'료' 사이에 간극이 있다", "test": "Demurrage 요약은 시간인가 금액·클레임인가(진단 §7 Q1)",
         "status": "HYPOTHESIS", "source": "docs/seagate-diagnosis.md §3 H4", "evidence": "계약 조건은 SEAGATE에 없음(입력 명세)"},
        {"id": "H5", "statement": "최적화 기능이 있어도 설명·조율은 사람 몫이다", "test": "Berth Optimization 실사용 여부(진단 §7 Q3)",
         "status": "HYPOTHESIS", "source": "docs/seagate-diagnosis.md §3 H5", "evidence": "Vopak 친저우 사례(업체 발표)"},
        {"id": "H6", "statement": "Tank(육상 수용률) 때문에 하역이 길어져 다음 선박이 기다린다", "test": "Tank Log·하역 속도 기록으로 대기 원인 분해",
         "status": "VIRTUAL" if shore else "OPEN", "source": "로드맵 Phase 6·31 예시",
         "evidence": (f"가상: 원인 배분 {usd(shore['cost_usd'])}({shore['share'] * 100:.0f}%), 합계 {fmt_h(shore['duration_h'])}" if shore else "")},
        {"id": "H7", "statement": "ETA 오차가 커서 정적 스케줄의 신뢰도가 낮다", "test": "24h 전 ETA vs ATA 오차 분포",
         "status": "OPEN", "source": "로드맵 Phase 3·31 예시",
         "evidence": f"가상 데이터는 ETA 갱신 {f.get('eta_updates', 0)}건뿐 — 실제 ETA 이력 없이는 판단 불가"},
        {"id": "H8", "statement": "SBM 야간 계류 금지가 체선을 키운다(또는 지연을 흡수한다)", "test": "야간 대기 시간과 체선 돌입 시각 비교",
         "status": "VIRTUAL" if night else "OPEN", "source": "Entry Guide 규정 + 로드맵 Phase 4",
         "evidence": (f"가상: 야간 대기 원인 배분 {usd(night['cost_usd'])}, 지연 흡수 사례 {len(f.get('absorbed') or [])}건" if night else "")},
        {"id": "H9", "statement": "기상 악화 시 앞 선박 종료 지연이 다음 선박 접안을 연쇄로 민다", "test": "기상 중단 사례의 후속 선박 ETB 변화",
         "status": "VIRTUAL" if f.get("cascade") else "OPEN", "source": "로드맵 Phase 15 예시",
         "evidence": " / ".join((f.get("cascade") or [])[:1])},
        {"id": "H10", "statement": "선착순(FCFS)만으로는 고요율·임박 선박을 놓친다", "test": "정책 경쟁(FCFS vs Optimizer)",
         "status": "VIRTUAL" if (fcfs is not None and opt is not None) else "OPEN", "source": "로드맵 Phase 21",
         "evidence": (f"가상: 현업 Rule {usd(cur)} · FCFS {usd(fcfs)} · Optimizer {usd(opt)}" if fcfs is not None and opt is not None else "")},
    ]
    sh = (c.asr() or {}).get("shadow") or {}
    rate = sh.get("agreement_rate")
    hs += [
        {"id": "H11", "statement": "도착 시각을 조정(JIT)하면 묘박 대기를 줄일 수 있지만, 항해용선 만선 항해는 계약(due despatch·체선료)이 장벽이다",
         "test": "울산 입항선의 계약 형태(항해·기간용선, Virtual Arrival 조항) 비중", "status": "HYPOTHESIS",
         "source": "Case F — IMO GIA JIT Arrival Guide(MEPC 75/INF.22) · 카르타헤나 HADES", "evidence": "공개 문서 [사실] — 울산 계약 비중은 미확인"},
        {"id": "H12", "statement": "현업 Rule(계획 유지)은 예보·부두제약 변경 같은 결정 기회를 놓친다",
         "test": "Shadow Mode — 결정 시점마다 에이전트 1순위 후보와 현업 결정을 나란히 기록",
         "status": "VIRTUAL" if rate is not None and rate < 1 else "OPEN", "source": "로드맵 Phase 30 · engine/assurance.py",
         "evidence": (f"가상 Shadow: 결정 시점 {len(sh.get('decision_points') or [])}회 일치율 {rate * 100:.0f}%, 1순위 후보 승인 시 {usd(sh.get('cost_delta_usd'))} 차이"
                      if rate is not None else "")},
    ]
    return hs


def _triggers():
    etb_min, etb_usd = param("ENG-ETB-CHANGE", "etb_minutes"), param("ENG-ETB-CHANGE", "usd")
    from .agent import OPTIONS_TRIGGER_USD  # 에이전트의 실제 값과 맞춘다
    return [
        {"trigger": f"ETB {etb_min}분 이상 또는 노출 ${etb_usd:,} 이상 변동", "detector": "에이전트(정보 이벤트마다 재예측 후 비교)",
         "data": "ETA 갱신·SOF 이벤트·예보로 다시 계산한 ETB·체선료", "action": "AUTO_RECALC", "threshold": f"{etb_min}분 / ${etb_usd:,}", "implemented": True,
         "rule": "ENG-ETB-CHANGE"},
        {"trigger": "기상 예보 갱신(Weather Warning)", "detector": "KMA 예보 발행", "data": "weather.json forecasts", "action": "AUTO_RECALC",
         "threshold": "발행 시 항상 + 후보 탐색", "implemented": True, "rule": "ULS-WEATHER-LIMIT"},
        {"trigger": "부두제약 변경(Berth Closure·정비 일정)", "detector": "SEAGATE 부두제약관리", "data": "berths.json constraint_updates", "action": "AUTO_RECALC",
         "threshold": "변경 시 항상 + 후보 탐색", "implemented": True, "rule": "BERTH-OOS"},
        {"trigger": f"체선료 노출 ${OPTIONS_TRIGGER_USD:,} 이상 증가", "detector": "에이전트", "data": "재계산한 총 노출", "action": "AUTO_RECALC",
         "threshold": f"${OPTIONS_TRIGGER_USD:,}", "implemented": True, "rule": "ENG-ETB-CHANGE"},
        {"trigger": "후보(옵션) 적용", "detector": "담당자", "data": "작업함 결정", "action": "APPROVAL", "threshold": "사람 승인 후에만 계획 버전 추가",
         "implemented": True, "rule": "ENG-DISPUTE-NO-AUTO"},
        {"trigger": "NOR 수신", "detector": "에이전트", "data": "NOR 시각 + AIS 투묘", "action": "AUTO_RECALC", "threshold": "수신 시 항상(회신은 승인 후 발송)",
         "implemented": True, "rule": "LAW-NOR-ARRIVAL"},
        {"trigger": "Tank Availability 변경", "detector": "생산조정팀·원유재고예측", "data": "탱크 가용·수용률 변경 이벤트", "action": "AUTO_RECALC",
         "threshold": "미정", "implemented": False, "rule": "PLAN-PUMP-RATE"},
        {"trigger": "Pipeline Failure", "detector": "설비 알람", "data": "배관·펌프 상태", "action": "APPROVAL", "threshold": "미정", "implemented": False, "rule": None},
        {"trigger": "Emergency Priority(긴급 출하)", "detector": "생산·영업", "data": "우선순위 요청", "action": "APPROVAL", "threshold": "미정", "implemented": False, "rule": None},
        {"trigger": "Operation Delay > X시간", "detector": "터미널 하역 기록", "data": "실적 vs 예측 하역 속도", "action": "AUTO_RECALC",
         "threshold": "부분 — SOF가 예측과 달라 ETB가 30분 이상 바뀌면 영향 항목 생성", "implemented": False, "rule": "ENG-ETB-CHANGE"},
    ]


def _story(c):
    fw = _framework()
    by_cause = [r for r in c.pareto("by_cause") if r["cost_usd"] > 0]
    op = (c.vas.get("OPERATIONALLY_ADDRESSABLE") or {}).get("usd")
    head = c.val.get("headline") or {}
    frac = as_fraction(head.get("saving_pct"))
    presets = {p["id"]: p["params"] for p in c.biz()["presets"]}
    cons = business.run(presets["conservative"], c.diag, c.val)
    b = business.run(presets["scenario"], c.diag, c.val)
    cases = _data("benchmark").get("cases") or []
    fill = {"benchmark": (f"공개 사례 {len(cases)}건(P18: Vopak 친저우·SAQR·앤트워프 탱크 터미널 등, 업체 발표 수치는 독립 검증 없음)" if cases else "○○"),
            "top_causes": ", ".join(r["label"] for r in by_cause[:3]) or "○○",
            "operational_usd": f"{usd(op)}(가상 1주)" if op is not None else "○○",
            "constraints": "선석 적합성·주간 계류·풍속·정비·탱크 수용률",
            "saving_pct": f"{frac * 100:.0f}%(가상 1주)" if frac is not None else "○○%",
            "annual_saving": (f"보수 가정 {usd(cons['annual_saving_usd'])} ~ 가상 비율 그대로 {usd(b['annual_saving_usd'])}"
                              f"(약 {cons['krw']['annual_saving'] / 1e8:.1f}~{b['krw']['annual_saving'] / 1e8:.1f}억 원, 전부 가정)")}
    return [line.format(**fill) for line in fw["story_template"]]


def run(diag_base=None, validation=None, world=None, agent=None):
    """world·agent를 주면 사례 복원·Shadow Mode가 그 에이전트 타임라인을 같이 쓴다(없으면 기준 데이터로 한 벌 만든다)."""
    c = _Ctx(diag_base, validation, world, agent)
    fw = _framework()
    rows = _fill_questions(c)
    answers, chains = _main_and_chains(c)
    mq = []
    for q in fw["main_questions"]:
        st, ans, ev = answers.get(q["id"], ("OPEN", "", []))
        mq.append(dict(q, status=st, answer=ans, evidence=ev))
    return {
        "goal": fw["goal"], "goal_result": fw["goal_result"], "principles": fw["principles"],
        "main_questions": mq, "coverage": _coverage(rows), "phases": _phases(rows, c), "questions": rows,
        "evidence_chains": chains, "hypotheses": _hypotheses(c), "triggers": _triggers(), "status_labels": STATUS_LABELS,
        "summary": {"questions": len(rows), "by_status": {s: sum(1 for r in rows if r["status"] == s) for s in STATUSES},
                    "need_mentor": sum(1 for r in rows if r.get("need_mentor") and r["status"] in ("OPEN", "HYPOTHESIS"))},
        "story": _story(c), "flow": fw["flow"], "variable_gate": fw["variable_gate"], "process_stages": fw["process_stages"],
        "process_lenses": fw["process_lenses"], "controllability_classes": fw["controllability_classes"],
        "benchmark_cases": fw["benchmark_cases"], "benchmark_template": fw["benchmark_template"], "solution_options": fw["solution_options"],
        "pilot_stages": fw["pilot_stages"], "core_questions": fw["core_questions"], "deliverables": fw["deliverables"],
        "validation_available": bool(c.totals),
        "notes": ["VIRTUAL = 가상 시나리오로 계산한 값 — 실제 울산 CLX 사실이 아니다.", "HYPOTHESIS = 문서·공개자료 기반 추정(출처 열 참고).",
                  "CONFIRMED는 현업 확인 후에만 쓴다."],
        **_knowledge(c),
    }


def _knowledge(c):
    """v3 지식 블록 — 파일 내용 + 검증 결과로 계산한 값(computed). 파일이 없으면 빈 블록."""
    bm = _data("benchmark")
    dl = copy.deepcopy(_data("decision_logic"))
    reps = {r.get("policy"): r for r in c.val.get("replay") or [] if isinstance(r, dict)}
    for r in dl.get("rules") or []:
        if r["priority"] == 1:
            r["computed"] = ({"violations": sum(int((reps.get(p) or {}).get("violations") or 0) for p in r["used_by_policy"] if p in reps)}
                             if reps else {})
        else:
            r["computed"] = {p: c.totals[p] for p in r["used_by_policy"] if p in c.totals}
    if dl:
        dl["tradeoffs"] = _tradeoffs(c)
        dl["implemented_in_current_rule"] = [r["id"] for r in dl.get("rules") or [] if "CURRENT_RULE" in r["used_by_policy"]]
    sh = copy.deepcopy(_data("stakeholders"))
    tasks = (sh.get("_meta") or {}).get("tasks") or []
    people = sh.get("stakeholders") or []
    pm = _data("process_map")
    stages = copy.deepcopy(pm.get("stages") or [])
    return {
        "benchmark": copy.deepcopy(bm.get("cases") or []),
        "benchmark_meta": copy.deepcopy(bm.get("_meta") or {}),
        "decision_logic": dl,
        "stakeholders": people,
        "stakeholder_tasks": [{"task": t, "accountable": [p["name"] for p in people if p["raci"].get(t) == "A"],
                               "responsible": [p["name"] for p in people if p["raci"].get(t) == "R"]} for t in tasks],
        "solution_matrix": c.solution(),
        "process_map": stages,
        "process_map_meta": {"lenses": _framework()["process_lenses"], "stages": len(stages),
                             "by_status": {s: sum(1 for x in stages if x["status"] == s) for s in STATUSES},
                             "note": (pm.get("_meta") or {}).get("note", "")},
    }
