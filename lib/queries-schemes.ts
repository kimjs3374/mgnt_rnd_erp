import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * 사업유형 목록(`app.funding_schemes`).
 *
 * 원래 `lib/queries-rules.ts` 에 얹혀 있었다 — 규정 문서함이 「어느 사업유형에 적용되는 규정인가」를
 * 고르는 칸에 쓰려고 거기 뒀던 것이다. 2026-09-04 규정 문서함을 지우면서 이 조회만 남겼다.
 * 규정과는 상관없는, **사업유형이 데이터라는 사실**(CLAUDE.md §0.5) 때문에 있는 조회다.
 *
 * ⚠ `select("코드,이름")` 로 추리지 않는다 — supabase-js 의 select 타입 파서가 한글 컬럼명을
 *   식별자로 못 읽어 `ParserError` 로 컴파일이 깨진다. 컬럼 추리기는 화면에서 한다.
 */

export type 사업유형선택지 = { 코드: string; 이름: string }

export const getSchemeChoices = () =>
  safeSelect<사업유형선택지>("funding_schemes", () =>
    db.from("funding_schemes").select("*").order("코드"),
  )
