import { Card, EmptyState } from "@/components/page-shell"
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
import { won } from "@/lib/queries"
import Link from "next/link"
import { SettlementDocuments } from "@/components/settlement-documents"
import { getSettlementDocuments } from "@/lib/queries-settlement"
import { 기간끝났나, 오늘_KST } from "@/lib/settlement-types"
import { 연차수 } from "@/lib/fiscal-year"
import {
  getProject,
  getProjectBudget,
  getProjectExpenses,
  getCategories,
  getEvidenceRequirements,
  getProjectEvidenceFiles,
} from "@/lib/queries-project"

export const dynamic = "force-dynamic"

/** RCMS 에 옮겨 적을 대상. 「검토대기」는 아직 사람이 확정하지 않았고 「반려」는 되돌아온 건이다. */
const 대조대상 = ["확정", "제출"]

/**
 * 정산에서 재원은 **현금과 현물 둘뿐이다.**
 *
 * 계상은 출연금 / 기관부담 현금 / 기관부담 현물 세 갈래로 쪼개야 한다 —
 * 협약서 금액과 재원별로 대조해야 하고(`lib/verify.ts` ②), 간접비 기준액에서 현물을 빼야 하니까.
 * 그런데 **정산에서는 출연금과 기관부담 현금이 같은 돈이다.** 둘 다 통장에서 나가고
 * 세금계산서·이체증으로 증빙한다. 현물만 성격이 다르다(장비·인건비를 돈 대신 얹는 것).
 * 그래서 원장을 「연구시설·장비 및 재료비 / 출연금」 과 「… / 현금」 으로 나눠 보여주면
 * 같은 성격의 돈이 두 줄로 갈려 소진율을 눈으로 못 더한다.
 *
 * → 정산 탭에서만 **출연금 + 기관부담 현금 = 현금** 으로 합친다. 계상 탭은 세 갈래를 그대로 둔다.
 */
const 정산재원 = (재원구분: string) => (재원구분 === "현물" ? "현물" : "현금")

/** 품목 jsonb 에서 사람이 읽을 이름을 뽑는다. 형태가 흔들려도 화면이 안 죽게. */
function itemLabel(품목: unknown): string {
  if (Array.isArray(품목)) {
    const names = 품목
      .map((i) => {
        if (!i || typeof i !== "object") return null
        const o = i as Record<string, unknown>
        return o.품목명 ?? o.name ?? o.item_name ?? null
      })
      .filter(Boolean)
      .map(String)
    if (names.length) return names.join(", ")
  }
  return "—"
}

/**
 * 과제 정산 — 과제비 원장 · 사용 건 · RCMS 입력 대조.
 *
 * ⚠ RCMS 는 외부 API 가 없다. 「연동」이라고 쓰지 않는다.
 *   사람이 RCMS 화면에 옮겨 적기 **직전 상태**를 완성해두는 것이 여기서 하는 일이고,
 *   마지막 입력은 사람이 한다.
 */
export default async function ProjectSettlementPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: raw } = await params
  const id = Number(raw)

  const [budget, exp, cats, proj, reqs, files, 정산서류] = await Promise.all([
    getProjectBudget(id),
    getProjectExpenses(id),
    getCategories(),
    getProject(id),
    getEvidenceRequirements(),
    getProjectEvidenceFiles(id),
    // 최종 정산 서류 — 협약기간이 끝난 과제만 받는다(`db/110`).
    getSettlementDocuments(id),
  ])

  // 최종 정산 카드가 협약기간·상태를 본다. 한 번만 꺼내 둔다.
  const 과제 = proj.rows[0]

  // ⚠ 아직 선정도 안 된 과제에는 정산할 것이 없다(2026-09-04 사용자 지적).
  //   탭·대장 링크에서 이미 뺐지만 **주소로는 들어올 수 있다.** 그때 빈 표를 보여주면
  //   「정산이 비어 있네」로 읽힌다 — 없는 게 아니라 아직 할 수 없는 일이라고 말한다.
  if (proj.rows[0]?.상태 === "신청중") {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">아직 정산할 것이 없습니다 — 선정 전입니다</p>
        <p className="mt-1 text-xs text-muted-foreground">
          정산은 <b>받은 돈을 쓴 뒤</b>에 하는 일입니다. 이 과제는 아직 신청 단계라 집행도 정산도
          시작할 수 없습니다. 지금 할 수 있는 것은{" "}
          <Link href={`/projects/${id}/budget`} className="underline underline-offset-2">
            연구비 계상
          </Link>
          (신청서에 넣을 사업비 계획)이고, 선정을 기록하면 집행·정산 탭이 열립니다 —{" "}
          <Link href="/projects/applying" className="underline underline-offset-2">
            신청중 목록
          </Link>
          .
        </p>
      </div>
    )
  }

  const 이름 = new Map(cats.rows.map((c) => [c.코드, c.이름]))
  const 정렬 = new Map(cats.rows.map((c) => [c.코드, c.정렬 ?? 999]))

  // (비목 × 현금·현물) 로 합친다. 출연금 줄과 기관부담 현금 줄이 한 줄이 된다(위 정산재원 주석).
  const 묶음 = new Map<
    string,
    { 비목_대분류: string; 비목명: string | null; 재원구분: string; 배정액: number; 집행액: number }
  >()
  for (const b of budget.rows) {
    const 재원 = 정산재원(b.재원구분)
    const key = `${b.비목_대분류}|${재원}`
    const cur =
      묶음.get(key) ??
      { 비목_대분류: b.비목_대분류, 비목명: b.비목명 ?? null, 재원구분: 재원, 배정액: 0, 집행액: 0 }
    cur.배정액 += Number(b.배정액 ?? 0)
    cur.집행액 += Number(b.집행액 ?? 0)
    묶음.set(key, cur)
  }
  const 원장 = Array.from(묶음.values())
    .map((b) => ({
      ...b,
      잔액: b.배정액 - b.집행액,
      // 소진율은 합친 뒤에 다시 계산한다. 두 줄의 비율을 더하면 뜻이 없는 숫자가 된다.
      소진율: b.배정액 > 0 ? Math.round((b.집행액 / b.배정액) * 1000) / 10 : 0,
    }))
    .sort(
      (a, b) =>
        (정렬.get(a.비목_대분류) ?? 999) - (정렬.get(b.비목_대분류) ?? 999) ||
        // 현금이 먼저, 현물이 뒤. 사전순(ㄱ)으로 두면 현금·현물 순서가 비목마다 흔들린다.
        (a.재원구분 === b.재원구분 ? 0 : a.재원구분 === "현금" ? -1 : 1),
    )
  const 총배정 = 원장.reduce((s, b) => s + (b.배정액 ?? 0), 0)
  const 총집행 = 원장.reduce((s, b) => s + Number(b.집행액 ?? 0), 0)
  const 초과 = 원장.filter((b) => Number(b.잔액 ?? 0) < 0)

  const 대조 = exp.rows
    .filter((e) => 대조대상.includes(e.상태))
    // 제출 순서대로 — 사람이 위에서부터 그대로 옮겨 적는다.
    .sort((a, b) => (a.일자 ?? "").localeCompare(b.일자 ?? ""))

  /**
   * 출장·회의 증빙 확보 현황 (2026-09-04 사용자 지시).
   *
   * RCMS 는 건별로 서류를 묶어 받는다 — 원장·사용 건은 「얼마를 썼나」를 보여주지만
   * 「제출할 서류가 다 모였나」는 안 보여줬다. 여기서 그 빈자리를 메운다.
   *
   * `비목_세부항목`(TRAVEL·MEETING)으로 대상을 고른다 — `components/expense-evidence.tsx` 의
   * `활동비_구분()` 과 같은 매핑이다. 두 곳이 다른 규칙을 쓰면 「여기선 확보인데 저기선 미확보」가 생긴다.
   */
  const 출장회의건 = exp.rows.filter(
    (e) => e.비목_세부항목 === "TRAVEL" || e.비목_세부항목 === "MEETING",
  )
  const 출장회의현황 = 출장회의건.map((e) => {
    const 구분 = e.비목_세부항목 === "TRAVEL" ? "출장" : "회의"
    const 요건들 = reqs.rows
      .filter((r) => r.비목_대분류 === "ACTIVITY" && r.구분 === 구분 && r.필수여부 && !r.개인정보포함)
      .sort((a, b) => a.순번 - b.순번)
    const 파일들 = files.rows.filter((f) => f.집행_id === e.id)
    const 확보 = 요건들.filter((r) => 파일들.some((f) => f.요건_id === r.id))
    return {
      집행: e,
      구분,
      필수: 요건들.length,
      확보: 확보.length,
      미확보서류: 요건들.filter((r) => !확보.some((c) => c.id === r.id)).map((r) => r.서류명),
    }
  })
  const 미완료건 = 출장회의현황.filter((c) => c.확보 < c.필수)

  return (
    <>
      {budget.error && <DbError what="과제비 원장" error={budget.error} />}
      {exp.error && <DbError what="집행" error={exp.error} />}
      {reqs.error && <DbError what="증빙 요건" error={reqs.error} />}
      {files.error && <DbError what="증빙 파일" error={files.error} />}

      <div className="rounded-lg border bg-card p-4 text-[14.3px] text-muted-foreground">
        <span className="font-medium text-foreground">RCMS 는 외부 API 가 없습니다.</span>{" "}
        이건 「연동」이 아니라 사람이 RCMS 화면에 옮겨 적기 직전 상태를 완성해두는 것입니다.
        마지막 입력은 사람이 합니다.
      </div>

      {/* ── 과제비 원장 */}
      <Card>
        <div className="flex flex-wrap items-baseline gap-2 border-b p-3">
          <span className="text-[14.3px] font-medium">과제비 원장</span>
          <span className="text-xs text-muted-foreground">
            집행 인정 상태: 확정 · 제출 · 정산완료 · 재원은{" "}
            <span className="text-foreground">현금(출연금+기관부담 현금) · 현물</span> 둘로 묶었습니다
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            배정 {won(총배정)} · 집행 {won(총집행)} ·{" "}
            {총배정 > 0 ? Math.round((총집행 / 총배정) * 1000) / 10 : 0}%
          </span>
        </div>

        {원장.length === 0 ? (
          <EmptyState
            title="계상된 비목이 없습니다"
            hint="「연구비 계상」 탭에서 배정액을 넣으면 원장이 만들어집니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>비목</TableHead>
                <TableHead className="w-[90px]">재원</TableHead>
                <TableHead className="text-right">배정액</TableHead>
                <TableHead className="text-right">집행액</TableHead>
                <TableHead className="text-right">잔액</TableHead>
                <TableHead className="w-[180px]">소진율</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {원장.map((b, i) => {
                const rate = Number(b.소진율 ?? 0)
                const over = Number(b.잔액 ?? 0) < 0
                return (
                  <TableRow
                    key={`${b.비목_대분류}-${b.재원구분}-${i}`}
                    className="h-[38px] text-[14.3px]"
                  >
                    <TableCell className="font-medium">
                      {b.비목명 ?? 이름.get(b.비목_대분류) ?? b.비목_대분류}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{b.재원구분}</TableCell>
                    <TableCell className="text-right tabular-nums">{won(b.배정액)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {won(Number(b.집행액))}
                    </TableCell>
                    <TableCell
                      className={
                        over
                          ? "text-right font-medium tabular-nums text-destructive"
                          : "text-right tabular-nums"
                      }
                    >
                      {won(Number(b.잔액))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={
                              rate >= 100
                                ? "h-full bg-destructive"
                                : rate >= 85
                                  ? "h-full bg-[var(--warning-fg)]"
                                  : "h-full bg-[var(--chart-2)]"
                            }
                            style={{ width: `${Math.min(rate, 100)}%` }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-right tabular-nums text-xs">
                          {rate}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="h-[38px] bg-secondary/40 text-[14.3px] font-medium hover:bg-secondary/40">
                <TableCell colSpan={2}>합계</TableCell>
                <TableCell className="text-right tabular-nums">{won(총배정)}</TableCell>
                <TableCell className="text-right tabular-nums">{won(총집행)}</TableCell>
                <TableCell className="text-right tabular-nums">{won(총배정 - 총집행)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}

        {초과.length > 0 && (
          <div className="border-t p-3 text-[14.3px]">
            <span className="font-medium text-destructive">
              배정액 초과 {초과.length}건
            </span>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {초과.map((b, i) => (
                <li key={i}>
                  {b.비목명 ?? b.비목_대분류} / {b.재원구분} —{" "}
                  {won(Math.abs(Number(b.잔액)))} 초과
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── 사용 건 */}
      <Card>
        <div className="flex flex-wrap items-baseline gap-2 border-b p-3">
          <span className="text-[14.3px] font-medium">사용 건</span>
          <span className="text-xs text-muted-foreground">{exp.rows.length}건</span>
        </div>
        {exp.rows.length === 0 ? (
          <EmptyState
            title="집행 건이 없습니다"
            hint="Slack 채널에 증빙을 올리면 봇이 판독해 「검토대기」로 쌓습니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[96px]">일자</TableHead>
                <TableHead>품목 / 거래처</TableHead>
                <TableHead className="w-[200px]">비목</TableHead>
                <TableHead className="w-[80px]">재원</TableHead>
                <TableHead className="text-right">합계</TableHead>
                <TableHead className="w-[92px]">상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exp.rows.map((e) => (
                <TableRow key={e.id} className="h-[42px] text-[14.3px]">
                  <TableCell className="tabular-nums text-muted-foreground">
                    {e.일자 ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div>{itemLabel(e.품목)}</div>
                    <div className="text-xs text-muted-foreground">{e.거래처 ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.비목_대분류 ? (이름.get(e.비목_대분류) ?? e.비목_대분류) : "미분류"}
                    {e.비목_세부항목 && (
                      <div className="text-xs">{e.비목_세부항목}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {정산재원(e.재원구분)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{won(e.합계)}</TableCell>
                  <TableCell>
                    <StatusBadge value={e.상태} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ── 출장·회의 증빙 확보 현황 */}
      {출장회의건.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-baseline gap-2 border-b p-3">
            <span className="text-[14.3px] font-medium">출장·회의 증빙 확보 현황</span>
            <span className="text-xs text-muted-foreground">
              RCMS 는 건별로 서류를 묶어 받습니다 — 얼마를 썼는지가 아니라{" "}
              <span className="text-foreground">제출할 서류가 다 모였는지</span>를 봅니다
            </span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {출장회의건.length - 미완료건.length}/{출장회의건.length}건 확보 완료
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[96px]">일자</TableHead>
                <TableHead className="w-[80px]">구분</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead className="w-[140px]">확보</TableHead>
                <TableHead>미확보 서류</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {출장회의현황.map((c) => (
                <TableRow key={c.집행.id} className="h-[42px] text-[14.3px]">
                  <TableCell className="tabular-nums text-muted-foreground">
                    {c.집행.일자 ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.구분}</TableCell>
                  <TableCell>{c.집행.거래처 ?? "—"}</TableCell>
                  <TableCell
                    className={
                      c.확보 < c.필수
                        ? "font-medium tabular-nums text-destructive"
                        : "tabular-nums text-muted-foreground"
                    }
                  >
                    {c.확보}/{c.필수}
                  </TableCell>
                  <TableCell className="text-[13.2px] text-muted-foreground">
                    {c.미확보서류.length ? c.미확보서류.join(" · ") : "—"}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/projects/${id}/expenses`}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      첨부
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {미완료건.length === 0 ? (
            <p className="border-t p-3 text-[14.3px] text-muted-foreground">
              출장·회의 건 {출장회의건.length}건 모두 필수 서류를 확보했습니다.
            </p>
          ) : (
            <p className="border-t p-3 text-[14.3px] text-[var(--warning-fg)]">
              {미완료건.length}건에 서류가 빠졌습니다 —{" "}
              <Link
                href={`/projects/${id}/expenses`}
                className="underline underline-offset-2"
              >
                집행 탭
              </Link>
              에서 그 건을 열어 첨부하세요.
            </p>
          )}
        </Card>
      )}

      {/* ── RCMS 입력 대조 */}
      <Card>
        <div className="flex flex-wrap items-baseline gap-2 border-b p-3">
          <span className="text-[14.3px] font-medium">RCMS 입력 대조</span>
          <span className="text-xs text-muted-foreground">
            제출 순서(일자)대로 정렬했습니다. 위에서부터 그대로 옮겨 적으면 됩니다.
          </span>
        </div>
        {대조.length === 0 ? (
          <EmptyState
            title="옮겨 적을 건이 없습니다"
            hint="집행이 「확정」되면 여기에 제출 순서대로 쌓입니다."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[44px]">#</TableHead>
                <TableHead className="w-[96px]">일자</TableHead>
                <TableHead className="w-[200px]">비목 / 세부항목</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>거래처</TableHead>
                <TableHead className="text-right">공급가액</TableHead>
                <TableHead className="text-right">세액</TableHead>
                <TableHead className="text-right">합계</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {대조.map((e, i) => (
                <TableRow key={e.id} className="h-[38px] text-[14.3px]">
                  <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="tabular-nums">{e.일자 ?? "—"}</TableCell>
                  <TableCell>
                    {e.비목_대분류 ? (이름.get(e.비목_대분류) ?? e.비목_대분류) : "미분류"}
                    {e.비목_세부항목 && (
                      <div className="text-xs text-muted-foreground">{e.비목_세부항목}</div>
                    )}
                  </TableCell>
                  <TableCell>{itemLabel(e.품목)}</TableCell>
                  <TableCell className="text-muted-foreground">{e.거래처 ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{won(e.공급가액)}</TableCell>
                  <TableCell className="text-right tabular-nums">{won(e.세액)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {won(e.합계)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="h-[38px] bg-secondary/40 text-[14.3px] font-medium hover:bg-secondary/40">
                <TableCell colSpan={5}>합계 {대조.length}건</TableCell>
                <TableCell className="text-right tabular-nums">
                  {won(대조.reduce((s, e) => s + Number(e.공급가액 ?? 0), 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {won(대조.reduce((s, e) => s + Number(e.세액 ?? 0), 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {won(대조.reduce((s, e) => s + Number(e.합계 ?? 0), 0))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ── 최종 정산 서류 (정산 탭의 마지막 단계) ──────────────────────────
          기간이 끝나면 정산보고서·정산결과 통보서·잔액 반납 증빙을 낸다. 그 파일을 둘 자리가
          없어서 새로 만들었다(`db/110`) — 비목이나 집행 건이 아니라 **과제가 끝났다는 사실**에 붙는다.
          판정(`기간끝났나`)은 **서버에서** 한다. 화면이 날짜를 다시 계산하면 두 곳이 어긋난다. */}
      {정산서류.error && <DbError what="최종 정산 서류" error={정산서류.error} />}
      <SettlementDocuments
        과제_id={id}
        파일={정산서류.rows}
        기간끝남={기간끝났나(과제?.상태, 과제?.종료일, 오늘_KST())}
        종료일={과제?.종료일 ?? null}
        협약연수={연차수(과제?.시작일, 과제?.종료일) || 1}
      />
    </>
  )
}
