"""잔업제로 Slack 봇 — 메신저가 프론트엔드인 ERP.

사람은 ERP 화면에 안 들어온다. 그게 자료를 개인 PC 에 두는 이유고
공유폴더가 정착하지 못한 이유다. 그래서 **입력은 Slack, 축적은 DB, 조회는 웹**으로 가른다.

챗은 웹 챗과 **같은 MCP 서버·같은 chat.ask()** 를 공유한다. 도구를 두 벌로 만들지 않는다.

⚠ 봇은 서버 한 대에서만 실행한다.
   같은 앱 토큰으로 여러 곳이 Socket Mode 에 붙으면 이벤트가 랜덤하게 한 곳에만 간다.
   에러가 안 나서 원인 찾기가 최악이다. 각자 돌려보려면 개발용 앱을 따로 만든다.

⚠ manifest 에 선언한 기능은 전부 여기 구현돼 있어야 한다.
   선언만 하고 핸들러가 없으면 슬래시 커맨드가 dispatch_failed 로 죽는다.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

import chat
import evidence_flow
import project_pick
import rest

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rnd-bot")

app = App(token=os.environ["SLACK_BOT_TOKEN"])
THRESHOLD = float(os.environ.get("CLASSIFY_CONFIDENCE_THRESHOLD", "0.70"))

HELP = """안녕하세요. 지원사업 관리 도우미입니다.

이런 걸 물어보세요
· 우리가 지금 하는 지원사업 뭐뭐 있지?
· 작년에 노트북 뭘로 처리했지?
· 아이퍼스 특허 비용 두 건이 왜 다르지?
· 이 공고 우리가 지원할 수 있나?
· 지금 정산하면 반려당할 게 있나?

증빙 사진·PDF 를 채널에 올리면 판독해서 비목을 제안합니다.
멘션·DM·`/rnd <질문>` 셋 다 됩니다."""

_BOT_ID: str | None = None
_LABELS: dict[str, dict[str, str]] | None = None


def bot_id(client) -> str | None:
    global _BOT_ID
    if _BOT_ID is None:
        try:
            _BOT_ID = client.auth_test().get("user_id")
        except Exception as e:
            log.warning("auth_test 실패: %s", e)
    return _BOT_ID


def labels() -> dict[str, dict[str, str]]:
    """비목 코드 → 한글. 화면에 EQUIP_PURCHASE 가 보이면 안 된다."""
    global _LABELS
    if _LABELS is None:
        cats = rest.select("categories", "select=코드,이름")
        subs = rest.select("sub_categories", "select=코드,이름,대분류")
        _LABELS = {
            "cat": {c["코드"]: c["이름"] for c in cats},
            "sub": {s["코드"]: s["이름"] for s in subs},
            "sub_cat": {s["코드"]: s["대분류"] for s in subs},
        }
    return _LABELS


def label_of(대분류: str | None, 세부: str | None) -> str:
    L = labels()
    if not 대분류:
        return "미분류"
    s = L["cat"].get(대분류, 대분류)
    return s + (f" › {L['sub'].get(세부, 세부)}" if 세부 else "")


def clean(text: str, uid: str | None) -> str:
    if uid:
        text = text.replace(f"<@{uid}>", " ")
    return re.sub(r"\s+", " ", text).strip()


def footer(res: chat.ChatResult) -> str:
    s = f"_{res.turns}턴 · {res.seconds:.1f}초_"
    if res.cost_usd:
        s += f" · _${res.cost_usd:.3f}_"
    if not res.ok:
        s += " · _도구 연결 확인 필요_"
    return s


# ─────────────────────────────────────────────────────────────────────────────
# 챗
# ─────────────────────────────────────────────────────────────────────────────
def answer(say, thread_ts: str, question: str) -> None:
    if not question:
        say(text=HELP, thread_ts=thread_ts)
        return
    res = chat.ask(question)
    if not res.ok:
        log.error("chat 실패: %s", res.error)
    say(text=f"{res.text}\n\n{footer(res)}", thread_ts=thread_ts)


@app.event("app_mention")
def on_mention(event, say, client):
    q = clean(event.get("text", ""), bot_id(client))
    log.info("mention: %s", q[:80])
    answer(say, event.get("thread_ts") or event["ts"], q)


@app.command("/rnd")
def on_command(ack, respond, command):
    # ⚠ 3초 안에 ack 하지 않으면 Slack 이 끊는다. 답변은 15초쯤 걸린다.
    ack()
    q = (command.get("text") or "").strip()
    if not q:
        respond(text=HELP, response_type="ephemeral")
        return
    respond(text=f"_{q}_ … 찾아보는 중", response_type="ephemeral")
    res = chat.ask(q)
    respond(text=f"{res.text}\n\n{footer(res)}", response_type="in_channel")


# ─────────────────────────────────────────────────────────────────────────────
# ① 증빙 판독
# ─────────────────────────────────────────────────────────────────────────────
def proposal_blocks(r: dict) -> list[dict]:
    """판독·분류 결과를 Block Kit 으로. **비목만 던지지 않는다** — 근거와 과거 처리를 같이 준다."""
    e, cls = r["expense"], r["분류"]
    conf = float(cls["확신도"])
    품목 = ", ".join(str(i.get("품목명")) for i in r["판독"]["품목"]) or "품목 미상"
    합계 = f"{int(e['합계']):,}원" if e.get("합계") else "금액 미상"

    head = f"*{e.get('거래처') or '거래처 미상'}* · {합계} · {e.get('일자') or '일자 미상'}\n{품목}"
    if r["방향"].startswith("보류"):
        head += f"\n⚠ 거래 방향 {r['방향']} — 자사 사업자번호를 문서에서 못 찾았습니다"

    blocks: list[dict] = [
        {"type": "section", "text": {"type": "mrkdwn", "text": head}},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"→ *{label_of(e.get('비목_대분류'), e.get('비목_세부항목'))}*  (확신도 {conf:.0%})",
            },
        },
    ]

    if cls["근거"]:
        blocks.append(
            {"type": "section", "text": {"type": "mrkdwn", "text": f"*판단 근거*\n{cls['근거'][:800]}"}}
        )

    유사 = past_similar(e.get("비목_세부항목"), e.get("거래처"), e["id"])
    blocks.append(
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": "*우리 회사 과거 처리*\n" + (유사 or "· 유사 이력 없음 — 쌓이면 여기가 채워집니다")},
        }
    )

    # ★ 어느 지원사업에 붙일지. 집행 건이 엉뚱한 사업의 정산 원장에 들어가면 그대로 반려 사유다.
    후보 = r.get("과제후보") or []
    현재 = e.get("과제_id")
    sel: dict = {
        "type": "static_select",
        "action_id": "set_project",
        "placeholder": {"type": "plain_text", "text": "지원사업 선택"},
        "options": project_pick.options(후보),
    }
    if 현재 is not None:
        for o in sel["options"]:
            if o["value"] == str(현재):
                sel["initial_option"] = o
                break
    blocks.append(
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"*지원사업*  {project_pick.name_of(현재)}"
                    if 현재 is not None
                    else f"*지원사업*  _미지정_ — {r.get('과제사유','')}"
                ),
            },
            "accessory": sel,
        }
    )

    if r["불일치"]:
        blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "⚠ *서류 간 금액 불일치*\n```" + json.dumps(r["불일치"], ensure_ascii=False)[:400] + "```"},
            }
        )

    elements = []
    if 현재 is None:
        blocks.append(
            {
                "type": "context",
                "elements": [{"type": "mrkdwn", "text": "⚠ 어느 지원사업에 붙일지 먼저 정해야 확정할 수 있습니다."}],
            }
        )
    if conf >= THRESHOLD and e.get("비목_세부항목") and 현재 is not None:
        elements.append(
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "이대로 확정"},
                "style": "primary",
                "value": str(e["id"]),
                "action_id": "confirm_expense",
            }
        )
    else:
        # ⚠ 확신도 0.70 미만은 자동 확정을 코드가 막는다. 버튼을 아예 내지 않는다.
        blocks.append(
            {
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"확신도 {conf:.0%} — 70% 미만이라 그대로 확정할 수 없습니다. 비목을 직접 정해 주세요."}
                ],
            }
        )
    elements.append(
        {
            "type": "button",
            "text": {"type": "plain_text", "text": "비목 수정"},
            "value": str(e["id"]),
            "action_id": "open_correction",
        }
    )
    blocks.append({"type": "actions", "elements": elements})
    return blocks


def past_similar(세부: str | None, 거래처: str | None, self_id: int) -> str:
    """확정된 건 중 같은 세부항목 또는 같은 거래처 3건. 정정 사유가 있으면 같이 보여준다."""
    try:
        q = "상태=in.(확정,제출,정산완료)&비목_세부항목=not.is.null&select=id,일자,거래처,품목,비목_세부항목&order=일자.desc&limit=40"
        rows = [r for r in rest.select("expenses", q) if r["id"] != self_id]
        hit = [r for r in rows if r["비목_세부항목"] == 세부 or r["거래처"] == 거래처][:3]
        if not hit:
            return ""
        L = labels()
        out = []
        for r in hit:
            품목 = ", ".join(str(i.get("품목명")) for i in (r.get("품목") or []) if isinstance(i, dict))
            out.append(f"· {품목 or r['거래처']} → {L['sub'].get(r['비목_세부항목'], r['비목_세부항목'])} ({r['일자']})")
        return "\n".join(out)
    except Exception as e:
        log.warning("유사 조회 실패: %s", e)
        return ""


def handle_files(event, client, say) -> None:
    """판독은 오래 걸린다(수십 초). 이벤트 스레드를 잡아두지 않는다."""
    ch, ts = event["channel"], event["ts"]
    thread = event.get("thread_ts") or ts

    try:
        client.reactions_add(channel=ch, timestamp=ts, name="hourglass_flowing_sand")
    except Exception:
        pass

    for f in event.get("files") or []:
        try:
            r = evidence_flow.ingest(f, ch, ts)
        except Exception as e:
            log.exception("판독 실패")
            say(text=f"*{f.get('name')}* 판독에 실패했습니다.\n```{str(e)[:300]}```", thread_ts=thread)
            continue

        if r.get("duplicate"):
            say(text=f"*{r['파일명']}* — 이미 등록된 증빙입니다 (집행 #{r['expense_id']}).", thread_ts=thread)
            continue

        say(blocks=proposal_blocks(r), text="증빙 판독 결과", thread_ts=thread)

    try:
        client.reactions_remove(channel=ch, timestamp=ts, name="hourglass_flowing_sand")
        client.reactions_add(channel=ch, timestamp=ts, name="white_check_mark")
    except Exception:
        pass


@app.event("message")
def on_message(event, say, client):
    if event.get("bot_id") or event.get("subtype") in (
        "bot_message", "message_changed", "message_deleted",
    ):
        return

    if event.get("files"):
        threading.Thread(target=handle_files, args=(event, client, say), daemon=True).start()
        return

    if event.get("channel_type") != "im":
        return  # 공개 채널에서는 멘션으로만 답한다. 잡담에 끼어들지 않는다.

    q = clean(event.get("text", ""), None)
    log.info("dm: %s", q[:80])
    answer(say, event.get("thread_ts") or event["ts"], q)


@app.event("file_shared")
def on_file_shared(event, logger):
    logger.debug("file_shared 무시(message 에서 처리): %s", event.get("file_id"))


# ─────────────────────────────────────────────────────────────────────────────
# 확정 · 정정
# ─────────────────────────────────────────────────────────────────────────────
def ai_snapshot(e: dict) -> dict:
    return {
        "비목_대분류": e.get("비목_대분류"),
        "비목_세부항목": e.get("비목_세부항목"),
        "확신도": e.get("ai_확신도"),
        "근거": e.get("ai_근거"),
        "대안": e.get("ai_대안"),
    }


def finish(expense_id: int, user: str) -> list[str]:
    """확정 뒤 처리 — **여기서 Storage 로 올린다.** 확정되지 않은 파일은 쌓지 않는다."""
    rest.update("expenses", {"id": expense_id}, {"상태": "확정"})
    try:
        return evidence_flow.promote_to_storage(expense_id)
    except Exception as e:
        log.exception("Storage 업로드 실패")
        return [f"⚠ 업로드 실패: {e}"]


@app.action("confirm_expense")
def on_confirm(ack, body, client, respond):
    ack()
    eid = int(body["actions"][0]["value"])
    user = body["user"]["id"]
    e = rest.select("expenses", f"id=eq.{eid}&select=*")[0]

    conf = float(e.get("ai_확신도") or 0)
    if conf < THRESHOLD:
        respond(text=f"확신도 {conf:.0%} — 70% 미만은 그대로 확정할 수 없습니다.", replace_original=False)
        return
    if e.get("과제_id") is None:
        respond(text="어느 지원사업에 붙일지 먼저 정해 주세요. 정산 원장이 갈리는 자리입니다.", replace_original=False)
        return

    rest.insert(
        "decisions",
        {
            "expense_id": eid,
            "ai_제안": ai_snapshot(e),
            "확정_비목": e["비목_대분류"],
            "확정_세부항목": e["비목_세부항목"],
            "정정여부": False,
            "확정자": user,
        },
    )
    paths = finish(eid, user)
    respond(
        text=f"✅ 확정 — *{label_of(e['비목_대분류'], e['비목_세부항목'])}*\n"
        + (f"증빙 {len(paths)}건을 보관했습니다." if paths and not str(paths[0]).startswith('⚠') else "\n".join(map(str, paths))),
        replace_original=False,
    )


SUB_OPTIONS_LIMIT = 100


def sub_options() -> list[dict]:
    L = labels()
    opts = []
    for code, name in L["sub"].items():
        cat = L["cat"].get(L["sub_cat"].get(code, ""), "")
        opts.append(
            {"text": {"type": "plain_text", "text": f"{cat} › {name}"[:75]}, "value": code}
        )
    return opts[:SUB_OPTIONS_LIMIT]


@app.action("set_project")
def on_set_project(ack, body, respond):
    """지원사업을 고르면 즉시 반영한다. 확정 때 다시 묻지 않는다."""
    ack()
    eid = None
    try:
        pid = int(body["actions"][0]["selected_option"]["value"])
        # 어느 집행 건인지는 같은 메시지의 버튼 값에서 찾는다
        for blk in body["message"]["blocks"]:
            for el in blk.get("elements", []):
                if el.get("action_id") in ("confirm_expense", "open_correction"):
                    eid = int(el["value"])
                    break
        if eid is None:
            raise RuntimeError("집행 건을 찾지 못했다")
        rest.update("expenses", {"id": eid}, {"과제_id": pid})
        respond(
            text=f"지원사업을 *{project_pick.name_of(pid)}* 로 지정했습니다.",
            replace_original=False,
        )
    except Exception as e:
        log.exception("과제 지정 실패")
        respond(text=f"지원사업 지정에 실패했습니다: {e}", replace_original=False)


@app.action("open_correction")
def on_open_correction(ack, body, client):
    ack()
    eid = body["actions"][0]["value"]
    client.views_open(
        trigger_id=body["trigger_id"],
        view={
            "type": "modal",
            "callback_id": "submit_correction",
            "private_metadata": json.dumps(
                {"expense_id": int(eid), "channel": body["channel"]["id"], "ts": body["message"]["ts"]}
            ),
            "title": {"type": "plain_text", "text": "비목 정정"},
            "submit": {"type": "plain_text", "text": "확정"},
            "close": {"type": "plain_text", "text": "취소"},
            "blocks": [
                {
                    "type": "input",
                    "block_id": "sub",
                    "label": {"type": "plain_text", "text": "올바른 비목"},
                    "element": {
                        "type": "static_select",
                        "action_id": "v",
                        "options": sub_options(),
                    },
                },
                {
                    "type": "input",
                    "block_id": "proj",
                    "label": {"type": "plain_text", "text": "지원사업"},
                    "element": {
                        "type": "static_select",
                        "action_id": "v",
                        "options": project_pick.options(
                            project_pick.candidates(
                                (rest.select("expenses", f"id=eq.{eid}&select=일자")[0] or {}).get("일자")
                            )
                        ),
                    },
                },
                {
                    "type": "input",
                    "block_id": "why",
                    "label": {"type": "plain_text", "text": "왜 다른가요?"},
                    "element": {
                        "type": "radio_buttons",
                        "action_id": "v",
                        "options": [
                            {"text": {"type": "plain_text", "text": "우리 회사는 관행상 이렇게 처리"}, "value": "관행"},
                            {"text": {"type": "plain_text", "text": "규정 해석이 다름"}, "value": "해석"},
                            {"text": {"type": "plain_text", "text": "이 사업만 특수한 사정"}, "value": "과제특수"},
                            {"text": {"type": "plain_text", "text": "품목을 잘못 읽음 (판독 오류)"}, "value": "판독오류"},
                        ],
                    },
                },
                {
                    "type": "input",
                    "block_id": "note",
                    "label": {"type": "plain_text", "text": "한 줄 메모 (필수)"},
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "v",
                        "placeholder": {"type": "plain_text", "text": "예: 연구원 지급 노트북은 사무 겸용이라 운영비로 처리해 왔음"},
                    },
                },
            ],
        },
    )


@app.view("submit_correction")
def on_submit_correction(ack, body, view, client):
    meta = json.loads(view["private_metadata"])
    eid, user = meta["expense_id"], body["user"]["id"]
    vals = view["state"]["values"]
    sub = vals["sub"]["v"]["selected_option"]["value"]
    why = vals["why"]["v"]["selected_option"]["value"]
    note = (vals["note"]["v"]["value"] or "").strip()

    # ★ 사유가 없으면 저장하지 않는다. 화면에서 막고, 여기서 막고, DB 제약이 또 막는다.
    if not note:
        ack(response_action="errors", errors={"note": "왜 고쳤는지 한 줄이 필요합니다. 이게 이 시스템의 전부입니다."})
        return
    ack()

    e = rest.select("expenses", f"id=eq.{eid}&select=*")[0]
    대분류 = labels()["sub_cat"].get(sub)

    rest.insert(
        "decisions",
        {
            "expense_id": eid,
            "ai_제안": ai_snapshot(e),
            "확정_비목": 대분류,
            "확정_세부항목": sub,
            "정정여부": True,
            "정정사유_유형": why,
            "정정사유": note,
            "확정자": user,
        },
    )
    patch = {"비목_대분류": 대분류, "비목_세부항목": sub}
    proj = vals.get("proj", {}).get("v", {}).get("selected_option")
    if proj:
        patch["과제_id"] = int(proj["value"])
    rest.update("expenses", {"id": eid}, patch)
    paths = finish(eid, user)

    client.chat_postMessage(
        channel=meta["channel"],
        thread_ts=meta["ts"],
        text=(
            f"✏️ 정정 확정 — *{label_of(대분류, sub)}*\n"
            f"지원사업: {project_pick.name_of(patch.get('과제_id') or e.get('과제_id'))}\n"
            f"사유({why}): {note}\n"
            + (f"증빙 {len(paths)}건 보관 완료." if paths and not str(paths[0]).startswith("⚠") else "\n".join(map(str, paths)))
            + "\n_이 판단은 다음 분류에 먼저 반영됩니다._"
        ),
    )


if __name__ == "__main__":
    log.info(
        "잔업제로 봇 시작 · MCP=%s · 모델=%s · 임계값=%.2f",
        chat.MCP_CONFIG, chat.MODEL, THRESHOLD,
    )
    SocketModeHandler(app, os.environ["SLACK_APP_TOKEN"]).start()
