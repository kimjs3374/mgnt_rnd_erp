"""공고 자격요건의 공용 어휘 — 추출과 판정이 같은 말을 쓰게 한다.

⚠ **여기 없는 항목명을 추출이 내면 에러 없이 조용히 쓸모없어진다.**
   `mcp_server.eligibility_check` 의 MAP 에서 떨어져 전부 「확인 필요」가 되고,
   판정 전체가 「확인 필요」로 내려앉는다. 추출은 성공한 것처럼 보인다.
   → MAP·SCALE 을 고치면 여기도 고친다. `tools_check.py` 가 둘을 대조한다.
"""

from __future__ import annotations

# 항목 → 모델에게 줄 설명. 이 목록 안에서만 고르게 한다.
# 키는 eligibility_check MAP 의 키(공백 제거형)와 같아야 한다.
REQUIREMENT_ITEMS: dict[str, str] = {
    "매출액": "직전연도 매출액",
    "매출증가율": "매출 증가율",
    "부채비율": "부채비율",
    "자본전액잠식": "자본 전액 잠식 — 해당하면 결격",
    "R&D집약도": "매출 대비 연구개발비 비중",
    "기업부설연구소": "기업부설연구소 보유 여부",
    "종업원수": "상시 종업원 수",
}

# eligibility_check 의 SCALE 이 아는 단위만. 그 밖은 **비교 자체를 안 한다.**
# 실측에서 74억을 「90억 이상 충족」으로 판정한 적이 있다 — 원/억원을 안 맞춰서.
REQUIREMENT_UNITS: tuple[str, ...] = ("원", "만원", "백만원", "천만원", "억원", "%", "명", "none")

# judge() 가 아는 연산자. 그 밖은 「알 수 없는 연산자」로 떨어진다.
REQUIREMENT_OPS: tuple[str, ...] = ("gte", "lte", "gt", "lt", "eq", "has")

# 참/거짓 항목 — 기준값·단위를 숫자로 받지 않는다.
BOOLEAN_ITEMS: frozenset[str] = frozenset({"자본전액잠식", "기업부설연구소"})
