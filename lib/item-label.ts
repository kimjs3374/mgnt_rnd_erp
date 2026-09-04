/**
 * 집행의 \`품목\`(JSONB 배열) → 사람이 읽는 한 줄.
 *
 * ⚠ **\`품목\` 은 문자열이 아니라 객체 배열이다** — \`[{ 품목명, 수량, 금액 }]\`.
 *   그대로 JSX 에 넣으면 「Objects are not valid as a React child」로 화면이 죽는다.
 *   실제로 그렇게 한 번 죽였다(2026-09-04, 업체 구매내역).
 *
 * 같은 함수가 \`projects/[id]/expenses\` · \`projects/[id]/settlement\` · \`expenses\` 세 곳에
 * 복사돼 있다. 표기를 고치라는 지시가 오면 **셋 중 하나만 고쳐진다.** 여기로 모으는 중이다 —
 * 새로 쓰는 곳은 이걸 쓴다(대회 중이라 남의 파일 세 개를 지금 건드리지는 않는다).
 */
export function itemLabel(품목: unknown): string {
  if (Array.isArray(품목)) {
    const names = 품목
      .map((i) => {
        if (!i || typeof i !== "object") return null
        const o = i as Record<string, unknown>
        return o.품목명 ?? o.name ?? o.item_name ?? null
      })
      .filter(Boolean)
      .map(String)
    if (names.length) return names.join(", ")
  }
  return "—"
}
