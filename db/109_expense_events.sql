-- 109: 집행 건의 **생애 이력**. 업로드부터 확정까지 한 줄기로 남긴다.
--
-- 왜: 이력이 여러 곳에 흩어져 있었다 — 판독은 evidence_doc_reads, 확정은 decisions,
--     LLM 호출은 llm_usage. 그리고 **대화로 값을 고친 것은 아무 데도 남지 않았다**
--     (거래처를 사람이 적어 넣어도 rest.update 만 하고 끝났다).
--     「이 건이 왜 이렇게 처리됐나」에 답하려면 한 줄기가 필요하다.
--
-- ※ 추가만 한다. 기존 테이블은 건드리지 않는다.
-- ※ expense_id 에 FK 를 걸지 않는다 — **버려진 건의 이력도 남아야 한다.**
--    무엇을 왜 안 올렸는지가 나중에 질문이 된다.

create table if not exists app.expense_events (
  id           bigserial primary key,
  expense_id   bigint,
  evidence_id  bigint,
  -- upload  파일 접수      read    판독        classify 비목 분류
  -- ask     사람에게 질문   answer  사람의 답변  edit     값 수정
  -- project 지원사업 지정   confirm 확정        correct  정정 확정
  -- discard 버림           store   Storage 보관 relearn  재학습 예약
  행위         text not null,
  행위자       text,                 -- Slack user id, 또는 'system'
  요약         text,                 -- 사람이 읽는 한 줄
  상세         jsonb,                -- 기계가 읽는 값 (이전값/새값 등)
  created_at   timestamptz not null default now()
);

create index if not exists expense_events_expense_idx
  on app.expense_events (expense_id, id);
create index if not exists expense_events_time_idx
  on app.expense_events (created_at desc);

comment on table app.expense_events is
  '집행 건의 생애 이력 — 업로드·판독·질문·수정·확정·폐기. 버려진 건의 이력도 남긴다.';

-- 사람이 읽는 이력 뷰. 「이 건 어떻게 처리됐나」에 그대로 답이 된다.
create or replace view app.v_expense_history as
select
  ev.expense_id,
  ev.id                                             as seq,
  to_char(ev.created_at at time zone 'Asia/Seoul',
          'YYYY-MM-DD HH24:MI:SS')                  as 시각,
  ev.행위,
  coalesce(ev.행위자, 'system')                     as 행위자,
  ev.요약,
  ev.상세
from app.expense_events ev
order by ev.expense_id, ev.id;

-- 봇/재학습이 접속하는 롤은 rnd_mcp 다(rnd_dev 는 소유자).
-- 108 에서 이걸 놓쳐 permission denied 를 한 번 겪었다.
grant select, insert on app.expense_events to rnd_mcp, rnd_dev;
grant usage, select on sequence app.expense_events_id_seq to rnd_mcp, rnd_dev;
grant select on app.v_expense_history to rnd_mcp, rnd_dev, authenticated;
