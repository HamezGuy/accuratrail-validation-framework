"""Generate deterministic fictional PDF fixtures with ReportLab; no clinical data.

Run with the bundled Python runtime. Set PDF_FIXTURE_FONT to an equivalent
DejaVuSans.ttf installation if the bundled font path is unavailable.
"""
from pathlib import Path
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = Path(__file__).resolve().parent
FONT = Path(os.environ.get('PDF_FIXTURE_FONT',
    str(Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/share/fonts/DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('FixtureSans', str(FONT)))

rows = [
    ('Weight', '70.5', 'kg'),
    ('Notes', 'Synthetic software qualification only', ''),
    ('Count', '0', ''),
    ('Confirmed', 'false', ''),
    ('Temperature', '37.2', '°C'),
    ('Dose', '0', 'μg'),
    ('Unicode label', 'Café naïve', ''),
    ('Regular expression [test]', '1.0 (checked)', ''),
]


def write_form(filename: str, signed: bool) -> None:
    # Uncompressed streams allow same-byte-length content corruption controls
    # without changing PDF object offsets or implementing a PDF serializer.
    document = canvas.Canvas(str(HERE / filename), pagesize=letter, invariant=1, pageCompression=0)
    document.setTitle('Fictional owned qualification form')
    document.setAuthor('AccuraTrial software contract test fixture')
    document.setFont('FixtureSans', 17)
    document.drawString(48, 742, 'Software qualification form')
    document.setFont('FixtureSans', 10)
    document.drawString(48, 719, 'Fictional parser qualification fixture.')
    document.drawString(48, 690, 'Subject: OQ-OWNED-SUBJECT')
    document.drawString(48, 672, 'Form: OQ field checks')
    document.setStrokeColorRGB(0.65, 0.69, 0.73)
    document.line(48, 653, 564, 653)
    document.drawString(48, 633, 'Field')
    document.drawString(224, 633, 'Value')
    document.drawString(482, 633, 'Unit')
    for index, (label, value, unit) in enumerate(rows):
        y = 606 - index * 29
        document.drawString(48, y, label)
        document.drawString(224, y, value)
        if unit:
            document.drawString(482, y, unit)
    document.line(48, 377, 564, 377)
    document.setFont('FixtureSans', 12)
    document.drawString(48, 353, 'Electronic signature - form 111')
    document.setFont('FixtureSans', 9)
    signature_lines = [
        'Signer: Owned Operator (operator)',
        'Signed at: 2026-10-02T12:00:00.000Z',
        'Meaning: Approved',
        'Signature record: 901',
        'SHA-256: ' + 'a' * 64,
        'Verified scope: event-crf-item-values/1',
    ] if signed else ['Signature state: unsigned']
    for index, line in enumerate(signature_lines):
        document.drawString(48, 332 - index * 17, line)
    document.setFont('FixtureSans', 12)
    document.drawString(48, 211, 'Form audit history')
    document.setFont('FixtureSans', 10)
    document.drawString(48, 192, 'Audit Trail Report')
    document.setFont('FixtureSans', 8.5)
    document.drawString(48, 170, 'Date/Time Action Field User Old Value New Value Reason')
    document.drawString(48, 152, 'Weight Owned Operator 75 70.5 PQ verified synthetic weight correction')
    document.setFont('FixtureSans', 9)
    document.drawString(48, 93, 'Fictional manifestation only; no signature authority is asserted.')
    document.drawString(48, 49, 'Contract fixture - generated with ReportLab - page 1 of 1')
    document.showPage()
    document.save()


write_form('owned-form.pdf', signed=False)
write_form('signed-form.pdf', signed=True)

# A valid one-page PDF without text: parsing must refuse it as textual evidence.
empty = canvas.Canvas(str(HERE / 'empty-text.pdf'), pagesize=letter, invariant=1, pageCompression=0)
empty.setTitle('Intentionally empty software qualification fixture')
empty.setAuthor('AccuraTrial software contract test fixture')
empty.showPage()
empty.save()
