"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { PROJECT_TABS } from "@/lib/nav"

/**
 * 과제 상세 탭. 사이드바가 아니라 **과제 안에서** 화면을 가른다.
 *
 * 왜 클라이언트 컴포넌트인가 — 어느 탭이 켜져 있는지는 경로에서만 알 수 있는데
 * 서버 레이아웃에는 pathname 이 안 들어온다. 딱 그것만 하는 얇은 조각이라
 * 데이터는 전부 서버 컴포넌트인 각 탭이 직접 읽는다.
 *
 * ⚠ **탭은 단계마다 다르다.** 아직 할 수 없는 일의 탭을 열어 두면 그 자체가 거짓말이다.
 *
 * | 단계 | 개요 | 연구비 계상 | 집행 | 정산 |
 * |---|---|---|---|---|
 * | 신청중 | ○ | ○ (신청서에 넣을 계획) | ✗ | ✗ |
 * | 수행중 | ○ | ○ | ○ | ○ |
 * | 종료 | ○ | ✗ | ○ | ○ |
 *
 * - **신청중에 집행·정산을 두지 않는다**(2026-09-04 사용자 지적).
 *   선정도 안 됐는데 쓸 돈이 없고, 쓴 게 없으니 정산할 것도 없다.
 *   시작도 안 한 과제에 정산 탭이 있으면 「여기서 뭘 해야 하나」를 잘못 알려 준다.
 * - **종료된 과제에 「연구비 계상」을 두지 않는다**(2026-09-03 사용자 지시).
 *   계상은 협약·수행 중에 하는 일이다. 끝난 과제에 열려 있으면 아직 배정을 고칠 수 있다는
 *   뜻으로 읽히고, 실제로 고치면 정산 대조 기준이 바뀐다.
 * - **지원사업 건에는 「연구비 계상」을 아예 안 띄운다**(2026-09-04 사용자 지적 — "이건 연구비
 *   계상이 아니야"). 5직접비 + 간접비 + 연구수당 한도는 국가 R&D 전용 규정이고, 지자체·TP
 *   지원사업은 정산 방식 자체가 다르다(단순 영수증 등). 상태와 무관하게 사업유형으로 가른다.
 *
 * **탭을 빼도 자료는 사라지지 않는다** — 지난 계상은 정산 탭의 과제비 원장이 그대로 쓴다.
 * 숨기는 것은 「할 일」이지 「본 것」이 아니다.
 */

/** 상태 어휘는 DB 값을 그대로 쓴다 — `수행중 / 신청중 / 종료`. "수행" 으로 비교하면 언제나 0 이다. */
function 보일_탭인가(seg: string, 상태: string | null | undefined, 과제사업: boolean): boolean {
  if (seg === "budget" && !과제사업) return false
  if (상태 === "신청중") return seg === "" || seg === "budget"
  if (상태 === "종료") return seg !== "budget"
  return true
}

export function ProjectTabs({
  id,
  상태,
  과제사업 = true,
}: {
  id: number
  상태?: string | null
  /** 국가 R&D(과제사업) 건인가 — 아니면(지원사업) 「연구비 계상」 탭을 안 띄운다. */
  과제사업?: boolean
}) {
  const pathname = usePathname()
  const base = `/projects/${id}`
  // 탭 목록은 lib/nav.ts 가 갖는다 — 브레드크럼과 같은 표를 봐야 이름이 어긋나지 않는다.
  // 거기서 지우지 않고 여기서 거르는 이유: 같은 표를 브레드크럼도 보기 때문에
  // 목록에서 빼면 /projects/13/budget 의 브레드크럼이 「연구비 계상」을 못 찾는다.
  const tabs = PROJECT_TABS.filter((t) => 보일_탭인가(t.seg, 상태, 과제사업)).map((t) => ({
    title: t.title,
    href: t.seg ? `${base}/${t.seg}` : base,
  }))

  return (
    <div className="flex gap-1 border-b">
      {tabs.map((t) => {
        const on = pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[14.3px] transition-colors",
              on
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.title}
          </Link>
        )
      })}
    </div>
  )
}
