"""Main calculator application window."""

import tkinter as tk
from pathlib import Path
from engine.evaluator import evaluate, CalcError
from engine.formatter import format_result
from state.calculator_state import CalculatorState
from state.history_store import HistoryStore
from gui.display import DisplayFrame
from gui.button_panel import ButtonPanel
from gui.history_panel import HistoryPanel


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Scientific Calculator")
        self.resizable(False, False)
        self.configure(bg="#1c1c1e")

        self._state = CalculatorState()
        self._history = HistoryStore(Path(__file__).parent.parent / "history.json")

        self._display = DisplayFrame(self)
        self._display.grid(row=0, column=0, columnspan=2, sticky="ew")

        self._btn_panel = ButtonPanel(self, self)
        self._btn_panel.grid(row=1, column=0, sticky="nsew", padx=(8, 4), pady=8)

        self._history_panel = HistoryPanel(self, self._history, self.on_history_select)
        self._history_panel.grid(row=1, column=1, sticky="nsew", padx=(4, 8), pady=8)

        self.columnconfigure(0, weight=3)
        self.columnconfigure(1, weight=2)
        self.rowconfigure(1, weight=1)

        self.bind("<Key>", self._on_keypress)
        self._refresh_display()

    # ── Callbacks ──────────────────────────────────────────────

    def on_digit(self, ch: str) -> None:
        self._state.push_char(ch)
        self._refresh_display()

    def on_operator(self, op: str) -> None:
        self._state.push_char(op)
        self._refresh_display()

    def on_function(self, fn: str) -> None:
        self._state.push_char(fn + "(")
        self._refresh_display()

    def on_constant(self, name: str) -> None:
        self._state.push_char(name)
        self._refresh_display()

    def on_ans(self) -> None:
        self._state.push_char("Ans")
        self._refresh_display()

    def on_equals(self) -> None:
        expr = self._state.expression
        if not expr:
            return
        try:
            value = evaluate(expr, ans=self._state.ans, angle_mode=self._state.angle_mode)
            formatted = format_result(value)
            self._state.commit_result(value)
            self._state.expression = ""
            self._history.append(expr, formatted)
            if hasattr(self, '_history_panel'):
                self._history_panel.refresh()
            self._display.update(expr, formatted)
        except CalcError as e:
            self._state.error = str(e)
            self._display.update(expr, f"Error: {e}")

    def on_clear(self) -> None:
        self._state.clear()
        self._refresh_display()

    def on_full_reset(self) -> None:
        self._state.full_reset()
        self._refresh_display()

    def on_backspace(self) -> None:
        self._state.backspace()
        self._refresh_display()

    def on_negate(self) -> None:
        """Prepend a minus sign, or wrap expression in -(...)."""
        if not self._state.expression:
            self._state.push_char("-")
        else:
            self._state.expression = f"-({self._state.expression})"
        self._refresh_display()

    def on_toggle_mode(self) -> None:
        self._state.toggle_angle_mode()
        if hasattr(self, '_mode_button'):
            self._mode_button.config(text=self._state.angle_mode.upper())
        self._refresh_display()

    def on_history_select(self, expression: str, result: str) -> None:
        self._state.expression = expression
        self._refresh_display()

    # ── Internal ──────────────────────────────────────────────

    def _refresh_display(self) -> None:
        expr = self._state.expression
        if self._state.result is not None and not expr:
            result_str = format_result(self._state.result)
        else:
            result_str = "0"
        self._display.update(expr, result_str)

    def _on_keypress(self, event: tk.Event) -> None:
        key = event.char
        keysym = event.keysym
        if key.isdigit() or key == ".":
            self.on_digit(key)
        elif key in "+-*/":
            self.on_operator(key)
        elif key in ("=", "\r"):
            self.on_equals()
        elif keysym == "BackSpace":
            self.on_backspace()
        elif keysym == "Escape":
            self.on_full_reset()
        elif key == "(":
            self._state.push_char("(")
            self._refresh_display()
        elif key == ")":
            self._state.push_char(")")
            self._refresh_display()
