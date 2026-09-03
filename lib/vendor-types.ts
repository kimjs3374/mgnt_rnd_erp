/**
 * 업체(거래처) 대장의 행 타입과 사업자번호 처리. **서버와 클라이언트가 같이 읽는다.**
 *
 * `lib/queries-vendors.ts` 는 `server-only` 를 import 하므로 클라이언트 컴포넌트가 거기서
 * 타입을 가져오면 빌드가 깨진다. 그래서 타입만 여기 따로 둔다(`lib/evidence-types.ts` 와 같은 이유).
 * `"use server"` 파일도 export 가 전부 async 함수여야 해서 상수를 담지 못한다 —
 * 사업자번호 유틸이 여기 있는 이유다.
 *
 * DB 컬럼명이 한글이라 타입도 한글로 맞춘다. 매핑 계층을 하나 줄인다.
 */

/** `app.v_vendor_status` 한 줄 — 업체 + 서류 확보 현황 + 그 업체로 나간 집행. */
export type VendorRow = {
  id: number
  업체명: string
  /** 하이픈 없는 10자리. null = 아직 등록증을 못 받아 번호를 모르는 업체. */
  사업자번호: string | null
  대표자: string | null
  은행: string | null
  계좌번호: string | null
  예금주: string | null
  비고: string | null
  updated_at: string
  등록증_건수: number
  통장사본_건수: number
  기타_건수: number
  /** 사업자번호로 이은 집행 건수. 이름으로 잇지 않는다 — 표기가 갈린다. */
  집행건수: number
  집행액: number
}

/** 업체 상세 편집 폼이 쓰는 전체 컬럼(뷰에 없는 것까지). */
export type VendorDetail = VendorRow & {
  업태: string | null
  종목: string | null
  주소: string | null
  연락처: string | null
  이메일: string | null
}

export type VendorDocument = {
  id: number
  업체_id: number
  서류종류: string
  발급일: string | null
  비고: string | null
  파일명: string
  크기: number | null
  업로더: string
  /** false = 로그인 세션 없이 올라간 파일. 화면에 「미인증」으로 그대로 표시한다. */
  업로더_인증: boolean
  업로드일시: string
}

/** 집행 건에는 있는데 대장에 없는 거래처. 빈 화면에서 「여기서 시작하라」를 보여준다. */
export type 미등록거래처 = {
  거래처: string
  사업자번호: string | null
  건수: number
  합계: number
}

/** 화면이 먼저 보여주는 두 자리 + 그 밖. DB 에는 CHECK 가 없다(요구 서류가 사업마다 다르다). */
export const 업체서류_기본 = ["사업자등록증", "통장사본"] as const
export const 업체서류_후보 = ["사업자등록증", "통장사본", "계약서", "청렴계약이행서약서", "기타"]

/**
 * 사업자번호는 **숫자만** 저장한다.
 * 증빙마다 `123-45-67890` · `1234567890` 로 표기가 섞여 들어오는데, 그대로 두면
 * `app.expenses.거래처_사업자번호` 와 못 붙어서 집행 건이 안 잡힌다. DB CHECK 도 같은 규칙이다.
 */
export const 사업자번호_숫자만 = (s: string) => s.replace(/[^0-9]/g, "")

/** 화면 표기용 `123-45-67890`. 저장값은 건드리지 않는다. */
export function 사업자번호_표기(s: string | null): string {
  if (!s) return "—"
  const d = 사업자번호_숫자만(s)
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : s
}

/** 못 받는 값이면 **사람이 읽을 이유**를, 비었거나 올바르면 null 을 낸다. */
export function 사업자번호_점검(raw: string): string | null {
  const d = 사업자번호_숫자만(raw)
  if (!d) return null // 모르는 채로 등록하는 것을 막지 않는다
  if (d.length === 9) {
    // 실측: 집행 건에 `268870567`(9자리)이 들어 있다 — 증빙에서 읽을 때 맨 앞 0 이 떨어진다.
    // **0 을 붙여 짐작하지 않는다.** 어느 자리가 떨어졌는지는 등록증만이 안다.
    return (
      `사업자번호는 숫자 10자리인데 9자리입니다. 증빙에서 읽은 번호는 맨 앞 0 이 떨어져 ` +
      `9자리로 남는 경우가 있습니다 — 사업자등록증을 보고 채우세요.`
    )
  }
  if (d.length !== 10) return `사업자번호는 숫자 10자리입니다 — 지금 ${d.length}자리입니다.`
  return null
}
