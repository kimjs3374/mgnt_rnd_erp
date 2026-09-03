"""사람 판정+코멘트를 의미로 쌓고 찾는다 — LLM 을 부르지 않는다.

사용자 질문(2026-09-04): "각 사업별 직접판정하고 코멘트 작성하면 자연어 처리해서
학습하는 구조로 가능?" — F:\\solverton\\insight_engine.py 의 classify_new_comment()
와 같은 방식(로컬 임베딩 모델 + 코사인 유사도)으로 만들었다.

오늘 만든 extraction_lexicon(db/102_)과 다른 층이다:
  extraction_lexicon  문구가 글자 그대로 같아야 걸린다(부분문자열/정규식).
  judgment_semantic   문구가 달라도 **뜻이 비슷하면** 걸린다(임베딩 코사인 유사도).
  둘 다 이 파일이 아니라 사람이 판정+코멘트를 남길 때 같이 쌓인다.

무거운 의존성(torch·sentence-transformers)은 이 파일에 없다 — 격리된 venv
(/rnd/bot/venv-embed)의 embed_cli.py 를 subprocess 로만 부른다. 그 프로세스가
죽거나 느려도 이 파일을 쓰는 게이트웨이·MCP 는 안 죽는다(타임아웃으로 잡는다).

⚠ 벡터 DB 를 쓰지 않는다(CLAUDE.md §6). 임베딩은 jsonb 배열로 저장하고, 유사도는
매 호출마다 파이썬에서 코사인 유사도(정규화된 벡터라 내적과 같다)로 계산한다.
이 규모(수백~수천 건)에서는 인덱스 없이도 충분히 빠르다 — 판을 더 키울 일이
생기면 그때 인덱스형 접근을 고려한다(지금은 아니다, 미리 만들지 않는다).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rest  # noqa: E402

EMBED_PY = "/rnd/bot/venv-embed/bin/python"   # venv 는 git 에 안 들어가니 그대로 둔다
EMBED_CLI = "/web/rnd/bot/embed_cli.py"       # ⚠ 스크립트는 /web/rnd/bot/ 에 둔다 —
# /rnd/bot/ 은 별개 디렉터리다(symlink 아님, 실측 확인). 오늘 실제로 쓰는 코드
# (mcp_server.py·ann_rules.py 등)는 전부 /web/rnd/bot/ 에 있고 git 이 그것만 본다.
# 처음에 embed_cli.py 를 /rnd/bot/ 에 둬서 커밋이 안 됐다 — 여기로 옮겼다.
EMBED_TIMEOUT = 60  # subprocess 폴백용. 모델 로딩(콜드스타트 8~12초) + 인코딩.
# embed_cli.py 와 반드시 같은 값이어야 한다. DB 컬럼 기본값에만 기대지 않고 매번
# 명시적으로 적는다 — 모델이 나중에 또 바뀌면(오늘 이미 한 번 바뀌었다: 다국어
# MiniLM → 한국어 STS 전용 ko-sroberta-multitask, 실측 오탐 때문에) 어떤 행이 어느
# 모델로 만들어졌는지 데이터에 그대로 남아야 한다.
MODEL_NAME = "jhgan/ko-sroberta-multitask"

# ⚠ 실측(2026-09-04): 화면에서 "저장 중…"이 멈춘다는 신고가 왔다 — subprocess 콜드
# 스타트가 8~12초 걸려 nginx 앞단 타임아웃보다 길어질 수 있었다(뒤에서는 결국
# 저장까지 됐지만 화면은 응답을 못 받아 영영 멈춰 있었다). 그래서 모델을 상주시켜
# 두는 서버(bot/embed_server.py, systemd rnd-embed)를 먼저 쓰고, 그게 죽어 있으면
# 예전 subprocess 방식으로 **폴백**한다 — 느리지만 기능은 산다.
EMBED_SERVER = os.environ.get("RND_EMBED_URL", "http://127.0.0.1:3612")
EMBED_SERVER_TIMEOUT = 15  # 이미 상주해 있으면 문장 하나에 수백 ms 다 — 넉넉히 15초


def _embed_via_server(texts: list[str]) -> list[list[float]] | None:
    """상주 서버로 시도한다. 서버가 없거나 응답이 없으면 None — 예외를 던지지 않는다
    (호출부가 subprocess 폴백으로 넘어가게)."""
    try:
        res = requests.post(f"{EMBED_SERVER}/embed", json={"texts": texts},
                            timeout=EMBED_SERVER_TIMEOUT)
        res.raise_for_status()
        d = res.json()
        if not d.get("ok"):
            return None
        return d["vectors"]
    except requests.RequestException:
        return None


def _embed_via_subprocess(texts: list[str]) -> list[list[float]]:
    if not os.path.exists(EMBED_PY):
        raise RuntimeError(
            f"임베딩 venv 가 없다({EMBED_PY}). "
            "python3 -m venv /rnd/bot/venv-embed && "
            "/rnd/bot/venv-embed/bin/pip install sentence-transformers 로 먼저 만든다."
        )
    proc = subprocess.run(
        [EMBED_PY, EMBED_CLI],
        input=json.dumps(texts, ensure_ascii=False),
        capture_output=True, text=True, timeout=EMBED_TIMEOUT,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"embed_cli 실패({proc.returncode}): {proc.stderr[:500]}")
    d = json.loads(proc.stdout)
    if not d.get("ok"):
        raise RuntimeError(f"embed_cli 오류: {d.get('error')}")
    return d["vectors"]


def _embed(texts: list[str]) -> list[list[float]]:
    """텍스트 목록을 벡터 목록으로. 실패하면 예외를 던진다 — 호출부가 잡는다.

    상주 서버(빠름) 먼저 시도하고, 없으면 subprocess(느리지만 항상 된다)로 폴백한다.
    """
    if not texts:
        return []
    v = _embed_via_server(texts)
    if v is not None:
        return v
    return _embed_via_subprocess(texts)


def _cosine(a: list[float], b: list[float]) -> float:
    """정규화된 벡터라 내적이 곧 코사인 유사도다."""
    return sum(x * y for x, y in zip(a, b))


def record_judgment(text: str, 판정: str, 답변자: str, *, announcement_id: int | None = None,
                    특징키: str | None = None, 사유: str | None = None) -> dict[str, Any]:
    """사람의 판정+코멘트를 **즉시** 저장한다. 임베딩은 여기서 계산하지 않는다.

    사용자 지적(2026-09-04): "DB에 올리고 모델은 백그라운드에서 작업하면 되지
    저장할때마다 모델호출하면 서버리소스가 남아나겠냐" — 맞다. 저장 요청 하나가
    임베딩 계산 시간에 묶이면 안 된다. 저장은 텍스트만 넣고 바로 끝낸다 —
    호출부(bot/gateway.py)가 응답을 돌려준 **뒤에** fill_embedding() 을 백그라운드
    스레드로 부른다.

    text 는 보통 그 판정의 근거가 된 공고문 문장(근거문장)이다 — 판정 자체
    ("불가")가 아니라 **왜 그런지를 말하는 문장**이어야 다음에 비슷한 문장이 나왔을
    때 걸린다.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("text 가 비었다 — 판정 근거 문장이 있어야 한다")
    if not 답변자:
        raise ValueError("답변자 가 비었다 — 누가 판단했는지 없으면 이력이 아니다")

    row = rest.insert("judgment_semantic", {
        "announcement_id": announcement_id,
        "텍스트": text,
        "임베딩": None,          # 백그라운드에서 채운다 — find_similar() 가 null 은 건너뛴다
        "임베딩모델": MODEL_NAME,
        "판정": 판정,
        "특징키": 특징키,
        "사유": 사유,
        "답변자": 답변자,
    })
    return row


def fill_embedding(row_id: int, text: str) -> None:
    """저장된 행에 임베딩을 채운다 — record_judgment() 이후 백그라운드에서 부른다.

    실패해도 예외를 삼킨다(호출부가 백그라운드 스레드라 예외를 받아줄 곳이 없다) —
    대신 stderr 로 남긴다. 원문·판정 자체는 이미 안전하게 DB 에 있으니 급하지 않다.
    """
    try:
        vec = _embed([text])[0]
        rest.update("judgment_semantic", {"id": row_id}, {"임베딩": vec, "임베딩모델": MODEL_NAME})
    except Exception as e:
        print(f"[semantic_learn] fill_embedding(#{row_id}) 실패: {type(e).__name__}: {e}",
              file=sys.stderr)


def corpus() -> list[dict[str, Any]]:
    """판정 코퍼스를 한 번만 읽는다 — 배치(ann_rules.batch)가 공고마다 다시 읽지 않게.

    find_similar() 에 그대로 넘기면 된다. 코퍼스는 수백 건 규모라 통째로 들고 있어도 된다
    (벡터 DB 를 쓰지 않는다는 전제가 여기서도 그대로다)."""
    return rest.select(
        "judgment_semantic",
        f"select=id,announcement_id,텍스트,임베딩,임베딩모델,판정,특징키,사유,답변자,created_at"
        f"&임베딩모델=eq.{MODEL_NAME}&order=id.desc&limit=2000",
    )


def find_similar(text: str, top_k: int = 5, min_sim: float = 0.40,
                 rows: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """의미가 비슷한 과거 판정 사례를 찾는다. 정답을 대신 내리지 않는다 — 참고 사례만 준다.

    ⚠ min_sim 기본값(0.40)은 실측으로 잡았다(2026-09-04). 처음엔 다국어 범용 모델
    (paraphrase-multilingual-MiniLM-L12-v2, F:\\solverton 이 쓰던 것)로 0.55 를 뒀는데,
    실측에서 완전히 무관한 문장("문의처: 담당자 02-1234-5678")이 0.70 넘게 나오고
    진짜 비슷한 문장은 0.45 로 더 낮게 나왔다 — 문턱이 뒤집혀 있었다. 한국어 STS
    전용 모델(ko-sroberta-multitask)로 바꾼 뒤 재실측: 무관한 문장은 전부 0.27 이하,
    진짜 비슷한 판정문은 0.45~0.81 로 뚜렷이 갈렸다. 0.40 은 그 사이 여유를 두고
    잡은 값이다 — 근거 없이 정한 숫자가 아니다.
    """
    text = (text or "").strip()
    if not text:
        return []
    if rows is None:
        rows = corpus()
    if not rows:
        return []

    q = _embed([text])[0]
    scored = []
    for r in rows:
        벡터 = r.get("임베딩")
        if not isinstance(벡터, list) or len(벡터) != len(q):
            continue  # 저장 당시 다른 모델·차원이었을 수 있다 — 단정하지 않고 건너뛴다
        sim = _cosine(q, 벡터)
        if sim >= min_sim:
            scored.append({**{k: v for k, v in r.items() if k != "임베딩"}, "유사도": round(sim, 4)})
    scored.sort(key=lambda r: -r["유사도"])
    return scored[:top_k]


def history_for_announcement(announcement_id: int) -> list[dict[str, Any]]:
    """이 공고에 남긴 판정+코멘트 이력을 그대로 돌려준다 — 임베딩 유사도가 아니라
    announcement_id 로 정확히 필터한다.

    사용자 지적(2026-09-04): "왜 이력 남긴거 확인이 안되냐 확인할수 있어야지?" —
    find_similar() 는 전체 공고를 대상으로 한 **의미 유사도** 검색이라 min_sim(0.40)
    문턱을 못 넘으면 방금 자기가 남긴 코멘트도 안 보일 수 있었다. 이건 그거랑 다르게
    "이 공고에 실제로 뭘 남겼는지"를 정확히 보여준다 — 임베딩을 계산하지 않으니
    background fill_embedding() 이 아직 안 끝났어도(임베딩이 null 이어도) 바로 보인다.
    """
    if not announcement_id:
        return []
    return rest.select(
        "judgment_semantic",
        f"select=id,announcement_id,텍스트,판정,특징키,사유,답변자,created_at"
        f"&announcement_id=eq.{int(announcement_id)}&order=created_at.desc&limit=50",
    )


def main() -> None:
    """CLI 시험용. python3 bot/semantic_learn.py 찾기 "문장" """
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "찾기":
        q = " ".join(sys.argv[2:])
        for r in find_similar(q):
            print(f"  유사도 {r['유사도']:.3f} 판정={r['판정']} [{r.get('announcement_id')}] {r['텍스트'][:60]}")
            if r.get("사유"):
                print(f"    사유: {r['사유']}")
    else:
        print(f"모르는 명령: {cmd}")


if __name__ == "__main__":
    main()
