-- 연차를 회계연도 기준으로 맞춘다. (2026-09-03 · mgnt2 나예찬)
--
-- 연차는 회계연도(1/1~12/31)로 센다. 협약기간을 12로 나눈 값이 아니다.
--   2022-06-01 ~ 2024-05-31 → 기간은 2년이지만 2022 · 2023 · 2024 **3개 연차**다.
--   (1차 2022-06-01~12-31 · 2차 2023 한 해 · 3차 2024-01-01~05-31)
--
-- 시드가 12개월 나눗셈으로 들어가 있어서 3건이 하나씩 모자랐다:
--   id 3  RS-2023-00305514  2023-04-01~2025-03-31  2 → 3
--   id 9  RS-2024-00351902  2024-05-01~2026-04-30  2 → 3
--   id 13 RS-2022-00284460  2022-06-01~2024-05-31  2 → 3
--
-- 왜 지금 고치나: `bot/mcp_server.py` 가 이 컬럼을 읽어 「N차년도」로 답한다.
-- 화면은 기간에서 계산하지만(`lib/fiscal-year.ts`) 봇은 저장값을 그대로 말한다.
--
-- `app.projects.연차` 의 뜻은 **지금 몇 년차인가**다(끝난 과제면 마지막 연차).
-- 그래서 current_date 를 협약기간 안으로 끌어와 시작연도와 뺀다.
-- ⚠ 값이 오늘 기준이라 해가 바뀌면 다시 돌려야 맞는다. 화면이 계산값을 쓰는 이유가 이것이다.
--   DDL 은 없다. 값만 고친다.

begin;

update app.projects p
   set 연차 = greatest(
         1,
         extract(year from least(greatest(current_date, p.시작일), p.종료일))::int
       - extract(year from p.시작일)::int + 1
       )
 where p.시작일 is not null
   and p.종료일 is not null
   and p.종료일 >= p.시작일;

-- 확인: 바뀐 것만 보인다
select id, 과제코드, 시작일, 종료일, 연차,
       extract(year from 종료일)::int - extract(year from 시작일)::int + 1 as 총연차
  from app.projects
 order by id;

commit;

-- 되돌리기 (시드 원래 값)
--   update app.projects set 연차 = 2 where id in (3, 9, 13);
