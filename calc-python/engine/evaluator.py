"""Calculator expression evaluator with exception hierarchy."""


class CalcError(ValueError):
    """Base class for all calculator errors."""


class CalcSyntaxError(CalcError):
    """Raised when the expression cannot be parsed."""


class CalcDomainError(CalcError):
    """Raised when input is outside the function's domain."""


class CalcDivisionByZeroError(CalcError):
    """Raised on division by zero."""
