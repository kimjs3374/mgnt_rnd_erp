import { PageShell } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { AnnouncementBoard } from "@/components/announcement-board"
import type { 자격판정값 } from "@/components/announcement-board"
import { CalendarBoard } from "@/components/calendar-board"
import { ProjectBoard } from "@/components/project-board"
import { TodoCard } from "@/components/todo-card"
import { WatchlistStrip } from "@/components/watchlist-strip"
import {
  getLedger,
  getExpenses,
  getDocuments,
  getAnnouncementBoard,
  getCalendar,
  getCalendarUndated,
  getProjects,
  getRndAnnouncements,
} from "@/lib/queries"
import { getProgramAnnouncements } from "@/lib/queries-programs"
import { getWatchlistAnnouncements } from "@/lib/queries-budgeting"
import { getLabels, categoryLabel } from "@/lib/labels"

export const dynamic = "force-dynamic"

/**
 * 대시보드 — 카드를 성격별로 쪼갠 판.
 *
 * 올릴지 말지의 기준은 하나다: **행동이 필요한가.**
 *   보고 나서 할 일이 생기면 올리고, 그냥 알고 넘어가는 숫자면 안 올린다.
 *
 * ```
 * 공고 확인                          ← 새로 온 기회
 * 일정(달력)  |  과제 관리            ← 언제 / 무엇을 하고 있나
 *             |  오늘 처리할 것       ← 내가 눌러야 넘어가는 것
 * ```
 *
 * 2026-09-04 개편(5차) — 「한눈에 들어와야 한다」는 지적으로 판을 다시 짰다.
 *   ① **아래 세 칸(비목 확정·챙길 서류·제출 전 점검)을 없애고 카드 하나로 합쳤다**
 *      (`TodoCard`). 세 장을 가로로 늘어놓으니 테두리·헤더가 세 번 반복돼 맨 아래
 *      한 행이 시끄러웠다. 정보를 지우는 게 아니라 **자리를 옮긴 것**이다 — 완전히
 *      지우면 확정 대기가 쌓이는 걸 아무도 모르게 된다.
 *   ② **과제 관리를 3줄로 줄이고, 오늘 처리할 것을 그 밑에 이어 붙였다.** 오른쪽
 *      열을 `flex flex-col` 로 묶고 오늘 처리할 것에 `flex-1` 을 준다 — 왼쪽 달력
 *      카드가 길든 짧든 오른쪽 두 카드 합이 자동으로 따라간다(CSS Grid 의 기본
 *      `items-stretch` 가 두 칸을 같은 높이로 맞추고, `flex-1` 이 남는 높이를 흡수).
 *   ③ 공고 확인이 자격판정을 함께 보여준다(가능 판정만 이 카드에 올라온다,
 *      §3.6 — 새 판정 로직을 만들지 않고 `getProgramAnnouncements`·
 *      `getRndAnnouncements` 를 그대로 가져다 쓴다).
 *
 * ⚠ 확정 대기를 빠뜨리면 안 된다. 확신도 0.70 미만은 코드가 자동 확정을 막게 해 뒀으므로
 *   사람을 기다리는 줄이 반드시 생기는데, 화면에서 사라지면 그게 쌓이는 걸 아무도 모른다.
 */

/** 「오늘」은 서버가 정한다. 심사장 PC 의 시간대를 믿지 않는다. */
function 서울의_오늘() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date())
}

export default async function DashboardPage() {
  // 동시에 부른다. 하나가 실패해도 나머지는 그려진다.
  const [ledger, expenses, docs, board, calendar, undated, projects, labels, program, rnd, watch] =
    await Promise.all([
      getLedger(),
      getExpenses(),
      getDocuments(),
      getAnnouncementBoard(),
      getCalendar(),
      getCalendarUndated(),
      getProjects(),
      // 비목은 DB 에 FACILITY 같은 코드로 들어 있다. 화면에 코드가 보이면 사용자가 읽을 수 없다.
      getLabels(),
      // 자격판정만 쓰려고 부른다 — 공고 탐색과 같은 함수, 같은 값이다.
      getProgramAnnouncements(),
      getRndAnnouncements(),
      // 「과제 계상」 화면을 없애면서(2026-09-04) 관심 공고 목록만 여기로 옮겼다 — 계상은
      // 흐름의 끝이고 관심 공고는 처음이라 원래도 그 화면 맨 위에 있었다(watchlist-strip.tsx).
      getWatchlistAnnouncements(),
    ])

  const today = 서울의_오늘()

  const 확정대기 = expenses.rows.filter((e) => e.상태 === "검토대기")
  const 점검 = ledger.rows.filter((r) => r.미처리점검 > 0)
  const 미확보서류 = docs.rows.filter((d) => ["만료", "없음"].includes(d.상태))

  // id → 자격판정. 두 출처를 합쳐도 id 는 announcements 테이블 한 곳에서 오므로 안 섞인다.
  // 판정을 못 가져왔다고 카드 전체를 죽이지 않는다 — 배지가 안 뜰 뿐이다.
  const 판정: Record<number, 자격판정값 | undefined> = {}
  for (const r of [...program.rows, ...rnd.rows]) 판정[r.id] = r.자격판정

  // 공고 id → 출처. 과제 관리 카드가 사업유형이 빈 건(기업마당·K-Startup 출처는
  // 실측상 사업유형을 거의 안 채운다)을 배지로 못 그릴 때, 공고 확인 카드와
  // 같은 기준(출처)으로 대신 판정하도록 넘긴다.
  const 공고출처: Record<number, string | undefined> = {}
  for (const r of [...program.rows, ...rnd.rows]) 공고출처[r.id] = r.출처

  const errors = [ledger, expenses, docs, board, calendar, undated, projects, watch]
    .map((r, i) => ({
      e: r.error,
      what: ["대장", "집행", "서류함", "공고", "일정", "날짜 미정", "과제 관리", "관심 공고"][i],
    }))
    .filter((x) => x.e)

  return (
    <PageShell
      title="대시보드"
      description="오늘 확인할 공고, 챙길 일정, 진행 중인 과제와 처리할 일을 한 화면에서 본다."
    >
      {errors.map((x) => (
        <DbError key={x.what} what={x.what} error={x.e!} />
      ))}

      {/* ① 새로 온 기회 — 첫 화면의 첫 줄이라 이미 마감된 공고는 들어오지 않는다 */}
      <AnnouncementBoard
        rows={board.rows}
        판정={판정}
        undated={undated.rows}
        today={today}
        error={board.error}
      />

      {/* 관심 표시한 공고 — 마감이 지나가는 게 계상할 과제보다 급해서 새 기회 바로 다음에 둔다.
          아무것도 관심 표시 안 했으면(대부분의 방문) 빈 카드로 자리만 차지하니 그때는 뺀다. */}
      {watch.rows.length > 0 && <WatchlistStrip rows={watch.rows} />}

      {/* ② 언제 / 무엇을 하고 있나 + 내가 눌러야 넘어가는 것.
          오른쪽 열을 flex-col 로 묶는다 — 과제 관리(3줄, 내용만큼)+오늘 처리할 것(flex-1, 나머지)
          을 합친 세로 길이가 왼쪽 달력 카드와 자동으로 같아진다. */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <CalendarBoard rows={calendar.rows} today={today} error={calendar.error} />
        <div className="flex flex-col gap-4">
          <ProjectBoard
            rows={projects.rows}
            공고출처={공고출처}
            today={today}
            error={projects.error}
          />
          <TodoCard
            갈래들={[
              {
                // ⚠ 미리보기로 자르지 않는다(slice 없음) — todo-card.tsx 가 갈래별로
                //   자체 페이지 넘김을 하므로 전체 목록이 있어야 두 번째 페이지가 채워진다.
                라벨: "비목 확정",
                링크: "/expenses",
                건수: 확정대기.length,
                항목: 확정대기.map((e) => ({
                  키: `e${e.id}`,
                  이름: e.거래처 ?? "거래처 미상",
                  꼬리: e.비목_대분류
                    ? categoryLabel(labels, e.비목_대분류, e.비목_세부항목).main
                    : "비목 미지정",
                })),
              },
              {
                라벨: "챙길 서류",
                링크: "/documents",
                건수: 미확보서류.length,
                항목: 미확보서류.map((d) => ({
                  키: `d${d.코드}`,
                  이름: d.이름,
                  꼬리: d.상태,
                  배지: true,
                })),
              },
              {
                라벨: "제출 전 점검",
                링크: "/programs",
                건수: 점검.length,
                항목: 점검.map((r) => ({
                  키: `p${r.id}`,
                  이름: r.사업명,
                  꼬리: `${r.미처리점검}건`,
                })),
              },
            ]}
          />
        </div>
      </div>
    </PageShell>
  )
}
