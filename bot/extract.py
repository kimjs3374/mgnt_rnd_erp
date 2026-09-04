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
import sys
from typing import Any

import psycopg

import evidence_ocr

DSN = os.environ["RND_DSN"]
OUR_BRN = re.sub(r"\D", "", os.environ.get("OUR_BRN", ""))
THRESHOLD = float(os.environ.get("CLASSIFY_CONFIDENCE_THRESHOLD", "0.70"))
# 기본은 haiku. 2026-09-03 실측으로 낮췄다 — 비목 분류 경계 4건(특허 등록비→COMMON_COST,
# 학회 참가비→HR_SUPPORT, 시료→MATERIAL_BUY, 사무용품→LAB_OPERATION)에서 sonnet 과
# 똑같이 4/4 를 맞췄고 소요도 같았다(각 60초). 되돌리려면 코드가 아니라
# /rnd/bot/.env.mcp 에 RND_EXTRACT_MODEL=claude-sonnet-5 를 둔다.
MODEL = os.environ.get("RND_EXTRACT_MODEL", "claude-haiku-4-5-20251001")


# ─────────────────────────────────────────────────────────────────────────────
# 헤드리스 호출
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# 토큰 절감 — 구독제에서는 비용보다 **토큰 차감**이 리스크다. 5시간 윈도우를 갉아먹는다.
#
#   실측(2026-09-04, haiku, 같은 프롬프트):
#     현재(cwd=/web/rnd/bot)            50,911 토큰
#     + CLAUDE.md 없는 폴더에서 실행     31,905  (-37%)   ← /web/rnd/CLAUDE.md 38KB 가 매번 실렸다
#     + 빈 settings(플러그인·메모리 끔)  25,133  (-51%)
#     + --system-prompt 로 대체         21,349  (-58%)
#
#   ⚠ 우리 프롬프트는 1,500 토큰뿐이다. 줄일 것은 프롬프트가 아니라 **자동으로 붙는 컨텍스트**다.
#   ⚠ 세션 재사용(--resume)은 비용만 64% 줄이고 **토큰은 그대로**다 — 구독제엔 의미가 없다.
LLM_WORKDIR = os.environ.get("RND_LLM_WORKDIR", "/rnd/bot/llmwork")
LLM_SETTINGS = os.path.join(LLM_WORKDIR, "empty-settings.json")
LEAN_SYSTEM = os.environ.get(
    "RND_LLM_SYSTEM",
    "너는 국가 R&D 연구비 집행의 비목을 분류하고 증빙을 판독하는 도구다. "
    "요청한 JSON 하나만 출력한다. 설명·인사·사족을 붙이지 않는다.")


def _ensure_workdir() -> str:
    """CLAUDE.md 도 플러그인 설정도 없는 작업 디렉터리를 만들어 둔다."""
    try:
        os.makedirs(LLM_WORKDIR, exist_ok=True)
        if not os.path.exists(LLM_SETTINGS):
            with open(LLM_SETTINGS, "w", encoding="utf-8") as f:
                f.write('{"enabledPlugins":{},"autoMemoryEnabled":false}')
    except Exception as e:
        print(f"[llm] 작업 디렉터리 준비 실패(무시): {e}", file=sys.stderr)
        return "/tmp"
    return LLM_WORKDIR


def _run(prompt: str, *, allow_read: bool, turns: int, timeout: int) -> tuple[str, dict]:
    workdir = _ensure_workdir()
    cmd = [
        shutil.which("claude") or "/usr/local/bin/claude",
        "-p", prompt,
        "--output-format", "json",
        "--model", MODEL,
    ]
    if os.environ.get("RND_LLM_LEAN", "1") != "0":
        cmd += ["--settings", LLM_SETTINGS, "--system-prompt", LEAN_SYSTEM]
    # ⚠ 함정 1. 파일을 읽히려면 `--allowed-tools "Read"` 와 넉넉한 --max-turns 가 **둘 다** 필요하다.
    if allow_read:
        cmd += ["--allowed-tools", "Read", "--max-turns", str(turns)]
    else:
        cmd += ["--allowed-tools", "", "--max-turns", "1"]

    r = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout,
        cwd=workdir,          # ★ 여기서 실행해야 상위 CLAUDE.md 가 안 실린다
    )
    raw = r.stdout or r.stderr or ""
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        d = {}
    return raw, d



# ─────────────────────────────────────────────────────────────────────────────
# LLM 사용량 실측 — 「의존도를 낮췄다」를 숫자로 대려면 얼마나 썼는지 재야 한다.
#   로컬이 처리한 건은 여기 행이 안 생긴다. **행이 없는 것 자체가 증거다.**
# ─────────────────────────────────────────────────────────────────────────────
LAST_USAGE: dict = {}          # 가장 최근 LLM 호출의 사용량. 카드에 그대로 띄운다.


def _log_usage(단계: str, d: dict, *, 성공: bool, 사유: str = "",
               파일명: str | None = None) -> None:
    u = (d or {}).get("usage") or {}
    inp = u.get("input_tokens")
    out = u.get("output_tokens")
    cc = u.get("cache_creation_input_tokens")
    cr = u.get("cache_read_input_tokens")
    총 = sum(x for x in (inp, out, cc, cr) if isinstance(x, int)) or None
    row = {
        "단계": 단계, "모델": MODEL, "성공": 성공, "사유": (사유 or "")[:300] or None,
        "입력토큰": inp, "출력토큰": out, "캐시생성토큰": cc, "캐시읽기토큰": cr,
        "총토큰": 총,
        "비용_usd": (d or {}).get("total_cost_usd"),
        "소요초": round((d or {}).get("duration_ms", 0) / 1000, 2) or None,
        "턴수": (d or {}).get("num_turns"),
        "파일명": 파일명,
    }
    LAST_USAGE.clear()
    LAST_USAGE.update({k: v for k, v in row.items() if v is not None})

    # 로그에도 남긴다 — DB 가 죽어도 journalctl 로 볼 수 있어야 한다
    print(f"[llm_usage] {단계} 성공={성공} 토큰={총} 비용=${row['비용_usd']} "
          f"{row['소요초']}초", file=sys.stderr)
    try:
        import rest
        rest.insert("llm_usage", {k: v for k, v in row.items() if v is not None})
    except Exception as e:
        print(f"[llm_usage] 적재 실패(무시): {e}", file=sys.stderr)

def _claude(prompt: str, *, allow_read: bool, timeout: int = 180) -> str:
    """헤드리스 호출. 도구 턴이 모자라 죽는 경우를 한 번 더 시도해서 넘긴다.

    ⚠ 실측: 문서에는 `--max-turns 2` 면 된다고 적혀 있었는데 부족할 때가 있다.
      파일은 읽었는데 답할 턴이 없어 `stop_reason: tool_use` 로 끝난다.
      같은 입력인데 되기도 하고 안 되기도 한다 — 그래서 넉넉히 주고, 그래도 걸리면 늘려서 재시도한다.
    """
    단계 = "read_evidence" if allow_read else "classify"
    turns = 4 if allow_read else 1
    raw, d = _run(prompt, allow_read=allow_read, turns=turns, timeout=timeout)

    if allow_read and d.get("stop_reason") == "tool_use":
        _log_usage(단계, d, 성공=False, 사유="turns 부족(tool_use) — 재시도")
        raw, d = _run(prompt, allow_read=True, turns=8, timeout=timeout)

    if not d:
        _log_usage(단계, {}, 성공=False, 사유="JSON 파싱 실패")
        return raw

    text = (d.get("result") or "").strip()
    # ⚠ 함정 1의 증상 — is_error 가 false 인데 result 가 비어 온다. 성공처럼 보이는 실패다.
    if d.get("is_error") or not text:
        사유 = f"빈 응답 (is_error={d.get('is_error')} stop={d.get('stop_reason')})"
        _log_usage(단계, d, 성공=False, 사유=사유)
        raise RuntimeError(사유)

    _log_usage(단계, d, 성공=True)
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
    """파일 하나를 판독한다. 거래 방향은 여기서 정하지 않는다.

    ① 로컬 OCR 경로를 먼저 탄다 — **LLM 호출 0회.**  s+v=t 이고 v~=s/10 인 삼중항을
       찾으면 라벨이 없어도 금액이 확정된다(실측: 커버리지 100%, 교차일치 94.1%).
    ② 산술로 검증이 안 되면 조용히 물러나 기존 vision 경로가 받는다(17초·$0.076).
       되돌리려면 RND_LOCAL_OCR=0 . 코드를 고칠 필요 없다.
    """
    if os.environ.get("RND_LOCAL_OCR", "1") != "0":
        try:
            loc = evidence_ocr.read(path)
            if evidence_ocr.good_enough(loc):
                return loc
        except Exception as e:  # 로컬 경로가 죽어도 판독 자체는 계속돼야 한다
            print(f"[evidence_ocr] 로컬 판독 실패, LLM 으로 폴백: {e}", file=sys.stderr)

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

    def _clean(nm):
        """라벨 조각을 상호로 쓰지 않는다.

        실측: 전자세금계산서에서 「성 상호 성」이 상호로 잡혔다. 좌우 두 블록의 라벨이
        한 줄로 뭉쳐 나온 것이다. 사업자번호가 사전에 없는 거래처였다면 그 쓰레기가
        그대로 거래처명이 됐을 것이다.
        """
        if not nm:
            return None
        s = re.sub(r"(상호|법인명|성명|성|등록|번호|공급자|공급받는자|받는자|사업장|"
                   r"주소|업태|종목|이메일|Email|종사업|장번호|대표자?)", " ", str(nm))
        s = re.sub(r"[\s·,./|-]+", " ", s).strip()
        return nm if len(re.sub(r"\s", "", s)) >= 2 else None

    def _named(party):
        """**사업자번호 조회를 먼저** 하고, 없을 때만 판독된 이름을 쓴다.

        ⚠ 순서가 중요하다. OCR 이 뽑은 이름을 우선하면 쓰레기 이름이 DB 조회를 막는다 —
          실측: 충남TP(312-82-06577)가 사전에 있는데도 OCR 이 읽은
          「서규석 공 (주)매그나텍」이 먼저 채워져 조회를 건너뛰었다. 우리 회사 이름이
          거래처로 들어갈 뻔했다. 번호는 체크섬으로 검증돼 있고 사전은 사람이 만든 것이다.
        """
        return vendor_by_brn(party.get("brn")) or _clean(party.get("name")), party.get("brn")

    if not OUR_BRN:
        n, b = _named(sup)
        return n, b, "보류(자사번호 미설정)"
    if buy.get("brn") == OUR_BRN:
        n, b = _named(sup)
        return n, b, "확정(우리가 공급받는자)"
    if sup.get("brn") == OUR_BRN:
        # ⚠ 우리가 파는 쪽이다. 지출증빙이 아니라 **매출 증빙**일 수 있다.
        #   예전에는 이것도 그냥 「확정」이라 조용히 지나갔다. 이제 사람에게 알린다.
        n, b = _named(buy)
        return n, b, "주의(우리가 공급자 — 매출 증빙일 수 있음)"

    # ★ 자사번호가 문서에 없다. 지출증빙은 **우리가 사는 쪽**이므로, 상대 사업자번호가
    #   하나만 잡히면 그게 거래처다. 거래명세서에는 우리 번호가 아예 안 찍힌다 —
    #   실측 516문서 중 48건(9.3%)이 여기 해당했고, 전부 「보류」 경고를 달고 있었다.
    후보 = [p for p in (sup, buy) if p.get("brn") and p.get("brn") != OUR_BRN]
    if len(후보) == 1:
        n, b = _named(후보[0])
        return n, b, "확정(지출증빙 — 상대 사업자번호 하나)"

    # 번호가 아예 없거나 상대 번호가 둘 이상이면 고르지 않는다. 추측하지 않는다.
    n, b = _named(sup)
    return n, b, "보류(자사번호 미발견)"



def vendor_by_brn(brn: str | None) -> str | None:
    """**사업자번호로 상호를 찾는다.** 거래처 인식의 마지막 보루.

    왜 필요한가: 스캔 세금계산서·계산서는 공급자/공급받는자 블록이 좌우로 나란해서
    OCR 로 펼치면 글자가 뒤섞인다. 상호를 텍스트에서 집으면 **우리 회사가 공급자로**
    잡히는 사고가 난다(실측). 그래서 이름은 비우고, 대신 **체크섬으로 확정된 번호**로
    `app.vendors` 를 조회한다. 번호는 뒤집히지 않는다.
    """
    d = re.sub(r"\D", "", brn or "")
    if len(d) != 10:
        return None
    try:
        rows = _q("select 업체명 from app.vendors where 사업자번호 = %s limit 1", (d,))
    except Exception:
        return None
    return rows[0]["업체명"] if rows else None

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



# 품목 모델은 클래스가 4개라 확신도 분포가 거래처 모델보다 낮게 깔린다.
#   ⚠ 2026-09-04 실측으로 **학습셋을 고쳤다.** 예전 씨앗은 케이스의 품목을 전부 이어붙인
#     한 줄만 학습했는데, 실제 카드전표·영수증은 품목이 짧거나 하나뿐이다. 분포가 어긋나
#     짧은 입력에서 확률이 평평해졌고(예: 「시약」 0.45), τ=0.50 을 못 넘어 **품목을 버리고
#     거래처 모델로 떨어졌다** — 시약과 항온항습기가 같은 비목으로 나왔다. 씨앗을
#     「케이스 1행 + 품목 각 1행」으로 바꾼 뒤 같은 입력이 0.52~0.66 으로 올라왔다.
#   실측(거래처 그룹 분리, n=650): 전체 88.2%
#     τ=0.50 커버리지 97.4%/정확도 89.0% · τ=0.60 93.3%/91.7% · τ=0.70 86.3%/93.3%
#   이 경로는 **항상 사람이 확인**하므로(자동확정_가능=False) 침묵보다 근거 있는 제안이 낫다.
#   침묵하면 거래처로 떨어지는데, 그건 「한 거래처에서 장비도 재료도 산다」는 사실에 어긋난다.
BIMOK_ITEM_TAU = float(os.environ.get("RND_BIMOK_ITEM_TAU", "0.50"))
BIMOK_ITEM_PATH = os.environ.get(
    "RND_BIMOK_ITEM_MODEL", "/rnd/bot/models/bimok_item_v2.joblib")
BIMOK_MODEL_PATH = os.environ.get(
    "RND_BIMOK_MODEL", "/rnd/bot/models/bimok_cat_v1.joblib")
# 자체 모델이 "제안이라도 할" 최소 확신도.
#   실측(거래처 그룹 분리): tau 0.70 -> 커버리지 72.7%/정확도 96.4%
#                          tau 0.60 -> 커버리지 81.8%/정확도 92.1%
#   이 경로는 **항상 자동확정_가능=False** 라 사람이 반드시 확인한다. 그래서 침묵보다
#   근거를 붙인 제안이 낫다고 보고 0.60 을 쓴다. 자동확정 게이트(THRESHOLD 0.70)와는 별개다.
BIMOK_TAU = float(os.environ.get("RND_BIMOK_TAU", "0.60"))
_bimok_model = None


_bimok_item_model = None


_MODEL_MTIME: dict = {}


def _load(path, cache_name):
    """★ 재학습으로 파일이 바뀌면 **다시 읽는다.**

    사람이 확정 → retrain.py 가 모델을 갱신 → 봇을 재시작하지 않아도 다음 판독부터
    새 모델이 쓰인다. 예전에는 프로세스가 사는 동안 첫 모델을 계속 붙들고 있어서
    「학습했다」고 말해도 실제 판단은 옛 모델이 하고 있었다.
    """
    g = globals()
    try:
        mt = os.path.getmtime(path)
    except OSError:
        mt = None
    if g[cache_name] is not None and _MODEL_MTIME.get(cache_name) == mt:
        return g[cache_name] or None
    try:
        import joblib
        g[cache_name] = joblib.load(path)
        print(f"[bimok] 모델 로드 {os.path.basename(path)} mtime={mt}", file=sys.stderr)
    except Exception as e:
        print(f"[bimok] 모델 로드 실패 {path}: {e}", file=sys.stderr)
        g[cache_name] = False
    _MODEL_MTIME[cache_name] = mt
    return g[cache_name] or None


def _bimok():
    """거래처 기반 모델(보조)."""
    return _load(BIMOK_MODEL_PATH, "_bimok_model")


def _bimok_item():
    """★ 품목 기반 모델(주). **품목이 비목을 정한다** — 같은 거래처에서 장비도 사고
    재료도 산다. 거래처로 비목을 정하는 건 타당하지 않다."""
    return _load(BIMOK_ITEM_PATH, "_bimok_item_model")



# 비목 코드는 내부용이다. **사람에게 보이는 곳엔 한글 이름을 쓴다.**
#   FACILITY 라고 띄우면 담당자가 뭔지 모른다 — 근거를 읽으라고 만든 문장이 무의미해진다.
_CAT_KO = {
    "FACILITY": "연구시설·장비 및 재료비",
    "ACTIVITY": "연구활동비",
    "PERSONNEL": "인건비",
    "INDIRECT": "간접비",
    "ALLOWANCE": "연구수당",
    "STUDENT": "학생인건비",
    "LOCAL_UNCAT": "미분류(지자체)",
}
_cat_ko_cache: dict[str, str] = {}


def cat_ko(code: str | None) -> str:
    """대분류 코드를 한글 이름으로. DB 를 우선 보고, 없으면 표를 쓴다."""
    if not code:
        return "미분류"
    if code in _cat_ko_cache:
        return _cat_ko_cache[code]
    name = _CAT_KO.get(code, code)
    try:
        rows = _q("select 이름 from app.categories where 코드 = %s limit 1", (code,))
        if rows and rows[0].get("이름"):
            name = rows[0]["이름"]
    except Exception:
        pass
    _cat_ko_cache[code] = name
    return name


# ─────────────────────────────────────────────────────────────────────────────
# 가맹점 업종 — 상호만 보고 알 수 있는 것
#
#   카드전표에는 품목이 인쇄되지 않는다. 그래서 **상호가 유일한 근거**다.
#   「칼국수앤쑤꾸미」가 음식점인 건 사람이면 다 안다. 실측에서 이걸 놓쳐
#   OCR 쓰레기 품목(「타계 금액, 과세물품가오, 신용승인정보」)으로 재료비를 찍었다.
#
#   ⚠ 이건 **비목 추론 규칙이 아니라 업종 식별**이다. 상호에 든 음식 이름을 보고
#     음식점인지 아는 것뿐이고, 그 다음 비목은 회계 원칙이 정한다(식대=연구활동비).
#     사람이 정정하면 그 값이 이력에 남아 다음부터는 조회로 먼저 답한다.
_FOOD_WORDS = (
    # 음식 이름 — ⚠ **한 글자 단어를 넣지 말 것.** '회'·'각' 을 넣었다가
    #   「알수없는거래처XYZ」가 음식점으로 판정됐고, 「협회」·「학회」·「회의」도 걸린다.
    #   두 글자 이상, 그리고 음식점 말고는 잘 안 쓰는 말만 넣는다.
    "칼국수|국수|쌀국수|우동|라멘|짜장|짬뽕|탕수육|만두|족발|보쌈|곱창|막창|"
    "삼겹|갈비|불고기|냉면|국밥|해장국|설렁탕|곰탕|감자탕|부대찌개|찌개|전골|"
    "초밥|스시|사시미|횟집|생선회|물회|장어|아구|해물|조개|낙지|쭈꾸미|쑤꾸미|주꾸미|"
    "치킨|피자|버거|파스타|스테이크|돈까스|돈가스|카레|샐러드|샌드위치|"
    "떡볶이|순대|분식|김밥|도시락|덮밥|비빔밥|백반|한정식|뷔페|바베큐|"
    "食堂|맛집|먹거리|"
    # 업종어
    "식당|음식점|요리주점|중화요리|고깃집|"
    "카페|커피|coffee|cafe|베이커리|제과점|빵집|디저트|브런치|"
    "주점|호프|포차|술집|맥주|막걸리"
)
_FOOD_BRANDS = (
    "스타벅스|투썸|이디야|메가커피|빽다방|컴포즈|폴바셋|할리스|엔제리너스|"
    "맥도날드|롯데리아|버거킹|맘스터치|서브웨이|"
    "김밥천국|본죽|한솥|이삭토스트|파리바게|뚜레쥬르|배스킨|던킨"
)
_FOOD_RE = re.compile(f"({_FOOD_WORDS}|{_FOOD_BRANDS})", re.I)
# 주유·통행은 음식이 아니지만 같은 「상호로 아는」 부류다
_FUEL_RE = re.compile(r"주유소|주유|셀프주유|에너지|오일뱅크|SK에너지|GS칼텍스|현대오일|"
                      r"S-OIL|알뜰주유|고속도로|통행료|하이패스", re.I)
_STAY_RE = re.compile(r"호텔|모텔|펜션|리조트|게스트하우스|스테이|inn|hotel", re.I)


def industry_of(상호: str | None) -> tuple[str, str, str] | None:
    """상호로 업종을 알아낸다. (대분류, 세부항목, 설명) 또는 None."""
    if not 상호:
        return None
    nm = re.sub(r"\s+", "", 상호)
    if _FOOD_RE.search(nm):
        return ("ACTIVITY", "MEETING", "상호에 음식·식당 이름이 들어 있어 음식점으로 봅니다")
    if _FUEL_RE.search(nm):
        return ("ACTIVITY", "TRAVEL", "상호가 주유소·통행료 사업자입니다")
    if _STAY_RE.search(nm):
        return ("ACTIVITY", "TRAVEL", "상호가 숙박업소입니다")
    return None

def _model_note() -> str:
    """학습 규모와 실측 정확도를 **모델 파일 옆의 metrics.json 에서 읽어** 문장으로 만든다.

    ⚠ 수치를 코드에 박아 두면 재학습 뒤 거짓말이 된다. 파일이 없으면 수치를 말하지 않는다.
    """
    import json as _json
    try:
        with open(BIMOK_ITEM_PATH + ".meta.json", encoding="utf-8") as f:
            m = _json.load(f)
    except Exception:
        return "사내 실집행 자료와 확정 이력으로 학습했습니다."
    n = m.get("n_train")
    acc = m.get("accuracy_groupsplit")
    본 = m.get("n_actual") or 0
    정 = m.get("n_correction") or 0
    조각 = []
    if n:
        조각.append(f"학습 {n}건")
    if 본:
        조각.append(f"그중 사람이 확정한 {본}건" + (f"(정정 {정}건)" if 정 else ""))
    s = "사내 실집행 자료로 학습했습니다"
    if 조각:
        s = "사내 실집행 자료로 " + " · ".join(조각) + " 학습했습니다"
    if acc:
        s += f". 처음 보는 거래처 기준 {100*float(acc):.1f}%입니다"
    return s + "."


def _classify_local(거래처: str | None, 품목: list[dict] | None = None,
                    사유: str = "") -> dict:
    """LLM 없이 비목을 정한다. 3단으로 내려간다.

      ① 같은 거래처를 **사람이 확정한** 과거 비목      실측 정확도 100% / 커버리지 36.4%
      ② 자체 모델(대분류)                            처음 보는 거래처 85.7%, tau 0.70 에서 96.4%
      ③ 보류                                        답하지 않는다. 사람이 고른다.

    ⚠ 규칙으로 비목을 '추론'하지 않는다(CLAUDE.md §0 — 규칙기반은 쌓여도 안 좋아진다).
      ①은 사람이 확정한 값의 재사용이고, ②는 그 확정들로 학습한 모델이다.
    ⚠ 세부항목은 폴더/파일에서 라벨이 안 나와 **학습돼 있지 않다.** 대분류만 제안하고
      세부항목은 비운다 — 사람이 고르면 decisions 에 쌓여 다음 학습 재료가 된다.
    """
    names = ", ".join(str(i.get("품목명")) for i in (품목 or []) if i.get("품목명"))

    # ★⓪ 상호로 업종이 확실하면 그게 먼저다.
    #    카드전표엔 품목이 없고, POS 영수증은 OCR 이 라벨 조각을 품목으로 뽑을 때가 있다.
    #    실측: 「주 칼국수 앤 쑤꾸미 내동점」이 쓰레기 품목 때문에 재료비로 찍혔다.
    ind = industry_of(거래처)
    if ind:
        cat, sub, why = ind
        return {
            "비목_대분류": cat, "비목_세부항목": sub, "확신도": 0.75,
            "근거": f"거래처 「{거래처}」 — {why}. "
                    f"**{cat_ko(cat)}**로 제안합니다. "
                    f"출장 중 식대라면 출장비로, 회의 식대라면 회의비로 골라 주세요 — "
                    f"고르신 값이 이력에 남아 다음부터 먼저 참조됩니다.",
            "규정": "", "대안": [], "판단출처": "로컬 · 가맹점 업종",
            "자동확정_가능": False,
        }

    # ★① 품목 모델. **무엇을 샀는가가 비목을 정한다.**
    #    거래처 우선은 타당하지 않다 — 한 거래처에서 장비·재료·활동비가 다 나온다.
    #    처음 보는 거래처여도 품목만 있으면 답할 수 있다(실측 83.1%, 거래처 미사용).
    mi = _bimok_item()
    if mi is not None and names.strip():
        try:
            cat = mi.predict([names])[0]
            conf = float(mi.predict_proba([names]).max())
        except Exception as e:
            print(f"[bimok] 품목 예측 실패: {e}", file=sys.stderr)
            cat, conf = None, 0.0
        if cat and conf >= BIMOK_ITEM_TAU:
            return {
                "비목_대분류": cat, "비목_세부항목": None, "확신도": round(conf, 2),
                "근거": f"**품목**「{names[:60]}」을 보고 자체 모델이 "
                        f"**{cat_ko(cat)}**로 제안합니다(확신도 {conf:.0%}). {_model_note()} "
                        f"**세부항목은 직접 골라 주세요** — 그 선택이 다음 학습에 들어갑니다.",
                "규정": "", "대안": [], "판단출처": "로컬 · 품목 모델",
                "자동확정_가능": False,
            }

    # ② 같은 거래처의 과거 확정 이력 (보조 — 거래처가 비목을 정하진 않지만 참고는 된다)
    if 거래처:
        try:
            rows = _q(
                """
                select e.비목_대분류, e.비목_세부항목, count(*) as n
                  from app.expenses e
                 where e.거래처 = %s and e.비목_세부항목 is not null
                 group by 1, 2 order by n desc limit 1
                """,
                (거래처,),
            )
        except Exception:
            rows = []
        if rows:
            r = rows[0]
            return {
                "비목_대분류": r["비목_대분류"],
                "비목_세부항목": r["비목_세부항목"],
                "확신도": 0.60,
                "근거": f"같은 거래처 「{거래처}」를 과거에 {r['n']}건 "
                        f"이 비목으로 확정했습니다. 그 값을 그대로 제안합니다(규정 대조 없음).",
                "규정": "", "대안": [], "판단출처": "로컬 · 과거 확정 이력",
                "자동확정_가능": False,
            }

    # ③ 거래처 사전(app.vendors.비목_대분류) — 사내 실집행 772파일에서 뽑은 최빈 비목.
    #     실집행 이력이 아직 없는 거래처도 여기서 답이 나온다. 사람이 확정한 값에서
    #     유도한 것이라 규칙 추론이 아니다.
    if 거래처:
        try:
            rows = _q(
                """
                select 비목_대분류 from app.vendors
                 where 업체명 = %s and 비목_대분류 is not null limit 1
                """,
                (거래처,),
            )
        except Exception:
            rows = []
        if rows:
            return {
                "비목_대분류": rows[0]["비목_대분류"], "비목_세부항목": None,
                "확신도": 0.65,
                "근거": f"거래처 사전에서 「{거래처}」의 비목을 찾았습니다: "
                        f"**{cat_ko(rows[0]['비목_대분류'])}**. 사내 실집행 772파일에서 이 거래처가 "
                        f"주로 쓰인 비목입니다. **세부항목은 직접 골라 주세요.**",
                "규정": "", "대안": [], "판단출처": "로컬 · 거래처 사전",
                "자동확정_가능": False,
            }

    # ④ 거래처 기반 모델 (마지막 보조)
    m = _bimok()
    if m is not None and (거래처 or names):
        try:
            q = f"{거래처 or ''} {거래처 or ''} {names}".strip()
            cat = m.predict([q])[0]
            conf = float(m.predict_proba([q]).max())
        except Exception as e:
            print(f"[bimok] 예측 실패: {e}", file=sys.stderr)
            cat, conf = None, 0.0
        if cat and conf >= BIMOK_TAU:
            return {
                "비목_대분류": cat, "비목_세부항목": None,
                "확신도": round(conf, 2),
                "근거": f"자체 비목 모델이 **대분류만** 제안합니다: **{cat_ko(cat)}** "
                        f"(확신도 {conf:.0%}). 사내 실집행 79건으로 학습했고, 처음 보는 "
                        f"거래처 기준 정확도 85.7%입니다. **세부항목은 학습돼 있지 않으니 "
                        f"직접 골라 주세요** — 고르신 값이 다음 학습에 들어갑니다.",
                "규정": "", "대안": [], "판단출처": "로컬 · 거래처 모델",
                "자동확정_가능": False,
            }

    # ③ 보류
    return {
        "비목_대분류": None, "비목_세부항목": None, "확신도": 0.0,
        "근거": ("로컬 모델·이력·사전 어디서도 확신이 서지 않아 **보류**합니다. 판독된 금액·일자·사업자번호는 아래 그대로이니 비목만 "
                "골라 주세요 — 그 선택이 학습 데이터가 됩니다."
                + (f"\n_(사유: {사유[:120]})_" if 사유 else "")),
        "규정": "", "대안": [], "판단출처": "보류 · 근거 부족",
        "자동확정_가능": False,
    }

def classify(거래처: str | None, 품목: list[dict], 합계: Any) -> dict:
    """② 비목 분류 — **로컬 먼저, LLM 은 보조.**

    순서를 이렇게 두는 이유:
      · 로컬이 확신하는 건은 LLM 을 아예 안 부른다 → 토큰이 안 나간다.
      · 확신이 없을 때만 LLM 이 받는다 → 품질은 유지된다.
      · **판단 이력이 쌓일수록 로컬이 답하는 비율이 올라가고 LLM 호출은 줄어든다.**
        규칙 기반이면 쌓여도 안 좋아지지만, 이건 사람이 확정한 값으로 학습한다.

    되돌리기: RND_LOCAL_FIRST=0 이면 예전처럼 LLM 을 먼저 부른다.
    """
    if os.environ.get("RND_LOCAL_FIRST", "1") != "0":
        loc = _classify_local(거래처, 품목)
        # 로컬이 근거를 갖고 답했으면(비목이 있으면) 그걸 쓴다. LLM 호출 0회.
        if loc.get("비목_대분류"):
            return loc

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

    try:
        d = _json_block(_claude(head + body, allow_read=False))
    except Exception as e:
        # LLM 이 죽어도 판독 결과까지 통째로 버리지 않는다. 과거 이력으로 채우고,
        # 그것도 없으면 **보류**로 남겨 사람이 고르게 한다(Block Kit 드롭다운).
        # ⚠ 규칙으로 비목을 '추론'하지 않는다 — 그건 쌓여도 좋아지지 않는다(CLAUDE.md §0).
        #   과거에 **사람이 확정한 같은 거래처의 비목**을 재사용하는 것뿐이다.
        print(f"[classify] LLM 실패, 로컬 폴백: {e}", file=sys.stderr)
        return _classify_local(거래처, 품목, str(e))

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
        "판단출처": f"LLM · {MODEL.split('-')[1] if '-' in MODEL else MODEL}",
        # 실사용량을 결과에 실어 보낸다 — 「LLM 을 얼마나 썼나」가 카드에 보여야 한다
        "토큰": LAST_USAGE.get("총토큰"),
        "비용_usd": LAST_USAGE.get("비용_usd"),
        "소요초": LAST_USAGE.get("소요초"),
        "자동확정_가능": conf >= THRESHOLD and bool(cat),
    }
