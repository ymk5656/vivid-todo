import pytest
from engine.formatter import format_result


@pytest.mark.parametrize("value,expected", [
    (5.0,          "5"),
    (2.5,          "2.5"),
    (1000000.0,    "1000000"),
    (0.1 + 0.2,    "0.3"),
    (1e13,         "1e+13"),
    (1.23456789012345, "1.23456789012"),
    (1e-10,        "1e-10"),
    (1e-9,         "1e-9"),
    (5e-9,         "5e-9"),
    (0.0,          "0"),
    (-5.0,         "-5"),
    (-2.5,         "-2.5"),
    (-1e13,        "-1e+13"),
    (-1e-10,       "-1e-10"),
])
def test_format_result(value, expected):
    assert format_result(value) == expected
