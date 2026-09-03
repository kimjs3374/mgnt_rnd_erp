"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useFileDrop, 드롭강조 } from "@/components/use-file-drop"
import type { 드롭영역만들기 } from "@/components/use-file-drop"
import { 문서파일_점검 } from "@/lib/upload-limits"
import {
  uploadRuleDocuments,
  getRuleDownloadUrl,
  deleteRuleDocument,
} from "@/app/actions/rule-files"
import { 문서종류_후보 } from "@/lib/rule-types"
import type { RuleDocument, 적용범위, 공고선택지, 사업유형선택지 } from "@/lib/rule-types"

/**
 * 규정·공고 원문 문서함.
 *
 * **규정은 사업마다 다르다.** 정부출연금 비율도 연구수당 한도도 「어느 공고냐 · 어느 사업유형이냐」로
 * 갈린다 — 실측으로 2026 공고는 중소기업 75% 이내인데 수행 중인 과제는 97.8% 였고 **둘 다 맞다.**
 * 그래서 규정 파일도 규칙과 **같은 축**에 매단다: 공고 > 사업유형 > 공통
 * (`app.funding_share_rules` 의 우선순위와 같다 — `db/98` 참조).
 *
 * 축을 맞춰야 「이 과제에 적용되는 규정」을 한 번에 모을 수 있다. 규칙 행은 이미 쪽수로 인용하고
 * 있는데(`p.31 정부지원 비율표`), 그 쪽수가 가리키는 **원본이 여기 있어야** 근거를 화면에서 연다.
 *
 * 증빙 첨부와 마찬가지로 **놓는 자리가 곧 분류다** — 사업유형 카드에 놓으면 그 유형 전체 규정으로,
 * 공고 카드에 놓으면 그 공고에만 적용되는 규정으로 들어간다.
 */

const KB = (n: number | null) =>
  n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`

/** ISO → `09-03 20:40` (KST). 서버·클라이언트가 같은 값을 내야 하므로 직접 계산한다. */
function 시각(iso: string) {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

/** 업로드 대상 한 자리. 카드에 놓든 폼에서 고르든 결국 이 셋 중 하나로 정해진다. */
type 대상 = { 적용범위: 적용범위; announcement_id: number | null; 사업유형: string | null }

export function RuleDocuments({
  문서,
  공고들,
  사업유형들,
  로그인,
}: {
  문서: RuleDocument[]
  공고들: 공고선택지[]
  사업유형들: 사업유형선택지[]
  로그인: boolean
}) {
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = React.useTransition()
  const { 드롭대상, 드롭영역 } = useFileDrop({ 거부됨: (사유) => setMsg({ ok: false, text: 사유 }) })

  // 폼 — 메타는 한 벌만 받는다. 카드에 바로 놓을 때도 이 값이 함께 붙는다.
  const [범위, set범위] = React.useState<적용범위>("사업유형")
  const [공고id, set공고id] = React.useState<string>("")
  const [유형코드, set유형코드] = React.useState<string>(사업유형들[0]?.코드 ?? "")
  const [문서종류, set문서종류] = React.useState("공고문")
  const [제목, set제목] = React.useState("")
  const [발행기관, set발행기관] = React.useState("")
  const [발행일, set발행일] = React.useState("")
  const [버전, set버전] = React.useState("")
  const [근거메모, set근거메모] = React.useState("")

  const 폼대상: 대상 =
    범위 === "공고"
      ? { 적용범위: "공고", announcement_id: 공고id ? Number(공고id) : null, 사업유형: null }
      : 범위 === "사업유형"
        ? { 적용범위: "사업유형", announcement_id: null, 사업유형: 유형코드 || null }
        : { 적용범위: "공통", announcement_id: null, 사업유형: null }

  function 올리기(대상: 대상, files: File[]) {
    const 고른것 = files.filter(Boolean)
    if (!고른것.length) return
    if (pending) {
      setMsg({ ok: false, text: "앞의 파일을 올리는 중입니다. 끝난 뒤에 놓으세요." })
      return
    }
    if (대상.적용범위 === "공고" && !대상.announcement_id) {
      setMsg({ ok: false, text: "어느 공고의 규정인지 먼저 고르세요." })
      return
    }
    if (대상.적용범위 === "사업유형" && !대상.사업유형) {
      setMsg({ ok: false, text: "어느 사업유형의 규정인지 먼저 고르세요." })
      return
    }

    // 서버가 최종 판정자지만 여기서 먼저 거른다 — 25MB 짜리를 끝까지 올려보낸 뒤 거절하면
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

    setMsg(null)
    const fd = new FormData()
    fd.set("적용범위", 대상.적용범위)
    if (대상.announcement_id) fd.set("announcement_id", String(대상.announcement_id))
    if (대상.사업유형) fd.set("사업유형", 대상.사업유형)
    fd.set("문서종류", 문서종류)
    fd.set("제목", 제목)
    fd.set("발행기관", 발행기관)
    fd.set("발행일", 발행일)
    fd.set("버전", 버전)
    fd.set("근거메모", 근거메모)
    for (const f of 보낼것) fd.append("files", f)

    start(async () => {
      const r = await uploadRuleDocuments(fd)
      const 앞 = 거절.length ? `${거절.join(" / ")} · ` : ""
      if (r.ok && !r.error && !거절.length) {
        setMsg({ ok: true, text: `${r.올린수 ?? 보낼것.length}건 올렸습니다.` })
        // 메타는 한 벌짜리라 올리고 나면 비운다. 남겨 두면 다음 파일에 엉뚱한 제목이 붙는다.
        set제목("")
        set근거메모("")
      } else {
        setMsg({ ok: false, text: 앞 + (r.error ?? "올리지 못했습니다.") })
      }
    })
  }

  function 내려받기(id: number) {
    setMsg(null)
    start(async () => {
      const r = await getRuleDownloadUrl(id)
      if (r.ok && r.url) window.open(r.url, "_blank", "noopener")
      else setMsg({ ok: false, text: r.error ?? "내려받지 못했습니다." })
    })
  }

  function 지우기(id: number, 이름: string) {
    setMsg(null)
    start(async () => {
      const r = await deleteRuleDocument(id)
      setMsg(
        r.ok
          ? { ok: true, text: `${이름} 지웠습니다.` }
          : { ok: false, text: r.error ?? "지우지 못했습니다." },
      )
    })
  }

  const 공고이름 = new Map(공고들.map((a) => [a.id, a.사업명]))
  const 유형이름 = new Map(사업유형들.map((s) => [s.코드, s.이름]))

  // 규정이 붙어 있는 공고 + 지금 폼에서 고른 공고. 고른 공고 카드가 바로 떠야 거기에 놓을 수 있다.
  const 공고묶음 = Array.from(
    new Set([
      ...문서.filter((d) => d.적용범위 === "공고" && d.announcement_id).map((d) => d.announcement_id as number),
      ...(범위 === "공고" && 공고id ? [Number(공고id)] : []),
    ]),
  )

  return (
    <div className="flex flex-col gap-4">
      {/* ── 올리기 ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <span className="text-[13px] font-medium">규정 올리기</span>
          <span className="text-xs text-muted-foreground">
            적용 범위를 고르고 파일을 끌어다 놓으세요. 아래 카드에 바로 놓아도 됩니다.
          </span>
          {!로그인 && (
            <span className="rounded px-1.5 py-0.5 text-[11px] text-[var(--warning-fg)]">
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          {(["공고", "사업유형", "공통"] as 적용범위[]).map((v) => (
            <Button
              key={v}
              type="button"
              variant={범위 === v ? "default" : "outline"}
              className="h-7 text-[12.5px]"
              onClick={() => set범위(v)}
            >
              {v === "공고" ? "이 공고만" : v === "사업유형" ? "사업유형 전체" : "공통(모든 사업)"}
            </Button>
          ))}

          {범위 === "공고" && (
            <select
              className="h-7 min-w-[280px] max-w-[520px] rounded-md border bg-background px-2 text-[12.5px]"
              value={공고id}
              onChange={(e) => set공고id(e.target.value)}
            >
              <option value="">공고를 고르세요…</option>
              {공고들.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.공고일 ? `${a.공고일} · ` : ""}
                  {a.사업명}
                  {a.소관부처 ? ` (${a.소관부처})` : ""}
                </option>
              ))}
            </select>
          )}
          {범위 === "사업유형" && (
            <select
              className="h-7 rounded-md border bg-background px-2 text-[12.5px]"
              value={유형코드}
              onChange={(e) => set유형코드(e.target.value)}
            >
              {사업유형들.map((s) => (
                <option key={s.코드} value={s.코드}>
                  {s.이름}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            문서종류
            <Input
              list="규정_문서종류"
              className="h-7 text-[12.5px]"
              value={문서종류}
              onChange={(e) => set문서종류(e.target.value)}
              placeholder="공고문 · 관리지침 · 서식…"
            />
            {/* 후보는 제안일 뿐이다. 사업마다 서류 이름이 달라서 목록 밖 값을 막지 않는다. */}
            <datalist id="규정_문서종류">
              {문서종류_후보.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            제목 <span className="text-[10.5px]">(비우면 파일명을 그대로 씁니다)</span>
            <Input
              className="h-7 text-[12.5px]"
              value={제목}
              onChange={(e) => set제목(e.target.value)}
              placeholder="(제2026-57호) 신청 방법 및 유의사항"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            발행기관
            <Input
              className="h-7 text-[12.5px]"
              value={발행기관}
              onChange={(e) => set발행기관(e.target.value)}
              placeholder="중소벤처기업부 · 과기정통부…"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            발행일
            <Input
              type="date"
              className="h-7 text-[12.5px]"
              value={발행일}
              onChange={(e) => set발행일(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            버전·고시번호
            <Input
              className="h-7 text-[12.5px]"
              value={버전}
              onChange={(e) => set버전(e.target.value)}
              placeholder="과기부고시 제2025-9호"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
            근거메모 <span className="text-[10.5px]">(어디를 인용하는지)</span>
            <Input
              className="h-7 text-[12.5px]"
              value={근거메모}
              onChange={(e) => set근거메모(e.target.value)}
              placeholder="p.31 정부지원 비율표 · p.18 연구수당 20%"
            />
          </label>
        </div>

        {/* 폼 드롭존 — 위에서 고른 범위로 들어간다. */}
        <div
          {...드롭영역("폼", (files) => 올리기(폼대상, files))}
          className={
            "mt-3 flex flex-wrap items-center justify-center gap-2 rounded-md border border-dashed p-4 text-[12.5px] text-muted-foreground transition-colors " +
            (드롭대상 === "폼" ? 드롭강조.받음 : "")
          }
        >
          <span>
            여기에 파일을 끌어다 놓으면{" "}
            <b className="text-foreground">
              {폼대상.적용범위 === "공고"
                ? 공고id
                  ? `「${공고이름.get(Number(공고id)) ?? `공고 ${공고id}`}」 전용`
                  : "선택한 공고 전용"
                : 폼대상.적용범위 === "사업유형"
                  ? `「${유형이름.get(유형코드) ?? 유형코드}」 전체`
                  : "모든 사업 공통"}
            </b>{" "}
            규정으로 들어갑니다
          </span>
          <label className="cursor-pointer rounded-md border px-2 py-0.5 hover:bg-secondary/60">
            파일 고르기
            <input
              type="file"
              multiple
              className="hidden"
              disabled={pending}
              onChange={(e) => {
                올리기(폼대상, Array.from(e.target.files ?? []))
                e.target.value = ""
              }}
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {pending && <span className="text-[12.5px] text-muted-foreground">올리는 중…</span>}
          {msg && (
            <span className={msg.ok ? "text-[12.5px] text-muted-foreground" : "text-[12.5px] text-destructive"}>
              {msg.text}
            </span>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            pdf·hwp·xlsx·이미지·zip · 25MB 까지 · 비공개 버킷에 저장되고 다운로드는 60초 서명 주소로 나간다
          </span>
        </div>
      </div>

      {/* ── 사업유형 전체 ───────────────────────────────────────────────── */}
      <RuleGroup
        제목="사업유형별 규정"
        설명="그 유형의 모든 사업에 적용된다. 공고에 따로 정한 것이 있으면 공고가 이긴다."
        카드={사업유형들.map((s) => ({
          키: `유형:${s.코드}`,
          이름: s.이름,
          대상: { 적용범위: "사업유형" as 적용범위, announcement_id: null, 사업유형: s.코드 },
          파일: 문서.filter((d) => d.적용범위 === "사업유형" && d.사업유형 === s.코드),
        }))}
        {...{ 드롭대상, 드롭영역, 올리기, 내려받기, 지우기, pending }}
      />

      {/* ── 공고 ────────────────────────────────────────────────────────── */}
      <RuleGroup
        제목="공고별 규정"
        설명="그 공고에만 적용된다. 우선순위가 가장 높다 — 같은 항목이 겹치면 공고를 따른다."
        비었을때="아직 공고에 붙은 규정이 없습니다. 위에서 「이 공고만」을 고르고 공고를 지정하면 여기 카드가 생깁니다."
        카드={공고묶음.map((id) => ({
          키: `공고:${id}`,
          이름: 공고이름.get(id) ?? `공고 ${id}`,
          대상: { 적용범위: "공고" as 적용범위, announcement_id: id, 사업유형: null },
          파일: 문서.filter((d) => d.적용범위 === "공고" && d.announcement_id === id),
        }))}
        {...{ 드롭대상, 드롭영역, 올리기, 내려받기, 지우기, pending }}
      />

      {/* ── 공통 ────────────────────────────────────────────────────────── */}
      <RuleGroup
        제목="공통 규정"
        설명="사업을 가리지 않고 걸리는 상위 법령·고시. 우선순위가 가장 낮다 — 위에서 정한 것이 없을 때만 쓴다."
        카드={[
          {
            키: "공통",
            이름: "모든 사업 공통",
            대상: { 적용범위: "공통" as 적용범위, announcement_id: null, 사업유형: null },
            파일: 문서.filter((d) => d.적용범위 === "공통"),
          },
        ]}
        {...{ 드롭대상, 드롭영역, 올리기, 내려받기, 지우기, pending }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------------- */

type 카드 = { 키: string; 이름: string; 대상: 대상; 파일: RuleDocument[] }

/**
 * 범위 하나(사업유형별·공고별·공통)의 카드 묶음.
 *
 * ⚠ 컴포넌트 이름을 한글로 짓지 않는다 — JSX 태그 이름 판정이 소문자 ASCII 기준이라
 *   한글 이름은 변환기에 따라 내장 태그로 읽힐 수 있다. 변수·필드는 한글 그대로 쓴다.
 */
function RuleGroup({
  제목,
  설명,
  비었을때,
  카드,
  드롭대상,
  드롭영역,
  올리기,
  내려받기,
  지우기,
  pending,
}: {
  제목: string
  설명: string
  비었을때?: string
  카드: 카드[]
  드롭대상: string | null
  드롭영역: 드롭영역만들기
  올리기: (대상: 대상, files: File[]) => void
  내려받기: (id: number) => void
  지우기: (id: number, 이름: string) => void
  pending: boolean
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-medium">{제목}</span>
        <span className="text-[11.5px] text-muted-foreground">{설명}</span>
      </div>

      {카드.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">{비었을때 ?? "없습니다."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {카드.map((c) => (
            <div
              key={c.키}
              {...드롭영역(c.키, (files: File[]) => 올리기(c.대상, files))}
              className={
                "rounded-md border transition-colors " + (드롭대상 === c.키 ? 드롭강조.카드 : "")
              }
            >
              <div className="flex flex-wrap items-baseline gap-2 border-b bg-secondary/30 px-3 py-2">
                <span className="text-[12.5px] font-medium">{c.이름}</span>
                <span className="text-[11.5px] text-muted-foreground">{c.파일.length}건</span>
                {드롭대상 === c.키 && (
                  <span className="ml-auto text-[11.5px] text-primary">
                    놓으면 여기 규정으로 들어갑니다
                  </span>
                )}
              </div>

              {c.파일.length === 0 ? (
                <p className="px-3 py-2 text-[11.5px] text-muted-foreground">
                  아직 없습니다. 파일을 여기에 끌어다 놓으세요.
                </p>
              ) : (
                <ul className="divide-y">
                  {c.파일.map((d) => (
                    <li key={d.id} className="px-3 py-2 text-[12.5px]">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="rounded bg-secondary px-1 py-0.5 text-[10.5px]">
                          {d.문서종류}
                        </span>
                        <span className="font-medium">{d.제목}</span>
                        <span className="text-[11.5px] text-muted-foreground">{d.파일명}</span>
                        <span className="tabular-nums text-[11.5px] text-muted-foreground">
                          {KB(d.크기)}
                        </span>
                        <button
                          type="button"
                          className="ml-auto text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          disabled={pending}
                          onClick={() => 내려받기(d.id)}
                        >
                          다운로드
                        </button>
                        <button
                          type="button"
                          className="text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-destructive"
                          disabled={pending}
                          onClick={() => 지우기(d.id, d.파일명)}
                        >
                          삭제
                        </button>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        {d.발행기관 && <span>{d.발행기관}</span>}
                        {d.발행일 && <span className="tabular-nums">{d.발행일}</span>}
                        {d.버전 && <span>{d.버전}</span>}
                        {d.근거메모 && <span className="text-foreground">근거: {d.근거메모}</span>}
                        <span className="ml-auto tabular-nums">{시각(d.업로드일시)}</span>
                        <span>{d.업로더}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
