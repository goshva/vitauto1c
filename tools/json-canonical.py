"""Канонический вид JSON-настроек vitauto.

Приводит файл к тому же формату, что генераторы репозитория
(tools/gen_pwa_matrix.py и др.): UTF-8 без BOM, отступ 1, перевод строки в конце.
Переводы строк сохраняются как в исходном файле (CRLF остаётся CRLF): иначе импорт
настроек на Windows давал бы ложные «изменения» в git status из-за core.autocrlf.

    python tools/json-canonical.py <файл.json>
"""
import json
import sys


def existing_newline(path: str) -> str:
    """Перевод строки, уже принятый в файле: CRLF, если он там есть, иначе LF."""
    try:
        with open(path, "rb") as f:
            return "\r\n" if b"\r\n" in f.read() else "\n"
    except FileNotFoundError:
        return "\n"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: json-canonical.py <file.json>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    newline = existing_newline(path)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    if newline != "\n":
        text = text.replace("\n", newline)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
