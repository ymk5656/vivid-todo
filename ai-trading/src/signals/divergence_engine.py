"""
Divergence detector for 10 indicators.
Ported from "Divergence for Many Indicators v4" (LonesomeTheBlue).

Four divergence types:
  pos_reg  — price lower-low  + indicator higher-low  (bullish reversal)
  neg_reg  — price higher-high + indicator lower-high  (bearish reversal)
  pos_hid  — price higher-low  + indicator lower-low   (bullish continuation)
  neg_hid  — price lower-high  + indicator higher-high (bearish continuation)
"""
from __future__ import annotations

import math
from dataclasses import dataclass


# ─── Math helpers ─────────────────────────────────────────────────────────────

def _sma(data: list[float], period: int) -> list[float]:
    out = [math.nan] * len(data)
    for i in range(period - 1, len(data)):
        out[i] = sum(data[i - period + 1: i + 1]) / period
    return out


def _ema(data: list[float], period: int) -> list[float]:
    out = [math.nan] * len(data)
    k = 2.0 / (period + 1)
    start = next((i for i, v in enumerate(data) if not math.isnan(v)), None)
    if start is None:
        return out
    out[start] = data[start]
    for i in range(start + 1, len(data)):
        prev = out[i - 1]
        v = data[i]
        out[i] = (v * k + prev * (1 - k)) if not math.isnan(v) and not math.isnan(prev) else prev
    return out


# ─── Indicator series ─────────────────────────────────────────────────────────

def _rsi(closes: list[float], period: int = 14) -> list[float]:
    n = len(closes)
    out = [math.nan] * n
    if n <= period:
        return out
    gains = [max(closes[i] - closes[i - 1], 0.0) for i in range(1, n)]
    losses = [max(closes[i - 1] - closes[i], 0.0) for i in range(1, n)]
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    out[period] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    for i in range(period + 1, n):
        avg_g = (avg_g * (period - 1) + gains[i - 1]) / period
        avg_l = (avg_l * (period - 1) + losses[i - 1]) / period
        out[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return out


def _macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    ef = _ema(closes, fast)
    es = _ema(closes, slow)
    line = [a - b if not (math.isnan(a) or math.isnan(b)) else math.nan for a, b in zip(ef, es)]
    sig = _ema(line, signal)
    hist = [a - b if not (math.isnan(a) or math.isnan(b)) else math.nan for a, b in zip(line, sig)]
    return line, sig, hist


def _cci(ohlcv: list[dict], period: int = 10) -> list[float]:
    tp = [(c["high"] + c["low"] + c["close"]) / 3.0 for c in ohlcv]
    out = [math.nan] * len(tp)
    for i in range(period - 1, len(tp)):
        w = tp[i - period + 1: i + 1]
        mean = sum(w) / period
        mad = sum(abs(v - mean) for v in w) / period
        out[i] = (tp[i] - mean) / (0.015 * mad) if mad else 0.0
    return out


def _momentum(closes: list[float], period: int = 10) -> list[float]:
    out = [math.nan] * len(closes)
    for i in range(period, len(closes)):
        out[i] = closes[i] - closes[i - period]
    return out


def _obv(ohlcv: list[dict]) -> list[float]:
    out = [0.0]
    for i in range(1, len(ohlcv)):
        if ohlcv[i]["close"] > ohlcv[i - 1]["close"]:
            out.append(out[-1] + ohlcv[i]["volume"])
        elif ohlcv[i]["close"] < ohlcv[i - 1]["close"]:
            out.append(out[-1] - ohlcv[i]["volume"])
        else:
            out.append(out[-1])
    return out


def _vwma(closes: list[float], volumes: list[float], period: int) -> list[float]:
    out = [math.nan] * len(closes)
    for i in range(period - 1, len(closes)):
        pv = sum(closes[i - j] * volumes[i - j] for j in range(period))
        v = sum(volumes[i - j] for j in range(period))
        out[i] = pv / v if v else closes[i]
    return out


def _vw_macd(ohlcv: list[dict], fast: int = 12, slow: int = 26) -> list[float]:
    closes = [c["close"] for c in ohlcv]
    vols = [c["volume"] for c in ohlcv]
    vf = _vwma(closes, vols, fast)
    vs = _vwma(closes, vols, slow)
    return [a - b if not (math.isnan(a) or math.isnan(b)) else math.nan for a, b in zip(vf, vs)]


def _cmf(ohlcv: list[dict], period: int = 21) -> list[float]:
    out = [math.nan] * len(ohlcv)
    for i in range(period - 1, len(ohlcv)):
        mfv = vol = 0.0
        for j in range(i - period + 1, i + 1):
            c, h, l, v = ohlcv[j]["close"], ohlcv[j]["high"], ohlcv[j]["low"], ohlcv[j]["volume"]
            hl = h - l
            mfv += ((c - l) - (h - c)) / hl * v if hl else 0.0
            vol += v
        out[i] = mfv / vol if vol else 0.0
    return out


def _mfi(ohlcv: list[dict], period: int = 14) -> list[float]:
    tp = [(c["high"] + c["low"] + c["close"]) / 3.0 for c in ohlcv]
    out = [math.nan] * len(ohlcv)
    for i in range(period, len(ohlcv)):
        pos = sum(tp[j] * ohlcv[j]["volume"] for j in range(i - period + 1, i + 1) if tp[j] >= tp[j - 1])
        neg = sum(tp[j] * ohlcv[j]["volume"] for j in range(i - period + 1, i + 1) if tp[j] < tp[j - 1])
        out[i] = 100 - 100 / (1 + pos / neg) if neg else 100.0
    return out


def _stoch_smooth(ohlcv: list[dict], k_period: int = 14, smooth: int = 3) -> list[float]:
    n = len(ohlcv)
    raw = [math.nan] * n
    for i in range(k_period - 1, n):
        hh = max(c["high"] for c in ohlcv[i - k_period + 1: i + 1])
        ll = min(c["low"]  for c in ohlcv[i - k_period + 1: i + 1])
        raw[i] = (ohlcv[i]["close"] - ll) / (hh - ll) * 100 if hh != ll else 50.0
    return _sma(raw, smooth)


# ─── Pivot detection ─────────────────────────────────────────────────────────

def _find_pivots(series: list[float], prd: int) -> tuple[list[int], list[int]]:
    highs: list[int] = []
    lows: list[int] = []
    n = len(series)
    for i in range(prd, n - prd):
        v = series[i]
        if math.isnan(v):
            continue
        left = series[i - prd: i]
        right = series[i + 1: i + prd + 1]
        neighbors = left + right
        if any(math.isnan(x) for x in neighbors):
            continue
        if v > max(neighbors):
            highs.append(i)
        if v < min(neighbors):
            lows.append(i)
    return highs, lows


# ─── Virtual-line validation ─────────────────────────────────────────────────

def _line_not_broken_below(series: list[float], i1: int, i2: int) -> bool:
    """No bar between i1..i2 dips below the straight line connecting them."""
    if i2 <= i1 + 1:
        return True
    y1, y2 = series[i1], series[i2]
    slope = (y2 - y1) / (i2 - i1)
    for k in range(i1 + 1, i2):
        v = series[k]
        if math.isnan(v):
            continue
        if v < y1 + slope * (k - i1):
            return False
    return True


def _line_not_broken_above(series: list[float], i1: int, i2: int) -> bool:
    """No bar between i1..i2 rises above the straight line connecting them."""
    if i2 <= i1 + 1:
        return True
    y1, y2 = series[i1], series[i2]
    slope = (y2 - y1) / (i2 - i1)
    for k in range(i1 + 1, i2):
        v = series[k]
        if math.isnan(v):
            continue
        if v > y1 + slope * (k - i1):
            return False
    return True


# ─── Core divergence detection ────────────────────────────────────────────────

@dataclass
class DivergenceResult:
    indicator: str
    div_type: str   # pos_reg | neg_reg | pos_hid | neg_hid
    bar_index: int
    rsi_value: float = 0.0  # RSI value at divergence bar (for filtering)


def _detect(price: list[float], ind: list[float], name: str,
            prd: int, lookback: int) -> list[DivergenceResult]:
    results: list[DivergenceResult] = []
    price_ph, price_pl = _find_pivots(price, prd)

    # ── Bullish (at price pivot lows) ─────────────────────────────────────────
    for i, idx2 in enumerate(price_pl):
        prev_pl = [j for j in price_pl[:i] if 0 < idx2 - j <= lookback]
        if not prev_pl:
            continue
        idx1 = prev_pl[-1]
        p1, p2 = price[idx1], price[idx2]
        i1, i2 = ind[idx1], ind[idx2]
        if math.isnan(i1) or math.isnan(i2):
            continue

        if p2 < p1 and i2 > i1:   # pos_reg: price LL, indicator HL
            if (_line_not_broken_below(price, idx1, idx2)
                    and _line_not_broken_below(ind, idx1, idx2)):
                results.append(DivergenceResult(name, "pos_reg", idx2))

        elif p2 > p1 and i2 < i1:  # pos_hid: price HL, indicator LL
            if (_line_not_broken_below(price, idx1, idx2)
                    and _line_not_broken_below(ind, idx1, idx2)):
                results.append(DivergenceResult(name, "pos_hid", idx2))

    # ── Bearish (at price pivot highs) ────────────────────────────────────────
    for i, idx2 in enumerate(price_ph):
        prev_ph = [j for j in price_ph[:i] if 0 < idx2 - j <= lookback]
        if not prev_ph:
            continue
        idx1 = prev_ph[-1]
        p1, p2 = price[idx1], price[idx2]
        i1, i2 = ind[idx1], ind[idx2]
        if math.isnan(i1) or math.isnan(i2):
            continue

        if p2 > p1 and i2 < i1:   # neg_reg: price HH, indicator LH
            if (_line_not_broken_above(price, idx1, idx2)
                    and _line_not_broken_above(ind, idx1, idx2)):
                results.append(DivergenceResult(name, "neg_reg", idx2))

        elif p2 < p1 and i2 > i1:  # neg_hid: price LH, indicator HH
            if (_line_not_broken_above(price, idx1, idx2)
                    and _line_not_broken_above(ind, idx1, idx2)):
                results.append(DivergenceResult(name, "neg_hid", idx2))

    return results


# ─── Public API ───────────────────────────────────────────────────────────────

def calculate_divergences(
    ohlcv: list[dict],
    prd: int = 5,
    lookback: int = 60,
    rsi_filter: bool = True,
) -> list[DivergenceResult]:
    """Return divergences found in the most recent `lookback` bars.
    
    Args:
        ohlcv: OHLCV data
        prd: Pivot detection period
        lookback: Number of recent bars to check
        rsi_filter: If True, filter divergences by RSI value:
            - Bullish (pos_reg, pos_hid): RSI ≤ 20 required
            - Bearish (neg_reg, neg_hid): RSI ≥ 80 required
    """
    if len(ohlcv) < 2 * prd + lookback + 30:
        return []

    closes = [c["close"] for c in ohlcv]
    price = closes

    rsi_values = _rsi(closes)
    macd_line, _, macd_hist = _macd(closes)
    indicators = {
        "RSI":      rsi_values,
        "MACD":     macd_line,
        "MACD_H":   macd_hist,
        "STOCH":    _stoch_smooth(ohlcv),
        "CCI":      _cci(ohlcv),
        "MOM":      _momentum(closes),
        "OBV":      _obv(ohlcv),
        "VWMACD":   _vw_macd(ohlcv),
        "CMF":      _cmf(ohlcv),
        "MFI":      _mfi(ohlcv),
    }

    threshold = len(ohlcv) - lookback
    all_divs: list[DivergenceResult] = []
    for name, series in indicators.items():
        for d in _detect(price, series, name, prd, lookback):
            if d.bar_index >= threshold:
                # Add RSI value to result
                rsi_at_bar = rsi_values[d.bar_index] if d.bar_index < len(rsi_values) else 0.0
                d.rsi_value = rsi_at_bar
                
                # Apply RSI filter if enabled
                if rsi_filter:
                    if d.div_type in ("pos_reg", "pos_hid"):  # Bullish divergence
                        if rsi_at_bar > 20:  # RSI must be ≤ 20 for strong bullish
                            continue
                    elif d.div_type in ("neg_reg", "neg_hid"):  # Bearish divergence
                        if rsi_at_bar < 80:  # RSI must be ≥ 80 for weak bearish
                            continue
                
                all_divs.append(d)

    return all_divs


def summarize_divergences(divs: list[DivergenceResult]) -> dict:
    """Flatten divergence results into a dict for SignalResult.indicators."""
    if not divs:
        return {}
    by_type: dict[str, set[str]] = {}
    for d in divs:
        by_type.setdefault(d.div_type, set()).add(d.indicator)
    out: dict[str, object] = {}
    for dtype, inds in by_type.items():
        out[f"div_{dtype}"] = ",".join(sorted(inds))
        out[f"div_{dtype}_count"] = len(inds)
    return out
