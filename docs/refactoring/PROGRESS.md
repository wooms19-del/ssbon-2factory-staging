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
- [ ] Step 1.3: 다른 normalize 함수 5개
- [ ] Step 1.4: DL.getDay() + 04-30 검증
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
