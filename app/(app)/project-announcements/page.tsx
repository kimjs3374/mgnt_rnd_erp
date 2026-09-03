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
import { getRndAnnouncements, 정보성, type AnnouncementRow } from "@/lib/queries"

export const dynamic = "force-dynamic"

/**
 * 과제사업 > 공고 탐색.
 *
 * **IRIS 가 본체고 NTIS 는 참고다.** IRIS 상세페이지에는 공고문(HWP·HWPX·PDF)이 붙어
 * 있어 받아서 접수기간·자격요건·제출서류까지 판독이 끝난다 — 이 화면이 파는 것이 그거다.
 * NTIS 국가R&D 과제검색 오픈API 는 **이미 수행 중인 과제의 메타정보**라 접수기간도
 * 공고문도 없다(scripts/collect-ntis.mjs 주석). 신청할 수 있는 공고가 아니다.
 *
 * 그래서 한 표에 섞어 id 순으로 늘어놓지 않는다. IRIS 를 위에 두고, NTIS 는
 * 「참고」 구분선 아래로 내린다. 지우지는 않는다 — 어떤 과제가 이미 돌고 있는지는
 * 볼 값어치가 있다. 다만 **신청 가능한 공고인 척하게 두지 않는다.**
 *
 * 기업마당은 지원사업 쪽 화면(/announcements)이 따로 담당한다 — 출처 자체가 다르다.
 */
export default async function ProjectAnnouncementsPage() {
  const { rows, error } = await getRndAnnouncements()

  // 정렬은 이미 lib/queries.ts 에서 끝났다(IRIS 먼저, 그 안에서 마감 임박순).
  // 여기서는 표시만 가른다 — 순서를 두 곳에서 정하면 한쪽만 고치게 된다.
  const 공고 = rows.filter((a) => !정보성(a))
  const 참고 = rows.filter((a) => 정보성(a))

  return (
    <PageShell
      title="공고 탐색 (과제사업)"
      description="IRIS 공고문(HWP·PDF)을 받아 판독해 자격 요건·제출 서류를 뽑고 우리 것과 대조한다. NTIS 과제검색은 접수기간·공고문이 없어 참고로만 둔다."
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
            hint="IRIS 수집(scripts/collect-iris.mjs)이 돌면 여기에 채워집니다."
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
              {공고.map((a) => (
                <Row key={a.id} a={a} />
              ))}

              {참고.length > 0 && (
                <>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="h-7 py-1 text-xs text-muted-foreground">
                      참고 — NTIS 국가R&D 과제검색 {참고.length}건 · 접수기간·공고문이
                      없다. 이미 수행 중인 과제 정보이고 신청 대상이 아니다.
                    </TableCell>
                  </TableRow>
                  {참고.map((a) => (
                    <Row key={a.id} a={a} 흐리게 />
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageShell>
  )
}

/** 표 한 줄. 참고 구간은 흐리게 — 같은 무게로 보이면 구분선을 그은 뜻이 없다. */
function Row({ a, 흐리게 }: { a: AnnouncementRow; 흐리게?: boolean }) {
  return (
    <TableRow className={`h-[38px] text-[13px] ${흐리게 ? "opacity-60" : ""}`}>
      <TableCell>
        <span className="text-xs text-muted-foreground">{a.출처}</span>
      </TableCell>
      <TableCell className="font-medium">
        <Link href={`/project-announcements/${a.id}`} className="hover:underline">
          {a.사업명}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {a.소관부처 ?? a.전문기관 ?? "—"}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {a.접수시작 && a.접수종료 ? `${a.접수시작} ~ ${a.접수종료}` : "—"}
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground">{a.마감유형}</span>
      </TableCell>
      <TableCell>
        <StatusBadge value={a.파싱상태} />
      </TableCell>
    </TableRow>
  )
}
