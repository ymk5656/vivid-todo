import pytest
from pathlib import Path
from state.history_store import HistoryStore, HistoryEntry


def test_append_and_load(tmp_path):
    store = HistoryStore(tmp_path / "history.json")
    store.append("2+3", "5")
    entries = store.load()
    assert len(entries) == 1
    assert entries[0].expression == "2+3"
    assert entries[0].result == "5"


def test_max_100_entries(tmp_path):
    store = HistoryStore(tmp_path / "history.json")
    for i in range(105):
        store.append(f"{i}+1", str(i + 1))
    assert len(store.load()) == 100


def test_clear(tmp_path):
    store = HistoryStore(tmp_path / "history.json")
    store.append("1+1", "2")
    store.clear()
    assert store.load() == []


def test_missing_file_returns_empty(tmp_path):
    store = HistoryStore(tmp_path / "nonexistent.json")
    assert store.load() == []
