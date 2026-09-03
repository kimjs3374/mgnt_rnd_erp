-- =============================================================================
-- 94_document_upload.sql — 서류함 업로드 + AI 판독 이력
--
--   2026-09-03 작성. db/93_document_shelf.sql 다음에 적용한다.
--
-- 왜 판독 이력을 남기는가
--   이 시스템의 값어치는 분류가 아니라 **기록**이다(CLAUDE.md §5-1).
--   발급일이 2026-06-01 이라는 결과만 남기면 나중에 그게 틀렸을 때 왜 그렇게 됐는지
--   알 방법이 없다. AI 가 뭘 제안했고 확신도가 얼마였고 원문 어디를 근거로 삼았는지,
--   그리고 **사람이 뭘로 확정했는지**를 같이 남긴다.
--
--   확신도 0.70 미만은 코드가 자동 확정을 막는다(§5-3). 모델은 모호해도 단정한다 —
--   지시로는 안 막히고 코드로 막아야 한다.
--
-- 파일은 어디에 두는가
--   Supabase Storage **비공개** 버킷 `company-docs`. app/actions/documents.ts 가 만든다.
--   `evidence` 버킷과 같은 방식이다(mgnt2, db/70_storage_rls.sql) — 브라우저에서 직접
--   올리는 경로를 두지 않고 service_role 서버 액션만 쓴다. 그래야 어느 서류 종류에
--   속하는지 검증할 자리가 남는다. 다운로드는 60초 서명 URL.
--
--   공개 버킷(`announcements`)에 두지 않는다. 사업자등록증·납세증명서는 회사 실데이터다(§2-6).
--
-- 적용: sudo docker exec -i rnd-db psql -U postgres -d postgres < db/94_document_upload.sql
-- 되돌리기: 파일 맨 아래
-- =============================================================================

begin;

alter table app.documents
  add column if not exists 크기         bigint,
  add column if not exists mime         text,
  add column if not exists 발급기관     text,
  add column if not exists 업로더        text,
  add column if not exists 업로더_id     uuid,
  add column if not exists 업로더_인증   boolean not null default false,
  add column if not exists ai_발급일    date,
  add column if not exists ai_확신도    numeric,
  add column if not exists ai_근거      text,
  add column if not exists 확정_방법    text,
  add column if not exists updated_at   timestamptz not null default now();

comment on column app.documents.storage_path is
  'Supabase Storage 비공개 버킷 company-docs 안의 경로. 공개 URL 이 없다 — 60초 서명 URL 로만 내려간다.';
comment on column app.documents.ai_발급일 is
  'claude -p 가 서류에서 읽은 발급일. 확정값(발급일)과 **따로** 둔다 — 사람이 고쳤을 때 '
  '무엇을 고쳤는지가 남아야 한다. 그 기록이 다음 판독의 판단 근거가 된다.';
comment on column app.documents.ai_확신도 is
  '0~1. 0.70 미만이면 발급일을 자동 확정하지 않는다 — 코드가 막는다(CLAUDE.md §5-3).';
comment on column app.documents.ai_근거 is
  '서류 원문에서 그대로 인용한 문장. 지어낸 값인지 사람이 바로 확인할 수 있어야 한다.';
comment on column app.documents.확정_방법 is
  'ai_자동 | 사람_확인 | 사람_수정 | 미확정. 「AI가 뭘 제안했고 사람이 뭘로 확정했는가」가 이 시스템의 핵심 기록이다.';
comment on column app.documents.업로더_인증 is
  'false = 로그인 전이라 업로더를 신뢰할 수 없다. lib/current-user.ts 와 같은 규칙(mgnt2).';

-- 뷰가 doc_type 별로 발급일이 가장 최근인 것을 고른다. 이력은 지우지 않는다.
create index if not exists idx_documents_doc_type on app.documents (doc_type, 발급일 desc);

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
-- drop index if exists app.idx_documents_doc_type;
-- alter table app.documents
--   drop column if exists 크기,        drop column if exists mime,
--   drop column if exists 발급기관,     drop column if exists 업로더,
--   drop column if exists 업로더_id,    drop column if exists 업로더_인증,
--   drop column if exists ai_발급일,    drop column if exists ai_확신도,
--   drop column if exists ai_근거,      drop column if exists 확정_방법,
--   drop column if exists updated_at;
-- notify pgrst, 'reload schema';
-- commit;
