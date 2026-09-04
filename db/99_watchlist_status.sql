-- 관심 표시(watchlist)에 단계를 둔다: 관심 → 신청예정 → 신청완료.
-- 사용자 요청(2026-09-04): "목록에서 관심 공고, 신청 예정 구분할 수 있게 라벨 작업 및 필터".
-- 이후 요청(2026-09-04): "리스트에서 별을 누르면 관심 공고로 넘어가고, 상세 페이지에서
-- 신청 예정·신청 완료 버튼을 누르면 상태가 바뀌도록" — 신청완료 단계를 추가했다.
-- 종류가 늘어난 게 아니라, 이미 관심 표시한 공고 중 진짜 신청 진행 단계만 한 걸음씩
-- 더 표시하는 것뿐이다.
--
-- 적용: pg-meta 직접 실행(172.20.0.6:8080, supabase_admin) — mgnt3는 docker exec·psql 권한이 없다.
--   자세한 절차는 memory/solverton_pgmeta_direct_access.md 참고.
alter table app.watchlist
  add column if not exists 상태 text not null default '관심';

alter table app.watchlist drop constraint if exists watchlist_상태_check;
alter table app.watchlist
  add constraint watchlist_상태_check check (상태 in ('관심', '신청예정', '신청완료'));

notify pgrst, 'reload schema';
