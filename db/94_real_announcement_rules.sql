-- =============================================================================
-- 94_real_announcement_rules.sql — 재원 분담 규칙의 근거를 **실제 공고문 원문**으로 바꾼다
--
--   왜: 93_ 에서 넣은 규정 기본값은 팀 문서(파일분석_결과.md 요약)를 근거로 달고 있었다.
--       공고 원문 파일을 확보했으므로 **원문 조항을 그대로 인용**하고, 그 공고를 과제에 연결한다.
--       더미로 지어낸 값이 하나도 없어야 화면의 「근거」가 근거로 쓰인다.
--
--   원본 파일 (서버, .gitignore 대상 — 1.4MB PDF 를 저장소에 넣지 않는다)
--     data/real/공고규정/ann-2026-57.hwpx         2026년 지역혁신선도기업육성(R&D) 시행계획 공고 (제2026-57호)
--     data/real/공고규정/ann-2026-57-notice.hwp   [붙임3] (필독) 신청 방법 및 유의사항  ← 계상 규정이 여기 있다
--     data/real/공고규정/rule-06-mgmt-guideline.pdf  지역산업육성 기술개발사업 관리지침
--     data/real/공고규정/rule-07-cost-standard.pdf   국가연구개발사업 연구개발비 사용 기준(과기부고시 제2025-9호)
--   추출 방법: `node scripts/parse-doc.mjs <파일> --grep <키워드>`
--     (rhwp `getPageTextLayout` + 좌표로 표 복원. `getPageText` 는 표를 빠뜨린다 — CLAUDE.md §4)
--
--   ⚠ 인용은 쪽수까지 남긴다. 심사 「데이터·개방성·재현성」이 출처·재현성을 본다.
--   설계 원칙: 추가·수정만. 삭제 없음.
--   적용:     cd /web/rnd && ./db/psql.sh -f db/94_real_announcement_rules.sql
--   되돌리기: 파일 맨 아래
-- =============================================================================

begin;

-- ── ① 실제 공고를 공고 대장에 넣는다 ────────────────────────────────────────
-- 접수기간은 원문 p.6 「신청․접수기간 : `26. 2. 11.(수) ~ 3. 3.(화) 18:00 까지」
-- 지원규모는 원문 p.2 「총 734.3억원(국비) 내외」
insert into app.announcements
  (출처, 출처_id, 사업명, 소관부처, 지역, 접수시작, 접수종료, 마감유형,
   공고문_파일명, 사업유형, 요약, 파싱상태)
values
  ('공고문', '제2026-57호',
   '2026년 지역혁신선도기업육성(R&D) 시행계획 공고', '중소벤처기업부', '광주',
   '2026-02-11', '2026-03-03', 'dated',
   'ann-2026-57.hwpx', 'NATIONAL_RND',
   '총 734.3억원(국비) 내외 · 접수창구 smtech.go.kr · 계상 규정은 [붙임3] 신청 방법 및 유의사항 p.18·p.31 · 원문 data/real/공고규정/',
   '파싱완료')
on conflict (출처, 출처_id) do update
  set 접수시작 = excluded.접수시작,
      접수종료 = excluded.접수종료,
      공고문_파일명 = excluded.공고문_파일명,
      요약 = excluded.요약,
      파싱상태 = excluded.파싱상태;

-- ── ② 과제에 사업유형·공고를 붙인다 ────────────────────────────────────────
-- 사업유형은 전부 국가 R&D 다(과제코드가 RS- 로 시작한다). 라벨이 비어 있으면 규칙도 못 고른다.
update app.projects
   set 사업유형 = 'NATIONAL_RND'
 where 과제코드 like 'RS-%' and 사업유형 is null;

-- ⚠ 공고 연결은 **P01 한 건만** 한다. 시드 과제 12건은 각자 다른 공고에서 왔을 텐데
--   전부 이 공고에 묶으면 그것 자체가 지어낸 데이터가 된다.
--   P01 은 공고 근거로, 나머지는 규정 기본값으로 판정된다 — 우선순위가 화면에서 그대로 보인다.
update app.projects p
   set 공고_id = a.id
  from app.announcements a
 where a.출처 = '공고문' and a.출처_id = '제2026-57호'
   and p.과제코드 = 'RS-2025-00410021'
   and p.공고_id is null;

-- ── ③ 한도 컬럼 추가 — 공고 p.18 에 네 가지가 같이 적혀 있다 ───────────────
alter table app.funding_share_rules
  add column if not exists 연구수당_상한     numeric,  -- 수정인건비 합 대비 %
  add column if not exists 위탁_상한         numeric,  -- 직접비(현물포함) − 위탁·국제공동·부담비 대비 %
  add column if not exists 외부기술활용_상한 numeric;  -- 직접비(현물 포함) 대비 %

comment on column app.funding_share_rules.연구수당_상한 is
  '공고 p.18 「연구수당 계상 한도 : 수정인건비 합(현금·현물 인건비, 학생인건비, 미지급 인건비 포함, '
  '단 연구근접지원인력 인건비는 제외)의 20% 이내」. 계상 검증은 lib/verify.ts 가 budgets.한도비율 로 한다.';

-- ── ④ 규정 기본행의 근거를 공고 원문으로 교체 ──────────────────────────────
update app.funding_share_rules set
  원문 = '[붙임3] p.31 <영리기관 유형에 따른 기관부담연구개발비 산정 요약> 중소기업 | 정부·지자체 지원연구개발비 비율 75% 이내 | 기관부담연구개발비 중 현금 비중 10% 이상. '
        || 'p.31 예시: 기관부담연구개발비 총 연구개발비의 25% 이상 · 기업 부담 현금 기관부담연구개발비의 10% 이상 · 기업 부담 현물 기관부담연구개발비의 90% 이하. '
        || 'p.18 (간접비) 영리기관의 간접비는 직접비(현물, 위탁연구개발비, 국제공동연구개발비 및 연구개발부담비 제외)의 10% 이내로 계상 가능.',
  출처 = '(제2026-57호) 2026년 지역혁신선도기업육성(R&D) [붙임3] 신청 방법 및 유의사항 p.18·p.31 — 원본 data/real/공고규정/ann-2026-57-notice.hwp',
  상태 = '확정', confidence = 1.000,
  연구수당_상한 = 20, 위탁_상한 = 40, 외부기술활용_상한 = 40
where 기관유형 = '중소기업' and 사업유형 is null and announcement_id is null;

update app.funding_share_rules set
  원문 = '[붙임3] p.31 <영리기관 유형에 따른 기관부담연구개발비 산정 요약> 비영리기관 | 정부·지자체 지원연구개발비 비율 100% | 기관부담연구개발비 중 현금 비중 -(없음).',
  출처 = '(제2026-57호) [붙임3] 신청 방법 및 유의사항 p.31 — 원본 data/real/공고규정/ann-2026-57-notice.hwp',
  상태 = '확정', confidence = 1.000, 연구수당_상한 = 20
where 기관유형 = '비영리' and 사업유형 is null and announcement_id is null;

-- 중견·대기업·대학·출연연은 **이 공고 표에 없다.** 팀 문서 표가 유일한 근거라 「제안」을 유지하고
-- 무엇을 확인해야 하는지 원문에 적어 둔다 — 「모르면 모른다고 한다」(설계원칙 5).
update app.funding_share_rules set
  원문 = 원문 || ' ⚠ 이 유형은 (제2026-57호) 공고 p.31 표에 없다. 공고 p.31 이 「국가연구개발혁신법 시행령 <별표 1>을 참고」로 넘기므로 그 별표로 확인해야 확정할 수 있다.',
  출처 = 출처 || ' + (제2026-57호) [붙임3] p.31 에는 해당 유형 없음'
where 기관유형 in ('중견기업','대기업','대학','출연연') and announcement_id is null
  and 원문 not like '%별표 1%';

-- ── ⑤ 공고 전용 규칙 — 규정 기본행을 이긴다 ────────────────────────────────
-- 값은 기본행과 같지만 **근거가 공고 그 자체**다. P01 은 이 행으로 판정되고 화면에 「공고 규칙」이 뜬다.
insert into app.funding_share_rules
  (기관유형, 사업유형, announcement_id, 정부출연_상한, 민간현금_최소, 민간현물_최대, 간접비_상한,
   연구수당_상한, 위탁_상한, 외부기술활용_상한, 절사단위, 원문, 출처, 상태, confidence)
select '중소기업', 'NATIONAL_RND', a.id, 75, 10, 90, 10, 20, 40, 40, 3,
  '정부·지자체 지원연구개발비 비율 75% 이내 · 기관부담연구개발비 중 현금 10% 이상 · 현물 90% 이하 '
  || '(p.31) · 연구수당 수정인건비 합의 20% 이내, 협약 당시보다 증액 불가(p.18) · 간접비 직접비(현물·위탁·'
  || '국제공동·부담비 제외)의 10% 이내(p.18) · 위탁연구개발비 40% 이내(p.18).',
  '이 과제의 공고 원문 — (제2026-57호) [붙임3] 신청 방법 및 유의사항 p.18·p.31',
  '확정', 1.000
from app.announcements a
where a.출처 = '공고문' and a.출처_id = '제2026-57호'
on conflict do nothing;

commit;

notify pgrst, 'reload schema';

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- begin;
-- delete from app.funding_share_rules where announcement_id is not null;
-- update app.projects set 공고_id = null where 과제코드 = 'RS-2025-00410021';
-- update app.projects set 사업유형 = null where 과제코드 like 'RS-%';
-- delete from app.announcements where 출처 = '공고문' and 출처_id = '제2026-57호';
-- alter table app.funding_share_rules
--   drop column if exists 연구수당_상한,
--   drop column if exists 위탁_상한,
--   drop column if exists 외부기술활용_상한;
-- commit;
-- notify pgrst, 'reload schema';
