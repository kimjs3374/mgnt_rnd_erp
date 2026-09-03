/**
 * KST 날짜·시각을 고정 형식 문자열로. `toLocaleString("ko-KR")` 을 안 쓴다.
 *
 * ⚠ 서버(Node.js)와 브라우저(Chrome)의 ICU 데이터가 달라 같은 "ko-KR" 로케일도
 *   서버는 "AM", 브라우저는 "오전"으로 다르게 낸다(2026-09-04 실측 — 하이드레이션 불일치로
 *   React가 그 부분 트리를 클라이언트에서 통째로 다시 그리면서, 방금 반영된 변경이 화면에서
 *   순간적으로 사라지고 새로고침 전 상태로 되돌아가 보이는 원인이었다).
 *   숫자를 직접 조립하면 서버·클라이언트가 항상 같은 문자열을 낸다.
 */

const p = (n: number) => String(n).padStart(2, "0")

function toKst(iso: string): Date {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
}

/** "2026-09-04 17:05" */
export function formatKstDateTime(iso: string): string {
  const k = toKst(iso)
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`
}

/** "2026-09-04" */
export function formatKstDate(iso: string): string {
  const k = toKst(iso)
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`
}
