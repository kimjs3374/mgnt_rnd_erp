"use client"

import { useActionState } from "react"
import {
  changeUserRole,
  changeUserDepartment,
  suspendUser,
  reactivateUser,
  type ActionResult,
} from "@/app/actions/admin-users"
import { Button } from "@/components/ui/button"

type Account = {
  id: number
  username: string
  name: string
  email: string | null
  phone: string | null
  role: "member" | "admin" | "super_admin"
  status: "approved" | "rejected" | "suspended"
  department: "research" | "planning" | null
  last_login_at: string | null
}

const STATUS_LABEL: Record<Account["status"], string> = {
  approved: "정상",
  rejected: "반려",
  suspended: "정지됨",
}

const ROLE_LABEL: Record<Account["role"], string> = {
  super_admin: "슈퍼관리자",
  admin: "관리자",
  member: "일반회원",
}

function RoleCell({ account }: { account: Account }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => (await changeUserRole(formData)) ?? null,
    null,
  )

  // 슈퍼관리자 등급은 이 화면에서 못 바꾼다 — DB에서 직접 지정하는, 훨씬 무거운 조작이다.
  if (account.role === "super_admin") {
    return <span className="text-xs text-muted-foreground">변경 불가</span>
  }

  const nextRole = account.role === "admin" ? "member" : "admin"
  const label = account.role === "admin" ? "일반회원으로 변경" : "관리자로 승격"

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="id" value={account.id} />
        <input type="hidden" name="role" value={nextRole} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "변경 중..." : label}
        </Button>
      </form>
      {state && !state.ok && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </div>
  )
}

function DepartmentCell({ account }: { account: Account }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => (await changeUserDepartment(formData)) ?? null,
    null,
  )

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="id" value={account.id} />
        <select
          name="department"
          defaultValue={account.department ?? ""}
          disabled={pending}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs outline-none"
        >
          <option value="" disabled>
            미지정
          </option>
          <option value="research">연구소</option>
          <option value="planning">기획실</option>
        </select>
      </form>
      {state && !state.ok && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </div>
  )
}

function StatusCell({ account }: { account: Account }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (_prev, formData) => {
    const action = account.status === "suspended" ? reactivateUser : suspendUser
    return (await action(formData)) ?? null
  }, null)

  if (account.status === "rejected") {
    return <span className="text-xs text-muted-foreground">-</span>
  }

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="id" value={account.id} />
        <Button
          type="submit"
          size="sm"
          variant={account.status === "suspended" ? "outline" : "destructive"}
          disabled={pending}
        >
          {pending ? "처리 중..." : account.status === "suspended" ? "정지 해제" : "계정 정지"}
        </Button>
      </form>
      {state && !state.ok && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
    </div>
  )
}

export function AdminAccounts({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) {
    return (
      <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        표시할 계정이 없습니다.
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
            <th className="px-3 py-2 font-medium">상태</th>
            <th className="px-3 py-2 font-medium">역할</th>
            <th className="px-3 py-2 font-medium">부서</th>
            <th className="px-3 py-2 font-medium">최근 로그인</th>
            <th className="px-3 py-2 font-medium">권한</th>
            <th className="px-3 py-2 font-medium">계정</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id} className="border-b align-top last:border-0">
              <td className="px-3 py-2">{a.username}</td>
              <td className="px-3 py-2">{a.name}</td>
              <td className="px-3 py-2">{a.phone ?? a.email ?? "-"}</td>
              <td className="px-3 py-2">{STATUS_LABEL[a.status]}</td>
              <td className="px-3 py-2">{ROLE_LABEL[a.role]}</td>
              <td className="px-3 py-2">
                <DepartmentCell account={a} />
              </td>
              <td className="px-3 py-2">
                {a.last_login_at ? new Date(a.last_login_at).toLocaleString("ko-KR") : "-"}
              </td>
              <td className="px-3 py-2">
                <RoleCell account={a} />
              </td>
              <td className="px-3 py-2">
                <StatusCell account={a} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
