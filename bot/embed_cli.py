#!/usr/bin/env python3
"""텍스트 -> 임베딩(384차원). 무거운 의존성(torch·sentence-transformers)을 격리한
전용 venv(/rnd/bot/venv-embed)에서만 돈다 — 기존 봇 프로세스엔 이 패키지들을
안 넣는다(pdf_extract.py 와 같은 패턴: 무거운 단계는 subprocess 로 격리한다).

모델: jhgan/ko-sroberta-multitask (768차원)
  ⚠ 처음엔 F:\\solverton 이 쓰던 다국어 범용 모델(paraphrase-multilingual-MiniLM-L12-v2)
  로 시작했는데, 실측(2026-09-04)에서 짧은 한국어 판정 문장에 심하게 어긋났다 —
  "일반음식점을 영업 중인 자"에 대해 완전히 무관한 "문의처: 담당자 02-1234-5678"이
  유사도 0.701 인데, 진짜 뜻이 비슷한 "이용업・미용업을 운영 중인 소상공인만 신청
  가능"은 0.449 로 더 낮았다 — 문턱(0.55)을 넘는 건 가짜, 진짜는 문턱 아래였다.
  다국어 범용 모델이 한국어 짧은 문장의 미묘한 의미보다 표면적 토큰 겹침에
  더 민감했던 것으로 보인다.
  → 한국어 STS(문장의미유사도) 벤치마크로 직접 파인튜닝된 모델로 바꿨다.
  KorSTS 기준 스피어만 상관 0.84~0.85 대로 이 작업(한국어 판정문 대 판정문 비교)에
  훨씬 맞는 선택이다. 768차원이라 MiniLM(384)보다 느리지만 CPU 에서도 문장 하나에
  100ms 안팎이라 이 용도(사람이 코멘트 남길 때만 호출)엔 문제 없다.

입력: stdin 으로 JSON 배열(문자열 목록). 출력: stdout 으로 JSON 배열(벡터 목록).
  한 번에 여러 문장을 묶어 보내는 이유 — 모델 로딩이 몇 초 걸린다. 문장마다 새
  프로세스를 띄우면 그때마다 로딩 비용을 문다. 배치로 묶어 한 번만 문다.

사용:
  echo '["일반음식점을 영업 중인 자", "이미용업소 시설환경개선"]' \\
    | /rnd/bot/venv-embed/bin/python /web/rnd/bot/embed_cli.py
"""
import json
import os
import sys

# ⚠ 실측(2026-09-04): 화면에서 "저장 중…"이 멈춰 있다는 신고가 왔다. 콜드 스타트
# 한 번에 11.8초 걸리는데, 그중 상당수가 "sending unauthenticated requests to the
# HF Hub" 경고와 함께 **매 호출마다 huggingface.co 에 접속을 시도**하는 데서 온다 —
# 모델은 이미 로컬에 캐시돼 있는데도 매번 원격에 갱신 여부를 확인한다. 이게 느린
# 것도 문제지만, 더 큰 문제는 **네트워크에 의존하게 된다는 것**이다 — 이 기능은
# 로컬 모델만 쓰면 되는데 HF Hub 연결이 느리거나 막히면 응답 전체가 멈춘다.
# offline 모드로 강제해 로컬 캐시만 쓰게 한다.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


def main() -> None:
    raw = sys.stdin.read()
    try:
        texts = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"stdin이 JSON 배열이 아니다: {e}"}))
        sys.exit(1)
    if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
        print(json.dumps({"ok": False, "error": "문자열 배열을 stdin으로 줄 것"}))
        sys.exit(1)
    if not texts:
        print(json.dumps({"ok": True, "vectors": []}))
        return

    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer("jhgan/ko-sroberta-multitask")
    vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    print(json.dumps({"ok": True, "vectors": [v.tolist() for v in vecs]}))


if __name__ == "__main__":
    main()
