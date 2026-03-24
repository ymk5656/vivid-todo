import math
import pytest
from engine.evaluator import evaluate, CalcSyntaxError, CalcDomainError, CalcDivisionByZeroError

@pytest.mark.parametrize("expr,ans,mode,expected", [
    ("2+3",        None, "rad", 5.0),
    ("10/4",       None, "rad", 2.5),
    ("2**8",       None, "rad", 256.0),
    ("sqrt(9)",    None, "rad", 3.0),
    ("sin(pi/2)",  None, "rad", 1.0),
    ("cos(0)",     None, "rad", 1.0),
    ("log(100)",   None, "rad", 2.0),
    ("ln(e)",      None, "rad", 1.0),
    ("factorial(5)", None, "rad", 120.0),
    ("Ans+1",      5.0,  "rad", 6.0),
    ("sin(90)",    None, "deg", 1.0),
])
def test_evaluate_ok(expr, ans, mode, expected):
    result = evaluate(expr, ans=ans, angle_mode=mode)
    assert math.isclose(result, expected, rel_tol=1e-9, abs_tol=1e-9)

@pytest.mark.parametrize("expr,mode,exc", [
    ("1/0",       "rad", CalcDivisionByZeroError),
    ("sqrt(-1)",  "rad", CalcDomainError),
    ("log(-5)",   "rad", CalcDomainError),
    ("2++3",      "rad", CalcSyntaxError),
    ("abc",       "rad", CalcSyntaxError),
    ("tan(90)",   "deg", CalcDomainError),
])
def test_evaluate_errors(expr, mode, exc):
    with pytest.raises(exc):
        evaluate(expr, ans=None, angle_mode=mode)
