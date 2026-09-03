"""bot/project_pick.py 후보 목록 검사 — 「수행중 사업이 목록에서 사라지지 않는가」

왜 이 파일이 있는가: 협약기간으로만 좁히던 때, 2024~2025-03 날짜의 세금계산서를 올리면
Slack 후보가 **종료 과제 3건만** 떴다. 수행중 6건이 통째로 빠져서 고를 수가 없었다.
같은 일이 다시 생기는지 여기서 잡는다.

rest.select 를 실제 DB 값으로 대신 채워 넣는다(서비스 키 없이 논리만 본다).

    /rnd/bot/venv/bin/python tests/project-pick-check.py
"""

from __future__ import annotations

import os
import sys

os.environ.setdefault("SERVICE_ROLE_KEY", "test-only-not-used")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bot"))

import project_pick  # noqa: E402
import rest  # noqa: E402

# app.projects 실측(2026-09-04). 과제명은 짧게 줄였다 — 길이 자르기까지 보려고 하나는 길게 뒀다.
ROWS = [
    (12, "RS-2026-00552310", "분리막 코팅 세라믹 슬러리 분산 안정화 기술", "2026-10-01", "2027-09-30", "신청중"),
    (11, "RS-2026-00551777", "이차전지 소재 국제공동연구(한-독) 실리콘 복합음극재 양산성 검증 및 표준화 공동연구", "2026-09-01", "2028-08-31", "신청중"),
    (8, "RS-2026-00544301", "원통형 21700 셀 열폭주 지연 케이스 부자재", "2026-06-01", "2027-05-31", "수행중"),
    (4, "RS-2026-00521130", "지역 주력산업 연계 이동형 태양광 ESS 실증", "2026-05-01", "2028-04-30", "수행중"),
    (7, "RS-2026-00530012", "배터리 셀 조립공정 AI 비전 검사 시스템 개발", "2026-03-01", "2027-02-28", "수행중"),
    (5, "RS-2026-00521204", "전고체 전지용 황화물계 고체전해질 습식 합성", "2026-01-01", "2027-12-31", "수행중"),
    (6, "RS-2025-00398877", "폐리튬이온전지 흑연 재생 및 재활용 공정 실증", "2025-07-01", "2026-12-31", "수행중"),
    (2, "RS-2025-00410021", "커피박 유래 실리콘 복합음극재 기반 고에너지밀도", "2025-04-01", "2027-03-31", "수행중"),
    (9, "RS-2024-00351902", "수계 바인더 적용 친환경 음극 슬러리 배합 최적", "2024-05-01", "2026-04-30", "종료"),
    (10, "RS-2024-00344115", "고출력 셀용 알루미늄 집전체 표면처리 기술 개발", "2024-03-01", "2025-12-31", "종료"),
    (3, "RS-2023-00305514", "커피박 바이오매스 활용 이차전지 음극 소재 예비", "2023-04-01", "2025-03-31", "종료"),
    (13, "RS-2022-00284460", "리튬이온전지 전해액 첨가제 스크리닝 자동화", "2022-06-01", "2024-05-31", "종료"),
]
활성 = {8, 4, 7, 5, 6, 2}


def fake_select(table: str, query: str = ""):
    assert table == "projects", table
    if "id=eq." in query:
        pid = int(query.split("id=eq.")[1].split("&")[0])
        return [{"과제명": r[2]} for r in ROWS if r[0] == pid]
    # 실제 호출과 같은 순서(시작일 내림차순)로 준다
    return [
        {"id": r[0], "과제코드": r[1], "과제명": r[2], "시작일": r[3], "종료일": r[4], "상태": r[5]}
        for r in ROWS
    ]


rest.select = fake_select
project_pick.rest = rest

fails: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("  ok   " if cond else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(name)


print("① 회귀 — 2024-11-20 (예전에 종료 3건만 떴던 날짜)")
pid, cands, why = project_pick.guess("2024-11-20")
ids = [r["id"] for r in cands]
check("후보에 12건 전부 남는다", len(cands) == 12, f"{len(cands)}건")
check("수행중 6건이 모두 목록에 있다", 활성 <= set(ids), f"빠진 것 {sorted(활성 - set(ids))}")
check("수행중 6건이 목록 맨 앞", set(ids[:6]) == 활성, f"앞 6건 {ids[:6]}")
check("기본값을 만들지 않는다", pid is None, str(pid))
check("사유가 종료·신청중임을 말한다", "종료·신청중" in why, why)

print("② 기간에 겹치는 수행중이 여럿 — 2026-05-14 (시연 노트북 건)")
pid, cands, why = project_pick.guess("2026-05-14")
ids = [r["id"] for r in cands]
check("기본값 없음", pid is None, str(pid))
check("기간 내 수행중 5건이 맨 앞", set(ids[:5]) == {2, 4, 5, 6, 7}, str(ids[:5]))
check("기간 밖 수행중(8) 이 그 다음", ids[5] == 8, str(ids[5]))
check("사유에 건수가 있다", "5건" in why, why)

print("③ 기간에 겹치는 수행중이 하나 — 2028-01-01")
pid, cands, why = project_pick.guess("2028-01-01")
check("그 하나를 기본값으로 제안", pid == 4, str(pid))
check("사유가 하나뿐임을 말한다", "하나뿐" in why, why)

print("④ 어느 협약기간에도 안 드는 날짜 — 2020-01-01")
pid, cands, why = project_pick.guess("2020-01-01")
ids = [r["id"] for r in cands]
check("기본값 없음", pid is None, str(pid))
check("후보는 그대로 12건", len(cands) == 12)
check("수행중이 먼저 온다", set(ids[:6]) == 활성, str(ids[:6]))
check("사유가 기간 밖임을 말한다", "안 든다" in why, why)

print("⑤ 일자를 못 읽은 경우")
pid, cands, why = project_pick.guess(None)
ids = [r["id"] for r in cands]
check("기본값 없음", pid is None, str(pid))
check("수행중이 먼저 온다", set(ids[:6]) == 활성, str(ids[:6]))
check("사유가 일자 미상임을 말한다", "일자" in why, why)

print("⑥ Slack static_select 형식")
cands = project_pick.candidates("2024-11-20")
opts = project_pick.options(cands, "2024-11-20")
check("옵션 수 = 후보 수", len(opts) == len(cands), f"{len(opts)}/{len(cands)}")
check("Slack 100개 제한 안", len(opts) <= 100)
check("text 75자 이하", all(len(o["text"]["text"]) <= 75 for o in opts))
check("description 75자 이하", all(len(o["description"]["text"]) <= 75 for o in opts))
check("value 는 과제 id 문자열", all(o["value"].isdigit() for o in opts))
check("맨 앞 옵션에 수행중 표시가 붙는다", opts[0]["text"]["text"].startswith("[수행중"), opts[0]["text"]["text"])
check(
    "종료 과제는 [종료] 로 표시된다",
    any(o["text"]["text"].startswith("[종료]") for o in opts),
)
check("description 에 과제코드가 있다", "RS-" in opts[0]["description"]["text"], opts[0]["description"]["text"])
기간밖 = [o for o in opts if "기간 밖" in o["text"]["text"]]
check("기간 밖 수행중은 그렇게 표시된다", len(기간밖) == 6, f"{len(기간밖)}건")
check(
    "일자를 안 주면 기간 밖 표시를 하지 않는다",
    all("기간 밖" not in o["text"]["text"] for o in project_pick.options(cands)),
)

print("⑦ 상태 어휘 — 「수행」이 아니라 「수행중」")
check("수행중은 활성", project_pick.is_active({"상태": "수행중"}))
check("종료는 활성 아님", not project_pick.is_active({"상태": "종료"}))
check("신청중은 활성 아님 — 선정 전이라 집행할 돈이 없다", not project_pick.is_active({"상태": "신청중"}))
check("상태 없음도 죽지 않는다", not project_pick.is_active({}))

print("⑧ name_of")
check("id 로 과제명", project_pick.name_of(2).startswith("커피박 유래"), project_pick.name_of(2))
check("None 은 미지정", project_pick.name_of(None) == "미지정")
check("없는 id 는 #id", project_pick.name_of(999) == "#999", project_pick.name_of(999))

print()
if fails:
    print(f"✗ 실패 {len(fails)}건: {fails}")
    sys.exit(1)
print("✓ 전 항목 통과")
