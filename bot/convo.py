# -*- coding: utf-8 -*-
"""증빙 스레드에서 **대화로** 확정한다.

버튼만으로는 판독이 부실한 건이 막다른 길이 된다 — 거래처를 못 읽으면 확정도 못 하고
고칠 방법도 모달뿐이다. 스레드에서 물어보고 댓글로 답을 받으면, 사람이 아는 것을
그 자리에서 채워 넣을 수 있다.

흐름
    판독 → 부족한 것을 **하나씩** 물어본다 → 사람이 댓글로 답한다 → 반영
    → 다 채워지면 **요약을 보여주고 최종 확인**을 받는다 → 그때 원장에 확정된다

설계
  · **상태를 저장하지 않는다.** 「지금 무엇을 묻는 중인가」는 집행 건의 현재 값으로 매번
    다시 계산한다. 봇이 재시작해도 대화가 이어진다.
  · 한 번에 **하나만** 묻는다. 여러 개를 한꺼번에 물으면 답이 섞여 들어온다.
  · 답변은 「키: 값」과 자연스러운 한 줄 답 **둘 다** 받는다. 사람에게 형식을 강요하지 않는다.
  · 값 검증에 실패하면 **되묻는다.** 잘못된 값을 조용히 넣지 않는다.
"""
from __future__ import annotations

import re

# ─────────────────────────────────────────────────────────────── 답변 해석
_CONFIRM = re.compile(r"^(확정|확인|ok|okay|네|예|응|맞아요?|맞습니다|맞음|그대로|좋아요?)[.!]*$", re.I)
_CANCEL = re.compile(r"^(버려|버리기|취소|삭제|폐기|아니야|아님)[.!]*$", re.I)
# 「이 건 어떻게 처리됐지?」를 묻는 자리에서 바로 답한다.
_HISTORY = re.compile(r"^(이력|히스토리|기록|로그|history|log)[?？.!]*$", re.I)
_KEYMAP = {
    "거래처": "거래처", "상호": "거래처", "업체": "거래처", "업체명": "거래처",
    "공급자": "거래처", "가맹점": "거래처",
    "금액": "합계", "합계": "합계", "총액": "합계", "결제금액": "합계", "합계금액": "합계",
    "공급가액": "공급가액", "세액": "세액", "부가세": "세액",
    "일자": "일자", "날짜": "일자", "거래일": "일자", "작성일": "일자", "거래일자": "일자",
    "비목": "비목", "계정": "비목",
    "사업": "과제", "지원사업": "과제", "과제": "과제",
    "사업자번호": "사업자번호", "등록번호": "사업자번호",
    # 메모는 값이 아니라 이력이다 — 집행 건을 바꾸지 않고 이력에만 남는다.
    "메모": "메모", "코멘트": "메모", "비고": "메모", "note": "메모", "memo": "메모",
}
# 값이 비어도(「메모:」) 그 키로 받는다 — 비었다는 것까지 알아야 되물을 수 있다.
_KEYLINE = re.compile(r"^\s*([가-힣A-Za-z]{2,6})\s*[:：=]\s*(.*)$")


def parse_reply(text: str, 묻는중: str | None) -> tuple[str, str | None]:
    """댓글 한 줄을 (동작 또는 필드, 값)으로. 형식을 강요하지 않는다.

    「금액: 880000」 같은 명시적 형식이 있으면 그걸 쓰고, 없으면 **지금 묻고 있던 것**에
    대한 답으로 본다. 「확정」·「버려」는 명령이다.
    """
    t = (text or "").strip()
    if not t:
        return ("무시", None)
    if _CONFIRM.match(t):
        return ("확정", None)
    if _CANCEL.match(t):
        return ("버리기", None)
    if _HISTORY.match(t):
        return ("이력", None)
    m = _KEYLINE.match(t)
    if m and m.group(1) in _KEYMAP:
        return (_KEYMAP[m.group(1)], m.group(2).strip())
    if 묻는중:
        return (묻는중, t)
    return ("모름", t)


# ─────────────────────────────────────────────────────────────── 값 검증
_MONEY = re.compile(r"[\d,]{2,}")
_DATE_PATS = [
    (re.compile(r"(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})"), None),
    (re.compile(r"(?<!\d)(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)"), 2000),
]


def _to_money(v: str):
    m = _MONEY.search(v or "")
    if not m:
        return None
    n = int(re.sub(r"\D", "", m.group()) or 0)
    return n if 10 <= n <= 10_000_000_000 else None


def _to_date(v: str):
    for pat, base in _DATE_PATS:
        m = pat.search(v or "")
        if not m:
            continue
        y, mo, d = m.groups()
        y = int(y) + (base or 0)
        mo, d = int(mo), int(d)
        if 2000 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31:
            return f"{y:04d}-{mo:02d}-{d:02d}"
    return None


def _to_brn(v: str):
    d = re.sub(r"\D", "", v or "")
    return d if len(d) == 10 else None


def apply_answer(field: str, value: str, *, labels: dict, projects: list) -> tuple[dict, str] | str:
    """답변을 집행 건 patch 로 바꾼다. 실패하면 **되물을 문구**(str)를 돌려준다.

    잘못된 값을 조용히 넣지 않는다 — 원장에 들어가면 정산에서 반려된다.
    """
    v = (value or "").strip()
    if field == "거래처":
        if len(re.sub(r"\s", "", v)) < 2:
            return "상호가 너무 짧습니다. 두 글자 이상으로 적어 주세요."
        return {"거래처": v[:150]}, f"거래처를 *{v[:150]}* 로 적었습니다."
    if field == "합계":
        n = _to_money(v)
        if not n:
            return "금액을 숫자로 적어 주세요. 예: `880000` 또는 `880,000원`"
        return {"합계": n}, f"금액을 *{n:,}원* 으로 적었습니다."
    if field in ("공급가액", "세액"):
        n = _to_money(v)
        if not n:
            return f"{field}을 숫자로 적어 주세요."
        return {field: n}, f"{field}을 *{n:,}원* 으로 적었습니다."
    if field == "일자":
        d = _to_date(v)
        if not d:
            return "일자를 `2024-05-14` 처럼 적어 주세요."
        return {"일자": d}, f"일자를 *{d}* 로 적었습니다."
    if field == "사업자번호":
        b = _to_brn(v)
        if not b:
            return "사업자번호를 10자리로 적어 주세요. 예: `536-88-00754`"
        return {"거래처_사업자번호": b}, f"사업자번호를 *{b[:3]}-{b[3:5]}-{b[5:]}* 로 적었습니다."
    if field == "비목":
        code = _match_bimok(v, labels)
        if not code:
            보기 = " · ".join(list(labels["sub"].values())[:8])
            return f"어느 비목인지 못 찾았습니다. 예: {보기} …\n`비목 고르고 확정` 버튼으로 골라도 됩니다."
        cat = labels["sub_cat"].get(code)
        return ({"비목_대분류": cat, "비목_세부항목": code},
                f"비목을 *{labels['cat'].get(cat, cat)} › {labels['sub'].get(code, code)}* 로 적었습니다.")
    if field == "과제":
        pid, name = _match_project(v, projects)
        if not pid:
            return "어느 지원사업인지 못 찾았습니다. 사업명 일부를 적거나 위 드롭다운에서 골라 주세요."
        return {"과제_id": pid}, f"지원사업을 *{name}* 로 적었습니다."
    return "무엇을 고치려는지 모르겠습니다. `금액: 880000` 처럼 적어 주세요."


def _norm(s):
    return re.sub(r"[\s·,./|_\-()]", "", str(s or "")).lower()


def _match_bimok(v: str, labels: dict) -> str | None:
    """세부항목 이름으로 코드를 찾는다. 부분 일치 하나만 나올 때 인정한다."""
    n = _norm(v)
    if not n:
        return None
    hits = [c for c, nm in labels["sub"].items() if n in _norm(nm) or _norm(nm) in n]
    if len(hits) == 1:
        return hits[0]
    exact = [c for c, nm in labels["sub"].items() if _norm(nm) == n]
    return exact[0] if len(exact) == 1 else None


def _match_project(v: str, projects: list) -> tuple[int | None, str | None]:
    n = _norm(v)
    if not n:
        return None, None
    hits = [p for p in projects if n in _norm(p.get("사업명")) or _norm(p.get("사업명")) in n]
    if len(hits) == 1:
        return hits[0]["id"], hits[0]["사업명"]
    return None, None


# ─────────────────────────────────────────────────────────────── 무엇을 물을까
def next_question(e: dict) -> tuple[str, str] | None:
    """부족한 것 중 **하나**를 골라 묻는다. 없으면 None(= 최종 확인 차례).

    순서는 「사람만 아는 것 → 화면에서 고를 수 있는 것」이다. 거래처·일자·금액은 원본을
    본 사람만 알고, 비목·지원사업은 버튼으로도 정할 수 있다.
    """
    if not (e.get("거래처") or "").strip():
        brn = (e.get("거래처_사업자번호") or "").strip()
        번호 = (f"사업자번호 *{brn[:3]}-{brn[3:5]}-{brn[5:]}* 는 읽었습니다. "
              if len(brn) == 10 else "사업자번호도 못 읽었습니다. ")
        return ("거래처",
                f"❓ *거래처 상호*를 못 읽었습니다. {번호}\n"
                f"이 스레드에 상호를 적어 주세요 — 한 번만 적으면 다음부터 자동으로 채웁니다.")
    if not e.get("일자"):
        return ("일자", "❓ *거래일자*를 못 읽었습니다. `2024-05-14` 처럼 적어 주세요.")
    if not e.get("합계"):
        return ("합계", "❓ *금액*을 못 읽었습니다. `880000` 처럼 적어 주세요.")
    if not e.get("비목_대분류"):
        return ("비목", "❓ *비목*을 판단하지 못했습니다. 비목 이름을 적거나 아래 버튼으로 골라 주세요.")
    if e.get("과제_id") is None:
        return ("과제", "❓ 어느 *지원사업*에 붙일지 정해 주세요. 사업명을 적거나 위에서 골라 주세요.")
    return None


def summary(e: dict, *, labels: dict, project_name: str, 금액경고: bool = False) -> str:
    """최종 확인 카드. **이걸 보고 사람이 확정한다.**"""
    brn = (e.get("거래처_사업자번호") or "").strip()
    brn_v = f"  ({brn[:3]}-{brn[3:5]}-{brn[5:]})" if len(brn) == 10 else ""
    금액 = f"{int(e['합계']):,}원" if e.get("합계") else "미상"
    cat = labels["cat"].get(e.get("비목_대분류"), e.get("비목_대분류") or "미분류")
    sub = labels["sub"].get(e.get("비목_세부항목"))
    비목 = f"{cat} › {sub}" if sub else cat
    경고 = ("\n⚠ 금액이 산술로 검산되지 않았습니다 — 원본과 대조해 주세요."
           if 금액경고 else "")
    return (
        "*확정 전 마지막 확인입니다.*\n"
        f"• 거래처  {e.get('거래처')}{brn_v}\n"
        f"• 일자    {e.get('일자')}\n"
        f"• 금액    {금액}\n"
        f"• 비목    {비목}\n"
        f"• 지원사업 {project_name}" + 경고 + "\n\n"
        "맞으면 `확정` 이라고 답해 주세요. 고칠 게 있으면 `금액: 880000` 처럼 적어 주세요.\n"
        "남길 말이 있으면 `메모: …` — 선택이지만 나중에 큰 도움이 됩니다.\n"
        "이 건을 없던 일로 하려면 `버려` 라고 답해 주세요."
    )
