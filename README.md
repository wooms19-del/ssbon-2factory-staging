# 순수본 2공장 생산관리 (리뉴얼 · staging)

기존 Firestore 기반 웹을 Supabase(PostgreSQL)로 옮기며 전면 리뉴얼하는 작업 저장소입니다.
운영 중인 웹은 `ssbon-2factory` 이며 이 저장소와 무관하게 그대로 돌아갑니다.

배포 주소: https://wooms19-del.github.io/ssbon-2factory-staging/

## 현재 단계

UI 셸까지입니다. 로그인 화면, 좌측 세로 메뉴, 우측 상단 사용자 설정, 화면 전환이 동작합니다.
대시보드는 Supabase에서 기준정보 건수를 실제로 읽어 연결 상태를 보여 줍니다.
공정 화면들은 자리만 잡아 둔 상태이며 데이터 이관 뒤에 붙입니다.

인증은 계정 저장소가 확정되지 않아 연결되어 있지 않습니다.
`js/auth.js` 의 `verify()` 한 함수만 교체하면 되도록 격리해 두었습니다.
그 전까지는 로그인 화면의 '화면만 둘러보기' 로 셸을 확인할 수 있으며,
이 버튼과 `reviewSession()` 은 인증 연결 시 제거합니다.

## 구조

    index.html      로그인 화면 + 앱 셸 마크업
    css/app.css     디자인 토큰과 전체 스타일
    js/config.js    접속 주소와 키 (온프레미스 이관 시 이 파일만 교체)
    js/nav.js       메뉴 구성, 화면별 연결 예정 테이블
    js/api.js       PostgREST 조회 래퍼
    js/auth.js      세션 관리와 인증 연결부
    js/app.js       라우팅, 메뉴 렌더, 사용자 메뉴, 대시보드

## 온프레미스 이관

`js/config.js` 의 `restUrl` 과 `anonKey` 두 줄만 바꿉니다.
다른 파일은 접속 주소를 직접 들고 있지 않습니다.
