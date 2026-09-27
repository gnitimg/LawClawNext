import os

# 设置NVIDIA CUDA库路径，使ONNX Runtime能找到GPU加速库
_nvidia_lib_paths = [
    os.path.expanduser('~/.local/lib/python3.12/site-packages/nvidia/cublas/lib'),
    os.path.expanduser('~/.local/lib/python3.12/site-packages/nvidia/cudnn/lib'),
    os.path.expanduser('~/.local/lib/python3.12/site-packages/nvidia/cufft/lib'),
    os.path.expanduser('~/.local/lib/python3.12/site-packages/nvidia/curand/lib'),
    os.path.expanduser('~/.local/lib/python3.12/site-packages/nvidia/cuda_runtime/lib'),
    os.path.expanduser('~/.local/lib/python3.12/site-packages/nvidia/cuda_nvrtc/lib'),
    os.path.expanduser('~/.local/lib/python3.12/site-packages/nvidia/nvjitlink/lib'),
]
_current_ld_path = os.environ.get('LD_LIBRARY_PATH', '')
os.environ['LD_LIBRARY_PATH'] = ':'.join(_nvidia_lib_paths + ([_current_ld_path] if _current_ld_path else []))

import argparse
import base64
import concurrent.futures
import hashlib
import html
import json
import re
import secrets
import shutil
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except Exception:
    AESGCM = None

ID_CARD_PATTERN = re.compile(r"[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]")
BANK_CARD_PATTERN = re.compile(r"(?:\d[ -]?){13,19}")
TOKEN_PATTERN = re.compile(r"<(?:ID_CARD|BANK_CARD|ADDRESS|PHONE|EMAIL|NAME)_[a-f0-9]{8}>")
ADDRESS_TRIGGERS = [
    "户籍地址", "户籍地", "现居住地", "现住址", "居住地", "家庭住址",
    "通讯地址", "联系地址", "住所地", "住址", "地址", "暂住地",
    "出生地", "籍贯"
]
ADDRESS_KEYWORDS = [
    "省", "市", "自治区", "自治州", "县", "区", "镇", "乡", "街道",
    "村", "组", "路", "街", "巷", "号", "栋", "幢", "单元", "室",
    "小区", "社区", "院", "楼", "广场", "大厦", "公寓", "开发区", "高新区"
]
ADDRESS_END_CHARS = set(["，", "。", "；", "\n", "\r", "、"])
TYPE_PRIORITY = {"ID_CARD": 3, "BANK_CARD": 2, "ADDRESS": 1}
TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".log"}
BINARY_TEXT_EXTENSIONS = {".docx", ".pdf"}
PASSTHROUGH_EXTENSIONS = {".doc", ".wps", ".xls", ".xlsx", ".png", ".jpg", ".jpeg"}
PROCESSABLE_EXTENSIONS = TEXT_EXTENSIONS | BINARY_TEXT_EXTENSIONS | PASSTHROUGH_EXTENSIONS
KDF_ITERATIONS = 200000
MAPPING_ALGORITHM = "AES-256-GCM"
SCANNED_PDF_MARKER = "[扫描件] 此文件为图片PDF，OCR未能提取文字。请检查OCR配置或手动提供文本。"


def _get_configured_timezone():
    """从 lawclaw-config.json 读取用户设定的时区"""
    import json as _json
    config_paths = [
        os.path.expanduser('~/.openclaw/lawclaw-config.json'),
        os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming', 'lawclaw', 'lawclaw-config.json'),
    ]
    for config_path in config_paths:
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    data = _json.load(f)
                tz_settings = data.get('timezone', {})
                if tz_settings.get('autoDetect', True):
                    return None  # 使用系统时区
                configured = tz_settings.get('timezone', '')
                if configured:
                    # 验证时区是否有效
                    try:
                        datetime.now(timezone.utc).astimezone()
                        from zoneinfo import ZoneInfo
                        datetime.now(ZoneInfo(configured))
                        return configured
                    except Exception:
                        pass
        except Exception:
            pass
    return None  # 回退到系统时区


def now_iso():
    configured_tz = _get_configured_timezone()
    if configured_tz:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(configured_tz)).isoformat()
    return datetime.now(timezone.utc).astimezone().isoformat()


def b64e(data):
    return base64.b64encode(data).decode("ascii")


def read_text(path):
    for enc in ["utf-8", "utf-8-sig", "gb18030"]:
        try:
            return Path(path).read_text(encoding=enc), enc
        except UnicodeDecodeError:
            pass
    return Path(path).read_text(encoding="utf-8", errors="replace"), "utf-8-replace"


def write_text(path, text):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text, encoding="utf-8")


def is_garbage_text(text):
    """检测提取的文本是否为垃圾（PDF 结构数据、二进制乱码等）。"""
    if not text or len(text) < 20:
        return False
    import re as _re
    if _re.search(r"(?:\xff[\xd8\xd9\xdb\xc0-\xcf]|JFIF|Exif|\b(?:IDAT|IEND|IHDR)\b)", text):
        return True
    compact = _re.sub(r"\s+", "", text)
    if len(compact) > 80:
        total = len(compact) or 1
        control_chars = len(_re.findall(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", compact))
        replacement_chars = compact.count("\ufffd")
        extended_latin = len(_re.findall(r"[\xa0-\xff]", compact))
        cjk_chars = len(_re.findall(r"[\u4e00-\u9fff]", compact))
        readable_chars = len(_re.findall(r"[A-Za-z0-9\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]", compact))
        common_punctuation = len(_re.findall(r"""[.,;:!?'"\[\](){}<>/@#$%^&*_+=|\\~-]""", compact))
        if control_chars / total > 0.02:
            return True
        if replacement_chars / total > 0.01:
            return True
        if extended_latin / total > 0.12 and cjk_chars / total < 0.02:
            return True
        if (readable_chars + common_punctuation) / total < 0.55:
            return True
    pdf_struct_re = _re.compile(
        r"(?:endstream|endobj|obj\s|startxref|%%EOF|BaseFont|Type0|Identity-H|ToUnicode|FlateDecode|FontDescriptor)",
        _re.IGNORECASE,
    )
    pdf_matches = len(pdf_struct_re.findall(text))
    word_count = len(text.split()) or 1
    if pdf_matches / word_count > 0.05:
        return True
    chinese_chars = len(_re.findall(r"[\u4e00-\u9fff]", text))
    total_chars = len(text.replace(" ", "")) or 1
    # 中文法律文档：零中文字符 = 二进制数据，一定是垃圾
    if chinese_chars == 0 and total_chars > 100:
        return True
    if chinese_chars / total_chars < 0.02:
        readable_chars = len(_re.findall(r"[\w\u4e00-\u9fff]", text))
        if readable_chars / total_chars < 0.3:
            return True
    return False


def normalize_extracted_text(text):
    return re.sub(r"\n{4,}", "\n\n\n", str(text or "").replace("\x00", "")).strip()


def docx_xml_to_text(xml):
    text = html.unescape(str(xml or ""))
    text = re.sub(r"<w:tab\s*/>", "\t", text)
    text = re.sub(r"</w:p>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return normalize_extracted_text(text)


def extract_docx_text(path):
    parts = []
    with zipfile.ZipFile(path) as archive:
        for name in ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]:
            try:
                parts.append(docx_xml_to_text(archive.read(name).decode("utf-8", errors="ignore")))
            except KeyError:
                pass
    return normalize_extracted_text("\n\n".join(part for part in parts if part))


def decode_pdf_string(value):
    def replace_escape(match):
        token = match.group(1)
        table = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "(": "(", ")": ")", "\\": "\\"}
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


# OCR 配置（可通过命令行参数覆盖）
_ocr_config = {
    'dpi': 150,
    'max_threads': None,  # None = 自动检测
    'max_memory_mb': None,  # None = 不限制
}


def load_ocr_config_from_file():
    """从 lawclaw.json 读取 OCR 配置"""
    import json
    config_paths = [
        os.path.expanduser('~/.openclaw/workspace-lawyer/lawclaw.json'),
        os.path.join(os.path.dirname(__file__), '..', '..', 'lawclaw.json'),
    ]
    for config_path in config_paths:
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                ocr_svc = data.get('ocrService', {})
                if ocr_svc.get('mode') == 'local':
                    local_cfg = ocr_svc.get('local', {})
                    if local_cfg.get('dpi'):
                        _ocr_config['dpi'] = int(local_cfg['dpi'])
                    if local_cfg.get('configMode') == 'manual':
                        if local_cfg.get('threads'):
                            _ocr_config['max_threads'] = int(local_cfg['threads'])
                    if local_cfg.get('memoryLimitMb'):
                        _ocr_config['max_memory_mb'] = int(local_cfg['memoryLimitMb'])
                return
            except Exception:
                pass


def _detect_gpu():
    """检测是否有可用GPU"""
    gpu_name = None
    gpu_vram_mb = 0
    try:
        import subprocess
        nvidia_smi = 'nvidia-smi'
        for p in ['/usr/lib/wsl/lib/nvidia-smi', '/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi']:
            if os.path.exists(p):
                nvidia_smi = p
                break
        result = subprocess.run(
            [nvidia_smi, '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(', ')
            gpu_name = parts[0].strip()
            gpu_vram_mb = int(parts[1].strip())
    except Exception:
        pass
    try:
        import onnxruntime as ort
        has_cuda = 'CUDAExecutionProvider' in ort.get_available_providers()
        if has_cuda and gpu_name:
            return True, gpu_name, gpu_vram_mb
        elif has_cuda:
            return True, 'Unknown GPU', 0
    except Exception:
        pass
    if gpu_name:
        return False, gpu_name + ' (not usable by ONNX Runtime)', gpu_vram_mb
    return False, None, 0


def _get_available_memory_mb():
    try:
        import psutil
        return int(psutil.virtual_memory().available / (1024 * 1024))
    except ImportError:
        return 8192


def get_resource_limits():
    """根据硬件和用户配置计算资源限制"""
    cpu_count = os.cpu_count() or 2
    avail_mem_mb = _get_available_memory_mb()
    gpu_available, gpu_name, gpu_vram_mb = _detect_gpu()
    if _ocr_config['max_threads']:
        total_thread_budget = max(1, int(_ocr_config['max_threads']))
        ocr_threads = 1
    elif gpu_available:
        total_thread_budget = max(1, cpu_count)
        ocr_threads = max(2, min(4, cpu_count // 2))
    else:
        total_thread_budget = max(1, cpu_count)
        ocr_threads = max(2, min(6, cpu_count // 2))
    if _ocr_config['max_memory_mb']:
        total_mem_budget = _ocr_config['max_memory_mb']
    else:
        total_mem_budget = int(avail_mem_mb * 0.7)
    mem_per_worker = 400
    max_workers_by_mem = max(1, total_mem_budget // mem_per_worker)
    max_workers_by_cpu = max(1, total_thread_budget // max(1, ocr_threads))
    max_workers = min(max_workers_by_mem, max_workers_by_cpu)
    max_workers = max(1, min(max_workers, 12))
    if _ocr_config['max_threads']:
        max_workers = max(1, min(max_workers, total_thread_budget))
        ocr_threads = max(1, total_thread_budget // max_workers)
    total_threads = max_workers * ocr_threads
    thread_ceiling = total_thread_budget if _ocr_config['max_threads'] else cpu_count
    if total_threads > thread_ceiling:
        ocr_threads = max(1, thread_ceiling // max_workers)
    return {
        'max_workers': max_workers, 'ocr_threads': ocr_threads,
        'max_memory_mb': total_mem_budget, 'gpu_available': gpu_available,
        'gpu_name': gpu_name, 'cpu_count': cpu_count, 'avail_memory_mb': avail_mem_mb,
    }


def get_ocr_thread_count():
    """自动检测合适的 OCR 线程数。"""
    import os
    import multiprocessing
    if _ocr_config['max_threads']:
        return max(1, _ocr_config['max_threads'])
    cores = multiprocessing.cpu_count()
    # 策略：核心数//4，最少 2，最多 6
    recommended = max(2, min(6, cores // 4))
    # 检查可用内存
    try:
        import psutil
        avail_mb = psutil.virtual_memory().available / (1024 * 1024)
        if avail_mb < 4096:
            recommended = max(2, recommended // 2)
    except ImportError:
        pass
    return recommended


def _ocr_worker(args):
    """OCR 工作进程：对单个页面进行识别。"""
    import fitz
    from rapidocr_onnxruntime import RapidOCR
    pdf_path, page_idx, dpi = args
    ocr = RapidOCR()
    doc = fitz.open(pdf_path)
    page = doc[page_idx]
    pix = page.get_pixmap(dpi=dpi)
    img_bytes = pix.tobytes("png")
    result, _ = ocr(img_bytes)
    doc.close()
    if result:
        return page_idx, "\n".join([line[1] for line in result if line[1]])
    return page_idx, ""


def extract_pdf_text(path):
    """提取 PDF 文本：PyMuPDF 文字型 + RapidOCR 扫描型（多线程）。"""
    try:
        import fitz
        doc = fitz.open(path)
        # 第一步：PyMuPDF 提取文字型页面
        text_parts = []
        scanned_pages = []
        for i, page in enumerate(doc):
            text = page.get_text().strip()
            if text and len(text) > 20:
                text_parts.append(text)
            else:
                scanned_pages.append(i)
        doc.close()
        # 第二步：扫描型页面用 RapidOCR（多线程）
        if scanned_pages:
            try:
                from concurrent.futures import ProcessPoolExecutor
                dpi = _ocr_config['dpi']
                thread_count = get_ocr_thread_count()
                tasks = [(path, idx, dpi) for idx in scanned_pages]
                with ProcessPoolExecutor(max_workers=thread_count) as executor:
                    results = list(executor.map(_ocr_worker, tasks))
                for _, ocr_text in sorted(results):
                    if ocr_text.strip():
                        text_parts.append(ocr_text.strip())
            except ImportError:
                # 降级：单线程
                try:
                    from rapidocr_onnxruntime import RapidOCR
                    ocr = RapidOCR()
                    doc = fitz.open(path)
                    for page_idx in scanned_pages:
                        page = doc[page_idx]
                        pix = page.get_pixmap(dpi=_ocr_config['dpi'])
                        img_bytes = pix.tobytes("png")
                        result, _ = ocr(img_bytes)
                        if result:
                            ocr_text = "\n".join([line[1] for line in result])
                            if ocr_text.strip():
                                text_parts.append(ocr_text.strip())
                    doc.close()
                except Exception:
                    pass
            except Exception:
                pass
        if text_parts:
            return "\n\n".join(text_parts)
        if scanned_pages:
            return ""
    except ImportError:
        pass
    except Exception:
        pass
    # 降级：原有正则提取（仅在 PyMuPDF 不可用时使用）
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
    return normalize_extracted_text("\n".join(part for part in parts if part))


def extract_binary_text(path):
    suffix = Path(path).suffix.lower()
    if suffix == ".docx":
        return extract_docx_text(path)
    if suffix == ".pdf":
        return extract_pdf_text(path)
    return ""


def redacted_text_relpath(rel):
    """将文件路径扩展名改为.txt，如 xxx.pdf → xxx.txt（而非 xxx.pdf.txt）"""
    p = Path(str(rel))
    return p.with_suffix(".txt")


def resolve_output_layout(output_dir):
    package_root = Path(output_dir)
    if package_root.name == ".lawclaw":
        return package_root, package_root / "privacy"
    return package_root.parent if package_root.name == "privacy" else package_root, package_root


def is_valid_date(value):
    try:
        datetime.strptime(value, "%Y%m%d")
        return True
    except ValueError:
        return False


def is_valid_id_card(value):
    value = value.upper()
    if not ID_CARD_PATTERN.fullmatch(value):
        return False
    if not is_valid_date(value[6:14]):
        return False
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
    check_map = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"]
    total = sum(int(value[i]) * weights[i] for i in range(17))
    return value[-1] == check_map[total % 11]


def normalize_card(value):
    return re.sub(r"[^0-9]", "", value)


def luhn_check(value):
    if not value.isdigit():
        return False
    total = 0
    for index, char in enumerate(value[::-1]):
        digit = int(char)
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def card_type(value):
    length = len(value)
    if value.startswith("62") and 16 <= length <= 19:
        return "UnionPay"
    if value.startswith("4") and length in [13, 16, 19]:
        return "Visa"
    if length == 16:
        prefix2 = int(value[:2])
        prefix4 = int(value[:4])
        if 51 <= prefix2 <= 55 or 2221 <= prefix4 <= 2720:
            return "MasterCard"
    if length == 15 and value[:2] in ["34", "37"]:
        return "AmericanExpress"
    if 16 <= length <= 19 and 3528 <= int(value[:4]) <= 3589:
        return "JCB"
    return "UnknownCard" if 13 <= length <= 19 else None


def find_id_cards(text):
    out = []
    for match in ID_CARD_PATTERN.finditer(text):
        raw = match.group()
        if is_valid_id_card(raw):
            out.append({"type": "ID_CARD", "raw": raw, "start": match.start(), "end": match.end(), "confidence": 98})
    return out


def find_bank_cards(text):
    out = []
    for match in BANK_CARD_PATTERN.finditer(text):
        raw = match.group()
        normalized = normalize_card(raw)
        if not 13 <= len(normalized) <= 19:
            continue
        if not luhn_check(normalized):
            continue
        subtype = card_type(normalized)
        if subtype is None:
            continue
        out.append({"type": "BANK_CARD", "subtype": subtype, "raw": raw, "normalized": normalized, "start": match.start(), "end": match.end(), "confidence": 90})
    return out


def find_addresses_by_trigger(text):
    out = []
    for trigger in ADDRESS_TRIGGERS:
        pos = 0
        while True:
            idx = text.find(trigger, pos)
            if idx == -1:
                break
            value_start = idx + len(trigger)
            while value_start < len(text) and text[value_start] in [":", "：", " ", "\t"]:
                value_start += 1
            value_end = value_start
            while value_end < len(text) and text[value_end] not in ADDRESS_END_CHARS:
                value_end += 1
            segment = text[value_start:value_end]
            raw = segment.strip()
            left_trim = len(segment) - len(segment.lstrip())
            right_trim = len(segment.rstrip())
            start = value_start + left_trim
            end = value_start + right_trim
            if 2 <= len(raw) <= 80 and any(k in raw for k in ADDRESS_KEYWORDS):
                out.append({"type": "ADDRESS", "raw": raw, "start": start, "end": end, "confidence": 82, "source": "trigger"})
            pos = idx + len(trigger)
    return out


def find_addresses_by_pattern(text):
    pattern = re.compile(r"[\u4e00-\u9fa5A-Za-z0-9]{2,30}(?:省|市|区|县|镇|乡|街道|村|路|街|巷|小区|社区|号|栋|幢|单元|室)[\u4e00-\u9fa5A-Za-z0-9号栋幢单元室楼层\-]{0,40}")
    out = []
    for match in pattern.finditer(text):
        raw = match.group()
        if len(raw) >= 4 and any(k in raw for k in ADDRESS_KEYWORDS):
            out.append({"type": "ADDRESS", "raw": raw, "start": match.start(), "end": match.end(), "confidence": 65, "source": "pattern"})
    return out


def merge_overlaps(items):
    items = sorted(items, key=lambda x: (x["start"], -TYPE_PRIORITY.get(x["type"], 0), -x.get("confidence", 0)))
    merged = []
    for item in items:
        if not merged or item["start"] >= merged[-1]["end"]:
            merged.append(item)
            continue
        last = merged[-1]
        ip = TYPE_PRIORITY.get(item["type"], 0)
        lp = TYPE_PRIORITY.get(last["type"], 0)
        if ip > lp or (ip == lp and item.get("confidence", 0) > last.get("confidence", 0)):
            merged[-1] = item
    return merged


def detect(text):
    items = []
    items.extend(find_id_cards(text))
    items.extend(find_bank_cards(text))
    items.extend(find_addresses_by_trigger(text))
    items.extend(find_addresses_by_pattern(text))
    return merge_overlaps(items)


def make_token(raw, item_type, case_id, used):
    while True:
        prefix = raw[:6]
        suffix = raw[-6:] if len(raw) >= 6 else raw
        noise = case_id + secrets.token_hex(16)
        middle = (prefix + noise + suffix)[:32].ljust(32, "X")
        digest = hashlib.sha256(middle.encode("utf-8")).hexdigest()[:8]
        token = f"<{item_type}_{digest}>"
        if token not in used:
            used.add(token)
            return token, digest


def replace_back(text, items):
    result = text
    for item in sorted(items, key=lambda x: x["start"], reverse=True):
        result = result[:item["start"]] + item["token"] + result[item["end"]:]
    return result


def derive_key_from_recovery_key(recovery_key, salt, dklen=32):
    return hashlib.pbkdf2_hmac("sha256", recovery_key.encode("utf-8"), salt, KDF_ITERATIONS, dklen=dklen)


def aes_gcm_encrypt(key, plaintext, aad):
    nonce = secrets.token_bytes(12)
    if AESGCM is not None:
        ciphertext = AESGCM(key).encrypt(nonce, plaintext, aad)
        return nonce, ciphertext, ciphertext[-16:]

    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(aad)
    ciphertext = encryptor.update(plaintext) + encryptor.finalize()
    return nonce, ciphertext + encryptor.tag, encryptor.tag


def iter_files(input_dir):
    base = Path(input_dir)
    for path in base.rglob("*"):
        if path.is_file() and path.suffix.lower() in PROCESSABLE_EXTENSIONS:
            yield path


def redact_file(path, input_dir, output_dir, case_id, used_tokens):
    rel = Path(path).relative_to(input_dir)
    suffix = Path(path).suffix.lower()
    passthrough = False
    if suffix in TEXT_EXTENSIONS:
        text, encoding = read_text(path)
        out_rel = rel
    elif suffix in BINARY_TEXT_EXTENSIONS:
        text = extract_binary_text(path)
        if text and not is_garbage_text(text):
            encoding = f"{suffix[1:]}-extracted-text"
            out_rel = redacted_text_relpath(rel)
        else:
            # 扫描 PDF 无法提取文字，直接复制原始文件（保持二进制完整）
            passthrough = True
            if suffix == ".pdf":
                encoding = "pdf-ocr-failed-marker"
                out_rel = redacted_text_relpath(rel)
            else:
                encoding = f"{suffix[1:]}-passthrough"
                out_rel = rel
    else:
        passthrough = True
        encoding = f"{suffix[1:] or 'binary'}-passthrough"
        out_rel = rel

    if passthrough:
        out_path = Path(output_dir) / "redacted" / out_rel
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if suffix == ".pdf":
            write_text(out_path, SCANNED_PDF_MARKER)
        else:
            shutil.copy2(path, out_path)
        return {
            "file": str(out_rel).replace("\\", "/"),
            "sourceFile": str(rel).replace("\\", "/"),
            "encoding": encoding,
            "items": [],
            "passthrough": True,
            "markerFile": suffix == ".pdf"
        }, []

    items = detect(text)
    for item in items:
        token, digest = make_token(item["raw"], item["type"], case_id, used_tokens)
        item["token"] = token
        item["hashPrefix"] = digest
        item["sourceFile"] = str(rel).replace("\\", "/")
    redacted = replace_back(text, items)
    out_path = Path(output_dir) / "redacted" / out_rel
    write_text(out_path, redacted)
    safe_items = []
    private_items = []
    for item in items:
        safe_items.append({k: item.get(k) for k in ["token", "type", "sourceFile", "start", "end", "confidence", "hashPrefix", "subtype"] if item.get(k) is not None})
        private_items.append({k: item.get(k) for k in ["token", "type", "raw", "sourceFile", "start", "end", "confidence", "hashPrefix", "subtype", "normalized"] if item.get(k) is not None})
    return {
        "file": str(out_rel).replace("\\", "/"),
        "sourceFile": str(rel).replace("\\", "/"),
        "encoding": encoding,
        "items": safe_items
    }, private_items


def _process_single_file(args):
    """Worker function for parallel file processing. Runs in a separate process."""
    path_str, input_dir_str, output_dir_str, case_id, ocr_threads_per_worker = args
    file_tokens = set()
    _ocr_config['max_threads'] = ocr_threads_per_worker
    public_file, private_file_items = redact_file(
        Path(path_str), Path(input_dir_str), Path(output_dir_str), case_id, file_tokens
    )
    return public_file, private_file_items, file_tokens


def build_package(input_dir, output_dir, case_id, recovery_key):
    # 安全检查：防止input和output是同一目录
    resolved_input = Path(input_dir).resolve()
    resolved_output = Path(output_dir).resolve()
    if resolved_input == resolved_output:
        raise ValueError(
            f"input-dir 和 output-dir 不能是同一目录！"
            f"\n  input:  {resolved_input}"
            f"\n  output: {resolved_output}"
        )
    package_root, output = resolve_output_layout(output_dir)
    redacted_dir = output / "redacted"
    private_dir = output / "private"
    report_dir = output / "report"
    redacted_dir.mkdir(parents=True, exist_ok=True)
    private_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)

    # 收集文件并跨文件并行处理
    files = list(iter_files(input_dir))
    limits = get_resource_limits()
    max_workers = min(len(files), max(1, limits.get('max_workers') or 1)) if files else 1
    ocr_threads_per_worker = max(1, limits.get('ocr_threads') or 1)
    task_args = [(str(p), str(Path(input_dir)), str(output), case_id, ocr_threads_per_worker) for p in files]

    public_files = []
    private_items = []
    all_tokens = set()

    if max_workers > 1 and len(files) > 1:
        with concurrent.futures.ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_process_single_file, a): a[0] for a in task_args}
            for future in concurrent.futures.as_completed(futures):
                public_file, private_file_items, file_tokens = future.result()
                public_files.append(public_file)
                private_items.extend(private_file_items)
                all_tokens.update(file_tokens)
    else:
        for a in task_args:
            public_file, private_file_items, file_tokens = _process_single_file(a)
            public_files.append(public_file)
            private_items.extend(private_file_items)
            all_tokens.update(file_tokens)
    mapping = {"caseId": case_id, "createdAt": now_iso(), "items": private_items}
    recovery_key = recovery_key or secrets.token_urlsafe(32)
    salt = secrets.token_bytes(16)
    key = derive_key_from_recovery_key(recovery_key, salt, dklen=32)
    aad_obj = {"caseId": case_id, "createdAt": mapping["createdAt"], "purpose": "lawclient-sensitive-mapping"}
    aad = json.dumps(aad_obj, ensure_ascii=False, sort_keys=True).encode("utf-8")
    nonce, ciphertext, tag = aes_gcm_encrypt(key, json.dumps(mapping, ensure_ascii=False).encode("utf-8"), aad)
    meta = {
        "caseId": case_id,
        "algorithm": MAPPING_ALGORITHM,
        "kdf": "PBKDF2-HMAC-SHA256",
        "iterations": KDF_ITERATIONS,
        "salt": b64e(salt),
        "nonce": b64e(nonce),
        "tag": b64e(tag),
        "aad": aad_obj,
        "createdAt": now_iso()
    }
    (private_dir / "mapping.enc").write_bytes(ciphertext)
    write_text(private_dir / "mapping.meta.json", json.dumps(meta, ensure_ascii=False, indent=2))
    write_text(private_dir / "recovery.key", recovery_key)
    stats = {
        "caseId": case_id,
        "createdAt": now_iso(),
        "inputDir": str(Path(input_dir).resolve()),
        "outputDir": str(output.resolve()),
        "packageDir": str(package_root.resolve()),
        "privacyDir": str(output.resolve()),
        "fileCount": len(public_files),
        "itemCount": len(private_items),
        "passthroughFileCount": len([file for file in public_files if file.get("passthrough")]),
        "typeCount": {"ID_CARD": 0, "BANK_CARD": 0, "ADDRESS": 0},
        "files": public_files
    }
    for item in private_items:
        stats["typeCount"][item["type"]] = stats["typeCount"].get(item["type"], 0) + 1
    write_text(report_dir / "redaction_report.json", json.dumps(stats, ensure_ascii=False, indent=2))

    # 生成 extracted-materials.json（指向脱敏后的文件，供分析引擎读取）
    extracted_manifest = {
        "generatedAt": now_iso(),
        "source": "redact_case.py",
        "caseId": case_id,
        "files": []
    }
    for pf in public_files:
        redacted_path = str((redacted_dir / pf["file"]).resolve())
        preview = ""
        try:
            with open(redacted_path, encoding="utf-8", errors="replace") as f:
                preview = f.read(200)
        except Exception:
            pass
        status = "needs_ocr" if pf.get("encoding") == "pdf-ocr-failed-marker" else "extracted"
        if pf.get("passthrough") and status == "extracted":
            status = "unsupported"
        extracted_manifest["files"].append({
            "fileName": pf["file"],
            "path": redacted_path,
            "sourceFile": pf.get("sourceFile", pf["file"]),
            "type": pf.get("encoding", "txt"),
            "textPreview": preview,
            "textPath": redacted_path,
            "status": status,
            "error": "PDF OCR failed; no readable text was extracted" if status == "needs_ocr" else ""
        })
    # 写入package_root（.lawclaw/）而非output（.lawclaw/privacy/）
    write_text(package_root / "extracted-materials.json", json.dumps(extracted_manifest, ensure_ascii=False, indent=2))

    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--case-id", default=None)
    parser.add_argument("--recovery-key", default=None)
    parser.add_argument("--ocr-dpi", type=int, default=150, help="OCR 渲染 DPI")
    parser.add_argument("--ocr-threads", type=int, default=None, help="OCR 并行线程数（默认自动）")
    parser.add_argument("--ocr-memory-mb", type=int, default=None, help="OCR 最大内存占用 MB")
    parser.add_argument("--ocr-only", action="store_true", help="仅执行 OCR 提取，不脱敏")
    parser.add_argument("--skip-ocr", action="store_true", help="跳过 OCR，仅执行脱敏（假设输入已是文本）")
    args = parser.parse_args()
    # 先从配置文件读取
    load_ocr_config_from_file()
    # 命令行参数覆盖配置文件
    if args.ocr_dpi:
        _ocr_config['dpi'] = args.ocr_dpi
    if args.ocr_threads is not None:
        _ocr_config['max_threads'] = args.ocr_threads
    if args.ocr_memory_mb is not None:
        _ocr_config['max_memory_mb'] = args.ocr_memory_mb
    case_id = args.case_id or "CASE_" + datetime.now().strftime("%Y%m%d_%H%M%S")
    stats = build_package(args.input_dir, args.output_dir, case_id, args.recovery_key)
    print(json.dumps({
        "ok": True,
        "caseId": stats["caseId"],
        "outputDir": stats["outputDir"],
        "fileCount": stats["fileCount"],
        "itemCount": stats["itemCount"],
        "typeCount": stats["typeCount"]
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
