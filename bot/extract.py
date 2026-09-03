"""① 증빙 판독 · ② 비목 분류 — 관문이자 심장.

설계 원칙 (흔들리면 프로젝트가 흔들린다)
  · **계산으로 확정되는 것은 LLM 에게 맡기지 않는다.**
    거래 방향은 자사 사업자번호를 상수로 두고 코드가 정한다.
    모델이 공급자와 공급받는자를 confidence 0.97 로 뒤집은 적이 있다.
  · **모호하면 단정하지 말라고 지시해도 단정한다.**
    확신도 0.70 미만은 코드가 자동 확정을 막는다. 프롬프트를 믿지 않는다.
  · 비목만 던지지 않는다. **근거 + 과거 처리**를 같이 준다.
    담당자가 못 믿으면 어차피 다시 확인하고, 그러면 시간이 안 준다.

실측으로 걸린 함정
  1. 파일을 읽히려면 `--allowed-tools "Read"` 와 `--max-turns 2` 가 **둘 다** 필요하다.
     빼면 파일을 못 읽고 **빈 응답이 is_error:false 로** 돌아온다. 성공처럼 보인다.
  2. 모델이 지정한 키 이름을 안 지킨다(doc_date→date, item_name→name).
     내용은 맞고 형식만 틀리다 → 프롬프트로 강제하지 말고 **코드가 별칭을 흡수**한다.
  3. 따옴표 없는 JS 객체 문법으로 낼 때가 있다 → 값싼 복구를 붙인다.
  4. **빈 <corrections> 블록을 넣으면 모델이 겁먹는다.** 규정만으로 답이 정해지는 품목까지
     신뢰도 0.05·UNKNOWN 을 낸다 → **비면 블록 자체를 넣지 않는다.**
  5. **비목 선택과 신뢰도를 한 표에 묶으면 안 된다.** 신뢰도를 먼저 정하고 맞는 비목을 버린다.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from typing import Any

import psycopg

DSN = os.environ["RND_DSN"]
OUR_BRN = re.sub(r"\D", "", os.environ.get("OUR_BRN", ""))
THRESHOLD = float(os.environ.get("CLASSIFY_CONFIDENCE_THRESHOLD", "0.70"))
MODEL = os.environ.get("RND_EXTRACT_MODEL", "claude-sonnet-5")


# ─────────────────────────────────────────────────────────────────────────────
# 헤드리스 호출
# ─────────────────────────────────────────────────────────────────────────────
def _run(prompt: str, *, allow_read: bool, turns: int, timeout: int) -> tuple[str, dict]:
    cmd = [
        shutil.which("claude") or "/usr/local/bin/claude",
        "-p", prompt,
        "--output-format", "json",
        "--model", MODEL,
    ]
    # ⚠ 함정 1. 파일을 읽히려면 `--allowed-tools "Read"` 와 넉넉한 --max-turns 가 **둘 다** 필요하다.
    if allow_read:
        cmd += ["--allowed-tools", "Read", "--max-turns", str(turns)]
    else:
        cmd += ["--allowed-tools", "", "--max-turns", "1"]

    r = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout
    )
    raw = r.stdout or r.stderr or ""
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        d = {}
    return raw, d


def _claude(prompt: str, *, allow_read: bool, timeout: int = 180) -> str:
    """헤드리스 호출. 도구 턴이 모자라 죽는 경우를 한 번 더 시도해서 넘긴다.

    ⚠ 실측: 문서에는 `--max-turns 2` 면 된다고 적혀 있었는데 부족할 때가 있다.
      파일은 읽었는데 답할 턴이 없어 `stop_reason: tool_use` 로 끝난다.
      같은 입력인데 되기도 하고 안 되기도 한다 — 그래서 넉넉히 주고, 그래도 걸리면 늘려서 재시도한다.
    """
    turns = 4 if allow_read else 1
    raw, d = _run(prompt, allow_read=allow_read, turns=turns, timeout=timeout)

    if allow_read and d.get("stop_reason") == "tool_use":
        raw, d = _run(prompt, allow_read=True, turns=8, timeout=timeout)

    if not d:
        return raw

    text = (d.get("result") or "").strip()
    # ⚠ 함정 1의 증상 — is_error 가 false 인데 result 가 비어 온다. 성공처럼 보이는 실패다.
    if d.get("is_error") or not text:
        raise RuntimeError(
            f"빈 응답 (is_error={d.get('is_error')} stop={d.get('stop_reason')})"
        )
    return text


def _json_block(text: str) -> Any:
    """```json 펜스·앞뒤 잡담·따옴표 없는 키를 견딘다."""
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(.+?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    else:
        i, j = t.find("{"), t.rfind("}")
        if i >= 0 and j > i:
            t = t[i : j + 1]
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        # ⚠ 함정 3. 따옴표 없는 키를 한 번만 값싸게 고쳐 본다. 재판독은 이미지 비용을 또 낸다.
        fixed = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', t)
        fixed = fixed.replace("'", '"')
        return json.loads(fixed)


def pick(d: dict, *names, default=None):
    """⚠ 함정 2. 모델이 키 이름을 안 지킨다. 코드가 별칭을 흡수한다."""
    for n in names:
        if n in d and d[n] not in (None, ""):
            return d[n]
    return default


# ─────────────────────────────────────────────────────────────────────────────
# ① 판독
# ─────────────────────────────────────────────────────────────────────────────
READ_PROMPT = """{path} 파일을 Read 도구로 읽어라. 연구비 집행 증빙(세금계산서·영수증·거래명세서·카드전표)이다.

다음을 뽑아 JSON 하나만 출력한다. 설명을 붙이지 마라.

{{
  "doc_type": "tax_invoice|receipt|card_slip|statement|quote|unknown",
  "supplier":      {{"name": "공급자 상호", "brn": "사업자등록번호 숫자만"}},
  "buyer":         {{"name": "공급받는자 상호", "brn": "사업자등록번호 숫자만"}},
  "doc_date": "YYYY-MM-DD",
  "supply_amount": 공급가액 정수,
  "vat": 세액 정수,
  "total_amount": 합계 정수,
  "items": [{{"품목명": "...", "수량": 숫자, "금액": 정수, "confidence": 0.0~1.0, "note": "불확실하면 이유"}}]
}}

규칙
- 금액은 콤마 없는 정수. 못 읽으면 null.
- **공급자와 공급받는자를 바꾸지 마라.** 서식마다 「거래처」라는 라벨이 가리키는 쪽이 다르다.
  사업자등록번호를 각각 그대로 적어라. 어느 쪽이 우리 회사인지는 판단하지 마라.
- 흐리거나 겹쳐서 불확실하면 **추측하지 말고** confidence 를 낮추고 note 에 이유를 적어라.
"""


def read_evidence(path: str) -> dict:
    """파일 하나를 판독한다. 거래 방향은 여기서 정하지 않는다."""
    raw = _claude(READ_PROMPT.format(path=path), allow_read=True)
    d = _json_block(raw)

    items = []
    for it in pick(d, "items", "line_items", "품목", default=[]) or []:
        if not isinstance(it, dict):
            continue
        items.append(
            {
                "품목명": pick(it, "품목명", "item_name", "name", "품목", default="(미상)"),
                "수량": pick(it, "수량", "quantity", "qty"),
                "금액": pick(it, "금액", "amount", "price", "supply_amount"),
                "confidence": float(pick(it, "confidence", "conf", default=0.5) or 0.5),
                "note": pick(it, "note", "비고"),
            }
        )

    sup = pick(d, "supplier", "공급자", default={}) or {}
    buy = pick(d, "buyer", "공급받는자", default={}) or {}
    digits = lambda x: re.sub(r"\D", "", str(x or ""))

    return {
        "서류종류": pick(d, "doc_type", "type", default="unknown"),
        "공급자": {"name": pick(sup, "name", "상호", "이름"), "brn": digits(pick(sup, "brn", "사업자등록번호", "biz_no"))},
        "공급받는자": {"name": pick(buy, "name", "상호", "이름"), "brn": digits(pick(buy, "brn", "사업자등록번호", "biz_no"))},
        "일자": pick(d, "doc_date", "date", "일자"),
        "공급가액": pick(d, "supply_amount", "supply", "공급가액"),
        "세액": pick(d, "vat", "tax", "세액"),
        "합계": pick(d, "total_amount", "total", "amount", "합계"),
        "품목": items,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 코드가 확정하는 것 — LLM 에게 맡기지 않는다
# ─────────────────────────────────────────────────────────────────────────────
def resolve_direction(ext: dict) -> tuple[str | None, str | None, str]:
    """거래처와 그 사업자번호를 **계산으로** 정한다.

    자사 사업자번호를 상수로 두고 둘 중 우리가 아닌 쪽이 거래처다.
    우리 번호가 문서에 없으면 「보류」로 남긴다. 추측하지 않는다.
    """
    sup, buy = ext["공급자"], ext["공급받는자"]
    if not OUR_BRN:
        return sup.get("name"), sup.get("brn"), "보류(자사번호 미설정)"
    if buy.get("brn") == OUR_BRN:
        return sup.get("name"), sup.get("brn"), "확정(우리가 공급받는자)"
    if sup.get("brn") == OUR_BRN:
        return buy.get("name"), buy.get("brn"), "확정(우리가 공급자)"
    return sup.get("name"), sup.get("brn"), "보류(자사번호 미발견)"


def verify_amounts(ext: dict) -> list[dict]:
    """금액 검산. 항목 합과 합계가 어긋나면 기록한다. 이것도 계산이다."""
    out = []
    items = [i for i in ext["품목"] if isinstance(i.get("금액"), (int, float))]
    total = ext.get("합계")
    supply, vat = ext.get("공급가액"), ext.get("세액")

    if items and isinstance(total, (int, float)):
        s = sum(int(i["금액"]) for i in items)
        # 항목 합이 공급가액과 맞고 합계가 부가세 포함이면 불일치가 아니다.
        if s != int(total) and not (
            isinstance(supply, (int, float)) and s == int(supply)
        ):
            out.append({"종류": "항목합_불일치", "항목합": s, "합계": int(total), "차이": int(total) - s})

    if all(isinstance(x, (int, float)) for x in (supply, vat, total)):
        if int(supply) + int(vat) != int(total):
            out.append(
                {"종류": "공급가액+세액≠합계", "공급가액": int(supply), "세액": int(vat), "합계": int(total)}
            )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# ② 비목 분류
# ─────────────────────────────────────────────────────────────────────────────
def _q(sql: str, params: tuple = ()) -> list[dict]:
    with psycopg.connect(DSN, connect_timeout=5) as c, c.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _regulations() -> str:
    rows = _q(
        """select c.이름 as 대분류, s.코드, s.이름, coalesce(s.정의,'') as 정의
             from app.sub_categories s join app.categories c on c.코드 = s.대분류
            where s.체계 = '중기부' order by s.대분류, s.코드"""
    )
    return "\n".join(
        f"{r['코드']} | {r['대분류']} › {r['이름']}" + (f" — {r['정의']}" if r["정의"] else "")
        for r in rows
    )


def _corrections(limit: int = 60) -> str:
    rows = _q(
        """select e.품목::text as 품목, d.ai_제안->>'비목_세부항목' as ai제안,
                  d.확정_세부항목, d.정정사유_유형, d.정정사유
             from app.decisions d join app.expenses e on e.id = d.expense_id
            where d.정정여부 and coalesce(d.정정사유_유형,'') <> '판독오류'
            order by d.created_at desc limit %s""",
        (limit,),
    )
    out = []
    for r in rows:
        품목 = r["품목"][:60]
        # ai제안이 비어 있으면 「None →」이 찍힌다. 모델에게 혼란만 준다.
        화살 = f"{r['ai제안']} → " if r.get("ai제안") else ""
        out.append(
            f"{품목} | {화살}{r['확정_세부항목']} | {r['정정사유_유형']} | {r['정정사유']}"
        )
    return "\n".join(out)


def _past(limit: int = 120) -> str:
    rows = _q(
        """select e.일자, e.거래처, e.품목::text as 품목, e.비목_세부항목
             from app.expenses e
            where e.상태 in ('확정','제출','정산완료') and e.비목_세부항목 is not null
            order by e.일자 desc nulls last limit %s""",
        (limit,),
    )
    return "\n".join(
        f"{r['일자']} | {r['거래처']} | {r['품목'][:50]} | {r['비목_세부항목']}" for r in rows
    )


CLASSIFY_HEAD = """너는 중소벤처기업부 R&D 과제의 연구비 비목 분류기다.

주어진 집행 건을 세부항목 코드 하나로 분류하고 **반드시 근거를 함께** 낸다.
대분류보다 **세부항목 판단이 어렵다.** 특히 이 경계에 주의한다.
- 사무용 기기·SW → LAB_OPERATION / 연구용 장비·SW → EQUIP_PURCHASE 또는 SOFTWARE
- 시약·재료 구입 → MATERIAL_BUY / 시험제품 제작 → MATERIAL_MAKE
- 학회 참가비 → HR_SUPPORT / 학회 출장 교통·숙박 → TRAVEL
- 특허 출원·심사·OA 대응 → IP_ACTIVITY / **등록비 → COMMON_COST(간접비)**

판단 우선순위
1. <corrections> — 사람이 AI 판단을 고친 이력. **가장 신뢰도가 높다.**
2. <past_expenses> — 우리 회사 과거 집행. **같은 회사의 관행이 규정보다 앞선다.**
3. <regulations> — 규정 조항
4. 일반 회계 상식

**먼저 비목을 고르고, 그다음에 확신도를 매긴다.** 순서를 바꾸지 마라 —
확신도를 먼저 정하면 맞는 비목을 버리게 된다.

확신이 서지 않으면 세부항목을 그대로 두되 confidence 를 낮춰라.
**틀린 비목을 자신 있게 답하는 것이 모르겠다고 답하는 것보다 훨씬 위험하다.** 반려되면 서류를 다시 만들어야 한다.

JSON 하나만 출력한다.
{
  "sub_category": "세부항목 코드",
  "confidence": 0.0~1.0,
  "rationale": "왜 이 비목인지 2~3문장",
  "rule_citation": "근거 규정 문구",
  "alternatives": [{"sub_category": "코드", "why": "이렇게 볼 여지"}]
}

<regulations>
{regs}
</regulations>
"""


def classify(거래처: str | None, 품목: list[dict], 합계: Any) -> dict:
    regs = _regulations()
    head = CLASSIFY_HEAD.replace("{regs}", regs)

    # ⚠ 함정 4. 비면 블록 자체를 넣지 않는다. 빈 블록을 보면 모델이 과잉 보류로 기운다.
    corr, past = _corrections(), _past()
    if corr:
        head += f"\n<corrections>\n{corr}\n</corrections>\n"
    if past:
        head += f"\n<past_expenses>\n{past}\n</past_expenses>\n"

    names = ", ".join(str(i.get("품목명")) for i in 품목) or "(품목 미상)"
    body = f"\n집행 건\n- 거래처: {거래처 or '미상'}\n- 품목: {names}\n- 금액: {합계}\n"

    d = _json_block(_claude(head + body, allow_read=False))
    sub = pick(d, "sub_category", "세부항목", "subCategory")
    conf = float(pick(d, "confidence", "conf", default=0.5) or 0.5)

    cat = _q("select 대분류 from app.sub_categories where 코드 = %s", (sub,))
    return {
        "비목_대분류": cat[0]["대분류"] if cat else None,
        "비목_세부항목": sub if cat else None,
        "확신도": conf,
        "근거": pick(d, "rationale", "근거", default=""),
        "규정": pick(d, "rule_citation", "규정", default=""),
        "대안": pick(d, "alternatives", "대안", default=[]),
        "자동확정_가능": conf >= THRESHOLD and bool(cat),
    }
