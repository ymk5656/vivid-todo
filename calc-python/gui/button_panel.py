"""Button panel for calculator input."""

import tkinter as tk
from dataclasses import dataclass

STYLES = {
    "digit":    {"bg": "#2d2d2d", "fg": "white",   "activebackground": "#444"},
    "operator": {"bg": "#ff9500", "fg": "white",   "activebackground": "#ffaa33"},
    "function": {"bg": "#505050", "fg": "white",   "activebackground": "#666"},
    "special":  {"bg": "#3a3a3a", "fg": "#cccccc", "activebackground": "#555"},
    "equals":   {"bg": "#ff9500", "fg": "white",   "activebackground": "#ffaa33"},
    "mode":     {"bg": "#1c5c96", "fg": "white",   "activebackground": "#2a72b5"},
}

@dataclass
class ButtonDef:
    label: str
    row: int
    col: int
    style: str
    action: str        # name of App method
    arg: str = ""      # argument passed to the method
    colspan: int = 1
    rowspan: int = 1

BUTTON_DEFS = [
    # Row 0: mode + brackets + clear
    ButtonDef("RAD", 0, 0, "mode",    "on_toggle_mode"),
    ButtonDef("(",   0, 1, "special", "on_operator", "("),
    ButtonDef(")",   0, 2, "special", "on_operator", ")"),
    ButtonDef("CE",  0, 3, "special", "on_clear"),
    ButtonDef("AC",  0, 4, "special", "on_full_reset"),
    ButtonDef("⌫",   0, 5, "special", "on_backspace"),
    # Row 1: trig + constants + power
    ButtonDef("sin", 1, 0, "function", "on_function", "sin"),
    ButtonDef("cos", 1, 1, "function", "on_function", "cos"),
    ButtonDef("tan", 1, 2, "function", "on_function", "tan"),
    ButtonDef("π",   1, 3, "special",  "on_constant", "pi"),
    ButtonDef("e",   1, 4, "special",  "on_constant", "e"),
    ButtonDef("xʸ",  1, 5, "operator", "on_operator", "**"),
    # Row 2: log + sqrt + factorial + Ans + modulo
    ButtonDef("log", 2, 0, "function", "on_function", "log"),
    ButtonDef("ln",  2, 1, "function", "on_function", "ln"),
    ButtonDef("√x",  2, 2, "function", "on_function", "sqrt"),
    ButtonDef("n!",  2, 3, "function", "on_function", "factorial"),
    ButtonDef("Ans", 2, 4, "special",  "on_ans"),
    ButtonDef("%",   2, 5, "operator", "on_operator", "%"),
    # Rows 3-6: numpad + operators
    ButtonDef("7",   3, 0, "digit",    "on_digit", "7"),
    ButtonDef("8",   3, 1, "digit",    "on_digit", "8"),
    ButtonDef("9",   3, 2, "digit",    "on_digit", "9"),
    ButtonDef("÷",   3, 3, "operator", "on_operator", "/"),
    ButtonDef("4",   4, 0, "digit",    "on_digit", "4"),
    ButtonDef("5",   4, 1, "digit",    "on_digit", "5"),
    ButtonDef("6",   4, 2, "digit",    "on_digit", "6"),
    ButtonDef("×",   4, 3, "operator", "on_operator", "*"),
    ButtonDef("1",   5, 0, "digit",    "on_digit", "1"),
    ButtonDef("2",   5, 1, "digit",    "on_digit", "2"),
    ButtonDef("3",   5, 2, "digit",    "on_digit", "3"),
    ButtonDef("−",   5, 3, "operator", "on_operator", "-"),
    ButtonDef("+/-", 6, 0, "special",  "on_operator", "-"),
    ButtonDef("0",   6, 1, "digit",    "on_digit", "0"),
    ButtonDef(".",   6, 2, "digit",    "on_digit", "."),
    ButtonDef("+",   6, 3, "operator", "on_operator", "+"),
    ButtonDef("=",   3, 4, "equals",   "on_equals", "", 2, 4),  # spans cols 4-5, rows 3-6
]

class ButtonPanel(tk.Frame):
    def __init__(self, parent, app, **kwargs):
        super().__init__(parent, bg="#1c1c1e", **kwargs)
        for i in range(6):
            self.columnconfigure(i, weight=1)
        for i in range(7):
            self.rowconfigure(i, weight=1)

        for b in BUTTON_DEFS:
            style = STYLES[b.style]
            btn = tk.Button(
                self, text=b.label,
                font=("SF Pro Display", 18),
                relief="flat", bd=0,
                width=3, height=2,
                **style,
                command=self._make_command(app, b),
            )
            btn.grid(row=b.row, column=b.col, columnspan=b.colspan,
                     rowspan=b.rowspan, sticky="nsew", padx=2, pady=2)
            if b.action == "on_toggle_mode":
                app._mode_button = btn

    @staticmethod
    def _make_command(app, b: ButtonDef):
        method = getattr(app, b.action)
        if b.arg:
            return lambda m=method, a=b.arg: m(a)
        return method
