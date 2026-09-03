import type { ReactNode } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Ban,
  Download,
  FileText,
  Building2,
  Users,
  Wallet,
  Send,
  Phone,
  Tag,
  ChevronRight,
  ClipboardList,
  Sparkles,
} from "lucide-react"
import { PageShell, Card, EmptyState } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { DeadlineBadge } from "@/components/deadline-badge"
import { DbError } from "@/components/db-error"
import { Badge } from "@/components/ui/badge"
import { EligibilityConfirm } from "@/components/eligibility-confirm"
import { JudgmentNote } from "@/components/judgment-note"
import { ApplyStatus } from "@/components/apply-status"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  getAnnouncementDetail,
  getRequiredDocs,
  getRequirementJudgments,
  type AnnouncementDetailRow,
} from "@/lib/queries"

const 자격판정_라벨: Record<AnnouncementDetailRow["자격판정"], string> = {
  가능: "신청 가능",
  불가: "신청 불가",
  확인필요: "확인 필요",
  요건미확인: "요건 미확인",
  해당없음: "해당없음",
}

const 자격판정_설명: Record<AnnouncementDetailRow["자격판정"], string> = {
  요건미확인: "아직 자동 자격판정이 실행되지 않았습니다. 공고문을 직접 확인하세요.",
  확인필요: "회사 프로필과 아직 대조되지 않았거나, 대조는 됐지만 AI 확신도가 낮아 사람이 봐야 합니다.",
  가능: "회사 프로필 기준으로 신청 요건을 충족하는 것으로 판정되었습니다.",
  불가: "회사 프로필 기준으로 신청 요건에 맞지 않는 것으로 판정되었습니다.",
  해당없음: "행사·설명회 등 지원사업 자체가 아닌 것으로 확인되었습니다 — 신청 요건을 따질 대상이 아닙니다.",
}

/**
 * 판정 등급별 톤 — 배지 하나가 아니라 화면 전체의 첫인상을 맡는 자리다.
 * 2026-09-03엔 전체 배경을 색으로 칠했더니 "한눈에 뚜렷"해지긴 했지만, 그 안의 근거·확인
 * 상자까지 같은 색 위에 겹쳐 시끄러웠다(사용자 피드백 2026-09-04, "깔끔하게"). 그래서 배경은
 * 중립(흰 카드)으로 돌리고, 신호는 ① 상단 굵은 컬러 띠 ② 진한 색 원형 아이콘 배지
 * ③ 색 있는 제목 글자 ④ 도넛 게이지 색, 넷으로만 준다 — 배경 전체를 칠하지 않아도
 * 이 넷이면 등급이 한눈에 갈린다.
 */
const 자격판정_톤: Record<
  AnnouncementDetailRow["자격판정"],
  { titleClass: string; barClass: string; badgeClass: string; gaugeVar: string; icon: typeof CheckCircle2 }
> = {
  가능: {
    titleClass: "text-[var(--success-fg)]",
    barClass: "bg-[var(--success-fg)]",
    badgeClass: "bg-[var(--success-fg)] text-white",
    gaugeVar: "var(--success-fg)",
    icon: CheckCircle2,
  },
  불가: {
    titleClass: "text-destructive",
    barClass: "bg-destructive",
    badgeClass: "bg-destructive text-white",
    gaugeVar: "var(--destructive)",
    icon: XCircle,
  },
  확인필요: {
    titleClass: "text-[var(--warning-fg)]",
    barClass: "bg-[var(--warning-fg)]",
    badgeClass: "bg-[var(--warning-fg)] text-white",
    gaugeVar: "var(--warning-fg)",
    icon: AlertTriangle,
  },
  요건미확인: {
    titleClass: "text-muted-foreground",
    barClass: "bg-muted-foreground",
    badgeClass: "bg-muted-foreground text-white",
    gaugeVar: "var(--muted-foreground)",
    icon: HelpCircle,
  },
  // "확인필요"(회색·경고 아이콘, 봐야 함)와 구분한다 — 이건 "이미 봤고 볼 게 아니었음"이다.
  해당없음: {
    titleClass: "text-muted-foreground",
    barClass: "bg-muted-foreground",
    badgeClass: "bg-muted-foreground text-white",
    gaugeVar: "var(--muted-foreground)",
    icon: Ban,
  },
}

/** 점수 도넛 게이지 — 숫자+막대보다 "표시판"처럼 한눈에 읽힌다. 라이브러리 없이 순수 SVG. */
function ScoreGauge({ score, colorVar }: { score: number; colorVar: string }) {
  const r = 40
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score))
  const offset = c - (pct / 100) * c
  return (
    <svg viewBox="0 0 100 100" className="size-28 shrink-0 sm:size-32" role="img" aria-label={`점수 ${score}/100`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke={colorVar} strokeOpacity="0.18" strokeWidth="11" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={colorVar}
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="48" textAnchor="middle" fontSize="30" fontWeight="800" fill={colorVar}>
        {score}
      </text>
      <text x="50" y="67" textAnchor="middle" fontSize="11" fill={colorVar} opacity="0.7">
        / 100
      </text>
    </svg>
  )
}

function 파일종류(파일명: string | null): string | null {
  if (!파일명) return null
  const ext = 파일명.split(".").pop()?.toUpperCase()
  return ext && ext.length <= 5 ? ext : null
}

/** 라벨 붙은 정보 한 칸 — 아이콘으로 훑어 읽히게 한다. */
function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate font-medium">{value}</div>
      </div>
    </div>
  )
}

/**
 * 공고 상세 — **사업명을 누르면 이 화면 하나로 다 본다.**
 * 지원사업(/announcements)과 과제사업(/project-announcements) 양쪽이 이 컴포넌트
 * 하나를 공유한다 — 출처만 다르고 화면 구조는 같다. backHref 로 어느 목록에서 왔는지만
 * 구분한다.
 *
 * 예전엔 "사업명 클릭 → 슬라이드 패널(요약·자격판정)" 과 "체크리스트 전체보기 →
 * 별도 페이지(공고문 발췌·요구서류)" 로 나뉘어 있었다. 사용자 요청(2026-09-03)으로
 * 하나의 페이지로 합쳤다 — 사업명을 누르면 바로 이 화면으로 이동한다.
 *
 * 2026-09-03 두 번째 요청 — "누가 봐도 시선을 사로잡게, 공고문 발췌는 요약해서."
 *   ① 자격판정을 배지 한 줄이 아니라 **화면 맨 위 색이 있는 히어로 패널**로 올렸다.
 *      점수·확신도·근거·확인필요항목이 전부 그 안에 있다 — 아래에 따로 반복하지 않는다
 *      (같은 사실을 두 번 보여주면 그만큼 화면이 늘어질 뿐 안 읽힌다).
 *   ② 공고문 발췌(원문 그대로, 최대 4000자)는 기본으로 접어 둔다(<details>) — 읽을
 *      것은 이미 사업요약(LLM 요약)이 위에 있다. 원문은 "근거를 확인하고 싶을 때"만
 *      펼치는 감사용 자료로 격을 낮췄다. 지우지는 않는다 — 판독을 검증할 유일한 원본이다.
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

  const [
    { rows: annRows, error: annError },
    { rows: docs, error: docError },
    { rows: 요건판정목록, error: 요건판정오류 },
  ] = await Promise.all([
    getAnnouncementDetail(announcementId),
    getRequiredDocs(announcementId),
    getRequirementJudgments(announcementId),
  ])

  const a = annRows[0]
  if (!a && !annError) notFound()

  const 요약 = a?.요약 ?? null
  // 우리 버킷 사본이 있으면 그걸 우선한다 — 원본 서버 링크는 나중에 끊길 수 있다(실측: IRIS).
  const 다운로드url = a?.공고문_bucket_url ?? a?.공고문_url ?? null
  const 톤 = a ? 자격판정_톤[a.자격판정] : null
  const 판정아이콘 = 톤?.icon

  return (
    <PageShell
      title={a?.사업명 ?? "공고 상세"}
      description={
        a
          ? `공고번호 ${a.출처_id ?? "—"} · ${a.출처}${a.지역 ? ` · ${a.지역}` : ""}`
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
      {요건판정오류 && <DbError what="요건별 판정" error={요건판정오류} />}

      {a && 톤 && 판정아이콘 && (
        <>
          {/*
           * ── 히어로 메가카드 ────────────────────────────────────────────────
           * 사용자 피드백(2026-09-03, "내일 심사위원 앞에서 봄 — 한눈에 딱 들어오게"):
           * 판정·핵심정보·접수기간·다운로드가 각각 따로 떨어진 흰 박스였다.
           * 하나의 카드 안에 색 구역(판정) → 중립 구역(핵심 정보) → 액션 구역(다운로드)
           * 3단으로 이어 붙여 "따로 보는 네 개"가 아니라 "한 번에 읽는 하나"로 만든다.
           */}
          <div className="overflow-hidden rounded-xl shadow-lg shadow-black/5">
            <div className={cn("h-3 w-full", 톤.barClass)} />

            {/* 구역 1 — 판정. 배경은 중립(흰 카드)으로 두고, 아이콘·제목 글자·게이지 색만으로
                등급을 알린다 — 배경 전체를 칠하지 않아야 그 안의 근거·확인 상자가 조용해진다. */}
            <div className="bg-card p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="flex items-center gap-4 sm:gap-5">
                  <div
                    className={cn(
                      "flex size-14 shrink-0 items-center justify-center rounded-full shadow-sm sm:size-16",
                      톤.badgeClass,
                    )}
                  >
                    {(() => {
                      const Icon = 판정아이콘
                      return <Icon className="size-7 sm:size-8" strokeWidth={2.25} />
                    })()}
                  </div>
                  <div>
                    <div className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                      자격 판정
                    </div>
                    <div
                      className={cn(
                        "text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl",
                        톤.titleClass,
                      )}
                    >
                      {자격판정_라벨[a.자격판정]}
                    </div>
                    <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">
                      {자격판정_설명[a.자격판정]}
                    </p>
                  </div>
                </div>

                {typeof a.자격판정_점수 === "number" && (
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <ScoreGauge score={a.자격판정_점수} colorVar={톤.gaugeVar} />
                    {typeof a.자격판정_확신도 === "number" && (
                      <div className="text-xs font-medium text-muted-foreground">
                        AI 확신도 {Math.round(a.자격판정_확신도 * 100)}%
                      </div>
                    )}
                  </div>
                )}
              </div>

              {a.자격판정_원판정 && (
                <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-1.5 text-[13px] font-medium text-muted-foreground">
                  AI가 원래 낸 판정은 「{a.자격판정_원판정}」이었지만, 확신도가 0.70 미만이라
                  「확인필요」로 낮췄습니다 — 사람이 확인하기 전엔 자동으로 확정하지 않습니다.
                </p>
              )}

              {((a.자격판정_근거 && a.자격판정_근거.length > 0) ||
                (a.자격판정_확인필요항목 && a.자격판정_확인필요항목.length > 0)) && (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {a.자격판정_근거 && a.자격판정_근거.length > 0 && (
                    <div className="rounded-lg border bg-muted/40 p-3.5">
                      <div className="text-xs font-bold text-muted-foreground">근거</div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">
                        {a.자격판정_근거.map((근거, i) => (
                          <li key={i}>{근거}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {a.자격판정_확인필요항목 && a.자격판정_확인필요항목.length > 0 && (
                    <div className="rounded-lg border bg-muted/40 p-3.5">
                      <div className="text-xs font-bold text-muted-foreground">
                        회사 정보에 없어 확인이 필요한 항목
                      </div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">
                        {a.자격판정_확인필요항목.map((항목, i) => (
                          <li key={i}>{항목}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 border-t pt-4">
                <EligibilityConfirm
                  announcementId={a.id}
                  확정여부있음={a.자격판정_확정일시 != null}
                  정정여부={a.자격판정_정정여부 ?? null}
                  확정자={a.자격판정_확정자 ?? null}
                  확정일시={a.자격판정_확정일시 ?? null}
                />
              </div>

              {/* 의미 학습 — 판정 결과(위)와 다른 층. "왜 그런지" 문장을 쌓아서
                  다음 공고에서 문구가 달라도 뜻이 비슷하면 참고 사례로 찾는다. */}
              <div className="mt-3 border-t pt-3">
                <JudgmentNote
                  announcementId={a.id}
                  검색기본질의={`${a.사업명 ?? ""} ${요약?.사업요약 ?? ""}`.trim()}
                />
              </div>
            </div>

            {/* 구역 2 — 핵심 정보(중립, 카드 배경) */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 bg-card p-5 text-[13px] sm:grid-cols-4 sm:p-6">
              <Fact icon={Building2} label="주관기관" value={a.소관부처 ?? "—"} />
              <Fact icon={Building2} label="수행기관" value={a.전문기관 ?? "—"} />
              <Fact icon={Tag} label="지원분야" value={요약?.지원분야 ?? "정보 없음"} />
              <Fact icon={Users} label="지원대상" value={요약?.지원대상 ?? "정보 없음"} />
              <Fact icon={Wallet} label="지원규모" value={요약?.지원규모 ?? "정보 없음"} />
              <Fact icon={Send} label="접수방법" value={요약?.접수방법 ?? "정보 없음"} />
              <div className="col-span-2">
                <Fact
                  icon={Phone}
                  label="문의처"
                  value={<span className="whitespace-pre-wrap">{요약?.문의처 ?? "정보 없음"}</span>}
                />
              </div>
            </div>

            {/* 구역 3 — 접수기간 + 다운로드(액션) */}
            <div className="grid gap-px overflow-hidden border-t bg-border sm:grid-cols-2">
              <div className="flex items-center justify-between gap-3 bg-card p-4">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">접수기간</div>
                  <div className="tabular-nums">
                    {a.접수시작 && a.접수종료
                      ? `${a.접수시작} ~ ${a.접수종료}`
                      : "공고문에 날짜로 적혀 있지 않습니다."}
                  </div>
                </div>
                <DeadlineBadge 마감유형={a.마감유형} 접수종료={a.접수종료} />
              </div>

              <div className="bg-card p-3">
                {다운로드url ? (
                  <a
                    href={다운로드url}
                    className="flex h-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                  >
                    <Download className="size-4.5 shrink-0" />
                    <span className="truncate">{a.공고문_파일명 ?? "공고문 다운로드"}</span>
                    {파일종류(a.공고문_파일명) && (
                      <Badge variant="secondary" className="shrink-0">
                        {파일종류(a.공고문_파일명)}
                      </Badge>
                    )}
                  </a>
                ) : a.공고문_파일명 ? (
                  <div className="flex h-full items-center gap-2 rounded-lg border p-2.5 text-muted-foreground">
                    <FileText className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{a.공고문_파일명}</span>
                    <span className="text-xs">다운로드 링크 없음</span>
                  </div>
                ) : (
                  <p className="flex h-full items-center justify-center text-muted-foreground">
                    첨부된 공고문이 없습니다.
                  </p>
                )}
              </div>
            </div>

            {/* 구역 4 — 신청 진행 상태(사람이 직접 정한다) */}
            <div className="border-t bg-card p-4">
              <ApplyStatus announcementId={a.id} initial={a.관심상태 ?? null} />
            </div>
          </div>

          {/*
           * ── 요건별 판정 — 계산으로 확정되는 자리라 LLM을 쓰지 않는다 ───────────
           * 위 히어로의 자격판정은 "종합 한 줄"이고, 이건 그 한 줄을 만든 재료를
           * 항목별로 그대로 보여준다 — 참가 계획서 문항4①이 명시한 "요건별 표".
           */}
          {요건판정목록.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <ClipboardList className="size-4 text-muted-foreground" />
                <div>
                  <h2 className="text-sm font-semibold">요건별 판정 {요건판정목록.length}건</h2>
                  <p className="text-xs text-muted-foreground">
                    회사 프로필 값과 공고 요건을 단위까지 맞춰 계산한다 — AI가 아니라 코드로
                    확정한다. 단위를 맞출 수 없거나 값이 없으면 「확인필요」로 두고 추측하지 않는다.
                  </p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[70px]">구분</TableHead>
                    <TableHead className="w-[160px]">항목</TableHead>
                    <TableHead className="w-[90px]">판정</TableHead>
                    <TableHead>상세</TableHead>
                    <TableHead>근거(공고 원문)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {요건판정목록.map((r, i) => (
                    <TableRow key={i} className="text-[13px]">
                      <TableCell className="align-top">
                        <Badge variant={r.필수여부 ? "default" : "outline"}>
                          {r.필수여부 ? "필수" : "조건"}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top font-medium">{r.항목}</TableCell>
                      <TableCell className="align-top">
                        <StatusBadge value={r.판정} />
                      </TableCell>
                      <TableCell className="align-top text-muted-foreground">{r.상세}</TableCell>
                      <TableCell className="align-top text-muted-foreground">{r.근거}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* ── 사업 요약 — 읽는 사람이 여기서 끝내도 되게 ────────────────────── */}
          <Card className="border-l-4 border-l-primary bg-primary/[0.03] p-5 text-[14px]">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="size-4 text-primary" />
              <h2 className="text-sm font-bold text-primary">사업 요약</h2>
            </div>
            <p className="leading-relaxed whitespace-pre-wrap text-foreground/90">
              {요약?.사업요약 ?? "아직 요약이 준비되지 않았습니다. 공고문을 직접 확인하세요."}
            </p>
          </Card>
        </>
      )}

      <Card>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <ClipboardList className="size-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">요구서류 {docs.length}건</h2>
            <p className="text-xs text-muted-foreground">
              근거문장은 공고문 원문을 그대로 인용한 것이다 — 지어낸 서류인지 여기서 검증한다.
            </p>
          </div>
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
              {[...docs]
                .sort((x, y) => Number(y.필수여부) - Number(x.필수여부))
                .map((d) => (
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

      {/* ── 공고문 원문 — 접어 둔다. 읽을 것은 위 「사업 요약」이고, 이건 검증용이다 ── */}
      {a?.본문 && (
        <details className="group rounded-lg border">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 p-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
            공고문 원문 보기
            <span className="font-normal text-muted-foreground">
              — 위 요약·판정의 근거를 직접 확인하고 싶을 때만 펼치세요
            </span>
          </summary>
          <p className="max-h-72 overflow-y-auto border-t p-4 text-[13px] whitespace-pre-wrap text-muted-foreground">
            {a.본문.slice(0, 3000)}
            {a.본문.length > 3000 && "…"}
          </p>
        </details>
      )}

      {footer}
    </PageShell>
  )
}
