-- 순수본 2공장 생산관리 스키마
-- 운영 중인 Supabase 에서 역으로 뽑아낸 정의다.
-- 온프레미스 PostgreSQL 에 그대로 실행해 같은 구조를 만들 수 있다.
--
-- 주의: 컬럼과 타입은 실제 데이터에서 확인한 것이고,
--       기본키·외래키·인덱스는 API 로 조회할 수 없어 명명 규칙과
--       sync/run.py 의 upsert 키로 추정했다. 아래 표시를 확인할 것.

CREATE TABLE item_master (
    item_id            bigserial,
    erp_code           text NOT NULL,
    name               text NOT NULL,
    category           text NOT NULL,
    part               text,
    unit               text NOT NULL,
    product_group      text,
    unit_weight_g      integer,
    capa               numeric,
    pallet_box         integer,
    sauce_name         text,
    sub_name           text,
    no_meat            boolean NOT NULL,
    ea_per_pack        integer,
    ea_per_box         integer,
    product_weight_g   integer,
    PRIMARY KEY (item_id)
);

CREATE TABLE worker (
    worker_id          bigserial,
    name               text NOT NULL,
    role               text NOT NULL,
    active             boolean NOT NULL,
    PRIMARY KEY (worker_id)
);

CREATE TABLE meat_box (
    box_id             bigserial,
    scan_date          date NOT NULL,
    part_id            integer NOT NULL,
    origin_id          integer NOT NULL,
    weight_kg          numeric NOT NULL,
    import_code        text NOT NULL,
    trace_code         text NOT NULL,
    pack_date          date,
    expiry_date        date,
    rf_start           text,
    rf_end             text,
    status             text NOT NULL,
    reject_reason      text NOT NULL,
    src_key            text NOT NULL,
    PRIMARY KEY (box_id)
);
CREATE UNIQUE INDEX meat_box_uk ON meat_box (src_key);   -- sync upsert 키

CREATE TABLE thaw_cart (
    cart_id            bigserial,
    cart_no            text NOT NULL,
    start_date         date NOT NULL,
    finish_date        date NOT NULL,
    part_id            integer NOT NULL,
    box_count          integer NOT NULL,
    total_kg           numeric NOT NULL,
    remain_kg          numeric,
    start_time         timestamptz,
    end_time           timestamptz NOT NULL,
    src_key            text NOT NULL,
    PRIMARY KEY (cart_id)
);
CREATE UNIQUE INDEX thaw_cart_uk ON thaw_cart (src_key);   -- sync upsert 키

CREATE TABLE thaw_cart_box (
    cart_id            integer NOT NULL,
    box_id             integer NOT NULL,
    PRIMARY KEY (cart_id, box_id)
);

CREATE TABLE preprocess_run (
    pp_id              bigserial,
    work_date          date NOT NULL,
    cage_no            text NOT NULL,
    part_id            integer NOT NULL,
    input_kg           numeric,
    waste_kg           numeric,
    workers            integer,
    start_time         timestamptz,
    end_time           timestamptz,
    src_key            text NOT NULL,
    output_kg          numeric NOT NULL,
    PRIMARY KEY (pp_id)
);
CREATE UNIQUE INDEX preprocess_run_uk ON preprocess_run (src_key);   -- sync upsert 키

CREATE TABLE preprocess_source (
    pp_id              integer NOT NULL,
    cart_id            integer NOT NULL,
    used_kg            numeric NOT NULL,
    PRIMARY KEY (pp_id, cart_id)
);

CREATE TABLE cooking_run (
    ck_id              bigserial,
    work_date          date NOT NULL,
    tank_no            text NOT NULL,
    cage_no            text NOT NULL,
    part_id            integer NOT NULL,
    input_kg           numeric,
    output_kg          numeric NOT NULL,
    workers            integer NOT NULL,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz NOT NULL,
    note               text,
    src_key            text NOT NULL,
    PRIMARY KEY (ck_id)
);
CREATE UNIQUE INDEX cooking_run_uk ON cooking_run (src_key);   -- sync upsert 키

CREATE TABLE cooking_wagon (
    ck_id              integer NOT NULL,
    wagon_no           text NOT NULL,
    kg                 numeric NOT NULL,
    direction          text NOT NULL,
    PRIMARY KEY (ck_id, wagon_no, direction)
);

CREATE TABLE shredding_run (
    sh_id              bigserial,
    work_date          date NOT NULL,
    part_id            integer,
    input_kg           numeric,
    washed_kg          text,
    output_kg          numeric NOT NULL,
    waste_kg           numeric NOT NULL,
    workers            integer NOT NULL,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz NOT NULL,
    src_key            text NOT NULL,
    PRIMARY KEY (sh_id)
);
CREATE UNIQUE INDEX shredding_run_uk ON shredding_run (src_key);   -- sync upsert 키

CREATE TABLE shredding_wagon (
    sh_id              integer NOT NULL,
    wagon_no           text NOT NULL,
    kg                 numeric NOT NULL,
    direction          text NOT NULL,
    PRIMARY KEY (sh_id, wagon_no, direction)
);

CREATE TABLE sauce_batch (
    sauce_id           bigserial,
    work_date          date NOT NULL,
    tank_no            text NOT NULL,
    recipe_id          text,
    kg                 numeric NOT NULL,
    note               text,
    src_key            text NOT NULL,
    sauce_name         text NOT NULL,
    PRIMARY KEY (sauce_id)
);
CREATE UNIQUE INDEX sauce_batch_uk ON sauce_batch (src_key);   -- sync upsert 키

CREATE TABLE packing_run (
    pk_id              bigserial,
    work_date          date NOT NULL,
    product_id         integer,
    machine_no         text NOT NULL,
    ea                 integer NOT NULL,
    defect             integer NOT NULL,
    pouch              integer NOT NULL,
    sauce_kg           numeric,
    sub_name           text,
    sub_kg             numeric,
    workers            integer,
    start_time         timestamptz,
    end_time           timestamptz,
    src_key            text NOT NULL,
    PRIMARY KEY (pk_id)
);
CREATE UNIQUE INDEX packing_run_uk ON packing_run (src_key);   -- sync upsert 키

CREATE TABLE packing_wagon (
    pk_id              integer NOT NULL,
    wagon_no           text NOT NULL,
    kg                 numeric NOT NULL,
    PRIMARY KEY (pk_id, wagon_no)
);

CREATE TABLE packing_part (
    pk_id              integer NOT NULL,
    part_id            integer NOT NULL,
    item_id            integer,
    input_kg           numeric,
    ea                 integer NOT NULL,
    PRIMARY KEY (pk_id, part_id)
);

CREATE TABLE outerpacking_run (
    op_id              bigserial,
    work_date          date NOT NULL,
    product_id         integer,
    inner_ea           integer NOT NULL,
    outer_ea           integer NOT NULL,
    outer_boxes        integer NOT NULL,
    partial_box_ea     integer,
    remain_ea          integer NOT NULL,
    sample_ea          integer NOT NULL,
    product_defect     integer NOT NULL,
    tray_used          integer,
    tray_defect        integer,
    stock_reg          boolean NOT NULL,
    test_run           boolean NOT NULL,
    note               text,
    src_key            text NOT NULL,
    PRIMARY KEY (op_id)
);
CREATE UNIQUE INDEX outerpacking_run_uk ON outerpacking_run (src_key);   -- sync upsert 키

CREATE TABLE outerpacking_worklog (
    op_id              integer NOT NULL,
    seq                integer NOT NULL,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz NOT NULL,
    workers            integer NOT NULL,
    PRIMARY KEY (op_id, seq)
);

CREATE TABLE retort_run (
    rt_id              bigserial,
    work_date          date NOT NULL,
    machine_no         text NOT NULL,
    round_no           integer NOT NULL,
    product_id         integer,
    ea                 integer NOT NULL,
    batch              text NOT NULL,
    ccp_type           text NOT NULL,
    temp               numeric NOT NULL,
    t1                 text NOT NULL,
    t2                 text NOT NULL,
    t3                 text NOT NULL,
    t4                 text NOT NULL,
    src_key            text NOT NULL,
    PRIMARY KEY (rt_id)
);
CREATE UNIQUE INDEX retort_run_uk ON retort_run (src_key);   -- sync upsert 키

CREATE TABLE attendance (
    att_id             bigserial,
    work_date          date NOT NULL,
    worker_id          integer NOT NULL,
    time_in            text,
    time_out           text,
    PRIMARY KEY (att_id)
);


-- 외래키 (컬럼 이름으로 추정한 것이다. 실제와 다를 수 있으니 확인할 것)
ALTER TABLE meat_box ADD FOREIGN KEY (part_id) REFERENCES item_master(item_id);
ALTER TABLE thaw_cart ADD FOREIGN KEY (part_id) REFERENCES item_master(item_id);
ALTER TABLE thaw_cart_box ADD FOREIGN KEY (cart_id) REFERENCES thaw_cart(cart_id);
ALTER TABLE thaw_cart_box ADD FOREIGN KEY (box_id) REFERENCES meat_box(box_id);
ALTER TABLE preprocess_run ADD FOREIGN KEY (part_id) REFERENCES item_master(item_id);
ALTER TABLE preprocess_source ADD FOREIGN KEY (pp_id) REFERENCES preprocess_run(pp_id);
ALTER TABLE preprocess_source ADD FOREIGN KEY (cart_id) REFERENCES thaw_cart(cart_id);
ALTER TABLE cooking_run ADD FOREIGN KEY (part_id) REFERENCES item_master(item_id);
ALTER TABLE cooking_wagon ADD FOREIGN KEY (ck_id) REFERENCES cooking_run(ck_id);
ALTER TABLE shredding_run ADD FOREIGN KEY (part_id) REFERENCES item_master(item_id);
ALTER TABLE shredding_wagon ADD FOREIGN KEY (sh_id) REFERENCES shredding_run(sh_id);
ALTER TABLE packing_run ADD FOREIGN KEY (product_id) REFERENCES item_master(item_id);
ALTER TABLE packing_wagon ADD FOREIGN KEY (pk_id) REFERENCES packing_run(pk_id);
ALTER TABLE packing_part ADD FOREIGN KEY (pk_id) REFERENCES packing_run(pk_id);
ALTER TABLE packing_part ADD FOREIGN KEY (part_id) REFERENCES item_master(item_id);
ALTER TABLE packing_part ADD FOREIGN KEY (item_id) REFERENCES item_master(item_id);
ALTER TABLE outerpacking_run ADD FOREIGN KEY (product_id) REFERENCES item_master(item_id);
ALTER TABLE outerpacking_worklog ADD FOREIGN KEY (op_id) REFERENCES outerpacking_run(op_id);
ALTER TABLE retort_run ADD FOREIGN KEY (product_id) REFERENCES item_master(item_id);
ALTER TABLE attendance ADD FOREIGN KEY (worker_id) REFERENCES worker(worker_id);
