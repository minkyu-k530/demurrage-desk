"""REPLAY — 정책 경쟁(Phase 21)과 Historical Replay(Phase 22).

모든 정책은 결정 시점(t0 + ETA·예보·부두제약·자원 통보 발행 시각)마다 **그 시점에 알던 정보만**(KnownEnv: 발행된 ETA·예보·부두제약,
관측은 과거만) 써서 계획을 정하고, 계획은 그 시각부터 새 계획 버전으로 붙는다(승인과 같은 방식). 결과는 실제 세계(truth)로 채점한다.
이미 이동·접안을 시작한 선박은 바꾸지 않는다.
"""
from __future__ import annotations

import copy
import os
import shutil
import tempfile
import time

from . import sim
from .optimize import (Evaluator, arrival_known, completed, first_event, greedy, laytime_deadline, lever_options, optimize,
                       positions, started)
from .timeutil import DayWindow, add_h, add_m, floor_hour, hour_slots, hours, iso, round_usd, ts
from .world import KnownEnv, TruthEnv, first_pins

POLICIES = [
    {"id": "CURRENT_RULE", "label": "현업 Rule (SEAGATE v1 유지)",
     "desc": "선종별 FCFS로 만든 기준 계획(VLCC·수에즈막스→SBM, 아프라막스→SK8, 제품선→SK7)을 끝까지 유지한다. 재계획 없음."},
    {"id": "FCFS", "label": "FCFS (도착 순)",
     "desc": "결정 시점마다 아직 이동 전인 선박을 그때 알던 도착 시각 순으로 세우고, 가장 빨리 접안할 수 있는 적합 선석 맨 뒤에 붙인다."},
    {"id": "RATE", "label": "체선료율 우선", "desc": "요율이 높은 선박부터 같은 방식으로 붙인다."},
    {"id": "LAYTIME_RISK", "label": "레이타임 임박 우선",
     "desc": "NOR + 통지시간 + 허용 레이타임(대기가 모두 산입될 때 체선에 들어가는 시각)이 이른 선박부터 붙인다."},
    {"id": "OPTIMIZER", "label": "Optimizer (완전 탐색)",
     "desc": "결정 시점마다 그때 알던 정보로 선석 배정·순서·탱크 레버의 모든 조합을 비교해 예상 체선료가 가장 작은 안을 고른다."},
    {"id": "RISK_AWARE", "label": "Risk-aware Optimizer",
     "desc": "같은 탐색을 기준 예측 + 오차 시나리오(폭풍 종료 ±3h, 도착 전 선박 ETA ±3h)의 가중 평균 체선료로 평가한다(기준 40%, 나머지 균등)."},
    {"id": "AGENT_HITL", "label": "Agent + 사람 승인",
     "desc": "에이전트가 영향 설명 항목에 낸 1순위 옵션을 담당자가 생성 시각에 승인했다고 가정한다(작업함과 같은 경로)."},
]
LABEL = {p["id"]: p["label"] for p in POLICIES}


# ---------- 결정 시점의 정보 ----------
class ShiftedEnv:
    """알던 정보(KnownEnv)를 흔든 환경 — 도착 전 선박 ETA 이동, 미래 풍속 덮어쓰기."""

    def __init__(self, base, eta_shift_h=0.0, arrived=(), wind_override=None):
        self.base, self.eta_shift_h, self.arrived, self.wind_override = base, eta_shift_h, set(arrived), wind_override or {}

    def eta(self, cid):
        e = self.base.eta(cid)
        return add_h(e, self.eta_shift_h) if self.eta_shift_h and cid not in self.arrived else e

    def wind(self, h):
        v = self.wind_override.get(iso(h))
        return self.base.wind(h) if v is None else v

    def oos(self, bid):
        return self.base.oos(bid)


def storm_override(env, t, delta_h, limit=15.0, horizon_h=72):
    """t 이후 예보의 폭풍(접안 한계 이상 구간)을 delta_h만큼 늘리거나 줄인 풍속표. 폭풍이 없으면 None."""
    start = floor_hour(t)
    hrs = [add_h(start, k) for k in range(1, horizon_h + 1)]
    vals = {h: env.wind(h) for h in hrs}
    storm = [h for h in hrs if vals[h] >= limit]
    if not storm:
        return None
    peak = max(storm, key=lambda h: (vals[h], -hrs.index(h)))
    out = {}
    for h in hrs:
        if h < peak:
            continue
        if delta_h > 0:
            out[iso(h)] = vals[peak] if h < add_h(peak, delta_h) else env.wind(add_h(h, -delta_h))
        else:
            out[iso(h)] = env.wind(add_h(h, -delta_h))
    return out


def risk_envs(world, t, pins, movable):
    base = KnownEnv(world, t)
    arrived = {c for c in world.calls if "ANCHORED" in pins.get(c, {})}
    envs = [(base, 0.4)]
    if any(c not in arrived for c in movable):
        envs += [(ShiftedEnv(base, -3, arrived), 0.15), (ShiftedEnv(base, 3, arrived), 0.15)]
    for d in (-3, 3):
        o = storm_override(base, t, d)
        if o:
            envs.append((ShiftedEnv(base, wind_override=o), 0.15))
    total = sum(w for _, w in envs)
    return [(e, w / total) for e, w in envs]


def decision_points(world):
    pts = {world.t0: {"t": world.t0, "trigger": "INIT", "label": "기준 계획 수립 (t0)"}}
    for e in world.info_events(world.base_history()):
        if e["kind"] not in ("ETA", "FORECAST", "CONSTRAINT", "RESOURCE"):
            continue
        label = f"{world.vessel_of(e['call_id'])['name']} {e['label']}" if e["kind"] == "ETA" else e["label"]
        if e["t"] in pts:
            pts[e["t"]]["label"] += f" · {label}"
        else:
            pts[e["t"]] = {"t": e["t"], "trigger": e["kind"], "label": label}
    return [pts[t] for t in sorted(pts)]


def plan_at(history, t):
    cur = history[0]
    for h in history:
        if ts(h["effective_from"]) <= t:
            cur = h
    return cur


def state_at(world, history, t):
    """결정 직전 상태: 그때까지의 실제 사건(pins), 바꿀 수 있는 선박, 현재 계획."""
    prior = [h for h in history if ts(h["effective_from"]) < t] or history[:1]
    truth = world.truth(prior)
    pins = {cid: first_pins(r["events"], t) for cid, r in truth.items()}
    current = copy.deepcopy(plan_at(history, t)["plan"])
    begun = started(truth, t)
    movable = [c for b in world.berths for c in current["sequence"].get(b, []) if c not in begun]
    return {"truth": truth, "pins": pins, "current": current, "movable": movable, "done": completed(truth, t)}


def decide(world, policy, t, history):
    st = state_at(world, history, t)
    cur, movable, pins = st["current"], st["movable"], st["pins"]
    env = KnownEnv(world, t)
    ev = Evaluator(world, t, env, pins)
    if policy in ("FCFS", "RATE", "LAYTIME_RISK"):
        if policy == "FCFS":
            key = lambda c: (arrival_known(world, env, pins, c), c)  # noqa: E731
        elif policy == "RATE":
            key = lambda c: (-float(world.terms(c)["rate_usd_day"]), arrival_known(world, env, pins, c), c)  # noqa: E731
        else:
            key = lambda c: (laytime_deadline(world, env, pins, c), arrival_known(world, env, pins, c), c)  # noqa: E731
        plan = greedy(world, ev, cur, movable, sorted(movable, key=key))
        cost = ev.plan(plan["sequence"], plan["levers"])[0]
        return plan, {"projected_usd": cost, "state": st, "evaluator": ev}
    levers = lever_options(world, t, cur.get("levers", []), st["done"])
    scen = [(ev, 1.0)] if policy == "OPTIMIZER" else [(Evaluator(world, t, e, pins), w) for e, w in risk_envs(world, t, pins, movable)]
    res = optimize(world, t, scen, cur, movable, levers)
    return res["plan"], {"projected_usd": ev.plan(res["plan"]["sequence"], res["plan"]["levers"])[0], "state": st, "evaluator": ev}


def diff_plan(world, current, new):
    cur, nxt = positions(current["sequence"]), positions(new["sequence"])
    order = list(world.berths)
    moves = []
    for cid in sorted(nxt, key=lambda c: (order.index(nxt[c][0]), nxt[c][1])):
        if cur.get(cid) != nxt[cid]:
            a, b = cur.get(cid), nxt[cid]
            src = f"{a[0]} #{a[1] + 1}" if a else "신규"
            moves.append(f"{world.vessel_of(cid)['name']}: {src} → {b[0]} #{b[1] + 1}")
    have = {x.get("id") for x in current.get("levers", [])}
    titles = {o["id"]: o["title"] for o in world.plan_v1.get("shore_options", [])}
    levers = [titles.get(x.get("id"), x.get("id")) for x in new.get("levers", []) if x.get("id") not in have]
    return moves, levers


# ---------- 채점 ----------
def violations(world, truth):
    window, env, out = DayWindow(**world.daytime), TruthEnv(world), []
    for cid, r in truth.items():
        berth, vessel, call = world.berths[r["berth_id"]], world.vessel_of(cid), world.calls[cid]
        ok, fails = sim.compatibility(berth, vessel, call)
        out += [f"{vessel['name']} {berth['id']}: {f['msg']} ({f['rule']})" for f in fails]
        d = sim.DURATIONS[berth["type"]]
        af = r["etb"]
        if sim.daytime_rule(berth, vessel, call)[0] and not window.op_ok(add_m(af, -d["mooring"]), af):
            out.append(f"{vessel['name']} {berth['id']}: 야간 계류·접안 {iso(af)}")
        if any(env.wind(h) >= berth["mooring_wind_ms"] for h in hour_slots(add_m(af, -d["shift"]), af)):
            out.append(f"{vessel['name']} {berth['id']}: 풍속 한계 초과 중 접안 {iso(af)}")
        for w in env.oos(berth["id"]):
            if ts(w["from"]) <= add_m(af, -d["mooring"]) < ts(w["to"]):
                out.append(f"{vessel['name']} {berth['id']}: 정비 중 접안 {iso(af)}")
    return out + sim.audit(world, truth)  # v3: 조석·파고·안개·검사 승인·예선·도선·계류 감독·배관·탱크


def metrics(world, history):
    truth = world.truth(history)
    ev = world.evaluate(truth, world.t_end, alternatives=False)
    horizon = hours(world.t0, world.t_end)
    occ = {b: 0.0 for b in world.berths}
    per_call, total, wait = [], 0.0, 0.0
    for cid in sorted(ev, key=lambda c: (list(world.berths).index(ev[c]["sim"]["berth_id"]), ev[c]["sim"]["seq"])):
        r, st = ev[cid]["sim"], ev[cid]["statement"]
        anch, aw = first_event(r["events"], "ANCHORED"), first_event(r["events"], "ANCHOR_AWEIGH")
        af, ll = first_event(r["events"], "ALL_FAST"), first_event(r["events"], "LAST_LINE")
        w_h = max(0.0, hours(anch, aw)) if anch and aw else 0.0
        wait += w_h
        if af and ll:
            a, b = max(af, world.t0), min(ll, world.t_end)
            if b > a:
                occ[r["berth_id"]] += hours(a, b)
        amt = st.get("amount_usd", 0.0)
        total += amt
        per_call.append({"call_id": cid, "vessel": world.vessel_of(cid)["name"], "berth_id": r["berth_id"], "seq": r["seq"],
                         "amount_usd": round_usd(amt), "demurrage_h": round(st.get("demurrage_h", 0.0), 3),
                         "waiting_h": round(w_h, 3), "etb": iso(af)})
    v = violations(world, truth)
    return {"total_usd": round_usd(total), "waiting_h": round(wait, 2), "violations": len(v), "violation_details": v,
            "utilization": {b: round(x / horizon, 3) for b, x in occ.items()}, "per_call": per_call}


def initial_history(world, label="기준 계획 (현업 Rule)"):
    return [{"version": 1, "effective_from": iso(world.t0), "source": "SEAGATE Berthing Schedule v1 (현업 Rule)", "label": label,
             "plan": {"sequence": copy.deepcopy(world.plan_v1["sequence"]), "levers": []}}]


def replay(world, policy, stop_before=None):
    """정책 하나를 결정 시점마다 적용해 계획 버전 이력을 만든다. stop_before 시각의 결정 직전에서 멈출 수 있다."""
    t_start = time.perf_counter()
    hist = initial_history(world)
    decisions, changes = [], 0
    for dp in decision_points(world):
        t = dp["t"]
        if stop_before is not None and t >= stop_before:
            break
        if policy == "CURRENT_RULE":
            decisions.append({"t": iso(t), "trigger": dp["trigger"], "summary": "계획 유지 (현업 Rule은 재계획하지 않음)",
                              "moves": [], "levers": [], "projected_usd": None})
            continue
        current = copy.deepcopy(plan_at(hist, t)["plan"])
        new, info = decide(world, policy, t, hist)
        moves, levers = diff_plan(world, current, new)
        summary = "; ".join(moves + levers) or "변경 없음"
        if moves or levers:
            if t == world.t0:
                hist[0] = dict(hist[0], plan=new, label=f"{LABEL[policy]} 초기 계획", source=f"{LABEL[policy]} (t0)")
            else:
                hist.append({"version": len(hist) + 1, "effective_from": iso(t), "source": f"{LABEL[policy]} 재계획",
                             "label": summary[:80], "plan": new})
                changes += len(moves) + len(levers)
        decisions.append({"t": iso(t), "trigger": dp["trigger"], "summary": summary, "moves": moves, "levers": levers,
                          "projected_usd": info["projected_usd"]})
    out = {"policy": policy, "label": LABEL[policy], "history": hist, "decisions": decisions, "plan_changes": changes}
    if stop_before is None:
        out.update(metrics(world, hist))
    out["compute_ms"] = round((time.perf_counter() - t_start) * 1000, 1)
    return out


def hindsight(world):
    """미래를 다 아는 사후 최적 — t0에 실제 도착·관측 풍속·실제 부두제약으로 한 번 최적화. 실현 불가능한 하한."""
    t_start = time.perf_counter()
    t = world.t0
    ev = Evaluator(world, t, TruthEnv(world), {})
    current = {"sequence": copy.deepcopy(world.plan_v1["sequence"]), "levers": []}
    movable = [c for b in world.berths for c in current["sequence"].get(b, [])]
    res = optimize(world, t, [(ev, 1.0)], current, movable, lever_options(world, t, [], set()))
    hist = [dict(initial_history(world)[0], plan=res["plan"], label="사후 최적 (hindsight)")]
    m = metrics(world, hist)
    moves, levers = diff_plan(world, current, res["plan"])
    return {"total_usd": m["total_usd"], "waiting_h": m["waiting_h"], "per_call": m["per_call"], "violations": m["violations"],
            "plan": "; ".join(moves + levers) or "기준 계획과 같음", "compute_ms": round((time.perf_counter() - t_start) * 1000, 1),
            "note": "미래(실제 도착·관측 풍속·실제 부두제약)를 모두 아는 사후 최적 — 실현 불가능한 하한. 정보 가치의 상한을 보여 준다."}


def agent_hitl(world):
    """작업함 경로 그대로: 영향 설명 항목의 1순위 옵션을 생성 시각에 승인한다. 데이터 파일로 만든 기준 세계에서만 쓴다."""
    from .service import Desk  # 순환 import 회피
    t_start = time.perf_counter()
    tmp = tempfile.mkdtemp(prefix="desk-hitl-")
    try:
        desk = Desk(os.path.join(tmp, "state.json"))
        done, decisions = set(), []
        while True:
            items = desk.agent.timeline(desk.history)["items"]
            cands = [i for i in items if i["kind"] == "IMPACT" and i.get("options") and i["options"]["best"] and i["id"] not in done]
            if not cands:
                break
            it = cands[0]
            done.add(it["id"])
            opt = desk.item(it["id"], it["created_at"])["options"]["best"][0]
            if opt.get("approvable"):
                desk.decide(it["id"], "APPROVE_OPTION", it["created_at"], opt["id"], note="검증 리플레이: 1순위 옵션 승인", actor="validation")
                decisions.append({"t": it["created_at"], "trigger": "AGENT", "summary": opt["title"], "moves": opt.get("moves", []),
                                  "levers": [lv["title"] for lv in opt.get("levers", [])], "projected_usd": opt.get("total_usd"),
                                  "item_id": it["id"]})
        hist = desk.history
        m = metrics(desk.world, hist)
        changes = sum(len(d["moves"]) + len(d["levers"]) for d in decisions)
        return dict(m, policy="AGENT_HITL", label=LABEL["AGENT_HITL"], decisions=decisions, plan_changes=changes,
                    compute_ms=round((time.perf_counter() - t_start) * 1000, 1))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def public(result):
    """API 응답용 — 내부 이력(history)은 뺀다."""
    keys = ("policy", "label", "total_usd", "waiting_h", "violations", "violation_details", "plan_changes", "utilization",
            "compute_ms", "per_call", "decisions")
    return {k: result[k] for k in keys if k in result}
