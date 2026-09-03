"use server"

import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"

/**
 * 내부 연구원 명부 — 등록 · 수정 · 연봉 갱신 · 퇴사 처리.
 *
 * 여기에도 AI 는 없다. 사람이 넣은 값을 그대로 저장하고, 월급여만 코드가 나눈다
 * (설계원칙 2 — 계산으로 확정되는 것은 LLM 에게 맡기지 않는다).
 *
 * ⚠ 개인정보: 이름·연구자등록번호·입사일·연봉이다(CLAUDE.md §5 절대규칙 5).
 *   **서버가 실명인지 가명인지 가릴 방법은 없다.** 기계가 판정할 수 있는 것만 막고
 *   (빈 값 · 길이 · 연도 범위 · 음수), 「가명을 쓰라」는 화면에서 말한다.
 *   `app.personnel_costs.표시명` 과 같은 처리다.
 *
 * ⚠ **연봉은 덮어쓰지 않고 연도별로 쌓는다.** 사용자 표현이 「1년 단위 업데이트」였다 —
 *   2024년 계상의 근거는 2024년 연봉이라, 올해 값으로 덮으면 지난 계상을 설명할 수 없게 된다.
 */

export type ResearcherResult = { ok: boolean; error?: string; id?: number }

const 글자 = (v: unknown, max = 60) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim()
  return s.slice(0, max)
}
const 정수 = (v: unknown) => {
  const n = Math.round(Number(String(v ?? "").replace(/[,\s]/g, "")))
  return Number.isFinite(n) ? n : 0
}
const 날짜 = (v: unknown) => {
  const s = String(v ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export type 연구원입력 = {
  id?: number | null
  표시명: string
  연구자등록번호?: string | null
  입사일자?: string | null
  소속기관?: string | null
  소속부서?: string | null
  직급?: string | null
  내외부?: string
  국적?: string | null
  연봉: number | string
  연봉_기준연도?: number | null
  재직?: boolean
  비고?: string | null
}

export async function saveResearcher(입력: 연구원입력): Promise<ResearcherResult> {
  try {
    const 표시명 = 글자(입력.표시명, 40)
    if (!표시명) return { ok: false, error: "이름(표시명)을 넣어야 합니다." }

    const 연봉 = 정수(입력.연봉)
    if (연봉 < 0) return { ok: false, error: "연봉은 0 보다 작을 수 없습니다." }
    // 실수로 월급여를 넣는 일이 잦다. 막지는 않고 되묻게만 한다 — 정말 그런 사람도 있다.
    const 올해 = new Date().getFullYear()
    const 기준연도 = 입력.연봉_기준연도 == null ? 올해 : 정수(입력.연봉_기준연도)
    if (기준연도 < 2000 || 기준연도 > 올해 + 5) {
      return { ok: false, error: `연봉 기준연도가 이상합니다 (${기준연도}).` }
    }
    const 내외부 = 입력.내외부 === "외부" ? "외부" : "내부"

    const row = {
      표시명,
      연구자등록번호: 글자(입력.연구자등록번호, 40) || null,
      입사일자: 날짜(입력.입사일자),
      소속기관: 글자(입력.소속기관, 60) || null,
      소속부서: 글자(입력.소속부서, 60) || null,
      직급: 글자(입력.직급, 40) || null,
      내외부,
      국적: 글자(입력.국적, 30) || null,
      연봉,
      연봉_기준연도: 기준연도,
      재직: 입력.재직 !== false,
      비고: 글자(입력.비고, 200) || null,
      updated_at: new Date().toISOString(),
    }

    const user = await getCurrentUser()
    let id = Number(입력.id ?? 0)

    if (id > 0) {
      const { error } = await db.from("researchers").update(row).eq("id", id)
      if (error) return { ok: false, error: 중복문구(error.message) }
    } else {
      const { data, error } = await db.from("researchers").insert(row).select("*")
      if (error) return { ok: false, error: 중복문구(error.message) }
      id = Number(((data ?? [])[0] as { id?: number } | undefined)?.id ?? 0)
    }
    if (!id) return { ok: false, error: "저장했지만 id 를 못 받았습니다." }

    // 연도별 연봉 이력. 같은 해를 다시 저장하면 그 해 값만 바뀌고 다른 해는 그대로다.
    if (연봉 > 0) {
      const { error: sErr } = await db
        .from("researcher_salaries")
        .upsert(
          { 연구원_id: id, 연도: 기준연도, 연봉, 바꾼이: user.이름, 바꾼일시: new Date().toISOString() },
          { onConflict: "연구원_id,연도" },
        )
      if (sErr) console.error("[researchers] 연봉 이력 기록 실패", sErr.message)
    }

    revalidatePath("/researchers")
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** UNIQUE 위반을 사람 말로 바꾼다. 원문(`duplicate key ...`)은 화면에 낼 말이 아니다. */
function 중복문구(msg: string) {
  return /duplicate key|researchers_등록번호_uniq/.test(msg)
    ? "같은 연구자등록번호가 이미 있습니다. 그 사람을 고치세요."
    : msg
}

/**
 * 명부에서 지운다. **이력이 남는 삭제가 아니라 진짜 삭제**라, 계상에 이미 들어간 사람은
 * 지우지 말고 「재직」을 끄는 쪽을 권한다(계상 줄은 명부를 참조하지 않고 값을 복사해 두므로
 * 지워도 계상은 안 깨진다 — 그래도 명부에서 사라지면 다음에 다시 못 고른다).
 */
export async function deleteResearcher(id: number): Promise<ResearcherResult> {
  try {
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "연구원을 찾을 수 없습니다." }
    const { error } = await db.from("researchers").delete().eq("id", id)
    if (error) return { ok: false, error: error.message }
    revalidatePath("/researchers")
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
