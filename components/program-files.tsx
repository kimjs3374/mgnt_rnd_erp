"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { 기간프리셋, 범위정하기, 기간_전체 } from "@/lib/date-filter"
import { 묶기, 지출별로가르기, 시각표기, 크기표기, 출처목록 } from "@/lib/program-file-types"
import type { 사업파일, 서류함스코프, 보류증빙 } from "@/lib/program-file-types"

/**
 * **지원사업 증빙 서류함** — 사업마다 흩어져 들어간 증빙을 한 화면에 모아 놓는다.
 * (2026-09-04 사용자 지시: "각 지원사업에 넣은 폴더를 한눈에 보기 쉽게 정리 … 한번에 모아서
 *  다운 및 특정 기간을 지정해 볼 수 있으면", 이어서 "지원사업 관리에 있는 사업만")
 *
 * 담기는 것은 **지원사업 관리 목록에 있는 사업뿐**이다(거르는 일은 조회 계층이 한다).
 *
 * 이 화면은 **보고 받는 곳**이지 올리는 곳이 아니다. 올리는 자리는 그대로 둔다 —
 * 계상 증빙은 비목 옆에서, 집행 증빙은 사용 건 옆에서, 정산 서류는 정산 탭에서 붙인다.
 * **놓는 자리가 곧 서류종류**라서 그렇다. 여기서 또 받으면 「무엇에 붙은 파일인가」가 사라진다.
 *
 * 기간은 **올린 시각** 기준이다(집행일·제출일이 아니다 — 파일마다 뜻이 달라 한 축으로 못 묶는다).
 * 그 말을 화면에도 적어 둔다. 안 적으면 「9월분만 봤는데 왜 8월 영수증이 나오나」가 된다.
 */

const 모든출처 = "출처 전체"

/**
 * 서류 한 줄. 사업 묶음 안에 낱개로도, 지출 묶음을 펼친 안쪽에도 쓴다.
 * 출처 배지는 늘 찍는다 — 지출 묶음 안에 계상 증빙·집행 증빙이 섞일 수 있어서
 * (같은 거래를 계상 탭에서도 집행 탭에서도 각자 증빙을 붙일 수 있다), 부모 줄의
 * "지출" 표만으로는 이 파일이 어느 쪽에서 왔는지 알 수 없다.
 */
function 파일줄({ f }: { f: 사업파일 }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[14.1px]">
      <span className="w-[68px] shrink-0 rounded bg-muted px-1.5 py-0.5 text-center text-[12.1px] text-muted-foreground">
        {f.출처.replace(" 증빙", "").replace(" 서류", "")}
      </span>
      <a
        href={`/api/program-files/one?key=${encodeURIComponent(f.키)}`}
        className="min-w-0 flex-1 truncate hover:underline"
        title={f.파일명}
      >
        {f.파일명}
      </a>
      <span className="shrink-0 text-muted-foreground">{f.분류}</span>
      <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
        {크기표기(f.크기)}
      </span>
      <span className="w-[104px] shrink-0 text-right tabular-nums text-muted-foreground">
        {시각표기(f.일시)}
      </span>
    </div>
  )
}

export function ProgramFiles({
  파일,
  보류,
  스코프,
}: {
  파일: 사업파일[]
  /** 집행엔 붙어 있는데 아직 실물이 없어 못 담은 증빙. 빈 배열이면 아무것도 안 그린다. */
  보류: 보류증빙[]
  스코프: 서류함스코프
}) {
  const [검색, set검색] = React.useState("")
  const [출처, set출처] = React.useState<string>(모든출처)
  const [프리셋, set프리셋] = React.useState<string>(기간_전체)
  const [시작, set시작] = React.useState("")
  const [끝, set끝] = React.useState("")
  const [펼침, set펼침] = React.useState<Record<number, boolean>>({})
  // 지출(집행 건) 단위 펼침 — **기본은 접힘**이다(2026-09-04 사용자 지시: "지출 하나만
  // 보이고 마우스로 누르면 펼쳐서 볼 수 있게"). 사업 묶음은 기본이 펼침인 것과 반대다 —
  // 사업은 몇 개 안 되지만 지출은 과제 하나에 수십 건씩 쌓일 수 있어 다 펼치면 도로 복잡해진다.
  const [지출펼침, set지출펼침] = React.useState<Record<number, boolean>>({})

  // 프리셋과 직접 입력은 **같은 규칙**으로 합친다(과제·지원사업 대장과 같은 모듈).
  const 범위 = React.useMemo(() => 범위정하기(프리셋, 시작, 끝), [프리셋, 시작, 끝])

  const 걸린것 = React.useMemo(() => {
    const q = 검색.trim().toLowerCase()
    return 파일.filter((f) => {
      if (출처 !== 모든출처 && f.출처 !== 출처) return false
      if (범위) {
        const d = String(f.일시).slice(0, 10)
        if (d < 범위.시작 || d > 범위.끝) return false
      }
      if (!q) return true
      return (
        f.파일명.toLowerCase().includes(q) ||
        f.과제명.toLowerCase().includes(q) ||
        f.분류.toLowerCase().includes(q)
      )
    })
  }, [파일, 검색, 출처, 범위])

  const 묶음 = React.useMemo(() => 묶기(걸린것), [걸린것])
  const 총크기 = 걸린것.reduce((s, f) => s + (f.크기 ?? 0), 0)

  const 필터걸림 = !!검색.trim() || 출처 !== 모든출처 || 프리셋 !== 기간_전체 || !!시작 || !!끝

  function 초기화() {
    set검색("")
    set출처(모든출처)
    set프리셋(기간_전체)
    set시작("")
    set끝("")
  }

  /** 화면에 걸어 둔 조건을 그대로 zip 주소에 싣는다 — 보는 것과 받는 것이 어긋나면 안 된다. */
  function zip주소(과제_id?: number) {
    const p = new URLSearchParams()
    // 어느 서류함인지 반드시 싣는다 — 두 서류함이 zip 라우트 하나를 같이 쓴다.
    p.set("scope", 스코프)
    if (범위) {
      p.set("from", 범위.시작)
      p.set("to", 범위.끝)
    }
    if (출처 !== 모든출처) p.set("sources", 출처)
    if (과제_id != null) p.set("project", String(과제_id))
    const qs = p.toString()
    return `/api/program-files/zip${qs ? `?${qs}` : ""}`
  }

  return (
    <div className="space-y-3">
      {/* 거르는 줄 — 지원사업 대장·과제 대장과 같은 모양으로 둔다. 나란히 쓰는 화면끼리
          조작법이 다르면 매번 다시 익혀야 한다. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={검색}
          onChange={(e) => set검색(e.target.value)}
          placeholder="파일명 · 사업명 · 분류"
          className="h-7 w-56 text-[14.1px]"
          aria-label="서류 검색"
        />

        <Select value={출처} onValueChange={(v) => set출처(v ?? 모든출처)}>
          <SelectTrigger size="sm" className="h-7 w-32 text-[14.1px]" aria-label="출처로 걸러내기">
            <SelectValue placeholder={모든출처} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={모든출처}>출처 전체</SelectItem>
            {출처목록.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={프리셋}
          onValueChange={(v) => {
            set프리셋(v ?? 기간_전체)
            set시작("")
            set끝("")
          }}
        >
          <SelectTrigger size="sm" className="h-7 w-32 text-[14.1px]" aria-label="기간 프리셋">
            <SelectValue placeholder="기간 전체" />
          </SelectTrigger>
          <SelectContent>
            {기간프리셋.map((p) => (
              <SelectItem key={p.v} value={p.v}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={시작}
          onChange={(e) => set시작(e.target.value)}
          className="h-7 w-[132px] text-[14.1px]"
          aria-label="기간 시작"
        />
        <span className="text-xs text-muted-foreground">~</span>
        <Input
          type="date"
          value={끝}
          onChange={(e) => set끝(e.target.value)}
          className="h-7 w-[132px] text-[14.1px]"
          aria-label="기간 끝"
        />

        <span className="text-xs tabular-nums text-muted-foreground">
          {걸린것.length}건 · {크기표기(총크기)}
        </span>

        {필터걸림 && (
          <Button variant="ghost" size="sm" className="h-7 text-[14.1px]" onClick={초기화}>
            초기화
          </Button>
        )}

        <div className="ml-auto">
          <Button
            size="sm"
            className="h-7 text-[14.1px]"
            disabled={걸린것.length === 0}
            // 라우트 핸들러가 zip 을 흘려보낸다. fetch 로 받아 Blob 을 만들지 않는다 —
            // 서류가 많으면 통째로 메모리에 올라간다.
            onClick={() => {
              window.location.href = zip주소()
            }}
          >
            모두 내려받기 ({걸린것.length})
          </Button>
        </div>
      </div>

      {/* **못 담은 것을 못 담았다고 말한다.** 조용히 빼면 「집행엔 있는데 서류함엔 없다」가
          되고, 사람은 시스템이 파일을 잃었다고 생각한다(실제로 그 질문이 나왔다).
          거르기와 무관하게 늘 보인다 — 기간을 좁혔다고 없던 일이 되지 않는다. */}
      {보류.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[14.1px] dark:border-amber-900/60 dark:bg-amber-950/30">
          <p>
            <b>아직 안 담긴 증빙 {보류.length}건</b> — 「검토대기」라 파일이 저장소에 올라가기
            전이다. 집행 탭에서 확정하면 여기 들어온다.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {보류.map((b) => (
              <li key={`${b.집행_id}:${b.파일명}`} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{b.과제명}</span>
                <span className="truncate">{b.파일명}</span>
                <a
                  href={`/projects/${b.과제_id}/expenses`}
                  className="text-muted-foreground underline hover:no-underline"
                >
                  집행 #{b.집행_id} 열기
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 기간의 뜻을 적어 둔다. 안 적으면 「9월만 봤는데 왜 8월 영수증이 나오나」가 된다. */}
      <p className="text-xs text-muted-foreground">
        기간은 <b>파일을 올린 날</b> 기준이다(집행일·제출일이 아니다). 압축을 풀면 사업명 폴더
        안에 들어 있다.
      </p>

      {묶음.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {파일.length === 0
            ? "지원사업에 올라온 증빙이 아직 없다. 계상 증빙은 연구비 계상 탭에서, 집행 증빙은 집행 탭에서, 정산 서류는 정산 탭에서 붙인다."
            : "그 조건에 걸리는 서류가 없다."}
        </p>
      ) : (
        <div className="space-y-2">
          {묶음.map((g) => {
            const 열림 = 펼침[g.과제_id] ?? true
            return (
              <div key={g.과제_id} className="rounded-lg border">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                  <button
                    type="button"
                    className="text-[14.3px] font-medium hover:underline"
                    aria-expanded={열림}
                    onClick={() => set펼침((p) => ({ ...p, [g.과제_id]: !열림 }))}
                  >
                    {열림 ? "▾" : "▸"} {g.과제명}
                  </button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {g.파일.length}건 · {크기표기(g.합계크기)}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <a
                      href={`/projects/${g.과제_id}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      사업 열기
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[14.1px]"
                      onClick={() => {
                        window.location.href = zip주소(g.과제_id)
                      }}
                    >
                      이 사업만 받기
                    </Button>
                  </div>
                </div>

                {열림 && (() => {
                  const { 낱개, 지출들 } = 지출별로가르기(g.파일)
                  return (
                    <ul className="divide-y">
                      {/* 정산 서류(항상) · 계상 증빙 중 집행_id 가 없는 것 — 지출에 못 묶인
                          낱개는 예전처럼 그대로 보여준다. */}
                      {낱개.map((f) => (
                        <li key={f.키}>
                          <파일줄 f={f} />
                        </li>
                      ))}
                      {/* 지출(거래 건) 하나로 접는다 — 계상 증빙(검수조서·세금계산서 등)과
                          집행 증빙이 **같은 거래**면 여기서 합쳐진다(2026-09-04 사용자 지적:
                          "같은 지출에 대한 지출증빙이잖아 이걸 지출명으로 잡아서 파일을 합쳐서").
                          한 묶음 안에 출처가 섞일 수 있어 각 줄에 계상/집행 표를 그대로 둔다. */}
                      {지출들.map((e) => {
                        const 지출열림 = 지출펼침[e.지출_id] ?? false
                        return (
                          <li key={`지출:${e.지출_id}`}>
                            <button
                              type="button"
                              aria-expanded={지출열림}
                              onClick={() => set지출펼침((p) => ({ ...p, [e.지출_id]: !지출열림 }))}
                              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-left text-[14.1px] hover:bg-muted/40"
                            >
                              <span className="w-[68px] shrink-0 rounded bg-muted px-1.5 py-0.5 text-center text-[12.1px] text-muted-foreground">
                                지출
                              </span>
                              <span className="w-3 shrink-0 text-muted-foreground">
                                {지출열림 ? "▾" : "▸"}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {e.거래처 ?? "거래처 미상"}
                                <span className="ml-1.5 text-muted-foreground">
                                  파일 {e.파일.length}건
                                </span>
                              </span>
                              {/* 어떤 비목으로 쓴 돈인가 — 접힌 채로 보여야 한다
                                  (2026-09-04 사용자 지시). 펼쳐서 파일마다 붙은 분류를
                                  읽게 하면, 정산 때 제일 먼저 묻는 것을 제일 늦게 알게 된다.
                                  세부항목이 없으면 대분류만 온다(조회에서 정한다). */}
                              {e.비목 && (
                                <span className="hidden shrink-0 truncate text-[12.8px] text-muted-foreground sm:inline">
                                  {e.비목}
                                </span>
                              )}
                              {e.합계 != null && (
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {e.합계.toLocaleString("ko-KR")}원
                                </span>
                              )}
                              <span className="w-[104px] shrink-0 text-right tabular-nums text-muted-foreground">
                                {e.일자 ?? "—"}
                              </span>
                            </button>
                            {지출열림 && (
                              <ul className="divide-y bg-muted/20 pl-[42px]">
                                {e.파일.map((f) => (
                                  <li key={f.키}>
                                    <파일줄 f={f} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
