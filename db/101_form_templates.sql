-- =============================================================================
-- 101_form_templates.sql — 회사 표준 양식(서식) 한 벌
--
--   무엇을 푸는가 — **문서 통일화**
--     증빙 서류 이름은 이미 `app.evidence_requirements` 에 있다(견적의뢰서 · 지출결의서 ·
--     검수조서 · 출장신청서 · 회의록 …, 매그나텍 실제 제출 폴더의 파일 번호 1~7 그대로).
--     그런데 **그 서류를 무슨 양식으로 쓰는지**는 사람마다 다르다 — 각자 예전 파일을 복사해 쓰고,
--     그래서 같은 지출결의서가 과제마다 다른 모양으로 나간다.
--     이 표가 서류명마다 **회사 표준 파일 하나**를 정한다. 계상 탭에서 받아 쓰면 양식이 통일된다.
--
--   왜 `rule_documents`(규정 문서함)와 따로 두나
--     그쪽은 **밖에서 받는 것**이다 — 공고문 · 관리지침 · 사용기준. 적용범위 축도 공고/사업유형/공통이다.
--     여기는 **우리가 만들어 쓰는 것**이고, 축이 「서류명」이다. 한 서류명에 표준은 하나여야 한다는
--     제약이 이 표의 존재 이유인데, 규정 문서함에 섞으면 그 제약을 걸 자리가 없다.
--
--   ⚠ **서류명 하나에 표준 하나.** 그게 「통일」의 정의다. 사업유형별로 양식이 다른 경우만
--     갈라 둔다(RCMS 지출결의서와 지자체 지출결의서는 서식이 다르다). 사업유형 null = 공통.
--     같은 자리에 새로 올리면 **교체**하고 이전 파일은 스토리지에서 지운다 —
--     둘을 남겨 두면 어느 것이 표준인지 다시 알 수 없어진다.
--
--   저장소: 기존 `evidence` 버킷(비공개). 경로 `forms/<사업유형|common>/<ts>-<rand>.<ext>`
--     업로드는 서버 액션(service_role)만 한다(`db/70_storage_rls.sql` 의 결정 유지).
--
--   적용: cd /web/rnd && ./db/psql.sh -f db/101_form_templates.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.form_templates (
  id            bigserial primary key,
  -- `app.evidence_requirements.서류명` 과 같은 말을 쓴다. FK 를 걸지 않는 이유는 아래 주석 참조.
  서류명        text   not null,
  -- null = 모든 사업유형에 쓰는 공통 양식.
  사업유형      text   references app.funding_schemes("코드"),
  버전          text,
  설명          text,
  파일명        text   not null,
  storage_path  text   not null unique,
  크기          bigint,
  mime          text,
  업로더        text   not null,
  업로더_id     text,
  업로더_인증   boolean not null default false,
  업로드일시    timestamptz not null default now()
);

-- ⚠ `서류명` 에 FK 를 걸지 않았다. `evidence_requirements` 는 같은 서류명이 비목마다 여러 행으로
--   있고(지출결의서가 FACILITY·ACTIVITY·PERSONNEL 세 번), 거기엔 서류명 UNIQUE 가 없다.
--   FK 를 걸려면 저쪽 구조를 바꿔야 하는데 그 표는 이미 화면 두 곳이 쓰고 있다(추가만 규칙).
--   대신 화면이 **요건 목록에서 서류명을 골라 주게** 해서 오타로 새 이름이 생기지 않게 막는다.

create unique index if not exists form_templates_uniq
  on app.form_templates (서류명, coalesce(사업유형, ''));

comment on table app.form_templates is
  '회사 표준 양식. 서류명 하나에 표준 파일 하나(사업유형별로만 갈린다). '
  '계상 탭에서 받아 쓰면 같은 서류가 과제마다 다른 모양으로 나가지 않는다.';

grant select on app.form_templates to authenticated;
grant all    on app.form_templates to service_role;
grant all    on sequence app.form_templates_id_seq to service_role;

alter table app.form_templates enable row level security;
drop policy if exists authenticated_read_form_templates on app.form_templates;
create policy authenticated_read_form_templates
  on app.form_templates for select to authenticated using (true);

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_form_templates on app.form_templates;
-- drop table if exists app.form_templates;
-- commit;
-- notify pgrst, 'reload schema';
-- ※ 버킷의 파일은 지워지지 않는다. storage 의 forms/ 아래를 따로 정리해야 한다.
