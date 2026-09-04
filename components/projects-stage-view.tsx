import Link from "next/link"
import { FolderKanban, Wallet, Layers, Presentation, CalendarClock, TriangleAlert } from "lucide-react"
import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { Button } from "@/components/ui/button"
import { getProjects, won } from "@/lib/queries"
import { ProjectCreateButton } from "@/components/project-create-button"
import { ProjectsLedger } from "@/components/projects-ledger"
import { getCurrentUser } from "@/lib/current-user"
import { db, safeSelect } from "@/lib/db"
import { getEvidenceGaps } from "@/lib/queries-evidence-gap"
import { EvidenceGapCard } from "@/components/evidence-gap-card"
import { getCategories } from "@/lib/queries-project"
import { getNextSettlement } from "@/lib/queries-settlement-day"
import { SettlementDeadlineCard } from "@/components/settlement-deadline-card"
import {
  단계판정,
  단계정의,
  미선정인가,
  종료표시가_밀렸나,
  보기목록,
  전체보기,
  type 과제단계,
  type 보기범위,
} from "@/lib/project-stage"

export const dynamic = "force-dynamic"

/**
 * 과제사업의 **단계별 화면 한 벌** — 신청중 · 신청완료 · 수행중 · 사업종료.
 *
 * 네 화면이 읽는 데이터와 표가 똑같아서 한 컴포넌트로 두고 `단계` 만 바꿔 부른다.
 * 넷으로 복사하면 한 곳만 고쳐지고, 그 어긋남은 시연장에서 드러난다.
 *
 * 단계는 **저장하지 않고 계산한다**(`lib/project-stage.ts`) — 그래야 선정을 기록하는 순간
 * 수행중으로, 수행기간이 지나면 사업종료로 **저절로** 넘어간다(2026-09-03 사용자 지시).
 */
export async function ProjectsStageView({ 단계 }: { 단계: 보기범위 }) {
  const [{ rows: 전체행, error }, 미배정, 스테이지, 책임자행, who, 증빙, 공고행] = await Promise.all([
    getProjects(),
    // 과제가 아직 정해지지 않은 집행. 사이드바에서 「집행」을 뺐으므로 여기서 알려주지 않으면
    // Slack 으로 막 들어온 건이 아무 화면에도 안 뜬다.
    safeSelect<{ id: number }>("expenses", () =>
      db.from("expenses").select("id").is("과제_id", null),
    ),
    // 선정결과는 `ProjectRow` 에 없고 `lib/queries.ts` 는 권태호 담당이라 건드리지 않는다.
    // ⚠ 한글 컬럼명을 select 문자열에 넣으면 supabase-js 타입 파서가 컴파일에서 막는다.
    safeSelect<{ id: number; 선정결과: string | null; 상태: string; 종료일: string | null; 공고_id: number | null }>(
      "projects",
      () => db.from("projects").select("*"),
    ),
    // 연구책임자는 옆 테이블에 있다(`db/104_project_lead.sql`).
    safeSelect<{ 과제_id: number; 표시명: string }>("project_leads", () =>
      db.from("project_leads").select("*"),
    ),
    getCurrentUser(),
    // 사업비 증빙이 빈 곳(2026-09-04 사용자 지시). 집행 건별 필수 서류 기준이다.
    getEvidenceGaps(),
    // ⚠ 「과제 관리」는 과제사업만 본다(2026-09-04 사용자 지적 — 지원사업 관리에 있는
    //   건이 여기에도 섞여 나왔다). 공고 출처로 지원사업(기업마당·K-Startup)을 걸러낸다.
    //   이 필터가 팀원의 이후 편집으로 한 번 사라졌었다 — 다시 지우지 않는다.
    safeSelect<{ id: number; 출처: string }>("announcements", () =>
      db.from("announcements").select("id,출처"),
    ),
  ])

  const 지원사업_출처 = new Set(["기업마당", "K-Startup"])
  const 공고출처 = new Map(공고행.rows.map((a) => [a.id, a.출처]))
  const 판정재료 = new Map(스테이지.rows.map((r) => [Number(r.id), r]))
  const 전체 = 전체행.filter((r) => {
    const 공고_id = 판정재료.get(r.id)?.공고_id ?? null
    if (공고_id == null) return true
    return !지원사업_출처.has(공고출처.get(공고_id) ?? "")
  })
  /**
   * 판정에 쓸 값. 선정결과는 위 조회에서 오고, 상태·종료일은 목록 행이 이미 갖고 있다.
   * 조회가 실패하면 선정결과 없이 판정한다 — 못 읽었다고 화면을 비우지 않는다.
   */
  const 재료 = (r: { id: number; 상태: string; 종료일: string | null }) => ({
    상태: r.상태,
    선정결과: 판정재료.get(r.id)?.선정결과 ?? null,
    종료일: r.종료일,
  })

  // 미선정 건은 세 단계 어디에도 넣지 않는다 — 과제가 되지 못한 건이라 지원사업 대장에서 본다.
  const 과제들 = 전체.filter((r) => !미선정인가(재료(r)))
  const 전체보기중 = 단계 === "전체"
  const rows = 전체보기중 ? 과제들 : 과제들.filter((r) => 단계판정(재료(r)) === 단계)

  /**
   * 과제 id → 단계. **서버가 한 번만 판정해서 넘긴다.**
   * 표가 다시 판정하면 규칙이 두 곳에 생기고, 한쪽만 고쳐지는 날이 온다.
   */
  const 단계별 = Object.fromEntries(rows.map((r) => [r.id, 단계판정(재료(r))])) as Record<
    number,
    과제단계
  >

  // 전체 보기에서도 밀린 종료를 짚어 준다 — 사업종료 화면에 안 들어가도 눈에 띄어야 한다.
  const 밀린종료 =
    단계 === "사업종료" || 전체보기중
      ? rows.filter((r) => 종료표시가_밀렸나(재료(r))).map((r) => r.id)
      : []

  const 정의 = 전체보기중
    ? { 단계: "전체" as 보기범위, 경로: 전체보기.경로, 설명: 전체보기.설명 }
    : 단계정의.find((d) => d.단계 === 단계)!
  const 총사업비 = rows.reduce((s, r) => s + (r.총사업비 ?? 0), 0)
  const 정부지원금 = rows.reduce((s, r) => s + (r.정부지원금 ?? 0), 0)

  // 이 화면에 보이는 과제 중에서만 센다. 안 보이는 과제의 구멍을 세면 숫자가 안 맞아 보인다.
  // 비목 코드 → 한글. 목록에 EQUIP_PURCHASE 가 보이면 안 된다.
  const 비목 = await getCategories()
  const 증빙미비과제 = rows.filter((r) => 증빙.gaps[r.id])
  const 빈집행건 = 증빙미비과제.reduce((s, r) => s + (증빙.gaps[r.id]?.빈집행건 ?? 0), 0)
  const 빈칸 = 증빙미비과제.reduce((s, r) => s + (증빙.gaps[r.id]?.빈칸 ?? 0), 0)

  // 매월 정산 마감. **규칙·공휴일·그 달만 다른 날을 전부 DB 에서 읽는다**(`db/114`) —
  // 회계 일정은 매번 달라져서 코드에 박으면 고칠 때마다 배포해야 한다(2026-09-04 사용자 지시).
  const 정산 = await getNextSettlement()

  const 올해 = new Date().toISOString().slice(0, 4)
  const 올해끝 = rows.filter((r) => String(r.종료일 ?? "").slice(0, 4) === 올해).length

  const 책임자 = Object.fromEntries(
    책임자행.rows.map((r) => [Number(r.과제_id), String(r.표시명 ?? "")]),
  ) as Record<number, string>

  return (
    <PageShell
      title={단계}
      description={정의.설명}
      actions={
        <>
          {/* 공고 없이 과거 사업을 대장에 담는 길. 공고에서 시작하는 건은 [지원 등록] 쪽이다. */}
          <ProjectCreateButton />
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            ⤓ Excel
          </Button>
        </>
      }
    >
      {error && <DbError what="과제사업" error={error} />}

      {/* 단계는 나뉘어 있어도 옆 단계로 바로 건너갈 수 있어야 한다. 사이드바까지 안 가게. */}
      <div className="flex flex-wrap items-center gap-1">
        {보기목록.map((b) => {
          const 수 =
            b.이름 === "전체"
              ? 과제들.length
              : 과제들.filter((r) => 단계판정(재료(r)) === b.이름).length
          const 지금 = b.이름 === 단계
          return (
            <Link
              key={b.이름}
              href={b.경로}
              aria-current={지금 ? "page" : undefined}
              className={
                "rounded-md border px-2.5 py-1 text-[12.8px] transition-colors " +
                (지금
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60")
              }
            >
              {b.이름} <span className="tabular-nums">{수}</span>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* 숫자 아래 글은 짧게 — 정의.설명(페이지 설명 문단)은 위에 이미 떴다.
            같은 말을 카드 안에 다시 길게 적을 필요가 없다(2026-09-04 사용자 지시). */}
        <Stat
          icon={FolderKanban}
          label={`${단계} 과제 수`}
          value={rows.length}
          sub={
            전체보기중
              ? "선정 결과 포함"
              : 단계 === "신청중"
                ? "접수 완료, 심사 전"
                : 단계 === "신청완료"
                  ? "발표·심사 중, 결과 대기"
                  : 단계 === "수행중"
                    ? "협약 기간 안"
                    : "정산·보고 남을 수 있음"
          }
        />
        <Stat
          icon={Wallet}
          label="총사업비 합계"
          value={won(총사업비)}
          sub={
            단계 === "신청중" || 단계 === "신청완료"
              ? "협약 전이라 0 인 건이 섞여 있다"
              : `정부지원금 ${won(정부지원금)}`
          }
        />
        {전체보기중 ? (
          // ⚠ 여기 「단계별(2 · 6 · 4)」 카드가 있었는데 **바로 위 단계 칩이 같은 숫자**를
          //   이미 말하고 있어서 자리만 먹었다(사용자 지적). 정산에서 실제로 반려되는
          //   **사업비 증빙**으로 바꿨다 — 지금 이 대장에서 제일 크게 빈 곳이다.
          // ★ 눌러서 **어느 과제의 어느 집행에 무슨 서류가 없는지** 보고, 그 자리로 바로 간다
          //   (2026-09-04 사용자 지시). 숫자만 있으면 「3건」을 보고도 할 일을 모른다.
          <EvidenceGapCard
            과제들={증빙미비과제.map((r) => ({
              id: r.id,
              과제명: r.과제명,
              구멍: 증빙.gaps[r.id]!,
            }))}
            비목이름={Object.fromEntries(비목.rows.map((c) => [c.코드, c.이름]))}
          />
        ) : 단계 === "신청중" ? (
          // 발표·심사는 이제 「신청완료」 단계로 따로 있다(2026-09-04, 신청중·신청완료 분리) —
          // 여기서는 다음에 뭘 기다리는지만 짧게 말해 준다.
          <Stat icon={Layers} label="다음 단계" value="신청완료" sub="발표·심사가 기록되면 자동으로 넘어간다" />
        ) : 단계 === "신청완료" ? (
          <Stat icon={Presentation} label="발표·심사 중" value={rows.length} sub="선정 결과를 기다리는 건" />
        ) : 단계 === "수행중" ? (
          <Stat
            icon={CalendarClock}
            label={`${올해}년 안에 끝남`}
            value={올해끝}
            sub="완료보고를 준비할 건"
          />
        ) : (
          <Stat
            icon={TriangleAlert}
            label="상태가 안 맞는 건"
            value={밀린종료.length}
            sub="종료 처리 필요"
            tone={밀린종료.length > 0 ? "warn" : "default"}
          />
        )}

        {/* 매월 정산 마감까지 남은 날(2026-09-04 사용자 지시).
            ⚠ 음력 공휴일(설·부처님오신날·추석)은 달력을 확인하고 넣은 값이 아니라
               `lib/settlement-day.ts` 의 목록을 사람이 검산해야 한다.
               그래서 **날짜를 그대로 적어** 눈으로 대조할 수 있게 하고, 확인이 필요하면 말한다. */}
        {/* 확인하는 자리가 곧 고치는 자리다 — 설정 화면을 따로 두면 매번 찾게 된다. */}
        <SettlementDeadlineCard 정산={정산} />
      </div>

      <ProjectsLedger
        rows={rows}
        책임자={책임자}
        로그인={who.인증}
        단계={단계}
        단계별={단계별}
        증빙={증빙.gaps}
        밀린종료={밀린종료}
      />

      {(단계 === "신청중" || 단계 === "신청완료") && (
        <>
          {/* 사업비 계상은 **신청서에 넣는 것**이라 선정 전에 하는 일이다.
              선정된 뒤에 처음 계상하는 순서는 실제 일과 반대다(2026-09-04 사용자 지시로 열었다).
              예전엔 여기서 전용 대기열 화면(「과제 계상」)으로 보냈는데 그 화면을 없앴다 —
              총사업비도 이제 줄 오른쪽 「계상」 링크를 눌러 들어간 연구비 계상 탭에서 바로 채운다.
              신청완료(발표·심사 중)도 협약 전이라 신청중과 같은 안내를 그대로 쓴다
              (탭 노출 규칙도 raw 상태="신청중" 기준이라 신청완료 건도 계상 탭이 열려 있다,
              `components/project-tabs.tsx`). */}
          <p className="text-xs text-muted-foreground">
            신청 단계에서도 <b>과제비를 계상할 수 있습니다</b> — 줄 오른쪽의 「계상」을 눌러 열면
            재원 구성 카드에서 총사업비를 넣고 규정으로 나눌 수 있습니다. 한도 검산(연구수당 ·
            간접비)이 지금도 돌아 제출 전에 규정에 어긋난 계상을 잡아냅니다.
          </p>
          <p className="text-xs text-muted-foreground">
            결과가 나오면 공고 상세의 「지원 · 선정 · 대장」에서 [선정]을 누르세요 — 그 줄이 바로{" "}
            <Link href="/projects" className="underline underline-offset-2">
              수행중
            </Link>
            으로 넘어갑니다. 그때 <b>협약 금액으로 계상을 다시 맞춥니다.</b>
          </p>
        </>
      )}

      {미배정.rows.length > 0 && (
        <p className="text-xs text-[var(--warning-fg)]">
          과제가 아직 정해지지 않은 집행이 {미배정.rows.length}건 있습니다 —{" "}
          <Link href="/expenses" className="underline underline-offset-2">
            전체 집행에서 과제를 지정하세요
          </Link>
          . Slack 으로 막 들어온 건은 과제가 비어 있을 수 있습니다.
        </p>
      )}
    </PageShell>
  )
}
