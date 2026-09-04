/**
 * Storage 서명 URL을 **브라우저가 열 수 있는 주소**로 바꾼다.
 *
 * `SUPABASE_URL` 이 `http://127.0.0.1:3600` 이라 서명 URL 도 그 주소로 만들어진다.
 * 서버는 그리로 접속하는 게 맞지만, **다운로드 링크는 사람이 브라우저에서 연다** —
 * 127.0.0.1 은 그 사람의 컴퓨터를 가리키므로 아무 데도 닿지 않는다.
 *
 * ⚠ `SUPABASE_URL` 자체를 공개 도메인으로 바꾸면 안 된다. `rnd-api.mgnt.kr` 는
 *   Cloudflare 로 풀려서(2606:4700:…) **DB 쿼리마다 인터넷을 한 바퀴 돈다.**
 *   서버는 계속 루프백으로 붙고, **링크를 만들 때만** 공개 주소로 바꾼다.
 */

const 내부 = process.env.SUPABASE_URL ?? ""
const 공개 = process.env.SUPABASE_PUBLIC_URL ?? "https://rnd-api.mgnt.kr"

// 입력 타입을 그대로 돌려준다 — 호출부마다 url 이 string 이기도 하고
// string | undefined 이기도 해서, null 로 뭉뚱그리면 그 자리들이 전부 타입 오류가 난다.
export function 공개주소(url: string): string
export function 공개주소(url: string | null): string | null
export function 공개주소(url: string | undefined): string | undefined
export function 공개주소(url: string | null | undefined): string | null | undefined
export function 공개주소(url: string | null | undefined): string | null | undefined {
  if (!url) return url
  if (!내부 || !공개 || 내부 === 공개) return url
  return url.startsWith(내부) ? 공개 + url.slice(내부.length) : url
}
