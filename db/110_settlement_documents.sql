-- =============================================================================
-- 110_settlement_documents.sql — 과제 **최종 정산** 서류 보관
--
--   무엇을 푸는가 (2026-09-04 사용자 지시)
--     협약기간이 끝나면 최종 정산 파일을 낸다 — 정산보고서 · 정산결과 통보서 ·
--     잔액 반납 증빙 같은 것들이다. 그런데 그 파일을 둘 자리가 없었다:
--       · `app.project_evidence_files`  **비목_대분류가 NOT NULL** 이다. 최종 정산 서류는
--                                        비목에 붙지 않는다(과제 전체에 하나 붙는다)
--       · `app.evidence`                집행 **건** 단위. 정산은 건이 아니라 과제의 끝이다
--       · `app.documents`               우리 회사 상시 서류(등기부·재무제표). 과제에 안 매달린다
--       · `app.rule_documents`          우리가 **받는** 규정. 정산 서류는 우리가 **내는** 것이다
--     기존 넷은 건드리지 않는다.
--
--   왜 과제에 직접 매다는가
--     최종 정산은 **과제가 끝났다는 사실 자체**에 붙는다. 연차별로 여러 번 낼 수 있어
--     `정산연차` 를 두되 NULL 을 허용한다(마지막 한 번만 내는 사업이 대부분이다).
--     덮어쓰지 않고 쌓는다 — 반려되어 다시 낸 이력이 남아야 「왜 두 번 냈는지」를 설명할 수 있다.
--
--   서류종류에 CHECK 를 걸지 않은 이유
--     `db/98` · `db/101` 과 같다. 정산 서류 이름이 사업마다 다르다(RCMS 정산보고서 /
--     지자체 「사업비 정산 내역서」 / TP 「집행실적보고서」). 코드에 박으면 한 유형만 돌아간다.
--     화면이 흔한 값을 먼저 보여주고, 그 밖은 「기타」로 받는다.
--
--   파일 저장소: 기존 `evidence` 버킷(비공개). 새 버킷을 만들지 않았다.
--     경로 규칙 `settlement/<과제_id>/<타임스탬프>-<rand>.<확장자>`
--     ⚠ `db/70_storage_rls.sql` 이 INSERT 정책을 **일부러** 안 만들었다(쓰기는 service_role 만).
--        그 결정을 유지한다 — 업로드는 서버 액션으로만.
--
--   ⚠ 실제 정산 파일에는 계좌·인건비·개인정보가 들어 있다(CLAUDE.md §5-5).
--     로그인 게이트가 없는 지금은 **비공개 버킷 + 60초 서명 URL** 이 유일한 보호막이다.
--     시연·제출 상태에서는 비워 둔다. 더미를 심지 않았다.
--
--   설계 원칙: 추가만. 적용: cd /web/rnd && ./db/psql.sh -f db/110_settlement_documents.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.settlement_documents (
  id            bigserial primary key,
  과제_id       bigint not null references app.projects(id) on delete cascade,

  -- 정산보고서 | 정산결과 통보서 | 잔액 반납 증빙 | 이자 반납 증빙 | 기타 … 자유값(위 주석).
  서류종류      text not null default '기타',
  -- 연차별로 정산하는 사업이 있다. 마지막 한 번만 내는 사업이 대부분이라 NULL 을 허용한다.
  정산연차      integer,
  -- 우리가 **낸 날**. 발급일이 아니라 제출일이다 — 반려·재제출 이력이 이 날짜로 읽힌다.
  제출일        date,
  비고          text,

  파일명        text not null,
  storage_path  text not null unique,
  크기          bigint,
  mime          text,

  업로더        text not null,
  업로더_id     text,
  업로더_인증   boolean not null default false,
  업로드일시    timestamptz not null default now()
);

create index if not exists settlement_documents_과제_idx
  on app.settlement_documents (과제_id, 서류종류, 업로드일시 desc);

comment on table app.settlement_documents is
  '과제 최종 정산 서류. 비목이나 집행 건이 아니라 **과제가 끝났다는 사실**에 붙는다. '
  '덮어쓰지 않고 쌓는다 — 반려되어 다시 낸 이력이 남아야 왜 두 번 냈는지를 설명할 수 있다.';

comment on column app.settlement_documents.정산연차 is
  '연차별로 정산하는 사업만 채운다. 마지막 한 번만 내는 사업은 NULL.';

comment on column app.settlement_documents.제출일 is
  '우리가 낸 날(발급일이 아니다). 반려·재제출 이력이 이 날짜로 읽힌다.';

grant select on app.settlement_documents to authenticated;
grant all    on app.settlement_documents to service_role;
grant all    on sequence app.settlement_documents_id_seq to service_role;

alter table app.settlement_documents enable row level security;
drop policy if exists authenticated_read_settlement_documents on app.settlement_documents;
create policy authenticated_read_settlement_documents
  on app.settlement_documents for select to authenticated using (true);

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_settlement_documents on app.settlement_documents;
-- drop table if exists app.settlement_documents;
-- commit;
-- notify pgrst, 'reload schema';
-- ※ 버킷의 파일은 지워지지 않는다. storage 의 settlement/ 아래를 따로 정리해야 한다.
