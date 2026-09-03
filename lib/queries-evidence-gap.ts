import "server-only"
import { db, safeSelect } from "@/lib/db"
// 타입은 클라이언트 컴포넌트(목록 카드)도 읽어야 해서 따로 있다 — 이 파일은 server-only 다.
import type { 빈건, 증빙구멍 } from "@/lib/evidence-gap-types"

export type { 빈건, 증빙구멍 }

/**
 * **사업비 증빙이 빈 곳**을 과제별로 센다. (2026-09-04 사용자 지시)
 *
 * 세는 대상은 **집행 건별 증빙**이다 — 실제로 돈을 쓴 건에 붙어야 하는 서류
 * (구매의뢰서 · 지출결의서 · 거래명세서 · 세금계산서 · 검수조서, `db/100`).
 * 계상 탭의 비목별 요건은 「무엇이 필요한가」 목록이고, 정산에서 반려되는 것은 **집행 건 쪽**이다.
 *
 * ⚠ `lib/queries.ts` 에 넣지 않는다. 네 명이 동시에 여는 파일이라 저장 충돌이 두 번 났다.
 */

type 집행Raw = {
  id: number
  과제_id: number | null
  비목_대분류: string | null
  일자: string | null
  거래처: string | null
  합계: number | null
}
type 요건Raw = {
  id: number
  비목_대분류: string
  집행단위: boolean
  필수여부: boolean
  서류명: string
}
type 파일Raw = { 집행_id: number | null; 요건_id: number | null }
/** 지금 면제 상태인 칸(db/114 의 `v_evidence_waiver_now`). 최신 행이 「면제」인 것만 온다. */
type 면제Raw = {
  집행_id: number
  요건_id: number
  사유: string
  사유유형: string | null
  행위자: string
  일시: string
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
  const [집행, 요건, 파일, 면제] = await Promise.all([
    safeSelect<집행Raw>("expenses", () => db.from("expenses").select("*")),
    safeSelect<요건Raw>("evidence_requirements", () =>
      db.from("evidence_requirements").select("*"),
    ),
    safeSelect<파일Raw>("project_evidence_files", () =>
      db.from("project_evidence_files").select("*"),
    ),
    // 사람이 「이 서류는 없어도 된다」고 사유를 적어 면제한 칸. 미비에서 빼되 목록에는 남긴다.
    safeSelect<면제Raw>("v_evidence_waiver_now", () =>
      db.from("v_evidence_waiver_now").select("*"),
    ),
  ])
  const error = 집행.error ?? 요건.error ?? 파일.error ?? 면제.error ?? null
  if (error) return { gaps: {}, error }

  // 비목별 **집행단위 필수** 요건 id 들. 이게 한 집행 건이 채워야 할 칸이다.
  const 필수 = new Map<string, number[]>()
  for (const r of 요건.rows) {
    if (!r.집행단위 || !r.필수여부) continue
    필수.set(r.비목_대분류, [...(필수.get(r.비목_대분류) ?? []), Number(r.id)])
  }
  // 요건 id → 서류명. 「지출결의서가 없다」까지 말해야 사람이 무엇을 준비할지 안다.
  const 서류명 = new Map(요건.rows.map((r) => [Number(r.id), String(r.서류명 ?? "이름 없는 서류")]))

  // (집행, 요건) → 면제. 「채워졌다」가 아니라 **「사유를 달고 비워 뒀다」**로 따로 센다.
  const 면제맵 = new Map<string, 면제Raw>()
  for (const w of 면제.rows) 면제맵.set(`${Number(w.집행_id)}:${Number(w.요건_id)}`, w)

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
    const 안채운것 = 칸.filter((id) => !있는것.has(id))
    // 면제된 칸은 **미비가 아니다**(사용자 지시). 대신 몇 칸을 왜 면제했는지 같이 들고 간다.
    const 면제된것 = 안채운것.filter((id) => 면제맵.has(`${Number(e.id)}:${id}`))
    const 빈목록 = 안채운것.filter((id) => !면제맵.has(`${Number(e.id)}:${id}`))
    const 빈 = 빈목록.length

    const cur =
      gaps[pid] ??
      ({ 집행건: 0, 빈집행건: 0, 빈칸: 0, 면제칸: 0, 빈집행ids: [], 상세: [] } as 증빙구멍)
    cur.집행건 += 1
    cur.면제칸 += 면제된것.length
    if (빈 > 0) {
      cur.빈집행건 += 1
      cur.빈집행ids.push(Number(e.id))
      cur.상세.push({
        집행_id: Number(e.id),
        일자: e.일자 ?? null,
        거래처: e.거래처 ?? null,
        합계: e.합계 == null ? null : Number(e.합계),
        비목_대분류: e.비목_대분류 ?? null,
        빠진서류: 빈목록.map((id) => 서류명.get(id) ?? `요건 ${id}`),
        // 면제 버튼이 이 id 를 서버에 보낸다 — 이름만 있으면 어느 칸인지 서버가 모른다.
        빠진요건ids: 빈목록,
        면제: 면제된것.map((id) => {
          const w = 면제맵.get(`${Number(e.id)}:${id}`)!
          return {
            요건_id: id,
            서류명: 서류명.get(id) ?? `요건 ${id}`,
            사유: w.사유,
            행위자: w.행위자,
            일시: w.일시,
          }
        }),
      })
    } else if (면제된것.length > 0) {
      // 다 채웠거나 면제로 정리된 건도 **면제 내역은 보여준다** — 「왜 정상인가」가 거기 있다.
      cur.상세.push({
        집행_id: Number(e.id),
        일자: e.일자 ?? null,
        거래처: e.거래처 ?? null,
        합계: e.합계 == null ? null : Number(e.합계),
        비목_대분류: e.비목_대분류 ?? null,
        빠진서류: [],
        빠진요건ids: [],
        면제: 면제된것.map((id) => {
          const w = 면제맵.get(`${Number(e.id)}:${id}`)!
          return {
            요건_id: id,
            서류명: 서류명.get(id) ?? `요건 ${id}`,
            사유: w.사유,
            행위자: w.행위자,
            일시: w.일시,
          }
        }),
      })
    }
    cur.빈칸 += 빈
    gaps[pid] = cur
  }

  // 오래된 집행부터 처리하는 것이 자연스럽다 — 정산 마감이 먼저 닿는 쪽이다.
  const 일자 = new Map(집행.rows.map((e) => [Number(e.id), String(e.일자 ?? "")]))
  for (const k of Object.keys(gaps)) {
    gaps[Number(k)].빈집행ids.sort((a, b) => (일자.get(a) ?? "").localeCompare(일자.get(b) ?? ""))
    gaps[Number(k)].상세.sort((a, b) => (a.일자 ?? "").localeCompare(b.일자 ?? ""))
  }

  // 다 채운 과제는 목록에서 뺀다 — 「구멍이 있는 곳」만 남겨야 화면이 조용하다.
  // 미비가 0 이면 카드에서 뺀다 — **면제만 남은 과제는 「정상」이다**(사용자 지시).
  // 면제 내역은 그 과제 집행 탭에서 계속 보인다(여기서 세지 않는 것과 기록을 지우는 것은 다르다).
  for (const k of Object.keys(gaps)) {
    if (gaps[Number(k)].빈칸 === 0) delete gaps[Number(k)]
  }
  return { gaps, error: null }
}
