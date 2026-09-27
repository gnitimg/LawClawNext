import argparse
import json
import logging
import os
import re
import sys
import time
import zlib
from pathlib import Path


TEXT_EXTENSIONS = {".txt", ".md"}
PDF_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | PDF_EXTENSIONS | IMAGE_EXTENSIONS

log = logging.getLogger("lawclaw.pdf_extract")
_OCR_CACHE = {}


def normalize_text(value):
    return re.sub(r"\n{4,}", "\n\n\n", str(value or "").replace("\x00", "")).strip()


def read_text(path):
    for encoding in ("utf-8", "utf-8-sig", "gb18030"):
        try:
            return Path(path).read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return Path(path).read_text(encoding="utf-8", errors="replace")


def decode_pdf_string(value):
    table = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "(": "(", ")": ")", "\\": "\\"}

    def replace_escape(match):
        token = match.group(1)
        return table.get(token, token)

    value = re.sub(r"\\([nrtbf()\\])", replace_escape, value)
    return re.sub(r"\\([0-7]{1,3})", lambda match: chr(int(match.group(1), 8)), value)


def extract_pdf_strings(source):
    parts = []
    for match in re.finditer(r"\((?:\\.|[^\\)])*\)\s*(?:Tj|'|\"|TJ)?", source or ""):
        raw = re.sub(r"\)\s*(?:Tj|'|\"|TJ)?$", "", match.group(0))[1:]
        decoded = decode_pdf_string(raw)
        if re.search(r"[\w\u4e00-\u9fff]", decoded):
            parts.append(decoded)
    return " ".join(parts)


def legacy_extract_pdf_text(path):
    data = Path(path).read_bytes()[:20 * 1024 * 1024]
    source = data.decode("latin1", errors="ignore")
    parts = [extract_pdf_strings(source)]
    for match in re.finditer(r"stream\r?\n([\s\S]*?)\r?\nendstream", source):
        before = source[max(0, match.start() - 400):match.start()]
        stream = match.group(1).encode("latin1", errors="ignore")
        try:
            decoded = zlib.decompress(stream) if "/FlateDecode" in before else stream
            parts.append(extract_pdf_strings(decoded.decode("latin1", errors="ignore")))
        except Exception:
            pass
    return normalize_text("\n".join(part for part in parts if part))


GPU_PROVIDERS = (
    "CUDAExecutionProvider",
    "ROCMExecutionProvider",
    "DmlExecutionProvider",
    "CoreMLExecutionProvider",
)


def detect_onnx_provider(prefer_gpu=False):
    provider = "CPUExecutionProvider"
    available = []
    try:
        import onnxruntime as ort

        available = list(ort.get_available_providers())
        if prefer_gpu:
            provider = next((item for item in GPU_PROVIDERS if item in available), provider)
    except Exception as exc:
        log.info("ONNX Runtime provider detection failed; using CPU: %s", exc)
    status = {
        "available": any(item in available for item in GPU_PROVIDERS),
        "enabled": provider != "CPUExecutionProvider",
        "provider": provider,
        "providers": available,
    }
    log.info("OCR GPU status: available=%s provider=%s", status["available"], status["provider"])
    return status


def build_rapidocr_kwargs(provider, threads):
    gpu = provider in {"CUDAExecutionProvider", "ROCMExecutionProvider"}
    candidates = [
        {"providers": [provider], "num_thread": threads},
        {"num_thread": threads},
        {"providers": [provider]},
        {
            "det_use_cuda": gpu,
            "cls_use_cuda": gpu,
            "rec_use_cuda": gpu,
            "num_thread": threads,
        },
        {},
    ]
    seen = set()
    for item in candidates:
        key = repr(sorted((name, repr(value)) for name, value in item.items()))
        if key in seen:
            continue
        seen.add(key)
        yield item


def get_ocr(threads, require_gpu=False):
    thread_count = max(1, int(threads or 1))
    cache_key = (thread_count, bool(require_gpu))
    if cache_key in _OCR_CACHE:
        return _OCR_CACHE[cache_key]

    from rapidocr_onnxruntime import RapidOCR

    gpu = detect_onnx_provider(prefer_gpu=require_gpu)
    if require_gpu and not gpu["enabled"]:
        raise RuntimeError(
            "GPU OCR is enabled, but ONNX Runtime has no supported GPU provider. "
            "Install the matching GPU runtime or turn off GPU OCR in LawClaw settings."
        )
    provider = gpu["provider"]
    last_error = None
    for kwargs in build_rapidocr_kwargs(provider, thread_count):
        try:
            ocr = RapidOCR(**kwargs)
            _OCR_CACHE[cache_key] = (ocr, gpu)
            log.info("RapidOCR initialized with args=%s", kwargs)
            return _OCR_CACHE[cache_key]
        except TypeError as exc:
            last_error = exc
            continue
    if last_error:
        raise last_error
    ocr = RapidOCR()
    _OCR_CACHE[cache_key] = (ocr, gpu)
    return _OCR_CACHE[cache_key]


def rapidocr_result_text(raw_result):
    result = raw_result[0] if isinstance(raw_result, tuple) else raw_result
    lines = []
    for item in result or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2 and item[1]:
            lines.append(str(item[1]))
    return normalize_text("\n".join(lines))


def ocr_image_bytes(image_bytes, threads, require_gpu=False):
    ocr, gpu = get_ocr(threads, require_gpu=require_gpu)
    return rapidocr_result_text(ocr(image_bytes)), gpu


def extract_image_text(path, threads, require_gpu=False):
    return ocr_image_bytes(Path(path).read_bytes(), threads, require_gpu=require_gpu)


def extract_pdf_text(path, dpi, threads, require_gpu=False):
    try:
        import fitz
    except Exception as exc:
        log.info("PyMuPDF unavailable; using legacy PDF text extraction: %s", exc)
        return legacy_extract_pdf_text(path), detect_onnx_provider(prefer_gpu=require_gpu)

    text_parts = []
    gpu = None
    with fitz.open(path) as doc:
        total = len(doc)
        for index, page in enumerate(doc, start=1):
            text = normalize_text(page.get_text())
            if text and len(text) > 20:
                text_parts.append(text)
            else:
                pix = page.get_pixmap(dpi=dpi)
                image_bytes = pix.tobytes("png")
                ocr_text, gpu = ocr_image_bytes(image_bytes, threads, require_gpu=require_gpu)
                if ocr_text:
                    text_parts.append(ocr_text)
            if index == total or index % 10 == 0:
                log.info("OCR 进度: %s/%s 页", index, total)
    if gpu is None:
        gpu = detect_onnx_provider(prefer_gpu=require_gpu)
    return normalize_text("\n\n".join(text_parts)), gpu


def output_path_for(input_dir, output_dir, file_path):
    rel = Path(file_path).relative_to(input_dir)
    return Path(output_dir) / rel.with_suffix(".txt")


def extract_file(input_dir, output_dir, file_path, dpi, threads, require_gpu=False):
    suffix = Path(file_path).suffix.lower()
    if suffix in TEXT_EXTENSIONS:
        text = normalize_text(read_text(file_path))
        gpu = detect_onnx_provider(prefer_gpu=require_gpu)
    elif suffix in PDF_EXTENSIONS:
        text, gpu = extract_pdf_text(file_path, dpi, threads, require_gpu=require_gpu)
    elif suffix in IMAGE_EXTENSIONS:
        text, gpu = extract_image_text(file_path, threads, require_gpu=require_gpu)
    else:
        return None

    out_path = output_path_for(input_dir, output_dir, file_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8")
    return {
        "input": str(file_path),
        "output": str(out_path),
        "textLength": len(text),
        "gpu": gpu,
    }


def iter_input_files(input_dir):
    for item in sorted(Path(input_dir).rglob("*")):
        if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield item


def apply_memory_limit(memory_limit_mb):
    if not memory_limit_mb or memory_limit_mb <= 0:
        return False


def load_runtime_config():
    path = os.environ.get("LAWCLAW_OCR_CONFIG", "").strip()
    if not path:
        return {}
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception as exc:
        log.warning("Unable to read OCR runtime config %s: %s", path, exc)
        return {}


def current_rss_mb():
    try:
        import psutil

        return round(psutil.Process().memory_info().rss / 1024 / 1024, 1)
    except Exception:
        return 0.0


def benchmark_file(path, dpi, threads, max_pages, require_gpu):
    try:
        import fitz
    except Exception as exc:
        raise RuntimeError("PyMuPDF is required for the local OCR benchmark") from exc

    timings = []
    peak_mb = current_rss_mb()
    gpu = None
    with fitz.open(path) as doc:
        page_total = len(doc)
        pages = min(max(1, int(max_pages or 1)), page_total)
        for index in range(pages):
            started = time.perf_counter()
            pix = doc[index].get_pixmap(dpi=dpi)
            _, gpu = ocr_image_bytes(pix.tobytes("png"), threads, require_gpu=require_gpu)
            timings.append(time.perf_counter() - started)
            peak_mb = max(peak_mb, current_rss_mb())
    total_seconds = sum(timings)
    return {
        "pages": len(timings),
        "sourcePages": page_total,
        "seconds": round(total_seconds, 3),
        "secondsPerPage": round(total_seconds / max(1, len(timings)), 3),
        "peakMemoryMb": peak_mb,
        "gpu": gpu or detect_onnx_provider(prefer_gpu=require_gpu),
    }
    try:
        import resource

        limit = int(memory_limit_mb) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
        log.info("OCR memory limit applied: %s MB", memory_limit_mb)
        return True
    except Exception as exc:
        log.info("OCR memory limit not applied: %s", exc)
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir")
    parser.add_argument("--output-dir")
    parser.add_argument("--benchmark-file")
    parser.add_argument("--benchmark-pages", type=int, default=6)
    parser.add_argument("--gpu", action="store_true", help="Require a supported ONNX GPU execution provider")
    parser.add_argument("--cpu", action="store_true", help="Force CPU OCR")
    parser.add_argument("--threads", "--ocr-threads", dest="threads", type=int)
    parser.add_argument("--dpi", "--ocr-dpi", dest="dpi", type=int)
    parser.add_argument("--memory-limit-mb", "--ocr-memory-mb", dest="memory_limit_mb", type=int)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stderr)
    runtime = load_runtime_config()
    require_gpu = bool(args.gpu or (not args.cpu and runtime.get("gpuEnabled", False)))
    threads = max(1, min(64, int(args.threads or runtime.get("threads", 4))))
    dpi = max(72, min(600, int(args.dpi or runtime.get("dpi", 150))))
    memory_limit_mb = max(0, int(args.memory_limit_mb if args.memory_limit_mb is not None else runtime.get("memoryLimitMb", 0)))
    memory_limit_applied = apply_memory_limit(memory_limit_mb)

    if args.benchmark_file:
        result = benchmark_file(args.benchmark_file, dpi, threads, args.benchmark_pages, require_gpu)
        result["settings"] = {
            "threads": threads,
            "dpi": dpi,
            "gpuEnabled": require_gpu,
            "memoryLimitMb": memory_limit_mb,
            "memoryLimitApplied": memory_limit_applied,
        }
        print(json.dumps(result, ensure_ascii=False))
        return

    if not args.input_dir or not args.output_dir:
        parser.error("--input-dir and --output-dir are required unless --benchmark-file is used")
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "files": [],
        "settings": {
            "threads": threads,
            "dpi": dpi,
            "memoryLimitMb": memory_limit_mb,
            "memoryLimitApplied": memory_limit_applied,
            "gpuEnabled": require_gpu,
        },
        "gpu": detect_onnx_provider(prefer_gpu=require_gpu),
    }

    for file_path in iter_input_files(input_dir):
        try:
            result = extract_file(input_dir, output_dir, file_path, dpi, threads, require_gpu=require_gpu)
            if result:
                summary["files"].append(result)
                summary["gpu"] = result.get("gpu") or summary["gpu"]
        except Exception as exc:
            log.exception("Failed to extract %s: %s", file_path, exc)
            summary["files"].append({
                "input": str(file_path),
                "error": str(exc),
                "textLength": 0,
            })

    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
