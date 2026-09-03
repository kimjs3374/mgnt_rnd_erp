import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * **사업비 증빙이 빈 곳**을 과제별로 센다. (2026-09-04 사용자 지시)
 *
 * 세는 대상은 **집행 건별 증빙**이다 — 실제로 돈을 쓴 건에 붙어야 하는 서류
 * (구매의뢰서 · 지출결의서 · 거래명세서 · 세금계산서 · 검수조서, `db/100`).
 * 계상 탭의 비목별 요건은 「무엇이 필요한가」 목록이고, 정산에서 반려되는 것은 **집행 건 쪽**이다.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않는다. 네 명이 동시에 여는 파일이라 저장 충돌이 두 번 났다.
 */

type 집행Raw = { id: number; 과제_id: number | null; 비목_대분류: string | null }
type 요건Raw = { id: number; 비목_대분류: string; 집행단위: boolean; 필수여부: boolean }
type 파일Raw = { 집행_id: number | null; 요건_id: number | null }

export type 증빙구멍 = {
  /** 증빙이 필요한 집행 건수(그 과제에서). */
  집행건: number
  /** 그중 필수 서류가 하나라도 빈 건수. */
  빈집행건: number
  /** 안 채운 필수 서류 칸 수(건 × 서류). 「얼마나 남았나」는 이 숫자가 말해 준다. */
  빈칸: number
}

/**
 * 과제 id → 증빙 구멍. 구멍이 없는 과제는 **키 자체를 안 만든다**(화면이 `?.` 로 읽는다).
 *
 * ⚠ 조회가 실패하면 **빈 객체**를 돌려준다. 못 읽었다고 「증빙 미비 0」이라고 말하면
 *   거짓말이 되지만, 화면이 죽는 것보다는 낫다 — 대신 `error` 를 같이 준다.
 */
export async function getEvidenceGaps(): Promise<{
  gaps: Record<number, 증빙구멍>
  error: string | null
}> {
  const [집행, 요건, 파일] = await Promise.all([
    safeSelect<집행Raw>("expenses", () => db.from("expenses").select("*")),
    safeSelect<요건Raw>("evidence_requirements", () =>
      db.from("evidence_requirements").select("*"),
    ),
    safeSelect<파일Raw>("project_evidence_files", () =>
      db.from("project_evidence_files").select("*"),
    ),
  ])
  const error = 집행.error ?? 요건.error ?? 파일.error ?? null
  if (error) return { gaps: {}, error }

  // 비목별 **집행단위 필수** 요건 id 들. 이게 한 집행 건이 채워야 할 칸이다.
  const 필수 = new Map<string, number[]>()
  for (const r of 요건.rows) {
    if (!r.집행단위 || !r.필수여부) continue
    필수.set(r.비목_대분류, [...(필수.get(r.비목_대분류) ?? []), Number(r.id)])
  }

  // 집행 건별로 붙은 요건 id.
  const 붙음 = new Map<number, Set<number>>()
  for (const f of 파일.rows) {
    const e = Number(f.집행_id ?? 0)
    if (!e || f.요건_id == null) continue
    const s = 붙음.get(e) ?? new Set<number>()
    s.add(Number(f.요건_id))
    붙음.set(e, s)
  }

  const gaps: Record<number, 증빙구멍> = {}
  for (const e of 집행.rows) {
    const pid = Number(e.과제_id ?? 0)
    if (!pid) continue // 과제가 아직 안 정해진 집행은 여기서 안 센다(대장 아래에 따로 알린다)
    const 칸 = 필수.get(String(e.비목_대분류 ?? "")) ?? []
    if (!칸.length) continue // 이 비목은 집행 건별 증빙을 요구하지 않는다(인건비·간접비 등)

    const 있는것 = 붙음.get(Number(e.id)) ?? new Set<number>()
    const 빈 = 칸.filter((id) => !있는것.has(id)).length

    const cur = gaps[pid] ?? { 집행건: 0, 빈집행건: 0, 빈칸: 0 }
    cur.집행건 += 1
    if (빈 > 0) cur.빈집행건 += 1
    cur.빈칸 += 빈
    gaps[pid] = cur
  }

  // 다 채운 과제는 목록에서 뺀다 — 「구멍이 있는 곳」만 남겨야 화면이 조용하다.
  for (const k of Object.keys(gaps)) {
    if (gaps[Number(k)].빈칸 === 0) delete gaps[Number(k)]
  }
  return { gaps, error: null }
}
