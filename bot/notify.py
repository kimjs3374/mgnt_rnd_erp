"""잔업제로 알림 발송기 — 사람이 묻기 전에 시스템이 먼저 말하는 유일한 경로.

봇(bot.py)은 **사람이 올린 것에 답만** 한다. 증빙을 올려야 판독하고, 물어봐야 답한다.
그런데 정산에서 사고가 나는 건 아무도 안 물어봤을 때다 — 마감일이 지났고, 결과 발표가
났는데 아무도 등록 안 했고, 증빙 한 장이 빠진 채로 달이 넘어간다. 이 파일이 그 자리를 맡는다.

⚠ **여기에 LLM 판단이 없다.** 무엇을 알릴지는 전부 SQL 계산이다.
   금액·기한 판정을 AI 에게 맡기지 않는다는 원칙(CLAUDE.md 설계원칙 1)이 여기서 가장
   중요하다 — 알림이 틀리면 사람이 알림을 꺼 버리고, 그러면 기능이 죽은 것과 같다.
   유일한 LLM 사용처는 `주간브리핑` 하나이고, 그건 요약일 뿐 판정이 아니다.

⚠ 같은 말을 두 번 하지 않는다. `app.notifications.키` 의 unique 제약이 막는다.
   타이머 재시작·수동 실행으로 하루에 여러 번 돌아도 채널에는 한 번만 나간다.
   막는 일을 코드가 아니라 DB 가 한다 — 두 개가 동시에 떠도 안전하다.

리마인드 간격
  · 신청마감 : D-14 · D-7 · D-3 · D-1 · D-0 에만. 매일 보내면 사람이 안 본다.
  · 결과등록 : **등록될 때까지 매일.** 계획서 문항4① 이 약속한 「결과등록 전까지 지속
               리마인드」다. 놓치면 다음 행동이 통째로 밀리는 유일한 항목이라 예외를 둔다.
  · 관심공고 : D-14 · D-7 · D-3 · D-1 · D-0
  · 보고기한 : D-30 · D-14 · D-7 · D-3 · D-1 · D-0
  · 서류만료 · 정산위험 : 주 1회(월요일). 매일 볼 성질이 아니다.
  · 브리핑3단 : 주 1회(월요일). 명세 B.12 — 📅 일정 · 💰 예산 · 📈 진행률.
  · 월정산   : 매월 1일. 지난달 것을 닫는다.

명세 B.12 의 「미리 보기」는 `--dry-run` 이다. 무엇이 나갈지 채널에 안 보내고 먼저 본다.

쓰기
    python notify.py                 오늘 몫을 계산해서 보낸다(타이머가 부르는 형태)
    python notify.py --dry-run       계산만 하고 안 보낸다. 화면에 그대로 찍는다
    python notify.py --force         이미 보낸 것도 다시 보낸다(시연·복구용)
    python notify.py --only 결과등록  한 종류만
    python notify.py --weekly        주간 브리핑까지 같이(요일 무시)
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
from typing import Any, Iterable

import psycopg

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rnd-notify")

# DSN 이 두 개인 이유
#   조회는 **읽기 전용 계정**으로 한다(rnd_mcp). 알림은 읽고 세는 일이 전부라
#   쓰기 권한을 들고 다닐 이유가 없다 — MCP 서버와 같은 규율이다.
#   쓰기는 발송 이력 한 줄뿐이고, 그때만 rnd_dev 로 붙는다.
#   ⚠ rnd_dev 는 supabase_admin 소유 테이블(watchlist 등)에 select 권한이 없다.
#     조회까지 rnd_dev 로 하면 "permission denied for table watchlist" 로 조용히
#     한 종류가 통째로 빠진다(실측 2026-09-04).
READ_DSN = os.environ.get("RND_NOTIFY_READ_DSN") or os.environ["RND_DSN"]
WRITE_DSN = os.environ.get("RND_NOTIFY_DSN") or os.environ.get("RND_DEV_DSN") or READ_DSN

# 채널을 못 찾으면 시작할 때 죽는 편이 낫다 — 조용히 아무 데도 안 가는 것이 최악이다.
def _channel() -> str:
    ch = (os.environ.get("RND_NOTIFY_CHANNEL") or "").strip()
    if ch:
        return ch
    watched = (os.environ.get("WATCHED_CHANNEL_IDS") or "").strip()
    first = next((c.strip() for c in watched.replace(",", " ").split() if c.strip()), "")
    if not first:
        raise RuntimeError(
            "보낼 채널이 없다. RND_NOTIFY_CHANNEL 또는 WATCHED_CHANNEL_IDS 를 설정할 것."
        )
    return first


WEB = os.environ.get("RND_WEB_BASE", "https://rnd.mgnt.kr")

# 리마인드를 보낼 D-day. 이 값에 정확히 걸린 날만 나간다.
게이트_신청마감 = {14, 7, 3, 1, 0}
게이트_관심공고 = {14, 7, 3, 1, 0}
게이트_보고기한 = {30, 14, 7, 3, 1, 0}


def q(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with psycopg.connect(READ_DSN, connect_timeout=5) as c, c.cursor() as cur:
        cur.execute(sql, params)
        if cur.description is None:
            return []
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def won(n: Any) -> str:
    return "—" if n is None else f"{int(n):,}원"


def dday(n: int | None) -> str:
    """D-3 · D-DAY · D+2. 부호를 사람 표기로 뒤집는다 — 여기서 헷갈리면 알림이 거짓말이 된다."""
    if n is None:
        return ""
    if n == 0:
        return "D-DAY"
    return f"D-{n}" if n > 0 else f"D+{abs(n)}"


# ─────────────────────────────────────────────────────────────────────────────
# 알림 한 건
# ─────────────────────────────────────────────────────────────────────────────
class 알림:
    def __init__(self, 종류: str, 참조종류: str | None, 참조_id: str | None, 줄: str):
        self.종류 = 종류
        self.참조종류 = 참조종류
        self.참조_id = 참조_id
        self.줄 = 줄

    def 키(self, 오늘: dt.date) -> str:
        return f"{self.종류}:{self.참조종류 or '-'}:{self.참조_id or '-'}:{오늘.isoformat()}"


# ─────────────────────────────────────────────────────────────────────────────
# 무엇을 알릴 것인가 — 전부 계산이다
# ─────────────────────────────────────────────────────────────────────────────
def 신청마감(오늘: dt.date) -> list[알림]:
    """신청해 놓고 아직 결과가 안 나온 사업의 접수 마감.

    ⚠ `선정결과` 는 신청하면 '접수' 가 들어간다. null 만 보면 신청한 건이 통째로
      빠진다(실측: 78·79·109 세 건이 전부 '접수' 였다). 둘 다 「아직 결과 없음」이다.
    """
    rows = q(
        """
        select p.id, p.과제명, p.마감일, (p.마감일 - %s::date) as d_day
          from app.projects p
         where p.상태 = '신청중'
           and p.마감일 is not null
           and (p.선정결과 is null or p.선정결과 = '접수')
         order by p.마감일
        """,
        (오늘,),
    )
    out = []
    for r in rows:
        d = int(r["d_day"])
        if d not in 게이트_신청마감:
            continue
        out.append(
            알림("신청마감", "사업", str(r["id"]),
                f"*{dday(d)}* · {r['과제명']} — 접수마감 {r['마감일']}  <{WEB}/projects/{r['id']}|열기>")
        )
    return out


def 결과등록(오늘: dt.date) -> list[알림]:
    """발표일이 지났는데 결과가 안 적힌 신청 건. **등록될 때까지 매일 나간다.**

    발표일을 모르는 건도 놓치지 않는다 — 공고문에 발표일이 안 적힌 경우가 흔해서
    `발표심사일`·`선정결과일` 이 비어 있는 건은 **접수마감 다음날부터** 센다.
    날짜를 지어내지 않으면서 리마인드는 살려 두는 방법이다(설계원칙 5).
    """
    rows = q(
        """
        select p.id, p.과제명,
               coalesce(p.선정결과일, p.발표심사일, p.마감일) as 기준일,
               (p.선정결과일 is null and p.발표심사일 is null)  as 발표일모름,
               (%s::date - coalesce(p.선정결과일, p.발표심사일, p.마감일)) as 지난날
          from app.projects p
         where p.상태 = '신청중'
           and (p.선정결과 is null or p.선정결과 = '접수')
           and coalesce(p.선정결과일, p.발표심사일, p.마감일) is not null
           and coalesce(p.선정결과일, p.발표심사일, p.마감일) < %s::date
         order by 기준일
        """,
        (오늘, 오늘),
    )
    out = []
    for r in rows:
        꼬리 = " (발표일 미확인 — 접수마감 기준)" if r["발표일모름"] else ""
        out.append(
            알림("결과등록", "사업", str(r["id"]),
                f"*{r['과제명']}* — {r['기준일']} 이후 {int(r['지난날'])}일째 결과 미등록{꼬리}"
                f"  <{WEB}/projects/{r['id']}|결과 등록>")
        )
    return out


def 관심공고(오늘: dt.date) -> list[알림]:
    """관심 표시한 공고의 접수 마감. 사람이 「챙겨보겠다」고 누른 것만 올린다."""
    rows = q(
        """
        select a.id, a.사업명, a.접수종료, coalesce(a.소관부처, a.전문기관) as 기관,
               (a.접수종료 - %s::date) as d_day
          from app.announcements a
          join app.watchlist w on w.종류 = '공고' and w.참조_id = a.id
         where a.접수종료 is not null
         order by a.접수종료
        """,
        (오늘,),
    )
    out = []
    for r in rows:
        d = int(r["d_day"])
        if d not in 게이트_관심공고:
            continue
        out.append(
            알림("관심공고", "공고", str(r["id"]),
                f"*{dday(d)}* · {r['사업명']} ({r['기관'] or '—'}) — 접수마감 {r['접수종료']}"
                f"  <{WEB}/announcements/{r['id']}|열기>")
        )
    return out


def 보고기한(오늘: dt.date) -> list[알림]:
    """중간·완료 보고. 이미 낸 것은 올리지 않는다 — 봐도 할 일이 없다."""
    rows = q(
        """
        select id, 과제명, '중간보고' as 종류, 중간보고_예정 as 기한,
               (중간보고_예정 - %s::date) as d_day
          from app.projects
         where 중간보고_예정 is not null and 중간보고_완료 is null
        union all
        select id, 과제명, '완료보고', 완료보고_예정, (완료보고_예정 - %s::date)
          from app.projects
         where 완료보고_예정 is not null and 완료보고_완료 is null
         order by 기한
        """,
        (오늘, 오늘),
    )
    out = []
    for r in rows:
        d = int(r["d_day"])
        if d not in 게이트_보고기한:
            continue
        out.append(
            알림("보고기한", "사업", f"{r['id']}:{r['종류']}",
                f"*{dday(d)}* · {r['과제명']} — {r['종류']} {r['기한']}"
                f"  <{WEB}/projects/{r['id']}|열기>")
        )
    return out


def 서류만료(오늘: dt.date) -> list[알림]:
    """회사 서류(사업자등록증·재무제표 등)의 만료. 주 1회."""
    rows = q(
        """
        select 코드, 이름, 상태, 만료일 from app.v_document_status
         where 상태 in ('만료', '만료임박')
         order by 만료일 nulls last
        """
    )
    return [
        알림("서류만료", "서류", str(r["코드"]),
            f"*{r['상태']}* · {r['이름']} — 만료 {r['만료일'] or '미상'}  <{WEB}/documents|서류함>")
        for r in rows
    ]


def 정산위험(오늘: dt.date) -> list[알림]:
    """정산 전에 반려당할 것. mcp_server.risk_check 과 **같은 규칙**을 전 과제로 돌린다.

    ⚠ 규칙을 두 벌로 두면 한쪽만 고쳐진다. 여기 있는 네 가지는 risk_check 과 문구까지
      맞춰 두었다 — 챗봇에 물어본 답과 알림이 다르면 사람이 둘 다 안 믿는다.
    """
    out: list[알림] = []

    for r in q(
        """
        select b.과제_id, p.과제명, b.비목명, b.재원구분, b.배정액, b.집행액, b.소진율
          from app.v_budget_status b join app.projects p on p.id = b.과제_id
         where b.집행액 > b.배정액
         order by b.과제_id
        """
    ):
        out.append(
            알림("정산위험", "사업", f"{r['과제_id']}:예산:{r['비목명']}:{r['재원구분']}",
                f"⚠ 예산 초과 — {r['과제명']} · {r['비목명']}({r['재원구분']}) "
                f"배정 {won(r['배정액'])} / 집행 {won(r['집행액'])} ({r['소진율']}%)")
        )

    # 증빙 누락은 v_evidence_summary 가 이미 「무엇이 빠졌는지」까지 들고 있다.
    for r in q(
        """
        select s.expense_id, s.거래처, s.일자, s.합계, s.누락서류, e.과제_id
          from app.v_evidence_summary s join app.expenses e on e.id = s.expense_id
         where s.완비 is not true
           and e.상태 in ('확정', '제출')
         order by s.일자 limit 30
        """
    ):
        빠진 = ", ".join(r["누락서류"] or []) or "미상"
        out.append(
            알림("정산위험", "집행", f"{r['expense_id']}:증빙",
                f"⚠ 증빙 미비 — [{r['expense_id']}] {r['일자']} {r['거래처']} {won(r['합계'])}"
                f" · 빠진 것: {빠진}  <{WEB}/expenses|열기>")
        )

    for r in q(
        """
        select e.id, e.일자, e.거래처, p.과제명, p.시작일, p.종료일
          from app.expenses e join app.projects p on p.id = e.과제_id
         where e.일자 is not null and (e.일자 < p.시작일 or e.일자 > p.종료일)
         order by e.일자 limit 30
        """
    ):
        out.append(
            알림("정산위험", "집행", f"{r['id']}:기간",
                f"⚠ 협약기간 이탈 — [{r['id']}] {r['일자']} {r['거래처']} ({r['과제명']})"
                f"  근거: 협약기간 {r['시작일']}~{r['종료일']}")
        )

    for r in q(
        """
        select id, 거래처, ai_확신도 from app.expenses
         where 상태 = '검토대기' and ai_확신도 is not null and ai_확신도 < 0.70
         order by ai_확신도 limit 30
        """
    ):
        out.append(
            알림("정산위험", "집행", f"{r['id']}:확신도",
                f"⚠ 확신도 낮음 — [{r['id']}] {r['거래처']} {float(r['ai_확신도']):.0%}"
                f"  근거: 0.70 미만은 자동 확정이 막힌다. 사람이 봐야 한다")
        )

    return out


def 월정산(오늘: dt.date) -> list[알림]:
    """매월 1일. 지난달 집행을 닫는다."""
    말일 = 오늘.replace(day=1) - dt.timedelta(days=1)
    첫날 = 말일.replace(day=1)

    rows = q(
        """
        select p.id, p.과제명,
               count(*)                                   as 건수,
               coalesce(sum(e.합계), 0)                    as 합계,
               count(*) filter (where e.상태 = '검토대기') as 검토대기
          from app.expenses e join app.projects p on p.id = e.과제_id
         where e.일자 between %s and %s
         group by p.id, p.과제명
         order by p.id
        """,
        (첫날, 말일),
    )
    if not rows:
        return [알림("월정산", None, f"{첫날:%Y-%m}",
                    f"{첫날:%Y년 %-m월} 집행 건이 없습니다.")]

    out = []
    for r in rows:
        꼬리 = f" · 검토대기 {r['검토대기']}건" if r["검토대기"] else " · 전건 확정"
        out.append(
            알림("월정산", "사업", f"{r['id']}:{첫날:%Y-%m}",
                f"{첫날:%Y년 %-m월} · {r['과제명']} — {r['건수']}건 {won(r['합계'])}{꼬리}"
                f"  <{WEB}/projects/{r['id']}/settlement|정산 화면>")
        )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# B.12 브리핑 3단 — 일정 · 예산 · 진행률
# ─────────────────────────────────────────────────────────────────────────────
def _rcms_마감(오늘: dt.date) -> tuple[dt.date, int]:
    """다음 RCMS 정산 제출 마감. `app.settlement_rule` 이 기준일과 이동 방향을 들고 있다.

    ⚠ **여기에 LLM 이 없다.** 기준일 25일, 주말·공휴일이면 앞(또는 뒤) 영업일로 민다 —
      규정이 정한 하나뿐인 답이라 계산으로 확정한다(CLAUDE.md 설계원칙 2).
    """
    r = q("select 기준일, 이동 from app.settlement_rule where id = 1")
    기준일, 이동 = (r[0]["기준일"], r[0]["이동"]) if r else (25, "앞")

    def 그달(y: int, m: int) -> dt.date:
        마지막 = (dt.date(y + (m == 12), (m % 12) + 1, 1) - dt.timedelta(days=1)).day
        return dt.date(y, m, min(기준일, 마지막))

    d = 그달(오늘.year, 오늘.month)
    if d < 오늘:  # 이번 달 것은 지났다 → 다음 달
        d = 그달(오늘.year + (오늘.month == 12), (오늘.month % 12) + 1)

    if 이동 != "그대로":
        쉬는날 = {r["날짜"] for r in q("select 날짜 from app.holidays")}
        걸음 = -1 if 이동 == "앞" else 1
        while d.weekday() >= 5 or d in 쉬는날:
            d += dt.timedelta(days=걸음)

    return d, (d - 오늘).days


def 브리핑3단(오늘: dt.date) -> list[알림]:
    """📅 일정 · 💰 예산 · 📈 진행률. 명세 B.12.

    ⚠ 숫자를 좋게 보이려고 고르지 않는다. 증빙 완비율이 0% 면 0% 라고 적는다 —
      「담기지 못한 것을 숨기지 않는다」가 이 시스템의 일관된 태도다(명세 B.4).
      알림이 실제보다 후하면 사람이 안심하고 정산에서 반려당한다.
    """
    줄: list[str] = ["", "📅 *일정*"]

    일정 = q(
        """
        select 종류, 제목, 날짜, d_day from app.v_calendar
         where d_day between 0 and 30
         order by d_day limit 6
        """
    )
    for r in 일정:
        줄.append(f"   • {dday(int(r['d_day']))} · {r['종류']} — {r['제목']} ({r['날짜']})")
    if not 일정:
        줄.append("   • 30일 안에 걸린 일정 없음")

    마감일, 남음 = _rcms_마감(오늘)
    줄.append(f"   • {dday(남음)} · RCMS 정산 제출 마감 — {마감일}")

    만료 = q(
        "select 이름, 상태, 만료일 from app.v_document_status where 상태 in ('만료','만료임박')"
    )
    for r in 만료:
        줄.append(f"   • {r['상태']} · {r['이름']} — {r['만료일'] or '만료일 미상'}")
    if not 만료:
        줄.append("   • 만료·만료임박 서류 없음")

    줄 += ["", "💰 *예산*"]
    예산 = q(
        """
        select p.과제명,
               sum(b.배정액) as 배정, sum(b.집행액) as 집행
          from app.v_budget_status b join app.projects p on p.id = b.과제_id
         where p.상태 = '수행중'
         group by p.id, p.과제명
        having sum(b.배정액) > 0
         order by sum(b.집행액) desc limit 5
        """
    )
    for r in 예산:
        배정, 집행 = int(r["배정"]), int(r["집행"] or 0)
        율 = (집행 / 배정 * 100) if 배정 else 0
        줄.append(f"   • {r['과제명'][:30]} — 계상 {won(배정)} / 집행 {won(집행)} ({율:.1f}%)")
    if not 예산:
        줄.append("   • 계상이 확정된 수행중 과제 없음")

    줄 += ["", "📈 *진행률*"]
    ev = q(
        """
        select count(*)                                as 전체,
               count(*) filter (where s.완비)          as 완비,
               coalesce(sum(s.필수건수), 0)             as 필수,
               coalesce(sum(s.보유건수), 0)             as 보유
          from app.v_evidence_summary s
          join app.expenses e on e.id = s.expense_id
          join app.projects p on p.id = e.과제_id
         where p.상태 = '수행중' and e.상태 in ('확정', '제출')
        """
    )
    d = ev[0] if ev else {}
    전체, 완비 = int(d.get("전체") or 0), int(d.get("완비") or 0)
    필수, 보유 = int(d.get("필수") or 0), int(d.get("보유") or 0)
    if 전체:
        줄.append(f"   • 증빙 완비율 — {완비}/{전체}건 ({완비 / 전체 * 100:.0f}%)")
        줄.append(
            f"   • 제출서류 확보율 — {보유}/{필수}장 "
            f"({보유 / 필수 * 100:.0f}%)" if 필수 else "   • 제출서류 확보율 — 요건 없음"
        )
    else:
        줄.append("   • 수행중 과제에 확정된 집행 건이 없다")

    return [알림("브리핑3단", None, 오늘.isoformat(), "\n".join(줄))]


# ─────────────────────────────────────────────────────────────────────────────
# 주간 브리핑 — 이 파일에서 **유일하게** LLM 을 쓴다
# ─────────────────────────────────────────────────────────────────────────────
def 주간브리핑(오늘: dt.date) -> list[알림]:
    """지난 7일의 확정·정정·공고 판정을 사람 말로 요약한다.

    계획서 문항4⑤「판단 이력과 AI 브리핑」의 뒷부분이다. 이력은 이미 쌓이고 있고
    (decisions·judgment_semantic) 화면에도 보이는데, **먼저 말해 주는 쪽**이 없었다.

    ⚠ 요약일 뿐 판정이 아니다. 숫자는 전부 아래 SQL 이 센 것을 그대로 넘긴다 —
      모델에게 세라고 시키지 않는다(설계원칙 1·5).
    ⚠ 모델이 죽어도 알림은 나가야 한다. 실패하면 **집계만이라도** 보낸다.
    """
    부터 = 오늘 - dt.timedelta(days=7)

    확정 = q(
        """
        select d.확정_비목, d.확정_세부항목, d.정정여부, d.정정사유_유형, d.정정사유,
               e.거래처, e.합계
          from app.decisions d join app.expenses e on e.id = d.expense_id
         where d.created_at >= %s
         order by d.created_at
        """,
        (부터,),
    )
    판정 = q(
        """
        select j.판정, j.사유, j.답변자, a.사업명
          from app.judgment_semantic j
          left join app.announcements a on a.id = j.announcement_id
         where j.created_at >= %s and j.사유 is not null
         order by j.created_at
        """,
        (부터,),
    )

    정정 = [d for d in 확정 if d["정정여부"]]
    머리 = (f"지난 7일({부터}~{오늘}) — 집행 확정 {len(확정)}건 "
            f"(사람이 고친 것 {len(정정)}건) · 공고 판정 코멘트 {len(판정)}건")

    if not 확정 and not 판정:
        return [알림("주간브리핑", None, 오늘.isoformat(),
                    f"{머리}\n남은 기록이 없습니다.")]

    재료 = [머리, "", "[집행 확정]"]
    for d in 확정:
        표시 = f"{d['확정_비목']}/{d['확정_세부항목'] or '—'}"
        if d["정정여부"]:
            재료.append(f"- {d['거래처']} {won(d['합계'])} → {표시} "
                        f"(사람이 고침 · {d['정정사유_유형']}: {d['정정사유']})")
        else:
            재료.append(f"- {d['거래처']} {won(d['합계'])} → {표시} (AI 제안대로 확정)")
    재료 += ["", "[공고 판정 코멘트]"]
    for j in 판정:
        재료.append(f"- [{j['판정']}] {j['사업명'] or '공고 미상'} — {j['사유']} ({j['답변자']})")

    본문 = "\n".join(재료)

    프롬프트 = f"""아래는 R&D 과제관리 시스템에 지난 7일간 쌓인 기록이다.
팀에게 보낼 주간 브리핑을 한국어로 6줄 이내로 써라.

지켜야 할 것
- 아래에 없는 숫자·사실을 만들지 마라. 모르면 쓰지 마라.
- 「사람이 고친 것」이 있으면 무엇을 왜 고쳤는지를 가장 앞에 써라. 그게 회사에 남는 기록이다.
- 다음 주에 사람이 할 일이 보이면 마지막 줄에 한 줄로 적어라. 없으면 적지 마라.
- 인사말·머리말 없이 본문만.

{본문}
"""
    try:
        import extract  # 헤드리스 호출은 전부 여기 하나를 지난다
        요약 = extract._claude(프롬프트, allow_read=False, timeout=180).strip()
    except Exception as e:  # 모델이 죽어도 집계는 나간다
        log.warning("주간브리핑 요약 실패, 집계만 보낸다: %s", e)
        요약 = ""

    글 = f"{머리}\n\n{요약}" if 요약 else f"{머리}\n\n(요약 생성 실패 — 원자료만)\n{본문[:1500]}"
    return [알림("주간브리핑", None, 오늘.isoformat(), 글)]


# ─────────────────────────────────────────────────────────────────────────────
# 무엇을 오늘 돌릴 것인가
# ─────────────────────────────────────────────────────────────────────────────
제목표 = {
    "신청마감": "📌 신청 마감이 다가옵니다",
    "결과등록": "🔔 결과를 등록해 주세요",
    "관심공고": "⭐ 관심 공고 마감",
    "보고기한": "📄 보고 기한",
    "서류만료": "🗂 서류 만료",
    "정산위험": "🧾 정산 전 점검 — 지금 정산하면 걸릴 것",
    "월정산": "📆 지난달 정산",
    "브리핑3단": "📊 오늘의 과제 브리핑",
    "주간브리핑": "🗒 주간 브리핑",
}

수집기 = {
    "신청마감": 신청마감,
    "결과등록": 결과등록,
    "관심공고": 관심공고,
    "보고기한": 보고기한,
    "서류만료": 서류만료,
    "정산위험": 정산위험,
    "월정산": 월정산,
    "브리핑3단": 브리핑3단,
    "주간브리핑": 주간브리핑,
}


def 오늘몫(오늘: dt.date, *, weekly: bool, only: str | None) -> list[str]:
    """요일·날짜로 오늘 돌릴 종류를 고른다. 매일 다 돌리면 채널이 시끄러워 아무도 안 본다."""
    if only:
        return [only]
    종류 = ["신청마감", "결과등록", "관심공고", "보고기한"]
    if 오늘.weekday() == 0:  # 월요일
        종류 += ["서류만료", "정산위험", "브리핑3단", "주간브리핑"]
    if 오늘.day == 1:
        종류 += ["월정산"]
    if weekly and "주간브리핑" not in 종류:
        종류 += ["서류만료", "정산위험", "브리핑3단", "주간브리핑"]
    return 종류


# ─────────────────────────────────────────────────────────────────────────────
# 보내기
# ─────────────────────────────────────────────────────────────────────────────
def 안보낸것(알림들: Iterable[알림], 오늘: dt.date, *, force: bool) -> list[알림]:
    알림들 = list(알림들)
    if force or not 알림들:
        return 알림들
    키들 = [a.키(오늘) for a in 알림들]
    이미 = {r["키"] for r in q("select 키 from app.notifications where 키 = any(%s)", (키들,))}
    return [a for a in 알림들 if a.키(오늘) not in 이미]


def 남긴다(알림들: list[알림], 오늘: dt.date, 채널: str, ts: str | None) -> None:
    """보낸 사실을 남긴다.

    ⚠ `on conflict do nothing` — 두 프로세스가 동시에 떠도 여기서 조용히 갈린다.
      unique 위반으로 죽으면 이미 나간 메시지의 기록만 사라진다. 그게 더 나쁘다.
    """
    with psycopg.connect(WRITE_DSN, connect_timeout=5) as c, c.cursor() as cur:
        for a in 알림들:
            cur.execute(
                """
                insert into app.notifications (키, 종류, 참조종류, 참조_id, 제목, 본문, 채널, slack_ts)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (키) do nothing
                """,
                (a.키(오늘), a.종류, a.참조종류, a.참조_id, 제목표.get(a.종류, a.종류),
                 a.줄, 채널, ts),
            )
        c.commit()


def 글로(종류: str, 알림들: list[알림]) -> str:
    머리 = 제목표.get(종류, 종류)
    # 브리핑은 이미 제 모양을 갖춘 글이다. 불릿을 덧씌우면 3단 구조가 깨진다.
    if 종류 in ("주간브리핑", "브리핑3단"):
        return f"*{머리}*\n{알림들[0].줄}"
    몸 = "\n".join(f"• {a.줄}" for a in 알림들)
    return f"*{머리}* ({len(알림들)}건)\n{몸}"


def main() -> int:
    ap = argparse.ArgumentParser(description="잔업제로 알림 발송기")
    ap.add_argument("--dry-run", action="store_true", help="계산만 하고 안 보낸다")
    ap.add_argument("--force", action="store_true", help="이미 보낸 것도 다시 보낸다")
    ap.add_argument("--weekly", action="store_true", help="요일과 무관하게 주간분까지")
    ap.add_argument("--only", help="한 종류만 (예: 결과등록)")
    ap.add_argument("--date", help="기준일 (YYYY-MM-DD). 시연·검증용")
    args = ap.parse_args()

    오늘 = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    종류들 = 오늘몫(오늘, weekly=args.weekly, only=args.only)
    log.info("기준일 %s · 돌릴 종류: %s", 오늘, ", ".join(종류들))

    채널 = "(dry-run)" if args.dry_run else _channel()
    client = None
    if not args.dry_run:
        from slack_sdk import WebClient
        client = WebClient(token=os.environ["SLACK_BOT_TOKEN"])

    보낸건수 = 0
    for 종류 in 종류들:
        수집 = 수집기.get(종류)
        if 수집 is None:
            log.warning("모르는 종류라 건너뛴다: %s", 종류)
            continue
        try:
            전부 = 수집(오늘)
        except Exception as e:
            log.error("%s 계산 실패: %s", 종류, e)
            continue

        보낼것 = 안보낸것(전부, 오늘, force=args.force)
        if not 보낼것:
            log.info("%s: 보낼 것 없음 (계산 %d건, 이미 보냄 %d건)",
                     종류, len(전부), len(전부) - len(보낼것))
            continue

        글 = 글로(종류, 보낼것)
        if args.dry_run:
            print(f"\n───── {종류} ─────\n{글}")
            보낸건수 += len(보낼것)
            continue

        try:
            res = client.chat_postMessage(channel=채널, text=글)
            ts = res.get("ts")
        except Exception as e:
            # 발송 실패는 기록하되 ts 를 비워 둔다 — 「계산은 됐는데 안 나갔다」가 남는다.
            log.error("%s 발송 실패: %s", 종류, e)
            남긴다(보낼것, 오늘, 채널, None)
            continue

        남긴다(보낼것, 오늘, 채널, ts)
        보낸건수 += len(보낼것)
        log.info("%s: %d건 발송", 종류, len(보낼것))

    log.info("끝. 총 %d건", 보낸건수)
    return 0


if __name__ == "__main__":
    sys.exit(main())
