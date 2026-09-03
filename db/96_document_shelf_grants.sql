-- =============================================================================
-- 96_document_shelf_grants.sql — 서류함 뷰 권한
--
--   93/94 를 만들 때 GRANT 를 빼먹어 웹앱이 403 을 받았다:
--     permission denied for view v_document_shelf
--
--   ⚠ 이건 조용한 실패가 아니라 **눈에 보이는 실패인데 원인이 엉뚱한 곳처럼 보인다** —
--     화면은 200 으로 뜨고 표만 「0종」으로 비어 있다. 데이터가 없는 것처럼 보인다.
--
--   왜 필요한가: 웹앱은 service_role 로 붙고(lib/db.ts), 로그인이 붙으면 authenticated 로
--   읽는다. 기존 뷰(v_document_status·v_announcement_board)는 supabase_admin 이 만들어서
--   그 권한이 이미 붙어 있었다. 93/94 는 내가 postgres 로 만들어 rnd_dev 만 들어갔다.
--
--   **앞으로 app 스키마에 뷰를 만들면 이 GRANT 를 같이 쓴다.**
--
-- 적용: sudo docker exec -i rnd-db psql -U postgres -d postgres < db/96_document_shelf_grants.sql
-- =============================================================================

begin;

grant select on app.v_document_shelf   to service_role, authenticated, anon;
grant select on app.v_doc_requirement  to service_role, authenticated, anon;
grant select on app.v_doc_unmatched    to service_role, authenticated, anon;

-- anon 은 읽기만 준다. 로그인 게이트가 붙기 전까지 화면이 열려야 하고,
-- 서류함은 발급일·종류만 담아 개인정보가 없다(CLAUDE.md §2-6).
-- 쓰기는 서버 액션(service_role)만 한다.

commit;

notify pgrst, 'reload schema';
