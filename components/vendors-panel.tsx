"use client"

import * as React from "react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { EmptyState } from "@/components/page-shell"
import { useFileDrop, 드롭강조 } from "@/components/use-file-drop"
import { 문서파일_점검 } from "@/lib/upload-limits"
import {
  saveVendor,
  uploadVendorDocuments,
  getVendorDownloadUrl,
  deleteVendorDocument,
  deleteVendor,
} from "@/app/actions/vendors"
import { 업체서류_기본, 사업자번호_표기 } from "@/lib/vendor-types"
import type {
  VendorRow,
  VendorDetail,
  VendorDocument,
  미등록거래처,
  업체집행,
} from "@/lib/vendor-types"

/**
 * 업체(거래처) 대장 — 사업자등록증·통장사본을 받아 두는 자리.
 *
 * **이 서류는 과제가 아니라 업체에 붙는다.** 한 번 받아서 여러 과제·여러 집행 건에 쓴다.
 * 그래서 과제 안(계상 탭 증빙)이나 집행 건 상세가 아니라 여기 있다 — 거기 붙이면
 * 같은 등록증을 건마다 다시 받게 되고, 업체 이름으로 다시 찾을 수도 없다.
 *
 * 서류종류는 **놓는 자리가 정한다**(증빙 첨부·규정 문서함과 같은 규칙).
 * 파일명으로 종류를 짐작해 자동 분류하지 않는다 — 잘못 붙으면 「확보」 숫자가 조용히 거짓말을 한다.
 */

const won = (n: number | null | undefined) =>
  n == null ? "—" : `₩${Math.round(Number(n)).toLocaleString("ko-KR")}`

const KB = (n: number | null) =>
  n == null
    ? ""
    : n < 1024 * 1024
      ? `${Math.max(1, Math.round(n / 1024))}KB`
      : `${(n / 1024 / 1024).toFixed(1)}MB`

/** ISO → `09-03 20:40` (KST). 서버·클라이언트가 같은 값을 내야 하므로 직접 계산한다. */
function 시각(iso: string) {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

/**
 * ⚠ 컴포넌트 이름만 ASCII 로 둔다 — JSX 는 소문자로 시작하는 태그를 HTML 로 보는데,
 *   한글 식별자가 그 경계에서 어떻게 취급되는지는 도구마다 애매하다.
 *   변수·함수는 이 저장소 규칙대로 한글을 쓴다.
 */
/**
 * 서류를 받아 뒀나 — **「등록 / 미등록」 두 마디로 말한다**(2026-09-04 사용자 지시).
 *
 * 「확보 1」이라고 쓰면 회계 용어처럼 읽혀서 무슨 절차가 더 있는 줄 알게 되고,
 * 1 이 무슨 수인지도 안 적혀 있었다. 장수는 업체를 열면 파일 목록이 그대로 보여 준다 —
 * 훑는 자리에는 **받았나 못 받았나**만 있으면 된다. 여러 장이면 툴팁으로 말한다.
 */
function HeldBadge({ n }: { n: number }) {
  return n > 0 ? (
    <span
      className="inline-flex h-5 items-center rounded-4xl border border-border px-2 text-xs"
      title={n > 1 ? `${n}장 올려 두었습니다` : undefined}
    >
      등록
    </span>
  ) : (
    <span className="inline-flex h-5 items-center rounded-4xl bg-[var(--warning)] px-2 text-xs text-[var(--warning-fg)]">
      미등록
    </span>
  )
}

type 폼기본값 = { 업체명?: string; 사업자번호?: string }

/**
 * 서류 한 자리. **놓는 자리가 곧 종류다.**
 *
 * 부모 안에 정의하지 않고 밖에 둔다 — 렌더마다 컴포넌트 타입이 새로 만들어지면 React 가
 * 그 자리를 통째로 다시 붙이고, 드래그 도중에 그러면 드롭이 씹힌다.
 */
function DocSlot({
  종류,
  목록,
  켜짐,
  드롭영역props,
  pending,
  onFiles,
  on내려받기,
  on지우기,
}: {
  종류: string
  목록: VendorDocument[]
  켜짐: boolean
  드롭영역props: React.ComponentProps<"div">
  pending: boolean
  onFiles: (files: File[]) => void
  on내려받기: (id: number) => void
  on지우기: (id: number, 파일명: string) => void
}) {
  const 입력 = React.useRef<HTMLInputElement>(null)
  return (
    <div
      {...드롭영역props}
      className={`rounded-lg border p-3 transition-colors ${켜짐 ? 드롭강조.카드 : ""}`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-medium">{종류}</span>
        {목록.length === 0 ? (
          <span className="text-xs text-[var(--warning-fg)]">미등록</span>
        ) : (
          <span className="text-xs text-muted-foreground">등록 {목록.length}건</span>
        )}
        <Button
          type="button"
          variant="outline"
          className="ml-auto h-6 text-[12px]"
          disabled={pending}
          onClick={() => 입력.current?.click()}
        >
          파일 첨부
        </Button>
        <input
          ref={입력}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []))
            e.target.value = ""
          }}
        />
      </div>

      {목록.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          여기에 파일을 끌어다 놓으면 {종류} 으로 분류됩니다.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {목록.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                disabled={pending}
                onClick={() => on내려받기(d.id)}
              >
                {d.파일명}
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {KB(d.크기)} · {시각(d.업로드일시)}
                {/* 로그인이 아직 없다 — 확인되지 않은 업로더 이름은 적지 않는다.
                    빈칸이 「미인증(로그인 전)」보다 정직하다. 로그인이 붙으면 여기 이름이 찍힌다. */}
                {d.업로더_인증 ? ` · ${d.업로더}` : ""}
              </span>
              <button
                type="button"
                className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                disabled={pending}
                onClick={() => on지우기(d.id, d.파일명)}
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function VendorsPanel({
  업체,
  상세,
  서류,
  미등록,
  집행내역,
  비목이름 = {},
}: {
  업체: VendorRow[]
  상세: VendorDetail[]
  서류: VendorDocument[]
  미등록: 미등록거래처[]
  /** 사업자번호 → 그 업체와의 집행 내역(최근순). 「구매내역」 창이 쓴다. */
  집행내역: Record<string, 업체집행[]>
  /** 비목 코드 → 한글. 화면에 EQUIP_PURCHASE 가 보이면 안 된다. */
  비목이름?: Record<string, string>
}) {
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()
  /** null=닫힘 · "new"=등록 · 숫자=그 업체 수정 */
  const [열린, set열린] = React.useState<number | "new" | null>(null)
  const [기본값, set기본값] = React.useState<폼기본값>({})
  /** 구매내역을 펼친 업체. 수정 창과 **따로** 연다 — 보러 온 사람이 편집 폼에 떨어지면 안 된다. */
  const [내역업체, set내역업체] = React.useState<VendorRow | null>(null)
  const { 드롭대상, 드롭영역 } = useFileDrop({ 거부됨: (사유) => setMsg({ ok: false, text: 사유 }) })

  const 현재 = typeof 열린 === "number" ? 상세.find((v) => v.id === 열린) : undefined
  const 현재서류 = React.useMemo(
    () => (typeof 열린 === "number" ? 서류.filter((d) => d.업체_id === 열린) : []),
    [열린, 서류],
  )

  function 저장(form: HTMLFormElement) {
    const fd = new FormData(form)
    if (typeof 열린 === "number") fd.set("id", String(열린))
    setMsg(null)
    start(async () => {
      const r = await saveVendor(fd)
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "저장하지 못했습니다." })
        return
      }
      setMsg({ ok: true, text: "저장했습니다." })
      // 새로 등록한 업체는 **그 자리에서 서류를 올릴 수 있게** 수정 상태로 이어 둔다.
      // 저장 → 목록으로 튕김 → 다시 찾아 열기, 이 세 걸음이 실제로 제일 번거롭다.
      if (r.id) set열린(r.id)
    })
  }

  function 올리기(서류종류: string, files: File[]) {
    if (typeof 열린 !== "number") {
      setMsg({ ok: false, text: "업체를 먼저 저장하세요. 그다음에 서류를 올릴 수 있습니다." })
      return
    }
    const 고른것 = files.filter(Boolean)
    if (!고른것.length) return
    if (pending) {
      setMsg({ ok: false, text: "앞의 파일을 올리는 중입니다. 끝난 뒤에 놓으세요." })
      return
    }

    // 서버가 최종 판정자지만 여기서 먼저 거른다 — 25MB 를 끝까지 올려보낸 뒤 거절하면
    // 그 시간이 그냥 날아간다. 규칙은 `lib/upload-limits.ts` 한 벌을 같이 본다.
    const 거절: string[] = []
    const 보낼것: File[] = []
    for (const f of 고른것) {
      const 문제 = 문서파일_점검(f)
      if (문제) 거절.push(문제)
      else 보낼것.push(f)
    }
    if (!보낼것.length) {
      setMsg({ ok: false, text: 거절.join(" / ") })
      return
    }

    const fd = new FormData()
    fd.set("업체_id", String(열린))
    fd.set("서류종류", 서류종류)
    for (const f of 보낼것) fd.append("files", f)

    setMsg(null)
    start(async () => {
      const r = await uploadVendorDocuments(fd)
      const 앞 = 거절.length ? `${거절.join(" / ")} ` : ""
      setMsg({
        ok: r.ok,
        text: r.error ? `${앞}${r.error}` : `${앞}${서류종류} ${r.올린수 ?? 0}건 올렸습니다.`,
      })
    })
  }

  function 내려받기(id: number) {
    start(async () => {
      const r = await getVendorDownloadUrl(id)
      if (!r.ok || !r.url) {
        setMsg({ ok: false, text: r.error ?? "내려받지 못했습니다." })
        return
      }
      window.location.href = r.url
    })
  }

  function 서류지우기(id: number, 파일명: string) {
    start(async () => {
      const r = await deleteVendorDocument(id)
      setMsg({
        ok: r.ok,
        text: r.ok ? `${파일명} 을 지웠습니다.` : (r.error ?? "지우지 못했습니다."),
      })
    })
  }

  function 업체지우기(id: number) {
    start(async () => {
      const r = await deleteVendor(id)
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "지우지 못했습니다." })
        return
      }
      setMsg({ ok: true, text: "업체를 지웠습니다." })
      set열린(null)
    })
  }

  /** 한 자리 몫의 props. 자리는 위의 `DocSlot` 이 그린다. */
  const 자리props = (종류: string) => ({
    종류,
    목록: 현재서류.filter((d) => d.서류종류 === 종류),
    켜짐: 드롭대상 === `doc:${종류}`,
    드롭영역props: 드롭영역(`doc:${종류}`, (files) => 올리기(종류, files)),
    pending,
    onFiles: (files: File[]) => 올리기(종류, files),
    on내려받기: 내려받기,
    on지우기: 서류지우기,
  })

  return (
    <>
      {msg && (
        <div
          className={`rounded-lg border p-3 text-[13px] ${
            msg.ok
              ? "border-border bg-card text-foreground"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="h-7 text-[12.8px]"
          onClick={() => {
            set기본값({})
            set열린("new")
          }}
        >
          + 업체 등록
        </Button>
        <span className="text-xs text-muted-foreground">
          사업자등록증·통장사본은 업체에 붙는 서류입니다 — 한 번 받아 두면 모든 과제에서 씁니다.
        </span>
      </div>

      <div className="rounded-lg border bg-card">
        {업체.length === 0 ? (
          <EmptyState
            title="등록된 업체가 없습니다"
            hint={
              미등록.length > 0
                ? `집행 건에 거래처가 ${미등록.length}곳 있습니다. 아래에서 골라 대장에 올리세요.`
                : "「+ 업체 등록」으로 업체를 추가하고 사업자등록증·통장사본을 받아 두세요."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[220px]">업체명</TableHead>
                <TableHead>사업자번호</TableHead>
                <TableHead>대표자</TableHead>
                <TableHead>계좌</TableHead>
                <TableHead>사업자등록증</TableHead>
                <TableHead>통장사본</TableHead>
                <TableHead className="text-right">구매내역</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {업체.map((v) => (
                <TableRow
                  key={v.id}
                  className="h-[38px] cursor-pointer text-[13px]"
                  onClick={() => set열린(v.id)}
                >
                  <TableCell className="font-medium">{v.업체명}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {사업자번호_표기(v.사업자번호)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{v.대표자 ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {/* 내부 인원이 공유하는 화면이라 가리지 않는다(2026-09-03 결정). */}
                    {v.계좌번호 ? `${v.은행 ?? ""} ${v.계좌번호}`.trim() : "—"}
                  </TableCell>
                  <TableCell>
                    <HeldBadge n={v.등록증_건수} />
                  </TableCell>
                  <TableCell>
                    <HeldBadge n={v.통장사본_건수} />
                  </TableCell>
                  {/* 금액을 뺐다(2026-09-04 사용자 지시) — 훑는 자리에 총액이 있으면 눈이
                      거기 붙는데 정작 「무엇을 샀나」는 못 본다. 금액은 창 안에 건별로 있다. */}
                  <TableCell className="text-right">
                    {v.집행건수 > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-6 text-[12px]"
                        // ⚠ 행 전체가 수정 창을 여는 자리다. 막지 않으면 두 창이 같이 뜬다.
                        onClick={(ev) => {
                          ev.stopPropagation()
                          set내역업체(v)
                        }}
                      >
                        구매내역 {v.집행건수}건
                      </Button>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">거래 없음</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {미등록.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="text-[13px] font-medium">집행 건에는 있는데 대장에 없는 거래처</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            많이 쓴 곳부터입니다. 누르면 그 값이 채워진 등록 창이 열립니다 —{" "}
            <span className="text-foreground">표기가 다른 같은 업체를 자동으로 합치지 않습니다.</span>{" "}
            그 판단은 사람이 합니다.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {미등록.map((u) => (
              <li key={u.사업자번호 ?? u.거래처}>
                <button
                  type="button"
                  className="rounded-4xl border px-2 py-1 text-xs hover:bg-secondary"
                  onClick={() => {
                    set기본값({ 업체명: u.거래처, 사업자번호: u.사업자번호 ?? "" })
                    set열린("new")
                  }}
                >
                  + {u.거래처}
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    {u.건수}건 · {won(u.합계)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 구매내역 — **보는 창이다.** 여기서 집행을 고치지 않는다(고치는 자리는 과제의 집행 탭).
          줄을 누르면 그 집행 건이 펼쳐진 채로 열린다 — 증빙 미비 목록과 같은 규칙이다. */}
      <Dialog open={내역업체 != null} onOpenChange={(o) => !o && set내역업체(null)}>
        {내역업체 != null &&
          (() => {
            const 목록 = 내역업체.사업자번호 ? (집행내역[내역업체.사업자번호] ?? []) : []
            const 합 = 목록.reduce((s, e) => s + Number(e.합계 ?? 0), 0)
            return (
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle className="text-base">{내역업체.업체명} — 구매내역</DialogTitle>
                  <DialogDescription>
                    <b>사업자번호</b>로 이은 집행 건입니다. 최근 것부터 세웠습니다. 줄을 누르면 그
                    집행 건으로 갑니다.
                  </DialogDescription>
                </DialogHeader>

                {목록.length === 0 ? (
                  <EmptyState
                    title="이 업체로 잡힌 집행이 없습니다"
                    hint={
                      내역업체.사업자번호
                        ? "집행 건의 사업자번호가 대장과 글자까지 같아야 이어집니다 — 표기가 다르면 여기 안 잡힙니다."
                        : "이 업체에 사업자번호가 없습니다. 번호를 채우면 집행 건과 이어집니다."
                    }
                  />
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-[96px]">일자</TableHead>
                          <TableHead className="w-[104px]">과제</TableHead>
                          <TableHead>품목</TableHead>
                          <TableHead className="w-[92px]">비목</TableHead>
                          <TableHead className="w-[80px]">결제</TableHead>
                          <TableHead className="w-[112px] text-right">금액</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {목록.map((e) => (
                          <TableRow key={e.id} className="h-[38px] text-[13px]">
                            <TableCell className="tabular-nums text-muted-foreground">
                              {e.일자 ?? "미상"}
                            </TableCell>
                            <TableCell className="text-[12px] text-muted-foreground">
                              {e.과제_id ? (
                                <Link
                                  href={`/projects/${e.과제_id}/expenses?expense=${e.id}`}
                                  className="underline-offset-2 hover:underline"
                                  onClick={() => set내역업체(null)}
                                >
                                  {e.과제코드 ?? `과제 ${e.과제_id}`}
                                </Link>
                              ) : (
                                "미배정"
                              )}
                            </TableCell>
                            <TableCell className="whitespace-normal">{e.품목요약}</TableCell>
                            <TableCell className="text-[12px] text-muted-foreground">
                              {e.비목_대분류 ? (비목이름[e.비목_대분류] ?? e.비목_대분류) : "—"}
                            </TableCell>
                            <TableCell className="text-[12px] text-muted-foreground">
                              {e.결제수단 ?? "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {won(e.합계)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="text-right text-[13px] tabular-nums">
                      <span className="text-muted-foreground">{목록.length}건 합계 </span>
                      <b>{won(합)}</b>
                    </p>
                  </>
                )}
              </DialogContent>
            )
          })()}
      </Dialog>

      <Dialog open={열린 != null} onOpenChange={(o) => !o && set열린(null)}>
        {열린 != null && (
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{현재 ? 현재.업체명 : "업체 등록"}</DialogTitle>
              <DialogDescription>
                {현재
                  ? "업체 정보를 고치고, 아래에서 사업자등록증·통장사본을 받아 둡니다."
                  : "업체명만 있으면 등록됩니다. 사업자번호는 등록증을 받은 뒤에 채워도 됩니다."}
              </DialogDescription>
            </DialogHeader>

            <form
              // 창을 다시 열 때 앞 업체의 값이 남지 않게 키를 준다.
              // ⚠ `updated_at` 을 키에 넣는다. 새로 등록하면 서버 데이터가 도착하기 전에
              //    이 창이 이미 수정 상태로 바뀌는데, 그때 `defaultValue` 만 갈아끼우면
              //    Base UI 가 「uncontrolled 입력의 기본값이 초기화 뒤에 바뀌었다」고 경고하고
              //    칸이 갱신되지 않는다. 키가 바뀌면 폼을 다시 붙여 값이 제대로 들어간다.
              key={
                typeof 열린 === "number"
                  ? `v${열린}-${현재?.updated_at ?? "loading"}`
                  : `new-${기본값.사업자번호 ?? ""}-${기본값.업체명 ?? ""}`
              }
              onSubmit={(e) => {
                e.preventDefault()
                저장(e.currentTarget)
              }}
              className="space-y-3"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">
                  업체명
                  <Input
                    name="업체명"
                    required
                    defaultValue={현재?.업체명 ?? 기본값.업체명 ?? ""}
                    className="mt-1 h-8 text-[13px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  사업자번호 (숫자 10자리)
                  <Input
                    name="사업자번호"
                    inputMode="numeric"
                    placeholder="1234567890"
                    defaultValue={현재?.사업자번호 ?? 기본값.사업자번호 ?? ""}
                    className="mt-1 h-8 tabular-nums text-[13px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  대표자
                  <Input
                    name="대표자"
                    defaultValue={현재?.대표자 ?? ""}
                    className="mt-1 h-8 text-[13px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  연락처
                  <Input
                    name="연락처"
                    defaultValue={현재?.연락처 ?? ""}
                    className="mt-1 h-8 text-[13px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  업태
                  <Input
                    name="업태"
                    defaultValue={현재?.업태 ?? ""}
                    className="mt-1 h-8 text-[13px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  종목
                  <Input
                    name="종목"
                    defaultValue={현재?.종목 ?? ""}
                    className="mt-1 h-8 text-[13px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground sm:col-span-2">
                  주소
                  <Input
                    name="주소"
                    defaultValue={현재?.주소 ?? ""}
                    className="mt-1 h-8 text-[13px]"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  이메일
                  <Input
                    name="이메일"
                    defaultValue={현재?.이메일 ?? ""}
                    className="mt-1 h-8 text-[13px]"
                  />
                </label>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-[13px] font-medium">입금 계좌</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  통장사본을 보고 사람이 옮겨 적습니다. <b>AI 로 읽지 않습니다</b> — 계좌번호는 한
                  자만 틀려도 돈이 남에게 가고, 확신도로 걸러낼 수 있는 종류의 오류가 아닙니다.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <label className="text-xs text-muted-foreground">
                    은행
                    <Input
                      name="은행"
                      defaultValue={현재?.은행 ?? ""}
                      className="mt-1 h-8 text-[13px]"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    계좌번호
                    <Input
                      name="계좌번호"
                      defaultValue={현재?.계좌번호 ?? ""}
                      className="mt-1 h-8 tabular-nums text-[13px]"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    예금주
                    <Input
                      name="예금주"
                      defaultValue={현재?.예금주 ?? ""}
                      className="mt-1 h-8 text-[13px]"
                    />
                  </label>
                </div>
              </div>

              <label className="block text-xs text-muted-foreground">
                비고
                <Input
                  name="비고"
                  defaultValue={현재?.비고 ?? ""}
                  className="mt-1 h-8 text-[13px]"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" className="h-7 text-[12.8px]" disabled={pending}>
                  {pending ? "저장 중…" : 현재 ? "저장" : "등록"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 text-[12.8px]"
                  onClick={() => set열린(null)}
                >
                  닫기
                </Button>
                {현재 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto h-7 text-[12.8px] text-muted-foreground hover:text-destructive"
                    disabled={pending}
                    onClick={() => 업체지우기(현재.id)}
                  >
                    업체 지우기
                  </Button>
                )}
              </div>
            </form>

            {현재 ? (
              <div className="space-y-2">
                <p className="text-[13px] font-medium">받아 둔 서류</p>
                {업체서류_기본.map((종류) => (
                  <DocSlot key={종류} {...자리props(종류)} />
                ))}
                <DocSlot {...자리props("기타")} />
                <p className="text-xs text-muted-foreground">
                  파일은 비공개 저장소에 들어가고, 내려받을 때만 60초 서명 주소가 만들어집니다 —
                  공개 주소가 존재하지 않습니다. 등록증이 재발급되거나 계좌가 바뀌면{" "}
                  <b>덮어쓰지 않고 새로 올립니다</b> — 어느 시점 서류로 정산했는지가 근거가 됩니다.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                먼저 등록하면 이 자리에 사업자등록증·통장사본을 올릴 칸이 열립니다.
              </p>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
