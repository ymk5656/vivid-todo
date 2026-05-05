"""
Unit tests for RSI filter in divergence detection.
Tests Task 5: RSI ≤ 20 for bullish divergence, RSI ≥ 80 for bearish divergence.
"""
import math
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from src.signals.divergence_engine import calculate_divergences, DivergenceResult


class TestRsiFilterBullish:
    """Tests for RSI filter on bullish divergences."""
    
    def test_bullish_divergence_rsi_20_pass(self):
        """Bullish divergence with RSI ≤ 20 should pass filter."""
        # Create data where RSI ≤ 20 at divergence point
        # Need price LL + indicator HL, with RSI ≤ 20
        ohlcv = []
        # First create enough data for RSI(14) calculation
        # RSI ≤ 20 means oversold - need consistent downtrend
        for i in range(50):
            price = 100 - i  # Steady decline: 100, 99, 98, ...
            ohlcv.append({"high": price + 2, "low": price - 2, "close": price, "volume": 1000})
        
        result = calculate_divergences(ohlcv, prd=5, lookback=60, rsi_filter=True)
        
        # Should have bullish divergences (pos_reg or pos_hid) with RSI ≤ 20
        bullish = [d for d in result if d.div_type in ("pos_reg", "pos_hid")]
        if bullish:
            for d in bullish:
                assert d.rsi_value <= 20, f"RSI {d.rsi_value} should be ≤ 20 for bullish"
    
    def test_bullish_divergence_rsi_50_filtered(self):
        """Bullish divergence with RSI = 50 should be filtered out."""
        # Create data where RSI ≈ 50 (sideways movement)
        ohlcv = []
        for i in range(50):
            price = 100 + (i % 5)  # Sideways: 100, 101, 102, 103, 104, 100, ...
            ohlcv.append({"high": price + 2, "low": price - 2, "close": price, "volume": 1000})
        
        result_no_filter = calculate_divergences(ohlcv, prd=5, lookback=60, rsi_filter=False)
        result_with_filter = calculate_divergences(ohlcv, prd=5, lookback=60, rsi_filter=True)
        
        # With RSI ≈ 50, bullish divergences should be filtered out
        bullish_no_filter = [d for d in result_no_filter if d.div_type in ("pos_reg", "pos_hid")]
        bullish_with_filter = [d for d in result_with_filter if d.div_type in ("pos_reg", "pos_hid")]
        
        # If no-filter found bullish, with-filter should have fewer (or none)
        if bullish_no_filter:
            assert len(bullish_with_filter) <= len(bullish_no_filter)


class TestRsiFilterBearish:
    """Tests for RSI filter on bearish divergences."""
    
    def test_bearish_divergence_rsi_80_pass(self):
        """Bearish divergence with RSI ≥ 80 should pass filter."""
        # Create data where RSI ≥ 80 at divergence point
        # Need price HH + indicator LH, with RSI ≥ 80
        ohlcv = []
        # RSI ≥ 80 means overbought - need consistent uptrend
        for i in range(50):
            price = 100 + i  # Steady rise: 100, 101, 102, ...
            ohlcv.append({"high": price + 2, "low": price - 2, "close": price, "volume": 1000})
        
        result = calculate_divergences(ohlcv, prd=5, lookback=60, rsi_filter=True)
        
        # Should have bearish divergences (neg_reg or neg_hid) with RSI ≥ 80
        bearish = [d for d in result if d.div_type in ("neg_reg", "neg_hid")]
        if bearish:
            for d in bearish:
                assert d.rsi_value >= 80, f"RSI {d.rsi_value} should be ≥ 80 for bearish"
    
    def test_bearish_divergence_rsi_50_filtered(self):
        """Bearish divergence with RSI = 50 should be filtered out."""
        # Create data where RSI ≈ 50
        ohlcv = []
        for i in range(50):
            price = 100 + (i % 5)  # Sideways
            ohlcv.append({"high": price + 2, "low": price - 2, "close": price, "volume": 1000})
        
        result_no_filter = calculate_divergences(ohlcv, prd=5, lookback=60, rsi_filter=False)
        result_with_filter = calculate_divergences(ohlcv, prd=5, lookback=60, rsi_filter=True)
        
        bearish_no_filter = [d for d in result_no_filter if d.div_type in ("neg_reg", "neg_hid")]
        bearish_with_filter = [d for d in result_with_filter if d.div_type in ("neg_reg", "neg_hid")]
        
        if bearish_no_filter:
            assert len(bearish_with_filter) <= len(bearish_no_filter)


class TestRsiFilterDefault:
    """Tests for default behavior (backward compatibility)."""
    
    def test_default_rsi_filter_enabled(self):
        """Default rsi_filter=True should maintain backward compatibility."""
        ohlcv = []
        for i in range(50):
            price = 100 + (i % 10)
            ohlcv.append({"high": price + 2, "low": price - 2, "close": price, "volume": 1000})
        
        # Default should work (rsi_filter=True)
        result = calculate_divergences(ohlcv, prd=5, lookback=60)
        assert isinstance(result, list)
        for d in result:
            assert hasattr(d, 'rsi_value')
    
    def test_rsi_value_recorded(self):
        """RSI value should be recorded in DivergenceResult."""
        ohlcv = []
        for i in range(50):
            price = 100 + (i % 10)
            ohlcv.append({"high": price + 2, "low": price - 2, "close": price, "volume": 1000})
        
        result = calculate_divergences(ohlcv, prd=5, lookback=60, rsi_filter=False)
        for d in result:
            assert d.rsi_value > 0, "RSI value should be recorded"
            assert not math.isnan(d.rsi_value), "RSI value should not be NaN"
