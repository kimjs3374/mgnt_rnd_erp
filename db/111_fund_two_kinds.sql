-- 재원을 **현금 · 현물 둘로** 통일한다. 출연금을 없앤다. (2026-09-04 · mgnt2 나예찬, 사용자 지시)
--
-- 왜: 인건비 표는 이미 현금/현물 2분류인데(db/107) 계상 표만 3분류라 같은 「재원」이라는 말이
-- 화면마다 다른 것을 가리켰다. 사람이 매번 어느 쪽인지 다시 읽어야 한다.
--
-- ⚠ **CHECK 제약은 못 고친다.** `app.budgets` · `app.expenses` 소유자가 `supabase_admin` 이고
--    우리는 `rnd_dev` 다(`app.projects` 와 같다 — 팀메모리 `project-lead.md`).
--    그래서 제약은 `('출연금','현금','현물')` 그대로 두고 **값을 안 쓰는 쪽**으로 정리한다.
--    제약이 넓은 것은 문제가 아니다. 좁혀야 하면 김정수에게 부탁한다.
--
-- ⚠ **합계가 변하면 안 된다.** 출연금은 정부가 준 현금이라 현금에 **더한다**(이름만 바꾸는 게 아니다).
--    `(과제, 비목)` 에 현금 줄이 이미 있으면 UNIQUE 제약에 걸리므로 **더하고 지운다.** 14건이 그렇다.
--
-- ⚠ 잃는 것 하나: `lib/verify.ts` 의 「출연금 계상 = 협약 정부지원금」 대조가 없어진다.
--    이제 「현금 계상 = 정부지원금 + 기관부담 현금」으로 본다. **정부출연금만 따로 보는 일은
--    재원 구성 카드(`FundingShareCard`)가 계속 한다** — 거기가 원래 그 숫자를 만드는 자리다.

begin;

-- ① 같은 (과제, 비목) 에 현금 줄이 이미 있으면 **더한다.**
update app.budgets c
   set "배정액" = c."배정액" + g."배정액",
       "한도비율" = coalesce(c."한도비율", g."한도비율")
  from app.budgets g
 where g."재원구분" = '출연금'
   and c."재원구분" = '현금'
   and c."과제_id" = g."과제_id"
   and c."비목_대분류" = g."비목_대분류";

-- ② 현금 줄이 없던 것은 이름만 바꾼다(UNIQUE 에 안 걸린다).
update app.budgets b
   set "재원구분" = '현금'
 where b."재원구분" = '출연금'
   and not exists (
     select 1 from app.budgets c
      where c."과제_id" = b."과제_id"
        and c."비목_대분류" = b."비목_대분류"
        and c."재원구분" = '현금'
   );

-- ③ ①에서 이미 더해진 출연금 줄만 남는다. 지운다.
delete from app.budgets where "재원구분" = '출연금';

-- ④ 집행도 같은 어휘를 쓴다. 출연금으로 쓴 돈은 현금이다.
update app.expenses set "재원구분" = '현금' where "재원구분" = '출연금';

-- 확인 — 재원이 둘만 남고, 과제별 합계는 그대로여야 한다.
select "재원구분", count(*), sum("배정액") from app.budgets group by 1 order by 1;
select "과제_id", sum("배정액") as 합계 from app.budgets where "과제_id" in (2, 13) group by 1 order by 1;
select "재원구분", count(*) from app.expenses group by 1 order by 1;

commit;

-- 되돌리기: **없다.** 출연금과 기관부담 현금을 합쳐 버려서 어느 쪽이 얼마였는지 이 표만으로는
--   못 가른다. 되돌려야 하면 `projects.정부지원금` · `projects.기관부담_현금`(협약서 값)으로
--   다시 나눈다 — 그 둘은 안 건드렸다.
