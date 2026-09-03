-- =============================================================================
-- 105_rule_vs_original_llm.sql — 섀도 대조 뷰를 "원본 LLM 판정"만 보게 고친다
--
--   왜: ann_sync_decisions.py 로 규칙엔진 판정 615건을 eligibility_decisions 에
--   반영하면서(102_ 의 v_ann_rule_vs_llm 이 eligibility_decisions 를 통째로 조인하는
--   구조라) 규칙엔진이 자기 자신과 비교되는 문제가 생겼다 — 규칙엔진 행도
--   eligibility_decisions 에 들어가는 순간 그 행 자체가 "llm_판정" 자리에 잡혀
--   항상 일치로 보였다(대조 33건 → 633건으로 부풀고 "일치율"이 의미를 잃었다).
--
--   고침: LATERAL 로 "이 공고에서 ai_제안.판정경로 가 '규칙' 이 아닌 첫 행"만
--   llm_판정 자리에 붙인다. ai_제안.판정경로 는 102_ 의 105_ 이전엔 없던 키라,
--   기존 LLM 행(원본 score-eligibility.mjs 결과)에는 이 키가 없다 —
--   coalesce(...,'LLM') 로 "없으면 LLM 이다"로 본다.
--
--   설계 원칙: 추가만 한다. CREATE OR REPLACE VIEW 라 데이터는 그대로다.
--   적용:     cd /web/rnd && ./db/psql.sh -f db/105_rule_vs_original_llm.sql
--   되돌리기: 파일 맨 아래(102_ 의 원래 정의로 되돌린다)
-- =============================================================================

create or replace view app.v_ann_rule_vs_llm as
select
  r.announcement_id,
  a.사업명,
  a.출처,
  r.엔진버전,
  r.판정                                  as 규칙_판정,
  r.점수                                  as 규칙_점수,
  r.확신도                                as 규칙_확신도,
  r.커버리지,
  e.확정_판정                             as llm_판정,
  (e.ai_제안 ->> '점수')::int             as llm_점수,
  e.ai_확신도                             as llm_확신도,
  (r.판정 = e.확정_판정)                  as 판정일치,
  abs(r.점수 - coalesce((e.ai_제안 ->> '점수')::int, r.점수)) as 점수차,
  e.정정여부                              as 사람정정,
  r.llm_호출
from app.ann_rule_scores r
join app.announcements a on a.id = r.announcement_id
join lateral (
  -- 이 공고에서 규칙엔진이 아닌 첫 판정(원본 LLM 행). 여러 번 판정됐어도 최초 것만 본다 —
  -- score-eligibility.mjs 는 이미 판정된 공고를 다시 안 부르므로 보통 하나뿐이다.
  select d.확정_판정, d.ai_제안, d.ai_확신도, d.정정여부, d.created_at
    from app.eligibility_decisions d
   where d.announcement_id = r.announcement_id
     and coalesce(d.ai_제안 ->> '판정경로', 'LLM') <> '규칙'
   order by d.created_at asc
   limit 1
) e on true;

comment on view app.v_ann_rule_vs_llm is
  '규칙 판정 vs "원본 LLM" 판정 섀도 대조. ai_제안.판정경로가 규칙인 행은 비교 대상에서 뺀다 — '
  '규칙엔진 판정을 eligibility_decisions 에 반영(ann_sync_decisions.py)한 뒤에도 자기 자신과 '
  '비교되지 않게 하려는 것이다. 일치율·점수차의 유일한 근거.';

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기 — 102_ 의 원래 정의(eligibility_decisions 를 그냥 조인)로 되돌린다
-- =============================================================================
-- create or replace view app.v_ann_rule_vs_llm as
-- select r.announcement_id, a.사업명, a.출처, r.엔진버전,
--        r.판정 as 규칙_판정, r.점수 as 규칙_점수, r.확신도 as 규칙_확신도, r.커버리지,
--        e.확정_판정 as llm_판정, (e.ai_제안->>'점수')::int as llm_점수, e.ai_확신도 as llm_확신도,
--        (r.판정 = e.확정_판정) as 판정일치,
--        abs(r.점수 - coalesce((e.ai_제안->>'점수')::int, r.점수)) as 점수차,
--        e.정정여부 as 사람정정, r.llm_호출
--   from app.ann_rule_scores r
--   join app.announcements a on a.id = r.announcement_id
--   join app.eligibility_decisions e on e.announcement_id = r.announcement_id;
-- notify pgrst, 'reload schema';
