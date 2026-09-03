"""증빙 파일 보관 — 확정된 것만 Supabase Storage 로 올린다.

왜 확정 뒤에 올리는가
  판독만 하고 버려지는 파일이 있다. 확정되지 않은 것까지 Storage 에 쌓으면
  나중에 무엇이 정산 원장에 속한 파일인지 알 수 없다.
  → 받으면 서버 스테이징에 두고, 사람이 [확정] 을 누른 시점에 올린다.

⚠ 버킷 `evidence` 는 **비공개**다. 공개 URL 로 증빙이 새면 안 된다.
   조회는 서비스 키로 서명 URL 을 만들어 준다.
"""

from __future__ import annotations

import hashlib
import mimetypes
import os
import pathlib
import urllib.parse
from typing import Any

import requests

BUCKET = os.environ.get("RND_EVIDENCE_BUCKET", "evidence")
BASE = os.environ.get("SUPABASE_INTERNAL_URL", "http://127.0.0.1:3600")
KEY = os.environ["SERVICE_ROLE_KEY"]
STAGING = pathlib.Path(os.environ.get("RND_STAGING_DIR", "/rnd/data/staging"))

HDR = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# 스테이징 — 확정 전까지 여기 둔다
# ─────────────────────────────────────────────────────────────────────────────
def stage(data: bytes, filename: str) -> pathlib.Path:
    STAGING.mkdir(parents=True, exist_ok=True)
    ext = pathlib.Path(filename).suffix or ""
    p = STAGING / f"{sha256(data)}{ext}"
    if not p.exists():
        p.write_bytes(data)
    return p


def unstage(path: str | pathlib.Path) -> None:
    try:
        pathlib.Path(path).unlink(missing_ok=True)
    except OSError:
        pass  # 정리 실패로 본 흐름을 막지 않는다


# ─────────────────────────────────────────────────────────────────────────────
# Storage
# ─────────────────────────────────────────────────────────────────────────────
def object_path(expense_id: int, filename: str, digest: str) -> str:
    """경로에 파일명을 그대로 쓰지 않는다 — 한글·공백·중복 때문에 깨진다.
    사람이 읽을 이름은 DB(evidence.파일명)에 남는다."""
    ext = pathlib.Path(filename).suffix.lower() or ""
    return f"expenses/{expense_id}/{digest[:16]}{ext}"


def upload(local: str | pathlib.Path, dest: str, *, filename: str = "") -> dict[str, Any]:
    """확정된 증빙을 올린다. 이미 있으면 덮어쓴다(같은 해시면 같은 파일이다)."""
    data = pathlib.Path(local).read_bytes()
    mime = mimetypes.guess_type(filename or str(local))[0] or "application/octet-stream"

    r = requests.post(
        f"{BASE}/storage/v1/object/{BUCKET}/{urllib.parse.quote(dest)}",
        headers={**HDR, "Content-Type": mime, "x-upsert": "true"},
        data=data,
        timeout=60,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"업로드 실패 {r.status_code}: {r.text[:200]}")
    return {"path": dest, "bytes": len(data), "sha256": sha256(data), "mime": mime}


def signed_url(dest: str, *, seconds: int = 3600) -> str | None:
    """비공개 버킷이라 조회는 서명 URL 로 준다. 실패하면 None — 화면이 죽지 않게."""
    try:
        r = requests.post(
            f"{BASE}/storage/v1/object/sign/{BUCKET}/{urllib.parse.quote(dest)}",
            headers={**HDR, "Content-Type": "application/json"},
            json={"expiresIn": seconds},
            timeout=15,
        )
        if r.status_code >= 400:
            return None
        return BASE + "/storage/v1" + r.json()["signedURL"]
    except Exception:
        return None


def ensure_bucket() -> None:
    """버킷이 없으면 비공개로 만든다. 있으면 아무것도 하지 않는다."""
    r = requests.get(f"{BASE}/storage/v1/bucket/{BUCKET}", headers=HDR, timeout=15)
    if r.status_code == 200:
        return
    requests.post(
        f"{BASE}/storage/v1/bucket",
        headers={**HDR, "Content-Type": "application/json"},
        json={"id": BUCKET, "name": BUCKET, "public": False},
        timeout=15,
    )
