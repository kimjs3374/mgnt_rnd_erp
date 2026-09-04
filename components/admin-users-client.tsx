"use client"

import { useState } from "react"
import { AdminTabs } from "@/components/admin-tabs"
import { AdminAccountsManagement, type Account } from "@/components/admin-accounts-management"
import { AdminPendingUsers, type PendingUser } from "@/components/admin-pending-users"
import { AdminResetRequests } from "@/components/admin-reset-requests"

type ResetRequest = {
  id: number
  username: string
  name: string
  email: string | null
  reset_requested_at: string
}

/**
 * "계정 관리"·"계정 승인" 두 탭이 사람을 공유한다 — 승인 대기 목록에서 승인하면
 * 그 사람이 계정 관리 탭의 부서별 목록에도 새로고침 없이 바로 나타나야 한다.
 * 그러려면 두 탭이 각자 상태를 들고 있으면 안 되고, 여기 한 곳에서 같이 관리해야 한다
 * (2026-09-04 실측 — 각자 들고 있게 했더니 승인해도 계정 관리 탭엔 안 보였다).
 */
export function AdminUsersClient({
  initialPending,
  initialAccounts,
  resetRequests,
}: {
  initialPending: PendingUser[]
  initialAccounts: Account[]
  resetRequests: ResetRequest[]
}) {
  const [pending, setPending] = useState(initialPending)
  const [accounts, setAccounts] = useState(initialAccounts)

  const updateAccount = (id: number, patch: Partial<Account>) =>
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))

  const handleApprove = (u: PendingUser) => {
    setPending((prev) => prev.filter((p) => p.id !== u.id))
    setAccounts((prev) => [
      ...prev,
      {
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: "member",
        status: "approved",
        department: u.department,
        position: u.position,
        extra_menus: [],
        last_login_at: null,
      },
    ])
  }

  const handleReject = (u: PendingUser) => {
    setPending((prev) => prev.filter((p) => p.id !== u.id))
    // 반려된 사람은 계정 관리(부서별 목록)에 넣지 않는다 — 직원이 된 적이 없다.
  }

  const stats = {
    total: accounts.length + pending.length,
    active: accounts.filter((a) => a.status === "approved").length,
    inactive: accounts.filter((a) => a.status === "suspended").length,
    pending: pending.length,
  }

  return (
    <AdminTabs
      accountsTab={<AdminAccountsManagement accounts={accounts} stats={stats} onUpdate={updateAccount} />}
      approvalTab={
        <>
          <div>
            <h2 className="text-lg font-semibold">계정 승인</h2>
            <p className="text-sm text-muted-foreground">가입 신청한 계정을 승인하거나 반려합니다.</p>
          </div>
          <AdminPendingUsers users={pending} onApprove={handleApprove} onReject={handleReject} />

          <div>
            <h2 className="text-lg font-semibold">비밀번호 재설정 요청</h2>
            <p className="text-sm text-muted-foreground">
              이메일 자동 발송은 지원하지 않습니다. 임시 비밀번호를 발급한 뒤 본인에게 직접 전달하세요.
            </p>
          </div>
          <AdminResetRequests requests={resetRequests} />
        </>
      }
    />
  )
}
