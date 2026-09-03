import "server-only"
import { db, safeSelect } from "@/lib/db"
import {
  다음정산일,
  기본규칙,
  type 정산규칙,
  type 공휴일,
  type 달마다,
  type 정산일,
  type 이동방식,
} from "@/lib/settlement-day"

/**
 * 정산 마감 설정 조회 — `db/114_settlement.sql`.
 *
 * 규칙·공휴일·그 달만 다른 날을 **전부 DB 에서 읽는다.** 코드에 박으면 고칠 때마다 배포해야 하고,
 * 대회 뒤에 쓸 사람은 못 고친다(사용자 지시: 「회계 일정은 매번 달라진다」).
 *
 * ⚠ 조회가 실패하면 **기본값으로 계산한다.** 마감 표시가 사라지는 것보다 낫고,
 *   화면이 「기본값으로 보고 있다」고 말한다.
 */

export type 정산설정 = {
  규칙: 정산규칙
  공휴일: 공휴일[]
  달마다: 달마다[]
  /** 설정을 못 읽어 기본값으로 계산 중인가. */
  기본값사용: boolean
}

export async function getSettlementConfig(): Promise<정산설정> {
  const [규칙행, 공휴일행, 달행] = await Promise.all([
    safeSelect<{ 기준일: number; 이동: string }>("settlement_rule", () =>
      db.from("settlement_rule").select("*").limit(1),
    ),
    safeSelect<{ 날짜: string; 이름: string; 확인필요: boolean }>("holidays", () =>
      db.from("holidays").select("*").order("날짜"),
    ),
    safeSelect<{ 연월: string; 마감일: string; 사유: string | null }>("settlement_overrides", () =>
      db.from("settlement_overrides").select("*").order("연월"),
    ),
  ])

  const r = 규칙행.rows[0]
  const 기본값사용 = !!규칙행.error || !r
  const 규칙: 정산규칙 = 기본값사용
    ? 기본규칙
    : {
        기준일: Number(r.기준일) || 기본규칙.기준일,
        이동: (["앞", "뒤", "그대로"].includes(String(r.이동)) ? r.이동 : "앞") as 이동방식,
      }

  return {
    규칙,
    공휴일: (공휴일행.rows ?? []).map((h) => ({
      날짜: String(h.날짜).slice(0, 10),
      이름: h.이름,
      확인필요: !!h.확인필요,
    })),
    달마다: (달행.rows ?? []).map((o) => ({
      연월: o.연월,
      마감일: String(o.마감일).slice(0, 10),
      사유: o.사유,
    })),
    기본값사용,
  }
}

/** 화면이 제일 자주 쓰는 것 — 설정을 읽어 다음 마감을 바로 준다. */
export async function getNextSettlement(): Promise<정산일 & { 기본값사용: boolean }> {
  const c = await getSettlementConfig()
  return { ...다음정산일({ 규칙: c.규칙, 공휴일: c.공휴일, 달마다: c.달마다 }), 기본값사용: c.기본값사용 }
}
