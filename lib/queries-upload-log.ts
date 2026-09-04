import "server-only"
import { db, safeSelect } from "@/lib/db"

/**
 * 서류를 **누가(아이디 기준) · 언제** 올렸나. (2026-09-04 사용자 지시)
 *
 * 서류가 붙는 표가 넷이다 — 과제 증빙 · 과제 정산 · 회사 서류함 · 업체 서류.
 * 네 화면을 각각 뒤지게 하면 「누가 올렸지」에 답이 안 나온다. 한 자리로 모은다.
 *
 * ⚠ 원래 규정 문서함(`rule_documents`)까지 다섯이었는데, 그 화면이 없어져서 뺐다
 *   (2026-09-04 사용자 지시). **표와 파일은 남아 있다** — 볼 화면이 없을 뿐이다.
 *   규정 문서함을 되살리면 이 목록에도 다시 넣어야 한다.
 *
 * ⚠ **아이디는 저장된 이름이 아니라 `업로더_id` 로 지금 다시 찾는다.**
 *   표에 남는 `업로더` 는 그때의 **표시명**(「최고관리자」)이라 아이디가 아니고,
 *   사람이 이름을 바꾸면 옛 기록이 딴사람처럼 보인다. id 는 안 바뀐다.
 *   그래서 `업로더_id → users.username` 으로 잇는다.
 *
 * ⚠ **`업로더_인증` 이 false 면 아이디를 말하지 않는다.** 로그인이 붙기 전(2026-09-03)에
 *   올라온 것과 테스트가 넣은 것이 그렇다. 거기에 아무 이름이나 적으면 **기록이 거짓말을 한다** —
 *   「확인 안 됨」이 정직하다. 로그는 정확하지 않으면 있으나 마나다.
 */
export type 업로드기록 = {
  키: string
  구분: string
  /** 어디에 붙은 서류인가 — 과제명 · 업체명. 모르면 빈 문자열. */
  어디: string
  서류명: string
  파일명: string
  크기: number | null
  /** 로그인 아이디. 인증 안 된 기록은 null 이다. */
  아이디: string | null
  /** 올릴 때 남은 표시명. 아이디가 없을 때 참고로만 보여 준다. */
  표시명: string
  인증: boolean
  일시: string | null
}

type Row = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v))
const n = (v: unknown) => (v == null ? null : Number(v))

export async function getUploadLog(): Promise<{ rows: 업로드기록[]; error: string | null }> {
  const [증빙, 정산, 회사, 업체서류, users, projects, vendors, 요건, doctypes] =
    await Promise.all([
      safeSelect<Row>("project_evidence_files", () =>
        db.from("project_evidence_files").select("*"),
      ),
      safeSelect<Row>("settlement_documents", () => db.from("settlement_documents").select("*")),
      safeSelect<Row>("documents", () => db.from("documents").select("*")),
      safeSelect<Row>("vendor_documents", () => db.from("vendor_documents").select("*")),
      safeSelect<Row>("users", () => db.from("users").select("*")),
      safeSelect<Row>("projects", () => db.from("projects").select("*")),
      safeSelect<Row>("vendors", () => db.from("vendors").select("*")),
      safeSelect<Row>("evidence_requirements", () =>
        db.from("evidence_requirements").select("*"),
      ),
      safeSelect<Row>("doc_types", () => db.from("doc_types").select("*")),
    ])

  const error =
    증빙.error ??
    정산.error ??
    회사.error ??
    업체서류.error ??
    users.error ??
    projects.error ??
    vendors.error ??
    요건.error ??
    doctypes.error ??
    null
  if (error) return { rows: [], error }

  const 아이디맵 = new Map(users.rows.map((u) => [s(u.id), s(u.username)]))
  const 과제맵 = new Map(projects.rows.map((p) => [s(p.id), s(p.과제명)]))
  const 업체맵 = new Map(vendors.rows.map((v) => [s(v.id), s(v.업체명)]))
  const 요건맵 = new Map(요건.rows.map((r) => [s(r.id), s(r.서류명)]))
  const 종류맵 = new Map(doctypes.rows.map((d) => [s(d.코드), s(d.이름)]))

  /** 다섯 표가 같은 세 칸(업로더·업로더_id·업로더_인증)을 쓴다. 읽는 규칙도 한 벌이어야 한다. */
  const 사람 = (r: Row) => {
    const 인증 = r.업로더_인증 === true
    const id = r.업로더_id == null ? "" : s(r.업로더_id)
    return {
      인증,
      // 인증이 안 된 기록에는 아이디를 붙이지 않는다 — 없는 사실을 만들지 않는다.
      아이디: 인증 && id ? (아이디맵.get(id) ?? null) : null,
      표시명: s(r.업로더),
    }
  }

  const 만들기 = (표: string, 구분: string, r: Row, 어디: string, 서류명: string, 일시: unknown) => ({
    키: `${표}:${s(r.id)}`,
    구분,
    어디,
    서류명: 서류명 || "—",
    파일명: s(r.파일명),
    크기: n(r.크기),
    일시: 일시 == null ? null : s(일시),
    ...사람(r),
  })

  const rows: 업로드기록[] = [
    ...증빙.rows.map((r) =>
      만들기(
        "evidence",
        "과제 증빙",
        r,
        과제맵.get(s(r.과제_id)) ?? "",
        요건맵.get(s(r.요건_id)) ?? s(r.비목_대분류),
        r.업로드일시,
      ),
    ),
    ...정산.rows.map((r) =>
      만들기(
        "settlement",
        "과제 정산",
        r,
        과제맵.get(s(r.과제_id)) ?? "",
        s(r.서류종류),
        r.업로드일시,
      ),
    ),
    ...회사.rows.map((r) =>
      만들기(
        "documents",
        "회사 서류함",
        r,
        "",
        종류맵.get(s(r.doc_type)) ?? s(r.doc_type),
        // ⚠ 이 표만 `업로드일시` 가 없고 `created_at` 이다. 없는 칸을 읽으면 조용히 빈칸이 된다.
        r.created_at,
      ),
    ),
    ...업체서류.rows.map((r) =>
      만들기(
        "vendor",
        "업체 서류",
        r,
        업체맵.get(s(r.업체_id)) ?? "",
        s(r.서류종류),
        r.업로드일시,
      ),
    ),
  ]

  // 최근 것부터. 일시를 모르는 건 맨 아래 — 「모른다」를 최근처럼 보이게 하지 않는다.
  rows.sort((a, b) => (b.일시 ?? "").localeCompare(a.일시 ?? ""))
  return { rows, error: null }
}
