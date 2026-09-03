#!/usr/bin/env python3
"""PDF -> 텍스트. CLAUDE.md §6: PDF 는 pypdf. argv[1] 경로, stdout 에 텍스트."""
import sys
from pypdf import PdfReader

def main():
    path = sys.argv[1]
    reader = PdfReader(path)
    text = "\n".join((p.extract_text() or "") for p in reader.pages)
    sys.stdout.write(text)

if __name__ == "__main__":
    main()
