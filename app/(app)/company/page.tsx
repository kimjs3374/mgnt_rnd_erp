import { PageShell, Card } from "@/components/page-shell"

/** 회사 프로필 — 자격 판정의 대조 기준. 값이 없으면 「확인 필요」로 남긴다. 지어내지 않는다. */
const PROFILE: { label: string; value: string; source: string }[] = [
  { label: "상호", value: "(주)매그나텍", source: "사업자등록증" },
  { label: "소재지", value: "전남 장성", source: "법인등기부등본" },
  { label: "업종(KSIC)", value: "—", source: "확인 필요" },
  { label: "종업원 수", value: "—", source: "확인 필요" },
  { label: "매출액 (최근 결산)", value: "—", source: "표준 재무제표" },
  { label: "부채비율", value: "—", source: "표준 재무제표" },
  { label: "자본전액잠식", value: "없음", source: "표준 재무제표" },
  { label: "R&D 집약도", value: "—", source: "기술기업개요표" },
  { label: "기업부설연구소", value: "보유", source: "연구소 인정서" },
]

export default function CompanyPage() {
  return (
    <PageShell
      title="회사 프로필"
      description="공고의 자격 요건이 이 값들과 대조된다. 비어 있으면 판정이 「확인 필요」로 남는다."
    >
      <Card className="divide-y">
        {PROFILE.map((p) => (
          <div
            key={p.label}
            className="flex items-center gap-4 px-4 py-2.5 text-[13px]"
          >
            <span className="w-44 shrink-0 text-muted-foreground">{p.label}</span>
            <span className="flex-1 font-medium tabular-nums">{p.value}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{p.source}</span>
          </div>
        ))}
      </Card>

      <p className="text-xs text-muted-foreground">
        값을 채울수록 자격 판정이 자동으로 끝난다. 비어 있는 것을 추측으로 채우면
        지원 자격이 없는 공고에 계획서를 쓰게 된다.
      </p>
    </PageShell>
  )
}
