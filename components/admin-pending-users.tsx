"use client"

import { useActionState } from "react"
import { approveUser, rejectUser, type ActionResult } from "@/app/actions/admin-users"
import { Button } from "@/components/ui/button"
import { formatKstDate } from "@/lib/kst"
import { DEPARTMENT_LABEL } from "@/lib/positions"

export type PendingUser = {
  id: number
  username: string
  name: string
  phone: string | null
  email: string | null
  department: "research" | "planning" | "executive" | null
  position: string | null
  created_at: string
}

/**
 * 승인/반려 처리 버튼 하나.
 *
 * ⚠ 서버 액션에 revalidatePath를 안 둔다(2026-09-04 실측: 방금 처리한 행을 서버가 다시
 *   읽어와서 화면을 덮어쓰면, 아직 그 값을 못 본 채로 돌아와 화면이 안 바뀌거나 옛 상태로
 *   보인다). 목록 자체를 이 컴포넌트가 들고 있지 않고 부모(AdminUsersClient)가 들고 있는
 *   이유도 같다 — 승인하면 "계정 승인" 목록에서 빠지는 동시에 "계정 관리" 탭의 부서별
 *   목록에도 나타나야 하는데, 그건 두 탭이 같은 상태를 공유해야 가능하다.
 */
function ActionButton({
  user,
  action,
  onDone,
  label,
  variant,
}: {
  user: PendingUser
  action: (formData: FormData) => Promise<ActionResult>
  onDone: (user: PendingUser) => void
  label: string
  variant?: "default" | "destructive"
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const result = (await action(formData)) ?? null
      if (result?.ok) onDone(user)
      return result
    },
    null,
  )

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="id" value={user.id} />
        <Button type="submit" size="sm" variant={variant} disabled={pending}>
          {pending ? "처리 중..." : label}
        </Button>
      </form>
      {state && !state.ok && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </div>
  )
}

export function AdminPendingUsers({
  users,
  onApprove,
  onReject,
}: {
  users: PendingUser[]
  onApprove: (user: PendingUser) => void
  onReject: (user: PendingUser) => void
}) {
  if (users.length === 0) {
    return (
      <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        승인 대기 중인 계정이 없습니다.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">아이디</th>
            <th className="px-3 py-2 font-medium">이름</th>
            <th className="px-3 py-2 font-medium">연락처</th>
            <th className="px-3 py-2 font-medium">이메일</th>
            <th className="px-3 py-2 font-medium">부서</th>
            <th className="px-3 py-2 font-medium">직급</th>
            <th className="px-3 py-2 font-medium">신청일</th>
            <th className="px-3 py-2 font-medium text-right">처리</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b last:border-0">
              <td className="px-3 py-2">{u.username}</td>
              <td className="px-3 py-2">{u.name}</td>
              <td className="px-3 py-2">{u.phone ?? "-"}</td>
              <td className="px-3 py-2">{u.email ?? "-"}</td>
              <td className="px-3 py-2">{u.department ? DEPARTMENT_LABEL[u.department] : "-"}</td>
              <td className="px-3 py-2">{u.position ?? "-"}</td>
              <td className="px-3 py-2">{formatKstDate(u.created_at)}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-2">
                  <ActionButton user={u} action={approveUser} onDone={onApprove} label="승인" />
                  <ActionButton
                    user={u}
                    action={rejectUser}
                    onDone={onReject}
                    label="반려"
                    variant="destructive"
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
