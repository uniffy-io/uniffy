"""Binary demo files rendered at seed time, so no blobs live in the repo."""

from __future__ import annotations

import io
import textwrap
import zlib

from PIL import Image, ImageDraw, ImageFont

from uniffy.scripts.demo_company.loader import FileSpec

VIOLET = (105, 74, 255)
VIOLET_DEEP = (34, 24, 94)
VIOLET_SOFT = (196, 181, 253)
SLATE = (30, 41, 59)
PAPER = (250, 250, 249)

PAGE_WIDTH = 595
PAGE_HEIGHT = 842
MARGIN = 72
BODY_LINES_PER_PAGE = 30
WRAP_COLUMNS = 80


def generated_file_specs() -> tuple[FileSpec, ...]:
    """Deterministic output: a re-run produces the same names and skips them."""
    return (
        FileSpec(
            folder="People",
            filename="employee-handbook.pdf",
            mime_type="application/pdf",
            description="Condensed print edition of the Uniffy employee handbook.",
            tags=("handbook", "people"),
            data=_pdf("Uniffy Employee Handbook", _HANDBOOK_SECTIONS),
        ),
        FileSpec(
            folder="Engineering",
            filename="release-quality-manual.pdf",
            mime_type="application/pdf",
            description="Release quality manual: CI gates, canary rollout and rollback.",
            tags=("engineering", "infra"),
            data=_pdf("Uniffy Release Quality Manual", _RELEASE_MANUAL_SECTIONS),
        ),
        FileSpec(
            folder="Compliance",
            filename="gdpr-training-summary.pdf",
            mime_type="application/pdf",
            description="Annual GDPR training summary all staff sign off on.",
            tags=("compliance",),
            data=_pdf("GDPR Training Summary 2026", _GDPR_SECTIONS),
        ),
        FileSpec(
            folder="Brand",
            filename="brand-wallpaper.png",
            mime_type="image/png",
            description="Unity Violet wallpaper with the tagline, for screens and slides.",
            tags=("brand",),
            data=_brand_wallpaper(),
        ),
        FileSpec(
            folder="Facilities",
            filename="sofia-hq-floor-3.png",
            mime_type="image/png",
            description="Floor 3 plan: meeting rooms, phone booths and the open space.",
            tags=("sofia-office",),
            data=_floor_plan(),
        ),
        FileSpec(
            folder="Brand",
            filename="team-offsite-2026.jpg",
            mime_type="image/jpeg",
            description="Cover shot from the 2026 Rila mountains team offsite.",
            tags=("brand", "people"),
            data=_offsite_photo(),
        ),
    )


_HANDBOOK_SECTIONS: list[tuple[str, list[str]]] = [
    (
        "Welcome to Uniffy",
        [
            "Uniffy builds the unified workspace: notes, files, chat, agents,"
            " calendar and projects in one application, shipped as a hosted"
            " cloud and as a self-hosted product. We run the company on Uniffy"
            " itself, so this handbook is the short, printable edition; the"
            " notes in the Uniffy HQ folder are always the current version.",
            "Your first week is mapped out in the First Week Checklist note."
            " Your buddy walks you through the Sofia office, the support desk"
            " handovers and the systems you get access to.",
        ],
    ),
    (
        "Working hours and leave",
        [
            "Support roles follow the published coverage rota. Everyone else"
            " works flexible hours around the 10:00-16:00 core. Leave requests"
            " go through your manager with two weeks of notice for anything"
            " longer than two days.",
            "Annual leave is 25 days plus Bulgarian public holidays. Sick days"
            " need no certificate for the first two days; the third day onwards"
            " requires one for payroll.",
        ],
    ),
    (
        "Customer data",
        [
            "Customer workspace content never leaves the production systems."
            " No exports to personal devices, no screenshots of customer"
            " workspaces, no customer content pasted into chat. Access happens"
            " only through an audited support session the customer can see and"
            " revoke. The Customer Data Protection Policy note is binding for"
            " every role, engineering or not.",
            "Report any suspected data incident to the security channel within"
            " one hour of noticing it. Reporting early is never penalised;"
            " sitting on an incident is.",
        ],
    ),
    (
        "Expenses",
        [
            "Travel between Sofia and Plovdiv books through the office manager."
            " Everything else follows the Expenses and Travel note: receipts"
            " within 30 days, approval before commitments over 200 leva.",
        ],
    ),
]

_RELEASE_MANUAL_SECTIONS: list[tuple[str, list[str]]] = [
    (
        "Scope",
        [
            "This manual covers every release of the Uniffy platform: the"
            " hosted cloud and the self-hosted images ship from the same"
            " pipeline. The QA pod in Plovdiv runs the device-lab regression"
            " pass; its handover rules are in the Release and Deploy Runbook.",
        ],
    ),
    (
        "CI gates",
        [
            "Every merge candidate runs the full unit tier, lint and the"
            " integration suites before the first canary sees it. A red or"
            " flaky-quarantined suite blocks the pipeline until the owning"
            " team signs off a fix. New dependencies younger than five days"
            " are refused by policy, not by reviewer memory.",
            "Nightly CI results are posted to the infra operations channel"
            " every morning. The weekly summary goes to the release review on"
            " Friday.",
        ],
    ),
    (
        "Canary and rollout",
        [
            "A release reaches one canary org group first and holds there for"
            " a full working day. Rollout proceeds only while the error budget"
            " for the affected services holds; burning more than a quarter of"
            " a monthly error budget in a day freezes the rollout automatically.",
        ],
    ),
    (
        "Critical regressions",
        [
            "Thresholds per service are in the SLO reference file kept next to"
            " this manual. A critical regression pages the on-call engineer"
            " within 15 minutes and the page is logged: who acknowledged, when,"
            " and the first mitigation applied.",
        ],
    ),
    (
        "Rollback",
        [
            "Rollback is one pipeline action and never needs approval outside"
            " the on-call rotation. Data migrations ship expand-contract so a"
            " rollback never loses customer writes. Stock-outs of rollback"
            " capacity, such as an irreversible migration, are flagged in the"
            " release review the week before they ship.",
        ],
    ),
]

_GDPR_SECTIONS: list[tuple[str, list[str]]] = [
    (
        "Why this training exists",
        [
            "Uniffy processes customer workspace content as a processor and"
            " staff and billing data as a controller. Every employee completes"
            " this training on joining and every April. Completion is tracked"
            " in the compliance register.",
        ],
    ),
    (
        "The rules that matter day to day",
        [
            "Minimum necessary access: enter a customer workspace only through"
            " an audited, time-bound support session the customer approved."
            " Access is logged and sampled monthly.",
            "No data leaves the production systems: no exports, no forwarding"
            " to private mail, no screenshots of customer content.",
            "Customers and their users can request their data or its deletion"
            " at any time; route every such request to the data protection"
            " officer the same day.",
        ],
    ),
    (
        "Incidents",
        [
            "A privacy incident is any access, loss or disclosure outside the"
            " rules above, however small. The 72-hour regulator clock starts"
            " when WE notice, so report internally within one hour.",
        ],
    ),
    (
        "Sign-off",
        [
            "By signing the training register you confirm you have read this"
            " summary and the Customer Data Protection Policy, and know who"
            " the data protection officer is.",
        ],
    ),
]


def _pdf(title: str, sections: list[tuple[str, list[str]]]) -> bytes:
    """Minimal single-font PDF with real text objects, so extraction and search work."""
    pages = _paginate(sections)
    objects: list[bytes] = []

    page_object_numbers = [4 + index * 2 for index in range(len(pages))]
    kids = " ".join(f"{number} 0 R" for number in page_object_numbers)
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    objects.append(
        b"<< /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
        b" /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >>"
    )

    for index, page_lines in enumerate(pages):
        stream = _page_stream(title if index == 0 else None, page_lines)
        compressed = zlib.compress(stream)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}]"
            f" /Resources << /Font 3 0 R >> /Contents {5 + index * 2} 0 R >>".encode()
        )
        objects.append(
            f"<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n".encode()
            + compressed
            + b"\nendstream"
        )

    buffer = io.BytesIO()
    buffer.write(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(buffer.tell())
        buffer.write(f"{number} 0 obj\n".encode() + body + b"\nendobj\n")

    xref_start = buffer.tell()
    buffer.write(f"xref\n0 {len(objects) + 1}\n".encode())
    buffer.write(b"0000000000 65535 f \n")
    for offset in offsets:
        buffer.write(f"{offset:010d} 00000 n \n".encode())
    buffer.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_start}\n%%EOF\n".encode()
    )
    return buffer.getvalue()


def _paginate(sections: list[tuple[str, list[str]]]) -> list[list[tuple[str, bool]]]:
    lines: list[tuple[str, bool]] = []
    for heading, paragraphs in sections:
        if lines:
            lines.append(("", False))
        lines.append((heading, True))
        lines.append(("", False))
        for paragraph in paragraphs:
            lines.extend((wrapped, False) for wrapped in textwrap.wrap(paragraph, WRAP_COLUMNS))
            lines.append(("", False))

    pages: list[list[tuple[str, bool]]] = []
    for start in range(0, len(lines), BODY_LINES_PER_PAGE):
        pages.append(lines[start : start + BODY_LINES_PER_PAGE])
    return pages or [[]]


def _page_stream(title: str | None, lines: list[tuple[str, bool]]) -> bytes:
    parts: list[str] = []
    cursor_y = PAGE_HEIGHT - MARGIN
    if title:
        parts.append(f"BT /F2 18 Tf {MARGIN} {cursor_y} Td ({_escape(title)}) Tj ET")
        cursor_y -= 36

    parts.append(f"BT /F1 11 Tf {MARGIN} {cursor_y} Td 15 TL")
    for text, is_heading in lines:
        if is_heading:
            parts.append(f"/F2 13 Tf ({_escape(text)}) Tj /F1 11 Tf T*")
        else:
            parts.append(f"({_escape(text)}) Tj T*")
    parts.append("ET")
    return "\n".join(parts).encode("latin-1", errors="replace")


def _escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _vertical_gradient(
    width: int, height: int, top: tuple[int, int, int], bottom: tuple[int, int, int]
) -> Image.Image:
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        blend = y / max(height - 1, 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * blend) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return image


def _unified_panes(draw: ImageDraw.ImageDraw, x: int, y: int, scale: int) -> None:
    """The brand motif: three overlapping rounded panes, one workspace."""
    offsets = ((0, 0), (scale, scale // 2), (scale * 2, scale))
    for index, (dx, dy) in enumerate(offsets):
        box = [x + dx, y + dy, x + dx + scale * 4, y + dy + scale * 3]
        outline = VIOLET_SOFT if index < 2 else (255, 255, 255)
        draw.rounded_rectangle(box, radius=scale // 2, outline=outline, width=max(2, scale // 8))


def _brand_wallpaper() -> bytes:
    image = _vertical_gradient(1600, 900, VIOLET, VIOLET_DEEP)
    draw = ImageDraw.Draw(image)
    _unified_panes(draw, x=1080, y=180, scale=60)
    draw.text((110, 340), "Uniffy", font=_font(110), fill=PAPER)
    draw.text(
        (114, 490),
        "Teamwork. Simplified, amplified, unified.",
        font=_font(36),
        fill=VIOLET_SOFT,
    )
    return _encode(image, "PNG")


_FLOOR_ROOMS: list[tuple[str, tuple[int, int, int, int]]] = [
    ("Rila", (60, 60, 460, 340)),
    ("Pirin", (60, 380, 460, 620)),
    ("Iskar", (60, 660, 460, 840)),
    ("Studena", (500, 720, 640, 840)),
    ("Bistritsa", (680, 720, 820, 840)),
    ("Kitchen", (860, 720, 1340, 840)),
    ("Open space", (500, 60, 1340, 680)),
]


def _floor_plan() -> bytes:
    image = Image.new("RGB", (1400, 900), PAPER)
    draw = ImageDraw.Draw(image)
    label_font = _font(30)
    draw.rectangle([20, 20, 1380, 880], outline=SLATE, width=6)
    for name, box in _FLOOR_ROOMS:
        draw.rectangle(list(box), outline=SLATE, width=4, fill=(255, 255, 255))
        draw.text((box[0] + 16, box[1] + 12), name, font=label_font, fill=SLATE)
    draw.text((60, 24), "Sofia HQ - Floor 3", font=_font(34), fill=VIOLET_DEEP)
    draw.text((1040, 24), "Not to scale", font=_font(24), fill=(120, 120, 120))
    return _encode(image, "PNG")


def _offsite_photo() -> bytes:
    image = _vertical_gradient(1600, 1000, (255, 214, 165), (94, 80, 100))
    draw = ImageDraw.Draw(image)
    draw.ellipse([1180, 120, 1340, 280], fill=(255, 236, 179))
    ranges = [
        (
            (70, 60, 66),
            [
                (0, 1000),
                (0, 620),
                (330, 400),
                (620, 660),
                (980, 380),
                (1290, 640),
                (1600, 520),
                (1600, 1000),
            ],
        ),
        (
            (44, 38, 46),
            [(0, 1000), (0, 780), (420, 560), (830, 800), (1210, 580), (1600, 760), (1600, 1000)],
        ),
    ]
    for color, points in ranges:
        draw.polygon(points, fill=color)
    draw.text((70, 880), "Rila offsite, June 2026", font=_font(40), fill=(255, 244, 230))
    return _encode(image, "JPEG")


def _encode(image: Image.Image, image_format: str) -> bytes:
    buffer = io.BytesIO()
    if image_format == "JPEG":  # noqa: PLR2004
        image.save(buffer, format="JPEG", quality=85)
    else:
        image.save(buffer, format="PNG")
    return buffer.getvalue()
