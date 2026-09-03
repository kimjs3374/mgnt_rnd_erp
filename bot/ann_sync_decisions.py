"""규칙 엔진 판정을 eligibility_decisions 에 반영한다 — LLM 호출 0회.

왜 새 테이블을 만들지 않고 기존 eligibility_decisions 에 넣나
  화면(components/eligibility-confirm.tsx)·서버 액션(app/actions/eligibility.ts)·
  판정계산/점수계산(lib/queries.ts)이 전부 이 테이블 하나만 본다. ai_제안 이 jsonb라
  {점수, 근거, 확인필요항목, 원판정} 모양만 맞추면 **프론트 코드를 한 줄도 안 고쳐도**
  규칙엔진 판정이 그대로 화면에 뜬다. 새 테이블을 만들면 그 화면들을 전부 다시
  짜야 하고, 오늘(9/4 14:30 마감) 그럴 시간이 없다.

절대 하지 않는 것 — 판단 우선순위 1층을 지킨다
  이미 사람이 확인/정정한 공고(정정여부=true 인 최신 행)는 **절대 덮어쓰지 않는다.**
  CLAUDE.md 판단 우선순위: 정정 이력 > 과거 집행 > 규정 > 일반 상식. 규칙엔진이
  아무리 최신이어도 사람 판단보다 세지 않다.

비교는 지우지 않는 것으로 한다
  eligibility_decisions 는 추가만 하는 이력 테이블이다(created_at 오름차순으로 쌓는다).
  규칙엔진 행을 기존 LLM 행 "뒤에" 추가하면 화면은 최신(규칙엔진)을 보여주고,
  LLM 이 예전에 뭐라고 했는지는 이 스크립트가 아래에서 report() 로 대조해 보여준다
  (app.v_ann_rule_vs_llm 뷰, 이미 만들어 둔 것을 그대로 쓴다).

요건미확인은 넣지 않는다
  넣으면 lib/queries.ts 판정계산() 이 "확인필요"로 승격시켜버린다(가능/불가가 아니면
  전부 확인필요로 묶는 기존 로직). 요건미확인은 확인필요보다 아래 등급이라는 구분이
  화면에서 사라진다 — 그래서 요건미확인 221건은 그대로 두고, 기존 로직(행이 아예
  없으면 요건미확인)이 계속 그 상태를 정확히 보여주게 둔다.

사용법
  python3 bot/ann_sync_decisions.py           동기화 실행
  python3 bot/ann_sync_decisions.py --dry     몇 건이 바뀔지만 본다(쓰지 않는다)
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ann_features as F
import rest

# 해당없음을 넣는다(2026-09-04). 위 「요건미확인은 넣지 않는다」의 이유는 판정계산()이
# 가능/불가가 아닌 값을 전부 「확인필요」로 묶어버리는 것이었는데, 그 로직을 고쳐
# 「해당없음」은 그대로 통과시킨다(lib/queries.ts·lib/queries-programs.ts). 화면도 이 등급을
# 5번째로 그리고(announcement-detail.tsx), 목록에서는 「불가」와 같이 접는다
# (announcements-view.tsx). 그래서 이제 넣어야 실제로 걸러진다 —
# 사용자 지적: 공고 488 "이 건은 네트워킹 강연인데 걸러내지를 못하고".
# 요건미확인은 여전히 뺀다(그 값은 아직 판정계산에서 확인필요로 승격된다).
INCLUDE = ("가능", "불가", "확인필요", "해당없음")


def _latest_decision(announcement_id: int) -> dict | None:
    rows = rest.select(
        "eligibility_decisions",
        f"select=*&announcement_id=eq.{announcement_id}&order=created_at.desc&limit=1",
    )
    return rows[0] if rows else None


def _이미_동기화됨(latest: dict | None, r: dict) -> bool:
    """같은 엔진버전·같은 판정을 이미 규칙엔진 출처로 반영해뒀으면 다시 안 넣는다."""
    if not latest:
        return False
    제안 = latest.get("ai_제안") or {}
    return (
        제안.get("판정경로") == "규칙"
        and 제안.get("엔진버전") == r["엔진버전"]
        and latest.get("확정_판정") == r["판정"]
    )


def sync_one(r: dict) -> str:
    """규칙 판정 한 건을 eligibility_decisions 에 반영한다. 무엇을 했는지 한 줄로 돌려준다."""
    aid = r["announcement_id"]
    latest = _latest_decision(aid)

    if latest and latest.get("정정여부"):
        return f"[{aid}] 건너뜀 — 사람이 이미 정정함({latest.get('확정자')}). 절대 안 덮어씀"

    if _이미_동기화됨(latest, r):
        return f"[{aid}] 변화 없음 — 이미 같은 판정으로 반영돼 있다"

    확인필요_사유 = [
        d.get("사유") or d.get("특징키") for d in (r.get("확인필요_상세") or [])
    ] or list(r.get("확인필요항목") or [])

    원판정 = None
    if r["판정"] == "확인필요" and r["점수"] >= 60 and not any(
        not g["통과"] and not g.get("보류") for g in (r.get("게이트_결과") or [])
    ):
        # LLM 쪽 원판정과 같은 개념 — 확인필요 항목만 없었다면 어떤 등급이었을지.
        원판정 = "가능"

    rest.insert("eligibility_decisions", {
        "announcement_id": aid,
        "ai_제안": {
            "점수": r["점수"],
            "근거": list(r.get("근거") or []),
            "확인필요항목": 확인필요_사유,
            "원판정": 원판정,
            # 아래는 기존 계약(점수·근거·확인필요항목·원판정)에 없던 추가 필드다.
            # TS 타입은 읽는 필드만 정의할 뿐 jsonb 자체를 제한하지 않으므로 안전하다 —
            # 화면이 당장 안 써도 나중에 "규칙엔진 판정" 배지·근거 상세를 붙일 때 쓴다.
            "판정경로": "규칙",
            "엔진버전": r["엔진버전"],
            "llm_호출": 0,
            "커버리지": r["커버리지"],
        },
        "ai_확신도": r["확신도"],
        "확정_판정": r["판정"],
        "정정여부": False,
        "확정자": None,
    })
    prev = "새로 생김" if not latest else f"이전 {latest.get('확정_판정')}({'사람 확인' if latest.get('확정자') else 'LLM'}) → "
    return f"[{aid}] 반영됨 — {prev}{r['판정']} {r['점수']}점 (규칙엔진 {r['엔진버전']})"


def run(dry: bool = False) -> None:
    rows = rest.select(
        "ann_rule_scores",
        f"select=announcement_id,엔진버전,판정,점수,확신도,커버리지,게이트_결과,근거,"
        f"확인필요항목&엔진버전=eq.{F.ENGINE_VERSION}&판정=in.({','.join(INCLUDE)})&order=announcement_id",
    )
    print(f"대상 {len(rows)}건 (엔진버전 {F.ENGINE_VERSION}, 요건미확인 제외)")
    if dry:
        print("--dry 모드 — 쓰지 않는다")

    반영, 건너뜀, 무변화 = 0, 0, 0
    for r in rows:
        if dry:
            latest = _latest_decision(r["announcement_id"])
            if latest and latest.get("정정여부"):
                건너뜀 += 1
            elif _이미_동기화됨(latest, r):
                무변화 += 1
            else:
                반영 += 1
            continue
        label = sync_one(r)
        if "반영됨" in label:
            반영 += 1
        elif "건너뜀" in label:
            건너뜀 += 1
            print(f"  ⚠ {label}")
        else:
            무변화 += 1

    print(f"\n반영 {반영}건 · 사람 정정이라 건너뜀 {건너뜀}건 · 이미 동일 {무변화}건")


def report() -> None:
    """섀도 대조 — LLM 이 이미 판정한 것과 나란히 본다. app.v_ann_rule_vs_llm 그대로."""
    rows = rest.select("v_ann_rule_vs_llm", f"select=*&엔진버전=eq.{F.ENGINE_VERSION}")
    if not rows:
        print("대조할 행이 없다.")
        return
    일치 = sum(1 for r in rows if r["판정일치"])
    print(f"\n=== 규칙 vs LLM 대조 ({len(rows)}건) ===")
    print(f"동일 판정 {일치}/{len(rows)}")
    for r in sorted(rows, key=lambda r: -abs(r.get("점수차") or 0))[:10]:
        표 = "✓" if r["판정일치"] else "✗"
        print(f"  {표} [{r['announcement_id']}] {r['사업명'][:36]:36s} "
              f"규칙={r['규칙_판정']}({r['규칙_점수']}점) LLM={r['llm_판정']}({r['llm_점수']}점)")


if __name__ == "__main__":
    run(dry="--dry" in sys.argv)
    report()
