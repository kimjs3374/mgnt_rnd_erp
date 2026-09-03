"""공고 판독 — 제출서류 · 구조화 요약 · 1차 거르기.

`scripts/lib/llm.mjs` 에 있던 세 가지를 그대로 옮겼다(권태호 작업, 2026-09-03 19:08).
**프롬프트 문구는 한 글자도 고치지 않았다.** 옮기는 것과 고치는 것을 같이 하면
뒤에 결과가 달라졌을 때 무엇 때문인지 못 가린다.

왜 옮기나
  같은 모델을 파이썬과 node 두 곳에서 부르고 있었다. 시연 전에 프롬프트를 하나 고치면
  다른 쪽은 그대로 남는다. 그 사고는 조용하고, 드러나는 자리가 심사장이다.
  → 판단은 파이썬이 갖고, node 는 게이트웨이로 부른다(2026-09-03 김정수 결정).

옮기면서 같이 얻은 것 — node 쪽에는 없던 것들이다
  · `_json_block` 이 ```json 펜스·앞뒤 잡담·따옴표 없는 키를 견딘다.
    node 의 정규식 한 줄(`/\\[[\\s\\S]*\\]/`)은 견디지 못하고 null 을 돌려줬다.
  · 빈 응답을 성공으로 넘기지 않는다(실측 함정 1 — is_error:false 인데 result 가 비어 온다).
"""

from __future__ import annotations

import json
import re
from typing import Any

import logging

log = logging.getLogger(__name__)

import extract  # _claude · _json_block 을 그대로 쓴다. 헤드리스 로직을 두 벌로 두지 않는다.

SUMMARY_MAX_CHARS = 30_000  # llm.mjs 의 본문.slice(0, 30000) 과 같다


def _json_any(text: str) -> Any:
    """배열도 객체도 받는다. `extract._json_block` 은 객체만 잘라 낸다."""
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.+?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    if t.startswith("["):
        return json.loads(t)
    i, j = t.find("["), t.rfind("]")
    k, l = t.find("{"), t.rfind("}")
    # 배열이 객체보다 먼저 나오면 배열로 본다.
    if i >= 0 and j > i and (k < 0 or i < k):
        try:
            return json.loads(t[i : j + 1])
        except json.JSONDecodeError:
            pass
    return extract._json_block(t)


# ─────────────────────────────────────────────────────────────────────────────
# ① 제출서류 — 프로토타입 gongo.py extract_documents(2026-08-21 검증) 계보
# ─────────────────────────────────────────────────────────────────────────────
PROMPT_DOCUMENTS = """다음은 정부지원사업 공고문에서 제출서류가 언급된 구간이다.
신청자가 실제로 준비해야 할 서류만 뽑아라.

규칙
- 가점·우대사항 증빙은 별도로 분류한다(필수가 아니다).
- 평가지표표·사업비표는 서류가 아니다. 넣지 마라.
- 공고문에 없는 서류를 추측해서 만들지 마라.
- 필수/해당시 구분이 원문에서 불분명하면 "확인필요"로 표시하고 단정하지 마라.
- 발급기관이 공고문에 적혀 있을 때만 채운다. 없으면 null.

JSON 배열로만 답하라. 각 항목:
{"연번": 정수, "서류명": 문자열, "구분": "필수"|"해당시"|"가점"|"확인필요",
 "부수": 문자열|null, "발급처": 문자열|null, "비고": 문자열|null,
 "근거문장": 공고문에서 그대로 인용한 한 문장}

위 지시대로 JSON 배열만 출력하라. 설명 금지.
"""


def extract_documents(sections: list[dict] | list[str]) -> dict[str, Any]:
    """sections 는 node 의 findSections() 결과. {본문:…} 목록이거나 문자열 목록."""
    parts = [s.get("본문", "") if isinstance(s, dict) else str(s) for s in sections or []]
    body = "\n\n---\n\n".join(p for p in parts if p)
    if not body.strip():
        return {"ok": False, "docs": None, "error": "본문이 비어 있다"}

    text = extract._claude(PROMPT_DOCUMENTS + "\n\n=== 공고문 ===\n" + body,
                           allow_read=False, timeout=600)
    docs = _json_any(text)
    if not isinstance(docs, list):
        return {"ok": False, "docs": None, "error": "JSON 배열이 아니다", "text": text[:300]}
    return {"ok": True, "docs": docs}


# ─────────────────────────────────────────────────────────────────────────────
# ② 구조화 요약 — 공고 상세 패널. app.ann_summary 에 캐싱된다
# ─────────────────────────────────────────────────────────────────────────────
PROMPT_SUMMARY = """다음은 정부지원사업·R&D 과제 공고문 본문이다. 아래 항목을 뽑아라.

규칙
- 공고문에 실제로 적힌 내용만 뽑는다. 없으면 null 로 둔다 — 지어내지 마라.
- 문의처는 담당 부서·연락처·이메일만 남긴다. 담당자 개인 실명은 빼라(부서명·직책만).
- 사업요약은 3~5문장, 공고문 표현을 최대한 그대로 쓴다 — 의역하거나 부풀리지 않는다.
- 지원규모에 단위가 적혀 있으면 그 단위 그대로 옮긴다. 환산하지 마라.

JSON 객체 하나로만 답하라:
{"지원분야": 문자열|null, "지원대상": 문자열|null, "지원규모": 문자열|null,
 "접수방법": 문자열|null, "문의처": 문자열|null, "사업요약": 문자열|null,
 "확신도": 0~1 사이 숫자}

위 지시대로 JSON 객체 하나만 출력하라. 설명 금지.
"""


def extract_summary(본문: str) -> dict[str, Any]:
    body = (본문 or "")[:SUMMARY_MAX_CHARS]
    if not body.strip():
        return {"ok": False, "summary": None, "error": "본문이 비어 있다"}

    text = extract._claude(PROMPT_SUMMARY + "\n\n=== 공고문 ===\n" + body,
                           allow_read=False, timeout=600)
    summary = _json_any(text)
    if not isinstance(summary, dict):
        return {"ok": False, "summary": None, "error": "JSON 객체가 아니다", "text": text[:300]}
    # 없는 값은 null 로 둔다. 화면이 「공고문에서 못 찾음」으로 그린다 — 빈 칸을 지어내 채우지 않는다.
    return {"ok": True, "summary": summary}


# ─────────────────────────────────────────────────────────────────────────────
# ③ 1차 거르기 — 첨부 다운로드·판독 전에 회사에 맞을 만한 것부터 고른다
# ─────────────────────────────────────────────────────────────────────────────
PROMPT_RELEVANCE = """다음은 한 중소기업의 회사 정보와, 기업마당에 올라온 지원사업 공고 목록(제목 + 요약)이다.
이 회사가 신청을 검토해볼 만한 공고의 번호만 골라라 — 목록을 통째로 다시 훑지 않고
한 번에 골라내는 것이 목적이니, 명백히 업종이 안 맞는 공고(예: 제조 기업에 요식업·관광·
농축산 현장지원 같은 공고)만 걸러내면 된다.

규칙
- 업종이 정확히 안 맞아도 업종 무관 지원사업(경영안정자금, 수출지원, 인증·특허 지원,
  고용·인건비 지원, 전시회 참가 지원 등)은 포함해도 된다.
- 애매하면 포함해라 — 여기서 빼면 사람이 다시 볼 기회가 없다. 여기서 넣으면 다음 단계에서
  공고문을 더 읽고 사람이 다시 거른다.
- 목록에 없는 번호를 만들어내지 마라.

JSON 배열로만 답하라. 각 항목: {"번호": 정수, "이유": 짧은 한 문장}

위 지시대로 JSON 배열만 출력하라. 설명 금지.
"""


def select_relevant(company_text: str, candidates: list[dict]) -> dict[str, Any]:
    """번호(1-base)와 이유만 돌려준다. 목록을 실제로 거르는 건 부른 쪽이 한다.

    **실패하면 빈 목록이 아니라 ok:False 를 낸다.** 부른 쪽이 「최신순 상위 N건」으로
    대신 판단하게 하려는 것이다 — 조용히 전체를 걸러버리면 사람이 볼 기회가 사라진다.
    """
    if not candidates:
        return {"ok": True, "picked": []}

    lines = "\n".join(
        f"{i + 1}. {c.get('사업명', '')} — {str(c.get('요약') or '')[:60]}"
        for i, c in enumerate(candidates)
    )
    prompt = (PROMPT_RELEVANCE
              + f"\n=== 회사 정보 ===\n{company_text}\n\n=== 공고 목록 ===\n{lines}\n")

    # 300건 분량은 20건 실측(30~60초)보다 훨씬 오래 걸린다. 넉넉히 준다.
    text = extract._claude(prompt, allow_read=False, timeout=600)
    picked = _json_any(text)
    if not isinstance(picked, list):
        return {"ok": False, "picked": None, "error": "JSON 배열이 아니다", "text": text[:300]}

    n = len(candidates)
    out = []
    for p in picked:
        if not isinstance(p, dict):
            continue
        try:
            번호 = int(extract.pick(p, "번호", "no", "index", default=0))
        except (TypeError, ValueError):
            continue
        # 목록에 없는 번호를 만들어 내면 버린다. 지어낸 번호로 엉뚱한 공고를 고르지 않는다.
        if 1 <= 번호 <= n:
            out.append({"번호": 번호, "이유": str(p.get("이유") or "")})
    return {"ok": True, "picked": out}


# ─────────────────────────────────────────────────────────────────────────────
# ④ 자격판정 점수 — 공고 본문을 회사 정보와 대조해 0~100점을 매긴다(mgnt3, 2026-09-03).
#    ①~③과 같은 골격(_claude 호출 → _json_any 파싱 → ok/error)을 그대로 따른다.
# ─────────────────────────────────────────────────────────────────────────────
SCORE_MAX_CHARS = 30_000  # PROMPT_SUMMARY 와 같은 한도 — 본문이 길면 앞부분만 본다.

PROMPT_SCORE = """다음은 한 중소기업의 회사 정보와 정부지원사업/R&D 과제 공고문 본문이다.
이 회사가 이 공고에 신청할 수 있는지 판단하고 0~100점으로 점수를 매겨라.

규칙
- 공고문에 실제로 적힌 자격요건·지원대상 기준으로만 판단한다. 없는 조건을 지어내지 마라.
- 회사 정보에 없는 값이 필요한 조건은 "확인필요항목"에 따로 적고, 그 조건 때문에
  점수를 깎지 마라(모르는 것을 불리하게 보지 않는다) — 다만 확신도는 낮춰라.
- 필수 자격요건에 명백히 어긋나면(업종 제한·매출/인력 기준 초과 등) 점수를 20점 이하로,
  판정은 "불가"로 한다.
- 점수가 60 이상이면서 확신도가 낮으면 안 된다 — 애매하면 확신도를 낮추고 판정은
  "확인필요"로 한다.

JSON 객체 하나로만 답하라:
{"점수": 0~100 정수, "판정": "가능"|"불가"|"확인필요",
 "근거": [공고문·회사정보에 근거한 짧은 문장, 3~5개],
 "확인필요항목": [문자열] (없으면 빈 배열),
 "확신도": 0~1 사이 숫자}

위 지시대로 JSON 객체 하나만 출력하라. 설명 금지.
"""


def score_eligibility(company_text: str, 본문: str) -> dict[str, Any]:
    """회사 정보 대조 자격판정 — LLM이 점수를 매긴다(규칙표로 대체하지 않는다, CLAUDE.md
    9/3 결정). 확신도 0.70 미만은 부른 쪽(scripts/score-eligibility.mjs)이 "확인필요"로
    강제한다 — 여기서는 모델이 준 값을 그대로 돌려주고 단정하지 않는다.
    """
    body = (본문 or "")[:SCORE_MAX_CHARS]
    if not body.strip():
        return {"ok": False, "result": None, "error": "본문이 비어 있다"}
    if not (company_text or "").strip():
        return {"ok": False, "result": None, "error": "회사 정보가 비어 있다"}

    prompt = (PROMPT_SCORE
              + f"\n=== 회사 정보 ===\n{company_text}\n\n=== 공고문 ===\n{body}\n")
    text = extract._claude(prompt, allow_read=False, timeout=600)
    result = _json_any(text)
    if not isinstance(result, dict):
        return {"ok": False, "result": None, "error": "JSON 객체가 아니다", "text": text[:300]}
    return {"ok": True, "result": result}


# ─────────────────────────────────────────────────────────────────────────────
# ⑤ 보유 서류 판독 — 서류함·회사 프로필이 쓴다 (김정수, 2026-09-03)
#
#    ①~④는 **공고문**을 읽는다. 이 둘은 **우리가 가진 서류**를 읽는다 —
#    사업자등록증·납세증명서·표준재무제표증명 같은 것이다. 목적이 달라 프롬프트가 다르다:
#    공고문 판독은 「무엇을 요구하는가」를 찾고, 이건 「거기 적힌 값」을 그대로 옮긴다.
#
#    ⚠ 원래 lib/doc-ai.mjs 가 node 에서 claude 를 직접 불렀다. 게이트웨이 규칙
#      (2026-09-03 결정 — node 에 claude 직접 호출을 한 줄도 두지 않는다)에 어긋나서
#      **프롬프트 문구를 그대로** 여기로 옮겼다. 옮기는 것과 고치는 것을 같이 하지 않았다.
#
#    파일을 읽혀야 하므로 allow_read=True 다. 빼면 파일을 못 읽고 빈 응답이
#    is_error:false 로 돌아온다 — 성공처럼 보이는 실패다.
# ─────────────────────────────────────────────────────────────────────────────
PROMPT_DOC_READ = """파일 {path} 를 Read 로 읽고, 아래 값을 뽑아라.

이것은 한 기업이 정부지원사업에 제출하려고 보관 중인 증빙 서류다.

규칙
- 서류에 **실제로 적혀 있는 것만** 뽑는다. 없으면 null 로 둔다. 절대 지어내지 마라.
- 발급일은 서류가 발급된 날이다. 유효기간 만료일이나 신청일이 아니다.
  「발급일」·「발행일」·「증명일」·「작성일」로 적힌 날짜를 찾아라.
- 결산연도는 재무제표류에만 있다. 없으면 null.
- 확신도는 **네가 그 값을 서류에서 실제로 봤는지**에 대한 것이다.
  흐릿하거나 여러 날짜 중 어느 것인지 애매하면 0.6 이하로 낮춰라. 추측이면 0.3 이하다.
- 근거문장은 서류에서 **그대로 인용**한다. 요약하거나 다시 쓰지 마라.
- 개인 실명·주민등록번호·연락처는 뽑지 마라. 필요 없는 값이다.

서류 종류 후보: {candidates}

JSON 객체 하나로만 답하라. 설명 금지.
{{"서류종류": 위 후보 중 하나 또는 null,
 "발급일": "YYYY-MM-DD" 또는 null,
 "발급기관": 문자열 또는 null,
 "결산연도": 정수 또는 null,
 "근거문장": 서류에서 그대로 인용한 한 문장 또는 null,
 "확신도": 0~1 숫자}}
"""


def _read(prompt: str, 이름: str) -> dict[str, Any]:
    """파일을 읽히는 판독의 공통 껍데기.

    ⚠ **터지게 두지 않는다.** `_json_any` 는 빈 문자열을 만나면 JSONDecodeError 를 던지고,
      게이트웨이는 그걸 그대로 500 으로 내보낸다 — 화면에는
      「JSONDecodeError: Expecting value: line 1 column 1 (char 0)」만 남는다.
      그 메시지로는 원인을 못 찾는다(실측으로 여기서 시간을 버렸다).
      그래서 예외를 잡아 **모델이 실제로 뭘 돌려줬는지**를 error 에 실어 보낸다.
    """
    try:
        text = extract._claude(prompt, allow_read=True, timeout=300)
    except Exception as e:
        log.error("%s: 헤드리스 실패: %s", 이름, e)
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "result": None}

    if not (text or "").strip():
        return {"ok": False, "error": "모델이 빈 응답을 돌려줬다", "result": None}

    try:
        d = _json_any(text)
    except Exception as e:
        log.error("%s: JSON 파싱 실패: %s / 원문: %r", 이름, e, text[:300])
        return {"ok": False,
                "error": f"JSON 파싱 실패({type(e).__name__}) · 모델 응답: {text[:200]!r}",
                "result": None}

    if not isinstance(d, dict):
        return {"ok": False, "error": f"객체가 아니라 {type(d).__name__} 이 왔다: {text[:200]!r}",
                "result": None}
    return {"ok": True, "result": d}


def read_document(path: str, candidates: list[str] | None = None) -> dict[str, Any]:
    """보유 서류 한 장에서 발급일·발급기관을 읽는다. 서류함 업로드가 부른다.

    후보 목록을 같이 넘겨 서류 종류도 맞춰 본다 — 사용자가 종류를 잘못 고른 채 올릴 수 있다.
    """
    if not path:
        return {"ok": False, "error": "path 가 비었다", "result": None}
    쓸것 = " · ".join(candidates) if candidates else "(제한 없음)"
    prompt = PROMPT_DOC_READ.format(path=path, candidates=쓸것)
    return _read(prompt, "read_document")


PROMPT_COMPANY_READ = """파일 {path} 를 Read 로 읽고, 회사 정보를 뽑아라.

사업자등록증 · 표준재무제표증명 · 기업부설연구소 인정서 · 중소기업확인서 같은
회사 서류다. 어떤 서류인지는 내용을 보고 판단해라.

규칙
- 서류에 **실제로 적혀 있는 값만** 뽑는다. 없으면 null. **절대 지어내지 마라.**
  이 값들로 정부지원사업 신청 자격을 판정한다 — 지어낸 숫자는 틀린 판정을 낳는다.
- 금액은 **원 단위 정수**로 바꿔라. "74억"이면 7400000000 이다. 단위를 착각하지 마라.
- 비율(매출증가율·부채비율·R&D집약도)은 퍼센트 숫자만. "182.3%" → 182.3
- 대표자 이름 외의 개인 실명·주민등록번호·연락처는 뽑지 마라.
- 업종코드(KSIC)는 사업자등록증에 적힌 코드가 있을 때만. 업태·종목 문구에서 추측하지 마라.
- 확신도는 값을 실제로 봤는지에 대한 것이다. 추측이면 0.3 이하로 낮춰라.

JSON 객체 하나로만 답하라. 설명 금지. 못 찾은 항목은 넣지 말고 빼라.
{{"회사명": 문자열, "사업자등록번호": "000-00-00000", "대표자": 문자열,
 "소재지": 문자열, "설립일": "YYYY-MM-DD", "업종명": [문자열],
 "주요제품": 문자열, "ksic_코드": [문자열], "기업규모": "중소기업"|"중견기업"|"소상공인",
 "결산연도": 정수, "매출액": 정수(원), "매출증가율": 숫자(%), "부채비율": 숫자(%),
 "rnd_집약도": 숫자(%), "종업원수": 정수,
 "기업부설연구소": true|false, "자본전액잠식": true|false,
 "근거": {{"항목명": "서류에서 그대로 인용한 문장"}},
 "확신도": 0~1 숫자}}
"""


def read_company_document(path: str) -> dict[str, Any]:
    """회사 서류 한 장에서 company_profile 항목을 읽는다. 회사 프로필 화면이 부른다.

    ⚠ 결과를 DB 에 바로 쓰지 않는다 — 부르는 쪽(app/actions/company-parse.ts)이 폼에만
      채우고 사람이 확정한다. 항목이 열 개가 넘어 하나만 틀려도 자격 판정이 뒤집힌다.
    """
    if not path:
        return {"ok": False, "error": "path 가 비었다", "result": None}
    return _read(PROMPT_COMPANY_READ.format(path=path), "read_company_document")
