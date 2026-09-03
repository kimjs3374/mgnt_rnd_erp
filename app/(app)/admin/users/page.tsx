import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { AdminPendingUsers } from "@/components/admin-pending-users"
import { AdminResetRequests } from "@/components/admin-reset-requests"
import { AdminAccounts } from "@/components/admin-accounts"

export const dynamic = "force-dynamic"

type PendingUser = {
  id: number
  username: string
  name: string
  phone: string | null
  email: string | null
  department: "research" | "planning" | null
  created_at: string
}

type ResetRequest = {
  id: number
  username: string
  name: string
  email: string | null
  reset_requested_at: string
}

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

export default async function AdminUsersPage() {
  const user = await getCurrentUser()
  if (!user.인증 || user.role !== "super_admin") {
    redirect("/dashboard")
  }

  const { data, error } = await db
    .from("users")
    .select("id, username, name, phone, email, department, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .returns<PendingUser[]>()

  const pending = data ?? []

  const { data: resetData, error: resetError } = await db
    .from("users")
    .select("id, username, name, email, reset_requested_at")
    .not("reset_requested_at", "is", null)
    .order("reset_requested_at", { ascending: true })
    .returns<ResetRequest[]>()
  const resetRequests = resetData ?? []

  const { data: accountsData, error: accountsError } = await db
    .from("users")
    .select("id, username, name, email, phone, role, status, department, last_login_at")
    .neq("status", "pending")
    .order("username", { ascending: true })
    .returns<Account[]>()
  const accounts = accountsData ?? []

  return (
    <div className="space-y-8 p-4">
      <div>
        <h1 className="text-xl font-semibold">계정 관리</h1>
        <p className="text-sm text-muted-foreground">
          슈퍼관리자만 접근할 수 있습니다. 가입 승인, 권한 부여, 계정 정지를 여기서 처리합니다.
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold">계정 승인</h2>
        <p className="text-sm text-muted-foreground">가입 신청한 계정을 승인하거나 반려합니다.</p>
      </div>

      {error && (
        <p className="text-sm text-destructive">목록을 불러오지 못했습니다: {error.message}</p>
      )}
      {!error && <AdminPendingUsers initialUsers={pending} />}

      <div>
        <h2 className="text-lg font-semibold">전체 계정 · 권한 관리</h2>
        <p className="text-sm text-muted-foreground">
          역할을 바꾸거나 계정을 정지/해제합니다. 본인 계정과 마지막 남은 최고관리자는 보호됩니다.
        </p>
      </div>

      {accountsError && (
        <p className="text-sm text-destructive">목록을 불러오지 못했습니다: {accountsError.message}</p>
      )}
      {!accountsError && <AdminAccounts accounts={accounts} />}

      <div>
        <h2 className="text-lg font-semibold">비밀번호 재설정 요청</h2>
        <p className="text-sm text-muted-foreground">
          이메일 자동 발송은 지원하지 않습니다. 임시 비밀번호를 발급한 뒤 본인에게 직접 전달하세요.
        </p>
      </div>

      {resetError && (
        <p className="text-sm text-destructive">목록을 불러오지 못했습니다: {resetError.message}</p>
      )}
      {!resetError && <AdminResetRequests requests={resetRequests} />}
    </div>
  )
}
