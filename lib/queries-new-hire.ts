import "server-only"
import { db, safeSelect } from "@/lib/db"
import type { NewHireRule } from "@/lib/new-hire"

/**
 * 신규채용 기준 규칙(db/112). 전건이 몇 줄이라 통째로 받아 화면에서 고른다 —
 * 고르는 판단(`규칙고르기`: 공고 > 사업유형 > 공통)은 순수 함수가 해야
 * 「왜 이 기준이 이겼는지」를 화면에서 말할 수 있다(`funding_share_rules` 와 같은 방식).
 */
export const getNewHireRules = () =>
  safeSelect<NewHireRule>("new_hire_rules", () =>
    db.from("new_hire_rules").select("*").order("id"),
  )

/** 그 공고의 공고일 — 신규채용 판정의 기준일 후보다(과제의 공고일이 비어 있을 때). */
export const getAnnouncementDate = (공고_id: number) =>
  safeSelect<{ id: number; 공고일: string | null }>("announcements", () =>
    db.from("announcements").select("*").eq("id", 공고_id).limit(1),
  )
