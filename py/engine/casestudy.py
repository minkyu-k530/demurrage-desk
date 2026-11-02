"""CASE STUDY — Phase 12 '실제 어려웠던 하루' 복원 (가상 사례).

선박 한 척의 하루를 T-72h · T-48h · T-24h · 도착 · 결정 · 결과 시점으로 나눠, 각 시점에 **그때 알 수 있었던 정보만**
(known-at-t) 다시 보여 준다.

- 복원 경로 = 기준 계획(SEAGATE v1)을 끝까지 유지한 실제 세계(현업 Rule). 데모에서 승인한 변경은 섞지 않는다.
- T = 최초 통지 ETA(72h 통지). T-72h는 72h 통지를 받은 시각보다 앞당기지 않는다.
- 기준 계획은 plan.json `issued_at`(가상 11/02 18:00)부터 알려진 것으로 본다. 그 전 시점에는 ETA 통지만 보인다.
- 결정 시점의 선택지 = 그 시각 에이전트가 낸 후보(작업함). 현업 선택 = 계획 유지 [가정 DL-03].
- 반사실 = 검증(정책 경쟁·사후 최적)의 선박별 체선료.
"""
from __future__ import annotations

from datetime import timedelta
from functools import lru_cache

from .agent import Agent
from .clock import WAIT_LABEL
from .diagnosis import usd
from .intake import EVENT_LABEL
from .timeutil import fmt_h, fmt_ts, hours, iso, round_usd, ts

KEYS = ["T-72h", "T-48h", "T-24h", "ARRIVAL", "DECISION", "RESULT"]
LABELS = {"T-72h": "T-72h · 72시간 전 통지", "T-48h": "T-48h", "T-24h": "T-24h", "ARRIVAL": "도착 (투묘)",
          "DECISION": "결정 시점", "RESULT": "결과"}
# v3 대기 사유(WP-M) — clock.WAIT_LABEL에 아직 없을 때 쓰는 이름
EXTRA_WAIT = {"TIDE": "조석·UKC 창", "TUG": "도선·예선 대기", "VETTING": "검사·승인 대기", "FOG": "시정 불량", "WAVE": "파고", "TANK": "탱크 공간 부족"}
TRIGGER_LABEL = {"INIT": "기준 계획", "ETA": "ETA 갱신", "FORECAST": "예보 갱신", "CONSTRAINT": "부두제약 변경", "AGENT": "에이전트 후보"}
NEIGHBOR_SOF = {"OPS_STOPPED", "OPS_RESUMED", "OPS_COMPLETED", "LAST_LINE"}


@lru_cache(maxsize=1)
def shared():
    """기준 데이터(data/live)의 World·Agent 한 쌍 — 호출자가 world/agent를 주지 않을 때 쓴다(에이전트 타임라인 캐시 공유)."""
    from .world import World
    w = World()
    return w, Agent(w)


def _wait_label(reason):
    return WAIT_LABEL.get(reason) or EXTRA_WAIT.get(reason) or reason


def _name(world, cid):
    return world.vessel_of(cid)["name"]


def _plan_known_from(world):
    issued = ts(world.plan_v1.get("issued_at")) if world.plan_v1.get("issued_at") else None
    return min(issued, world.t0) if issued else world.t0


def _eta_known(world, cid, t):
    known = [u for u in world.calls[cid]["eta_updates"] if ts(u["issued_at"]) <= t]
    return ts(known[-1]["eta"]) if known else None


def _forecast_known(world, t):
    got = [f for issued, _, f in world.forecasts if issued <= t]
    return got[-1] if got else None


def _wait_hours(sim_row):
    out = {}
    for w in sim_row.get("wait_reasons") or []:
        h = hours(ts(w["from"]), ts(w["to"]))
        if h > 0:
            out[w["reason"]] = out.get(w["reason"], 0.0) + h
    return out


def _final(world):
    return world.view(world.base_history(), world.t_end, alternatives=False)["calls"]


def index(world, history=None, agent=None):
    """복원 후보 목록 — 기준 계획 그대로의 실제 체선료 큰 순."""
    rows = []
    for cid, c in _final(world).items():
        st, sim_row = c["statement"], c["sim"]
        ok = st.get("status") == "OK"
        amt = round_usd(st.get("amount_usd") or 0.0) if ok else 0.0
        dem = (st.get("demurrage_h") or 0.0) if ok else 0.0
        wait = sum(_wait_hours(sim_row).values())
        name = _name(world, cid)
        rows.append({"call_id": cid, "vessel": name, "berth_id": sim_row.get("berth_id"), "amount_usd": amt,
                     "title": f"{name} — {sim_row.get('berth_id')} 대기 {fmt_h(wait)} · 체선 {fmt_h(dem)} · {usd(amt)}",
                     "wait_h": round(wait, 2), "demurrage_h": round(dem, 2)})
    rows.sort(key=lambda r: (-r["amount_usd"], r["call_id"]))
    return rows


# ---------------------------------------------------------------- 시점별 '그때 알던 것'
def _known(world, base, cid, t, plan_from):
    eta = _eta_known(world, cid, t)
    fc = _forecast_known(world, t)
    out = {"eta": iso(eta), "etb": None, "etc": None, "laytime_start": None, "exposure_usd": None, "plan_version": None,
           "forecast_id": fc["id"] if fc else None, "berth_queue": [], "berth_id": None, "ata": None, "demurrage_h": None,
           "status": None, "queue_basis": ""}
    if t < plan_from:
        known = sorted(((_eta_known(world, c, t), _name(world, c)) for c in world.calls), key=lambda x: (x[0] is None, x[0] or t))
        out["berth_queue"] = [n for e, n in known if e is not None]
        out["queue_basis"] = "72h 통지를 받은 선박(ETA 순) — 기준 계획 게시 전"
        return out, None, None
    view = world.view(base, t, alternatives=False)
    row = view["calls"][cid]
    sim_row, st = row["sim"], row["statement"]
    bid = sim_row.get("berth_id")
    seq = view["plan"]["plan"]["sequence"].get(bid, [])
    out.update(etb=iso(ts(sim_row.get("etb"))), etc=iso(ts(sim_row.get("etc"))), plan_version=view["plan"]["version"], berth_id=bid,
               berth_queue=[_name(world, x) for x in seq], status=row["status"],
               queue_basis=f"SEAGATE 계획 v{view['plan']['version']} {bid} 순서")
    anchored = ts(sim_row.get("anchored"))
    if anchored and anchored <= t:
        out["ata"] = iso(anchored)
    if st.get("status") == "OK":
        out.update(laytime_start=st.get("laytime_start"), exposure_usd=round_usd(st.get("amount_usd") or 0.0),
                   demurrage_h=round(st.get("demurrage_h") or 0.0, 2))
    return out, row, view


def _risks(world, cid, t, known, row, view, plan_from):
    if row is None:
        return ["기준 계획 게시 전 — 선석·순서 미정, 72h 통지 ETA만 있다"]
    out = []
    if (known.get("exposure_usd") or 0) > 0:
        out.append(f"체선 {fmt_h(known['demurrage_h'] or 0)} 예상 · {usd(known['exposure_usd'])} (이 시점 정보 기준)")
    sim_row = row["sim"]
    seq = view["plan"]["plan"]["sequence"].get(sim_row.get("berth_id"), [])
    if cid in seq and seq.index(cid) > 0:
        prev = seq[seq.index(cid) - 1]
        prev_sim = view["calls"][prev]["sim"]
        if not (ts(prev_sim.get("etd")) and ts(prev_sim["etd"]) <= t):
            out.append(f"앞 선박 {_name(world, prev)} 하역 종료 예상 {fmt_ts(ts(prev_sim.get('etc')))} — 늦어지면 접안도 함께 밀린다")
    etb, anchored = ts(sim_row.get("etb")), ts(sim_row.get("anchored"))
    if etb and anchored and etb > max(t, anchored):
        out.append(f"묘박 대기 예상 {fmt_h(hours(max(t, anchored), etb))} (접안 예상 {fmt_ts(etb)})")
    if sim_row.get("daytime_rule") and etb and etb > t:
        out.append(f"{sim_row.get('daytime_rule_id') or '주간 계류'} — 앞 배가 밤에 끝나면 다음 주간 창까지 기다린다")
    fc = _forecast_known(world, t)
    if fc and ("주의보" in fc.get("summary", "") or "경보" in fc.get("summary", "")):
        out.append(f"예보 {fc['id']}: {fc['summary']}")
    nor = (row["statement"].get("nor") or {}).get("tendered")
    if nor and ts(nor) <= t:
        for i in row["statement"].get("issues") or []:
            if i.get("severity") == "critical":
                out.append(f"{i.get('title')} ({', '.join(i.get('rules') or [])})")
    return out or ["뚜렷한 위험 없음 (이 시점 정보 기준)"]


def _events(world, base, cid, plan_from):
    """복원에 쓰는 정보 이벤트 — 이 선박의 ETA·SOF, 같은 선석 앞뒤 선박의 하역 중단·완료·이안, 예보, 부두제약, 계획 게시."""
    truth = world.truth(base)
    bid = truth[cid].get("berth_id")
    seq = world.plan_v1["sequence"].get(bid, [])
    mates = [c for c in seq if c != cid]
    ev = [(plan_from, "PLAN", f"SEAGATE Berthing Schedule v1 게시 — {bid}: {' → '.join(_name(world, c) for c in seq)}")]
    for c in [cid] + mates:
        for u in world.calls[c]["eta_updates"]:
            who = "" if c == cid else f"{_name(world, c)} "
            ev.append((ts(u["issued_at"]), "ETA", f"{who}ETA 통지 → {fmt_ts(ts(u['eta']))} ({u['source']})"))
    for issued, _, f in world.forecasts:
        ev.append((issued, "FORECAST", f"예보 {f['id']}: {f['summary']}"))
    for u in world.constraint_updates:
        ev.append((ts(u["issued_at"]), "CONSTRAINT", f"부두제약 {u['id']}: {u['summary']}"))
    for e in truth[cid]["events"]:
        ev.append((ts(e["ts"]), "SOF", EVENT_LABEL.get(e["type"], e["type"])))
    for c in mates:
        for e in truth[c]["events"]:
            if e["type"] in NEIGHBOR_SOF:
                ev.append((ts(e["ts"]), "SOF", f"{_name(world, c)} {EVENT_LABEL.get(e['type'], e['type'])}"))
    ev.sort(key=lambda x: x[0])
    return ev


def _touches(item, cid, vessel):
    if cid in (item.get("call_ids") or []):
        return True
    for o in (item.get("options") or {}).get("best") or []:
        if any(p.get("call_id") == cid and abs(p.get("delta") or 0) > 0.005 for p in o.get("per_call") or []):
            return True
        if vessel in o.get("title", ""):
            return True
    return False


def _decision_points(world, base, cid, items, validation, result_t):
    vessel = _name(world, cid)
    dps = (validation or {}).get("decision_points") or []
    if not dps:
        from .replay import decision_points  # 검증 결과가 없을 때만
        dps = [{"t": iso(d["t"]), "trigger": d["trigger"], "label": d["label"]} for d in decision_points(world)]
    bid = world.truth(base)[cid].get("berth_id")
    mates = set(world.plan_v1["sequence"].get(bid, [])) | {cid}
    infos = [e for e in world.info_events(base)
             if e["kind"] in ("FORECAST", "CONSTRAINT") or (e["kind"] == "ETA" and e.get("call_id") in mates)]
    out = []
    for dp in dps:
        t = ts(dp["t"])
        if t > result_t:
            continue
        item = next((i for i in items if ts(i["created_at"]) == t and i["kind"] in ("BASELINE", "IMPACT")), None)
        relevant = dp["trigger"] == "INIT" or (item is not None and _touches(item, cid, vessel))
        if not relevant:
            continue
        best = ((item or {}).get("options") or {}).get("best") or []
        keep_usd = ((item or {}).get("options") or {}).get("baseline_usd")
        if keep_usd is None and item is not None:
            keep_usd = item.get("total_after") if item.get("total_after") is not None else sum(
                x.get("amount_usd") or 0 for x in item.get("exposure") or [])
        opts = [{"id": "KEEP", "title": "계획 유지 (현업 Rule)", "saving_usd": 0.0, "chosen": True, "call_delta_usd": 0.0,
                 "total_usd": round_usd(keep_usd) if keep_usd is not None else None}]
        rejected = []
        for o in best[:3]:
            d = next((p.get("delta") or 0.0 for p in o.get("per_call") or [] if p.get("call_id") == cid), 0.0)
            coord = "; ".join(o.get("coordination") or [])
            opts.append({"id": o["id"], "title": o["title"], "saving_usd": round_usd(o.get("saving_usd") or 0.0), "chosen": False,
                         "call_delta_usd": round_usd(d), "total_usd": o.get("total_usd"), "approvable": bool(o.get("approvable")),
                         "risk": (o.get("risk") or {}).get("text"), "coordination": coord})
            mine = f"−{usd(-d)}" if d < -0.005 else (f"+{usd(d)}" if d > 0.005 else "변화 없음")
            rejected.append(f"{o['id']} {o['title']} (예상 전체 절감 {usd(o.get('saving_usd'))}, 이 선박 {mine}): "
                            f"[가정] 현업 Rule에는 재계획 절차가 없어 검토되지 않음" + (f" — 실행하려면 {coord}" if coord else ""))
        if not best:
            thr = ((item or {}).get("options") or {}).get("threshold_usd")
            rejected.append("에이전트 후보 없음" + (f" — 절감이 임계값 {usd(thr)} 미만이거나 바꿀 수 있는 안이 없음" if thr else " — 이 시점에는 후보 탐색 대상 아님"))
        later = [e for e in infos if t < e["t"] <= result_t]
        missing = [f"{fmt_ts(e['t'])} {TRIGGER_LABEL.get(e['kind'], e['kind'])}: "
                   + (f"{_name(world, e['call_id'])} " if e.get("call_id") else "") + f"{e['label']} — 이 시점에는 몰랐다" for e in later]
        out.append({"t": iso(t), "trigger": dp["trigger"], "label": dp.get("label") or TRIGGER_LABEL.get(dp["trigger"], dp["trigger"]),
                    "item_id": item["id"] if item else None, "options": opts, "chosen": "계획 유지 (현업 Rule)",
                    "why": "[가정] 현업 Rule은 게시한 기준 계획을 바꾸지 않는다(DL-03) — 실제 담당자의 판단 이유는 인터뷰로 확인"
                           + (f" · 이 시점 예상 총 노출 {usd(keep_usd)}" if keep_usd is not None else ""),
                    "rejected_why": rejected,
                    "missing_info": missing or ["이후 새 정보 없음 — 이 시점 정보로 결과까지 내다볼 수 있었다"]})
    return out


def _pick_decision(dps, cid):
    scored = [(min((o["call_delta_usd"] for o in d["options"][1:]), default=0.0), -max((o["saving_usd"] for o in d["options"]), default=0.0), d)
              for d in dps if len(d["options"]) > 1]
    if scored:
        scored.sort(key=lambda x: (x[0], x[1]))
        return scored[0][2]
    return dps[-1] if dps else None


def _counterfactual(validation, cid, amt, total):
    val = validation or {}
    rep = {r.get("policy"): r for r in val.get("replay") or [] if isinstance(r, dict)}
    rows = [("현업 Rule 그대로", "CURRENT_RULE", rep.get("CURRENT_RULE")), ("에이전트 1순위 승인", "AGENT_HITL", rep.get("AGENT_HITL")),
            ("Optimizer", "OPTIMIZER", rep.get("OPTIMIZER")), ("사후 최적", "HINDSIGHT", val.get("hindsight"))]
    out = []
    for label, pid, r in rows:
        p = next((x for x in (r or {}).get("per_call") or [] if x.get("call_id") == cid), None)
        v = p.get("amount_usd") if p else None
        tot = (r or {}).get("total_usd")
        if pid == "CURRENT_RULE":
            v = amt if v is None else v
            tot = total if tot is None else tot
        out.append({"label": label, "policy": pid, "usd": None if v is None else round_usd(v), "total_usd": None if tot is None else round_usd(tot),
                    "basis": "VIRTUAL" if (r or pid == "CURRENT_RULE") else "NA"})
    return out


def run(world, history, call_id, agent=None, validation=None):
    if call_id not in world.calls:
        raise ValueError(f"unknown call: {call_id}")
    base = world.base_history()
    agent = agent or Agent(world)
    items = agent.timeline(base)["items"]
    final = _final(world)
    row_f = final[call_id]
    sim_f, st_f = row_f["sim"], row_f["statement"]
    vessel = world.vessel_of(call_id)
    name = vessel["name"]
    plan_from = _plan_known_from(world)
    ups = world.calls[call_id]["eta_updates"]
    T, first_issued = ts(ups[0]["eta"]), ts(ups[0]["issued_at"])
    arrival = ts(sim_f.get("anchored")) or ts(row_f["events"][0]["ts"])
    result_t = min(ts(sim_f.get("etd")) or world.t_end, world.t_end)
    amt = round_usd(st_f.get("amount_usd") or 0.0) if st_f.get("status") == "OK" else 0.0
    dem = (st_f.get("demurrage_h") or 0.0) if st_f.get("status") == "OK" else 0.0
    total = round_usd(sum((c["statement"].get("amount_usd") or 0.0) for c in final.values() if c["statement"].get("status") == "OK"))

    dps = _decision_points(world, base, call_id, items, validation, result_t)
    pick = _pick_decision(dps, call_id)
    decision_t = ts(pick["t"]) if pick else arrival
    times = {"T-72h": max(T - timedelta(hours=72), first_issued), "T-48h": T - timedelta(hours=48), "T-24h": T - timedelta(hours=24),
             "ARRIVAL": arrival, "DECISION": decision_t, "RESULT": result_t}
    order = sorted(KEYS, key=lambda k: (times[k], KEYS.index(k)))
    events = _events(world, base, call_id, plan_from)
    snaps, prev_t, prev_known = [], None, None
    for k in order:
        t = times[k]
        known, row, view = _known(world, base, call_id, t, plan_from)
        changed = [f"{fmt_ts(et)} {txt}" for et, _, txt in events if (prev_t is None or et > prev_t) and et <= t]
        if prev_known:
            for key, label in (("etb", "접안 예상"), ("etc", "하역 종료 예상")):
                a, b = prev_known.get(key), known.get(key)
                if a and b and a != b:
                    changed.append(f"{label} {fmt_ts(ts(a))} → {fmt_ts(ts(b))} ({'+' if ts(b) > ts(a) else ''}{fmt_h(hours(ts(a), ts(b)))})")
            a, b = prev_known.get("exposure_usd"), known.get("exposure_usd")
            if a is not None and b is not None and abs(a - b) >= 1:
                changed.append(f"이 선박 체선료 노출 {usd(a)} → {usd(b)}")
        if prev_t is None:
            changed = changed[-6:]  # 첫 시점은 최근 통지 위주
        ids = [i["id"] for i in items if (prev_t is None or ts(i["created_at"]) > prev_t) and ts(i["created_at"]) <= t
               and (_touches(i, call_id, name) or (i["kind"] == "STATEMENT" and call_id in i.get("call_ids", [])))]
        snaps.append({"key": k, "label": LABELS[k], "t": iso(t), "known": known,
                      "changed": changed or ["변경 없음"], "risks": _risks(world, call_id, t, known, row, view, plan_from), "item_ids": ids})
        prev_t, prev_known = t, known

    waits = _wait_hours(sim_f)
    wait_h = sum(waits.values())
    plan0 = _known(world, base, call_id, plan_from, plan_from)[0]  # 기준 계획을 처음 알았을 때의 예측
    etb1, etc1 = ts(sim_f.get("etb")), ts(sim_f.get("etc"))
    pva = []
    if plan0.get("etb") and etb1:
        pva.append(f"접안 {fmt_ts(ts(plan0['etb']))} → 실제 {fmt_ts(etb1)} ({'+' if etb1 >= ts(plan0['etb']) else ''}{fmt_h(hours(ts(plan0['etb']), etb1))})")
    if plan0.get("etc") and etc1:
        pva.append(f"하역 종료 {fmt_ts(ts(plan0['etc']))} → {fmt_ts(etc1)} ({'+' if etc1 >= ts(plan0['etc']) else ''}{fmt_h(hours(ts(plan0['etc']), etc1))})")
    if plan0.get("exposure_usd") is not None:
        pva.append(f"체선료 {usd(plan0['exposure_usd'])} → {usd(amt)}")
    opt_dps = [d for d in dps if len(d["options"]) > 1]
    cands = [(d, o) for d in opt_dps for o in d["options"][1:]]
    mine = [x for x in cands if x[1]["call_delta_usd"] < -0.005]
    pick_dp, pick_o = (min(mine, key=lambda x: (x[1]["call_delta_usd"], -x[1]["saving_usd"])) if mine
                       else max(cands, key=lambda x: x[1]["saving_usd"], default=(None, None)))
    best_dp = max(opt_dps, key=lambda d: max(o["saving_usd"] for o in d["options"][1:]), default=None)
    if pick_o:
        o = pick_o
        again = (f"[추론] 아니오 — {fmt_ts(ts(pick_dp['t']))} 당시 정보만으로도 '{o['title']}' 후보가 전체 {usd(o['saving_usd'])} 절감"
                 + (f"(이 선박 −{usd(-o['call_delta_usd'])})" if o["call_delta_usd"] < -0.005 else "(이 선박 체선료는 그대로 — 전체 기준)")
                 + "으로 보였다(사후 정보 없이)" + (f". 실행 전 확인: {o['coordination']}" if o.get("coordination") else ""))
    else:
        again = "[추론] 예 — 당시 정보로는 임계값을 넘는 더 나은 후보가 없었다"

    cf = _counterfactual(validation, call_id, amt, total)
    lessons = []
    if waits:
        top = max(waits, key=waits.get)
        lessons.append(f"[가상] 대기 {fmt_h(wait_h)} 중 '{_wait_label(top)}'가 {fmt_h(waits[top])}로 가장 컸다"
                       + (" — 앞 선박 종료가 늦어지면 그대로 이어진다(연쇄)" if top == "CONGESTION" else ""))
    if best_dp:
        lessons.append(f"[추론] 결정 창은 {fmt_ts(ts(best_dp['t']))} {TRIGGER_LABEL.get(best_dp['trigger'], best_dp['trigger'])} 직후였다 — "
                       f"정보가 들어오는 즉시 재계산해야 후보를 쓸 수 있다(Trigger)")
        late = [m for d in opt_dps for m in d["missing_info"] if "몰랐다" in m]
        if late:
            lessons.append(f"[추론] 결정 뒤에 들어온 정보 {len(set(late))}건 — 늦게 오는 정보는 다음 결정 시점에서 다시 계산한다")
    cur, agent_row = cf[0], cf[1]
    if agent_row["usd"] is not None and cur["usd"] is not None and agent_row["total_usd"] is not None and cur["total_usd"] is not None:
        lessons.append(f"[가상] 에이전트 1순위 후보를 승인했다면 이 선박 {usd(cur['usd'])} → {usd(agent_row['usd'])}, "
                       f"전체 {usd(cur['total_usd'])} → {usd(agent_row['total_usd'])} — 선박별이 아니라 전체로 판단해야 한다")
    if any(i.get("severity") == "critical" for i in st_f.get("issues") or []):
        lessons.append("[가상] 도착 전 NOR — AIS 투묘 시각 대조와 'validity reserved' 회신이 필요했다")
    lessons.append("[가정] 현업 판단(계획 유지)과 그 이유는 가정이다 — 실제 어려웠던 하루 1~3건을 같은 틀로 복원해 검증한다(P12 인터뷰)")

    n_opt = len(opt_dps)
    summary = (f"[가상 사례] {name}({vessel.get('type', '')}, {sim_f.get('berth_id')}) — 최초 통지 ETA {fmt_ts(T)}, 실제 투묘 {fmt_ts(arrival)}, "
               f"접안 {fmt_ts(etb1)}. 대기 {fmt_h(wait_h)} · 체선 {fmt_h(dem)} · {usd(amt)}. 결정 시점 {len(dps)}회 중 {n_opt}회 에이전트 후보가 있었고, "
               f"현업 Rule은 모두 계획 유지 [가정].")
    note = "복원 경로 = 기준 계획(SEAGATE v1)을 끝까지 유지한 실제 세계(가상). 각 시점의 known은 그 시각까지 발행·관측된 정보만으로 계산."
    if history and len(history) > 1:
        note += f" 데모에서 승인한 계획 변경 {len(history) - 1}건은 반영하지 않는다."
    return {"call_id": call_id, "vessel": name, "berth_id": sim_f.get("berth_id"),
            "title": f"{name}의 하루 — {world.meta.get('title', '')} [가상]", "summary": summary,
            "reference": {"T": iso(T), "basis": "최초 통지 ETA", "plan_known_from": iso(plan_from)},
            "nor": {"tendered": (st_f.get("nor") or {}).get("tendered"), "received": (st_f.get("nor") or {}).get("received"),
                    "valid": (st_f.get("nor") or {}).get("valid"), "laytime_start": st_f.get("laytime_start")},
            "snapshots": snaps, "decision_points": dps,
            "result": {"wait_h": round(wait_h, 2), "wait_by_reason": [{"reason": r, "label": _wait_label(r), "hours": round(h, 2)}
                                                                         for r, h in sorted(waits.items(), key=lambda kv: -kv[1])],
                       "demurrage_h": round(dem, 2), "amount_usd": amt, "plan_vs_actual": " · ".join(pva) or "—",
                       "would_decide_again": again},
            "counterfactual": cf, "lessons": lessons, "basis": "VIRTUAL", "note": note}
