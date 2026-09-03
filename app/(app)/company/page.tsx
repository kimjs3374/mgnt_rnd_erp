import { PageShell, Card, EmptyState } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { getCompany, won } from "@/lib/queries"

export const dynamic = "force-dynamic"

const pct = (n: number | null) => (n == null ? "—" : `${n}%`)

/** 회사 프로필 — 자격 판정의 대조 기준. 값이 없으면 「확인 필요」로 남긴다. 지어내지 않는다. */
export default async function CompanyPage() {
  const { rows, error } = await getCompany()
  const c = rows[0]

  const fields = c
    ? [
        { label: "결산연도", value: String(c.결산연도), source: c.출처_문서 ?? "—" },
        { label: "매출액", value: won(c.매출액), source: "표준 재무제표" },
        { label: "매출증가율", value: pct(c.매출증가율), source: "표준 재무제표" },
        { label: "부채비율", value: pct(c.부채비율), source: "표준 재무제표" },
        {
          label: "자본전액잠식",
          value: c.자본전액잠식 ? "해당" : "없음",
          source: "표준 재무제표",
        },
        { label: "R&D 집약도", value: pct(c.rnd_집약도), source: "기술기업개요표" },
        {
          label: "기업부설연구소",
          value: c.기업부설연구소 ? "보유" : "미보유",
          source: "연구소 인정서",
        },
        {
          label: "업종(KSIC)",
          value: c.ksic_코드?.length ? c.ksic_코드.join(", ") : "—",
          source: "사업자등록증",
        },
        {
          label: "종업원 수",
          value: c.종업원수 != null ? `${c.종업원수}명` : "—",
          source: "4대보험 가입자명부",
        },
      ]
    : []

  const 미입력 = fields.filter((f) => f.value === "—").length

  return (
    <PageShell
      title="회사 프로필"
      description="공고의 자격 요건이 이 값들과 대조된다. 비어 있으면 판정이 「확인 필요」로 남는다."
    >
      {error && <DbError what="회사 프로필" error={error} />}

      <Card className="divide-y">
        {!c && !error ? (
          <EmptyState
            title="회사 프로필이 없습니다"
            hint="자격 판정이 대조할 기준이 없어 모든 요건이 「확인 필요」로 남습니다."
          />
        ) : (
          fields.map((f) => (
            <div key={f.label} className="flex items-center gap-4 px-4 py-2.5 text-[13px]">
              <span className="w-44 shrink-0 text-muted-foreground">{f.label}</span>
              <span
                className={
                  f.value === "—"
                    ? "flex-1 tabular-nums text-muted-foreground"
                    : "flex-1 font-medium tabular-nums"
                }
              >
                {f.value}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{f.source}</span>
            </div>
          ))
        )}
      </Card>

      {c && 미입력 > 0 && (
        <p className="text-xs text-[var(--warning-fg)]">
          비어 있는 항목 {미입력}개 — 그만큼 자격 판정이 「확인 필요」로 남는다.
          추측으로 채우면 지원 자격이 없는 공고에 계획서를 쓰게 된다.
        </p>
      )}
    </PageShell>
  )
}
