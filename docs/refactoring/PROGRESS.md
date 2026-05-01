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
- [ ] Step 1.5: DL.getMonth()
- [ ] Step 1.6: DL.resolveType()
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
