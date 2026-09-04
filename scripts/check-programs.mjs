// 제출 전 점검 — 계산으로 확정되는 것만 다룬다. LLM 을 쓰지 않는다(CLAUDE.md 설계원칙 2).
//
// 채우는 두 가지(둘 다 이미 화면 어딘가에서 실시간 계산해 보여주던 것을 program_checks 에
// "이력"으로 남기는 것뿐이다 — 화면은 바뀌지 않는다, `app.v_program_ledger`가 이 테이블을
// 세서 대시보드·지원사업 대장의 "미처리 점검" 숫자를 이미 읽고 있었는데 지금까지 아무도
// 여기에 쓴 적이 없어 항상 0 이었다):
//
//   ① 기한임박 — 수행 중인 과제의 종료일이 30일 이내인데 완료보고가 안 끝났다.
//      중간보고 예정일이 14일 이내인데 중간보고가 안 끝났다.
//   ② 금액불일치 — 그 과제에 잡힌 비목 배정 합이 총사업비를 넘었다(총사업비 초과).
//
// ⚠ 서류 미확보는 여기서 다루지 않는다 — project_evidence_files 가 아직 2건뿐이라
//   전 과제가 "미확보"로 찍혀 나온다. 실제로 뭐가 부족한지 가리는 신호가 아니라
//   "전부 빨갛다"만 보여주게 된다. 데이터가 쌓이면 그때 켠다.
//
// 재실행해도 같은 문제를 두 번 쌓지 않는다 — 같은 과제·같은 종류로 "미처리" 상태인
// 게 이미 있으면 건너뛴다.
import { pgSelect, pgInsert } from "./lib/pgrest.mjs"

const 오늘 = new Date().toISOString().slice(0, 10)

function 날짜차(a, b) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000)
}

async function main() {
  const [projects, budgets, existing] = await Promise.all([
    pgSelect("projects", "select=id,과제명,상태,종료일,중간보고_예정,중간보고_완료,완료보고_예정,완료보고_완료,총사업비"),
    pgSelect("budgets", "select=과제_id,배정액"),
    pgSelect("program_checks", "select=과제_id,종류,대상,처리&처리=eq.미처리"),
  ])

  const 배정합 = new Map()
  for (const b of budgets) {
    배정합.set(b.과제_id, (배정합.get(b.과제_id) ?? 0) + Number(b.배정액 ?? 0))
  }

  const 이미있음 = new Set(existing.map((e) => `${e.과제_id}:${e.종류}:${e.대상 ?? ""}`))

  const rows = []

  for (const p of projects) {
    if (p.상태 !== "수행중") continue

    // ① 종료일 임박, 완료보고 안 끝남
    if (p.종료일 && !p.완료보고_완료) {
      const d = 날짜차(p.종료일, 오늘)
      if (d <= 30) {
        const key = `${p.id}:기한임박:완료보고`
        if (!이미있음.has(key)) {
          rows.push({
            과제_id: p.id,
            종류: "기한임박",
            심각도: d < 0 ? "오류" : d <= 7 ? "오류" : "경고",
            대상: "완료보고",
            내용:
              d < 0
                ? `종료일(${p.종료일})이 ${-d}일 지났는데 완료보고가 안 끝났습니다.`
                : `종료일(${p.종료일})까지 ${d}일 남았는데 완료보고가 안 끝났습니다.`,
            근거: `app.projects.종료일=${p.종료일}, 완료보고_완료=null`,
            처리: "미처리",
          })
          이미있음.add(key)
        }
      }
    }

    // ① 중간보고 예정일 임박, 중간보고 안 끝남
    if (p.중간보고_예정 && !p.중간보고_완료) {
      const d = 날짜차(p.중간보고_예정, 오늘)
      if (d <= 14) {
        const key = `${p.id}:기한임박:중간보고`
        if (!이미있음.has(key)) {
          rows.push({
            과제_id: p.id,
            종류: "기한임박",
            심각도: d < 0 ? "오류" : "경고",
            대상: "중간보고",
            내용:
              d < 0
                ? `중간보고 예정일(${p.중간보고_예정})이 ${-d}일 지났는데 중간보고가 안 끝났습니다.`
                : `중간보고 예정일(${p.중간보고_예정})까지 ${d}일 남았습니다.`,
            근거: `app.projects.중간보고_예정=${p.중간보고_예정}, 중간보고_완료=null`,
            처리: "미처리",
          })
          이미있음.add(key)
        }
      }
    }

    // ② 배정 합이 총사업비를 넘었다
    const 총사업비 = Number(p.총사업비 ?? 0)
    const 합 = 배정합.get(p.id) ?? 0
    if (총사업비 > 0 && 합 > 총사업비) {
      const key = `${p.id}:금액불일치:비목 배정`
      if (!이미있음.has(key)) {
        rows.push({
          과제_id: p.id,
          종류: "금액불일치",
          심각도: "오류",
          대상: "비목 배정",
          내용: `비목 배정 합계(${합.toLocaleString()}원)가 총사업비(${총사업비.toLocaleString()}원)를 넘었습니다.`,
          근거: `app.budgets 배정액 합=${합}, app.projects.총사업비=${총사업비}`,
          처리: "미처리",
        })
        이미있음.add(key)
      }
    }
  }

  if (rows.length === 0) {
    console.log("새로 걸리는 항목 없음.")
    return
  }

  const ins = await pgInsert("program_checks", rows)
  console.log(`${ins.length}건 기록함:`)
  for (const r of rows) console.log(`  [${r.과제_id}] ${r.종류} · ${r.대상} — ${r.내용}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
