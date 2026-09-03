"""증빙 한 건이 Slack 에서 DB 까지 가는 길.

    파일 수신 → 스테이징 → ① 판독 → 거래방향·금액검산(코드) → ② 비목 분류
              → expenses/evidence 적재 → Block Kit 회신
              → [확정] 누르면 Storage 업로드 + decisions 기록

⚠ 확정 전에는 Storage 에 올리지 않는다. 정산 원장에 속하지 않는 파일을 쌓지 않기 위해서다.
"""

from __future__ import annotations

import json
import logging
import os

import requests

import extract
import project_pick
import rest
import store

log = logging.getLogger("evidence")



def download(url_private: str) -> bytes:
    """Slack 파일은 봇 토큰으로 인증해야 받을 수 있다."""
    r = requests.get(
        url_private,
        headers={"Authorization": f"Bearer {os.environ['SLACK_BOT_TOKEN']}"},
        timeout=60,
    )
    r.raise_for_status()
    return r.content


def already(digest: str) -> dict | None:
    """같은 파일이 두 번 올라온다. sha256 으로 잡는다."""
    rows = rest.select("evidence", f"sha256=eq.{digest}&select=id,expense_id&limit=1")
    return rows[0] if rows else None


def ingest(file_info: dict, channel: str, ts: str) -> dict:
    """파일 하나를 처리해 expenses 행을 만든다. 실패해도 예외를 밖으로 던지지 않는다."""
    name = file_info.get("name") or "evidence"
    data = download(file_info["url_private"])
    digest = store.sha256(data)

    dup = already(digest)
    if dup:
        return {"ok": False, "duplicate": True, "expense_id": dup["expense_id"], "파일명": name}

    path = store.stage(data, name)

    # ① 판독
    ext = extract.read_evidence(str(path))

    # 코드가 확정하는 것 — LLM 에게 맡기지 않는다
    거래처, brn, 방향 = extract.resolve_direction(ext)
    불일치 = extract.verify_amounts(ext)

    # ② 비목 분류
    cls = extract.classify(거래처, ext["품목"], ext.get("합계"))

    # 어느 지원사업에 붙일지 — 집행 일자로 좁힌다. 애매하면 기본값을 만들지 않는다.
    과제_id, 후보, 사유 = project_pick.guess(ext.get("일자"))

    exp = rest.insert(
        "expenses",
        {
            "과제_id": 과제_id,
            "거래처": 거래처,
            "거래처_사업자번호": brn or None,
            "일자": ext.get("일자"),
            "공급가액": ext.get("공급가액"),
            "세액": ext.get("세액"),
            "합계": ext.get("합계"),
            "품목": ext["품목"],
            "비목_대분류": cls["비목_대분류"],
            "비목_세부항목": cls["비목_세부항목"],
            "ai_확신도": cls["확신도"],
            "ai_근거": (cls["근거"] + ("\n" + cls["규정"] if cls["규정"] else "")).strip(),
            "ai_대안": cls["대안"],
            "방향검증": 방향,
            "불일치": 불일치,
            "재원구분": "출연금",
            "상태": "검토대기",
            "slack_channel": channel,
            "slack_ts": ts,
        },
    )

    rest.insert(
        "evidence",
        {
            "expense_id": exp["id"],
            "파일명": name,
            "서류종류": ext.get("서류종류"),
            "storage_path": None,  # 확정 시 채운다
            "sha256": digest,
            "bytes": len(data),
            "slack_file_id": file_info.get("id"),
        },
    )

    return {
        "ok": True, "expense": exp, "판독": ext, "분류": cls,
        "불일치": 불일치, "방향": 방향, "staged": str(path),
        "과제후보": 후보, "과제사유": 사유,
    }


def promote_to_storage(expense_id: int) -> list[str]:
    """확정된 건의 증빙을 Storage 로 올린다. 올라간 경로 목록을 돌려준다."""
    store.ensure_bucket()
    out: list[str] = []
    rows = rest.select(
        "evidence", f"expense_id=eq.{expense_id}&storage_path=is.null&select=id,파일명,sha256"
    )
    for ev in rows:
        digest = ev["sha256"]
        # 스테이징에서 확장자를 모르므로 해시로 시작하는 파일을 찾는다
        import pathlib

        cand = list(store.STAGING.glob(f"{digest}*"))
        if not cand:
            log.warning("스테이징에 파일이 없다: %s", digest[:12])
            continue
        dest = store.object_path(expense_id, ev["파일명"], digest)
        info = store.upload(cand[0], dest, filename=ev["파일명"])
        rest.update("evidence", {"id": ev["id"]}, {"storage_path": info["path"]})
        store.unstage(cand[0])
        out.append(dest)
    return out
