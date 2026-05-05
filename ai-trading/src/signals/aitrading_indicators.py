"""
Custom indicators for aitrading strategy.
Includes VWAP, ATR, support/resistance detection, volume analysis.
All isolated for easy modification (user requirement).
"""
import math
from typing import Optional


# ─── VWAP (Volume Weighted Average Price) ────────────────────────────────

def calculate_vwap(ohlcv: list[dict], session_anchored: bool = True) -> list[float]:
    """
    Calculate VWAP (Volume Weighted Average Price).
    
    Formula: cumulative((high+low+close)/3 * volume) / cumulative(volume)
    If session_anchored: Reset cumulative sum at each session start (date change).
    
    Args:
        ohlcv: List of OHLCV dicts with keys: high, low, close, volume, timestamp(optional)
        session_anchored: If True, reset at date change (for intraday)
        
    Returns:
        List of VWAP values aligned with input length.
        First element = typical_price if not anchored, or cumulative from start.
    """
    n = len(ohlcv)
    if n == 0:
        return []
    
    vwap_values: list[float] = [0.0] * n
    cum_pv = 0.0  # cumulative price * volume
    cum_vol = 0.0  # cumulative volume
    
    prev_date = None
    
    for i, candle in enumerate(ohlcv):
        high = float(candle.get("high", 0.0))
        low = float(candle.get("low", 0.0))
        close = float(candle.get("close", 0.0))
        volume = float(candle.get("volume", 0.0))
        
        # Typical price = (high + low + close) / 3
        typical_price = (high + low + close) / 3.0
        pv = typical_price * volume  # price * volume
        
        # Session anchoring: reset on date change
        if session_anchored:
            timestamp = candle.get("timestamp")
            if timestamp:
                # Extract date part (assuming ISO format or datetime)
                current_date = str(timestamp)[:10]  # YYYY-MM-DD
                if prev_date is not None and current_date != prev_date:
                    # New session - reset cumulative sums
                    cum_pv = 0.0
                    cum_vol = 0.0
                prev_date = current_date
        
        cum_pv += pv
        cum_vol += volume
        
        if cum_vol > 0:
            vwap_values[i] = cum_pv / cum_vol
        else:
            vwap_values[i] = typical_price  # fallback
    
    return vwap_values


def detect_vwap_breakout(ohlcv: list[dict], vwap_values: list[float]) -> bool:
    """
    Detect if price just crossed ABOVE VWAP (bullish breakout).
    
    Returns True if:
    - Previous candle was below VWAP (close < vwap)
    - Current candle is above VWAP (close >= vwap)
    
    Args:
        ohlcv: List of OHLCV dicts
        vwap_values: VWAP values from calculate_vwap()
        
    Returns:
        True if breakout detected, False otherwise
    """
    if len(ohlcv) < 2 or len(vwap_values) < 2:
        return False
    
    # Get prev and current values
    prev_candle = ohlcv[-2]
    curr_candle = ohlcv[-1]
    prev_close = float(prev_candle.get("close", 0.0))
    curr_close = float(curr_candle.get("close", 0.0))
    prev_vwap = vwap_values[-2]
    curr_vwap = vwap_values[-1]
    
    # Check for NaN
    if math.isnan(prev_vwap) or math.isnan(curr_vwap):
        return False
    
    # Crossed above: prev was below, current is above or equal
    if prev_close < prev_vwap and curr_close >= curr_vwap:
        return True
    
    return False


def detect_vwap_breakdown(ohlcv: list[dict], vwap_values: list[float]) -> bool:
    """
    Detect if price just crossed BELOW VWAP (bearish breakdown).
    
    Returns True if:
    - Previous candle was above VWAP (close > vwap)
    - Current candle is below VWAP (close <= vwap)
    """
    if len(ohlcv) < 2 or len(vwap_values) < 2:
        return False
    
    prev_close = float(ohlcv[-2].get("close", 0.0))
    curr_close = float(ohlcv[-1].get("close", 0.0))
    prev_vwap = vwap_values[-2]
    curr_vwap = vwap_values[-1]
    
    if math.isnan(prev_vwap) or math.isnan(curr_vwap):
        return False
    
    if prev_close > prev_vwap and curr_close <= curr_vwap:
        return True
    
    return False


# ─── ATR (Average True Range) ────────────────────────────────────────────

def calculate_atr(ohlcv: list[dict], period: int = 14) -> list[float]:
    """
    Calculate ATR (Average True Range) using Wilder's smoothing.
    
    True Range = max(high - low, |high - prev_close|, |low - prev_close|)
    ATR = Wilder's smoothed average of True Range.
    
    Args:
        ohlcv: List of OHLCV dicts with keys: high, low, close
        period: ATR period (default 14)
        
    Returns:
        List of ATR values. First (period-1) elements = float('nan').
    """
    n = len(ohlcv)
    if n < period:
        return [float("nan")] * n
    
    # Calculate True Range for each candle
    tr_values: list[float] = [float("nan")] * n
    for i in range(n):
        high = float(ohlcv[i].get("high", 0.0))
        low = float(ohlcv[i].get("low", 0.0))
        close = float(ohlcv[i].get("close", 0.0))
        
        if i == 0:
            tr = high - low
        else:
            prev_close = float(ohlcv[i-1].get("close", 0.0))
            tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        
        tr_values[i] = tr
    
    # Wilder's smoothing for ATR
    atr_values: list[float] = [float("nan")] * n
    
    # First ATR = SMA of first 'period' TR values (skip first which has no prev_close)
    first_atr = sum(tr_values[1:period+1]) / period
    atr_values[period] = first_atr
    
    # Wilder's smoothing: ATR[i] = (ATR[i-1] * (period-1) + TR[i]) / period
    for i in range(period + 1, n):
        atr_values[i] = (atr_values[i-1] * (period - 1) + tr_values[i]) / period
    
    return atr_values


def calculate_stop_loss(entry_price: float, atr_values: list[float], multiplier: float = 1.5) -> float:
    """
    Calculate stop loss price based on ATR.
    
    Formula: entry_price - (ATR * multiplier)
    For long positions only (bearish/short would be entry + ATR*multiplier).
    
    Args:
        entry_price: Entry price
        atr_values: ATR values from calculate_atr()
        multiplier: ATR multiplier (default 1.5, user specified 1.5~2.0)
        
    Returns:
        Stop loss price
    """
    if not atr_values or math.isnan(atr_values[-1]):
        return entry_price * 0.95  # fallback: 5% stop
    
    atr = atr_values[-1]
    return entry_price - (atr * multiplier)


def calculate_trailing_stop(current_price: float, atr_values: list[float], multiplier: float = 2.0) -> float:
    """
    Calculate trailing stop price based on ATR.
    
    Formula: current_price - (ATR * multiplier)
    Stop moves up as price rises (trailing behind).
    
    Args:
        current_price: Current price
        atr_values: ATR values from calculate_atr()
        multiplier: ATR multiplier (default 2.0)
        
    Returns:
        Trailing stop price
    """
    if not atr_values or math.isnan(atr_values[-1]):
        return current_price * 0.95  # fallback
    
    atr = atr_values[-1]
    return current_price - (atr * multiplier)


# ─── Support/Resistance Detection ────────────────────────────────────────

def _find_pivots(prices: list[float], prd: int) -> tuple[list[int], list[int]]:
    """
    Find swing highs and lows (pivot points).
    Ported from divergence_engine.py pattern.
    
    Args:
        prices: List of price values (usually closes)
        prd: Period to look on each side (default 2 means 2 candles each side)
        
    Returns:
        (high_indices, low_indices)
    """
    highs: list[int] = []
    lows: list[int] = []
    n = len(prices)
    
    # Need at least 2*prd+1 candles to find a pivot
    for i in range(prd, n - prd):
        v = prices[i]
        if math.isnan(v):
            continue
        
        # Get all neighbors (prd on each side)
        left = prices[i - prd: i]
        right = prices[i + 1: i + prd + 1]
        neighbors = left + right
        
        if any(math.isnan(x) for x in neighbors):
            continue
        
        # Check if current is highest (swing high) or lowest (swing low)
        if v > max(neighbors):
            highs.append(i)
        if v < min(neighbors):
            lows.append(i)
    
    return highs, lows


def detect_swing_lows(ohlcv: list[dict], prd: int = 5) -> list[int]:
    """Find swing low indices."""
    closes = [float(c.get("close", 0.0)) for c in ohlcv]
    _, lows = _find_pivots(closes, prd)
    return lows


def detect_swing_highs(ohlcv: list[dict], prd: int = 5) -> list[int]:
    """Find swing high indices."""
    closes = [float(c.get("close", 0.0)) for c in ohlcv]
    highs, _ = _find_pivots(closes, prd)
    return highs


def is_near_support(ohlcv: list[dict], current_idx: int = -1, threshold_pct: float = 0.02) -> bool:
    """
    Check if current price is near a support zone (swing low).
    
    Args:
        ohlcv: OHLCV data
        current_idx: Index to check (-1 for latest)
        threshold_pct: How close to swing low (2% default)
        
    Returns:
        True if price is within threshold_pct of a swing low
    """
    if not ohlcv:
        return False
    
    idx = current_idx if current_idx >= 0 else len(ohlcv) + current_idx
    if idx < 0 or idx >= len(ohlcv):
        return False
    
    current_price = float(ohlcv[idx].get("close", 0.0))
    swing_lows = detect_swing_lows(ohlcv)
    
    if not swing_lows:
        return False
    
    # Check distance to nearest swing low
    for low_idx in swing_lows:
        if low_idx < len(ohlcv):
            low_price = float(ohlcv[low_idx].get("close", 0.0))
            distance_pct = abs(current_price - low_price) / low_price
            if distance_pct <= threshold_pct:
                return True
    
    return False


def detect_higher_low(ohlcv: list[dict], lookback: int = 20) -> bool:
    """
    Check if recent low is a Higher Low (bullish market state).
    
    Returns True if:
    - There are at least 2 swing lows in lookback period
    - Most recent low > previous low
    """
    if len(ohlcv) < lookback:
        return False
    
    recent_data = ohlcv[-lookback:]
    swing_lows = detect_swing_lows(recent_data)
    
    if len(swing_lows) < 2:
        return False
    
    # Get prices of last 2 swing lows
    last_low_idx = swing_lows[-1]
    prev_low_idx = swing_lows[-2]
    
    if last_low_idx < len(recent_data) and prev_low_idx < len(recent_data):
        last_low = recent_data[last_low_idx].get("close", 0.0)
        prev_low = recent_data[prev_low_idx].get("close", 0.0)
        return last_low > prev_low  # Higher Low
    
    return False


def detect_lower_low(ohlcv: list[dict], lookback: int = 20) -> bool:
    """
    Check if Lower Low continues (bearish market state).
    
    Returns True if:
    - There are at least 2 swing lows in lookback period
    - Most recent low < previous low
    """
    if len(ohlcv) < lookback:
        return False
    
    recent_data = ohlcv[-lookback:]
    swing_lows = detect_swing_lows(recent_data)
    
    if len(swing_lows) < 2:
        return False
    
    last_low_idx = swing_lows[-1]
    prev_low_idx = swing_lows[-2]
    
    if last_low_idx < len(recent_data) and prev_low_idx < len(recent_data):
        last_low = recent_data[last_low_idx].get("close", 0.0)
        prev_low = recent_data[prev_low_idx].get("close", 0.0)
        return last_low < prev_low  # Lower Low
    
    return False


# ─── Volume Analysis ─────────────────────────────────────────────────────

def detect_volume_decrease_stabilize(ohlcv: list[dict], lookback: int = 10) -> bool:
    """
    Check if volume decreased then stabilized (setup condition).
    
    Pattern: Volume decreases over first half, then stabilizes (flat or slight increase) in second half.
    
    Args:
        ohlcv: OHLCV data
        lookback: Number of candles to analyze
        
    Returns:
        True if volume decrease + stabilization pattern detected
    """
    if len(ohlcv) < lookback:
        return False
    
    volumes = [float(c.get("volume", 0.0)) for c in ohlcv[-lookback:]]
    half = lookback // 2
    
    # First half: should decrease
    first_half = volumes[:half]
    # Check if generally decreasing
    first_decreasing = all(first_half[i] >= first_half[i+1] for i in range(len(first_half)-1))
    
    if not first_decreasing:
        return False
    
    # Second half: should stabilize (not decrease further)
    second_half = volumes[half:]
    avg_second = sum(second_half) / len(second_half)
    avg_first_last = sum(first_half[-2:]) / 2
    
    # Stabilized if second half avg >= last first half value (bottom formed)
    return avg_second >= avg_first_last * 0.95  # Allow 5% tolerance


def detect_volume_increase(ohlcv: list[dict], lookback: int = 5) -> bool:
    """
    Check if volume is increasing (for pyramid adding trigger).
    
    Returns True if volume is generally increasing over lookback period.
    """
    if len(ohlcv) < lookback:
        return False
    
    volumes = [float(c.get("volume", 0.0)) for c in ohlcv[-lookback:]]
    
    # Check if generally increasing (allow some noise)
    increases = sum(1 for i in range(1, len(volumes)) if volumes[i] > volumes[i-1])
    return increases >= len(volumes) // 2  # Majority increasing


def is_falling_with_volume_increase(ohlcv: list[dict], lookback: int = 5) -> bool:
    """
    Check for falling state with volume increase (buy-prohibited state).
    
    Conditions:
    - Consecutive bearish candles (close < open)
    - Volume increasing
    """
    if len(ohlcv) < lookback:
        return False
    
    recent = ohlcv[-lookback:]
    
    # Check for consecutive bearish candles
    bearish_count = sum(1 for c in recent if float(c.get("close", 0)) < float(c.get("open", 0)))
    if bearish_count < 2:  # Need at least 2 bearish candles
        return False
    
    # Check volume increase
    return detect_volume_increase(ohlcv, lookback)
