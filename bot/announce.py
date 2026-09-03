"""④ 공고 자격요건 추출 — 공고문 → `app.ann_requirements`.

`eligibility_check` 는 이미 있다. 그건 **DB 에 들어온 요건을 회사 프로필과 대조**한다.
없던 것은 그 앞 단계다 — 공고문에서 요건을 뽑아 DB 에 넣는 일.
요건이 0건이면 eligibility_check 는 「요건 미확인」만 돌려준다.
실측에서 1,479건 중 729건이 접수기간만 보고 잘못 「신청 가능」으로 찍혔다.

설계
  · **어휘를 고정한다**(`vocab.py`). 모델이 항목명을 지어내면 판정이 조용히 죽는다.
    목록 밖 요건은 **버리지 않고** `기타` 로 따로 돌려준다 — 사람이 보게.
  · **본문 전체를 넣지 않는다.** 자격 관련 구간만 잘라 넣는다.
    공고문은 수만 자고, 헤드리스는 호출마다 새 세션이라 토큰이 그대로 비용이다.
  · **읽기는 RND_DSN(rnd_mcp, 읽기 전용), 쓰기는 rest.py(service_role).**
    extract.py 와 같은 규칙이다. 봇이 쓰기 권한을 들고 다니지 않는다.
  · 확신도 0.70 미만은 저장하되 **필수여부를 끈다.** 애매한 것으로 「지원 불가」를
    만들지 않는다 — 틀린 「불가」는 공고를 조용히 버린다.
"""

from __future__ import annotations

import re
from typing import Any

import extract  # _json_block · pick · _q 를 그대로 쓴다. 로직을 두 벌로 두지 않는다.
import gongo   # 헤드리스 호출(_headless) — 본문은 stdin 으로 넘긴다
import rest
from vocab import BOOLEAN_ITEMS, REQUIREMENT_ITEMS, REQUIREMENT_OPS, REQUIREMENT_UNITS

# 자격 요건이 실제로 적히는 구간의 표제어. 여기 주변만 잘라 낸다.
SECTION_HINTS = (
    "신청자격", "지원자격", "참여자격", "응모자격", "자격요건",
    "지원대상", "신청대상", "참여대상",
    "지원제외", "참여제한", "신청제한", "결격", "제외대상",
)
WINDOW = 2500        # 표제어 앞뒤로 남길 글자 수
MAX_CHARS = 45_000   # 잘라 낸 것이 이보다 크면 앞에서부터 자른다
MIN_CONF = 0.70      # extract.THRESHOLD 와 같은 뜻. 미만이면 필수여부를 끈다


def relevant_sections(text: str) -> tuple[str, bool]:
    """자격 관련 구간만 남긴다. (잘라낸 텍스트, 잘랐는지 여부)"""
    if not text:
        return "", False
    if len(text) <= WINDOW * 2:
        return text, False

    spans: list[tuple[int, int]] = []
    for hint in SECTION_HINTS:
        for m in re.finditer(re.escape(hint), text):
            spans.append((max(0, m.start() - 400), min(len(text), m.end() + WINDOW)))

    if not spans:
        # 표제어가 없으면 앞부분을 준다. 「못 찾았다」고 빈손으로 돌아가지 않는다.
        return text[:MAX_CHARS], len(text) > MAX_CHARS

    spans.sort()
    merged = [list(spans[0])]
    for s, e in spans[1:]:
        if s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])

    out = "\n…\n".join(text[s:e] for s, e in merged)
    return out[:MAX_CHARS], len(out) > MAX_CHARS


def _prompt(body: str) -> str:
    items = "\n".join(f"  - {k} : {v}" for k, v in REQUIREMENT_ITEMS.items())
    return f"""아래는 정부 지원사업 공고문에서 신청자격·지원대상·참여제한 부분만 잘라 낸 것이다.
기업이 이 공고에 지원할 수 있는지 판단하는 데 쓰는 **수치·여부 요건**을 뽑아라.

## 뽑을 항목 — 이 목록 밖의 이름을 쓰지 마라
{items}

목록에 없는 요건(업종·지역·기업규모·과제수행 이력 등)은 `기타` 에 원문 그대로 넣어라.
**억지로 위 항목에 끼워 맞추지 마라.**

## 규칙
- 공고문에 **실제로 적힌 것만** 뽑는다. 일반적인 관행이나 짐작으로 채우지 않는다.
- 연산자: gte(이상) · lte(이하) · gt(초과) · lt(미만) · eq(같음) · has(보유)
- 단위: 원 · 만원 · 백만원 · 천만원 · 억원 · % · 명 (여부 항목은 "none")
  **공고문에 적힌 단위를 그대로 쓴다. 환산하지 마라.** 환산은 코드가 한다.
- 필수여부: 못 지키면 지원 자체가 안 되는 것만 true. 우대·가점은 false.
- 자본전액잠식·기업부설연구소는 여부 항목이다 → 연산자 eq/has, 단위 "none",
  기준값은 0(해당 없어야 함) 또는 1(있어야 함).
- 원문: 판단 근거가 된 **공고문 문장을 그대로** 옮긴다. 요약하지 마라.
- confidence: 0.0~1.0. **애매하면 낮춰라.** 낮은 게 틀린 것보다 낫다.

## 출력 — JSON 만. 설명 문장을 붙이지 마라.
{{"요건": [{{"항목": "매출액", "필수여부": true, "연산자": "gte",
            "기준값": 90, "단위": "억원", "원문": "…", "confidence": 0.9}}],
 "기타": [{{"내용": "제조업 영위 기업", "원문": "…"}}]}}

해당하는 요건이 하나도 없으면 {{"요건": [], "기타": []}} 를 낸다. 지어내지 마라.

## 공고문
{body}
"""


def _norm(raw: dict) -> dict | None:
    """모델이 낸 한 행을 DB 계약에 맞춘다. 못 맞추면 None — 어휘 밖은 저장하지 않는다."""
    항목 = str(extract.pick(raw, "항목", "item", "name", default="") or "").replace(" ", "")
    if 항목 not in REQUIREMENT_ITEMS:
        return None

    연산자 = str(extract.pick(raw, "연산자", "op", "operator", default="") or "").strip()
    if 연산자 not in REQUIREMENT_OPS:
        연산자 = None

    기준값 = extract.pick(raw, "기준값", "value", "threshold", default=None)
    try:
        기준값 = float(re.sub(r"[^\d.\-]", "", str(기준값))) if 기준값 is not None else None
    except ValueError:
        기준값 = None

    단위 = str(extract.pick(raw, "단위", "unit", default="") or "").strip()
    if 항목 in BOOLEAN_ITEMS:
        단위 = "none"
    elif 단위 not in REQUIREMENT_UNITS:
        # 단위를 못 믿으면 비워 둔다. eligibility_check 가 「단위를 맞출 수 없다」로
        # 비교를 건너뛴다 — 추측해서 판정하는 것보다 낫다.
        단위 = None

    try:
        conf = float(extract.pick(raw, "confidence", "신뢰도", "확신도", default=0.5) or 0.5)
    except (TypeError, ValueError):
        conf = 0.5
    conf = max(0.0, min(1.0, conf))

    필수 = bool(extract.pick(raw, "필수여부", "required", "mandatory", default=False))
    if conf < MIN_CONF:
        # 애매한 것으로 「지원 불가」를 만들지 않는다. 틀린 불가는 공고를 조용히 버린다.
        필수 = False

    원문 = str(extract.pick(raw, "원문", "evidence", "quote", "source", default="") or "").strip()

    return {
        "항목": 항목,
        "필수여부": 필수,
        "연산자": 연산자,
        "기준값": 기준값,
        "단위": 단위,
        "원문": 원문[:2000] or None,
        "confidence": round(conf, 2),
    }


def extract_requirements(text: str) -> dict[str, Any]:
    """공고문 텍스트 → {요건:[…], 기타:[…], 잘림:bool}. DB 를 건드리지 않는다."""
    body, truncated = relevant_sections(text or "")
    if not body.strip():
        return {"요건": [], "기타": [], "잘림": False, "사유": "본문이 비어 있다"}

    # ⚠ 긴 본문을 `-p` 인자로 주면 --max-turns 1 인데도 stop=tool_use 로 죽는다(실측 09-03).
    #    짧은 지시는 `-p`, 긴 본문은 stdin — gongo._headless 가 그 형태다.
    out = gongo._headless(_prompt(body), "위 지시대로 JSON 객체 하나만 출력하라. 설명 금지.")
    data = extract._json_block(out)
    if not isinstance(data, dict):
        return {"요건": [], "기타": [], "잘림": truncated, "사유": "모델 응답을 JSON 으로 못 읽었다"}

    rows, dropped = [], []
    for r in data.get("요건") or []:
        if not isinstance(r, dict):
            continue
        n = _norm(r)
        (rows if n else dropped).append(n or r)

    기타 = [r for r in (data.get("기타") or []) if isinstance(r, dict)]
    # 어휘에서 떨어진 것도 버리지 않는다. 사람이 보게 기타로 넘긴다.
    기타 += [{"내용": str(d.get("항목") or d), "원문": str(d.get("원문") or "")} for d in dropped]

    return {"요건": rows, "기타": 기타, "잘림": truncated}


def announcement_text(announcement_id: int) -> tuple[str, str]:
    """(사업명, 본문). 없으면 예외."""
    r = extract._q(
        "select 사업명, coalesce(본문,'') as 본문 from app.announcements where id = %s",
        (announcement_id,),
    )
    if not r:
        raise LookupError(f"공고 {announcement_id} 가 없다")
    return r[0]["사업명"], r[0]["본문"]


def save_requirements(announcement_id: int, rows: list[dict], *, replace: bool = True) -> int:
    """rest.py(service_role)로 넣는다. replace 면 기존 것을 지우고 다시 넣는다."""
    if replace:
        rest.delete("ann_requirements", {"announcement_id": announcement_id})
    n = 0
    for r in rows:
        rest.insert("ann_requirements", {"announcement_id": announcement_id, **r})
        n += 1
    return n


def extract_and_save(announcement_id: int, *, save: bool = True) -> dict[str, Any]:
    사업명, 본문 = announcement_text(announcement_id)
    res = extract_requirements(본문)
    res["announcement_id"] = announcement_id
    res["사업명"] = 사업명
    res["저장"] = save_requirements(announcement_id, res["요건"]) if save else 0
    return res
