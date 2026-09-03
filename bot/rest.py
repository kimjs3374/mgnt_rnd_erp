"""쓰기 경로 — PostgREST 를 service_role 로 부른다.

읽기는 MCP 가 `rnd_mcp`(SELECT 전용)로 하고, 쓰기만 여기로 온다.
봇에 DB 슈퍼유저 비밀번호를 주지 않기 위해서다 — 최소 권한 원칙.
service_role 은 bypassrls 라 RLS 를 통과하지만 **서버 안에서만** 쓴다.
"""

from __future__ import annotations

import os
from typing import Any

import requests

BASE = os.environ.get("SUPABASE_INTERNAL_URL", "http://127.0.0.1:3600")
KEY = os.environ["SERVICE_ROLE_KEY"]

HDR = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Profile": "app",   # 쓰기 대상 스키마
    "Accept-Profile": "app",    # 읽기 대상 스키마
    "Content-Type": "application/json",
}


def insert(table: str, row: dict[str, Any]) -> dict[str, Any]:
    r = requests.post(
        f"{BASE}/rest/v1/{table}",
        headers={**HDR, "Prefer": "return=representation"},
        json=row,
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"insert {table} 실패 {r.status_code}: {r.text[:300]}")
    d = r.json()
    return d[0] if isinstance(d, list) and d else d


def update(table: str, match: dict[str, Any], patch: dict[str, Any]) -> list[dict]:
    params = "&".join(f"{k}=eq.{v}" for k, v in match.items())
    r = requests.patch(
        f"{BASE}/rest/v1/{table}?{params}",
        headers={**HDR, "Prefer": "return=representation"},
        json=patch,
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"update {table} 실패 {r.status_code}: {r.text[:300]}")
    return r.json()


def select(table: str, query: str = "") -> list[dict]:
    url = f"{BASE}/rest/v1/{table}" + (f"?{query}" if query else "")
    r = requests.get(url, headers=HDR, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"select {table} 실패 {r.status_code}: {r.text[:300]}")
    return r.json()


def delete(table: str, match: dict[str, Any]) -> None:
    params = "&".join(f"{k}=eq.{v}" for k, v in match.items())
    if not params:
        raise ValueError("조건 없는 delete 는 막는다")  # 테이블을 통째로 비우는 사고 방지
    r = requests.delete(f"{BASE}/rest/v1/{table}?{params}", headers=HDR, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"delete {table} 실패 {r.status_code}: {r.text[:300]}")
