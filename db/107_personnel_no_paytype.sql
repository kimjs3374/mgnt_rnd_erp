-- =============================================================================
-- 107_personnel_no_paytype.sql — 인건비 계상에서 「지급구분」을 뺀다. 재원구분(현금/현물) 하나로.
--
--   무엇을 바꾸나
--     `app.personnel_costs.지급구분`(지급/미지급)을 지운다. 재원구분(현금/현물)만 남긴다.
--     **사용자 지시(2026-09-04)** — "지급 미지급은 지우고 현금 현물로 두 개로만 나눠줘.
--     어차피 출연금은 다 현금이니까." 지급=현금·미지급=현물 이 1:1로 맞물려 있었으니,
--     지급구분을 없애도 재원구분 값 자체는 그대로 남는다(둘 다 이미 DB 에 저장돼 있다).
--
--   놓친 예외 하나 — 알고 결정한 것이다
--     `기본재원()`(lib/personnel.ts)은 지급이어도 재원을 「출연금」으로 직접 고칠 수 있는
--     예외(신규채용 인건비를 정부출연금에서 바로 지급하는 경우)를 열어 뒀었다. 사용자가
--     "출연금은 다 현금"이라고 정리했으므로, 이제 인건비 입력에서는 **현금·현물 둘만** 고른다.
--     그 인건비가 정부출연금 재원인지 민간현금 재원인지는 **연구비 계상(BudgetEditor)** 쪽의
--     PERSONNEL 비목 줄에서 이미 재원구분(출연금·현금·현물) 셋 중 골라 배정하므로, 개인별
--     인건비 표 단계에서 그 구분까지 강제할 필요가 없다 — 거기서 다시 정해진다.
--
--   ⚠ `app.projects` 와 달리 이 테이블은 우리가 만들었다(소유자 rnd_dev) — ALTER 가 된다.
--     추가만 하는 규칙은 여기선 「고치는 것」이라 예외다. 우리가 만든 지 하루 안 된 표라
--     아직 아무 데도 이 컬럼을 참조하는 리포트·엑셀이 굳어 있지 않다(이 커밋에서 같이 고친다).
--
--   적용: cd /web/rnd && ./db/psql.sh -f db/107_personnel_no_paytype.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

alter table app.personnel_costs drop constraint if exists personnel_costs_지급구분_chk;
alter table app.personnel_costs drop column if exists 지급구분;

alter table app.personnel_costs drop constraint if exists personnel_costs_재원구분_chk;
alter table app.personnel_costs
  add constraint personnel_costs_재원구분_chk check (재원구분 in ('현금', '현물'));

alter table app.personnel_costs alter column 재원구분 set default '현물';

comment on column app.personnel_costs.재원구분 is
  '현금 = 실제 급여이체(현금 지출) · 현물 = 기관부담 현물(급여이체 없이 참여로만 잡음). '
  '정부출연금 재원인지 민간현금 재원인지는 여기서 정하지 않는다 — 연구비 계상(budgets)의 '
  'PERSONNEL 줄에서 출연금·현금·현물 세 갈래로 다시 배정한다.';

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- alter table app.personnel_costs drop constraint if exists personnel_costs_재원구분_chk;
-- alter table app.personnel_costs
--   add constraint personnel_costs_재원구분_chk check (재원구분 in ('출연금','현금','현물'));
-- alter table app.personnel_costs add column if not exists 지급구분 text not null default '미지급';
-- alter table app.personnel_costs
--   add constraint personnel_costs_지급구분_chk check (지급구분 in ('지급','미지급'));
-- -- 되돌릴 때 지급구분을 재원구분에서 역산해 채운다(현금→지급, 현물→미지급).
-- update app.personnel_costs set 지급구분 = case when 재원구분 = '현금' then '지급' else '미지급' end;
-- commit;
-- notify pgrst, 'reload schema';
