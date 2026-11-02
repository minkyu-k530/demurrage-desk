"""OPTIMIZE — 결정 시점 t의 접안계획 최적화와 비교용 규칙(Phase 20·21).

결정변수: 아직 이동·접안을 시작하지 않은 선박의 선석 배정과 선석별 순서 + 운영 레버(탱크 추가 배정).
하드 제약: sim.compatibility(DWT·SBM 하한·흘수+UKC·LOA·화물) + sim이 지키는 시간 규칙(주간·풍속·정비·전환).
목적함수: 예상 체선료 합(USD) → 같으면 대기시간 합 → 같으면 기존 계획 대비 변경 수.
공유 자원(배관·탱크·예선·계류 감독)이 구속될 수 있는 선석끼리는 묶음(world.berth_groups)이고, 묶음끼리는 서로 독립이므로
(묶음, 선석별 순서, 레버) 단위 평가를 캐시하고 묶음별 최적 순서를 조합한다. 묶을 것이 없으면 묶음 = 선석 하나(예전과 같다).
6~9척 규모라 완전 탐색이 정확하고 빠르다. 운영 규모에서는 CP-SAT·MIP로 바꾼다.
"""
from __future__ import annotations

import itertools

from . import clock, sim
from .timeutil import add_h, add_m, hours, iso, round_usd, ts

SBM_CLASS_CARGO = "CRUDE"


def first_event(events, typ):
    return next((e["ts"] for e in events if e["type"] == typ), None)


def _statement(world, cid, r, t):
    """예상 계산서(금액·레이타임 개시·만료). 같은 사건·같은 대기 사유면 같은 결과라 world 단위로 기억한다
    (공유 자원 묶음은 한 번에 여러 선박을 흘리므로, 바뀌지 않은 선박의 계산서를 다시 만들지 않는다)."""
    ctx = world.context_for(r)
    log = ctx.get("pumping_log")
    key = (cid, tuple((e["type"], e["ts"], e.get("reason")) for e in r["events"]), ctx["daytime_rule"],
           tuple((w["from"], w["to"], w["reason"], w.get("detail")) for w in r["wait_reasons"]),
           None if log is None else bool(log.get("shore_restriction")))
    memo = world._stmt
    if key not in memo:
        if len(memo) > 20000:
            memo.clear()
        evs = [dict(e, projected=e["ts"] > t) for e in r["events"]]
        st = clock.compute(evs, world.terms(cid), ctx, alternatives=False)
        memo[key] = {"amount_usd": st.get("amount_usd", 0.0), "laytime_expiry": st.get("laytime_expiry"),
                     "laytime_start": st.get("laytime_start")}
    return memo[key]


class Evaluator:
    """(world, t, env, pins) 아래에서 계획의 예상 체선료를 계산한다. 묶음(선석 하나 또는 공유 자원 묶음)별 결과를 캐시한다."""

    def __init__(self, world, t, env, pins):
        self.w, self.t, self.env, self.pins = world, t, env, pins
        self.cache = {}
        self.groups = [tuple(g) for g in world.berth_groups(list(world.berths))]
        self.group_of = {b: g for g in self.groups for b in g}

    def group(self, g, seq_map, levers):
        """묶음 g의 선석별 순서(seq_map에서 꺼냄)로 함께 흘린 결과 {call_id: {...}}."""
        seqs = tuple(tuple(seq_map.get(b) or ()) for b in g)
        calls = {c for q in seqs for c in q}
        lv = tuple(sorted((x["call_id"], x["shore_rate_m3h"], x["effective_from"]) for x in levers if x["call_id"] in calls))
        key = (g, seqs, lv)
        if key not in self.cache:
            sub = {"sequence": {b: list(q) for b, q in zip(g, seqs)}, "levers": [x for x in levers if x["call_id"] in calls]}
            res = sim.simulate(self.w, sub, self.env, now=self.t, pins=self.pins)
            per = {}
            for cid, r in res.items():
                st = _statement(self.w, cid, r, self.t)
                aweigh = first_event(r["events"], "ANCHOR_AWEIGH") or r["etb"]
                per[cid] = {"amount": st.get("amount_usd", 0.0), "etb": r["etb"], "etd": r["etd"],
                            "wait_h": max(0.0, hours(r["anchored"], aweigh)),
                            "expiry": st.get("laytime_expiry"), "start": st.get("laytime_start")}
            self.cache[key] = per
        return self.cache[key]

    def berth(self, bid, seq, levers):
        """선석 하나만 채운 묶음 평가(묶음의 다른 선석은 비어 있다고 본다)."""
        return self.group(self.group_of.get(bid, (bid,)), {bid: seq}, levers)

    def plan(self, seq_map, levers):
        per, done = {}, set()
        for bid in seq_map:
            g = self.group_of.get(bid, (bid,))
            if g in done:
                continue
            done.add(g)
            if any(seq_map.get(b) for b in g):
                per.update(self.group(g, seq_map, levers))
        return round_usd(sum(x["amount"] for x in per.values())), sum(x["wait_h"] for x in per.values()), per


def compatible_berths(world, cid):
    vessel, call = world.vessel_of(cid), world.calls[cid]
    return [b for b, berth in world.berths.items() if sim.compatibility(berth, vessel, call)[0]]


def started(truth, t):
    """t까지 이동·접안을 시작했거나 하역을 마친 선박 — 계획을 바꿀 수 없다."""
    return {cid for cid, r in truth.items() if any(e["type"] in ("ANCHOR_AWEIGH", "ALL_FAST") and e["ts"] <= t for e in r["events"])}


def completed(truth, t):
    return {cid for cid, r in truth.items() if any(e["type"] == "OPS_COMPLETED" and e["ts"] <= t for e in r["events"])}


def positions(seq_map):
    return {cid: (bid, i) for bid, seq in seq_map.items() for i, cid in enumerate(seq)}


def lever_options(world, t, base_levers, done):
    out = []
    for lv in world.plan_v1.get("shore_options", []):
        if lv["call_id"] in done or any(x.get("id") == lv["id"] for x in base_levers):
            continue
        eff = max(t, ts(lv.get("available_from") or iso(t)))
        out.append({"id": lv["id"], "call_id": lv["call_id"], "shore_rate_m3h": lv["shore_rate_m3h"], "effective_from": iso(eff),
                    "title": lv["title"], "owner": lv.get("owner")})
    return out


def _subsets(items):
    for n in range(len(items) + 1):
        yield from itertools.combinations(items, n)


def optimize(world, t, scenarios, current, movable, lever_opts):
    """완전 탐색. scenarios = [(Evaluator, weight)] — 하나면 결정론적 최적, 여럿이면 기대값 최적(Risk-aware).

    current = 지금 계획 {"sequence", "levers"}. movable = 바꿀 수 있는 선박 목록.
    반환: {"plan", "cost", "wait_h", "changes", "per_call"(첫 시나리오 기준)}
    """
    berths = list(world.berths)
    groups = [tuple(g) for g in world.berth_groups(berths)]
    movable = [c for c in movable if c in positions(current["sequence"])]
    fixed = {b: [c for c in current["sequence"].get(b, []) if c not in movable] for b in berths}
    cur_pos = positions(current["sequence"])
    compat = {c: compatible_berths(world, c) or [cur_pos[c][0]] for c in movable}
    base_levers = list(current.get("levers", []))
    best = None
    for lever_set in _subsets(lever_opts):
        levers = base_levers + [{k: lv[k] for k in ("id", "call_id", "shore_rate_m3h", "effective_from")} for lv in lever_set]
        memo = {}

        def group_best(g, subsets, levers=levers, memo=memo):
            """묶음 g에 배정된 선박(선석별 subset)의 모든 순서 조합 중 최선. 선석 하나면 그 선석의 순열 탐색."""
            key = (g, subsets)
            if key not in memo:
                top = None
                for perms in itertools.product(*[itertools.permutations(sorted(sub)) for sub in subsets]):
                    seqs = {b: fixed[b] + list(perm) for b, perm in zip(g, perms)}
                    cost = wait = 0.0
                    for ev, wgt in scenarios:
                        total, w_h, _ = ev.plan(seqs, levers)
                        cost += wgt * total
                        wait += wgt * w_h
                    changes = sum(1 for b, sub in zip(g, subsets) for i, c in enumerate(seqs[b]) if c in sub and cur_pos.get(c) != (b, i))
                    score = (round(cost, 2), round(wait, 3), changes)
                    if top is None or score < top[0]:
                        top = (score, seqs)
                memo[key] = top
            return memo[key]

        for combo in itertools.product(*[compat[c] for c in movable]):
            parts = [group_best(g, tuple(frozenset(c for c, bb in zip(movable, combo) if bb == b) for b in g)) for g in groups]
            score = (round(sum(p[0][0] for p in parts), 2), round(sum(p[0][1] for p in parts), 3),
                     sum(p[0][2] for p in parts) + len(lever_set))
            if best is None or score < best[0]:
                best = (score, {b: p[1][b] for g, p in zip(groups, parts) for b in g}, levers, lever_set)
    score, seq_map, levers, lever_set = best
    _, _, per = scenarios[0][0].plan(seq_map, levers)
    return {"plan": {"sequence": seq_map, "levers": levers}, "cost": score[0], "wait_h": score[1], "changes": score[2],
            "per_call": per, "lever_set": list(lever_set)}


def greedy(world, ev, current, movable, order):
    """규칙형 배정: order 순서로 한 척씩, 가장 빨리 접안할 수 있는 적합 선석의 맨 뒤에 붙인다."""
    berths = list(world.berths)
    seq_map = {b: [c for c in current["sequence"].get(b, []) if c not in movable] for b in berths}
    levers = list(current.get("levers", []))
    for c in order:
        best = None
        for b in compatible_berths(world, c) or [positions(current["sequence"])[c][0]]:
            trial = dict(seq_map, **{b: seq_map[b] + [c]})
            per = ev.group(ev.group_of.get(b, (b,)), trial, levers)
            key = (per[c]["etb"], round(sum(x["amount"] for x in per.values()), 2), berths.index(b))
            if best is None or key < best[0]:
                best = (key, b)
        seq_map[best[1]].append(c)
    return {"sequence": seq_map, "levers": levers}


def arrival_known(world, env, pins, cid):
    p = pins.get(cid, {})
    return p["ANCHORED"]["ts"] if "ANCHORED" in p else env.eta(cid)


def laytime_deadline(world, env, pins, cid):
    """NOR + 통지시간 + 허용 레이타임 — 대기가 전부 산입될 때 체선에 들어가는 가장 이른 시각."""
    p = pins.get(cid, {})
    nor = (p.get("NOR_RECEIVED") or p.get("NOR_TENDERED") or {}).get("ts")
    if nor is None:
        call = world.calls[cid]
        nor = add_m(arrival_known(world, env, pins, cid), call.get("nor_delay_minutes", 30))
    terms = world.terms(cid)
    return add_h(nor, float(terms.get("notice_hours", 6)) + float(terms["laytime_hours"]))


def rule_sequence(world):
    """현업 Rule(가정): 선종별 FCFS. SBM 대상(원유·SBM 하한 이상)은 SBM, 나머지 원유선은 부두, 제품선은 SK7 우선.
    같은 그룹에서는 t0에 알던 ETA 순으로, 정비 중이 아니고 가장 빨리 비는 선석에 붙인다."""
    from .world import KnownEnv
    env = KnownEnv(world, world.t0)
    order = sorted(world.calls, key=lambda c: (env.eta(c), c))
    free = {b: world.t0 for b in world.berths}
    seq = {b: [] for b in world.berths}
    for cid in order:
        call, vessel = world.calls[cid], world.vessel_of(cid)
        compat = [b for b in compatible_berths(world, cid)]
        sbm = [b for b in compat if world.berths[b]["type"] == "SBM"]
        piers = [b for b in compat if world.berths[b]["type"] != "SBM"]
        if call["cargo_class"] == SBM_CLASS_CARGO and sbm:
            group = sbm
        elif call["cargo_class"] == SBM_CLASS_CARGO:
            group = piers
        else:  # 제품선: 원유를 받지 않는 제품 부두(SK7)를 먼저
            group = sorted(piers, key=lambda b: ("CRUDE" in world.berths[b]["cargo"], list(world.berths).index(b)))
        if not group:
            group = compat or list(world.berths)[:1]
        eta = env.eta(cid)
        open_ = [b for b in group if not any(ts(w["from"]) <= eta < ts(w["to"]) for w in env.oos(b))] or group
        pick = min(open_, key=lambda b: (max(free[b], eta), group.index(b)))
        seq[pick].append(cid)
        rate = min(vessel["pump_m3h"] if call["operation"] == "DISCHARGE" else float("inf"),
                   call.get("shore_rate_m3h") or float("inf"), world.berths[pick]["max_rate_m3h"])
        free[pick] = add_h(max(free[pick], eta), call["quantity_bbl"] * sim.BBL_TO_M3 / rate + 6)
    return seq
