import { getSchemeChoices } from "@/lib/queries-schemes"
import { ProjectCreateDialog } from "@/components/project-create-dialog"

/**
 * 대장 화면의 [+ 기존 사업 옮겨 담기] 버튼.
 *
 * ⚠ 서버에서 사업유형을 읽어 클라이언트 대화상자에 넘기려고 **한 겹 감쌌다.**
 *   `app/(app)/projects/page.tsx` 는 네 명이 동시에 여는 파일이라(지금도 남의 미커밋 변경이 있다)
 *   거기에 import 와 조회를 늘리지 않는다 — **한 줄만 넣게** 하는 것이 이 파일의 목적이다.
 *   사업유형을 코드에 박지 않는 이유는 CLAUDE.md §0.5(「사업유형은 데이터다」).
 */
export async function ProjectCreateButton() {
  const { rows } = await getSchemeChoices()
  return <ProjectCreateDialog 사업유형들={rows} />
}
