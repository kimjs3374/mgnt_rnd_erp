import Link from "next/link"
import { PageShell, Stat } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { Button } from "@/components/ui/button"
import { getProjects, won } from "@/lib/queries"
import { ProjectCreateButton } from "@/components/project-create-button"
import { ProjectsLedger } from "@/components/projects-ledger"
import { db, safeSelect } from "@/lib/db"

export const dynamic = "force-dynamic"

/**
 * 과제사업 — 선정되어 협약·수행된 과제의 수행 정보.
 * 「지원사업」이 공고→신청→선정까지의 파이프라인 뷰라면, 이건 그 다음 단계 —
 * 협약을 맺고 실제로 돈을 쓰고 있(었)는 과제 자체의 마스터 정보다.
 */
export default async function ProjectsPage() {
  const [{ rows: 전체, error }, 미배정, 단계] = await Promise.all([
    getProjects(),
    // 과제가 아직 정해지지 않은 집행. 사이드바에서 「집행」을 뺐으므로 여기서 알려주지 않으면
    // Slack 으로 막 들어온 건이 아무 화면에도 안 뜬다.
    safeSelect<{ id: number }>("expenses", () =>
      db.from("expenses").select("id").is("과제_id", null),
    ),
    // 선정 단계만 따로 읽는다. `ProjectRow` 에 선정결과가 없고 `lib/queries.ts` 는
    // 권태호 담당이라 건드리지 않는다(공유 파일 저장 충돌이 두 번 났다).
    // ⚠ `select("선정결과")` 처럼 한글 컬럼명을 select 문자열에 넣으면 supabase-js 의
    //    타입 파서가 컴파일에서 막는다. `*` 로 받고 좁혀 읽는다.
    safeSelect<{ id: number; 선정결과: string | null }>("projects", () =>
      db.from("projects").select("*"),
    ),
  ])

  // 과제사업 대장에는 **선정된 건만** 둔다. 신청·심사 중인 건은 지원사업 대장에서 본다.
  //
  // ⚠ `선정결과 === "선정"` 으로 거르지 않는다 — 시드 12건은 케이오시 관리대장(엑셀)을
  //    옮겨온 것이라 선정결과 칸이 비어 있다. 그걸로 거르면 대장이 통째로 빈다.
  //    「아직 선정되지 않았다고 확인된 것」만 뺀다 — 신청중(상태) · 미선정(선정결과).
  //    조회가 실패하면 빼지 않는다. 못 읽었다고 있는 과제를 숨기면 그게 더 나쁘다.
  const 제외 = new Set(
    단계.rows.filter((r) => r.선정결과 === "미선정").map((r) => r.id),
  )
  const rows = 전체.filter((r) => r.상태 !== "신청중" && !제외.has(r.id))
  const 숨긴수 = 전체.length - rows.length

  const 총사업비 = rows.reduce((s, r) => s + (r.총사업비 ?? 0), 0)
  const 정부지원금 = rows.reduce((s, r) => s + (r.정부지원금 ?? 0), 0)
  // ⚠ DB 가 쓰는 값은 「수행중」이다. "수행" 으로 비교하면 언제나 0 이 나온다.
  const 수행중 = rows.filter((r) => r.상태 === "수행중").length

  return (
    <PageShell
      title="과제사업 대장"
      description="선정된 과제만 여기 있다. 과제를 누르면 그 안에 개요 · 연구비 계상 · 집행 · 정산이 있다. 돈은 과제 단위로만 관리한다."
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
      {/* 걸러내기·연도·쪽 나누기는 `ProjectsLedger`(클라이언트)가 표와 함께 들고 있다.
          PageShell 의 filters 자리에 두면 표와 상태를 나눠 갖게 되어 둘을 잇는 배선이 생긴다. */}
      {error && <DbError what="과제사업" error={error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="과제 수" value={rows.length} sub="선정된 건만" />
        <Stat label="총사업비 합계" value={won(총사업비)} sub={`정부지원금 ${won(정부지원금)}`} />
        <Stat label="수행 중" value={수행중} sub="종료 제외" />
        <Stat
          label="종료"
          value={rows.filter((r) => r.상태 === "종료").length}
          sub="정산까지 마쳤는지는 정산 화면에서 본다"
        />
      </div>

      <ProjectsLedger rows={rows} />

      {숨긴수 > 0 && (
        <p className="text-xs text-muted-foreground">
          아직 선정되지 않은 {숨긴수}건(신청 · 심사 · 미선정)은 여기 없습니다 —{" "}
          <Link href="/programs" className="underline underline-offset-2">
            지원사업 대장에서 봅니다
          </Link>
          . 선정을 기록하면 그 줄이 이 대장으로 넘어옵니다.
        </p>
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
