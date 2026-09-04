# -*- coding: utf-8 -*-
"""집행 건의 **생애 이력**을 한 줄기로 남긴다.

이력이 흩어져 있었다 — 판독은 `evidence_doc_reads`, 확정은 `decisions`, LLM 호출은
`llm_usage`. 그리고 **대화로 값을 고친 것은 아무 데도 남지 않았다**. 사람이 거래처를
적어 넣어도 `rest.update` 만 하고 끝났다.

「이 건이 왜 이렇게 처리됐나」에 답하려면 한 줄기가 필요하다. 그게 이 시스템의 값어치다 —
집행 결과 표는 이미 회사에 있고, 없는 것은 **왜 그렇게 넣었는지**다.

⚠ 이력 기록이 실패해도 **본 작업은 계속된다.** 로그를 못 남겨서 확정을 못 하면 본말전도다.
"""
from __future__ import annotations

import logging

import rest

log = logging.getLogger("events")

# 행위 종류 — 새 값을 넣을 때 여기에 뜻을 적는다. DB 는 CHECK 를 걸지 않는다(유연성).
UPLOAD = "upload"        # 파일 접수
READ = "read"            # 판독(로컬 OCR / LLM)
CLASSIFY = "classify"    # 비목 분류
ASK = "ask"              # 사람에게 질문
ANSWER = "answer"        # 사람의 답변
EDIT = "edit"            # 값 수정 (이전값 → 새값)
PROJECT = "project"      # 지원사업 지정
CONFIRM = "confirm"      # 확정 (AI 제안에 동의)
CORRECT = "correct"      # 정정 확정 (AI 제안을 바꿈)
DISCARD = "discard"      # 버림
STORE = "store"          # Storage 보관
RELEARN = "relearn"      # 재학습 예약
COMMENT = "comment"      # 사람이 남긴 메모


def log_event(행위: str, 요약: str, *, expense_id=None, evidence_id=None,
              행위자: str | None = None, **상세) -> None:
    """이력 한 줄. 실패해도 조용히 넘어간다 — 본 작업을 막지 않는다."""
    try:
        rest.insert("expense_events", {
            "expense_id": expense_id,
            "evidence_id": evidence_id,
            "행위": 행위,
            "행위자": 행위자 or "system",
            "요약": 요약[:400],
            "상세": 상세 or None,
        })
    except Exception:
        log.exception("이력 기록 실패(무시): %s %s", 행위, 요약[:60])


def history(expense_id: int, limit: int = 60) -> list[dict]:
    """한 건의 이력을 시간순으로."""
    try:
        return rest.select(
            "expense_events",
            f"expense_id=eq.{expense_id}&select=*&order=id.asc&limit={limit}")
    except Exception:
        log.exception("이력 조회 실패")
        return []


_ICON = {
    UPLOAD: "📎", READ: "🔍", CLASSIFY: "🏷", ASK: "❓", ANSWER: "💬",
    EDIT: "✍️", PROJECT: "📌", CONFIRM: "✅", CORRECT: "✏️",
    DISCARD: "🗑", STORE: "📦", RELEARN: "🔁", COMMENT: "💬",
}


def _kst(iso: str | None) -> str:
    """DB 는 UTC 로 저장한다. 사람에게는 KST 로 보여준다 — 「몇 시에 했더라」가 이력의 절반이다."""
    from datetime import datetime, timedelta
    s = (iso or "").replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return (iso or "")[:19].replace("T", " ")
    if dt.tzinfo is not None:
        dt = dt.astimezone().utcoffset() is not None and dt or dt
        dt = dt + (timedelta(hours=9) - (dt.utcoffset() or timedelta()))
    return dt.strftime("%m-%d %H:%M:%S")


def render(rows: list[dict]) -> str:
    """Slack 에 그대로 붙일 수 있는 이력 표시.

    기계용 `상세` 는 빼고 **사람이 읽는 한 줄**만 낸다. 자세한 값이 필요하면 DB 를 본다.
    """
    if not rows:
        return "_이 건의 이력이 없습니다._"
    out = []
    for r in rows:
        ts = _kst(r.get("created_at"))
        who = r.get("행위자") or "system"
        who = f"<@{who}>" if who.startswith("U") else f"`{who}`"
        out.append(f"{_ICON.get(r.get('행위'), '·')} `{ts}`  {r.get('요약')}  — {who}")
    return "\n".join(out)
