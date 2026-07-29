/* 인증.
   현재 상태: 계정 저장소가 확정되지 않아 verify()는 연결되어 있지 않다.
   확정되면 verify() 한 함수만 교체하면 되고 나머지 코드는 건드리지 않는다.
   (기존 웹은 Firestore _config/auth 의 users 맵 + sha256 방식이었다.) */
(function(){
  var LS = 'ssbon2_auth';

  function getSession(){
    try {
      var s = JSON.parse(localStorage.getItem(LS) || 'null');
      return (s && s.id && s.role) ? s : null;
    } catch(e){ return null; }
  }

  function setSession(s, persist){
    if (persist) localStorage.setItem(LS, JSON.stringify(s));
    else sessionStorage.setItem(LS, JSON.stringify(s));
    window.SSBON.auth.session = s;
  }

  function clear(){
    localStorage.removeItem(LS);
    sessionStorage.removeItem(LS);
    window.SSBON.auth.session = null;
  }

  function restore(){
    var s = getSession();
    if (!s) {
      try { s = JSON.parse(sessionStorage.getItem(LS) || 'null'); } catch(e){ s = null; }
      if (s && !(s.id && s.role)) s = null;
    }
    window.SSBON.auth.session = s;
    return s;
  }

  /* 계정 검증. 저장소 확정 전까지는 실패를 그대로 알린다. */
  function verify(){
    return Promise.reject(new Error('NO_BACKEND'));
  }

  /* 화면 검토용 통과. 인증이 아니며, 백엔드 연결 시 제거한다. */
  function reviewSession(){
    return { id: '검토', role: 'admin', review: true };
  }

  window.SSBON.auth = {
    session: null,
    restore: restore,
    verify: verify,
    setSession: setSession,
    reviewSession: reviewSession,
    clear: clear
  };
})();
