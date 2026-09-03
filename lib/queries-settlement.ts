import "server-only"
import { db, safeSelect } from "@/lib/db"
import type { SettlementDocument } from "@/lib/settlement-types"

/**
 * 최종 정산 서류 조회.
 *
 * ⚠ `lib/queries.ts` 나 `lib/queries-project.ts` 에 넣지 않는다 — 여러 화면이 같이 쓰는 파일이라
 *   네 명이 동시에 연다. 같은 파일을 둘이 열면 나중에 저장한 쪽이 덮어쓰고 git 이 막아주지 않는다
 *   (실제로 세 번 났다 — `_팀로그/memory/queries-ts-concurrent-save.md`).
 *
 * ⚠ `select("id,서류종류,…")` 로 컬럼을 추리지 않는다. supabase-js 의 select 타입 파서가
 *   **한글 컬럼명을 식별자로 못 읽어** 컴파일이 깨진다. 이 저장소는 전부 `select("*")` 다.
 */
export const getSettlementDocuments = (과제_id: number) =>
  safeSelect<SettlementDocument>("settlement_documents", () =>
    db
      .from("settlement_documents")
      .select("*")
      .eq("과제_id", 과제_id)
      // 최근에 낸 것이 위로. 반려되어 다시 낸 건이 맨 위에 오는 것이 맞다.
      .order("업로드일시", { ascending: false }),
  )
