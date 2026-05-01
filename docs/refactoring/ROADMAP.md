# 🗺️ 리팩토링 ROADMAP

> 순수본 2공장 스마트팩토리 - 코드 리팩토링 마스터 플랜
> 작성일: 2026-05-01
> 상태: Phase 0 (스테이징 환경 구축)

---

## 🎯 최종 목표

```
지금:                          목표:
┌────────┐                    ┌────────┐
│Firebase│                    │Firebase│
└────────┘                    └────────┘
    │                              │
    ▼ 5번 다른 방식                ▼ 단 하나
┌──┬──┬──┬──┬──┐              ┌──────────┐
│월 │일 │분 │이 │파│              │dataLayer │
│단 │별 │석 │력 │쇄│              │  .js     │
│위 │실 │차 │추 │  │              └──────────┘
│   │적 │트 │적 │  │                   │
└──┴──┴──┴──┴──┘                   ┌───┴───┬────┬────┐
각자 다르게 계산                   ▼       ▼    ▼    ▼
                                  월       일   분   이
                                  단       별   석   력
                                  위       실   차   추
                                                트   적
                                  같은 결과 보장
```

---

## 📐 dataLayer.js 설계

### 정규화 함수 (5개)
- `DL.normalizePacking(record)` - kgea, noMeat, testRun, typeList 자동 부착
- `DL.normalizeShredding(record)` - 와곤별 분배 정규화
- `DL.normalizeThawing(record)` - 부위별 정규화
- `DL.normalizeCooking(record)`
- `DL.normalizePreprocess(record)`

### 조회 함수 (2개)
- `DL.getDay(date)` - 그날 모든 공정 데이터 + 요약
- `DL.getMonth(yearMonth)` - 한 달치 + 일별 요약

### 추적 함수 (1개)
- `DL.resolveType(date, wagon)` - 와곤 → 부위 (날짜 필터 자동)

### 검증 함수 (1개)
- `DL.validate(date)` - 정합성 자동 체크

---

## 🛤️ Phase별 진행

### Phase 0: 스테이징 환경 구축 ✅
- [x] Staging repo 생성
- [x] 코드 복사
- [x] STAGING 모드 추가
- [x] GitHub Pages 활성화
- [x] docs/refactoring/ 작성

### Phase 1: dataLayer.js 작성
- [ ] Step 1.1: 빈 dataLayer.js + index.html 등록
- [ ] Step 1.2: DL.normalizePacking() + 자동 검증
- [ ] Step 1.3: 다른 normalize 5개
- [ ] Step 1.4: DL.getDay() + 04-30 검증
- [ ] Step 1.5: DL.getMonth()
- [ ] Step 1.6: DL.resolveType()
- [ ] Step 1.7: DL.validate()

### Phase 2: 화면 마이그레이션 (영향도 낮은 순)
- [ ] 이력추적 (trace.js)
- [ ] 분석 → 일별요약
- [ ] 분석 → 월별현황
- [ ] 월단위생산량
- [ ] 일별실적 (performance.js) - 가장 위험

### Phase 3: 입력 가드레일
- [ ] packing 저장 시 DL.validate() 자동 실행
- [ ] 와곤번호 빈칸 저장 차단
- [ ] 부위 자동 추론 후 사용자 확인 모달

### Phase 4: 자동 백업·정합성
- [ ] 매일 자정 Firebase 백업 Cloud Function
- [ ] 매일 아침 DL.validate() 전체 실행 + 알림

### Phase 5: Production 교체 (사용자분 OK 후만)
- [ ] Staging 충분히 검증
- [ ] Production repo로 한 번에 복사
- [ ] 사용자분 명시적 OK
- [ ] Production push

---

## 🛡️ 안전 원칙 (절대 깨지 않음)

1. Production repo는 사용자분 명시 OK 전까지 절대 수정 X
2. 모든 작업은 Staging repo에서만
3. 새 세션 시작 시 docs/refactoring/ 4개 파일 무조건 view
4. 검증 100% 안 되면 진행 금지, 사용자분께 보고
5. "되는 척" 금지. 실제 4월 DB 데이터로 검증한 결과만 OK
6. 임의 판단 금지. 의심되면 사용자분께 질문

---

## ⏱️ 예상 시간

| Phase | 시간 | 위험 |
|---|---|---|
| Phase 0 | 30분 | 0 |
| Phase 1 | 4시간 | 0 |
| Phase 2 (5개 화면) | 14시간 | 중간 |
| Phase 3 | 3시간 | 낮음 |
| Phase 4 | 4시간 | 0 |
| Phase 5 (교체) | 1시간 | (사용자분 결정) |
| **합계** | **약 26시간** | |
