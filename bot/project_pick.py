"""증빙을 **어느 지원사업에 붙일지** 정한다.

전에는 과제 id 를 상수로 박아 두었다 — 지원사업이 여럿인데 전부 한 곳에 붙는다.
집행 건이 엉뚱한 사업의 정산 원장에 들어가면 그대로 반려 사유다.

원칙은 다른 곳과 같다 — **계산으로 좁히고, 애매하면 사람에게 넘긴다.**

⚠ 2026-09-04 고침: 협약기간으로만 좁혀서 **수행 중인 사업이 목록에서 사라졌다.**
   2024~2025-03 날짜의 세금계산서를 올리면 후보가 종료 과제 3건(3·9·10)만 뜨고,
   지금 수행 중인 6건(2·4·5·6·7·8)이 통째로 빠졌다. `ACTIVE` 는 선언만 돼 있고
   아무도 쓰지 않는 죽은 코드였다. 정정 사유를 「이 사업 것」으로 고를 수가 없으니
   집행 건이 미지정으로 남거나 **종료 과제에 붙는다.**

그래서 좁히는 방식을 바꿨다 — **지우지 않고 순서로 좁힌다.**
  · **수행 중인 사업은 후보에서 빼지 않는다.** 협약 직전 발주·선급금처럼
    집행일이 기간을 벗어나는 건이 실제로 있다.
  · 순서: 수행중·기간 내 → 수행중·기간 밖 → 종료·신청중·기간 내 → 그 밖.
  · **기본값(자동 제안)은 「수행중 + 기간 내」 후보가 딱 하나일 때만** 만든다.
    종료된 사업에 새 집행을 자동으로 붙이면 그게 곧 반려 사유다.
  · 종료·신청중도 목록에서 지우지 않는다 — 과거 정산 건을 뒤늦게 붙이는 일이 있다
    (실제로 과제 3 에 2024-07-03 집행 건이 붙어 있다).
"""

from __future__ import annotations

import rest

# ⚠ DB 가 쓰는 값은 「수행중」이다. "수행" 으로 비교하면 언제나 0 이 나온다.
#   신청중은 활성이 아니다 — 선정 전이라 아직 집행할 돈이 없다. 목록엔 두고 아래로 내린다.
ACTIVE = ("수행중", "진행중", "협약", "협약체결", "보고", "심사")

SELECT = "select=id,과제코드,과제명,시작일,종료일,상태&order=시작일.desc"


def is_active(r: dict) -> bool:
    return (r.get("상태") or "") in ACTIVE


def in_period(r: dict, 일자: str | None) -> bool:
    """집행일이 협약기간 안인가. 일자를 못 읽었으면 판정하지 않는다(False)."""
    if not 일자:
        return False
    return (not r.get("시작일") or r["시작일"] <= 일자) and (
        not r.get("종료일") or 일자 <= r["종료일"]
    )


def _group(r: dict, 일자: str | None) -> int:
    """작을수록 먼저 보여준다. 어느 것도 버리지 않는다."""
    활성, 기간내 = is_active(r), in_period(r, 일자)
    if 활성 and 기간내:
        return 0
    if 활성:
        return 1
    if 기간내:
        return 2
    return 3


def candidates(일자: str | None) -> list[dict]:
    """후보 전체를 **관련도 순으로** 돌려준다. 기간으로 걸러내지 않는다."""
    rows = rest.select("projects", SELECT)
    # PostgREST 가 시작일 내림차순으로 주고, sorted 가 안정 정렬이라 그 순서가 그룹 안에서 유지된다.
    return sorted(rows, key=lambda r: _group(r, 일자))


def guess(일자: str | None) -> tuple[int | None, list[dict], str]:
    """(기본값, 후보목록, 사유) — 기본값이 None 이면 사람이 골라야 한다."""
    cands = candidates(일자)
    if not cands:
        return None, [], "등록된 지원사업이 없다"

    if not 일자:
        return None, cands, "집행 일자를 못 읽어 기간으로 좁힐 수 없다"

    활성기간내 = [r for r in cands if is_active(r) and in_period(r, 일자)]
    if len(활성기간내) == 1:
        return (
            활성기간내[0]["id"],
            cands,
            f"집행일 {일자} 가 협약기간 안에 드는 수행중 사업이 하나뿐",
        )
    if len(활성기간내) > 1:
        return None, cands, f"집행일 {일자} 에 겹치는 수행중 사업이 {len(활성기간내)}건 — 골라야 한다"

    기간내 = [r for r in cands if in_period(r, 일자)]
    if 기간내:
        # 종료된 사업에 새 집행을 자동으로 붙이지 않는다. 사람이 확인해야 한다.
        return (
            None,
            cands,
            f"집행일 {일자} 에 겹치는 사업이 {len(기간내)}건인데 모두 종료·신청중 — 확인 필요",
        )
    return None, cands, f"집행일 {일자} 가 어느 사업의 협약기간에도 안 든다 — 확인 필요"


def _tag(r: dict, 일자: str | None) -> str:
    상태 = r.get("상태") or "상태 미상"
    if is_active(r) and 일자 and not in_period(r, 일자):
        return f"{상태}·기간 밖"
    return 상태


def options(cands: list[dict], 일자: str | None = None) -> list[dict]:
    """Slack static_select 용. 상태를 앞에 붙인다 — 종료 과제를 모르고 고르는 걸 막는다."""
    out = []
    for r in cands[:100]:
        기간 = f"{r.get('시작일') or '?'}~{r.get('종료일') or '?'}"
        out.append(
            {
                "text": {
                    "type": "plain_text",
                    "text": f"[{_tag(r, 일자)}] {r['과제명']}"[:75],
                },
                "description": {
                    "type": "plain_text",
                    "text": f"{r.get('과제코드') or ''} · {기간}".strip(" ·")[:75],
                },
                "value": str(r["id"]),
            }
        )
    return out


def name_of(pid: int | None) -> str:
    if pid is None:
        return "미지정"
    rows = rest.select("projects", f"id=eq.{pid}&select=과제명")
    return rows[0]["과제명"] if rows else f"#{pid}"
