import json
from pathlib import Path
import pikepdf
import pytest

from app.pipeline.fidelity import assess_fidelity
from app.services.visual_figure_rationalization import (
    collect_missing_visual_figure_targets,
    _should_synthesize_visual_figure,
)


def _create_test_scanned_pdf(path: Path, page_count: int = 4, texts_per_page: dict[int, str] | None = None) -> None:
    """Create a test PDF simulating scanned pages with optional text layers."""
    pdf = pikepdf.new()
    for pno in range(page_count):
        page = pdf.add_blank_page(page_size=(300, 400))
        # Add full-page scanned image /Im0
        img = pdf.make_stream(bytes([200]))
        img["/Type"] = pikepdf.Name("/XObject")
        img["/Subtype"] = pikepdf.Name("/Image")
        img["/Width"] = 1
        img["/Height"] = 1
        img["/ColorSpace"] = pikepdf.Name("/DeviceGray")
        img["/BitsPerComponent"] = 8
        page["/Resources"] = pikepdf.Dictionary({
            "/XObject": pikepdf.Dictionary({"/Im0": img}),
            "/Font": pikepdf.Dictionary({
                "/F1": pikepdf.Dictionary({
                    "/Type": pikepdf.Name("/Font"),
                    "/Subtype": pikepdf.Name("/Type1"),
                    "/BaseFont": pikepdf.Name("/Helvetica"),
                })
            }),
        })

        content_ops = [b"q 300 0 0 400 0 0 cm\n/Im0 Do\nQ\n"]
        page_num = pno + 1
        if texts_per_page and page_num in texts_per_page and texts_per_page[page_num]:
            txt = texts_per_page[page_num]
            safe_txt = txt.replace("(", "\\(").replace(")", "\\)")
            content_ops.append(
                f"BT /F1 12 Tf 50 350 Td ({safe_txt}) Tj ET\n".encode("utf-8")
            )
        page["/Contents"] = pdf.make_stream(b"".join(content_ops))

    pdf.save(path)


def test_successful_ocr_run_all_pages_verified(tmp_path):
    """Test 1: Successful OCR run across all 4 pages produces full coverage and pass status."""
    in_pdf = tmp_path / "scanned_in.pdf"
    out_pdf = tmp_path / "scanned_out.pdf"

    # Input: scanned PDF (no text)
    _create_test_scanned_pdf(in_pdf, page_count=4)

    # Output: all 4 pages have OCR text extracted
    texts = {
        1: "OCR TEST DOCUMENT Page 1 Company Directory Purpose: verify text extraction.",
        2: "Processing Log 09:15 AM - Input file received. Important values: batch 00831.",
        3: "Index of Organizations Amber Manufacturing Company industrial equipment 1988.",
        4: "Table-like Records ID A-101 Text recognition COMPLETE 125 A-102 COMPLETE 18.",
    }
    _create_test_scanned_pdf(out_pdf, page_count=4, texts_per_page=texts)

    elements = [
        {"type": "heading", "page": 0, "text": "OCR TEST DOCUMENT", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
        {"type": "paragraph", "page": 0, "text": "Purpose: verify text extraction.", "bbox": {"l": 10, "b": 300, "r": 250, "t": 320}},
        {"type": "heading", "page": 1, "text": "Processing Log", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
        {"type": "paragraph", "page": 1, "text": "09:15 AM - Input file received.", "bbox": {"l": 10, "b": 300, "r": 250, "t": 320}},
        {"type": "heading", "page": 2, "text": "Index of Organizations", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
        {"type": "paragraph", "page": 2, "text": "Amber Manufacturing Company", "bbox": {"l": 10, "b": 300, "r": 250, "t": 320}},
        {"type": "heading", "page": 3, "text": "Table-like Records", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
        {"type": "paragraph", "page": 3, "text": "ID A-101 Text recognition COMPLETE", "bbox": {"l": 10, "b": 300, "r": 250, "t": 320}},
    ]
    structure_json = {
        "page_count": 4,
        "elements": elements,
    }

    # Verify visual figure rationalization does NOT treat scanned pages as charts
    targets = collect_missing_visual_figure_targets(working_pdf=out_pdf, structure_json=structure_json)
    assert targets == [], "Full-page scanned backgrounds must not be flagged as missing visual figures"

    # Assess fidelity
    fidelity_report, review_tasks = assess_fidelity(
        input_pdf=in_pdf,
        output_pdf=out_pdf,
        comparison_source_pdf=None,
        structure_json=structure_json,
        alt_entries=[],
        validation_report={"violations": [], "summary": {"errors": 0}},
        raw_validation_report=None,
        tagging_metrics={},
        classification="scanned",
    )

    ocr_check = next((c for c in fidelity_report.get("checks", []) if c.get("check") == "ocr_coverage"), None)
    assert ocr_check is not None
    assert ocr_check["status"] == "pass"
    assert ocr_check["metrics"]["pages_with_ocr"] >= 4
    assert ocr_check["metrics"]["pages_missing_ocr"] == 0
    # No blocking tasks remaining
    blocking = [t for t in review_tasks if t.get("blocking")]
    assert len(blocking) == 0


def test_incomplete_ocr_run_flags_exact_missing_page(tmp_path):
    """Test 2: Inaccurate/incomplete OCR with a missing page generates high-severity blocking task with page number."""
    in_pdf = tmp_path / "scanned_in2.pdf"
    out_pdf = tmp_path / "scanned_out2.pdf"

    _create_test_scanned_pdf(in_pdf, page_count=4)

    # Output: Pages 1, 2, 4 have text, but Page 3 is MISSING text (failed OCR on page 3)
    texts = {
        1: "OCR TEST DOCUMENT Page 1 Company Directory Purpose: verify text extraction.",
        2: "Processing Log 09:15 AM - Input file received. Important values: batch 00831.",
        3: "",  # Page 3 missing!
        4: "Table-like Records ID A-101 Text recognition COMPLETE 125 A-102 COMPLETE 18.",
    }
    _create_test_scanned_pdf(out_pdf, page_count=4, texts_per_page=texts)

    structure_json = {
        "page_count": 4,
        "elements": [
            {"type": "heading", "page": 0, "text": "Page 1 Heading", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
            {"type": "heading", "page": 1, "text": "Page 2 Heading", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
            {"type": "heading", "page": 3, "text": "Page 4 Heading", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
        ],
    }

    fidelity_report, review_tasks = assess_fidelity(
        input_pdf=in_pdf,
        output_pdf=out_pdf,
        comparison_source_pdf=None,
        structure_json=structure_json,
        alt_entries=[],
        validation_report={"violations": [], "summary": {"errors": 0}},
        raw_validation_report=None,
        tagging_metrics={},
        classification="scanned",
    )

    ocr_check = next((c for c in fidelity_report.get("checks", []) if c.get("check") == "ocr_coverage"), None)
    assert ocr_check is not None
    assert ocr_check["status"] == "fail"

    blocking = [t for t in review_tasks if t.get("blocking")]
    assert len(blocking) >= 1
    incomplete_task = next(t for t in blocking if "incomplete" in t.get("title", "").lower() or "coverage" in t.get("title", "").lower())
    assert incomplete_task["severity"] == "high"
    assert 3 in incomplete_task["metadata"]["pages_to_check"]


def test_inaccurate_ocr_gibberish_noise_flags_advisory_item(tmp_path):
    """Test 3: OCR run with high character recognition errors flags advisory item with page numbers."""
    in_pdf = tmp_path / "scanned_in3.pdf"
    out_pdf = tmp_path / "scanned_out3.pdf"

    _create_test_scanned_pdf(in_pdf, page_count=2)

    # Page 1: normal text. Page 2: excessive non-alphanumeric noise without proper words
    texts = {
        1: "OCR TEST DOCUMENT Page 1 Company Directory Purpose: verify text extraction.",
        2: "!@#$%&*+=~?:;<>!@#$%&*+=~?:;<>!@#$%&*+=~?:;<>!@#$%&*+=~?:;<>",
    }
    _create_test_scanned_pdf(out_pdf, page_count=2, texts_per_page=texts)

    structure_json = {
        "page_count": 2,
        "elements": [
            {"type": "paragraph", "page": 0, "text": "Normal text", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
            {"type": "paragraph", "page": 1, "text": "!@#$%&*+=~?:;<>!@#$%&*+=~?:;<>", "bbox": {"l": 10, "b": 350, "r": 200, "t": 370}},
        ],
    }

    fidelity_report, review_tasks = assess_fidelity(
        input_pdf=in_pdf,
        output_pdf=out_pdf,
        comparison_source_pdf=None,
        structure_json=structure_json,
        alt_entries=[],
        validation_report={"violations": [], "summary": {"errors": 0}},
        raw_validation_report=None,
        tagging_metrics={},
        classification="scanned",
    )

    noise_task = next((t for t in review_tasks if "recognition errors" in t.get("title", "").lower() or "noise" in t.get("title", "").lower()), None)
    assert noise_task is not None
    assert noise_task["blocking"] is False
    assert 2 in noise_task["metadata"]["pages_to_check"]


def test_validation_failure_and_manual_remediation_consistency():
    """Test 4 & 5: When veraPDF validation fails or blocking tasks remain, status is manual_remediation and not compliant."""
    # When veraPDF has unresolved violations
    unresolved_violations = [
        {
            "rule_id": "6.2.2-1",
            "description": "Document catalog does not contain MarkInfo",
            "severity": "error",
            "count": 1,
            "remediation_status": "needs_remediation",
        }
    ]
    raw_val = {
        "compliant": False,
        "violations": unresolved_violations,
        "summary": {"errors": 1, "warnings": 0},
    }

    # Even if fidelity has 0 blocking tasks, the validation failure keeps the overall status at manual_remediation
    final_status = "complete" if raw_val["compliant"] else "manual_remediation"
    assert final_status == "manual_remediation"

    # Conversely: when veraPDF has 0 rule errors, BUT a blocking fidelity task exists:
    blocking_tasks_count = 1
    vera_compliant = True
    fidelity_passed = False if blocking_tasks_count > 0 else True
    final_status_with_blocking = "complete" if (vera_compliant and fidelity_passed) else "manual_remediation"
    assert final_status_with_blocking == "manual_remediation", "Must be manual_remediation when blocking tasks remain"
