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
            "접수기간만 보고 「신청 가능」이라고 하면 안 된다 — 실측에서 1,479건 중 729건이 그렇게 잘못 찍혔다.\n"
            f"→ 판정하려면 먼저 parse_announcement({announcement_id}) 로 공고문에서 요건을 뽑는다."
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


def _쓰기환경():
    """announce.py 는 쓰기(service_role)를 하므로 SERVICE_ROLE_KEY 가 필요하다.

    ⚠ 맨 위에서 import 하면 안 된다. mcp.json 은 RND_DSN 만 넘기므로 키가 없는 자리에서
      import 하는 순간 KeyError 로 **서버가 통째로 죽는다 — 그런데 에러는 안 보이고**
      모델이 "연결에 실패한 것 같다"고만 말한다(§4.5 함정 4번과 같은 증상).
      그래서 도구를 부를 때 환경을 먼저 채우고 그 다음에 import 한다.
    """
    if "SERVICE_ROLE_KEY" not in os.environ:
        path = os.environ.get("RND_ENV_FILE", "/rnd/docker/.env")
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
        except OSError as e:
            return f"쓰기 자격증명을 못 읽었다({path}): {e}"
    if "SERVICE_ROLE_KEY" not in os.environ:
        return "SERVICE_ROLE_KEY 가 없다. 이 도구는 DB 에 써야 해서 읽기 전용 자격증명만으로는 못 돈다."
    return ""


@mcp.tool()
def parse_announcement(announcement_id: int, force: bool = False) -> str:
    """공고문에서 자격 요건을 뽑아 DB 에 넣는다. 판정(eligibility_check)의 앞 단계다.

    「요건 미확인」이라고 나온 공고에 이걸 쓴다. 요건이 이미 있으면 다시 뽑지 않는다
    (force=true 로만 재판독한다 — 헤드리스 호출 한 번이 그대로 한도다).

    공고문 첨부가 없는 공고는 오픈API 요약으로 판독하고, 무엇을 읽었는지 답에 밝힌다.
    요약에서 뽑은 요건은 공고문에서 뽑은 것보다 성기다 — 그걸 감추지 않는다.
    확신도 0.70 미만은 저장하되 필수여부를 끈다. 애매한 것으로 「지원 불가」를 만들지 않는다.
    """
    ann = q(
        "select 사업명, coalesce(nullif(본문,''),'') as 본문, coalesce(nullif(요약,''),'') as 요약,"
        " 공고문_url from app.announcements where id = %s",
        (announcement_id,),
    )
    if not ann:
        return none(f"공고 {announcement_id} 가 없다.")
    a = ann[0]

    있는것 = q(
        "select count(*) as n from app.ann_requirements where announcement_id = %s", (announcement_id,)
    )[0]["n"]
    if 있는것 and not force:
        return (
            f"'{a['사업명']}' — 자격 요건이 이미 {있는것}건 들어 있다. 다시 뽑지 않는다.\n"
            f"판정은 eligibility_check({announcement_id}) 로 한다. 다시 읽히려면 force=true."
        )

    if not a["본문"] and not a["요약"]:
        붙임 = f"\n공고문 파일은 있다({a['공고문_url']}) — 수집 단계에서 첨부를 못 읽은 것이다." if a["공고문_url"] else ""
        return (
            f"'{a['사업명']}' — 읽을 공고문도 요약도 없다. 요건을 지어내지 않는다."
            f"{붙임}\n→ collect_announcements 로 이 출처를 다시 받아오면 본문이 채워질 수 있다."
        )

    err = _쓰기환경()
    if err:
        return err
    import announce  # noqa: PLC0415 — 위 주석 참조. 반드시 환경을 채운 뒤에 부른다.

    try:
        res = announce.extract_and_save(announcement_id)
    except Exception as e:  # 헤드리스 실패·PostgREST 실패를 모델에게 그대로 알린다
        return f"'{a['사업명']}' 요건 판독 실패: {type(e).__name__}: {e}"

    요건, 기타 = res.get("요건") or [], res.get("기타") or []
    if not 요건 and not 기타:
        return (
            f"'{a['사업명']}' — {res.get('판독원본')}에서 자격 요건을 못 찾았다"
            f"{' (' + res['사유'] + ')' if res.get('사유') else ''}.\n"
            "판정: 요건 미확인. 없는 요건을 만들어내지 않는다."
        )

    out = [
        f"'{a['사업명']}' 요건 {len(요건)}건 저장 ({res.get('판독원본')} 판독"
        + (", 본문이 길어 자격 구간만 잘라 읽음" if res.get("잘림") else "")
        + ")"
    ]
    for r in 요건:
        기준 = " ".join(str(x) for x in (r.get("연산자"), r.get("기준값"), r.get("단위")) if x)
        out.append(
            f"- [{'필수' if r.get('필수여부') else '조건'}] {r.get('항목')}"
            + (f" {기준}" if 기준 else "")
            + (f"\n  근거: {str(r.get('원문'))[:120]}" if r.get("원문") else "")
        )
    if 기타:
        out.append(f"\n어휘에 없는 요건 {len(기타)}건 — 자동 판정에 안 쓰고 사람이 본다")
        for r in 기타[:5]:
            out.append(f"- {str(r.get('내용') or r)[:100]}")
    out.append(f"\n→ 이제 eligibility_check({announcement_id}) 로 회사 프로필과 대조한다.")
    return "\n".join(out)


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



# ─────────────────────────────────────────────────────────────────────────────
# 규칙 판정 — LLM 을 부르지 않는다 (bot/ann_score.py)
#
# eligibility_check 와 다른 층이다: eligibility_check 는 parse_announcement 가
# LLM 으로 뽑은 ann_requirements 를 대조한다(요건 추출에 헤드리스 1회가 든다).
# 여기는 요건 추출도 정규식으로 한다 — 판정 전 과정에 LLM 호출이 0 이다.
# 그래서 836건 전체를 미리 돌려둘 수 있고, 아래 도구들은 그 결과를 읽기만 한다.
# ─────────────────────────────────────────────────────────────────────────────
@mcp.tool()
def rule_eligibility_scan(region: str = "", 판정: str = "") -> str:
    """규칙 엔진이 이미 매긴 자격판정을 훑어본다. LLM 을 부르지 않는다 — 즉시 답한다.

    판정을 "가능"·"불가"·"확인필요"·"요건미확인" 중 하나로 좁힐 수 있다.
    아직 한 번도 안 돌렸으면(v_ann_rule_coverage 가 비어 있으면) rule_eligibility_check 로
    한 건을 먼저 테스트하거나, 배치는 서버에서 `bot/ann_rules.py 배치` 로 돌린다.
    """
    cov = q("select * from app.v_ann_rule_coverage order by 엔진버전 desc limit 1")
    if not cov:
        return none("규칙 판정을 아직 한 번도 안 돌렸다. rule_eligibility_check(공고id) 로 한 건을 먼저 본다.")
    c = cov[0]

    sql = (
        "select r.announcement_id, a.사업명, a.지역, r.판정, r.점수, r.확신도, r.커버리지, r.판정경로"
        "  from app.ann_rule_scores r join app.announcements a on a.id = r.announcement_id"
        " where r.엔진버전 = %s"
    )
    params: tuple = (c["엔진버전"],)
    if 판정:
        sql += " and r.판정 = %s"
        params += (판정,)
    if region:
        sql += " and coalesce(a.지역,'') ilike %s"
        params += (f"%{region}%",)
    sql += " order by r.점수 desc, r.확신도 desc limit 30"
    rows = q(sql, params)

    out = [
        f"규칙 엔진 {c['엔진버전']} · 전체 공고 {c['전체공고']}건 중 {c['판정건수']}건 판정"
        f" · LLM 호출 0회(전부)"
        f"\n가능 {c['가능']} · 불가 {c['불가']} · 확인필요 {c['확인필요']} · 요건미확인 {c['요건미확인']}"
        f" · 평균 커버리지 {c['평균커버리지']}"
    ]
    if not rows:
        out.append(f"\n조건(판정={판정 or '전체'}, 지역={region or '전체'})에 맞는 공고가 없다.")
        return "\n".join(out)

    out.append(f"\n표본 {len(rows)}건 (점수·확신도 순):")
    for r in rows:
        out.append(
            f"- [{r['announcement_id']}] {r['판정']} {r['점수']}점 (확신도 {r['확신도']}, "
            f"커버리지 {r['커버리지']}) · {r['사업명']}"
        )
    out.append(
        "\n※ 「요건미확인」은 본문을 못 읽었거나 조항을 다 못 갈랐다는 뜻이다 — 「불가」가 아니다."
        "\n※ 한 건을 자세히 보려면 rule_eligibility_check(공고id)."
    )
    return "\n".join(out)


@mcp.tool()
def rule_eligibility_check(announcement_id: int) -> str:
    """공고 한 건을 규칙 엔진으로 판정한다. LLM 호출 0회, 보통 20ms 안에 끝난다.

    eligibility_check 와 출력 형식이 비슷하지만 이건 즉석에서 다시 계산한다(항상 최신
    company_profile·사람 답변을 반영). 게이트마다 근거문장을 원문 그대로 붙인다 —
    확신도 0.70 미만은 이미 코드가 확정을 막아뒀다(§6 설계 원칙 2번).
    """
    err = _쓰기환경()
    if err:
        return err
    import ann_rules  # noqa: PLC0415 — 환경을 채운 뒤에만 import 한다(§4.5 함정 4번과 같은 이유)

    try:
        r = ann_rules.score_announcement(announcement_id, save=True)
    except LookupError as e:
        return none(str(e))
    except Exception as e:
        return f"규칙 판정 실패: {type(e).__name__}: {e}"

    out = [
        f"'{r['사업명']}'",
        f"판정: {r['판정']} · {r['점수']}점 · 확신도 {r['확신도']} · 커버리지 {r['커버리지']}"
        f" (메타 {r['커버리지_상세']['메타']} / 본문 {r['커버리지_상세']['본문']})"
        f" · LLM 호출 0회 · {r.get('ms')}ms",
    ]
    if not r["본문사용"]:
        out.append(f"⚠ 본문을 못 읽었다({r['본문길이']}자) — 커버리지가 낮아 판정이 메타 정보에만 기댄다.")

    out.append("\n게이트:")
    for g in r["게이트_결과"]:
        표 = "통과" if g["통과"] else ("보류" if g.get("보류") else "위반")
        out.append(f"  [{표}] {g['키']}: {g['사유']}\n    근거: {g['근거'][:140]}")

    if r["특징_기여"]:
        out.append("\n가산:")
        for c in r["특징_기여"]:
            out.append(f"  +{c['점수']:g}점 {c['키']} — {c['근거'][:100]}")

    if r["확인필요항목"]:
        out.append(f"\n확인 필요: {', '.join(r['확인필요항목'])}")
        for qn in r.get("질문", []):
            out.append(f"  Q. {qn['질문']}")
        out.append(
            "  → answer_eligibility_question 으로 답을 넣으면 즉시 다시 판정되고,"
            " 일반화되는 답은 다음 공고에서 다시 안 묻는다."
        )

    out.append(
        "\n※ 「불가」인 게이트는 계산으로 확정된 것이다(마감일·지역·지원대상 등)."
        " 「확인필요」는 회사 정보나 서류가 더 필요하다는 뜻이지 판정이 아니다."
    )
    return "\n".join(out)


@mcp.tool()
def answer_eligibility_question(
    announcement_id: int,
    특징키: str,
    사람_값: str,
    답변자: str,
    일반화: bool = False,
    짚은문구: str = "",
) -> str:
    """규칙 엔진이 「확인 필요」로 올린 질문에 답한다. 답은 그대로 쌓이고, 그 공고를 즉시 다시 판정한다.

    특징키는 rule_eligibility_check 가 「확인 필요」 목록에 준 것을 그대로 쓴다
    (예: "부채비율_상한", "체납_제외", "기업부설연구소_필수").
    일반화=true 면 이 답이 회사 사실로 굳어져 **다른 공고에서도 같은 질문이 다시 안 뜬다**
    (예: 체납 여부·연구소 보유 여부). 공고마다 달라지는 것(지역 보류 등)은 일반화하지 않는다.

    짚은문구를 주면 — 공고 원문에서 그 조건을 말한 문장 일부를 그대로 옮기면 — 다음부터
    같은 문구가 나오는 다른 공고도 정규식 없이 이 값으로 자동 인식된다(extraction_lexicon).
    이게 이 시스템이 「학습해서 LLM 의존도를 낮춘다」고 말하는 것의 실제 동작이다.
    """
    err = _쓰기환경()
    if err:
        return err
    import ann_rules  # noqa: PLC0415

    try:
        r = ann_rules.record_answer(
            announcement_id=announcement_id, 특징키=특징키, 사람_값=사람_값,
            답변자=답변자, 일반화=일반화, 짚은문구=(짚은문구 or None),
        )
    except ValueError as e:
        return f"입력을 확인할 것: {e}"
    except Exception as e:
        return f"답변 저장 실패: {type(e).__name__}: {e}"

    out = [f"답 저장됨: {특징키} = {사람_값}" + (" (일반화 — 회사 사실로 굳음)" if 일반화 else " (이 공고 한정)")]
    if r.get("lexicon"):
        out.append(f"패턴도 학습됨: {r['lexicon']['패턴']!r} → 다음부터 이 문구가 보이면 자동 인식된다")
    if r.get("판정"):
        p = r["판정"]
        out.append(f"\n재판정: {p['판정']} · {p['점수']}점 · 확신도 {p['확신도']}"
                   + (f"\n남은 확인필요: {', '.join(p['확인필요항목'])}" if p["확인필요항목"] else "\n확인필요 항목 없음"))
    return "\n".join(out)



# ─────────────────────────────────────────────────────────────────────────────
# 의미 기반 판정 학습 — 사람이 판정+코멘트를 남기면 임베딩해서 쌓고, 다음 공고에서
# 문구가 달라도 뜻이 비슷하면 참고 사례로 보여준다. LLM 을 부르지 않는다 —
# 로컬 임베딩 모델(격리된 venv, bot/embed_cli.py)만 쓴다.
#
# extraction_lexicon(문자열 그대로 일치)과 다른 층이다 — "일반음식점을 영업 중인
# 자"를 배웠어도 문구가 그대로 같아야 다시 걸리는 게 아니라, "이미용업소는요"처럼
# 뜻만 비슷해도 코사인 유사도로 찾아낸다.
# ─────────────────────────────────────────────────────────────────────────────
@mcp.tool()
def similar_past_judgments(announcement_id: int) -> str:
    """이 공고와 뜻이 비슷한 과거 판정 사례를 찾는다. 정답을 대신 정하지 않는다 —

    "예전에 비슷한 걸 이렇게 판단했다"는 참고 사례만 준다. 사람이 아직 아무것도
    안 남겼으면(judgment_semantic 이 비어 있으면) "사례 없음"이라고 정직하게 답한다.
    """
    ann = q("select 사업명, 요약 from app.announcements where id = %s", (announcement_id,))
    if not ann:
        return none(f"공고 {announcement_id} 가 없다.")

    err = _쓰기환경()  # 임베딩 계산도 격리 venv 를 부르는 무거운 호출이라 같은 가드를 쓴다
    if err:
        return err
    import semantic_learn  # noqa: PLC0415

    질의 = f"{ann[0]['사업명']} {ann[0]['요약'] or ''}".strip()
    try:
        matches = semantic_learn.find_similar(질의)
    except Exception as e:
        return f"의미 검색 실패: {type(e).__name__}: {e}"

    if not matches:
        return (f"'{ann[0]['사업명']}'와 뜻이 비슷한 과거 판정 사례가 없다.\n"
                "→ 사람이 이 공고를 판정+코멘트로 남기면(record_judgment_comment) "
                "다음부터 비슷한 공고에 참고 사례로 쓰인다.")

    out = [f"'{ann[0]['사업명']}'와 뜻이 비슷한 과거 판정 {len(matches)}건:"]
    for m in matches:
        out.append(
            f"  유사도 {m['유사도']:.2f} · 판정 {m['판정']}"
            + (f" · {m['특징키']}" if m.get("특징키") else "")
            + f"\n    \"{m['텍스트'][:80]}\""
            + (f"\n    사유: {m['사유']}" if m.get("사유") else "")
            + f" ({m.get('답변자')})"
        )
    out.append("\n※ 참고 사례일 뿐이다 — 이 공고 자체의 판정은 rule_eligibility_check 로 확인한다.")
    return "\n".join(out)


@mcp.tool()
def record_judgment_comment(
    announcement_id: int, 텍스트: str, 판정: str, 답변자: str,
    특징키: str = "", 사유: str = "",
) -> str:
    """사람의 판정과 코멘트를 의미 검색용으로 쌓는다.

    텍스트는 판정의 **근거가 된 공고문 문장**을 그대로 옮긴다(판정 결과 자체가
    아니라 왜 그런지를 말하는 문장이어야 다음에 비슷한 문장이 나왔을 때 걸린다).
    판정은 가능ㆍ불가ㆍ확인필요ㆍ요건미확인ㆍ해당없음 중 하나.
    """
    err = _쓰기환경()
    if err:
        return err
    import semantic_learn  # noqa: PLC0415

    try:
        row = semantic_learn.record_judgment(
            텍스트, 판정, 답변자, announcement_id=announcement_id,
            특징키=(특징키 or None), 사유=(사유 or None),
        )
    except ValueError as e:
        return f"입력을 확인할 것: {e}"
    except Exception as e:
        return f"저장 실패: {type(e).__name__}: {e}"

    return (f"저장됨(#{row.get('id')}): {판정} · \"{텍스트[:60]}\"\n"
            "→ 다음부터 뜻이 비슷한 공고에서 similar_past_judgments 로 이 사례가 보인다.")


# ─────────────────────────────────────────────────────────────────────────────
# 사업계획서 작성 어시스턴트 (참가 계획서 문항4②)
#
#   계획서에 적은 것: "사업계획서 작성 시 사업비목 분류에 시간이 많이 걸리는 문제를
#   해결하기 위해, 챗봇 형식으로 대화하면서 전체적인 사업계획서 청사진을 그려준다."
#
#   설계: 도구가 **글을 쓰지 않는다.** 도구는 재료와 「아직 모르는 것」을 모아 주고,
#   글은 챗봇이 쓴다. 그래야 Slack 봇과 웹 챗이 같은 재료로 같은 답을 한다.
#   비목 배분처럼 **계산으로 확정되는 자리는 도구 안에서 끝낸다** — LLM 에게 넘기면
#   합계가 안 맞는 표가 나온다(설계원칙 2).
# ─────────────────────────────────────────────────────────────────────────────
@mcp.tool()
def plan_draft(announcement_id: int) -> str:
    """사업계획서 청사진에 필요한 재료를 한 번에 모은다. 공고 요건·제출서류·회사 프로필·
    과거 유사 과제·아직 모르는 것을 함께 돌려준다. 챗봇은 이걸 받아 목차별 초안을 쓰고,
    「모르는 것」에 적힌 항목만 사람에게 물어본다.
    """
    ann = q(
        """
        select id, 사업명, 소관부처, 전문기관, 지역, 접수시작, 접수종료, 마감유형, 공고url
          from app.announcements where id = %s
        """,
        (announcement_id,),
    )
    if not ann:
        return none(f"공고 {announcement_id} 가 없다")
    a = ann[0]

    조각 = [
        f"# 공고 #{a['id']} — {a['사업명']}",
        f"소관 {a['소관부처'] or '—'} · 전문기관 {a['전문기관'] or '—'} · 지역 {a['지역'] or '—'}",
        f"접수 {a['접수시작'] or '—'} ~ {a['접수종료'] or a['마감유형'] or '—'}",
    ]

    s = q(
        """select 지원분야, 지원대상, 지원규모, 접수방법, 사업요약
             from app.ann_summary where announcement_id = %s""",
        (announcement_id,),
    )
    if s:
        d = s[0]
        조각 += [
            "",
            "## 공고 요약",
            f"- 지원분야: {d['지원분야'] or '—'}",
            f"- 지원대상: {d['지원대상'] or '—'}",
            f"- 지원규모: {d['지원규모'] or '—'}",
            f"- 접수방법: {d['접수방법'] or '—'}",
            f"- 요약: {(d['사업요약'] or '—')[:400]}",
        ]
    else:
        조각 += ["", "## 공고 요약", "- **아직 안 읽었다.** parse_announcement 로 먼저 읽혀야 한다."]

    req = q(
        """select 항목, 필수여부, 연산자, 기준값, 단위, 원문
             from app.ann_requirements where announcement_id = %s
            order by 필수여부 desc, 항목""",
        (announcement_id,),
    )
    조각 += ["", f"## 자격 요건 ({len(req)}건)"]
    for r in req[:20]:
        기준 = ""
        if r["연산자"] and r["기준값"] is not None:
            기준 = f" {r['연산자']} {r['기준값']}{r['단위'] or ''}"
        조각.append(
            f"- [{'필수' if r['필수여부'] else '참고'}] {r['항목']}{기준} — 근거: {(r['원문'] or '')[:120]}"
        )
    if not req:
        조각.append("- 없음. **요건을 못 읽은 것과 요건이 없는 것은 다르다** — 「요건 미확인」으로 둔다.")

    docs = q(
        """select 서류명, 필수여부, 유효기간_문구, 구분
             from app.ann_required_docs where announcement_id = %s
            order by 필수여부 desc, 서류명""",
        (announcement_id,),
    )
    조각 += ["", f"## 제출 서류 ({len(docs)}건)"]
    for r in docs[:30]:
        꼬리 = f" · 유효기간 {r['유효기간_문구']}" if r["유효기간_문구"] else ""
        조각.append(f"- [{'필수' if r['필수여부'] else '해당시'}] {r['서류명']}{꼬리}")
    if not docs:
        조각.append("- 아직 못 읽었다.")

    # 보유 서류와 맞대 본다 — 「무엇을 더 떼야 하는가」가 계획서 착수의 첫 질문이다.
    보유 = {r["이름"]: r["상태"] for r in q("select 이름, 상태 from app.v_document_status")}
    미보유 = [r["서류명"] for r in docs if r["필수여부"] and r["서류명"] not in 보유]
    if 미보유:
        조각 += ["", "### 아직 서류함에 없는 필수 서류", *(f"- {n}" for n in 미보유[:15])]

    cp = q(
        """select 회사명, 결산연도, 매출액, 부채비율, 종업원수, rnd_집약도,
                  기업부설연구소, ksic_코드
             from app.company_profile order by 결산연도 desc limit 1"""
    )
    조각 += ["", "## 우리 회사"]
    if cp:
        c = cp[0]
        조각 += [
            f"- {c['회사명'] or '—'} · {c['결산연도']}년 결산",
            f"- 매출 {won(c['매출액'])} · 부채비율 {c['부채비율']}% · 종업원 {c['종업원수']}명",
            f"- R&D 집약도 {c['rnd_집약도']}% · 기업부설연구소 "
            f"{'보유' if c['기업부설연구소'] else '없음'} · 업종 {c['ksic_코드'] or '—'}",
        ]
    else:
        조각.append("- **회사 프로필이 비어 있다.** 먼저 채워야 자격 판정이 된다.")

    과거 = q(
        """
        with 비목별 as (
          -- ⚠ budgets 는 (과제, 대분류, 재원구분) 단위라 인건비가 현금·현물로 두 줄 난다.
          --   먼저 대분류로 모으지 않으면 「인건비 · 인건비」로 찍힌다(실측).
          select b.과제_id, b.비목_대분류, sum(b.배정액) as 배정액
            from app.budgets b group by b.과제_id, b.비목_대분류
        )
        select p.id, p.과제명, p.시작일, p.종료일, p.총사업비,
               string_agg(c.이름 || ' ' || to_char(v.배정액, 'FM999,999,999'), ' · '
                          order by c.정렬) as 계상
          from app.projects p
          join 비목별 v on v.과제_id = p.id
          join app.categories c on c.코드 = v.비목_대분류
         where p.상태 in ('수행중', '종료')
         group by p.id
         order by p.시작일 desc nulls last limit 3
        """
    )
    조각 += ["", "## 과거 우리 과제 (계획서에 그대로 쓸 수 있는 실적)"]
    for r in 과거:
        조각.append(
            f"- [{r['id']}] {r['과제명']} ({r['시작일']}~{r['종료일']}, 총 {won(r['총사업비'])})\n"
            f"    계상: {r['계상']}"
        )
    if not 과거:
        조각.append("- 없음")

    # ★ 도구가 답을 지어내지 않는 자리. 모르는 것은 사람에게 묻게 만든다(설계원칙 5).
    모르는것 = [
        "이 공고에 낼 과제명(가제)",
        "총사업비 규모와 수행기간(개월)",
        "참여연구원 인원과 각자 참여율",
        "핵심 기술 아이템 한 줄 — 무엇을 개발하는가",
        "컨소시엄 여부(대학·출연연이 들어오면 기관유형별로 계상 규칙이 달라진다)",
    ]
    if not cp:
        모르는것.insert(0, "회사 프로필(매출·부채비율·종업원수) — 자격 판정의 전제")
    조각 += ["", "## 사람에게 물어야 할 것", *(f"- {n}" for n in 모르는것)]

    조각 += [
        "",
        "## 이 재료로 할 일",
        "1. 위 요건을 목차로 바꿔 계획서 청사진을 쓴다. 요건 하나가 목차 한 줄이다.",
        "2. 「사람에게 물어야 할 것」은 **지어내지 말고 물어본다.** 한 번에 하나씩.",
        "3. 총사업비가 정해지면 `budget_draft` 로 비목 배분을 받는다 — "
        "그건 계산이라 내가 문장으로 만들지 않는다.",
    ]
    return "\n".join(조각)


@mcp.tool()
def budget_draft(
    total_budget: int,
    org_type: str = "중소기업",
    ref_project_id: int | None = None,
) -> str:
    """총사업비를 비목별로 배분한 계상 초안. **LLM 이 아니라 계산이다.**

    배분 비율은 우리 회사 과거 과제의 실제 계상 구조에서 가져온다(같은 회사의 관행이
    규정보다 앞선다). 절사단위로 절사하고 남은 잔액은 가장 큰 비목에 얹어 **합계를 보존**한다.
    """
    # ⚠ **인자 이름은 ASCII 로 둔다.** 도구 이름에 한글을 못 쓰는 것과 같은 제약이
    #   인자에도 걸린다 — 한글 인자로 두면 모델이 도구를 못 부르고 "도구가 작동하지
    #   않는다"고 **거짓말을 한다**(2026-09-04 실측: turns=1, 호출 0회).
    #   에러가 안 보여서 원인 찾기가 최악이다. 안쪽 이름만 한글로 옮겨 받는다.
    총사업비, 기관유형, 참고과제_id = total_budget, org_type, ref_project_id

    if 총사업비 <= 0:
        return "총사업비는 0보다 커야 한다."

    rule = q(
        """select 기관유형, 정부출연_상한, 민간현금_최소, 민간현물_최대,
                  간접비_상한, 연구수당_상한, 절사단위, 원문, 출처, 상태
             from app.funding_share_rules
            where 기관유형 = %s
            order by (상태 = '확정') desc, 사업유형 nulls last limit 1""",
        (기관유형,),
    )
    if not rule:
        있는것 = ", ".join(r["기관유형"] for r in q("select distinct 기관유형 from app.funding_share_rules"))
        return f"기관유형 「{기관유형}」 규칙이 없다. 있는 것: {있는것}"
    R = rule[0]
    절사 = 10 ** int(R["절사단위"] or 3)

    # ① 배분 비율 — 과거 과제의 실제 계상에서. 없으면 못 만든다고 말한다.
    where, params = "", ()
    if 참고과제_id:
        where, params = "where b.과제_id = %s", (참고과제_id,)
    ratio = q(
        f"""
        select b.비목_대분류, c.이름, c.정렬, sum(b.배정액)::numeric as 합
          from app.budgets b join app.categories c on c.코드 = b.비목_대분류
          {where}
         group by b.비목_대분류, c.이름, c.정렬
         order by c.정렬
        """,
        params,
    )
    if not ratio:
        return none("참고할 과거 계상이 없다. 과제를 하나라도 계상해 두어야 배분 비율이 나온다")

    총합 = sum(float(r["합"]) for r in ratio)
    if 총합 <= 0:
        return none("과거 계상 합계가 0이라 비율을 못 낸다")

    # ② 절사 배분. 잔액은 가장 큰 비목에 얹는다 — 합계가 1원도 안 틀리게(명세 B.13).
    배분: list[dict] = []
    for r in ratio:
        몫 = int(총사업비 * (float(r["합"]) / 총합))
        배분.append({"코드": r["비목_대분류"], "이름": r["이름"], "금액": (몫 // 절사) * 절사})
    잔액 = 총사업비 - sum(b["금액"] for b in 배분)
    if 잔액:
        배분.sort(key=lambda b: -b["금액"])
        배분[0]["금액"] += 잔액

    # ③ 한도 검증 — 규정이 정한 답이 하나뿐인 자리. 넘으면 그대로 말한다.
    경고: list[str] = []
    for b in 배분:
        if b["코드"] == "INDIRECT" and R["간접비_상한"] is not None:
            상한 = int(총사업비 * float(R["간접비_상한"]) / 100)
            if b["금액"] > 상한:
                경고.append(f"간접비 {won(b['금액'])} 가 상한 {R['간접비_상한']}%({won(상한)})를 넘는다")
        if b["코드"] == "ALLOWANCE" and R["연구수당_상한"] is not None:
            인건비 = next((x["금액"] for x in 배분 if x["코드"] == "PERSONNEL"), 0)
            상한 = int(인건비 * float(R["연구수당_상한"]) / 100)
            if 인건비 and b["금액"] > 상한:
                경고.append(
                    f"연구수당 {won(b['금액'])} 가 인건비의 {R['연구수당_상한']}%({won(상한)})를 넘는다"
                )

    출연 = int(총사업비 * float(R["정부출연_상한"]) / 100)
    부담 = 총사업비 - 출연
    현금최소 = int(부담 * float(R["민간현금_최소"] or 0) / 100)

    배분.sort(key=lambda b: next(r["정렬"] for r in ratio if r["비목_대분류"] == b["코드"]))
    줄 = [
        f"# 계상 초안 — 총사업비 {won(총사업비)} · {R['기관유형']}",
        f"참고한 비율: {'과제 ' + str(참고과제_id) if 참고과제_id else '우리 회사 과거 과제 전체'}"
        f" · 절사 {절사:,}원 단위",
        "",
        "## 비목별 배분",
    ]
    for b in 배분:
        줄.append(f"- {b['이름']}: {won(b['금액'])} ({b['금액'] / 총사업비 * 100:.1f}%)")
    줄 += [
        f"- **합계 {won(sum(b['금액'] for b in 배분))}** (총사업비와 일치)",
        "",
        "## 재원 구성 (규칙)",
        f"- 정부출연금 상한 {R['정부출연_상한']}% → 최대 {won(출연)}",
        f"- 기관부담금 {won(부담)} 중 현금 최소 {R['민간현금_최소'] or 0}% → {won(현금최소)} 이상",
        f"- 현물 최대 {R['민간현물_최대'] or 0}%",
        f"- 근거: {R['출처']} ({R['상태']})",
    ]
    if 경고:
        줄 += ["", "## ⚠ 한도 초과"] + [f"- {w}" for w in 경고]
    else:
        줄 += ["", "한도 점검(간접비·연구수당)에서 걸린 것 없음."]

    줄 += [
        "",
        "⚠ 이 배분은 **과거 관행을 그대로 늘린 것**이다. 이번 과제의 장비 구입이 크거나 "
        "위탁이 붙으면 사람이 손으로 옮겨야 한다. 옮긴 뒤에도 합계는 맞아야 한다.",
    ]
    return "\n".join(줄)


# ⚠ 반드시 파일 맨 끝. 이 아래에 도구를 정의하면 통째로 등록되지 않는다. 에러도 안 난다.
if __name__ == "__main__":
    mcp.run()
