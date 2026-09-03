/**
 * 규정 문서함의 행 타입과 화면이 제안하는 값. **서버와 클라이언트가 같이 읽는다.**
 *
 * `app/actions/rule-files.ts` 는 `"use server"` 라 **export 가 전부 async 함수**여야 한다 —
 * 타입·상수를 거기 두면 빌드가 깨진다. `lib/queries-rules.ts` 는 `server-only` 라
 * 클라이언트가 못 읽는다. 그래서 둘 사이의 공용 자리가 이 파일이다.
 */

/** `app.funding_share_rules` 의 우선순위와 **같은 축**이다: 공고 > 사업유형 > 공통. */
export type 적용범위 = "공고" | "사업유형" | "공통"

export type RuleDocument = {
  id: number
  적용범위: 적용범위
  announcement_id: number | null
  사업유형: string | null
  문서종류: string
  제목: string
  발행기관: string | null
  발행일: string | null
  버전: string | null
  /** 이 문서의 어디를 근거로 쓰는지(예: `p.31 정부지원 비율표`). 쪽수 없이 인용하지 않는다. */
  근거메모: string | null
  파일명: string
  크기: number | null
  업로더: string
  /** false = 로그인 게이트가 붙기 전에 올라간 파일. 화면에 그대로 표시한다. */
  업로더_인증: boolean
  업로드일시: string
}

/** 공고·사업유형 고르는 칸에 쓸 최소 정보. */
export type 공고선택지 = { id: number; 사업명: string; 소관부처: string | null; 공고일: string | null }
export type 사업유형선택지 = { 코드: string; 이름: string }

/**
 * 화면이 제안하는 흔한 문서종류. **DB 에 CHECK 를 걸지 않았다** —
 * 지자체 사업은 「사업설명회 자료」, 국가 R&D 는 「연차보고 서식」처럼 서류 이름이 사업마다 다르다.
 * CHECK 로 박으면 한 유형만 돌아간다(CLAUDE.md §0.5 「사업유형은 데이터다」와 같은 이유).
 * 그래서 여기는 **제안**이고, 사람이 다른 값을 직접 쓸 수 있다.
 */
export const 문서종류_후보 = [
  "공고문",
  "신청 유의사항",
  "관리지침",
  "연구개발비 사용기준",
  "서식",
  "협약서",
  "기타",
] as const
