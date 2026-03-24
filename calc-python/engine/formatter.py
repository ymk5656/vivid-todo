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
    - Up to max_digits significant figures otherwise

    Args:
        value: The float to format
        max_digits: Maximum significant digits (default 12)

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
        # Format in scientific notation, then clean up
        sci_str = f"{rounded:.6e}"
        # Parse and reformat to match expected output (e.g., "1e+13" not "1.000000e+13")
        parts = sci_str.split('e')
        mantissa = float(parts[0])
        exponent = int(parts[1])
        # Format mantissa, removing trailing zeros
        mantissa_str = f"{mantissa:.6f}".rstrip('0').rstrip('.')
        # Ensure it's a single digit before the decimal (standard scientific notation)
        if '.' not in mantissa_str:
            mantissa_str = str(int(float(mantissa_str)))
        return f"{mantissa_str}e{exponent:+03d}".replace("+0", "+").replace("-0", "-")

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
