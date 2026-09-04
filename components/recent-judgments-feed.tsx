import Link from "next/link"
import { Card } from "@/components/page-shell"
import { StatusBadge } from "@/components/status-badge"
import { DbError } from "@/components/db-error"
import { getRecentJudgmentHistory } from "@/lib/queries-briefing"

const 지원사업_출처 = new Set(["기업마당", "K-Startup"])

function 상세경로(출처: string): "/announcements" | "/project-announcements" {
  return 지원사업_출처.has(출처) ? "/announcements" : "/project-announcements"
}

/** ISO → `09-03 17:36` (KST). */
function 시각(iso: string) {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

/**
 * 최근 판단 이력 — 참가 계획서 문항4④가 "가장 중요하게 보는 기능"이라 말한 것을
 * 실제로 눈에 보이게 한다: 사람이 공고 하나하나를 보며 왜 그렇게 판단했는지 남긴 문장이
 * 쌓인 것을, 그 공고 안이 아니라 **회사 전체 최근 순으로** 한 화면에서 본다.
 *
 * 공고 탐색(/announcements, /project-announcements) 하단에 붙인다 — 챗(Slack 연동)이
 * 아직 없어도, 담당자가 바뀌거나 퇴사해도 "왜 그렇게 처리했는지"가 회사에 남는다는
 * 계획서의 핵심 주장을 화면 하나로 보여줄 수 있어야 해서다.
 */
export async function RecentJudgmentsFeed() {
  const { rows, error } = await getRecentJudgmentHistory(8)

  if (error) return <DbError what="판단 이력" error={error} />

  return (
    <Card className="p-4 text-[14.3px]">
      {/* 서버 컴포넌트라 useState 를 못 쓴다. <details> 면 상태도 JS 도 없이 접힌다.
          기본은 펼침 — 계획서가 「가장 중요하게 보는 기능」이라 한 자리라 접혀 있으면 안 보인다. */}
      <details open className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <h2 className="text-sm font-semibold">
            최근 판단 이력
            {rows.length > 0 && (
              <span className="ml-1.5 font-normal text-muted-foreground">{rows.length}</span>
            )}
          </h2>
          <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">펼치기</span>
          <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">접기</span>
        </summary>

      <p className="mb-3 mt-1 text-xs text-muted-foreground">
        사람이 공고를 보고 남긴 「왜 그렇게 판단했나」가 쌓인 기록입니다. 담당자가 바뀌거나
        퇴사해도 이 기록은 회사에 남고, 다음에 비슷한 공고를 볼 때 참고 사례로 다시 쓰입니다.
      </p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">
          아직 쌓인 판단 이력이 없습니다. 공고 상세 페이지의 「판단 근거」에서 남기면 여기 쌓입니다.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const ann = Array.isArray(r.announcements) ? r.announcements[0] : r.announcements
            return (
              <li key={r.id} className="border-b pb-2.5 last:border-b-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge value={r.판정} />
                  {ann ? (
                    <Link
                      href={`${상세경로(ann.출처)}/${r.announcement_id}`}
                      className="truncate font-medium hover:underline"
                    >
                      {ann.사업명}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">공고 #{r.announcement_id}</span>
                  )}
                </div>
                {r.사유 && <p className="mt-1 text-muted-foreground">{r.사유}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.답변자} · {시각(r.created_at)}
                  {r.특징키 && ` · ${r.특징키}`}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      </details>
    </Card>
  )
}
