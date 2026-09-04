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
import convo
import evidence_flow
import events
import extract
import learn_hook
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
    if not r["판독"].get("_산술검증") and e.get("합계"):
        # 금액이 산술로 확인되지 않았다. 사람이 원본을 봐야 한다.
        head += ("\n⚠ *금액이 검산되지 않았습니다* — 공급가액+세액=합계 관계로 확인하지 "
                 "못했습니다. 원본과 대조해 주세요")
    if r["방향"].startswith("주의"):
        # 우리가 파는 쪽으로 읽혔다. 지출증빙이 아닐 수 있으니 분명히 알린다.
        head += (f"\n⚠ *{r['방향']}* — 이 문서에서는 우리 회사가 공급자입니다. "
                 f"지출 증빙이 맞는지 확인해 주세요")
    elif r["방향"].startswith("보류"):
        head += (f"\n⚠ 거래 방향 {r['방향']} — 자사 사업자번호를 문서에서 못 찾았고 "
                 f"거래처를 특정할 단서도 하나로 좁혀지지 않았습니다")

    # ★ 누가 판단했는지 밝힌다 — 로컬 코드인지 LLM 인지.
    #   심사장에서도, 담당자에게도 이게 보여야 한다. 근거 없는 자동화는 못 믿는다.
    판독출처 = r["판독"].get("_판독") or "LLM vision"
    if r["판독"].get("_경로") == "scan":
        판독출처 += " · OCR"
        if r["판독"].get("_회전"):
            판독출처 += f" (회전 {r['판독']['_회전']}° 보정)"
    elif r["판독"].get("_경로") == "native":
        판독출처 += " · 텍스트레이어"
    if r["판독"].get("_금액방법"):
        판독출처 += f" · 금액 {r['판독']['_금액방법']}"

    분류출처 = cls.get("판단출처") or "LLM"

    # ★ LLM 을 썼으면 **얼마나 썼는지 숫자로** 같이 띄운다. 안 썼으면 그렇다고 적는다.
    #   「의존도를 낮췄다」는 주장은 이 줄이 증거다.
    if cls.get("토큰") or cls.get("비용_usd"):
        tok = f"{int(cls['토큰']):,}토큰" if cls.get("토큰") else ""
        cost = f"${cls['비용_usd']:.4f}" if cls.get("비용_usd") else ""
        sec = f"{cls['소요초']:.1f}초" if cls.get("소요초") else ""
        llm_line = " · ".join(x for x in ("LLM 사용", tok, cost, sec) if x)
    else:
        llm_line = "LLM 미사용 (로컬 처리)"
    ctx_line = f"판독: {판독출처}  |  {llm_line}"
    아이콘 = "🖥" if 분류출처.startswith("로컬") else ("⏸" if 분류출처.startswith("보류") else "🤖")

    blocks: list[dict] = [
        {"type": "section", "text": {"type": "mrkdwn", "text": head}},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"→ *{label_of(e.get('비목_대분류'), e.get('비목_세부항목'))}*  (확신도 {conf:.0%})"
                        f"  ·  {아이콘} *{분류출처}*",
            },
        },
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": ctx_line}],
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
    # ★ 세부항목과 지원사업만 정해지면 버튼을 낸다. **확신도로 사람을 막지 않는다.**
    #   확신도 게이트는 「자동 확정」을 막는 장치다. AI 가 맞췄는데 확신도만 낮은 건이
    #   많고(자체 모델은 대분류만 주므로 0.65 대가 흔하다), 그때 「비목 수정」만 강요하면
    #   맞은 판단이 「정정」으로 기록돼 학습 신호가 오염된다.
    # ★ 세부항목은 **확정 조건이 아니다.** 자체 모델은 대분류까지만 제안하는데
    #   세부항목을 요구하면 AI 판단이 맞아도 원클릭 확정이 영원히 안 된다.
    #   세부항목은 확정 시점에 근거가 있으면 채우고, 없으면 비운 채 넘어간다.
    부족 = _확정_부족항목(e)
    if not 부족:
        elements.append(
            {
                "type": "button",
                "text": {"type": "plain_text",
                         "text": "이대로 확정" if conf >= THRESHOLD else "확인했음 · 이대로 확정"},
                "style": "primary",
                "value": str(e["id"]),
                "action_id": "confirm_expense",
            }
        )
    else:
        # ⚠ 확신도 0.70 미만은 코드가 자동 확정을 막는다(CLAUDE.md §5.3).
        #   다만 **막힌 이유를 정확히 말해야** 담당자가 다음 행동을 안다.
        #   실측에서 「확신도 70% 미만」만 띄웠더니, 실제로는 세부항목이 없어서 막힌
        #   건도 그렇게 보여 확정 버튼이 왜 없는지 알 수 없었다.
        if any("거래처" in x for x in 부족):
            # 스캔 세금계산서는 상호가 좌우 블록으로 뭉쳐 OCR 로 복원이 안 된다.
            # 사업자번호는 정확하므로 사람이 상호만 한 번 적으면 다음부터 자동이다.
            도움 = ("\n*비목 고르고 확정* 을 누르면 거래처 상호를 적을 수 있습니다 — "
                   "한 번만 적으면 사업자번호와 함께 기억해 다음부터 자동으로 채웁니다.")
        elif any("일자" in x or "금액" in x for x in 부족):
            도움 = ("\n일자·금액은 사람이 채울 수 없는 값입니다. 원본이 흐리거나 서식이 특이한 "
                   "경우이니 *버리기* 후 다시 올리거나 담당자에게 알려 주세요.")
        else:
            도움 = "\n아래 *비목 고르고 확정* 을 누르면 세부항목을 골라 바로 확정됩니다."
        blocks.append(
            {
                "type": "context",
                "elements": [
                    {"type": "mrkdwn",
                     "text": "확정할 수 없습니다 — 다음이 비어 있습니다: "
                             + " · ".join(부족) + 도움}
                ],
            }
        )
    elements.append(
        {
            "type": "button",
            # 이름이 「비목 수정」이면 확정 흐름인 줄 모른다. 이 버튼이 곧 확정 경로다.
            "text": {"type": "plain_text", "text": "비목 고르고 확정"},
            "style": "primary" if not elements else None,
            "value": str(e["id"]),
            "action_id": "open_correction",
        }
    )
    # ★ 확정하지 않을 건을 버리는 경로. 이게 없으면 판독 결과와 임시 파일이 영영 남는다.
    #   확정 전에는 Storage 에 아무것도 올라가 있지 않으므로 여기서 지우면 흔적이 없다.
    elements.append(
        {
            "type": "button",
            "text": {"type": "plain_text", "text": "버리기"},
            "style": "danger",
            "value": str(e["id"]),
            "action_id": "discard_expense",
            "confirm": {
                "title": {"type": "plain_text", "text": "이 판독을 버립니다"},
                "text": {"type": "mrkdwn",
                         "text": "판독 결과와 임시 보관 파일을 지웁니다.\n"
                                 "확정된 건이 아니라서 정산 원장에는 영향이 없습니다.\n"
                                 "같은 파일을 다시 올리면 새로 판독합니다."},
                "confirm": {"type": "plain_text", "text": "버리기"},
                "deny": {"type": "plain_text", "text": "취소"},
                "style": "danger",
            },
        }
    )
    # style=None 은 Slack 이 거부한다. 비어 있으면 키 자체를 뺀다.
    for el in elements:
        if el.get("style") is None:
            el.pop("style", None)
    if e.get("비목_대분류") and not e.get("비목_세부항목") and 현재 is not None:
        blocks.append({
            "type": "context",
            "elements": [{"type": "mrkdwn",
                          "text": "ℹ️ 세부항목은 비어 있습니다. *이대로 확정* 하면 근거가 있을 때만 "
                                  "자동으로 채우고, 없으면 비운 채 확정합니다 — "
                                  "대분류만으로도 예산·집행 집계는 됩니다. "
                                  "직접 고르려면 *비목 고르고 확정* 을 누르세요."}],
        })
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


def _expense_in_thread(ch: str, thread_ts: str) -> dict | None:
    """이 스레드가 다루는 집행 건. 여러 건이면 **가장 최근 미확정 건**을 본다.

    한 번에 파일을 여러 개 올리면 한 스레드에 여러 건이 걸린다. 그때 오래된 것까지
    건드리면 엉뚱한 건을 고치게 되므로, 아직 확정되지 않은 마지막 건만 대상으로 한다.
    """
    try:
        rows = rest.select(
            "expenses",
            f"slack_channel=eq.{ch}&slack_ts=eq.{thread_ts}&상태=neq.확정"
            f"&select=*&order=id.desc&limit=1")
    except Exception:
        log.exception("스레드-집행 매칭 실패")
        return None
    return rows[0] if rows else None


def _projects_for(e: dict) -> list[dict]:
    try:
        return project_pick.candidates(e.get("일자"))
    except Exception:
        return []


def _ask_or_summarize(client, ch: str, thread_ts: str, e: dict, *, 최초: bool = False) -> None:
    """다음 질문을 하거나, 다 채워졌으면 최종 확인 카드를 보여준다.

    ⚠ 판독 직후(최초)에 이미 다 채워져 있으면 **아무것도 내지 않는다.** 위에 버튼 카드가
      있는데 최종 확인 카드까지 내면 같은 일을 하는 두 방법이 나란히 떠서 헷갈린다.
      최종 확인은 **대화로 값을 고친 뒤**에 의미가 있다 — 내가 고친 게 맞는지 보는 것이다.
    """
    q = convo.next_question(e)
    if q:
        꼬리 = ("\n_댓글로 답해도 되고, 위 버튼으로 골라도 됩니다._"
              if q[0] in ("비목", "과제") else "")
        client.chat_postMessage(channel=ch, thread_ts=thread_ts, text=q[1] + 꼬리)
        events.log_event(events.ASK, f"「{q[0]}」을(를) 물어봄", expense_id=e.get("id"),
                         필드=q[0])
        return
    if 최초:
        return
    금액경고 = bool(e.get("불일치"))
    client.chat_postMessage(
        channel=ch, thread_ts=thread_ts,
        text=convo.summary(e, labels=labels(),
                           project_name=project_pick.name_of(e.get("과제_id")),
                           금액경고=금액경고))


def handle_thread_reply(event, client) -> bool:
    """증빙 스레드의 사람 댓글. 처리했으면 True.

    ⚠ 아무 스레드에나 끼어들지 않는다 — 이 채널·이 ts 로 등록된 **미확정 집행 건**이
      있을 때만 반응한다. 잡담에 답하면 채널이 못 쓰게 된다.
    """
    ch = event.get("channel")
    thread_ts = event.get("thread_ts")
    if not (ch and thread_ts):
        return False
    e = _expense_in_thread(ch, thread_ts)
    if not e:
        return False

    user = event.get("user")
    text = (event.get("text") or "").strip()
    묻는중 = (convo.next_question(e) or (None, None))[0]
    동작, 값 = convo.parse_reply(text, 묻는중)

    if 동작 == "무시":
        return True

    if 동작 == "메모":
        if not (값 or "").strip():
            client.chat_postMessage(channel=ch, thread_ts=thread_ts,
                                    text="메모 내용을 같이 적어 주세요. 예: `메모: 3명분 일괄 결제`")
            return True
        events.log_event(events.COMMENT, 값.strip()[:300],
                         expense_id=e["id"], 행위자=uname(client, user), 원문=text[:400])
        client.chat_postMessage(channel=ch, thread_ts=thread_ts,
                                text=f"💬 메모를 남겼습니다  ·  <@{user}>")
        _ask_or_summarize(client, ch, thread_ts, e)
        return True

    if 동작 == "이력":
        client.chat_postMessage(
            channel=ch, thread_ts=thread_ts,
            text=f"*집행 #{e['id']} 처리 이력*\n" + events.render(events.history(e["id"])))
        return True

    if 동작 == "버리기":
        try:
            events.log_event(events.DISCARD, "사람이 버림(대화)",
                             expense_id=e["id"], 행위자=uname(client, user))
            msg = evidence_flow.discard(e["id"])
            client.chat_postMessage(channel=ch, thread_ts=thread_ts,
                                    text=f"🗑 버렸습니다 — {msg}  ·  <@{user}>")
        except Exception as ex:
            client.chat_postMessage(channel=ch, thread_ts=thread_ts,
                                    text=f"버리지 못했습니다: {ex}")
        return True

    if 동작 == "확정":
        부족 = _확정_부족항목(e)
        if 부족:
            client.chat_postMessage(
                channel=ch, thread_ts=thread_ts,
                text="아직 확정할 수 없습니다 — 다음이 비어 있습니다: " + " · ".join(부족))
            _ask_or_summarize(client, ch, thread_ts, e)
            return True
        _확정하기(client, ch, thread_ts, e, user)
        return True

    if 동작 == "모름":
        client.chat_postMessage(
            channel=ch, thread_ts=thread_ts,
            text="무엇을 고치려는지 모르겠습니다. `금액: 880000` 처럼 적어 주세요.\n"
                 "`확정` 이라고 답하면 지금 값으로 확정합니다.")
        return True

    # 값 반영
    res = convo.apply_answer(동작, 값, labels=labels(), projects=_projects_for(e))
    if isinstance(res, str):                       # 되묻기
        client.chat_postMessage(channel=ch, thread_ts=thread_ts, text=res)
        return True
    patch, 확인 = res
    # ★ 합계·공급가액·세액은 한 덩어리다. 하나만 고치면 원장이 어긋난다.
    이전_patch = dict(patch)
    patch = _금액정합(e, patch)
    if patch != 이전_patch:
        따라감 = [k for k in ("합계", "공급가액", "세액") if k in patch and k not in 이전_patch]
        if 따라감:
            확인 += (" " + " · ".join(
                f"{k} {int(patch[k]):,}원" for k in 따라감) + " 도 같이 맞췄습니다.")
    이전 = {k: e.get(k) for k in patch}
    try:
        rest.update("expenses", {"id": e["id"]}, patch)
    except Exception as ex:
        log.exception("집행 갱신 실패")
        client.chat_postMessage(channel=ch, thread_ts=thread_ts, text=f"저장하지 못했습니다: {ex}")
        return True
    # 거래처 상호를 사람이 적었으면 사전에도 남긴다 — 다음부터 번호만 맞으면 자동이다.
    if "거래처" in patch:
        _remember_vendor_name(e, patch["거래처"])
    # ★ 사람이 고친 값을 남긴다. 지금까지 이게 아무 데도 안 남았다 —
    #   「AI 가 뭘 제안했고 사람이 뭘로 바꿨는지」가 이 시스템의 값어치다.
    events.log_event(events.EDIT, 확인.replace("*", ""), expense_id=e["id"],
                     행위자=uname(client, user), 답변=text[:200], 이전=이전, 새값=patch)
    client.chat_postMessage(channel=ch, thread_ts=thread_ts, text=f"✍️ {확인}  ·  <@{user}>")
    _ask_or_summarize(client, ch, thread_ts, dict(e, **patch))
    return True


def _remember_vendor_name(e: dict, 상호: str) -> None:
    """사람이 적어 준 상호를 거래처 사전에 남긴다. 실패해도 대화는 계속된다."""
    brn = (e.get("거래처_사업자번호") or "").strip()
    if len(brn) != 10:
        return
    try:
        기존 = rest.select("vendors", f"사업자번호=eq.{brn}&select=사업자번호")
        row = {"업체명": 상호[:150]}
        if e.get("비목_대분류"):
            row["비목_대분류"] = e["비목_대분류"]
        if 기존:
            rest.update("vendors", {"사업자번호": brn}, row)
        else:
            rest.insert("vendors", dict(row, 사업자번호=brn))
        log.info("거래처 사전 등록: %s %s", brn, 상호)
    except Exception:
        log.exception("거래처 사전 등록 실패(무시)")


def _확정하기(client, ch: str, thread_ts: str, e: dict, user: str) -> None:
    """대화로 확정한다. 버튼 경로(on_confirm)와 **같은 일**을 한다."""
    sub = e.get("비목_세부항목")
    sub_note = ""
    if not sub:
        sub, why = _fill_sub(e["비목_대분류"], e.get("거래처"))
        if sub:
            rest.update("expenses", {"id": e["id"]}, {"비목_세부항목": sub})
            sub_note = f"\n_세부항목은 {why} «{labels()['sub'].get(sub, sub)}» 로 넣었습니다._"
        else:
            sub_note = "\n_세부항목은 비워 뒀습니다 — 근거 없이 채우지 않습니다._"
    rest.insert("decisions", {
        "expense_id": e["id"],
        "ai_제안": ai_snapshot(e),
        "확정_비목": e["비목_대분류"],
        "확정_세부항목": sub,
        "정정여부": False,
        "확정자": user,
    })
    events.log_event(events.CONFIRM,
                     f"확정(대화) — {label_of(e['비목_대분류'], sub)}",
                     expense_id=e["id"], 행위자=uname(client, user), 비목=e["비목_대분류"],
                     세부항목=sub, 거래처=e.get("거래처"), 합계=e.get("합계"))
    paths = finish(e["id"], user)
    client.chat_postMessage(
        channel=ch, thread_ts=thread_ts,
        text=(f"✅ 확정 — *{label_of(e['비목_대분류'], sub)}*  ·  <@{user}>{sub_note}\n"
              f"거래처 {e.get('거래처')} · {int(e['합계']):,}원 · {e.get('일자')}\n"
              + (f"증빙 {len(paths)}건을 보관했습니다."
                 if paths and not str(paths[0]).startswith("⚠") else "\n".join(map(str, paths)))
              + "\n_이 확정이 다음 분류의 근거로 쌓입니다._"))
    # 확정 직후 이력을 한 번 보여준다 — 「무엇이 근거였나」의 답이 그대로 스레드에 남는다.
    client.chat_postMessage(
        channel=ch, thread_ts=thread_ts,
        text=f"*집행 #{e['id']} 처리 이력*\n" + events.render(events.history(e["id"])))


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
            r = evidence_flow.ingest(f, ch, ts, 올린이=uname(client, event.get("user")))
        except Exception as e:
            log.exception("판독 실패")
            say(text=f"*{f.get('name')}* 판독에 실패했습니다.\n```{str(e)[:300]}```", thread_ts=thread)
            continue

        if r.get("duplicate"):
            say(text=f"*{r['파일명']}* — 이미 등록된 증빙입니다 (집행 #{r['expense_id']}).", thread_ts=thread)
            continue

        say(blocks=proposal_blocks(r), text="증빙 판독 결과", thread_ts=thread)
        # ★ 부족한 게 있으면 **바로 물어본다.** 버튼만 두면 판독이 부실한 건이
        #   막다른 길이 된다 — 거래처를 못 읽으면 고칠 방법을 모른다.
        try:
            _ask_or_summarize(client, ch, thread, r["expense"], 최초=True)
            # ★ 메모는 **선택이지만 권한다.** 「왜 이렇게 처리했나」를 나중에 찾을 때
            #   가장 도움이 되는 건 그때 적어 둔 한 줄이다. 필수로 만들면 아무 말이나
            #   적게 된다(정정 사유에서 겪었다).
            client.chat_postMessage(
                channel=ch, thread_ts=thread,
                text=("💬 이 증빙에 남길 *메모*가 있으면 적어 주세요 — 선택입니다.\n"
                      "예) `메모: 학회 참가비 3명분 일괄 결제, 개인분은 제외`\n"
                      "_남기지 않아도 확정할 수 있지만, 나중에 「왜 이렇게 처리했나」를 "
                      "찾을 때 이 한 줄이 가장 도움이 됩니다._"))
        except Exception:
            log.exception("첫 질문 실패(무시)")

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

    # ★ 증빙 스레드의 댓글이면 대화로 처리한다. 등록된 미확정 집행 건이 있을 때만
    #   반응하므로 잡담에 끼어들지 않는다.
    if event.get("thread_ts"):
        try:
            if handle_thread_reply(event, client):
                return
        except Exception:
            log.exception("스레드 대화 처리 실패")

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



def _with_confirm(msg_blocks: list[dict], e: dict, pid: int) -> list[dict]:
    """이미 보낸 제안 메시지에 **확정 버튼을 끼워 넣고** 지원사업 표시를 갱신한다.

    제안을 처음부터 다시 만들지 않는다 — 판독 결과는 그때뿐이고, 여기서 필요한 건
    「지원사업이 정해졌다」는 사실 하나다. 블록을 그대로 두고 바뀐 부분만 손댄다.
    """
    conf = float(e.get("ai_확신도") or 0)
    out = []
    for b in msg_blocks:
        b = dict(b)
        # 지원사업 줄 — 이름을 채우고 고른 값을 선택 상태로
        if b.get("type") == "section" and b.get("accessory", {}).get("action_id") == "set_project":
            b["text"] = {"type": "mrkdwn", "text": f"*지원사업*  {project_pick.name_of(pid)}"}
            acc = dict(b["accessory"])
            for o in acc.get("options", []):
                if o.get("value") == str(pid):
                    acc["initial_option"] = o
                    break
            b["accessory"] = acc
        # 「지원사업을 먼저 정하라」는 안내는 이제 맞지 않는다
        if b.get("type") == "context":
            t = " ".join(el.get("text", "") for el in b.get("elements", []))
            if "어느 지원사업에 붙일지" in t or t.startswith("확정하려면"):
                continue
        # 버튼 줄에 확정 버튼을 넣는다
        if b.get("type") == "actions":
            els = [dict(el) for el in b.get("elements", [])]
            if not any(el.get("action_id") == "confirm_expense" for el in els):
                if e.get("비목_대분류"):
                    els.insert(0, {
                        "type": "button",
                        "text": {"type": "plain_text",
                                 "text": "이대로 확정" if conf >= THRESHOLD else "확인했음 · 이대로 확정"},
                        "style": "primary",
                        "value": str(e["id"]),
                        "action_id": "confirm_expense",
                    })
                    for el in els:
                        if el.get("action_id") == "open_correction":
                            el.pop("style", None)
            b["elements"] = els
        out.append(b)
    return out


_UNAME: dict[str, str] = {}
# 스코프(users:read)가 없을 때 쓰는 매핑. 팀은 네 명이라 파일 하나로 충분하다.
_UMAP_PATH = os.environ.get("RND_SLACK_USERS", "/rnd/bot/slack_users.json")
_UMAP: dict[str, str] | None = None


def _umap() -> dict[str, str]:
    """Slack ID → 이름 매핑 파일. 없으면 빈 표."""
    global _UMAP
    if _UMAP is None:
        try:
            # utf-8-sig: Windows 에서 저장하면 BOM 이 붙는다. 그것 때문에
            # 매핑을 통째로 못 읽어 이름이 ID 로 남은 적이 있다.
            with open(_UMAP_PATH, encoding="utf-8-sig") as f:
                _UMAP = {k: str(v) for k, v in json.load(f).items()}
        except FileNotFoundError:
            _UMAP = {}
        except Exception:
            log.exception("사용자 매핑 파일을 읽지 못했다: %s", _UMAP_PATH)
            _UMAP = {}
    return _UMAP


def uname(client, uid: str | None) -> str | None:
    """Slack 표시 이름. **이력에는 ID 가 아니라 이름을 남긴다.**

    `U0BUSMY21UL` 은 Slack 안에서만 이름으로 렌더된다 — 웹 모달에서는 그대로 보여
    누가 한 일인지 알 수 없다.

    조회 순서: ① Slack API → ② 매핑 파일 → ③ ID 그대로.
    ①이 안 되는 이유는 스코프다(`users:read` 가 없다). 앱에 스코프를 붙이고 재설치하면
    ①이 살아나고 파일은 그냥 남아 있어도 무해하다.
    """
    if not uid:
        return None
    if uid in _UNAME:
        return _UNAME[uid]
    nm = None
    try:
        u = (client.users_info(user=uid) or {}).get("user") or {}
        p = u.get("profile") or {}
        nm = (p.get("display_name") or p.get("real_name")
              or u.get("real_name") or u.get("name")) or None
    except Exception as e:
        # 스코프 부족은 설정 문제라 매번 스택을 찍을 필요가 없다. 한 줄로 남긴다.
        if "missing_scope" in str(e):
            log.warning("users:read 스코프가 없어 매핑 파일로 이름을 찾는다 (%s)", uid)
        else:
            log.exception("사용자 이름 조회 실패: %s", uid)
    if not nm:
        nm = _umap().get(uid) or uid
    _UNAME[uid] = nm
    return nm


def _thread_post(client, body, text: str) -> bool:
    """버튼이 눌린 메시지의 **스레드에 댓글로** 남긴다.

    확정·정정·버리기는 이력이다. `respond()` 로 보내면 「나에게만 표시」되는 임시
    메시지라 새로고침하면 사라지고 다른 사람은 보지도 못한다.
    """
    try:
        msg = body.get("message") or {}
        ch = (body.get("channel") or {}).get("id")
        ts = msg.get("thread_ts") or msg.get("ts")
        if not (ch and ts):
            return False
        client.chat_postMessage(channel=ch, thread_ts=ts, text=text)
        return True
    except Exception:
        log.exception("스레드 댓글 실패 — 임시 메시지로 대체한다")
        return False


def _금액정합(e: dict, patch: dict) -> dict:
    """합계·공급가액·세액 중 하나를 고치면 나머지를 맞춘 patch 를 돌려준다.

    셋은 한 덩어리다. 하나만 고치면 원장에 앞뒤가 안 맞는 숫자가 남는다 —
    실측: 합계만 8,439,640 으로 고쳤는데 공급가액 4,064,000 · 세액 406,400 이 그대로였다.

    ⚠ 면세(세액 0 이고 공급가액 == 합계)는 그대로 둔다. 없는 세금을 지어내지 않는다.
    """
    키 = {"합계", "공급가액", "세액"} & set(patch)

    def i(v):
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    if len(키) != 1:
        # 공급가액·세액을 둘 다 말했으면 합계는 **그 둘의 합**이다. 계산이지 추측이 아니다.
        if {"공급가액", "세액"} <= set(patch):
            s, v = i(patch["공급가액"]), i(patch["세액"])
            if s is not None and v is not None:
                return dict(patch, 합계=s + v)
        return patch
    바꾼 = 키.pop()

    def _i2(v):
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    옛합, 옛공, 옛세 = i(e.get("합계")), i(e.get("공급가액")), i(e.get("세액"))
    면세 = (옛세 == 0 and 옛공 is not None and 옛공 == 옛합)

    out = dict(patch)
    if 바꾼 == "합계":
        t = i(patch["합계"])
        if t is None:
            return patch
        if 면세:
            out["공급가액"], out["세액"] = t, 0
        else:
            v = round(t / 11)
            out["공급가액"], out["세액"] = t - v, v
    elif 바꾼 == "공급가액":
        s = i(patch["공급가액"])
        if s is None:
            return patch
        v = 0 if 면세 else round(s / 10)
        out["세액"], out["합계"] = v, s + v
    else:                                  # 세액
        v = i(patch["세액"])
        if v is None or 옛공 is None:
            return patch
        out["합계"] = 옛공 + v
    return out


def _확정_부족항목(e: dict) -> list[str]:
    """확정에 반드시 있어야 하는 것들 중 **비어 있는 것**을 돌려준다.

    ⚠ 판독이 실패한 건을 확정하면 거래처 없는 집행이 원장에 들어간다 — 정산에서
      그대로 반려된다. 예전에는 거래처·일자가 비어도 버튼이 나왔다.
    세부항목은 여기 없다. 자체 모델은 대분류까지만 제안하고, 없어도 예산 집계는 된다.
    """
    없음 = []
    if not (e.get("거래처") or "").strip():
        brn = (e.get("거래처_사업자번호") or "").strip()
        없음.append("*거래처 상호*" + (f" (사업자번호 {brn[:3]}-{brn[3:5]}-{brn[5:]} 는 읽었습니다)"
                                    if len(brn) == 10 else " — 상호도 사업자번호도 못 찾았습니다"))
    if not e.get("일자"):
        없음.append("*일자*")
    if not e.get("합계"):
        없음.append("*금액*")
    if not e.get("비목_대분류"):
        없음.append("*비목*")
    if e.get("과제_id") is None:
        없음.append("*지원사업*")
    return 없음


def _fill_sub(대분류: str, 거래처: str | None) -> tuple[str | None, str]:
    """세부항목을 사람이 안 골랐을 때 **근거가 있을 때만** 채운다.

    ⓪ 그 대분류에 세부항목이 없거나 하나뿐이면 자명하다(인건비·연구수당·학생인건비).
    ① 같은 거래처를 같은 대분류로 확정한 적이 있으면 그때 사람이 고른 세부항목을 쓴다.
    그 밖에는 **비운다.** 최빈값으로 채우면 장비 구입 건에 재료비를 붙이는 식이 된다 —
    모르면 모른다고 하는 게 낫다(CLAUDE.md 설계원칙 4·5). 대분류만으로도 예산 집계는 된다.
    """
    L = labels()
    후보 = [c for c, cat in L["sub_cat"].items() if cat == 대분류]
    if not 후보:
        return None, "이 비목엔 세부항목이 없습니다"
    if len(후보) == 1:
        return 후보[0], "이 비목의 세부항목이 하나뿐이라"
    if 거래처:
        try:
            rows = extract._q(
                """
                select 비목_세부항목 as sub, count(*) as n
                  from app.expenses
                 where 거래처 = %s and 비목_대분류 = %s and 비목_세부항목 is not null
                 group by 1 order by n desc limit 1
                """,
                (거래처, 대분류),
            )
        except Exception:
            log.exception("세부항목 이력 조회 실패")
            rows = []
        if rows:
            return rows[0]["sub"], f"같은 거래처를 같은 비목으로 확정한 {rows[0]['n']}건을 따라"
    return None, ""


def _정정인가(e: dict, 대분류: str | None, sub: str | None) -> bool:
    """사람이 고른 값이 AI 제안과 다른가.

    같으면 **동의**(정정여부 False), 다르면 **정정**(True).
    자체 모델은 대분류만 제안하므로 세부항목만 채운 경우는 정정이 아니다 —
    대분류가 그대로면 AI 는 맞은 것이다.
    """
    ai_cat = e.get("비목_대분류")
    ai_sub = e.get("비목_세부항목")
    if ai_sub:                       # AI 가 세부항목까지 냈다면 그것과 비교한다
        return (ai_cat, ai_sub) != (대분류, sub)
    return bool(ai_cat) and ai_cat != 대분류

def finish(expense_id: int, user: str) -> list[str]:
    """확정 뒤 처리 — **여기서 Storage 로 올린다.** 확정되지 않은 파일은 쌓지 않는다."""
    rest.update("expenses", {"id": expense_id}, {"상태": "확정"})
    try:
        paths = evidence_flow.promote_to_storage(expense_id)
    except Exception as e:
        log.exception("Storage 업로드 실패")
        paths = [f"⚠ 업로드 실패: {e}"]
    # ★ 사람이 확정한 것으로 **모델을 다시 학습한다.** 업로드가 실패해도 판단 기록은
    #   이미 남았으므로 학습은 돌린다. 봇을 멈추지 않는 별도 스레드다.
    try:
        learn_hook.schedule(f"expense {expense_id} 확정")
    except Exception:
        log.exception("재학습 예약 실패 — 확정 자체는 정상")
    return paths


@app.action("confirm_expense")
def on_confirm(ack, body, client, respond):
    ack()
    eid = int(body["actions"][0]["value"])
    user = body["user"]["id"]
    e = rest.select("expenses", f"id=eq.{eid}&select=*")[0]

    conf = float(e.get("ai_확신도") or 0)
    # ⚠ 확신도 게이트는 **자동 확정**을 막는 장치지 사람을 막는 장치가 아니다.
    #   AI 가 맞췄는데 확신도만 낮은 건이 실제로 많다(자체 모델은 대분류만 주므로 0.65 대가 흔하다).
    #   그럴 때 「비목 수정」만 강요하면 맞은 판단이 「정정」으로 기록돼 **학습 신호가 오염된다.**
    #   사람이 눈으로 확인하고 누르는 버튼이므로 확신도로 막지 않는다 — 대신 기록에 남긴다.
    if e.get("상태") == "확정":
        # 대화로 확정한 뒤 위쪽 버튼이 그대로 남아 있다. 누르면 이력이 두 번 쌓인다.
        respond(text="이미 확정된 건입니다.", replace_original=False)
        return
    부족 = _확정_부족항목(e)
    if 부족:
        # 판독이 실패한 건을 확정하면 거래처 없는 집행이 원장에 들어간다.
        respond(text="확정할 수 없습니다 — 다음이 비어 있습니다: " + " · ".join(부족),
                replace_original=False)
        return

    # 세부항목이 비어 있으면 근거가 있을 때만 채운다. 없으면 비운 채 확정한다.
    sub = e.get("비목_세부항목")
    if sub:
        sub_note = ""
    else:
        sub, why = _fill_sub(e["비목_대분류"], e.get("거래처"))
        if sub:
            rest.update("expenses", {"id": eid}, {"비목_세부항목": sub})
            sub_note = (f"\n_세부항목은 {why} *{labels()['sub'].get(sub, sub)}* 로 넣었습니다 — "
                        f"다르면 «비목 고르고 확정» 으로 바꿔 주세요._")
        else:
            sub_note = ("\n_세부항목은 비워 뒀습니다. 근거 없이 채우지 않습니다 — "
                        "대분류만으로도 예산·집행 집계는 됩니다._")

    rest.insert(
        "decisions",
        {
            "expense_id": eid,
            "ai_제안": ai_snapshot(e),
            "확정_비목": e["비목_대분류"],
            "확정_세부항목": sub,
            # AI 제안 그대로 확정 = **동의**. 정정이 아니다. 재학습에서 이 구분이 중요하다.
            "정정여부": False,
            "확정자": user,
        },
    )
    events.log_event(events.CONFIRM,
                     f"확정(버튼) — {label_of(e['비목_대분류'], sub)}",
                     expense_id=eid, 행위자=uname(client, user), 비목=e["비목_대분류"],
                     세부항목=sub, 확신도=conf, 정정여부=False)
    paths = finish(eid, user)
    저확신 = ("\n_확신도 {:.0%} 였지만 사람이 확인해 확정했습니다 — 이 동의도 학습에 들어갑니다._"
             .format(conf) if conf < THRESHOLD else
             "\n_이 동의가 다음 분류의 근거로 쌓입니다._")
    msg = (f"✅ 확정 — *{label_of(e['비목_대분류'], sub)}*  ·  <@{user}>{sub_note}{저확신}\n"
           + (f"증빙 {len(paths)}건을 보관했습니다."
              if paths and not str(paths[0]).startswith('⚠') else "\n".join(map(str, paths))))
    # ★ 스레드에 남긴다. 확정은 이력이다 — 임시 메시지로 흘려보내면 안 된다.
    if not _thread_post(client, body, msg):
        respond(text=msg, replace_original=False)


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
def on_set_project(ack, body, respond, client):
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
        # ★ 원본 메시지를 다시 그린다. 예전에는 DB 만 고치고 새 메시지를 덧붙여서,
        #   **지원사업을 골라도 확정 버튼이 나타나지 않았다.** 이게 「확정 버튼이 없다」의
        #   진짜 원인이었다.
        e = rest.select("expenses", f"id=eq.{eid}&select=*")[0]
        respond(blocks=_with_confirm(body["message"]["blocks"], e, pid),
                text=f"지원사업을 {project_pick.name_of(pid)} 로 지정했습니다.",
                replace_original=True)
        events.log_event(events.PROJECT,
                         f"지원사업을 「{project_pick.name_of(pid)}」로 지정",
                         expense_id=eid, 행위자=uname(client, body["user"]["id"]), 과제_id=pid)
        # 어느 사업에 붙였는지도 이력이다. 정산 원장이 갈리는 자리다.
        _thread_post(client, body,
                     f"📌 지원사업을 *{project_pick.name_of(pid)}* 로 지정했습니다  ·  "
                     f"<@{body['user']['id']}>")
    except Exception as e:
        log.exception("과제 지정 실패")
        respond(text=f"지원사업 지정에 실패했습니다: {e}", replace_original=False)


@app.action("discard_expense")
def on_discard(ack, body, respond, client):
    """확정하지 않을 건을 버린다. **확정 전에는 Storage 에 아무것도 없다** — 흔적이 남지 않는다."""
    ack()
    eid = int(body["actions"][0]["value"])
    try:
        msg = evidence_flow.discard(eid)
    except Exception as e:
        log.exception("버리기 실패")
        respond(text=f"버리지 못했습니다: {e}", replace_original=False)
        return
    user = body["user"]["id"]
    # 버린 것도 이력이다 — 무엇을 왜 안 올렸는지가 나중에 질문이 된다.
    _thread_post(client, body, f"🗑 버렸습니다 — {msg}  ·  <@{user}>")
    respond(text=f"🗑 버렸습니다 — {msg}", replace_original=True, blocks=[])


@app.action("open_correction")
def on_open_correction(ack, body, client):
    ack()
    eid = body["actions"][0]["value"]
    _e = (rest.select("expenses", f"id=eq.{eid}&select=거래처,거래처_사업자번호") or [{}])[0]
    _brn = _e.get("거래처_사업자번호") or ""
    _brn_view = (f"{_brn[:3]}-{_brn[3:5]}-{_brn[5:]}" if len(_brn) == 10 else (_brn or "못 읽음"))
    # ★ 상호를 못 읽는 건 스캔 세금계산서의 구조 문제다(좌우 블록이 한 줄로 뭉친다).
    #   번호는 정확하므로, 사람이 상호를 한 번만 적어 주면 vendors 에 남아 다음부터 자동이다.
    _vendor_block = {
        "type": "input",
        "block_id": "vendor",
        "optional": bool((_e.get("거래처") or "").strip()),
        "label": {"type": "plain_text", "text": "거래처 상호"},
        "hint": {"type": "plain_text",
                 "text": f"사업자번호 {_brn_view} · 한 번 적어 주시면 다음부터 자동으로 채웁니다"},
        "element": {
            "type": "plain_text_input",
            "action_id": "v",
            "initial_value": (_e.get("거래처") or "")[:150] or None,
            "placeholder": {"type": "plain_text", "text": "예: 주식회사 에스비티엘첨단소재"},
        },
    }
    if _vendor_block["element"]["initial_value"] is None:
        _vendor_block["element"].pop("initial_value")
    client.views_open(
        trigger_id=body["trigger_id"],
        view={
            "type": "modal",
            "callback_id": "submit_correction",
            "private_metadata": json.dumps(
                {"expense_id": int(eid), "channel": body["channel"]["id"], "ts": body["message"]["ts"]}
            ),
            # 이 모달은 정정 전용이 아니다. 세부항목을 고르거나 거래처를 채우고
            # **그대로 확정**하는 길이기도 하다. 제목이 「정정」이면 그걸 오해한다.
            "title": {"type": "plain_text", "text": "확인하고 확정"},
            "submit": {"type": "plain_text", "text": "확정"},
            "close": {"type": "plain_text", "text": "취소"},
            "blocks": [
                _vendor_block,
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
                    # ★ AI 제안 그대로 확정하는 경우엔 쓸 사유가 없다. 제출 시점에
                    #   **다를 때만** 요구한다(억지 사유는 정정 이력을 오염시킨다).
                    "optional": True,
                    "label": {"type": "plain_text", "text": "왜 다른가요? (비목을 바꿀 때만)"},
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
                    "optional": True,
                    "label": {"type": "plain_text", "text": "한 줄 메모 (비목을 바꿀 때만 필수)"},
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
    _why_sel = vals.get("why", {}).get("v", {}).get("selected_option")
    why = _why_sel["value"] if _why_sel else None
    note = (vals.get("note", {}).get("v", {}).get("value") or "").strip()

    e = rest.select("expenses", f"id=eq.{eid}&select=*")[0]
    대분류 = labels()["sub_cat"].get(sub)

    # ★ **AI 제안을 바꿀 때만** 사유를 요구한다.
    #   그대로 확정하거나 세부항목만 고르거나 거래처만 채우는 경우엔 쓸 사유가 없다.
    #   억지로 적게 하면 정정 이력이 오염되고, 그게 곧 학습 재료라 모델까지 망가진다.
    정정 = _정정인가(e, 대분류, sub)
    if 정정:
        if not note:
            ack(response_action="errors",
                errors={"note": "비목을 바꾸셨습니다. 왜 고쳤는지 한 줄이 필요합니다 — "
                                "이 기록이 다음 판단의 근거가 됩니다."})
            return
        if not why:
            ack(response_action="errors", errors={"why": "어떤 이유인지 하나 골라 주세요."})
            return
    ack()

    rest.insert(
        "decisions",
        {
            "expense_id": eid,
            "ai_제안": ai_snapshot(e),
            "확정_비목": 대분류,
            "확정_세부항목": sub,
            # ★ AI 가 낸 값과 같으면 **정정이 아니라 동의**다.
            #   세부항목이 비어 있어 모달을 거친 것뿐인데 전부 「정정」으로 남기면
            #   「AI 가 틀렸다」는 기록이 쌓여 재학습이 엉뚱한 쪽으로 간다.
            "정정여부": 정정,
            "정정사유_유형": why if 정정 else None,
            # 동의 건은 빈 문자열이 아니라 NULL 로 둔다 — 사유가 없다는 뜻이다.
            "정정사유": note or None,
            "확정자": user,
        },
    )
    events.log_event(events.CORRECT if 정정 else events.CONFIRM,
                     (f"정정 확정 — {label_of(대분류, sub)} (사유 {why}: {note[:60]})"
                      if 정정 else f"확정(모달) — {label_of(대분류, sub)}"),
                     expense_id=eid, 행위자=uname(client, user), 비목=대분류, 세부항목=sub,
                     정정여부=정정, 사유유형=why, 사유=note or None,
                     ai제안=ai_snapshot(e))
    patch = {"비목_대분류": 대분류, "비목_세부항목": sub}
    # ★ 사람이 적어 준 상호를 저장하고 거래처 사전에도 남긴다. 다음부터는 번호만 맞으면 자동.
    상호 = (vals.get("vendor", {}).get("v", {}).get("value") or "").strip()
    if 상호 and 상호 != (e.get("거래처") or ""):
        patch["거래처"] = 상호[:150]
        brn = (e.get("거래처_사업자번호") or "").strip()
        if len(brn) == 10:
            try:
                기존 = rest.select("vendors", f"사업자번호=eq.{brn}&select=사업자번호")
                if 기존:
                    rest.update("vendors", {"사업자번호": brn},
                                {"업체명": 상호[:150], "비목_대분류": 대분류})
                else:
                    rest.insert("vendors", {"사업자번호": brn, "업체명": 상호[:150],
                                            "비목_대분류": 대분류})
                log.info("거래처 사전 등록: %s %s", brn, 상호)
            except Exception:
                log.exception("거래처 사전 등록 실패(확정은 계속)")
    proj = vals.get("proj", {}).get("v", {}).get("selected_option")
    if proj:
        patch["과제_id"] = int(proj["value"])
    rest.update("expenses", {"id": eid}, patch)
    paths = finish(eid, user)

    client.chat_postMessage(
        channel=meta["channel"],
        thread_ts=meta["ts"],
        text=(
            (f"✏️ 정정 확정 — *{label_of(대분류, sub)}*" if 정정
             else f"✅ 확인하고 확정 — *{label_of(대분류, sub)}*")
            + f"  ·  <@{user}>\n"
            f"지원사업: {project_pick.name_of(patch.get('과제_id') or e.get('과제_id'))}\n"
            # 사유는 **정정일 때만** 찍는다. 동의 건에 「사유(None):」이 남으면
            # 이력을 읽는 사람이 뭘 고쳤다는 건지 헷갈린다.
            + (f"사유({why}): {note}\n" if 정정 and note else "")
            + (f"거래처: {patch['거래처']}\n" if patch.get("거래처") else "")
            + (f"증빙 {len(paths)}건 보관 완료." if paths and not str(paths[0]).startswith("⚠") else "\n".join(map(str, paths)))
            + ("\n_이 정정이 다음 분류에 먼저 반영됩니다._" if 정정
               else "\n_이 동의도 학습에 들어갑니다._")
        ),
    )


if __name__ == "__main__":
    log.info(
        "잔업제로 봇 시작 · MCP=%s · 모델=%s · 임계값=%.2f",
        chat.MCP_CONFIG, chat.MODEL, THRESHOLD,
    )
    SocketModeHandler(app, os.environ["SLACK_APP_TOKEN"]).start()
