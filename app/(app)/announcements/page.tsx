import { AnnouncementsView } from "@/components/announcements-view"
import { SyncAnnouncementsButton } from "@/components/sync-announcements-button"
import { getProgramAnnouncements } from "@/lib/queries-programs"

export const dynamic = "force-dynamic"

/**
 * 지원사업 > 공고 탐색.
 *
 * **과제사업 공고 탐색(/project-announcements)과 같은 화면을 쓴다** —
 * components/announcements-explorer.tsx 하나를 공유하고, 이 화면만 다른 것만 prop 으로 넘긴다.
 * 두 화면이 다르게 생기면 같은 일을 두 번 배워야 하고 고칠 때도 두 곳을 고쳐야 한다.
 *
 * 다른 것은 출처와 판정 근거뿐이다.
 *   과제사업 — IRIS 공고문(HWP·PDF)을 받아 LLM 으로 요건을 읽어 판정한다.
 *   지원사업 — 기업마당·K-Startup 오픈API 가 지역·지원대상을 정제해서 주므로
 *              **계산으로** 대조한다(CLAUDE.md 설계원칙 1). 등급과 배지는 같은 4종이다.
 */
export default async function AnnouncementsPage() {
  const { rows, error, company } = await getProgramAnnouncements()

  const 출처별 = 지원사업_출처별건수(rows)
  const 가능 = rows.filter((r) => r.자격판정 === "가능").length
  const 불가 = rows.filter((r) => r.자격판정 === "불가").length
  const 미확정 = rows.filter(
    (r) => r.자격판정 === "확인필요" || r.자격판정 === "요건미확인",
  ).length
  const 중복건수 = rows.filter((r) => r.중복후보).length

  const banner =
    rows.length === 0
      ? "수집된 공고가 없습니다. 우측 위 「동기화」를 누르면 기업마당·K-Startup 오픈API에서 목록이 채워집니다."
      : company
        ? `${출처별} 실제 수집한 공고 ${rows.length}건입니다. ` +
          `${company.회사명 ?? "회사"}(${company.지역코드.join("·") || "지역 미설정"} · ${company.지원대상_유형.join("·") || "대상 미설정"}) 기준으로 ` +
          `신청 가능 ${가능}건, 지역·대상이 맞지 않는 것이 ${불가}건, 공고가 대상을 밝히지 않아 확인이 필요한 것이 ${미확정}건입니다. ` +
          `판정은 오픈API가 준 지역·지원대상을 계산으로 대조한 결과입니다 — 「불가」는 확실할 때만 붙입니다.` +
          (중복건수 > 0
            ? ` 재공고·연장공고로 보이는 중복 후보 ${중복건수}건이 있습니다 — 자동 병합하지 않고 후보로만 표시합니다.`
            : "")
        : `${출처별} 실제 수집한 공고 ${rows.length}건입니다. 회사 프로필이 비어 있어 대조할 기준이 없습니다 — 「회사 > 회사 프로필」에서 지역·지원대상을 채우면 자격판정이 살아납니다.`

  return (
    <AnnouncementsView
      title="공고 탐색 (지원사업)"
      description="기업마당·K-Startup 공식 오픈API로 공고를 모아, 회사 프로필의 지역·지원대상과 대조해 우리가 신청할 수 있는 것을 가린다."
      rows={rows}
      error={error}
      banner={banner}
      actions={<SyncAnnouncementsButton />}
      showSource
      emptyHint="「동기화」를 누르면 기업마당·K-Startup 오픈API 목록이 채워집니다."
      footer={
        <div className="rounded-lg border bg-card p-4 text-[13px]">
          <h2 className="mb-2 text-sm font-semibold">판정 등급 4종</h2>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">가능</span> — 지역·지원대상이 모두
              우리와 맞는다
            </li>
            <li>
              <span className="font-medium text-foreground">불가</span> — 공고가 밝힌 지역이
              우리 밖이거나, 지원대상에 우리가 없다
            </li>
            <li>
              <span className="font-medium text-foreground">확인 필요</span> — 공고가 지원대상을
              안 밝혔다. <b>「불가」로 적지 않는다</b> — 그러면 신청할 수 있는 공고가 조용히
              사라진다
            </li>
            <li>
              <span className="font-medium text-foreground">요건 미확인</span> — 회사 프로필이
              비어 대조 자체를 못 했다
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            지역은 기관이 사업명에 붙인 대괄호 태그와 소관부처에서 읽는다(기업마당), 또는
            API 가 준 지역 필드를 쓴다(K-Startup). 둘 다 없으면 「미상」으로 두고 걸러내지 않는다.
            접수기간도 절반 이상이 날짜가 아니다(상시·소진시·회차별 상이) — 파싱되면 D-day,
            안 되면 유형 배지. <b>날짜를 지어내지 않는다.</b>
          </p>
        </div>
      }
    />
  )
}

/** "기업마당 302건 · K-Startup 500건으로" — 어느 출처가 몇 건인지 배너가 먼저 말한다. */
function 지원사업_출처별건수(rows: { 출처: string }[]): string {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.출처, (m.get(r.출처) ?? 0) + 1)
  if (m.size === 0) return ""
  return (
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}건`)
      .join(" · ") + "으로"
  )
}
