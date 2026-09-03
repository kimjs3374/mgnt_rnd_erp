/**
 * 최종 정산 서류의 행 타입과 「기간이 끝났는가」 판정. **서버와 클라이언트가 같이 읽는다.**
 *
 * `lib/queries-settlement.ts` 는 `server-only` 를 import 하므로 클라이언트 컴포넌트가 거기서
 * 타입을 가져오면 빌드가 깨진다. 그래서 타입만 여기 둔다(`lib/evidence-types.ts` 와 같은 이유).
 * `"use server"` 파일도 export 가 전부 async 함수여야 해서 상수·순수 함수를 담지 못한다.
 */

export type SettlementDocument = {
  id: number
  과제_id: number
  서류종류: string
  정산연차: number | null
  제출일: string | null
  비고: string | null
  파일명: string
  크기: number | null
  업로더: string
  업로더_인증: boolean
  업로드일시: string
}

/**
 * 화면이 먼저 보여주는 자리. DB 에는 CHECK 가 없다 — 정산 서류 이름이 사업마다 다르다
 * (RCMS 「정산보고서」 / 지자체 「사업비 정산 내역서」 / TP 「집행실적보고서」).
 * 그 밖은 「기타」로 받는다.
 */
export const 정산서류_기본 = ["정산보고서", "정산결과 통보서", "잔액 반납 증빙"] as const
export const 정산서류_후보 = [
  "정산보고서",
  "정산결과 통보서",
  "잔액 반납 증빙",
  "이자 반납 증빙",
  "기타",
]

/**
 * **협약기간이 끝났는가.** 최종 정산 파일은 여기서부터 받는다(2026-09-04 사용자 지시).
 *
 * 상태를 먼저 본다 — 사람이 「종료」로 바꿨으면 날짜보다 그 판단이 앞선다.
 * 날짜만 보면 상태가 아직 「수행중」인 채로 기간이 지난 과제를 놓치고,
 * 상태만 보면 기간이 끝났는데 아직 상태를 안 바꾼 과제를 놓친다. 둘 중 하나라도 참이면 끝난 것으로 본다.
 *
 * ⚠ 종료일이 없으면 **끝나지 않은 것으로 본다.** 모르는 것을 「끝났다」로 단정하면
 *   아직 수행 중인 과제에 최종 정산을 받게 된다(설계원칙 5).
 */
export function 기간끝났나(
  상태: string | null | undefined,
  종료일: string | null | undefined,
  오늘: string,
): boolean {
  if (상태 === "종료") return true
  if (!종료일) return false
  return 종료일 < 오늘
}

/** KST 기준 오늘(YYYY-MM-DD). 서버·클라이언트가 같은 값을 봐야 판정이 흔들리지 않는다. */
export function 오늘_KST(now: Date = new Date()): string {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`
}
