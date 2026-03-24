"""History display panel."""

import tkinter as tk
from state.history_store import HistoryStore, HistoryEntry
from typing import Callable

class HistoryPanel(tk.Frame):
    def __init__(self, parent, history_store: HistoryStore,
                 on_select: Callable[[str, str], None], **kwargs):
        super().__init__(parent, bg="#2c2c2e", **kwargs)
        self._store = history_store
        self._on_select = on_select
        self._entries: list[HistoryEntry] = []

        tk.Label(self, text="History", bg="#2c2c2e", fg="#888888",
                 font=("SF Pro Display", 13)).pack(anchor="w", padx=8, pady=(6, 2))

        frame = tk.Frame(self, bg="#2c2c2e")
        frame.pack(fill="both", expand=True)

        scrollbar = tk.Scrollbar(frame)
        scrollbar.pack(side="right", fill="y")

        self._listbox = tk.Listbox(
            frame, bg="#2c2c2e", fg="white", selectbackground="#3a3a3c",
            font=("SF Pro Display", 12), relief="flat", bd=0,
            yscrollcommand=scrollbar.set,
        )
        self._listbox.pack(side="left", fill="both", expand=True)
        scrollbar.config(command=self._listbox.yview)
        self._listbox.bind("<<ListboxSelect>>", self._on_click)

        clear_btn = tk.Button(self, text="Clear History", bg="#3a3a3c", fg="#ff453a",
                              relief="flat", font=("SF Pro Display", 11),
                              command=self._clear)
        clear_btn.pack(fill="x", padx=8, pady=6)

        self.refresh()

    def refresh(self) -> None:
        self._entries = self._store.load()
        self._listbox.delete(0, "end")
        for e in reversed(self._entries):   # newest first
            self._listbox.insert("end", f"{e.expression} = {e.result}")

    def _on_click(self, _event) -> None:
        sel = self._listbox.curselection()
        if not sel:
            return
        idx = len(self._entries) - 1 - sel[0]  # reverse index
        entry = self._entries[idx]
        self._on_select(entry.expression, entry.result)

    def _clear(self) -> None:
        self._store.clear()
        self.refresh()
