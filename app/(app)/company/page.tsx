import { PageShell } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { CompanyForm, type CompanyValues } from "@/components/company-form"
import { db, safeSelect } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * 회사 프로필 — 자격 판정이 대조하는 기준값.
 *
 * 읽기 전용 표였던 것을 **입력 화면으로 바꿨다.** 이유는 두 가지다.
 *   ① 들어 있던 재무값이 합성값이었다(2026-09-03 확인). 지어낸 숫자로 자격을 판정하면
 *      틀린 답에 근거까지 붙여서 내놓는다 — 가장 나쁜 실패다. 그래서 비웠고, 비운 이상
 *      사람이 채울 자리가 있어야 한다.
 *   ② 지역·지원대상이 공고 탐색의 「우리 회사 조건」이 실제로 대조하는 값이다.
 *      DB 를 직접 고쳐야만 바꿀 수 있으면 시연 중에 조건을 못 바꾼다.
 *
 * 값이 비어 있으면 판정은 「확인 필요」로 남는다. 그게 정직한 상태다.
 */
export default async function CompanyPage() {
  const { rows, error } = await safeSelect<Record<string, unknown>>("company_profile", () =>
    db.from("company_profile").select("*").order("결산연도", { ascending: false }).limit(1),
  )
  const c = rows[0] ?? {}

  const values: CompanyValues = {
    결산연도: (c.결산연도 as number) ?? null,
    회사명: (c.회사명 as string) ?? null,
    사업자등록번호: (c.사업자등록번호 as string) ?? null,
    대표자: (c.대표자 as string) ?? null,
    소재지: (c.소재지 as string) ?? null,
    지역코드: (c.지역코드 as string[]) ?? null,
    기업규모: (c.기업규모 as string) ?? null,
    업종명: (c.업종명 as string[]) ?? null,
    주요제품: (c.주요제품 as string) ?? null,
    설립일: (c.설립일 as string) ?? null,
    지원대상_유형: (c.지원대상_유형 as string[]) ?? null,
    ksic_코드: (c.ksic_코드 as string[]) ?? null,
    종업원수: (c.종업원수 as number) ?? null,
    매출액: (c.매출액 as number) ?? null,
    매출증가율: (c.매출증가율 as number) ?? null,
    부채비율: (c.부채비율 as number) ?? null,
    rnd_집약도: (c.rnd_집약도 as number) ?? null,
    기업부설연구소: (c.기업부설연구소 as boolean) ?? false,
    자본전액잠식: (c.자본전액잠식 as boolean) ?? false,
    출처_문서: (c.출처_문서 as string) ?? null,
  }

  return (
    <PageShell
      title="회사 프로필"
      description="공고의 자격 요건이 이 값들과 대조된다. 비어 있으면 판정이 「확인 필요」로 남는다 — 추측으로 채우지 않는다."
    >
      {error && <DbError what="회사 프로필" error={error} />}
      <CompanyForm values={values} />
    </PageShell>
  )
}
