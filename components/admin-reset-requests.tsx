"use client"

import { useActionState } from "react"
import { issueTempPassword, type IssueTempPasswordResult } from "@/app/actions/admin-users"
import { Button } from "@/components/ui/button"

type ResetRequest = {
  id: number
  username: string
  name: string
  email: string | null
  reset_requested_at: string
}

const initialState: IssueTempPasswordResult | null = null

function IssueRow({ req }: { req: ResetRequest }) {
  const [state, formAction, pending] = useActionState<IssueTempPasswordResult | null, FormData>(
    async (_prev, formData) => (await issueTempPassword(formData)) ?? null,
    initialState,
  )

  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-3 py-2">{req.username}</td>
      <td className="px-3 py-2">{req.name}</td>
      <td className="px-3 py-2">{req.email ?? "-"}</td>
      <td className="px-3 py-2">{new Date(req.reset_requested_at).toLocaleString("ko-KR")}</td>
      <td className="px-3 py-2">
        {state?.ok ? (
          <div className="text-sm">
            <span className="font-mono font-medium">{state.tempPassword}</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              본인에게 직접 전달하세요 — 문서·메일·Slack에 남기지 않습니다.
            </p>
          </div>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="id" value={req.id} />
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "발급 중..." : "임시 비밀번호 발급"}
            </Button>
            {state && !state.ok && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
          </form>
        )}
      </td>
    </tr>
  )
}

export function AdminResetRequests({ requests }: { requests: ResetRequest[] }) {
  if (requests.length === 0) {
    return (
      <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        비밀번호 재설정 요청이 없습니다.
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
            <th className="px-3 py-2 font-medium">이메일</th>
            <th className="px-3 py-2 font-medium">요청일시</th>
            <th className="px-3 py-2 font-medium">처리</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <IssueRow key={r.id} req={r} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
