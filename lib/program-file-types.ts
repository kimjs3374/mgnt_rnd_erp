/**
 * 지원사업 서류함의 행 타입. **서버와 클라이언트가 같이 읽는다.**
 *
 * 조회 계층(`lib/queries-program-files.ts`)은 `server-only` 라 클라이언트 컴포넌트가
 * 거기서 타입을 가져오면 빌드가 깨진다(`lib/evidence-types.ts` 와 같은 사정).
 */

/** 파일이 어디서 온 것인가. **표에 그대로 배지로 찍힌다.** */
export const 출처목록 = ["계상 증빙", "집행 증빙", "정산 서류"] as const
export type 파일출처 = (typeof 출처목록)[number]

export type 사업파일 = {
  /** `출처:id` — 화면·다운로드가 파일 하나를 가리키는 키. 표가 셋이라 id 만으로는 겹친다. */
  키: string
  출처: 파일출처
  id: number
  과제_id: number
  과제명: string
  파일명: string
  /** 비목명·서류종류처럼 「무엇에 붙은 파일인가」. 폴더 이름으로도 쓴다. */
  분류: string
  크기: number | null
  /** 올라온 시각(ISO). 기간 필터가 보는 값이다. */
  일시: string
  업로더: string | null
}

/** 사업 하나 묶음 — 화면이 폴더처럼 접었다 편다. */
export type 사업묶음 = {
  과제_id: number
  과제명: string
  파일: 사업파일[]
  합계크기: number
}

/**
 * 파일 목록 → 사업별 묶음. **거르고 난 뒤에** 묶는다.
 *
 * 서버에서 미리 묶어 내려보내지 않는다 — 화면에서 기간·출처를 거르면 묶음이 달라지고,
 * 그러면 「이 사업 3건」이라는 숫자가 눈앞의 목록과 어긋난다. 세는 자리는 하나여야 한다.
 */
export function 묶기(파일: 사업파일[]): 사업묶음[] {
  const map = new Map<number, 사업묶음>()
  for (const f of 파일) {
    const cur = map.get(f.과제_id) ?? { 과제_id: f.과제_id, 과제명: f.과제명, 파일: [], 합계크기: 0 }
    cur.파일.push(f)
    cur.합계크기 += f.크기 ?? 0
    map.set(f.과제_id, cur)
  }
  // 서류가 많이 쌓인 사업부터. 「어디에 무엇이 모였나」가 먼저 보여야 한다.
  return [...map.values()].sort(
    (a, b) => b.파일.length - a.파일.length || a.과제명.localeCompare(b.과제명),
  )
}

/** ISO → `2026-09-04 07:12` (KST). 서버·클라이언트가 같은 값을 내야 하므로 직접 계산한다. */
export function 시각표기(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const k = new Date(t.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

export function 크기표기(n: number | null | undefined): string {
  if (n == null) return "—"
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}
