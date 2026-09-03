"""HTTP 게이트웨이 — 봇 밖에서 챗과 자격요건 추출을 부르는 유일한 창구.

왜 만드나
  Slack 봇은 Socket Mode, MCP 는 stdio, 웹은 subprocess 로 파이썬을 부른다.
  전부 프로세스 안에서만 닿는다. 그래서 수집 스크립트(node)처럼 **밖에 있는 것**이
  같은 판단을 쓰려면 헤드리스 호출을 자기 쪽에 또 짜야 한다.
  실제로 `scripts/lib/llm.mjs` 가 그렇게 생겼다 — 프롬프트가 두 벌이 되면
  한쪽만 고쳐지고, 그 사고는 시연장에서 드러난다.

원칙
  · **로직을 옮기지 않는다.** 여기 있는 건 라우팅뿐이고 판단은 chat.py·announce.py 에 남는다.
  · **127.0.0.1 에만 묶는다.** 이 서버엔 light_sync·supabase·mail 이 같이 돈다.
    밖에서 닿아야 하면 nginx 를 거친다 — 그건 김정수 일이다.
  · **의존성을 늘리지 않는다.** 표준 라이브러리만 쓴다(FastAPI·Flask 안 넣는다).
    venv 를 건드리면 시연 전날에 확인할 게 하나 더 생긴다.
  · 스레드로 받는다. 헤드리스 한 번이 15~60초라 순차로 받으면 서로 막는다.

엔드포인트
  GET  /health                    → {"ok": true, …}
  POST /chat                      {"question": "...", "context": "..."}
  POST /eligibility/extract       {"announcement_id": 1, "save": true}
                                  {"text": "공고문 …", "save": false}

RND_GW_TOKEN 이 설정돼 있으면 Authorization: Bearer <토큰> 을 요구한다.
없으면 루프백 신뢰로 그냥 받는다.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import announce
import chat

HOST = os.environ.get("RND_GW_HOST", "127.0.0.1")
PORT = int(os.environ.get("RND_GW_PORT", "3611"))
TOKEN = os.environ.get("RND_GW_TOKEN", "").strip()
MAX_BODY = 4 * 1024 * 1024

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("gateway")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "rnd-gateway"

    # 기본 로그는 stderr 로 한 줄씩 흘린다. journal 이 받는다.
    def log_message(self, fmt: str, *a) -> None:
        log.info("%s %s", self.address_string(), fmt % a)

    # ── 응답 ────────────────────────────────────────────────────────────────
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        if n > MAX_BODY:
            raise ValueError(f"본문이 너무 크다 ({n} 바이트)")
        raw = self.rfile.read(n).decode("utf-8")
        d = json.loads(raw)
        if not isinstance(d, dict):
            raise ValueError("JSON 객체를 보내라")
        return d

    def _authed(self) -> bool:
        if not TOKEN:
            return True
        got = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        return got == TOKEN

    # ── 라우팅 ──────────────────────────────────────────────────────────────
    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] == "/health":
            self._send(200, {"ok": True, "service": "rnd-gateway", "port": PORT,
                             "endpoints": ["/health", "/chat", "/eligibility/extract"]})
            return
        self._send(404, {"ok": False, "error": f"그런 경로가 없다: {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?")[0]
        if not self._authed():
            self._send(401, {"ok": False, "error": "토큰이 맞지 않는다"})
            return
        try:
            body = self._body()
        except Exception as e:
            self._send(400, {"ok": False, "error": str(e)})
            return

        try:
            if path == "/chat":
                self._chat(body)
            elif path == "/eligibility/extract":
                self._extract(body)
            else:
                self._send(404, {"ok": False, "error": f"그런 경로가 없다: {path}"})
        except LookupError as e:
            self._send(404, {"ok": False, "error": str(e)})
        except Exception as e:
            # 무엇이 터졌는지 숨기지 않는다. 밖에 열지 않는 이유가 이것이기도 하다.
            log.error("%s 실패: %s\n%s", path, e, traceback.format_exc())
            self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

    # ── 핸들러 ──────────────────────────────────────────────────────────────
    def _chat(self, body: dict) -> None:
        q = str(body.get("question") or body.get("q") or "").strip()
        if not q:
            self._send(400, {"ok": False, "error": "question 이 비었다"})
            return
        r = chat.ask(q, extra_context=str(body.get("context") or ""))
        self._send(200, {
            "ok": r.ok, "text": r.text, "turns": r.turns,
            "seconds": r.seconds, "cost_usd": r.cost_usd, "error": r.error,
        })

    def _extract(self, body: dict) -> None:
        aid = body.get("announcement_id")
        text = body.get("text")
        save = bool(body.get("save", aid is not None))

        if aid is None and not text:
            self._send(400, {"ok": False, "error": "announcement_id 나 text 중 하나는 있어야 한다"})
            return

        if aid is not None:
            res = announce.extract_and_save(int(aid), save=save)
        else:
            # 본문만 준 경우엔 저장할 곳이 없다. 저장을 요청해도 조용히 무시하지 않고 알린다.
            res = announce.extract_requirements(str(text))
            if save:
                res["사유"] = "announcement_id 가 없어 저장하지 않았다"
            res["저장"] = 0

        self._send(200, {"ok": True, **res})


def main() -> None:
    for name in ("RND_DSN", "SERVICE_ROLE_KEY"):
        if not os.environ.get(name):
            log.warning("%s 가 없다. systemd 없이 띄웠다면 EnvironmentFile 을 확인할 것", name)
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True
    log.info("게이트웨이 %s:%s — %s", HOST, PORT, "토큰 필요" if TOKEN else "루프백 신뢰")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
