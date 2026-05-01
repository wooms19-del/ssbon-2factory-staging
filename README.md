# 🔧 ssbon-2factory-staging

순수본 2공장 스마트팩토리 — **리팩토링 스테이징 환경**

## ⚠️ 이 repo는 무엇인가

- **Production**: https://github.com/wooms19-del/ssbon-2factory
  - 실제 공장 직원이 매일 사용
  - 절대 직접 수정 X
- **Staging (이 repo)**: https://github.com/wooms19-del/ssbon-2factory-staging
  - 리팩토링 작업 전용
  - Firebase **read-only** (write 차단)
  - 망가져도 production 영향 0

## 🌐 Staging 사이트
https://wooms19-del.github.io/ssbon-2factory-staging/

화면 우상단에 빨간 **"🔧 STAGING"** 배지 표시됨.

## 🛡️ Write 차단 메커니즘

`js/common.js` 상단의 `_STAGING_MODE = true` 플래그로:
- `fbSave / fbUpdate / fbDelete` → console.log만, 실제 DB 변경 0
- `firebase.firestore().collection().add/set/update/delete` → 모두 차단
- read는 정상 동작 (production Firebase에서 그대로 가져옴)

## 📁 리팩토링 문서

`docs/refactoring/`:
- **ROADMAP.md** — 전체 마스터 플랜
- **PROGRESS.md** — 현재 진행 상황
- **DECISIONS.md** — 사용자분 결정 사항
- **DATA_MODEL.md** — 정규화된 데이터 모델

## 🔄 워크플로우

1. Staging에서 작업
2. 자동 검증 (실제 4월 데이터 baseline과 일치)
3. 사용자분 OK
4. Production repo로 한 번에 복사
