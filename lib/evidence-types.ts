/**
 * 증빙 요건·파일의 행 타입과 **업로드 제한**. 서버와 클라이언트가 같이 읽는다.
 *
 * `lib/queries-project.ts` 는 `server-only` 를 import 하고 있어서 클라이언트 컴포넌트가
 * 그 파일에서 타입을 가져오면 빌드가 깨진다. 그래서 타입을 여기 따로 둔다.
 *
 * ⚠ 아래쪽 업로드 제한은 **런타임 코드**다(원래 이 파일은 타입만 있었다).
 *   순수 함수·상수뿐이고 DB·`server-only` 를 건드리지 않으므로 양쪽에서 안전하다.
 *   여기에 서버 전용 코드를 들이면 클라이언트 번들이 깨지니 넣지 않는다.
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
  /** true = 집행 건 상세에서 첨부받는 서류(견적서·지출결의서·거래명세서·검수조서). */
  집행단위?: boolean
}

export type EvidenceFile = {
  id: number
  비목_대분류: string
  요건_id: number | null
  /** 집행 건에 붙은 증빙이면 그 건의 id. 비목 단위로 미리 올린 파일은 null. */
  집행_id: number | null
  파일명: string
  크기: number | null
  업로더: string
  /** false = 로그인 세션 없이 올라간 파일. 화면에 「미인증」으로 그대로 표시한다. */
  업로더_인증: boolean
  업로드일시: string
}

/* ------------------------------------------------------------------ *
 * 업로드 제한 — 서버와 클라이언트가 **같은 값**을 본다.
 *
 * 최종 판정자는 서버 액션(`app/actions/evidence-files.ts`)이다. 클라이언트는 같은 규칙으로
 * 미리 걸러서, 못 받을 파일을 회선으로 끝까지 올려보낸 뒤에 거절하는 일을 없앤다
 * (드래그드랍은 한 번에 여러 개가 들어와서 이 낭비가 곱절이 된다).
 * 두 곳에 따로 적으면 반드시 어긋나므로 여기 한 벌만 둔다.
 * ------------------------------------------------------------------ */

/** 25MB. 공고문·검수조서 스캔이 보통 1~5MB 다. 더 큰 건 RCMS 에 직접 올리는 편이 빠르다. */
export const 증빙_최대크기 = 25 * 1024 * 1024

/** 증빙으로 받는 확장자. 실행 파일을 받지 않는 것이 목적이다. */
export const 증빙_허용확장자 = new Set([
  "pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "jpg", "jpeg", "png", "gif", "webp", "heic", "zip", "csv", "txt",
])

export function 증빙_확장자(name: string) {
  const i = name.lastIndexOf(".")
  return i < 0 ? "" : name.slice(i + 1).toLowerCase()
}

/** 받을 수 없는 파일이면 **사람이 읽을 이유**를, 받을 수 있으면 null 을 낸다. */
export function 증빙파일_점검(file: { name: string; size: number }): string | null {
  if (file.size === 0) return `${file.name} 은 빈 파일입니다.`
  if (file.size > 증빙_최대크기) {
    return `${file.name} 이 ${(file.size / 1024 / 1024).toFixed(1)}MB 입니다. 25MB 까지만 올릴 수 있습니다.`
  }
  const ext = 증빙_확장자(file.name)
  if (!증빙_허용확장자.has(ext)) {
    return `.${ext || "확장자 없음"} 은 받지 않습니다. 증빙은 pdf·hwp·xlsx·이미지·zip 으로 올리세요.`
  }
  return null
}
