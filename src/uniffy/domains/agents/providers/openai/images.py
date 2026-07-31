"""Map normalised image params onto the OpenAI images endpoint.

`aspect_ratio` + `resolution` are the portable knobs; OpenAI speaks pixels.
gpt-image-1 accepts three fixed sizes, while gpt-image-2 accepts any
`WIDTHxHEIGHT` inside a documented envelope, so the size is computed from the
ratio at the tier's pixel budget and clamped to that envelope.
"""

from math import sqrt

# gpt-image-2 envelope: both edges multiples of 16, long edge <= 3840, long:short
# <= 3:1, total pixels within these bounds.
_EDGE_MULTIPLE = 16
_MAX_EDGE = 3840
_MIN_PIXELS = 655_360
_MAX_PIXELS = 8_294_400
_MAX_RATIO = 3.0

# Target pixel budget per resolution tier.
_TIER_PIXELS = {
    "512px": 512 * 512,
    "1K": 1024 * 1024,
    "2K": 2048 * 2048,
    "4K": 3840 * 2160,
}

# gpt-image-1 has no arbitrary sizing; these are the only legal values.
_FIXED_SIZES = {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
}

DEFAULT_ASPECT_RATIO = "1:1"
DEFAULT_RESOLUTION = "1K"


def parse_aspect_ratio(aspect_ratio: str) -> tuple[float, float]:
    """``"16:9"`` -> ``(16.0, 9.0)``; falls back to square on a malformed value."""
    width, _, height = aspect_ratio.partition(":")
    try:
        w, h = float(width), float(height)
    except ValueError:
        return 1.0, 1.0
    if w <= 0 or h <= 0:
        return 1.0, 1.0
    return w, h


def _round_to_multiple(value: float) -> int:
    return max(_EDGE_MULTIPLE, int(round(value / _EDGE_MULTIPLE)) * _EDGE_MULTIPLE)


def compute_size(aspect_ratio: str, resolution: str) -> str:
    """Concrete ``WIDTHxHEIGHT`` for gpt-image-2 within the documented envelope."""
    w_ratio, h_ratio = parse_aspect_ratio(aspect_ratio)
    if w_ratio / h_ratio > _MAX_RATIO:
        h_ratio = w_ratio / _MAX_RATIO
    elif h_ratio / w_ratio > _MAX_RATIO:
        w_ratio = h_ratio / _MAX_RATIO

    budget = _TIER_PIXELS.get(resolution, _TIER_PIXELS[DEFAULT_RESOLUTION])
    scale = sqrt(budget / (w_ratio * h_ratio))
    width = _round_to_multiple(w_ratio * scale)
    height = _round_to_multiple(h_ratio * scale)

    if max(width, height) > _MAX_EDGE:
        shrink = _MAX_EDGE / max(width, height)
        width = _round_to_multiple(width * shrink)
        height = _round_to_multiple(height * shrink)

    pixels = width * height
    if pixels > _MAX_PIXELS or pixels < _MIN_PIXELS:
        bound = _MAX_PIXELS if pixels > _MAX_PIXELS else _MIN_PIXELS
        adjust = sqrt(bound / pixels)
        width = min(_round_to_multiple(width * adjust), _MAX_EDGE)
        height = min(_round_to_multiple(height * adjust), _MAX_EDGE)
        # Rounding to the 16px grid lands either side of the bound; walk the
        # short edge back onto it.
        while width * height > _MAX_PIXELS and min(width, height) > _EDGE_MULTIPLE:
            if width >= height:
                width -= _EDGE_MULTIPLE
            else:
                height -= _EDGE_MULTIPLE
        while width * height < _MIN_PIXELS and max(width, height) < _MAX_EDGE:
            if width <= height:
                width += _EDGE_MULTIPLE
            else:
                height += _EDGE_MULTIPLE

    return f"{width}x{height}"


def build_request(model: str, params: dict, *, supports_arbitrary_size: bool) -> dict:
    """Normalised params -> OpenAI images request kwargs (model excluded)."""
    aspect_ratio = params.get("aspect_ratio", DEFAULT_ASPECT_RATIO)
    resolution = params.get("resolution", DEFAULT_RESOLUTION)

    if supports_arbitrary_size:
        size = compute_size(aspect_ratio, resolution)
    else:
        size = _FIXED_SIZES.get(aspect_ratio, _FIXED_SIZES[DEFAULT_ASPECT_RATIO])

    request: dict = {"size": size, "quality": params.get("quality", "auto")}
    for knob in ("background", "output_format", "moderation"):
        value = params.get(knob)
        if value is not None:
            request[knob] = value
    return request
