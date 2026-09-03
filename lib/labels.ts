import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * 비목 코드 → 한글 이름.
 *
 * `expenses.비목_대분류` 는 `FACILITY` 같은 코드값이다. 화면에 그대로 내보내면
 * 심사장에서 `INDIRECT › COMMON_COST` 가 보인다. 마스터 테이블에서 이름을 가져온다.
 *
 * PostgREST 관계 조인 대신 맵을 따로 받아 JS 에서 합친다 —
 * FK 이름에 의존하지 않아 스키마가 흔들려도 화면이 안 죽는다. 두 테이블 다 20행 남짓이다.
 */
export type LabelMap = { cat: Record<string, string>; sub: Record<string, string> }

export async function getLabels(): Promise<LabelMap> {
  const [c, s] = await Promise.all([
    safeSelect<{ 코드: string; 이름: string }>("categories", () =>
      db.from("categories").select("*"),
    ),
    safeSelect<{ 코드: string; 이름: string }>("sub_categories", () =>
      db.from("sub_categories").select("*"),
    ),
  ])

  const toMap = (rows: { 코드: string; 이름: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.코드, r.이름]))

  return { cat: toMap(c.rows), sub: toMap(s.rows) }
}

/** 「연구활동비 › 지식재산 창출 활동비」 형태로. 이름을 못 찾으면 코드를 그대로 보여준다. */
export function categoryLabel(
  labels: LabelMap,
   대분류: string | null,
  세부항목: string | null,
): { main: string; sub: string | null } {
  if (!대분류) return { main: "미분류", sub: null }
  return {
    main: labels.cat[대분류] ?? 대분류,
    sub: 세부항목 ? (labels.sub[세부항목] ?? 세부항목) : null,
  }
}
