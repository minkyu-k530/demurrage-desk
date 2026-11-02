"""시각 유틸. 모든 시각은 현지시각(KST) naive datetime, 계산은 running hours."""
from __future__ import annotations

import math
from datetime import datetime, time, timedelta

FMT = "%Y-%m-%dT%H:%M"


def ts(value):
    if value is None or isinstance(value, datetime):
        return value
    s = str(value).strip().replace(" ", "T")
    return datetime.strptime(s[:16], FMT)


def iso(dt):
    return dt.strftime(FMT) if dt else None


def hours(a, b):
    return (b - a).total_seconds() / 3600.0


def add_h(dt, h):
    return dt + timedelta(hours=h)


def add_m(dt, m):
    return dt + timedelta(minutes=m)


def fmt_h(h):
    total = int(round(h * 60))
    sign = "−" if total < 0 else ""
    total = abs(total)
    return f"{sign}{total // 60}h {total % 60:02d}m"


def fmt_ts(dt):
    return dt.strftime("%m/%d %H:%M") if dt else "—"


def ceil_to(dt, minutes):
    base = dt.replace(second=0, microsecond=0)
    if base < dt:
        base += timedelta(minutes=1)
    step = minutes
    mins = base.hour * 60 + base.minute
    rem = mins % step
    return base if rem == 0 else base + timedelta(minutes=step - rem)


def floor_hour(dt):
    return dt.replace(minute=0, second=0, microsecond=0)


def parse_hhmm(s):
    h, m = s.split(":")
    return time(int(h), int(m))


class DayWindow:
    """'주간' 창. 계류·접안 작업 [op_start, op_end]가 같은 날 이 창 안에 있어야 한다 (ULS-DAYTIME-DEF)."""

    def __init__(self, start="07:00", end="17:30"):
        self.start = parse_hhmm(start)
        self.end = parse_hhmm(end)

    def contains(self, dt):
        return self.start <= dt.time() <= self.end

    def op_ok(self, op_start, op_end):
        return (op_start.date() == op_end.date()
                and op_start.time() >= self.start
                and op_end.time() <= self.end)

    def label(self):
        return f"{self.start.strftime('%H:%M')}–{self.end.strftime('%H:%M')}"


def hour_slots(a, b):
    """[a, b)가 걸치는 정시 슬롯들."""
    if b <= a:
        return []
    out, h = [], floor_hour(a)
    while h < b:
        out.append(h)
        h += timedelta(hours=1)
    return out


def round_usd(x):
    return math.floor(x * 100 + 0.5) / 100.0
