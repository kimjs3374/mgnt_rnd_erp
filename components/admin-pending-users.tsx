"use client"

import { useActionState, useState } from "react"
import { approveUser, rejectUser, type ActionResult } from "@/app/actions/admin-users"
import { Button } from "@/components/ui/button"
import { formatKstDate } from "@/lib/kst"

const DEPARTMENT_LABEL: Record<string, string> = { research: "연구소", planning: "기획실" }

type PendingUser = {
  id: number
  username: string
  name: string
  phone: string | null
  email: string | null
  department: "research" | "planning" | null
  created_at: string
}

/**
 * 승인/반려 처리 버튼 하나.
 *
 * ⚠ 서버 액션에 revalidatePath를 안 둔다(components/admin-accounts.tsx와 같은 이유 —
 *   2026-09-04 실측: 방금 처리한 행을 서버가 다시 읽어와서 화면을 덮어쓰면, 아직 그 값을
 *   못 본 채로 돌아와 화면이 안 바뀌거나 옛 상태로 보인다). 성공하면 부모가 이 행을
 *   목록에서 바로 지운다(낙관적 업데이트) — 새로고침해도 어차피 안 보이니 데이터는 맞다.
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
  onDone: (id: number) => void
  label: string
  variant?: "default" | "destructive"
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const result = (await action(formData)) ?? null
      if (result?.ok) onDone(user.id)
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

export function AdminPendingUsers({ initialUsers }: { initialUsers: PendingUser[] }) {
  const [users, setUsers] = useState(initialUsers)
  const remove = (id: number) => setUsers((prev) => prev.filter((u) => u.id !== id))

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
              <td className="px-3 py-2">{formatKstDate(u.created_at)}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-2">
                  <ActionButton user={u} action={approveUser} onDone={remove} label="승인" />
                  <ActionButton
                    user={u}
                    action={rejectUser}
                    onDone={remove}
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
