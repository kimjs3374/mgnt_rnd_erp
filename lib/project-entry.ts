/**
 * 대장 직접 등록에서 서버와 화면이 같이 보는 값.
 *
 * `app/actions/project-create.ts` 는 `"use server"` 라 **export 가 전부 async 함수**여야 해서
 * 상수를 거기 둘 수 없다(넣으면 빌드가 깨진다).
 */

/**
 * ⚠ DB 가 쓰는 낱말 그대로다. **「수행」이 아니라 「수행중」이다** —
 * 한 글자 틀리면 대장 집계가 에러 없이 조용히 0 이 된다(실제로 걸린 적 있다).
 */
export const 과제상태값 = ["수행중", "종료", "신청중"] as const
export type 과제상태 = (typeof 과제상태값)[number]

export const 과제상태_설명: Record<과제상태, string> = {
  수행중: "협약을 맺고 지금 하고 있는 건",
  종료: "끝난 건. 정산이 남아 있어도 종료로 둔다",
  신청중: "아직 선정 전. 과제사업 대장에서는 숨고 지원사업 대장에 뜬다",
}

/** `app.funding_schemes` 를 화면에서 다시 읽지 않아도 되게 라벨만 옮겨 둔다. */
export const 사업유형_라벨: Record<string, string> = {
  NATIONAL_RND: "국가 R&D",
  LOCAL_TP: "지자체·TP 지원사업",
}
