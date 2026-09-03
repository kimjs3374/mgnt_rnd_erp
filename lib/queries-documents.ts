import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * 서류함 — app.v_document_shelf 뷰 하나만 읽는다.
 * 유효기간 계산(공고문 명시 > 공공문서 기본 90일)은 전부 DB 안에서 끝난다.
 * 화면이 날짜를 계산하면 브라우저 시계를 믿게 되는데, 심사장 PC 의 시간대를 믿을 수 없다.
 */

export type ShelfRow = {
  코드: string
  이름: string
  발급처: string | null
  공공문서: boolean
  유효기간_종류: string
  비고: string | null
  정렬: number
  요구공고수: number
  필수공고수: number
  구분: "필수" | "참고" | "미요구"
  적용_유효일수: number | null
  유효기간_근거: string | null
  발급일: string | null
  결산연도: number | null
  파일명: string | null
  storage_path: string | null
  보유: boolean
  만료일: string | null
  상태: string
}

export const getDocumentShelf = () =>
  safeSelect<ShelfRow>("v_document_shelf", () =>
    db.from("v_document_shelf").select("*").order("정렬"),
  )

/** 우리가 올린 서류 원본 — 판독 이력(무엇을 제안했고 사람이 뭘로 확정했는지)까지. */
export type DocumentRow = {
  id: number
  doc_type: string
  발급일: string | null
  결산연도: number | null
  파일명: string | null
  발급기관: string | null
  ai_발급일: string | null
  ai_확신도: number | null
  ai_근거: string | null
  확정_방법: string | null
  created_at: string
}

export const getDocumentFiles = () =>
  safeSelect<DocumentRow>("documents", () =>
    db.from("documents").select("*").order("created_at", { ascending: false }),
  )

/**
 * 공고가 요구했는데 서류 종류로 못 묶은 것.
 * 대부분 서식(계획서·확약서·동의서)이라 보관 대상이 아니지만, 빠뜨린 실제 증빙이
 * 여기 섞여 있을 수 있어 조용히 버리지 않는다.
 */
export type UnmatchedRow = {
  서류명: string
  요구공고수: number
  필수공고수: number
  공고_최단유효일수: number | null
}

export const getUnmatchedDocs = () =>
  safeSelect<UnmatchedRow>("v_doc_unmatched", () =>
    db.from("v_doc_unmatched").select("*").order("요구공고수", { ascending: false }).limit(60),
  )
