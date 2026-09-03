import { ProgramsStageView } from "@/components/programs-stage-view"

export const dynamic = "force-dynamic"

/**
 * 지원사업 > **지원사업 관리**(전체).
 *
 * 경로를 `/programs` 그대로 둔다 — 원래 「사업 대장」이 이 주소였고, 이미 여러
 * 화면·링크·API(`/api/programs/xlsx`)·북마크가 가리키고 있다(2026-09-04 이름만 바꿈).
 * 신청중·수행중·사업종료는 `/programs/applying` · `/programs/executing` · `/programs/closed`다.
 */
export default function ProgramsPage() {
  return <ProgramsStageView 단계="전체" />
}
