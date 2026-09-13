"""Message assembly: the MIME shape a calendar invitation has to land in for
mail clients to act on it."""

import pytest

from uniffy.core.mail.config import MailConfig
from uniffy.core.mail.parts import CalendarMethod, CalendarPart, MailAttachment
from uniffy.core.mail.sender import _compose

ICS = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"


def _config(**overrides) -> MailConfig:
    return MailConfig(
        **{"from_address": "no-reply@example.com", "smtp_host": "localhost", **overrides}
    )


def _message(**overrides):
    return _compose(
        **{
            "config": _config(),
            "recipient": "attendee@example.com",
            "subject": "Invitation",
            "html": "<p>See you there</p>",
            "text": "See you there",
            **overrides,
        }
    )


def _types(message) -> list[str]:
    return [part.get_content_type() for part in message.walk()]


def _alternative(message):
    return next(
        part for part in message.walk() if part.get_content_type() == "multipart/alternative"
    )


class TestPlainMessage:
    def test_a_message_with_no_extras_stays_a_simple_alternative(self) -> None:
        message = _message()

        assert message.get_content_type() == "multipart/alternative"
        assert _types(message) == ["multipart/alternative", "text/plain", "text/html"]

    def test_envelope_metadata_is_applied(self) -> None:
        message = _message(
            config=_config(from_name="Uniffy", reply_to="replies@example.com")
        )

        assert message["From"] == "Uniffy <no-reply@example.com>"
        assert message["Reply-To"] == "replies@example.com"
        assert message["To"] == "attendee@example.com"

    def test_a_nameless_sender_uses_the_bare_address(self) -> None:
        assert _message(config=_config(from_name="")).get("From") == "no-reply@example.com"


class TestCalendarPart:
    def test_the_calendar_body_rides_inside_the_alternative(self) -> None:
        """Outlook draws its accept and decline controls from an inline
        text/calendar alternative, not from the attachment."""
        message = _message(
            calendar_part=CalendarPart(document=ICS, method=CalendarMethod.REQUEST)
        )

        inline = [part.get_content_type() for part in _alternative(message).iter_parts()]
        assert inline == ["text/plain", "text/html", "text/calendar"]

    def test_the_calendar_body_comes_last_among_the_alternatives(self) -> None:
        """A client takes the last alternative it understands, so a calendar
        body placed before the HTML one would simply never be chosen."""
        message = _message(
            calendar_part=CalendarPart(document=ICS, method=CalendarMethod.REQUEST)
        )

        assert list(_alternative(message).iter_parts())[-1].get_content_type() == "text/calendar"

    @pytest.mark.parametrize(
        "method", [CalendarMethod.REQUEST, CalendarMethod.CANCEL, CalendarMethod.REPLY]
    )
    def test_the_method_reaches_the_content_type(self, method: CalendarMethod) -> None:
        message = _message(calendar_part=CalendarPart(document=ICS, method=method))

        calendar = next(
            part
            for part in _alternative(message).iter_parts()
            if part.get_content_type() == "text/calendar"
        )
        assert calendar.get_param("method") == method.value

    def test_the_document_survives_intact(self) -> None:
        message = _message(
            calendar_part=CalendarPart(document=ICS, method=CalendarMethod.REQUEST)
        )

        calendar = next(
            part
            for part in _alternative(message).iter_parts()
            if part.get_content_type() == "text/calendar"
        )
        assert "BEGIN:VCALENDAR" in calendar.get_content()


class TestAttachments:
    def test_an_attachment_turns_the_message_into_mixed(self) -> None:
        message = _message(
            attachments=[MailAttachment(filename="invite.ics", content=ICS)]
        )

        assert message.get_content_type() == "multipart/mixed"
        assert "multipart/alternative" in _types(message)

    def test_the_attachment_is_the_only_part_marked_as_one(self) -> None:
        message = _message(
            calendar_part=CalendarPart(document=ICS, method=CalendarMethod.REQUEST),
            attachments=[MailAttachment(filename="invite.ics", content=ICS)],
        )

        attached = [
            part for part in message.walk() if part.get_content_disposition() == "attachment"
        ]
        assert len(attached) == 1
        assert attached[0].get_filename() == "invite.ics"

    def test_an_invitation_carries_both_forms(self) -> None:
        """Gmail acts on the attachment, Outlook on the inline part; sending one
        form alone works in one client and not the other."""
        message = _message(
            calendar_part=CalendarPart(document=ICS, method=CalendarMethod.REQUEST),
            attachments=[MailAttachment(filename="invite.ics", content=ICS)],
        )

        inline = [
            part.get_content_type()
            for part in _alternative(message).iter_parts()
        ]
        attached = [
            part for part in message.walk() if part.get_content_disposition() == "attachment"
        ]
        assert "text/calendar" in inline
        assert len(attached) == 1

    def test_several_attachments_all_land(self) -> None:
        message = _message(
            attachments=[
                MailAttachment(filename="one.ics", content=ICS),
                MailAttachment(filename="two.ics", content=ICS),
            ]
        )

        names = [
            part.get_filename()
            for part in message.walk()
            if part.get_content_disposition() == "attachment"
        ]
        assert names == ["one.ics", "two.ics"]
