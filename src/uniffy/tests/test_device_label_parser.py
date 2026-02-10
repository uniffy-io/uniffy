"""Tests for User-Agent device label parser."""

import pytest

from uniffy.domains.auth.context import parse_device_label


class TestParseDeviceLabelBrowserDetection:
    """Tests for browser detection from User-Agent strings."""

    @pytest.mark.parametrize(
        "user_agent,expected_browser",
        [
            # Chrome on various platforms
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Chrome",
            ),
            # Edge (Chromium-based, uses "Edg/" without trailing "e")
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
                "Edge",
            ),
            # Edge legacy (uses "Edge/")
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 Edge/18.19041",
                "Edge",
            ),
            # Firefox
            (
                "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0",
                "Firefox",
            ),
            # Opera (uses "OPR/")
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
                "Opera",
            ),
            # Safari (macOS, no Chrome token)
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Version/17.2 Safari/605.1.15",
                "Safari",
            ),
        ],
    )
    def test_browser_detection(self, user_agent: str, expected_browser: str):
        """Test that the correct browser is identified from the UA string."""
        result = parse_device_label(user_agent)
        assert result.startswith(expected_browser)

    def test_edge_takes_priority_over_chrome(self):
        """Edge UA contains Chrome token but should be identified as Edge."""
        ua = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
        )
        result = parse_device_label(ua)
        assert "Edge" in result
        assert "Chrome" not in result

    def test_opera_takes_priority_over_chrome(self):
        """Opera UA contains Chrome token but should be identified as Opera."""
        ua = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0"
        )
        result = parse_device_label(ua)
        assert "Opera" in result
        assert "Chrome" not in result


class TestParseDeviceLabelOSDetection:
    """Tests for operating system detection from User-Agent strings."""

    @pytest.mark.parametrize(
        "user_agent,expected_os",
        [
            # Windows
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Windows",
            ),
            # macOS (Macintosh)
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "macOS",
            ),
            # macOS (Mac OS X variant)
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Version/17.2 Safari/605.1.15",
                "macOS",
            ),
            # Linux
            (
                "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0",
                "Linux",
            ),
            # Android
            (
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
                "Android",
            ),
            # iOS (iPhone)
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
                "iOS",
            ),
            # iOS (iPad)
            (
                "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
                "iOS",
            ),
            # iOS (iPod)
            (
                "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
                "iOS",
            ),
            # ChromeOS
            (
                "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "ChromeOS",
            ),
        ],
    )
    def test_os_detection(self, user_agent: str, expected_os: str):
        """Test that the correct OS is identified from the UA string."""
        result = parse_device_label(user_agent)
        assert result.endswith(expected_os)

    def test_android_takes_priority_over_linux(self):
        """Android UA contains 'Linux' but should be identified as Android."""
        ua = (
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        )
        result = parse_device_label(ua)
        assert "Android" in result
        assert "Linux" not in result


class TestParseDeviceLabelCombinations:
    """Tests for full browser + OS label output."""

    @pytest.mark.parametrize(
        "user_agent,expected_label",
        [
            # Chrome on Windows
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Chrome on Windows",
            ),
            # Firefox on Linux
            (
                "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0",
                "Firefox on Linux",
            ),
            # Safari on macOS
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Version/17.2 Safari/605.1.15",
                "Safari on macOS",
            ),
            # Edge on Windows
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
                "Edge on Windows",
            ),
            # Chrome on Android
            (
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
                "Chrome on Android",
            ),
            # Safari on iOS
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
                "Safari on iOS",
            ),
            # Chrome on ChromeOS
            (
                "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Chrome on ChromeOS",
            ),
            # Opera on macOS
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
                "Opera on macOS",
            ),
        ],
    )
    def test_full_label(self, user_agent: str, expected_label: str):
        """Test the complete device label output."""
        assert parse_device_label(user_agent) == expected_label


class TestParseDeviceLabelEdgeCases:
    """Tests for edge cases and fallback behavior."""

    def test_empty_string(self):
        """Empty UA string returns 'Unknown device'."""
        assert parse_device_label("") == "Unknown device"

    def test_none_like_empty(self):
        """Falsy values return 'Unknown device'."""
        assert parse_device_label("") == "Unknown device"

    def test_garbage_string(self):
        """Unrecognizable UA returns 'Unknown device'."""
        assert parse_device_label("totally-not-a-browser/1.0") == "Unknown device"

    def test_only_browser_no_os(self):
        """Known browser but unrecognized OS still returns a label."""
        result = parse_device_label("Chrome/120.0.0.0")
        assert result == "Chrome on Unknown OS"

    def test_only_os_no_browser(self):
        """Known OS but unrecognized browser still returns a label."""
        result = parse_device_label("SomeBot/1.0 (Windows NT 10.0)")
        assert result == "Unknown browser on Windows"

    def test_bot_user_agent(self):
        """Bot UAs without browser or OS tokens return 'Unknown device'."""
        assert parse_device_label("Googlebot/2.1") == "Unknown device"

    def test_curl_user_agent(self):
        """curl UA returns 'Unknown device' (no browser or OS tokens)."""
        assert parse_device_label("curl/8.4.0") == "Unknown device"

    def test_very_long_user_agent(self):
        """Very long UA string still parses correctly."""
        ua = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 " + "x" * 1000
        )
        assert parse_device_label(ua) == "Chrome on Windows"
