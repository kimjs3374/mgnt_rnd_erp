import "server-only"

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/**
 * 아주 단순한 인메모리 레이트 리밋 — 프로세스 하나짜리 dev/데모 서버 전제다.
 * 여러 인스턴스로 스케일하면(예: prod에서 pm2 클러스터) DB나 Redis로 바꿔야 한다.
 * 지금은 로그인 시도 제한 용도로만 쓴다.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count++
  return true
}

export function resetRateLimit(key: string): void {
  buckets.delete(key)
}
