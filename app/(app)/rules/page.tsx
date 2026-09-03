import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { RuleDocuments } from "@/components/rule-documents"
import {
  getRuleDocuments,
  getAnnouncementChoices,
  getSchemeChoices,
} from "@/lib/queries-rules"
import { getCurrentUser } from "@/lib/current-user"

export const dynamic = "force-dynamic"

/**
 * 규정 문서함 — **규정은 사업마다 다르다**는 사실을 시스템 안에 두는 자리.
 *
 * 지금까지 재원분담·연구수당·간접비 한도는 `app.funding_share_rules` 에 **쪽수로 인용**돼 있었는데
 * (`p.31 정부지원 비율표`), 그 쪽수가 가리키는 **원본**은 서버 파일시스템에만 있었다.
 * 사람이 새 공고 규정을 올릴 방법도 없었다. 이 화면이 그 둘을 푼다.
 *
 * 적용 범위는 규칙과 같은 축이다 — **공고 > 사업유형 > 공통.**
 */
export default async function RulesPage() {
  const [문서, 공고, 유형, who] = await Promise.all([
    getRuleDocuments(),
    getAnnouncementChoices(),
    getSchemeChoices(),
    getCurrentUser(),
  ])

  const 공고건 = 문서.rows.filter((d) => d.적용범위 === "공고").length
  const 유형건 = 문서.rows.filter((d) => d.적용범위 === "사업유형").length
  const 공통건 = 문서.rows.filter((d) => d.적용범위 === "공통").length

  return (
    <PageShell
      title="규정 문서함"
      description="공고·사업유형마다 규정이 다르다. 한도와 비율의 근거가 되는 원문을 여기에 두고, 어느 범위에 적용되는지까지 같이 남긴다."
    >
      {문서.error && <DbError what="규정 문서" error={문서.error} />}
      {공고.error && <DbError what="공고 목록" error={공고.error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="규정 문서" value={문서.rows.length} sub="전체" />
        <Stat label="공고별" value={공고건} sub="우선순위 1위 — 겹치면 공고를 따른다" />
        <Stat label="사업유형별" value={유형건} sub="그 유형의 모든 사업" />
        <Stat label="공통" value={공통건} sub="상위 법령·고시" />
      </div>

      <RuleDocuments
        문서={문서.rows}
        공고들={공고.rows}
        사업유형들={유형.rows}
        로그인={who.인증}
      />
    </PageShell>
  )
}
