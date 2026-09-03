import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/current-user"
import { approveUser, rejectUser } from "@/app/actions/admin-users"
import { AdminResetRequests } from "@/components/admin-reset-requests"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

type PendingUser = {
  id: number
  username: string
  name: string
  phone: string | null
  email: string | null
  created_at: string
}

type ResetRequest = {
  id: number
  username: string
  name: string
  email: string | null
  reset_requested_at: string
}

export default async function AdminUsersPage() {
  const user = await getCurrentUser()
  if (!user.인증 || user.role !== "admin") {
    redirect("/dashboard")
  }

  const { data, error } = await db
    .from("users")
    .select("id, username, name, phone, email, created_at")
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

  return (
    <div className="space-y-8 p-4">
      <div>
        <h1 className="text-xl font-semibold">계정 승인</h1>
        <p className="text-sm text-muted-foreground">가입 신청한 계정을 승인하거나 반려합니다.</p>
      </div>

      {error && (
        <p className="text-sm text-destructive">목록을 불러오지 못했습니다: {error.message}</p>
      )}

      {!error && pending.length === 0 && (
        <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          승인 대기 중인 계정이 없습니다.
        </p>
      )}

      {pending.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">아이디</th>
                <th className="px-3 py-2 font-medium">이름</th>
                <th className="px-3 py-2 font-medium">연락처</th>
                <th className="px-3 py-2 font-medium">이메일</th>
                <th className="px-3 py-2 font-medium">신청일</th>
                <th className="px-3 py-2 font-medium text-right">처리</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{u.username}</td>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2">{u.phone ?? "-"}</td>
                  <td className="px-3 py-2">{u.email ?? "-"}</td>
                  <td className="px-3 py-2">
                    {new Date(u.created_at).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <form action={approveUser}>
                        <input type="hidden" name="id" value={u.id} />
                        <Button type="submit" size="sm">
                          승인
                        </Button>
                      </form>
                      <form action={rejectUser}>
                        <input type="hidden" name="id" value={u.id} />
                        <Button type="submit" size="sm" variant="destructive">
                          반려
                        </Button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
