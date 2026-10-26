import pikepdf
import pypdfium2 as pdfium
from pathlib import Path
import json

in_path = "/app/data/uploads/39b3274f-2d52-45fe-a7c5-da1641ebf2fa.pdf"
out_path = "/app/data/output/40a5490c-1a14-47cb-9fb8-63bd48930f09/accessible_AccessFix_OCR_Test_Scanned_4_Pages.pdf"

print("=== CHECKING INPUT PDF ===")
pdf_in = pdfium.PdfDocument(in_path)
print(f"Input page count: {len(pdf_in)}")
for pno in range(len(pdf_in)):
    page = pdf_in[pno]
    textpage = page.get_textpage()
    text = textpage.get_text_range()
    print(f"Page {pno+1}: text_len={len(text.strip())}")

print("\n=== CHECKING REMEDIATED PDF ===")
pdf_out = pdfium.PdfDocument(out_path)
print(f"Output page count: {len(pdf_out)}")
for pno in range(len(pdf_out)):
    page = pdf_out[pno]
    textpage = page.get_textpage()
    text = textpage.get_text_range()
    print(f"Page {pno+1}: text_len={len(text.strip())}")
    print(f"   Snippet (first 200 chars): {repr(text.strip()[:200])}")

print("\n=== PAGE 2 FULL TEXT ===")
print(pdf_out[1].get_textpage().get_text_range())

print("\n=== PAGE 4 FULL TEXT ===")
print(pdf_out[3].get_textpage().get_text_range())




print("\n=== CHECKING PIKEPDF STRUCTURE TREE ===")
with pikepdf.open(out_path) as p:
    root = p.Root
    print("StructTreeRoot present:", "/StructTreeRoot" in root)
    if "/StructTreeRoot" in root:
        k = root["/StructTreeRoot"].get("/K")
        print("Root /K type:", type(k), "len:", len(k) if isinstance(k, (list, pikepdf.Array)) else 1)
