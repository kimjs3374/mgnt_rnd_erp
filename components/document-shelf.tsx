"use client"

import * as React from "react"
import { FileCheck2, FileClock, FileX2, Info } from "lucide-react"
import { Card, EmptyState } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { StatusBadge, ConfidenceBadge } from "@/components/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  uploadDocument,
  confirmDocument,
  deleteDocument,
  getDocumentDownloadUrl,
  type UploadResult,
} from "@/app/actions/documents"
import type { ShelfRow, DocumentRow, UnmatchedRow } from "@/lib/queries-documents"

/**
 * 서류함.
 *
 * 「필수」와 「참고」를 사람이 정하지 않는다 — **공고가 필수로 요구했는지**로 계산한다
 * (app.v_document_shelf). 한 곳이라도 필수로 요구하면 필수다. 그래서 새 공고를 수집하면
 * 이 표의 구간이 저절로 바뀐다. 손으로 관리하는 목록이 아니다.
 *
 * 유효기간은 **공고문 명시가 공공문서 기본 90일을 이긴다.** 근거를 같이 보여준다 —
 * 「왜 30일인가」에 「국세·지방세 완납 증명서: 발행일로부터 2개월 이내」라고 답할 수 있어야 한다.
 */

const 상태_설명: Record<string, string> = {
  없음: "아직 올리지 않았습니다.",
  유효: "지금 제출할 수 있습니다.",
  만료임박: "30일 안에 만료됩니다 — 미리 재발급하세요.",
  만료: "유효기간이 지났습니다. 다시 발급받아 올려야 합니다.",
  공고확인필요: "공고마다 요구 기간이 달라 일률적으로 판정하지 않습니다.",
  확인필요: "발급일이 비어 있어 만료를 계산할 수 없습니다.",
}

function 남은일수(만료일: string | null): number | null {
  if (!만료일) return null
  const [y, m, d] = 만료일.split("-").map(Number)
  if (!y || !m || !d) return null
  const end = Date.UTC(y, m - 1, d)
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((end - today) / 86400000)
}

export function DocumentShelf({
  shelf,
  files,
  unmatched,
}: {
  shelf: ShelfRow[]
  files: DocumentRow[]
  unmatched: UnmatchedRow[]
}) {
  const [열린종류, set열린종류] = React.useState<string | null>(null)

  const 필수 = shelf.filter((r) => r.구분 === "필수")
  const 참고 = shelf.filter((r) => r.구분 === "참고")
  const 미요구 = shelf.filter((r) => r.구분 === "미요구")

  const 손봐야 = shelf.filter(
    (r) => r.구분 !== "미요구" && (r.상태 === "없음" || r.상태 === "만료" || r.상태 === "만료임박"),
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border bg-card p-3 text-[14.3px] text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          수집한 공고 {shelf.reduce((s, r) => Math.max(s, r.요구공고수), 0) > 0 ? "에서 " : ""}
          실제로 요구된 서류를 종류로 묶었습니다 — <b className="text-foreground">필수 {필수.length}종</b>
          {참고.length > 0 && <> · 참고 {참고.length}종</>}.
          {손봐야.length > 0 ? (
            <>
              {" "}
              그중 <b className="text-[var(--warning-fg)]">{손봐야.length}종</b>이 없거나
              만료·임박입니다.
            </>
          ) : (
            <> 필요한 서류가 모두 유효합니다.</>
          )}{" "}
          유효기간은 <b className="text-foreground">공고문에 적힌 기간이 우선</b>이고, 없으면
          공공문서 기본 90일입니다(사업자등록증은 유효기간 없음).
        </span>
      </div>

      <Section
        icon={FileCheck2}
        title={`필수 서류 ${필수.length}종`}
        desc="공고가 「필수」로 요구한 서류. 한 곳이라도 필수로 부르면 필수다."
        rows={필수}
        files={files}
        열린종류={열린종류}
        set열린종류={set열린종류}
      />

      {참고.length > 0 && (
        <Section
          icon={FileClock}
          title={`참고 서류 ${참고.length}종`}
          desc="공고가 요구하긴 했으나 「해당시·가점」으로만 불린 서류."
          rows={참고}
          files={files}
          열린종류={열린종류}
          set열린종류={set열린종류}
        />
      )}

      {미요구.length > 0 && (
        <Section
          icon={FileX2}
          title={`아직 요구된 적 없는 서류 ${미요구.length}종`}
          desc="수집한 공고 중에는 요구한 곳이 없다. 종류만 미리 세워 둔 것이다."
          rows={미요구}
          files={files}
          열린종류={열린종류}
          set열린종류={set열린종류}
        />
      )}

      {unmatched.length > 0 && <Unmatched rows={unmatched} />}

      <p className="text-xs text-muted-foreground">
        파일은 비공개 저장소에 둡니다 — 공개 URL 이 없고 내려받을 때 60초짜리 주소를 그때 만듭니다.
        발급일은 올리는 즉시 <b>claude -p</b> 가 서류에서 읽지만,{" "}
        <b>확신도 70% 미만은 코드가 자동 확정을 막습니다</b> — 모델은 모호해도 단정하기 때문입니다.
      </p>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  desc,
  rows,
  files,
  열린종류,
  set열린종류,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  rows: ShelfRow[]
  files: DocumentRow[]
  열린종류: string | null
  set열린종류: (v: string | null) => void
}) {
  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        {Icon && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-3" />
          </span>
        )}
        {title}
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">{desc}</p>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="해당하는 서류가 없습니다" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[190px]">서류명</TableHead>
                <TableHead className="w-[80px]">요구</TableHead>
                <TableHead className="w-[100px]">발급일</TableHead>
                <TableHead className="w-[150px]">만료</TableHead>
                <TableHead className="w-[90px]">상태</TableHead>
                <TableHead>유효기간 근거</TableHead>
                <TableHead className="w-[130px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <ShelfRowView
                  key={r.코드}
                  r={r}
                  files={files.filter((f) => f.doc_type === r.코드)}
                  열림={열린종류 === r.코드}
                  toggle={() => set열린종류(열린종류 === r.코드 ? null : r.코드)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

function ShelfRowView({
  r,
  files,
  열림,
  toggle,
}: {
  r: ShelfRow
  files: DocumentRow[]
  열림: boolean
  toggle: () => void
}) {
  const d = 남은일수(r.만료일)

  return (
    <>
      <TableRow className="h-[38px] text-[14.3px]">
        <TableCell className="truncate font-medium" title={r.이름}>
          {r.이름}
          {r.발급처 && (
            <div className="truncate text-xs font-normal text-muted-foreground">
              {r.발급처}
            </div>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">
          {r.요구공고수 > 0 ? (
            <span title={`${r.요구공고수}개 공고가 요구 · 그중 ${r.필수공고수}곳이 필수`}>
              {r.요구공고수}건
              {r.필수공고수 > 0 && (
                <span className="ml-1 text-xs text-[var(--warning-fg)]">필수 {r.필수공고수}</span>
              )}
            </span>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="tabular-nums text-muted-foreground">
          {r.발급일 ?? (r.결산연도 ? `${r.결산연도}년` : "—")}
        </TableCell>
        <TableCell className="tabular-nums">
          {r.만료일 ? (
            <span className={d != null && d < 30 ? "text-[var(--warning-fg)]" : ""}>
              {r.만료일}
              {d != null && (
                <span className="ml-1 text-xs">{d < 0 ? "지남" : `D-${d}`}</span>
              )}
            </span>
          ) : r.유효기간_종류 === "permanent" ? (
            <span className="text-xs text-muted-foreground">유효기간 없음</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>
          <span title={상태_설명[r.상태] ?? ""}>
            <StatusBadge value={r.상태} />
          </span>
        </TableCell>
        <TableCell className="truncate text-xs text-muted-foreground" title={r.유효기간_근거 ?? ""}>
          {r.유효기간_근거 ?? "—"}
        </TableCell>
        <TableCell>
          <Button type="button" variant="outline" className="h-7 text-[14.1px]" onClick={toggle}>
            {열림 ? "닫기" : files.length > 0 ? `파일 ${files.length}` : "＋ 올리기"}
          </Button>
        </TableCell>
      </TableRow>

      {열림 && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="whitespace-normal bg-muted/30 p-3">
            <UploadPanel 종류={r} files={files} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function UploadPanel({ 종류, files }: { 종류: ShelfRow; files: DocumentRow[] }) {
  const [state, action, pending] = React.useActionState<UploadResult | null, FormData>(
    uploadDocument,
    null,
  )

  return (
    <div className="flex flex-col gap-3 text-[14.3px]">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="doc_type" value={종류.코드} />
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.heic"
          className="h-7 max-w-[320px] text-[14.1px] file:mr-2 file:h-6 file:rounded-md file:border file:bg-background file:px-2 file:text-[14.1px]"
        />
        {/* ⚠ type="submit" 을 빼면 shadcn 기본값(type="button")이라 아무 반응이 없다. */}
        <Button type="submit" className="h-7 text-[14.1px]" disabled={pending}>
          {pending ? "올리는 중… (판독까지 20~40초)" : "올리고 발급일 판독"}
        </Button>
        {종류.비고 && <span className="text-xs text-muted-foreground">{종류.비고}</span>}
      </form>

      {state && (
        <div
          className={
            state.ok
              ? "rounded-md border bg-card p-2 text-xs"
              : "rounded-md border border-destructive/40 bg-card p-2 text-xs text-destructive"
          }
        >
          <div>{state.message}</div>
          {state.제안 && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>
                AI 판독: 발급일 <b className="text-foreground">{state.제안.발급일 ?? "못 읽음"}</b>
              </span>
              <ConfidenceBadge value={state.제안.확신도} />
              {state.제안.종류불일치 && (
                <span className="text-[var(--warning-fg)]">
                  ⚠ 이 파일은 「{state.제안.종류불일치}」로 보인다 — 종류를 확인할 것
                </span>
              )}
              {state.제안.근거문장 && (
                <span className="basis-full italic">「{state.제안.근거문장}」</span>
              )}
            </div>
          )}
        </div>
      )}

      {files.length > 0 && (
        <div className="divide-y rounded-md border bg-card">
          {files.map((f) => (
            <FileRow key={f.id} f={f} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 파일 한 줄 — 발급일 확정·다운로드·삭제. AI 제안과 사람 확정을 같이 보여준다. */
function FileRow({ f }: { f: DocumentRow }) {
  const [state, action, pending] = React.useActionState<
    { ok: boolean; message: string } | null,
    FormData
  >(confirmDocument, null)
  const [지움, set지움] = React.useState(false)
  const [오류, set오류] = React.useState<string | null>(null)

  if (지움) return null

  const 방법라벨: Record<string, string> = {
    ai_자동: "AI 자동 확정",
    사람_확인: "사람이 확인",
    사람_수정: "사람이 수정",
    미확정: "미확정",
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={f.파일명 ?? ""}>
          {f.파일명 ?? "(이름 없음)"}
        </span>
        <Badge variant="outline" className="h-5 shrink-0 px-2 text-xs">
          {방법라벨[f.확정_방법 ?? "미확정"] ?? f.확정_방법}
        </Badge>
        <ConfidenceBadge value={f.ai_확신도} />
        <Button
          type="button"
          variant="outline"
          className="h-7 shrink-0 text-[14.1px]"
          onClick={async () => {
            const r = await getDocumentDownloadUrl(f.id)
            if (r.ok && r.url) window.location.href = r.url
            else set오류(r.error ?? "내려받지 못했습니다")
          }}
        >
          ⤓ 내려받기
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-7 shrink-0 text-[14.1px] text-destructive"
          onClick={async () => {
            const r = await deleteDocument(f.id)
            if (r.ok) set지움(true)
            else set오류(r.error ?? "지우지 못했습니다")
          }}
        >
          삭제
        </Button>
      </div>

      <form action={action} className="flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="id" value={f.id} />
        <span className="text-muted-foreground">발급일</span>
        <Input
          type="date"
          name="발급일"
          defaultValue={f.발급일 ?? f.ai_발급일 ?? ""}
          className="h-7 w-36 text-[14.1px]"
        />
        <span className="text-muted-foreground">결산연도</span>
        <Input
          type="number"
          name="결산연도"
          defaultValue={f.결산연도 ?? ""}
          placeholder="—"
          className="h-7 w-24 text-[14.1px]"
        />
        <Button type="submit" variant="outline" className="h-7 text-[14.1px]" disabled={pending}>
          {pending ? "저장 중…" : "확정"}
        </Button>
        {f.ai_발급일 && f.발급일 && f.ai_발급일 !== f.발급일 && (
          <span className="text-[var(--warning-fg)]">
            AI 는 {f.ai_발급일} 이라 읽었다 — 사람이 {f.발급일} 로 고쳤다
          </span>
        )}
        {state && (
          <span className={state.ok ? "text-muted-foreground" : "text-destructive"}>
            {state.message}
          </span>
        )}
      </form>

      {f.ai_근거 && (
        <p className="text-xs text-muted-foreground italic">판독 근거: 「{f.ai_근거}」</p>
      )}
      {오류 && <p className="text-xs text-destructive">{오류}</p>}
    </div>
  )
}

/** 종류로 못 묶은 요구서류 — 대부분 서식이지만 조용히 버리지 않는다. */
function Unmatched({ rows }: { rows: UnmatchedRow[] }) {
  const [열림, set열림] = React.useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => set열림((v) => !v)}
        className="mb-1 text-sm font-semibold hover:underline"
      >
        {열림 ? "▾" : "▸"} 종류로 묶지 못한 요구서류 {rows.length}종
      </button>
      <p className="mb-2 text-xs text-muted-foreground">
        대부분 공고 서식(계획서·확약서·동의서)이라 보관 대상이 아니다. 다만 빠뜨린 실제 증빙이
        섞여 있을 수 있어 <b>지우지 않고 여기 남긴다.</b>
      </p>
      {열림 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>서류명</TableHead>
                <TableHead className="w-[80px]">요구</TableHead>
                <TableHead className="w-[80px]">필수</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.서류명} className="h-[34px] text-[14.3px]">
                  <TableCell className="truncate" title={r.서류명}>
                    {r.서류명}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {r.요구공고수}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {r.필수공고수}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
