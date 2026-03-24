"""Output formatting for calculator results."""

import math


def format_result(value: float, max_digits: int = 12) -> str:
    """
    Format a float result for display.

    Behaviors:
    - NaN and Inf → "Error"
    - Integer snap: 5.0 → "5"
    - Floating-point snap: 0.1+0.2 = 0.30000000000000004 → "0.3"
    - Scientific notation for very large (≥1e12) or very small (<1e-9) nonzero numbers
    - Up to max_digits decimal places for rounding, then up to max_digits significant figures for display

    Args:
        value: The float to format
        max_digits: Maximum decimal places for rounding (default 12)

    Returns:
        Formatted string representation
    """
    # Handle NaN and Inf
    if math.isnan(value) or math.isinf(value):
        return "Error"

    # Round to max_digits significant figures to handle floating-point precision
    rounded = round(value, max_digits)

    # Check if we need scientific notation BEFORE integer snap
    abs_val = abs(rounded)
    use_scientific = abs_val != 0 and (abs_val >= 1e12 or abs_val < 1e-9)

    if use_scientific:
        # Use scientific notation for very large or very small numbers
        import re
        # Use Python's built-in g format which handles sci notation cleanly
        formatted = f"{rounded:.6e}"
        # Normalize exponent: 1.0e+013 -> 1e+13, 1.0e-010 -> 1e-10
        formatted = re.sub(r'\.?0+(e)', r'\1', formatted)  # strip trailing zeros before 'e'
        formatted = re.sub(r'e([+-])0*(\d+)', r'e\1\2', formatted)  # strip leading zeros in exponent
        return formatted

    # Not using scientific notation, so apply integer snap
    # Integer snap: if the rounded value is very close to an integer, make it an integer
    if math.isclose(rounded, round(rounded), abs_tol=1e-10):
        rounded = int(round(rounded))

    # If it's an integer, return as string without decimals
    if isinstance(rounded, int):
        return str(rounded)

    # General case: up to max_digits significant figures
    result = f"{rounded:.{max_digits}g}"
    return result
