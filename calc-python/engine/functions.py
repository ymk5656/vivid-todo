"""Mathematical functions for the calculator."""

import math
from engine.evaluator import CalcDomainError


def _to_rad(x: float, angle_mode: str) -> float:
    """Convert angle to radians if in degree mode."""
    return math.radians(x) if angle_mode == "deg" else x


def calc_sin(x: float, angle_mode: str) -> float:
    """Calculate sine. angle_mode can be 'rad' or 'deg'."""
    return math.sin(_to_rad(x, angle_mode))


def calc_cos(x: float, angle_mode: str) -> float:
    """Calculate cosine. angle_mode can be 'rad' or 'deg'."""
    return math.cos(_to_rad(x, angle_mode))


def calc_tan(x: float, angle_mode: str) -> float:
    """Calculate tangent. angle_mode can be 'rad' or 'deg'."""
    r = _to_rad(x, angle_mode)
    # Check for undefined: cos(r) ≈ 0
    if math.isclose(math.cos(r), 0.0, abs_tol=1e-12):
        raise CalcDomainError("tan is undefined at this angle")
    return math.tan(r)


def calc_log(x: float) -> float:
    """Calculate base-10 logarithm. Requires x > 0."""
    if x <= 0:
        raise CalcDomainError("log requires x > 0")
    return math.log10(x)


def calc_ln(x: float) -> float:
    """Calculate natural logarithm. Requires x > 0."""
    if x <= 0:
        raise CalcDomainError("ln requires x > 0")
    return math.log(x)


def calc_sqrt(x: float) -> float:
    """Calculate square root. Requires x >= 0."""
    if x < 0:
        raise CalcDomainError("sqrt requires x >= 0")
    return math.sqrt(x)


def calc_factorial(n: float) -> float:
    """Calculate factorial. Requires non-negative integer."""
    if n != int(n) or n < 0:
        raise CalcDomainError("factorial requires a non-negative integer")
    return float(math.factorial(int(n)))


def calc_pow(base: float, exp: float) -> float:
    """Calculate base raised to the power of exp."""
    return base ** exp
