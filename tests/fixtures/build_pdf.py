"""Generate a tiny test PDF in-memory (no external deps beyond Pillow)."""
from __future__ import annotations

import io
import struct
import zlib


def make_minimal_pdf(text: str = "Resume Sample") -> bytes:
    """Return a syntactically valid 1-page PDF that rasterizes to a blank page.

    For pdf2image's purposes only the structure must be valid; the rendered
    image is irrelevant since we feed it to a FakeModel anyway.
    """
    # Hand-rolled minimal PDF
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        b"<< /Length 44 >>\nstream\nBT /F1 24 Tf 100 700 Td (" + text.encode("latin-1") + b") Tj ET\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode())
        out.write(obj)
        out.write(b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(b"trailer\n")
    out.write(f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode())
    out.write(f"startxref\n{xref_pos}\n%%EOF\n".encode())
    return out.getvalue()
