"""
AITrading Strategy - Revised BUY/SELL logic with isolated components.

Strategy Flow:
  BUY: Market Filter → Setup → Entry Trigger → Position Sizing
  SELL: Stop Loss / Structure Collapse / Profit Protection / Bearish Signal

All helper functions are isolated in this file for easy modification.
"""

from dataclasses import dataclass, field
from typing import Optional
import math

# Reuse existing indicators
from src.signals.aitrading_indicators import (
    detect_higher_low, detect_lower_low,
    is_near_support, is_falling_with_volume_increase,
    detect_volume_decrease_stabilize,
    detect_vwap_breakout, detect_vwap_breakdown,
    detect_swing_lows, detect_swing_highs,
    calculate_vwap, calculate_atr,
    calculate_stop_loss, calculate_trailing_stop
)
from src.signals.divergence_engine import calculate_divergences, DivergenceResult
from src.signals.signal_models import Action, SignalStrength, Decision


# ─── Market State Filter ───────────────────────────────────────────────

def check_market_state(ohlcv: list[dict]) -> dict:
    """
    Check if buy is permitted based on market state.
    
    Returns:
        dict with keys:
            - buy_permitted: bool
            - reason: str (explanation)
    """
    if not ohlcv or len(ohlcv) < 20:
        return {"buy_permitted": False, "reason": "Insufficient data (need ≥20 candles)"}
    
    # Check buy-prohibited conditions first (any triggers prohibition)
    if is_falling_with_volume_increase(ohlcv, lookback=5):
        return {"buy_permitted": False, "reason": "Falling with volume increase (buy-prohibited)"}
    
    if detect_lower_low(ohlcv, lookback=20):
        return {"buy_permitted": False, "reason": "Lower Low continues (bearish trend)"}
    
    # Check buy-permitted conditions (≥1 needed)
    reasons = []
    
    if detect_higher_low(ohlcv, lookback=20):
        reasons.append("Higher Low detected")
    
    if is_near_support(ohlcv, current_idx=-1, threshold_pct=0.02):
        reasons.append("Near support zone")
    
    if reasons:
        return {"buy_permitted": True, "reason": ", ".join(reasons)}
    
    return {"buy_permitted": False, "reason": "No buy-permitted conditions met (no Higher Low or Support zone)"}


# ─── BUY Setup Logic ──────────────────────────────────────────────────

def check_setup(ohlcv: list[dict], divergences: list[DivergenceResult]) -> dict:
    """
    Check if BUY setup conditions are met.
    
    Returns:
        dict with keys:
            - setup_exists: bool
            - reasons: list[str]
    """
    if not ohlcv:
        return {"setup_exists": False, "reasons": ["No OHLCV data"]}
    
    reasons = []
    
    # 1. Bullish divergence ≥ 1 with RSI ≤ 20
    bullish_divs = [d for d in divergences if d.div_type in ("pos_reg", "pos_hid")]
    if bullish_divs:
        # Check if any has RSI ≤ 20 (strong bullish)
        strong_bullish = [d for d in bullish_divs if d.rsi_value <= 20]
        if strong_bullish:
            reasons.append(f"Bullish divergence ≥1 with RSI≤20 ({len(strong_bullish)} found)")
        else:
            reasons.append(f"Bullish divergence found but RSI>20 ({len(bullish_divs)} found)")
    
    # 2. Support zone rebound attempt
    if is_near_support(ohlcv, current_idx=-1, threshold_pct=0.02):
        # Check if price is rising (close[-1] > close[-2])
        if len(ohlcv) >= 2:
            current_close = float(ohlcv[-1].get("close", 0))
            prev_close = float(ohlcv[-2].get("close", 0))
            if current_close > prev_close:
                reasons.append("Support zone rebound attempt (price rising)")
    
    # 3. Volume decrease then bottom
    if detect_volume_decrease_stabilize(ohlcv, lookback=10):
        reasons.append("Volume decreased then stabilized (bottom formed)")
    
    setup_exists = len(reasons) > 0
    return {"setup_exists": setup_exists, "reasons": reasons}


# ─── Entry Trigger Logic ──────────────────────────────────────────────

def check_entry_trigger(ohlcv: list[dict], vwap_values: list[float]) -> dict:
    """
    Check if entry trigger conditions are met (AFTER setup).
    
    Returns:
        dict with keys:
            - trigger_occurred: bool
            - trigger_type: str
            - reasons: list[str]
    """
    if not ohlcv:
        return {"trigger_occurred": False, "trigger_type": "", "reasons": ["No OHLCV data"]}
    
    reasons = []
    
    # 1. VWAP re-breakout
    if detect_vwap_breakout(ohlcv, vwap_values):
        reasons.append("VWAP re-breakout (price crossed above VWAP)")
    
    # 2. Previous high breakout
    if len(ohlcv) >= 20:
        recent_highs = [float(c.get("high", 0)) for c in ohlcv[-20:-1]]  # Exclude current
        if recent_highs:
            prev_high = max(recent_highs)
            current_close = float(ohlcv[-1].get("close", 0))
            if current_close > prev_high:
                reasons.append(f"Previous high breakout ({current_close:.2f} > {prev_high:.2f})")
    
    trigger_occurred = len(reasons) > 0
    trigger_type = "VWAP breakout" if "VWAP" in reasons[0] else "High breakout" if reasons else ""
    
    return {"trigger_occurred": trigger_occurred, "trigger_type": trigger_type, "reasons": reasons}


# ─── Position Sizing + Stop Loss ─────────────────────────────────────

def calculate_position_size(account_balance: float, risk_pct: float, stop_distance: float) -> float:
    """
    Calculate position size based on risk percentage.
    
    Formula: position_size = (account_balance * risk_pct/100) / stop_distance
    
    Args:
        account_balance: Total account balance (KRW)
        risk_pct: Risk percentage (0.5~1.0)
        stop_distance: Distance to stop loss (entry - stop_loss)
    
    Returns:
        Position size (units to buy)
    """
    if stop_distance <= 0:
        return 0.0
    risk_amount = account_balance * (risk_pct / 100.0)
    return risk_amount / stop_distance


def calculate_stop_loss(entry_price: float, swing_low: float, atr_values: list[float], multiplier: float = 1.5) -> float:
    """
    Calculate stop loss price.
    
    Formula: min(swing_low, entry_price - atr_values[-1] * multiplier)
    
    Args:
        entry_price: Entry price
        swing_low: Most recent swing low price
        atr_values: ATR values from calculate_atr()
        multiplier: ATR multiplier (1.5~2.0)
    
    Returns:
        Stop loss price
    """
    atr_stop = entry_price - (atr_values[-1] * multiplier) if atr_values and not math.isnan(atr_values[-1]) else entry_price * 0.95
    return min(swing_low, atr_stop)


# ─── Post-Buy Management ─────────────────────────────────────────────

def check_partial_profit(current_price: float, entry_price: float, stop_loss: float) -> dict:
    """
    Check if partial profit should be taken at R:R = 1:1.
    
    Returns:
        dict with keys:
            - should_sell: bool
            - sell_pct: float
            - reason: str
    """
    if stop_loss >= entry_price:
        return {"should_sell": False, "sell_pct": 0, "reason": "Invalid stop loss"}
    
    risk = entry_price - stop_loss
    reward = current_price - entry_price
    rr_ratio = reward / risk if risk > 0 else 0.0
    
    if rr_ratio >= 1.0:
        return {"should_sell": True, "sell_pct": 50.0, "reason": f"R:R = 1:{rr_ratio:.2f} (1:1 target reached)"}
    
    return {"should_sell": False, "sell_pct": 0, "reason": f"R:R = 1:{rr_ratio:.2f} (below 1:1)"}


def check_pyramid_add(ohlcv: list[dict], current_positions: int, max_positions: int = 3) -> dict:
    """
    Check if should add to position (pyramid).
    
    Conditions:
        - High breakout AND volume increase
        - NOT during downtrend (no Lower Low)
    
    Returns:
        dict with keys:
            - should_add: bool
            - add_pct: float
            - reason: str
    """
    if current_positions >= max_positions:
        return {"should_add": False, "add_pct": 0, "reason": f"Max positions reached ({max_positions})"}
    
    # Check downtrend prohibition
    if detect_lower_low(ohlcv, lookback=20):
        return {"should_add": False, "add_pct": 0, "reason": "Lower Low detected (downtrend - pyramid forbidden)"}
    
    # Check trigger conditions
    from src.signals.aitrading_indicators import detect_volume_increase
    
    has_high_breakout = False
    if len(ohlcv) >= 20:
        recent_highs = [float(c.get("high", 0)) for c in ohlcv[-20:-1]]
        if recent_highs:
            prev_high = max(recent_highs)
            current_close = float(ohlcv[-1].get("close", 0))
            has_high_breakout = current_close > prev_high
    
    has_volume_increase = detect_volume_increase(ohlcv, lookback=5)
    
    if has_high_breakout and has_volume_increase:
        return {"should_add": True, "add_pct": 50.0, "reason": "High breakout + volume increase"}
    
    return {"should_add": False, "add_pct": 0, "reason": "No pyramid conditions met"}


# ─── Structure Collapse Sell ─────────────────────────────────────────

def check_structure_collapse(ohlcv: list[dict], vwap_values: list[float]) -> dict:
    """
    Check for structure collapse (sell conditions).
    
    Returns:
        dict with keys:
            - sell_triggered: bool
            - sell_pct: float
            - reason: str
            - exit_type: str
    """
    if not ohlcv or len(ohlcv) < 20:
        return {"sell_triggered": False, "sell_pct": 0, "reason": "", "exit_type": ""}
    
    swing_lows = detect_swing_lows(ohlcv, prd=5)
    
    # Condition 1: Previous low downward breakout
    if len(swing_lows) >= 2:
        prev_low_idx = swing_lows[-2]
        if prev_low_idx < len(ohlcv):
            prev_low_price = float(ohlcv[prev_low_idx].get("close", 0))
            current_close = float(ohlcv[-1].get("close", 0))
            if current_close < prev_low_price:
                return {
                    "sell_triggered": True,
                    "sell_pct": 50.0,
                    "reason": f"Previous low breakout ({current_close:.2f} < {prev_low_price:.2f})",
                    "exit_type": "STRUCTURE_COLLAPSE"
                }
    
    # Condition 2: Lower High formed AND VWAP below maintained
    swing_highs = detect_swing_highs(ohlcv, prd=5)
    if len(swing_highs) >= 2:
        # Check for Lower High (recent high < previous high)
        last_high_idx = swing_highs[-1]
        prev_high_idx = swing_highs[-2]
        if last_high_idx < len(ohlcv) and prev_high_idx < len(ohlcv):
            last_high = float(ohlcv[last_high_idx].get("high", 0))
            prev_high = float(ohlcv[prev_high_idx].get("high", 0))
            
            if last_high < prev_high:
                # Check VWAP below maintained (price < VWAP for 2+ candles)
                if len(vwap_values) >= 2:
                    recent_prices = [float(c.get("close", 0)) for c in ohlcv[-3:]]
                    recent_vwap = vwap_values[-3:] if len(vwap_values) >= 3 else vwap_values
                    vwap_below = all(recent_prices[i] < recent_vwap[i] for i in range(min(len(recent_prices), len(recent_vwap))))
                    
                    if vwap_below:
                        return {
                            "sell_triggered": True,
                            "sell_pct": 100.0,
                            "reason": f"Lower High formed ({last_high:.2f} < {prev_high:.2f}) + VWAP below",
                            "exit_type": "STRUCTURE_COLLAPSE"
                        }
    
    return {"sell_triggered": False, "sell_pct": 0, "reason": "", "exit_type": ""}


# ─── Bearish Signal Sell ─────────────────────────────────────────────

def check_bearish_signal(ohlcv: list[dict], divergences: list[DivergenceResult], vwap_values: list[float]) -> dict:
    """
    Check for bearish signal sell conditions.
    
    Conditions (ALL must be true):
        1. Bearish divergence exists with RSI ≥ 80
        2. VWAP downward break: price < VWAP for current candle
    
    Returns:
        dict with keys:
            - sell_triggered: bool
            - sell_pct: float
            - reason: str
            - exit_type: str
    """
    if not ohlcv:
        return {"sell_triggered": False, "sell_pct": 0, "reason": "", "exit_type": ""}
    
    # Condition 1: Bearish divergence with RSI ≥ 80
    bearish_divs = [d for d in divergences if d.div_type in ("neg_reg", "neg_hid") and d.rsi_value >= 80]
    if not bearish_divs:
        return {"sell_triggered": False, "sell_pct": 0, "reason": "No bearish divergence with RSI≥80", "exit_type": ""}
    
    # Condition 2: VWAP downward break
    if not detect_vwap_breakdown(ohlcv, vwap_values):
        return {"sell_triggered": False, "sell_pct": 0, "reason": "No VWAP breakdown (price above VWAP)", "exit_type": ""}
    
    return {
        "sell_triggered": True,
        "sell_pct": 100.0,
        "reason": f"Bearish divergence (RSI≥80) + VWAP breakdown ({len(bearish_divs)} signals)",
        "exit_type": "BEARISH_SIGNAL"
    }


# ─── Stop Loss + Profit Protection ───────────────────────────────────

def check_stop_loss(current_price: float, stop_loss: float) -> dict:
    """Check if stop loss triggered."""
    if current_price <= stop_loss:
        return {"sell_triggered": True, "sell_pct": 100.0, "reason": f"Stop loss triggered ({current_price:.2f} ≤ {stop_loss:.2f})", "exit_type": "STOP_LOSS"}
    return {"sell_triggered": False, "sell_pct": 0, "reason": "", "exit_type": ""}


def check_profit_protection(current_price: float, entry_price: float, stop_loss: float, stoch_values: dict) -> dict:
    """
    Check profit protection conditions.
    
    Returns:
        dict with keys: sell_triggered, sell_pct, reason, exit_type
    """
    # ① Partial profit at R:R = 1:1
    partial = check_partial_profit(current_price, entry_price, stop_loss)
    if partial["should_sell"]:
        return {
            "sell_triggered": True,
            "sell_pct": partial["sell_pct"],
            "reason": partial["reason"],
            "exit_type": "PARTIAL_TP"
        }
    
    # ② Overheating: K35/K65/K100 ≥ 80 (2+ indicators)
    if stoch_values:
        overheat_count = sum(1 for k in ["K35", "K65", "K100"] if stoch_values.get(k, 0) >= 80)
        if overheat_count >= 2:
            return {
                "sell_triggered": True,
                "sell_pct": 100.0,
                "reason": f"Overheating ({overheat_count} stochastic indicators ≥80)",
                "exit_type": "OVERHEAT"
            }
    
    # ③ Trailing stop
    atr_for_trailing = []  # TODO: pass actual ATR values
    trailing = calculate_trailing_stop(current_price, atr_for_trailing, multiplier=2.0)
    if current_price <= trailing:
        return {
            "sell_triggered": True,
            "sell_pct": 100.0,
            "reason": f"Trailing stop triggered ({current_price:.2f} ≤ {trailing:.2f})",
            "exit_type": "TRAILING_STOP"
        }
    
    return {"sell_triggered": False, "sell_pct": 0, "reason": "", "exit_type": ""}


# ─── Sell Priority + Risk Management ────────────────────────────────

def execute_sell_priority(signals: list[dict]) -> dict:
    """
    Execute sell priority: STOP_LOSS > STRUCTURE_COLLAPSE > OVERHEAT > TRAILING_STOP > BEARISH_SIGNAL
    
    Returns highest priority sell signal (first match wins).
    """
    priority_order = ["STOP_LOSS", "STRUCTURE_COLLAPSE", "OVERHEAT", "TRAILING_STOP", "BEARISH_SIGNAL"]
    
    for exit_type in priority_order:
        for signal in signals:
            if signal.get("exit_type") == exit_type and signal.get("sell_triggered"):
                return signal
    
    return {"sell_triggered": False, "sell_pct": 0, "reason": "No sell signal", "exit_type": ""}


def check_risk_management(daily_pnl: float, consecutive_losses: int, account_dd: float, portfolio_value: float) -> dict:
    """
    Check strategy-level risk management.
    
    Returns:
        dict with keys: halt, review_strategy, reason
    """
    # Daily loss > -2%
    daily_loss_pct = (daily_pnl / portfolio_value * 100) if portfolio_value > 0 else 0
    if daily_loss_pct < -2.0:
        return {"halt": True, "review_strategy": False, "reason": f"Daily loss > -2% ({daily_loss_pct:.2f}%)"}
    
    # 3 consecutive losses
    if consecutive_losses >= 3:
        return {"halt": True, "review_strategy": False, "reason": f"3 consecutive losses"}
    
    # Account DD -10%
    if account_dd < -10.0:
        return {"halt": False, "review_strategy": True, "reason": f"Account DD -10% (review strategy)"}
    
    return {"halt": False, "review_strategy": False, "reason": ""}


# ─── Main Strategy Class ─────────────────────────────────────────────

class AITradingStrategy:
    """
    Main strategy class implementing the full BUY/SELL flow.
    
    Flow: Market Filter → Setup → Entry Trigger → Position Sizing → Sell Management
    """
    
    def __init__(self):
        self.name = "AITrading"
        self.entry_price: Optional[float] = None
        self.stop_loss: Optional[float] = None
        self.position_size: Optional[float] = None
    
    def evaluate(self, signal: SignalResult, ohlcv: list[dict]) -> Decision:
        """
        Main evaluation method. Implements full BUY/SELL decision flow.
        
        Args:
            signal: SignalResult from TradingView or other provider
            ohlcv: OHLCV data for analysis
            
        Returns:
            Decision with action, size_pct, stop_loss_pct, exit_type, reason
        """
        if not ohlcv or len(ohlcv) < 20:
            return Decision(
                action=Action.NEUTRAL,
                symbol=signal.symbol,
                strength=SignalStrength.NEUTRAL,
                reason="Insufficient OHLCV data"
            )
        
        # Calculate indicators
        vwap_values = calculate_vwap(ohlcv)
        atr_values = calculate_atr(ohlcv, period=14)
        divergences = calculate_divergences(ohlcv, rsi_filter=True)
        
        # ── SELL CHECKS (priority order) ──────────────────────────────
        sell_signals = []
        
        # Stop Loss (if in position)
        if self.stop_loss and self.entry_price:
            stop_check = check_stop_loss(float(ohlcv[-1].get("close", 0)), self.stop_loss)
            if stop_check["sell_triggered"]:
                sell_signals.append(stop_check)
        
        # Structure Collapse
        collapse = check_structure_collapse(ohlcv, vwap_values)
        if collapse["sell_triggered"]:
            sell_signals.append(collapse)
        
        # Profit Protection (if in position)
        if self.entry_price and self.stop_loss:
            from src.signals.stochastic_engine import calculate_multi_stoch
            stoch_values = calculate_multi_stoch(ohlcv)
            protection = check_profit_protection(
                float(ohlcv[-1].get("close", 0)),
                self.entry_price,
                self.stop_loss,
                stoch_values
            )
            if protection["sell_triggered"]:
                sell_signals.append(protection)
        
        # Bearish Signal
        bearish = check_bearish_signal(ohlcv, divergences, vwap_values)
        if bearish["sell_triggered"]:
            sell_signals.append(bearish)
        
        # Execute sell priority
        if sell_signals:
            priority_signal = execute_sell_priority(sell_signals)
            if priority_signal.get("sell_triggered"):
                return Decision(
                    action=Action.SELL,
                    symbol=signal.symbol,
                    strength=SignalStrength.STRONG_SELL,
                    size_pct=priority_signal.get("sell_pct", 100.0),
                    exit_type=priority_signal.get("exit_type", ""),
                    reason=priority_signal.get("reason", "")
                )
        
        # ── BUY CHECKS ────────────────────────────────────────────────
        # Step 1: Market State Filter
        market = check_market_state(ohlcv)
        if not market["buy_permitted"]:
            return Decision(
                action=Action.NEUTRAL,
                symbol=signal.symbol,
                strength=SignalStrength.NEUTRAL,
                reason=f"Buy prohibited: {market['reason']}"
            )
        
        # Step 2: Setup Check
        setup = check_setup(ohlcv, divergences)
        if not setup["setup_exists"]:
            return Decision(
                action=Action.NEUTRAL,
                symbol=signal.symbol,
                strength=SignalStrength.NEUTRAL,
                reason=f"No setup: {', '.join(setup['reasons']) if setup['reasons'] else 'conditions not met'}"
            )
        
        # Step 3: Entry Trigger
        trigger = check_entry_trigger(ohlcv, vwap_values)
        if not trigger["trigger_occurred"]:
            return Decision(
                action=Action.NEUTRAL,
                symbol=signal.symbol,
                strength=SignalStrength.NEUTRAL,
                reason=f"No trigger: {', '.join(trigger['reasons']) if trigger['reasons'] else 'conditions not met'}"
            )
        
        # Step 4: Position Sizing + Stop Loss
        entry_price = float(ohlcv[-1].get("close", 0))
        swing_lows = detect_swing_lows(ohlcv, prd=5)
        swing_low = float(ohlcv[swing_lows[-1]].get("close", entry_price * 0.95)) if swing_lows else entry_price * 0.95
        
        stop_loss = calculate_stop_loss(entry_price, swing_low, atr_values, multiplier=1.5)
        account_balance = 10000000  # TODO: get from account
        risk_pct = 0.5  # 0.5% risk
        stop_distance = entry_price - stop_loss
        position_size = calculate_position_size(account_balance, risk_pct, stop_distance)
        
        # Store for later use
        self.entry_price = entry_price
        self.stop_loss = stop_loss
        self.position_size = position_size
        
        return Decision(
            action=Action.BUY,
            symbol=signal.symbol,
            strength=SignalStrength.STRONG_BUY,
            size_pct=min(position_size / account_balance * 100, 20.0),  # Cap at 20% (MAX_POSITION_PCT)
            stop_loss_pct=(entry_price - stop_loss) / entry_price * 100,
            reason=f"Setup: {', '.join(setup['reasons'])} | Trigger: {', '.join(trigger['reasons'])}"
        )
