-- =============================================================================
-- 95_project_evidence.sql — 비목별 RCMS 증빙 요건 + 과제별 첨부 파일
--
--   무엇을 푸는가
--     계상은 「얼마를 어느 비목에」고, 정산은 「그 돈을 썼다는 증빙」이다. 케이오시·매그나텍 둘 다
--     증빙을 **폴더로** 관리한다 — 실제 폴더가 `02. 2차년도\01. 연구재료비\(주)천보\2024.06.21\`
--     아래에 `1. 견적의뢰 · 2. 견적서 · 3. 지출결의서 · 4. 발주서 · 5. 거래명세서 · 6. 세금계산서 ·
--     7. 검수조서` 로 번호까지 붙어 있었다. **그 번호가 곧 RCMS 제출 순서다.**
--     이 표는 그 폴더 규칙을 시스템 안으로 옮긴 것이고, 「무엇이 빠졌는지」를 사람이 아니라
--     코드가 센다.
--
--   왜 새 테이블인가
--     `app.evidence_rules` 는 **결제수단**(카드·계좌이체) 축이라 비목별 요건을 담을 수 없고,
--     `app.program_documents` 는 **신청 단계 제출서류** 체크리스트다(과제_id 는 이미 있다).
--     여기는 **집행·정산 증빙** 축이라 따로 만든다. 기존 두 테이블은 건드리지 않는다.
--
--   ⚠ 개인정보 — 항목은 두고 파일은 받지 않는다
--     인건비 증빙(급여이체증·4대보험 가입자명부·급여명세·지급대장)은 **개인 급여를 그대로 드러낸다.**
--     CLAUDE.md §5-5 「인건비·개인정보는 항목 자체를 만들지 않는다」가 걸리는 자리다.
--     그렇다고 목록에서 지우면 「빠진 서류」를 못 세므로, **요건으로는 남기고 업로드를 코드로 막는다**
--     (`개인정보포함 = true`). 화면에는 「RCMS 에 직접 제출 · 여기 올리지 않는다」로 표시한다.
--
--   파일 저장소: 기존 `evidence` 버킷(비공개)을 쓴다. 새 버킷을 만들지 않았다.
--     경로 규칙 `projects/<과제_id>/<비목코드>/<타임스탬프>_<파일명>`
--     ⚠ `db/70_storage_rls.sql` 은 INSERT 정책을 **일부러** 만들지 않았다(쓰기는 service_role 만).
--        그 결정은 유지된다 — 업로드는 서버 액션(service_role)만 하고 브라우저에서 직접 올리지 않는다.
--
--   설계 원칙: 추가만. 적용: cd /web/rnd && ./db/psql.sh -f db/95_project_evidence.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

-- ── 요건 ────────────────────────────────────────────────────────────────────
create table if not exists app.evidence_requirements (
  id              bigserial primary key,
  비목_대분류     text    not null references app.categories("코드"),
  -- 같은 비목 안에서도 집행 성격에 따라 서류가 다르다. null = 그 비목 전부에 해당.
  구분            text,                       -- 물품·용역 | 출장 | 회의 | 급여 | 산출근거
  순번            integer not null default 0, -- 실제 폴더의 파일 번호(1~7)를 그대로 쓴다
  서류명          text    not null,
  필수여부        boolean not null default true,
  -- true = 개인 급여·주민번호가 드러나는 서류. 우리 시스템에 올리지 않는다(위 ⚠ 참조).
  개인정보포함    boolean not null default false,
  원문            text,                       -- 규정·공고에서 그대로 인용
  출처            text    not null,
  사업유형        text    references app.funding_schemes("코드"),
  announcement_id bigint  references app.announcements(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create unique index if not exists evidence_requirements_uniq
  on app.evidence_requirements
     (비목_대분류, coalesce(구분,''), 서류명, coalesce(사업유형,''), coalesce(announcement_id,0));

comment on table app.evidence_requirements is
  'RCMS 제출 증빙 요건(비목별). 순번은 매그나텍 실제 제출 폴더의 파일 번호 1~7 과 같다. '
  '개인정보포함=true 는 요건으로만 표시하고 업로드를 막는다.';

-- ── 첨부 파일 ───────────────────────────────────────────────────────────────
create table if not exists app.project_evidence_files (
  id            bigserial primary key,
  과제_id       bigint not null references app.projects(id) on delete cascade,
  비목_대분류   text   not null references app.categories("코드"),
  요건_id       bigint references app.evidence_requirements(id) on delete set null,
  -- 집행 건에 붙는 증빙이면 여기에 매단다. 계상 단계에서 미리 올리는 경우도 있어 null 을 허용한다.
  집행_id       bigint references app.expenses(id) on delete set null,
  파일명        text   not null,
  storage_path  text   not null unique,
  크기          bigint,
  mime          text,
  -- 업로드한 사람. 로그인 사용자 기준이다(lib/current-user.ts).
  업로더        text   not null,
  업로더_id     text,                                   -- Supabase auth uid
  업로더_인증   boolean not null default false,         -- false = 로그인 세션 없이 올라간 건(로그인 붙기 전)
  업로드일시    timestamptz not null default now(),
  비고          text
);

create index if not exists project_evidence_files_과제_비목_idx
  on app.project_evidence_files (과제_id, 비목_대분류, 업로드일시 desc);

comment on column app.project_evidence_files.업로더_인증 is
  'true = Supabase 세션으로 확인된 사용자. false = 로그인 게이트가 붙기 전에 올라간 파일이라 '
  '업로더를 신뢰할 수 없다는 뜻. 화면에 그대로 표시한다 — 숨기면 정산 근거가 흐려진다.';

grant select on app.evidence_requirements   to authenticated;
grant select on app.project_evidence_files  to authenticated;
grant all    on app.evidence_requirements   to service_role;
grant all    on app.project_evidence_files  to service_role;
grant all    on sequence app.evidence_requirements_id_seq  to service_role;
grant all    on sequence app.project_evidence_files_id_seq to service_role;

alter table app.evidence_requirements  enable row level security;
alter table app.project_evidence_files enable row level security;
drop policy if exists authenticated_read_evidence_requirements on app.evidence_requirements;
create policy authenticated_read_evidence_requirements
  on app.evidence_requirements for select to authenticated using (true);
drop policy if exists authenticated_read_project_evidence_files on app.project_evidence_files;
create policy authenticated_read_project_evidence_files
  on app.project_evidence_files for select to authenticated using (true);

-- ── 요건 시드 ───────────────────────────────────────────────────────────────
-- 출처 표기 원칙: 공고·고시에서 나온 것은 쪽수를, 회사 관행에서 나온 것은 그 폴더를 적는다.
--   [세트]  매그나텍 실제 제출 폴더의 파일 번호(1~7) — 02.회사데이터 2·3차년도 비목별 폴더
--           + 기술명세.md 「전형적 세트는 견적의뢰 → 견적서 → 지출결의서 → 발주서 → 거래명세표
--           → 세금계산서 → 검수조서」
--   [공고]  (제2026-57호) 2026년 지역혁신선도기업육성(R&D) [붙임3] 신청 방법 및 유의사항
--   [규정]  국가연구개발사업 연구개발비 사용 기준(과기부고시 제2025-9호) · 지역산업육성 기술개발사업 관리지침
insert into app.evidence_requirements
  (비목_대분류, 구분, 순번, 서류명, 필수여부, 개인정보포함, 원문, 출처)
values
  -- 연구시설·장비 및 재료비 — 물품 구매 세트. 실제 폴더에 번호가 그대로 있다.
  ('FACILITY','물품·용역',1,'견적의뢰서',   false,false,null,'매그나텍 제출 폴더 1번(견적의뢰) · 기술명세.md 전형적 세트'),
  ('FACILITY','물품·용역',2,'견적서',       true, false,null,'매그나텍 제출 폴더 2번 · 기술명세.md 전형적 세트'),
  ('FACILITY','물품·용역',3,'지출결의서',   true, false,null,'매그나텍 제출 폴더 3번 · 실제 폴더에서 지출결의서만 있는 건이 19건 나왔다(통합기능목록 B.5)'),
  ('FACILITY','물품·용역',4,'발주서',       true, false,null,'매그나텍 제출 폴더 4번 · 금액 없는 서류라 독립 건으로 세지 않는다(구현명세 §증빙 묶기)'),
  ('FACILITY','물품·용역',5,'거래명세서',   true, false,null,'매그나텍 제출 폴더 5번'),
  ('FACILITY','물품·용역',6,'세금계산서 또는 카드전표', true,false,null,'매그나텍 제출 폴더 6번 · 결제수단별 요건은 app.evidence_rules'),
  ('FACILITY','물품·용역',7,'검수조서',     true, false,null,'매그나텍 제출 폴더 7번 · 증빙 세트 7종 중 유일하게 우리가 만드는 서류(통합기능목록 B.5)'),
  ('FACILITY','장비',      8,'연구시설·장비 도입계획서', false,false,
   '연구개발계획서 [본문2]에 해당 연구시설·장비를 미등록한 경우 해당 연구시설·장비 도입 불인정 및 해당 구매비용을 삭감하며, 장비도입을 승인 받은 경우 연구시설·장비 도입계획서는 협약 시 제출',
   '(제2026-57호) 공고 유의사항 원문 — 파일분석_결과.md §1.8 불인정 규칙'),

  -- 연구활동비 — 물품·용역 세트 + 출장/회의
  ('ACTIVITY','물품·용역',2,'견적서',       true, false,null,'매그나텍 제출 폴더 2번(연구활동비 Adobe·NCT 건)'),
  ('ACTIVITY','물품·용역',3,'지출결의서',   true, false,null,'매그나텍 제출 폴더 3번'),
  ('ACTIVITY','물품·용역',4,'발주서',       true, false,null,'매그나텍 제출 폴더 4번'),
  ('ACTIVITY','물품·용역',5,'거래명세서',   true, false,null,'매그나텍 제출 폴더 5번'),
  ('ACTIVITY','물품·용역',6,'세금계산서 또는 카드전표', true,false,null,'매그나텍 제출 폴더 6번'),
  ('ACTIVITY','물품·용역',7,'검수조서',     true, false,null,'매그나텍 제출 폴더 7번'),
  ('ACTIVITY','출장',     11,'출장신청서',       true, false,null,'통합기능목록 B.5 증빙 양식 13종 · 매그나텍 회의비 및 출장 폴더'),
  ('ACTIVITY','출장',     12,'출장결과보고서',   true, false,null,'통합기능목록 B.5 · 매그나텍 출장보고서_231128_RCMS.pdf'),
  ('ACTIVITY','출장',     13,'출장 증빙 서류(교통·숙박 영수)', true,false,null,'매그나텍 제출 폴더 「4. 출장 증빙 서류 첨부」'),
  ('ACTIVITY','회의',     14,'회의록',           true, false,null,'통합기능목록 B.5 증빙 양식 13종'),
  ('ACTIVITY','회의',     15,'회의참석자명단',   true, false,null,'통합기능목록 B.5 증빙 양식 13종'),

  -- 인건비 — 개인정보가 걸리는 자리. 요건으로만 남기고 업로드는 막는다.
  ('PERSONNEL','급여',    1,'참여연구원 현황표', true, false,null,'매그나텍 인건비 폴더 「산학연 콜라보 본연구 참여연구원 현황표」'),
  ('PERSONNEL','급여',    2,'지출결의서',        true, false,null,'매그나텍 인건비 폴더 월별 지출결의서'),
  ('PERSONNEL','급여',    3,'참여율 변경 신청·승인서', false,false,null,'통합기능목록 B.5 증빙 양식 13종'),
  ('PERSONNEL','급여',    4,'급여이체증',        true, true,
   '인건비·학생인건비는 급여대장·이체증빙·원천징수·4대보험이 개인 급여를 그대로 드러낸다',
   'CLAUDE.md §5 절대규칙 5(인건비·개인정보는 항목 자체를 만들지 않는다) · 연습 기능명세 §인건비 제외 방침'),
  ('PERSONNEL','급여',    5,'4대보험 가입자명부', true, true,
   '개인별 가입 내역이 그대로 드러난다',
   'CLAUDE.md §5 절대규칙 5 · 매그나텍 인건비 폴더 「4대보험 가입자명부_230630.pdf」'),
  ('STUDENT','급여',      1,'참여연구원 현황표', true, false,null,'인건비와 같은 요건을 적용한다'),
  ('STUDENT','급여',      4,'급여이체증',        true, true,
   '학생인건비도 개인 급여를 드러낸다','CLAUDE.md §5 절대규칙 5'),

  -- 연구수당 · 간접비 — 산출근거가 증빙이다
  ('ALLOWANCE','산출근거',1,'연구수당 산출근거', true, false,
   '연구수당 계상 한도 : 연구개발기관 수정인건비 합(현금·현물 인건비, 학생인건비, 미지급 인건비 포함, 단 연구근접지원인력 인건비는 제외)의 20% 이내 계상 가능. 협약 체결 당시 계상한 금액보다 증액하여 계상 불가',
   '(제2026-57호) [붙임3] 신청 방법 및 유의사항 p.18'),
  ('ALLOWANCE','산출근거',2,'지급대장',          true, true,
   '개인별 지급액이 드러난다','CLAUDE.md §5 절대규칙 5 · 통합기능목록 B.5 증빙 양식 13종'),
  ('INDIRECT','산출근거', 1,'간접비 산출근거',   true, false,
   '(간접비) 영리기관인 연구개발기관의 간접비는 직접비(현물, 위탁연구개발비, 국제공동연구개발비 및 연구개발부담비 제외)의 10% 이내로 계상 가능',
   '(제2026-57호) [붙임3] 신청 방법 및 유의사항 p.18')
on conflict do nothing;

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- drop policy if exists authenticated_read_project_evidence_files on app.project_evidence_files;
-- drop policy if exists authenticated_read_evidence_requirements on app.evidence_requirements;
-- drop table if exists app.project_evidence_files;
-- drop table if exists app.evidence_requirements;
-- commit;
-- notify pgrst, 'reload schema';
-- ※ 버킷의 파일은 지워지지 않는다. storage 의 projects/<과제_id>/ 를 따로 정리해야 한다.
