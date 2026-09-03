-- 집행 건별 증빙 세트를 실무 이름·순서에 맞춘다. (2026-09-03 · mgnt2 나예찬, 사용자 지시)
--
-- 바뀌는 것
--   ① 견적서 → **구매의뢰서**  (집행단위 행 id 2 FACILITY · id 9 ACTIVITY)
--   ② 「세금계산서 또는 카드전표」 → **세금계산서**, 그리고 **집행단위로 켠다** (id 6 · id 13)
--
-- ②를 새 행으로 만들지 않은 이유: **이미 있던 행이다.** 순번 6 이라 정렬만으로
-- 거래명세서(5) 와 검수조서(7) **사이**에 들어간다. 새로 만들면 같은 서류가 두 줄이 되고
-- 계상 탭과 집행 탭이 서로 다른 이름으로 같은 것을 가리키게 된다.
--
-- 결제수단별 요건(카드 결제면 카드전표)은 `app.evidence_rules` 가 따로 들고 있고
-- 그 사실은 id 6 의 `출처` 에 적혀 있다 — 이름에서 빠져도 근거는 남는다.
--
-- 집행 건별 세트 (재료비 FACILITY · 활동비 ACTIVITY)
--   2 구매의뢰서 · 3 지출결의서 · 5 거래명세서 · 6 세금계산서 · 7 검수조서
--
-- `순번` 은 매그나텍 실제 제출 폴더 번호라 **지우지 않는다**(정렬과 폴더 대조에 쓴다).
-- 화면에만 안 보이게 했다 — `expense-evidence.tsx` · `evidence-attachments.tsx`.
-- DDL 은 없다. 값만 고친다.
--
-- ⚠ `app.project_evidence_files.요건_id` 는 id 로 걸려 있어 이름을 바꿔도 붙은 파일은 안 끊긴다
--    (실행 시점 업로드 0건).

begin;

update app.evidence_requirements
   set 서류명 = '구매의뢰서'
 where 서류명 = '견적서'
   and 집행단위;

update app.evidence_requirements
   set 서류명 = '세금계산서',
       집행단위 = true
 where 서류명 = '세금계산서 또는 카드전표'
   and 비목_대분류 in ('FACILITY', 'ACTIVITY')
   and 구분 = '물품·용역';

-- 확인: 집행 건별에 뜨는 세트가 비목마다 5줄인가
select 비목_대분류, 순번, 서류명, 필수여부
  from app.evidence_requirements
 where 집행단위
 order by 비목_대분류, 순번;

commit;

-- 되돌리기
--   update app.evidence_requirements set 서류명='견적서' where 서류명='구매의뢰서' and 집행단위;
--   update app.evidence_requirements set 서류명='세금계산서 또는 카드전표', 집행단위=false
--    where 서류명='세금계산서' and 비목_대분류 in ('FACILITY','ACTIVITY') and 구분='물품·용역';
