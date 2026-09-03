"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"

/**
 * 금액 입력칸 — **치는 즉시 천 단위 콤마가 붙는다.**
 *
 * 왜 `<input type="number">` 를 안 쓰나: 브라우저가 `1,234,567` 을 값으로 받아주지 않는다
 * (콤마를 넣으면 value 가 빈 문자열이 된다). 그래서 `type="text"` + `inputMode="numeric"` 으로 두고
 * 숫자만 남겨 다시 포맷한다. 모바일 키패드는 inputMode 로 그대로 뜬다.
 *
 * 계상 금액은 자리수가 8~9자리다. 콤마가 없으면 6,000,000 과 60,000,000 을 눈으로 구분할 수 없고,
 * 그 둘을 잘못 보는 순간 한도 검증이 통과한 채로 협약과 어긋난다. 그래서 표시가 기능이다.
 */

const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "")

/** 콤마·공백·원 표시를 걷어내고 숫자만 남긴다. 붙여넣기(₩1,234,567)도 그대로 받는다. */
export function parseMoney(s: string): number {
  const digits = s.replace(/[^\d]/g, "")
  if (!digits) return 0
  const n = Number(digits)
  return Number.isFinite(n) ? n : 0
}

export function MoneyInput({
  value,
  onValueChange,
  className,
  "aria-label": ariaLabel,
  disabled,
}: {
  value: number
  onValueChange: (n: number) => void
  className?: string
  "aria-label"?: string
  disabled?: boolean
}) {
  // 화면 문자열을 따로 들고 있는 이유: 0 을 지우고 다시 치는 동안 "" 상태가 필요하다.
  // 부모가 값을 바꿨을 때(자동 계산·저장 후 revalidate)는 그쪽을 따른다.
  const [text, setText] = React.useState(() => fmt(value))
  React.useEffect(() => {
    if (parseMoney(text) !== value) setText(fmt(value))
    // text 를 의존성에 넣으면 타이핑 중에 되돌려 버린다. 부모 값 변화만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      onChange={(e) => {
        const raw = e.target.value
        // 전부 지웠으면 빈 칸으로 두고 값은 0 으로 알린다. 여기서 "0" 을 강제로 넣으면
        // 커서 뒤에 0 이 남아 60000000 을 치려다 600000000 이 된다.
        if (raw.replace(/[^\d]/g, "") === "") {
          setText("")
          onValueChange(0)
          return
        }
        const n = parseMoney(raw)
        setText(fmt(n))
        onValueChange(n)
      }}
      onBlur={() => setText(fmt(parseMoney(text)))}
    />
  )
}
