import argparse
import base64
import hashlib
import json
import re
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except Exception:
    AESGCM = None

TOKEN_PATTERN = re.compile(r"<(?:ID_CARD|BANK_CARD|ADDRESS|PHONE|EMAIL|NAME)_[a-f0-9]{8}>")
TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".log"}
DEFAULT_ITERATIONS = 200000


def b64d(data):
    return base64.b64decode(data.encode("ascii"))


def read_text(path):
    for enc in ["utf-8", "utf-8-sig", "gb18030"]:
        try:
            return Path(path).read_text(encoding=enc)
        except UnicodeDecodeError:
            pass
    return Path(path).read_text(encoding="utf-8", errors="replace")


def write_text(path, text):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text, encoding="utf-8")


def derive_key(recovery_key, salt, dklen, iterations=DEFAULT_ITERATIONS):
    return hashlib.pbkdf2_hmac("sha256", recovery_key.encode("utf-8"), salt, iterations, dklen=dklen)


def load_recovery_key(args):
    if args.recovery_key:
        return args.recovery_key
    if args.recovery_key_file:
        return Path(args.recovery_key_file).read_text(encoding="utf-8").strip()
    raise RuntimeError("recovery key is required")


def decrypt_aes_gcm(ciphertext, key, nonce, aad):
    if AESGCM is not None:
        return AESGCM(key).decrypt(nonce, ciphertext, aad)

    if len(ciphertext) < 16:
        raise RuntimeError("AES-GCM ciphertext is too short")
    encrypted = ciphertext[:-16]
    tag = ciphertext[-16:]
    decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
    decryptor.authenticate_additional_data(aad)
    return decryptor.update(encrypted) + decryptor.finalize()


def decrypt_sm4_gcm(ciphertext, key, nonce, tag, aad):
    decryptor = Cipher(algorithms.SM4(key), modes.GCM(nonce, tag)).decryptor()
    decryptor.authenticate_additional_data(aad)
    return decryptor.update(ciphertext) + decryptor.finalize()


def decrypt_mapping(mapping_path, meta_path, recovery_key):
    meta = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    algorithm = str(meta.get("algorithm") or "SM4-GCM").upper()
    iterations = int(meta.get("iterations") or DEFAULT_ITERATIONS)
    salt = b64d(meta["salt"])
    nonce = b64d(meta["nonce"])
    aad = json.dumps(meta["aad"], ensure_ascii=False, sort_keys=True).encode("utf-8")
    ciphertext = Path(mapping_path).read_bytes()

    if algorithm in {"AES-256-GCM", "AES-GCM"}:
        key = derive_key(recovery_key, salt, dklen=32, iterations=iterations)
        plaintext = decrypt_aes_gcm(ciphertext, key, nonce, aad)
    elif algorithm == "SM4-GCM":
        key = derive_key(recovery_key, salt, dklen=16, iterations=iterations)
        plaintext = decrypt_sm4_gcm(ciphertext, key, nonce, b64d(meta["tag"]), aad)
    else:
        raise RuntimeError(f"unsupported mapping algorithm: {algorithm}")
    return json.loads(plaintext.decode("utf-8"))


def restore_text(text, mapping):
    table = {item["token"]: item["raw"] for item in mapping.get("items", [])}
    return TOKEN_PATTERN.sub(lambda m: table.get(m.group(), m.group()), text)


def iter_files(input_dir):
    base = Path(input_dir)
    for path in base.rglob("*"):
        if path.is_file() and path.suffix.lower() in TEXT_EXTENSIONS:
            yield path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--meta", required=True)
    parser.add_argument("--recovery-key", default=None)
    parser.add_argument("--recovery-key-file", default=None)
    args = parser.parse_args()
    recovery_key = load_recovery_key(args)
    mapping = decrypt_mapping(args.mapping, args.meta, recovery_key)
    count = 0
    for path in iter_files(args.input_dir):
        rel = path.relative_to(args.input_dir)
        text = read_text(path)
        restored = restore_text(text, mapping)
        count += len(TOKEN_PATTERN.findall(text))
        write_text(Path(args.output_dir) / rel, restored)
    print(json.dumps({
        "ok": True,
        "caseId": mapping.get("caseId"),
        "outputDir": str(Path(args.output_dir).resolve()),
        "tokenOccurrences": count
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
