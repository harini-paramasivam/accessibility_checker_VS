"""Step 2: OCR scanned PDFs using OCRmyPDF and Tesseract verification."""

import asyncio
import logging
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from app.config import get_settings
from app.pipeline.subprocess_utils import (
    SubprocessTimeout,
    communicate_with_timeout,
    subprocess_process_group_kwargs,
)
from app.services.runtime_paths import enriched_subprocess_env, resolve_binary

logger = logging.getLogger(__name__)


@dataclass
class OcrResult:
    success: bool
    output_path: Path
    status: str = "completed"  # "completed", "partially_completed", "skipped", "failed", "needs_review"
    skipped: bool = False
    message: str = ""
    reason: str = ""
    pages_processed: list[int] = field(default_factory=list)
    pages_skipped: list[int] = field(default_factory=list)
    pages_failed: list[int] = field(default_factory=list)
    engine_error: str | None = None


def verify_ocr_engine(language: str | None = None) -> tuple[bool, str]:
    """Verify that Tesseract executable and requested language data are available."""
    settings = get_settings()
    binary = resolve_binary("tesseract", explicit=settings.tesseract_path)
    if not binary:
        msg = (
            f"Tesseract executable '{settings.tesseract_path}' not found in PATH or configured directories. "
            "Please install tesseract-ocr and required language packs or configure TESSERACT_PATH."
        )
        logger.error(msg)
        return False, msg

    candidate_path = Path(binary)
    if not candidate_path.exists():
        msg = f"Configured Tesseract executable does not exist at '{binary}'."
        logger.error(msg)
        return False, msg

    env = enriched_subprocess_env()
    try:
        proc = subprocess.run(
            [binary, "--version"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
            env=env,
        )
        if proc.returncode != 0:
            err = proc.stderr.strip() or proc.stdout.strip()
            msg = f"Tesseract executable check failed with exit code {proc.returncode}: {err}"
            logger.error(msg)
            return False, msg
    except Exception as exc:
        msg = f"Failed to execute Tesseract ({binary}): {exc}"
        logger.error(msg)
        return False, msg

    if language:
        try:
            proc = subprocess.run(
                [binary, "--list-langs"],
                capture_output=True,
                text=True,
                check=False,
                timeout=10,
                env=env,
            )
            if proc.returncode == 0:
                installed = {line.strip() for line in proc.stdout.splitlines() if line.strip()}
                requested = [l.strip() for l in language.split("+") if l.strip()]
                missing = [l for l in requested if l not in installed]
                if missing:
                    msg = (
                        f"Tesseract is missing required language pack(s): {', '.join(missing)}. "
                        f"Installed: {', '.join(sorted(installed)) or 'none'}."
                    )
                    logger.error(msg)
                    return False, msg
        except Exception as exc:
            logger.warning("Could not list Tesseract installed languages: %s", exc)

    return True, "Tesseract OCR engine is verified and available."


def _build_ocrmypdf_args(
    *,
    input_path: Path,
    output_path: Path,
    language: str,
    mode: str,
    rotate_pages: bool,
    deskew: bool,
    pages: list[int] | str | None = None,
    jobs: int | None = None,
    max_image_mpixels: int | None = None,
) -> list[str]:
    settings = get_settings()
    try:
        resolved_jobs = int(jobs if jobs is not None else settings.ocrmypdf_jobs)
    except (TypeError, ValueError):
        resolved_jobs = 1
    try:
        resolved_max_image_mpixels = int(
            max_image_mpixels
            if max_image_mpixels is not None
            else settings.ocrmypdf_max_image_mpixels
        )
    except (TypeError, ValueError):
        resolved_max_image_mpixels = 75

    args = [
        sys.executable,
        "-m",
        "ocrmypdf",
        "--language",
        language,
        "--output-type",
        "pdf",
        "--jobs",
        str(max(1, resolved_jobs)),
        # Keep Pillow's decompression guard low enough that high-DPI scans fail
        # cleanly instead of expanding until the app/container is killed.
        "--max-image-mpixels",
        str(max(1, resolved_max_image_mpixels)),
    ]

    # Selective page OCR
    if pages:
        if isinstance(pages, list):
            pages_arg = ",".join(str(p) for p in sorted(pages))
        else:
            pages_arg = str(pages).strip()
        if pages_arg:
            args.extend(["--pages", pages_arg])

    if mode == "redo":
        if rotate_pages:
            args.append("--rotate-pages")
        args.append("--redo-ocr")
    elif mode == "force":
        if rotate_pages:
            args.append("--rotate-pages")
        if deskew:
            args.append("--deskew")
        args.append("--force-ocr")
    else:
        # Default behavior for the primary OCR step.
        if rotate_pages:
            args.append("--rotate-pages")
        if deskew:
            args.append("--deskew")
        args.append("--skip-text")

    args.extend([str(input_path), str(output_path)])
    return args


async def run_ocr(
    input_path: Path,
    output_path: Path,
    language: str = "eng",
    mode: str = "skip",
    *,
    pages: list[int] | str | None = None,
    rotate_pages: bool = True,
    deskew: bool = True,
    timeout_seconds: int | None = None,
    jobs: int | None = None,
    max_image_mpixels: int | None = None,
) -> OcrResult:
    """Run OCRmyPDF as a subprocess to add or repair text layers on scanned/unreliable pages.

    Validates Tesseract readiness beforehand, supports selective page OCR,
    and returns rich outcome information.
    """
    logger.info(
        f"Running OCR on {input_path.name} (language={language}, pages={pages}, mode={mode})"
    )

    # 1. Verify OCR engine dependencies first
    is_ready, engine_msg = verify_ocr_engine(language)
    if not is_ready:
        return OcrResult(
            success=False,
            output_path=input_path,
            status="failed",
            message=engine_msg,
            reason=engine_msg,
            engine_error=engine_msg,
            pages_failed=pages if isinstance(pages, list) else [],
        )

    args = _build_ocrmypdf_args(
        input_path=input_path,
        output_path=output_path,
        language=language,
        mode=mode,
        rotate_pages=rotate_pages,
        deskew=deskew,
        pages=pages,
        jobs=jobs,
        max_image_mpixels=max_image_mpixels,
    )

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=enriched_subprocess_env(),
        **subprocess_process_group_kwargs(),
    )
    try:
        stdout, stderr = await communicate_with_timeout(proc, timeout_seconds)
    except SubprocessTimeout:
        msg = f"OCR timed out after {timeout_seconds}s"
        logger.error(msg)
        return OcrResult(
            success=False,
            output_path=input_path,
            status="failed",
            message=msg,
            reason=msg,
            engine_error=msg,
            pages_failed=pages if isinstance(pages, list) else [],
        )

    stderr_text = stderr.decode("utf-8", errors="replace").strip()
    stdout_text = stdout.decode("utf-8", errors="replace").strip()

    target_page_list = pages if isinstance(pages, list) else []

    if proc.returncode == 0:
        logger.info(f"OCR complete: {output_path.name}")
        return OcrResult(
            success=True,
            output_path=output_path,
            status="completed",
            skipped=False,
            message=f"OCR completed successfully on {output_path.name}",
            reason="OCR completed successfully on all targeted pages.",
            pages_processed=target_page_list,
        )
    elif proc.returncode == 6 and mode == "skip":
        # Exit code 6 = "file already has text" — OCRmyPDF skipped because text was found
        logger.info(f"OCR skipped (already has text): {input_path.name}")
        return OcrResult(
            success=True,
            output_path=input_path,
            status="skipped",
            skipped=True,
            message="File already contains text",
            reason="OCR skipped because all requested pages already contain existing text.",
            pages_skipped=target_page_list,
        )
    else:
        err_msg = stderr_text or stdout_text or f"Process exited with code {proc.returncode}"
        msg = f"OCR failed (exit {proc.returncode}): {err_msg}"
        logger.error(msg)
        return OcrResult(
            success=False,
            output_path=input_path,
            status="failed",
            message=msg,
            reason=msg,
            engine_error=err_msg,
            pages_failed=target_page_list,
        )
