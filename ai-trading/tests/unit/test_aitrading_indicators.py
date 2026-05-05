"""
Unit tests for aitrading indicators.
Tests VWAP, ATR, support/resistance detection, volume analysis.
"""
import math
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from src.signals.aitrading_indicators import (
    calculate_vwap, detect_vwap_breakout, detect_vwap_breakdown,
    calculate_atr, calculate_stop_loss, calculate_trailing_stop,
    detect_swing_lows, detect_swing_highs, is_near_support,
    detect_higher_low, detect_lower_low,
    detect_volume_decrease_stabilize, detect_volume_increase, is_falling_with_volume_increase
)


class TestCalculateVWAP:
    """Tests for VWAP calculation."""
    
    def test_calculate_vwap_basic(self):
        """Test basic VWAP calculation with 2 candles."""
        ohlcv = [
            {"high": 110, "low": 90, "close": 100, "volume": 1000},
            {"high": 115, "low": 95, "close": 105, "volume": 1500}
        ]
        result = calculate_vwap(ohlcv)
        assert len(result) == 2
        # First element = typical_price (100) since cum_vol starts
        assert result[0] == 100.0
        # Second: (100*1000 + 105*1500) / (1000+1500) = (100000 + 157500) / 2500 = 103.0
        assert abs(result[1] - 103.0) < 0.01
    
    def test_calculate_vwap_empty(self):
        """Test VWAP with empty input."""
        result = calculate_vwap([])
        assert result == []
    
    def test_calculate_vwap_single(self):
        """Test VWAP with single candle."""
        ohlcv = [{"high": 110, "low": 90, "close": 100, "volume": 1000}]
        result = calculate_vwap(ohlcv)
        assert len(result) == 1
        assert result[0] == 100.0
    
    def test_calculate_vwap_session_anchored(self):
        """Test session-anchored VWAP - reset on date change."""
        ohlcv = [
            {"high": 110, "low": 90, "close": 100, "volume": 1000, "timestamp": "2026-05-05T09:00:00"},
            {"high": 115, "low": 95, "close": 105, "volume": 1500, "timestamp": "2026-05-05T10:00:00"},
            {"high": 120, "low": 100, "close": 110, "volume": 2000, "timestamp": "2026-05-06T09:00:00"},  # New session
            {"high": 125, "low": 105, "close": 115, "volume": 2500, "timestamp": "2026-05-06T10:00:00"}
        ]
        result = calculate_vwap(ohlcv, session_anchored=True)
        assert len(result) == 4
        # After session reset, third element should start fresh
        # Third candle: (110*2000) / 2000 = 110.0 (fresh start)
        assert abs(result[2] - 110.0) < 0.01


class TestDetectVWAPBreakout:
    """Tests for VWAP breakout detection."""
    
    def test_vwap_breakout_true(self):
        """Test breakout detection - price crosses above VWAP."""
        ohlcv = [
            {"high": 110, "low": 90, "close": 100, "volume": 1000},
            {"high": 105, "low": 85, "close": 95, "volume": 1200},
            {"high": 115, "low": 95, "close": 105, "volume": 1300}  # This should cross above VWAP
        ]
        vwap = calculate_vwap(ohlcv)
        result = detect_vwap_breakout(ohlcv, vwap)
        assert result == True
    
    def test_vwap_breakout_false(self):
        """Test no breakout - price stays below VWAP."""
        ohlcv = [
            {"high": 110, "low": 90, "close": 100, "volume": 1000},
            {"high": 105, "low": 85, "close": 95, "volume": 1200},
            {"high": 103, "low": 83, "close": 93, "volume": 1300}  # Still below
        ]
        vwap = calculate_vwap(ohlcv)
        result = detect_vwap_breakout(ohlcv, vwap)
        assert result == False
    
    def test_vwap_breakout_insufficient_data(self):
        """Test breakout with insufficient data."""
        ohlcv = [{"high": 110, "low": 90, "close": 100, "volume": 1000}]
        vwap = [100.0]
        result = detect_vwap_breakout(ohlcv, vwap)
        assert result == False


class TestDetectVWAPBreakdown:
    """Tests for VWAP breakdown detection."""
    
    def test_vwap_breakdown_true(self):
        """Test breakdown - price crosses below VWAP."""
        ohlcv = [
            {"high": 110, "low": 90, "close": 100, "volume": 1000},
            {"high": 115, "low": 95, "close": 105, "volume": 1200},
            {"high": 103, "low": 85, "close": 95, "volume": 1300}  # Crosses below
        ]
        vwap = calculate_vwap(ohlcv)
        result = detect_vwap_breakdown(ohlcv, vwap)
        assert result == True


class TestCalculateATR:
    """Tests for ATR calculation."""
    
    def test_calculate_atr_basic(self):
        """Test basic ATR calculation."""
        ohlcv = [
            {"high": 110, "low": 90, "close": 100},
            {"high": 115, "low": 95, "close": 105},
            {"high": 120, "low": 100, "close": 110}
        ]
        result = calculate_atr(ohlcv, period=2)
        assert len(result) == 3
        assert math.isnan(result[0])  # First element NaN for period=2
        assert not math.isnan(result[2])  # Should have value
    
    def test_calculate_atr_empty(self):
        """Test ATR with empty input."""
        result = calculate_atr([], period=14)
        assert result == []
    
    def test_calculate_atr_insufficient_data(self):
        """Test ATR with insufficient data."""
        ohlcv = [{"high": 110, "low": 90, "close": 100}]
        result = calculate_atr(ohlcv, period=14)
        assert len(result) == 1
        assert math.isnan(result[0])


class TestCalculateStopLoss:
    """Tests for stop loss calculation."""
    
    def test_calculate_stop_loss_basic(self):
        """Test stop loss = entry - ATR*multiplier."""
        result = calculate_stop_loss(entry_price=100.0, atr_values=[math.nan, 5.0, 5.0], multiplier=1.5)
        assert result == 92.5  # 100 - 5.0*1.5
    
    def test_calculate_stop_loss_nan_fallback(self):
        """Test stop loss with NaN ATR (fallback to 5%)."""
        result = calculate_stop_loss(entry_price=100.0, atr_values=[], multiplier=1.5)
        assert result == 95.0  # 100 * 0.95


class TestCalculateTrailingStop:
    """Tests for trailing stop calculation."""
    
    def test_calculate_trailing_stop_basic(self):
        """Test trailing stop = current - ATR*multiplier."""
        result = calculate_trailing_stop(current_price=110.0, atr_values=[math.nan, 5.0, 5.0], multiplier=2.0)
        assert result == 100.0  # 110 - 5.0*2.0
    
    def test_calculate_trailing_stop_nan_fallback(self):
        """Test trailing stop with NaN ATR."""
        result = calculate_trailing_stop(current_price=110.0, atr_values=[], multiplier=2.0)
        assert result == 104.5  # 110 * 0.95


class TestDetectSwingLows:
    """Tests for swing low detection."""
    
    def test_detect_swing_lows_basic(self):
        """Test basic swing low detection."""
        # For prd=2, i=2 checks [0,1] and [3,4] - need prices[2] lowest
        # prices[2]=90 is lowest in [100,95,98,102]
        ohlcv = [
            {"high": 105, "low": 95, "close": 100},  # i=0
            {"high": 100, "low": 90, "close": 95},  # i=1
            {"high": 98, "low": 85, "close": 90},  # i=2: 90 is lowest in window [100,95,98,102]
            {"high": 108, "low": 88, "close": 98},  # i=3
            {"high": 112, "low": 95, "close": 102}   # i=4
        ]
        result = detect_swing_lows(ohlcv, prd=2)
        assert len(result) > 0
        assert 2 in result  # Index 2 should be detected as swing low
    
    def test_detect_swing_lows_insufficient_data(self):
        """Test with insufficient data."""
        ohlcv = [{"high": 105, "low": 95, "close": 100}, {"high": 100, "low": 90, "close": 95}]
        result = detect_swing_lows(ohlcv, prd=5)
        assert result == []


class TestDetectHigherLow:
    """Tests for Higher Low detection."""
    
    def test_detect_higher_low_true(self):
        """Test Higher Low detection - recent low > previous low."""
        # detect_swing_lows uses prd=5 by default
        # Need n >= 11 for range(5, n-5) to have any pivots
        # For Higher Low: need 2+ swing lows where last > previous
        # Design: price 90 at i=5, price 92 at i=11 -> 92 > 90 = Higher Low
        prices = [100]*5 + [90] + [95]*5 + [92] + [100]*5
        ohlcv = [{"high": p+10, "low": p-10, "close": p} for p in prices]
        result = detect_higher_low(ohlcv, lookback=len(prices))
        assert result == True
    
    def test_detect_higher_low_false(self):
        """Test not Higher Low - recent low < previous low."""
        ohlcv = [
            {"high": 110, "low": 90, "close": 100},
            {"high": 108, "low": 92, "close": 95},  # swing low 1 (95)
            {"high": 105, "low": 88, "close": 93},  # swing low 2 (93) < 95
            {"high": 115, "low": 90, "close": 102}
        ]
        result = detect_higher_low(ohlcv, lookback=4)
        assert result == False


class TestDetectLowerLow:
    """Tests for Lower Low detection."""
    
    def test_detect_lower_low_true(self):
        """Test Lower Low detection - recent low < previous low."""
        # With prd=5: swing lows at i=5 (92), i=11 (90) -> 90 < 92 = Lower Low
        prices = [100]*5 + [92] + [95]*5 + [90] + [100]*5
        ohlcv = [{"high": p+10, "low": p-10, "close": p} for p in prices]
        result = detect_lower_low(ohlcv, lookback=len(prices))
        assert result == True


class TestIsNearSupport:
    """Tests for support zone detection."""
    
    def test_is_near_support_true(self):
        """Test price near swing low (within 2%)."""
        # detect_swing_lows uses prd=5, need n>=11 for range(5, n-5)
        # Design: swing low at i=5 (90), current at i=10 (91) -> 1.1% diff
        prices = [100]*5 + [90] + [100]*4 + [91]  # i=5=90 (swing low), i=10=91 (current)
        ohlcv = [{"high": p+10, "low": p-10, "close": p} for p in prices]
        result = is_near_support(ohlcv, current_idx=-1, threshold_pct=0.02)
        assert result == True


class TestVolumeDecreaseStabilize:
    """Tests for volume decrease + stabilize pattern."""
    
    def test_volume_decrease_stabilize_true(self):
        """Test volume decrease then stabilize."""
        # lookback=5: half=2
        # first_half=[1000,990] (decreasing)
        # second_half=[980,985,990] (stabilized - not decreasing)
        # avg_second=985, avg_first_last=(1000+990)/2=995
        # 985 >= 995*0.95=945.25? YES
        ohlcv = [{"volume": v} for v in [1000, 990, 980, 985, 990]]
        result = detect_volume_decrease_stabilize(ohlcv, lookback=5)
        assert result == True
    
    def test_volume_decrease_stabilize_false(self):
        """Test volume still decreasing (no stabilize)."""
        ohlcv = [{"volume": v} for v in [1000, 800, 600, 400, 300]]
        result = detect_volume_decrease_stabilize(ohlcv, lookback=5)
        assert result == False


class TestVolumeIncrease:
    """Tests for volume increase detection."""
    
    def test_detect_volume_increase_true(self):
        """Test volume generally increasing."""
        ohlcv = [{"volume": v} for v in [1000, 1200, 1100, 1300, 1400]]
        result = detect_volume_increase(ohlcv, lookback=5)
        assert result == True


class TestIsFallingWithVolumeIncrease:
    """Tests for falling + volume increase (buy-prohibited)."""
    
    def test_is_falling_with_volume_increase_true(self):
        """Test bearish candles + volume increase."""
        ohlcv = [
            {"close": 100, "open": 102, "volume": 1000},  # Bearish
            {"close": 95, "open": 98, "volume": 1200},   # Bearish + vol↑
            {"close": 93, "open": 96, "volume": 1300}    # Bearish + vol↑
        ]
        result = is_falling_with_volume_increase(ohlcv, lookback=3)
        assert result == True
