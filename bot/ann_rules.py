"""규칙 판정의 DB 껍데기 — 읽고, 판정하고, 쓴다.

판단은 ann_score.judge() 가 갖는다(순수 함수). 이 파일은 그걸 DB 에 잇기만 한다.
gongo.py 프롬프트가 두 벌이 됐던 사고와 같은 이유로 **판단 로직을 여기 두지 않는다.**

  bot/ann_features.py  공고문 → 특징 (정규식·구역·사전)
  bot/ann_score.py     특징 + 회사 → 판정   ← 판단은 전부 여기
  bot/ann_rules.py     DB 읽기/쓰기, 배치      ← 이 파일

쓰는 법
  python3 bot/ann_rules.py 판정 <공고id>        한 건 판정(저장 안 함)
  python3 bot/ann_rules.py 배치 [최대건수]      전체 판정 + 저장
  python3 bot/ann_rules.py 대조                 LLM 판정과 섀도 대조
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ann_features as F
import ann_score
import rest

ANN_COLS = ("id,사업명,출처,출처_id,소관부처,전문기관,지역,지역코드,지원분야,지원대상,"
            "접수시작,접수종료,마감유형,요약,본문,사업유형,공고일")


# ─────────────────────────────────────────────────────────────────────────────
# 읽기
# ─────────────────────────────────────────────────────────────────────────────
def load_company() -> dict[str, Any]:
    """가장 최근 결산연도의 회사 프로필. 없으면 빈 dict.

    ⚠ 빈 dict 를 돌려주는 것을 막지 않는다. 회사 정보가 없으면 게이트 대부분이
      「판단 근거 없음」으로 빠지고 판정은 「요건미확인」이 된다 — 그게 정직한 결과다.
      여기서 기본값을 만들어 채우면 그 순간 지어낸 판정이 된다.
    """
    rows = rest.select("company_profile", "select=*&order=결산연도.desc&limit=1")
    return rows[0] if rows else {}


def load_weights() -> list[dict]:
    return rest.select("scoring_weights", "select=*")


def load_lexicon() -> list[dict]:
    return rest.select("extraction_lexicon", "select=*&사용중=is.true")


def load_answers(announcement_id: int | None = None) -> list[dict]:
    """사람 답변. 일반화=true 는 공고와 무관하게 전부 가져온다."""
    q = "select=*&order=created_at.desc"
    rows = rest.select("ann_feature_answers", q)
    return [r for r in rows
            if r.get("일반화") or (announcement_id and r.get("announcement_id") == announcement_id)]


def apply_answers(company: dict, answers: list[dict]) -> tuple[dict, list[str]]:
    """일반화된 사람 답변을 회사 정보에 얹는다. **DB 는 고치지 않는다.**

    이게 「물어보고 수용해서 다시 안 묻는다」의 실제 경로다. 회사 프로필에 값이
    비어 있어 확인필요로 올라간 항목이, 사람이 한 번 답하면 다음 판정에서 사라진다.

    ⚠ company_profile 을 직접 갱신하지 않는다 — 답변은 출처가 사람이고 서류 증빙이
      아니다. 두 출처를 한 컬럼에 섞으면 나중에 무엇이 증빙된 값인지 알 수 없다.
    """
    쓴것: list[str] = []
    c = dict(company)
    # `_` 로 시작하는 칸은 company_profile 에 없는 항목이다(ann_score.DB에없는사실 참조).
    # 회사 상태이지만 서류로만 확인되는 것들 — 사람 답변이 유일한 출처다.
    매핑 = {
        "부채비율_상한":       ("부채비율", "수치"),
        "매출액_기준":         ("매출액", "수치"),
        "종업원수_기준":       ("종업원수", "수치"),
        "업력_제한":           ("설립일", "문자"),
        "자본전액잠식_제외":   ("자본전액잠식", "불리언"),
        "기업부설연구소_필수": ("기업부설연구소", "불리언"),
        "체납_제외":           ("_체납없음", "불리언"),
        "참여제한_제외":       ("_참여제한없음", "불리언"),
    }
    for a in answers:
        if not a.get("일반화"):
            continue
        칸 = 매핑.get(a.get("특징키") or "")
        if not 칸:
            continue
        컬럼, 형 = 칸
        if c.get(컬럼) is not None:
            continue                      # 증빙에서 온 값이 이미 있으면 답변으로 덮지 않는다
        값 = (a.get("사람_값") or "").strip()
        if not 값 or 값 == "모름":
            continue
        try:
            if 형 == "수치":
                c[컬럼] = float(값.replace(",", "").replace("원", ""))
            elif 형 == "불리언":
                c[컬럼] = 값 in ("예", "true", "True", "y", "Y", "보유", "해당")
            else:
                c[컬럼] = 값
        except ValueError:
            continue
        쓴것.append(f"{컬럼}={c[컬럼]} (사람 답변 #{a.get('id')})")
    return c, 쓴것


# ─────────────────────────────────────────────────────────────────────────────
# 판정
# ─────────────────────────────────────────────────────────────────────────────
def judge_one(ann: dict, company: dict, weights: list[dict],
              lexicon: list[dict], answers: list[dict] | None = None) -> dict:
    c, 얹은것 = apply_answers(company, answers or [])
    t0 = time.monotonic()
    r = ann_score.judge(ann, c, weights=weights, lexicon=lexicon)
    if r.get("ok"):
        r["ms"] = int((time.monotonic() - t0) * 1000)
        if 얹은것:
            r["판정경로"] = "규칙+사람"
            r["근거"] = list(r["근거"]) + [f"사람 답변 적용: {', '.join(얹은것)}"]
        r["질문"] = ann_score.questions(r, ann)
    return r


def save_one(ann_id: int, r: dict) -> None:
    """특징과 판정을 저장한다. 같은 엔진버전은 덮어쓴다(재실행이 안전해야 한다)."""
    rest.delete("ann_features", {"announcement_id": ann_id, "엔진버전": r["엔진버전"]})
    rows = [f.row(ann_id) for f in r["features"]]
    for i in range(0, len(rows), 200):
        if rows[i:i + 200]:
            rest.insert("ann_features", rows[i:i + 200])

    rest.delete("ann_rule_scores", {"announcement_id": ann_id, "엔진버전": r["엔진버전"]})
    rest.insert("ann_rule_scores", {
        "announcement_id": ann_id,
        "엔진버전": r["엔진버전"],
        "점수": r["점수"],
        "판정": r["판정"],
        "확신도": r["확신도"],
        "커버리지": r["커버리지"],
        "판정경로": r.get("판정경로", "규칙"),
        "게이트_결과": r["게이트_결과"],
        "특징_기여": r["특징_기여"],
        "확인필요항목": r["확인필요항목"],
        "근거": r["근거"],
        "llm_호출": 0,
        "ms": r.get("ms"),
    })


def score_announcement(ann_id: int, save: bool = True) -> dict:
    """게이트웨이·MCP 가 부르는 진입점. LLM 호출 0회."""
    rows = rest.select("announcements", f"select={ANN_COLS}&id=eq.{ann_id}")
    if not rows:
        raise LookupError(f"공고 {ann_id} 이 없다")
    ann = rows[0]
    r = judge_one(ann, load_company(), load_weights(), load_lexicon(), load_answers(ann_id))
    if r.get("ok") and save:
        save_one(ann_id, r)
    return _serializable(r, ann)


# ─────────────────────────────────────────────────────────────────────────────
# 사람 답변 받기 — 사용자 요청 ②의 「물어보고 수용하고 학습한다」
#
# 두 가지가 동시에 일어난다.
#   ① 답 자체가 쌓인다(ann_feature_answers). 일반화=true 면 회사 상수가 되어
#      다음 공고에서 같은 질문이 사라진다.
#   ② 사람이 「이 문구가 그 요건이다」를 짚어주면 **추출 규칙이 자란다**
#      (extraction_lexicon). 다음 판독은 정규식이 못 뽑은 것을 여기서 뽑는다.
#      이게 LLM 없이 판단하는 쪽으로 가는 실제 경로다 — 규칙을 사람이 코드로
#      고치는 게 아니라, 화면에서 짚으면 데이터로 들어온다.
#
# ⚠ 답을 받았다고 company_profile 을 고치지 않는다. 답변의 출처는 사람이고 서류
#   증빙이 아니다. 두 출처를 한 컬럼에 섞으면 나중에 무엇이 증빙된 값인지 알 수 없다.
# ─────────────────────────────────────────────────────────────────────────────
def record_answer(announcement_id: int | None, 특징키: str, 사람_값: str, 답변자: str,
                  질문: str = "", 근거문장: str | None = None, ai_추출값: str | None = None,
                  일반화: bool = False, 사유: str | None = None,
                  짚은문구: str | None = None, 종류: str = "정보",
                  구역: str | None = None) -> dict:
    """답을 저장하고, 짚어준 문구가 있으면 렉시콘에 넣고, 그 공고를 다시 판정한다.

    다시 판정까지 하는 이유: 「답했는데 화면이 그대로」면 사람이 두 번 답한다.
    답의 효과가 같은 화면에서 바로 보여야 답이 쌓인다.
    """
    if not (사람_값 or "").strip():
        raise ValueError("사람_값 이 비었다")
    if not (답변자 or "").strip():
        raise ValueError("답변자 가 비었다 — 누가 확정했는지 없으면 이력이 아니다")

    ans = rest.insert("ann_feature_answers", {
        "announcement_id": announcement_id,
        "특징키": 특징키,
        "질문": 질문 or f"「{특징키}」 요건",
        "근거문장": 근거문장,
        "ai_추출값": ai_추출값,
        "사람_값": 사람_값.strip(),
        "사유": 사유,
        "일반화": bool(일반화),
        "답변자": 답변자.strip(),
    })

    렉시콘 = None
    if (짚은문구 or "").strip():
        # 사람이 짚어준 문구를 그대로 패턴으로 쓴다. 공백은 지운다 —
        # 매칭이 공백 지운 사본에 대고 이뤄지기 때문이다(ann_features.strip_ws).
        패턴 = F.strip_ws(짚은문구)
        if len(패턴) < 4:
            raise ValueError(f"짚은 문구가 너무 짧다({패턴!r}) — 아무 공고에나 걸린다")
        렉시콘 = rest.insert("extraction_lexicon", {
            "패턴": 패턴,
            "패턴유형": "부분문자열",
            "특징키": 특징키,
            "종류": 종류,
            "값_텍스트": 사람_값.strip(),
            "구역": 구역,
            "신뢰도": 0.900,      # 사람이 짚어준 것이라 정규식(0.70~0.95)보다 낮지 않게 둔다
            "출처_answer_id": ans.get("id"),
            "만든이": 답변자.strip(),
        })

    다시 = score_announcement(int(announcement_id), save=True) if announcement_id else None
    return {"ok": True, "answer": ans, "lexicon": 렉시콘, "판정": 다시}


def _serializable(r: dict, ann: dict) -> dict:
    """Feature 객체를 JSON 으로 바꾼다. 근거·규칙id 를 화면이 그대로 쓴다."""
    out = dict(r)
    out["사업명"] = ann.get("사업명")
    out["features"] = [
        {k: v for k, v in f.row(ann.get("id") or 0).items() if k != "announcement_id"}
        for f in r.get("features", [])
    ]
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 배치 — 836건을 한 번에. LLM 호출 0회라 몇 초에 끝난다
# ─────────────────────────────────────────────────────────────────────────────
def batch(limit: int | None = None, save: bool = True) -> dict:
    company = load_company()
    weights = load_weights()
    lexicon = load_lexicon()
    answers = [a for a in load_answers() if a.get("일반화")]

    if not company:
        print("⚠ company_profile 이 비어 있다. 판정은 대부분 「요건미확인」이 된다.")
    if not weights:
        raise RuntimeError("scoring_weights 가 비어 있다. db/102_ann_rule_engine.sql 을 적용할 것")

    anns: list[dict] = []
    page = 0
    while True:
        chunk = rest.select("announcements",
                            f"select={ANN_COLS}&order=id&limit=200&offset={page * 200}")
        anns += chunk
        if len(chunk) < 200 or (limit and len(anns) >= limit):
            break
        page += 1
    if limit:
        anns = anns[:limit]

    통계: dict[str, int] = {}
    실패: list[str] = []
    t0 = time.monotonic()
    for i, ann in enumerate(anns, 1):
        try:
            r = judge_one(ann, company, weights, lexicon, answers)
            if not r.get("ok"):
                실패.append(f"[{ann['id']}] {r.get('error')}")
                continue
            if save:
                save_one(int(ann["id"]), r)
            통계[r["판정"]] = 통계.get(r["판정"], 0) + 1
        except Exception as e:                       # 한 건 실패로 배치를 멈추지 않는다
            실패.append(f"[{ann['id']}] {type(e).__name__}: {e}")
        if i % 100 == 0:
            print(f"  {i}/{len(anns)} …")

    초 = round(time.monotonic() - t0, 1)
    return {"ok": True, "대상": len(anns), "판정": 통계, "실패": 실패[:20],
            "실패수": len(실패), "초": 초, "llm_호출": 0, "엔진버전": F.ENGINE_VERSION}


# ─────────────────────────────────────────────────────────────────────────────
# 섀도 대조 — 「LLM 없이도 된다」는 주장의 유일한 근거
# ─────────────────────────────────────────────────────────────────────────────
def compare() -> dict:
    rows = rest.select("v_ann_rule_vs_llm", f"select=*&엔진버전=eq.{F.ENGINE_VERSION}")
    if not rows:
        return {"ok": False, "error": "대조할 행이 없다. 배치를 먼저 돌리고, LLM 판정이 있어야 한다."}

    일치 = [r for r in rows if r.get("판정일치")]
    표: dict[str, int] = {}
    for r in rows:
        표[f"규칙={r['규칙_판정']} / LLM={r['llm_판정']}"] = 표.get(
            f"규칙={r['규칙_판정']} / LLM={r['llm_판정']}", 0) + 1
    차 = [r["점수차"] for r in rows if r.get("점수차") is not None]

    # 등급 일치 — 실무에서 갈리는 것은 「버릴 것 / 사람이 볼 것 / 낼 것」 세 갈래다.
    # 「확인필요」와 「요건미확인」은 둘 다 「사람이 볼 것」이라 서로 다른 판정이 아니다.
    # 네 갈래 문자열 일치율만 보면 이 둘의 차이가 불일치로 잡혀 숫자가 실제보다 나쁘게 나온다.
    def 등급(판정: str) -> str:
        return {"불가": "버림", "가능": "낼것"}.get(판정, "보류")

    등급일치 = [r for r in rows if 등급(r["규칙_판정"]) == 등급(r["llm_판정"])]

    # 방향도 같이 본다. 규칙이 보수적으로 틀리는 것(LLM 불가 / 규칙 보류)은
    # 반대 방향(LLM 보류 / 규칙 불가)보다 낫다 — 「불가」로 잘못 찍힌 공고는
    # 사람이 다시 볼 기회가 없다(§6 설계 원칙 4번).
    보수적 = [r for r in rows if 등급(r["규칙_판정"]) == "보류" and 등급(r["llm_판정"]) == "버림"]
    공격적 = [r for r in rows if 등급(r["규칙_판정"]) == "버림" and 등급(r["llm_판정"]) != "버림"]

    return {
        "ok": True,
        "엔진버전": F.ENGINE_VERSION,
        "대조건수": len(rows),
        "판정일치": len(일치),
        "일치율": round(len(일치) / len(rows), 3),
        "등급일치": len(등급일치),
        "등급일치율": round(len(등급일치) / len(rows), 3),
        "규칙이_보수적": len(보수적),
        "규칙이_공격적": len(공격적),
        "점수차_평균": round(sum(차) / len(차), 1) if 차 else None,
        "점수차_최대": max(차) if 차 else None,
        "교차표": dict(sorted(표.items(), key=lambda kv: -kv[1])),
    }


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "배치"
    if cmd == "판정":
        if len(sys.argv) < 3:
            print("공고 id 를 줄 것: python3 bot/ann_rules.py 판정 15")
            sys.exit(1)
        r = score_announcement(int(sys.argv[2]), save=False)
        print(json.dumps(r, ensure_ascii=False, indent=2, default=str))
    elif cmd == "배치":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
        print(json.dumps(batch(limit), ensure_ascii=False, indent=2))
    elif cmd == "대조":
        print(json.dumps(compare(), ensure_ascii=False, indent=2))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
