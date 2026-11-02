"""AGENT — 정보 이벤트(SOF·ETA·예보·부두제약·계획 변경)가 들어올 때마다 다시 계산하고,
사람이 판단할 작업(작업함 항목)과 알림을 만든다.

에이전트는 계획을 직접 바꾸지 않는다. 변경안의 체선료 영향을 계산해 제안하고(EXPLAIN·SCHED),
승인은 사람이 한다(HITL). 승인된 옵션은 데모에서 'SEAGATE 반영'을 흉내 내 새 계획 버전이 된다.
"""
from __future__ import annotations

import copy
import itertools
import json
from collections import OrderedDict
from datetime import timedelta

from . import clock, drafts, reasons, rules, sim
from .intake import EVENT_LABEL
from .timeutil import fmt_h, fmt_ts, hours, iso, round_usd, ts
from .world import KnownEnv, ROLE_LABEL, first_pins

ITEM_USD = rules.param("ENG-ETB-CHANGE", "usd")
ETB_MIN = rules.param("ENG-ETB-CHANGE", "etb_minutes")
OPTIONS_TRIGGER_USD = 20000
OPTION_MIN_SAVING = 10000
TIME_RULES = ["ULS-WEATHER-LIMIT", "BERTH-OOS", "PLAN-TURNOVER", "PLAN-DURATIONS"]
COMPAT_RULES = ["ULS-DWT-MAX", "ULS-DRAFT-UKC", "ULS-LOA-MAX", "ULS-CARGO-TYPE"]


def _usd(x):
    return f"${abs(x):,.0f}"


def _signed(x):
    return ("+" if x >= 0 else "−") + _usd(x)


def _dmin(a, b):
    if a is None or b is None:
        return 0
    return int(round(hours(a, b) * 60))


class StressEnv:
    """t 시점의 예측 환경에 스트레스를 건다(미도착 선박 ETA 이동, 강풍 구간 연장). 과거 관측은 건드리지 않는다."""

    def __init__(self, base, now, eta_shift_h=0, storm_extend_h=0):
        self.base, self.now, self.dh, self.ext = base, now, eta_shift_h, storm_extend_h
        self.forecast = base.forecast

    def eta(self, cid):
        return self.base.eta(cid) + timedelta(hours=self.dh)

    def wind(self, h):
        w = self.base.wind(h)
        if h <= self.now:
            return w
        for k in range(1, self.ext + 1):
            w = max(w, self.base.wind(h - timedelta(hours=k)))
        return w

    def oos(self, bid):
        return self.base.oos(bid)


class Agent:
    VIEW_CACHE = 400

    def __init__(self, world):
        self.w = world
        self._views, self._timelines, self._truth_eval = OrderedDict(), {}, {}

    # ---------- 캐시된 뷰 ----------
    def prefix(self, history, t):
        pre = [h for h in history if ts(h["effective_from"]) <= t]
        return pre or history[:1]

    @staticmethod
    def key(history):
        return json.dumps(history, sort_keys=True, ensure_ascii=False)

    def view(self, history, t, before_plan_change=False):
        """before_plan_change=True면 시점 t에 발효되는 계획 버전을 빼고 본다(승인 직전 상태)."""
        t = ts(t)
        pre = self.prefix(history, t)
        if before_plan_change:
            pre = [h for h in pre if ts(h["effective_from"]) < t] or history[:1]
        k = (self.key(pre), iso(t))
        if k in self._views:
            self._views.move_to_end(k)
        else:
            self._views[k] = self.w.view(pre, t, alternatives=False)
            while len(self._views) > self.VIEW_CACHE:
                self._views.popitem(last=False)
        return self._views[k]

    def truth_eval(self, history):
        k = self.key(history)
        if k not in self._truth_eval:
            self._truth_eval[k] = self.w.evaluate(self.w.truth(history), self.w.t_end, alternatives=False)
        return self._truth_eval[k]

    def name(self, cid):
        return self.w.vessel_of(cid)["name"]

    def summarize(self, v):
        out = {}
        for cid, c in v["calls"].items():
            st, r = c["statement"], c["sim"]
            wait = {}
            for wr in r["wait_reasons"]:
                wait[wr["reason"]] = wait.get(wr["reason"], 0.0) + hours(wr["from"], wr["to"])
            out[cid] = {"berth": r["berth_id"], "seq": r["seq"], "etb": r["etb"], "etc": r["etc"], "etd": r["etd"],
                        "anchored": r["anchored"], "amount": st.get("amount_usd", 0.0), "dem_h": st.get("demurrage_h", 0.0),
                        "margin": st.get("margin_h", 0.0), "start": ts(st.get("laytime_start")), "expiry": ts(st.get("laytime_expiry")),
                        "status": c["status"], "codes": {i["code"] for i in st.get("issues", [])},
                        "stop_h": sum(hours(a, b) for a, b in r["stops"]), "wait": wait, "berth_free": r["berth_free_from"]}
        return out

    # ---------- 타임라인 ----------
    def timeline(self, history):
        k = self.key(history)
        if k in self._timelines:
            return self._timelines[k]
        infos = self.w.info_events(history)
        times = sorted({e["t"] for e in infos})
        items, alerts, trend = [], [], []
        prev, prev_total, low_seen = None, 0.0, set()
        for tau in times:
            here = [e for e in infos if e["t"] == tau]
            kinds = {e["kind"] for e in here}
            plan_change = "PLAN" in kinds
            here = [e for e in here if e["kind"] != "PLAN"]
            kinds.discard("PLAN")
            v = self.view(history, tau, before_plan_change=plan_change)
            s = self.summarize(v)
            total = round_usd(sum(x["amount"] for x in s.values()))
            for e in here:
                if e["kind"] == "SOF" and e["type"] in ("NOR_TENDERED", "NOR_RETENDERED"):
                    items.append(self.nor_item(history, e["call_id"], tau, v, retender=e["type"] == "NOR_RETENDERED"))
                elif e["kind"] == "SOF" and e["type"] == "DOCS_ON_BOARD":
                    items.append(self.statement_item(history, e["call_id"], tau))
            if prev is None:
                items.append(self.baseline_item(history, tau, v, s, total))
            elif here:
                changes = self.diff(prev, s)
                with_options = bool(kinds & {"FORECAST", "CONSTRAINT"}) or abs(total - prev_total) >= OPTIONS_TRIGGER_USD
                if changes or with_options:
                    item = self.impact_item(history, tau, here, v, prev, s, changes, prev_total, total, with_options)
                    if item:
                        items.append(item)
            if plan_change:
                v2 = self.view(history, tau)
                s2 = self.summarize(v2)
                total2 = round_usd(sum(x["amount"] for x in s2.values()))
                items.append(self.plan_item(tau, v2, s, s2, total, total2))
                v, s, total = v2, s2, total2
            trend.append({"t": iso(tau), "total": total, "plan_version": v["plan"]["version"]})
            for cid, x in s.items():
                if "LOW_MARGIN" in x["codes"] and cid not in low_seen and x["status"] not in ("COMPLETED", "SAILED"):
                    low_seen.add(cid)
                    alerts.append({"at": iso(tau), "level": "warning", "call_id": cid, "rules": ["ENG-LOW-MARGIN"],
                                   "text": f"{self.name(cid)} 레이타임 여유 {fmt_h(x['margin'])} 예상 — 추가 지연은 곧바로 체선료"})
            if plan_change:
                alerts.append({"at": iso(tau), "level": "info", "rules": [], "text": f"계획 v{v['plan']['version']} 반영 — {v['plan']['label']}"})
            prev, prev_total = s, total
        alerts += self.fact_alerts(history)
        alerts.sort(key=lambda a: a["at"])
        items.sort(key=lambda i: i["created_at"])
        out = {"items": items, "by_id": {i["id"]: i for i in items}, "alerts": alerts, "trend": trend}
        self._timelines[k] = out
        return out

    def fact_alerts(self, history):
        out = []
        label = {"ANCHORED": "묘박지 투묘", "ALL_FAST": "접안 완료", "OPS_STOPPED": "하역 중단(기상)", "OPS_RESUMED": "하역 재개",
                 "HOSES_DISCONNECTED": "호스 분리(하역 종료)", "LAST_LINE": "이안"}
        for cid, c in self.truth_eval(history).items():
            for e in c["events"]:
                if e["type"] in label:
                    out.append({"at": iso(e["ts"]), "level": "warning" if e["type"] == "OPS_STOPPED" else "info", "call_id": cid,
                                "rules": ["ULS-WEATHER-LIMIT"] if e["type"] == "OPS_STOPPED" else [],
                                "text": f"{self.name(cid)} {label[e['type']]}"})
            st = c["statement"]
            if st["status"] != "OK":
                continue
            out.append({"at": st["laytime_start"], "level": "info", "call_id": cid, "rules": st["start_rules"],
                        "text": f"{self.name(cid)} 레이타임 개시"})
            if st["demurrage_start"]:
                out.append({"at": st["demurrage_start"], "level": "critical", "call_id": cid, "rules": ["ASB-08-RATE-PRORATA"],
                            "text": f"{self.name(cid)} 체선 돌입 — 시간당 {_usd(st['rate_usd_day'] / 24)}"})
        return [a for a in out if self.w.t0 <= ts(a["at"]) <= self.w.t_end]

    # ---------- 변경 감지와 설명 ----------
    def diff(self, a, b):
        out = []
        for cid, y in b.items():
            x = a[cid]
            d_etb, d_etc, d_start = _dmin(x["etb"], y["etb"]), _dmin(x["etc"], y["etc"]), _dmin(x["start"], y["start"])
            d_amt = y["amount"] - x["amount"]
            new_low = "LOW_MARGIN" in y["codes"] and "LOW_MARGIN" not in x["codes"]
            moved = (x["berth"], x["seq"]) != (y["berth"], y["seq"])
            if abs(d_etb) >= ETB_MIN or abs(d_amt) >= ITEM_USD or abs(d_start) >= ETB_MIN or new_low or moved or abs(d_etc) >= 60:
                out.append(self.change_row(cid, x, y, a, b, d_etb, d_amt, new_low, moved))
        return out

    def change_row(self, cid, x, y, a, b, d_etb, d_amt, new_low, moved):
        parts = []
        if moved:
            parts.append(f"선석 {x['berth']} #{x['seq']} → {y['berth']} #{y['seq']}")
        if y["anchored"] and x["anchored"] and abs(_dmin(x["anchored"], y["anchored"])) >= 30:
            parts.append(f"도착 {fmt_ts(x['anchored'])} → {fmt_ts(y['anchored'])}")
        if abs(y["stop_h"] - x["stop_h"]) >= 0.5:
            parts.append(f"기상 하역 중단 {fmt_h(x['stop_h'])} → {fmt_h(y['stop_h'])}")
        if abs(_dmin(x["start"], y["start"])) >= 30:
            parts.append(f"레이타임 개시 {fmt_ts(x['start'])} → {fmt_ts(y['start'])}")
        if abs(d_etb) >= ETB_MIN:
            why = []
            if abs(_dmin(x["berth_free"], y["berth_free"])) >= 30 and not moved:
                why.append(f"앞 선박 이안 {fmt_ts(x['berth_free'])} → {fmt_ts(y['berth_free'])}")
            for reason, label in (("WEATHER", "강풍 접안 불가"), ("NIGHT", "야간 계류·접안 제한"), ("OOS", "선석 정비")):
                dh = y["wait"].get(reason, 0.0) - x["wait"].get(reason, 0.0)
                if abs(dh) >= 0.5:
                    why.append(f"{label} {'+' if dh > 0 else '−'}{fmt_h(abs(dh))}")
            parts.append(f"접안 {fmt_ts(x['etb'])} → {fmt_ts(y['etb'])} ({'+' if d_etb > 0 else '−'}{fmt_h(abs(d_etb) / 60)})" + (f" — {', '.join(why)}" if why else ""))
        if abs(_dmin(x["etc"], y["etc"])) >= 30:
            parts.append(f"하역 종료 {fmt_ts(x['etc'])} → {fmt_ts(y['etc'])}")
        money = f"체선 {fmt_h(x['dem_h'])} → {fmt_h(y['dem_h'])} · {_signed(d_amt)}"
        if new_low:
            money += f" · 레이타임 여유 {fmt_h(y['margin'])}(경고)"
        call = self.w.calls[cid]
        return {"call_id": cid, "vessel": self.name(cid), "agent": call.get("agent"),
                "berth_before": x["berth"], "berth_after": y["berth"], "seq_before": x["seq"], "seq_after": y["seq"],
                "etb_before": iso(x["etb"]), "etb_after": iso(y["etb"]), "etb_delta_min": d_etb,
                "etc_before": iso(x["etc"]), "etc_after": iso(y["etc"]),
                "amount_before": round_usd(x["amount"]), "amount_after": round_usd(y["amount"]), "delta_usd": round_usd(d_amt),
                "dem_before_h": x["dem_h"], "dem_after_h": y["dem_h"], "margin_after_h": y["margin"],
                "text": f"{self.name(cid)} ({y['berth']} #{y['seq']}): " + " · ".join(parts + [money])}

    def absorbed(self, a, b, changes):
        changed = {c["call_id"] for c in changes}
        out = []
        for cid, y in b.items():
            if cid in changed:
                continue
            x = a[cid]
            if abs(_dmin(x["berth_free"], y["berth_free"])) >= 60 and _dmin(x["etb"], y["etb"]) == 0 and y["wait"].get("NIGHT", 0) > 0:
                out.append({"call_id": cid, "vessel": self.name(cid),
                            "text": f"{self.name(cid)}: 앞 선박 이안이 {fmt_ts(x['berth_free'])} → {fmt_ts(y['berth_free'])}로 바뀌었지만 "
                                    f"야간 계류 금지 때문에 접안 {fmt_ts(y['etb'])} 그대로 — 지연이 흡수됨"})
        return out

    @staticmethod
    def trigger_list(here, name):
        out = []
        for e in here:
            if e["kind"] == "SOF":
                out.append({"kind": "SOF", "label": f"SOF: {name(e['call_id'])} {EVENT_LABEL.get(e['type'], e['type'])}"})
            elif e["kind"] == "ETA":
                out.append({"kind": "ETA", "label": f"{name(e['call_id'])} {e['label']}"})
            else:
                out.append({"kind": e["kind"], "label": e["label"]})
        return out

    def impact_item(self, history, tau, here, v, prev, s, changes, prev_total, total, with_options):
        delta = round_usd(total - prev_total)
        trig = self.trigger_list(here, self.name)
        kinds = {e["kind"] for e in here}
        opts = self.options(history, tau, v, s) if with_options else None
        best = opts["best"][0]["saving_usd"] if opts and opts["best"] else 0.0
        if not changes and best < OPTION_MIN_SAVING:
            return None
        main = next((t["label"] for t in trig if t["kind"] in ("FORECAST", "CONSTRAINT", "ETA")), trig[0]["label"] if trig else "정보 갱신")
        if changes and abs(delta) >= 1:
            title = f"{main} → 체선료 노출 {_signed(delta)}"
        elif changes:
            c0 = min(changes, key=lambda c: c["margin_after_h"] if c["dem_after_h"] <= 0 else 99)
            title = f"{main} → 금액 변동 없음 · {c0['vessel']} 레이타임 여유 {fmt_h(c0['margin_after_h'])}"
        else:
            title = f"{main} → 대안 {_signed(-best)} 가능"
        sev = "high" if abs(delta) >= OPTIONS_TRIGGER_USD or best >= OPTIONS_TRIGGER_USD else ("medium" if abs(delta) >= ITEM_USD or best else "low")
        narrative = [c["text"] for c in changes]
        absorbed = self.absorbed(prev, s, changes)
        narrative += [x["text"] for x in absorbed]
        if opts and opts["best"]:
            o = opts["best"][0]
            narrative.append(f"검토 옵션 {opts['evaluated']}개 중 최선: {o['title']} → {_signed(-o['saving_usd'])} (근거: {', '.join(o['rules_checked'][:4])} 등)")
        item_drafts = []
        if opts and opts["best"]:
            for lv in opts["best"][0]["levers"]:
                detail = [f"{p['vessel']}: {_usd(p['before'])} → {_usd(p['after'])}" for p in opts["best"][0]["per_call"] if abs(p["delta"]) >= 1]
                item_drafts.append(drafts.memo_lever(lv, opts["best"][0]["saving_usd"], detail))
        return {"id": f"IMP-{tau:%m%d-%H%M}", "kind": "IMPACT", "created_at": iso(tau), "title": title,
                "summary": (changes[0]["text"] if changes else narrative[-1]) if (changes or narrative) else "",
                "severity": sev, "call_ids": [c["call_id"] for c in changes], "trigger": trig,
                "needs_decision": bool(opts and opts["best"]) or sev == "high",
                "actions": ["ACK", "APPROVE_OPTION", "REJECT"] if opts and opts["best"] else ["ACK", "REJECT"],
                "total_before": prev_total, "total_after": total, "delta_usd": delta,
                "changes": changes, "absorbed": absorbed, "narrative": narrative, "options": opts, "drafts": item_drafts}

    def plan_item(self, tau, v_after, s_before, s_after, total_before, total_after):
        """승인된 옵션이 계획 버전으로 반영된 결과. 같은 시각의 다른 정보와 섞지 않고 '계획만의 효과'를 보여 준다."""
        changes = self.diff(s_before, s_after)
        delta = round_usd(total_after - total_before)
        plan = v_after["plan"]
        item_drafts = []
        n = drafts.etb_notice(changes, plan["label"])
        if n:
            item_drafts.append(n)
        narrative = [c["text"] for c in changes] + [x["text"] for x in self.absorbed(s_before, s_after, changes)]
        return {"id": f"PLN-{tau:%m%d-%H%M}", "kind": "PLAN_APPLIED", "created_at": iso(tau),
                "title": f"계획 v{plan['version']} 반영 — {plan['label']} → 체선료 노출 {_signed(delta)}",
                "summary": changes[0]["text"] if changes else "예측 변화 없음",
                "severity": "medium", "call_ids": [c["call_id"] for c in changes],
                "trigger": [{"kind": "PLAN", "label": plan["source"]}], "needs_decision": False, "actions": ["ACK"],
                "total_before": total_before, "total_after": total_after, "delta_usd": delta,
                "changes": changes, "absorbed": [], "narrative": narrative, "options": None, "drafts": item_drafts}

    # ---------- 기준 계획 점검 ----------
    def baseline_item(self, history, tau, v, s, total):
        opts = self.options(history, tau, v, s)
        exposure = []
        for cid, x in sorted(s.items(), key=lambda kv: -kv[1]["amount"]):
            top = max(x["wait"].items(), key=lambda kv: kv[1])[0] if x["wait"] else None
            exposure.append({"call_id": cid, "vessel": self.name(cid), "berth_id": x["berth"], "amount_usd": round_usd(x["amount"]),
                             "demurrage_h": x["dem_h"], "top_reason": {"CONGESTION": "선석 점유", "NIGHT": "야간 계류 제한", "WEATHER": "기상", "OOS": "선석 정비"}.get(top, "—")})
        rec, item_drafts = self.binding_constraint(tau, exposure, opts)
        if opts["best"]:
            rec = {"text": f"절감 옵션 {len(opts['best'])}개 — 최선: {opts['best'][0]['title']} ({_signed(-opts['best'][0]['saving_usd'])})", "rules": opts["best"][0]["rules_checked"]}
        return {"id": f"BASE-{tau:%m%d-%H%M}", "kind": "BASELINE", "created_at": iso(tau),
                "title": f"기준 계획 체선료 노출 {_usd(total)} — 최대 {exposure[0]['vessel']} {_usd(exposure[0]['amount_usd'])}",
                "summary": rec["text"], "severity": "high" if total >= OPTIONS_TRIGGER_USD else "medium",
                "call_ids": [e["call_id"] for e in exposure if e["amount_usd"] > 0],
                "trigger": [{"kind": "INIT", "label": "SEAGATE Berthing Schedule v1 수신"}],
                "needs_decision": True, "actions": ["ACK", "SEND"] if item_drafts else ["ACK"],
                "exposure": exposure, "total_usd": total, "options": opts, "recommendation": rec, "drafts": item_drafts}

    def binding_constraint(self, tau, exposure, opts):
        """최대 노출 선박이 왜 다른 선석으로 못 가는지 — 제원 불가와 정비 중 선석을 구분해 문의할 곳을 찾는다."""
        if not exposure or exposure[0]["amount_usd"] <= 0:
            return {"text": "체선료 노출 없음", "rules": []}, []
        cid = exposure[0]["call_id"]
        vessel, call = self.w.vessel_of(cid), self.w.calls[cid]
        env = KnownEnv(self.w, tau)
        blocked = [x for x in opts["excluded"] if x["call_id"] == cid]
        for bid, berth in self.w.berths.items():
            ok, _ = sim.compatibility(berth, vessel, call)
            windows = env.oos(bid)
            if ok and windows and ts(windows[-1]["to"]) > tau:
                w = windows[-1]
                win = f"~{fmt_ts(ts(w['to']))}"
                why = "; ".join(f"{x['berth_id']} {x['msg']}" for x in blocked)
                text = (f"{vessel['name']} 노출 {_usd(exposure[0]['amount_usd'])}: 배정 가능 선석 중 {berth['id']}가 정비 중({win}). "
                        f"다른 선석은 제원상 불가({why}). 정비 일정 조기화 여부 확인 권고")
                return {"text": text, "rules": ["BERTH-OOS"] + sorted({r for x in blocked for r in x["rules"]})}, [
                    drafts.memo_oos(berth, vessel["name"], exposure[0]["amount_usd"], win)]
        return {"text": f"검토한 옵션 {opts['evaluated']}개 중 {_usd(OPTION_MIN_SAVING)} 이상 절감안 없음", "rules": []}, []

    # ---------- 옵션 (작은 후보 집합의 체선료 비교 — 솔버 아님) ----------
    def options(self, history, tau, v, s):
        pre = self.prefix(history, tau)
        plan = v["plan"]["plan"]
        truth = self.w.truth(pre)
        started = {cid for cid, r in truth.items() if any(e["type"] in ("ANCHOR_AWEIGH", "ALL_FAST") and e["ts"] <= tau for e in r["events"])}
        done = {cid for cid, r in truth.items() if any(e["type"] == "OPS_COMPLETED" and e["ts"] <= tau for e in r["events"])}
        pins = {cid: first_pins(r["events"], tau) for cid, r in truth.items()}
        env = KnownEnv(self.w, tau)
        cache = {}
        group_of = {b: tuple(g) for g in self.w.berth_groups(list(self.w.berths)) for b in g}

        def group_eval(g, seq_map, levers, e=env):
            """묶음 g(공유 자원이 없으면 선석 하나)의 순서들로 함께 흘린 결과 — (환경, 묶음, 순서, 레버)로 캐시."""
            seqs = tuple(tuple(seq_map.get(b) or ()) for b in g)
            calls = {c for q in seqs for c in q}
            lv = tuple(sorted((x["call_id"], x["shore_rate_m3h"], x["effective_from"]) for x in levers if x["call_id"] in calls))
            key = (id(e), g, seqs, lv)
            if key not in cache:
                sub = {"sequence": {b: list(q) for b, q in zip(g, seqs)}, "levers": [x for x in levers if x["call_id"] in calls]}
                res = sim.simulate(self.w, sub, e, now=tau, pins=pins)
                per = {}
                for cid, r in res.items():
                    evs = [dict(ev, projected=ev["ts"] > tau) for ev in r["events"]]
                    st = clock.compute(evs, self.w.terms(cid), self.w.context_for(r), alternatives=False)
                    per[cid] = {"amount": st.get("amount_usd", 0.0), "etb": r["etb"], "etc": r["etc"]}
                cache[key] = per
            return cache[key]

        def evaluate(seq_map, levers, e=env):
            per, done = {}, set()
            for bid in seq_map:
                g = group_of.get(bid, (bid,))
                if g in done:
                    continue
                done.add(g)
                if any(seq_map.get(b) for b in g):
                    per.update(group_eval(g, seq_map, levers, e))
            return round_usd(sum(x["amount"] for x in per.values())), per

        base_levers = list(plan.get("levers", []))
        base_total, base_per = evaluate(plan["sequence"], base_levers)
        movable = [cid for seq in plan["sequence"].values() for cid in seq if cid not in started]
        where = {cid: bid for bid, seq in plan["sequence"].items() for cid in seq}

        ops, excluded = [], []
        for cid in movable:
            vessel, call = self.w.vessel_of(cid), self.w.calls[cid]
            for bid, berth in self.w.berths.items():
                if bid == where[cid]:
                    continue
                ok, fails = sim.compatibility(berth, vessel, call)
                if ok:
                    ops.append(("move", cid, bid))
                else:
                    excluded.append({"call_id": cid, "vessel": vessel["name"], "berth_id": bid,
                                     "rules": [f["rule"] for f in fails], "msg": "; ".join(f["msg"] for f in fails)})
        for bid, seq in plan["sequence"].items():
            for a, b in zip(seq, seq[1:]):
                if a in movable and b in movable:
                    ops.append(("swap", bid, a, b))

        def apply(op_list):
            seq_map = copy.deepcopy(plan["sequence"])
            for op in op_list:
                if op[0] == "move":
                    _, cid, bid = op
                    for q in seq_map.values():
                        if cid in q:
                            q.remove(cid)
                    eta = env.eta(cid)
                    tgt = seq_map[bid]
                    pos = len(tgt)
                    for i, other in enumerate(tgt):
                        if other in movable and env.eta(other) > eta:
                            pos = i
                            break
                    tgt.insert(pos, cid)
                else:
                    _, bid, a, b = op
                    q = seq_map[bid]
                    if a in q and b in q:
                        i, j = q.index(a), q.index(b)
                        q[i], q[j] = q[j], q[i]
            return seq_map

        def calls_of(op):
            return {op[1]} if op[0] == "move" else {op[2], op[3]}

        combos = [[]] + [[o] for o in ops]
        combos += [[o1, o2] for o1, o2 in itertools.combinations(ops, 2) if not (calls_of(o1) & calls_of(o2))]
        lever_opts = []
        for lv in self.w.plan_v1.get("shore_options", []):
            if lv["call_id"] in done or any(x.get("id") == lv["id"] for x in base_levers):
                continue
            eff = max(tau, ts(lv.get("available_from") or iso(tau)))
            lever_opts.append(dict(lv, effective_from=iso(eff)))
        lever_sets = [[]] + [[lv] for lv in lever_opts]

        results, seen = [], set()
        for combo in combos:
            seq_map = apply(combo)
            for lvs in lever_sets:
                if not combo and not lvs:
                    continue
                sig = (json.dumps(seq_map, sort_keys=True), tuple(x["id"] for x in lvs))
                if sig in seen:
                    continue
                seen.add(sig)
                tot, per = evaluate(seq_map, base_levers + lvs)
                results.append({"ops": combo, "levers": lvs, "seq": seq_map, "total": tot, "per": per})
        def parts(r):
            return frozenset([("op",) + tuple(op) for op in r["ops"]] + [("lv", lv["id"]) for lv in r["levers"]])

        results.sort(key=lambda r: (r["total"], len(parts(r))))
        by_parts = {parts(r): r["total"] for r in results}

        def dominated(r):
            p = parts(r)
            for n in range(1, len(p)):
                for sub in itertools.combinations(p, n):
                    if by_parts.get(frozenset(sub), float("inf")) <= r["total"] + 1:
                        return True
            return False

        def describe(r):
            moves = []
            for op in r["ops"]:
                if op[0] == "move":
                    _, cid, bid = op
                    new_pos = r["seq"][bid].index(cid) + 1
                    moves.append(f"{self.name(cid)}: {where[cid]} #{plan['sequence'][where[cid]].index(cid) + 1} → {bid} #{new_pos}")
                else:
                    moves.append(f"{op[1]} 순서 교체: {self.name(op[2])} ↔ {self.name(op[3])}")
            lv_txt = [f"{lv['id']} {lv['title']}" for lv in r["levers"]]
            return moves, " + ".join(moves + [lv["title"].split(" (")[0] for lv in r["levers"]]) or "변경 없음", lv_txt

        best, totals_seen = [], []
        for r in results:
            saving = round_usd(base_total - r["total"])
            if saving < 1000 or len(best) >= 3 or dominated(r) or any(abs(r["total"] - x) < 1 for x in totals_seen):
                continue
            totals_seen.append(r["total"])
            moves, title, _ = describe(r)
            moved = {op[1] for op in r["ops"] if op[0] == "move"}
            rules_checked = list(COMPAT_RULES if moved else []) + TIME_RULES + (["PLAN-PUMP-RATE"] if r["levers"] else [])
            for cid in moved | {c for op in r["ops"] if op[0] == "swap" for c in op[2:]}:
                b = self.w.berths[next(bid for bid, q in r["seq"].items() if cid in q)]
                rid = sim.daytime_rule(b, self.w.vessel_of(cid), self.w.calls[cid])[1]
                if rid not in rules_checked:
                    rules_checked.insert(0, rid)
            coord = [f"{lv['owner']} 확인 필요: {lv['note']}" for lv in r["levers"]]
            if moved:
                coord.append("대리점·도선·예선 재통보 필요 (변경 승인 후 통보문 초안 생성)")
            if any(bid == "SK3B" for op in r["ops"] if op[0] == "move" for bid in [op[2]]):
                coord.append("SK3B 정비 완료 확인 필요 (부두제약관리)")
            per_call = [{"call_id": cid, "vessel": self.name(cid), "before": round_usd(base_per[cid]["amount"]),
                         "after": round_usd(r["per"][cid]["amount"]), "delta": round_usd(r["per"][cid]["amount"] - base_per[cid]["amount"])}
                        for cid in base_per]
            best.append({"id": f"OPT{len(best) + 1}", "title": title, "moves": moves,
                         "levers": [{"id": lv["id"], "title": lv["title"], "owner": lv["owner"], "effective_from": lv["effective_from"],
                                     "note": lv.get("note"), "call_id": lv["call_id"], "shore_rate_m3h": lv["shore_rate_m3h"]} for lv in r["levers"]],
                         "total_usd": r["total"], "saving_usd": saving, "per_call": per_call,
                         "rules_checked": rules_checked, "coordination": coord, "approvable": True,
                         "plan": {"sequence": r["seq"], "levers": base_levers + [
                             {"id": lv["id"], "call_id": lv["call_id"], "shore_rate_m3h": lv["shore_rate_m3h"], "effective_from": lv["effective_from"]}
                             for lv in r["levers"]]},
                         "ops_calls": sorted(moved | {c for op in r["ops"] if op[0] == "swap" for c in op[2:]})})
        if best and best[0]["saving_usd"] < OPTION_MIN_SAVING:
            best = []
        self.candidate_cards(best, plan, base_levers, base_per, env, tau, evaluate)
        singles = []
        for r in results:
            if len(r["ops"]) + len(r["levers"]) == 1:
                singles.append({"title": describe(r)[1], "total_usd": r["total"], "delta_usd": round_usd(r["total"] - base_total)})
        singles.sort(key=lambda x: x["delta_usd"])
        return {"evaluated": len(results), "baseline_usd": base_total, "threshold_usd": OPTION_MIN_SAVING,
                "best": best, "singles": singles[:10], "excluded": excluded,
                "note": "SEAGATE Berth Optimization을 대체하지 않는다. 이동 1~2건·순서 교체·운영 레버의 작은 후보 집합을 체선료로 비교해 설명할 뿐이다."}

    def candidate_cards(self, best, plan, base_levers, base_per, env, tau, evaluate):
        """로드맵 Phase 27 후보 카드: 예상 비용·기준 대비·선정 이유·Risk(스트레스 테스트)·핵심 가정·대안."""
        stresses = [("기상 악화가 3시간 더 길면", StressEnv(env, tau, storm_extend_h=3)),
                    ("미도착 선박 ETA가 3시간 늦으면", StressEnv(env, tau, eta_shift_h=3)),
                    ("미도착 선박 ETA가 3시간 빠르면", StressEnv(env, tau, eta_shift_h=-3))]
        base_stress = {label: evaluate(plan["sequence"], base_levers, e)[0] for label, e in stresses}
        fc = env.forecast[2]
        for i, o in enumerate(best):
            o["expected_cost_usd"] = o["total_usd"]
            o["baseline_delta_usd"] = round_usd(-o["saving_usd"])
            _, per = evaluate(o["plan"]["sequence"], o["plan"]["levers"])
            gains = sorted(((per[cid]["amount"] - base_per[cid]["amount"], cid) for cid in base_per), key=lambda x: x[0])
            reasons_txt = []
            for d, cid in gains[:2]:
                if d > -1:
                    continue
                b, a = base_per[cid], per[cid]
                bits = [f"체선료 {_usd(b['amount'])} → {_usd(a['amount'])}"]
                if abs(_dmin(b["etb"], a["etb"])) >= 30:
                    bits.append(f"접안 {fmt_ts(b['etb'])} → {fmt_ts(a['etb'])}")
                elif abs(_dmin(b["etc"], a["etc"])) >= 30:
                    bits.append(f"하역 종료 {fmt_ts(b['etc'])} → {fmt_ts(a['etc'])}")
                reasons_txt.append(f"{self.name(cid)} " + " · ".join(bits))
            o["reason"] = " / ".join(reasons_txt) or o["title"]
            tested, worst, worst_label = [], o["saving_usd"], None
            for label, e in stresses:
                s = round_usd(base_stress[label] - evaluate(o["plan"]["sequence"], o["plan"]["levers"], e)[0])
                tested.append(f"{label}: 절감 {_signed(s)}")
                if s < worst:
                    worst, worst_label = s, label
            if worst < 0:
                text = f"{worst_label} 오히려 {_usd(-worst)} 손해 — 승인 전 최신 정보 확인"
            elif worst_label and worst < 0.5 * o["saving_usd"]:
                text = f"{worst_label} 절감이 {_usd(worst)}로 줄어듦"
            else:
                text = f"스트레스 테스트 {len(stresses)}종 모두 절감 {_usd(worst)} 이상 유지"
            o["risk"] = {"text": text, "worst_saving_usd": worst, "tested": tested}
            assume = [f"ETA·도착: {fmt_ts(tau)} 시점 최신 통지값 (±3h 스트레스 테스트)",
                      f"기상: {fc['id']} — {fc['summary']}",
                      "주간 계류 창 07:00~17:30 [가정 ULS-DAYTIME-DEF]",
                      "풍속 한계 15/18/20 m/s [가정 ULS-WEATHER-LIMIT]"]
            for lv in o["levers"]:
                assume.append(f"{lv['owner']} 레버: {lv['note']}")
            for cid in o.get("ops_calls", []):
                bid = next(b for b, q in o["plan"]["sequence"].items() if cid in q)
                w = env.oos(bid)
                if w:
                    assume.append(f"{bid} 사용 가능 시점 {fmt_ts(ts(w[-1]['to']))} (부두제약관리)")
            o["assumptions"] = list(dict.fromkeys(assume))
            nxt = best[i + 1] if i + 1 < len(best) else (best[0] if i > 0 else None)
            o["fallback"] = {"id": nxt["id"], "title": nxt["title"]} if nxt else None

    # ---------- NOR 점검 ----------
    def nor_item(self, history, cid, tau, v, retender):
        pre = self.prefix(history, tau)
        truth = self.w.truth(pre)[cid]
        anchored = next(e["ts"] for e in truth["events"] if e["type"] == "ANCHORED")
        arrived = anchored <= tau
        vessel, call, terms = self.w.vessel_of(cid), self.w.calls[cid], self.w.terms(cid)
        c = v["calls"][cid]
        r = c["sim"]
        full = clock.compute(c["events"], terms, self.w.context_for(r))
        berth_busy = r["berth_free_from"] > tau
        berth_note = (f"Berth {r['berth_id']} is presently occupied; NOR is given berth or no berth."
                      if berth_busy else f"Berth {r['berth_id']} is expected to be available for the vessel.")
        checks = [
            {"name": "도착 여부 (AIS)", "ok": arrived, "rules": ["LAW-NOR-ARRIVAL"],
             "detail": f"AIS 투묘 {fmt_ts(anchored)}" if arrived else f"AIS상 항해 중 — 묘박지 투묘 기록 없음 (투묘 {fmt_ts(anchored)} 예상)"},
            {"name": "레이캔", "ok": None, "rules": ["ASB-05-LAYCAN"],
             "detail": f"레이캔 {terms['laycan_from']}부터" if terms.get("laycan_from") else "계약 recap에 레이캔 정보 없음 — 계산에서 제외"},
            {"name": "선석 상태", "ok": None, "rules": ["ASB-09-REACHABLE"],
             "detail": (f"{r['berth_id']} 점유 중 — {fmt_ts(r['berth_free_from'])}부터 사용 가능, 예상 접안 {fmt_ts(r['etb'])} (berth or no berth NOR)"
                        if berth_busy else f"{r['berth_id']} 사용 가능 — 예상 접안 {fmt_ts(r['etb'])}")},
        ]
        basis = {"ALL_FAST": "접안 완료가 먼저", "NOTICE": "통지시간 만료가 먼저", "RETENDER": "재제출 NOR + 6h", "OPS_COMMENCED": "무효 NOR → 하역 개시"}
        proj = {"start": full.get("laytime_start"), "basis": basis.get(full.get("start_basis"), full.get("start_basis")), "rules": full.get("start_rules", [])}
        impact = None
        if retender:
            alt = next((a for a in full.get("alternatives", []) if a["code"] == "OWNER_FIRST_NOR"), None)
            if alt:
                impact = {"delta_usd": alt["delta_usd"],
                          "text": f"첫 NOR(항해 중)을 받아들였다면 레이타임이 더 일찍 시작 → 예측 체선료 {_signed(alt['delta_usd'])}. 재제출로 그만큼 방어"}
        if not arrived:
            rec = "NOR 거절·도착 후 재제출 요청 (도착 전 NOR은 무효 — LAW-NOR-ARRIVAL). 수령 문구에 'validity reserved'를 반드시 넣는다(함정 #14)"
        else:
            rec = "수령하되 'received, validity reserved'로 회신 — 수령 서명이 하자 포기로 해석되지 않게(함정 #14)"
        draft = drafts.nor_reply(vessel, call, iso(next(e["ts"] for e in truth["events"] if e["type"] == ("NOR_RETENDERED" if retender else "NOR_TENDERED"))),
                                 arrived, iso(anchored), berth_note, retender=retender)
        nor_at = next(e["ts"] for e in truth["events"] if e["type"] == ("NOR_RETENDERED" if retender else "NOR_TENDERED"))
        return {"id": f"NOR-{cid[-4:]}-{tau:%m%d%H%M}", "kind": "NOR", "created_at": iso(tau),
                "title": f"{'NOR 재제출' if retender else 'NOR 수령'} — {vessel['name']}" + ("" if arrived else " · 도착 전 NOR 의심"),
                "summary": checks[0]["detail"] + f" · 레이타임 개시 예측 {fmt_ts(ts(proj['start']))} ({proj['basis']})",
                "severity": "high" if not arrived else "low", "call_ids": [cid],
                "trigger": [{"kind": "SOF", "label": f"SOF: {vessel['name']} {EVENT_LABEL['NOR_RETENDERED' if retender else 'NOR_TENDERED']}"}],
                "needs_decision": True, "actions": ["SEND", "REJECT"],
                "call_id": cid, "vessel": vessel["name"], "nor_at": iso(nor_at), "retender": retender, "checks": checks,
                "laytime_projection": proj, "impact": impact, "recommendation": {"text": rec}, "drafts": [draft]}

    # ---------- 하역 종료 → SOF 대조·계산서·체선사유 ----------
    def statement_item(self, history, cid, tau):
        pre = self.prefix(history, tau)
        r = self.w.truth(pre)[cid]
        vessel, call, contract, terms = self.w.vessel_of(cid), self.w.calls[cid], self.w.contracts[cid], self.w.terms(cid)
        ctx = self.w.context_for(r)
        terminal = [dict(e, projected=False) for e in r["events"]]
        report = self.w.sof_reports.get(cid, {"diffs": []})
        sof = []
        for e in terminal:
            d = next((x for x in report["diffs"] if x["type"] == e["type"]), None)
            if d and d.get("drop"):
                continue
            sof.append(dict(e, ts=e["ts"] if not d else e["ts"] + timedelta(minutes=d["delta_minutes"])))
        st_term = clock.compute(terminal, terms, ctx)
        st_sof = clock.compute(sof, terms, ctx)
        rows = []
        for d in report["diffs"]:
            t_ev = next((e for e in terminal if e["type"] == d["type"]), None)
            s_ev = next((e for e in sof if e["type"] == d["type"]), None)
            use = "AIS" if d["type"] == "ANCHORED" else "TERMINAL"
            rows.append({"type": d["type"], "label": EVENT_LABEL.get(d["type"], d["type"]),
                         "sof_ts": iso(s_ev["ts"]) if s_ev else None, "terminal_ts": iso(t_ev["ts"]) if t_ev else None,
                         "delta_min": _dmin(t_ev["ts"], s_ev["ts"]) if (s_ev and t_ev) else None, "use": use, "note": d.get("note"),
                         "rules": ["ENG-RECONCILE"]})
        rs = reasons.classify(terminal, terms, ctx, st_term, r, vessel)
        delta = round_usd(st_sof["amount_usd"] - st_term["amount_usd"])
        st_term["story"] = story(st_term, vessel["name"])
        title = f"계산서 초안 — {vessel['name']} 체선 {fmt_h(st_term['demurrage_h'])} · {_usd(st_term['amount_usd'])}"
        if rows:
            title += f" · SOF 불일치 {len(rows)}건"
        return {"id": f"STM-{cid[-4:]}", "kind": "STATEMENT", "created_at": iso(tau), "title": title,
                "summary": (f"대리점 SOF 그대로면 {_signed(delta)} — 터미널 기록 기준으로 작성" if rows else "SOF와 터미널 기록 일치")
                           + (f" · 주요 사유 {rs[0]['label']} {fmt_h(rs[0]['hours'])}" if rs else ""),
                "severity": "high" if st_term["amount_usd"] >= OPTIONS_TRIGGER_USD or abs(delta) >= ITEM_USD else "medium",
                "call_ids": [cid], "trigger": [{"kind": "SOF", "label": f"SOF: {vessel['name']} 서류 완료 — 대리점 SOF 수신"}],
                "needs_decision": True, "actions": ["APPROVE", "REJECT"],
                "call_id": cid, "vessel": vessel["name"], "contract": dict(contract, sk_role_label=ROLE_LABEL.get(contract["sk_role"])),
                "statement": st_term, "reconcile": {"rows": rows, "amount_sof": st_sof["amount_usd"], "amount_terminal": st_term["amount_usd"], "delta_usd": delta},
                "reasons": rs, "reasons_note": reasons.NOTE, "seagate_entry": drafts.seagate_reason_entry(call, rs),
                "drafts": [drafts.statement_cover(vessel, call, contract, st_term, delta, rs)]}

    # ---------- 결과 ----------
    def outcome(self, history, t):
        base = self.truth_eval(history[:1])
        cur = self.truth_eval(history)
        last_end = max(ts(c["statement"]["laytime_end"]) for c in cur.values() if c["statement"]["status"] == "OK")
        b = round_usd(sum(c["statement"]["amount_usd"] for c in base.values()))
        a = round_usd(sum(c["statement"]["amount_usd"] for c in cur.values()))
        return {"final": ts(t) >= last_end, "baseline_usd": b, "actual_usd": a, "saving_usd": round_usd(b - a), "ends_at": iso(last_end),
                "approved": [{"version": h["version"], "label": h["label"], "effective_from": h["effective_from"], "item_id": h.get("item_id")} for h in history[1:]]}


def story(st, name):
    """계산서를 문장으로 (EXPLAIN). 숫자는 계산서 값 그대로 쓴다 — LLM으로 바꿔도 이 원칙은 유지."""
    if st.get("status") != "OK":
        return [f"{name}: 필수 이벤트가 없어 계산할 수 없음 ({', '.join(st.get('missing', []))})"]
    basis = {"ALL_FAST": "접안 완료가 통지시간 만료보다 빨라 접안 시각", "NOTICE": "NOR 수령 6시간 뒤(통지시간 만료)",
             "OPS_COMMENCED": "NOR이 도착 전에 나와 무효라서 하역 개시 시각", "RETENDER": "재제출 NOR 6시간 뒤",
             "LAYCAN": "레이캔 시작", "OVERRIDE": "지정 시각",
             "NOR_AFTER_BERTH": "접안 뒤에 NOR이 나와 NOR 수령 시각"}.get(st["start_basis"], st["start_basis"])
    out = [f"레이타임은 {basis}인 {fmt_ts(ts(st['laytime_start']))}에 시작했다 ({', '.join(st['start_rules'])})."]
    ded = [d for d in st["deductions"]]
    if ded:
        out.append("공제: " + ", ".join(f"{d['label']} {fmt_h(d['hours'])} ({d['rule']})" for d in ded) + ".")
    if st["demurrage_h"] > 0:
        out.append(f"허용 {fmt_h(st['allowed_h'])}을 {fmt_ts(ts(st['demurrage_start']))}에 모두 써서 체선에 들어갔고, "
                   f"호스 분리 {fmt_ts(ts(st['laytime_end']))}까지 체선 {fmt_h(st['demurrage_h'])} → USD {st['amount_usd']:,.2f}.")
        if st["half_h"] > 0:
            out.append(f"이 중 {fmt_h(st['half_h'])}은 기상 등 cl.8 사유라 반액(ASB-08-HALF-RATE).")
    else:
        out.append(f"사용 {fmt_h(st['used_h'])} / 허용 {fmt_h(st['allowed_h'])} — 체선 없음, 여유 {fmt_h(st['margin_h'])}.")
    disputes = [i for i in st["issues"] if i["severity"] == "dispute"]
    if disputes:
        out.append(f"쟁점 {len(disputes)}건은 자동 판정하지 않고 대안 계산을 함께 둔다(ENG-DISPUTE-NO-AUTO).")
    return out
