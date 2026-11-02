"""서비스 파사드 — server.py(HTTP)와 mcp_server.py(MCP)가 부르는 유일한 진입점. 계약은 docs/api.md."""
from __future__ import annotations

import copy
import hashlib
import importlib
import json
import threading
from pathlib import Path

from . import golden, intake, reasons, rules
from .agent import Agent, story
from .intake import EVENT_LABEL
from .store import Store
from .timeutil import add_h, hours, iso, round_usd, ts
from .world import KnownEnv, ROLE_LABEL, STATUS_LABEL, World

try:
    from . import claims as claims_mod
except ImportError:  # 클레임 모듈이 없을 때도 나머지는 동작
    claims_mod = None

STATUS_OF = {"ACK": "ACK", "APPROVE": "APPROVED", "APPROVE_OPTION": "APPROVED", "SEND": "SENT", "REJECT": "REJECTED"}
DECISIONS = set(STATUS_OF)
ROOT = Path(__file__).resolve().parent.parent
PRECOMPUTED = ROOT / "data" / "precomputed"
# 검증(정책 경쟁·리플레이·시나리오) 결과에 영향을 주지 않는 하류 모듈 — 나머지 엔진 파일이 바뀌면 미리 계산본을 버린다
_DOWNSTREAM = {"__init__.py", "service.py", "store.py", "drafts.py", "diagnosis.py", "discovery.py", "business.py",
               "casestudy.py", "assurance.py", "claims.py", "golden.py"}


def validation_fingerprint():
    h = hashlib.sha256()
    engine = sorted(p for p in (ROOT / "engine").glob("*.py") if p.name not in _DOWNSTREAM)
    files = engine + sorted((ROOT / "data" / "live").glob("*.json")) + [ROOT / "data" / "rules.json"]
    for f in files:
        if f.exists():
            h.update(f.relative_to(ROOT).as_posix().encode())
            h.update(f.read_bytes())
    return h.hexdigest()[:16]


class DeskError(ValueError):
    pass


class Desk:
    def __init__(self, state_path=None):
        self.world = World()
        self.agent = Agent(self.world)
        self.store = Store(state_path)
        self.lock = threading.RLock()
        self._cache = {}
        if not self.store.data.get("history"):
            self.store.data["history"] = self.world.base_history()

    def refresh(self):
        """다른 프로세스(예: 웹 서버)가 저장한 결정·계획 버전을 다시 읽는다. MCP 서버가 호출마다 쓴다."""
        with self.lock:
            self.store = Store(self.store.path)
            if not self.store.data.get("history"):
                self.store.data["history"] = self.world.base_history()

    # ---------- 공통 ----------
    @property
    def history(self):
        return self.store.data["history"]

    def _t(self, t):
        t = ts(t) if t else self.world.t0
        return min(max(t, self.world.t0), self.world.t_end)

    def _claim_rows(self):
        if not claims_mod:
            return []
        rows = []
        for r in claims_mod.list_claims():
            d = self.store.data["decisions"].get(r["claim_id"])
            rows.append(dict(r, status=STATUS_OF[d["decision"]] if d else r.get("status", "NEW")))
        return rows

    # ---------- meta ----------
    def meta(self):
        w = self.world
        calls = []
        for cid, c in w.calls.items():
            con = dict(w.contracts[cid], sk_role_label=ROLE_LABEL.get(w.contracts[cid]["sk_role"]))
            calls.append({"call_id": cid, "operation": c["operation"], "cargo": c["cargo"], "quantity_bbl": c["quantity_bbl"],
                          "agent": c.get("agent"), "vessel": w.vessel_of(cid), "contract": con})
        lim = rules.rule("ULS-WEATHER-LIMIT")["params"]
        infos = []
        for e in w.info_events(self.history):
            label = e.get("label") or f"{w.vessel_of(e['call_id'])['name']} {EVENT_LABEL.get(e['type'], e['type'])}"
            infos.append({"t": iso(e["t"]), "kind": e["kind"], "label": label, "call_id": e.get("call_id"), "type": e.get("type")})
        _, cases = golden.cases()
        return {
            "scenario": {k: w.meta[k] for k in ("id", "title", "t0", "t_end", "synthetic", "story")},
            "daytime": w.daytime,
            "limits": {"mooring_ms": lim["mooring_ms"], "ops_sbm_ms": lim["ops_sbm_ms"], "ops_pier_ms": lim["ops_pier_ms"]},
            "berths": [{k: b.get(k) for k in ("id", "name", "type", "max_dwt", "depth_m", "length_m", "cargo", "max_rate_m3h",
                                               "mooring_wind_ms", "ops_stop_wind_ms")} for b in w.berths.values()],
            "calls": calls, "info_events": infos,
            "golden": [{"id": c["id"], "title": c["title"]} for c in cases],
            "simulator_doc": "docs/domain/demurrage-simulator.html",
        }

    # ---------- state ----------
    def _status(self, item, t, timeline_items):
        d = self.store.data["decisions"].get(item["id"])
        if d:
            return STATUS_OF[d["decision"]], d
        if item["kind"] == "IMPACT" and item.get("options") and item["options"]["best"]:
            later = [i for i in timeline_items if i["kind"] == "IMPACT" and i["created_at"] > item["created_at"]
                     and ts(i["created_at"]) <= t and i.get("options") and i["options"]["best"]]
            if later:
                return "STALE", None
        return "NEW", None

    def _row(self, item, t, tl_items):
        status, _ = self._status(item, t, tl_items)
        return {"id": item["id"], "kind": item["kind"], "created_at": item["created_at"], "title": item["title"],
                "summary": item.get("summary", ""), "severity": item.get("severity", "low"), "call_ids": item.get("call_ids", []),
                "status": status, "needs_decision": bool(item.get("needs_decision")) and status == "NEW",
                "delta_usd": item.get("delta_usd") if item["kind"] in ("IMPACT", "PLAN_APPLIED") else
                (-item["options"]["best"][0]["saving_usd"] if item.get("options") and item["options"]["best"] else None)}

    def state(self, t=None):
        with self.lock:
            t = self._t(t)
            hist = self.history
            v = self.agent.view(hist, t)
            tl = self.agent.timeline(hist)
            calls, kpi = [], {"exposure_usd": 0.0, "accrued_usd": 0.0, "on_demurrage": [], "waiting": [], "next_demurrage": None}
            for cid, c in v["calls"].items():
                st, r = c["statement"], c["sim"]
                con = self.world.contracts[cid]
                row = {
                    "call_id": cid, "vessel_name": self.world.vessel_of(cid)["name"], "vessel_type": self.world.vessel_of(cid)["type"],
                    "berth_id": r["berth_id"], "seq": r["seq"], "status": c["status"], "status_label": STATUS_LABEL[c["status"]],
                    "anchored": iso(r["anchored"]), "etb": iso(r["etb"]), "etc": iso(r["etc"]), "etd": iso(r["etd"]),
                    "laytime_start": st.get("laytime_start"), "laytime_expiry": st.get("laytime_expiry"), "demurrage_start": st.get("demurrage_start"),
                    "allowed_h": st.get("allowed_h"), "used_h": st.get("used_h"), "margin_h": st.get("margin_h"),
                    "demurrage_h": st.get("demurrage_h"), "half_h": st.get("half_h"), "amount_usd": st.get("amount_usd", 0.0),
                    "rate_usd_day": st.get("rate_usd_day"), "clock": c["clock"],
                    "issues": [{"code": i["code"], "severity": i["severity"], "title": i["title"]} for i in st.get("issues", [])],
                    "events": [{"type": e["type"], "label": EVENT_LABEL.get(e["type"], e["type"]), "ts": iso(e["ts"]), "projected": e["ts"] > t,
                                "source": e.get("source"), "reason": e.get("reason")} for e in c["events"]],
                    "segments": st.get("segments", []),
                    "layer": con["layer"], "sk_role_label": ROLE_LABEL.get(con["sk_role"]), "counterparty": con["counterparty"],
                }
                calls.append(row)
                kpi["exposure_usd"] += row["amount_usd"] or 0.0
                kpi["accrued_usd"] += c["clock"].get("accrued_usd", 0.0)
                if c["clock"].get("state") in ("DEMURRAGE", "DEMURRAGE_HALF"):
                    kpi["on_demurrage"].append(cid)
                if c["status"] == "WAITING":
                    kpi["waiting"].append(cid)
                ds = st.get("demurrage_start")
                if ds and ts(ds) > t and (kpi["next_demurrage"] is None or ds < kpi["next_demurrage"]["at"]):
                    kpi["next_demurrage"] = {"call_id": cid, "vessel": row["vessel_name"], "at": ds}
            calls.sort(key=lambda r: (list(self.world.berths).index(r["berth_id"]), r["seq"]))
            kpi["exposure_usd"], kpi["accrued_usd"] = round_usd(kpi["exposure_usd"]), round_usd(kpi["accrued_usd"])
            env = KnownEnv(self.world, t)
            hrs = int(hours(self.world.t0, self.world.t_end)) + 1
            wind = {"start": iso(self.world.t0), "values": [round(env.wind(add_h(self.world.t0, i)), 1) for i in range(hrs)],
                    "observed_until": iso(t), "forecast_id": env.forecast[2]["id"], "forecast_summary": env.forecast[2]["summary"]}
            inbox = [self._row(i, t, tl["items"]) for i in tl["items"] if ts(i["created_at"]) <= t]
            for r in self._claim_rows():
                rec = r.get("recommended_usd", r["computed_usd"])
                cut = round_usd(rec - r["claimed_usd"])
                inbox.append({"id": r["claim_id"], "kind": "CLAIM", "created_at": r["received_at"],
                              "title": f"클레임 — {r['vessel']} 청구 ${r['claimed_usd']:,.0f} → 권고 ${rec:,.0f}"
                                       + (f" (재계산 ${r['computed_usd']:,.0f})" if abs(rec - r["computed_usd"]) >= 1 else ""),
                              "summary": r.get("recommendation_label", ""), "severity": "high" if abs(cut) >= 10000 else "medium",
                              "call_ids": [r["call_id"]], "status": r["status"], "needs_decision": r["status"] == "NEW",
                              "delta_usd": cut})
            inbox.sort(key=lambda r: r["created_at"], reverse=True)
            kpi["pending_items"] = sum(1 for r in inbox if r["needs_decision"])
            cur = self.world.plan_at(hist, t)
            return {
                "t": iso(t),
                "plan": {"version": cur["version"], "label": cur["label"], "source": cur["source"], "effective_from": cur["effective_from"],
                         "sequence": cur["plan"]["sequence"], "levers": cur["plan"].get("levers", [])},
                "plan_history": [{k: h.get(k) for k in ("version", "label", "effective_from", "source", "item_id")} for h in hist],
                "kpi": kpi, "calls": calls,
                "berths": [{"id": b, "name": x["name"], "type": x["type"], "oos": env.oos(b)} for b, x in self.world.berths.items()],
                "wind": wind, "inbox": inbox,
                "alerts": sorted([a for a in tl["alerts"] if ts(a["at"]) <= t], key=lambda a: a["at"], reverse=True),
                "trend": [p for p in tl["trend"] if ts(p["t"]) <= t],
                "outcome": self.agent.outcome(hist, t),
            }

    # ---------- item ----------
    def item(self, item_id, t=None):
        with self.lock:
            t = self._t(t)
            if item_id.startswith("CLM-"):
                if not claims_mod:
                    raise DeskError("claims module not available")
                review = claims_mod.review(item_id)
                d = self.store.data["decisions"].get(item_id)
                return {"id": item_id, "kind": "CLAIM", "created_at": review["claim"]["received_at"],
                        "title": f"클레임 검토 — {review['vessel']['name']} ({item_id})", "summary": review["recommendation"]["label"],
                        "severity": "high", "status": STATUS_OF[d["decision"]] if d else "NEW", "needs_decision": not d,
                        "call_ids": [review["claim"]["call_id"]], "trigger": [{"kind": "CLAIM", "label": f"청구 접수 {review['claim']['received_at'][:10]}"}],
                        "decision": d, "actions": ["APPROVE", "REJECT"], "review": review}
            tl = self.agent.timeline(self.history)
            if item_id not in tl["by_id"]:
                raise DeskError(f"unknown item: {item_id}")
            if ts(tl["by_id"][item_id]["created_at"]) > t:
                raise DeskError(f"아직 생성되지 않은 항목입니다: {item_id} (생성 {tl['by_id'][item_id]['created_at']}, 요청 시점 {iso(t)})")
            item = copy.deepcopy(tl["by_id"][item_id])
            status, d = self._status(item, t, tl["items"])
            item["status"], item["decision"] = status, d
            item["needs_decision"] = bool(item.get("needs_decision")) and status == "NEW"
            opts = item.get("options")
            if opts:
                truth = self.world.truth(self.agent.prefix(self.history, t))
                # 옵션은 항목 생성 시점 계획의 '전체 스냅숏'이다. 그 뒤 계획이 바뀌었으면 적용하면 새 계획을 되돌리므로 막는다.
                base = [h for h in self.history if ts(h["effective_from"]) < ts(item["created_at"])] or self.history[:1]
                cur = self.world.plan_at(self.history, t)
                same_base = cur["version"] == base[-1]["version"]
                open_ = status in ("NEW", "ACK")
                for o in opts["best"]:
                    started = [cid for cid in o["ops_calls"]
                               if any(e["type"] in ("ANCHOR_AWEIGH", "ALL_FAST") and e["ts"] <= t for e in truth[cid]["events"])]
                    o["approvable"] = open_ and ts(item["created_at"]) <= t and not started and same_base
                    if started:
                        o["blocked_reason"] = f"이미 이동·접안한 선박: {', '.join(self.world.vessel_of(c)['name'] for c in started)}"
                    elif not open_:
                        o["blocked_reason"] = "더 최신 영향 분석 항목이 있음" if status == "STALE" else f"항목 상태 {status}"
                    elif not same_base:
                        o["blocked_reason"] = f"항목 생성 뒤 계획이 v{cur['version']}로 바뀜 — 최신 항목에서 다시 계산"
                    else:
                        o["blocked_reason"] = None
            return item

    # ---------- decide ----------
    def decide(self, item_id, decision, t=None, option_id=None, note=None, body=None, actor="터미널 담당자(데모)"):
        with self.lock:
            if decision not in DECISIONS:
                raise DeskError(f"unknown decision: {decision}")
            t = self._t(t)
            item = self.item(item_id, t)
            if ts(item["created_at"]) > t:
                raise DeskError("아직 생성되지 않은 항목입니다 (시점 확인)")
            if decision not in item["actions"]:
                raise DeskError(f"{item['kind']} 항목에 허용되지 않는 결정: {decision}")
            msg = "기록됨"
            version = self.world.plan_at(self.history, t)["version"]
            if decision == "APPROVE_OPTION":
                opt = next((o for o in (item.get("options") or {}).get("best", []) if o["id"] == option_id), None)
                if not opt:
                    raise DeskError(f"unknown option: {option_id}")
                if not opt["approvable"]:
                    raise DeskError(f"적용할 수 없는 옵션: {opt.get('blocked_reason')}")
                later_items = {i["id"] for i in self.agent.timeline(self.history)["items"] if ts(i["created_at"]) > t}
                kept = [h for h in self.history if ts(h["effective_from"]) <= t]
                dropped = len(self.history) - len(kept)
                plan = copy.deepcopy(opt["plan"])
                new_ids = {lv["id"] for lv in opt["levers"]}
                for lv in plan["levers"]:
                    if lv.get("id") in new_ids:  # 이미 발효된(상속된) 레버의 시작 시각은 건드리지 않는다
                        lv["effective_from"] = iso(max(ts(lv["effective_from"]), t))
                version = kept[-1]["version"] + 1
                kept.append({"version": version, "effective_from": iso(t), "label": opt["title"], "item_id": item_id, "option_id": option_id,
                             "source": f"{item_id} {option_id} 승인 → SEAGATE 반영(데모 시뮬레이션)", "plan": plan})
                self.store.data["history"] = kept
                stale = [k for k in self.store.data["decisions"] if k in later_items]
                for k in stale:
                    self.store.data["decisions"].pop(k)
                msg = f"계획 v{version} 반영 ({iso(t)}부터)" + (f" · 이후 계획 {dropped}건·결정 {len(stale)}건 무효화" if dropped or stale else "")
            self.store.data["decisions"][item_id] = {"decision": decision, "option_id": option_id, "note": note, "body": body,
                                                     "actor": actor, "at": iso(t)}
            self.store.log({"at": iso(t), "actor": actor, "item_id": item_id, "kind": item["kind"], "decision": decision,
                            "detail": msg if decision == "APPROVE_OPTION" else (note or item["title"]), "option_id": option_id})
            self.store.save()
            return {"ok": True, "plan_version": version, "message": msg}

    def reset(self):
        with self.lock:
            self.store.data["history"] = self.world.base_history()
            self.store.data["decisions"] = {}
            self.store.log({"at": iso(self.world.t0), "actor": "시스템", "item_id": None, "kind": "RESET", "decision": "RESET", "detail": "결정·계획 버전 초기화"})
            self.store.save()
            return {"ok": True}

    # ---------- 계산서 ----------
    def statement(self, call_id, t=None):
        with self.lock:
            t = self._t(t)
            if call_id not in self.world.calls:
                raise DeskError(f"unknown call: {call_id}")
            pre = self.agent.prefix(self.history, t)
            v = self.world.view(pre, t, alternatives=True)
            c = v["calls"][call_id]
            vessel, terms = self.world.vessel_of(call_id), self.world.terms(call_id)
            st = c["statement"]
            st["story"] = story(st, vessel["name"])
            ctx = self.world.context_for(c["sim"])
            rs = reasons.classify(c["events"], terms, ctx, st, c["sim"], vessel) if st["status"] == "OK" else []
            con = dict(self.world.contracts[call_id], sk_role_label=ROLE_LABEL.get(self.world.contracts[call_id]["sk_role"]))
            return {"call_id": call_id, "t": iso(t), "vessel": vessel, "contract": con, "berth_id": c["sim"]["berth_id"],
                    "status": c["status"], "statement": st, "reasons": rs, "reasons_note": reasons.NOTE}

    # ---------- 클레임 ----------
    def claims(self):
        return self._claim_rows()

    def claim(self, claim_id):
        if not claims_mod:
            raise DeskError("claims module not available")
        return claims_mod.review(claim_id)

    # ---------- 입력·계산기 ----------
    def intake_parse(self, text, base_date):
        return intake.parse_sof(text or "", base_date)

    def intake_calc(self, text, base_date, terms, context):
        if not terms or not terms.get("laytime_hours") or not terms.get("rate_usd_day"):
            raise DeskError("terms.laytime_hours, terms.rate_usd_day는 필수")
        terms = dict({"notice_hours": 6, "operation": "DISCHARGE"}, **{k: v for k, v in terms.items() if v not in (None, "")})
        context = {k: v for k, v in (context or {}).items() if v not in (None, "")}
        parsed, st = golden.run(text or "", terms, context, base_date)
        rs = []
        if st["status"] == "OK":
            st["story"] = story(st, "입력 SOF")
            ctx = golden.build_context(context, parsed["notes"], base_date)
            rs = reasons.classify(parsed["events"], {k: golden.resolve(v, base_date) for k, v in terms.items()}, ctx, st)
        return {"parsed": parsed, "statement": st, "reasons": rs, "reasons_note": reasons.NOTE,
                "input": {"base_date": base_date, "terms": terms, "context": context}}

    def golden(self):
        base, cases = golden.cases()
        return {"base_date": base, "cases": cases}

    # ---------- v2: 로드맵 (Discovery → 진단 → 검증 → 비즈니스 케이스) ----------
    def _mod(self, name):
        try:
            return importlib.import_module(f"engine.{name}")
        except ImportError as e:
            raise DeskError(f"engine/{name}.py 준비 중 ({e})")

    def validation(self):
        with self.lock:
            if self._cache.get("validation") is None:
                pre = PRECOMPUTED / "validation.json"
                data = None
                if pre.exists():
                    data = json.loads(pre.read_text(encoding="utf-8"))
                    if data.get("fingerprint") != validation_fingerprint():
                        data = None  # 엔진·입력이 바뀌었으면 미리 계산본을 쓰지 않는다
                if data is None:
                    data = self._mod("validate").run(self.world)
                    data["source"] = "live"
                self._cache["validation"] = data
            return self._cache["validation"]

    def _diag_base(self):
        if self._cache.get("diag_base") is None:
            self._cache["diag_base"] = self._mod("diagnosis").run(self.world, self.world.base_history(), self.validation(), agent=self.agent)
        return self._cache["diag_base"]

    def diagnosis(self, case="base"):
        with self.lock:
            if case in (None, "", "base"):
                return self._diag_base()
            if case != "current":
                raise DeskError(f"unknown case: {case} (base|current)")
            key = json.dumps(self.history, sort_keys=True, ensure_ascii=False)
            cur = self._cache.setdefault("diag_current", {})
            if key not in cur:
                cur.clear()
                cur[key] = self._mod("diagnosis").run(self.world, self.history, self.validation(), agent=self.agent)
            return cur[key]

    def discovery(self):
        with self.lock:
            if self._cache.get("discovery") is None:
                self._cache["discovery"] = self._mod("discovery").run(self._diag_base(), self.validation(),
                                                                      world=self.world, agent=self.agent)
            return self._cache["discovery"]

    def business_case(self, params=None):
        with self.lock:
            return self._mod("business").run(dict(params or {}), self._diag_base(), self.validation())

    # ---------- v3: 자원·제약(P4~P10) · 사례 복원(P12) · 도입 검증(P28·P30) ----------
    def resources(self, t=None, scenario=None, policy=None):
        with self.lock:
            sc = (scenario or "BASE").upper()
            return self._mod("resources").run(self.world, self.history, self._t(t),
                                              scenario_id=None if sc == "BASE" else sc, policy=policy or None)

    def casestudies(self):
        with self.lock:
            return self._mod("casestudy").index(self.world, self.history, self.agent)

    def casestudy(self, call_id=None):
        with self.lock:
            mod = self._mod("casestudy")
            if not call_id:
                cases = mod.index(self.world, self.history, self.agent)
                if not cases:
                    raise DeskError("복원할 사례가 없습니다")
                call_id = cases[0]["call_id"]
            if call_id not in self.world.calls:
                raise DeskError(f"unknown call: {call_id}")
            return mod.run(self.world, self.history, call_id, self.agent, self.validation())

    def assurance(self):
        with self.lock:
            return self._mod("assurance").run(self.validation(), self.audit(), None, world=self.world, agent=self.agent)

    def rules(self):
        return list(rules.registry().values())

    def audit(self):
        return list(reversed(self.store.data["audit"]))
