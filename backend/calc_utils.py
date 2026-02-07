import numpy as np

def parse_float_list(t: str):
    """Parses a space-separated string of numbers into a list of floats."""
    return [float(x) for x in t.split()] if t and t.strip() else []

def get_fit(x_vals, y_text):
    """Calculates polynomial coefficients (degree 3) for given X values and Y string data."""
    y_vals = parse_float_list(y_text)
    if len(y_vals) < 2: return [0.0]*4
    # Polyfit returns coefficients highest degree first
    c = np.polyfit(x_vals, y_vals, min(3, len(x_vals)-1)).tolist()
    # Ensure always 4 coefficients (ax^3 + bx^2 + cx + d)
    return [0.0]*(4-len(c)) + c
