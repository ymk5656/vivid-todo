import asyncio
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import yaml

from src.core.abstract_exchange import AbstractExchange
from src.data.trade_repository import TradeRepository
from src.monitoring.telegram_notifier import TelegramNotifier
from src.orders.circuit_breaker import CircuitBreaker
from src.orders.order_manager import OrderManager
from src.orders.risk_engine import RiskEngine
from src.data.market_data import fetch_ohlcv
from src.signals.signal_models import Action, SignalResult
from src.signals.tradingview_provider import TradingViewProvider
from src.strategies.base_strategy import AbstractStrategy
from src.strategies.strategy_simple import SimpleStrategy
from src.strategies.strategy_ai import AIStrategy
from src.strategies.aitrading_strategy import AITradingStrategy
from src.strategies.ma_crossover_strategy import MACrossoverStrategy
from src.strategies.volatility_sizing_strategy import VolatilitySizingStrategy

logger = logging.getLogger(__name__)

# How often to run the AI evaluation loop per interval setting
INTERVAL_POLL_SECONDS: dict[str, int] = {
    "1m":  60,
    "5m":  60,    # every 1 min (5x per interval)
    "15m": 300,   # every 5 min (3x per interval)
    "30m": 300,   # every 5 min (6x per interval)
    "1h":  300,   # every 5 min (12x per interval)
    "4h":  600,   # every 10 min
    "1d":  600,   # every 10 min
}


@dataclass
class _TradeCounter:
    """Per-symbol trade accumulation state for balanced buy/sell sizing."""
    buy_count: int = 0
    sell_count: int = 0
    avg_sell_price: float = 0.0   # rolling average price of consecutive sells


class TradingBot:
    def __init__(
        self,
        exchanges: dict[str, AbstractExchange],
        strategy: AbstractStrategy | None = None,
        repo: TradeRepository | None = None,
        config_path: str = "config/config.yaml",
    ):
        self._exchanges = exchanges
        # Strategy selection: env -> config -> default (MA Crossover)
        config_strategy = self._load_config().get("strategy", {}).get("name", "ma_crossover")
        if config_strategy == "aitrading":
            default_strategy = AITradingStrategy()
        elif config_strategy == "ai":
            default_strategy = AIStrategy()
        elif config_strategy == "ma_crossover":
            default_strategy = MACrossoverStrategy()
        elif config_strategy == "volatility_sizing":
            default_strategy = VolatilitySizingStrategy()
        else:
            default_strategy = MACrossoverStrategy()  # default fallback
        self._strategy = strategy or default_strategy
        self._repo = repo
        self._config_path = config_path
        self._running = False
        self._mode = "ALL"               # CRYPTO | STOCK | ALL
        self._last_signals: list[SignalResult] = []
        self._last_alerts: list[dict] = []
        self._trade_counters: dict[str, _TradeCounter] = {}

        self._tv = TradingViewProvider()
        self._notifier = TelegramNotifier()
        self._cb = CircuitBreaker(repo=repo)
        self._risk = RiskEngine()
        self._order_mgr = OrderManager(
            exchanges=exchanges,
            repo=repo,
            circuit_breaker=self._cb,
            risk_engine=self._risk,
            notifier=self._notifier,
        )

    # ------------------------------------------------------------------ config

    def _load_config(self) -> dict:
        try:
            with open(self._config_path) as f:
                return yaml.safe_load(f) or {}
        except Exception:
            return {}

    def _symbols(self, cfg: dict) -> list[str]:
        symbols: list[str] = []
        if self._mode in ("CRYPTO", "ALL"):
            symbols += cfg.get("crypto", {}).get("symbols", [])
        if self._mode in ("STOCK", "ALL"):
            symbols += cfg.get("stocks", {}).get("symbols", [])
        db_symbols = self._repo.get_setting("symbols")
        if db_symbols:
            symbols = [s.strip() for s in db_symbols.split(",") if s.strip()]
        return symbols

    def _interval(self, cfg: dict) -> str:
        db_val = self._repo.get_setting("interval")
        return db_val or cfg.get("trading", {}).get("interval", "1h")

    def _enabled_indicators(self, cfg: dict) -> list[str]:
        db_val = self._repo.get_setting("enabled_indicators")
        if db_val:
            return [i.strip() for i in db_val.split(",") if i.strip()]
        return cfg.get("indicators", {}).get("enabled", [])

    def _risk_params(self, cfg: dict) -> tuple[float, float, float, float, float]:
        """Return (loss_alert_pct, stop_loss_pct, take_profit_pct, max_position_pct, amount_krw)."""
        risk_cfg = cfg.get("risk", {})
        loss_alert_pct = float(self._repo.get_setting("size_pct") or risk_cfg.get("size_pct", 10.0))
        stop_loss_pct = float(self._repo.get_setting("stop_loss_pct") or risk_cfg.get("stop_loss_pct", 2.0))
        take_profit_pct = float(self._repo.get_setting("take_profit_pct") or risk_cfg.get("take_profit_pct", 4.0))
        max_position_pct = float(risk_cfg.get("max_position_pct", 20.0))
        amount_krw = float(self._repo.get_setting("amount_krw") or risk_cfg.get("default_amount_krw", 100_000))
        return loss_alert_pct, stop_loss_pct, take_profit_pct, max_position_pct, amount_krw

    # ------------------------------------------------------------------ run loop

    def set_mode(self, mode: str):
        self._mode = mode.upper()
        logger.info("Trading mode set to %s", self._mode)

    def start(self):
        self._running = True
        logger.info("TradingBot started (mode=%s)", self._mode)

    def stop(self):
        self._running = False
        logger.info("TradingBot stopped")

    @property
    def running(self) -> bool:
        return self._running

    @property
    def last_signals(self) -> list[SignalResult]:
        return self._last_signals

    @property
    def last_alerts(self) -> list[dict]:
        return self._last_alerts

    @property
    def circuit_breaker_status(self) -> dict:
        return self._cb.status()

    # ------------------------------------------------------------------ trade counter helpers

    def _counter(self, symbol: str) -> _TradeCounter:
        if symbol not in self._trade_counters:
            self._trade_counters[symbol] = _TradeCounter()
        return self._trade_counters[symbol]

    def _apply_buy_sizing(self, symbol: str, decision, current_price: float, amount_krw: float) -> None:
        """Set decision.override_amount_krw with counter-based multiplier for BUY orders."""
        counter = self._counter(symbol)
        sell_n = counter.sell_count

        if sell_n > 0 and counter.avg_sell_price > 0 and current_price < counter.avg_sell_price:
            # Buying back below where we sold — scale up proportionally
            base = amount_krw * sell_n
            logger.info(
                "%s BUY×%d (avg_sell=%.2f > price=%.2f) → %.0f KRW",
                symbol, sell_n, counter.avg_sell_price, current_price, base,
            )
        else:
            base = amount_krw

        # AI size_hint is encoded in decision.size_pct (0–100 scale); apply it to base
        hint_factor = decision.size_pct / 100.0 if decision.size_pct > 0 else 1.0
        decision.override_amount_krw = base * hint_factor

        # Reset sell counter; increment buy counter
        counter.sell_count = 0
        counter.avg_sell_price = 0.0
        counter.buy_count += 1

    def _apply_sell_tracking(self, symbol: str, current_price: float) -> None:
        """Update counter when a SELL decision is issued."""
        counter = self._counter(symbol)
        n = counter.sell_count
        # Rolling average sell price
        counter.avg_sell_price = (counter.avg_sell_price * n + current_price) / (n + 1)
        counter.sell_count += 1
        counter.buy_count = 0   # reset buy accumulation on sell

    # ------------------------------------------------------------------ loss alert

    def _check_loss_alert(self, loss_alert_pct: float) -> Optional[dict]:
        """Return an alert dict if today's loss exceeds loss_alert_pct of total portfolio."""
        try:
            daily_pnl = self._repo.get_daily_pnl()
            if daily_pnl >= 0:
                return None
            # Estimate portfolio from any available exchange
            for ex in self._exchanges.values():
                try:
                    portfolio_krw = ex.get_krw_balance()
                    if portfolio_krw > 0:
                        loss_pct = abs(daily_pnl) / portfolio_krw * 100
                        if loss_pct >= loss_alert_pct:
                            return {
                                "level": "error",
                                "message": (
                                    f"손실 경보: 오늘 손실 {loss_pct:.1f}% — "
                                    f"설정 한도 {loss_alert_pct:.1f}% 초과 "
                                    f"(손실액 {abs(daily_pnl):,.0f}원)"
                                ),
                            }
                        return None
                except Exception:
                    continue
        except Exception:
            pass
        return None

    def _load_strategy(self) -> AbstractStrategy:
        """Load strategy by name: DB setting -> config.yaml -> default (ma_crossover)."""
        name = self._repo.get_setting("strategy_name") if self._repo else ""
        if not name:
            cfg = self._load_config()
            name = cfg.get("strategy", {}).get("name", "ma_crossover")

        if name == "aitrading":
            return AITradingStrategy()
        if name == "ai":
            return AIStrategy()
        if name == "ma_crossover":
            return MACrossoverStrategy()
        if name == "volatility_sizing":
            # Read target_vol from config for this strategy
            cfg = self._load_config()
            target_vol = float(cfg.get("strategy", {}).get("target_vol", 0.10))
            return VolatilitySizingStrategy(target_vol=target_vol)
        # Fallback
        return MACrossoverStrategy()

    # ------------------------------------------------------------------ tick

    def tick(self):
        """Run one evaluation cycle (called from the async loop)."""
        if not self._running:
            return

        # Reload strategy from DB each cycle (allows UI switching without restart)
        self._strategy = self._load_strategy()

        cfg = self._load_config()
        symbols = self._symbols(cfg)
        interval = self._interval(cfg)
        indicators = self._enabled_indicators(cfg)
        loss_alert_pct, stop_loss_pct, take_profit_pct, max_position_pct, amount_krw = self._risk_params(cfg)

        # Strategy always uses 100% of the fixed amount_krw budget (no percentage sizing)
        self._strategy.update_risk_params(100.0, stop_loss_pct, take_profit_pct)
        self._risk.update_max_position_pct(max_position_pct)

        if not symbols:
            logger.warning("No symbols configured")
            return

        alerts: list[dict] = []

        # Loss alert check
        loss_alert = self._check_loss_alert(loss_alert_pct)
        if loss_alert:
            alerts.append(loss_alert)

        signals = self._tv.get_signals_bulk(symbols, interval=interval, enabled_indicators=indicators)
        self._last_signals = signals

        for signal in signals:
            ohlcv = fetch_ohlcv(signal.symbol, interval=interval, count=250)
            decision = self._strategy.evaluate(signal, ohlcv=ohlcv)

            # Overwrite TradingView fields with actual strategy decision
            signal.action = decision.action
            signal.confirmed = decision.action != Action.NEUTRAL
            signal.ai_note = decision.reason[:120] if decision.reason else ""

            current_price = ohlcv[-1]["close"] if ohlcv else 0.0

            if decision.action == Action.BUY and current_price > 0:
                self._apply_buy_sizing(signal.symbol, decision, current_price, amount_krw)
            elif decision.action == Action.SELL and current_price > 0:
                self._apply_sell_tracking(signal.symbol, current_price)

            self._order_mgr.execute(decision)

        order_alerts = self._order_mgr.pop_alerts()
        self._last_alerts = alerts + order_alerts

    async def run_async(self):
        """Async loop — run inside FastAPI lifespan."""
        self._running = True
        while self._running:
            try:
                self.tick()
            except Exception as exc:
                logger.error("Bot tick error: %s", exc, exc_info=True)
                self._notifier.notify_error(str(exc))
            cfg = self._load_config()
            interval = self._interval(cfg)
            poll_seconds = INTERVAL_POLL_SECONDS.get(interval, 60)
            logger.debug("Next tick in %ds (interval=%s)", poll_seconds, interval)
            await asyncio.sleep(poll_seconds)
