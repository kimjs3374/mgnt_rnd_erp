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
import events
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



def _save_doc_read(evidence_id, ext: dict) -> None:
    """`app.evidence_doc_reads` 에 판독 결과를 적재한다.

    본문텍스트가 다음 모델의 학습 피처다. 사람이 비목을 고치면 `app.decisions` 에
    남고, 두 개를 `app.v_trainset_bimok` 뷰가 이어 붙인다.
    """
    if not evidence_id:
        return
    rest.insert(
        "evidence_doc_reads",
        {
            "evidence_id": evidence_id,
            # ⚠ DB CHECK 는 ('native','ocr','none') 다. evidence_ocr 는 'scan' 을 쓴다 —
            #   그대로 넣었다가 23514 로 적재가 통째로 실패했다. 여기서 맞춰준다.
            "추출_경로": {"scan": "ocr", "native": "native"}.get(
                ext.get("_경로"), "none"),
            "추출_도구": ext.get("_판독") or "llm",
            "ocr_psm": None,
            "ocr_확신도": (round(float(ext["_OCR품질"]) * 100, 2)
                          if ext.get("_OCR품질") is not None else None),
            "문자수": len((ext.get("_본문") or "").replace(" ", "")) or None,
            "본문텍스트": ext.get("_본문") or None,
            "ai_서식": ext.get("_서식") or ext.get("서류종류"),
            "ai_확신도": ext.get("_서식확신도"),
            "ai_출처": "rule" if ext.get("_판독") == "로컬OCR" else "llm",
            "ai_근거": {
                "서식근거": ext.get("_서식근거"),
                "금액방법": ext.get("_금액방법"),
                "산술검증": ext.get("_산술검증"),
                "회전": ext.get("_회전"),
                "사업자번호": ext.get("_사업자번호"),
            },
        },
    )

def ingest(file_info: dict, channel: str, ts: str,
           올린이: str | None = None) -> dict:
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

    # 어느 지원사업에 붙일지 — 집행 일자로 좁힌다.
    과제_id, 후보, 사유 = project_pick.guess(ext.get("일자"))
    if 과제_id is None:
        # ★ 일자만으로는 못 정하는 게 정상이다 — 우리 실집행 기간(2023~2024)에 겹치는
        #   사업이 여럿이고 다 종료됐다. 그렇다고 **미지정으로 두면 확정 버튼이 사라진다.**
        #   같은 과제 증빙을 연달아 올리는 게 실제 사용 방식이므로 **직전에 지정한 사업**을
        #   미리 채운다. 화면에 그대로 보이고 드롭다운으로 언제든 바꿀 수 있다.
        직전 = project_pick.recent_default()
        if 직전 is not None:
            과제_id = 직전
            사유 = (f"{사유}. 직전에 지정한 「{project_pick.name_of(직전)}」로 미리 채웠습니다 "
                   f"— 다르면 아래에서 바꿔 주세요")

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

    ev = rest.insert(
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

    # ★ 판독 결과를 남긴다 — **이게 학습 데이터의 입구다.**
    #   여기 안 쌓으면 「사람이 어떻게 고쳤는지」를 나중에 학습할 재료가 없다.
    #   판독이 실패해도 집행 건은 이미 만들어졌으므로, 여기서 나는 예외는 삼킨다.
    try:
        _save_doc_read(ev.get("id"), ext)
    except Exception:
        log.exception("판독 결과 적재 실패(무시하고 진행)")

    # 올린 것은 **사람이 한 일**이다. 판독·분류는 기계가 한 일이라 system 으로 둔다.
    events.log_event(events.UPLOAD, f"증빙을 올림 — {name}",
                     expense_id=exp["id"], 행위자=올린이,
                     파일명=name, sha256=digest[:16])
    events.log_event(
        events.READ,
        (f"판독 {ext.get('_판독') or 'LLM'} · {ext.get('_서식') or '서식 미상'} · "
         f"금액 {ext.get('_금액방법') or '미상'}"
         f"{' (검산됨)' if ext.get('_산술검증') else ' (미검산)'}"),
        expense_id=exp["id"], 경로=ext.get("_경로"), 서식=ext.get("_서식"),
        금액방법=ext.get("_금액방법"), 산술검증=bool(ext.get("_산술검증")),
        합계=ext.get("합계"), 일자=ext.get("일자"), 사업자번호=ext.get("_사업자번호"))
    events.log_event(
        events.CLASSIFY,
        (f"비목 {cls.get('비목_대분류') or '미정'} · {cls.get('판단출처') or 'LLM'}"
         f" · 확신도 {float(cls.get('확신도') or 0):.0%}"),
        expense_id=exp["id"], 판단출처=cls.get("판단출처"),
        비목=cls.get("비목_대분류"), 확신도=cls.get("확신도"),
        토큰=cls.get("토큰"))
    return {
        "ok": True, "expense": exp, "판독": ext, "분류": cls,
        "불일치": 불일치, "방향": 방향, "staged": str(path),
        "과제후보": 후보, "과제사유": 사유,
    }



def remember_vendor(expense_id: int) -> str | None:
    """확정된 건의 **사업자번호 ↔ 상호 ↔ 비목**을 거래처 사전에 남긴다.

    왜 필요한가: OCR 로 읽은 상호는 엔진 버전에 따라 매번 다르게 깨진다.
      실측 — 같은 영수증, 같은 코드인데
        tesseract 5.5.3 → 「유 성 목 도 룡 점」
        tesseract 5.3.4 → 「23S 도 룡 점」
      반면 **사업자번호는 체크섬으로 검증돼 항상 같다.** 그래서 번호를 키로 삼고,
      사람이 한 번 확정한 상호·비목을 사전에 적어 둔다. 다음부터는 상호가 깨져도
      번호로 조회해 제대로 된 이름과 비목이 나온다 — 이게 「쌓이면 좋아진다」의 실체다.
    """
    rows = rest.select(
        "expenses",
        f"id=eq.{expense_id}&select=거래처,거래처_사업자번호,비목_대분류",
    )
    if not rows:
        return None
    e = rows[0]
    brn = (e.get("거래처_사업자번호") or "").strip()
    name = (e.get("거래처") or "").strip()
    if len(brn) != 10 or not name:
        return None
    old = rest.select("vendors", f"사업자번호=eq.{brn}&select=id,업체명,비목_대분류")
    payload = {"사업자번호": brn, "업체명": name}
    if e.get("비목_대분류"):
        payload["비목_대분류"] = e["비목_대분류"]
    try:
        if old:
            # 이미 있으면 비목만 갱신한다. 사람이 적어 둔 이름을 OCR 이름으로 덮지 않는다.
            upd = {k: v for k, v in payload.items() if k == "비목_대분류"}
            if upd:
                rest.update("vendors", {"id": old[0]["id"]}, upd)
            return f"기존 거래처 갱신: {old[0]['업체명']}"
        rest.insert("vendors", payload)
        return f"거래처 사전에 등록: {name} ({brn})"
    except Exception as e2:
        log.warning("거래처 사전 등록 실패: %s", e2)
        return None

def discard(expense_id: int) -> str:
    """확정하지 않은 건을 **흔적 없이 버린다.** 판독 기록 · 증빙 행 · 임시 파일까지.

    ⚠ 확정된 건은 거부한다. 원장에서 지우는 건 전혀 다른 문제이고, 여기서 할 일이 아니다.
    ⚠ FK 가 걸려 있지 않으므로 참조하는 쪽부터 순서대로 지운다.
    되돌리기: 같은 파일을 다시 올리면 새로 판독한다(중복 판정도 함께 풀린다).
    """
    rows = rest.select("expenses", f"id=eq.{expense_id}&select=id,상태")
    if not rows:
        return "이미 없는 건입니다"
    if rows[0].get("상태") == "확정":
        raise RuntimeError("확정된 건은 버릴 수 없습니다 — 원장에 이미 들어간 건입니다")

    evs = rest.select("evidence", f"expense_id=eq.{expense_id}&select=id,sha256,storage_path")
    올라간것 = [e for e in evs if e.get("storage_path")]
    if 올라간것:
        # 확정 전에 Storage 에 올라간 게 있으면 안 된다. 있으면 멈추고 사람에게 알린다.
        raise RuntimeError(
            f"이 건의 증빙 {len(올라간것)}개가 이미 Storage 에 있습니다 — 확인이 필요합니다")

    지운파일 = 0
    for ev in evs:
        try:
            rest.delete("evidence_doc_reads", {"evidence_id": ev["id"]})
        except Exception:
            log.exception("판독 기록 삭제 실패(계속)")
        for p in store.STAGING.glob(f"{ev['sha256']}*"):
            try:
                p.unlink()
                지운파일 += 1
            except OSError:
                log.exception("임시 파일 삭제 실패(계속): %s", p)

    rest.delete("evidence", {"expense_id": expense_id})
    rest.delete("decisions", {"expense_id": expense_id})
    rest.delete("expenses", {"id": expense_id})
    # ⚠ 집행 건은 지워도 **이력은 남긴다.** 무엇을 왜 안 올렸는지가 나중에 질문이 된다.
    events.log_event(events.DISCARD,
                     f"판독을 버림 — 증빙 {len(evs)}건, 임시 파일 {지운파일}개",
                     expense_id=expense_id)
    return f"판독 기록과 증빙 {len(evs)}건, 임시 파일 {지운파일}개를 지웠습니다"


def promote_to_storage(expense_id: int) -> list[str]:
    """확정된 건의 증빙을 Storage 로 올린다. 올라간 경로 목록을 돌려준다."""
    store.ensure_bucket()
    # ★ 확정과 동시에 거래처 사전을 채운다. 다음 건부터 상호가 깨져도 번호로 찾는다.
    try:
        msg = remember_vendor(expense_id)
        if msg:
            log.info("%s", msg)
    except Exception:
        log.exception("거래처 사전 등록 실패(무시)")

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
        events.log_event(events.STORE, f"증빙 보관 — {ev['파일명']}",
                         expense_id=expense_id, evidence_id=ev["id"], 경로=dest)
        rest.update("evidence", {"id": ev["id"]}, {"storage_path": info["path"]})
        store.unstage(cand[0])
        out.append(dest)
    return out
