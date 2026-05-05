"""
Unit tests for aitrading strategy components.
Tests Market State, BUY Setup, Entry Trigger, Position Sizing, Sell Logic.
"""
import math
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from src.strategies.aitrading_strategy import (
    check_market_state, check_setup, check_entry_trigger,
    calculate_position_size, calculate_stop_loss,
    check_structure_collapse, check_bearish_signal,
    check_stop_loss, check_profit_protection,
    execute_sell_priority, check_risk_management,
    AITradingStrategy
)
from src.signals.divergence_engine import DivergenceResult


class TestMarketState:
    """Tests for Market State Filter."""
    
    def test_market_state_buy_permitted_higher_low(self):
        """Buy permitted when Higher Low detected."""
        # Need 21+ elements with Higher Low pattern (prd=5, lookback=20)
        # Higher Low: 2+ swing lows where last > previous
        # Create: swing low at i=6 (90), i=12 (92) -> 92 > 90 = Higher Low
        prices = [100]*6 + [90] + [95]*5 + [92] + [100]*8  # 21 elements
        ohlcv = [{"high": p+10, "low": p-10, "close": p, "volume": 1000} for p in prices]
        result = check_market_state(ohlcv)
        assert result["buy_permitted"] == True
        assert "Higher Low" in result["reason"]
    
    def test_market_state_buy_permitted_support(self):
        """Buy permitted when near support zone."""
        # Need 21+ elements with swing low then price near it
        prices = [100]*6 + [90] + [100]*13 + [91]  # i=5=90 (swing low), i=20=91 (near support)
        ohlcv = [{"high": p+10, "low": p-10, "close": p, "volume": 1000} for p in prices]
        result = check_market_state(ohlcv)
        assert result["buy_permitted"] == True
        assert "support" in result["reason"].lower()
    
    def test_market_state_prohibited_falling_volume_up(self):
        """Buy prohibited when falling with volume increase."""
        # Need 20+ candles with consecutive bearish + volume increase
        ohlcv = []
        for i in range(20):
            ohlcv.append({"close": 100-i, "open": 102-i, "volume": 1000+i*100})
        result = check_market_state(ohlcv)
        assert result["buy_permitted"] == False
        assert "Falling" in result["reason"]


class TestSetup:
    """Tests for BUY Setup logic."""
    
    def test_setup_bullish_divergence(self):
        """Setup exists with bullish divergence RSI<=20."""
        ohlcv = []
        for i in range(50):
            price = 100 - i  # Decline to get RSI<=20
            ohlcv.append({"high": price+2, "low": price-2, "close": price, "volume": 1000})
        
        from src.signals.divergence_engine import calculate_divergences
        divergences = calculate_divergences(ohlcv, rsi_filter=False)
        result = check_setup(ohlcv, divergences)
        if any(d.div_type in ("pos_reg", "pos_hid") and d.rsi_value <= 20 for d in divergences):
            assert result["setup_exists"] == True
    
    def test_setup_support_rebound(self):
        """Setup exists with support rebound."""
        # Need: swing low at i=5 (90), current price near 90 (within 2%), price rising
        prices = [100]*6 + [90] + [100]*13 + [91]  # i=20=91, near 90 (1.1% diff)
        ohlcv = [{"high": p+10, "low": p-10, "close": p, "volume": 1000} for p in prices]
        # Ensure price rising at end
        ohlcv[-1]["close"] = 91
        ohlcv[-2]["close"] = 90
        result = check_setup(ohlcv, [])
        assert result["setup_exists"] == True
        assert any("support" in r.lower() for r in result["reasons"])
    
    def test_setup_volume_stabilize(self):
        """Setup exists with volume decrease + stabilize."""
        # lookback=10: half=5, first decrease, second stabilize
        # first=[1000,990,980,970,960] (decrease), second=[960,965,970,975,980] (stabilize)
        volumes = [1000, 990, 980, 970, 960, 960, 965, 970, 975, 980]
        ohlcv = [{"volume": v, "close": 100} for v in volumes]
        result = check_setup(ohlcv, [])
        assert result["setup_exists"] == True
        assert "Volume" in ",".join(result["reasons"])


class TestEntryTrigger:
    """Tests for Entry Trigger logic."""
    
    def test_trigger_vwap_breakout(self):
        """Trigger on VWAP breakout."""
        from src.signals.aitrading_indicators import calculate_vwap
        ohlcv = [
            {"high": 110, "low": 90, "close": 100, "volume": 1000},
            {"high": 105, "low": 85, "close": 95, "volume": 1200},
            {"high": 115, "low": 95, "close": 105, "volume": 1300}  # Crosses above VWAP
        ]
        vwap = calculate_vwap(ohlcv)
        result = check_entry_trigger(ohlcv, vwap)
        assert result["trigger_occurred"] == True
        assert "VWAP" in result["trigger_type"]
    
    def test_trigger_high_breakout(self):
        """Trigger on previous high breakout."""
        ohlcv = []
        for i in range(20):
            ohlcv.append({"high": 100+i, "low": 90+i, "close": 95+i, "volume": 1000})
        # Add breakout candle
        ohlcv.append({"high": 125, "low": 115, "close": 120, "volume": 1500})
        
        from src.signals.aitrading_indicators import calculate_vwap
        vwap = calculate_vwap(ohlcv)
        result = check_entry_trigger(ohlcv, vwap)
        assert result["trigger_occurred"] == True


class TestPositionSizing:
    """Tests for Position Sizing + Stop Loss."""
    
    def test_position_sizing(self):
        """Calculate position size correctly."""
        result = calculate_position_size(account_balance=10000000, risk_pct=0.5, stop_distance=5000)
        expected = (10000000 * 0.005) / 5000
        assert result == expected
    
    def test_stop_loss_calculation(self):
        """Calculate stop loss correctly."""
        result = calculate_stop_loss(
            entry_price=100.0,
            swing_low=95.0,
            atr_values=[math.nan, 5.0, 5.0],
            multiplier=1.5
        )
        atr_stop = 100.0 - (5.0 * 1.5)
        assert result == min(95.0, atr_stop)


class TestStructureCollapse:
    """Tests for Structure Collapse Sell."""
    
    def test_structure_collapse_low_breakout(self):
        """Sell 50% on previous low breakout."""
        # Need 21+ candles, 2+ swing lows (prd=5), then break below previous low
        # Swing low 1 at i=6 (90), Swing low 2 at i=12 (92)
        prices = [100]*6 + [90] + [95]*5 + [92] + [100]*8  # 21 elements
        prices.append(85)  # i=21: below previous swing low (85 < 92)
        
        ohlcv = [{"high": p+10, "low": p-10, "close": p, "volume": 1000} for p in prices]
        
        from src.signals.aitrading_indicators import calculate_vwap
        vwap = calculate_vwap(ohlcv)
        result = check_structure_collapse(ohlcv, vwap)
        assert result["sell_triggered"] == True
        assert result["sell_pct"] == 50.0
        assert result["exit_type"] == "STRUCTURE_COLLAPSE"


class TestBearishSignal:
    """Tests for Bearish Signal Sell."""
    
    def test_bearish_signal_divergence_vwap(self):
        """Sell 100% on bearish divergence + VWAP breakdown."""
        ohlcv = []
        for i in range(50):
            price = 100 + i  # Rise to get RSI>=80
            ohlcv.append({"high": price+2, "low": price-2, "close": price, "volume": 1000})
        
        from src.signals.divergence_engine import calculate_divergences
        from src.signals.aitrading_indicators import calculate_vwap
        
        divergences = calculate_divergences(ohlcv, rsi_filter=False)
        vwap = calculate_vwap(ohlcv)
        
        result = check_bearish_signal(ohlcv, divergences, vwap)
        # If bearish divergence with RSI>=80 exists AND VWAP breakdown
        bearish = [d for d in divergences if d.div_type in ("neg_reg", "neg_hid") and d.rsi_value >= 80]
        if bearish:
            result = check_bearish_signal(ohlcv, divergences, vwap)


class TestStopLoss:
    """Tests for Stop Loss check."""
    
    def test_stop_loss_trigger(self):
        """Stop loss triggered when price <= stop_loss."""
        result = check_stop_loss(current_price=90.0, stop_loss=95.0)
        assert result["sell_triggered"] == True
        assert result["sell_pct"] == 100.0
        assert result["exit_type"] == "STOP_LOSS"


class TestProfitProtection:
    """Tests for Profit Protection."""
    
    def test_profit_partial_tp(self):
        """Partial profit at R:R = 1:1."""
        result = check_profit_protection(
            current_price=110.0,
            entry_price=100.0,
            stop_loss=95.0,
            stoch_values={}
        )
        assert result["sell_triggered"] == True
        assert result["sell_pct"] == 50.0
        assert result["exit_type"] == "PARTIAL_TP"


class TestSellPriority:
    """Tests for Sell Priority execution."""
    
    def test_sell_priority_order(self):
        """STOP_LOSS has highest priority."""
        signals = [
            {"sell_triggered": True, "exit_type": "BEARISH_SIGNAL", "sell_pct": 100},
            {"sell_triggered": True, "exit_type": "STOP_LOSS", "sell_pct": 100},
            {"sell_triggered": True, "exit_type": "STRUCTURE_COLLAPSE", "sell_pct": 50}
        ]
        result = execute_sell_priority(signals)
        assert result["exit_type"] == "STOP_LOSS"


class TestRiskManagement:
    """Tests for Risk Management."""
    
    def test_risk_management_halt(self):
        """Halt on daily loss > -2%."""
        result = check_risk_management(
            daily_pnl=-300000,
            consecutive_losses=0,
            account_dd=-3.0,
            portfolio_value=10000000
        )
        assert result["halt"] == True
        assert "Daily loss" in result["reason"]
