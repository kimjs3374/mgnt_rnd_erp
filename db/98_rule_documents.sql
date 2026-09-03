-- =============================================================================
-- 98_rule_documents.sql — 규정·공고 원문 문서함
--
--   무엇을 푸는가
--     **규정은 사업마다 다르다.** 정부출연금 비율도, 연구수당 한도도, 간접비율도
--     「어느 공고냐 · 어느 사업유형이냐」에 따라 갈린다. 실측으로 같은 회사가
--     2026 공고에서는 중소기업 75% 이내인데 수행 중인 과제는 97.8% 였다 — 둘 다 맞다.
--     그런데 지금 그 **근거 원문**은 서버 파일시스템(`data/real/공고규정/`)에만 있고,
--     화면에서 열 수도, 사람이 새 규정을 올릴 수도 없다. 이 표가 그 자리를 만든다.
--
--   왜 새 테이블인가 — 기존 셋 다 담을 수 없다
--     · `app.documents`      회사 서류함. `doc_type` FK 가 **회사 공통 8종**뿐이라 공고문·지침을 못 담는다
--     · `app.program_documents` 과제별 **제출서류 체크리스트**(우리가 내는 것). 규정은 받는 것이다
--     · `app.project_evidence_files` 과제별 **집행 증빙**. 규정은 과제보다 위에 있다
--     기존 세 표는 건드리지 않는다.
--
--   축을 왜 이렇게 잡았나 — `app.funding_share_rules` 와 **같은 축**이다
--     그 표의 우선순위가 이미 **공고 > 사업유형 > 규정(기본값)** 이다(`db/93`, `db/94`).
--     규정 문서도 같은 세 층에 매달아야 「이 과제에 적용되는 규정」을 한 번에 모을 수 있다.
--     축이 어긋나면 규칙과 근거 문서가 따로 놀고, 그때부터 근거를 못 댄다.
--
--       적용범위 = 공고      → announcement_id 필수  (그 공고에만 적용)
--       적용범위 = 사업유형  → 사업유형 필수         (국가 R&D 전체 / 지자체·TP 전체)
--       적용범위 = 공통      → 둘 다 null            (모든 사업에 적용되는 상위 법령·고시)
--
--     범위와 키가 어긋나면 **어디에 적용되는 규정인지 알 수 없다.** 화면이 아니라 DB 가 막는다.
--
--   문서종류에 CHECK 를 걸지 않은 이유
--     CLAUDE.md §0.5 「사업유형은 데이터다. 코드에 박지 않는다」와 같은 이유다.
--     지자체 사업은 「사업설명회 자료」, 국가 R&D 는 「연차보고 서식」처럼 서류 이름이 사업마다 다르다.
--     CHECK 로 박으면 한 유형만 돌아간다. 화면이 흔한 값을 제안하고, 사람이 다른 걸 쓸 수 있게 둔다.
--
--   파일 저장소: 기존 `evidence` 버킷(비공개). 새 버킷을 만들지 않았다.
--     경로 규칙 `rules/<적용범위>/<키>/<타임스탬프>-<rand>.<확장자>`
--     ⚠ `db/70_storage_rls.sql` 이 INSERT 정책을 **일부러** 안 만들었다(쓰기는 service_role 만).
--        그 결정을 유지한다 — 업로드는 서버 액션으로만 한다.
--
--   설계 원칙: 추가만. 적용: cd /web/rnd && ./db/psql.sh -f db/98_rule_documents.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.rule_documents (
  id              bigserial primary key,

  -- 공고 | 사업유형 | 공통. 아래 CHECK 가 범위와 키의 짝을 강제한다.
  적용범위        text   not null,
  announcement_id bigint references app.announcements(id) on delete cascade,
  사업유형        text   references app.funding_schemes("코드"),

  -- 공고문 · 유의사항 · 관리지침 · 사용기준 · 서식 · 협약서 · 기타. 자유값이다(위 주석 참조).
  문서종류        text   not null default '기타',
  제목            text   not null,
  발행기관        text,
  발행일          date,
  버전            text,
  -- 「p.31 정부지원 비율표」처럼 이 문서의 **어디를** 근거로 쓰는지. 쪽수 없이 인용하지 않는다
  -- (`funding_share_rules.출처` 가 이미 쪽수로 인용하고 있고, 그 쪽수가 가리키는 원본이 여기다).
  근거메모        text,

  파일명          text   not null,
  storage_path    text   not null unique,
  크기            bigint,
  mime            text,

  업로더          text   not null,
  업로더_id       text,
  업로더_인증     boolean not null default false,
  업로드일시      timestamptz not null default now(),

  constraint rule_documents_적용범위_chk
    check (적용범위 in ('공고', '사업유형', '공통')),

  constraint rule_documents_범위키_chk check (
    (적용범위 = '공고'     and announcement_id is not null and 사업유형 is null) or
    (적용범위 = '사업유형' and announcement_id is null     and 사업유형 is not null) or
    (적용범위 = '공통'     and announcement_id is null     and 사업유형 is null)
  )
);

create index if not exists rule_documents_공고_idx
  on app.rule_documents (announcement_id, 업로드일시 desc)
  where announcement_id is not null;

create index if not exists rule_documents_사업유형_idx
  on app.rule_documents (사업유형, 업로드일시 desc)
  where 사업유형 is not null;

comment on table app.rule_documents is
  '규정·공고 원문 문서함. 적용범위는 app.funding_share_rules 와 같은 축(공고 > 사업유형 > 공통)이다. '
  '규칙 행이 쪽수로 인용하는 원본이 여기 있어야 근거를 화면에서 바로 열 수 있다.';

comment on column app.rule_documents.근거메모 is
  '이 문서의 어디를 근거로 쓰는지(예: p.31 정부지원 비율표). '
  '쪽수 없이 인용하면 나중에 아무도 다시 못 찾는다.';

comment on column app.rule_documents.업로더_인증 is
  'false = 로그인 게이트가 붙기 전에 올라간 파일이라 업로더를 신뢰할 수 없다. 화면에 그대로 표시한다.';

grant select on app.rule_documents to authenticated;
grant all    on app.rule_documents to service_role;
grant all    on sequence app.rule_documents_id_seq to service_role;

alter table app.rule_documents enable row level security;
drop policy if exists authenticated_read_rule_documents on app.rule_documents;
create policy authenticated_read_rule_documents
  on app.rule_documents for select to authenticated using (true);

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_rule_documents on app.rule_documents;
-- drop table if exists app.rule_documents;
-- commit;
-- notify pgrst, 'reload schema';
-- ※ 버킷의 파일은 지워지지 않는다. storage 의 rules/ 아래를 따로 정리해야 한다.
