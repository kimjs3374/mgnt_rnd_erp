# Slack 앱 새로 만들기 — 붙여넣기 한 번

> **앱 생성을 가장 먼저 한다.** 워크스페이스 설정에 따라 관리자 승인이 필요할 수 있고,
> 그러면 현장에서 몇 시간이 날아간다.

## 1. 앱 생성

`api.slack.com/apps` → **Create New App** → **From an app manifest**
→ 워크스페이스 선택 → `manifest.json` 붙여넣기 → Create.

manifest 로 만들면 스코프·이벤트·Socket Mode·슬래시 커맨드가 **한 번에** 들어간다.
하나씩 클릭해 넣지 않는다.

## 2. 토큰 두 개

| 토큰 | 어디서 | 용도 |
|---|---|---|
| `xapp-…` | Basic Information → App-Level Tokens → Generate<br>스코프 **`connections:write`** | Socket Mode 연결 |
| `xoxb-…` | **Install to Workspace** 후 OAuth & Permissions | 봇 API 호출 |

`/rnd/docker/.env` 에 넣는다.
```
SLACK_BOT_TOKEN=xoxb-…
SLACK_APP_TOKEN=xapp-…
WATCHED_CHANNEL_IDS=C…        # 쉼표로 여러 개
```

## 3. 채널

채널을 만들고 **봇을 초대한다** — `/invite @잔업제로`.
채널 ID 는 채널명 클릭 → 맨 아래에 있다.

## 4. 점검 — 띄우기 전에 먼저 한다

```bash
cd /web/rnd/bot
set -a; . /rnd/docker/.env; . /rnd/bot/.env.mcp; set +a
/rnd/bot/venv/bin/python slack/check.py
```

토큰 형식 → 인증 → 스코프 → 채널 참여 → 발신 → Socket Mode 를 순서대로 본다.
**무엇이 빠졌는지 알려준다.** 「안 되는데 왜 안 되는지 모르겠다」를 만들지 않는 것이 목적이다.

## 5. 기동

```bash
sudo systemctl restart rnd-bot
sudo journalctl -u rnd-bot -f
```

채널에서 `@잔업제로 우리가 지금 하는 지원사업 뭐뭐 있지?` → 답이 오면 끝.

---

## manifest 에 들어간 것

**스코프 11** — `app_mentions:read` `channels:history` `channels:read` `chat:write`
`commands` `files:read` `groups:history` `groups:read` `im:history` `im:write` `reactions:write`

**이벤트 5** — `app_mention` `file_shared` `message.channels` `message.groups` `message.im`

**슬래시 커맨드 1** — `/rnd <질문>`

**Socket Mode 켜짐** — 공개 HTTPS 엔드포인트가 필요 없다.
현장 네트워크에서 그대로 동작하고 데모 중 터널링·배포 사고 위험이 없다.

### ⚠ 이전 manifest 에서 뺀 것과 그 이유

| 뺀 것 | 왜 |
|---|---|
| `/6pm-예산` · `/6pm-정산` | **구현이 없었다.** 선언만 하면 눌렀을 때 `dispatch_failed` 가 뜬다. 시연에서 최악이다 |
| 메시지 단축키 「집행 등록」 | 같은 이유. 핸들러가 없다 |
| `files:write` `reactions:read` `users:read` | 지금 코드가 안 쓴다. **최소 권한으로 간다** |

**선언한 것은 전부 구현돼 있다.** 기능을 늘릴 때 manifest 와 코드를 같이 고친다.

---

## MCP 연결 — 봇과 웹이 같은 서버를 쓴다

```
[Slack 봇]  ─┐
             ├─→ chat.ask() ─→ claude -p --mcp-config ─→ [MCP 서버] ─→ Postgres
[웹 챗]     ─┘                                            도구 11개
```

| 파일 | 무엇 |
|---|---|
| `bot/mcp_server.py` | MCP 서버. 도구 11개. **`mcp.run()` 은 반드시 파일 맨 끝** |
| `bot/chat.py` | `claude -p` + MCP 래퍼. 봇과 웹이 공유 |
| `/rnd/bot/mcp.json` | 도구 서버 실행 설정. DSN 이 들어 있어 **600, 저장소에 안 올린다** |
| `/rnd/bot/.env.mcp` | `RND_DSN` — 읽기 전용 계정 `rnd_mcp` |

**도구 검증은 LLM 없이 한다.** 한도를 한 토큰도 안 쓴다:
```bash
/rnd/bot/venv/bin/python bot/tools_check.py
```

### ⚠ 실제로 걸린 함정

| 함정 | 증상 |
|---|---|
| mcp 2.x 에서 `FastMCP` → **`MCPServer`** 개명 | **서버가 죽는데 에러가 안 보인다.** 모델이 "연결 실패한 것 같다"고만 말한다 |
| 도구 이름에 **한글 불가** (`A-Za-z0-9_-`만) | 경고만 나고 도구가 안 잡힌다. **docstring 은 한글 OK** |
| `mcp.run()` 아래에 도구 정의 | 그 아래가 통째로 등록 안 됨. **에러 없음** |
| `claude mcp list` 에 `--mcp-config` | `unknown option`. `-p` 와만 쓴다 |
| `--allowed-tools "Read"` 를 빼고 파일 읽히기 | **빈 응답이 `is_error:false` 로** 돌아온다. 성공처럼 보인다 |

**헤드리스는 호출마다 새 세션이라 프롬프트 캐시가 안 이어진다** — 질문당 약 4만 토큰.
사소한 질문에도 $0.05 가 든다. 시연 질문은 리허설에서 검증한 것으로 고정한다.

---

## 시연 주의

**심사위원을 워크스페이스에 초대하지 않는다.** 마찰이 크다.
**웹 ERP 가 주 심사 대상**이고 심사용 계정도 웹에 둔다. Slack 은 팀이 직접 시연해 보여준다.
