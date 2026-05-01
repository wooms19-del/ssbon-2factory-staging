# 📋 진행 상황

> 매 작업 끝낼 때마다 갱신
> 새 세션 시작 시 무조건 먼저 읽기

---

## 현재 위치

**Phase 0 - 스테이징 환경 구축 ✅ 완료**
**Phase 1 - dataLayer.js 작성 - 시작 대기 중**

---

## 완료 체크리스트

### Phase 0 ✅
- [x] Staging repo 생성 (ssbon-2factory-staging)
- [x] Production 코드 전체 복사
- [x] STAGING 모드 코드 추가 (write 차단 + 빨간 배지)
- [x] GitHub Pages 활성화
- [x] docs/refactoring/ 4개 파일 작성

### Phase 1 (대기)
- [x] Step 1.1: js/dataLayer.js 빈 파일 + index.html 등록 ✅ 2026-05-01
- [x] Step 1.2: DL.normalizePacking() + 4월 데이터로 자동 검증 ✅ 2026-05-01
- [x] Step 1.3: 다른 normalize 함수 5개 ✅ 2026-05-01
- [x] Step 1.4: DL.getDay() + 04-30 검증 ✅ 2026-05-02
- [x] Step 1.5: DL.getMonth() ✅ 2026-05-02
- [x] Step 1.6: DL.resolveType() + 와곤 추적 ✅ 2026-05-02
- [ ] Step 1.7: DL.validate()

---

## 🔖 마지막 안전 시점 (롤백용)

- Phase 0 완료: (커밋 SHA는 push 후 기록)
- 롤백 명령: GitHub Actions 또는 git reset --hard <sha>

---

## 📅 작업 로그

### 2026-05-01
- Phase 0 시작 및 완료
- Staging URL: https://wooms19-del.github.io/ssbon-2factory-staging/

### Phase 1 진행
- [x] Step 1.1: dataLayer.js 빈 모듈 + index.html 등록
  - 파일: js/dataLayer.js (3,307 bytes)
  - 기본 유틸: _num, _r2, _str, _trim
  - 제품 조회: getProduct, getKgea, isNoMeat, getKgTot
  - testRun 판정: isTestRun
  - placeholder: normalizePacking 등 9개
  - 자동 검증: 19/19 통과

- [x] Step 1.2: DL.normalizePacking() 작성 + 자동 검증
  - 4월 packing 47건 모두 정규화 → 47/47 통과
  - 추가 정규화 필드: _kgea, _isNoMeat, _isTestRun, _meatKg,
    _wagonDistSum, _cartDistSum, _typeKgsSum, _typeList, _primaryType, _isConsistent
  - 04-30 우둔 케이스 정밀 검증: 미니쇠고기 _meatKg=243.46, 코스트코 _meatKg=141.91 정확
  - typeList 분포: 우둔 10건, 홍두깨 4건, 빈값 33건 (다음 Step에서 wagon 추적으로 채울 예정)
  - 사전 점검 시나리오 10개 모두 통과

- [x] Step 1.3: normalize 5개 추가 (Shredding, Thawing, Cooking, Preprocess, Outerpacking)
  - 4월 데이터 197건 중 197/197 통과
  - shredding _isConsistent 로직 1차 잘못 → 발견 후 즉시 수정
    (wagonOutDist 빈값일 때 검증 안 하도록)
  - 04-30 thawing 합 검증: 750.60kg (예상 750.6) ✅
  - 04-30 shredding 분배: 6=95, 23=93.8, 12=38.2, 24=145 ✅

- [x] Step 1.4: DL.getDay(date) + 4월 22일치 자동 검증 (2026-05-02)
  - 사용자분과 합의한 룰 확정:
    * 인원 = 시간 겹치는 작업끼리 합산, 안 겹치면 max (작은 쪽이 옮겨감)
    * 시간 = 인터벌 머지 (겹친 시간 1번만), 그룹 duration 합
    * 경계만 맞닿는 케이스(예: 10:00~10:45 + 10:45~11:30)는 "안 겹침" 처리
    * 메추리알(noMeat) 수율 = (EA × subKgea) / subKg
    * L.products 단일 출처, ||0.05 같은 하드코딩 금지
  - 04-30 정밀 검증 15/15 통과:
    rmKgTotal=750.6, meatKgTotal=385.37, 원육수율=51.34%,
    pkEa우둔=12772, pkEaNoMeat=4032,
    workers={pp:7, ck:2, sh:14, pk:12},
    hours={pp:0.92, ck:2.83, sh:1.5, pk:8.58},
    메추리알수율=98.08% (이론362.88/실제370)
  - 1차 작성 후 sh workers 28명 나오는 버그 발견:
    경계 시점 같은 record(10:45 끝, 10:45 시작)를 같은 그룹으로 묶음
    → `<=`를 `<`로 수정해서 14명 정답
  - 4월 전체 22일치 결과:
    * 정합성 에러 0건 (코드)
    * 데이터 이상 2일 발견:
      - 04-09: 자숙 820.3 vs 파쇄 829.9 (차이 1.2%, 입력오차 수준)
      - 04-14: 자숙 876.4 vs 파쇄 973.5 (차이 11.1% — 입력 오류 의심)
      → dataLayer가 데이터 이상을 정확히 잡아냄 (검증 룰 동작 확인)
    * 16일에 _typeList 빈값 packing 32건 발견 (Step 1.6에서 자동 해결 예정)
  - 추가된 함수: _calcWH, _t2m, _r4, _getDay
  - 라인 수: 328 → 629 (+301)

- [x] Step 1.6: DL.resolveType + 와곤 추적 (2026-05-02)
  - 추적 흐름:
    cooking.wagonOut → shredding.wagonIn → shredding.wagonOut → packing.wagon
    부위(type)는 cooking에만 있으니 와곤번호로 역추적
  - 도메인 룰 준수:
    * 와곤번호 날짜별 재사용 → 같은 날짜 cooking·shredding과만 매칭
    * 04-29 와곤 23 = 홍두깨 / 04-30 와곤 23 = 우둔 — 격리 검증 통과
    * noMeat(메추리알) 제품은 절대 부위 추론 X
  - 추가 함수:
    * _buildWagonTypeMap(date) - 날짜별 와곤→부위 맵 (cooking 직접 + shredding 전파)
    * _resolveType(date, wagon) - 단일 와곤 → 부위
    * _resolveTypesForPacking(record) - packing 전체 부위 추론 (반환 {types, source})
  - getDay() 통합:
    * normalizePacking 후 _typeList 빈값이면 자동 호출
    * _resolvedBy 필드로 출처 표시 (typeKgs/type/wagon/fallback/noMeat)
  - 4월 22일치 검증:
    * packing 44건 중:
      - typeKgs 결정: 3건
      - type 필드: 11건
      - 와곤추적: 27건
      - fallback (같은날 cook 단일부위): 2건
      - noMeat: 1건
      - 미해결: 0건
    * 추론된 부위가 같은 날 cooking에 없는 경우: 0건 (모든 추론 정확)
    * 16일 모두 원육수율 정상 (47.9%~56.0%, 이전엔 0%)
  - 04-14 화면값 회귀 검증:
    meatKgTotal 885.6 / 원육수율 55.3% — 화면과 100% 일치 ✅
  - 04-30 회귀 검증: 모든 값 그대로 통과 ✅
  - 멀티부위 케이스 정상 동작:
    04-07 트레이더스 (와곤 7,26,27) → 설도+홍두깨 (typeKgs 없으니 균등)
    04-09 (와곤 20,21,26) → 설도+우둔
  - Edge case 정상 동작:
    04-08 트레이더스 (와곤 6,18, sh.wagonOut 빈값) → fallback 처리
    04-13 시그니처 (와곤 빈값) → fallback (같은날 cook 모두 설도)
  - 라인 수: 629 → 800+ (+170)

- [x] Step 1.5: DL.getMonth(yearMonth) (2026-05-02)
  - 입력: 'YYYY-MM' (예: '2026-04')
  - 반환:
    {
      yearMonth, 
      days: [getDay 결과 배열],
      monthSummary: { 부위별 합계 + 수율 + 인원/시간 + 제품별 + validation집계 }
    }
  - 룰 (legacy monthly_production 분석 후 확정):
    * 월합계 = 단순 sum (kg, ea, defect)
    * 월수율 = 합계끼리 재계산 (가중평균 자동 됨)
      예: 원육수율_월 = meatKgTotal_월 / rmKgTotal_월
    * 공정수율 chain: 전처리=ppKg/rmKg, 자숙=ckKg/ppKg, 파쇄=shKg/ckKg, 포장=meatKg/shKg
    * 일평균 = 합계 / dayCount (데이터 있는 일수만)
    * dayCount = 데이터 있는 일자 수 (캘린더 일수 X)
  - 인원/시간 통계:
    * hoursTotal: 월 총 가동시간
    * personHours: 월 총 인시 (= sum(daily.hours × daily.workers))
    * workersAvg: 일별 인원 평균
    * workersMax: 일별 인원 max
    * personDays: 인일 (일별 인원 합)
    → 4가지 다 노출, 화면이 골라 쓰도록
  - 제품별 누적: pkByProduct[제품명] = {ea, defect, pouch, count, meatKg, subKg}
  - noMeat 누적: 일별 theoretical/actual 합산 후 월간 yield 재계산
  - validation 집계: daysWithErrors, daysWithWarnings
  
  4월 검증 (12/12 통과):
  ✅ rmKgTotal=21253.61, 부위별 (설도 12525.68 / 우둔 5180.95 / 홍두깨 3546.98)
  ✅ ppKg=20623, ckKg=11595.7, shKg=10928.11
  ✅ 일별 누적 = 월합계 (5개 항목 모두 일치)
  ✅ 부위별 합 = 총합 (rmKg, meatKg)
  ✅ 제품별 EA합 = pkEaByPart합 + noMeat + unresolved (=226445)
  
  4월 결과:
  - 원육수율: 51.86% (11023.07 / 21253.61)
  - 공정수율: 전처리 97.03% / 자숙 56.23% / 파쇄 94.24% / 포장 100.87%
  - 메추리알 수율: 98.08% (이론 362.88 / 실제 370)
  - 데이터 있는 일수: 22일
  - daysWithErrors: 0, daysWithWarnings: 0
  - workersMax: pp 14, ck 2, sh 23, pk 18
  
  성능: 22일치 17ms (0.8ms/day)
  엣지 케이스:
  - 빈 월(5월): dayCount=0, 안전 반환
  - 잘못된 입력: error 필드와 함께 빈 결과
  
  라인 수: 812 → 1000+ (+188)

### Phase 2 진입 (2026-05-02)

- [x] Step 2.0: legacy vs DL 자동 비교 인프라 + testRun 체인 발견·해결 (2026-05-02)
  
  접근: 화면 마이그레이션 전에 legacy 계산 로직을 Node에 포팅해서
        DL과 4월 22일치 자동 비교 → 차이 발견 → 원인 분석 → DL 강화
  
  목적: 마이그레이션 시 회귀 테스트 자동화 + legacy 버그/DL 버그 분리
  
  발견:
    legacy renderDaily(analysis.js) vs DL.getDay() 비교 결과:
    - 22일 × 7항목 = 154건 비교
    - 1차: 144건 일치, 10건 차이 (04-02, 04-15)
    - 차이 원인: testRun 체인 역추적 누락
      * Legacy는 testRun packing → sh → ck → pp → th 까지 체인 추적해서 모두 제외
      * DL은 packing.testRun 플래그만 봄 → 그 위 공정 record들이 살아있음
      * 04-02: DL 898.25kg vs Legacy 800.25kg (98kg 차이 = th 홍두깨 testRun체인)
      * 04-15: DL 825.97kg vs Legacy 800.29kg (25.68kg 차이 = th 홍두깨 testRun체인)
  
  해결:
    dataLayer.js에 _markTestRunChain() 함수 추가
    추적 흐름:
      testPk.wagon/cart
        → shredding.wagonOut/cartOut 매칭 → testRun 마킹
        → shredding.wagonIn → cooking.wagonOut 매칭 → testRun
        → cooking.cage → preprocess.cage 매칭 → testRun
        → preprocess.wagons → thawing.cart 매칭 (와곤번호 정규화) → testRun
    _isTestRun=true 추가, _testRunReason='chain' 으로 출처 표시
    getDay() 안에서 normalize 후 자동 호출
  
  검증:
    Legacy vs DL: 154/154 (100%) 일치 ✅
    회귀: 04-30 15/15 통과 ✅, 4월 22일치 정합성 0건 ✅
    getMonth: 12/12 통과 (testRun 체인 정확히 제외된 합계)
    
  영향:
    - 이전 검증값 정정: thRmTotal 21253.6 → 21129.93 (정확)
    - 부위별: 홍두깨 3547 → 3423.3 (testRun 123.68kg 정확히 제외)
    - DL이 더 정확해짐
  
  생성된 인프라 (Phase 2 마이그레이션 검증에 재사용):
    - /home/claude/verify/legacy_daily.js (legacy 로직 Node 포팅)
    - /home/claude/verify/compare_legacy_vs_dl.js (자동 비교)

- [ ] Step 2.1: 일별요약 화면 마이그레이션 (analysis.js renderDaily)
- [ ] Step 2.2: 월별현황 화면
- [ ] Step 2.3: 월단위생산량 (monthly_production.js, ||0.05 버그 정정 효과)
- [ ] Step 2.4: 일별실적 (performance.js, 가장 위험)
- [ ] Step 2.5: 이력추적 (trace.js, 가장 복잡)

- [x] Step 2.0b: monthly_production.js 비교 + 외포장 testRun + 외포장 EA 버그 발견 (2026-05-02)
  
  legacy monthly_production을 Node 포팅해서 DL.getMonth와 4월 비교
  
  발견 1: 외포장 testRun → packing 전파 (DL에 누락)
    - monthly_production.js의 isTestPk: r.testRun || testOpKeys.has(date+product)
    - 4월 04-24: packing FC 3KG 8EA (testRun=null) + 외포장 testRun=true
      → legacy는 매칭으로 packing도 testRun 처리, DL은 누락
    → DL._markTestRunChain()에 외포장 처리 추가 (op_chain reason)
  
  발견 2: legacy 화면 간 룰 불일치 (analysis.js 버그)
    - monthly_production.js: 외포장 testRun → packing 전파 있음
    - analysis.js renderDaily: 전파 누락
    - 같은 4월 04-24가 두 화면에서 다른 숫자 표시
    → DL은 monthly의 정확한 룰 따름 (analysis.js Phase 2에서 자동 정정)
  
  발견 3: 🚨 monthly_production.js의 외포장 EA 우선 룰은 명백한 BUG
    - 코드: p.eaDisp = oe>0 ? oe : p.ea
    - 같은 (날짜+제품)에 packing N건이면 N개 모두 같은 oe 받음 = 중복 카운트
    - 04-02 시그니처: packing 2건 + 외포장 16861 → legacy=33722 (★2배)
    - 04-27 시그니처: packing 3건 → legacy=42588 (★3배)
    - 4월 누적: 실제 226437 EA → legacy 표시 ~429337 EA (★~2배 부풀려짐)
    - 추가 문제: 외포장이 다른 날 packing 결과인 경우도 시점 어긋남 (04-16 inner=0, outer=14232)
    → DL: 기본 packing.ea 사용 (정확), 외포장은 outerEaTotal 별도 metric (정확)
  
  ||0.05 분석:
    - 4월 모든 제품이 L.products에 정상 등록 (kgea 다 있음)
    - 4월 데이터에선 ||0.05 실제 발동 안 함
    - 잠재 위험만 존재 → DL은 절대 사용 안 함

  검증:
    - rmKg/ppKg/ckKg/shKg 합계 100% 일치 (외포장 testRun 추가 후) ✅
    - 14/20 항목 일치 (나머지 6은 legacy 부풀림 BUG 때문에 비교 의미 없음)
    - 04-30 회귀 15/15 ✅
    - 4월 22일 정합성 0건 ✅
    - getMonth 자체 검증 12/12 ✅
  
  사용자분 보고 필요:
    🚨 월단위생산량 화면이 EA를 약 2배 부풀려 보여주고 있을 가능성 (외포장 우선 룰 BUG)
    🚨 분석 → 일별요약 화면이 외포장 testRun 매칭 누락 (월단위생산량과 결과 불일치)

- [x] Step 2.0c: 외포장 EA 부풀림 BUG 주장 정정 (2026-05-02)
  
  ⚠️ 이전 Step 2.0b의 "★2배 부풀림" 보고는 잘못된 분석이었음
  
  사용자분이 화면 직접 확인 후 "똑같은데?" 지적 → 코드 재검증 결과 사과 + 정정
  
  진짜 legacy 코드:
    var byDP = {};
    pkClean.forEach(r => byDP[k].ea += r.ea);  // (date+product) 그룹화
    Object.keys(byDP).forEach(k => {
      byDP[k].eaDisp = oe>0 ? oe : byDP[k].ea;  // ★ 그룹 단위로 1번만
    });
  
  → packing 여러 건이라도 byDP 그룹 1개로 합쳐짐 → eaDisp 1번만 적용
  → 중복 카운트 없음, 부풀림 없음
  
  정확한 4월 비교:
    - legacy 외포장 우선 합: 225,880 EA
    - 내포장 합: 226,437 EA
    - 차이: 557 EA (~0.25%) — 외포장 안 한 packing 일부
  
  내가 잘못한 점:
    - byDP 그룹화 못 봤음 (코드 정확히 안 읽음)
    - Python 시뮬레이션도 record 단위로 oe 곱하는 잘못된 로직
    - 사용자분께 "★2배 부풀림" 라고 큰 일처럼 보고 → 화면 직접 보고서 정정 요청
  
  DL 정정:
    - pkEaTotalDisp: byDP 그룹 단위로 정확히 다시 구현 → legacy와 100% 일치 ✅
    - meatKgTotalDisp: 동일 그룹 단위 ✅
    - outerEaTotal: 외포장 자체 합 (별도)
  
  검증:
    - legacy vs DL pkEaTotalDisp: 225,880 ↔ 225,880 ✅
    - legacy vs DL meatKg(외포장 우선): 10,955.61 ↔ 10,955.61 ✅
    - 04-30 회귀 15/15 ✅
    - 4월 정합성 0건 ✅
    - getMonth 12/12 ✅
  
  진짜 차이는 ~10kg 수준 (04-24 외포장 testRun 체인 1건 효과)
