"""PDF Tag Tree Structural Validator and Inspector Service.

Validates PDF logical structure trees against PDF/UA-1 (ISO 14289-1) and
WCAG 2.1 AA criteria:
- Heading hierarchy (H1-H6 sequence, no skipped levels, initial H1, semantic depth)
- Table structures (TR, TH, TD, Scope attributes)
- List structures (L -> LI -> Lbl / LBody)
- Figure alternative text (presence, unresolved placeholder detection, quality)
- Link descriptions and annotations
- Structural health score calculation (0 - 100 based on rigorous checks)
- Node expandable inspection with parent/children, page, and content snippets
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Patterns that indicate unresolved or low-quality placeholder alternative text
PLACEHOLDER_ALT_PATTERNS = re.compile(
    r"(?:^\[.*\]$)"  # Any text enclosed in brackets like [Could not determine figure semantics]
    r"|(?:could not determine)"
    r"|(?:generation failed)"
    r"|(?:requires manual)"
    r"|(?:placeholder)"
    r"|(?:untitled)"
    r"|(?:no description)"
    r"|^(?:image|img|figure|fig|graphic|picture|photo|icon|screenshot|scan|drawing)"
    r"(?:[-_\s]*\d+)?(?:\.(?:png|jpg|jpeg|gif|svg|webp|bmp|tiff|pdf))?$",
    re.IGNORECASE,
)

GENERIC_ALT_TEXT_PATTERNS = re.compile(
    r"^(?:image|img|figure|fig|graphic|picture|photo|icon|untitled|placeholder|screenshot|scan|drawing)"
    r"(?:[-_\s]*\d+)?(?:\.(?:png|jpg|jpeg|gif|svg|webp|bmp|tiff))?$",
    re.IGNORECASE,
)


def _resolve_dict(obj: Any) -> Any:
    """Resolve a pikepdf indirect object to a dict or return as-is."""
    if obj is None:
        return None
    try:
        import pikepdf
        if isinstance(obj, (pikepdf.Dictionary, dict)):
            return obj
        if hasattr(obj, "keys") and hasattr(obj, "get"):
            return obj
    except Exception:
        pass
    return None


def _clean_str(val: Any) -> str:
    if val is None:
        return ""
    try:
        text = str(val).strip()
        if text.startswith("/"):
            text = text[1:]
        return text
    except Exception:
        return ""


def _extract_text_from_node(node_dict: Any) -> str:
    """Extract snippet of title, actual text, or alt text from a struct element."""
    for key in ("/Title", "/ActualText", "/Alt"):
        val = node_dict.get(key)
        if val:
            text = _clean_str(val)
            if text:
                return text[:120]
    return ""


def _extract_scope(attrs_obj: Any) -> str:
    """Extract Scope attribute ('Col', 'Row', 'Both') from an attribute dictionary/array."""
    try:
        import pikepdf
        if isinstance(attrs_obj, pikepdf.Dictionary):
            scope = attrs_obj.get("/Scope")
            if scope:
                return _clean_str(scope)
        elif isinstance(attrs_obj, pikepdf.Array):
            for item in attrs_obj:
                if isinstance(item, pikepdf.Dictionary):
                    scope = item.get("/Scope")
                    if scope:
                        return _clean_str(scope)
    except Exception:
        pass
    return ""


class TagTreeValidator:
    """Validates and extracts hierarchical PDF structure tree."""

    def __init__(self, pdf_path: Path | str, structure_json: str | dict | None = None) -> None:
        self.pdf_path = Path(pdf_path)
        self.structure_json = structure_json
        self.node_counter = 0
        self.issues: list[dict[str, Any]] = []
        self.tag_counts: dict[str, int] = {}
        self.headings_sequence: list[dict[str, Any]] = []
        self._parsed_from_pdf = False

    def _next_id(self) -> str:
        self.node_counter += 1
        return f"tag-{self.node_counter}"

    def build_and_validate(self) -> dict[str, Any]:
        """Main entry point to inspect structure and validate rules."""
        import pikepdf

        tree: list[dict[str, Any]] = []
        self._parsed_from_pdf = False

        if self.pdf_path.exists():
            try:
                with pikepdf.open(str(self.pdf_path)) as pdf:
                    struct_root = pdf.Root.get("/StructTreeRoot")
                    if struct_root is not None:
                        # Build fast lookup for page objects -> 1-based page numbers
                        page_map: dict[Any, int] = {}
                        for idx, page in enumerate(pdf.pages, start=1):
                            page_map[id(page.obj)] = idx
                            if hasattr(page.obj, "objgen"):
                                page_map[page.obj.objgen] = idx

                        tree = self._parse_pikepdf_tree(struct_root, page_map=page_map)
                        self._parsed_from_pdf = bool(tree)
            except Exception as exc:
                logger.warning("Failed to parse StructTreeRoot from %s: %s", self.pdf_path, exc)

        # Fallback to structure_json from Docling if StructTreeRoot was not found
        if not self._parsed_from_pdf and self.structure_json:
            tree = self._parse_json_structure(self.structure_json)

        # Execute structural validations
        self._validate_heading_hierarchy()
        self._validate_node_rules(tree)

        # Calculate Structure Health from meaningful checks
        error_count = sum(1 for issue in self.issues if issue.get("severity") == "error")
        warning_count = sum(1 for issue in self.issues if issue.get("severity") == "warning")

        # Specific penalties for critical failures
        flat_h1_failed = any(issue.get("id") == "issue-head-flat-all-h1" for issue in self.issues)
        placeholder_failed = any("-alt-placeholder" in str(issue.get("id", "")) for issue in self.issues)
        missing_alt_failed = any(issue.get("id", "").endswith("-alt") for issue in self.issues)

        deductions = (error_count * 15) + (warning_count * 5)
        if flat_h1_failed:
            deductions = max(deductions, 25)
        if placeholder_failed or missing_alt_failed:
            deductions = max(deductions, 20)

        # Score calculation: 100 base minus deductions
        score = max(0, min(100, 100 - deductions))

        # Reconcile counts
        h_count = len(self.headings_sequence)
        table_count = self.tag_counts.get("Table", 0)
        list_count = self.tag_counts.get("L", 0)
        figure_count = self.tag_counts.get("Figure", 0)
        link_count = self.tag_counts.get("Link", 0)

        return {
            "available": bool(tree),
            "structural_score": score,
            "is_valid_hierarchy": error_count == 0,
            "error_count": error_count,
            "warning_count": warning_count,
            "stats": {
                "total_nodes": self.node_counter,
                "counts_by_tag": dict(sorted(self.tag_counts.items())),
                "headings_count": h_count,
                "tables_count": table_count,
                "lists_count": list_count,
                "figures_count": figure_count,
                "links_count": link_count,
            },
            "headings_hierarchy": self.headings_sequence,
            "issues": self.issues,
            "tree": tree,
        }

    def _resolve_node_page(self, node: Any, page_map: dict[Any, int]) -> int | None:
        """Resolve 1-based page number from /Pg attribute on node or child MCRs."""
        if not hasattr(node, "get"):
            return None

        # Check /Pg directly on node
        pg = node.get("/Pg")
        if pg is not None:
            if id(pg) in page_map:
                return page_map[id(pg)]
            if hasattr(pg, "objgen") and pg.objgen in page_map:
                return page_map[pg.objgen]

        # Check in /K kids
        k = node.get("/K")
        if hasattr(k, "get"):
            k_pg = k.get("/Pg")
            if k_pg is not None:
                if id(k_pg) in page_map:
                    return page_map[id(k_pg)]
                if hasattr(k_pg, "objgen") and k_pg.objgen in page_map:
                    return page_map[k_pg.objgen]
        elif isinstance(k, list) or hasattr(k, "__iter__"):
            try:
                for child in k:
                    if hasattr(child, "get"):
                        c_pg = child.get("/Pg")
                        if c_pg is not None:
                            if id(c_pg) in page_map:
                                return page_map[id(c_pg)]
                            if hasattr(c_pg, "objgen") and c_pg.objgen in page_map:
                                return page_map[c_pg.objgen]
            except Exception:
                pass
        return None

    def _parse_pikepdf_tree(
        self,
        node: Any,
        depth: int = 0,
        page_map: dict[Any, int] | None = None,
        parent_tag: str | None = None,
        parent_id: str | None = None,
    ) -> list[dict[str, Any]]:
        import pikepdf
        if node is None or depth > 32:
            return []

        page_map = page_map or {}
        results: list[dict[str, Any]] = []

        if isinstance(node, pikepdf.Array):
            for item in node:
                results.extend(
                    self._parse_pikepdf_tree(
                        item,
                        depth + 1,
                        page_map=page_map,
                        parent_tag=parent_tag,
                        parent_id=parent_id,
                    )
                )
            return results

        if not isinstance(node, pikepdf.Dictionary):
            return results

        tag_name = _clean_str(node.get("/S"))
        # If no /S, it might be StructTreeRoot or a non-element container
        if not tag_name:
            children_k = node.get("/K")
            if children_k is not None:
                return self._parse_pikepdf_tree(
                    children_k,
                    depth + 1,
                    page_map=page_map,
                    parent_tag=parent_tag,
                    parent_id=parent_id,
                )
            return []

        node_id = self._next_id()
        self.tag_counts[tag_name] = self.tag_counts.get(tag_name, 0) + 1

        alt_text = _clean_str(node.get("/Alt"))
        actual_text = _clean_str(node.get("/ActualText"))
        title_text = _clean_str(node.get("/Title")) or _extract_text_from_node(node)
        page_num = self._resolve_node_page(node, page_map)

        attributes: dict[str, Any] = {}
        attrs_obj = node.get("/A")
        if attrs_obj:
            scope = _extract_scope(attrs_obj)
            if scope:
                attributes["scope"] = scope

        # Record headings for hierarchy analysis
        if re.match(r"^H[1-6]$", tag_name, re.IGNORECASE):
            level = int(tag_name[1])
            attributes["level"] = level
            self.headings_sequence.append({
                "node_id": node_id,
                "tag": tag_name,
                "level": level,
                "title": title_text or f"Heading Level {level}",
                "page": page_num or 1,
            })

        # Process children recursively
        children: list[dict[str, Any]] = []
        children_k = node.get("/K")
        if children_k is not None:
            children = self._parse_pikepdf_tree(
                children_k,
                depth + 1,
                page_map=page_map,
                parent_tag=tag_name,
                parent_id=node_id,
            )

        node_data: dict[str, Any] = {
            "id": node_id,
            "tag": tag_name,
            "role": self._map_role(tag_name),
            "parent_tag": parent_tag,
            "parent_id": parent_id,
            "title": title_text or (f"<{tag_name}>" if not children else ""),
            "page": page_num,
            "alt": alt_text or None,
            "actual_text": actual_text or None,
            "attributes": attributes,
            "children": children,
            "children_count": len(children),
            "issues": [],
        }
        results.append(node_data)
        return results

    def _parse_json_structure(self, raw: str | dict) -> list[dict[str, Any]]:
        data = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(data, dict):
            return []

        elements = data.get("elements", [])
        if not isinstance(elements, list):
            return []

        root_children: list[dict[str, Any]] = []
        doc_id = self._next_id()

        for elem in elements:
            if not isinstance(elem, dict):
                continue
            elem_type = str(elem.get("type", "P")).strip()
            level = elem.get("level")
            tag = self._docling_type_to_tag(elem_type, level)
            node_id = self._next_id()
            self.tag_counts[tag] = self.tag_counts.get(tag, 0) + 1

            text = str(elem.get("text", "")).strip()[:120]
            # Page in elements is 0-indexed; present as 1-based to user
            page_val = elem.get("page")
            page_num = (int(page_val) + 1) if isinstance(page_val, int) else 1
            attributes: dict[str, Any] = {}

            if re.match(r"^H[1-6]$", tag):
                h_level = int(tag[1])
                attributes["level"] = h_level
                self.headings_sequence.append({
                    "node_id": node_id,
                    "tag": tag,
                    "level": h_level,
                    "title": text or f"Heading Level {h_level}",
                    "page": page_num,
                })

            root_children.append({
                "id": node_id,
                "tag": tag,
                "role": self._map_role(tag),
                "parent_tag": "Document",
                "parent_id": doc_id,
                "title": text or f"<{tag}>",
                "page": page_num,
                "alt": elem.get("alt_text"),
                "actual_text": None,
                "attributes": attributes,
                "children": [],
                "children_count": 0,
                "issues": [],
            })

        return [{
            "id": doc_id,
            "tag": "Document",
            "role": "document",
            "parent_tag": None,
            "parent_id": None,
            "title": "Document Root",
            "page": 1,
            "alt": None,
            "actual_text": None,
            "attributes": {},
            "children": root_children,
            "children_count": len(root_children),
            "issues": [],
        }]

    def _docling_type_to_tag(self, elem_type: str, level: Any = None) -> str:
        t = elem_type.lower()
        if t in ("heading", "title", "section_header", "h1"):
            if isinstance(level, int) and 1 <= level <= 6:
                return f"H{level}"
            if t == "title":
                return "H1"
            return "H2"
        if t == "h2":
            return "H2"
        if t == "h3":
            return "H3"
        if t == "h4":
            return "H4"
        if t == "h5":
            return "H5"
        if t == "h6":
            return "H6"
        if t == "table":
            return "Table"
        if t in ("list", "ordered_list", "unordered_list"):
            return "L"
        if t in ("list_item", "li"):
            return "LI"
        if t in ("picture", "figure", "image"):
            return "Figure"
        return "P"

    def _map_role(self, tag: str) -> str:
        t = tag.upper()
        if t in ("DOCUMENT", "PART", "SECT", "DIV"):
            return "container"
        if re.match(r"^H[1-6]?$", t):
            return "heading"
        if t in ("P", "SPAN"):
            return "text"
        if t == "TABLE":
            return "table"
        if t in ("THEAD", "TBODY", "TFOOT", "TR"):
            return "table_structure"
        if t == "TH":
            return "table_header"
        if t == "TD":
            return "table_cell"
        if t == "L":
            return "list"
        if t in ("LI", "LBL", "LBODY"):
            return "list_item"
        if t == "FIGURE":
            return "figure"
        if t == "LINK":
            return "link"
        return "content"

    def _validate_heading_hierarchy(self) -> None:
        """Validate WCAG 1.3.1 / PDF/UA-1 heading sequence and semantic depth."""
        if not self.headings_sequence:
            return

        # Check 1: Does document begin with H1?
        first = self.headings_sequence[0]
        if first["level"] > 1:
            self.issues.append({
                "id": "issue-head-0",
                "severity": "error",
                "tag": first["tag"],
                "node_id": first["node_id"],
                "page": first["page"],
                "message": f"First heading is <{first['tag']}> instead of <H1>.",
                "suggestion": "Start headings hierarchy with <H1> as the main document title.",
            })

        # Check 2: Are levels skipped?
        prev_level = first["level"]
        for idx, current in enumerate(self.headings_sequence[1:], start=1):
            curr_level = current["level"]
            if curr_level > prev_level + 1:
                self.issues.append({
                    "id": f"issue-head-{idx}",
                    "severity": "error",
                    "tag": current["tag"],
                    "node_id": current["node_id"],
                    "page": current["page"],
                    "message": f"Heading level skipped: jumped from <H{prev_level}> to <H{curr_level}>.",
                    "suggestion": f"Adjust heading to <H{prev_level + 1}> or insert an intermediate level to maintain hierarchy.",
                })
            prev_level = curr_level

        # Check 3: All-H1 Flat Hierarchy / Lack of Semantic Depth
        if len(self.headings_sequence) >= 3:
            h1_count = sum(1 for h in self.headings_sequence if h["level"] == 1)
            if h1_count == len(self.headings_sequence):
                self.issues.append({
                    "id": "issue-head-flat-all-h1",
                    "severity": "error",
                    "tag": "H1",
                    "node_id": first["node_id"],
                    "page": first["page"],
                    "message": f"All {len(self.headings_sequence)} headings are classified as <H1> with no hierarchical subheadings (H2–H6). Heading structure lacks semantic depth.",
                    "suggestion": "Classify sections, subsections, and subordinate headers according to their semantic depth (H2–H6).",
                })

    def _validate_node_rules(self, nodes: list[dict[str, Any]]) -> None:
        """Recursively validate table, list, figure, and link structural rules."""
        for node in nodes:
            tag = node["tag"]
            children = node.get("children", [])
            node_issues: list[str] = []

            # 1. Table validations
            if tag == "Table":
                all_descendants = self._flatten_descendants(children)
                tags = [d["tag"] for d in all_descendants]
                has_tr = any(t == "TR" for t in tags)
                has_th = any(t == "TH" for t in tags)

                if not has_tr:
                    msg = "Table contains no Table Row (TR) elements."
                    self.issues.append({
                        "id": f"issue-{node['id']}-tr",
                        "severity": "error",
                        "tag": "Table",
                        "node_id": node["id"],
                        "page": node.get("page"),
                        "message": msg,
                        "suggestion": "Structure data into <TR> table rows.",
                    })
                    node_issues.append(msg)

                if not has_th:
                    msg = "Table contains no Table Header (TH) cells."
                    self.issues.append({
                        "id": f"issue-{node['id']}-th",
                        "severity": "error",
                        "tag": "Table",
                        "node_id": node["id"],
                        "page": node.get("page"),
                        "message": msg,
                        "suggestion": "Mark column or row header cells with <TH> tags.",
                    })
                    node_issues.append(msg)

            elif tag == "TH":
                scope = node.get("attributes", {}).get("scope")
                if not scope:
                    msg = "Table Header (TH) is missing Scope attribute (Col or Row)."
                    self.issues.append({
                        "id": f"issue-{node['id']}-scope",
                        "severity": "warning",
                        "tag": "TH",
                        "node_id": node["id"],
                        "page": node.get("page"),
                        "message": msg,
                        "suggestion": "Specify Scope='Col' for column headers or Scope='Row' for row headers.",
                    })
                    node_issues.append(msg)

            # 2. List validations
            elif tag == "L":
                for child in children:
                    if child["tag"] != "LI":
                        msg = f"List (L) contains direct child <{child['tag']}> instead of <LI>."
                        self.issues.append({
                            "id": f"issue-{node['id']}-child",
                            "severity": "error",
                            "tag": "L",
                            "node_id": node["id"],
                            "page": node.get("page"),
                            "message": msg,
                            "suggestion": "Ensure all direct children of <L> are <LI> (List Item) elements.",
                        })
                        node_issues.append(msg)
                        break

            # 3. Figure validations (Strict placeholder & missing alt check)
            elif tag == "Figure":
                alt = node.get("alt")
                actual = node.get("actual_text")
                if not alt and not actual:
                    msg = "Figure is missing alternative text (Alt or ActualText attribute)."
                    self.issues.append({
                        "id": f"issue-{node['id']}-alt",
                        "severity": "error",
                        "tag": "Figure",
                        "node_id": node["id"],
                        "page": node.get("page"),
                        "message": msg,
                        "suggestion": "Provide a descriptive Alt text describing the figure's visual purpose.",
                    })
                    node_issues.append(msg)
                elif alt and (PLACEHOLDER_ALT_PATTERNS.search(alt.strip()) or alt.strip().startswith("[")):
                    msg = f"Figure has unresolved placeholder text '{alt}'. Meaningful manual alternative text is required."
                    self.issues.append({
                        "id": f"issue-{node['id']}-alt-placeholder",
                        "severity": "error",
                        "tag": "Figure",
                        "node_id": node["id"],
                        "page": node.get("page"),
                        "message": msg,
                        "suggestion": "Provide meaningful alternative text describing the figure or flag for manual review.",
                    })
                    node_issues.append(msg)
                elif alt and GENERIC_ALT_TEXT_PATTERNS.match(alt.strip()):
                    msg = f"Alternative text '{alt}' appears to be a generic placeholder or file name."
                    self.issues.append({
                        "id": f"issue-{node['id']}-altgen",
                        "severity": "warning",
                        "tag": "Figure",
                        "node_id": node["id"],
                        "page": node.get("page"),
                        "message": msg,
                        "suggestion": "Replace file names or placeholders with meaningful visual descriptions.",
                    })
                    node_issues.append(msg)

            # 4. Link validations
            elif tag == "Link":
                title = node.get("title", "").strip()
                if not title and not children:
                    msg = "Link tag contains no text or child annotations."
                    self.issues.append({
                        "id": f"issue-{node['id']}-link",
                        "severity": "warning",
                        "tag": "Link",
                        "node_id": node["id"],
                        "page": node.get("page"),
                        "message": msg,
                        "suggestion": "Wrap link around meaningful descriptive text.",
                    })
                    node_issues.append(msg)

            node["issues"] = node_issues

            # Recurse into children
            if children:
                self._validate_node_rules(children)

    def _flatten_descendants(self, nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        flat: list[dict[str, Any]] = []
        for n in nodes:
            flat.append(n)
            children = n.get("children", [])
            if children:
                flat.extend(self._flatten_descendants(children))
        return flat
