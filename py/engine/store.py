"""결정(HITL)·계획 버전·감사 로그 저장. 데모는 JSON 파일 하나(runtime/state.json)."""
from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path

RUNTIME = Path(__file__).resolve().parent.parent / "runtime"


class Store:
    def __init__(self, path=None):
        self.path = Path(path or RUNTIME / "state.json")
        self.lock = threading.RLock()
        self.data = {"history": None, "decisions": {}, "audit": []}
        if self.path.exists():
            try:
                self.data.update(json.loads(self.path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                pass

    def save(self):
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(self.path)

    def log(self, entry):
        with self.lock:
            entry = dict(entry, wall=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            self.data["audit"].append(entry)
            return entry
