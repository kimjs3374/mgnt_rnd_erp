"use server"

import { spawn } from "node:child_process"

/**
 * 웹 챗 → Slack 봇과 **같은 chat.ask()** 를 부른다.
 * MCP 도구도 프롬프트도 두 벌로 두지 않는다 — 한쪽만 고쳐지는 사고를 막는다.
 *
 * Next.js(TS) 와 봇(Python) 이 갈리는 지점이라 subprocess 로 넘긴다.
 * 접점은 이 한 곳뿐이고, AI 로직은 전부 Python 에 남는다.
 */

const PY = process.env.RND_BOT_PYTHON ?? "/rnd/bot/venv/bin/python"
const BOT_DIR = process.env.RND_BOT_DIR ?? "/web/rnd/bot"
const TIMEOUT_MS = 150_000

export type ChatAnswer = {
  ok: boolean
  text: string
  turns: number
  seconds: number
  costUsd: number | null
  error?: string
}

const RUNNER = `
import json, sys
sys.path.insert(0, ${JSON.stringify(BOT_DIR)})
import chat
q = sys.stdin.read()
r = chat.ask(q)
print(json.dumps({
    "ok": r.ok, "text": r.text, "turns": r.turns,
    "seconds": r.seconds, "cost_usd": r.cost_usd, "error": r.error,
}, ensure_ascii=False))
`

export async function askChat(question: string): Promise<ChatAnswer> {
  const q = question.trim()
  if (!q) {
    return { ok: false, text: "질문을 입력해 주세요.", turns: 0, seconds: 0, costUsd: null }
  }

  return new Promise<ChatAnswer>((resolve) => {
    const started = Date.now()
    const child = spawn(PY, ["-c", RUNNER], {
      cwd: BOT_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let out = ""
    let err = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
    }, TIMEOUT_MS)

    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err += d))

    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        text: "지금은 답할 수 없습니다.",
        turns: 0,
        seconds: (Date.now() - started) / 1000,
        costUsd: null,
        error: e.message,
      })
    })

    child.on("close", (code) => {
      clearTimeout(timer)
      const seconds = (Date.now() - started) / 1000
      try {
        const d = JSON.parse(out.trim().split("\n").pop() ?? "")
        resolve({
          ok: !!d.ok,
          text: d.text || "지금은 답할 수 없습니다.",
          turns: d.turns ?? 0,
          seconds: d.seconds ?? seconds,
          costUsd: d.cost_usd ?? null,
          error: d.error,
        })
      } catch {
        resolve({
          ok: false,
          text: "지금은 답할 수 없습니다.",
          turns: 0,
          seconds,
          costUsd: null,
          error: (err || `exit ${code}`).slice(0, 300),
        })
      }
    })

    child.stdin.write(q)
    child.stdin.end()
  })
}
