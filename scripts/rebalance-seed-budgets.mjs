#!/usr/bin/env node
/**
 * 시드 ① 후속 — 계상을 협약서에 맞춘다.
 *
 * 왜 필요한가: 시드가 「나머지 과제는 출연금 단일 재원으로 단순화」했는데,
 * 같은 시드가 projects 에는 정부지원금·기관부담 현금·현물을 따로 넣었다. 둘이 어긋난다.
 * 예) 과제 RS-2026-00521130 — 협약은 정부 225,000,000 / 현금 50,000,000 / 현물 25,000,000 인데
 *     계상은 출연금 300,000,000 이다. 그래서 한도 검증이 12건 전부를 「손봐야 할 과제」로 찍는다.
 *
 * 검증이 틀린 게 아니라 **더미가 자기모순**이다. 12개가 다 빨간불이면 P01 의
 * 연구수당 240,000원 초과(시연에서 보여줄 진짜 경고)가 묻힌다. 그래서 데이터를 고친다.
 *
 * 규칙 — lib/verify.ts 와 같은 계산을 쓴다. 화면과 데이터가 다른 셈을 하면 안 된다.
 *   ① 간접비 = (직접비 − 현물) × r/(100+r), 백만원 절사  ← 곱셈이 아니라 총액 역산
 *   ② 연구수당 ≤ (인건비 + 학생인건비) × r%, 백원 절사
 *   ③ 재원: 현물은 인건비에, 현금은 시설·장비에 얹는다. 나머지가 출연금이 되고
 *      총사업비 = 정부지원금 + 현금 + 현물 이므로 출연금 합계는 자동으로 협약과 맞는다.
 *
 * ⚠ P01(RS-2025-00410021)은 건드리지 않는다. 연구수당 240,000원 초과는 **일부러** 넣은 것이다.
 *
 * 실행: cd /web/rnd && node scripts/rebalance-seed-budgets.mjs
 */
import fs from "node:fs"
import path from "node:path"

const env = Object.fromEntries(
  fs
    .readFileSync("/web/rnd/.env.local", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]
    }),
)
const REST = env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1"
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const col = (c) => encodeURIComponent(c)

async function req(method, pathq, body) {
  const res = await fetch(`${REST}/${pathq}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      [method === "GET" ? "Accept-Profile" : "Content-Profile"]: "app",
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${pathq} → ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : []
}

const die = (m) => {
  console.error(`\n✗ ${m}`)
  process.exit(1)
}
const won = (n) => Number(n).toLocaleString("ko-KR")
/** lib/verify.ts 의 floorTo 와 같다. epsilon 을 더하고 내린다 — 절사 경계에서 100만원이 사라진다. */
const floorTo = (n, d) => Math.floor(n / 10 ** d + 1e-9) * 10 ** d

const DEMO = "RS-2025-00410021" // 손대지 않는다
const 수당비율 = 20
const 간접비율 = 10

// ── 현재 상태 읽기
const projects = await req("GET", "projects?select=*")
const budgets = await req("GET", "budgets?select=*")
const 예산of = (pid) => budgets.filter((b) => b.과제_id === pid)

// ── 백업
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const dir = path.join(process.env.HOME, "rnd-backup", stamp)
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, "budgets.json"), JSON.stringify(budgets, null, 2))
console.log(`백업 budgets ${budgets.length}행 → ${dir}\n`)

const 결과 = []
const upserts = []

for (const p of projects) {
  const lines = 예산of(p.id)
  if (!lines.length) continue
  if (p.과제코드 === DEMO) {
    결과.push({ 코드: p.과제코드, 처리: "건너뜀 (시연용 초과 유지)" })
    continue
  }

  const 총 = Number(p.총사업비 || 0)
  const 현금목표 = Number(p.기관부담_현금 || 0)
  const 현물목표 = Number(p.기관부담_현물 || 0)
  if (총 <= 0) {
    결과.push({ 코드: p.과제코드, 처리: "총사업비 없음 — 건너뜀" })
    continue
  }

  // ① 간접비 — 총액 역산이라 자기참조다(간접비가 정해져야 직접비가 정해진다).
  //    백만원 단위로 위에서부터 내려오며 「한도를 넘지 않는 가장 큰 값」을 찾는다.
  let 간접 = 0
  for (let I = floorTo(총, 6); I >= 0; I -= 1_000_000) {
    const D = 총 - I
    if (D <= 현물목표) continue
    if (I <= floorTo(((D - 현물목표) * 간접비율) / (100 + 간접비율), 6)) {
      간접 = I
      break
    }
  }
  const 직접목표 = 총 - 간접

  // ② 직접비 — 기존 비중을 유지하며 목표에 맞춰 늘리고, 잔차는 시설·장비가 흡수한다.
  const 기존 = {}
  for (const l of lines) 기존[l.비목_대분류] = (기존[l.비목_대분류] ?? 0) + Number(l.배정액)
  const 기존직접 = Object.entries(기존)
    .filter(([c]) => c !== "INDIRECT")
    .reduce((a, [, v]) => a + v, 0)
  const scale = 직접목표 / 기존직접

  const 새값 = {}
  for (const c of ["PERSONNEL", "STUDENT", "ACTIVITY", "ALLOWANCE"]) {
    if (기존[c]) 새값[c] = Math.round((기존[c] * scale) / 1000) * 1000
  }
  // 연구수당은 한도를 넘기지 않는다. 넘치는 만큼은 시설·장비로 보낸다.
  const 수당한도 = floorTo((((새값.PERSONNEL ?? 0) + (새값.STUDENT ?? 0)) * 수당비율) / 100, 2)
  if ((새값.ALLOWANCE ?? 0) > 수당한도) 새값.ALLOWANCE = 수당한도
  새값.FACILITY =
    직접목표 - Object.entries(새값).reduce((a, [, v]) => a + v, 0)
  새값.INDIRECT = 간접

  if (새값.FACILITY <= 0) die(`${p.과제코드}: 시설·장비가 음수가 된다. 손으로 봐야 한다.`)

  // ③ 재원 — 현물은 인건비, 현금은 시설·장비. 나머지는 출연금.
  const rows = []
  const push = (cat, src, amt, lim = null) => {
    if (amt > 0) rows.push({ 과제_id: p.id, 비목_대분류: cat, 재원구분: src, 배정액: amt, 한도비율: lim })
  }
  const 현물 = Math.min(현물목표, 새값.PERSONNEL ?? 0)
  if (현물 !== 현물목표) die(`${p.과제코드}: 현물 ${won(현물목표)} 이 인건비보다 크다. 손으로 봐야 한다.`)
  const 현금 = Math.min(현금목표, 새값.FACILITY)
  if (현금 !== 현금목표) die(`${p.과제코드}: 현금 ${won(현금목표)} 이 시설·장비보다 크다.`)

  push("PERSONNEL", "현물", 현물)
  push("PERSONNEL", "출연금", (새값.PERSONNEL ?? 0) - 현물)
  push("STUDENT", "출연금", 새값.STUDENT ?? 0)
  push("FACILITY", "현금", 현금)
  push("FACILITY", "출연금", 새값.FACILITY - 현금)
  push("ACTIVITY", "출연금", 새값.ACTIVITY ?? 0)
  push("ALLOWANCE", "출연금", 새값.ALLOWANCE ?? 0, 수당비율)
  push("INDIRECT", "출연금", 새값.INDIRECT, 간접비율)

  // ④ 검산 — 저장하기 전에 스스로 확인한다.
  const 합 = rows.reduce((a, r) => a + r.배정액, 0)
  const 출연 = rows.filter((r) => r.재원구분 === "출연금").reduce((a, r) => a + r.배정액, 0)
  if (합 !== 총) die(`${p.과제코드}: 계상 ${won(합)} ≠ 총사업비 ${won(총)}`)
  if (출연 !== Number(p.정부지원금)) {
    die(`${p.과제코드}: 출연금 ${won(출연)} ≠ 정부지원금 ${won(p.정부지원금)}`)
  }

  upserts.push(...rows)
  결과.push({
    코드: p.과제코드,
    처리: `직접 ${won(직접목표)} · 간접 ${won(간접)} · 현금 ${won(현금)} · 현물 ${won(현물)}`,
  })
}

// ── 저장. 기존 줄을 지우고 새로 넣는다(재원 구성이 통째로 바뀌므로).
const 대상 = [...new Set(upserts.map((r) => r.과제_id))]
if (대상.length) {
  await req("DELETE", `budgets?${col("과제_id")}=in.(${대상.join(",")})&select=id`)
  await req("POST", "budgets", upserts)
}

for (const r of 결과) console.log(`  ${r.코드}  ${r.처리}`)
console.log(`\n${대상.length}개 과제 · ${upserts.length}행 재작성`)

// ── 최종 검증 — 화면이 쓰는 뷰를 그대로 읽어 같은 셈을 다시 한다.
const view = await req("GET", "v_budget_status?select=*")
let 위반 = 0
for (const p of projects) {
  const ls = view.filter((v) => v.과제_id === p.id)
  if (!ls.length) continue
  const s = (f) => ls.filter(f).reduce((a, v) => a + Number(v.배정액), 0)
  const 계상 = s(() => true)
  const 수정인건비 = s((v) => ["PERSONNEL", "STUDENT"].includes(v.비목_대분류))
  const 수당 = s((v) => v.비목_대분류 === "ALLOWANCE")
  const 직접 = s((v) => v.비목_대분류 !== "INDIRECT")
  const 현물 = s((v) => v.재원구분 === "현물" && v.비목_대분류 !== "INDIRECT")
  const 간접 = s((v) => v.비목_대분류 === "INDIRECT")
  const bad = []
  if (계상 !== Number(p.총사업비)) bad.push(`총액 ${won(계상 - Number(p.총사업비))}`)
  if (s((v) => v.재원구분 === "출연금") !== Number(p.정부지원금)) bad.push("출연금")
  if (s((v) => v.재원구분 === "현금") !== Number(p.기관부담_현금 || 0)) bad.push("현금")
  if (s((v) => v.재원구분 === "현물") !== Number(p.기관부담_현물 || 0)) bad.push("현물")
  if (수당 > floorTo((수정인건비 * 수당비율) / 100, 2)) {
    bad.push(`연구수당 ${won(수당 - floorTo((수정인건비 * 수당비율) / 100, 2))} 초과`)
  }
  if (간접 > floorTo(((직접 - 현물) * 간접비율) / (100 + 간접비율), 6)) bad.push("간접비 초과")
  if (bad.length) {
    위반++
    console.log(`  ✗ ${p.과제코드}  ${bad.join(" · ")}`)
  }
}
console.log(`\n한도·협약 위반 과제 ${위반}건 (P01 의 연구수당 초과 1건만 남는 것이 정상)`)
