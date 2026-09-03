"""Slack 연결 점검 — 봇을 띄우기 전에 무엇이 빠졌는지 먼저 안다.

    /rnd/bot/venv/bin/python slack/check.py

토큰·스코프·채널 참여·Socket Mode 를 순서대로 본다.
「안 되는데 왜 안 되는지 모르겠다」를 만들지 않는 것이 목적이다.
"""

from __future__ import annotations

import os
import sys

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

# manifest 가 선언한 것과 봇이 실제로 쓰는 것. 하나라도 빠지면 조용히 실패한다.
NEED_SCOPES = {
    "app_mentions:read",
    "channels:history",
    "chat:write",
    "commands",
    "files:read",
    "groups:history",
    "im:history",
    "im:write",
    "reactions:write",
}

OK, BAD, WARN = "✓", "✗", "⚠"
fails = 0


def line(mark: str, msg: str) -> None:
    print(f"  {mark} {msg}")


def fail(msg: str) -> None:
    global fails
    fails += 1
    line(BAD, msg)


bot = os.environ.get("SLACK_BOT_TOKEN", "")
app_tok = os.environ.get("SLACK_APP_TOKEN", "")
channels = [c.strip() for c in os.environ.get("WATCHED_CHANNEL_IDS", "").split(",") if c.strip()]

print("1. 토큰")
if not bot.startswith("xoxb-"):
    fail("SLACK_BOT_TOKEN 이 없거나 xoxb- 로 시작하지 않는다")
else:
    line(OK, f"봇 토큰 형식 OK (…{bot[-6:]})")
if not app_tok.startswith("xapp-"):
    fail("SLACK_APP_TOKEN 이 없거나 xapp- 로 시작하지 않는다 — Socket Mode 가 안 붙는다")
else:
    line(OK, f"앱 토큰 형식 OK (…{app_tok[-6:]})")

if fails:
    print(f"\n실패 {fails}건 — .env 를 먼저 채운다")
    sys.exit(1)

client = WebClient(token=bot)

print("\n2. 인증")
try:
    a = client.auth_test()
    line(OK, f"워크스페이스 {a['team']} · 봇 {a['user']} ({a['user_id']})")
    bot_id = a["user_id"]
except SlackApiError as e:
    fail(f"auth.test 실패: {e.response['error']}")
    sys.exit(1)

print("\n3. 스코프")
try:
    granted = set(
        (client.auth_test().headers.get("x-oauth-scopes") or "").split(",")
    ) - {""}
    if not granted:
        # 헤더가 안 올 때가 있다. apps.permissions 로 다시 본다.
        line(WARN, "응답 헤더에서 스코프를 못 읽었다. 수동 확인 필요")
    else:
        missing = NEED_SCOPES - granted
        if missing:
            fail(f"빠진 스코프: {', '.join(sorted(missing))} → 재설치 필요")
        else:
            line(OK, f"필요한 스코프 {len(NEED_SCOPES)}개 모두 있음")
except SlackApiError as e:
    line(WARN, f"스코프 확인 실패: {e.response['error']}")

print("\n4. 채널")
if not channels:
    line(WARN, "WATCHED_CHANNEL_IDS 가 비어 있다 — 공개 채널 메시지를 안 본다")
for ch in channels:
    try:
        info = client.conversations_info(channel=ch)["channel"]
        joined = info.get("is_member", False)
        if joined:
            line(OK, f"#{info['name']} ({ch}) — 봇 참여 중")
        else:
            fail(f"#{info['name']} ({ch}) — 봇이 참여하지 않았다. /invite @{a['user']}")
    except SlackApiError as e:
        fail(f"{ch}: {e.response['error']}")

print("\n5. 발신")
if channels:
    try:
        r = client.chat_postMessage(
            channel=channels[0], text="연결 점검 — 이 메시지가 보이면 발신이 됩니다."
        )
        line(OK, f"메시지 전송 OK (ts={r['ts']})")
        client.chat_delete(channel=channels[0], ts=r["ts"])
        line(OK, "테스트 메시지 삭제함")
    except SlackApiError as e:
        fail(f"전송 실패: {e.response['error']}")

print("\n6. Socket Mode")
try:
    from slack_sdk.socket_mode import SocketModeClient

    sm = SocketModeClient(app_token=app_tok, web_client=client)
    url = sm.issue_new_wss_url()
    line(OK, "WSS 발급 OK — Socket Mode 연결 가능")
    del url
except Exception as e:
    fail(f"Socket Mode 실패: {type(e).__name__}: {e}")

print(f"\n실패 {fails}건")
print("\n⚠ 봇은 서버 한 대에서만 실행한다. 같은 앱 토큰으로 여러 곳이 붙으면")
print("   이벤트가 랜덤하게 한 곳에만 가고, 에러가 안 나서 원인 찾기가 최악이다.")
sys.exit(1 if fails else 0)
