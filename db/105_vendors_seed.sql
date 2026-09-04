-- 거래처 사전 — 사내 실데이터 772파일에서 추출 (LLM 0회)
-- 사업자번호는 체크섬 통과분만. 자사번호는 제외.
-- 상호는 폴더명(회사가 실제로 쓰는 이름)이고, 비목은 그 폴더의 최빈 비목이다.
begin;
insert into app.vendors (업체명, 사업자번호) values ('나비엠알오', '1198666372')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('MTI코리아', '6428102515')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('한국자동차연구원', '3128204676')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('선일상사', '1191262526')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('알파', '2590951818')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('테이팩스', '1248547496')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('네이버파이넨셜', '6664900212')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('에너에버배터리솔루션(주)', '1318636918')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('(주)엠디브로스', '1098625113')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('엠에이치네트웍스', '7408802652')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('주식회사 엔캠', '3048125799')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('충남TP', '3128206577')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('한국고분자시험연구소', '5438600802')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('아이퍼스(특허)', '2208855844')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('(주)나비엠알오', '1198666372')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('(주)천보', '3038149444')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('(주)천보신소재', '2688700567')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('(주)코리아사이언스', '1388197298')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('광주목금형시스템', '4091905349')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('켐트레이딩', '4388600908')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('라이노화학', '1078688859')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('포스코퓨처엠', '5068101452')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('아이퍼스', '2208855844')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
insert into app.vendors (업체명, 사업자번호) values ('자유환경', '7258101558')
  on conflict (사업자번호) do update set 업체명 = excluded.업체명;
commit;
notify pgrst, 'reload schema';
