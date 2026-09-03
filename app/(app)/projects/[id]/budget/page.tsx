import Link from "next/link"
import { DbError } from "@/components/db-error"
import { BudgetEditor, type Line } from "@/components/budget-editor"
import { FundingShareCard } from "@/components/funding-share-card"
import { FormTemplates } from "@/components/form-templates"
import { BudgetConfirmBar } from "@/components/budget-confirm-bar"
import { PersonnelEditor } from "@/components/personnel-editor"
import { ResearchersBoard } from "@/components/researchers-board"
import { 재원별합계 } from "@/lib/personnel"
import { getResearchers, getSalaryHistory } from "@/lib/queries-researchers"
import {
  getProject,
  getProjectBudget,
  getCategories,
  getFundingShareRules,
  getCompanyProfile,
  getEvidenceRequirements,
  getPersonnelCosts,
} from "@/lib/queries-project"
import { getConfirmState, getFormTemplates } from "@/lib/queries-confirm"
import { pickRule, computeShare } from "@/lib/funding-share"
import { verify, summarize } from "@/lib/verify"
import { 연차연도 } from "@/lib/fiscal-year"
import { getCurrentUser } from "@/lib/current-user"

export const dynamic = "force-dynamic"

/**
 * 연구비 계상 — 과제 하나의 비목별 배정액을 넣고 한도를 검산한다.
 *
 * 이 탭이 「예산」 전역 화면과 다른 점은 **쓸 수 있다**는 것이다.
 * 계상은 과제 단위로만 뜻이 있다 — 12개 과제의 인건비를 합친 숫자로는
 * 연구수당 한도도 간접비 역산도 계산되지 않는다. 기준이 과제마다 다르기 때문이다.
 *
 * 화면 순서가 곧 일하는 순서다 —
 *   ① **재원 구성**(정부출연금·민간부담금)을 공고·규정에서 자동으로 채우고,
 *   ② 그 금액을 기준으로 비목별 계상을 넣고 한도를 검산한다.
 * ①이 위에 있는 이유: verify() 의 ②번 검증이 「재원별 계상 = 협약 금액」이라
 * 협약 금액이 비어 있으면 아래 표가 무엇과 대조되는지 알 수 없다.
 */
export default async function ProjectBudgetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: raw } = await params
  const id = Number(raw)

  const [proj, budget, cats, rules, company, reqs, forms, people, confirm, who, 명부, 연봉이력] =
    await Promise.all([
      getProject(id),
      getProjectBudget(id),
      getCategories(),
      getFundingShareRules(),
      getCompanyProfile(),
      getEvidenceRequirements(),
      getFormTemplates(),
      getPersonnelCosts(id),
      getConfirmState(id),
      getCurrentUser(),
      // 내부 연구원 명부 — 인건비 표에서 골라 넣는다(`db/105_researchers.sql`).
      getResearchers(),
      // ⑥ 명부를 여기서 관리한다(2026-09-04 사용자 지시) — 연봉 이력까지 같이 읽는다.
      getSalaryHistory(),
    ])
  const p = proj.rows[0]
  // 계상이 확정됐으면 이 탭은 **볼 수만** 있다(`db/100`). 고치려면 [확정 해제]다 —
  // 「사업 대장으로 넘어간다」고 쓰지 않는다(그 이름은 지원사업 쪽 화면이다, 2026-09-04 정정).
  const 읽기전용 = confirm.확정

  // 협약이 걸친 회계연도들. **탭은 1차년도만 열고 사람이 늘린다**(사용자 지시) —
  // 협약이 여러 해여도 1차년도만 계상하고 넘어가는 경우가 흔해서, 빈 탭을 미리 벌리면
  // 「2차년도가 비어 있다」는 잘못된 인상을 준다. 그래서 연도 목록은 안내로만 쓴다.
  //
  // ⚠ 기간을 365.25 로 나누지 않는다. 연차는 회계연도로 센다 — 2022-06-01~2024-05-31 은
  //    기간이 2년이어도 2022·2023·2024 **3개 연차**다. 자세한 근거는 lib/fiscal-year.ts.
  const 연도목록 = 연차연도(p?.시작일, p?.종료일)
  const 연수 = 연도목록.length || Math.max(1, Number(p?.연차 ?? 1))

  // 개인별 인건비 합계(전 연차). 0 보다 클 때만 비목 인건비가 자동으로 맞춰진다.
  const 인건비합계 = Object.values(재원별합계(people.rows)).reduce((s, v) => s + (v || 0), 0)

  const 정렬 = new Map(cats.rows.map((c) => [c.코드, c.정렬 ?? 999]))
  const lines: Line[] = budget.rows
    .map((b) => ({
      비목_대분류: b.비목_대분류,
      비목명: b.비목명,
      재원구분: b.재원구분,
      배정액: Number(b.배정액 ?? 0),
      한도비율: b.한도비율 == null ? null : Number(b.한도비율),
      집행액: Number(b.집행액 ?? 0),
      기존: true,
    }))
    // 규정 순서로 고정한다. DB 입력순에 맡기면 화면마다 순서가 달라진다.
    .sort(
      (a, b) =>
        (정렬.get(a.비목_대분류) ?? 999) - (정렬.get(b.비목_대분류) ?? 999) ||
        a.재원구분.localeCompare(b.재원구분, "ko"),
    )

  // 재원 분담 규칙 고르기 — 공고 > 사업유형 > 규정 기본값. 판단은 순수 함수가 한다.
  const 기관유형 = company.rows[0]?.기업규모 ?? null
  // ⚠ `ProjectRow`(lib/queries.ts)에 공고_id 가 아직 없다. DB 컬럼은 있다.
  //    그 파일은 네 명이 같이 쓰는 공유 파일이라 타입을 고치러 열지 않는다(CLAUDE.md §1,
  //    queries.ts 저장 충돌이 두 번 났다). 여기서 좁혀서 읽는다.
  const 공고_id = (p as { 공고_id?: number | null } | undefined)?.공고_id ?? null
  const rule = pickRule(rules.rows, {
    공고_id,
    사업유형: p?.사업유형 ?? null,
    기관유형,
  })
  const 자동 = computeShare(p?.총사업비 ?? null, rule)

  // 왜 계산하지 못했는지를 화면이 말해야 한다. 「모르면 모른다고 한다」(설계원칙 5).
  const 없는이유 =
    자동 != null
      ? null
      : rules.error
        ? `재원 분담 규칙을 읽지 못했다: ${rules.error}`
        : 기관유형 == null
          ? "회사 프로필에 기업규모가 없어 어느 기관유형 규정을 적용할지 정할 수 없다. 회사 프로필을 먼저 채운다."
          : rule == null
            ? `${기관유형} 에 적용할 재원 분담 규칙이 없다. db/91_funding_share_rules.sql 로 규정을 넣거나, 공고에서 읽은 규칙을 등록한다.`
            // ⚠ "개요 탭에서 총사업비를 먼저 넣는다"였는데 개요 탭엔 그 칸이 없었다(실측) —
            //   총사업비를 실제로 바꾸는 곳은 협약금액_확정() 뿐이고, 그건 「과제 계상」 화면에서만 부른다.
            //   없는 곳을 가리키는 안내는 할 일을 못 만든다.
            : "총사업비가 비어 있어 재원을 나눌 수 없다. 「과제 계상」 화면에서 먼저 넣는다."

  // 확정 막대가 쓰는 값. 한도 위반은 세기만 하고 확정을 막지 않는다 —
  // 한도를 넘긴 채 협약된 과제가 실제로 있다(P01 연구수당 240,000원 초과).
  const 협약정보 = {
    총사업비: p?.총사업비 ?? null,
    정부지원금: p?.정부지원금 ?? null,
    기관부담_현금: p?.기관부담_현금 ?? null,
    기관부담_현물: p?.기관부담_현물 ?? null,
  }
  const 위반수 = summarize(verify(lines, 협약정보)).위반
  const 배정합 = lines.reduce((s, l) => s + Number(l.배정액 ?? 0), 0)
  const 계상비목 = Array.from(
    new Set(lines.filter((l) => Number(l.배정액) > 0).map((l) => l.비목_대분류)),
  )

  return (
    <>
      {proj.error && <DbError what="과제" error={proj.error} />}
      {budget.error && <DbError what="예산" error={budget.error} />}
      {cats.error && <DbError what="비목" error={cats.error} />}
      {confirm.error && <DbError what="계상 확정 상태" error={confirm.error} />}

      {/* 계상 탭은 계상하는 자리다. 다 잡으면 여기서 확정하고 관리 위치가 대장으로 넘어간다. */}
      <BudgetConfirmBar
        과제_id={id}
        과제명={p?.과제명 ?? ""}
        확정={confirm.확정}
        최신={confirm.최신}
        이력={confirm.이력}
        총사업비={Number(p?.총사업비 ?? 0)}
        배정합={배정합}
        위반수={위반수}
      />

      {/* 종료된 과제는 탭·대장·개요에서 계상으로 가는 길을 뺐으니, 여기까지 오는 길은
          주소·북마크뿐이다. 화면을 없애지 않고 왜 빠졌는지를 말한다 —
          계상 내역이 지워진 것이 아니라는 점이 중요하다. */}
      {p?.상태 === "종료" && (
        <div className="rounded-lg border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            종료된 과제입니다 — 연구비 계상은 탭에서 뺐습니다
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            계상은 협약·수행 중에 하는 일이라 끝난 과제에는 들어오는 길(과제 탭 · 대장의
            「계상」 · 개요의 「고치기」)을 두지 않습니다. 지난 계상이 지워진 것은 아닙니다 —{" "}
            <Link
              href={`/projects/${id}/settlement`}
              className="underline underline-offset-2"
            >
              정산 탭
            </Link>
            의 과제비 원장이 아래 배정액을 기준으로 집행과 대조합니다. 주소로 직접 들어왔기에
            아래를 그대로 열어 두지만, <b>여기서 배정액을 고치면 정산 대조 기준이 바뀝니다.</b>
          </p>
        </div>
      )}

      {/* 선정 전 계상은 **신청서에 넣는 계획**이다. 협약 계상과 화면이 똑같아서
          말해 주지 않으면 이미 확정된 금액을 만지는 것으로 읽힌다.
          (2026-09-04 사용자 지시로 신청중에도 계상을 열었다.) */}
      {p?.상태 === "신청중" && (
        <div className="rounded-lg border border-[var(--warning-fg)]/30 bg-[var(--warning)] p-4">
          <p className="text-sm font-medium text-[var(--warning-fg)]">
            신청 단계 계상입니다 — 아직 협약 금액이 아닙니다
          </p>
          <p className="mt-1 text-xs text-[var(--warning-fg)]">
            여기 잡는 금액은 <b>신청서·사업계획서에 넣는 계획</b>입니다. 선정되면 기관이 확정한
            협약 금액으로 <b>다시 맞춰야 합니다</b> — 금액이 깎여 오는 일이 흔합니다. 한도 검산
            (연구수당 · 간접비)은 지금도 그대로 돌아서, 제출 전에 규정에 어긋난 계상을 미리 잡습니다.{" "}
            <Link href="/projects/applying" className="underline underline-offset-2">
              신청중 목록
            </Link>
            에서 이 과제의 단계를 봅니다.
          </p>
        </div>
      )}

      <FundingShareCard
        과제_id={id}
        총사업비={p?.총사업비 ?? null}
        협약={{
          정부지원금: p?.정부지원금 ?? null,
          기관부담_현금: p?.기관부담_현금 ?? null,
          기관부담_현물: p?.기관부담_현물 ?? null,
        }}
        자동={자동}
        없는이유={없는이유}
        읽기전용={읽기전용}
      />

      {/* ★ 개인별 인건비가 **비목 표보다 위**에 있다(2026-09-04 사용자 지시).
          인건비는 사람마다 참여율·월급여가 달라 비목 합계 하나로는 만들 수 없고,
          **개인별 표가 근거이고 비목 인건비는 그 합계**다. 근거가 결과보다 아래 있으면
          읽는 순서가 거꾸로다 — 사람을 넣으면 아래 비목 인건비가 저절로 바뀐다. */}
      {people.error && <DbError what="개인별 인건비" error={people.error} />}
      <PersonnelEditor
        과제_id={id}
        초기값={people.rows}
        협약연수={연수}
        연차연도={연도목록}
        읽기전용={읽기전용}
        명부={명부.rows}
      />

      {/* ⑥ 연구원 명부 — 별도 탭에서 빼고 인건비 표 **바로 아래**에 접어 둔다.
          명부는 인건비 표에 이름을 넣기 위한 재료다. 화면이 갈려 있으면 「등록 → 메뉴 이동 →
          복귀 → 골라 넣기」 네 걸음이 된다. 늘 펼쳐 두지 않는 이유는 그 반대다 —
          계상하러 온 사람에게 명부가 먼저 보이면 그것도 순서가 거꾸로다. */}
      {!읽기전용 && (
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer list-none p-3 text-[13px] font-medium">
            연구원 명부 ({명부.rows.filter((r) => r.재직).length}명 재직 · 전체{" "}
            {명부.rows.length}명)
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              여기 등록해 두면 위 인건비 표에서 골라 넣습니다 — 과제마다 다시 치지 않습니다
            </span>
          </summary>
          <div className="border-t p-3">
            {명부.error && <DbError what="연구원 명부" error={명부.error} />}
            {연봉이력.error && <DbError what="연봉 이력" error={연봉이력.error} />}
            <ResearchersBoard rows={명부.rows} 이력={연봉이력.rows} />
          </div>
        </details>
      )}

      <BudgetEditor
        과제_id={id}
        초기값={lines}
        협약={협약정보}
        비목목록={cats.rows.map((c) => ({ 코드: c.코드, 이름: c.이름 }))}
        읽기전용={읽기전용}
        // 개인별 줄이 **금액을 갖고** 있으면 인건비는 그쪽이 진실이다. 여기서 고치면 다음 저장에 덮인다.
        // ⚠ 이름만 적어 둔 0원짜리 줄로는 잠그지 않는다 — 서버도 그때는 비목을 안 건드리므로
        //   (`app/actions/personnel.ts` 의 인건비동기화), 잠그면 고칠 길이 아예 없어진다.
        인건비자동={인건비합계 > 0}
      />

      {/* 계상한 비목이 요구하는 **서류 목록**과 그 서류의 회사 표준 양식.
          여기 있던 「비목별 증빙 파일」은 뺐다 — 증빙 실물은 집행 건 단위로 붙는 것이 맞고
          집행 탭(components/expense-evidence.tsx)이 이미 그 일을 한다. 계상 단계에서 필요한 것은
          「무슨 서류를 어떤 양식으로 쓸 것인가」이고, 그게 문서 통일화다. */}
      {reqs.error && <DbError what="증빙 요건" error={reqs.error} />}
      {forms.error && <DbError what="표준 양식" error={forms.error} />}
      <FormTemplates
        요건={reqs.rows.map((r) => ({
          서류명: r.서류명,
          구분: r.구분,
          비목_대분류: r.비목_대분류,
          필수여부: r.필수여부,
          개인정보포함: r.개인정보포함,
          순번: r.순번,
        }))}
        양식={forms.rows}
        사업유형={p?.사업유형 ?? null}
        비목이름={Object.fromEntries(cats.rows.map((c) => [c.코드, c.이름]))}
        계상비목={계상비목}
        로그인={who.인증}
      />

      <p className="text-xs text-muted-foreground">
        정부출연금·민간부담금은 공고 규칙이 있으면 그것을, 없으면 기관유형 규정을 적용해
        계산한다(공고 &gt; 사업유형 &gt; 규정). 근거가 「확정」이 아니면 값만 채우고 사람이 저장한다.
        연구수당은 수정인건비 × 한도%(백원 절사), 간접비는 곱셈이 아니라
        (직접비 − 현물) × r/(100+r) 총액 역산(백만원 절사)이다. 한도%가 비어 있으면 판정하지 않고
        「확인 필요」로 둔다 — 연구수당 비율이 사업마다 달라서 코드에 박지 않았다.
      </p>
    </>
  )
}
