"use client"

import { useState } from "react"

/**
 * 계정 관리 / 계정 승인 탭 전환.
 *
 * 두 탭의 내용을 서버 컴포넌트(app/(app)/admin/users/page.tsx)에서 미리 렌더링해
 * children으로 받고, 여기서는 CSS로 보이기/숨기기만 한다 — 언마운트하지 않는 이유는
 * 계정 관리 탭의 선택 상태(어떤 부서·어떤 사람을 보고 있었는지)가 탭을 왔다갔다해도
 * 유지되게 하기 위해서다.
 */
export function AdminTabs({
  accountsTab,
  approvalTab,
}: {
  accountsTab: React.ReactNode
  approvalTab: React.ReactNode
}) {
  const [tab, setTab] = useState<"accounts" | "approval">("accounts")

  return (
    <div>
      <div className="mb-6 flex gap-4 border-b text-sm">
        {(
          [
            ["accounts", "계정 관리"],
            ["approval", "계정 승인"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "border-b-2 border-primary pb-2 font-medium text-primary"
                : "pb-2 text-muted-foreground hover:text-foreground"
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className={tab === "accounts" ? "space-y-6" : "hidden"}>{accountsTab}</div>
      <div className={tab === "approval" ? "space-y-8" : "hidden"}>{approvalTab}</div>
    </div>
  )
}
