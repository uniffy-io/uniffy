from uniffy.domains.settings.defaults import DEFAULT_KEYBOARD_SHORTCUTS


def test_timer_toggle_shortcut_is_present_and_unique_among_global_chords() -> None:
    assert DEFAULT_KEYBOARD_SHORTCUTS["time.toggleTimer"] == "Ctrl+Shift+L"
    global_actions = {
        action: chord
        for action, chord in DEFAULT_KEYBOARD_SHORTCUTS.items()
        if action.split(".")[0] in ("nav", "app", "time", "recording", "comments", "calls")
    }
    chords = list(global_actions.values())
    assert len(chords) == len(set(chords)), global_actions


def test_call_controls_have_discoverable_defaults() -> None:
    for action in ("mute", "camera", "answer", "decline", "leave", "pushToTalk"):
        assert DEFAULT_KEYBOARD_SHORTCUTS[f"calls.{action}"]
