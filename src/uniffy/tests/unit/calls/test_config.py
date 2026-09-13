"""What the deployment must supply before calls will run."""

import pytest

from uniffy.domains.calls.config import LiveKitConfig, LiveKitConfigError

REAL_SECRET = "9f2c41ab7d0e5386c1b4a97f2e6d085b3c7a1f49e2d86b05a7c3f194e60d2b8a"


@pytest.fixture
def livekit_env(monkeypatch):
    """Set the three required variables; the test varies the secret."""

    def apply(secret: str):
        monkeypatch.setenv("LIVEKIT_HOST", "http://livekit:7880")
        monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
        monkeypatch.setenv("LIVEKIT_API_SECRET", secret)

    return apply


class TestTheSigningSecret:
    def test_a_generated_secret_is_accepted(self, livekit_env) -> None:
        livekit_env(REAL_SECRET)

        assert LiveKitConfig.from_env().api_secret == REAL_SECRET

    def test_the_secret_this_repository_used_to_ship_is_refused(self, livekit_env) -> None:
        """It admits the holder to any call in the deployment and lets them forge
        the presence events we trust, and it is readable by anyone who has seen
        the repository. Shipping it pre-filled is what made it likely to survive
        into a real deployment."""
        livekit_env("devsecret-change-me-in-prod-32chars-min")

        with pytest.raises(LiveKitConfigError, match="placeholder"):
            LiveKitConfig.from_env()

    @pytest.mark.parametrize("secret", ["changeme", "secret", "DevSecret", " devsecret "])
    def test_other_published_defaults_are_refused(self, livekit_env, secret: str) -> None:
        livekit_env(secret)

        with pytest.raises(LiveKitConfigError):
            LiveKitConfig.from_env()

    def test_a_secret_too_short_to_be_credible_is_refused(self, livekit_env) -> None:
        livekit_env("a" * 31)

        with pytest.raises(LiveKitConfigError, match="32 characters"):
            LiveKitConfig.from_env()

    def test_a_secret_at_the_length_floor_is_accepted(self, livekit_env) -> None:
        livekit_env("b" * 32)

        assert LiveKitConfig.from_env().api_secret == "b" * 32

    def test_an_absent_secret_still_reports_what_is_missing(self, livekit_env) -> None:
        livekit_env("")

        with pytest.raises(LiveKitConfigError, match="required"):
            LiveKitConfig.from_env()
