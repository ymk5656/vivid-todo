"""Persistent history storage for calculator sessions."""

import json
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

MAX_HISTORY = 100

_DEFAULT_HISTORY_PATH = Path(__file__).resolve().parent.parent / "history.json"


@dataclass
class HistoryEntry:
    expression: str
    result: str
    timestamp: str


class HistoryStore:
    def __init__(self, path: Path | None = None):
        self._path = Path(path) if path is not None else _DEFAULT_HISTORY_PATH

    def load(self) -> list[HistoryEntry]:
        if not self._path.exists():
            return []
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            return [HistoryEntry(**e) for e in data]
        except (json.JSONDecodeError, TypeError, KeyError):
            return []

    def append(self, expression: str, result: str) -> None:
        entries = self.load()
        entries.append(HistoryEntry(
            expression=expression,
            result=result,
            timestamp=datetime.now(timezone.utc).isoformat(),
        ))
        if len(entries) > MAX_HISTORY:
            entries = entries[-MAX_HISTORY:]
        self._path.write_text(
            json.dumps([asdict(e) for e in entries], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def clear(self) -> None:
        if self._path.exists():
            self._path.write_text("[]", encoding="utf-8")
