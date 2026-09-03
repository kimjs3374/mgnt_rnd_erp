"""잔업제로 Slack 봇 — 메신저가 프론트엔드인 ERP.

사람은 ERP 화면에 안 들어온다. 그게 자료를 개인 PC 에 두는 이유고
공유폴더가 정착하지 못한 이유다. 그래서 **입력은 Slack, 축적은 DB, 조회는 웹**으로 가른다.

이 봇은 웹 챗과 **같은 MCP 서버·같은 chat.ask() 를 공유한다.** 도구를 두 벌로 만들지 않는다.

⚠ 봇은 서버 한 대에서만 실행한다.
   같은 앱 토큰으로 여러 곳이 Socket Mode 에 붙으면 이벤트가 랜덤하게 한 곳에만 간다.
   에러가 안 나서 원인 찾기가 최악이다. 각자 돌려보려면 개발용 앱을 따로 만든다.

⚠ manifest 에 선언한 기능은 전부 여기 구현돼 있어야 한다.
   선언만 하고 핸들러가 없으면 슬래시 커맨드가 dispatch_failed 로 죽는다. 시연에서 최악이다.
"""

from __future__ import annotations

import logging
import os
import re

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

import chat

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rnd-bot")

app = App(token=os.environ["SLACK_BOT_TOKEN"])

WATCHED = {
    c.strip() for c in os.environ.get("WATCHED_CHANNEL_IDS", "").split(",") if c.strip()
}

HELP = """안녕하세요. 지원사업 관리 도우미입니다.

이런 걸 물어보세요
· 우리가 지금 하는 지원사업 뭐뭐 있지?
· 작년에 노트북 뭘로 처리했지?
· 아이퍼스 특허 비용 두 건이 왜 다르지?
· 이 공고 우리가 지원할 수 있나?
· 지금 정산하면 반려당할 게 있나?
· 간접비 얼마로 잡아야 해?

증빙 사진·PDF 를 채널에 올리면 판독해서 비목을 제안합니다.
`/rnd <질문>` 으로도 물을 수 있습니다."""

_BOT_ID: str | None = None


def bot_id(client) -> str | None:
    """auth.test 를 매번 부르지 않는다. 멘션마다 API 를 때릴 이유가 없다."""
    global _BOT_ID
    if _BOT_ID is None:
        try:
            _BOT_ID = client.auth_test().get("user_id")
        except Exception as e:  # 네트워크가 흔들려도 답변은 계속돼야 한다
            log.warning("auth_test 실패: %s", e)
    return _BOT_ID


def clean(text: str, uid: str | None) -> str:
    if uid:
        text = text.replace(f"<@{uid}>", " ")
    return re.sub(r"\s+", " ", text).strip()


def footer(res: chat.ChatResult) -> str:
    """소요·비용을 같이 띄운다. 발표 지표로 그대로 쓴다."""
    s = f"_{res.turns}턴 · {res.seconds:.1f}초_"
    if res.cost_usd:
        s += f" · _${res.cost_usd:.3f}_"
    if not res.ok:
        s += " · _도구 연결 확인 필요_"
    return s


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
    # ⚠ 3초 안에 ack 하지 않으면 Slack 이 시간초과로 끊는다.
    #   답변은 15초쯤 걸리므로 먼저 ack 하고 response_url 로 나중에 보낸다.
    ack()
    q = (command.get("text") or "").strip()
    if not q:
        respond(text=HELP, response_type="ephemeral")
        return
    respond(text=f"_{q}_ … 찾아보는 중", response_type="ephemeral")
    res = chat.ask(q)
    respond(text=f"{res.text}\n\n{footer(res)}", response_type="in_channel")


@app.event("message")
def on_message(event, say, client):
    # 봇 자신·수정·삭제 이벤트는 무시한다. 안 그러면 자기 말에 답한다.
    if event.get("bot_id") or event.get("subtype") in (
        "bot_message",
        "message_changed",
        "message_deleted",
    ):
        return

    files = event.get("files") or []
    thread = event.get("thread_ts") or event["ts"]

    if files:
        # 처리 중 표시를 먼저 단다. 재시도 대기가 정지처럼 보이면 안 된다.
        try:
            client.reactions_add(
                channel=event["channel"], timestamp=event["ts"], name="hourglass_flowing_sand"
            )
        except Exception:
            pass  # 리액션 실패로 본 흐름을 막지 않는다
        names = ", ".join(f.get("name", "?") for f in files)
        say(
            text=f"파일 {len(files)}건 받았습니다 ({names}).\n증빙 판독은 아직 붙이는 중입니다.",
            thread_ts=thread,
        )
        return

    is_dm = event.get("channel_type") == "im"
    if not is_dm:
        # 공개 채널에서는 멘션으로만 답한다. 잡담에 끼어들지 않는다.
        return

    q = clean(event.get("text", ""), None)
    log.info("dm: %s", q[:80])
    answer(say, thread, q)


@app.event("file_shared")
def on_file_shared(event, logger):
    # message 이벤트에서 이미 처리한다. 여기서 또 답하면 두 번 답한다.
    logger.debug("file_shared 무시(message 에서 처리): %s", event.get("file_id"))


if __name__ == "__main__":
    log.info(
        "잔업제로 봇 시작 · MCP=%s · 모델=%s · 감시채널=%s",
        chat.MCP_CONFIG,
        chat.MODEL,
        ",".join(WATCHED) or "(제한 없음)",
    )
    SocketModeHandler(app, os.environ["SLACK_APP_TOKEN"]).start()
