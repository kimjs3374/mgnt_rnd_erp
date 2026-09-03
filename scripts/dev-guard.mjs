// npm run dev 를 막는다 — rnd.mgnt.kr 이 공용 dev 서버 하나로 돌기 때문이다.
//
// 왜 막는가: 넷이 같은 /web/rnd 를 쓰는데 각자 next dev 를 띄우면 .next 를 서로 밀어내고
// 배포용 빌드까지 날아가 rnd.mgnt.kr 이 502 로 죽는다(2026-09-03 실제로 겪음).
//
// 공용 서버가 떠 있을 때만 막는다. 내려가 있으면 그냥 통과시킨다 —
// 서비스가 죽었는데 작업까지 막히면 곤란하다.
import net from "node:net"

const HOST = "127.0.0.1"
const PORT = 3610
const TIMEOUT_MS = 400

if (process.env.RND_ALLOW_DEV === "1") {
  console.log("[dev-guard] RND_ALLOW_DEV=1 — 검사를 건너뜁니다.")
  console.log("[dev-guard] ⚠ NEXT_DIST_DIR 을 꼭 같이 주세요. 예: NEXT_DIST_DIR=.next-$(whoami)")
  process.exit(0)
}

const alive = await new Promise((resolve) => {
  const s = new net.Socket()
  const done = (v) => { s.destroy(); resolve(v) }
  s.setTimeout(TIMEOUT_MS)
  s.once("connect", () => done(true))
  s.once("timeout", () => done(false))
  s.once("error", () => done(false))
  s.connect(PORT, HOST)
})

if (!alive) {
  console.log(`[dev-guard] 공용 dev 서버(${HOST}:${PORT})가 응답하지 않습니다. 그대로 진행합니다.`)
  console.log("[dev-guard] 공용 서버를 살리려면: sudo rnd-web-mode dev")
  process.exit(0)
}

console.error(`
  ┌────────────────────────────────────────────────────────────────┐
  │  개별 dev 서버는 띄우지 않습니다.                              │
  └────────────────────────────────────────────────────────────────┘

  rnd.mgnt.kr 이 이미 공용 dev 서버로 돌고 있습니다.
  소스를 고치고 저장하면 그대로 rnd.mgnt.kr 에 반영됩니다.
  빌드도, 재시작도, 이 명령도 필요 없습니다.

    확인   →  https://rnd.mgnt.kr
    상태   →  sudo rnd-web-mode status
    로그   →  sudo journalctl -u rnd-web -f

  각자 next dev 를 띄우면 .next 를 서로 밀어내 배포가 502 로 죽습니다.
  그래서 막아 두었습니다.  자세한 내용: _팀로그/memory/shared-dev-server.md

  그래도 꼭 따로 띄워야 한다면 (충돌을 피하려면 dist 디렉터리를 반드시 나눠야 합니다):

    RND_ALLOW_DEV=1 NEXT_DIST_DIR=.next-$(whoami) npm run dev -- -p 3620
`)
process.exit(1)
