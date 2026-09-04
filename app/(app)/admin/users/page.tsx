import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { AdminUsersClient } from "@/components/admin-users-client"

export const dynamic = "force-dynamic"

type PendingUser = {
  id: number
  username: string
  name: string
  phone: string | null
  email: string | null
  department: "research" | "planning" | "executive" | null
  position: string | null
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
  status: "approved" | "suspended"
  department: "research" | "planning" | "executive" | null
  position: string | null
  extra_menus: ("research" | "planning")[] | null
  last_login_at: string | null
}

export default async function AdminUsersPage() {
  const user = await getCurrentUser()
  if (!user.인증 || user.role !== "super_admin") {
    redirect("/dashboard")
  }

  const { data, error } = await db
    .from("users")
    .select("id, username, name, phone, email, department, position, created_at")
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

  // "계정 관리" 탭 — 승인·반려는 별도 탭(계정 승인)에서 다루니 여기선 정상·정지된
  // 계정만 부서별로 훑는다(반려는 애초에 직원이 된 적이 없어서 여기 안 넣는다).
  const { data: accountsData, error: accountsError } = await db
    .from("users")
    .select(
      "id, username, name, email, phone, role, status, department, position, extra_menus, last_login_at",
    )
    .in("status", ["approved", "suspended"])
    .order("name", { ascending: true })
    .returns<Account[]>()
  const accounts = accountsData ?? []

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">계정 관리</h1>
        <p className="text-sm text-muted-foreground">
          슈퍼관리자만 접근할 수 있습니다. 인원 조회, 권한 부여, 계정 승인을 여기서 처리합니다.
        </p>
      </div>

      {(error || accountsError) && (
        <p className="text-sm text-destructive">
          목록을 불러오지 못했습니다: {(error ?? accountsError)?.message}
        </p>
      )}
      {!error && !accountsError && (
        <AdminUsersClient
          initialPending={pending}
          initialAccounts={accounts}
          resetRequests={resetRequests}
        />
      )}
      {resetError && (
        <p className="mt-4 text-sm text-destructive">
          비밀번호 재설정 요청 목록을 불러오지 못했습니다: {resetError.message}
        </p>
      )}
    </div>
  )
}
