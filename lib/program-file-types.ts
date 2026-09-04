/**
 * 지원사업 서류함의 행 타입. **서버와 클라이언트가 같이 읽는다.**
 *
 * 조회 계층(`lib/queries-program-files.ts`)은 `server-only` 라 클라이언트 컴포넌트가
 * 거기서 타입을 가져오면 빌드가 깨진다(`lib/evidence-types.ts` 와 같은 사정).
 */

/**
 * 어느 서류함인가 — 지원사업(`/programs/files`) 인가 과제사업(`/projects/files`) 인가.
 * 조회 · 화면 · zip 라우트가 **같은 값**을 주고받는다(URL 에도 그대로 실린다).
 */
export type 서류함스코프 = "program" | "project"

/**
 * 그 서류함에 담을 사업인가. **규칙을 여기 한 번만 적는다** — 조회·zip 두 군데에 따로
 * 적었더니 한쪽만 틀려서(원본 값은 `NATIONAL_RND` 인데 화면 라벨 `"국가 R&D"` 로 비교했다)
 * 화면에선 빠진 R&D 과제가 zip 에는 들어왔다.
 *
 * ⚠ `사업유형` 은 **원본 app.projects 값**을 넘긴다. `v_program_ledger` 가 붙여 주는
 *   한글 라벨(「국가 R&D」)이 아니다.
 * ⚠ 미선정 건은 뺀다 — 지원사업 관리·과제 관리 목록에도 없다(사업이 되지 못한 건이다).
 *   목록에 없는 사업의 서류가 서류함에 있으면 그건 다른 화면이 된다.
 */
export const 과제사업인가 = (사업유형: string | null) => 사업유형 === "NATIONAL_RND"

export function 서류함에담나(
  r: { 사업유형: string | null; 선정결과: string | null },
  스코프: 서류함스코프,
): boolean {
  if ((r.선정결과 ?? "") === "미선정") return false
  // **둘로 정확히 갈린다** — R&D 면 과제사업, 나머지는 전부 지원사업(값이 비어 있어도 그렇다).
  // 지금 사업유형에 들어 있는 값은 `NATIONAL_RND` 와 빈 값 둘뿐이고, 지원사업 관리 화면도
  // 「R&D 가 아닌 것」으로 고른다(`components/programs-stage-view.tsx`) — 같은 기준이다.
  // 이렇게 써 두면 새 유형이 생겨도 **어느 서류함에도 안 보이는 서류는 생기지 않는다**
  // (지원사업 쪽으로 간다). 그 유형을 따로 다뤄야 하면 그때 여기 한 줄을 늘린다.
  return 스코프 === "project" ? 과제사업인가(r.사업유형) : !과제사업인가(r.사업유형)
}

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
  /**
   * 그 파일이 붙은 집행(지출) 건 — 있으면 있는 대로 화면이 지출 하나로 묶어 접는다
   * (2026-09-04 사용자 지시: "파일이 개별로 보이니 너무 복잡하니까 지출 하나만 보이고
   * 마우스로 누르면 펼쳐서 볼 수 있게" → "같은 지출에 대한 지출증빙이잖아 이걸 지출명으로
   * 잡아서 파일을 합쳐서").
   *
   * 「집행 증빙」은 항상 있다(evidence.expense_id 로 바로 연결). 「계상 증빙」은
   * project_evidence_files.집행_id 가 채워져 있을 때만 있다 — **채워져 있으면 같은
   * id 를 쓰는 집행 증빙과 한 지출로 합쳐진다**(같은 거래를 계상 탭에서도, 집행 탭에서도
   * 각자 증빙을 붙일 수 있어서 실제로 겹친다 — 테이팩스 거래명세서·세금계산서가 그 예다).
   * 「정산 서류」는 서류종류에 붙지 거래 건에 붙지 않아 이 값이 없다.
   */
  지출?: { id: number; 거래처: string | null; 일자: string | null; 합계: number | null }
}

/**
 * 집행에는 붙어 있는데 **서류함에 아직 못 담은** 증빙.
 *
 * 「검토대기」 건의 파일은 저장소에 올라가기 전이라(`storage_path` 가 비어 있다) 내려받을 수
 * 없다. 담지 않는 게 맞지만 **조용히 빼면 안 된다** — 「집행엔 있는데 서류함엔 없다」가 되고,
 * 사람은 시스템이 파일을 잃었다고 생각한다. 세어서 화면 위에 적고, 집행 탭으로 보낸다.
 */
export type 보류증빙 = {
  집행_id: number
  과제_id: number
  과제명: string
  파일명: string
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

/** 지출(집행 건) 하나에 묶인 파일들 — 사업 묶음 안에서 한 번 더 접힌다. */
export type 지출묶음 = {
  지출_id: number
  거래처: string | null
  일자: string | null
  합계: number | null
  파일: 사업파일[]
}

/**
 * 사업 묶음 하나의 파일을 **지출 단위로 한 번 더** 가른다.
 *
 * `f.지출` 이 있는 파일만 묶는다 — 「집행 증빙」은 항상 있고, 「계상 증빙」은 집행_id 를
 * 적어 둔 것만 있다(둘 다 있으면 같은 id 로 한 묶음이 된다). 「정산 서류」는 지출 개념이
 * 없어(서류종류에 붙지 거래 건에 붙지 않는다) 늘 낱개로 남는다.
 * 지출 묶음은 최근 지출이 위로 오게 정렬한다(파일 자체는 이미 최신순으로 들어온다).
 */
export function 지출별로가르기(파일: 사업파일[]): { 낱개: 사업파일[]; 지출들: 지출묶음[] } {
  const 낱개: 사업파일[] = []
  const map = new Map<number, 지출묶음>()
  const 순서: number[] = []
  for (const f of 파일) {
    if (!f.지출) {
      낱개.push(f)
      continue
    }
    const 지출 = f.지출
    if (!map.has(지출.id)) {
      map.set(지출.id, { 지출_id: 지출.id, 거래처: 지출.거래처, 일자: 지출.일자, 합계: 지출.합계, 파일: [] })
      순서.push(지출.id)
    }
    map.get(지출.id)!.파일.push(f)
  }
  return { 낱개, 지출들: 순서.map((id) => map.get(id)!) }
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
