import Link from "next/link"
import { PageShell, Card, Stat, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { DbError } from "@/components/db-error"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getProjects, won } from "@/lib/queries"

export const dynamic = "force-dynamic"

// funding_schemes.이름 을 그대로 옮긴다 — 화면에서 지어내지 않는다.
const 사업유형_라벨: Record<string, string> = {
  NATIONAL_RND: "국가 R&D",
  LOCAL_TP: "지자체·TP 지원사업",
}

/**
 * 과제사업 — 선정되어 협약·수행된 과제의 수행 정보.
 * 「지원사업」이 공고→신청→선정까지의 파이프라인 뷰라면, 이건 그 다음 단계 —
 * 협약을 맺고 실제로 돈을 쓰고 있(었)는 과제 자체의 마스터 정보다.
 */
export default async function ProjectsPage() {
  const { rows, error } = await getProjects()

  const 총사업비 = rows.reduce((s, r) => s + (r.총사업비 ?? 0), 0)
  const 정부지원금 = rows.reduce((s, r) => s + (r.정부지원금 ?? 0), 0)
  // ⚠ DB 가 쓰는 값은 「수행중」이다. "수행" 으로 비교하면 언제나 0 이 나온다.
  const 수행중 = rows.filter((r) => r.상태 === "수행중").length

  return (
    <PageShell
      title="과제사업"
      description="협약 이후 실제로 수행된(수행 중인) 과제의 마스터 정보. 집행·예산·정산이 여기서 갈라져 나간다."
    >
      {error && <DbError what="과제사업" error={error} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="과제 수" value={rows.length} sub="협약 이후 기준" />
        <Stat label="총사업비 합계" value={won(총사업비)} sub={`정부지원금 ${won(정부지원금)}`} />
        <Stat label="수행 중" value={수행중} sub="종료 제외" />
        <Stat
          label="종료"
          value={rows.filter((r) => r.상태 === "종료").length}
          sub="정산까지 마쳤는지는 정산 화면에서 본다"
        />
      </div>

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="수행 중인 과제가 없습니다"
            hint="지원사업이 선정되어 협약을 맺으면 여기에 쌓입니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[280px]">과제명</TableHead>
                <TableHead>과제코드</TableHead>
                <TableHead>부처 / 전문기관</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>수행기간</TableHead>
                <TableHead className="text-right">연차</TableHead>
                <TableHead className="text-right">총사업비</TableHead>
                <TableHead className="text-right">정부지원금</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="w-[150px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="h-[38px] text-[13px]">
                  <TableCell className="font-medium">
                    {/* 계상·정산은 과제 안에서 한다. 목록은 어느 과제로 들어갈지만 고른다. */}
                    <Link
                      href={`/projects/${r.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {r.과제명}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.과제코드 ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.부처 ?? "—"}
                    {r.전문기관 ? ` · ${r.전문기관}` : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.사업유형 ? (사업유형_라벨[r.사업유형] ?? r.사업유형) : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {r.시작일 ?? "확인 필요"} ~ {r.종료일 ?? "확인 필요"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.연차 ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(r.총사업비)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {won(r.정부지원금)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={r.상태} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/projects/${r.id}/budget`}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      계상
                    </Link>
                    <span className="px-1.5 text-xs text-muted-foreground">·</span>
                    <Link
                      href={`/projects/${r.id}/settlement`}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      정산
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageShell>
  )
}
