/* ─── 로그인 · 권한 (login.js) ───
   계정: Firestore _config/auth 문서의 users 맵 { 아이디: { h: sha256(비번), role: 'worker'|'admin' } }
   worker: 입력·일정표·출퇴근만  /  admin: 전체
   세션: localStorage 'ssbon_auth' (기기별 로그인 유지 — 작업 데이터 아님)      */
(function(){
  var LS_KEY='ssbon_auth';
  var API_KEY='AIzaSyA0Y6VK8EOahDE607LEWtyG9-U8YP3yqDE';
  var AUTH_URL='https://firestore.googleapis.com/v1/projects/ssbon-factory/databases/(default)/documents/_config/auth?key='+API_KEY;

  function sha256(str){
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function(buf){
      return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    });
  }
  function getSession(){
    try{ var s=JSON.parse(localStorage.getItem(LS_KEY)); return (s&&s.u&&s.role)?s:null; }catch(e){ return null; }
  }

  /* 권한 적용: worker면 관리 메뉴 숨김 */
  function applyRole(role){
    document.body.dataset.role=role;
    if(role!=='admin'){
      ['modeD','modeP','modeAI'].forEach(function(id){
        var el=document.getElementById(id); if(el) el.style.display='none';
      });
      /* 혹시 분석 화면이 열려있으면 입력으로 강제 이동 */
      if(typeof setMode==='function'){ try{ setMode('i'); }catch(e){} }
    }
    addLogoutBadge(role);
  }

  function addLogoutBadge(role){
    if(document.getElementById('authBadge')) return;
    var s=getSession(); if(!s) return;
    var b=document.createElement('button');
    b.id='authBadge'; b.className='mb';
    b.textContent='👤 '+s.u+(role==='admin'?' (관리자)':'');
    b.style.cssText='margin-left:6px;font-size:12px;opacity:.85';
    b.onclick=function(){
      if(confirm('로그아웃 하시겠습니까?')){ localStorage.removeItem(LS_KEY); location.reload(); }
    };
    var anchor=document.getElementById('modeAI')||document.getElementById('modeD');
    if(anchor&&anchor.parentNode) anchor.parentNode.appendChild(b);
  }

  function showOverlay(){
    var ov=document.createElement('div');
    ov.id='loginOv';
    ov.style.cssText='position:fixed;inset:0;background:#1b2a44;z-index:99999;display:flex;align-items:center;justify-content:center';
    ov.innerHTML=
      '<div style="background:#fff;border-radius:14px;padding:34px 30px;width:320px;box-shadow:0 10px 40px rgba(0,0,0,.35)">'+
      '<div style="font-size:19px;font-weight:bold;color:#1b2a44;text-align:center">순수본 2공장</div>'+
      '<div style="font-size:12.5px;color:#78808c;text-align:center;margin:4px 0 20px">로그인이 필요합니다</div>'+
      '<input id="lgU" placeholder="아이디" autocomplete="username" style="width:100%;height:44px;font-size:15px;border:1px solid #d5dbe4;border-radius:8px;padding:0 12px;margin-bottom:8px;box-sizing:border-box">'+
      '<input id="lgP" type="password" placeholder="비밀번호" autocomplete="current-password" style="width:100%;height:44px;font-size:15px;border:1px solid #d5dbe4;border-radius:8px;padding:0 12px;box-sizing:border-box">'+
      '<div id="lgMsg" style="font-size:12px;color:#b03933;height:18px;margin:6px 2px 2px"></div>'+
      '<button id="lgBtn" style="width:100%;height:46px;font-size:15px;font-weight:bold;color:#fff;background:#2b57c5;border:none;border-radius:8px;cursor:pointer">로그인</button>'+
      '</div>';
    document.body.appendChild(ov);
    var doLogin=function(){
      var u=document.getElementById('lgU').value.trim();
      var p=document.getElementById('lgP').value;
      var msg=document.getElementById('lgMsg');
      if(!u||!p){ msg.textContent='아이디와 비밀번호를 입력하세요'; return; }
      msg.textContent='확인 중...'; msg.style.color='#78808c';
      fetch(AUTH_URL).then(function(r){return r.json();}).then(function(doc){
        var users=(doc.fields&&doc.fields.users&&doc.fields.users.mapValue&&doc.fields.users.mapValue.fields)||{};
        var rec=users[u]&&users[u].mapValue&&users[u].mapValue.fields;
        if(!rec){ msg.textContent='아이디 또는 비밀번호가 다릅니다'; msg.style.color='#b03933'; return; }
        sha256(p).then(function(h){
          if(h!==(rec.h&&rec.h.stringValue)){ msg.textContent='아이디 또는 비밀번호가 다릅니다'; msg.style.color='#b03933'; return; }
          var role=(rec.role&&rec.role.stringValue)||'worker';
          localStorage.setItem(LS_KEY, JSON.stringify({u:u, role:role, t:Date.now()}));
          ov.remove(); applyRole(role);
        });
      }).catch(function(){ msg.textContent='네트워크 오류 — 다시 시도하세요'; msg.style.color='#b03933'; });
    };
    document.getElementById('lgBtn').onclick=doLogin;
    document.getElementById('lgP').addEventListener('keydown',function(e){ if(e.key==='Enter') doLogin(); });
    setTimeout(function(){ var el=document.getElementById('lgU'); if(el) el.focus(); },100);
  }

  function boot(){
    var s=getSession();
    if(s){ applyRole(s.role); } else { showOverlay(); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
