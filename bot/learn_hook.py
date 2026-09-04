# -*- coding: utf-8 -*-
"""사람이 확정하면 **모델이 따라온다.** 확정 → 재학습 → 다음 판독에 반영.

이 훅이 없으면 확정 기록은 그냥 로그다. 「쌓이면 좋아진다」를 말이 아니라
동작으로 만드는 자리다.

설계
  · **디바운스**한다. 확정을 연달아 누르면 마지막 것만 돈다(재학습 실측 4.3초).
  · **한 번에 하나만** 돈다. 겹쳐 돌면 joblib 파일이 반쯤 쓰인 상태로 읽힐 수 있다.
  · **봇을 멈추지 않는다.** 별도 스레드 + 별도 프로세스. 실패해도 확정은 이미 끝나 있다.
  · 재시작은 필요 없다 — extract._load 가 mtime 을 보고 새 파일을 다시 읽는다.
"""
from __future__ import annotations

import logging
import os
import subprocess
import threading

import events

log = logging.getLogger(__name__)

PY = os.environ.get("RND_PY", "/rnd/bot/venv/bin/python")
SCRIPT = os.environ.get("RND_RETRAIN", "/web/rnd/bot/retrain.py")
DELAY = float(os.environ.get("RND_RETRAIN_DELAY", "20"))   # 초. 연속 확정을 한 번으로 묶는다
ENABLED = os.environ.get("RND_AUTO_RETRAIN", "1") != "0"

_timer: threading.Timer | None = None
_lock = threading.Lock()      # 타이머 교체용
_run = threading.Lock()       # 재학습 동시 실행 금지
LAST: dict = {}               # 마지막 결과 — 상태 확인용


def _do() -> None:
    if not _run.acquire(blocking=False):
        log.info("[재학습] 이미 도는 중 — 건너뛴다")
        return
    try:
        r = subprocess.run([PY, SCRIPT, "--force"], capture_output=True,
                           text=True, timeout=600, cwd=os.path.dirname(SCRIPT) or ".")
        out = (r.stdout or "").strip()
        LAST.update(rc=r.returncode, out=out, err=(r.stderr or "").strip()[-500:])
        if r.returncode == 0:
            log.info("[재학습] 완료\n%s", out)
        elif r.returncode == 2:
            # 새 모델이 더 나빠서 스스로 배포를 거부한 경우다. 정상 동작이다.
            log.warning("[재학습] 성능 하락으로 배포 보류\n%s", out)
        else:
            log.error("[재학습] 실패 rc=%s\n%s\n%s", r.returncode, out, LAST.get("err"))
    except Exception:
        log.exception("[재학습] 예외")
    finally:
        _run.release()


def schedule(reason: str = "") -> None:
    """확정/정정 직후 호출한다. DELAY 초 뒤에 한 번 돈다."""
    if not ENABLED:
        return
    global _timer
    with _lock:
        if _timer is not None:
            _timer.cancel()
        _timer = threading.Timer(DELAY, _do)
        _timer.daemon = True
        _timer.start()
    log.info("[재학습] %.0f초 뒤 예약 (%s)", DELAY, reason or "확정")
    events.log_event(events.RELEARN, f"재학습 예약 — {reason or '확정'}")
