import { PageShell } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { AnnouncementBoard } from "@/components/announcement-board"
import { CalendarBoard } from "@/components/calendar-board"
import {
  getLedger,
  getExpenses,
  getDocuments,
  getAnnouncementBoard,
  getCalendar,
  getCalendarUndated,
} from "@/lib/queries"
import { getLabels, categoryLabel } from "@/lib/labels"

export const dynamic = "force-dynamic"

/**
 * 대시보드 — 카드 둘.
 *
 * 올릴지 말지의 기준은 하나다: **행동이 필요한가.**
 *   보고 나서 할 일이 생기면 올리고, 그냥 알고 넘어가는 숫자면 안 올린다.
 *   그래서 예산 소진율 같은 상태 숫자는 뺐다(2026-09-03). 62% 를 봐도 할 일이 없다.
 *
 *   ① 일정      — 언제까지 뭘 해야 하나 + 날짜 없이 나를 기다리는 것
 *   ② 공고 확인 — 놓친 기회가 있나
 *
 * ⚠ 2026-09-03: 맨 아래 「손봐야 할 것」 카드를 없앴다. 카드가 셋이면 화면이 흩어진다.
 *   다만 **카드만 없애고 안에 있던 것은 버리지 않는다** — 확정 대기·점검·서류 미확보는
 *   날짜가 없어 달력에 못 올라가므로 일정 카드의 「기다리는 일」 칸으로 넘긴다.
 *   특히 확정 대기가 사라지면, 확신도 0.70 미만이 자동 확정을 막아 생긴 줄이
 *   쌓이는 것을 아무도 모르게 된다.
 *
 * ⚠ 아무 일 없으면 조용해야 한다. **항상 켜져 있는 경고는 경고가 아니다.**
 *   걸리는 게 없는 칸은 아예 안 그린다. 회색으로 「0건」을 띄우지 않는다.
 */

/** 「오늘」은 서버가 정한다. 심사장 PC 의 시간대를 믿지 않는다. */
function 서울의_오늘() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date())
}

export default async function DashboardPage() {
  // 동시에 부른다. 하나가 실패해도 나머지는 그려진다.
  const [ledger, expenses, docs, board, calendar, undated, labels] = await Promise.all([
    getLedger(),
    getExpenses(),
    getDocuments(),
    getAnnouncementBoard(),
    getCalendar(),
    getCalendarUndated(),
    // 비목은 DB 에 FACILITY 같은 코드로 들어 있다. 화면에 코드가 보이면 사용자가 읽을 수 없다.
    getLabels(),
  ])

  const today = 서울의_오늘()

  const 신규공고 = board.rows.filter((r) => r.신규).length
  const 확정대기 = expenses.rows.filter((e) => e.상태 === "검토대기")
  const 점검 = ledger.rows.filter((r) => r.미처리점검 > 0)
  const 미확보서류 = docs.rows.filter((d) => ["만료", "없음"].includes(d.상태))

  // 이번 주(일~토) 안에 걸리는 일정 수 — 한 줄 요약에만 쓴다.
  const 이번주 = calendar.rows.filter(
    (r) => r.d_day != null && r.d_day >= 0 && r.d_day <= 7,
  ).length

  /**
   * 날짜가 없어 달력에 못 올라가는 것 — 일정 카드의 「기다리는 일」 칸으로 넘긴다.
   * 미리보기는 3줄까지만. 나머지는 각 화면에서 본다.
   * ⚠ 건수(건수)는 잘라내기 전 기준이다. 3줄만 세면 「12건 중 3건」을 3건이라 말하게 된다.
   */
  const 기다림 = [
    {
      라벨: "확정 대기",
      힌트: "AI 제안 → 사람이 눌러야 넘어간다",
      링크: "/expenses",
      건수: 확정대기.length,
      항목: 확정대기.slice(0, 3).map((e) => ({
        키: `e${e.id}`,
        이름: e.거래처 ?? "거래처 미상",
        꼬리: e.비목_대분류
          ? categoryLabel(labels, e.비목_대분류, e.비목_세부항목).main
          : "비목 미지정",
      })),
    },
    {
      라벨: "제출 전 점검",
      힌트: "누락 · 날짜오류 · 금액 불일치",
      링크: "/programs",
      건수: 점검.length,
      항목: 점검.slice(0, 3).map((r) => ({
        키: `p${r.id}`,
        이름: r.사업명,
        꼬리: `${r.미처리점검}건`,
      })),
    },
    {
      라벨: "서류 미확보",
      힌트: "만료됐거나 아직 없는 것",
      링크: "/documents",
      건수: 미확보서류.length,
      항목: 미확보서류.slice(0, 3).map((d) => ({
        키: `d${d.코드}`,
        이름: d.이름,
        꼬리: d.상태,
        배지: true,
        // 만료된 서류는 v_calendar 에도 「서류만료」로 올라간다(`참조종류='서류', 참조키=코드`).
        // 같은 줄이 「지난 일정」과 여기에 두 번 나오던 것을 일정 카드가 이 열쇠로 지운다.
        참조: `서류:${d.코드}`,
      })),
    },
  ]

  const errors = [ledger, expenses, docs, board, calendar, undated]
    .map((r, i) => ({
      e: r.error,
      what: ["대장", "집행", "서류함", "공고", "일정", "날짜 미정"][i],
    }))
    .filter((x) => x.e)

  // 카드 다섯 개를 문장 하나로 압축했다. 지울 정보는 없고, 높이만 줄인다.
  const 요약 = [
    신규공고 > 0 && `오늘 새 공고 ${신규공고}`,
    이번주 > 0 && `7일 내 일정 ${이번주}`,
    확정대기.length > 0 && `확정 대기 ${확정대기.length}`,
    점검.length > 0 && `점검 ${점검.length}`,
  ].filter(Boolean) as string[]

  return (
    <PageShell title="대시보드" description="오늘 손대야 할 것만 모았다.">
      {errors.map((x) => (
        <DbError key={x.what} what={x.what} error={x.e!} />
      ))}

      <p className="-mt-1 text-[13px] text-muted-foreground">
        {요약.length > 0 ? (
          요약.join(" · ")
        ) : (
          <span>지금 손댈 것이 없습니다.</span>
        )}
      </p>

      {/* ① 일정 — 날짜 있는 것과 날짜 없이 나를 기다리는 것이 한 카드에 있다 */}
      <CalendarBoard
        rows={calendar.rows}
        undated={undated.rows}
        기다림={기다림}
        today={today}
        error={calendar.error}
      />

      {/* ② 새로 올라온 공고 — 생애주기의 입구. 여기선 앞 8건만, 전체는 공고 탐색에서. */}
      <AnnouncementBoard rows={board.rows} 최대={8} />

    </PageShell>
  )
}
