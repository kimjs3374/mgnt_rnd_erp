"""MCP 도구 검증 — LLM 없이 한다. 한도를 한 토큰도 안 쓴다.

claude 를 부르면 한도만 쓰고 원인도 안 보인다. 현장 디버깅은 이걸로 한다.
서버가 죽어도 모델은 "연결에 실패한 것 같다"고만 말하는데, 여기서는 실제 예외가 보인다.

    /rnd/bot/venv/bin/python /rnd/bot/tools_check.py
"""

import asyncio
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

HERE = os.path.dirname(os.path.abspath(__file__))

# 도구별 시험 인자. None 이면 인자 없이 부른다.
CASES: list[tuple[str, dict]] = [
    ("program_ledger", {}),
    ("list_projects", {}),
    ("document_status", {}),
    ("category_history", {"keyword": "노트북"}),
    ("category_history", {"keyword": "아이퍼스"}),
    ("search_expenses", {"keyword": "소재"}),
    ("budget_status", {"project_id": 1}),
    ("risk_check", {"project_id": 1}),
    ("search_announcements", {"keyword": ""}),
    ("eligibility_check", {"announcement_id": 1}),
    ("required_documents", {"announcement_id": 1}),
    ("calc_indirect", {"직접비": 88_000_000, "비율": 10.0}),
    ("collection_status", {}),
    ("collect_progress", {}),
    ("rule_eligibility_scan", {}),
    ("rule_eligibility_check", {"announcement_id": 15}),
    # ⚠ 이 한 건만 실제로 바깥에 나간다. **NTIS 를 고른 이유는 claude 를 안 부르기 때문이다**
    #   (오픈API → upsert 로 끝난다). IRIS·기업마당으로 시험하면 검증 한 번에 헤드리스
    #   호출이 여러 번 나가 한도를 쓴다 — 규칙 §4.5 「도구 검증은 LLM 없이」.
    ("collect_announcements", {"source": "NTIS", "limit": 3, "wait_seconds": 60}),
]


async def main() -> int:
    params = StdioServerParameters(
        command=sys.executable,
        args=[os.path.join(HERE, "mcp_server.py")],
        env={**os.environ},
    )

    async with stdio_client(params) as (r, w), ClientSession(r, w) as s:
        await s.initialize()

        tools = await s.list_tools()
        names = sorted(t.name for t in tools.tools)
        print(f"등록된 도구 {len(names)}개")
        for n in names:
            print(f"  · {n}")

        # 도구 이름에 한글이 있으면 등록조차 안 된다. 미리 잡는다.
        bad = [n for n in names if not all(c.isascii() and (c.isalnum() or c in "_-") for c in n)]
        if bad:
            print(f"\n⚠ 이름 규칙 위반: {bad}")
            return 1

        print("\n호출 시험")
        fails = 0
        for name, args in CASES:
            if name not in names:
                print(f"  ✗ {name}: 등록 안 됨")
                fails += 1
                continue
            try:
                res = await s.call_tool(name, args)
                text = "".join(
                    getattr(c, "text", "") for c in res.content
                ).strip()
                head = text.splitlines()[0] if text else "(빈 응답)"
                mark = "✓" if text else "✗"
                if not text:
                    fails += 1
                label = f"{name}({', '.join(f'{k}={v!r}' for k, v in args.items())})"
                print(f"  {mark} {label[:52]:<52} → {head[:70]}")
            except Exception as e:
                print(f"  ✗ {name}: {type(e).__name__}: {e}")
                fails += 1

        print(f"\n실패 {fails}건 / 시험 {len(CASES)}건")
        return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
