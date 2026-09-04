"use client"

import * as React from "react"
import { EyeOff, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnnouncementsExplorer } from "@/components/announcements-explorer"

type ExplorerProps = React.ComponentProps<typeof AnnouncementsExplorer>

/**
 * 공고 탐색 화면 + 「불가·해당없음 숨김」.
 *
 * 화면 자체는 components/announcements-explorer.tsx(과제사업이 기준) 그대로다.
 * 여기는 그 위에 한 겹만 씌운다 — **신청할 대상이 아니라고 결론이 난 공고를 목록에서
 * 빼는 스위치.**
 *
 * 왜 explorer 안의 자격판정 드롭다운으로 안 하는가:
 *   그 드롭다운은 「불가만 보기」는 되는데 「불가만 빼고 보기」가 안 된다. 항목 하나를
 *   고르는 필터라 여집합을 못 만든다. 그런데 실제로 쓰는 동작은 여집합 쪽이다 —
 *   802건 중 412건이 불가라 그걸 안 빼면 쓸 수 있는 공고가 절반 아래로 묻힌다.
 *
 * 왜 explorer 를 직접 안 고치는가:
 *   그 파일은 지금 다른 팀원이 붙잡고 고치는 중이다(2026-09-03 19:22 수정).
 *   같은 디렉터리에서 두 명이 같은 파일을 열면 나중에 저장한 쪽이 통째로 덮어쓴다 —
 *   실제로 한 번 사고가 났다(git log "queries.ts 저장 충돌 복구").
 *   덧씌우는 쪽이 안전하고, 두 화면이 같은 것을 쓰는 것도 그대로 지켜진다.
 *
 * 기본값은 **숨김**이다. 「불가」는 지역이 우리 밖이거나 지원대상에 우리가 없다고
 * 공고가 명시한 것이라 사람이 볼 이유가 거의 없다. 다만 지우지는 않는다 —
 * 판정이 틀렸을 수 있고, 그걸 확인할 길을 막으면 안 된다. 버튼 한 번이면 다시 나온다.
 *
 * 「해당없음」도 같이 접는다(2026-09-04 추가). 사용자 지적: "얘는 왜 해당없음 판정근거
 * 다 했는데 노출되냐"(공고 517 — 광운대 사업 설명회). 사람이 "이건 애초에 지원사업이
 * 아니다"라고 근거까지 남겨 확정했는데 목록에 계속 남아 있으면 그 판정이 아무 일도 안 한
 * 셈이 된다. 「불가」와 이유는 다르지만("요건이 안 맞는다" vs "지원사업이 아니다")
 * **결론은 같다 — 우리가 신청할 대상이 아니다.** 그래서 같은 스위치로 묶는다.
 */

/** 목록에서 접어 두는 판정. 지우는 게 아니라 접는 것이다 — 스위치로 언제든 다시 편다. */
const 숨김대상 = (판정: string) => 판정 === "불가" || 판정 === "해당없음"
export function AnnouncementsView({
  rows,
  referenceRows = [],
  actions,
  ...rest
}: ExplorerProps) {
  const [숨김, set숨김] = React.useState(true)

  // 참고 목록(과제사업 화면의 NTIS 등)까지 한 번에 센다 — 스위치 하나가 둘 다 접는다.
  const { 불가건수, 해당없음건수 } = React.useMemo(() => {
    const 전부 = [...rows, ...referenceRows]
    return {
      불가건수: 전부.filter((r) => r.자격판정 === "불가").length,
      해당없음건수: 전부.filter((r) => r.자격판정 === "해당없음").length,
    }
  }, [rows, referenceRows])
  const 총숨김 = 불가건수 + 해당없음건수
  // 「해당없음」이 하나도 없으면 굳이 이름에 붙이지 않는다 — 없는 것을 세는 것처럼 보인다.
  const 숨김이름 = 해당없음건수 > 0 ? "불가·해당없음" : "불가"
  const 내역 =
    `「불가」 ${불가건수}건` + (해당없음건수 > 0 ? ` · 「해당없음」 ${해당없음건수}건` : "")

  const 보이는행 = 숨김 ? rows.filter((r) => !숨김대상(r.자격판정)) : rows
  const 보이는참고 = 숨김
    ? referenceRows.filter((r) => !숨김대상(r.자격판정))
    : referenceRows

  return (
    /**
     * 표가 가로로 넘치지 않게 가둔다.
     *
     * 원인은 flex 다. 사이드바 옆의 본문은 flex 자식인데 flex 자식의 min-width 기본값이
     * auto 라 **안쪽 표가 넓으면 본문이 그만큼 넓어지고 페이지 전체에 가로 스크롤이 생긴다.**
     * 바깥(layout·PageShell)에 min-w-0 을 주는 것으로 페이지 스크롤은 사라지지만,
     * 그러면 이번엔 표가 자기 안에서 가로로 스크롤된다(ui/table 의 overflow-x-auto).
     *
     * 표까지 안 넘치게 하려면 열 너비가 내용이 아니라 표에서 정해져야 한다 → table-fixed.
     * 나머지 열은 explorer 가 이미 고정폭(w-[110px] …)을 주고 있어서, 남는 폭을 사업명이
     * 가져가고 길면 말줄임된다. 잘린 이름은 행을 클릭하면 상세 패널에서 온전히 보인다.
     *
     * explorer 를 직접 안 고치고 여기서 하는 이유는 위 주석과 같다 — 남이 붙잡고 있는 파일이다.
     */
    <div className="w-full min-w-0 [&_[data-slot=table-cell]]:truncate [&_table]:table-fixed">
      <AnnouncementsExplorer
        {...rest}
        rows={보이는행}
        referenceRows={보이는참고}
        /**
         * ⚠ 두 자식(숨김 버튼 + 상위에서 받은 actions)에 key 를 붙인다.
         *   상위(app/(app)/announcements/page.tsx)가 만든 엘리먼트를 여기서 다른 자식과
         *   **나란히 배열로** 넘기는 순간 React 가 key 를 요구한다 — 실제로 콘솔에
         *   "Each child in a list should have a unique key prop … Check the render method
         *   of AnnouncementsView. It was passed a child from AnnouncementsPage" 가 떴다
         *   (사용자 신고 2026-09-04). 서버 컴포넌트가 만든 엘리먼트가 클라이언트 컴포넌트
         *   자식 배열에 섞이는 자리라 정적 JSX 인데도 경고가 난다.
         */
        actions={
          <div className="flex items-center gap-2">
            {총숨김 > 0 && (
              <Button
                key="숨김토글"
                type="button"
                variant={숨김 ? "default" : "outline"}
                className="h-7 text-[14.1px]"
                title={
                  숨김
                    ? `${내역}을 숨기고 있다. 누르면 다시 보인다.`
                    : `${내역}이 함께 보이고 있다. 누르면 숨긴다.`
                }
                onClick={() => set숨김((v) => !v)}
              >
                {숨김 ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {숨김 ? `${숨김이름} ${총숨김}건 숨김` : `${숨김이름} ${총숨김}건 표시 중`}
              </Button>
            )}
            {actions && <React.Fragment key="상위액션">{actions}</React.Fragment>}
          </div>
        }
      />
    </div>
  )
}
