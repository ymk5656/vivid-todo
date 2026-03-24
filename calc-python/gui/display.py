"""Display widget for showing input and results."""

import tkinter as tk


class DisplayFrame(tk.Frame):
    def __init__(self, parent, **kwargs):
        super().__init__(parent, bg="#1c1c1e", **kwargs)
        self._expr_var = tk.StringVar(value="")
        self._result_var = tk.StringVar(value="0")

        tk.Label(self, textvariable=self._expr_var, bg="#1c1c1e", fg="#888888",
                 font=("SF Pro Display", 16), anchor="e").pack(fill="x", padx=12, pady=(8, 0))
        tk.Label(self, textvariable=self._result_var, bg="#1c1c1e", fg="white",
                 font=("SF Pro Display", 36, "bold"), anchor="e").pack(fill="x", padx=12, pady=(0, 8))

    def update(self, expression: str, result: str) -> None:
        self._expr_var.set(expression)
        self._result_var.set(result)
