"""WORLD — 라이브 시나리오 입력 묶음을 읽고, 시점 t에 '알 수 있었던 것'만으로 예측·계산한다.

- 실제 세계(truth): 관측 풍속·실제 도착·실제 부두제약으로 시뮬레이션. 계획이 승인으로 바뀌면
  바뀐 시점까지의 사건은 고정하고 그 뒤만 새 계획으로 다시 흘린다.
- 시점 t의 뷰: t까지 일어난 사건은 고정(pins), 그 뒤는 t에 발행돼 있던 ETA·예보·부두제약으로 예측.
- v3 자원·제약(resources.json): ResourceView(kt)가 시점 kt에 알던 조석·파고·시정·예선·검사 승인 정보를 준다
  (kt=None이면 실제). resource_flags()는 어떤 자원이 결과를 바꿀 수 있는지(구속 가능성)를 정적으로 판정하고,
  공유 자원이 구속될 수 있는 선석끼리 berth_groups()로 묶는다. 구속될 수 없으면 선석은 서로 독립이다.
"""
from __future__ import annotations

import copy
import json
import math
from pathlib import Path

from . import clock, rules, sim
from .rules import DATA
from .timeutil import add_h, hours, iso, round_usd, ts

STATUS_LABEL = {"EN_ROUTE": "항해 중", "WAITING": "묘박 대기", "SHIFTING": "이동 중", "BERTHED": "접안·준비",
                "OPS": "하역 중", "STOPPED": "하역 중단", "POST_OPS": "호스 분리 중", "COMPLETED": "하역 완료", "SAILED": "이안"}
ROLE_LABEL = {"CHARTERER": "SK = 용선주 (선주에게 직접 지급)", "BUYER_DES": "SK = DES 매수인 (매도인에게 매매계약상 지급)",
              "SELLER_FOB": "SK = FOB 매도인 (매수인이 매매계약상 청구)", "SELLER_CFR": "SK = CFR 매도인"}


def _series(block):
    start = ts(block["start"])
    return {iso(add_h(start, i)): v for i, v in enumerate(block["wind_ms"])}


def merge_wait(before, after, cut):
    """cut 이전 대기 사유는 그때의 기록(before), 이후는 새 계획(after). 선석을 옮긴 배의 과거 대기를 새 선석 사유로 덮지 않는다."""
    out = [dict(w, to=min(w["to"], cut)) for w in before if w["from"] < cut]
    out += [dict(w, **{"from": max(w["from"], cut)}) for w in after if w["to"] > cut]
    merged = []
    for w in sorted(out, key=lambda w: w["from"]):
        if w["from"] >= w["to"]:
            continue
        if (merged and merged[-1]["reason"] == w["reason"] and merged[-1].get("detail") == w.get("detail")
                and merged[-1]["to"] >= w["from"]):
            merged[-1]["to"] = max(merged[-1]["to"], w["to"])
        else:
            merged.append(dict(w))
    return merged


def first_pins(events, t):
    pins = {}
    for e in events:
        if e["ts"] <= t and e["type"] not in ("OPS_STOPPED", "OPS_RESUMED") and e["type"] not in pins:
            pins[e["type"]] = e
    return pins


class TruthEnv:
    def __init__(self, world):
        self.w = world

    def eta(self, cid):
        c = self.w.calls[cid]
        return ts(c.get("actual_arrival") or c["eta_updates"][-1]["eta"])

    def wind(self, h):
        return self.w.obs.get(iso(h), 6.0)

    def oos(self, bid):
        return self.w.oos_at(bid, None)


class KnownEnv:
    def __init__(self, world, t):
        self.w, self.t = world, t
        issued = [f for f in world.forecasts if f[0] <= t] or world.forecasts[:1]
        self.forecast = issued[-1]

    def eta(self, cid):
        ups = self.w.calls[cid]["eta_updates"]
        known = [u for u in ups if ts(u["issued_at"]) <= self.t]
        return ts((known[-1] if known else ups[0])["eta"])

    def wind(self, h):
        if h <= self.t:
            return self.w.obs.get(iso(h), 6.0)
        return self.forecast[1].get(iso(h), 6.0)

    def oos(self, bid):
        return self.w.oos_at(bid, self.t)


def _windows(times, flags):
    """정시 슬롯별 참/거짓 → 연속 구간 [(from, to)]."""
    out = []
    for h, on in zip(times, flags):
        if not on:
            continue
        if out and out[-1][1] == h:
            out[-1] = (out[-1][0], add_h(h, 1))
        else:
            out.append((h, add_h(h, 1)))
    return out


def _merge(windows):
    out = []
    for a, b in sorted(windows):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


class ResourceView:
    """시점 kt에 알던 자원 정보(kt=None이면 실제 세계). 조석은 천문 예보라 둘이 같고, 너울·안개 주의보·예선 일정·
    검사 승인 예정은 발행 시각부터 안다. 탱크·배관·제품 기준은 고정값이다."""

    def __init__(self, world, kt):
        self.w, self.kt = world, kt
        R = world.resources

        def known(x):
            return kt is None or ts(x.get("issued_at") or iso(world.t0)) <= kt

        tide = R.get("tide") or {}
        self.z0 = float(tide.get("z0_m", 0.0))
        self.epoch = ts(tide.get("epoch") or iso(world.t0))
        self.cons = [(c["amp_m"], 2 * math.pi / c["period_h"], math.radians(c["phase_deg"])) for c in tide.get("constituents", [])]
        self.tide_step = int(tide.get("check_step_min", 15))
        wave = R.get("wave") or {}
        model = wave.get("model") or {}
        self.wave_base, self.wave_coef = float(model.get("base_m", 0.3)), float(model.get("wind_coef", 0.008))
        self.wave_limits = wave.get("limits") or {}
        self.swell = [(ts(x["from"]), ts(x["to"]), float(x["add_m"])) for x in wave.get("swell", []) if known(x)]
        self.swell_all_max = max([float(x["add_m"]) for x in wave.get("swell", [])] or [0.0])
        vis = R.get("visibility") or {}
        obs = world.fog_observed()
        if kt is None:
            self.fog = obs
        else:
            adv = [(ts(x["from"]), ts(x["to"])) for x in vis.get("advisories", []) if known(x)]
            self.fog = _merge(adv + [(a, min(b, kt)) for a, b in obs if a < kt])
        marine = R.get("marine") or {}
        tg, pl = marine.get("tugs") or {}, marine.get("pilots") or {}
        self.tug_fleet, self.pilot_pool = int(tg.get("fleet", 99)), int(pl.get("pool", 99))
        self.tug_cal = [(ts(x["from"]), ts(x["to"]), int(x["available"])) for x in tg.get("calendar", []) if known(x)]
        self.pilot_cal = [(ts(x["from"]), ts(x["to"]), int(x["available"])) for x in pl.get("calendar", []) if known(x)]
        self.tug_breaks = sorted({t for a, b, _ in self.tug_cal for t in (a, b)})
        self.pilot_breaks = sorted({t for a, b, _ in self.pilot_cal for t in (a, b)})
        self._tug_req, self._tug_default = tg.get("requirements") or {}, int(tg.get("default", 2))
        self._pilot_req, self._pilot_default = pl.get("requirements") or {}, int(pl.get("default", 1))
        self.lines = R.get("lines", [])
        self.farms = R.get("tanks", [])
        self._lines = {x["id"]: x for x in self.lines}
        self._farms = {x["id"]: x for x in self.farms}
        self.tank_ratio = float((R.get("tank_rule") or {}).get("berth_min_ratio", 0.5))
        prod = R.get("products") or {}
        self._co = {(x["from"], x["to"]): int(x["minutes"]) for x in prod.get("changeover_minutes", [])}
        self._co_default = int(prod.get("default_changeover_minutes", 180))
        self._sampling = prod.get("sampling_minutes") or {}
        self._vet = (R.get("vetting") or {}).get("calls", {})

    # 조석·파고
    def tide(self, t):
        x = hours(self.epoch, t)
        return self.z0 + sum(a * math.cos(wv * x - ph) for a, wv, ph in self.cons)

    def swell_at(self, h):
        return sum(v for a, b, v in self.swell if a <= h < b)

    def wave(self, h, wind):
        return self.wave_base + self.wave_coef * wind * wind + self.swell_at(h)

    def wave_limit(self, berth, kind, wind_on=True):
        """SBM 파고 한계(m). 풍속 한계가 먼저 걸려 파고가 결과를 바꿀 수 없으면 None(검사 생략)."""
        if berth["type"] != "SBM":
            return None
        lim = self.wave_limits.get("sbm_mooring_m" if kind == "mooring" else "sbm_ops_m")
        if lim is None:
            return None
        wind_lim = berth["mooring_wind_ms"] if kind == "mooring" else berth["ops_stop_wind_ms"]
        if wind_on and self.wave_base + self.wave_coef * wind_lim * wind_lim + self.swell_all_max < lim:
            return None
        return float(lim)

    # 예선·도선
    @staticmethod
    def _cap(cal, base, t):
        v = base
        for a, b, n in cal:
            if a <= t < b:
                v = min(v, n)
        return v

    def tug_cap(self, t):
        return self._cap(self.tug_cal, self.tug_fleet, t)

    def pilot_cap(self, t):
        return self._cap(self.pilot_cal, self.pilot_pool, t)

    def tug_req(self, vessel, berth):
        r = self._tug_req.get(vessel.get("type")) or {}
        return int(r.get(berth["type"], self._tug_default)) if isinstance(r, dict) else int(r)

    def pilot_req(self, vessel):
        return int(self._pilot_req.get(vessel.get("type"), self._pilot_default))

    # 탱크·배관·제품
    def farm(self, fid):
        return self._farms[fid]

    def line(self, lid):
        return self._lines[lid]

    def manifold_of(self, bid, product):
        for m in self.w.berths[bid].get("manifolds") or []:
            if product in m["products"]:
                return m["id"]
        return None

    def initial_manifolds(self, bid):
        return {m["id"]: m.get("initial") for m in self.w.berths[bid].get("manifolds") or []}

    def changeover(self, prev, product):
        if not prev or prev == product:
            return 0
        return self._co.get((prev, product), self._co_default)

    def sampling(self, product):
        return int(self._sampling.get(product, 0))

    # 선박 검사 승인
    def vetting(self, cid):
        """(상태, 승인 시각) — 실제면 실제 승인 시각, 시점 kt면 그때까지의 마지막 통보."""
        v = self._vet.get(cid)
        if not v:
            return "APPROVED", None
        cleared = ts(v.get("cleared_at")) if v.get("cleared_at") else None
        if self.kt is None or (cleared and cleared <= self.kt):
            return v.get("status", "APPROVED"), cleared
        ups = [u for u in v.get("updates", []) if ts(u["issued_at"]) <= self.kt]
        if ups:
            return ups[-1].get("status", v.get("status")), ts(ups[-1]["expected"])
        return v.get("status_initial", v.get("status", "APPROVED")), ts(v.get("expected_initial") or v.get("cleared_at"))

    def vetting_cleared(self, cid):
        return self.vetting(cid)[1]


class World:
    def __init__(self, base=None):
        base = Path(base or DATA / "live")

        def load(name):
            return json.loads((base / name).read_text(encoding="utf-8"))

        self.meta = load("scenario.json")
        self.t0, self.t_end = ts(self.meta["t0"]), ts(self.meta["t_end"])
        b = load("berths.json")
        self.berths = {x["id"]: x for x in b["berths"]}
        self.constraint_updates = b["constraint_updates"]
        self.vessels = {v["id"]: v for v in load("vessels.json")["vessels"]}
        self.calls = {c["call_id"]: c for c in load("calls.json")["calls"]}
        self.contracts = load("contracts.json")["contracts"]
        self.plan_v1 = load("plan.json")
        w = load("weather.json")
        self.obs = _series(w["observations"])
        self.forecasts = [(ts(f["issued_at"]), _series(f), f) for f in w["forecasts"]]
        self.sof_reports = load("sof_reports.json")["reports"]
        p = rules.rule("ULS-DAYTIME-DEF")["params"]
        self.daytime = {"start": p["start"], "end": p["end"]}
        self.resources = load("resources.json") if (base / "resources.json").exists() else {}
        self.relax = set()
        self._truth = {}
        self._init_resources()

    def _init_resources(self):
        """resources.json의 선석 정보(조석 접근·제품·라인)를 선석 사전에 붙이고 캐시를 비운다. variant의 patch 뒤에도 다시 부른다."""
        self._rv, self._flags, self._groups, self._fog = {}, None, {}, None
        self._res_cache = {}  # engine/resources.py 결과 캐시 (variant마다 새로)
        self._stmt = {}       # optimize._statement 계산서 기억 (사건·대기 사유가 같으면 같은 금액)
        extra = self.resources.get("berths") or {}
        rv = ResourceView(self, None)
        horizon = [add_h(self.t0, k / 4) for k in range(int(hours(self.t0, self.t_end) * 4) + 7 * 96)]
        tmax = max((rv.tide(t) for t in horizon), default=0.0) if rv.cons else 0.0
        for bid, b in self.berths.items():
            x = extra.get(bid) or {}
            b["tidal_access"] = bool(x.get("tidal_access", False))
            b["tide_max_m"] = round(tmax, 3) if b["tidal_access"] else 0.0
            if x.get("products"):
                b["products"] = list(x["products"])
            b["manifolds"] = copy.deepcopy(x.get("manifolds") or [])
            b["line"] = x.get("line")
        self._rv = {}

    def variant(self, patch=None, label=None):
        """시나리오 분석용 사본. 입력 데이터를 깊은 복사한 뒤 patch(w)로 바꾼다. 원본과 원본 캐시는 그대로다."""
        w = copy.copy(self)
        for name in ("meta", "berths", "constraint_updates", "vessels", "calls", "contracts", "plan_v1", "sof_reports", "daytime"):
            setattr(w, name, copy.deepcopy(getattr(self, name)))
        w.obs = dict(self.obs)
        w.forecasts = [(t, dict(series), copy.deepcopy(meta)) for t, series, meta in self.forecasts]
        w.resources = copy.deepcopy(self.resources)
        w.relax = set(self.relax)
        w._truth = {}
        w.variant_label = label or "variant"
        if patch:
            patch(w)
        w._init_resources()
        return w

    # ---- v3 자원·제약 ----
    def resource_view(self, kt):
        if kt not in self._rv:
            if len(self._rv) > 512:
                self._rv.clear()
            self._rv[kt] = ResourceView(self, kt)
        return self._rv[kt]

    def fog_observed(self):
        """시정 관측 시계열에서 기준 미만인 구간 = 실제 통제 구간."""
        if self._fog is None:
            vis = self.resources.get("visibility") or {}
            km = vis.get("km") or []
            start = ts(vis.get("start") or iso(self.t0))
            thr = float(vis.get("threshold_km", 1.0))
            times = [add_h(start, i) for i in range(len(km))]
            self._fog = _windows(times, [v < thr for v in km])
        return self._fog

    def resource_flags(self):
        """자원별 '결과를 바꿀 수 있는가'(정적 판정)와 선석 묶음. 구속될 수 없으면 sim은 그 자원 검사를 건너뛴다."""
        if self._flags is None:
            self._flags = _resource_flags(self)
        return self._flags

    def berth_groups(self, berths=None):
        """berths(순서 유지)를 공유 자원 묶음으로 나눈다. 묶을 것이 없으면 선석마다 하나."""
        berths = list(self.berths) if berths is None else list(berths)
        key = tuple(berths)
        if key not in self._groups:
            root = self.resource_flags()["root"]
            groups, seen = [], {}
            for b in berths:
                r = root.get(b, b)
                if r in seen:
                    groups[seen[r]].append(b)
                else:
                    seen[r] = len(groups)
                    groups.append([b])
            self._groups[key] = groups
        return self._groups[key]

    def resource_notices(self):
        """자원 정보가 새로 발행된 시각(예선·도선 일정, 안개 주의보, 너울 예보, 검사 승인 통보) — 결정 시점이 된다."""
        R, out = self.resources, []
        marine = R.get("marine") or {}
        for word, block in (("예선", marine.get("tugs")), ("도선사", marine.get("pilots"))):
            for x in (block or {}).get("calendar", []):
                out.append({"t": ts(x["issued_at"]), "kind": "RESOURCE", "id": x.get("id"),
                            "label": x.get("summary") or f"{word} 가용 {x['available']} ({ts(x['from']):%m/%d %H:%M}~{ts(x['to']):%m/%d %H:%M}) — {x.get('reason', '')}"})
        for x in (R.get("visibility") or {}).get("advisories", []):
            out.append({"t": ts(x["issued_at"]), "kind": "RESOURCE", "id": x.get("id"),
                        "label": x.get("summary") or f"안개 주의보: {ts(x['from']):%m/%d %H:%M}~{ts(x['to']):%m/%d %H:%M} 이동 통제 예상"})
        for x in (R.get("wave") or {}).get("swell", []):
            out.append({"t": ts(x["issued_at"]), "kind": "RESOURCE", "id": x.get("id"),
                        "label": x.get("summary") or f"너울 예보 +{x['add_m']}m ({ts(x['from']):%m/%d %H:%M}~{ts(x['to']):%m/%d %H:%M})"})
        for cid, v in ((R.get("vetting") or {}).get("calls") or {}).items():
            if cid not in self.calls:
                continue
            for u in v.get("updates", []):
                out.append({"t": ts(u["issued_at"]), "kind": "RESOURCE", "id": u.get("id"), "call_id": cid,
                            "label": u.get("summary") or f"{self.vessel_of(cid)['name']} 검사 승인 예정 {ts(u['expected']):%m/%d %H:%M}"})
        return sorted(out, key=lambda e: e["t"])

    # ---- 입력 조회 ----
    def oos_at(self, bid, t):
        windows = list(self.berths[bid]["oos"])
        for u in self.constraint_updates:
            if u["berth_id"] == bid and (t is None or ts(u["issued_at"]) <= t):
                windows = list(u["oos"])
        return windows

    def terms(self, cid):
        c = dict(self.contracts[cid])
        c["operation"] = self.calls[cid]["operation"]
        return c

    def vessel_of(self, cid):
        return self.vessels[self.calls[cid]["vessel_id"]]

    def base_history(self):
        return [{"version": 1, "effective_from": iso(self.t0), "source": "SEAGATE Berthing Schedule v1", "label": "기준 계획",
                 "plan": {"sequence": self.plan_v1["sequence"], "levers": []}}]

    # ---- 실제 세계 ----
    def truth(self, history):
        key = json.dumps(history, sort_keys=True, ensure_ascii=False)
        if key not in self._truth:
            env, res = TruthEnv(self), None
            for h in history:
                eff = ts(h["effective_from"])
                if res is None:
                    res = sim.simulate(self, h["plan"], env, now=self.t0)
                else:
                    pins = {cid: first_pins(r["events"], eff) for cid, r in res.items()}
                    prev, res = res, sim.simulate(self, h["plan"], env, now=eff, pins=pins)
                    for cid, r in res.items():
                        r["wait_reasons"] = merge_wait(prev[cid]["wait_reasons"], r["wait_reasons"], eff)
            self._truth[key] = res
        return self._truth[key]

    def plan_at(self, history, t):
        cur = history[0]
        for h in history:
            if ts(h["effective_from"]) <= t:
                cur = h
        return cur

    # ---- 시점 t의 뷰 ----
    def context_for(self, r):
        vessel = self.vessel_of(r["call_id"])
        ctx = {"daytime_rule": r["daytime_rule"], "wait_reasons": r["wait_reasons"], "daytime": self.daytime}
        if self.calls[r["call_id"]]["operation"] == "DISCHARGE" and r["rate_m3h"] < vessel["pump_m3h"]:
            ctx["pumping_log"] = {"avg_manifold_psi": None, "shore_restriction": True,
                                  "evidence": f"육상 수용률 {r['rate_m3h']:,.0f} m3/h < 선박 펌프 {vessel['pump_m3h']:,} m3/h (터미널 제한)"}
        elif self.calls[r["call_id"]]["operation"] == "DISCHARGE" and sum((r.get("slow_h") or {}).values()) > 0.05:
            slow = r["slow_h"]
            ctx["pumping_log"] = {"avg_manifold_psi": None, "shore_restriction": True,
                                  "evidence": f"공유 배관 {slow.get('PIPELINE', 0):.1f}h·탱크 공간 {slow.get('SHORE_TANK', 0):.1f}h 하역 속도 제한 (터미널 제한)"}
        return ctx

    def project(self, plan, t, history=None, env=None):
        """계획 plan으로 시점 t 이후를 예측. history가 있으면 t까지 실제 사건을 고정한다."""
        if history is None:
            return sim.simulate(self, plan, env or KnownEnv(self, t), now=max(t, self.t0), pins={})
        truth = self.truth(history)
        pins = {cid: first_pins(r["events"], t) for cid, r in truth.items()}
        res = sim.simulate(self, plan, env or KnownEnv(self, t), now=max(t, self.t0), pins=pins)
        for cid, r in res.items():
            r["wait_reasons"] = merge_wait(truth[cid]["wait_reasons"], r["wait_reasons"], t)
        return res

    def evaluate(self, proj, t, alternatives=True):
        out = {}
        for cid, r in proj.items():
            events = [dict(e, projected=e["ts"] > t) for e in r["events"]]
            st = clock.compute(events, self.terms(cid), self.context_for(r), alternatives=alternatives)
            out[cid] = {"sim": r, "events": events, "statement": st, "status": status_at(events, t), "clock": clock_at(st, t)}
        return out

    def view(self, history, t, alternatives=True):
        t = ts(t)
        h = self.plan_at(history, t)
        return {"t": t, "plan": h, "calls": self.evaluate(self.project(h["plan"], t, history), t, alternatives)}

    def info_events(self, history):
        out = [{"t": self.t0, "kind": "INIT", "label": "기준 계획 수신 (SEAGATE v1)"}]
        for cid, r in self.truth(history).items():
            for e in r["events"]:
                out.append({"t": e["ts"], "kind": "SOF", "call_id": cid, "type": e["type"]})
        for c in self.calls.values():
            for u in c["eta_updates"]:
                if ts(u["issued_at"]) > self.t0:
                    out.append({"t": ts(u["issued_at"]), "kind": "ETA", "call_id": c["call_id"], "source": u["source"],
                                "label": f"ETA 갱신 → {ts(u['eta']).strftime('%m/%d %H:%M')}"})
        for issued, _, f in self.forecasts:
            if issued > self.t0:
                out.append({"t": issued, "kind": "FORECAST", "label": f["summary"], "id": f["id"]})
        for u in self.constraint_updates:
            out.append({"t": ts(u["issued_at"]), "kind": "CONSTRAINT", "berth_id": u["berth_id"], "label": u["summary"], "id": u["id"]})
        for e in self.resource_notices():
            if e["t"] > self.t0:
                out.append(e)
        for h in history[1:]:
            out.append({"t": ts(h["effective_from"]), "kind": "PLAN", "label": h["label"]})
        out = [e for e in out if self.t0 <= e["t"] <= self.t_end]
        out.sort(key=lambda e: (e["t"], 0 if e["kind"] == "PLAN" else 1))
        return out


def _resource_flags(w):
    """정적 구속 가능성. 배관: 묶인 선석 최대 유량 합 > 한도. 탱크: 초기 + 들어올 수 있는 화물 전부(+생산 유입) > 상한,
    또는 초기 − 나갈 수 있는 화물 전부(− 공정 투입) < 하한. 예선·도선: 일정상 최소 가용 < 선석별 최대 소요의 합.
    계류 감독: 1인 공용이면 SBM끼리 묶는다. world.relax에 든 제약은 없는 것으로 본다."""
    R, relax = w.resources, w.relax
    berths = list(w.berths)
    compat = {cid: [b for b in berths if sim.compatibility(w.berths[b], w.vessel_of(cid), w.calls[cid])[0]] for cid in w.calls}
    by_berth = {b: [cid for cid in w.calls if b in compat[cid]] for b in berths}
    horizon_h = hours(w.t0, w.t_end) + 7 * 24
    parent = {b: b for b in berths}

    def find(b):
        while parent[b] != b:
            parent[b] = parent[parent[b]]
            b = parent[b]
        return b

    def union(bs):
        bs = [b for b in bs if b in parent]
        for b in bs[1:]:
            ra, rb = find(bs[0]), find(b)
            if ra != rb:
                parent[rb] = ra

    line_of, line_bind = {}, {}
    for L in R.get("lines", []):
        bs = [b for b in L["berths"] if b in w.berths]
        for b in bs:
            line_of.setdefault(b, L["id"])
        peak = sum(w.berths[b]["max_rate_m3h"] for b in bs if by_berth[b])
        line_bind[L["id"]] = "LINE" not in relax and peak > L["capacity_m3h"] + 1e-6
        if line_bind[L["id"]] and len(bs) > 1:
            union(bs)
    farms_of, farm_for, farm_bind, farm_load = {}, {}, {}, {}
    for F in R.get("tanks", []):
        bs = [b for b in F["berths"] if b in w.berths]
        for b in bs:
            farms_of.setdefault(b, []).append(F["id"])
            for prod in F["products"]:
                farm_for.setdefault((b, prod), F["id"])
        imp = exp = 0.0
        for cid, call in w.calls.items():
            if sim.product_of(call) not in F["products"] or not any(b in bs for b in compat[cid]):
                continue
            vol = call["quantity_bbl"] * sim.BBL_TO_M3
            if call["operation"] == "DISCHARGE":
                imp += vol
            else:
                exp += vol
        over = imp > 0 and F["level0_m3"] + imp + F.get("rundown_m3h", 0) * horizon_h > F["max_m3"]
        under = exp > 0 and F["level0_m3"] - exp - F.get("draw_m3h", 0) * horizon_h < F["min_m3"]
        farm_bind[F["id"]] = "TANK" not in relax and (over or under)
        farm_load[F["id"]] = {"imports_m3": imp, "exports_m3": exp}
        if farm_bind[F["id"]] and len(bs) > 1:
            union(bs)
    rv = ResourceView(w, None)
    marine = R.get("marine") or {}

    def need(req):
        return sum(max((req(w.vessel_of(c), w.berths[b]) for c in by_berth[b]), default=0) for b in berths)

    def low(block, base):
        cal = [x["available"] for x in (block or {}).get("calendar", [])]
        return min([base] + cal)

    tug_need, pilot_need = need(rv.tug_req), need(lambda v, b: rv.pilot_req(v))
    tug_bind = "TUG" not in relax and low(marine.get("tugs"), rv.tug_fleet) < tug_need
    pilot_bind = "PILOT" not in relax and low(marine.get("pilots"), rv.pilot_pool) < pilot_need
    if tug_bind or pilot_bind:
        union([b for b in berths if by_berth[b]])
    mm = marine.get("mooring_master") or {}
    mm_on = bool(mm.get("enabled")) and "MOORING_MASTER" not in relax
    mm_berths = [b for b in mm.get("berths", []) if b in w.berths]
    if mm_on:
        union(mm_berths)
    return {"root": {b: find(b) for b in berths}, "line_of": line_of, "line_bind": line_bind, "farms_of": farms_of,
            "farm_for": farm_for, "farm_bind": farm_bind, "farm_load": farm_load, "tug_bind": tug_bind, "pilot_bind": pilot_bind,
            "tug_need": tug_need, "pilot_need": pilot_need, "mm_on": mm_on, "mm_berths": mm_berths, "compat": compat}


def status_at(events, t):
    seen = [e for e in events if e["ts"] <= t]
    types = {e["type"] for e in seen}
    if "LAST_LINE" in types:
        return "SAILED"
    if "HOSES_DISCONNECTED" in types:
        return "COMPLETED"
    if "OPS_COMPLETED" in types:
        return "POST_OPS"
    stops = [e for e in seen if e["type"] in ("OPS_STOPPED", "OPS_RESUMED")]
    if stops and stops[-1]["type"] == "OPS_STOPPED":
        return "STOPPED"
    for typ, st in (("OPS_COMMENCED", "OPS"), ("ALL_FAST", "BERTHED"), ("ANCHOR_AWEIGH", "SHIFTING"), ("ANCHORED", "WAITING")):
        if typ in types:
            return st
    return "EN_ROUTE"


def clock_at(st, t):
    """시점 t까지 누적된 레이타임·체선과 그 순간의 시계 상태."""
    if st["status"] != "OK":
        return {"state": "UNKNOWN"}
    used = dem_full = dem_half = 0.0
    state = "NOT_STARTED" if t < ts(st["laytime_start"]) else "ENDED"
    for s in st["segments"]:
        a, b = ts(s["from"]), ts(s["to"])
        if a >= t:
            continue
        part = hours(a, min(b, t))
        if a <= t < b:
            state = {"COUNT": "LAYTIME", "EXCLUDE": "EXCLUDED", "FULL": "DEMURRAGE", "HALF": "DEMURRAGE_HALF"}[s["effect"]]
        if s["effect"] == "COUNT":
            used += part
        elif s["effect"] == "FULL":
            dem_full += part
        elif s["effect"] == "HALF":
            dem_half += part
    rate = st["rate_usd_day"]
    return {"state": state, "laytime_used_h": used, "demurrage_h": dem_full + dem_half,
            "accrued_usd": round_usd(dem_full * rate / 24 + dem_half * rate / 48)}
