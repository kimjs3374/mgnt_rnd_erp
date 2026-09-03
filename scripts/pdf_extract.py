#!/usr/bin/env python3
"""PDF -> 텍스트. CLAUDE.md §6: PDF 는 pypdf. argv[1] 경로, stdout 에 텍스트.

⚠ 실측(2026-09-04): 26건 판독실패 중 일부(id 105 등)는 pypdf 자체 버그였다 —
  특정 폰트의 너비 배열이 IndirectObject 를 담고 있으면
  `TypeError: unsupported operand type(s) for +: 'float' and 'IndirectObject'`
  로 죽는다(pypdf/_font.py get_text_width). 페이지 하나가 이 버그에 걸리면
  `"\n".join(p.extract_text() for p in reader.pages)` 제너레이터 전체가 죽어서
  **멀쩡한 다른 페이지의 텍스트까지 통째로 날아간다.**
  → 페이지별로 try/except 를 두른다. 한 페이지가 죽어도 나머지는 살린다.
  실패한 페이지 수는 stderr 로만 알린다 — stdout 은 extract.mjs 의 execFileSync 가
  그대로 텍스트로 받는 채널이라 진단 메시지를 섞으면 안 된다.

  이미지만 있는 PDF(포스터·리플릿류)는 이걸로 못 고친다 — 애초에 텍스트 레이어가
  없다. OCR 은 이 프로젝트 스택에서 뺀 것이다(CLAUDE.md §6) — 그런 문서는
  "판독실패"로 정직하게 남기고 넘어간다.
"""
import sys
from pypdf import PdfReader


def main():
    path = sys.argv[1]
    reader = PdfReader(path)
    parts = []
    실패쪽 = 0
    for i, p in enumerate(reader.pages):
        try:
            parts.append(p.extract_text() or "")
        except Exception as e:
            실패쪽 += 1
            print(f"[pdf_extract] {i+1}쪽 추출 실패, 건너뜀: {type(e).__name__}: {e}",
                  file=sys.stderr)
    if 실패쪽:
        print(f"[pdf_extract] {실패쪽}/{len(reader.pages)}쪽 실패, {len(reader.pages)-실패쪽}쪽은 살렸다",
              file=sys.stderr)
    sys.stdout.write("\n".join(parts))


if __name__ == "__main__":
    main()
