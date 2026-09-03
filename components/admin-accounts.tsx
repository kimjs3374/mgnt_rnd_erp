"use client"

import { useActionState, useState } from "react"
import {
  changeUserRole,
  changeUserDepartment,
  suspendUser,
  reactivateUser,
  type ActionResult,
} from "@/app/actions/admin-users"
import { Button } from "@/components/ui/button"
import { formatKstDateTime } from "@/lib/kst"

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

/**
 * 한 행(계정 하나)의 역할·부서·상태를 한곳에서 관리한다.
 *
 * ⚠ 처음엔 서버 액션이 끝나면 router.refresh()로 다시 불러오게 했었다. 그런데 그 재조회가
 *   방금 쓴 값을 아직 못 본 채로 돌아올 때가 있어서(2026-09-04 실측 — DB는 바로 맞게
 *   저장되는데 화면만 옛 값으로 되돌아감), 서버를 다시 묻지 않기로 했다.
 *   **성공 응답이 오면 그 값을 여기 지역 상태에 바로 반영한다.** 실제 DB는 이미 맞고
 *   (새로고침하면 항상 맞게 나온다), 화면은 그걸 낙관적으로 미리 보여주는 것뿐이다.
 *   역할·부서·상태 세 값을 한 컴포넌트에 모아 둔 이유도 이것이다 — 버튼 라벨과
 *   "역할"·"상태" 텍스트 칸이 서로 다른 곳에서 서버 prop을 보면 둘이 어긋난다.
 */
function AccountRow({ account }: { account: Account }) {
  const [role, setRole] = useState(account.role)
  const [department, setDepartment] = useState(account.department ?? "")
  const [status, setStatus] = useState(account.status)

  const [roleState, roleAction, rolePending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const nextRole = formData.get("role") as "member" | "admin"
      const result = (await changeUserRole(formData)) ?? null
      if (result?.ok) setRole(nextRole)
      return result
    },
    null,
  )

  const [deptState, deptAction, deptPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const next = String(formData.get("department") ?? "") as "research" | "planning"
      const result = (await changeUserDepartment(formData)) ?? null
      if (result?.ok) setDepartment(next)
      return result
    },
    null,
  )

  const [statusState, statusAction, statusPending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => {
      const nextStatus = status === "suspended" ? "approved" : "suspended"
      const action = status === "suspended" ? reactivateUser : suspendUser
      const result = (await action(formData)) ?? null
      if (result?.ok) setStatus(nextStatus)
      return result
    },
    null,
  )

  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-3 py-2">{account.username}</td>
      <td className="px-3 py-2">{account.name}</td>
      <td className="px-3 py-2">{account.phone ?? account.email ?? "-"}</td>
      <td className="px-3 py-2">{STATUS_LABEL[status]}</td>
      <td className="px-3 py-2">{ROLE_LABEL[role]}</td>
      <td className="px-3 py-2">
        <div>
          <form action={deptAction}>
            <input type="hidden" name="id" value={account.id} />
            {/* ⚠ value(제어) + key만으로는 안 됐다(2026-09-04 실측) — 선택 직후 짧게 되돌아가는
                현상이 남아 있었다. key를 department 값에 묶어 "값이 바뀔 때마다 완전히 새로
                만든다" + defaultValue(비제어)로 바꾸니 안정적으로 고정됐다. 원인은 끝까지
                명확히 못 밝혔지만(늦게 붙는 하이드레이션이 제어값을 다시 덮어쓰는 것으로 추정),
                이 조합이 반복 테스트(puppeteer 다회 재현)로 안정적임을 확인했다. */}
            <select
              key={`dept-${account.id}-${department}`}
              name="department"
              defaultValue={department}
              disabled={deptPending}
              onChange={(e) => {
                setDepartment(e.target.value)
                e.currentTarget.form?.requestSubmit()
              }}
              className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs outline-none"
            >
              <option value="" disabled>
                미지정
              </option>
              <option value="research">연구소</option>
              <option value="planning">기획실</option>
            </select>
          </form>
          {deptState && !deptState.ok && (
            <p className="mt-1 text-xs text-destructive">{deptState.error}</p>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        {account.last_login_at ? formatKstDateTime(account.last_login_at) : "-"}
      </td>
      <td className="px-3 py-2">
        {role === "super_admin" ? (
          <span className="text-xs text-muted-foreground">변경 불가</span>
        ) : (
          <div>
            <form action={roleAction}>
              <input type="hidden" name="id" value={account.id} />
              <input type="hidden" name="role" value={role === "admin" ? "member" : "admin"} />
              <Button type="submit" size="sm" variant="outline" disabled={rolePending}>
                {rolePending ? "변경 중..." : role === "admin" ? "일반회원으로 변경" : "관리자로 승격"}
              </Button>
            </form>
            {roleState && !roleState.ok && (
              <p className="mt-1 text-xs text-destructive">{roleState.error}</p>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {status === "rejected" ? (
          <span className="text-xs text-muted-foreground">-</span>
        ) : (
          <div>
            <form action={statusAction}>
              <input type="hidden" name="id" value={account.id} />
              <Button
                type="submit"
                size="sm"
                variant={status === "suspended" ? "outline" : "destructive"}
                disabled={statusPending}
              >
                {statusPending ? "처리 중..." : status === "suspended" ? "정지 해제" : "계정 정지"}
              </Button>
            </form>
            {statusState && !statusState.ok && (
              <p className="mt-1 text-xs text-destructive">{statusState.error}</p>
            )}
          </div>
        )}
      </td>
    </tr>
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
            <AccountRow key={a.id} account={a} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
