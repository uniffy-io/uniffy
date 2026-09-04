"""Status colours are assigned server-side from the brand axis."""

from uniffy.domains.projects.status_colors import assign_status_colors, brand_ramp_color


def test_ramp_matches_web_slots() -> None:
    # The web derives the same four values with brandRampStops; drift here shows up as a
    # default status rendering flat instead of as an axis slice.
    assert [brand_ramp_color(i, 4) for i in range(4)] == [
        "#694aff",
        "#8c56fa",
        "#ae62f5",
        "#d16ef0",
    ]


def test_single_status_sits_at_violet() -> None:
    assert brand_ramp_color(0, 1) == "#694aff"


def test_assign_fills_missing_and_keeps_overrides() -> None:
    config = {
        "options": [
            {"id": "b", "label": "B", "color": "", "sortOrder": 1},
            {"id": "a", "label": "A", "color": "#01b77f", "sortOrder": 0},
            {"id": "c", "label": "C", "sortOrder": 2},
        ]
    }

    assign_status_colors(config)

    by_id = {option["id"]: option["color"] for option in config["options"]}
    assert by_id["a"] == "#01b77f"
    assert by_id["b"] == brand_ramp_color(1, 3)
    assert by_id["c"] == brand_ramp_color(2, 3)


def test_invalid_colour_is_replaced() -> None:
    config = {"options": [{"id": "a", "label": "A", "color": "red", "sortOrder": 0}]}

    assign_status_colors(config)

    assert config["options"][0]["color"] == "#694aff"


def test_config_without_options_is_untouched() -> None:
    config = {"max_length": 10}

    assert assign_status_colors(config) == {"max_length": 10}
