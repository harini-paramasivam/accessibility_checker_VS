"""Step 1: Classify PDF as scanned, digital, or mixed with page-level analysis."""

import asyncio
import logging
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pikepdf

from app.pipeline.language import detect_language
from app.services.pdf_preflight import (
    PdfUploadPreflightError,
    PdfUploadPreflightReport,
    _iter_resource_image_pixels,
    inspect_pdf_upload,
)

logger = logging.getLogger(__name__)

# All installed Tesseract language packs for the probe OCR pass.
_PROBE_OCR_LANGUAGES = (
    "eng+spa+fra+deu+chi_sim+chi_tra+rus+ara+kor"
    "+ben+pol+heb+yid+hat+hin+ita+por+jpn"
)

# Text-based language detection sampling tiers.
_TEXT_DETECT_SAMPLE_TIERS = (
    (3, 3000),  # Fast path: first 3 pages
    (10, 8000),  # Broader sample
)

_TEXT_DETECT_TIMEOUT_SECONDS = 20.0
_PROBE_OCR_TIMEOUT_SECONDS = 90.0
_OCR_SCAN_IMAGE_HEAVY_RATIO = 0.75
_OCR_SCAN_TEXT_RATIO = 0.9
_OCR_SCAN_PREFLIGHT_SETTINGS = SimpleNamespace(
    upload_preflight_render_dpi=300,
    upload_image_heavy_page_min_pixels=4_000_000,
)


@dataclass
class PageClassification:
    page_number: int  # 1-based
    type: str  # "digital", "scanned", "mixed", "unreliable_ocr", "blank"
    has_selectable_text: bool
    text_length: int
    alnum_count: int
    has_image: bool
    image_pixels: int
    is_image_heavy: bool
    ocr_reliability: str  # "reliable", "missing", "incomplete", "unreliable", "none"
    needs_ocr: bool
    reason: str


@dataclass
class ClassificationResult:
    type: str  # "scanned", "digital", "mixed", "ocr_scan"
    confidence: float
    pages_with_text: int
    total_pages: int
    detected_language: str | None = field(default=None)
    image_heavy_pages: int = 0
    total_image_pixels: int = 0
    ocr_scan_like: bool = False
    pages_needing_ocr: list[int] = field(default_factory=list)
    pages_reliable_text: list[int] = field(default_factory=list)
    page_details: list[PageClassification] = field(default_factory=list)


def _page_has_text(page: pikepdf.Page) -> bool:
    """Check if a page has extractable text content streams via PDF operators."""
    try:
        if "/Contents" not in page:
            return False
        contents = page.get("/Contents")
        if contents is None:
            return False
        if isinstance(contents, pikepdf.Array):
            raw = b"".join(c.read_bytes() for c in contents)
        else:
            raw = contents.read_bytes()
        return bool(re.search(rb"(?:Tj|TJ|\'|\")\b", raw))
    except Exception as exc:
        logger.debug("Could not inspect page contents: %s", exc)
        return False


def _extract_stream_text_strings(page: pikepdf.Page) -> list[str]:
    """Extract string literals from page contents."""
    try:
        if "/Contents" not in page:
            return []
        contents = page.get("/Contents")
        if contents is None:
            return []
        if isinstance(contents, pikepdf.Array):
            raw = b"".join(c.read_bytes() for c in contents)
        else:
            raw = contents.read_bytes()
        matches = re.findall(rb"\(([^)]+)\)", raw)
        return [m.decode("latin1", errors="replace") for m in matches]
    except Exception:
        return []


def _extract_page_text(pdf_path: Path, page_index: int) -> str:
    """Extract visible text from a specific page using pdfminer."""
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract

        text = pdfminer_extract(
            str(pdf_path),
            page_numbers=[page_index],
            maxpages=1,
        )
        return text or ""
    except Exception as exc:
        logger.debug("pdfminer text extraction failed for page %d: %s", page_index + 1, exc)
        return ""


def _inspect_page_images(page: pikepdf.Page) -> tuple[int, int, bool]:
    """Inspect images on a page. Returns (image_count, total_pixels, is_heavy)."""
    try:
        resources = (
            page.get("/Resources", {})
            if hasattr(page, "get")
            else page.obj.get("/Resources")
        )
        image_pixels_list = list(
            _iter_resource_image_pixels(resources, visited=set())
        )
        image_count = len(image_pixels_list)
        total_pixels = sum(image_pixels_list)
        # Heavy image: >= 400k pixels
        is_heavy = total_pixels >= 400_000 or any(p >= 350_000 for p in image_pixels_list)
        return image_count, total_pixels, is_heavy
    except Exception as exc:
        logger.debug("Could not inspect page images: %s", exc)
        return 0, 0, False


def analyze_page(
    pdf_path: Path, page: pikepdf.Page, page_index: int
) -> PageClassification:
    """Perform detailed page-level analysis of text and image content."""
    page_num = page_index + 1
    has_stream_text = _page_has_text(page)
    extracted_text = _extract_page_text(pdf_path, page_index)
    clean_text = extracted_text.strip()
    if not clean_text and has_stream_text:
        stream_strings = _extract_stream_text_strings(page)
        if stream_strings:
            clean_text = " ".join(stream_strings).strip()

    text_len = len(clean_text)
    alnum_count = sum(1 for c in clean_text if c.isalnum())
    corrupt_count = clean_text.count("\ufffd") + clean_text.count("\x00")

    image_count, total_image_pixels, is_image_heavy = _inspect_page_images(page)
    has_image = image_count > 0

    # Decision logic for page classification & OCR need:
    if is_image_heavy:
        if (alnum_count == 0 and not has_stream_text):
            # Scanned image with no text layer at all
            return PageClassification(
                page_number=page_num,
                type="scanned",
                has_selectable_text=False,
                text_length=0,
                alnum_count=0,
                has_image=True,
                image_pixels=total_image_pixels,
                is_image_heavy=True,
                ocr_reliability="missing",
                needs_ocr=True,
                reason="Scanned page with no extractable text layer.",
            )
        elif corrupt_count > 0 and (corrupt_count / max(text_len, 1)) > 0.15:
            # Text layer is present but corrupted / unmapped glyphs
            return PageClassification(
                page_number=page_num,
                type="unreliable_ocr",
                has_selectable_text=True,
                text_length=text_len,
                alnum_count=alnum_count,
                has_image=True,
                image_pixels=total_image_pixels,
                is_image_heavy=True,
                ocr_reliability="unreliable",
                needs_ocr=True,
                reason="Existing text layer contains unmapped or corrupted glyphs.",
            )
        elif alnum_count < 5:
            # Substantial image but only trivial text (e.g. single digit or stray character)
            return PageClassification(
                page_number=page_num,
                type="unreliable_ocr",
                has_selectable_text=has_stream_text or text_len > 0,
                text_length=text_len,
                alnum_count=alnum_count,
                has_image=True,
                image_pixels=total_image_pixels,
                is_image_heavy=True,
                ocr_reliability="incomplete" if (has_stream_text or alnum_count > 0) else "missing",
                needs_ocr=True,
                reason=f"Substantial scanned image ({total_image_pixels // 1000}k px) with incomplete text layer ({alnum_count} alnum chars).",
            )
        else:
            # Has both substantial image and text layer
            return PageClassification(
                page_number=page_num,
                type="mixed",
                has_selectable_text=True,
                text_length=text_len,
                alnum_count=alnum_count,
                has_image=True,
                image_pixels=total_image_pixels,
                is_image_heavy=True,
                ocr_reliability="reliable",
                needs_ocr=False,
                reason="Page contains scanned image with an existing text layer.",
            )
    else:
        # Not image-heavy
        if alnum_count >= 5 or has_stream_text:
            return PageClassification(
                page_number=page_num,
                type="digital",
                has_selectable_text=True,
                text_length=text_len,
                alnum_count=alnum_count,
                has_image=has_image,
                image_pixels=total_image_pixels,
                is_image_heavy=False,
                ocr_reliability="reliable",
                needs_ocr=False,
                reason="Native digital vector text layer.",
            )
        elif has_image and total_image_pixels >= 100_000:
            # Medium image without text
            return PageClassification(
                page_number=page_num,
                type="scanned",
                has_selectable_text=False,
                text_length=text_len,
                alnum_count=alnum_count,
                has_image=True,
                image_pixels=total_image_pixels,
                is_image_heavy=False,
                ocr_reliability="missing",
                needs_ocr=True,
                reason="Raster image content without selectable text.",
            )
        else:
            return PageClassification(
                page_number=page_num,
                type="digital",
                has_selectable_text=False,
                text_length=0,
                alnum_count=0,
                has_image=has_image,
                image_pixels=total_image_pixels,
                is_image_heavy=False,
                ocr_reliability="none",
                needs_ocr=False,
                reason="Non-text or vector graphics page.",
            )


def _detect_language_from_text(pdf_path: Path) -> str | None:
    """Extract existing text and detect language with lingua."""
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract
    except ImportError as exc:
        logger.warning("pdfminer is not available for language detection: %s", exc)
        return None

    for max_pages, max_chars in _TEXT_DETECT_SAMPLE_TIERS:
        try:
            text = pdfminer_extract(
                str(pdf_path),
                page_numbers=list(range(max_pages)),
                maxpages=max_pages,
            )
        except Exception as exc:
            logger.debug(
                "pdfminer text extraction failed for %s (tier=%s pages): %s",
                pdf_path.name,
                max_pages,
                exc,
            )
            return None

        if not text or not text.strip():
            continue

        detected = detect_language(text[:max_chars])
        if detected:
            return detected

    return None


def _inspect_workload(pdf_path: Path) -> PdfUploadPreflightReport | None:
    try:
        return inspect_pdf_upload(pdf_path, settings=_OCR_SCAN_PREFLIGHT_SETTINGS)
    except PdfUploadPreflightError:
        return None


def _is_ocr_scan_with_text(
    report: PdfUploadPreflightReport | None,
    *,
    pages_with_text: int,
    total_pages: int,
) -> bool:
    if report is None or total_pages <= 0:
        return False
    text_ratio = pages_with_text / total_pages
    image_heavy_ratio = report.image_heavy_pages / max(report.page_count, 1)
    return (
        report.is_ocr_scan_like
        and text_ratio >= _OCR_SCAN_TEXT_RATIO
        and image_heavy_ratio >= _OCR_SCAN_IMAGE_HEAVY_RATIO
    )


async def _probe_ocr_detect(pdf_path: Path) -> str | None:
    """Probe-OCR page 1 with all languages, then detect from the OCR'd text."""
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract

        from app.pipeline.ocr import run_ocr

        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            probe_input = tmpdir_path / "page1.pdf"
            probe_output = tmpdir_path / "page1_ocr.pdf"

            def _extract_page1():
                with pikepdf.open(str(pdf_path)) as pdf:
                    if not pdf.pages:
                        return False
                    probe_pdf = pikepdf.Pdf.new()
                    probe_pdf.pages.append(pdf.pages[0])
                    probe_pdf.save(str(probe_input))
                    return True

            if not await asyncio.to_thread(_extract_page1):
                return None

            ocr_result = await run_ocr(
                probe_input,
                probe_output,
                language=_PROBE_OCR_LANGUAGES,
                timeout_seconds=30,
            )
            if not ocr_result.success:
                logger.debug("Probe OCR failed: %s", ocr_result.message)
                return None

            def _extract_and_detect():
                text = pdfminer_extract(str(ocr_result.output_path), maxpages=1)
                return detect_language(text[:3000]) if text else None

            return await asyncio.to_thread(_extract_and_detect)
    except Exception as exc:
        logger.debug("Probe OCR language detection failed: %s", exc)
        return None


async def classify_pdf(pdf_path: Path) -> ClassificationResult:
    """Classify whether a PDF is scanned, digital, mixed, or an OCR'd scan.

    Performs page-level text, image, and reliability analysis to avoid
    misclassifying PDFs with partial or corrupted text layers as purely digital.
    """

    def _classify_structure() -> ClassificationResult:
        with pikepdf.open(str(pdf_path)) as pdf:
            total = len(pdf.pages)
            if total == 0:
                return ClassificationResult(
                    type="digital", confidence=1.0, pages_with_text=0, total_pages=0
                )

            pages_with_text = sum(1 for page in pdf.pages if _page_has_text(page))
            ratio = pages_with_text / total
            workload = _inspect_workload(pdf_path)

            page_details: list[PageClassification] = []
            for idx, page in enumerate(pdf.pages):
                page_details.append(analyze_page(pdf_path, page, idx))

            pages_needing_ocr = [p.page_number for p in page_details if p.needs_ocr]
            pages_reliable_text = [
                p.page_number
                for p in page_details
                if not p.needs_ocr and (p.has_selectable_text or p.type == "digital")
            ]

            if ratio < 0.1:
                classification = "scanned"
                confidence = 1.0 - ratio
            elif _is_ocr_scan_with_text(
                workload,
                pages_with_text=pages_with_text,
                total_pages=total,
            ):
                classification = "ocr_scan"
                image_heavy_ratio = (
                    workload.image_heavy_pages / max(workload.page_count, 1)
                    if workload
                    else 0.0
                )
                confidence = min(1.0, max(0.75, (ratio + image_heavy_ratio) / 2))
            elif ratio > 0.9 and len(pages_needing_ocr) == 0:
                classification = "digital"
                confidence = ratio
            elif ratio > 0.9 and (not workload or not workload.image_heavy_pages):
                classification = "digital"
                confidence = ratio
            elif len(pages_needing_ocr) > 0 and len(pages_reliable_text) > 0:
                classification = "mixed"
                confidence = 0.8
            elif len(pages_needing_ocr) == total:
                classification = "scanned"
                confidence = 0.9
            else:
                classification = "mixed"
                confidence = 0.5

            return ClassificationResult(
                type=classification,
                confidence=confidence,
                pages_with_text=pages_with_text,
                total_pages=total,
                image_heavy_pages=workload.image_heavy_pages if workload else sum(1 for p in page_details if p.is_image_heavy),
                total_image_pixels=workload.total_image_pixels if workload else sum(p.image_pixels for p in page_details),
                ocr_scan_like=bool(workload and workload.is_ocr_scan_like),
                pages_needing_ocr=pages_needing_ocr,
                pages_reliable_text=pages_reliable_text,
                page_details=page_details,
            )

    result = await asyncio.to_thread(_classify_structure)

    # Try detecting language from existing text
    if result.pages_with_text > 0:
        try:
            detected = await asyncio.wait_for(
                asyncio.to_thread(_detect_language_from_text, pdf_path),
                timeout=_TEXT_DETECT_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            logger.warning(
                "Text-based language detection timed out after %.0fs for %s",
                _TEXT_DETECT_TIMEOUT_SECONDS,
                pdf_path.name,
            )
            detected = None
        if detected:
            result.detected_language = detected

    logger.info(
        "Classified %s: %s (%d/%d pages with text, %d needing OCR, lang=%s)",
        pdf_path.name,
        result.type,
        result.pages_with_text,
        len(result.pages_needing_ocr),
        result.detected_language,
    )

    # For scanned/mixed docs or docs without detected language, probe-OCR page 1
    if not result.detected_language and result.total_pages > 0:
        try:
            detected = await asyncio.wait_for(
                _probe_ocr_detect(pdf_path),
                timeout=_PROBE_OCR_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            logger.warning(
                "Probe-OCR language detection timed out after %.0fs for %s",
                _PROBE_OCR_TIMEOUT_SECONDS,
                pdf_path.name,
            )
            detected = None
        if detected:
            result.detected_language = detected
            logger.info("Probe OCR detected language for %s: %s", pdf_path.name, detected)

    return result
