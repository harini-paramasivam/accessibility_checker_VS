"""Comprehensive test suite for PDF classification and OCR stage.

Tests scenarios:
1. A digital PDF with selectable text.
2. A scanned PDF containing image-only text.
3. A mixed PDF with digital text on one page and scanned text on another.
4. A PDF with an incomplete or unreliable text layer.
5. A PDF when Tesseract is missing or misconfigured.
"""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pikepdf
import pytest

from app.pipeline import classify
from app.pipeline.ocr import OcrResult, run_ocr, verify_ocr_engine


def _create_digital_pdf(path: Path) -> None:
    """Create a multi-page PDF with native vector digital text."""
    pdf = pikepdf.new()
    font = pdf.make_indirect(
        pikepdf.Dictionary(
            {
                "/Type": pikepdf.Name("/Font"),
                "/Subtype": pikepdf.Name("/Type1"),
                "/BaseFont": pikepdf.Name("/Helvetica"),
            }
        )
    )
    for i in range(2):
        page = pdf.add_blank_page(page_size=(612, 792))
        page.obj["/Resources"] = pikepdf.Dictionary({"/Font": pikepdf.Dictionary({"/F1": font})})
        text_content = (
            f"BT /F1 12 Tf 72 720 Td (Chapter {i + 1}: Principles of Enterprise PDF Accessibility) Tj ET\n"
            "BT /F1 10 Tf 72 700 Td (All documents must comply with ISO 14289-1 standards.) Tj ET\n"
        )
        page.obj["/Contents"] = pdf.make_stream(text_content.encode("latin1"))
    pdf.save(path)


def _create_scanned_pdf(path: Path) -> None:
    """Create a scanned PDF with an image and no text."""
    pdf = pikepdf.new()
    page = pdf.add_blank_page(page_size=(612, 792))
    image = pdf.make_stream(b"\x80" * (1200 * 1600))
    image["/Type"] = pikepdf.Name("/XObject")
    image["/Subtype"] = pikepdf.Name("/Image")
    image["/Width"] = 1200
    image["/Height"] = 1600
    image["/ColorSpace"] = pikepdf.Name("/DeviceGray")
    image["/BitsPerComponent"] = 8
    page.obj["/Resources"] = pikepdf.Dictionary({"/XObject": pikepdf.Dictionary({"/Im0": image})})
    page.obj["/Contents"] = pdf.make_stream(b"q 612 0 0 792 0 0 cm /Im0 Do Q\n")
    pdf.save(path)


def _create_mixed_pdf(path: Path) -> None:
    """Create a 2-page PDF: Page 1 digital text, Page 2 scanned image."""
    pdf = pikepdf.new()
    font = pdf.make_indirect(
        pikepdf.Dictionary(
            {
                "/Type": pikepdf.Name("/Font"),
                "/Subtype": pikepdf.Name("/Type1"),
                "/BaseFont": pikepdf.Name("/Helvetica"),
            }
        )
    )
    # Page 1: Digital text
    page1 = pdf.add_blank_page(page_size=(612, 792))
    page1.obj["/Resources"] = pikepdf.Dictionary({"/Font": pikepdf.Dictionary({"/F1": font})})
    page1.obj["/Contents"] = pdf.make_stream(
        b"BT /F1 12 Tf 72 720 Td (Annual Accessibility Compliance Report Page 1) Tj ET\n"
        b"BT /F1 10 Tf 72 700 Td (This page contains high-fidelity native selectable text.) Tj ET\n"
    )

    # Page 2: Scanned image with no text
    page2 = pdf.add_blank_page(page_size=(612, 792))
    image = pdf.make_stream(b"\x55" * (1000 * 1500))
    image["/Type"] = pikepdf.Name("/XObject")
    image["/Subtype"] = pikepdf.Name("/Image")
    image["/Width"] = 1000
    image["/Height"] = 1500
    image["/ColorSpace"] = pikepdf.Name("/DeviceGray")
    image["/BitsPerComponent"] = 8
    page2.obj["/Resources"] = pikepdf.Dictionary({"/XObject": pikepdf.Dictionary({"/Im0": image})})
    page2.obj["/Contents"] = pdf.make_stream(b"q 612 0 0 792 0 0 cm /Im0 Do Q\n")

    pdf.save(path)


def _create_incomplete_text_layer_pdf(path: Path) -> None:
    """Create a PDF with a large scanned image but an incomplete/unreliable text layer."""
    pdf = pikepdf.new()
    font = pdf.make_indirect(
        pikepdf.Dictionary(
            {
                "/Type": pikepdf.Name("/Font"),
                "/Subtype": pikepdf.Name("/Type1"),
                "/BaseFont": pikepdf.Name("/Helvetica"),
            }
        )
    )
    page = pdf.add_blank_page(page_size=(612, 792))
    image = pdf.make_stream(b"\x33" * (1200 * 1800))
    image["/Type"] = pikepdf.Name("/XObject")
    image["/Subtype"] = pikepdf.Name("/Image")
    image["/Width"] = 1200
    image["/Height"] = 1800
    image["/ColorSpace"] = pikepdf.Name("/DeviceGray")
    image["/BitsPerComponent"] = 8
    page.obj["/Resources"] = pikepdf.Dictionary(
        {
            "/Font": pikepdf.Dictionary({"/F1": font}),
            "/XObject": pikepdf.Dictionary({"/Im0": image}),
        }
    )
    # Only single digit "1" - incomplete text layer on full page scan
    page.obj["/Contents"] = pdf.make_stream(
        b"q 612 0 0 792 0 0 cm /Im0 Do Q\n"
        b"BT /F1 10 Tf 550 50 Td (1) Tj ET\n"
    )
    pdf.save(path)


# ── TEST 1: Digital PDF with selectable text ──
@pytest.mark.asyncio
async def test_digital_pdf_with_selectable_text(tmp_path):
    pdf_path = tmp_path / "digital.pdf"
    _create_digital_pdf(pdf_path)

    result = await classify.classify_pdf(pdf_path)

    assert result.type == "digital"
    assert result.total_pages == 2
    assert result.pages_with_text == 2
    assert len(result.pages_needing_ocr) == 0
    assert len(result.pages_reliable_text) == 2
    assert all(not p.needs_ocr for p in result.page_details)
    assert all(p.ocr_reliability == "reliable" for p in result.page_details)


# ── TEST 2: Scanned PDF containing image-only text ──
@pytest.mark.asyncio
async def test_scanned_pdf_image_only(tmp_path):
    pdf_path = tmp_path / "scanned.pdf"
    _create_scanned_pdf(pdf_path)

    result = await classify.classify_pdf(pdf_path)

    assert result.type == "scanned"
    assert result.total_pages == 1
    assert len(result.pages_needing_ocr) == 1
    assert 1 in result.pages_needing_ocr
    assert result.page_details[0].needs_ocr is True
    assert result.page_details[0].ocr_reliability == "missing"
    assert result.page_details[0].is_image_heavy is True


# ── TEST 3: Mixed PDF (digital page 1, scanned page 2) ──
@pytest.mark.asyncio
async def test_mixed_pdf_digital_and_scanned(tmp_path):
    pdf_path = tmp_path / "mixed.pdf"
    _create_mixed_pdf(pdf_path)

    result = await classify.classify_pdf(pdf_path)

    assert result.type == "mixed"
    assert result.total_pages == 2
    # Page 1 is digital and does not need OCR
    assert result.page_details[0].needs_ocr is False
    assert result.page_details[0].ocr_reliability == "reliable"
    # Page 2 is scanned and requires OCR
    assert result.page_details[1].needs_ocr is True
    assert result.page_details[1].ocr_reliability == "missing"
    # Selective OCR target is only page 2
    assert result.pages_needing_ocr == [2]
    assert 1 in result.pages_reliable_text


# ── TEST 4: PDF with an incomplete or unreliable text layer ──
@pytest.mark.asyncio
async def test_incomplete_text_layer_triggers_ocr(tmp_path):
    pdf_path = tmp_path / "incomplete_ocr.pdf"
    _create_incomplete_text_layer_pdf(pdf_path)

    # Mock analyze_page text extraction to reflect minimal single-character text
    result = await classify.classify_pdf(pdf_path)

    # Must NOT be classified as digital; page requires OCR
    assert result.page_details[0].is_image_heavy is True
    # The page has substantial scanned image and only a stray page number
    assert result.page_details[0].ocr_reliability in ("incomplete", "unreliable", "missing")
    assert 1 in result.pages_needing_ocr


# ── TEST 5: Tesseract missing or misconfigured ──
@pytest.mark.asyncio
async def test_tesseract_missing_or_misconfigured(tmp_path, monkeypatch):
    pdf_path = tmp_path / "scanned.pdf"
    _create_scanned_pdf(pdf_path)
    output_path = tmp_path / "ocred.pdf"

    # Simulate tesseract binary not found
    monkeypatch.setattr("app.pipeline.ocr.resolve_binary", lambda binary, explicit=None: None)

    # 1. Engine check must report False with informative error
    is_ready, err_msg = verify_ocr_engine("eng")
    assert is_ready is False
    assert "not found" in err_msg or "install tesseract" in err_msg.lower()

    # 2. run_ocr must fail with status="failed", NEVER silently reporting "skipped"
    ocr_result = await run_ocr(pdf_path, output_path, language="eng")
    assert ocr_result.success is False
    assert ocr_result.status == "failed"
    assert ocr_result.skipped is False
    assert ocr_result.engine_error is not None
    assert "tesseract" in ocr_result.engine_error.lower()


# ── TEST 6: Selective OCR argument construction ──
def test_selective_ocr_args_includes_page_filter():
    from app.pipeline.ocr import _build_ocrmypdf_args

    args = _build_ocrmypdf_args(
        input_path=Path("input.pdf"),
        output_path=Path("output.pdf"),
        language="eng",
        mode="skip",
        rotate_pages=True,
        deskew=True,
        pages=[2, 4],
    )

    assert "--pages" in args
    assert args[args.index("--pages") + 1] == "2,4"
    assert "--skip-text" in args
