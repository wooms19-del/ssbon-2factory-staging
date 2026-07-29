/* 인증.
   계정 저장소가 확정되지 않아 verify()는 연결되어 있지 않다.
   확정되면 verify() 한 함수만 교체하면 되고 나머지 코드는 건드리지 않는다. */
(function(){
  var LS='ssbon2_auth';
  function read(store){ try{ var s=JSON.parse(store.getItem(LS)||'null'); return (s&&s.id&&s.role)?s:null; }catch(e){ return null; } }
  function restore(){ var s=read(localStorage)||read(sessionStorage); window.SSBON.auth.session=s; return s; }
  function setSession(s,persist){
    (persist?localStorage:sessionStorage).setItem(LS, JSON.stringify(s));
    window.SSBON.auth.session=s;
  }
  function clear(){ localStorage.removeItem(LS); sessionStorage.removeItem(LS); window.SSBON.auth.session=null; }
  function verify(){ return Promise.reject(new Error('NO_BACKEND')); }
  function reviewSession(){ return { id:'검토', role:'admin', review:true }; }
  window.SSBON.auth={ session:null, restore:restore, verify:verify,
    setSession:setSession, reviewSession:reviewSession, clear:clear };
})();
