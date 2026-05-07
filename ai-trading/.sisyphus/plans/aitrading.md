# aitrading Strategy Implementation Plan

## TL;DR

> **Quick Summary**: Implement a new isolated trading strategy (`aitrading_strategy.py`) with revised BUY/SELL logic that removes EMA200 filter, adds RSI-filtered divergence (≤20 for bullish, ≥80 for bearish), implements VWAP/ATR indicators, and introduces Structure Collapse + Bearish Signal sell concepts.
>
> **Deliverables**:
> - `src/strategies/aitrading_strategy.py` - Main strategy with isolated logic
> - `src/signals/aitrading_indicators.py` - VWAP, ATR, support/resistance, volume analysis
> - Modified `src/signals/divergence_engine.py` - Add RSI filter to divergence
> - Unit tests for all new components
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Indicators (Wave 1) → Strategy (Wave 2) → Integration (Wave 3) → Tests (Wave 4)

---

## Context

### Original Request
Create a new `aitrading` strategy system in `E:\project\ai-trading` directory based on detailed Korean trading strategies (BUY/SELL) that go beyond the existing simple TV signal strategy.

### Interview Summary
**Key Discussions**:
- **Divergence RSI Filter**: Strong bullish needs RSI ≤ 20, weak bearish needs RSI ≥ 80
- **EMA200 REMOVED**: Replaced with Higher Low / Support zone market filter
- **Strategy Isolation**: All strategy logic must be isolated for easy modification
- **K35/K65/K100**: Confirmed as Stochastic oscillator periods (K=35/65/100, D=3), already implemented
- **New Sell Concepts**: Structure Collapse (구조 붕괴) and Bearish Signal (약세 신호)

**Research Findings**:
- Existing `divergence_engine.py` has 10 indicators + 4 divergence types (need RSI filter added)
- `stochastic_engine.py` already implements K35/K65/K100 (confirmed by user)
- VWAP formula: cumulative(price×volume) / cumulative(volume), session-anchored
- ATR: 14-period standard, True Range = max(high-low, |high-prev_close|, |low-prev_close|)
- Test infrastructure exists: pytest 8.0+ with pytest-asyncio

### Metis Review
**Identified Gaps** (addressed):
- Strategy isolation requirement emphasized by user → Created separate `aitrading_indicators.py`
- Divergence RSI filter → Added to `divergence_engine.py` modification task
- EMA200 removal → Updated all strategy tasks to use new market filter
- RSI thresholds clarified: ≤20 for strong bullish, ≥80 for weak bearish

---

## Work Objectives

### Core Objective
Implement a production-ready trading strategy with multi-step conditional logic (market filter → setup → trigger → entry) and comprehensive risk management, isolated for easy modification.

### Concrete Deliverables
- `src/strategies/aitrading_strategy.py` - Main strategy class inheriting AbstractStrategy
- `src/signals/aitrading_indicators.py` - All new indicators (VWAP, ATR, support/resistance, volume)
- Modified `src/signals/divergence_engine.py` - Add RSI filter parameter
- `tests/unit/test_aitrading_strategy.py` - Unit tests for strategy logic
- `tests/unit/test_aitrading_indicators.py` - Unit tests for indicators

### Definition of Done
- [x] All BUY conditions implemented and tested (market filter, setup, trigger, entry)
- [x] All SELL conditions implemented and tested (stop loss, structure collapse, profit protection, bearish signal)
- [x] RSI-filtered divergence working (≤20 for bullish, ≥80 for bearish)
- [x] VWAP, ATR, Stochastic K35/K65/K100 indicators functional
- [x] Strategy integrated with TradingBot orchestrator
- [x] All tests pass: `pytest tests/unit/test_aitrading*.py -v`

### Must Have
- Market State Filter: Higher Low OR Support zone (NO EMA200!)
- Setup: Bullish divergence (RSI≤20) OR support rebound OR volume stabilization
- Entry Trigger: VWAP re-breakout OR previous high breakout
- Stop Loss: min(swing_low, entry - ATR×1.5~2), set immediately
- Structure Collapse Sell: Previous low break → 50%, Lower High + VWAP → 100%
- Bearish Signal Sell: Divergence (RSI≥80) + VWAP break → 100%
- Risk Management: Daily -2% halt, 3-loss streak halt, -10% DD review

### Must NOT Have (Guardrails)
- NO EMA200 filter (explicitly removed by user)
- NO complex dependencies outside strategy files
- NO modification to existing strategies (TVSignalStrategy, etc.)
- NO AI confirmation layer (use existing AIConfirmer separately if needed)
- NO UI changes (separate task)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision
- **Infrastructure exists**: YES (pytest 8.0+, pytest-asyncio)
- **Automated tests**: YES (TDD)
- **Framework**: pytest with asyncio support
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios (see TODO template below).
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (python -m pytest) - Run tests, verify output
- **Indicators**: Use Bash (python interactive) - Import, call functions, compare output
- **Strategy Logic**: Use Bash (python -c) - Instantiate strategy, call evaluate(), check Decision

---

## Execution Strategy

### Parallel Execution Waves

> Maximize throughput by grouping independent tasks into parallel waves.
> Each wave completes before the next begins.
> Target: 5-8 tasks per wave. Fewer than 3 per wave (except final) = under-splitting.

```
Wave 1 (Start Immediately - indicators foundation):
├── Task 1: VWAP indicator implementation [quick]
├── Task 2: ATR indicator implementation [quick]
├── Task 3: Support/Resistance detection [quick]
├── Task 4: Volume analysis (decrease+stabilize vs increase) [quick]
└── Task 5: Modify divergence_engine.py - add RSI filter [quick]

Wave 2 (After Wave 1 - core strategy, MAX PARALLEL):
├── Task 6: Market State Filter (Higher Low / Support zone) [deep]
├── Task 7: BUY Setup logic (divergence+RSI, support rebound, volume) [deep]
├── Task 8: Entry Trigger (VWAP breakout, high breakout) [deep]
├── Task 9: Position Sizing + Stop Loss logic [unspecified-high]
├── Task 10: Post-Buy Management (partial profit, trailing, pyramid) [unspecified-high]
├── Task 11: Structure Collapse Sell logic [deep]
└── Task 12: Bearish Signal Sell logic [deep]

Wave 3 (After Wave 2 - integration + remaining sells):
├── Task 13: Stop Loss + Profit Protection Sell [unspecified-high]
├── Task 14: Sell Priority + Risk Management [unspecified-high]
├── Task 15: Strategy class - wire all components [deep]
├── Task 16: Integrate with TradingBot [unspecified-high]
└── Task 17: Add exit_type to Decision dataclass if needed [quick]

Wave 4 (After Wave 3 - tests, ALL PARALLEL):
├── Task 18: Unit tests for aitrading_indicators [quick]
├── Task 19: Unit tests for aitrading_strategy [quick]
├── Task 20: Integration test with mock data [unspecified-high]
└── Task 21: Run all tests + verify [quick]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1-5 → Task 6-12 → Task 15 → Task 16 → Task 18-20 → F1-F4 → user okay
Parallel Speedup: ~75% faster than sequential
Max Concurrent: 7 (Wave 2)
```

### Dependency Matrix (abbreviated)

- **1-5**: - - 6-12, 15
- **6**: 1-5 - 7, 8, 15
- **7**: 1-5, 6 - 8, 15
- **8**: 1-5, 6, 7 - 15
- **9**: 1-5, 2 - 15
- **10**: 1-5, 8, 9 - 15
- **11**: 1-5, 3 - 15
- **12**: 1-5, 2, 3 - 15
- **15**: 6-14 - 16, 18-20
- **16**: 15 - 19
- **18-20**: 15, 16 - F1-F4

> Full matrix in each task's "Parallelization" section below.

### Agent Dispatch Summary

- **1**: **5** - T1 → `quick`, T2 → `quick`, T3 → `quick`, T4 → `quick`, T5 → `quick`
- **2**: **7** - T6 → `deep`, T7 → `deep`, T8 → `deep`, T9 → `unspecified-high`, T10 → `unspecified-high`, T11 → `deep`, T12 → `deep`
- **3**: **5** - T13 → `unspecified-high`, T14 → `unspecified-high`, T15 → `deep`, T16 → `unspecified-high`, T17 → `quick`
- **4**: **3** - T18 → `quick`, T19 → `quick`, T20 → `unspecified-high`
- **4**: **1** - T21 → `quick`
- **FINAL**: **4** - F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

- [x] 1. Implement VWAP (Volume Weighted Average Price) indicator

  **What to do**:
  - Create `calculate_vwap(ohlcv: list[dict], session_anchored: bool = True) -> list[float]` in `src/signals/aitrading_indicators.py`
  - Formula: cumulative((high+low+close)/3 * volume) / cumulative(volume)
  - If session_anchored: Reset cumulative sum at each session start (look for date change)
  - Return list of VWAP values aligned with input OHLCV
  - Add `detect_vwap_breakout(ohlcv, vwap_values) -> bool` helper

  **Must NOT do**:
  - Do NOT modify existing `stochastic_engine.py` or `divergence_engine.py`
  - Do NOT add VWAP to TradingViewProvider (separate concern)

  **Recommended Agent Profile**:
  > Select category + skills based on task domain. Justify each choice.
  - **Category**: `quick`
    - Reason: Simple mathematical calculation with clear formula, no complex logic branches
  - **Skills**: `[]`
    - No additional skills needed - pure Python math operations
  - **Skills Evaluated but Omitted**:
    - `pandas`: Overkill for this simple calculation, standard library sufficient

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Tasks 8, 12, 15 (VWAP breakout needed for entry trigger and bearish signal)
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  - `src/signals/stochastic_engine.py:11-63` - See pattern for OHLCV-based indicator calculation
  - WebSearch Result (VWAP): Formula and session-anchor pattern documented in research findings
  - `src/signals/divergence_engine.py:19-36` - See `_ema()`, `_sma()` helper patterns

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] Test file created: `tests/unit/test_aitrading_indicators.py::test_calculate_vwap`
  - [ ] `pytest tests/unit/test_aitrading_indicators.py::test_calculate_vwap -v` → PASS
  - [ ] Test session-anchored reset: date change triggers reset
  - [ ] Test breakout detection: price crossing above/below VWAP

  **QA Scenarios (MANDATORY)**:

  Scenario: VWAP calculation correctness
    Tool: Bash (python)
    Preconditions: OHLCV data with known values
    Steps:
      1. python -c "from src.signals.aitrading_indicators import calculate_vwap; ohlcv = [{'high': 110, 'low': 90, 'close': 100, 'volume': 1000}, {'high': 115, 'low': 95, 'close': 105, 'volume': 1500}]; result = calculate_vwap(ohlcv); print(result)"
      2. Verify result length matches input length
      3. Verify VWAP = ((100*1000) + (105*1500)) / (1000+1500) for second element
    Expected Result: [100.0, 102.0] (exact calculation)
    Failure Indicators: Wrong length, incorrect VWAP values, division by zero
    Evidence: `.sisyphus/evidence/task-1-vwap-calc.txt`

  Scenario: VWAP breakout detection
    Tool: Bash (python)
    Preconditions: OHLCV with price crossing VWAP
    Steps:
      1. python -c "from src.signals.aitrading_indicators import calculate_vwap, detect_vwap_breakout; ohlcv = [{'close': 100, 'volume': 1000}, {'close': 95, 'volume': 1200}, {'close': 105, 'volume': 1300}]; vwap = calculate_vwap(ohlcv); result = detect_vwap_breakout(ohlcv, vwap); print(result)"
      2. Verify returns True when price crosses above VWAP
      3. Verify returns False when price below VWAP
    Expected Result: True (price 105 > VWAP value)
    Evidence: `.sisyphus/evidence/task-1-vwap-breakout.txt`

  **Evidence to Capture:**
  - [ ] Each evidence file named: task-{N}-{scenario-slug}.{ext}
  - [ ] Calculation outputs for verification

  **Commit**: YES
  - Message: `feat(indicators): add VWAP calculation and breakout detection`
  - Files: `src/signals/aitrading_indicators.py`
  - Pre-commit: `pytest tests/unit/test_aitrading_indicators.py::test_calculate_vwap -v`

---

- [x] 2. Implement ATR (Average True Range) indicator

  **What to do**:
  - Add `calculate_atr(ohlcv: list[dict], period: int = 14) -> list[float]` to `aitrading_indicators.py`
  - True Range = max(high-low, |high-prev_close|, |low-prev_close|)
  - ATR = SMA(True Range, period) with Wilder's smoothing
  - Return list of ATR values (first period-1 elements = NaN)
  - Add helpers: `calculate_stop_loss(entry_price, atr_values, multiplier=1.5)` and `calculate_trailing_stop(current_price, atr_values, multiplier=2.0)`

  **Must NOT do**:
  - Do NOT use external libraries (TA-Lib, pandas-ta) - use pure Python for minimal deps
  - Do NOT modify existing strategies

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mathematical formula with clear steps, no complex branching
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: `numpy`: Unnecessary for this simple rolling calculation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Tasks 9, 10, 15 (ATR needed for stop loss, trailing stop)
  - **Blocked By**: None

  **References**:
  - WebSearch Result (ATR): Formula and Wilder's smoothing documented in research
  - `src/signals/divergence_engine.py:19-36` - See `_sma()` helper for rolling average pattern

  **Acceptance Criteria**:
  - [ ] Test file: `tests/unit/test_aitrading_indicators.py::test_calculate_atr`
  - [ ] `pytest tests/unit/test_aitrading_indicators.py::test_calculate_atr -v` → PASS
  - [ ] Stop loss calculation: entry - ATR*multiplier
  - [ ] Trailing stop: current_price - ATR*multiplier

  **QA Scenarios**:

  Scenario: ATR calculation correctness
    Tool: Bash (python)
    Preconditions: OHLCV with known high/low/close values
    Steps:
      1. python -c "from src.signals.aitrading_indicators import calculate_atr; ohlcv = [{'high': 110, 'low': 90, 'close': 100}, {'high': 115, 'low': 95, 'close': 105}, {'high': 120, 'low': 100, 'close': 110}]; result = calculate_atr(ohlcv, period=2); print(result)"
      2. Verify True Range calculation for each candle
      3. Verify ATR = SMA(True Ranges) with Wilder's smoothing
    Expected Result: [NaN, 10.0, 12.5] (example values)
    Evidence: `.sisyphus/evidence/task-2-atr-calc.txt`

  Scenario: Stop loss calculation
    Tool: Bash (python)
    Steps:
      1. python -c "from src.signals.aitrading_indicators import calculate_stop_loss; result = calculate_stop_loss(entry_price=100.0, atr_values=[NaN, 5.0, 5.0], multiplier=1.5); print(result)"
    Expected Result: 92.5 (100 - 5.0*1.5)
    Evidence: `.sisyphus/evidence/task-2-stop-loss.txt`

  **Commit**: YES
  - Message: `feat(indicators): add ATR with stop loss and trailing stop helpers`
  - Files: `src/signals/aitrading_indicators.py`

---

- [x] 3. Implement Support/Resistance zone detection

  **What to do**:
  - Add `detect_swing_lows(ohlcv: list[dict], prd: int = 5) -> list[int]` - Find swing low indices
  - Add `detect_swing_highs(ohlcv: list[dict], prd: int = 5) -> list[int]` - Find swing high indices
  - Add `is_near_support(ohlcv: list[dict], current_idx: int, threshold_pct: float = 0.02) -> bool`
  - Add `detect_higher_low(ohlcv: list[dict], lookback: int = 20) -> bool` - Check if recent low is higher than previous
  - Add `detect_lower_low(ohlcv: list[dict], lookback: int = 20) -> bool` - Check if Lower Low continues
  - Reuse pivot detection logic from `divergence_engine.py:150-167`

  **Must NOT do**:
  - Do NOT implement full market state filter (Task 6 will use these helpers)
  - Do NOT modify `divergence_engine.py` pivot logic (copy pattern only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Porting existing pivot logic with minor modifications
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Tasks 6, 7, 11, 15 (support zone and Low detection needed)
  - **Blocked By**: None

  **References**:
  - `src/signals/divergence_engine.py:150-167` - `_find_pivots()` function (copy pattern)
  - `src/signals/divergence_engine.py:172-199` - `_line_not_broken_below/above()` helpers

  **Acceptance Criteria**:
  - [ ] Tests: `test_detect_swing_lows`, `test_detect_higher_low`, `test_is_near_support`
  - [ ] `pytest tests/unit/test_aitrading_indicators.py::test_swing -v` → PASS

  **QA Scenarios**:

  Scenario: Higher Low detection
    Tool: Bash (python)
    Steps:
      1. python -c "from src.signals.aitrading_indicators import detect_higher_low; ohlcv = [{'close': 100}, {'close': 95}, {'close': 98}, {'close': 102}]; result = detect_higher_low(ohlcv, lookback=4); print(result)"
    Expected Result: True (98 > 95, recent low higher than previous)
    Evidence: `.sisyphus/evidence/task-3-higher-low.txt`

  **Commit**: YES
  - Message: `feat(indicators): add support/resistance and Low/High detection`
  - Files: `src/signals/aitrading_indicators.py`

---

- [x] 4. Implement Volume analysis patterns

  **What to do**:
  - Add `detect_volume_decrease_stabilize(ohlcv: list[dict], lookback: int = 10) -> bool`
    - Check if volume decreased over first half of lookback, then stabilized (flat or slight increase)
  - Add `detect_volume_increase(ohlcv: list[dict], lookback: int = 5) -> bool`
    - Check if volume is increasing (for pyramid adding trigger)
  - Add `is_falling_with_volume_increase(ohlcv: list[dict], lookback: int = 5) -> bool`
    - Check for consecutive bearish candles + volume increase (buy-prohibited state)

  **Must NOT do**:
  - Do NOT implement falling candle detection (use OHLC color: close < open = bearish)
  - Do NOT hardcode lookback values - pass as parameters

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Tasks 7, 12, 15 (volume patterns needed for setup and pyramid)
  - **Blocked By**: None

  **References**:
  - `src/signals/divergence_engine.py:86-96` - `_obv()` function shows volume iteration pattern

  **Acceptance Criteria**:
  - [ ] Tests: `test_volume_decrease_stabilize`, `test_volume_increase`, `test_falling_volume_increase`
  - [ ] `pytest tests/unit/test_aitrading_indicators.py::test_volume -v` → PASS

  **QA Scenarios**:

  Scenario: Volume decrease then stabilize
    Tool: Bash (python)
    Steps:
      1. python -c "from src.signals.aitrading_indicators import detect_volume_decrease_stabilize; ohlcv = [{'volume': 1000}, {'volume': 800}, {'volume': 600}, {'volume': 620}, {'volume': 650}]; result = detect_volume_decrease_stabilize(ohlcv, lookback=5); print(result)"
    Expected Result: True (decrease 1000→600, then stabilize 600→650)
    Evidence: `.sisyphus/evidence/task-4-volume-stabilize.txt`

  **Commit**: YES
  - Message: `feat(indicators): add volume analysis for setup and pyramid triggers`
  - Files: `src/signals/aitrading_indicators.py`

---

- [x] 5. Modify divergence_engine.py - Add RSI filter

  **What to do**:
  - Modify `calculate_divergences()` to accept new parameter: `rsi_filter: bool = True`
  - Add RSI calculation (or reuse from `_rsi()` function already in file)
  - For bullish divergence: Check if RSI ≤ 20 at divergence bar_index → valid
  - For bearish divergence: Check if RSI ≥ 80 at divergence bar_index → valid
  - Return only divergences that pass RSI filter (if enabled)
  - Update `DivergenceResult` dataclass to include `rsi_value: float` field

  **Must NOT do**:
  - Do NOT remove existing 10-indicator divergence detection
  - Do NOT change function signatures in a breaking way (add parameter with default)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Modifying existing code with clear pattern, not writing from scratch
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Tasks 7, 12, 15 (filtered divergence needed for setup and bearish signal)
  - **Blocked By**: None

  **References**:
  - `src/signals/divergence_engine.py:204-210` - `DivergenceResult` dataclass
  - `src/signals/divergence_engine.py:211-258` - `_detect()` function (add RSI check here)
  - `src/signals/divergence_engine.py:42-56` - `_rsi()` function (reuse for RSI calculation)
  - `src/signals/divergence_engine.py:263-296` - `calculate_divergences()` (modify signature)

  **Acceptance Criteria**:
  - [ ] Test: `test_divergence_with_rsi_filter` - bullish needs RSI≤20, bearish needs RSI≥80
  - [ ] `pytest tests/unit/test_divergence_engine.py::test_rsi_filter -v` → PASS
  - [ ] Default behavior: `rsi_filter=True` maintains backward compatibility

  **QA Scenarios**:

  Scenario: Bullish divergence with RSI≤20
    Tool: Bash (python)
    Steps:
      1. python -c "from src.signals.divergence_engine import calculate_divergences; import math; ohlcv = [{'close': 100, 'high': 110, 'low': 90}] * 50; # (create data with RSI≤20 and bullish divergence); result = calculate_divergences(ohlcv, rsi_filter=True); print([d for d in result if d.div_type == 'pos_reg'])"
    Expected Result: Non-empty list (divergence detected with RSI≤20)
    Evidence: `.sisyphus/evidence/task-5-divergence-rsi.txt`

  **Commit**: YES
  - Message: `feat(divergence): add RSI filter for strong bullish (≤20) and weak bearish (≥80)`
  - Files: `src/signals/divergence_engine.py`
  - Pre-commit: `pytest tests/unit/test_divergence_engine.py -v`

---

- [x] 6. Implement Market State Filter (Higher Low / Support zone)

  **What to do**:
  - Create `check_market_state(ohlcv: list[dict]) -> dict` in `aitrading_strategy.py` (or helper)
  - Return dict with keys: `buy_permitted: bool`, `reason: str`
  - **Buy-permitted conditions** (≥1 needed):
    - Recent low is Higher Low: `detect_higher_low(ohlcv, lookback=20)`
    - Near support zone: `is_near_support(ohlcv, current_idx=-1, threshold_pct=0.02)`
  - **Buy-prohibited conditions** (any triggers prohibition):
    - Falling with volume increase: `is_falling_with_volume_increase(ohlcv, lookback=5)`
    - Lower Low continues: `detect_lower_low(ohlcv, lookback=20)`

  **Must NOT do**:
  - Do NOT use EMA200 (explicitly removed by user)
  - Do NOT implement setup/trigger logic (separate tasks)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core logic that combines multiple indicators, needs careful conditional logic
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 3, 4, 5 for helpers)
  - **Parallel Group**: Wave 2 (with Tasks 7-12)
  - **Blocks**: Task 15 (market filter needed for strategy)
  - **Blocked By**: Tasks 3, 4, 5

  **References**:
  - Task 3: Support/Resistance detection helpers
  - Task 4: Volume analysis helpers
  - `src/strategies/tv_signal_strategy.py:22-46` - See `evaluate()` pattern to follow

  **Acceptance Criteria**:
  - [ ] Test: `test_market_state_buy_permitted_higher_low`
  - [ ] Test: `test_market_state_buy_permitted_support`
  - [ ] Test: `test_market_state_prohibited_falling_volume_up`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_market -v` → PASS

  **QA Scenarios**:

  Scenario: Buy-permitted state (Higher Low)
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import check_market_state; ohlcv = [{'close': 100}, {'close': 95}, {'close': 98}]; result = check_market_state(ohlcv); print(result)"
    Expected Result: `{'buy_permitted': True, 'reason': 'Higher Low detected'}`
    Evidence: `.sisyphus/evidence/task-6-market-state.txt`

  **Commit**: YES (with Task 15)
  - Message: `feat(strategy): add market state filter with Higher Low / Support zone`
  - Files: `src/strategies/aitrading_strategy.py`

---

- [x] 7. Implement BUY Setup logic

  **What to do**:
  - Create `check_setup(ohlcv: list[dict], divergences: list) -> dict` in strategy
  - Return dict: `setup_exists: bool`, `reasons: list[str]`
  - **Setup conditions** (≥1 needed):
    1. Bullish divergence ≥ 1 with RSI ≤ 20: Check `divergences` list for `pos_reg` or `pos_hid` types
    2. Support zone rebound attempt: `is_near_support()` AND price rising (close[-1] > close[-2])
    3. Volume decrease then bottom: `detect_volume_decrease_stabilize()`
  - Set `setup_exists = True` if ≥1 condition met
  - Record all matching reasons in `reasons` list

  **Must NOT do**:
  - Do NOT check entry triggers (separate task)
  - Do NOT make buy decision yet (just setup detection)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 3, 4, 5)
  - **Parallel Group**: Wave 2 (with Tasks 6, 8-12)
  - **Blocks**: Task 15 (setup needed for strategy)
  - **Blocked By**: Tasks 3, 4, 5

  **References**:
  - Task 5: Divergence with RSI filter
  - Task 3: Support zone detection
  - Task 4: Volume analysis
  - `src/signals/divergence_engine.py:299-309` - `summarize_divergences()` shows how to parse divergence results

  **Acceptance Criteria**:
  - [ ] Test: `test_setup_bullish_divergence`
  - [ ] Test: `test_setup_support_rebound`
  - [ ] Test: `test_setup_volume_stabilize`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_setup -v` → PASS

  **QA Scenarios**:

  Scenario: Setup with bullish divergence (RSI≤20)
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import check_setup; # (create ohlcv with bullish divergence RSI≤20); result = check_setup(ohlcv, divergences); print(result)"
    Expected Result: `{'setup_exists': True, 'reasons': ['Bullish divergence ≥1 with RSI≤20']}`
    Evidence: `.sisyphus/evidence/task-7-setup.txt`

  **Commit**: YES (with Task 15)

---

- [x] 8. Implement Entry Trigger logic

  **What to do**:
  - Create `check_entry_trigger(ohlcv: list[dict], vwap_values: list[float]) -> dict` in strategy
  - Return dict: `trigger_occurred: bool`, `trigger_type: str`, `reasons: list[str]`
  - **Trigger conditions** (≥1 needed AFTER setup):
    1. VWAP re-breakout: `detect_vwap_breakout()` returns True (price crosses above VWAP)
    2. Previous high breakout: current close > max(high[-lookback:-1]) (breakout above recent high)
  - Only evaluate if setup exists (Task 7 must pass first - enforced in Task 15 orchestration)

  **Must NOT do**:
  - Do NOT check market filter (Task 6 handles that)
  - Do NOT make buy decision yet (Task 15 combines all conditions)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 1, 3)
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 9-12)
  - **Blocks**: Task 15
  - **Blocked By**: Tasks 1, 3

  **References**:
  - Task 1: VWAP calculation and breakout detection
  - Task 3: Swing high detection for "previous high"

  **Acceptance Criteria**:
  - [ ] Test: `test_trigger_vwap_breakout`
  - [ ] Test: `test_trigger_high_breakout`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_trigger -v` → PASS

  **QA Scenarios**:

  Scenario: VWAP re-breakout trigger
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import check_entry_trigger; # (ohlcv with price crossing above VWAP); result = check_entry_trigger(ohlcv, vwap_values); print(result)"
    Expected Result: `{'trigger_occurred': True, 'trigger_type': 'VWAP re-breakout', ...}`
    Evidence: `.sisyphus/evidence/task-8-trigger.txt`

  **Commit**: YES (with Task 15)

---

- [x] 9. Implement Position Sizing + Stop Loss logic

  **What to do**:
  - Create `calculate_position_size(account_balance: float, risk_pct: float, stop_distance: float) -> float` in strategy
  - Formula: position_size = (account_balance * risk_pct/100) / stop_distance
  - Risk: 0.5~1% of account (parameter: `risk_pct`)
  - Create `calculate_stop_loss(entry_price: float, swing_low: float, atr_values: list[float], multiplier: float = 1.5) -> float`
  - Formula: `min(swing_low, entry_price - atr_values[-1] * multiplier)`
  - Integrate with `Decision` dataclass: set `stop_loss_pct` field

  **Must NOT do**:
  - Do NOT execute orders (OrderManager handles that)
  - Do NOT calculate ATR (Task 2 handles that)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 2)
  - **Parallel Group**: Wave 2 (with Tasks 6-8, 10-12)
  - **Blocks**: Task 15
  - **Blocked By**: Task 2

  **References**:
  - Task 2: ATR calculation
  - Task 3: Swing low detection for stop loss
  - `src/signals/signal_models.py:61-69` - `Decision` dataclass (see `stop_loss_pct` field)

  **Acceptance Criteria**:
  - [ ] Test: `test_position_sizing`
  - [ ] Test: `test_stop_loss_calculation`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_sizing -v` → PASS

  **QA Scenarios**:

  Scenario: Position sizing calculation
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import calculate_position_size; result = calculate_position_size(account_balance=10000000, risk_pct=0.5, stop_distance=5000); print(result)"
    Expected Result: 10.0 (10,000 KRW risk / 5000 stop distance = 2 units, or whatever the formula yields)
    Evidence: `.sisyphus/evidence/task-9-sizing.txt`

  **Commit**: YES (with Task 15)

---

- [x] 10. Implement Post-Buy Management logic

  **What to do**:
  - Create `check_partial_profit(current_price: float, entry_price: float, stop_loss: float) -> dict`:
    - R:R = 1:1 → return `{'should_sell': True, 'sell_pct': 50, 'reason': 'R:R=1:1'}`
    - R:R = (current_price - entry_price) / (entry_price - stop_loss)
  - Create `calculate_trailing_stop(current_price: float, atr_values: list[float], multiplier: float = 2.0) -> float`:
    - Return `current_price - atr_values[-1] * multiplier`
  - Create `check_pyramid_add(ohlcv: list[dict], current_positions: int) -> dict`:
    - Conditions: High breakout (Task 8) AND volume increase (Task 4)
    - FORBIDDEN: Adding during downtrend (check `detect_lower_low()`)

  **Must NOT do**:
  - Do NOT actually sell (return decision, OrderManager executes)
  - Do NOT modify stop loss after entry (user says "절대 변경 금지")

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 2, 4, 8)
  - **Parallel Group**: Wave 2 (with Tasks 6-9, 11, 12)
  - **Blocks**: Task 15
  - **Blocked By**: Tasks 2, 4, 8

  **References**:
  - Task 2: ATR for trailing stop
  - Task 4: Volume increase for pyramid
  - Task 8: High breakout for pyramid

  **Acceptance Criteria**:
  - [ ] Test: `test_partial_profit_rr_1_1`
  - [ ] Test: `test_trailing_stop`
  - [ ] Test: `test_pyramid_add_conditions`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_post_buy -v` → PASS

  **QA Scenarios**:

  Scenario: Partial profit at R:R=1:1
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import check_partial_profit; result = check_partial_profit(current_price=110, entry_price=100, stop_loss=95); print(result)"
    Expected Result: `{'should_sell': True, 'sell_pct': 50, 'reason': 'R:R=1:1'}` (R:R = (110-100)/(100-95) = 2.0, which is > 1.0)
    Evidence: `.sisyphus/evidence/task-10-partial-profit.txt`

  **Commit**: YES (with Task 15)

---

- [x] 11. Implement Structure Collapse Sell logic

  **What to do**:
  - Create `check_structure_collapse(ohlcv: list[dict], vwap_values: list[float]) -> dict` in strategy
  - Return dict: `sell_triggered: bool`, `sell_pct: float`, `reason: str`, `exit_type: str`
  - **Collapse conditions**:
    1. Previous low downward breakout: current close < min(swing_lows[-2:]) → `sell_pct = 50`, `exit_type = "STRUCTURE_COLLAPSE"`
    2. Additional collapse: Lower High formed AND VWAP below maintained (price < VWAP for 2+ candles) → `sell_pct = 100`, `exit_type = "STRUCTURE_COLLAPSE"`
  - Use helpers from Task 3 (swing detection) and Task 1 (VWAP)

  **Must NOT do**:
  - Do NOT check stop loss (separate Task 13)
  - Do NOT check profit protection (separate Task 13)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 1, 3)
  - **Parallel Group**: Wave 2 (with Tasks 6-10, 12)
  - **Blocks**: Task 15
  - **Blocked By**: Tasks 1, 3

  **References**:
  - Task 1: VWAP values
  - Task 3: Swing low/high detection
  - `src/signals/signal_models.py:69` - `exit_type` field ("STRUCTURE_COLLAPSE")

  **Acceptance Criteria**:
  - [ ] Test: `test_structure_collapse_low_breakout`
  - [ ] Test: `test_structure_collapse_additional`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_collapse -v` → PASS

  **QA Scenarios**:

  Scenario: Structure collapse - previous low breakout
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import check_structure_collapse; # (ohlcv with close breaking below previous low); result = check_structure_collapse(ohlcv, vwap_values); print(result)"
    Expected Result: `{'sell_triggered': True, 'sell_pct': 50, 'exit_type': 'STRUCTURE_COLLAPSE', ...}`
    Evidence: `.sisyphus/evidence/task-11-collapse.txt`

  **Commit**: YES (with Task 15)

---

- [x] 12. Implement Bearish Signal Sell logic

  **What to do**:
  - Create `check_bearish_signal(ohlcv: list[dict], divergences: list, vwap_values: list[float]) -> dict` in strategy
  - Return dict: `sell_triggered: bool`, `sell_pct: float`, `reason: str`, `exit_type: str`
  - **Bearish signal conditions** (ALL must be true):
    1. Bearish divergence exists with RSI ≥ 80: Check `divergences` for `neg_reg` or `neg_hid` types
    2. VWAP downward break: price < VWAP for current candle
    → `sell_pct = 100`, `exit_type = "BEARISH_SIGNAL"`
  - Use helpers from Task 5 (divergence with RSI filter) and Task 1 (VWAP)

  **Must NOT do**:
  - Do NOT check K35/K65/K100 overheat (that's Task 13 - Profit Protection)
  - Do NOT check trailing stop (separate Task 13)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 1, 5)
  - **Parallel Group**: Wave 2 (with Tasks 6-11)
  - **Blocks**: Task 15
  - **Blocked By**: Tasks 1, 5

  **References**:
  - Task 1: VWAP values
  - Task 5: Divergence with RSI filter (≥80 for bearish)
  - `src/signals/stochastic_engine.py:55-63` - Stochastic K35/K65/K100 (for reference, not used here)

  **Acceptance Criteria**:
  - [ ] Test: `test_bearish_signal_divergence_vwap`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_bearish_signal -v` → PASS

  **QA Scenarios**:

  Scenario: Bearish signal - divergence + VWAP break
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import check_bearish_signal; # (ohlcv with bearish divergence RSI≥80 and price < VWAP); result = check_bearish_signal(ohlcv, divergences, vwap_values); print(result)"
    Expected Result: `{'sell_triggered': True, 'sell_pct': 100, 'exit_type': 'BEARISH_SIGNAL', ...}`
    Evidence: `.sisyphus/evidence/task-12-bearish-signal.txt`

  **Commit**: YES (with Task 15)

---

- [x] 13. Implement Stop Loss + Profit Protection Sell

  **What to do**:
  - Create `check_stop_loss(current_price: float, stop_loss: float) -> dict`:
    - If current_price ≤ stop_loss → `{'sell_triggered': True, 'sell_pct': 100, 'exit_type': 'STOP_LOSS'}`
  - Create `check_profit_protection(current_price: float, entry_price: float, stop_loss: float, stoch_values: dict) -> dict`:
    - ① Partial profit: R:R = 1:1 → `sell_pct = 50`, `exit_type = "PARTIAL_TP"`
    - ② Overheating: K35/K65/K100 ≥ 80 (2+ indicators) → `sell_pct = 100`, `exit_type = "OVERHEAT"`
      - Use `src.signals.stochastic_engine.py:calculate_multi_stoch()` for stoch values
    - ③ Trailing stop: current_price ≤ trailing_stop → `sell_pct = 100`, `exit_type = "TRAILING_STOP"`

  **Must NOT do**:
  - Do NOT re-calculate stochastic (call existing function)
  - Do NOT modify `stochastic_engine.py`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 2, 10)
  - **Parallel Group**: Wave 3 (with Tasks 14-17)
  - **Blocks**: Task 15
  - **Blocked By**: Tasks 2, 10

  **References**:
  - Task 2: ATR for trailing stop
  - Task 10: Trailing stop calculation
  - `src/signals/stochastic_engine.py:55-63` - `calculate_multi_stoch()` (call this for overheat check)
  - `src/signals/signal_models.py:69` - `exit_type` field ("STOP_LOSS", "PARTIAL_TP", "OVERHEAT", "TRAILING_STOP")

  **Acceptance Criteria**:
  - [ ] Test: `test_stop_loss_trigger`
  - [ ] Test: `test_profit_partial_tp`
  - [ ] Test: `test_profit_overheat`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_profit_protection -v` → PASS

  **QA Scenarios**:

  Scenario: Overheating sell - K35/K65/K100 ≥ 80
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import check_profit_protection; from src.signals.stochastic_engine import calculate_multi_stoch; # (stoch values with 2+ ≥ 80); result = check_profit_protection(current_price, entry_price, stop_loss, stoch_values); print(result)"
    Expected Result: `{'sell_triggered': True, 'sell_pct': 100, 'exit_type': 'OVERHEAT', ...}`
    Evidence: `.sisyphus/evidence/task-13-overheat.txt`

  **Commit**: YES (with Task 15)

---

- [x] 14. Implement Sell Priority + Risk Management

  **What to do**:
  - Create `execute_sell_priority(signals: list[dict]) -> dict` in strategy:
    - Priority order: STOP_LOSS > STRUCTURE_COLLAPSE > OVERHEAT > TRAILING_STOP > BEARISH_SIGNAL
    - Return highest priority sell signal (first match wins)
  - Create `check_risk_management(daily_pnl: float, consecutive_losses: int, account_dd: float, portfolio_value: float) -> dict`:
    - Daily loss > -2% → `{'halt': True, 'reason': 'Daily loss > -2%'}`
    - 3 consecutive losses → `{'halt': True, 'reason': '3 consecutive losses'}`
    - Account DD -10% → `{'review_strategy': True, 'reason': 'Account DD -10%'}`

  **Must NOT do**:
  - Do NOT implement TradingBot risk checks (use existing CircuitBreaker/RiskEngine)
  - These are STRATEGY-LEVEL risk checks, not system-level

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (independent logic, no deps on other tasks except understanding priority order)
  - **Parallel Group**: Wave 3 (with Tasks 13, 15-17)
  - **Blocks**: Task 15
  - **Blocked By**: None (can use placeholder values for testing)

  **References**:
  - User's strategy: Sell Priority list (STOP_LOSS > STRUCTURE_COLLAPSE > OVERHEAT > TRAILING_STOP)
  - `src/orders/circuit_breaker.py` - See pattern for halt logic (reference only, do not modify)

  **Acceptance Criteria**:
  - [ ] Test: `test_sell_priority_order`
  - [ ] Test: `test_risk_management_halt`
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_sell_priority -v` → PASS

  **QA Scenarios**:

  Scenario: Sell priority - STOP_LOSS wins
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import execute_sell_priority; signals = [{'exit_type': 'TRAILING_STOP', ...}, {'exit_type': 'STOP_LOSS', ...}]; result = execute_sell_priority(signals); print(result)"
    Expected Result: `{'exit_type': 'STOP_LOSS', ...}` (highest priority)
    Evidence: `.sisyphus/evidence/task-14-priority.txt`

  **Commit**: YES (with Task 15)

---

- [x] 15. Create AITradingStrategy class - Main orchestrator

  **What to do**:
  - Create `src/strategies/aitrading_strategy.py` with class `AITradingStrategy(AbstractStrategy)`:
    - Implement `evaluate(self, signal: SignalResult, ohlcv: list[dict]) -> Decision`:
      1. Extract indicators from signal or calculate fresh
      2. Call `check_market_state()` (Task 6)
      3. If buy-prohibited → return NEUTRAL
      4. Call `check_setup()` (Task 7)
      5. If setup exists, call `check_entry_trigger()` (Task 8)
      6. If trigger occurred → return BUY Decision with position sizing (Task 9)
      7. Check sell conditions in priority order (Tasks 11, 12, 13, 14)
      8. Return SELL Decision with appropriate `exit_type`
    - Override `update_risk_params()` from base class
    - Add AI Score integration: `ai_score: float = 0.0` parameter (from signal.size_hint)

  **Must NOT do**:
  - Do NOT modify `base_strategy.py` or `signal_models.py` (unless Task 17 needed)
  - Do NOT execute orders (return Decision, OrderManager handles)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core orchestration logic combining all components, complex conditional flow
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on ALL previous tasks 6-14)
  - **Parallel Group**: Wave 3 (with Tasks 16, 17 after 6-14 complete)
  - **Blocks**: Task 16 (integration with TradingBot)
  - **Blocked By**: Tasks 6, 7, 8, 9, 10, 11, 12, 13, 14

  **References**:
  - `src/strategies/base_strategy.py:6-18` - `AbstractStrategy` interface
  - `src/strategies/tv_signal_strategy.py:5-46` - See `evaluate()` implementation pattern
  - `src/signals/signal_models.py:31-69` - `SignalResult` and `Decision` dataclasses
  - All previous tasks (6-14) for helper functions

  **Acceptance Criteria**:
  - [ ] Test: `test_evaluate_buy_flow` - Full BUY: market filter → setup → trigger → entry
  - [ ] Test: `test_evaluate_sell_flow` - Full SELL: stop loss / structure collapse / bearish signal
  - [ ] Test: `test_evaluate_neutral` - No buy conditions met → NEUTRAL
  - [ ] `pytest tests/unit/test_aitrading_strategy.py::test_evaluate -v` → PASS

  **QA Scenarios**:

  Scenario: Full BUY flow
    Tool: Bash (python)
    Steps:
      1. python -c "from src.strategies.aitrading_strategy import AITradingStrategy; strategy = AITradingStrategy(); signal = SignalResult(symbol='BTC/KRW', action=Action.BUY, strength=SignalStrength.NEUTRAL, indicators={}); ohlcv = [...]; decision = strategy.evaluate(signal, ohlcv); print(decision.action, decision.reason)"
    Expected Result: `Action.BUY, "Setup + Trigger met"` (when conditions met)
    Evidence: `.sisyphus/evidence/task-15-buy-flow.txt`

  Scenario: Full SELL flow - Structure Collapse
    Tool: Bash (python)
    Steps:
      1. python -c "..." # (create ohlcv with structure collapse condition)
    Expected Result: `Action.SELL, exit_type='STRUCTURE_COLLAPSE'`
    Evidence: `.sisyphus/evidence/task-15-sell-flow.txt`

  **Commit**: YES
  - Message: `feat(strategy): add AITradingStrategy main class with full BUY/SELL flow`
  - Files: `src/strategies/aitrading_strategy.py`
  - Pre-commit: `pytest tests/unit/test_aitrading_strategy.py -v`

---

- [x] 16. Integrate AITradingStrategy with TradingBot

  **What to do**:
  - Modify `src/core/trading_bot.py` to support new strategy:
    - Add option to select `AITradingStrategy` (new config option or command-line flag)
    - In `tick()` method, use `AITradingStrategy` when selected
    - Pass `ohlcv` data to `evaluate()` (already done in line 248)
  - Update `config/config.yaml` to add `aitrading` strategy option
  - Document in `CLAUDE.md` or `README.md`

  **Must NOT do**:
  - Do NOT remove existing `TVSignalStrategy` or `SimpleStrategy`
  - Do NOT modify `OrderManager`, `CircuitBreaker`, `RiskEngine` (reuse as-is)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 15)
  - **Parallel Group**: Wave 3 (with Task 17, after Task 15)
  - **Blocks**: Task 19 (integration test)
  - **Blocked By**: Task 15

  **References**:
  - `src/core/trading_bot.py:44-73` - `TradingBot.__init__()` (add strategy selection)
  - `src/core/trading_bot.py:217-265` - `TradingBot.tick()` (already passes ohlcv)
  - `config/config.yaml` - Add strategy selection option
  - `src/strategies/strategy_ai.py` - See how `AIStrategy` is integrated (reference)

  **Acceptance Criteria**:
  - [ ] Test: `test_trading_bot_aitrading` - Bot uses AITradingStrategy when configured
  - [ ] `pytest tests/integration/test_trading_bot.py -v` → PASS
  - [ ] Config option `strategy: aitrading` works

  **QA Scenarios**:

  Scenario: TradingBot uses AITradingStrategy
    Tool: Bash (python)
    Steps:
      1. python -c "from src.core.trading_bot import TradingBot; from src.strategies.aitrading_strategy import AITradingStrategy; bot = TradingBot(exchanges={}, strategy=AITradingStrategy()); # (run tick with mock data); print(bot._strategy.__class__.__name__)"
    Expected Result: `AITradingStrategy`
    Evidence: `.sisyphus/evidence/task-16-integration.txt`

  **Commit**: YES
  - Message: `feat(bot): integrate AITradingStrategy with TradingBot`
  - Files: `src/core/trading_bot.py`, `config/config.yaml`
  - Pre-commit: `pytest tests/integration/test_trading_bot.py -v`

---

- [x] 17. Add exit_type to Decision dataclass if needed

  **What to do**:
  - Check if `src/signals/signal_models.py:Decision` already supports all exit types:
    - "STOP_LOSS" ✅ (already in line 69)
    - "PARTIAL_TP" ✅ (already in line 69)
    - "STRUCTURE_COLLAPSE" ❌ (add to line 69)
    - "OVERHEAT" ❌ (add to line 69)
    - "TRAILING_STOP" ❌ (add to line 69)
    - "BEARISH_SIGNAL" ❌ (add to line 69)
    - "EMERGENCY" ✅ (already in line 69)
  - If missing, update line 69 to include all types

  **Must NOT do**:
  - Do NOT change field names or types
  - Do NOT break existing strategies that use Decision

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (independent check)
  - **Parallel Group**: Wave 3 (with Tasks 15, 16)
  - **Blocks**: None (cosmetic, can be done anytime)
  - **Blocked By**: None

  **References**:
  - `src/signals/signal_models.py:61-69` - `Decision` dataclass (see `exit_type` field)

  **Acceptance Criteria**:
  - [ ] `exit_type` field includes all 7 types: "", "STOP_LOSS", "PARTIAL_TP", "STRUCTURE_COLLAPSE", "OVERHEAT", "TRAILING_STOP", "BEARISH_SIGNAL", "EMERGENCY"
  - [ ] Existing tests still pass after modification

  **QA Scenarios**:

  Scenario: Decision with new exit_type
    Tool: Bash (python)
    Steps:
      1. python -c "from src.signals.signal_models import Decision, Action; d = Decision(action=Action.SELL, symbol='TEST', size_pct=100, exit_type='STRUCTURE_COLLAPSE'); print(d.exit_type)"
    Expected Result: `STRUCTURE_COLLAPSE`
    Evidence: `.sisyphus/evidence/task-17-exit-type.txt`

  **Commit**: YES (if modification needed)
  - Message: `feat(signal_models): add new exit_type values for aitrading strategy`
  - Files: `src/signals/signal_models.py`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, check function signatures). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `python -m pytest` + linting. Review all changed files for: empty catches, print statements in prod, hardcoded values, missing docstrings. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (BUY flow → SELL flow working together, not isolation). Test edge cases: empty OHLCV, RSI=50 (no filter), volume=0. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1-5**: `feat(indicators): add VWAP, ATR, support/resistance, volume analysis` - aitrading_indicators.py, divergence_engine.py, `pytest tests/unit/test_aitrading_indicators.py`
- **6-14**: `feat(strategy): implement BUY/SELL logic components` - aitrading_strategy.py, `pytest tests/unit/test_aitrading_strategy.py`
- **15**: `feat(strategy): add AITradingStrategy main class` - aitrading_strategy.py, `pytest tests/unit/test_aitrading_strategy.py::test_evaluate`
- **16**: `feat(bot): integrate with TradingBot` - trading_bot.py, config.yaml, `pytest tests/integration/`
- **17**: `feat(signal_models): update exit_type if needed` - signal_models.py

---

## Success Criteria

### Verification Commands
```bash
# Run all unit tests
python -m pytest tests/unit/test_aitrading_indicators.py tests/unit/test_aitrading_strategy.py -v
# Expected: All tests pass (N passed, 0 failed)

# Run integration test
python -m pytest tests/integration/test_trading_bot.py -v
# Expected: Integration test passes

# Check plan compliance
python -c "from src.strategies.aitrading_strategy import AITradingStrategy; print('Strategy loaded successfully')"
# Expected: "Strategy loaded successfully"

# Lint check
python -m flake8 src/strategies/aitrading_strategy.py src/signals/aitrading_indicators.py
# Expected: No linting errors
```

### Final Checklist
- [x] All "Must Have" present (market filter, setup, trigger, entry, sell conditions)
- [x] All "Must NOT Have" absent (NO EMA200, NO complex deps, NO UI changes)
- [x] All tests pass (unit + integration)
- [x] Strategy isolated in aitrading_strategy.py + aitrading_indicators.py
- [x] RSI filter working (≤20 for bullish, ≥80 for bearish)
- [x] K35/K65/K100 stochastic used for overheat detection
- [x] Evidence files captured for all QA scenarios
