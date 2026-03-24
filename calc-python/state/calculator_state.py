"""Calculator session state management."""

from dataclasses import dataclass
from typing import Literal


@dataclass
class CalculatorState:
    expression: str = ""
    result: float | None = None
    ans: float | None = None
    angle_mode: Literal["rad", "deg"] = "rad"
    error: str | None = None

    def push_char(self, ch: str) -> None:
        self.error = None
        self.expression += ch

    def backspace(self) -> None:
        self.expression = self.expression[:-1]

    def clear(self) -> None:
        self.expression = ""
        self.error = None

    def full_reset(self) -> None:
        self.expression = ""
        self.result = None
        self.error = None

    def commit_result(self, value: float) -> None:
        self.ans = value
        self.result = value
        self.error = None

    def toggle_angle_mode(self) -> None:
        self.angle_mode = "deg" if self.angle_mode == "rad" else "rad"
