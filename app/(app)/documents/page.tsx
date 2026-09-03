import { PageShell } from "@/components/page-shell"
import { DbError } from "@/components/db-error"
import { DocumentShelf } from "@/components/document-shelf"
import {
  getDocumentShelf,
  getDocumentFiles,
  getUnmatchedDocs,
} from "@/lib/queries-documents"

export const dynamic = "force-dynamic"

/**
 * 서류함.
 *
 * 「어차피 계속 낼 서류가 무엇인가」에 답한다. 목록을 손으로 관리하지 않는다 —
 * 수집한 공고의 요구서류(app.ann_required_docs)를 **서류 종류로 묶어** 계산한다.
 * 같은 서류를 공고마다 다른 이름으로 부르기 때문이다(실측):
 *   사업자등록증 · 사업자등록증 사본 · 사업자 등록증 · 사업자등록증 사본(사업자등록증명원)
 * 이름으로 세면 흩어져서 「22개 공고가 사업자등록증을 요구」가 안 나온다.
 *
 * 유효기간 우선순위 — **공고문 명시 > 공공문서 기본 90일**. 사업자등록증은 유효기간이 없다.
 * 여러 공고가 서로 다르게 말하면 가장 짧은 것을 쓴다(어느 공고에도 낼 수 있어야 한다).
 *
 * ⚠ 서류의 **내용은 저장하지 않는다.** 발급일·발급기관·종류만 쓴다 — 개인정보를 안 만진다(§2-6).
 */
export default async function DocumentsPage() {
  const [shelf, files, unmatched] = await Promise.all([
    getDocumentShelf(),
    getDocumentFiles(),
    getUnmatchedDocs(),
  ])

  const error = shelf.error ?? files.error ?? unmatched.error

  return (
    <PageShell
      title="서류함"
      description="공고가 반복해서 요구하는 서류를 종류로 묶어, 우리가 가지고 있는지와 아직 유효한지 본다."
    >
      {error && <DbError what="서류함" error={error} />}
      <DocumentShelf shelf={shelf.rows} files={files.rows} unmatched={unmatched.rows} />
    </PageShell>
  )
}
