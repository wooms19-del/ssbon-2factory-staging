# 🗳️ 사용자분 결정 사항

> 작업 중 사용자분이 한 모든 결정을 누적
> Claude는 작업 시작 전 무조건 읽고 반영

---

## 데이터 처리 룰

### 같은 부위 여러 제품 (예: 04-30 우둔→미니+코스트코)
- 결정: **행은 따로, 부위 KG 컬럼만 rowspan으로 병합**
- 일자: 2026-05-01
- 적용: 월단위생산량, 일별실적

### 빈 셀 표시
- 결정: 일반 빈 칸 그대로. "·" 같은 점 표시 사용 X
- 일자: 2026-05-01

### 무육 제품 (메추리알 등)
- 결정: 부위 그룹과 완전 분리. 절대 자동 추론으로 우둔 같은 데 끼면 안 됨
- 일자: 2026-05-01
- 적용: 모든 화면

### 불량률 계산 공식
- 결정: `defect / (ea + defect)` (파우치사용량 기준, KPI와 동일)
- 일자: 2026-05-01
- 변경 전: defect/ea 였음

### testRun 처리
- 결정: 모든 분석/차트/표에서 제외. KPI도 제외
- 일자: 2026-05-01

### testRun 체인 역추적 (Step 2.0 발견 후 보강)
- 결정: testRun packing record 1건 발견되면 그 위 모든 공정도 testRun으로 마킹
- 추적 흐름:
  ```
  outerpacking.testRun (같은 날짜+같은 제품)
    → packing.testRun → 체인 시작
  testRun packing.wagon/cart
    → shredding.wagonOut/cartOut 매칭 → testRun
    → shredding.wagonIn → cooking.wagonOut 매칭 → testRun
    → cooking.cage → preprocess.cage 매칭 → testRun
    → preprocess.wagons → thawing.cart 매칭 (정규화: "7호"→"7") → testRun
  ```
- 일자: 2026-05-02
- 발견 케이스 (4월 데이터):
  - 04-02: testRun pk(35EA, 와곤20) → 체인 → th 98kg(홍두깨, cart=5) 까지 testRun
  - 04-15: testRun pk(8EA, 와곤22) → 체인 → th 25.68kg(홍두깨, cart=8) 까지 testRun
  - 04-24: outerpacking testRun (FC 3KG 8EA) → packing.testRun=null이지만 매칭됨
           → 체인 → th 25.28kg(홍두깨) 까지 testRun
- 적용: dataLayer.js _markTestRunChain() — _isTestRun=true + _testRunReason='chain'/'op_chain'
- 효과: legacy renderDaily(analysis.js)와 4월 22일치 154/154 (100%) 일치

### legacy 화면 간 룰 불일치 발견 (정정 필요)
- 발견: 2026-05-02
- 내용:
  - **monthly_production.js**: outerpacking.testRun → packing.testRun 전파 룰 **있음** (정확)
  - **analysis.js (renderDaily)**: 외포장 → packing 전파 **누락** (BUG)
  - 같은 4월 04-24 데이터에 두 화면이 다른 결과 표시 가능
- 해결: DL은 monthly_production의 정확한 룰 따름
- 영향: legacy analysis.js 일별요약 화면이 외포장 testRun 매칭 1건 누락됨 (Phase 2 마이그레이션 시 자동 정정)

---

## 외포장 EA 처리 룰 (Step 2.x 발견 후 확정)

### 🚨 legacy monthly_production.js의 외포장 우선 EA 룰은 BUG
- 발견: 2026-05-02
- legacy 코드:
  ```js
  p.eaDisp = oe>0 ? oe : p.ea;  // monthly_production.js line 433
  ```
- 문제: 같은 (날짜+제품)에 packing record N건이 있을 때, **N개 record 모두에 같은 oe 적용** = 중복 카운트
- 4월 영향:
  - 04-02 시그니처 130g: packing 2건, 외포장 16861 EA → legacy=33722 (★2배 부풀려짐)
  - 04-27 시그니처: packing 3건 → legacy=42588 (★3배 부풀려짐)
  - 4월 누적 부풀림: 약 +200,000 EA (실제 226,437 → legacy 표시 ~429,337)
- 추가 도메인 문제:
  - 외포장이 다른 날 packing의 결과인 경우 (예: 04-16 inner=0, outer=14232)
  - 시점이 어긋난 EA를 같은 날짜로 카운트 → 부정확
- DL 결정:
  - 기본 분석은 packing.ea (내포장) 기준 = 도메인적 정확
  - 외포장 EA는 별도 metric `outerEaTotal`로 정확히 노출 (중복 없음)
  - legacy의 잘못된 합산 로직은 **재현하지 않음**
- 사용자분 보고 필요: 월단위생산량 화면이 EA를 ~2배 부풀려 보여주는 가능성

---

## 작업 방식

### Production vs Staging
- 결정: Production은 절대 안 건드림. 모든 리팩토링은 Staging에서
- 일자: 2026-05-01

### 검증 방식
- 결정: 실제 4월 DB 데이터로 자동 시뮬. baseline JSON과 100% 일치 확인
- 일자: 2026-05-01

### 진행 속도
- 결정: 빠르게 진행하되, "되는 척"이 아닌 실제 검증된 것만 통과
- 일자: 2026-05-01

---

## 도메인 룰 (잊으면 안 됨)

### 공정 흐름
```
해동기(barcode 등록) → 방혈(thawing, 전날 오후~새벽) →
전처리(preprocess) → 자숙(cooking) → 파쇄(shredding) →
포장(packing) → 외포장(outerpacking) [+ 소스(sauce) 별도]
```

### Tab ↔ Collection 매핑 (절대 바꾸면 안 됨)
- 해동기 = barcode
- 방혈 = thawing
- 전처리 = preprocess
- 자숙 = cooking
- 파쇄 = shredding
- 내포장 = packing
- 외포장 = outerpacking
- 소스 = sauce

### thawing.date = 방혈 종료일
- 방혈은 전날 오후 시작 → 다음날 새벽 종료
- date 필드는 종료일

### 와곤번호는 날짜별 재사용됨
- 같은 와곤 6번이 4월 동안 6번 다른 날짜에 사용됨
- 와곤→부위 추적 시 반드시 같은 날짜 cooking과 매칭해야 함

---

## 인원·시간 계산 룰 (Step 1.4 확정)

### 시간 = 설비 가동 시간 (중복 시간 제외)
- 결정: 여러 record가 시간 겹치면 → 머지해서 1번만 카운트
- 그룹별 duration 합산
- 일자: 2026-05-02
- 적용: 모든 공정 (preprocess/cooking/shredding/packing)

### 인원 = "그날 그 공정에 사용된 실제 인원 수"
- 결정:
  - 시간 겹치는 작업끼리 → 다른 사람이라 가정 → workers 합산
  - 시간 안 겹치는 작업끼리 → 옮겨갔을 수 있음 → max만 살림
  - 최종 = max(group_workers across all groups)
- 일자: 2026-05-02
- 예시 (04-30 포장):
  - G1 (09:15~16:50, 메추리알3+미니6 시간겹침) = 9명
  - G2 (17:00~18:00, 코스트코6+6 안겹침) = 12명
  - 총 = max(9, 12) = 12명
- 예시 (04-14 전처리):
  - pp1 (05:04~07:45) 5명 + pp2 (07:46~08:50) 7명 (1분차이로 안 겹침)
  - = max(5, 7) = 7명 (5명에서 시작 → 7명까지 늘어난 것)

### 자숙(cooking) 전용 룰: 항상 max
- 결정: 자숙은 보통 2명 거의 고정으로 운영. 여러 탱크 동시 가동되어도 같은 인원이 관리.
  → 시간 겹침 여부 무관, **모든 record의 workers 중 max**
- 일자: 2026-05-02
- 적용: _calcWH(records, {cookingRule:'always_max'})
- 예시 (04-14 자숙):
  - ck1 2명, ck2 2명 → max = 2명

### 경계만 맞닿는 케이스 처리
- 결정: 10:00~10:45와 10:45~11:30처럼 끝-시작이 같은 시점 = "안 겹침"
- 같은 사람이 이어서 일한 것으로 봄 → max 처리
- 일자: 2026-05-02
- 적용: _calcWH() 알고리즘 (`<=` 가 아닌 `<` 비교)

---

## noMeat (무육) 수율 계산 (Step 1.4 확정)

### 룰
- 결정: noMeat 제품은 메인 부재료(subName)로 수율 계산
- 일자: 2026-05-02
- 공식:
  ```
  이론 사용량 = sum(포장EA × L.products[].subKgea)
  실제 사용량 = sum(packing.subKg)
  수율 = 이론량 / 실제량
  ```
- 예시 (04-30 메추리알):
  - L.products: 메추리알 장조림 180g → subKgea=0.09 (1개당 90g)
  - 4032개 × 0.09 = 362.88 kg (이론)
  - subKg = 370 kg (실제)
  - 수율 = 98.07%

### 일반 제품에 들어가는 부재료(예: 시그니처 130g의 깐메추리알 20g)
- 보류: Step 1.5+ 에서 recipe.inner 항목 합쳐서 계산
- 일자: 2026-05-02

---

## 공정 특성 (Step 1.4 추가)

### 파쇄 KG > 자숙 KG는 정상
- 결정: 자숙→파쇄 사이에 원육이 물을 흡수해서 중량 증가 — **공정상 정상 현상**
- 일자: 2026-05-02
- 적용: 검증 룰에서 파쇄 > 자숙은 error 처리 X
- 단, 50%+ 증가 시 warning (입력 오류 의심)
- 예시: 04-14 자숙 876.4 → 파쇄 973.5 (111.1%) — 정상

---

## 와곤 부위 추적 룰 (Step 1.6 확정)

### 추적 흐름
```
cooking.wagonOut(type) → shredding.wagonIn → shredding.wagonOut → packing.wagon
부위(type)는 cooking에만 있음 → 와곤번호로 역추적
```

### 와곤 매핑 단계
1. **cooking 직접 맵**: cooking.wagonOut의 각 와곤 → cooking.type
2. **shredding 전파**:
   - sh.wagonIn 와곤들이 어느 cooking type에서 왔는지 확인
   - 단일 부위면 → sh.wagonOut의 모든 와곤도 그 부위
   - 멀티 부위면 → wagonInDist 가중치로 우세 부위 선택 (4월엔 거의 없음)
3. **packing 추론**: packing.wagon의 각 와곤을 위 맵에서 lookup

### Fallback (와곤 매칭 실패 또는 와곤 빈값)
- 같은 날 cooking이 모두 단일 부위면 → 그 부위로 추론
- 멀티 부위면 추론 불가 → 빈배열

### noMeat 절대 룰
- noMeat 제품(메추리알)은 어떤 경우에도 부위 추론 X (DECISIONS 기존 룰 강화)
- _resolveTypesForPacking에서 즉시 빈배열 반환

### 와곤 재사용 격리
- 일자: 2026-05-02
- 모든 추적은 같은 날짜의 cooking·shredding으로만 (date 매칭 강제)
- 검증: 와곤 23번 - 04-29=홍두깨, 04-30=우둔 → 정확히 격리됨
