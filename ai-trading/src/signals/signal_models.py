from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class Action(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    NEUTRAL = "NEUTRAL"


class SignalStrength(str, Enum):
    STRONG_BUY = "STRONG_BUY"
    BUY = "BUY"
    NEUTRAL = "NEUTRAL"
    SELL = "SELL"
    STRONG_SELL = "STRONG_SELL"

    @property
    def numeric(self) -> int:
        return {
            "STRONG_BUY": 2,
            "BUY": 1,
            "NEUTRAL": 0,
            "SELL": -1,
            "STRONG_SELL": -2,
        }[self.value]


@dataclass
class SignalResult:
    symbol: str
    action: Action
    strength: SignalStrength
    indicators: dict[str, Any]
    interval: str = "1h"
    timestamp: datetime = field(default_factory=datetime.utcnow)
    confirmed: bool = True      # set False when AI vetoes
    ai_note: str = ""
    size_hint: float = 1.0     # 1.0=full, 0.5=half, 0.1=probe, 0.0=vetoed

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "action": self.action.value,
            "strength": self.strength.value,
            "interval": self.interval,
            "timestamp": self.timestamp.isoformat(),
            "confirmed": self.confirmed,
            "ai_note": self.ai_note,
            "indicators": {
                k: v for k, v in self.indicators.items()
                if k in ("RECOMMENDATION", "BUY", "SELL", "NEUTRAL")
                or k.startswith("stoch")
                or k.startswith("div_")
            },
        }


@dataclass
class Decision:
    action: Action
    symbol: str
    size_pct: float         # AI size hint multiplier (0–100). Used when override_amount_krw is None.
    stop_loss_pct: float = 2.0
    take_profit_pct: float = 4.0
    reason: str = ""
    exit_type: str = ""       # "STOP_LOSS" | "PARTIAL_TP" | "STRUCTURE_COLLAPSE" | "OVERHEAT" | "TRAILING_STOP" | "BEARISH_SIGNAL" | "EMERGENCY" | "" (empty for BUY)
    override_amount_krw: Optional[float] = None  # When set, use this KRW amount directly for BUY orders
