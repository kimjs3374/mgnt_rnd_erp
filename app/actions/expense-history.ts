"use server"

import { db } from "@/lib/db"
import { 공개주소 } from "@/lib/storage-url"

/**
 * 집행 한 건의 **처리 이력**과 **보관된 증빙 파일**.
 *
 * 집행 결과 표는 이미 회사에 있다. 없는 것은 「왜 그 비목으로 넣었는지」다 —
 * AI 가 뭘 제안했고, 사람이 뭘로 확정했고, 왜 고쳤는지. 그게 `app.expense_events` 에 쌓인다.
 *
 * 이력은 봇이 남긴다(업로드·판독·질문·수정·확정·보관·재학습). 여기서는 읽기만 한다 —
 * 화면에서 이력을 고칠 수 있으면 그건 더 이상 이력이 아니다.
 */

export type HistoryEvent = {
  id: number
  행위: string
  행위자: string | null
  요약: string | null
  상세: Record<string, unknown> | null
  created_at: string
}

export type EvidenceLink = {
  id: number
  파일명: string
  url: string | null
}

export async function getExpenseHistory(집행_id: number): Promise<HistoryEvent[]> {
  // ⚠ 컬럼을 골라 적으면 supabase-js 의 타입 파서가 한글 컬럼명에서 막힌다
  //   (ParserError: Expected identifier). 이 프로젝트의 다른 액션들처럼 `*` 로 받고
  //   unknown 을 거쳐 형을 준다.
  const { data, error } = await db
    .from("expense_events")
    .select("*")
    .eq("expense_id", 집행_id)
    .order("id", { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as HistoryEvent[]
}

/**
 * 봇이 Storage 에 보관한 증빙 파일의 **다운로드 링크**.
 *
 * ⚠ `project_evidence_files`(계상 단계에서 사람이 올리는 서류)와 다른 테이블이다.
 *   봇이 Slack 에서 받아 확정 시점에 올린 증빙은 `app.evidence` 에 있다.
 *   확정 전에는 `storage_path` 가 비어 있다 — 그때는 아직 Storage 에 아무것도 없다.
 *
 * 서명 URL 은 1시간짜리다. 화면을 오래 열어 두면 만료되므로 열 때마다 새로 만든다.
 */
export async function getExpenseEvidence(집행_id: number): Promise<EvidenceLink[]> {
  const { data, error } = await db
    .from("evidence")
    .select("*")
    .eq("expense_id", 집행_id)
    .order("id", { ascending: true })
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as Array<{
    id: number
    파일명: string | null
    storage_path: string | null
  }>

  const out: EvidenceLink[] = []
  for (const r of rows) {
    let url: string | null = null
    if (r.storage_path) {
      const { data: signed } = await db.storage
        .from("evidence")
        .createSignedUrl(r.storage_path, 3600)
      url = 공개주소(signed?.signedUrl) ?? null
    }
    out.push({ id: r.id, 파일명: r.파일명 ?? `증빙 ${r.id}`, url })
  }
  return out
}
