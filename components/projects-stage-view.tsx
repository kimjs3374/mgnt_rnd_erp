import Link from "next/link"
import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { Button } from "@/components/ui/button"
import { getProjects, won } from "@/lib/queries"
import { ProjectCreateButton } from "@/components/project-create-button"
import { ProjectsLedger } from "@/components/projects-ledger"
import { getCurrentUser } from "@/lib/current-user"
import { db, safeSelect } from "@/lib/db"
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
 * 과제사업의 **단계별 화면 한 벌** — 신청중 · 수행중 · 사업종료.
 *
 * 세 화면이 읽는 데이터와 표가 똑같아서 한 컴포넌트로 두고 `단계` 만 바꿔 부른다.
 * 셋으로 복사하면 한 곳만 고쳐지고, 그 어긋남은 시연장에서 드러난다.
 *
 * 단계는 **저장하지 않고 계산한다**(`lib/project-stage.ts`) — 그래야 선정을 기록하는 순간
 * 수행중으로, 수행기간이 지나면 사업종료로 **저절로** 넘어간다(2026-09-03 사용자 지시).
 */
export async function ProjectsStageView({ 단계 }: { 단계: 보기범위 }) {
  const [{ rows: 전체, error }, 미배정, 스테이지, 책임자행, who] = await Promise.all([
    getProjects(),
    // 과제가 아직 정해지지 않은 집행. 사이드바에서 「집행」을 뺐으므로 여기서 알려주지 않으면
    // Slack 으로 막 들어온 건이 아무 화면에도 안 뜬다.
    safeSelect<{ id: number }>("expenses", () =>
      db.from("expenses").select("id").is("과제_id", null),
    ),
    // 선정결과는 `ProjectRow` 에 없고 `lib/queries.ts` 는 권태호 담당이라 건드리지 않는다.
    // ⚠ 한글 컬럼명을 select 문자열에 넣으면 supabase-js 타입 파서가 컴파일에서 막는다.
    safeSelect<{ id: number; 선정결과: string | null; 상태: string; 종료일: string | null }>(
      "projects",
      () => db.from("projects").select("*"),
    ),
    // 연구책임자는 옆 테이블에 있다(`db/104_project_lead.sql`).
    safeSelect<{ 과제_id: number; 표시명: string }>("project_leads", () =>
      db.from("project_leads").select("*"),
    ),
    getCurrentUser(),
  ])

  const 판정재료 = new Map(스테이지.rows.map((r) => [Number(r.id), r]))
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

  const 올해 = new Date().toISOString().slice(0, 4)
  const 심사중 = rows.filter((r) => (판정재료.get(r.id)?.선정결과 ?? "") === "발표심사").length
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label={`${단계} 과제 수`} value={rows.length} sub={정의.설명} />
        <Stat
          label="총사업비 합계"
          value={won(총사업비)}
          sub={단계 === "신청중" ? "협약 전이라 0 인 건이 섞여 있다" : `정부지원금 ${won(정부지원금)}`}
        />
        {전체보기중 ? (
          // 전체 보기에서는 단계별로 몇 건인지가 가장 궁금한 값이다.
          <Stat
            label="단계별"
            value={단계정의
              .map((d) => 과제들.filter((r) => 단계판정(재료(r)) === d.단계).length)
              .join(" · ")}
            sub="신청중 · 수행중 · 사업종료"
          />
        ) : 단계 === "신청중" ? (
          <Stat label="발표·심사 중" value={심사중} sub="결과를 기다리는 건" />
        ) : 단계 === "수행중" ? (
          <Stat label={`${올해}년 안에 끝남`} value={올해끝} sub="완료보고를 준비할 건" />
        ) : (
          <Stat
            label="상태가 안 맞는 건"
            value={밀린종료.length}
            sub="수행기간은 끝났는데 저장된 상태가 수행중"
            tone={밀린종료.length > 0 ? "warn" : "default"}
          />
        )}
      </div>

      <ProjectsLedger
        rows={rows}
        책임자={책임자}
        로그인={who.인증}
        단계={단계}
        단계별={단계별}
        밀린종료={밀린종료}
      />

      {단계 === "신청중" && (
        <>
          {/* 사업비 계상은 **신청서에 넣는 것**이라 선정 전에 하는 일이다.
              선정된 뒤에 처음 계상하는 순서는 실제 일과 반대다(2026-09-04 사용자 지시로 열었다). */}
          <p className="text-xs text-muted-foreground">
            신청 단계에서도 <b>과제비를 계상할 수 있습니다</b> — 줄 오른쪽의 「계상」을 누르거나{" "}
            <Link href="/project-budgeting" className="underline underline-offset-2">
              과제 계상
            </Link>
            에서 「신청 단계만」으로 걸러 보세요. 한도 검산(연구수당 · 간접비)이 지금도 돌아
            제출 전에 규정에 어긋난 계상을 잡아냅니다.
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
