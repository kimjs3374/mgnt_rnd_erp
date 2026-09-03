-- =============================================================================
-- 101_vendors.sql — 업체(거래처) 대장 + 업체 서류 보관
--
--   무엇을 푸는가
--     정산에 낼 서류 중 **업체에게 받아 두는 것**이 둘 있다 — 사업자등록증 · 통장사본.
--     이건 과제에 붙는 게 아니라 **업체에 붙는다.** 한 번 받아서 여러 과제·여러 집행 건에
--     그대로 쓴다. 그런데 지금 시스템에 그 자리가 없었다:
--       · `app.documents`               우리 회사 서류(`doc_types` 11종 FK). 업체 것을 넣으면
--                                       「우리 서류」로 섞이고 유효기간·제출서류 대조가 거짓이 된다
--       · `app.project_evidence_files`  과제 × 비목 기준. 업체 이름으로 다시 못 찾는다
--       · `app.evidence`                집행 **건** 단위. 같은 등록증을 건마다 다시 받게 된다
--     그래서 표를 새로 만든다. 기존 세 표는 건드리지 않는다.
--
--   왜 사업자번호가 키인가
--     `app.expenses.거래처_사업자번호` 가 **이미 있고** 봇이 증빙에서 읽어 채운다.
--     같은 번호로 매달면 지금까지 쌓인 집행 건이 그대로 이 대장에 붙는다 —
--     업체명은 증빙마다 표기가 다르다(「주식회사 천보신소재(Chunbo …)」 대 「천보신소재」).
--     **이름으로 묶으면 같은 업체가 둘로 갈린다.** 번호는 안 갈린다.
--     다만 not null 로 걸지 않는다 — 등록증을 받기 전이라 번호를 모르는 업체가 실제로 있다.
--     (null 이 여럿이어도 unique 는 통과한다)
--
--   계좌번호를 가리지 않는다 (2026-09-03 사용자 결정)
--     내부 인원이 공유하는 화면이라 뒤 4자리 마스킹을 넣지 않는다. 대신 두 겹을 유지한다 —
--     ① 전 화면이 로그인 뒤에 있고 ② 파일은 **비공개 `evidence` 버킷** + 60초 서명 URL 이다.
--     ⚠ 그래도 **실제 통장사본·등록증을 올리면 그건 실데이터**다(CLAUDE.md §5-5).
--        시연·제출 상태에서는 빈 상태로 두거나 가린 파일을 쓴다. 더미는 넣지 않았다.
--
--   서류종류에 CHECK 를 걸지 않은 이유
--     `db/98_rule_documents.sql` 과 같다 — 사업마다 요구 서류가 다르다(중소기업확인서·
--     청렴계약이행서약서 …). 코드에 박으면 한 유형만 돌아간다.
--     화면이 사업자등록증·통장사본 두 자리를 먼저 보여주고, 그 밖은 「기타」로 받는다.
--
--   파일 저장소: 기존 `evidence` 버킷(비공개). 새 버킷을 만들지 않았다.
--     경로 규칙 `vendors/<업체_id>/<타임스탬프>-<rand>.<확장자>`
--     ⚠ `db/70_storage_rls.sql` 이 INSERT 정책을 **일부러** 안 만들었다(쓰기는 service_role 만).
--        그 결정을 유지한다 — 업로드는 서버 액션으로만.
--
--   설계 원칙: 추가만. 적용: cd /web/rnd && ./db/psql.sh -f db/101_vendors.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

create table if not exists app.vendors (
  id            bigserial primary key,

  업체명        text not null,
  -- 하이픈 없는 10자리로 저장한다. 표기가 「123-45-67890」/「1234567890」 로 섞이면
  -- 집행 건과 못 붙는다 — 저장할 때 서버가 숫자만 남긴다.
  사업자번호    text unique,
  대표자        text,
  업태          text,
  종목          text,
  주소          text,
  연락처        text,
  이메일        text,

  -- 통장사본에서 사람이 옮겨 적는다. **AI 로 읽지 않는다** — 계좌번호는 한 자만 틀려도
  -- 돈이 남에게 가고, 확신도로 걸러낼 수 있는 종류의 오류가 아니다(CLAUDE.md §6-2).
  은행          text,
  계좌번호      text,
  예금주        text,

  비고          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- 하이픈·공백이 섞여 들어오는 것을 DB 가 막는다. 화면 검사는 우회할 수 있다.
  constraint vendors_사업자번호_chk check (사업자번호 is null or 사업자번호 ~ '^[0-9]{10}$')
);

create index if not exists vendors_업체명_idx on app.vendors (업체명);

create table if not exists app.vendor_documents (
  id            bigserial primary key,
  업체_id       bigint not null references app.vendors(id) on delete cascade,

  -- 사업자등록증 | 통장사본 | 계약서 | 기타 … 자유값이다(위 주석 참조).
  서류종류      text not null default '기타',
  -- 등록증은 재발급되고 계좌는 바뀐다. **덮어쓰지 않고 쌓는다** — 언제 받은 서류로
  -- 정산했는지가 나중에 근거가 된다. 화면은 종류별 최신 것을 위로 올린다.
  발급일        date,
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

create index if not exists vendor_documents_업체_idx
  on app.vendor_documents (업체_id, 서류종류, 업로드일시 desc);

comment on table app.vendors is
  '업체(거래처) 대장. 사업자등록증·통장사본처럼 업체에 붙는 서류의 주인이다. '
  '키는 사업자번호 — app.expenses.거래처_사업자번호 와 같은 값이라 집행 건이 그대로 붙는다. '
  '업체명은 증빙마다 표기가 달라 묶는 기준으로 쓰지 않는다.';

comment on column app.vendors.사업자번호 is
  '하이픈 없는 10자리. 등록증을 받기 전이라 모르는 업체가 있어 not null 로 걸지 않았다.';

comment on column app.vendors.계좌번호 is
  '통장사본을 사람이 옮겨 적는다. AI 로 읽지 않는다 — 한 자 틀리면 돈이 남에게 가고 '
  '확신도로 걸러낼 수 있는 오류가 아니다. 내부 공유 화면이라 마스킹하지 않는다(2026-09-03 결정).';

comment on column app.vendor_documents.서류종류 is
  '사업자등록증 · 통장사본 · 계약서 · 기타. CHECK 를 걸지 않았다 — 요구 서류가 사업마다 다르다.';

comment on column app.vendor_documents.업로더_인증 is
  'false = 로그인 세션 없이 올라간 파일이라 업로더를 신뢰할 수 없다. 화면에 그대로 표시한다.';

grant select on app.vendors           to authenticated;
grant select on app.vendor_documents  to authenticated;
grant all    on app.vendors           to service_role;
grant all    on app.vendor_documents  to service_role;
grant all    on sequence app.vendors_id_seq          to service_role;
grant all    on sequence app.vendor_documents_id_seq to service_role;

alter table app.vendors          enable row level security;
alter table app.vendor_documents enable row level security;
drop policy if exists authenticated_read_vendors on app.vendors;
create policy authenticated_read_vendors
  on app.vendors for select to authenticated using (true);
drop policy if exists authenticated_read_vendor_documents on app.vendor_documents;
create policy authenticated_read_vendor_documents
  on app.vendor_documents for select to authenticated using (true);

-- 업체별 서류 확보 현황. 화면이 「사업자등록증 있음/없음」을 세느라 전건을 훑지 않게 한다.
create or replace view app.v_vendor_status as
select
  v.id,
  v.업체명,
  v.사업자번호,
  v.대표자,
  v.은행,
  v.계좌번호,
  v.예금주,
  v.비고,
  v.updated_at,
  coalesce(d.등록증, 0)                       as 등록증_건수,
  coalesce(d.통장, 0)                         as 통장사본_건수,
  coalesce(d.기타, 0)                         as 기타_건수,
  -- 집행 건은 사업자번호로만 잇는다. 이름으로 이으면 같은 업체가 둘로 갈린다.
  coalesce(e.집행건수, 0)                     as 집행건수,
  coalesce(e.집행액, 0)                       as 집행액
from app.vendors v
left join (
  select 업체_id,
         count(*) filter (where 서류종류 = '사업자등록증') as 등록증,
         count(*) filter (where 서류종류 = '통장사본')     as 통장,
         count(*) filter (where 서류종류 not in ('사업자등록증', '통장사본')) as 기타
    from app.vendor_documents group by 업체_id
) d on d.업체_id = v.id
left join (
  select 거래처_사업자번호 as 사업자번호,
         count(*)          as 집행건수,
         sum(coalesce(합계, 0)) as 집행액
    from app.expenses
   where 거래처_사업자번호 is not null
   group by 1
) e on e.사업자번호 = v.사업자번호;

comment on view app.v_vendor_status is
  '업체 + 서류 확보 현황 + 그 업체로 나간 집행. 서류가 없는 업체를 화면이 바로 집어낸다.';

grant select on app.v_vendor_status to authenticated, service_role;

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop view if exists app.v_vendor_status;
-- drop policy if exists authenticated_read_vendor_documents on app.vendor_documents;
-- drop policy if exists authenticated_read_vendors on app.vendors;
-- drop table if exists app.vendor_documents;
-- drop table if exists app.vendors;
-- commit;
-- notify pgrst, 'reload schema';
-- ※ 버킷의 파일은 지워지지 않는다. storage 의 vendors/ 아래를 따로 정리해야 한다.
