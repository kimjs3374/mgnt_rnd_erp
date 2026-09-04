import Link from "next/link"
import { notFound } from "next/navigation"
import { StatusBadge } from "@/components/status-badge"
import { ProjectTabs } from "@/components/project-tabs"
import { DbError } from "@/components/db-error"
import { won } from "@/lib/queries"
import { getProject } from "@/lib/queries-project"

export const dynamic = "force-dynamic"

/**
 * 과제 상세 셸 — 과제 하나의 머리말 + 탭.
 *
 * ⚠ 전역 「예산」·「정산」 화면은 과제를 섞어서 보여준다. 과제가 12건이 되니
 *   합쳐진 소진율(배정 20.7억 대 집행 2,262만)은 아무 뜻도 없는 숫자가 됐다.
 *   **돈은 과제 단위로 계상하고 과제 단위로 정산한다.** 그래서 실제 작업은 여기서 한다.
 *   전역 화면은 「어느 과제로 들어갈지」를 고르는 로스터로 남긴다.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id: raw } = await params
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const { rows, error } = await getProject(id)
  const p = rows[0]

  // DB 가 죽은 것과 과제가 없는 것은 다르다. 죽었으면 이유를 보여주고,
  // 없으면 404 를 낸다. 둘을 같은 화면으로 뭉개면 원인을 못 찾는다.
  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
        <DbError what="과제" error={error} />
      </div>
    )
  }
  if (!p) notFound()

  // ⚠ 「과제사업」 이라고 늘 말하면 지원사업 건에서도 그렇게 뜬다 — 사업유형으로 가른다.
  //   원본 테이블 값은 라벨이 아니라 코드다(`lib/project-entry.ts`: NATIONAL_RND = 국가 R&D).
  //   과제 관리·지원사업 관리 두 landing 은 통합 관리 그룹 아래 있다(2026-09-04 개편).
  const 과제사업 = p.사업유형 === "NATIONAL_RND"

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div>
        <Link
          href={과제사업 ? "/projects/all" : "/programs"}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {과제사업 ? "과제 관리" : "지원사업 관리"}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight">{p.과제명}</h1>
          <StatusBadge value={p.상태} />
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {p.과제코드 ?? "과제코드 없음"}
          {p.부처 ? ` · ${p.부처}` : ""}
          {p.전문기관 ? ` / ${p.전문기관}` : ""}
          {p.사업명 ? ` · ${p.사업명}` : ""}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
          {p.시작일 ?? "확인 필요"} ~ {p.종료일 ?? "확인 필요"}
          {p.연차 ? ` · ${p.연차}차년도` : ""} · 총사업비 {won(p.총사업비)}
        </p>
      </div>

      {/* 상태를 넘기는 이유는 하나다 — **종료된 과제에는 「연구비 계상」 탭을 안 띄운다.**
          어느 탭을 띄울지 정하는 건 데이터라서 서버에서 읽어 넘긴다.
          과제사업 여부도 같이 넘긴다 — 「연구비 계상」(5직접비 + 간접비 + 연구수당 한도)은
          국가 R&D 전용 개념이라 지원사업 건에는 아예 탭을 안 띄운다. */}
      <ProjectTabs id={id} 상태={p.상태} 과제사업={과제사업} />

      {children}
    </div>
  )
}
