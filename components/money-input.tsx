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
 *
 * ★ **커서를 지킨다**(2026-09-04 사용자 지적).
 *   포맷을 다시 하면 React 가 값을 통째로 갈아 끼우고 **커서가 끝으로 튄다.** 그래서 예전에는
 *   2,000,000 을 2,300,000 으로 고치려고 가운데에 `3` 을 넣어도 커서가 맨 뒤로 가서,
 *   결국 **1의 자리부터 다시 치는** 수밖에 없었다.
 *   고친 방법은 자리(index)를 기억하는 게 아니라 **「커서 앞에 숫자가 몇 개였나」를 기억**하는 것이다 —
 *   콤마는 포맷할 때마다 개수가 달라지지만(2,000,000 → 23,000,000) **숫자 개수는 안 변한다.**
 */

const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "")

/** 콤마·공백·원 표시를 걷어내고 숫자만 남긴다. 붙여넣기(₩1,234,567)도 그대로 받는다. */
export function parseMoney(s: string): number {
  const digits = s.replace(/[^\d]/g, "")
  if (!digits) return 0
  const n = Number(digits)
  return Number.isFinite(n) ? n : 0
}

/** 앞에서부터 숫자를 `n` 개 지난 자리. 콤마는 안 센다. */
function 커서자리(글: string, 숫자개수: number): number {
  if (숫자개수 <= 0) return 0
  let 셈 = 0
  for (let i = 0; i < 글.length; i++) {
    if (글[i] >= "0" && 글[i] <= "9") {
      셈 += 1
      if (셈 === 숫자개수) return i + 1
    }
  }
  return 글.length
}

const 숫자수 = (s: string) => s.replace(/[^\d]/g, "").length

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
  const ref = React.useRef<HTMLInputElement>(null)
  /** 다시 그린 **뒤에** 놓을 커서 자리. 그리기 전에 놓으면 React 가 다시 끝으로 밀어 버린다. */
  const 놓을자리 = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (parseMoney(text) !== value) setText(fmt(value))
    // text 를 의존성에 넣으면 타이핑 중에 되돌려 버린다. 부모 값 변화만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // ⚠ `useEffect` 가 아니라 `useLayoutEffect` 다. 그려진 뒤·화면에 나오기 전에 커서를 놓아야
  //   한 프레임 깜빡이며 끝으로 갔다 오는 것이 안 보인다.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (el && 놓을자리.current != null && document.activeElement === el) {
      const p = Math.min(놓을자리.current, el.value.length)
      el.setSelectionRange(p, p)
    }
    놓을자리.current = null
  })

  /** 숫자 문자열을 그대로 받아 화면·부모·커서를 한 번에 맞춘다. */
  function 반영(숫자들: string, 커서앞숫자: number) {
    if (!숫자들) {
      // 전부 지웠으면 빈 칸으로 두고 값은 0 으로 알린다. 여기서 "0" 을 강제로 넣으면
      // 커서 뒤에 0 이 남아 60000000 을 치려다 600000000 이 된다.
      setText("")
      놓을자리.current = 0
      onValueChange(0)
      return
    }
    const n = Number(숫자들)
    const 다음 = fmt(n)
    setText(다음)
    놓을자리.current = 커서자리(다음, 커서앞숫자)
    onValueChange(Number.isFinite(n) ? n : 0)
  }

  return (
    <Input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      onKeyDown={(e) => {
        // ⚠ 콤마 위에서 지우면 아무 일도 안 일어난다 — 콤마를 지워도 숫자가 그대로라
        //   다시 포맷하면 같은 글자가 나온다. 사람 눈에는 **키가 안 먹는 것**으로 보인다.
        //   그래서 콤마를 만나면 **그 옆 숫자를 지운다**(사람이 하려던 일이 그것이다).
        const el = e.currentTarget
        const s = el.selectionStart ?? 0
        const t = el.selectionEnd ?? 0
        if (s !== t) return // 범위를 잡아 지우는 것은 기본 동작이 맞다
        const 전체 = el.value.replace(/[^\d]/g, "")

        if (e.key === "Backspace" && el.value[s - 1] === ",") {
          e.preventDefault()
          const 앞 = 숫자수(el.value.slice(0, s))
          반영(전체.slice(0, 앞 - 1) + 전체.slice(앞), Math.max(0, 앞 - 1))
        } else if (e.key === "Delete" && el.value[s] === ",") {
          e.preventDefault()
          const 앞 = 숫자수(el.value.slice(0, s))
          반영(전체.slice(0, 앞) + 전체.slice(앞 + 1), 앞)
        }
      }}
      onChange={(e) => {
        const el = e.target
        const raw = el.value
        // **자리(index)가 아니라 「커서 앞 숫자 개수」를 기억한다.** 콤마 개수는 포맷마다 바뀐다.
        const 커서앞숫자 = 숫자수(raw.slice(0, el.selectionStart ?? raw.length))
        반영(raw.replace(/[^\d]/g, ""), 커서앞숫자)
      }}
      onBlur={() => setText(fmt(parseMoney(text)))}
    />
  )
}
