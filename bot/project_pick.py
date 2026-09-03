"""증빙을 **어느 지원사업에 붙일지** 정한다.

전에는 과제 id 를 상수로 박아 두었다 — 지원사업이 여럿인데 전부 한 곳에 붙는다.
집행 건이 엉뚱한 사업의 정산 원장에 들어가면 그대로 반려 사유다.

원칙은 다른 곳과 같다 — **계산으로 좁히고, 애매하면 사람에게 넘긴다.**
  · 집행 일자가 협약기간 안에 들어가는 사업만 후보로 둔다.
  · 후보가 하나면 그것을 기본값으로 제안한다(사람이 바꿀 수 있다).
  · 후보가 없거나 둘 이상이면 **기본값을 만들지 않는다.** 고르게 한다.
"""

from __future__ import annotations

import rest

ACTIVE = ("수행", "진행중", "협약", "보고", "심사")


def candidates(일자: str | None) -> list[dict]:
    """집행 일자로 후보를 좁힌다."""
    rows = rest.select(
        "projects", "select=id,과제명,시작일,종료일,상태&order=시작일.desc"
    )
    if not 일자:
        return rows

    inside = [
        r
        for r in rows
        if (not r.get("시작일") or r["시작일"] <= 일자)
        and (not r.get("종료일") or 일자 <= r["종료일"])
    ]
    return inside or rows  # 기간에 맞는 게 없으면 전체를 보여주되 기본값은 안 만든다


def guess(일자: str | None) -> tuple[int | None, list[dict], str]:
    """(기본값, 후보목록, 사유) — 기본값이 None 이면 사람이 골라야 한다."""
    cands = candidates(일자)
    if not cands:
        return None, [], "등록된 지원사업이 없다"

    if 일자:
        inside = [
            r
            for r in cands
            if (not r.get("시작일") or r["시작일"] <= 일자)
            and (not r.get("종료일") or 일자 <= r["종료일"])
        ]
        if len(inside) == 1:
            return inside[0]["id"], cands, f"집행일 {일자} 가 협약기간 안에 드는 사업이 하나뿐"
        if len(inside) > 1:
            return None, cands, f"집행일 {일자} 에 겹치는 사업이 {len(inside)}건 — 골라야 한다"
        return None, cands, f"집행일 {일자} 가 어느 사업의 협약기간에도 안 든다 — 확인 필요"

    return None, cands, "집행 일자를 못 읽어 기간으로 좁힐 수 없다"


def options(cands: list[dict]) -> list[dict]:
    """Slack static_select 용."""
    out = []
    for r in cands[:100]:
        기간 = f"{r.get('시작일') or '?'}~{r.get('종료일') or '?'}"
        out.append(
            {
                "text": {"type": "plain_text", "text": f"{r['과제명']} ({기간})"[:75]},
                "value": str(r["id"]),
            }
        )
    return out


def name_of(pid: int | None) -> str:
    if pid is None:
        return "미지정"
    rows = rest.select("projects", f"id=eq.{pid}&select=과제명")
    return rows[0]["과제명"] if rows else f"#{pid}"
