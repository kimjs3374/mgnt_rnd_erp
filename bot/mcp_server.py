"""잔업제로 MCP 서버 — 시스템이 답할 수 있는 것의 목록.

임의 SQL 을 열지 않는다. 정해진 도구만 노출하므로 안전하고, 도구 하나하나가 곧 기능이다.
Slack 봇과 웹 챗이 이 서버 하나를 공유한다. 도구를 두 번 만들지 않는다.

⚠ 실제로 걸렸던 함정 (2026-09-02)
  1. mcp 2.x 에서 FastMCP → MCPServer 로 개명됐다.
     구버전 이름을 쓰면 **서버가 죽는데 에러가 안 보이고** 모델이
     "연결에 실패한 것 같다"고 말할 뿐이다.
  2. 도구 이름에 한글을 쓸 수 없다. A-Z a-z 0-9 _ - 만. **docstring 은 한글 OK.**
  3. mcp.run() 아래에 도구를 정의하면 그 아래가 통째로 등록 안 된다. 에러도 없다.
     → run() 은 반드시 파일 맨 끝.

검증은 LLM 없이 한다. tools_check.py 가 ClientSession 으로 list_tools/call_tool 을
직접 부른다 — 한도를 한 토큰도 안 쓴다. 현장 디버깅은 이걸로.
"""

import os
import json
from typing import Any

import psycopg
from mcp.server.mcpserver import MCPServer

import collect  # 공고 수집 실행기. 같은 디렉터리(/web/rnd/bot)에 있다.

DSN = os.environ["RND_DSN"]  # 기본값을 두지 않는다. 없으면 시작할 때 죽는 편이 낫다.

mcp = MCPServer("rnd")


# ─────────────────────────────────────────────────────────────────────────────
# 공용
# ─────────────────────────────────────────────────────────────────────────────
def q(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    """읽기 전용 계정으로 조회한다. rnd_mcp 는 SELECT 권한만 가진다."""
    with psycopg.connect(DSN, connect_timeout=5) as c, c.cursor() as cur:
        cur.execute(sql, params)
        if cur.description is None:
            return []
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def won(n: Any) -> str:
    if n is None:
        return "—"
    return f"{int(n):,}원"


def none(msg: str) -> str:
    """빈 결과를 빈 문자열로 돌려주지 않는다. 모델이 '없다'와 '실패했다'를 구분해야 한다."""
    return f"해당 없음: {msg}"


# ─────────────────────────────────────────────────────────────────────────────
# 도구
# ─────────────────────────────────────────────────────────────────────────────
@mcp.tool()
def category_history(keyword: str) -> str:
    """과거에 비슷한 품목을 어느 비목으로 확정했는지, 고쳤다면 왜 고쳤는지 돌려준다.

    「작년에 노트북 뭘로 처리했지?」「이 두 건이 왜 다른 비목이지?」에 답한다.
    정정 이력이 있으면 그 사유를 함께 준다 — 담당자 머릿속에만 있던 판단이 여기서 나온다.
    """
    rows = q(
        """
        select e.일자, e.거래처, e.품목,
               c.이름  as 비목, s.이름 as 세부항목,
               e.ai_확신도, e.상태,
               d.정정여부, d.정정사유_유형, d.정정사유, d.확정자
          from app.expenses e
          left join app.categories     c on c.코드 = e.비목_대분류
          left join app.sub_categories s on s.코드 = e.비목_세부항목
          left join lateral (
                select * from app.decisions dd
                 where dd.expense_id = e.id
                 order by dd.created_at desc limit 1) d on true
         where e.거래처 ilike %s
            or e.품목::text ilike %s
            or coalesce(s.이름,'') ilike %s
            or coalesce(c.이름,'') ilike %s
         order by e.일자 desc nulls last
         limit 10
        """,
        (f"%{keyword}%",) * 4,
    )
    if not rows:
        return none(f"'{keyword}' 로 찾은 과거 집행이 없다. 이력이 아직 안 쌓였을 수 있다.")

    out = [f"'{keyword}' 관련 과거 처리 {len(rows)}건"]
    for r in rows:
        line = (
            f"- {r['일자']} · {r['거래처']} · {won((r['품목'] or [{}])[0].get('금액') if isinstance(r['품목'], list) else None)}"
            f"\n  → {r['비목'] or '미분류'}"
            + (f" › {r['세부항목']}" if r["세부항목"] else "")
            + (f" (확신도 {float(r['ai_확신도']):.0%})" if r["ai_확신도"] is not None else "")
            + f" [{r['상태']}]"
        )
        if r["정정여부"]:
            line += (
                f"\n  ★ 사람이 정정함 — {r['정정사유_유형']}: {r['정정사유']}"
                f" (확정자 {r['확정자']})"
            )
        out.append(line)
    out.append(
        "\n※ ★ 표시는 사람이 AI 판단을 고친 건이다. 같은 품목이면 그 판단을 우선 따른다."
    )
    return "\n".join(out)


@mcp.tool()
def program_ledger() -> str:
    """지원사업 대장. 우리가 지금 어떤 지원사업을 어느 단계까지 진행했는지 전부 돌려준다.

    「우리가 지금 뭐뭐 하고 있지?」「마감 임박한 게 뭐야?」에 답한다.
    국가 R&D 와 지자체·TP 사업을 같은 대장에서 본다.
    """
    rows = q(
        """
        select 사업명, 기관, 사업유형, 마감일, d_day, 지원금액, 사용금액,
               집행률, 선정결과, 상태, 미처리점검, 미확보서류
          from app.v_program_ledger order by id
        """
    )
    if not rows:
        return none("등록된 지원사업이 없다.")

    out = [f"지원사업 {len(rows)}건"]
    for r in rows:
        마감 = (
            f"{r['마감일']}(D-{r['d_day']})"
            if r["마감일"] and r["d_day"] is not None and r["d_day"] >= 0
            else (r["마감일"] or "확인 필요")
        )
        out.append(
            f"- [{r['상태']}] {r['사업명']} · {r['기관'] or '기관 미상'}"
            f" · {r['사업유형'] or '유형 미상'}"
            f"\n  마감 {마감} · 지원 {won(r['지원금액'])} · 사용 {won(r['사용금액'])}"
            + (f" ({r['집행률']}%)" if r["집행률"] is not None else "")
            + (f"\n  ⚠ 미처리 점검 {r['미처리점검']}건" if r["미처리점검"] else "")
            + (f" · 미확보 서류 {r['미확보서류']}건" if r["미확보서류"] else "")
        )
    return "\n".join(out)


@mcp.tool()
def list_projects() -> str:
    """수행 중이거나 종료된 과제(사업) 목록. 과제번호·기간·총사업비를 준다."""
    rows = q(
        """
        select id, 과제코드, 과제명, 부처, 시작일, 종료일, 연차, 총사업비, 상태
          from app.projects order by 시작일 desc nulls last
        """
    )
    if not rows:
        return none("등록된 과제가 없다.")
    return "\n".join(
        f"- [{r['id']}] {r['과제명']} ({r['과제코드']})"
        f"\n  {r['부처'] or '부처 미상'} · {r['시작일']}~{r['종료일']} · {r['연차']}차년도"
        f" · 총 {won(r['총사업비'])} · {r['상태']}"
        for r in rows
    )


@mcp.tool()
def budget_status(project_id: int) -> str:
    """과제의 비목별 예산 배정·집행·잔액·소진율. 「간접비 얼마 남았어?」에 답한다."""
    rows = q(
        """
        select 비목명, 재원구분, 배정액, 집행액, 잔액, 소진율
          from app.v_budget_status where 과제_id = %s
         order by 비목_대분류, 재원구분
        """,
        (project_id,),
    )
    if not rows:
        return none(f"과제 {project_id} 의 예산 배정이 없다.")
    out = [f"과제 {project_id} 예산"]
    for r in rows:
        out.append(
            f"- {r['비목명']} ({r['재원구분']}) 배정 {won(r['배정액'])}"
            f" · 집행 {won(r['집행액'])} · 잔액 {won(r['잔액'])} · 소진 {r['소진율']}%"
        )
    return "\n".join(out)


@mcp.tool()
def search_expenses(keyword: str, project_id: int | None = None) -> str:
    """거래처·품목으로 집행 내역을 찾는다. 「포스코퓨처엠에 얼마 썼지?」에 답한다."""
    sql = """
        select e.일자, e.거래처, e.합계, c.이름 as 비목, s.이름 as 세부항목, e.상태
          from app.expenses e
          left join app.categories     c on c.코드 = e.비목_대분류
          left join app.sub_categories s on s.코드 = e.비목_세부항목
         where (e.거래처 ilike %s or e.품목::text ilike %s)
    """
    params: tuple = (f"%{keyword}%", f"%{keyword}%")
    if project_id is not None:
        sql += " and e.과제_id = %s"
        params += (project_id,)
    sql += " order by e.일자 desc nulls last limit 30"

    rows = q(sql, params)
    if not rows:
        return none(f"'{keyword}' 로 찾은 집행이 없다.")
    total = sum(int(r["합계"] or 0) for r in rows)
    out = [f"'{keyword}' 집행 {len(rows)}건 · 합계 {won(total)}"]
    for r in rows:
        out.append(
            f"- {r['일자']} · {r['거래처']} · {won(r['합계'])}"
            f" → {r['비목'] or '미분류'}"
            + (f" › {r['세부항목']}" if r["세부항목"] else "")
            + f" [{r['상태']}]"
        )
    return "\n".join(out)


@mcp.tool()
def risk_check(project_id: int) -> str:
    """정산 전 반려 위험 점검. 예산 초과·증빙 누락·기간 이탈을 규칙으로 검사한다.

    LLM 판단이 아니라 계산이다. 근거와 함께 돌려준다.
    """
    risks: list[str] = []

    over = q(
        """
        select 비목명, 재원구분, 배정액, 집행액, 소진율
          from app.v_budget_status
         where 과제_id = %s and 집행액 > 배정액
        """,
        (project_id,),
    )
    for r in over:
        risks.append(
            f"⚠ 예산 초과 — {r['비목명']}({r['재원구분']}) "
            f"배정 {won(r['배정액'])} / 집행 {won(r['집행액'])} ({r['소진율']}%)"
        )

    noev = q(
        """
        select e.id, e.일자, e.거래처, e.합계
          from app.expenses e
         where e.과제_id = %s
           and not exists (select 1 from app.evidence v where v.expense_id = e.id)
         order by e.일자 limit 20
        """,
        (project_id,),
    )
    for r in noev:
        risks.append(
            f"⚠ 증빙 미첨부 — [{r['id']}] {r['일자']} {r['거래처']} {won(r['합계'])}"
            "  근거: 정산 시 불인정 사유"
        )

    out_of_range = q(
        """
        select e.id, e.일자, e.거래처, p.시작일, p.종료일
          from app.expenses e join app.projects p on p.id = e.과제_id
         where e.과제_id = %s and e.일자 is not null
           and (e.일자 < p.시작일 or e.일자 > p.종료일)
         order by e.일자 limit 20
        """,
        (project_id,),
    )
    for r in out_of_range:
        risks.append(
            f"⚠ 협약기간 이탈 — [{r['id']}] {r['일자']} {r['거래처']}"
            f"  근거: 협약기간 {r['시작일']}~{r['종료일']}"
        )

    lowconf = q(
        """
        select id, 거래처, ai_확신도 from app.expenses
         where 과제_id = %s and 상태 = '검토대기'
           and ai_확신도 is not null and ai_확신도 < 0.70
         order by ai_확신도 limit 20
        """,
        (project_id,),
    )
    for r in lowconf:
        risks.append(
            f"⚠ 확신도 낮음 — [{r['id']}] {r['거래처']} {float(r['ai_확신도']):.0%}"
            "  근거: 0.70 미만은 자동 확정이 차단된다. 사람이 봐야 한다"
        )

    if not risks:
        return f"과제 {project_id}: 규칙 점검에서 걸린 것이 없다. (예산·증빙·기간·확신도)"
    return f"과제 {project_id} 위험 {len(risks)}건\n" + "\n".join(risks)


@mcp.tool()
def search_announcements(keyword: str = "", region: str = "") -> str:
    """수집된 지원사업 공고를 찾는다. 접수기간이 날짜가 아닌 건은 유형을 그대로 보여준다."""
    sql = "select id, 사업명, 소관부처, 전문기관, 지역, 접수시작, 접수종료, 마감유형 from app.announcements where true"
    params: tuple = ()
    if keyword:
        sql += " and 사업명 ilike %s"
        params += (f"%{keyword}%",)
    if region:
        sql += " and coalesce(지역,'') ilike %s"
        params += (f"%{region}%",)
    sql += " order by 접수종료 nulls last limit 30"

    rows = q(sql, params)
    if not rows:
        return none("조건에 맞는 공고가 없다.")
    out = [f"공고 {len(rows)}건"]
    for r in rows:
        기간 = (
            f"{r['접수시작']}~{r['접수종료']}"
            if r["접수시작"] and r["접수종료"]
            else f"[{r['마감유형']}]"
        )
        out.append(
            f"- [{r['id']}] {r['사업명']}"
            f"\n  {r['소관부처'] or r['전문기관'] or '기관 미상'} · {r['지역'] or '지역 무관'} · {기간}"
        )
    out.append("\n※ 접수기간이 날짜가 아닌 건(상시·소진시·선착순)은 마감유형을 그대로 표시한다. 날짜를 지어내지 않는다.")
    return "\n".join(out)


@mcp.tool()
def eligibility_check(announcement_id: int) -> str:
    """공고의 자격 요건을 회사 프로필과 대조해 항목별로 판정한다.

    요건마다 공고 원문을 근거로 붙인다. 회사 값이 없으면 「확인 필요」로 두고 단정하지 않는다.
    「모르는 것을 충족으로 판정하면 지원 자격이 없는 공고에 계획서를 쓰게 된다.」
    """
    ann = q("select 사업명 from app.announcements where id = %s", (announcement_id,))
    if not ann:
        return none(f"공고 {announcement_id} 가 없다.")

    reqs = q(
        """
        select 항목, 필수여부, 연산자, 기준값, 단위, 원문
          from app.ann_requirements where announcement_id = %s order by 필수여부 desc, id
        """,
        (announcement_id,),
    )
    if not reqs:
        return (
            f"'{ann[0]['사업명']}' — 자격 요건이 아직 추출되지 않았다.\n"
            "판정: 요건 미확인. **「확인 필요」보다 아래 등급이다.**\n"
            "접수기간만 보고 「신청 가능」이라고 하면 안 된다 — 실측에서 1,479건 중 729건이 그렇게 잘못 찍혔다."
        )

    prof = q("select * from app.company_profile order by 결산연도 desc limit 1")
    p = prof[0] if prof else {}

    # 요건 항목명 → (회사 프로필 컬럼, 그 컬럼이 저장된 단위)
    # ⚠ 단위를 안 맞추면 조용히 틀린다. 실측에서 74억을 「90억 이상 충족」으로 판정한 적이 있다.
    #    매출액은 원 단위로 저장되고 공고 기준값은 억원이다. 숫자만 비교하면 74억 > 90 이 된다.
    #    틀린 「지원 가능」은 없는 판정보다 훨씬 위험하다 — 자격이 안 되는 공고에 계획서를 쓰게 된다.
    MAP = {
        "매출액": ("매출액", "원"),
        "매출증가율": ("매출증가율", "%"),
        "부채비율": ("부채비율", "%"),
        "자본전액잠식": ("자본전액잠식", None),
        "R&D집약도": ("rnd_집약도", "%"),
        "rnd집약도": ("rnd_집약도", "%"),
        "기업부설연구소": ("기업부설연구소", None),
        "종업원수": ("종업원수", "명"),
    }

    # 저장 단위 → 요건 단위로 바꾸는 배수
    SCALE = {
        ("원", "억원"): 1 / 100_000_000,
        ("원", "천만원"): 1 / 10_000_000,
        ("원", "백만원"): 1 / 1_000_000,
        ("원", "만원"): 1 / 10_000,
        ("원", "원"): 1.0,
        ("%", "%"): 1.0,
        ("명", "명"): 1.0,
    }

    def judge(r: dict) -> tuple[str, str]:
        entry = MAP.get(r["항목"].replace(" ", ""))
        if not entry:
            return "확인 필요", f"'{r['항목']}' 은 회사 프로필에 대응하는 항목이 없다"
        col, stored_unit = entry
        if col not in p or p.get(col) is None:
            return "확인 필요", "회사 프로필에 값이 없다"

        v = p[col]
        if isinstance(v, bool):
            ok = v if r["기준값"] in (None, 1) else not v
            return ("충족" if ok else "미충족"), f"우리 {'보유/해당' if v else '미보유/해당없음'}"

        if r["기준값"] is None or r["연산자"] is None:
            return "확인 필요", f"우리 {v} (공고에서 기준값·연산자를 못 뽑았다)"

        want_unit = (r["단위"] or stored_unit or "").strip()
        scale = SCALE.get((stored_unit or "", want_unit))
        if scale is None:
            # 단위를 맞출 수 없으면 **비교하지 않는다.** 추측해서 판정하지 않는다.
            return (
                "확인 필요",
                f"우리 {v:,} ({stored_unit}) / 기준 {r['기준값']} ({want_unit}) — 단위를 맞출 수 없다",
            )

        a, b = float(v) * scale, float(r["기준값"])
        ok = {"gte": a >= b, "lte": a <= b, "gt": a > b, "lt": a < b, "eq": a == b}.get(
            r["연산자"], None
        )
        if ok is None:
            return "확인 필요", f"알 수 없는 연산자 {r['연산자']}"
        fmt = lambda x: f"{x:,.1f}".rstrip("0").rstrip(".")
        return ("충족" if ok else "미충족"), f"우리 {fmt(a)}{want_unit} / 기준 {fmt(b)}{want_unit}"

    lines, blocking, unknown = [], [], []
    for r in reqs:
        verdict, detail = judge(r)
        tag = "[필수]" if r["필수여부"] else "[조건]"
        lines.append(f"{verdict} {tag} {r['항목']}: {detail}\n      근거: {r['원문']}")
        if verdict == "미충족" and r["필수여부"]:
            blocking.append(r["항목"])
        if verdict == "확인 필요":
            unknown.append(r["항목"])

    if blocking:
        overall = f"지원 불가 — 필수 요건 미충족: {', '.join(blocking)}"
    elif unknown:
        overall = f"확인 필요 — 값이 없는 항목: {', '.join(unknown)}"
    else:
        overall = "지원 가능"

    return f"'{ann[0]['사업명']}'\n판정: {overall}\n\n" + "\n".join(lines)


@mcp.tool()
def required_documents(announcement_id: int) -> str:
    """공고가 요구하는 제출 서류를 우리 서류함과 대조한다. 만료된 것과 없는 것을 짚어 준다."""
    rows = q(
        """
        select r.서류명, r.필수여부, r.유효기간_문구, r.원문,
               v.상태 as 보유상태, v.발급일, v.만료일
          from app.ann_required_docs r
          left join app.v_document_status v on v.코드 = r.doc_type
         where r.announcement_id = %s
         order by r.필수여부 desc, r.id
        """,
        (announcement_id,),
    )
    if not rows:
        return none(f"공고 {announcement_id} 의 제출 서류가 아직 추출되지 않았다.")

    out = [f"제출 서류 {len(rows)}건"]
    문제 = 0
    for r in rows:
        상태 = r["보유상태"] or "없음"
        if 상태 in ("만료", "없음", "만료임박", "공고확인필요"):
            문제 += 1
            mark = "❌" if 상태 in ("만료", "없음") else "⚠"
        else:
            mark = "✅"
        out.append(
            f"{mark} {'[필수]' if r['필수여부'] else '[해당시]'} {r['서류명']} — {상태}"
            + (f" (발급 {r['발급일']}" + (f", 만료 {r['만료일']}" if r["만료일"] else "") + ")" if r["발급일"] else "")
            + (f"\n      공고 요구: {r['유효기간_문구']}" if r["유효기간_문구"] else "")
        )
    out.insert(1, f"준비 안 된 것 {문제}건")
    return "\n".join(out)


@mcp.tool()
def document_status() -> str:
    """회사 공통 서류의 유효 상태. 만료·만료임박·없음을 먼저 보여준다."""
    rows = q(
        """
        select 이름, 발급일, 결산연도, 상태, 만료일 from app.v_document_status
         order by case 상태 when '만료' then 0 when '없음' then 1
                            when '만료임박' then 2 when '공고확인필요' then 3 else 4 end, 이름
        """
    )
    if not rows:
        return none("서류함이 비어 있다.")
    return "\n".join(
        f"- {r['이름']} — {r['상태']}"
        + (f" (발급 {r['발급일']})" if r["발급일"] else "")
        + (f" (결산 {r['결산연도']})" if r["결산연도"] else "")
        + (f" 만료 {r['만료일']}" if r["만료일"] else "")
        for r in rows
    )


@mcp.tool()
def calc_indirect(
    직접비: int, 현물: int = 0, 위탁: int = 0, 국제공동: int = 0, 부담비: int = 0, 비율: float = 10.0
) -> str:
    """간접비를 역산한다. 단순 곱셈이 아니라 총액 기준 역산이고 백만원 단위로 절사한다.

    손으로 계산하면 틀린다. 그래서 도구로 둔다.
    """
    base = 직접비 - 현물 - 위탁 - 국제공동 - 부담비
    r = 비율 * 0.01
    raw = base * r / (1 + r)

    # ⚠ 부동소수점 절사 함정 — 실측으로 100만원이 조용히 사라진 적이 있다.
    #    직접비 88,000,000 의 역산이 정확히 8,000,000 인데 7,999,999.999… 가 나와
    #    백만원 절사가 7,000,000 을 돌려줬다. 사람이 검산하기 전엔 아무도 모른다.
    EPS = 1e-6
    floored = int((raw + EPS) // 1_000_000) * 1_000_000

    return (
        f"간접비 {floored:,}원\n"
        f"  기준액 = 직접비 {직접비:,} − 현물 {현물:,} − 위탁 {위탁:,}"
        f" − 국제공동 {국제공동:,} − 부담비 {부담비:,} = {base:,}원\n"
        f"  공식 = 기준액 × r/(1+r), r={비율}%  →  {raw:,.2f}원\n"
        f"  백만원 절사 → {floored:,}원\n"
        f"  ※ 절사 경계에서 부동소수점 때문에 100만원이 사라지는 사례가 있어 epsilon 보정을 넣었다."
    )


# ─────────────────────────────────────────────────────────────────────────────
# 공고 수집 — 「찾아보는」 도구(search_announcements) 앞에 「받아오는」 도구를 둔다.
#
# 나머지 도구는 전부 읽기만 한다. 이 셋만 바깥(IRIS·기업마당·K-Startup·NTIS)을 건드리므로
# 여기 모아 둔다. 수집 자체는 collect.py 가 scripts/collect-*.mjs 를 띄워서 한다 —
# 화면이 쓰는 것과 같은 코드다. 두 벌로 갈리면 챗봇 건수와 화면 건수가 달라진다.
# ─────────────────────────────────────────────────────────────────────────────
def _db_now() -> str:
    """DB 서버 시각. 「이번 수집으로 새로 들어온 건」의 기준선이다."""
    return str(q("select now() as t")[0]["t"])


def _신규(source: str, since: str) -> tuple[list[dict], int]:
    """기준시각 뒤에 생긴 행과, 그 행들에 붙은 요구서류 건수.

    ⚠ 「갱신」은 세지 않는다. announcements 에 updated_at 이 없어서 upsert 로 내용만
      바뀐 행을 구분할 방법이 없다. 없는 수치를 만들지 않는다.
    """
    rows = q(
        "select id, 사업명, 접수종료, 마감유형, 파싱상태 from app.announcements"
        " where 출처 = %s and created_at > %s order by created_at desc",
        (source, since),
    )
    if not rows:
        return [], 0
    docs = q(
        "select count(*) as n from app.ann_required_docs where announcement_id = any(%s)",
        ([r["id"] for r in rows],),
    )
    return rows, int(docs[0]["n"])


def _수집요약(meta: dict) -> str:
    meta = collect.refresh(meta)
    끝났나 = bool(meta.get("finished_at"))
    rc = meta.get("returncode")
    상태 = ("완료" if rc in (None, 0) else f"실패(종료코드 {rc})") if 끝났나 else "진행중"
    since = meta.get("db_since") or ""
    rows, doc_n = _신규(meta["source"], since) if since else ([], 0)

    out = [
        f"[{meta['run_id']}] {meta['source']} 수집 {상태} · {collect.경과초(meta)}초 경과"
        f" · 새로 들어온 공고 {len(rows)}건" + (f" · 요구서류 {doc_n}건 판독" if doc_n else "")
    ]
    for r in rows[:10]:
        기간 = f"~{r['접수종료']}" if r["접수종료"] else f"[{r['마감유형']}]"
        out.append(f"  - [{r['id']}] {str(r['사업명'])[:50]} · {기간} · {r['파싱상태']}")
    if len(rows) > 10:
        out.append(f"  … 외 {len(rows) - 10}건")

    로그 = collect.tail(collect.log_path(meta["run_id"]), 12)
    if 로그:
        out.append("\n수집 로그(끝 12줄)\n" + 로그)
    if not 끝났나:
        out.append(
            f"\n※ 아직 돌고 있다. 첨부 다운로드와 공고문 판독은 건당 수십 초 걸린다."
            f" 잠시 뒤 collect_progress('{meta['run_id']}') 로 다시 본다."
        )
    return "\n".join(out)


@mcp.tool()
def collect_announcements(
    source: str = "IRIS", limit: int = 5, keyword: str = "", wait_seconds: int = 40
) -> str:
    """공고를 출처에서 새로 받아온다(수집). 받아온 뒤 조회는 search_announcements 로 한다.

    출처 — IRIS(범부처 국가R&D 공고. 공고문 첨부가 붙어 제출서류까지 판독된다) ·
    기업마당 · K-Startup(둘 다 공식 오픈API) ·
    NTIS(수행중 과제 정보라 접수기간이 없다. 신청할 수 있는 공고가 아니다).

    limit 의 단위가 출처마다 다르다 — IRIS·NTIS 는 건수, 기업마당은 첨부까지 판독할 건수
    (나머지는 목록만 저장), K-Startup 은 100건 단위 페이지로 환산한다.
    keyword 는 NTIS 검색어에만 쓴다.

    수집은 분 단위다. wait_seconds 만큼만 기다리고, 안 끝나면 run_id 를 돌려준다 —
    그 뒤 collect_progress 로 이어 본다. 도구 호출이 끊겨도 수집은 계속 돈다.
    (기본 40초는 챗 계층 타임아웃 120초 안에 답이 돌아오게 잡은 값이다.)
    """
    src = collect.출처정규화(source)
    if not src:
        목록 = "\n".join(f"- {k}: {v['설명']}" for k, v in collect.SOURCES.items())
        return f"모르는 출처: {source!r}\n쓸 수 있는 출처\n{목록}"

    도는중 = collect.진행중(src)
    if 도는중:
        return (
            f"{src} 수집이 이미 돌고 있다 — 같은 출처를 두 번 돌리지 않는다"
            f"(같은 행을 양쪽에서 쓰고, 헤드리스 호출도 두 배로 나간다).\n\n"
            + _수집요약(도는중)
        )

    if limit < 1:
        return "limit 은 1 이상이어야 한다. 무엇을 받아올지 정하지 않고 부르지 않는다."

    meta = collect.start(src, limit, keyword, db_since=_db_now())
    meta = collect.wait(meta, max(0, wait_seconds))
    return _수집요약(meta)


@mcp.tool()
def collect_progress(run_id: str = "") -> str:
    """돌고 있는(또는 방금 끝난) 공고 수집이 어디까지 갔는지 본다. 비워두면 가장 최근 수집."""
    meta = collect.read_meta(run_id) if run_id else (collect.진행중() or collect.latest_meta())
    if not meta:
        return none(
            f"{run_id!r} 수집 기록이 없다." if run_id else "수집을 돌린 적이 없다. collect_announcements 로 시작한다."
        )
    return _수집요약(meta)


@mcp.tool()
def collection_status() -> str:
    """출처별로 공고를 몇 건 갖고 있고 언제 마지막으로 받아왔는지 — 「지금 새로 받아와야 하나」에 답한다."""
    rows = q(
        "select 출처, count(*) as 총건수, max(created_at) as 최근수집,"
        " count(*) filter (where 마감유형 = 'dated' and 접수종료 >= current_date) as 접수중,"
        " count(*) filter (where 파싱상태 = '파싱완료') as 판독완료,"
        " count(*) filter (where created_at > now() - interval '24 hours') as 최근24h"
        " from app.announcements group by 출처 order by 총건수 desc"
    )
    if not rows:
        return none("수집된 공고가 하나도 없다. collect_announcements 로 받아온다.")

    out = ["출처별 수집 현황"]
    for r in rows:
        out.append(
            f"- {r['출처']}: 총 {r['총건수']}건 · 접수중 {r['접수중']}건 · 공고문 판독 {r['판독완료']}건"
            f"\n  마지막 수집 {str(r['최근수집'])[:16]}"
            + (f" · 최근 24시간 {r['최근24h']}건" if r["최근24h"] else "")
        )
    out.append(
        "\n※ 「접수중」은 마감일이 날짜로 적힌 공고만 센다. 상시·소진시는 날짜가 없어 못 센다."
        "\n※ NTIS 는 수행중 과제 정보(마감유형 '정보성')다 — 신청할 수 있는 공고가 아니다."
    )
    도는중 = collect.진행중()
    if 도는중:
        out.append(f"\n지금 {도는중['source']} 수집이 돌고 있다 — collect_progress('{도는중['run_id']}')")
    return "\n".join(out)


# ⚠ 반드시 파일 맨 끝. 이 아래에 도구를 정의하면 통째로 등록되지 않는다. 에러도 안 난다.
if __name__ == "__main__":
    mcp.run()
