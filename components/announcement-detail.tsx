import type { ReactNode } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { PageShell, Card, EmptyState } from "@/components/page-shell"
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
import { getAnnouncementDetail, getRequiredDocs } from "@/lib/queries"

/**
 * 공고 상세 — 요구서류 체크리스트. 지원사업(/announcements)과 과제사업
 * (/project-announcements) 양쪽이 이 컴포넌트 하나를 공유한다 — 출처만 다르고
 * 화면 구조는 같다. backHref 로 어느 목록에서 왔는지만 구분한다.
 *
 * claude -p 헤드리스로 판독한 결과를 그대로 보여준다. 구분·근거문장이 비어 있는
 * 행(초기 시드 더미)은 값이 채워진 행과 섞여 있어도 숨기지 않는다 —
 * 모르는 걸 아는 척하지 않는다.
 */
export async function AnnouncementDetail({
  id,
  backHref,
  footer,
}: {
  id: string
  backHref: string
  /**
   * 이 화면 맨 아래에 붙일 것. 지금은 「지원 · 선정 · 대장」 패널이 들어온다
   * (`components/apply-panel.tsx`). 이 컴포넌트가 PageShell 을 들고 있어서
   * 페이지에서 형제로 붙이면 여백 규격 밖으로 나간다 — 그래서 프롭으로 받는다.
   */
  footer?: ReactNode
}) {
  const announcementId = Number(id)
  if (!Number.isFinite(announcementId)) notFound()

  const [{ rows: annRows, error: annError }, { rows: docs, error: docError }] =
    await Promise.all([
      getAnnouncementDetail(announcementId),
      getRequiredDocs(announcementId),
    ])

  const a = annRows[0]
  if (!a && !annError) notFound()

  return (
    <PageShell
      title={a?.사업명 ?? "공고 상세"}
      description={
        a
          ? `${a.출처} · ${a.소관부처 ?? a.전문기관 ?? "—"}${
              a.접수시작 && a.접수종료 ? ` · 접수 ${a.접수시작} ~ ${a.접수종료}` : ""
            }`
          : undefined
      }
      actions={
        <Link
          href={backHref}
          className="text-[12.8px] text-muted-foreground hover:text-foreground"
        >
          ← 목록으로
        </Link>
      }
    >
      {annError && <DbError what="공고 상세" error={annError} />}
      {docError && <DbError what="요구서류 목록" error={docError} />}

      {a?.본문 && (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">공고문 발췌</h2>
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] text-muted-foreground">
            {a.본문.slice(0, 4000)}
          </p>
        </Card>
      )}

      <Card>
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">요구서류 {docs.length}건</h2>
          <p className="text-xs text-muted-foreground">
            근거문장은 공고문 원문을 그대로 인용한 것이다 — 지어낸 서류인지 여기서 검증한다.
          </p>
        </div>
        {docs.length === 0 && !docError ? (
          <EmptyState
            title="아직 판독된 요구서류가 없습니다"
            hint="공고문에 제출서류 구간이 없거나, 판독이 아직 실행되지 않았습니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[240px]">서류명</TableHead>
                <TableHead>구분</TableHead>
                <TableHead>확인상태</TableHead>
                <TableHead>근거문장 / 비고</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id} className="text-[13px]">
                  <TableCell className="font-medium align-top">{d.서류명}</TableCell>
                  <TableCell className="align-top">
                    {d.구분 ? <StatusBadge value={d.구분} /> : "—"}
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge value={d.확인상태} />
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    {d.근거문장 ?? d.유효기간_문구 ?? d.원문}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {footer}
    </PageShell>
  )
}
