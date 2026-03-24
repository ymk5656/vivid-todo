import math
import pytest
from engine.evaluator import CalcDomainError
from engine.functions import (
    calc_sin, calc_cos, calc_tan, calc_log, calc_ln,
    calc_sqrt, calc_factorial, calc_pow
)

@pytest.mark.parametrize("x,mode,expected", [
    (0,  "rad", 0.0),
    (math.pi / 2, "rad", 1.0),
    (90, "deg", 1.0),
    (0,  "deg", 0.0),
])
def test_sin(x, mode, expected):
    assert math.isclose(calc_sin(x, mode), expected, abs_tol=1e-9)

@pytest.mark.parametrize("x,mode,expected", [
    (0,   "rad", 1.0),
    (90,  "deg", 0.0),
])
def test_cos(x, mode, expected):
    assert math.isclose(calc_cos(x, mode), expected, abs_tol=1e-9)

def test_tan_90_deg_raises():
    with pytest.raises(CalcDomainError):
        calc_tan(90, "deg")

@pytest.mark.parametrize("x,expected", [(100, 2.0), (1, 0.0)])
def test_log(x, expected):
    assert math.isclose(calc_log(x), expected, abs_tol=1e-9)

def test_log_non_positive_raises():
    with pytest.raises(CalcDomainError):
        calc_log(0)
    with pytest.raises(CalcDomainError):
        calc_log(-1)

def test_ln():
    assert math.isclose(calc_ln(math.e), 1.0, abs_tol=1e-9)

def test_ln_non_positive_raises():
    with pytest.raises(CalcDomainError):
        calc_ln(0)

def test_sqrt():
    assert calc_sqrt(9) == 3.0

def test_sqrt_negative_raises():
    with pytest.raises(CalcDomainError):
        calc_sqrt(-1)

@pytest.mark.parametrize("n,expected", [(0, 1), (5, 120), (10, 3628800)])
def test_factorial(n, expected):
    assert calc_factorial(n) == expected

def test_factorial_negative_raises():
    with pytest.raises(CalcDomainError):
        calc_factorial(-1)

def test_factorial_non_integer_raises():
    with pytest.raises(CalcDomainError):
        calc_factorial(2.5)

def test_pow():
    assert calc_pow(2, 8) == 256.0
