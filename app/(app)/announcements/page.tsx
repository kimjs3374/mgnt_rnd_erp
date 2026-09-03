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
import { getAnnouncements } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 공고 탐색.
 * 공고는 공공데이터(기업마당·K-Startup 공식 오픈 API)라 실데이터를 그대로 써도 된다.
 * ⚠ 크롤링하지 않는다. 공식 API만 쓴다.
 */
export default async function AnnouncementsPage() {
  const { rows, error } = await getAnnouncements()

  return (
    <PageShell
      title="공고 탐색"
      description="공고문을 넣으면 자격 요건·제출 서류·계상 규칙을 뽑아 우리 것과 대조한다."
      actions={
        <Button type="button" className="h-7 text-[12.8px]">
          공고문 업로드
        </Button>
      }
      filters={
        <>
          <Input placeholder="사업명·기관 검색" className="h-7 w-56 text-[13px]" />
          <Button type="button" variant="outline" className="h-7 text-[12.8px]">
            전체 분야
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
      {error && <DbError what="공고 목록" error={error} />}

      <Card>
        {rows.length === 0 && !error ? (
          <EmptyState
            title="아직 수집된 공고가 없습니다"
            hint="기업마당 API 를 붙이면 여기에 채워집니다. 전량이 단일 호출로 옵니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[320px]">사업명 ⇅</TableHead>
                <TableHead>소관</TableHead>
                <TableHead>지역</TableHead>
                <TableHead>접수기간</TableHead>
                <TableHead>마감유형</TableHead>
                <TableHead>파싱</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className="h-[38px] text-[13px]">
                  <TableCell className="font-medium">{a.사업명}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.소관부처 ?? a.전문기관 ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.지역 ?? "—"}</TableCell>
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

      <div className="rounded-lg border bg-card p-4 text-[13px]">
        <h2 className="mb-2 text-sm font-semibold">판정 등급 4종</h2>
        <ul className="space-y-1 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">가능</span> — 요건을 읽었고 충족한다
          </li>
          <li>
            <span className="font-medium text-foreground">불가</span> — 요건을 읽었고 미충족이다
          </li>
          <li>
            <span className="font-medium text-foreground">확인 필요</span> — 읽었으나 회사 값이 없다
          </li>
          <li>
            <span className="font-medium text-foreground">요건 미확인</span> — 아직 안 읽었다.
            <span className="ml-1">
              「확인 필요」보다 <b>아래</b>에 둔다 — 안 그러면 요건을 읽어 문제를 찾은 쪽이 손해를 본다
            </span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          접수기간의 56%가 날짜가 아니다(상시·소진시·선착순·상이). 파싱되면 D-day,
          안 되면 유형 배지로 별도 그룹. <b>날짜를 지어내지 않는다.</b>
        </p>
      </div>
    </PageShell>
  )
}
