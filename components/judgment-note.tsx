"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Sparkles, Search, PenLine, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  submitJudgmentComment,
  findSimilarJudgments,
  getJudgmentHistory,
  type SimilarJudgment,
  type JudgmentHistoryRow,
  type 판정값,
} from "@/app/actions/judgment"

/**
 * 판정 근거 문장 + 코멘트를 의미 학습에 남긴다 — LLM 을 부르지 않는다(로컬 임베딩,
 * bot/semantic_learn.py). EligibilityConfirm(가능/불가/확인필요 확정)과는 다른 층 —
 * 저건 "이 공고의 최종 판정"을 남기고, 이건 "왜 그렇게 판단했는지 그 문장"을 쌓아
 * **다음 공고에서 문구가 달라도 뜻이 비슷하면** 참고 사례로 찾아지게 한다.
 *
 * ⚠ 임베딩 호출은 몇 초 걸릴 수 있다(격리된 venv, 모델을 매번 새로 올린다) — 자동으로
 *   부르지 않는다. "비슷한 사례" 조회도 사람이 눌러야 시작한다.
 *
 * ⚠ "이 공고에 남긴 이력"(아래)은 다르다 — 임베딩을 계산하지 않는 단순 DB 조회라
 *   느릴 이유가 없다. 사용자 지적(2026-09-04): "왜 이력 남긴거 확인이 안되냐
 *   확인할수 있어야지?" — 저장은 되는데 화면에 다시 보여주는 데가 없었다. 그래서
 *   이건 마운트 시 자동으로 부른다(judgment/history, announcement_id 정확 필터 —
 *   비슷한 사례처럼 유사도 문턱을 못 넘어 누락되는 일이 없다).
 *
 * ⚠ 판정을 저장하면 공고 상단의 확정 판정(EligibilityConfirm 배지 + 목록/상세의
 *   자격판정 히어로 패널)도 같이 바뀐다(app/actions/judgment.ts 의 확정판정동기화,
 *   2026-09-04). 사용자 지적: "판정근거 남기면 그대로 판정되서 상태변경되는게
 *   맞지않을까?" — 맞는 말이라 연결했다. "해당없음"(행사·교육 등 지원사업 자체가
 *   아닌 공고)도 5종 전부 동기화 대상이다 — 처음엔 뺐다가, 실사용(공고 517)에서
 *   그 공고만 계속 "확인필요"로 남는 게 확인돼(사용자 지적: "브라우저에서 517
 *   다시 확인해봐 아직도 확인필요임") lib/queries.ts 의 판정계산()에 "해당없음"을
 *   5번째 등급으로 추가하고 동기화도 뚫었다.
 */
const 판정_선택지: { v: 판정값; label: string }[] = [
  { v: "가능", label: "가능" },
  { v: "불가", label: "불가" },
  { v: "확인필요", label: "확인필요" },
  { v: "요건미확인", label: "요건미확인" },
  { v: "해당없음", label: "해당없음(행사·교육 등)" },
]

function 유사도색(sim: number): string {
  if (sim >= 0.6) return "text-[var(--success-fg)]"
  if (sim >= 0.45) return "text-foreground"
  return "text-muted-foreground"
}

function 날짜표시(iso: string): string {
  return iso.slice(0, 10)
}

function 판정색(v: string): string {
  if (v === "가능") return "text-[var(--success-fg)]"
  if (v === "불가") return "text-destructive"
  return "text-foreground"
}

function 저장결과메시지(판정: 판정값, synced?: boolean, warning?: string): string {
  if (synced) {
    return `저장됐다 — 공고 상단의 확정 판정도 "${판정}"(으)로 반영됐다.`
  }
  return `의미 학습엔 저장됐지만 확정 판정 반영은 실패했다${warning ? `: ${warning}` : ""} — 위에서 직접 확인해달라.`
}

export function JudgmentNote({
  announcementId,
  검색기본질의,
}: {
  announcementId: number
  /** "비슷한 사례" 버튼을 처음 누를 때 검색어로 쓸 기본값(보통 사업명+요약 앞부분). */
  검색기본질의?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [텍스트, set텍스트] = React.useState("")
  const [판정, set판정] = React.useState<판정값>("불가")
  const [특징키, set특징키] = React.useState("")
  const [사유, set사유] = React.useState("")
  const [pending, start] = React.useTransition()
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)

  const [사례, set사례] = React.useState<SimilarJudgment[] | null>(null)
  const [사례로딩, set사례로딩] = React.useState(false)
  const [사례오류, set사례오류] = React.useState<string | null>(null)

  const [이력, set이력] = React.useState<JudgmentHistoryRow[] | null>(null)
  const [이력로딩, set이력로딩] = React.useState(true)
  const [이력오류, set이력오류] = React.useState<string | null>(null)

  const 이력불러오기 = React.useCallback(() => {
    set이력로딩(true)
    set이력오류(null)
    getJudgmentHistory(announcementId).then((r) => {
      set이력로딩(false)
      if (!r.ok) {
        set이력오류(r.error ?? "이력 조회 실패")
        return
      }
      set이력(r.rows)
    })
  }, [announcementId])

  React.useEffect(() => {
    이력불러오기()
  }, [이력불러오기])

  const 사례찾기 = (질의: string) =>
    start(async () => {
      set사례로딩(true)
      set사례오류(null)
      const r = await findSimilarJudgments(질의)
      set사례로딩(false)
      if (!r.ok) {
        set사례오류(r.error ?? "검색 실패 — 임베딩 서버(venv-embed)가 떠 있는지 확인")
        return
      }
      set사례(r.matches)
    })

  const 제출 = () =>
    start(async () => {
      const r = await submitJudgmentComment({
        announcementId,
        텍스트,
        판정,
        특징키: 특징키 || undefined,
        사유: 사유 || undefined,
      })
      if (r.ok) {
        setMsg({ ok: true, text: 저장결과메시지(판정, r.decisionSynced, r.decisionWarning) })
        setOpen(false)
        set텍스트("")
        set특징키("")
        set사유("")
        이력불러오기()
        if (r.decisionSynced) router.refresh() // 위 확정 판정 배지도 새로 읽어온다
      } else {
        setMsg({ ok: false, text: r.error ?? "저장 실패" })
      }
    })

  return (
    <div className="rounded-lg bg-background/60 p-3.5 text-[14.3px]">
      <div className="flex items-center gap-1.5 font-semibold">
        <History className="size-4" />
        이 공고에 남긴 이력
        {이력 && 이력.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[12.1px] font-normal text-muted-foreground">
            {이력.length}건
          </span>
        )}
      </div>

      {이력로딩 && <p className="mt-2 text-xs text-muted-foreground">불러오는 중…</p>}
      {이력오류 && (
        <p className="mt-2 text-xs text-destructive">
          {이력오류}{" "}
          <button type="button" className="underline" onClick={이력불러오기}>
            다시 시도
          </button>
        </p>
      )}
      {이력 && !이력로딩 && (
        <div className="mt-2">
          {이력.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              이 공고에는 아직 남긴 판정 근거가 없다 — 아래 "판정 근거 남기기"로 첫 이력을 남긴다.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {이력.map((h) => (
                <li key={h.id} className="rounded-md border bg-card p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-semibold ${판정색(h.판정)}`}>{h.판정}</span>
                    <span className="text-[12.1px] text-muted-foreground">
                      {h.답변자} · {날짜표시(h.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">"{h.텍스트}"</p>
                  {h.사유 && <p className="mt-0.5 text-[13.2px]">{h.사유}</p>}
                  {h.특징키 && (
                    <p className="mt-0.5 text-[12.1px] text-muted-foreground">{h.특징키}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex items-center gap-1.5 font-semibold">
          <Sparkles className="size-4" />
          의미로 찾는 과거 판정 사례
        </div>
        <div className="flex gap-2">
          {!open && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={pending}
              onClick={() => 사례찾기(검색기본질의 ?? "")}
            >
              <Search className="size-3.5" />
              비슷한 사례 찾기
            </Button>
          )}
          {!open && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => setOpen(true)}
            >
              <PenLine className="size-3.5" />
              판정 근거 남기기
            </Button>
          )}
        </div>
      </div>

      {사례로딩 && (
        <p className="mt-2 text-xs text-muted-foreground">
          찾는 중… (임베딩 모델을 새로 올리는 중이면 몇 초 걸린다)
        </p>
      )}
      {사례오류 && <p className="mt-2 text-xs text-destructive">{사례오류}</p>}
      {사례 && !사례로딩 && (
        <div className="mt-2">
          {사례.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              뜻이 비슷한 과거 사례가 아직 없다 — 아래에서 판정 근거를 남기면 다음부터 쌓인다.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {사례.map((m) => (
                <li key={m.id} className="rounded-md border bg-card p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{m.판정}</span>
                    <span className={`font-mono text-[12.1px] ${유사도색(m.유사도)}`}>
                      유사도 {m.유사도.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">"{m.텍스트}"</p>
                  {m.사유 && <p className="mt-0.5 text-[13.2px]">{m.사유}</p>}
                  <p className="mt-0.5 text-[12.1px] text-muted-foreground">
                    {m.답변자} · {날짜표시(m.created_at)}
                    {m.특징키 && ` · ${m.특징키}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg && (
        <p className={msg.ok ? "mt-2 text-xs font-medium text-[var(--success-fg)]" : "mt-2 text-xs font-medium text-destructive"}>
          {msg.text}
        </p>
      )}

      {open && (
        <div className="mt-3 grid gap-2.5 rounded-md border bg-card p-3 text-foreground">
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">
              판정 근거 문장 (필수 — 공고문에서 그대로 인용하거나, 판단 근거를 직접 쓴다)
            </div>
            <textarea
              className="min-h-16 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              placeholder="예: 관내에 주소를 두고 6개월 이상 영업 중인 자만 신청 가능"
              value={텍스트}
              onChange={(e) => set텍스트(e.target.value)}
            />
            <p className="mt-1 text-[12.1px] text-muted-foreground">
              판정 결과("불가") 대신, 왜 그런지 말하는 문장이어야 다음에 비슷한 문장이 나왔을 때 걸린다.
            </p>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">판정</div>
            <div className="flex flex-wrap gap-1.5">
              {판정_선택지.map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => set판정(o.v)}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-medium " +
                    (판정 === o.v ? "border-primary bg-primary text-primary-foreground" : "border-input")
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                특징키 (선택 — 예: 지역제한, 창업업력_제한)
              </div>
              <input
                type="text"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={특징키}
                onChange={(e) => set특징키(e.target.value)}
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">한 줄 메모 (선택)</div>
              <input
                type="text"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                value={사유}
                onChange={(e) => set사유(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="button" size="sm" disabled={pending || !텍스트.trim()} onClick={제출}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
