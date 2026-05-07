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
    calculate_stop_loss, calculate_trailing_stop,
    calculate_ema, detect_ema_breakout,
    detect_stoch_kd_crossover,
    check_price_hl_with_slope, check_indicator_ll_with_slope,
    calculate_slope
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
            # Correction 1: RSI ≤ 20 AND Support zone AND Volume increase reversal
            has_support = is_near_support(ohlcv, current_idx=-1, threshold_pct=0.02)
            from src.signals.aitrading_indicators import detect_volume_increase
            has_volume_reversal = detect_volume_increase(ohlcv, lookback=5)
            if has_support and has_volume_reversal:
                reasons.append(f"Bullish divergence ≥1 with RSI≤20 ({len(strong_bullish)}) + Support zone + Volume reversal")
            else:
                reasons.append(f"Bullish divergence found but missing: {'Support' if not has_support else ''} {'Volume reversal' if not has_volume_reversal else ''}")
        else:
            reasons.append(f"Bullish divergence found but RSI>20 ({len(bullish_divs)} found)")
    
    # 2. Support zone rebound attempt
    if is_near_support(ohlcv, current_idx=-1, threshold_pct=0.02):
        # Correction 1: Also needs volume increase for confirmation
        from src.signals.aitrading_indicators import detect_volume_increase
        if detect_volume_increase(ohlcv, lookback=5):
            # Check if price is rising (close[-1] > close[-2])
            if len(ohlcv) >= 2:
                current_close = float(ohlcv[-1].get("close", 0))
                prev_close = float(ohlcv[-2].get("close", 0))
                if current_close > prev_close:
                    reasons.append("Support zone rebound attempt (price rising + volume increase)")
        else:
            reasons.append("Support zone detected but no volume increase")
    
    # 3. Volume decrease then bottom
    if detect_volume_decrease_stabilize(ohlcv, lookback=10):
        reasons.append("Volume decreased then stabilized (bottom formed)")
    
    setup_exists = len(reasons) > 0
    return {"setup_exists": setup_exists, "reasons": reasons}


# ─── Entry Trigger Logic (3-Stage Divergence Confirmation) ───────────

def check_entry_trigger(ohlcv: list[dict], vwap_values: list[float], 
                       rsi_values: list[float] = None,
                       stoch_k_values: list[float] = None,
                       stoch_d_values: list[float] = None) -> dict:
    """
    3-Stage Divergence Confirmation Entry Trigger.
    
    Stage 1: Structural Setup - Price HL + Indicator LL with slope confirmation
    Stage 2: Oversold Escape - RSI/Stoch escapes oversold zone (≥ threshold)
    Stage 3: Price Action Confirmation - EMA breakout + Stoch K>D crossover
    
    Returns:
        dict with keys:
            - trigger_occurred: bool
            - trigger_type: str (which stage confirmed)
            - reasons: list[str]
            - stage_results: dict (detailed results for each stage)
    """
    if not ohlcv or len(ohlcv) < 20:
        return {
            "trigger_occurred": False, 
            "trigger_type": "", 
            "reasons": ["Insufficient OHLCV data (need ≥20 candles)"],
            "stage_results": {}
        }
    
    reasons = []
    stage_results = {}
    
    # ─── Stage 1: Structural Setup ────────────────────────────────
    # Price HL (Higher Low) with slope confirmation
    price_hl_result = check_price_hl_with_slope(ohlcv, lookback=15)
    
    # Indicator LL (Lower Low) - use RSI or Stochastic
    indicator_ll_result = {"ll_found": False, "slope": 0.0, "reason": "No indicator"}
    if rsi_values and len(rsi_values) == len(ohlcv):
        indicator_ll_result = check_indicator_ll_with_slope(ohlcv, rsi_values, lookback=15)
    elif stoch_k_values and len(stoch_k_values) == len(ohlcv):
        indicator_ll_result = check_indicator_ll_with_slope(ohlcv, stoch_k_values, lookback=15)
    
    stage1_pass = price_hl_result.get("hl_found", False) and indicator_ll_result.get("ll_found", False)
    
    # Slope confirmation: price slope positive, indicator slope negative (divergence)
    price_slope = price_hl_result.get("slope", 0.0)
    indicator_slope = indicator_ll_result.get("slope", 0.0)
    slope_divergence = price_slope > 0 and indicator_slope < 0
    
    stage_results["stage1"] = {
        "passed": stage1_pass,
        "price_hl": price_hl_result,
        "indicator_ll": indicator_ll_result,
        "slope_divergence": slope_divergence,
        "reason": f"Price HL: {price_hl_result.get('reason')}, Indicator LL: {indicator_ll_result.get('reason')}"
    }
    
    if stage1_pass and slope_divergence:
        reasons.append(f"Stage1: Structural setup complete (Price HL + Indicator LL + slope divergence)")
    
    # ─── Stage 2: Oversold Escape ────────────────────────────────
    oversold_escape = False
    escape_reason = ""
    
    # Check RSI escape (≤20 → ≥20, or ≤30 → ≥30)
    if rsi_values and len(rsi_values) >= 2:
        rsi_curr = rsi_values[-1] if not math.isnan(rsi_values[-1]) else None
        rsi_prev = rsi_values[-2] if len(rsi_values) >= 2 and not math.isnan(rsi_values[-2]) else None
        
        if rsi_curr is not None and rsi_prev is not None:
            # Strong divergence: was ≤20, now >20
            if rsi_prev <= 20 and rsi_curr > 20:
                oversold_escape = True
                escape_reason = f"RSI strong escape: {rsi_prev:.2f} → {rsi_curr:.2f}"
            # Weak divergence: was ≤30, now >30
            elif rsi_prev <= 30 and rsi_curr > 30:
                oversold_escape = True
                escape_reason = f"RSI weak escape: {rsi_prev:.2f} → {rsi_curr:.2f}"
    
    # Check Stochastic escape (≤20 → ≥20, or fast K crossing)
    if not oversold_escape and stoch_k_values and len(stoch_k_values) >= 2:
        stoch_curr = stoch_k_values[-1] if not math.isnan(stoch_k_values[-1]) else None
        stoch_prev = stoch_k_values[-2] if len(stoch_k_values) >= 2 and not math.isnan(stoch_k_values[-2]) else None
        
        if stoch_curr is not None and stoch_prev is not None:
            if stoch_prev <= 20 and stoch_curr > 20:
                oversold_escape = True
                escape_reason = f"Stoch escape: {stoch_prev:.2f} → {stoch_curr:.2f}"
    
    stage_results["stage2"] = {
        "passed": oversold_escape,
        "reason": escape_reason if oversold_escape else "No oversold escape detected"
    }
    
    if oversold_escape:
        reasons.append(f"Stage2: {escape_reason}")
    
    # ─── Stage 3: Price Action Confirmation ──────────────────────
    # 3a. EMA Breakout (EMA 5 or EMA 10)
    ema5_result = detect_ema_breakout(ohlcv, ema_period=5)
    ema10_result = detect_ema_breakout(ohlcv, ema_period=10)
    ema_breakout = ema5_result.get("breakout", False) or ema10_result.get("breakout", False)
    
    # 3b. Stochastic K>D Crossover (K35 Golden Cross)
    stoch_cross_result = {"crossover": False, "k_value": 0.0, "d_value": 0.0, "reason": "N/A"}
    if stoch_k_values and stoch_d_values:
        # Use the imported function but need to reconstruct from values
        # For simplicity, check K>D crossover directly
        if len(stoch_k_values) >= 2 and len(stoch_d_values) >= 2:
            k_curr = stoch_k_values[-1] if not math.isnan(stoch_k_values[-1]) else None
            k_prev = stoch_k_values[-2] if not math.isnan(stoch_k_values[-2]) else None
            d_curr = stoch_d_values[-1] if not math.isnan(stoch_d_values[-1]) else None
            d_prev = stoch_d_values[-2] if not math.isnan(stoch_d_values[-2]) else None
            
            if all(v is not None for v in [k_curr, k_prev, d_curr, d_prev]):
                k_crossed_above_d = (k_prev <= d_prev) and (k_curr > d_curr)
                stoch_cross_result = {
                    "crossover": k_crossed_above_d,
                    "k_value": k_curr,
                    "d_value": d_curr,
                    "reason": f"K crossed above D: {k_prev:.2f}→{k_curr:.2f} vs D {d_prev:.2f}→{d_curr:.2f}" if k_crossed_above_d else "No K>D crossover"
                }
    
    # 3c. Candle reversal (high breakout of divergence candle)
    candle_reversal = False
    candle_reason = ""
    if len(ohlcv) >= 2:
        # Find divergence candle (where indicator made LL)
        # Simplified: check if current high > previous high
        curr_high = float(ohlcv[-1].get("high", 0))
        prev_high = float(ohlcv[-2].get("high", 0))
        if curr_high > prev_high:
            candle_reversal = True
            candle_reason = f"Candle high breakout: {prev_high:.2f} → {curr_high:.2f}"
    
    # Stage 3 passes if EMA breakout OR (Stoch crossover AND candle reversal)
    stage3_pass = ema_breakout or (stoch_cross_result.get("crossover", False) and candle_reversal)
    
    stage_results["stage3"] = {
        "passed": stage3_pass,
        "ema_breakout": ema_breakout,
        "ema5_result": ema5_result,
        "ema10_result": ema10_result,
        "stoch_crossover": stoch_cross_result.get("crossover", False),
        "candle_reversal": candle_reversal,
        "reason": f"EMA breakout: {ema_breakout}, Stoch cross: {stoch_cross_result.get('crossover')}, Candle: {candle_reversal}"
    }
    
    if stage3_pass:
        reasons.append(f"Stage3: Price action confirmed (EMA breakout or Stoch cross + candle)")
    
    # ─── Final Trigger Decision ───────────────────────────────────
    # All 3 stages must pass for BUY trigger
    trigger_occurred = stage1_pass and oversold_escape and stage3_pass
    
    trigger_type = ""
    if trigger_occurred:
        trigger_type = "3-Stage Divergence Confirmation"
        reasons.append("✓ All 3 stages passed - BUY signal confirmed!")
    else:
        # Explain what failed
        if not stage1_pass:
            reasons.append("✗ Stage1 failed: Structural setup incomplete")
        if not oversold_escape:
            reasons.append("✗ Stage2 failed: No oversold escape")
        if not stage3_pass:
            reasons.append("✗ Stage3 failed: No price action confirmation")
    
    return {
        "trigger_occurred": trigger_occurred,
        "trigger_type": trigger_type,
        "reasons": reasons,
        "stage_results": stage_results
    }


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


def calculate_stop_loss(entry_price: float, swing_low: float, atr_values: list[float], multiplier: float = 1.2) -> float:
    """
    Calculate stop loss price.
    
    Formula: min(swing_low, entry_price - atr_values[-1] * multiplier)
    
    Args:
        entry_price: Entry price
        swing_low: Most recent swing low price
        atr_values: ATR values from calculate_atr()
        multiplier: ATR multiplier (Correction 5: 1.2 for tighter trailing)
    
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
                size_pct=0.0,
                reason="Insufficient OHLCV data"
            )
        
        # Calculate indicators
        vwap_values = calculate_vwap(ohlcv)
        atr_values = calculate_atr(ohlcv, period=14)
        divergences = calculate_divergences(ohlcv, rsi_filter=True)
        
        # Get RSI and Stochastic values for 3-stage trigger
        from src.signals.stochastic_engine import calculate_multi_stoch
        stoch_data = calculate_multi_stoch(ohlcv)
        
        # Extract RSI values (from divergence engine or calculate separately)
        # For now, use placeholder - will need RSI calculation
        rsi_values = None  # TODO: calculate RSI if needed
        
        # Extract Stochastic K and D values for K35
        stoch_k_values = stoch_data.get('k35', []) if stoch_data else []
        stoch_d_values = stoch_data.get('d35', []) if stoch_data else []
        
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
                    size_pct=priority_signal.get("sell_pct", 100.0),
                    exit_type=priority_signal.get("exit_type", ""),
                    reason=priority_signal.get("reason", "Sell signal triggered")
                )
        
        # ── BUY CHECKS ────────────────────────────────────────────────
        # Step 1: Market State Filter
        market = check_market_state(ohlcv)
        if not market["buy_permitted"]:
            return Decision(
                action=Action.NEUTRAL,
                symbol=signal.symbol,
                size_pct=0.0,
                reason=f"Buy prohibited: {market['reason']}"
            )
        
        # Step 2: Setup Check
        setup = check_setup(ohlcv, divergences)
        if not setup["setup_exists"]:
            return Decision(
                action=Action.NEUTRAL,
                symbol=signal.symbol,
                size_pct=0.0,
                reason=f"No setup: {', '.join(setup['reasons']) if setup['reasons'] else 'conditions not met'}"
            )
        
        # Step 3: Entry Trigger (3-Stage Divergence Confirmation)
        trigger = check_entry_trigger(
            ohlcv, 
            vwap_values, 
            rsi_values=rsi_values,
            stoch_k_values=stoch_k_values if stoch_k_values else None,
            stoch_d_values=stoch_d_values if stoch_d_values else None
        )
        if not trigger["trigger_occurred"]:
            return Decision(
                action=Action.NEUTRAL,
                symbol=signal.symbol,
                size_pct=0.0,
                reason=f"No trigger: {', '.join(trigger['reasons']) if trigger['reasons'] else 'conditions not met'}"
            )
        
        # Step 4: Position Sizing + Stop Loss
        entry_price = float(ohlcv[-1].get("close", 0))
        swing_lows = detect_swing_lows(ohlcv, prd=5)
        swing_low = float(ohlcv[swing_lows[-1]].get("close", entry_price * 0.95)) if swing_lows else entry_price * 0.95
        
        # Correction 5: Tighter trailing (ATR × 1.2)
        stop_loss = calculate_stop_loss(entry_price, swing_low, atr_values, multiplier=1.2)
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
            size_pct=min(position_size / account_balance * 100, 20.0),  # Cap at 20% (MAX_POSITION_PCT)
            stop_loss_pct=(entry_price - stop_loss) / entry_price * 100,
            reason=f"Setup: {', '.join(setup['reasons'])} | Trigger: {', '.join(trigger['reasons'])}"
        )
