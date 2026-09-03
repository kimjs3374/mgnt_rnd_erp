import { DbError } from "@/components/db-error"
import { BudgetEditor, type Line } from "@/components/budget-editor"
import { FundingShareCard } from "@/components/funding-share-card"
import { EvidenceAttachments } from "@/components/evidence-attachments"
import {
  getProject,
  getProjectBudget,
  getCategories,
  getFundingShareRules,
  getCompanyProfile,
  getEvidenceRequirements,
  getProjectEvidenceFiles,
} from "@/lib/queries-project"
import { pickRule, computeShare } from "@/lib/funding-share"
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

  const [proj, budget, cats, rules, company, reqs, files, who] = await Promise.all([
    getProject(id),
    getProjectBudget(id),
    getCategories(),
    getFundingShareRules(),
    getCompanyProfile(),
    getEvidenceRequirements(),
    getProjectEvidenceFiles(id),
    getCurrentUser(),
  ])
  const p = proj.rows[0]

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
            : "총사업비가 비어 있어 재원을 나눌 수 없다. 개요 탭에서 총사업비를 먼저 넣는다."

  return (
    <>
      {proj.error && <DbError what="과제" error={proj.error} />}
      {budget.error && <DbError what="예산" error={budget.error} />}
      {cats.error && <DbError what="비목" error={cats.error} />}

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
      />

      <BudgetEditor
        과제_id={id}
        초기값={lines}
        협약={{
          총사업비: p?.총사업비 ?? null,
          정부지원금: p?.정부지원금 ?? null,
          기관부담_현금: p?.기관부담_현금 ?? null,
          기관부담_현물: p?.기관부담_현물 ?? null,
        }}
        비목목록={cats.rows.map((c) => ({ 코드: c.코드, 이름: c.이름 }))}
      />

      {/* 계상한 비목이 곧 준비해야 할 RCMS 증빙 목록이 된다. 그래서 계상 표 바로 아래에 둔다. */}
      {reqs.error && <DbError what="증빙 요건" error={reqs.error} />}
      {files.error && <DbError what="증빙 파일" error={files.error} />}
      <EvidenceAttachments
        과제_id={id}
        요건={reqs.rows}
        파일={files.rows}
        비목이름={Object.fromEntries(cats.rows.map((c) => [c.코드, c.이름]))}
        계상비목={Array.from(
          new Set(lines.filter((l) => Number(l.배정액) > 0).map((l) => l.비목_대분류)),
        )}
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
