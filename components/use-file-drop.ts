"use client"

import * as React from "react"

/**
 * 파일 드래그드랍 한 벌. **증빙 첨부와 규정 문서함이 같은 것을 쓴다.**
 *
 * 화면마다 다시 짜면 안 되는 이유가 있다 — 아래 함정 다섯 개를 한 곳에서만 막으려고 뺐다.
 * (자세한 실측은 서버 팀메모리 `_팀로그/memory/drag-drop-file-upload.md`)
 *
 *   ① 드롭을 빗맞히면 **브라우저가 그 파일을 열어** 화면이 통째로 사라진다 → 창 전체에서 기본동작을 막는다
 *   ② `dragleave` 는 자식으로 들어갈 때도 튄다 → 자리마다 깊이를 세서 0일 때만 강조를 끈다
 *   ③ `dragover` 에서 `preventDefault()` 를 빠뜨리면 그 자리는 드롭을 아예 못 받는다(기본값이 「거부」)
 *   ④ 드래그 중에는 `dataTransfer.files` 가 비어 있다 → `types` 에 `Files` 가 있는지로만 판단한다
 *   ⑤ 안쪽 자리가 바깥을 이기게 하려면 전부 `stopPropagation` 한다
 *
 * 쓰는 쪽:
 * ```tsx
 * const { 드롭대상, 드롭영역 } = useFileDrop({ 거부됨: (사유) => setMsg({ ok: false, text: 사유 }) })
 * <li {...드롭영역("요건:12", (files) => 올리기(files))} className={드롭대상 === "요건:12" ? "…" : ""} />
 * ```
 */

/** 끌고 온 것이 파일인가. 글자·링크를 끌어와도 카드가 번쩍이지 않게 한다. */
export function 파일드래그인가(e: React.DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files")
}

/** `드롭영역(...)` 이 내는 props. 그대로 엘리먼트에 spread 한다. */
export type DropZoneProps = {
  onDragEnter: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

/** 자리를 만드는 함수. 컴포넌트 사이로 넘길 때 이 타입을 쓴다. */
export type 드롭영역만들기 = (
  키: string,
  받기: (files: File[]) => void,
  막힘?: string | null,
) => DropZoneProps

export function useFileDrop({ 거부됨 }: { 거부됨: (사유: string) => void }) {
  /** 지금 파일이 떠 있는 자리. 한 번에 하나만 강조된다. */
  const [드롭대상, set드롭대상] = React.useState<string | null>(null)
  const 깊이 = React.useRef<Record<string, number>>({})

  // 콜백을 ref 에 담아 둔다. 인라인 화살표를 그대로 붙들면 매 렌더마다 effect 가 다시 돈다.
  const 거부됨Ref = React.useRef(거부됨)
  거부됨Ref.current = 거부됨

  // ⚠ ① 빗맞은 드롭 — 브라우저가 파일을 열어 버리는 것을 막는다. 시연 중이면 그대로 사고다.
  //    자리에서 처리된 드롭은 거기서 propagation 이 끊겨 여기까지 오지 않는다.
  React.useEffect(() => {
    const 기본동작막기 = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return
      e.preventDefault()
    }
    const 강조되돌리기 = () => {
      깊이.current = {}
      set드롭대상(null)
    }
    window.addEventListener("dragover", 기본동작막기)
    window.addEventListener("drop", 기본동작막기)
    window.addEventListener("drop", 강조되돌리기)
    window.addEventListener("dragend", 강조되돌리기)
    return () => {
      window.removeEventListener("dragover", 기본동작막기)
      window.removeEventListener("drop", 기본동작막기)
      window.removeEventListener("drop", 강조되돌리기)
      window.removeEventListener("dragend", 강조되돌리기)
    }
  }, [])

  /**
   * 드롭 받는 자리 하나.
   * `막힘` 에 문구가 있으면 **받지 않는 자리**다 — 커서를 「금지」로 바꾸고, 놓으면 그 이유를 말한다.
   */
  const 드롭영역: 드롭영역만들기 = (키, 받기, 막힘) => {
    return {
      onDragEnter(e: React.DragEvent) {
        if (!파일드래그인가(e)) return
        e.preventDefault()
        e.stopPropagation()
        깊이.current[키] = (깊이.current[키] ?? 0) + 1
        set드롭대상(키)
      },
      onDragOver(e: React.DragEvent) {
        if (!파일드래그인가(e)) return
        e.preventDefault() // ③ 빠뜨리면 이 자리는 드롭을 아예 못 받는다
        e.stopPropagation()
        e.dataTransfer.dropEffect = 막힘 ? "none" : "copy"
      },
      onDragLeave(e: React.DragEvent) {
        if (!파일드래그인가(e)) return
        e.stopPropagation()
        깊이.current[키] = Math.max(0, (깊이.current[키] ?? 1) - 1) // ②
        if (깊이.current[키] === 0) set드롭대상((v) => (v === 키 ? null : v))
      },
      onDrop(e: React.DragEvent) {
        if (!파일드래그인가(e)) return
        e.preventDefault()
        e.stopPropagation()
        깊이.current[키] = 0
        set드롭대상((v) => (v === 키 ? null : v))
        if (막힘) {
          거부됨Ref.current(막힘)
          return
        }
        받기(Array.from(e.dataTransfer.files ?? []))
      },
    }
  }

  return { 드롭대상, 드롭영역 }

}

/** 강조 클래스. 두 화면이 같은 모양이어야 사람이 같은 것으로 읽는다. */
export const 드롭강조 = {
  /** 자리를 차지하지 않는 outline 을 쓴다 — border 로 하면 강조될 때마다 목록이 1px 씩 밀린다. */
  받음: "bg-primary/10 outline outline-1 outline-primary",
  막힘: "bg-destructive/10 outline outline-1 outline-destructive",
  카드: "border-primary bg-primary/5",
}
