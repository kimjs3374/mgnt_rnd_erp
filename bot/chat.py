"""챗 계층 — claude -p 헤드리스 + MCP.

Slack 봇과 웹 챗이 이 함수 하나를 공유한다. 도구도 프롬프트도 두 벌로 두지 않는다.

⚠ API 키를 쓰지 않는다. Claude Code CLI 를 구독 로그인 상태로 부른다.
⚠ 헤드리스는 호출마다 새 세션이라 프롬프트 캐시가 안 이어진다 — 질문당 약 4만 토큰이다.
   그래서 도구를 필요한 만큼만 열고, 시연 질문은 리허설에서 검증한 것으로 고정한다.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from dataclasses import dataclass

MCP_CONFIG = os.environ.get("RND_MCP_CONFIG", "/rnd/bot/mcp.json")
MODEL = os.environ.get("RND_CHAT_MODEL", "claude-sonnet-5")
TIMEOUT = int(os.environ.get("RND_CHAT_TIMEOUT", "120"))

TOOLS = [
    "category_history",
    "program_ledger",
    "list_projects",
    "budget_status",
    "search_expenses",
    "risk_check",
    "search_announcements",
    "eligibility_check",
    "required_documents",
    "document_status",
    "calc_indirect",
]
ALLOWED = ",".join(f"mcp__rnd__{t}" for t in TOOLS)

SYSTEM = """너는 매그나텍의 지원사업 관리 도우미다.

원칙
- **도구가 준 것만 말한다.** 도구에 없는 수치·날짜·금액을 지어내지 않는다.
- 답에 **근거를 함께 준다.** 어느 도구에서 나온 값인지, 규정 원문이 있으면 그대로 인용한다.
- 모르면 모른다고 한다. 「확인 필요」를 「가능」으로 바꾸지 않는다.
- 사람이 정정한 이력(★)이 있으면 그 판단을 규정보다 우선한다. 우리 회사 관행이기 때문이다.
- 짧게 답한다. 표가 필요하면 표로.

**도구 이름을 사용자에게 보이지 않는다.** 「eligibility_check 로 조회했습니다」가 아니라
「공고 요건을 회사 프로필과 대조했습니다」라고 말한다. 듣는 사람은 개발자가 아니다.

무엇을 할 수 있냐고 물으면 업무 말로 답한다 —
공고를 찾고 우리가 지원 가능한지 요건별로 판정하기 / 제출 서류가 준비됐는지, 만료된 건 없는지 /
지원사업 대장과 진행 단계 / 예산 소진율과 한도 / 과거에 어느 비목으로 처리했고 왜 고쳤는지 /
정산 전 반려 위험 / 간접비 역산.

대상은 국가 R&D 만이 아니라 정부·지자체 **지원사업 전반**이다.
"""


@dataclass
class ChatResult:
    text: str
    ok: bool
    turns: int = 0
    seconds: float = 0.0
    cost_usd: float | None = None
    error: str | None = None


def _claude_bin() -> str:
    return shutil.which("claude") or "/usr/local/bin/claude"


def ask(question: str, *, extra_context: str = "") -> ChatResult:
    """질문 하나를 처리한다. 실패해도 예외를 던지지 않고 ChatResult 로 돌려준다."""
    started = time.monotonic()
    prompt = question if not extra_context else f"{extra_context}\n\n질문: {question}"

    cmd = [
        _claude_bin(),
        "-p",
        prompt,
        "--output-format", "json",
        "--mcp-config", MCP_CONFIG,
        "--strict-mcp-config",
        "--allowed-tools", ALLOWED,
        "--append-system-prompt", SYSTEM,
        "--max-turns", "8",
        "--model", MODEL,
    ]

    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", timeout=TIMEOUT
        )
    except subprocess.TimeoutExpired:
        return ChatResult(
            text="지금은 답할 수 없습니다. (응답 시간 초과)",
            ok=False,
            seconds=time.monotonic() - started,
            error=f"timeout {TIMEOUT}s",
        )

    elapsed = time.monotonic() - started

    if r.returncode != 0:
        return ChatResult(
            text="지금은 답할 수 없습니다.",
            ok=False,
            seconds=elapsed,
            error=(r.stderr or r.stdout or "")[:500],
        )

    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        # 헤드리스가 JSON 이 아닌 것을 뱉는 경우가 있다. 원문을 그대로 살려 둔다.
        return ChatResult(text=r.stdout.strip()[:4000], ok=True, seconds=elapsed)

    # ⚠ is_error 가 false 인데 result 가 빈 경우가 있다.
    #   도구를 못 쓰면 그렇게 나온다 — 성공처럼 보이는 실패다. 여기서 잡는다.
    text = (d.get("result") or "").strip()
    if d.get("is_error") or not text:
        return ChatResult(
            text="지금은 답할 수 없습니다. (도구 연결을 확인해 주세요)",
            ok=False,
            turns=d.get("num_turns", 0),
            seconds=elapsed,
            error=f"is_error={d.get('is_error')} empty={not text}",
        )

    return ChatResult(
        text=text,
        ok=True,
        turns=d.get("num_turns", 0),
        seconds=elapsed,
        cost_usd=d.get("total_cost_usd"),
    )


if __name__ == "__main__":
    import sys

    q = " ".join(sys.argv[1:]) or "우리가 지금 하고 있는 지원사업이 뭐뭐 있지?"
    res = ask(q)
    print(res.text)
    print(
        f"\n— {res.turns}턴 · {res.seconds:.1f}초"
        + (f" · ${res.cost_usd:.4f}" if res.cost_usd else "")
        + ("" if res.ok else f" · 실패: {res.error}")
    )
