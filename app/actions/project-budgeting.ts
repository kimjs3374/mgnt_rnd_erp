"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getFundingShareRules, getCompanyProfile } from "@/lib/queries-project"
import { pickRule, computeShare } from "@/lib/funding-share"

/**
 * 선정된 과제의 **협약 총사업비를 확정하고, 그 공고 규정으로 재원을 나눈다.**
 *
 * 왜 이 단계가 따로 있나 — [지원 등록]이 만드는 줄은 **총사업비가 0** 이다
 * (`app/actions/apply.ts`: 「협약 전이라 총사업비는 아직 없다. NOT NULL 이라 0 으로 두고,
 * 협약 때 재원 구성 카드에서 채운다」). 선정이 나면 그 0을 협약 금액으로 바꿔야 하는데,
 * 그 전까지는 **비목을 나눌 기준 자체가 없어서 계상 화면에 가도 할 수 있는 게 없다.**
 * 이 액션이 공고 → 선정 → 계상 사이의 끊긴 자리를 잇는다.
 *
 * 나누는 규칙은 **공고 > 사업유형 > 규정 기본값** 순으로 이긴다(`lib/funding-share.ts`).
 * 같은 「정부지원 비율」이 공고마다 다르기 때문이다 — 2026 지역혁신선도기업육성 공고는
 * 중소기업 75% 이내인데 매그나텍 수행 과제는 97.8% 였고 **둘 다 맞다**(CLAUDE.md §11).
 *
 * ⚠ **이미 들어 있는 재원 금액을 덮어쓰지 않는다.** 협약서가 있으면 협약서가 사실이고
 *   계산값은 규정 상한 점검으로만 쓴다 — 협약 변경 없이 화면 숫자만 바꾸면 정산에서 반려된다
 *   (`components/funding-share-card.tsx` 와 같은 원칙). 비어 있을 때만 계산값이 입력값이 된다.
 */

export type BudgetingResult = {
  ok: boolean
  error?: string
  /** 사람에게 보여줄 계산 근거. 숫자마다 어디서 나왔는지 말할 수 있어야 한다. */
  근거?: string[]
  주의?: string[]
  채운값?: { 정부지원금: number | null; 기관부담_현금: number | null; 기관부담_현물: number | null }
}

const 원 = (n: number) => Math.round(n).toLocaleString("ko-KR")

/**
 * 총사업비를 확정한다. 재원 세 칸이 비어 있으면 규칙으로 계산해 같이 채운다.
 *
 * `미리보기 = true` 면 **아무것도 저장하지 않고 계산만** 돌려준다. 사람이 숫자와 근거를 보고
 * 저장을 누르게 하려는 것이다(설계원칙 3 — 계산은 코드가, 확정은 사람이).
 */
export async function 협약금액_확정(input: {
  과제_id: number
  총사업비: number
  미리보기?: boolean
}): Promise<BudgetingResult> {
  try {
    const 과제_id = Number(input.과제_id)
    const 총사업비 = Math.round(Number(input.총사업비))
    if (!Number.isInteger(과제_id) || 과제_id <= 0) return { ok: false, error: "과제를 찾을 수 없다." }
    if (!Number.isFinite(총사업비) || 총사업비 <= 0) {
      return { ok: false, error: "협약 총사업비를 0보다 큰 값으로 넣으세요." }
    }

    const { data, error } = await db.from("projects").select("*").eq("id", 과제_id).limit(1)
    if (error) return { ok: false, error: error.message }
    const p = (data ?? [])[0] as
      | {
          상태?: string
          선정결과?: string | null
          공고_id?: number | null
          사업유형?: string | null
          정부지원금?: number | null
          기관부담_현금?: number | null
          기관부담_현물?: number | null
        }
      | undefined
    if (!p) return { ok: false, error: "과제를 찾을 수 없다." }

    // 아직 선정 전인 건에 협약 금액을 넣으면 대장 숫자가 거짓이 된다.
    if (p.상태 === "신청중" || p.선정결과 === "미선정") {
      return {
        ok: false,
        error: "아직 선정된 과제가 아닙니다. 공고 상세에서 [선정]을 먼저 기록하세요.",
      }
    }

    const [규칙, 회사] = await Promise.all([getFundingShareRules(), getCompanyProfile()])
    const 기관유형 = (회사.rows[0]?.기업규모 as string | undefined) ?? null
    const rule = pickRule(규칙.rows, {
      공고_id: p.공고_id ?? null,
      사업유형: p.사업유형 ?? null,
      기관유형,
    })
    const share = computeShare(총사업비, rule)

    const 주의: string[] = []
    if (기관유형 == null) {
      주의.push(
        "회사 프로필에 기업규모가 없어 어느 기관유형 규정을 적용할지 정하지 못했습니다. 총사업비만 저장하고 재원은 비워 둡니다.",
      )
    } else if (rule == null) {
      주의.push(
        `${기관유형} 에 적용할 재원 분담 규칙이 없습니다. 총사업비만 저장하고 재원은 계상 화면에서 직접 넣으세요.`,
      )
    } else if (!share?.자동확정) {
      주의.push(
        `적용한 규칙이 「${rule.상태}」입니다 — 계산값은 제안이고, 협약서가 오면 협약서가 사실입니다.`,
      )
    }

    // 이미 들어 있는 값은 건드리지 않는다. 협약서가 사실이다.
    const 이미있음 =
      p.정부지원금 != null || p.기관부담_현금 != null || p.기관부담_현물 != null
    if (이미있음) {
      주의.push("재원 금액이 이미 들어 있어 계산값으로 덮어쓰지 않았습니다. 계상 화면에서 대조하세요.")
    }

    const 채운값 =
      share && !이미있음
        ? {
            정부지원금: share.정부출연금,
            기관부담_현금: share.민간부담_현금,
            기관부담_현물: share.민간부담_현물,
          }
        : {
            정부지원금: p.정부지원금 ?? null,
            기관부담_현금: p.기관부담_현금 ?? null,
            기관부담_현물: p.기관부담_현물 ?? null,
          }

    const 근거 = share?.근거 ?? [
      `총사업비 ${원(총사업비)}원만 저장합니다 — 적용할 재원 분담 규칙을 찾지 못했습니다.`,
    ]

    if (input.미리보기) return { ok: true, 근거, 주의, 채운값 }

    const patch: Record<string, unknown> = { 총사업비 }
    if (share && !이미있음) {
      patch.정부지원금 = share.정부출연금
      patch.기관부담_현금 = share.민간부담_현금
      patch.기관부담_현물 = share.민간부담_현물
    }

    const { error: uErr } = await db.from("projects").update(patch).eq("id", 과제_id)
    if (uErr) return { ok: false, error: uErr.message }

    revalidatePath("/project-budgeting")
    revalidatePath("/projects")
    revalidatePath(`/projects/${과제_id}`)
    revalidatePath(`/projects/${과제_id}/budget`)
    return { ok: true, 근거, 주의, 채운값 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
