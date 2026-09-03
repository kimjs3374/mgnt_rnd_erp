import "server-only"
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

/**
 * 비밀번호 해시 — Node 내장 scrypt. 외부 패키지(bcrypt 등) 설치 없이 바로 쓴다.
 * 저장 형식은 'salt:hash' (둘 다 hex). 검증도 이 형식을 그대로 가정한다.
 */

const KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, KEYLEN).toString("hex")
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false
  const hashBuf = Buffer.from(hash, "hex")
  const candidate = scryptSync(password, salt, KEYLEN)
  if (candidate.length !== hashBuf.length) return false
  return timingSafeEqual(candidate, hashBuf)
}

/** 계정 신청 화면의 비밀번호 규칙과 같은 기준(8자 이상 + 3종 이상)을 서버에서도 강제한다. */
export function isPasswordStrongEnough(password: string): boolean {
  if (password.length < 8) return false
  let classes = 0
  if (/[A-Z]/.test(password)) classes++
  if (/[a-z]/.test(password)) classes++
  if (/[0-9]/.test(password)) classes++
  if (/[^A-Za-z0-9]/.test(password)) classes++
  return classes >= 3
}
