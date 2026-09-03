/**
 * 증빙 요건·파일의 행 타입. **서버와 클라이언트가 같이 읽는다.**
 *
 * `lib/queries-project.ts` 는 `server-only` 를 import 하고 있어서 클라이언트 컴포넌트가
 * 그 파일에서 타입을 가져오면 빌드가 깨진다. 그래서 타입만 여기 따로 둔다 —
 * 어느 쪽에도 런타임 코드가 없으므로 양쪽에서 안전하게 import 된다.
 *
 * DB 컬럼명이 한글이라 타입도 한글로 맞춘다(다른 파일과 같은 규칙). 매핑 계층을 하나 줄인다.
 */

export type EvidenceRequirement = {
  id: number
  비목_대분류: string
  /** 물품·용역 | 출장 | 회의 | 급여 | 산출근거. null = 그 비목 전체에 해당. */
  구분: string | null
  /** 매그나텍 실제 제출 폴더의 파일 번호(1~7)와 같다. */
  순번: number
  서류명: string
  필수여부: boolean
  /** true = 개인 급여가 드러나는 서류. 업로드를 코드로 막는다(CLAUDE.md §5 절대규칙 5). */
  개인정보포함: boolean
  원문: string | null
  출처: string
}

export type EvidenceFile = {
  id: number
  비목_대분류: string
  요건_id: number | null
  파일명: string
  크기: number | null
  업로더: string
  /** false = 로그인 세션 없이 올라간 파일. 화면에 「미인증」으로 그대로 표시한다. */
  업로더_인증: boolean
  업로드일시: string
}
