"""Tests for PDF Structure Tag Tree, heading classification, placeholder detection,
reconciled counts, and Structure Health score calculations.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pikepdf
import pytest

from app.pipeline.alt_text import AltTextResult, generate_alt_text
from app.pipeline.structure import FigureInfo, _infer_heading_level
from app.pipeline.tagger import StructTreeBuilder, _normalize_heading_hierarchy
from app.services.tag_tree_validator import TagTreeValidator


def test_valid_heading_hierarchy(tmp_path: Path):
    """A valid hierarchy (H1 -> H2 -> H3) should pass without errors and score 100."""
    pdf_path = tmp_path / "valid_doc.pdf"
    doc_json = {
        "elements": [
            {"type": "heading", "level": 1, "text": "Document Title", "page": 0},
            {"type": "heading", "level": 2, "text": "Section 1", "page": 0},
            {"type": "heading", "level": 3, "text": "Subsection 1.1", "page": 0},
            {"type": "heading", "level": 2, "text": "Section 2", "page": 1},
        ]
    }
    validator = TagTreeValidator(pdf_path=pdf_path, structure_json=doc_json)
    result = validator.build_and_validate()

    assert result["is_valid_hierarchy"] is True
    assert result["error_count"] == 0
    assert result["structural_score"] == 100
    assert result["stats"]["headings_count"] == 4
    assert [h["level"] for h in result["headings_hierarchy"]] == [1, 2, 3, 2]


def test_incorrect_heading_levels_skipped(tmp_path: Path):
    """Skipping levels (e.g. H1 directly to H3) must be flagged as an error."""
    pdf_path = tmp_path / "skipped_doc.pdf"
    doc_json = {
        "elements": [
            {"type": "heading", "level": 1, "text": "Document Title", "page": 0},
            {"type": "heading", "level": 3, "text": "Skipped Level 3", "page": 0},
        ]
    }
    validator = TagTreeValidator(pdf_path=pdf_path, structure_json=doc_json)
    result = validator.build_and_validate()

    assert result["is_valid_hierarchy"] is False
    assert result["error_count"] >= 1
    assert any("skipped" in issue["message"].lower() for issue in result["issues"])
    assert result["structural_score"] < 100


def test_incorrect_heading_levels_starts_with_h2(tmp_path: Path):
    """A document starting with H2 instead of H1 must be flagged."""
    pdf_path = tmp_path / "no_h1_doc.pdf"
    doc_json = {
        "elements": [
            {"type": "heading", "level": 2, "text": "Starting Section", "page": 0},
            {"type": "heading", "level": 3, "text": "Subsection", "page": 0},
        ]
    }
    validator = TagTreeValidator(pdf_path=pdf_path, structure_json=doc_json)
    result = validator.build_and_validate()

    assert result["is_valid_hierarchy"] is False
    assert any("instead of <H1>" in issue["message"] for issue in result["issues"])
    assert result["structural_score"] < 100


def test_flattened_all_h1_headings_detected_and_penalized(tmp_path: Path):
    """If 18 headings are all classified as H1, Structure Health must NOT award 100/100."""
    pdf_path = tmp_path / "all_h1_doc.pdf"
    elements = [
        {"type": "heading", "level": 1, "text": f"Heading {i}", "page": i // 2}
        for i in range(1, 19)
    ]
    doc_json = {"elements": elements}
    validator = TagTreeValidator(pdf_path=pdf_path, structure_json=doc_json)
    result = validator.build_and_validate()

    assert result["is_valid_hierarchy"] is False
    assert result["stats"]["headings_count"] == 18
    assert result["structural_score"] <= 75
    flat_issue = next((iss for iss in result["issues"] if iss.get("id") == "issue-head-flat-all-h1"), None)
    assert flat_issue is not None
    assert "All 18 headings are classified as <H1>" in flat_issue["message"]


def test_missing_figure_alt_text_flagged(tmp_path: Path):
    """A Figure node missing alternative text must be flagged and lower the health score."""
    pdf_path = tmp_path / "missing_alt.pdf"
    doc_json = {
        "elements": [
            {"type": "heading", "level": 1, "text": "Title", "page": 0},
            {"type": "figure", "page": 0, "alt_text": None},
        ]
    }
    validator = TagTreeValidator(pdf_path=pdf_path, structure_json=doc_json)
    result = validator.build_and_validate()

    assert result["is_valid_hierarchy"] is False
    assert result["structural_score"] < 100
    assert any("missing alternative text" in iss["message"].lower() for iss in result["issues"])


def test_placeholder_figure_alt_text_not_awarded_100(tmp_path: Path):
    """Never award 100/100 when '[Could not determine figure semantics]' is used."""
    pdf_path = tmp_path / "placeholder_alt.pdf"
    doc_json = {
        "elements": [
            {"type": "heading", "level": 1, "text": "Report Title", "page": 0},
            {
                "type": "figure",
                "page": 0,
                "alt_text": "[Could not determine figure semantics]",
            },
        ]
    }
    validator = TagTreeValidator(pdf_path=pdf_path, structure_json=doc_json)
    result = validator.build_and_validate()

    assert result["is_valid_hierarchy"] is False
    assert result["structural_score"] <= 85
    assert any("placeholder" in iss["message"].lower() for iss in result["issues"])


def test_normalize_heading_hierarchy_preserves_levels():
    """_normalize_heading_hierarchy must preserve H2-H6 and not collapse everything into H1."""
    headings = [
        {"type": "heading", "level": 1, "page": 0, "text": "Title"},
        {"type": "heading", "level": 2, "page": 0, "text": "Section 1"},
        {"type": "heading", "level": 3, "page": 0, "text": "Subsection 1.1"},
        {"type": "heading", "level": 2, "page": 1, "text": "Section 2"},
        {"type": "heading", "level": 4, "page": 1, "text": "Subsection 2.1 (skipped)"},  # should clamp to 3
    ]
    _normalize_heading_hierarchy(headings)

    levels = [h["level"] for h in headings]
    assert levels == [1, 2, 3, 2, 3], f"Expected [1, 2, 3, 2, 3] but got {levels}"
    assert 2 in levels
    assert 3 in levels


def test_infer_heading_level_from_numbering():
    """_infer_heading_level should recognize section numbers like 1.1 or 1.1.2."""
    assert _infer_heading_level({}, "1. Introduction") == 2
    assert _infer_heading_level({}, "1.1 Background") == 2
    assert _infer_heading_level({}, "1.1.1 Sub-details") == 3
    assert _infer_heading_level({}, "1.1.1.1 Micro-details") == 4
    assert _infer_heading_level({}, "Chapter 2: Methods") == 1
    assert _infer_heading_level({"level": 3}, "Arbitrary Header") == 3


def test_list_item_does_not_inflate_list_count():
    """Adding 5 list items to 1 list group must count as 1 list, not 5."""
    pdf = pikepdf.new()
    page = pdf.add_blank_page()
    builder = StructTreeBuilder(pdf)
    builder.setup()

    # Add 5 items to the same list group
    list_ref = "list-grp-1"
    for i in range(5):
        builder.add_list_item(page_index=0, page_ref=page.obj, list_group_ref=list_ref)

    assert builder._lists_created == 1
    assert len(builder._list_cache) == 1


def test_tree_node_inspection_attributes_and_parents(tmp_path: Path):
    """Tree nodes must contain parent_tag, role, page, and children metadata."""
    pdf_path = tmp_path / "inspect_doc.pdf"
    doc_json = {
        "elements": [
            {"type": "heading", "level": 1, "text": "Main Title", "page": 0},
            {"type": "paragraph", "text": "Introduction text snippet", "page": 0},
        ]
    }
    validator = TagTreeValidator(pdf_path=pdf_path, structure_json=doc_json)
    result = validator.build_and_validate()

    tree = result["tree"]
    assert len(tree) == 1
    root = tree[0]
    assert root["tag"] == "Document"
    assert root["role"] == "document"
    assert len(root["children"]) == 2

    h1_node = root["children"][0]
    assert h1_node["tag"] == "H1"
    assert h1_node["parent_tag"] == "Document"
    assert h1_node["page"] == 1
    assert h1_node["title"] == "Main Title"
    assert h1_node["attributes"]["level"] == 1


@pytest.mark.asyncio
async def test_alt_text_unresolved_returns_pending_review(tmp_path: Path):
    """Figures with unresolved semantics must return status pending_review with no placeholder."""
    fig = FigureInfo(
        index=0,
        page=0,
        path=tmp_path / "missing_fig.png",
        caption="",
    )
    llm_mock = MagicMock()
    results = await generate_alt_text(
        figures=[fig],
        llm_client=llm_mock,
    )
    assert len(results) == 1
    res = results[0]
    assert res.status == "pending_review"
    assert res.generated_text is None or res.generated_text == ""
    assert "[Could not determine figure semantics]" not in str(res.generated_text)
    assert "[Image file not found]" not in str(res.generated_text)
