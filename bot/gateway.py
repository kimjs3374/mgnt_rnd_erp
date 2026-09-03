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
  POST /documents/extract         {"sections": [...]}
  POST /summary/extract           {"text": "공고문 본문"}
  POST /relevance/select          {"company": "...", "candidates": [...]}
  POST /eligibility/score         {"company": "...", "text": "공고문 본문"} → 0~100점 판정

RND_GW_TOKEN 이 설정돼 있으면 Authorization: Bearer <토큰> 을 요구한다.
없으면 루프백 신뢰로 그냥 받는다.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ann_rules
import announce
import chat
import gongo

HOST = os.environ.get("RND_GW_HOST", "127.0.0.1")
PORT = int(os.environ.get("RND_GW_PORT", "3611"))
TOKEN = os.environ.get("RND_GW_TOKEN", "").strip()
# 보유 서류를 base64 로 실어 보낸다(/document/read · /company/read). 25MB 파일이
# base64 로 약 34MB 가 되므로 4MB 로는 못 받는다. 루프백 전용 서비스라 이 크기가 문제되지 않는다.
MAX_BODY = 40 * 1024 * 1024

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
                             "endpoints": ["/health", "/chat", "/eligibility/extract",
                                           "/documents/extract", "/summary/extract",
                                           "/relevance/select", "/eligibility/score",
                                           "/document/read", "/company/read",
                                           "/rules/score", "/rules/batch",
                                           "/rules/answer", "/judgment/record",
                                           "/judgment/similar", "/judgment/history"]})
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
            elif path == "/documents/extract":
                self._documents(body)
            elif path == "/summary/extract":
                self._summary(body)
            elif path == "/relevance/select":
                self._relevance(body)
            elif path == "/eligibility/score":
                self._score(body)
            elif path == "/document/read":
                self._document_read(body)
            elif path == "/company/read":
                self._company_read(body)
            elif path == "/rules/score":
                self._rules_score(body)
            elif path == "/rules/batch":
                self._rules_batch(body)
            elif path == "/rules/answer":
                self._rules_answer(body)
            elif path == "/judgment/record":
                self._judgment_record(body)
            elif path == "/judgment/similar":
                self._judgment_similar(body)
            elif path == "/judgment/history":
                self._judgment_history(body)
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

    # ── 공고 판독 — scripts/lib/llm.mjs 에 있던 것들 ─────────────────────────
    # 실패를 200 으로 돌려준다. 수집 배치는 한 건이 실패해도 멈추지 않아야 하고,
    # node 쪽은 ok 만 본다. HTTP 코드로 알리면 배치가 예외로 끊긴다.
    def _documents(self, body: dict) -> None:
        sections = body.get("sections")
        if not isinstance(sections, list):
            self._send(400, {"ok": False, "error": "sections 배열이 있어야 한다"})
            return
        self._send(200, gongo.extract_documents(sections))

    def _summary(self, body: dict) -> None:
        text = str(body.get("text") or body.get("본문") or "")
        if not text.strip():
            self._send(400, {"ok": False, "error": "text 가 비었다"})
            return
        self._send(200, gongo.extract_summary(text))

    def _relevance(self, body: dict) -> None:
        company = str(body.get("company") or "").strip()
        candidates = body.get("candidates")
        if not company or not isinstance(candidates, list):
            self._send(400, {"ok": False, "error": "company 와 candidates 가 있어야 한다"})
            return
        self._send(200, gongo.select_relevant(company, candidates))

    # ── 보유 서류 판독 (김정수, 2026-09-03) ─────────────────────────────────
    # 공고문이 아니라 **우리가 가진 서류**를 읽는다. 서류함 업로드와 회사 프로필이 쓴다.
    #
    # ⚠ path 는 이 서버의 **로컬 파일 경로**다. claude 가 Read 로 열어야 하므로 그렇다.
    #   부르는 쪽(node)이 스토리지에서 받아 임시 파일로 풀어 놓고 경로만 넘긴다.
    #   밖으로 열려 있지 않은 루프백 서비스라 이 구조가 성립한다 — 열게 되면 반드시 막아야 한다.
    def _파일로(self, body: dict):
        """요청에서 판독할 파일을 확보한다. (경로, 지워야_하는가) 를 돌려준다.

        ⚠ **경로를 그냥 믿을 수 없다.** 이 서비스는 PrivateTmp=yes 라 자기만의 /tmp 를 보는데,
          웹(rnd-web)은 PrivateTmp=no 다. 웹이 /tmp 에 쓴 파일을 여기서는 못 읽는다 —
          모델이 "파일을 찾을 수 없습니다" 라고 답해서 JSON 파싱 실패로만 보였다(실측).
          그래서 파일을 가진 쪽이 내용을 실어 보내고, 여기서 우리 /tmp 에 풀어 쓴다.

        경로도 계속 받는다. bot/*.py 안에서 부르면 같은 네임스페이스라 경로가 통한다.
        """
        b64 = body.get("content_b64")
        if b64:
            ext = str(body.get("ext") or "pdf").lstrip(".").lower()
            if not ext.isalnum() or len(ext) > 8:
                raise ValueError(f"확장자가 이상하다: {ext!r}")
            try:
                blob = base64.b64decode(b64, validate=True)
            except Exception as e:
                raise ValueError(f"content_b64 를 못 풀었다: {e}") from e
            if not blob:
                raise ValueError("content_b64 가 비었다")
            fd, tmp = tempfile.mkstemp(prefix="docread-", suffix=f".{ext}")
            with os.fdopen(fd, "wb") as f:
                f.write(blob)
            return tmp, True

        path = str(body.get("path") or "").strip()
        if not path:
            raise ValueError("content_b64 도 path 도 없다")
        if not os.path.isfile(path):
            # 여기서 미리 잡는다. 모델에게 물어보면 한도만 쓰고 답은 문장으로 온다.
            raise ValueError(
                f"파일이 없다: {path} — 이 서비스는 PrivateTmp 라 /tmp 가 따로다. "
                "웹에서 부를 때는 content_b64 로 보낼 것."
            )
        return path, False

    def _document_read(self, body: dict) -> None:
        try:
            path, 임시 = self._파일로(body)
        except ValueError as e:
            self._send(400, {"ok": False, "error": str(e)})
            return
        cands = body.get("candidates") or []
        if not isinstance(cands, list):
            cands = []
        try:
            r = gongo.read_document(path, [str(c) for c in cands])
        finally:
            if 임시:
                try:
                    os.unlink(path)
                except OSError:
                    pass
        self._send(200, r)

    def _company_read(self, body: dict) -> None:
        try:
            path, 임시 = self._파일로(body)
        except ValueError as e:
            self._send(400, {"ok": False, "error": str(e)})
            return
        try:
            r = gongo.read_company_document(path)
        finally:
            if 임시:
                try:
                    os.unlink(path)
                except OSError:
                    pass
        self._send(200, r)

    def _score(self, body: dict) -> None:
        company = str(body.get("company") or "").strip()
        text = str(body.get("text") or body.get("본문") or "")
        if not company or not text.strip():
            self._send(400, {"ok": False, "error": "company 와 text 가 있어야 한다"})
            return
        self._send(200, gongo.score_eligibility(company, text))

    # ── 규칙 판정 — **LLM 을 부르지 않는다** (bot/ann_score.py) ───────────────
    # 이 세 라우트만 LLM 호출이 0 이다. 나머지는 헤드리스를 부른다.
    # 실측: 836건 전체 판정이 33초 · 호출 0회. LLM 경로는 37건에서 멈춰 있었다.
    def _rules_score(self, body: dict) -> None:
        aid = body.get("announcement_id") or body.get("id")
        if aid is None:
            self._send(400, {"ok": False, "error": "announcement_id 가 있어야 한다"})
            return
        r = ann_rules.score_announcement(int(aid), save=bool(body.get("save", True)))
        self._send(200, r)

    def _rules_batch(self, body: dict) -> None:
        limit = body.get("limit")
        r = ann_rules.batch(int(limit) if limit else None,
                            save=bool(body.get("save", True)))
        self._send(200, r)

    def _rules_answer(self, body: dict) -> None:
        """사람 답변을 받아 저장하고, 그 공고를 다시 판정해서 돌려준다.

        답의 효과가 같은 응답에 실려 오지 않으면 사람이 같은 질문에 두 번 답한다.
        """
        try:
            r = ann_rules.record_answer(
                announcement_id=body.get("announcement_id"),
                특징키=str(body.get("특징키") or ""),
                사람_값=str(body.get("사람_값") or ""),
                답변자=str(body.get("답변자") or ""),
                질문=str(body.get("질문") or ""),
                근거문장=body.get("근거문장"),
                ai_추출값=body.get("ai_추출값"),
                일반화=bool(body.get("일반화")),
                사유=body.get("사유"),
                짚은문구=body.get("짚은문구"),
                종류=str(body.get("종류") or "정보"),
                구역=body.get("구역"),
            )
        except ValueError as e:
            # 사람이 고칠 수 있는 입력 오류다. 500 으로 숨기지 않는다.
            self._send(400, {"ok": False, "error": str(e)})
            return
        self._send(200, r)

    # ── 의미 기반 판정 학습 — 사람이 판정+코멘트를 남기면 임베딩해서 쌓는다 ─────
    # LLM 을 안 부른다. 로컬 임베딩 모델(격리된 venv)만 쓴다. 첫 호출에 모델을
    # 디스크에서 새로 올리느라 몇 초 걸릴 수 있다 — 타임아웃을 넉넉히 둔다
    # (semantic_learn.EMBED_TIMEOUT=60초). 웹 쪽도 그만큼 기다리게 안내한다.
    def _judgment_record(self, body: dict) -> None:
        import semantic_learn  # noqa: PLC0415
        텍스트 = str(body.get("text") or body.get("텍스트") or "").strip()
        판정 = str(body.get("판정") or "").strip()
        답변자 = str(body.get("답변자") or "").strip()
        if not 텍스트 or not 판정 or not 답변자:
            self._send(400, {"ok": False, "error": "text · 판정 · 답변자 는 필수다"})
            return
        try:
            row = semantic_learn.record_judgment(
                텍스트, 판정, 답변자,
                announcement_id=body.get("announcement_id"),
                특징키=body.get("특징키"), 사유=body.get("사유"),
            )
        except ValueError as e:
            self._send(400, {"ok": False, "error": str(e)})
            return
        except Exception as e:
            log.error("judgment/record 실패: %s\n%s", e, traceback.format_exc())
            self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})
            return
        self._send(200, {"ok": True, "row": {k: v for k, v in row.items() if k != "임베딩"}})

        # 응답을 이미 보냈다 — 이제부터는 사용자를 안 기다리게 한다. 임베딩은
        # 백그라운드 스레드에서 채운다(사용자 지적 2026-09-04: 저장이 모델 호출에
        # 묶이면 안 된다). 실패해도 fill_embedding() 내부에서 삼킨다 — 여기서
        # 또 터지면 그건 이미 응답이 나간 뒤라 아무도 못 받는다.
        threading.Thread(
            target=semantic_learn.fill_embedding,
            args=(row["id"], 텍스트),
            daemon=True,
        ).start()

    def _judgment_similar(self, body: dict) -> None:
        import semantic_learn  # noqa: PLC0415
        텍스트 = str(body.get("text") or body.get("텍스트") or "").strip()
        if not 텍스트:
            self._send(400, {"ok": False, "error": "text 가 필요하다"})
            return
        try:
            matches = semantic_learn.find_similar(
                텍스트,
                top_k=int(body.get("top_k") or 5),
                min_sim=float(body.get("min_sim") or 0.40),
            )
        except Exception as e:
            log.error("judgment/similar 실패: %s\n%s", e, traceback.format_exc())
            self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})
            return
        self._send(200, {"ok": True, "matches": matches})

    def _judgment_history(self, body: dict) -> None:
        """이 공고에 실제로 남긴 판정+코멘트 이력. find_similar() 와 달리 임베딩
        유사도가 아니라 announcement_id 로 정확히 필터한다 — 사용자 지적(2026-09-04):
        "왜 이력 남긴거 확인이 안되냐 확인할수 있어야지?"."""
        import semantic_learn  # noqa: PLC0415
        announcement_id = body.get("announcement_id")
        if not announcement_id:
            self._send(400, {"ok": False, "error": "announcement_id 가 필요하다"})
            return
        try:
            rows = semantic_learn.history_for_announcement(int(announcement_id))
        except Exception as e:
            log.error("judgment/history 실패: %s\n%s", e, traceback.format_exc())
            self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})
            return
        self._send(200, {"ok": True, "rows": rows})


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
