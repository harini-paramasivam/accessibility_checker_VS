import json
import sqlite3

JOB_ID = "40a5490c-1a14-47cb-9fb8-63bd48930f09"

conn = sqlite3.connect("/app/data/pdf_accessibility.db")
c = conn.cursor()

c.execute("SELECT id, status, input_path, output_path, validation_json, fidelity_json, structure_json FROM jobs WHERE id = ?", (JOB_ID,))
row = c.fetchone()
if not row:
    print("JOB NOT FOUND")
    exit(1)

print("=== JOB ===")
print("Status:", row[1])
print("Input:", row[2])
print("Output:", row[3])

c.execute("SELECT id, task_type, title, detail, severity, blocking, status, source, metadata_json FROM review_tasks WHERE job_id = ?", (JOB_ID,))
tasks = c.fetchall()
print(f"\n=== REVIEW TASKS ({len(tasks)}) ===")
for t in tasks:
    print(f"- ID={t[0]} Type={t[1]} Blocking={t[5]} Severity={t[4]} Status={t[6]}")
    print(f"  Title: {t[2]}")
    print(f"  Detail: {t[3]}")
    print(f"  Metadata: {t[8]}")

c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in c.fetchall()]
print(f"\n=== TABLES: {tables} ===")
for tname in ["alt_texts", "alt_text_entries", "applied_changes"]:
    if tname in tables:
        c.execute(f"SELECT count(*) FROM {tname} WHERE job_id = ?", (JOB_ID,))
        print(f"Count in {tname}: {c.fetchone()[0]}")


c.execute("SELECT * FROM alt_texts WHERE job_id = ?", (JOB_ID,))
print("\n=== ALT TEXTS ROWS ===")
for r in c.fetchall():
    print(r)

c.execute("SELECT step_name, status, result_json FROM job_steps WHERE job_id = ?", (JOB_ID,))
steps = c.fetchall()
print(f"\n=== JOB STEPS ===")
for s in steps:
    print(f"- {s[0]}: status={s[1]}")
    if s[2]:
        try:
            r = json.loads(s[2])
            print(f"  Result: {r}")
        except Exception:
            print(f"  Result: {s[2][:100]}")

val = json.loads(row[4]) if row[4] else {}
print(f"\n=== VALIDATION JSON ===")
print("Compliant:", val.get("compliant"))
print("Profile:", val.get("profile"))
print("Standard:", val.get("standard"))
print("Summary:", val.get("summary"))

struct = json.loads(row[6]) if row[6] else {}
print(f"\n=== STRUCTURE JSON ===")
print("figures_count:", struct.get("figures_count"))
print("headings_count:", struct.get("headings_count"))
print("lists_count:", struct.get("lists_count"))
print("tables_count:", struct.get("tables_count"))
print("ocr_pages:", struct.get("ocr_pages"))
print("ocr_applied:", struct.get("ocr_applied"))
elements = struct.get("elements", [])
print(f"Total elements: {len(elements)}")
for i, el in enumerate(elements):
    if el.get("type") in ("figure", "table") or el.get("synthetic_figure"):
        print(f"  Element {i}: type={el.get('type')}, page={el.get('page')}, bbox={el.get('bbox')}, alt={el.get('alt_text')}, synth={el.get('synthetic_figure')}")

print("Violations count:", len(val.get("violations", [])))
print("Remediation summary:", val.get("remediation"))

fid = json.loads(row[5]) if row[5] else {}
print(f"\n=== FIDELITY JSON ===")
print("Passed:", fid.get("passed"))
print("Summary:", fid.get("summary"))
print("Checks:")
for ch in fid.get("checks", []):
    print(f"  [{ch.get('status')}] {ch.get('check')}: {ch.get('message')}")
