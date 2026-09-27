# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "rapidocr-onnxruntime",
#     "PyMuPDF",
# ]
# ///
"""
案件材料PDF文本提取脚本（v2 — RapidOCR + PyMuPDF）

自动检测PDF类型（文本型/扫描型），优先用 PyMuPDF 提取文本，
文本不足时用 RapidOCR 做图像识别。

用法:
    python3 pdf_extract.py --input-dir /path/to/pdfs --output-dir /path/to/output [--case-name "案件名"]

依赖:
    pip install rapidocr-onnxruntime PyMuPDF
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import fitz  # PyMuPDF

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pdf_extract")

# 每页字符数低于此值视为扫描型，需要 OCR
CHARS_PER_PAGE_THRESHOLD = 50

# OCR 初始化（全局单例，避免重复加载模型）
_ocr_instance = None


def get_ocr():
    """懒加载 RapidOCR 实例。"""
    global _ocr_instance
    if _ocr_instance is None:
        log.info("初始化 RapidOCR 引擎...")
        from rapidocr_onnxruntime import RapidOCR
        _ocr_instance = RapidOCR()
        log.info("RapidOCR 引擎就绪")
    return _ocr_instance


def extract_page_text_pymupdf(page) -> str:
    """用 PyMuPDF 提取单页文本。"""
    return (page.get_text() or "").strip()


def extract_page_ocr(page, page_num: int) -> str:
    """用 RapidOCR 对单页进行图像识别。"""
    try:
        # 渲染为 PNG 图像（150 DPI 平衡速度与质量）
        pix = page.get_pixmap(dpi=150)
        img_bytes = pix.tobytes("png")

        ocr = get_ocr()
        result, _ = ocr(img_bytes)

        if not result:
            return ""

        # result 是 [(bbox, text, score), ...] 的列表
        lines = [item[1] for item in result if item[1].strip()]
        text = "\n".join(lines)
        log.debug(f"  第{page_num}页 OCR 识别 {len(lines)} 行")
        return text
    except Exception as e:
        log.warning(f"  第{page_num}页 OCR 失败: {e}")
        return ""


def extract_pdf(pdf_path: str) -> tuple[str, str]:
    """
    提取 PDF 文本。返回 (text, method)。
    流程：PyMuPDF 文本提取 → 文本不足时用 RapidOCR。
    """
    filename = os.path.basename(pdf_path)
    log.info(f"处理: {filename}")

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        log.error(f"  无法打开 PDF: {e}")
        return f"[警告: {filename} 无法打开 ({e})]", "failed"

    page_count = len(doc)
    log.info(f"  页数: {page_count}")

    all_pages = []
    need_ocr_pages = []

    # 第一遍：PyMuPDF 文本提取
    for i in range(page_count):
        page = doc[i]
        text = extract_page_text_pymupdf(page)
        all_pages.append(text)
        if len(text) < CHARS_PER_PAGE_THRESHOLD:
            need_ocr_pages.append(i)

    total_chars = sum(len(t) for t in all_pages)
    chars_per_page = total_chars / max(page_count, 1)
    log.info(f"  PyMuPDF: {total_chars}字符, 平均{chars_per_page:.0f}字符/页, "
             f"需OCR: {len(need_ocr_pages)}/{page_count}页")

    # 如果大部分页面文本充足，直接用文本结果
    if len(need_ocr_pages) == 0:
        log.info(f"  [文本型] 全部页面文本充足")
        doc.close()
        result = "\n\n".join(
            f"--- 第{i+1}页 ---\n\n{all_pages[i]}" for i in range(page_count) if all_pages[i]
        )
        return result, "text"

    # 第二遍：对文本不足的页面做 OCR
    log.info(f"  [混合模式] 对 {len(need_ocr_pages)} 页执行 OCR...")
    for i in need_ocr_pages:
        ocr_text = extract_page_ocr(doc[i], i + 1)
        if ocr_text and len(ocr_text) > len(all_pages[i]):
            all_pages[i] = ocr_text

    doc.close()

    # 组装结果
    result = "\n\n".join(
        f"--- 第{i+1}页 ---\n\n{all_pages[i]}" for i in range(page_count) if all_pages[i]
    )

    ocr_chars = sum(len(all_pages[i]) for i in need_ocr_pages)
    method = "ocr" if ocr_chars > total_chars else "mixed"
    log.info(f"  [完成] {method.upper()} 提取 {len(result)} 字符")
    return result, method


def main():
    parser = argparse.ArgumentParser(description="案件材料PDF文本提取（RapidOCR + PyMuPDF）")
    parser.add_argument("--input-dir", required=True, help="PDF文件所在目录")
    parser.add_argument("--output-dir", required=True, help="输出根目录")
    parser.add_argument("--case-name", default=None, help="案件名称（可选，用于子目录名）")
    parser.add_argument("--debug", action="store_true", help="启用调试日志")
    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    # 输出目录结构
    if args.case_name:
        materials_dir = os.path.join(args.output_dir, args.case_name, "材料")
    else:
        materials_dir = os.path.join(args.output_dir, "材料")
    os.makedirs(materials_dir, exist_ok=True)

    # 查找 PDF 文件
    input_dir = Path(args.input_dir)
    pdf_files = sorted(input_dir.glob("*.pdf"), key=lambda p: p.name)

    if not pdf_files:
        log.error(f"未找到PDF文件: {args.input_dir}")
        sys.exit(1)

    log.info(f"找到 {len(pdf_files)} 个PDF文件")

    # 逐个处理
    results = []
    for pdf_file in pdf_files:
        text, method = extract_pdf(str(pdf_file))

        # 保存为 TXT（每页一个文件）
        stem = pdf_file.stem
        out_path = os.path.join(materials_dir, f"{stem}.txt")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)

        results.append({
            "file": pdf_file.name,
            "method": method,
            "chars": len(text),
            "output": f"{stem}.txt",
        })
        log.info(f"  -> 已保存: {stem}.txt")

    # 汇总
    text_count = sum(1 for r in results if r["method"] == "text")
    ocr_count = sum(1 for r in results if r["method"] == "ocr")
    mixed_count = sum(1 for r in results if r["method"] == "mixed")
    fail_count = sum(1 for r in results if r["method"] == "failed")

    print(f"\n{'='*50}")
    print(f"提取完成: {len(results)} 个文件")
    print(f"  文本型: {text_count} | OCR: {ocr_count} | 混合: {mixed_count} | 失败: {fail_count}")
    print(f"  输出目录: {materials_dir}")

    # 保存提取报告
    report = {
        "case_name": args.case_name,
        "input_dir": str(input_dir),
        "materials_dir": materials_dir,
        "total": len(results),
        "text_based": text_count,
        "ocr_based": ocr_count,
        "mixed": mixed_count,
        "failed": fail_count,
        "files": results,
    }
    report_path = os.path.join(os.path.dirname(materials_dir), "提取报告.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    log.info(f"  提取报告: {report_path}")


if __name__ == "__main__":
    main()
