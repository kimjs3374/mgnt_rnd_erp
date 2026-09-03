-- =============================================================================
-- 71_ann_required_docs.sql — 공고별 요구서류 (LLM 판독 결과)
--
--   공고문을 파싱해 「신청자가 준비해야 할 서류」를 뽑아 담는다. program_documents 는
--   지원사업(app.projects) 단위 대조 결과이고, 이건 그 이전 단계 — 아직 신청 전이라
--   projects 행이 없어도 저장할 수 있어야 하므로 announcements 를 직접 참조한다.
--
--   설계 원칙
--     ① 추가만 한다. DROP·ALTER TYPE·롤 DDL 없음.
--     ② 필수/해당시 구분이 원문 텍스트 추출 중 사라지는 경우가 실증에서 확인됐다
--        (프로토타입/결과_20260821.md 사례1 — 열 구분이 깨져 "O" 표시만 남음).
--        LLM 이 추측해 단정하면 사고다 → 애매하면 확인상태를 '확인필요'로 둔다.
--     ③ 근거문장을 원문 그대로 저장한다 — 지어낸 서류인지 검증할 수 있어야 한다.
--     ④ doc_type 매칭은 선택이다. 공고마다 표현이 달라 못 맞을 수 있고,
--        못 맞아도 요구서류 자체는 유효하다.
--
--   적용: Studio pg-meta 로 실행 (mgnt3 은 docker·psql·DB 비번이 없다 — 70_ 파일과 동일 사유)
--   되돌리기: 파일 맨 아래 블록
-- =============================================================================

begin;

create table if not exists app.ann_required_docs (
  id          bigserial primary key,
  공고_id     bigint not null references app.announcements(id) on delete cascade,
  서류명      text   not null,
  구분        text   not null,               -- 필수 | 해당시 | 가점 | 확인필요
  부수        text,
  발급처      text,
  비고        text,
  근거문장    text   not null,               -- 공고문에서 그대로 인용
  doc_type    text   references app.doc_types(코드),
  ai_확신도   numeric,
  확인상태    text   not null default '미확인',   -- 미확인 | 확인됨 | 확인필요
  created_at  timestamptz not null default now()
);

comment on table app.ann_required_docs is
  '공고문 LLM 판독으로 뽑은 요구서류 원본 목록. 신청 여부와 무관하게 공고 단위로 쌓는다. '
  '지원사업(app.projects) 단위 대조 결과는 app.program_documents 가 따로 담당한다.';
comment on column app.ann_required_docs.구분 is
  '원문에서 필수/해당시 구분이 텍스트 추출 중 깨지는 경우가 실증에서 나왔다(레이아웃 붕괴). '
  '애매하면 "확인필요"로 두고 단정하지 않는다.';
comment on column app.ann_required_docs.근거문장 is
  '공고문에서 그대로 인용. 지어낸 서류인지 검증하는 유일한 근거.';

create index if not exists idx_ann_required_docs_공고 on app.ann_required_docs (공고_id);

-- -----------------------------------------------------------------------------
-- 권한 — 객체 단위만. 롤 DDL 은 하지 않는다(예전에 클러스터가 25초 멈췄다).
-- -----------------------------------------------------------------------------
alter table app.ann_required_docs enable row level security;

drop policy if exists authenticated_read_ann_required_docs on app.ann_required_docs;
create policy authenticated_read_ann_required_docs
  on app.ann_required_docs for select to authenticated using (true);

grant select on app.ann_required_docs to authenticated;
grant all    on app.ann_required_docs to service_role;
grant usage, select on all sequences in schema app to service_role;

commit;

-- PostgREST 가 새 테이블을 보게 한다. 빠뜨리면 화면이 계속 빈 채로 뜬다.
notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop table if exists app.ann_required_docs;
-- commit;
-- notify pgrst, 'reload schema';
