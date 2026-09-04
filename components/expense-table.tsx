"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ExpenseHistory } from "@/components/expense-history"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge, ConfidenceBadge } from "@/components/status-badge"
import { EmptyState } from "@/components/page-shell"
import { ExpenseEvidence } from "@/components/expense-evidence"
import { confirmExpense, correctExpense } from "@/app/actions/expenses"
import type { EvidenceRequirement, EvidenceFile } from "@/lib/evidence-types"

export type SubOption = { 코드: string; 대분류: string; 이름: string }
export type CatOption = { 코드: string; 이름: string }

export type DecisionRow = {
  id: number
  확정_비목: string
  확정_세부항목: string | null
  정정여부: boolean
  정정사유_유형: string | null
  정정사유: string | null
  확정자: string | null
  created_at: string
}

export type SimilarRow = {
  품목: string
  세부항목: string | null
  일자: string | null
  정정사유: string | null
}

export type Row = {
  id: number
  일자: string | null
  거래처: string | null
  품목요약: string
  합계: number | null
  공급가액: number | null
  세액: number | null
  비목_대분류: string | null
  비목_세부항목: string | null
  /** 출연금 | 현금 | 현물. 필터와 정산 대조에 쓴다. */
  재원구분: string
  연차: number | null
  ai_확신도: number | null
  ai_근거: string | null
  방향검증: string | null
  불일치: unknown
  상태: string
  결정이력: DecisionRow[]
  유사: SimilarRow[]
}

const won = (n: number | null | undefined) =>
  n == null ? "—" : "₩" + Number(n).toLocaleString("ko-KR")

const 사유유형 = [
  { v: "관행", label: "우리 회사는 관행상 이렇게 처리" },
  { v: "해석", label: "규정 해석이 다름" },
  { v: "과제특수", label: "이 사업만 특수한 사정" },
  { v: "판독오류", label: "품목을 잘못 읽음 (판독 오류)" },
]

/** 재원 3분류를 정산 관점으로 묶은 표기. 정산 탭과 같은 규칙을 쓴다(출연금+기관부담 현금=현금). */
const 정산재원 = (재원구분: string) => (재원구분 === "현물" ? "현물" : "현금")

/** 기간 프리셋. RCMS 는 연차·분기 단위로 확인하니 그 폭에 맞춘다. */
const 기간프리셋 = [
  { v: "전체", label: "전체" },
  { v: "1m", label: "최근 1개월" },
  { v: "3m", label: "최근 3개월" },
  { v: "6m", label: "최근 6개월" },
  { v: "12m", label: "최근 1년" },
] as const

function 프리셋시작(v: string): string | null {
  if (v === "전체") return null
  const 개월 = Number(v.replace("m", ""))
  const d = new Date()
  d.setMonth(d.getMonth() - 개월)
  return d.toISOString().slice(0, 10)
}

export function ExpenseTable({
  rows,
  cats,
  subs,
  labels,
  actor,
  과제_id,
  증빙요건 = [],
  증빙파일 = [],
}: {
  rows: Row[]
  cats: CatOption[]
  subs: SubOption[]
  labels: { cat: Record<string, string>; sub: Record<string, string> }
  actor: string
  /** 집행 상세에서 증빙을 첨부하려면 과제가 필요하다. 전체 집행 화면에서는 넘기지 않는다. */
  과제_id?: number
  증빙요건?: EvidenceRequirement[]
  증빙파일?: EvidenceFile[]
}) {
  // 대장의 「증빙 N」 배지가 `?expense=<id>` 로 보낸다 — **어디가 비었는지로 바로** 가야 하므로
  // 목록만 열지 않고 그 집행 건의 상세(증빙 칸)까지 펼친 채로 시작한다(2026-09-04 사용자 지시).
  const [openId, setOpenId] = React.useState<number | null>(() => {
    if (typeof window === "undefined") return null
    const v = Number(new URLSearchParams(window.location.search).get("expense"))
    return Number.isInteger(v) && v > 0 ? v : null
  })

  // ── 필터 — 항목(비목) · 세부항목 · 재원 · 상태 · 기간 ─────────────────────
  // RCMS 확인은 「어느 비목의, 어느 기간 집행인가」로 한다. 목록을 눈으로 훑어 세지 않게 한다.
  const [비목, set비목] = React.useState("전체")
  const [세부, set세부] = React.useState("전체")
  const [재원, set재원] = React.useState("전체")
  const [상태, set상태] = React.useState("전체")
  const [프리셋, set프리셋] = React.useState<string>("전체")
  const [시작, set시작] = React.useState("")
  const [종료, set종료] = React.useState("")

  const 상태목록 = Array.from(new Set(rows.map((r) => r.상태)))
  const 세부목록 = subs.filter((s) => 비목 === "전체" || s.대분류 === 비목)

  const 기간시작 = 시작 || 프리셋시작(프리셋) || ""
  const filtered = rows.filter((r) => {
    if (비목 !== "전체" && r.비목_대분류 !== 비목) return false
    if (세부 !== "전체" && r.비목_세부항목 !== 세부) return false
    if (재원 !== "전체" && 정산재원(r.재원구분) !== 재원) return false
    if (상태 !== "전체" && r.상태 !== 상태) return false
    // 일자가 비어 있는 건은 기간을 걸면 빠진다. 그게 맞다 — 기간 확인 대상이 아니다.
    if (기간시작 && (!r.일자 || r.일자 < 기간시작)) return false
    if (종료 && (!r.일자 || r.일자 > 종료)) return false
    return true
  })

  const 걸러짐 = filtered.length !== rows.length
  const 합계 = filtered.reduce((s, r) => s + Number(r.합계 ?? 0), 0)
  const 초기화 = () => {
    set비목("전체"), set세부("전체"), set재원("전체"), set상태("전체")
    set프리셋("전체"), set시작(""), set종료("")
  }

  const open = filtered.find((r) => r.id === openId) ?? rows.find((r) => r.id === openId) ?? null
  const sel =
    "h-7 rounded-md border bg-transparent px-2 text-[13.8px] text-foreground"

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <select
          className={sel}
          value={비목}
          onChange={(e) => {
            set비목(e.target.value)
            set세부("전체")
          }}
          aria-label="비목으로 걸러내기"
        >
          <option value="전체">비목 전체</option>
          {cats.map((c) => (
            <option key={c.코드} value={c.코드}>
              {c.이름}
            </option>
          ))}
        </select>

        <select
          className={sel}
          value={세부}
          onChange={(e) => set세부(e.target.value)}
          aria-label="세부항목으로 걸러내기"
        >
          <option value="전체">세부항목 전체</option>
          {세부목록.map((s) => (
            <option key={s.코드} value={s.코드}>
              {s.이름}
            </option>
          ))}
        </select>

        <select className={sel} value={재원} onChange={(e) => set재원(e.target.value)} aria-label="재원으로 걸러내기">
          <option value="전체">재원 전체</option>
          <option value="현금">현금</option>
          <option value="현물">현물</option>
        </select>

        <select className={sel} value={상태} onChange={(e) => set상태(e.target.value)} aria-label="상태로 걸러내기">
          <option value="전체">상태 전체</option>
          {상태목록.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          className={sel}
          value={프리셋}
          onChange={(e) => {
            set프리셋(e.target.value)
            set시작("")
          }}
          aria-label="기간 프리셋"
        >
          {기간프리셋.map((p) => (
            <option key={p.v} value={p.v}>
              {p.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          className={sel}
          value={기간시작}
          onChange={(e) => {
            set시작(e.target.value)
            set프리셋("전체")
          }}
          aria-label="시작일"
        />
        <span className="text-[13.8px] text-muted-foreground">~</span>
        <input
          type="date"
          className={sel}
          value={종료}
          onChange={(e) => set종료(e.target.value)}
          aria-label="종료일"
        />

        <span className="ml-auto text-[13.8px] text-muted-foreground">
          {filtered.length}건 · <span className="tabular-nums">{won(합계)}</span>
          {걸러짐 && <span className="ml-1">(전체 {rows.length}건)</span>}
        </span>
        {걸러짐 && (
          <Button
            type="button"
            variant="ghost"
            className="h-7 px-2 text-[13.2px] text-muted-foreground"
            onClick={초기화}
          >
            필터 해제
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="집행 내역이 없습니다"
          hint="Slack 채널에 증빙을 올리면 봇이 판독해 여기에 「검토대기」로 쌓습니다."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>일자 ⇅</TableHead>
              <TableHead>거래처 ⇅</TableHead>
              <TableHead>품목</TableHead>
              <TableHead className="text-right">합계 ⇅</TableHead>
              <TableHead>비목 › 세부항목</TableHead>
              <TableHead className="w-[64px]">재원</TableHead>
              <TableHead className="text-center">확신도</TableHead>
              <TableHead>상태 ⇅</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-[14.3px] text-muted-foreground">
                  걸러낸 조건에 맞는 집행이 없습니다. 필터를 풀거나 기간을 넓혀 보세요.
                </TableCell>
              </TableRow>
            ) : null}
            {filtered.map((e) => (
              <TableRow
                key={e.id}
                className="h-[38px] cursor-pointer text-[14.3px]"
                onClick={() => setOpenId(e.id)}
              >
                <TableCell className="tabular-nums text-muted-foreground">
                  {e.일자 ?? "—"}
                </TableCell>
                <TableCell className="font-medium">{e.거래처 ?? "—"}</TableCell>
                {/* ⚠ `TableCell` 기본값이 `whitespace-nowrap` 이다. 품목명이 한 줄로 펴지면
                    이 열 하나가 232px 을 잡고 표가 창을 넘어간다(1,280px 실측).
                    두 줄로 접는다 — 품목명을 자르면 어느 건인지 못 읽는다. */}
                <TableCell className="max-w-[220px] whitespace-normal">{e.품목요약}</TableCell>
                <TableCell className="text-right tabular-nums">{won(e.합계)}</TableCell>
                <TableCell className="max-w-[200px] whitespace-normal text-muted-foreground">
                  {e.비목_대분류 ? (labels.cat[e.비목_대분류] ?? e.비목_대분류) : "미분류"}
                  {e.비목_세부항목 && (
                    <>
                      <span className="mx-1">›</span>
                      <span className="text-foreground">
                        {labels.sub[e.비목_세부항목] ?? e.비목_세부항목}
                      </span>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{정산재원(e.재원구분)}</TableCell>
                <TableCell className="text-center">
                  <ConfidenceBadge value={e.ai_확신도} />
                </TableCell>
                <TableCell>
                  <StatusBadge value={e.상태} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={openId != null} onOpenChange={(o) => !o && setOpenId(null)}>
        {open && (
          <ExpenseDetail
            row={open}
            cats={cats}
            subs={subs}
            labels={labels}
            actor={actor}
            과제_id={과제_id}
            증빙요건={증빙요건}
            증빙파일={증빙파일.filter((f) => f.집행_id === open.id)}
            onDone={() => setOpenId(null)}
          />
        )}
      </Dialog>
    </>
  )
}

function ExpenseDetail({
  row,
  cats,
  subs,
  labels,
  actor,
  과제_id,
  증빙요건,
  증빙파일,
  onDone,
}: {
  row: Row
  cats: CatOption[]
  subs: SubOption[]
  labels: { cat: Record<string, string>; sub: Record<string, string> }
  actor: string
  과제_id?: number
  증빙요건: EvidenceRequirement[]
  증빙파일: EvidenceFile[]
  onDone: () => void
}) {
  const [mode, setMode] = React.useState<"view" | "correct">("view")
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<string | null>(null)

  // 정정 폼 상태
  const [cat, setCat] = React.useState(row.비목_대분류 ?? "")
  const [sub, setSub] = React.useState(row.비목_세부항목 ?? "")
  const [유형, set유형] = React.useState("")
  const [사유, set사유] = React.useState("")

  const conf = row.ai_확신도 == null ? null : Number(row.ai_확신도)
  const lowConf = conf != null && conf < 0.7
  const 미확정 = row.상태 === "검토대기"
  // 정산이 끝난 건은 다시 확정하면 상태가 「확정」으로 **되돌아간다** — 정산이 풀린다.
  const 정산끝 = row.상태 === "정산완료"
  /**
   * 확정을 못 누르는 이유. **없으면 눌린다.**
   *
   * 이미 확정된 건은 막지 않는다 — 서버 액션이 decisions 에 한 줄을 더 쌓을 뿐이고,
   * 쌓이는 건 이 시스템이 원하는 것이다. 증빙을 다 붙인 뒤 다시 확정하는 것이 실제 일이다.
   */
  const 못누르는이유 = 정산끝
    ? "정산이 끝난 건이다. 다시 확정하면 정산이 풀린다."
    : lowConf
      ? `확신도 ${Math.round((conf ?? 0) * 100)}% — 70% 미만은 그대로 확정할 수 없다. [비목 수정]으로 직접 고르라.`
      : null

  const subOptions = subs.filter((s) => s.대분류 === cat)
  const 바뀜 = cat !== (row.비목_대분류 ?? "") || sub !== (row.비목_세부항목 ?? "")
  const 제출가능 = 바뀜 && !!유형 && 사유.trim().length > 0

  const doConfirm = () =>
    start(async () => {
      const r = await confirmExpense(row.id, actor)
      if (r.ok) onDone()
      else setMsg(r.error ?? "확정하지 못했다")
    })

  const doCorrect = () =>
    start(async () => {
      const r = await correctExpense({
        id: row.id,
        비목: cat,
        세부항목: sub || null,
        유형,
        사유,
        확정자: actor,
      })
      if (r.ok) onDone()
      else setMsg(r.error ?? "정정하지 못했다")
    })

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="text-base">
          {row.거래처 ?? "거래처 미상"} · {won(row.합계)}
        </DialogTitle>
        <DialogDescription>
          {row.일자 ?? "일자 미상"} · {row.품목요약}
        </DialogDescription>
      </DialogHeader>

      {mode === "view" ? (
        <div className="grid gap-3 text-[14.3px]">
          {/* 처리 이력 — 「왜 이 비목인가」의 답. 펼칠 때 한 번만 불러온다. */}
          <ExpenseHistory 집행_id={row.id} />

          {/* AI 판단 */}
          <section className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">AI 제안</span>
              <ConfidenceBadge value={row.ai_확신도} />
              {lowConf && (
                <span className="text-xs text-[var(--warning-fg)]">
                  70% 미만 — 자동 확정이 차단된다
                </span>
              )}
            </div>
            <div className="font-medium">
              {row.비목_대분류 ? (labels.cat[row.비목_대분류] ?? row.비목_대분류) : "미분류"}
              {row.비목_세부항목 && (
                <>
                  <span className="mx-1 text-muted-foreground">›</span>
                  {labels.sub[row.비목_세부항목] ?? row.비목_세부항목}
                </>
              )}
            </div>
            {row.ai_근거 && (
              <p className="mt-1.5 text-muted-foreground">{row.ai_근거}</p>
            )}
          </section>

          {/* 코드가 확정한 것 */}
          <div className="grid gap-2 sm:grid-cols-3">
            <Fact label="공급가액" value={won(row.공급가액)} />
            <Fact label="세액" value={won(row.세액)} />
            <Fact
              label="거래 방향"
              value={row.방향검증 ?? "—"}
              hint="자사 사업자번호로 계산 확정. LLM 아님"
            />
          </div>

          {/* 이 건의 증빙 — 요건 네 개와 ZIP 한 번에 받기. 과제 화면에서만 뜬다. */}
          {과제_id != null && (
            <ExpenseEvidence
              과제_id={과제_id}
              집행_id={row.id}
              비목_대분류={row.비목_대분류}
              비목_세부항목={row.비목_세부항목}
              요건={증빙요건}
              파일={증빙파일}
            />
          )}

          {/* 우리 회사 과거 처리 */}
          <section className="rounded-lg border bg-card p-3">
            <div className="mb-1.5 text-xs text-muted-foreground">우리 회사 과거 처리</div>
            {row.유사.length === 0 ? (
              <p className="text-muted-foreground">
                유사 이력 없음 — 쌓이면 여기가 채워진다
              </p>
            ) : (
              <ul className="space-y-1">
                {row.유사.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">·</span>
                    <span className="flex-1">
                      {s.품목} →{" "}
                      <span className="font-medium">
                        {s.세부항목 ? (labels.sub[s.세부항목] ?? s.세부항목) : "—"}
                      </span>
                      {s.일자 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({s.일자})
                        </span>
                      )}
                      {s.정정사유 && (
                        <div className="text-xs text-muted-foreground">
                          정정 사유: {s.정정사유}
                        </div>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 판단 이력 */}
          {row.결정이력.length > 0 && (
            <section className="rounded-lg border bg-card p-3">
              <div className="mb-1.5 text-xs text-muted-foreground">판단 이력</div>
              <ul className="space-y-1.5">
                {row.결정이력.map((d) => (
                  <li key={d.id}>
                    <span className="font-medium">
                      {labels.cat[d.확정_비목] ?? d.확정_비목}
                      {d.확정_세부항목 && ` › ${labels.sub[d.확정_세부항목] ?? d.확정_세부항목}`}
                    </span>
                    {d.정정여부 ? (
                      <span className="ml-2 text-xs text-[var(--warning-fg)]">
                        정정 · {d.정정사유_유형}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-muted-foreground">그대로 확정</span>
                    )}
                    {d.정정사유 && (
                      <div className="text-xs text-muted-foreground">{d.정정사유}</div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {msg && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {msg}
            </p>
          )}

          {/* **왜 안 눌리는지 화면에 적는다.** title 툴팁만 있으면 눌러 봐도 아무 일이 없고
              이유도 안 보인다 — 사용자가 "확정이 안 눌려서"라고 한 게 정확히 그 상황이었다. */}
          {못누르는이유 && (
            <p className="text-right text-xs text-muted-foreground">{못누르는이유}</p>
          )}
          {!못누르는이유 && !미확정 && (
            <p className="text-right text-xs text-muted-foreground">
              이미 확정된 건이다 — 다시 누르면 판단 이력에 한 줄이 더 쌓인다.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMode("correct")}>
              비목 수정
            </Button>
            <Button type="button" onClick={doConfirm} disabled={pending || !!못누르는이유}>
              {pending ? "처리 중…" : "확정"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 text-[14.3px]">
          <Field label="올바른 비목">
            <select
              className="h-8 w-full rounded-md border bg-card px-2 text-[14.3px]"
              value={cat}
              onChange={(e) => {
                setCat(e.target.value)
                setSub("")
              }}
            >
              <option value="">선택</option>
              {cats.map((c) => (
                <option key={c.코드} value={c.코드}>
                  {c.이름}
                </option>
              ))}
            </select>
          </Field>

          <Field label="세부항목">
            <select
              className="h-8 w-full rounded-md border bg-card px-2 text-[14.3px]"
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              disabled={!cat}
            >
              <option value="">선택 안 함</option>
              {subOptions.map((s) => (
                <option key={s.코드} value={s.코드}>
                  {s.이름}
                </option>
              ))}
            </select>
          </Field>

          {/* ★ 여기가 이 프로젝트에서 가장 중요한 입력이다 */}
          <Field label="왜 다른가요?">
            <div className="grid gap-1.5">
              {사유유형.map((o) => (
                <label key={o.v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="정정사유유형"
                    value={o.v}
                    checked={유형 === o.v}
                    onChange={() => set유형(o.v)}
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="한 줄 메모 (필수)">
            <input
              type="text"
              className="h-8 w-full rounded-md border bg-card px-2 text-[14.3px]"
              placeholder="예: 연구원 지급 노트북은 사무 겸용이라 운영비로 처리해 왔음"
              value={사유}
              onChange={(e) => set사유(e.target.value)}
            />
          </Field>

          <p className="text-xs text-muted-foreground">
            정정할 때 이유를 반드시 받는다. 지금까지 이 판단은 담당자 머릿속에서 끝났다.
            이제 조직에 남고, 다음 판정이 이걸 먼저 본다.
          </p>

          {msg && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {msg}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMode("view")}>
              뒤로
            </Button>
            <Button
              type="button"
              onClick={doCorrect}
              disabled={pending || !제출가능}
              title={
                !바뀜
                  ? "비목이 그대로다"
                  : !유형
                    ? "정정 사유 유형을 고르라"
                    : !사유.trim()
                      ? "한 줄 메모가 필요하다"
                      : undefined
              }
            >
              {pending ? "저장 중…" : "정정 확정"}
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  )
}

function Fact({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
