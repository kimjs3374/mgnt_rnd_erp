import Link from "next/link"
import { PageShell, Card, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { DbError } from "@/components/db-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getRndAnnouncements } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 과제사업 > 공고 탐색.
 * NTIS(국가R&D과제 공식 Open API) + IRIS(범부처 R&D 통합공고, 공개된 공고문을
 * 심사위원 확인을 거쳐 수집)만 본다. 기업마당은 지원사업 쪽 화면(/announcements)이
 * 따로 담당한다 — 두 화면은 출처 자체가 다르다.
 */
export default async function ProjectAnnouncementsPage() {
  const { rows, error } = await getRndAnnouncements()

  return (
    <PageShell
      title="공고 탐색 (과제사업)"
      description="NTIS·IRIS 공고문을 판독해 자격 요건·제출 서류를 뽑아 우리 것과 대조한다."
      actions={
        <Button type="button" className="h-7 text-[12.8px]">
          공고문 업로드
        </Button>
      }
      filters={
        <>
          <Input placeholder="사업명·기관 검색" className="h-7 w-56 text-[13px]" />
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            전체 출처
          </Button>
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            접수 중
          </Button>
          <Button type="button" variant="ghost" className="ml-auto h-7 text-[12.8px]">
            ↺ 초기화
          </Button>
        </>
      }
    >
      {error && <DbError what="과제사업 공고 목록" error={error} />}

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="아직 수집된 과제 공고가 없습니다"
            hint="NTIS·IRIS 수집이 붙으면 여기에 채워집니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[80px]">출처</TableHead>
                <TableHead className="w-[280px]">사업명 ⇅</TableHead>
                <TableHead>소관</TableHead>
                <TableHead>접수기간</TableHead>
                <TableHead>마감유형</TableHead>
                <TableHead>파싱</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className="h-[38px] text-[13px]">
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{a.출처}</span>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/project-announcements/${a.id}`}
                      className="hover:underline"
                    >
                      {a.사업명}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.소관부처 ?? a.전문기관 ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {a.접수시작 && a.접수종료
                      ? `${a.접수시작} ~ ${a.접수종료}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{a.마감유형}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={a.파싱상태} />
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
