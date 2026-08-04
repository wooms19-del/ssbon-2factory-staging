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

## 실적 동기화

현행 웹(Firestore)의 생산 기록을 Supabase 로 옮긴다.
`sync/run.py` 하나로 원육 박스부터 출퇴근까지 전부 처리한다.

    python sync/run.py            # 최근 30일 (기본)
    python sync/run.py --days 90  # 최근 90일
    python sync/run.py --all      # 전체 기간

모든 적재는 원본 문서 ID(`src_key`) 기준 upsert 이므로
몇 번을 다시 돌려도 중복이 생기지 않는다. 새 기록만 채워진다.

자동 실행은 `.github/workflows/sync.yml` 이 맡는다.
매일 한국시간 새벽 2시에 최근 30일치를 동기화하며,
Actions 탭에서 수동 실행하며 기간을 지정할 수도 있다.

접속 정보는 저장소에 두지 않는다. Actions 시크릿에 있다.

    FIREBASE_API_KEY / SUPABASE_URL / SUPABASE_KEY

부위 판정은 기존 웹의 규칙을 그대로 옮겼다.
근거를 찾지 못한 건은 추측해서 채우지 않고 비워 두며, 실행 로그에 목록이 남는다.
