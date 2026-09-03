import Link from "next/link"
import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { Button } from "@/components/ui/button"
import { ProgramsTable } from "@/components/programs-table"
import { getLedger, won } from "@/lib/queries"

// 대장은 늘 최신이어야 한다. 빌드 시점에 굳히지 않는다.
export const dynamic = "force-dynamic"

/**
 * 지원사업 대장 — 이 시스템의 중심 화면.
 * app.v_program_ledger 뷰 하나만 읽는다. 케이오시가 엑셀로 관리하던 관리대장을 대체한다.
 *
 * 검색·상태필터·정렬은 `ProgramsTable`(클라이언트 컴포넌트)이 갖는다 — 전체 목록을
 * 서버에서 한 번에 받아온 뒤 화면 안에서만 걸러 쓴다. 개요 Stat 4개는 필터 영향을 받지 않는다
 * (필터링된 부분집합의 합계를 대장 전체 합계처럼 보여주면 숫자가 거짓말을 한다).
 */
export default async function ProgramsPage() {
  const { rows, error } = await getLedger()

  const 총지원금 = rows.reduce((s, r) => s + (r.지원금액 ?? 0), 0)
  const 총사용 = rows.reduce((s, r) => s + (r.사용금액 ?? 0), 0)
  const 점검 = rows.reduce((s, r) => s + (r.미처리점검 ?? 0), 0)
  const 서류 = rows.reduce((s, r) => s + (r.미확보서류 ?? 0), 0)

  return (
    <PageShell
      title="지원사업 대장"
      description="공고 → 자격판정 → 신청 → 선정 → 집행·증빙 → 보고. 한 건의 생애주기를 한 줄로 본다."
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
          {/* 대장에 줄이 생기는 유일한 경로는 공고 지원이다(app/actions/apply.ts) —
              그래서 이 버튼은 폼을 열지 않고 공고 탐색으로 보낸다. CLAUDE.md §0.5 흐름. */}
          <Button type="button" className="h-7 text-[12.8px]" render={<Link href="/announcements" />}>
            + 공고에서 등록
          </Button>
        </>
      }
    >
      {error && <DbError what="지원사업 대장" error={error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="사업 수" value={rows.length} sub="검토 · 심사 · 수행 · 종료" />
        <Stat
          label="지원금액 합계"
          value={won(총지원금)}
          sub={`사용 ${won(총사용)}`}
        />
        <Stat
          label="미처리 점검"
          value={점검}
          sub="누락 · 날짜오류 · 금액 불일치"
          tone={점검 > 0 ? "warn" : "default"}
        />
        <Stat
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
