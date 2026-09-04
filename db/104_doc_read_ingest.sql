-- =============================================================================
-- 104_doc_read_ingest.sql — 판독 결과를 실제로 쌓기 위한 연결
--
--   왜: 103_ 에서 `app.evidence_doc_reads` 를 만들 때 `app.project_evidence_files`
--       (웹 업로드 경로)를 참조하게 했다. 그런데 **실제로 판독이 일어나는 곳은
--       Slack 흐름(`evidence_flow.ingest`)이고 그쪽은 `app.evidence` 에 넣는다.**
--       그래서 판독 결과가 한 건도 안 쌓이고 있었다(2026-09-04 확인: 0행).
--       학습 데이터가 안 모이면 「쌓이면 좋아진다」가 성립하지 않는다.
--
--   조치: evidence_id 를 추가하고 파일_id 를 nullable 로 바꾼다.
--         두 경로(웹 업로드 / Slack) 중 어느 쪽에서 와도 한 테이블에 쌓인다.
--
--   적용: cd /web/rnd && ./db/psql.sh -f db/104_doc_read_ingest.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

alter table app.evidence_doc_reads
  alter column 파일_id drop not null;

alter table app.evidence_doc_reads
  add column if not exists evidence_id bigint references app.evidence(id) on delete cascade;

create unique index if not exists evidence_doc_reads_evidence_uq
  on app.evidence_doc_reads (evidence_id) where evidence_id is not null;

comment on column app.evidence_doc_reads.evidence_id is
  'Slack 흐름(evidence_flow.ingest)에서 온 판독. 웹 업로드는 파일_id 를 쓴다. 둘 중 하나는 있어야 한다.';

-- 둘 다 비어 있으면 어디서 온 판독인지 알 수 없다
alter table app.evidence_doc_reads
  drop constraint if exists evidence_doc_reads_출처_필요;
alter table app.evidence_doc_reads
  add constraint evidence_doc_reads_출처_필요
  check (파일_id is not null or evidence_id is not null);

-- ---------------------------------------------------------------------------
-- 학습셋 뷰 — 비목 축. **사람이 확정한 것만** 학습에 들어간다.
--   판독 텍스트(본문텍스트) + 거래처 + 사람이 정한 비목 = 다음 모델의 재료.
-- ---------------------------------------------------------------------------
create or replace view app.v_trainset_bimok as
select e.id                                        as expense_id,
       coalesce(e.거래처, '')                       as 거래처,
       coalesce(
         (select string_agg(x->>'품목명', ' ')
            from jsonb_array_elements(coalesce(e.품목, '[]'::jsonb)) x), '') as 품목,
       coalesce(r.본문텍스트, '')                    as 본문,
       e.비목_대분류,
       e.비목_세부항목,
       d.정정여부,
       d.정정사유_유형,
       coalesce(d.created_at, e.created_at)        as 확정시각
  from app.expenses e
  left join app.evidence ev on ev.expense_id = e.id
  left join app.evidence_doc_reads r on r.evidence_id = ev.id
  left join lateral (
        select * from app.decisions d2
         where d2.expense_id = e.id
         order by d2.created_at desc limit 1) d on true
 where e.비목_대분류 is not null;

comment on view app.v_trainset_bimok is
  '비목 모델 재학습용. 정정여부=true 인 행은 sample_weight 를 높인다 — '
  '실측(서식 축)에서 정정 우선 학습이 무작위보다 +2.6p 였다.';

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop view if exists app.v_trainset_bimok;
-- alter table app.evidence_doc_reads drop constraint if exists evidence_doc_reads_출처_필요;
-- drop index if exists app.evidence_doc_reads_evidence_uq;
-- alter table app.evidence_doc_reads drop column if exists evidence_id;
-- commit;
-- notify pgrst, 'reload schema';
