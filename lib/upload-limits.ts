/**
 * 업로드 제한 — **서버와 클라이언트가 같은 값을 본다.**
 *
 * 최종 판정자는 서버 액션(`app/actions/evidence-files.ts` · `app/actions/rule-files.ts`)이다.
 * 화면은 같은 규칙으로 미리 걸러서, 못 받을 파일을 회선으로 끝까지 올려보낸 뒤 거절하는 일을 없앤다
 * (드래그드랍은 한 번에 여러 개가 들어와 이 낭비가 곱절이 된다). 화면 검사는 우회할 수 있으므로
 * **서버 검사를 지우지 않는다.** 두 겹이다.
 *
 * 증빙이든 규정이든 제한은 같아서 한 벌만 둔다. 순수 함수·상수뿐이라 양쪽에서 안전하게 읽는다.
 */

/** 25MB. 공고문 hwp·관리지침 pdf 가 보통 0.1~1.5MB 다. 더 큰 건 원본 링크로 두는 편이 낫다. */
export const 문서_최대크기 = 25 * 1024 * 1024

/** 받는 확장자. 실행 파일을 받지 않는 것이 목적이다. */
export const 문서_허용확장자 = new Set([
  "pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "jpg", "jpeg", "png", "gif", "webp", "heic", "zip", "csv", "txt",
])

export function 문서_확장자(name: string) {
  const i = name.lastIndexOf(".")
  return i < 0 ? "" : name.slice(i + 1).toLowerCase()
}

/** 받을 수 없는 파일이면 **사람이 읽을 이유**를, 받을 수 있으면 null 을 낸다. */
export function 문서파일_점검(file: { name: string; size: number }): string | null {
  if (file.size === 0) return `${file.name} 은 빈 파일입니다.`
  if (file.size > 문서_최대크기) {
    return `${file.name} 이 ${(file.size / 1024 / 1024).toFixed(1)}MB 입니다. 25MB 까지만 올릴 수 있습니다.`
  }
  const ext = 문서_확장자(file.name)
  if (!문서_허용확장자.has(ext)) {
    return `.${ext || "확장자 없음"} 은 받지 않습니다. pdf·hwp·xlsx·이미지·zip 으로 올리세요.`
  }
  return null
}
