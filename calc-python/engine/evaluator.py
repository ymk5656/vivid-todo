"""Calculator expression evaluator with exception hierarchy."""

import re
import sympy
import math
from typing import Literal


class CalcError(ValueError):
    """Base class for all calculator errors."""


class CalcSyntaxError(CalcError):
    """Raised when the expression cannot be parsed."""


class CalcDomainError(CalcError):
    """Raised when input is outside the function's domain."""


class CalcDivisionByZeroError(CalcError):
    """Raised on division by zero."""


def evaluate(expression: str, ans: float | None, angle_mode: Literal["rad", "deg"]) -> float:
    """Parse and evaluate a mathematical expression string.

    Args:
        expression: The expression to evaluate (e.g. "2+3", "sin(pi/2)").
        ans: The previous result, substituted for the "Ans" token.
        angle_mode: "rad" for radians, "deg" for degrees.

    Returns:
        The numeric result as a float.

    Raises:
        CalcSyntaxError: If the expression cannot be parsed or is invalid.
        CalcDomainError: If a function receives an out-of-domain argument.
        CalcDivisionByZeroError: If the expression involves division by zero.
    """
    # Import here to avoid circular import at module load time
    from engine.functions import (
        calc_sin, calc_cos, calc_tan,
        calc_log, calc_ln, calc_sqrt, calc_factorial,
    )

    expr = expression.strip()
    if not expr:
        raise CalcSyntaxError("Empty expression")

    # Reject consecutive arithmetic operators like "2++3", "2--3", "2+-3".
    # We allow "**" (power) by first replacing it with a placeholder, then checking.
    _check = expr.replace("**", "")
    if re.search(r'[+\-*/]{2,}', _check):
        raise CalcSyntaxError(f"Invalid operator sequence in expression: {expr}")

    # Substitute Ans token
    if ans is not None:
        expr = expr.replace("Ans", str(ans))
    elif "Ans" in expr:
        raise CalcSyntaxError("No previous answer available")

    # Build safe local symbol table
    local_dict = {
        "pi": sympy.pi,
        "e":  sympy.E,
        "sin":       lambda x: calc_sin(float(x), angle_mode),
        "cos":       lambda x: calc_cos(float(x), angle_mode),
        "tan":       lambda x: calc_tan(float(x), angle_mode),
        "log":       lambda x: calc_log(float(x)),
        "ln":        lambda x: calc_ln(float(x)),
        "sqrt":      lambda x: calc_sqrt(float(x)),
        "factorial": lambda x: calc_factorial(float(x)),
    }

    try:
        result = sympy.sympify(expr, locals=local_dict)

        # Check for symbolic infinities / complex infinity before evalf()
        # sympy represents 1/0 as zoo (complex infinity) or oo (real infinity)
        if result is sympy.zoo or result == sympy.zoo:
            raise CalcDivisionByZeroError("Division by zero")
        if result is sympy.oo or result == sympy.oo or result is -sympy.oo or result == -sympy.oo:
            raise CalcDivisionByZeroError("Result is infinite")

        # result may be a plain Python float (when lambdas return floats directly)
        # or a sympy expression — handle both cases
        if isinstance(result, (int, float)):
            value = float(result)
        else:
            value = float(result.evalf())
    except CalcError:
        raise
    except ZeroDivisionError:
        raise CalcDivisionByZeroError("Division by zero")
    except (sympy.SympifyError, TypeError, ValueError, AttributeError) as e:
        raise CalcSyntaxError(f"Invalid expression: {e}") from e

    # Guard against NaN
    if value != value:  # NaN check (NaN != NaN is always True)
        raise CalcSyntaxError("Expression produced an invalid result")

    if math.isinf(value):
        raise CalcDivisionByZeroError("Result is infinite")

    return value
