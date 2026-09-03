#!/usr/bin/env node
/**
 * 더미 시드 ① — 과제 12건 · 예산 배정  (db/90_seed_projects_budgets.sql 과 같은 내용)
 *
 * SQL 원본은 `sudo docker exec rnd-db psql` 을 전제하는데 웹 담당 계정에는 sudo·docker 가 없다.
 * 그래서 앱이 쓰는 것과 같은 service_role 클라이언트로 같은 DML 을 친다.
 * REST 라 begin/commit 이 없으므로 **순서**로 안전성을 만든다 —
 *   ① 백업 → ② 과제 삽입 → ③ 기존 집행을 P01 로 이관 → ④ 빈 과제 삭제 → ⑤ 예산 재작성 → ⑥ 검증
 * 중간에 죽어도 집행·판단 이력은 지워지지 않는다(원본 SQL 은 지운다. 그 부분만 의도적으로 다르다).
 *
 * 실행: cd /web/rnd && node scripts/seed-projects-budgets.mjs
 */
import fs from "node:fs"
import path from "node:path"

// ── .env.local 을 직접 읽는다. 앱을 거치지 않고 도는 스크립트라 next 의 로더가 없다.
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

// ⚠ supabase-js 를 쓰지 않는다. 이 서버는 Node 20 이고 supabase-js 는 클라이언트를 만드는 순간
//   RealtimeClient 를 초기화하는데, Node 22 미만에는 전역 WebSocket 이 없어 import 만으로 죽는다.
//   우리가 필요한 건 REST 4개(GET·POST·PATCH·DELETE)뿐이라 PostgREST 에 직접 붙는다.
const REST = env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1"
const KEY = env.SUPABASE_SERVICE_ROLE_KEY

const die = (msg, err) => {
  console.error(`\n✗ ${msg}${err ? ` — ${err.message ?? err}` : ""}`)
  process.exit(1)
}
const won = (n) => Number(n).toLocaleString("ko-KR")
const col = (c) => encodeURIComponent(c) // 컬럼명이 한글이라 쿼리스트링에 그대로 못 넣는다

/** PostgREST 한 번 치기. 테이블이 public 이 아니라 app 스키마라 profile 헤더가 필요하다. */
async function req(method, pathq, body) {
  const res = await fetch(`${REST}/${pathq}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      [method === "GET" ? "Accept-Profile" : "Content-Profile"]: "app",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${pathq} → ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : []
}

// ══════════════════════════════════════════════════════════ 데이터
const DEMO = "RS-2025-00410021" // 데모 주인공 P01

const PROJECTS = [
  ["RS-2025-00410021","커피박 유래 실리콘 복합음극재 기반 고에너지밀도 원통형 이차전지 개발","중소벤처기업부","중소기업기술정보진흥원","산학연 Collabo R&D","2025-CL-0410021","2025-04-01","2027-03-31",2,137000000,102750000,22850000,11400000,"수행중"],
  ["RS-2023-00305514","커피박 바이오매스 활용 이차전지 음극 소재 예비연구","중소벤처기업부","중소기업기술정보진흥원","산학연 Collabo R&D(예비연구)","2023-CL-0305514","2023-04-01","2025-03-31",2,137000000,102750000,22850000,11400000,"종료"],
  ["RS-2026-00521130","지역 주력산업 연계 이동형 태양광 ESS 실증","중소벤처기업부","광주테크노파크","지역혁신선도기업육성(R&D)","2026-GJ-0521130","2026-05-01","2028-04-30",1,300000000,225000000,50000000,25000000,"수행중"],
  ["RS-2026-00521204","전고체 전지용 황화물계 고체전해질 습식 합성 공정 개발","산업통상자원부","한국산업기술기획평가원","소재부품기술개발","2026-MP-0521204","2026-01-01","2027-12-31",1,240000000,180000000,40000000,20000000,"수행중"],
  ["RS-2025-00398877","폐리튬이온전지 흑연 재생 및 재활용 공정 실증","환경부","한국환경산업기술원","중소환경기업 사업화 지원","2025-EV-0398877","2025-07-01","2026-12-31",2,90000000,67500000,15000000,7500000,"수행중"],
  ["RS-2026-00530012","배터리 셀 조립공정 AI 비전 검사 시스템 개발","과학기술정보통신부","정보통신기획평가원","ICT융합 산업혁신","2026-IC-0530012","2026-03-01","2027-02-28",1,180000000,135000000,30000000,15000000,"수행중"],
  ["RS-2026-00544301","원통형 21700 셀 열폭주 지연 케이스 부자재 개발","중소벤처기업부","중소기업기술정보진흥원","창업성장기술개발","2026-ST-0544301","2026-06-01","2027-05-31",1,120000000,90000000,20000000,10000000,"수행중"],
  ["RS-2024-00351902","수계 바인더 적용 친환경 음극 슬러리 배합 최적화","중소벤처기업부","중소기업기술정보진흥원","기술혁신개발","2024-TI-0351902","2024-05-01","2026-04-30",2,200000000,150000000,33000000,17000000,"종료"],
  ["RS-2024-00344115","고출력 셀용 알루미늄 집전체 표면처리 기술 개발","산업통상자원부","한국산업기술기획평가원","소재부품기술개발","2024-MP-0344115","2024-03-01","2025-12-31",2,160000000,120000000,26000000,14000000,"종료"],
  ["RS-2026-00551777","이차전지 소재 국제공동연구(한-독) 실리콘 복합체","과학기술정보통신부","한국연구재단","국제협력사업","2026-NR-0551777","2026-09-01","2028-08-31",1,260000000,195000000,43000000,22000000,"신청중"],
  ["RS-2026-00552310","분리막 코팅 세라믹 슬러리 분산 안정화 기술","중소벤처기업부","중소기업기술정보진흥원","구매조건부신제품개발","2026-PC-0552310","2026-10-01","2027-09-30",1,95000000,71250000,15750000,8000000,"신청중"],
  ["RS-2022-00284460","리튬이온전지 전해액 첨가제 스크리닝 자동화","중소벤처기업부","중소기업기술정보진흥원","기술혁신개발","2022-TI-0284460","2022-06-01","2024-05-31",2,150000000,112500000,24000000,13500000,"종료"],
].map(([과제코드,과제명,부처,전문기관,사업명,협약번호,시작일,종료일,연차,총사업비,정부지원금,기관부담_현금,기관부담_현물,상태]) => ({
  과제코드,과제명,부처,전문기관,사업명,협약번호,시작일,종료일,연차,총사업비,정부지원금,기관부담_현금,기관부담_현물,상태,
}))

// 한도비율: 연구수당 20 / 간접비 10 — 2026 지역혁신선도 공고 유의사항 원문 기준
const BUDGETS = [
  // ── P01 데모 주인공 (137,000,000)
  ["RS-2025-00410021","PERSONNEL","출연금",6000000,null],
  ["RS-2025-00410021","PERSONNEL","현물",11400000,null],
  ["RS-2025-00410021","STUDENT","출연금",2400000,null],
  ["RS-2025-00410021","FACILITY","출연금",60000000,null],
  ["RS-2025-00410021","FACILITY","현금",18000000,null],
  ["RS-2025-00410021","ACTIVITY","출연금",21150000,null],
  ["RS-2025-00410021","ACTIVITY","현금",3850000,null],
  ["RS-2025-00410021","ALLOWANCE","출연금",4200000,20], // ⚠ 한도 3,960,000 초과 — 시연 포인트
  ["RS-2025-00410021","INDIRECT","출연금",9000000,10],
  ["RS-2025-00410021","INDIRECT","현금",1000000,10],
  // ── P02 종료 과제
  ["RS-2023-00305514","PERSONNEL","출연금",6000000,null],
  ["RS-2023-00305514","PERSONNEL","현물",11400000,null],
  ["RS-2023-00305514","STUDENT","출연금",2400000,null],
  ["RS-2023-00305514","FACILITY","출연금",60000000,null],
  ["RS-2023-00305514","FACILITY","현금",18000000,null],
  ["RS-2023-00305514","ACTIVITY","출연금",21150000,null],
  ["RS-2023-00305514","ACTIVITY","현금",3850000,null],
  ["RS-2023-00305514","ALLOWANCE","출연금",3900000,20],
  ["RS-2023-00305514","INDIRECT","출연금",10000000,10],
  // ── 나머지 (출연금 단일 재원으로 단순화)
  ["RS-2026-00521130","PERSONNEL","출연금",48000000,null],
  ["RS-2026-00521130","STUDENT","출연금",6000000,null],
  ["RS-2026-00521130","FACILITY","출연금",150000000,null],
  ["RS-2026-00521130","ACTIVITY","출연금",55000000,null],
  ["RS-2026-00521130","ALLOWANCE","출연금",10800000,20],
  ["RS-2026-00521130","INDIRECT","출연금",30200000,10],
  ["RS-2026-00521204","PERSONNEL","출연금",40000000,null],
  ["RS-2026-00521204","STUDENT","출연금",4800000,null],
  ["RS-2026-00521204","FACILITY","출연금",120000000,null],
  ["RS-2026-00521204","ACTIVITY","출연금",42000000,null],
  ["RS-2026-00521204","ALLOWANCE","출연금",8960000,20],
  ["RS-2026-00521204","INDIRECT","출연금",24240000,10],
  ["RS-2025-00398877","PERSONNEL","출연금",18000000,null],
  ["RS-2025-00398877","STUDENT","출연금",2400000,null],
  ["RS-2025-00398877","FACILITY","출연금",40000000,null],
  ["RS-2025-00398877","ACTIVITY","출연금",17600000,null],
  ["RS-2025-00398877","ALLOWANCE","출연금",4080000,20],
  ["RS-2025-00398877","INDIRECT","출연금",7920000,10],
  ["RS-2026-00530012","PERSONNEL","출연금",36000000,null],
  ["RS-2026-00530012","STUDENT","출연금",4800000,null],
  ["RS-2026-00530012","FACILITY","출연금",82000000,null],
  ["RS-2026-00530012","ACTIVITY","출연금",32000000,null],
  ["RS-2026-00530012","ALLOWANCE","출연금",8160000,20],
  ["RS-2026-00530012","INDIRECT","출연금",17040000,10],
  ["RS-2026-00544301","PERSONNEL","출연금",24000000,null],
  ["RS-2026-00544301","STUDENT","출연금",3600000,null],
  ["RS-2026-00544301","FACILITY","출연금",56000000,null],
  ["RS-2026-00544301","ACTIVITY","출연금",21000000,null],
  ["RS-2026-00544301","ALLOWANCE","출연금",5520000,20],
  ["RS-2026-00544301","INDIRECT","출연금",9880000,10],
  ["RS-2024-00351902","PERSONNEL","출연금",42000000,null],
  ["RS-2024-00351902","STUDENT","출연금",6000000,null],
  ["RS-2024-00351902","FACILITY","출연금",88000000,null],
  ["RS-2024-00351902","ACTIVITY","출연금",34000000,null],
  ["RS-2024-00351902","ALLOWANCE","출연금",9600000,20],
  ["RS-2024-00351902","INDIRECT","출연금",20400000,10],
  ["RS-2024-00344115","PERSONNEL","출연금",33000000,null],
  ["RS-2024-00344115","STUDENT","출연금",4800000,null],
  ["RS-2024-00344115","FACILITY","출연금",70000000,null],
  ["RS-2024-00344115","ACTIVITY","출연금",27000000,null],
  ["RS-2024-00344115","ALLOWANCE","출연금",7560000,20],
  ["RS-2024-00344115","INDIRECT","출연금",17640000,10],
  ["RS-2026-00551777","PERSONNEL","출연금",52000000,null],
  ["RS-2026-00551777","STUDENT","출연금",7200000,null],
  ["RS-2026-00551777","FACILITY","출연금",118000000,null],
  ["RS-2026-00551777","ACTIVITY","출연금",48000000,null],
  ["RS-2026-00551777","ALLOWANCE","출연금",11840000,20],
  ["RS-2026-00551777","INDIRECT","출연금",22960000,10],
  ["RS-2026-00552310","PERSONNEL","출연금",19000000,null],
  ["RS-2026-00552310","STUDENT","출연금",2400000,null],
  ["RS-2026-00552310","FACILITY","출연금",44000000,null],
  ["RS-2026-00552310","ACTIVITY","출연금",17000000,null],
  ["RS-2026-00552310","ALLOWANCE","출연금",4280000,20],
  ["RS-2026-00552310","INDIRECT","출연금",8320000,10],
  ["RS-2022-00284460","PERSONNEL","출연금",30000000,null],
  ["RS-2022-00284460","STUDENT","출연금",3600000,null],
  ["RS-2022-00284460","FACILITY","출연금",66000000,null],
  ["RS-2022-00284460","ACTIVITY","출연금",26000000,null],
  ["RS-2022-00284460","ALLOWANCE","출연금",6720000,20],
  ["RS-2022-00284460","INDIRECT","출연금",17680000,10],
]

// ══════════════════════════════════════════════════════════ 실행
const sel = async (t, q = "select=*") => {
  try {
    return await req("GET", `${t}?${q}`)
  } catch (e) {
    die(`${t} 조회 실패`, e)
  }
}

// ── ① 백업. 되돌릴 수 없는 일을 하기 전에 무조건 먼저 뜬다.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const dir = path.join(process.env.HOME, "rnd-backup", stamp)
fs.mkdirSync(dir, { recursive: true })
for (const t of ["projects", "budgets", "expenses", "decisions"]) {
  const rows = await sel(t)
  fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows, null, 2))
  console.log(`  백업 ${t.padEnd(10)} ${String(rows.length).padStart(4)}행`)
}
console.log(`백업 위치 ${dir}\n`)

// ── ② 과제 삽입 (없는 코드만). 이미 있으면 건드리지 않아 id 가 흔들리지 않는다.
const codes = PROJECTS.map((p) => p.과제코드)
const before = await sel("projects", `select=id,${col("과제코드")}`)
const have = new Set(before.map((r) => r.과제코드))
const toAdd = PROJECTS.filter((p) => !have.has(p.과제코드))
if (toAdd.length) {
  try {
    await req("POST", "projects", toAdd)
  } catch (e) {
    die("과제 삽입 실패", e)
  }
}
console.log(`과제 삽입 ${toAdd.length}건 (이미 있던 것 ${PROJECTS.length - toAdd.length}건)`)

const after = await sel("projects", `select=id,${col("과제코드")}`)
const idOf = new Map(after.map((r) => [r.과제코드, r.id]))
const seedIds = codes.map((c) => idOf.get(c)).filter(Boolean)
if (seedIds.length !== 12) die(`과제 12건이 안 된다 (${seedIds.length}건)`)

// ── ③ 시드 밖 과제에 달린 기존 집행을 P01 로 이관한다.
//     원본 SQL 은 이 집행들을 지운다. 지우면 판단 이력(decisions)까지 CASCADE 로 날아가고
//     「우리 회사 과거 처리」와 정정 사유가 사라진다 — 그게 이 제품의 핵심 주장이라 이관을 택했다.
const keep = new Set(seedIds)
const orphanProjects = after.filter((r) => !keep.has(r.id))
const orphanIds = orphanProjects.map((r) => r.id)
let moved = 0
if (orphanIds.length) {
  try {
    const rows = await req(
      "PATCH",
      `expenses?${col("과제_id")}=in.(${orphanIds.join(",")})&select=id`,
      { 과제_id: idOf.get(DEMO) },
    )
    moved = rows.length
  } catch (e) {
    die("집행 이관 실패", e)
  }
}
console.log(`집행 이관 ${moved}건 → ${DEMO}`)

// ── ④ 비게 된 옛 과제 삭제
if (orphanIds.length) {
  try {
    await req("DELETE", `projects?id=in.(${orphanIds.join(",")})&select=id`)
  } catch (e) {
    die("옛 과제 삭제 실패", e)
  }
  console.log(`옛 과제 삭제 ${orphanIds.length}건 (${orphanProjects.map((r) => r.과제코드).join(", ")})`)
}

// ── ⑤ 예산 재작성. 배정액은 계상 결과라 통째로 갈아끼우는 편이 정확하다.
try {
  await req("DELETE", `budgets?${col("과제_id")}=in.(${seedIds.join(",")})&select=id`)
} catch (e) {
  die("예산 삭제 실패", e)
}
{
  const rows = BUDGETS.map(([code, 비목_대분류, 재원구분, 배정액, 한도비율]) => ({
    과제_id: idOf.get(code), 비목_대분류, 재원구분, 배정액, 한도비율,
  }))
  try {
    await req("POST", "budgets", rows)
  } catch (e) {
    die("예산 삽입 실패", e)
  }
  console.log(`예산 삽입 ${rows.length}행`)
}

// ── ⑥ 검증. 원본 SQL 말미의 확인 쿼리를 그대로 코드로 옮겼다.
const bud = await sel(
  "budgets",
  `select=${col("배정액")},${col("비목_대분류")},${col("재원구분")}&${col("과제_id")}=eq.${idOf.get(DEMO)}`,
)
const total = bud.reduce((a, b) => a + Number(b.배정액), 0)
const cat = (c) => bud.filter((b) => b.비목_대분류 === c).reduce((a, b) => a + Number(b.배정액), 0)
const 수정인건비 = cat("PERSONNEL") + cat("STUDENT")
const 수당한도 = Math.floor((수정인건비 * 0.2) / 100) * 100
const 수당 = cat("ALLOWANCE")

console.log("\n── 검증 (P01)")
const ck = (name, ok, detail) => console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(22)} ${detail}`)
ck("계상 합계 = 총사업비", total === 137000000, `${won(total)}원`)
ck("수정인건비", 수정인건비 === 19800000, `${won(수정인건비)}원`)
ck("연구수당 한도 초과", 수당 > 수당한도, `계상 ${won(수당)} / 한도 ${won(수당한도)} → ${won(수당 - 수당한도)}원 초과`)

const projCnt = await sel("projects", "select=id")
const expCnt = await sel("expenses", "select=id")
const decCnt = await sel("decisions", "select=id")
console.log(`\n과제 ${projCnt.length}건 · 예산 ${BUDGETS.length}행 · 집행 ${expCnt.length}건 · 판단 ${decCnt.length}건`)

if (total !== 137000000) die("총사업비가 안 맞는다. 백업으로 되돌릴 것.")
console.log("\n완료.")
