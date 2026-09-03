import Link from "next/link"
import { FolderKanban, Wallet, ClipboardCheck, FileWarning } from "lucide-react"
import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { Button } from "@/components/ui/button"
import { ProgramsTable } from "@/components/programs-table"
import { db, safeSelect } from "@/lib/db"
import { getLedger, won } from "@/lib/queries"
import { 단계판정, 미선정인가, 단계정의, 보기목록, 전체보기, type 사업단계 } from "@/lib/program-stage"

export const dynamic = "force-dynamic"

/**
 * 지원사업의 **단계별 화면 한 벌** — 신청중 · 수행중 · 사업종료 (+ 전체).
 *
 * `components/projects-stage-view.tsx`와 같은 모양이다 — 한 컴포넌트를 `단계`만 바꿔 부른다.
 * 다만 지원사업은 연구비 계상·인건비·증빙요건 같은 R&D 전용 개념이 없어서(사업유형마다
 * 다르다 — `창업지원`은 정산이 단순 영수증이다), `/programs`(지원사업 대장)가 원래 갖고
 * 있던 Stat 넷(사업 수·지원금액·미처리 점검·미확보 서류)과 `ProgramsTable`만 그대로 쓴다.
 *
 * 단계는 **저장하지 않고 계산한다**(`lib/program-stage.ts` → `lib/project-stage.ts`) —
 * 판정 규칙은 과제사업과 완전히 같다(같은 테이블, `사업유형`만 다르다).
 */
export async function ProgramsStageView({ 단계 }: { 단계: 사업단계 | "전체" }) {
  const [{ rows: 전체행, error }, 종료일행] = await Promise.all([
    getLedger(),
    // LedgerRow(v_program_ledger)에는 상태·선정결과는 있는데 종료일이 없다 —
    // 단계판정에 필요해서 원본 projects에서 그것만 따로 읽는다(권태호 파일인 queries.ts는 안 건드린다).
    safeSelect<{ id: number; 종료일: string | null }>("projects", () =>
      db.from("projects").select("id,종료일"),
    ),
  ])

  // ⚠ v_program_ledger는 app.projects 전체(지원사업+과제사업)를 안 가리고 다 보여준다.
  //   「지원사업」 화면이라는 이름과 실제 내용이 어긋나면 안 되니 국가 R&D(과제사업)를 뺀다
  //   (programs/page.tsx와 같은 필터, 2026-09-04).
  const 지원사업 = 전체행.filter((r) => r.사업유형 !== "국가 R&D")

  const 종료일맵 = new Map(종료일행.rows.map((r) => [r.id, r.종료일]))
  const 재료 = (r: { id: number; 상태: string; 선정결과: string | null }) => ({
    상태: r.상태,
    선정결과: r.선정결과,
    종료일: 종료일맵.get(r.id) ?? null,
  })

  // 미선정 건은 세 단계 어디에도 넣지 않는다 — 사업이 되지 못한 건이다.
  const 사업들 = 지원사업.filter((r) => !미선정인가(재료(r)))
  const 전체보기중 = 단계 === "전체"
  const rows = 전체보기중 ? 사업들 : 사업들.filter((r) => 단계판정(재료(r)) === 단계)

  const 정의 = 전체보기중
    ? { 단계: "전체" as const, 경로: 전체보기.경로, 설명: 전체보기.설명 }
    : 단계정의.find((d) => d.단계 === 단계)!

  const 총지원금 = rows.reduce((s, r) => s + (r.지원금액 ?? 0), 0)
  const 총사용 = rows.reduce((s, r) => s + (r.사용금액 ?? 0), 0)
  const 점검 = rows.reduce((s, r) => s + (r.미처리점검 ?? 0), 0)
  const 서류 = rows.reduce((s, r) => s + (r.미확보서류 ?? 0), 0)

  return (
    <PageShell
      title={단계 === "전체" ? "지원사업 관리" : 단계}
      description={정의.설명}
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-7 text-[12.8px]"
            render={<a href="/api/programs/xlsx" />}
          >
            ⤓ Excel
          </Button>
          {/* 대장에 줄이 생기는 유일한 경로는 공고 지원이다(app/actions/apply.ts). */}
          <Button type="button" className="h-7 text-[12.8px]" render={<Link href="/announcements" />}>
            + 공고에서 등록
          </Button>
        </>
      }
    >
      {error && <DbError what="지원사업 대장" error={error} />}
      {종료일행.error && <DbError what="사업 기간" error={종료일행.error} />}

      {/* 단계는 나뉘어 있어도 옆 단계로 바로 건너갈 수 있어야 한다 — 사이드바까지 안 가게. */}
      <div className="flex flex-wrap items-center gap-1">
        {보기목록.map((b) => {
          const 수 =
            b.이름 === "전체"
              ? 사업들.length
              : 사업들.filter((r) => 단계판정(재료(r)) === b.이름).length
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
        <Stat
          icon={FolderKanban}
          label="사업 수"
          value={rows.length}
          sub={전체보기중 ? "검토 · 심사 · 수행 · 종료" : 정의.설명}
        />
        <Stat icon={Wallet} label="지원금액 합계" value={won(총지원금)} sub={`사용 ${won(총사용)}`} />
        <Stat
          icon={ClipboardCheck}
          label="미처리 점검"
          value={점검}
          sub="누락 · 날짜오류 · 금액 불일치"
          tone={점검 > 0 ? "warn" : "default"}
        />
        <Stat
          icon={FileWarning}
          label="미확보 서류"
          value={서류}
          sub="필수 서류 기준"
          tone={서류 > 0 ? "warn" : "default"}
        />
      </div>

      <ProgramsTable rows={rows} />
    </PageShell>
  )
}
