# 스키마와 점검 뷰

이 폴더가 DB 구조의 원본이다. 콘솔에서 손으로 만든 것은 언젠가 사라진다.

## 파일

    01_schema.sql        테이블 정의 (19개)
    02_audit_views.sql   데이터 점검 뷰

## 온프레미스 구축

    psql -U postgres -d ssbon -f 01_schema.sql
    psql -U postgres -d ssbon -f 02_audit_views.sql

`01_schema.sql` 은 운영 중인 Supabase 에서 역으로 뽑아낸 것이다.
컬럼과 타입은 실제 데이터로 확인했지만, 기본키·외래키는 API 로 조회할 수
없어 명명 규칙과 `sync/run.py` 의 upsert 키로 추정했다. 파일 안에 표시해 뒀다.
실제 운영 DB 를 옮길 때는 `pg_dump --schema-only` 로 받은 것이 더 정확하다.

## 점검 뷰

넣을 때 한 번 판정하고 화면은 읽기만 하는 구조라, 판정이 틀어지면 모든
화면이 같이 틀어진다. 그래서 DB 안에 점검을 둔다. 스크립트를 돌릴 때만
확인되는 것이 아니라 항상 현재 상태를 비춘다.

화면은 `audit_summary` 한 줄만 읽으면 된다.

    SELECT * FROM audit_summary;
    -- part_alloc | part_missing | yield_odd | total
    --          0 |            0 |         0 |     0

`total` 이 0 이 아니면 배지를 띄우고, 눌렀을 때 아래 뷰를 보여 준다.

| 뷰 | 무엇을 잡나 |
|---|---|
| `audit_part_alloc` | 포장이 받은 양과 파쇄 산출이 5% 넘게 다른 날·부위 |
| `audit_part_missing` | 고기 제품인데 부위가 안 붙은 포장 |
| `audit_yield` | 월 수율이 30~80% 를 벗어난 것 (이월이 큰 달은 제외) |

`v_part_flow`, `v_monthly_yield` 는 그 밑의 원본 뷰다. 전체를 훑을 때 쓴다.

### audit_part_alloc 이 잡는 것

대차 번호는 한정돼 있어 하루에 재사용된다. 한 포장이 같은 번호를 두 번
받으면 현장 입력이 `{번호: 합계}` 로 합쳐져 저장되므로, 두 부위에 걸친 양이
한쪽으로 몰린다. 지금 구조로는 갈라낼 수 없어 이 뷰로 잡는다.

근본 해결은 입력을 `{번호, kg}` 목록으로 바꾸는 것이다. 포장 화면을 만들 때
그렇게 설계하면 이 구멍이 없어진다.

2026-04 ~ 09 실적으로는 세 뷰 모두 0건이다. 뜨면 실제 신호로 봐도 된다.

## 알아 둘 것

`thaw_cart.part_id` 와 `packing_part.part_id` 에 원육이 아닌 품목
(프리미엄진간장, 정백당)이 들어온 사례가 있다. 뷰는 `item_master.category`
가 `원육` 인 것만 보도록 걸러 두었으나, 데이터를 넣는 쪽에서 막는 것이 맞다.
