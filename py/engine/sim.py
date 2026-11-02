"""SIM — 접안·하역 예측기. 데모에서 SEAGATE Berthing Schedule(ETB·ETC)을 대신한다.

계획(선석별 순서 + 레버) + 환경(ETA·풍속·부두제약) + 이미 일어난 이벤트(pins) → SOF 이벤트 예측.
같은 함수가 '실제 세계'(관측값)와 '시점 t의 예측'(예보값)을 모두 만든다. 실제 운영에서는
SEAGATE가 이 값을 주고, 우리는 그 위에 CLOCK(돈)을 얹는다.

v3 자원·제약(P4~P10, data/live/resources.json): 조석·UKC 창, SBM 파고 한계, 시정 불량 통제, 예선·도선·계류 감독,
선박 검사·승인(Vetting), 탱크 공간(ullage), 공유 주배관, 제품 라인 전환·샘플링.
- 공유 자원이 구속될 수 있는 선석끼리는 묶음(world.berth_groups)으로 함께 흘린다. 이동은 먼저 움직이는 선박부터
  예선·도선·계류 감독을 배정받고, 배관·탱크는 먼저 접안한 선박이 먼저 쓴다(나중 선박은 잔여 용량).
- 구속될 수 없는 자원(기준 시나리오)은 검사를 건너뛰고 예전 계산을 그대로 탄다 — BASE 숫자 불변.
- world.relax에 든 제약은 없는 것으로 본다(제약 비용 = 그 제약이 없을 때와의 체선료 차, engine/resources.py).
"""
from __future__ import annotations

import math
from datetime import timedelta

from . import rules
from .timeutil import DayWindow, add_h, add_m, ceil_to, floor_hour, hour_slots, hours, ts

DURATIONS = {
    "SBM": {"shift": 120, "mooring": 60, "hose_on": 60, "ops_start": 30, "hose_off": 60, "docs": 60, "unberth": 30},
    "PIER": {"shift": 90, "mooring": 30, "hose_on": 60, "ops_start": 30, "hose_off": 60, "docs": 60, "unberth": 30},
}
BBL_TO_M3 = 0.158987
SOURCE = {"ANCHORED": "AIS", "NOR_TENDERED": "MASTER", "NOR_RECEIVED": "AGENT", "NOR_RETENDERED": "MASTER",
          "ANCHOR_AWEIGH": "PILOT", "ALL_FAST": "TERMINAL", "HOSES_CONNECTED": "TERMINAL", "OPS_COMMENCED": "TERMINAL",
          "OPS_STOPPED": "TERMINAL", "OPS_RESUMED": "TERMINAL", "OPS_COMPLETED": "TERMINAL", "HOSES_DISCONNECTED": "TERMINAL",
          "DOCS_ON_BOARD": "AGENT", "LAST_LINE": "TERMINAL"}
STEP_MIN = 5          # 공유 배관·탱크를 보는 적분 간격(분)
GRID_DAYS = 14        # 배관·탱크 격자 길이(t0부터)
STOP_REASON = {"WIND": "WEATHER", "WAVE": "WEATHER", "SHORE_TANK": "SHORE_TANK", "PIPELINE": "PIPELINE"}
CLASS_PRODUCT = {"CRUDE": "CRUDE", "OIL": "GASOIL", "CHEM": "CHEM"}
INF = float("inf")


def product_of(call):
    return call.get("product") or CLASS_PRODUCT.get(call.get("cargo_class"), call.get("cargo_class"))


def known_time(env):
    """환경이 언제 알던 정보인가 — KnownEnv의 t, 실제 세계(TruthEnv)면 None. 스트레스 래퍼(.base)는 벗겨 본다."""
    e = env
    for _ in range(8):
        base = getattr(e, "base", None)
        if base is None:
            break
        e = base
    return getattr(e, "t", None)


def daytime_rule(berth, vessel, call):
    if berth["type"] == "SBM":
        return True, "ULS-SBM-NIGHT"
    limit = rules.param("ULS-SK38-DAYTIME", "laden_gt" if call["operation"] == "DISCHARGE" else "ballast_gt")
    return vessel["gt"] >= limit, "ULS-SK38-DAYTIME"


def ukc_m(vessel):
    return max(rules.param("ULS-DRAFT-UKC", "min_m"), vessel["draft_m"] * rules.param("ULS-DRAFT-UKC", "ratio"))


def tide_needed(berth, vessel):
    """흘수 + UKC가 수심을 넘는 만큼(m). 조석 접근 선석에서는 조위가 이만큼 있을 때만 들어간다(ULS-TIDE-UKC)."""
    return max(0.0, vessel["draft_m"] + ukc_m(vessel) - berth["depth_m"])


def compatibility(berth, vessel, call):
    """선석 적합성. 실패 사유마다 룰 ID를 단다. 조석 접근 선석에서 조위로 메울 수 있는 UKC 부족은 통과(조석 창은 SIM이 지킨다)."""
    fails, soft = [], []
    if vessel["dwt"] > berth["max_dwt"]:
        fails.append({"rule": "ULS-DWT-MAX", "msg": f"DWT {vessel['dwt']:,} > 최대 {berth['max_dwt']:,}"})
    if berth["type"] == "SBM" and vessel["dwt"] < rules.param("ULS-SBM-MIN-DWT", "min_dwt"):
        fails.append({"rule": "ULS-SBM-MIN-DWT", "msg": f"DWT {vessel['dwt']:,} < SBM 운영 하한 {rules.param('ULS-SBM-MIN-DWT', 'min_dwt'):,}"})
    ukc = max(rules.param("ULS-DRAFT-UKC", "min_m"), vessel["draft_m"] * rules.param("ULS-DRAFT-UKC", "ratio"))
    if vessel["draft_m"] + ukc > berth["depth_m"]:
        f = {"rule": "ULS-DRAFT-UKC", "msg": f"흘수 {vessel['draft_m']}m + UKC {ukc:.2f}m > 수심 {berth['depth_m']}m"}
        fails.append(f)
        if berth.get("tidal_access") and vessel["draft_m"] + ukc - berth["depth_m"] <= berth.get("tide_max_m", 0.0) + 1e-9:
            soft.append(f)
    if berth.get("length_m") and vessel["loa_m"] > berth["length_m"]:
        fails.append({"rule": "ULS-LOA-MAX", "msg": f"LOA {vessel['loa_m']}m > 선석 길이 {berth['length_m']}m"})
    if call["cargo_class"] not in berth["cargo"]:
        fails.append({"rule": "ULS-CARGO-TYPE", "msg": f"화물 {call['cargo_class']} 미취급 (취급: {', '.join(berth['cargo'])})"})
    elif berth.get("products") and product_of(call) not in berth["products"]:
        fails.append({"rule": "PROD-BERTH", "msg": f"제품 {product_of(call)} 라인 없음 (연결: {', '.join(berth['products'])})"})
    if fails and len(fails) == len(soft):
        return True, []
    return not fails, fails


def _in_oos(t, windows):
    for w in windows:
        if ts(w["from"]) <= t < ts(w["to"]):
            return ts(w["to"])
    return None


def _overlap_end(a, b, windows):
    """[a, b)와 겹치는 통제 구간 중 가장 늦게 끝나는 시각 (없으면 None)."""
    end = None
    for x, y in windows:
        if x < b and y > a and (end is None or y > end):
            end = y
    return end


# ---------- 자원 장부: 예선·도선·계류 감독 예약, 공유 배관 사용량, 탱크 수위 ----------
class _Usage:
    """배관 사용량(m3/h)을 STEP_MIN 격자 평균으로 담는다."""

    def __init__(self, t0, n):
        self.t0, self.n, self.u = t0, n, [0.0] * n

    def add(self, segs):
        step = timedelta(minutes=STEP_MIN)
        for a, b, r in segs:
            k = max(0, int((a - self.t0) // step))
            while k < self.n:
                ga = self.t0 + k * step
                gb = ga + step
                if ga >= b:
                    break
                ov = (min(b, gb) - max(a, ga)).total_seconds()
                if ov > 0:
                    self.u[k] += r * ov / (STEP_MIN * 60)
                k += 1


class _Farm:
    """탱크군 수위: 초기 + 선박 유출입 − 공정 투입(draw, 하한에서 멈춤) + 생산 유입(rundown, 상한에서 멈춤).
    room[k] = k 이후 가장 좁은 여유(상한 − 수위), stock[k] = k 이후 가장 적은 재고(수위 − 하한) — 나중 선박이 쓸 수 있는 몫."""

    def __init__(self, spec, t0, n, base=None):
        self.spec, self.t0, self.n = spec, t0, n
        self.net = [0.0] * n
        self.step_h = STEP_MIN / 60.0
        if base is not None:
            self.level, self.room, self.stock = base
            self.dirty = False
        else:
            self.dirty = True

    def add(self, segs, sign):
        step = timedelta(minutes=STEP_MIN)
        net = self.net
        for a, b, r in segs:
            k = max(0, int((a - self.t0) // step))
            while k < self.n:
                ga = self.t0 + k * step
                gb = ga + step
                if ga >= b:
                    break
                ov = (min(b, gb) - max(a, ga)).total_seconds() / 3600.0
                if ov > 0:
                    net[k] += sign * r * ov
                    self.dirty = True
                k += 1

    def _calc(self):
        s, n, net = self.spec, self.n, self.net
        hi, lo = s["max_m3"], s["min_m3"]
        draw, rund = s.get("draw_m3h", 0.0) * self.step_h, s.get("rundown_m3h", 0.0) * self.step_h
        level = [0.0] * (n + 1)
        x = level[0] = s["level0_m3"]
        for k in range(n):
            x += net[k]
            if draw:
                e = x - lo
                if e > 0:
                    x -= draw if draw < e else e
            if rund:
                e = hi - x
                if e > 0:
                    x += rund if rund < e else e
            level[k + 1] = x
        room, stock = [0.0] * (n + 1), [0.0] * (n + 1)
        rm = st = INF
        for k in range(n, -1, -1):
            v = level[k]
            if hi - v < rm:
                rm = hi - v
            if v - lo < st:
                st = v - lo
            room[k], stock[k] = rm, st
        self.level, self.room, self.stock = level, room, stock
        self.dirty = False

    def idx_ceil(self, t):
        step = STEP_MIN * 60
        sec = (t - self.t0).total_seconds()
        return min(self.n, max(0, int(math.ceil(sec / step - 1e-9))))

    def space(self, t, sign):
        if self.dirty:
            self._calc()
        k = self.idx_ceil(t)
        return self.room[k] if sign > 0 else self.stock[k]


_FARM_BASE = {}


def _empty_farm(spec, t0, n):
    """선박 흐름이 없을 때의 탱크 수위(초기·투입·생산만) — 사양이 같으면 다시 계산하지 않는다."""
    key = (t0, n, tuple(sorted((k, v) for k, v in spec.items() if isinstance(v, (int, float)))))
    if key not in _FARM_BASE:
        if len(_FARM_BASE) > 64:
            _FARM_BASE.clear()
        f = _Farm(spec, t0, n)
        f._calc()
        _FARM_BASE[key] = (f.level, f.room, f.stock)
    return _Farm(spec, t0, n, _FARM_BASE[key])


class _Book:
    """묶음 하나를 흘리는 동안 확정된 예약·흐름. 먼저 확정한 것이 우선이다."""

    def __init__(self, cx, group):
        self.cx = cx
        self.man = []
        f = cx.flags
        t0, n = cx.w.t0, GRID_DAYS * 24 * 60 // STEP_MIN
        self.lines, self.farms = {}, {}
        for b in group:
            lid = f["line_of"].get(b)
            if lid and f["line_bind"].get(lid) and lid not in self.lines:
                self.lines[lid] = _Usage(t0, n)
            for fid in f["farms_of"].get(b, []):
                if f["farm_bind"].get(fid) and fid not in self.farms:
                    self.farms[fid] = _empty_farm(cx.rv.farm(fid), t0, n)

    # 예선·도선·계류 감독
    def _min_free(self, a, b, key, cap, breaks):
        pts = [a] + [x for x in breaks if a < x < b] + [r["a"] for r in self.man if a < r["a"] < b]
        lo = INF
        for p in pts:
            used = sum(r[key] for r in self.man if r["a"] <= p < r["b"])
            lo = min(lo, cap(p) - used)
        return lo

    def blocked(self, a, b, tugs, pilots, mm):
        """[a, b) 이동에 필요한 예선·도선·계류 감독이 없으면 그 사유."""
        cx, rv = self.cx, self.cx.rv
        if cx.check_tug and tugs and self._min_free(a, b, "tugs", rv.tug_cap, rv.tug_breaks) < tugs:
            return "TUG"
        if cx.check_pilot and pilots and self._min_free(a, b, "pilots", rv.pilot_cap, rv.pilot_breaks) < pilots:
            return "PILOT"
        if mm and any(r["mm"] and r["mm"][0] < mm[1] and r["mm"][1] > mm[0] for r in self.man):
            return "MOORING_MASTER"
        return None

    def next_change(self, a, b):
        """[a, b)를 막던 예약·예선 일정이 바뀌는 가장 이른 시각."""
        rv = self.cx.rv
        cands = [r["b"] for r in self.man if r["a"] < b and r["b"] > a]
        cands += [x for x in rv.tug_breaks + rv.pilot_breaks if x > a]
        return min(cands) if cands else None

    def reserve(self, cid, kind, a, b, tugs, pilots, mm):
        self.man.append({"call_id": cid, "kind": kind, "a": a, "b": b, "tugs": tugs, "pilots": pilots, "mm": mm})

    # 배관·탱크
    def caps(self, bid, cid, call):
        f = self.cx.flags
        lid = f["line_of"].get(bid)
        line = self.lines.get(lid) if lid else None
        fid = self.cx.farm_of(bid, call)
        farm = self.farms.get(fid) if fid else None
        if line is None and farm is None:
            return None
        sign = 1 if call["operation"] == "DISCHARGE" else -1
        return _Caps(line, self.cx.rv.line(lid)["capacity_m3h"] if line else None, farm, sign)

    def commit_flow(self, bid, call, flow):
        f = self.cx.flags
        lid = f["line_of"].get(bid)
        if lid in self.lines:
            self.lines[lid].add(flow)
        fid = self.cx.farm_of(bid, call)
        if fid in self.farms:
            self.farms[fid].add(flow, 1 if call["operation"] == "DISCHARGE" else -1)

    def tank_ok(self, bid, cid, call, t_ops, need):
        fid = self.cx.farm_of(bid, call)
        farm = self.farms.get(fid) if fid else None
        if farm is None:
            return True
        sign = 1 if call["operation"] == "DISCHARGE" else -1
        return farm.space(t_ops, sign) >= need - 1e-6


class _Caps:
    """선박 한 척의 배관 잔여 용량·탱크 몫. 먼저 확정한 선박의 흐름은 이미 장부에 있다."""

    def __init__(self, line, line_cap, farm, sign):
        self.line, self.line_cap, self.farm, self.sign = line, line_cap, farm, sign

    def limit_num(self, k, seg_end_min, cum, dt):
        """k = 지금 격자 칸, seg_end_min = 구간 끝(t0부터 분), cum = 이 선박이 지금까지 넣은(뺀) 양, dt = 구간 길이(h)."""
        lim, why = INF, None
        if self.line is not None:
            res = self.line_cap - (self.line.u[k] if 0 <= k < self.line.n else 0.0)
            if res < lim:
                lim, why = res, "PIPELINE"
        if self.farm is not None and dt > 0:
            f = self.farm
            if f.dirty:
                f._calc()
            j = min(f.n, max(0, int(math.ceil(seg_end_min / STEP_MIN - 1e-9))))
            v = ((f.room[j] if self.sign > 0 else f.stock[j]) - cum) / dt
            if v < lim:
                lim, why = v, "SHORE_TANK"
        return lim, why


# ---------- 한 번의 simulate 동안 쓰는 환경·자원 ----------
class _Ctx:
    def __init__(self, world, env, now):
        self.w, self.env, self.now = world, env, now
        self.kt = known_time(env)
        self.rv = world.resource_view(self.kt)
        self.flags = world.resource_flags()
        self.relax = world.relax
        self.window = DayWindow(**world.daytime)
        self.check_tug = self.flags["tug_bind"]
        self.check_pilot = self.flags["pilot_bind"]
        try:  # 같은 환경 객체로 여러 번 흘리면(최적화 탐색) 풍속 조회를 기억해 둔다 — 값은 env.wind와 같다
            self._wind = env.__dict__.setdefault("_sim_wind_memo", {})
        except AttributeError:
            self._wind = {}

    def wind(self, h):
        v = self._wind.get(h)
        if v is None:
            v = self._wind[h] = self.env.wind(h)
        return v

    def farm_of(self, bid, call):
        return self.flags["farm_for"].get((bid, product_of(call)))

    def mm_on(self, bid):
        return self.flags["mm_on"] and bid in self.flags["mm_berths"]


class _Checker:
    """접안(ALL_FAST = af) 가능 여부와 막힌 사유. 기존 규칙(야간 → 풍속 → 정비)의 순서는 그대로 두고,
    선박·육상 준비(검사 승인 → 탱크 공간)를 앞에, 새 시간 규칙(파고 → 안개 → 조석 → 예선·도선·계류 감독)을 뒤에 붙인다."""

    def __init__(self, cx, book, bid, cid, berth, vessel, call, d, rule_day, oos):
        self.cx, self.book, self.bid, self.cid, self.berth, self.call, self.d = cx, book, bid, cid, berth, call, d
        self.rule_day, self.oos, self.env, self.window = rule_day, oos, cx.env, cx.window
        self.oos_p = [(ts(w["from"]), ts(w["to"])) for w in oos]
        self.wind = cx.wind
        rv, relax = cx.rv, cx.relax
        self.wind_on = "WIND" not in relax
        self.cleared = None if "VETTING" in relax else rv.vetting_cleared(cid)
        need = tide_needed(berth, vessel) if berth.get("tidal_access") and "TIDE" not in relax else 0.0
        self.tide_need = need if 0 < need <= berth.get("tide_max_m", 0.0) + 1e-9 else 0.0
        self.wave_lim = None if "WAVE" in relax else rv.wave_limit(berth, "mooring", self.wind_on)
        self.fog = [] if "FOG" in relax else rv.fog
        self.tugs, self.pilots = rv.tug_req(vessel, berth), rv.pilot_req(vessel)
        self.mm = cx.mm_on(bid)
        self.marine = cx.check_tug or cx.check_pilot or self.mm
        self.tank_need = 0.0
        if "TANK" not in relax and cx.farm_of(bid, call) in book.farms:
            vol = call["quantity_bbl"] * BBL_TO_M3
            spec = rv.farm(cx.farm_of(bid, call))
            self.tank_need = min(rv.tank_ratio * vol, 0.9 * (spec["max_m3"] - spec["min_m3"]))
        self.detail = None

    def mm_window(self, af):
        return (add_m(af, -self.d["mooring"]), af) if self.mm else None

    def tide_ok(self, a, b):
        t = a
        while t <= b:
            if self.cx.rv.tide(t) < self.tide_need - 1e-9:
                return False
            t = add_m(t, self.cx.rv.tide_step)
        return self.cx.rv.tide(b) >= self.tide_need - 1e-9

    def ok(self, af):
        d = self.d
        a0 = add_m(af, -d["shift"])
        if self.cleared is not None and a0 < self.cleared:
            return False, "VETTING"
        if self.tank_need and not self.book.tank_ok(self.bid, self.cid, self.call, add_m(af, d["hose_on"] + d["ops_start"]), self.tank_need):
            return False, "TANK"
        op_start = add_m(af, -d["mooring"])
        if self.rule_day and not self.window.op_ok(op_start, af):
            return False, "NIGHT"
        if self.wind_on and any(self.wind(h) >= self.berth["mooring_wind_ms"] for h in hour_slots(a0, af)):
            return False, "WEATHER"
        if self.oos_p and any(a <= op_start < b for a, b in self.oos_p):
            return False, "OOS"
        if self.wave_lim is not None and any(self.cx.rv.wave(h, self.wind(h)) >= self.wave_lim for h in hour_slots(a0, af)):
            return False, "WAVE"
        if self.fog and _overlap_end(a0, af, self.fog):
            return False, "FOG"
        if self.tide_need and not self.tide_ok(a0, af):
            return False, "TIDE"
        if self.marine:
            why = self.book.blocked(a0, af, self.tugs, self.pilots, self.mm_window(af))
            if why:
                self.detail = why
                return False, "TUG"
        return True, None

    def jump(self, t, why):
        d = self.d
        if why == "OOS":
            return ceil_to(add_m(_in_oos(add_m(t, -d["mooring"]), self.oos), d["mooring"]), 15)
        if why == "VETTING":
            return max(add_m(t, 15), ceil_to(add_m(self.cleared, d["shift"]), 15))
        if why == "FOG":
            end = _overlap_end(add_m(t, -d["shift"]), t, self.fog)
            return max(add_m(t, 15), ceil_to(add_m(end, d["shift"]), 15))
        return add_m(t, 15)


def _find_all_fast(earliest, d, chk):
    t = ceil_to(earliest, 15)
    for _ in range(21 * 96):
        ok, why = chk.ok(t)
        if ok:
            return t
        t = chk.jump(t, why)
    raise RuntimeError(f"no mooring window for berth {chk.berth['id']} after {earliest}")


def _classify_wait(anch, aweigh, ready_aweigh, berth_reason, d, chk):
    """대기 사유: 선석이 비기 전은 점유(또는 정비), 그 뒤는 15분 단위로 왜 못 붙었는지 판정."""
    out = []
    if anch >= aweigh:
        return out
    cut = min(max(ready_aweigh, anch), aweigh)
    if anch < cut:
        out.append({"from": anch, "to": cut, "reason": berth_reason})
    t = cut
    while t < aweigh:
        nxt = min(add_m(t, 15), aweigh)
        chk.detail = None
        ok, why = chk.ok(ceil_to(add_m(t, d["shift"]), 15))
        reason = why or "OTHER"
        detail = chk.detail if reason == "TUG" else None
        if out and out[-1]["reason"] == reason and out[-1].get("detail") == detail and out[-1]["to"] == t:
            out[-1]["to"] = nxt
        else:
            w = {"from": t, "to": nxt, "reason": reason}
            if detail:
                w["detail"] = detail
            out.append(w)
        t = nxt
    return out


def _pump(start, volume, rate_at, breaks, env, limit, stopped=None, rec=None):
    t, rem, stops = start, volume, []
    stop = stopped or (lambda h: env.wind(h) >= limit)
    for _ in range(20000):
        if rem <= 1e-6:
            break
        h = floor_hour(t)
        if stop(h):
            h2 = h + timedelta(hours=1)
            while stop(h2):
                h2 += timedelta(hours=1)
            stops.append((t, h2))
            t = h2
            continue
        seg_end = h + timedelta(hours=1)
        for b in breaks:
            if t < b < seg_end:
                seg_end = b
        r = rate_at(t)
        cap = r * hours(t, seg_end)
        if cap >= rem:
            t1 = add_h(t, rem / r)
            if rec is not None:
                rec.append((t, t1, r))
            t = t1
            rem = 0
        else:
            rem -= cap
            if rec is not None:
                rec.append((t, seg_end, r))
            t = seg_end
    return t.replace(second=0, microsecond=0), stops


def _split_causes(a, b, cause_of):
    """하역 중단 [a, b)를 정시 슬롯별 원인(풍속·파고)으로 나눈다 — 사건은 하나, 집계만 원인별."""
    out = []
    for h in hour_slots(a, b):
        _add_seg(out, max(a, h), min(b, h + timedelta(hours=1)), cause_of(h))
    return out


def _add_seg(segs, a, b, val):
    if segs and segs[-1][1] == a and segs[-1][2] == val:
        segs[-1] = (segs[-1][0], b, val)
    else:
        segs.append((a, b, val))


def _pump_capped(t0, start, volume, rate_at, breaks, stopped, cause_of, caps):
    """공유 배관·탱크 한도를 지키며 하역(LINE-SHARED-CAP·TANK-ULLAGE). STEP_MIN 간격으로 남은 몫을 보고 속도를 줄인다.
    시간은 t0부터의 분(float)으로 계산하고 끝에 시각으로 바꾼다."""
    step = float(STEP_MIN)
    m = (start - t0).total_seconds() / 60.0
    brk = sorted((b - t0).total_seconds() / 60.0 for b in breaks)
    rem, cum = volume, 0.0
    stops, flow = [], []
    slow, capped = {"PIPELINE": 0.0, "SHORE_TANK": 0.0}, {"PIPELINE": 0.0, "SHORE_TANK": 0.0}
    hour_state, rate_cache = {}, {}

    def stop_cause(hidx):
        if hidx not in hour_state:
            h = t0 + timedelta(hours=hidx)
            hour_state[hidx] = cause_of(h) if stopped(h) else None
        return hour_state[hidx]

    def rate(mm):
        seg = sum(1 for b in brk if mm >= b)
        if seg not in rate_cache:
            rate_cache[seg] = rate_at(t0 + timedelta(minutes=mm))
        return rate_cache[seg]

    for _ in range(400000):
        if rem <= 1e-6:
            break
        hidx = int(m // 60)
        c = stop_cause(hidx)
        if c:
            h2 = hidx + 1
            while stop_cause(h2):
                h2 += 1
            _add_seg(stops, m, h2 * 60.0, c)
            m = h2 * 60.0
            continue
        k = int(m // step)
        seg_end = (k + 1) * step
        for b in brk:
            if m < b < seg_end:
                seg_end = b
        r = rate(m)
        dt = (seg_end - m) / 60.0
        lim, why = caps.limit_num(k, seg_end, cum, dt)
        rr = r
        if lim < r - 1e-9:
            rr = lim if lim > 0 else 0.0
            if rr <= 1e-6:
                _add_seg(stops, m, seg_end, why)
                m = seg_end
                continue
            slow[why] += dt * (1 - rr / r)
            capped[why] += dt
        amt = rr * dt
        if amt >= rem:
            m1 = m + rem / rr * 60.0
            _add_seg(flow, m, m1, rr)
            cum += rem
            rem = 0
            m = m1
        else:
            _add_seg(flow, m, seg_end, rr)
            cum += amt
            rem -= amt
            m = seg_end

    def at(x):
        return t0 + timedelta(minutes=x)

    done = at(m).replace(second=0, microsecond=0)
    return (done, [(at(a), at(b), c) for a, b, c in stops], [(at(a), at(b), r) for a, b, r in flow], slow, capped)


# ---------- 선박 한 척: 접안 계획 → 접안·하역 → 이안 ----------
def _plan_berthing(cx, book, bid, cid, st, pins):
    w, env, now = cx.w, cx.env, cx.now
    berth = w.berths[bid]
    d = DURATIONS[berth["type"]]
    oos = [] if "OOS" in cx.relax else env.oos(bid)
    call, vessel = w.calls[cid], w.vessels[w.calls[cid]["vessel_id"]]
    p = pins.get(cid, {})
    rule_day, day_rule_id = daytime_rule(berth, vessel, call)
    if "NIGHT" in cx.relax:
        rule_day = False

    def pin(t):
        return p[t]["ts"] if t in p else None

    def fl(x):
        return max(x, now)

    anch = pin("ANCHORED") or fl(env.eta(cid))
    anom = call.get("nor_anomaly") or {}
    nor = pin("NOR_TENDERED") or fl(add_m(anch, anom.get("tender_offset_minutes", call.get("nor_delay_minutes", 30))))
    retender = None
    if "retender_offset_minutes" in anom:
        retender = pin("NOR_RETENDERED") or fl(add_m(anch, anom["retender_offset_minutes"]))

    berth_free = st["free"]
    oos_end = _in_oos(berth_free, oos)
    berth_avail = max(berth_free, oos_end) if oos_end else berth_free
    berth_reason = "OOS" if oos_end and oos_end > berth_free else "CONGESTION"
    ready_aweigh = add_m(berth_avail, d["mooring"] - d["shift"])
    chk = _Checker(cx, book, bid, cid, berth, vessel, call, d, rule_day, oos)
    searched = False
    if pin("ALL_FAST"):
        af = pin("ALL_FAST")
        aweigh = pin("ANCHOR_AWEIGH") or add_m(af, -d["shift"])
    elif pin("ANCHOR_AWEIGH"):
        aweigh = pin("ANCHOR_AWEIGH")
        af = fl(add_m(aweigh, d["shift"]))
    else:
        earliest = max(add_m(berth_avail, d["mooring"]), add_m(anch, d["shift"]), add_m(now, d["shift"]))
        af = _find_all_fast(earliest, d, chk)
        aweigh = add_m(af, -d["shift"])
        searched = True
    return {"cid": cid, "berth": berth, "vessel": vessel, "call": call, "d": d, "p": p, "pin": pin, "fl": fl,
            "rule_day": rule_day, "day_rule_id": day_rule_id, "anch": anch, "nor": nor, "retender": retender,
            "berth_avail": berth_avail, "berth_reason": berth_reason, "ready_aweigh": ready_aweigh,
            "af": af, "aweigh": aweigh, "chk": chk, "searched": searched}


def _revalidate(bp):
    """다른 선박을 확정한 뒤에도 잠정 접안 시각이 유효한가. 확정은 제약을 조이기만 하므로 그 시각이 여전히 되면 그대로,
    안 되면 그 시각부터 다시 찾는다(그 전 시각은 이미 안 됐다)."""
    if not bp["searched"]:
        return bp
    ok, _ = bp["chk"].ok(bp["af"])
    if ok:
        return bp
    af = _find_all_fast(bp["af"], bp["d"], bp["chk"])
    return dict(bp, af=af, aweigh=add_m(af, -bp["d"]["shift"]))


def _berth_and_pump(cx, book, bid, st, bp, levers_all, n):
    env, rv, relax = cx.env, cx.rv, cx.relax
    cid, berth, vessel, call, d = bp["cid"], bp["berth"], bp["vessel"], bp["call"], bp["d"]
    pin, fl, af, aweigh, chk = bp["pin"], bp["fl"], bp["af"], bp["aweigh"], bp["chk"]
    wait = _classify_wait(bp["anch"], aweigh, bp["ready_aweigh"], bp["berth_reason"], d, chk)
    book.reserve(cid, "BERTHING", aweigh, af, chk.tugs, chk.pilots, chk.mm_window(af))

    product = product_of(call)
    mf = rv.manifold_of(bid, product)
    prev_product = st["manifold"].get(mf) if mf else None
    co = 0 if "CHANGEOVER" in relax else rv.changeover(prev_product, product)
    sm = 0 if "SAMPLING" in relax else rv.sampling(product)
    hose_on = pin("HOSES_CONNECTED") or fl(add_m(af, d["hose_on"]))
    ops_legacy = add_m(hose_on, d["ops_start"])
    co_ready = add_m(hose_on, co)          # 호스 연결 후 라인 치환
    smp_ready = add_m(co_ready, sm)        # 치환 뒤 first-foot 샘플 분석
    ops_on = pin("OPS_COMMENCED") or fl(max(ops_legacy, smp_ready))
    prep = {"CHANGEOVER": max(0.0, hours(ops_legacy, co_ready)),
            "SAMPLING": max(0.0, hours(max(ops_legacy, co_ready), smp_ready))}

    levers = [lv for lv in levers_all if lv["call_id"] == cid]
    pump_cap = vessel["pump_m3h"] if call["operation"] == "DISCHARGE" else float("inf")
    base_shore = float("inf") if "SHORE_RATE" in relax else (call.get("shore_rate_m3h") or float("inf"))
    shore_levers = [] if "SHORE_RATE" in relax else levers

    lever_steps = [(ts(lv["effective_from"]), lv["shore_rate_m3h"]) for lv in shore_levers]

    def rate_at(t, levers=lever_steps, pump_cap=pump_cap, base_shore=base_shore, berth=berth):
        shore = base_shore
        for eff, rate in levers:
            if t >= eff:
                shore = rate
        return min(pump_cap, shore, berth["max_rate_m3h"])

    wind = cx.wind
    limit = float("inf") if "WIND" in relax else berth["ops_stop_wind_ms"]
    ops_wave = None if "WAVE" in relax else rv.wave_limit(berth, "ops", "WIND" not in relax)
    if ops_wave is None:
        def stopped(h):
            return wind(h) >= limit
    else:
        def stopped(h):
            return wind(h) >= limit or rv.wave(h, wind(h)) >= ops_wave

    def cause_of(h):
        return "WIND" if wind(h) >= limit else "WAVE"

    volume = call["quantity_bbl"] * BBL_TO_M3
    breaks = [ts(lv["effective_from"]) for lv in shore_levers]
    caps = book.caps(bid, cid, call)
    slow, capped = {"PIPELINE": 0.0, "SHORE_TANK": 0.0}, {"PIPELINE": 0.0, "SHORE_TANK": 0.0}
    if caps is None:
        flow = []
        ops_done, stops2 = _pump(ops_on, volume, rate_at, breaks, env, limit, stopped, flow)
        stops3 = [(a, b, cause_of(floor_hour(a))) for a, b in stops2]
    else:
        ops_done, stops3, flow, slow, capped = _pump_capped(cx.w.t0, ops_on, volume, rate_at, breaks, stopped, cause_of, caps)
    if pin("OPS_COMPLETED"):
        ops_done = pin("OPS_COMPLETED")
        stops3 = [(a, b, c) for a, b, c in stops3 if a < ops_done]
        flow = [(a, min(b, ops_done), r) for a, b, r in flow if a < ops_done]
    else:
        ops_done = fl(ops_done)
    causes = []
    for a, b, c in stops3:
        causes += _split_causes(a, b, cause_of) if c in ("WIND", "WAVE") else [(a, b, c)]
    book.commit_flow(bid, call, flow)
    hose_off = pin("HOSES_DISCONNECTED") or fl(add_m(ops_done, d["hose_off"]))
    docs = pin("DOCS_ON_BOARD") or fl(add_m(hose_off, d["docs"]))
    if mf:
        st["manifold"][mf] = product
    return dict(bp, n=n, wait=wait, hose_on=hose_on, ops_on=ops_on, ops_done=ops_done, hose_off=hose_off, docs=docs,
                rate=rate_at(ops_on), volume=volume, stops3=stops3, causes=causes, flow=flow, slow=slow, capped=capped, prep=prep,
                product=product, manifold=mf, prev_product=prev_product, changeover_min=co, sampling_min=sm,
                unberth_from=docs)


def _unberth(cx, book, bid, pb):
    """이안(LAST_LINE): 안개 통제·예선·도선·계류 감독이 비는 가장 이른 시각. 막히는 것이 없으면 서류 + 이안 소요."""
    d, pin, now, chk = pb["d"], pb["pin"], cx.now, pb["chk"]
    dur = d["unberth"]
    delay_h, delay_reason = 0.0, None
    if pin("LAST_LINE"):
        last = pin("LAST_LINE")
    else:
        s0 = pb["docs"] if add_m(pb["docs"], dur) >= now else add_m(now, -dur)
        s = s0
        fog = chk.fog
        for _ in range(4000):
            why, until = None, None
            if fog:
                end = _overlap_end(s, add_m(s, dur), fog)
                if end:
                    why, until = "FOG", end
            if why is None and (cx.check_tug or cx.check_pilot or chk.mm):
                mm = (s, add_m(s, dur)) if chk.mm else None
                b = book.blocked(s, add_m(s, dur), chk.tugs, chk.pilots, mm)
                if b:
                    why, until = b, book.next_change(s, add_m(s, dur)) or add_m(s, 15)
            if why is None:
                break
            delay_reason = delay_reason or why
            s = max(until, add_m(s, 1))
        delay_h = hours(s0, s)
        last = add_m(s, dur)
    book.reserve(pb["cid"], "UNBERTHING", add_m(last, -dur), last, chk.tugs, chk.pilots,
                 (add_m(last, -dur), last) if chk.mm else None)
    return last, delay_h, delay_reason


def _result(cx, bid, pb, last, delay_h, delay_reason):
    now, p = cx.now, pb["p"]
    evs = [("ANCHORED", pb["anch"], None), ("NOR_TENDERED", pb["nor"], None), ("NOR_RECEIVED", pb["nor"], None)]
    if pb["retender"]:
        evs.append(("NOR_RETENDERED", pb["retender"], None))
    evs += [("ANCHOR_AWEIGH", pb["aweigh"], None), ("ALL_FAST", pb["af"], None), ("HOSES_CONNECTED", pb["hose_on"], None),
            ("OPS_COMMENCED", pb["ops_on"], None)]
    for a, b, c in pb["stops3"]:
        evs += [("OPS_STOPPED", a, STOP_REASON.get(c, "OTHER")), ("OPS_RESUMED", b, None)]
    evs += [("OPS_COMPLETED", pb["ops_done"], None), ("HOSES_DISCONNECTED", pb["hose_off"], None),
            ("DOCS_ON_BOARD", pb["docs"], None), ("LAST_LINE", last, None)]
    events = [{"type": t, "ts": x, "reason": r, "source": SOURCE.get(t), "projected": x > now and t not in p}
              for t, x, r in sorted(evs, key=lambda e: e[1])]
    chk, d = pb["chk"], pb["d"]
    return {
        "call_id": pb["cid"], "berth_id": bid, "seq": pb["n"], "events": events,
        "berth_free_from": pb["berth_avail"], "wait_reasons": pb["wait"],
        "daytime_rule": pb["rule_day"], "daytime_rule_id": pb["day_rule_id"],
        "rate_m3h": pb["rate"], "volume_m3": pb["volume"], "stops": [(a, b) for a, b, _ in pb["stops3"]],
        "etb": pb["af"], "etc": pb["hose_off"], "etd": last, "anchored": pb["anch"],
        # v3 자원·제약
        "product": pb["product"], "manifold": pb["manifold"], "prev_product": pb["prev_product"],
        "changeover_min": pb["changeover_min"], "sampling_min": pb["sampling_min"],
        "farm": cx.farm_of(bid, pb["call"]), "line": cx.flags["line_of"].get(bid),
        "flow": pb["flow"], "slow_h": pb["slow"], "capped_h": pb["capped"], "prep_h": pb["prep"], "stop_causes": pb["causes"],
        "tide_needed_m": tide_needed(pb["berth"], pb["vessel"]), "tide_window": bool(chk.tide_need),
        "maneuvers": [{"kind": "BERTHING", "from": pb["aweigh"], "to": pb["af"], "tugs": chk.tugs, "pilots": chk.pilots},
                      {"kind": "UNBERTHING", "from": add_m(last, -d["unberth"]), "to": last, "tugs": chk.tugs, "pilots": chk.pilots}],
        "unberth_delay_h": delay_h, "unberth_delay_reason": delay_reason,
    }


def _simulate_group(cx, group, seqmap, levers, pins):
    """묶음 안의 선석들을 시간 순으로 함께 흘린다. 선석 하나면 예전과 똑같이 순서대로 흐른다."""
    book = _Book(cx, group)
    queues = {b: list(seqmap.get(b, [])) for b in group}
    state = {b: {"free": cx.w.t0, "n": 0, "manifold": cx.rv.initial_manifolds(b)} for b in group}
    turnover = rules.param("PLAN-TURNOVER", "minutes")
    at_berth, out, tent = {}, {}, {}
    while True:
        jobs = []
        for i, b in enumerate(group):
            if b in at_berth:
                jobs.append((at_berth[b]["unberth_from"], 0, i, b, None))
            elif queues[b]:
                bp = tent.get(b)
                if bp is not None and bp["cid"] == queues[b][0]:
                    bp = _revalidate(bp)
                else:
                    bp = _plan_berthing(cx, book, b, queues[b][0], state[b], pins)
                tent[b] = bp
                jobs.append((bp["aweigh"], 1, i, b, bp))
        if not jobs:
            break
        job = jobs[0] if len(jobs) == 1 else min(jobs, key=lambda j: j[:3])
        b = job[3]
        if job[1] == 0:
            pb = at_berth.pop(b)
            last, delay_h, delay_reason = _unberth(cx, book, b, pb)
            out[pb["cid"]] = _result(cx, b, pb, last, delay_h, delay_reason)
            state[b]["free"] = add_m(last, turnover)
        else:
            queues[b].pop(0)
            tent.pop(b, None)
            state[b]["n"] += 1
            at_berth[b] = _berth_and_pump(cx, book, b, state[b], job[4], levers, state[b]["n"])
    return out


def simulate(world, plan, env, now, pins=None):
    pins = pins or {}
    cx = _Ctx(world, env, now)
    seqmap = plan["sequence"]
    levers = plan.get("levers", [])
    res = {}
    for group in world.berth_groups(list(seqmap)):
        res.update(_simulate_group(cx, group, seqmap, levers, pins))
    return {cid: res[cid] for seq in seqmap.values() for cid in seq}


# ---------- 실제 세계 점검 (replay.violations) ----------
def audit(world, truth):
    """실제 세계 결과가 v3 제약을 지켰는지 — 조석·파고·안개·검사 승인·예선·도선·계류 감독·배관·탱크. 위반 문장 목록."""
    from .world import TruthEnv  # 순환 import 회피
    rv, flags, env = world.resource_view(None), world.resource_flags(), TruthEnv(world)
    relax = world.relax
    out, man = [], []
    for cid, r in truth.items():
        berth, vessel = world.berths[r["berth_id"]], world.vessel_of(cid)
        d = DURATIONS[berth["type"]]
        af = r["etb"]
        a0 = next((e["ts"] for e in r["events"] if e["type"] == "ANCHOR_AWEIGH"), add_m(af, -d["shift"]))
        if a0 < world.t0:
            continue
        name = f"{vessel['name']} {berth['id']}"
        cleared = rv.vetting_cleared(cid)
        if "VETTING" not in relax and cleared and a0 < cleared:
            out.append(f"{name}: 검사 승인 전 이동 {a0:%m/%d %H:%M} (승인 {cleared:%m/%d %H:%M})")
        need = tide_needed(berth, vessel) if berth.get("tidal_access") else 0.0
        if "TIDE" not in relax and 0 < need <= berth.get("tide_max_m", 0.0) + 1e-9:
            t = a0
            while t <= af:
                if rv.tide(t) < need - 1e-6:
                    out.append(f"{name}: 조위 부족 중 이동 {t:%m/%d %H:%M} (필요 {need:.2f}m, 조위 {rv.tide(t):.2f}m)")
                    break
                t = add_m(t, rv.tide_step)
        wl = rv.wave_limit(berth, "mooring", False)
        if "WAVE" not in relax and wl is not None:
            if any(rv.wave(h, env.wind(h)) >= wl for h in hour_slots(a0, af)):
                out.append(f"{name}: 파고 한계 초과 중 계류 {af:%m/%d %H:%M}")
        if "FOG" not in relax:
            for kind, a, b in ((m["kind"], m["from"], m["to"]) for m in r.get("maneuvers", [])):
                if a >= world.t0 and _overlap_end(a, b, rv.fog):
                    out.append(f"{name}: 시정 통제 중 {'접안' if kind == 'BERTHING' else '이안'} {a:%m/%d %H:%M}")
        for m in r.get("maneuvers", []):
            mm = flags["mm_on"] and r["berth_id"] in flags["mm_berths"]
            man.append({"call": cid, "name": name, "kind": m["kind"], "a": m["from"], "b": m["to"], "tugs": m["tugs"], "pilots": m["pilots"],
                        "mm": ((add_m(m["to"], -d["mooring"]) if m["kind"] == "BERTHING" else m["from"]), m["to"]) if mm else None})
    for m in man:
        if m["a"] < world.t0:
            continue
        pts = [m["a"]] + [x["a"] for x in man if m["a"] < x["a"] < m["b"]] + [x for x in rv.tug_breaks + rv.pilot_breaks if m["a"] < x < m["b"]]
        for p in pts:
            act = [x for x in man if x["a"] <= p < x["b"]]
            if "TUG" not in relax and sum(x["tugs"] for x in act) > rv.tug_cap(p):
                out.append(f"{m['name']}: 예선 부족 중 이동 {p:%m/%d %H:%M} (소요 {sum(x['tugs'] for x in act)} > 가용 {rv.tug_cap(p)})")
                break
            if "PILOT" not in relax and sum(x["pilots"] for x in act) > rv.pilot_cap(p):
                out.append(f"{m['name']}: 도선사 부족 중 이동 {p:%m/%d %H:%M}")
                break
        if m["mm"] and "MOORING_MASTER" not in relax:
            for x in man:
                if x is not m and x["mm"] and x["call"] != m["call"] and x["mm"][0] < m["mm"][1] and x["mm"][1] > m["mm"][0] and x["a"] < m["a"]:
                    out.append(f"{m['name']}: 계류 감독 중복 {m['mm'][0]:%m/%d %H:%M}")
                    break
    out += [f"{x}" for x in flow_checks(world, truth)]
    return out


def flow_checks(world, truth):
    """공유 배관 동시 유량·탱크 상하한을 결과 흐름(flow)으로 다시 계산해 넘침을 찾는다."""
    rv, flags, relax = world.resource_view(None), world.resource_flags(), world.relax
    out = []
    t0, n = world.t0, GRID_DAYS * 24 * 60 // STEP_MIN
    if "LINE" not in relax:
        for line in rv.lines:
            u = _Usage(t0, n)
            for r in truth.values():
                if r.get("line") == line["id"]:
                    u.add(r.get("flow", []))
            peak = max(u.u) if u.u else 0.0
            if peak > line["capacity_m3h"] * 1.02 + 1:
                out.append(f"{line['id']}: 동시 유량 {peak:,.0f} > 한도 {line['capacity_m3h']:,} m3/h")
    if "TANK" not in relax:
        for spec in rv.farms:
            f = _Farm(spec, t0, n)
            for cid, r in truth.items():
                if r.get("farm") == spec["id"]:
                    sign = 1 if world.calls[cid]["operation"] == "DISCHARGE" else -1
                    f.add(r.get("flow", []), sign)
            f._calc()
            hi, lo = max(f.level), min(f.level)
            tol = 0.005 * spec["max_m3"]
            if hi > spec["max_m3"] + tol:
                out.append(f"{spec['id']}: 탱크 상한 초과 {hi:,.0f} > {spec['max_m3']:,} m3")
            if lo < spec["min_m3"] - tol:
                out.append(f"{spec['id']}: 탱크 하한 미달 {lo:,.0f} < {spec['min_m3']:,} m3")
    return out
