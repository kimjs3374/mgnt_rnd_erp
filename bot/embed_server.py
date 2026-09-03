#!/usr/bin/env python3
"""임베딩 상시 서버 — 모델을 한 번만 올려두고 재사용한다.

⚠ 실측(2026-09-04): 화면에서 "판정 근거 남기기" 저장이 "저장 중…"에서 멈춘다는
신고가 왔다. 원인을 재보니 embed_cli.py(subprocess, 매 호출마다 새 프로세스)가
콜드스타트에 8~12초 걸렸다 — 그중 상당수는 모델을 디스크에서 다시 읽어 들이는
시간이다(768차원 RoBERTa, 약 450MB). nginx 앞단 타임아웃보다 길어질 수 있어
화면이 응답을 영영 못 받는 경우가 생긴다.

이 서버는 gateway.py 와 같은 골격(stdlib http.server, 새 의존성 없음)이지만
**모델을 프로세스 시작 시 한 번만 올린다.** 이후 요청은 순수 추론만 하므로
문장 하나에 수십~수백 ms 다 — 실측 목표.

embed_cli.py(subprocess, 격리)는 지우지 않는다 — 이 서버가 죽었을 때
semantic_learn.py 가 폴백으로 쓴다(느리지만 기능은 산다. Restart=always 로
계속 재시작을 시도하니 대개는 곧 다시 살아난다).

포트: 127.0.0.1:3612 (게이트웨이 3611 바로 옆). 루프백 전용 — 밖에 안 연다.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

HOST = os.environ.get("RND_EMBED_HOST", "127.0.0.1")
PORT = int(os.environ.get("RND_EMBED_PORT", "3612"))
MODEL_NAME = os.environ.get("RND_EMBED_MODEL", "jhgan/ko-sroberta-multitask")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("embed-server")

_model = None  # 프로세스당 한 번만 로딩한다 — 이게 이 서버의 존재 이유다


def _get_model():
    global _model
    if _model is None:
        log.info("모델 로딩 중: %s (한 번만 — 이후 요청은 이걸 재사용한다)", MODEL_NAME)
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL_NAME)
        log.info("모델 로딩 완료")
    return _model


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "rnd-embed"

    def log_message(self, fmt: str, *a) -> None:
        log.info("%s %s", self.address_string(), fmt % a)

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] == "/health":
            self._send(200, {"ok": True, "service": "rnd-embed", "port": PORT,
                             "model": MODEL_NAME, "loaded": _model is not None})
            return
        self._send(404, {"ok": False, "error": f"그런 경로가 없다: {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/embed":
            self._send(404, {"ok": False, "error": f"그런 경로가 없다: {self.path}"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
            texts = body.get("texts")
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                self._send(400, {"ok": False, "error": "texts 는 문자열 배열이어야 한다"})
                return
            if not texts:
                self._send(200, {"ok": True, "vectors": []})
                return
            model = _get_model()
            vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            self._send(200, {"ok": True, "vectors": [v.tolist() for v in vecs]})
        except Exception as e:
            log.error("embed 실패: %s", e, exc_info=True)
            self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})


def main() -> None:
    # 시작하자마자 모델을 올려둔다 — 첫 요청이 콜드스타트를 물지 않게.
    _get_model()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True
    log.info("임베딩 서버 %s:%s (모델 상주)", HOST, PORT)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
