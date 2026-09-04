-- 108: 재학습 스크립트(retrain.py)가 모델 이력을 남길 수 있게 한다.
-- 봇/재학습이 실제로 접속하는 롤은 rnd_mcp 다(rnd_dev 는 소유자).
-- 103_doc_read_learning.sql 에서 model_versions 에만 grant 가 빠져 있었다.
-- ※ 추가만 한다. 기존 테이블 구조는 건드리지 않는다.
grant select, insert, update on app.model_versions to rnd_mcp, rnd_dev;
grant usage, select on sequence app.model_versions_id_seq to rnd_mcp, rnd_dev;
