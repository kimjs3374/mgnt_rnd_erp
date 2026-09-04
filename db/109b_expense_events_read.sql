-- 109b: 웹앱(authenticated 롤)이 이력을 읽을 수 있게 한다. 읽기만.
grant select on app.expense_events to authenticated, anon;
