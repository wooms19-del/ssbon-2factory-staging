-- 잘못 저장된 부위 번호 정정
--
-- sync/common.py 의 PART 가 {"홍두깨":1,"설도":2,"우둔":3,"설깃":4} 로
-- 손으로 적혀 있었다. 그런데 item_master 가 ERP 코드순으로 정렬되면서
-- 3번 자리에 프리미엄진간장, 4번 자리에 정백당이 들어갔고
-- 우둔은 24번으로 밀렸다. 설깃은 아예 등록되지 않았다.
--
-- 그래서 우둔 작업이 진간장으로, 설깃 작업이 정백당으로 기록됐다.
-- 대상: 2026-04-09 ~ 05-19 우둔, 2026-07-31 설깃
--
-- 코드는 이제 마스터에서 번호를 읽어 오므로 앞으로는 생기지 않는다.
-- 이 파일은 이미 들어간 데이터를 되돌리는 용도다. 한 번만 실행하면 된다.

BEGIN;

-- 실행 전 확인용. 몇 건이 바뀌는지 본다.
--   SELECT 'thaw_cart' t, part_id, count(*) FROM thaw_cart WHERE part_id IN (3,4) GROUP BY 1,2
--   UNION ALL SELECT 'shredding_run', part_id, count(*) FROM shredding_run WHERE part_id IN (3,4) GROUP BY 1,2
--   UNION ALL SELECT 'packing_part', part_id, count(*) FROM packing_part WHERE part_id IN (3,4) GROUP BY 1,2;

-- 우둔: 3 → item_master 의 실제 우둔 번호
UPDATE thaw_cart      SET part_id = (SELECT item_id FROM item_master WHERE category='원육' AND part='우둔')
WHERE part_id = 3;
UPDATE shredding_run  SET part_id = (SELECT item_id FROM item_master WHERE category='원육' AND part='우둔')
WHERE part_id = 3;
UPDATE preprocess_run SET part_id = (SELECT item_id FROM item_master WHERE category='원육' AND part='우둔')
WHERE part_id = 3;
UPDATE cooking_run    SET part_id = (SELECT item_id FROM item_master WHERE category='원육' AND part='우둔')
WHERE part_id = 3;
UPDATE meat_box       SET part_id = (SELECT item_id FROM item_master WHERE category='원육' AND part='우둔')
WHERE part_id = 3;
UPDATE packing_part   SET part_id = (SELECT item_id FROM item_master WHERE category='원육' AND part='우둔')
WHERE part_id = 3;

-- 설깃: item_master 에 없다. 지우면 실적이 사라지므로 그대로 두고 목록만 남긴다.
-- 등록 후 아래를 실행할 것.
--   INSERT INTO item_master (erp_code, name, category, part, unit, no_meat)
--   VALUES ('100002', '냉동_쇠고기_설깃_외국산', '원육', '설깃', 'KG', false);
--   UPDATE thaw_cart      SET part_id = (SELECT item_id FROM item_master WHERE part='설깃') WHERE part_id = 4;
--   UPDATE shredding_run  SET part_id = (SELECT item_id FROM item_master WHERE part='설깃') WHERE part_id = 4;
--   UPDATE packing_part   SET part_id = (SELECT item_id FROM item_master WHERE part='설깃') WHERE part_id = 4;

COMMIT;

-- 실행 후 확인
--   SELECT part_id, count(*) FROM thaw_cart GROUP BY 1 ORDER BY 1;
--   남아 있는 3번이 없어야 하고, 4번(설깃)은 등록 전까지 남는다.
