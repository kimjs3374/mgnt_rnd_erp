"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Card, EmptyState } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/money-input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { saveResearcher, deleteResearcher } from "@/app/actions/researchers"
import type { Researcher, SalaryRow } from "@/lib/queries-researchers"

// lib/queries-researchers.ts 는 server-only 다. 타입만 가져오고 표시용 함수는 여기서 만든다.
const won = (n: number | null | undefined) =>
  n == null ? "—" : "₩" + Number(n).toLocaleString("ko-KR")
/** 연봉 → 월급여. 서버의 `월급여()` 와 **같은 식**이다(원 단위 내림). 두 곳이 어긋나면 안 된다. */
const 월급여 = (연봉: number) => Math.floor(Math.max(0, 연봉) / 12)

type Draft = {
  id?: number | null
  표시명: string
  연구자등록번호: string
  입사일자: string
  소속기관: string
  소속부서: string
  직급: string
  연봉: number
  연봉_기준연도: number
  재직: boolean
}

const 빈줄 = (올해: number): Draft => ({
  id: null,
  표시명: "",
  연구자등록번호: "",
  입사일자: "",
  소속기관: "",
  소속부서: "",
  직급: "",
  연봉: 0,
  연봉_기준연도: 올해,
  재직: true,
})

const 만들기 = (r: Researcher): Draft => ({
  id: r.id,
  표시명: r.표시명,
  연구자등록번호: r.연구자등록번호 ?? "",
  입사일자: r.입사일자 ?? "",
  소속기관: r.소속기관 ?? "",
  소속부서: r.소속부서 ?? "",
  직급: r.직급 ?? "",
  연봉: Number(r.연봉 ?? 0),
  연봉_기준연도: Number(r.연봉_기준연도 ?? new Date().getFullYear()),
  재직: r.재직,
})

/**
 * 내부 연구원 명부.
 *
 * 여기서 한 번 등록해 두면 **인건비 계상에서 골라 넣는다**(`components/personnel-editor.tsx`).
 * 과제마다 이름·연구자등록번호·연봉을 다시 치지 않는 것이 이 화면의 값어치다.
 *
 * ⚠ 연봉은 **연도별로 쌓인다.** 기준연도를 바꿔 저장하면 그 해 값이 새로 들어가고
 *   지난 해 값은 그대로 남는다 — 지난 계상의 근거가 그 해 연봉이기 때문이다.
 */
export function ResearchersBoard({
  rows,
  이력,
}: {
  rows: Researcher[]
  이력: SalaryRow[]
}) {
  const 올해 = new Date().getFullYear()
  // ⚠ 서버 액션의 `revalidatePath` 만으로는 **이 표가 안 바뀐다.** 표는 서버가 내려준 prop 을
  //   들고 있는데, 그 prop 이 새로 오려면 라우터가 다시 그려야 한다.
  //   이걸 빠뜨려서 「저장했는데 목록에 안 뜬다」가 됐다(e2e 가 잡았다).
  const router = useRouter()
  const [편집, set편집] = React.useState<Draft | null>(null)
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [검색, set검색] = React.useState("")
  const [pending, start] = React.useTransition()

  const 이력맵 = React.useMemo(() => {
    const m = new Map<number, SalaryRow[]>()
    for (const s of 이력) {
      const cur = m.get(Number(s.연구원_id)) ?? []
      cur.push(s)
      m.set(Number(s.연구원_id), cur)
    }
    return m
  }, [이력])

  const 보이는 = React.useMemo(() => {
    const q = 검색.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.표시명, r.연구자등록번호, r.소속부서, r.직급].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      ),
    )
  }, [rows, 검색])

  function 저장() {
    if (!편집) return
    setMsg(null)
    start(async () => {
      const r = await saveResearcher(편집)
      if (r.ok) {
        setMsg({ ok: true, text: `${편집.표시명} 저장했습니다.` })
        set편집(null)
        router.refresh()
      } else {
        setMsg({ ok: false, text: r.error ?? "저장하지 못했습니다." })
      }
    })
  }

  function 지우기(r: Researcher) {
    setMsg(null)
    start(async () => {
      const res = await deleteResearcher(r.id)
      if (res.ok) router.refresh()
      setMsg(
        res.ok
          ? { ok: true, text: `${r.표시명} 을(를) 명부에서 지웠습니다.` }
          : { ok: false, text: res.error ?? "지우지 못했습니다." },
      )
    })
  }

  const cell = "h-7 text-[13.8px]"

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Input
          value={검색}
          onChange={(e) => set검색(e.target.value)}
          placeholder="이름·등록번호·부서 검색"
          className="h-7 w-56 text-[14.3px]"
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {보이는.length}명{보이는.length !== rows.length ? ` (전체 ${rows.length}명)` : ""}
        </span>
        <Button
          type="button"
          className="ml-auto h-7 text-[14.1px]"
          disabled={pending}
          onClick={() => {
            set편집(빈줄(올해))
            setMsg(null)
          }}
        >
          + 연구원 등록
        </Button>
      </div>

      {/* 절대규칙 5 — 배포 URL 은 열려 있다. 서버가 실명을 가릴 수는 없으니 여기서 말한다. */}
      <p className="px-1 text-[12.7px] text-muted-foreground">
        공개 주소에는 <b>가명</b>을 쓰세요. 연봉은 <b>1년 단위</b>로 갱신하며 기준연도별로 쌓입니다 —
        지난 계상의 근거가 그 해 연봉이라 덮어쓰지 않습니다. 인건비 계상에서 쓰는 <b>월급여 = 연봉 ÷ 12</b>.
      </p>

      {편집 && (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 text-[14.3px] font-medium">
            {편집.id ? "연구원 고치기" : "연구원 등록"}
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <label className="text-[13.2px] text-muted-foreground">
              연구원 성명 (가명)
              <Input
                className={cell}
                value={편집.표시명}
                onChange={(e) => set편집({ ...편집, 표시명: e.target.value })}
                aria-label="연구원 성명"
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              연구자등록번호
              <Input
                className={cell}
                value={편집.연구자등록번호}
                onChange={(e) => set편집({ ...편집, 연구자등록번호: e.target.value })}
                aria-label="연구자등록번호"
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              입사일자
              <Input
                type="date"
                className={cell}
                value={편집.입사일자}
                onChange={(e) => set편집({ ...편집, 입사일자: e.target.value })}
                aria-label="입사일자"
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              연봉 (대략)
              <MoneyInput
                value={편집.연봉}
                onValueChange={(n) => set편집({ ...편집, 연봉: n })}
                className="h-7 text-right text-[13.8px] tabular-nums"
                aria-label="연봉"
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              연봉 기준연도
              <Input
                type="number"
                className={cell}
                value={편집.연봉_기준연도}
                onChange={(e) => set편집({ ...편집, 연봉_기준연도: Number(e.target.value) || 올해 })}
                aria-label="연봉 기준연도"
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              소속부서
              <Input
                className={cell}
                value={편집.소속부서}
                onChange={(e) => set편집({ ...편집, 소속부서: e.target.value })}
                aria-label="소속부서"
              />
            </label>
            <label className="text-[13.2px] text-muted-foreground">
              직급
              <Input
                className={cell}
                value={편집.직급}
                onChange={(e) => set편집({ ...편집, 직급: e.target.value })}
                aria-label="직급"
              />
            </label>
            <label className="flex items-end gap-1.5 text-[13.2px] text-muted-foreground">
              <input
                type="checkbox"
                checked={편집.재직}
                onChange={(e) => set편집({ ...편집, 재직: e.target.checked })}
                aria-label="재직"
              />
              재직 중
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[12.7px] text-muted-foreground">
              월급여로 환산하면 <b className="tabular-nums">{won(월급여(편집.연봉))}</b> 입니다
            </span>
            <span className="ml-auto" />
            <Button
              type="button"
              variant="ghost"
              className="h-7 text-[14.1px] text-muted-foreground"
              disabled={pending}
              onClick={() => set편집(null)}
            >
              취소
            </Button>
            <Button type="button" className="h-7 text-[14.1px]" disabled={pending} onClick={저장}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </div>
      )}

      {msg && (
        <p className={msg.ok ? "px-1 text-[13.8px] text-muted-foreground" : "px-1 text-[13.8px] text-destructive"}>
          {msg.text}
        </p>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="등록된 연구원이 없습니다"
            hint="[+ 연구원 등록]으로 넣어 두면 인건비 계상에서 골라 쓸 수 있습니다."
          />
        ) : 보이는.length === 0 ? (
          <EmptyState title="찾는 연구원이 없습니다" hint="검색어를 바꿔 보세요." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[120px]">성명</TableHead>
                <TableHead className="w-[130px]">연구자등록번호</TableHead>
                <TableHead className="w-[110px]">입사일자</TableHead>
                <TableHead>부서 / 직급</TableHead>
                <TableHead className="text-right">연봉</TableHead>
                <TableHead className="text-right">월급여</TableHead>
                <TableHead>연봉 이력</TableHead>
                <TableHead className="w-[110px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {보이는.map((r) => {
                const 이 = (이력맵.get(r.id) ?? []).slice(0, 3)
                return (
                  <TableRow key={r.id} className={"h-[38px] text-[14.3px] " + (r.재직 ? "" : "opacity-60")}>
                    <TableCell className="font-medium">
                      {r.표시명}
                      {!r.재직 && (
                        <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[11.6px] text-muted-foreground">
                          퇴사
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.연구자등록번호 ?? "—"}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.입사일자 ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.소속부서 ?? "—"}
                      {r.직급 ? ` · ${r.직급}` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {won(r.연봉)}
                      {r.연봉_기준연도 ? (
                        <span className="ml-1 text-[12.1px] text-muted-foreground">
                          {r.연봉_기준연도}년
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {won(월급여(Number(r.연봉)))}
                    </TableCell>
                    <TableCell className="text-[12.7px] text-muted-foreground">
                      {이.length ? 이.map((s) => `${s.연도} ${won(s.연봉)}`).join(" · ") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        disabled={pending}
                        onClick={() => {
                          set편집(만들기(r))
                          setMsg(null)
                        }}
                      >
                        고치기
                      </button>
                      <span className="px-1.5 text-xs text-muted-foreground">·</span>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                        disabled={pending}
                        onClick={() => 지우기(r)}
                      >
                        삭제
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  )
}
