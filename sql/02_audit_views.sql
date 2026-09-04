-- 데이터 점검 뷰
--
-- 화면이 이 뷰들을 그냥 조회하면 된다. 스크립트를 돌릴 때만 확인되는 것이
-- 아니라, 누가 어떻게 데이터를 넣든 항상 현재 상태를 비춘다.
--
-- 온프레미스로 옮겨도 DB 안에 있으므로 그대로 따라간다.


-- ─────────────────────────────────────────────────────────────
-- 1. 부위 배분 점검
--
-- 날짜·부위별로 "포장이 받은 양"과 "파쇄가 내보낸 양(세척 후)"을 비교한다.
-- 대차 판정이 한쪽 부위로 몰리거나 새면 여기서 드러난다.
--
-- 대차 번호는 한정돼 있어 하루에 재사용된다. 한 포장이 같은 번호를 두 번
-- 받으면 입력이 합산돼 저장되므로 두 부위에 걸친 양이 한쪽으로 몰린다.
-- 그 경우를 잡아내는 것이 이 뷰의 주 목적이다.
--
-- 이월·잔여로 어긋나는 것은 정상이다. 판정 기준은 아래 audit_part_alloc 에서
-- 정하며, 2026-04 ~ 09 실적으로는 5% 기준에서 0건이었다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_part_flow AS
WITH packed AS (
    SELECT r.work_date,
           p.part_id,
           SUM(p.input_kg) AS packed_kg
    FROM packing_part p
    JOIN packing_run  r  ON r.pk_id = p.pk_id
    JOIN item_master  pm ON pm.item_id = p.part_id AND pm.category = '원육'
    WHERE p.input_kg IS NOT NULL
    GROUP BY r.work_date, p.part_id
),
shredded AS (
    SELECT s.work_date,
           s.part_id,
           SUM(COALESCE(s.washed_kg, s.output_kg)) AS shredded_kg
    FROM shredding_run s
    JOIN item_master im ON im.item_id = s.part_id AND im.category = '원육'
    GROUP BY s.work_date, s.part_id
)
SELECT COALESCE(pk.work_date, sh.work_date)        AS work_date,
       COALESCE(pk.part_id,   sh.part_id)          AS part_id,
       im.name                                     AS part_name,
       COALESCE(pk.packed_kg,   0)::numeric(12,2)  AS packed_kg,
       COALESCE(sh.shredded_kg, 0)::numeric(12,2)  AS shredded_kg,
       (COALESCE(pk.packed_kg,0) - COALESCE(sh.shredded_kg,0))::numeric(12,2) AS diff_kg,
       CASE WHEN COALESCE(sh.shredded_kg,0) > 0
            THEN ROUND((COALESCE(pk.packed_kg,0) - sh.shredded_kg)
                       / sh.shredded_kg * 100, 1)
       END                                         AS diff_pct
FROM packed pk
FULL JOIN shredded sh
       ON sh.work_date = pk.work_date AND sh.part_id = pk.part_id
LEFT JOIN item_master im ON im.item_id = COALESCE(pk.part_id, sh.part_id);


-- 편차가 큰 것만. 화면은 이 뷰의 건수만 보면 된다.
CREATE OR REPLACE VIEW audit_part_alloc AS
SELECT work_date, part_id, part_name, packed_kg, shredded_kg, diff_kg, diff_pct
FROM v_part_flow
WHERE shredded_kg > 0
  AND ABS(diff_pct) > 5
ORDER BY work_date DESC, ABS(diff_pct) DESC;


-- ─────────────────────────────────────────────────────────────
-- 2. 부위 미판정 점검
--
-- 고기 제품인데 부위가 안 붙은 포장. 근거를 못 찾아 비워 둔 건이다.
-- 추측으로 채우지 않으므로 여기 남는다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW audit_part_missing AS
SELECT r.work_date,
       r.pk_id,
       im.name AS product_name,
       r.ea
FROM packing_run r
JOIN item_master im ON im.item_id = r.product_id
LEFT JOIN packing_part p ON p.pk_id = r.pk_id
WHERE p.pk_id IS NULL
  AND COALESCE(im.no_meat, false) = false
ORDER BY r.work_date DESC;


-- ─────────────────────────────────────────────────────────────
-- 3. 수율 점검
--
-- 원육은 해동한 날과 그것으로 생산하는 날이 다르다(이월). 그래서 하루 단위로
-- 원육 대비 수율을 보면 이월이 큰 날마다 튄다. 실제로 2026-07-02 는 원육
-- 206kg 에 코스트코 24,698개가 잡혀 수율 694% 로 보이지만 오류가 아니다.
--
-- 따라서 월 단위로 본다. 한 달이면 이월이 서로 상쇄된다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_monthly_yield AS
WITH rawmeat AS (
    -- thaw_cart.part_id 에 조미료가 섞여 들어온 사례가 있어 원육만 본다
    SELECT date_trunc('month', t.finish_date)::date AS ym,
           t.part_id,
           SUM(t.total_kg) AS raw_kg
    FROM thaw_cart t
    JOIN item_master im ON im.item_id = t.part_id AND im.category = '원육'
    WHERE t.finish_date IS NOT NULL
    GROUP BY 1, 2
),
prod AS (
    SELECT date_trunc('month', r.work_date)::date AS ym,
           p.part_id,
           SUM(p.ea * COALESCE(im.unit_weight_g, 0) / 1000.0) AS product_kg
    FROM packing_part p
    JOIN packing_run  r  ON r.pk_id  = p.pk_id
    JOIN item_master  pm ON pm.item_id = p.part_id AND pm.category = '원육'
    LEFT JOIN item_master im ON im.item_id = p.item_id
    GROUP BY 1, 2
)
SELECT COALESCE(r.ym, p.ym)                      AS ym,
       COALESCE(r.part_id, p.part_id)            AS part_id,
       im.name                                   AS part_name,
       COALESCE(r.raw_kg,     0)::numeric(12,2)  AS raw_kg,
       COALESCE(p.product_kg, 0)::numeric(12,2)  AS product_kg,
       CASE WHEN COALESCE(r.raw_kg,0) > 0
            THEN ROUND(COALESCE(p.product_kg,0) / r.raw_kg * 100, 1)
       END                                       AS yield_pct
FROM rawmeat r
FULL JOIN prod p ON p.ym = r.ym AND p.part_id = r.part_id
LEFT JOIN item_master im ON im.item_id = COALESCE(r.part_id, p.part_id);


-- 월 수율이 상식 범위를 벗어난 것.
-- 다만 해동만 하고 다음 달로 넘긴 양이 많으면 수율이 낮게, 지난달 것을 당겨
-- 쓰면 높게 나온다. 그건 오류가 아니므로 파쇄량과 견줘 이월이 큰 달은 뺀다.
CREATE OR REPLACE VIEW audit_yield AS
WITH shred AS (
    SELECT date_trunc('month', work_date)::date AS ym,
           part_id,
           SUM(COALESCE(washed_kg, output_kg)) AS shredded_kg
    FROM shredding_run
    WHERE part_id IS NOT NULL
    GROUP BY 1, 2
)
SELECT y.ym, y.part_id, y.part_name, y.raw_kg, y.product_kg, y.yield_pct,
       s.shredded_kg::numeric(12,2) AS shredded_kg
FROM v_monthly_yield y
LEFT JOIN shred s ON s.ym = y.ym AND s.part_id = y.part_id
WHERE y.raw_kg > 500
  AND y.product_kg > 0
  AND (y.yield_pct < 30 OR y.yield_pct > 80)
  -- 이월 판단: 그 달 해동량과 파쇄량이 20% 넘게 벌어지면 이월로 보고 제외
  AND (s.shredded_kg IS NULL
       OR ABS(y.raw_kg - s.shredded_kg) / y.raw_kg < 0.20)
ORDER BY y.ym DESC;


-- ─────────────────────────────────────────────────────────────
-- 4. 점검 요약 — 화면이 이 한 줄만 읽으면 된다
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW audit_summary AS
SELECT (SELECT COUNT(*) FROM audit_part_alloc)   AS part_alloc,
       (SELECT COUNT(*) FROM audit_part_missing) AS part_missing,
       (SELECT COUNT(*) FROM audit_yield)        AS yield_odd,
       (SELECT COUNT(*) FROM audit_part_alloc)
     + (SELECT COUNT(*) FROM audit_part_missing)
     + (SELECT COUNT(*) FROM audit_yield)        AS total;
