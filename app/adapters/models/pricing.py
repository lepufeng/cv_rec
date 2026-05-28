"""Static price table (CNY per 1M tokens). Update as vendors change pricing.

Costs computed here are estimates; the source of truth remains the vendor
invoice. Used for budget tracking and analytics, not billing.
"""
from __future__ import annotations

from decimal import Decimal


# (input_per_million, output_per_million)
PRICING_CNY: dict[str, tuple[Decimal, Decimal]] = {
    # Zhipu / z.ai
    "glm-4.6v-flash": (Decimal("0"), Decimal("0")),         # limited-time free
    "glm-4.6v-flashx": (Decimal("0.3"), Decimal("2.9")),
    "glm-4.6v": (Decimal("2.2"), Decimal("6.5")),
    "glm-4.5v": (Decimal("4.3"), Decimal("13.0")),
    "glm-ocr": (Decimal("0.2"), Decimal("0.2")),
    "glm-5": (Decimal("4.0"), Decimal("18.0")),
    "glm-5.1": (Decimal("6.0"), Decimal("24.0")),
    "glm-5-turbo": (Decimal("5.0"), Decimal("22.0")),
    "glm-4.7": (Decimal("2.0"), Decimal("8.0")),

    # Alibaba Qwen
    "qwen-vl-ocr": (Decimal("0.5"), Decimal("1.0")),
    "qwen-vl-plus": (Decimal("1.5"), Decimal("4.5")),
    "qwen-vl-max": (Decimal("3.0"), Decimal("9.0")),
}


def estimate_cost(model_id: str, input_tokens: int, output_tokens: int) -> Decimal:
    rate = PRICING_CNY.get(model_id.lower())
    if not rate:
        return Decimal("0")
    in_rate, out_rate = rate
    cost = (Decimal(input_tokens) * in_rate + Decimal(output_tokens) * out_rate) / Decimal("1000000")
    # Round to 6 decimal places (matches DB column precision).
    return cost.quantize(Decimal("0.000001"))
