// 관리자 로그인: 비번 게이트(소프트) + 세션 플래그 — window._isAdmin / adminLogin / adminLogout
// ※ 완벽 차단 아님(클라이언트 토글, window._isAdmin 콘솔 조작으로 우회 가능).
//   진짜 차단은 Firestore 규칙 잠금이 있어야 함. Phase 2에서 6월 override를 이 플래그에 물림.

(function(){
  var SS_KEY = 'ssbon_admin_v1'; // sessionStorage — 기기별·탭 세션 한정(다른 기기로 안 번짐)
  window._isAdmin = (sessionStorage.getItem(SS_KEY) === '1');

  // ── 관리자 override (수정본 6월 등) ──────────────────────────
  // 캐시: { 'YYYY-MM': { 'YYYY-MM-DD': {rm,pp,ck,sh} } }
  window._adminOv = window._adminOv || {};
  window._adminOvLoaded = window._adminOvLoaded || {};

  // 해당 월 override를 Firestore에서 1회 로드·캐시
  window._adminLoadOverride = async function(ym){
    if(!ym || window._adminOvLoaded[ym]) return;
    window._adminOvLoaded[ym] = true;
    try{
      var docId = 'admin_override_' + ym.replace('-','');
      var doc = await db.collection('_config').doc(docId).get();
      var data = (doc.exists && doc.data()) ? doc.data() : null;
      if(data && Array.isArray(data.days)){
        var map = {};
        data.days.forEach(function(d){
          if(d && d.date) map[d.date] = { rm:d.rm, pp:d.pp, ck:d.ck, sh:d.sh };
        });
        window._adminOv[ym] = map;
      }
    }catch(e){ window._adminOvLoaded[ym] = false; } // 실패 시 재시도 허용
  };

  // 관리자면서 그 날짜 override 있으면 수정값, 아니면 원래값 (동기)
  // field: 'rm'|'pp'|'ck'|'sh'
  window.adminBase = function(date, field, original){
    if(!window._isAdmin) return original;
    var ym = String(date||'').slice(0,7);
    var m = window._adminOv[ym];
    if(!m) return original;
    var r = m[String(date).slice(0,10)];
    if(!r) return original;
    var v = r[field];
    return (v == null) ? original : v;
  };

  // 로그인 모달 열기
  window.adminLogin = function(){
    if(window._isAdmin){ _adminRenderBadge(); return; }
    if(document.getElementById('_adminModal')) return;
    var ov = document.createElement('div');
    ov.id = '_adminModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:100000;display:flex;align-items:center;justify-content:center';
    ov.innerHTML =
      '<div style="background:#fff;border-radius:12px;padding:22px 24px;width:300px;box-shadow:0 12px 40px rgba(0,0,0,0.25);font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif">'
      +'<div style="font-weight:700;font-size:15px;margin-bottom:14px;color:#0f172a">🔒 관리자 로그인</div>'
      +'<input id="_adminId" type="text" autocomplete="username" placeholder="아이디" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;margin-bottom:8px">'
      +'<input id="_adminPw" type="password" autocomplete="current-password" placeholder="비밀번호" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;margin-bottom:6px">'
      +'<div id="_adminErr" style="color:#dc2626;font-size:12px;min-height:16px;margin-bottom:8px"></div>'
      +'<div style="display:flex;gap:8px">'
      +'<button onclick="_adminSubmit()" style="flex:1;padding:9px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">로그인</button>'
      +'<button onclick="_adminCloseModal()" style="padding:9px 14px;background:#f1f5f9;color:#334155;border:none;border-radius:8px;font-size:13px;cursor:pointer">취소</button>'
      +'</div></div>';
    document.body.appendChild(ov);
    document.getElementById('_adminId').focus();
    ['_adminId','_adminPw'].forEach(function(id){
      document.getElementById(id).addEventListener('keydown', function(e){ if(e.key === 'Enter') _adminSubmit(); });
    });
  };

  window._adminCloseModal = function(){
    var m = document.getElementById('_adminModal');
    if(m) m.remove();
  };

  window._adminSubmit = async function(){
    var idEl = document.getElementById('_adminId');
    var pwEl = document.getElementById('_adminPw');
    var inId = idEl ? idEl.value.trim() : '';
    var inPw = pwEl ? pwEl.value : '';
    var err = document.getElementById('_adminErr');
    if(!inId || !inPw){ if(err) err.textContent = '아이디와 비밀번호를 입력하세요.'; return; }
    var ok = false;
    try{
      var doc = await db.collection('_config').doc('admin_config').get();
      var data = (doc.exists && doc.data()) ? doc.data() : {};
      ok = (inId.toLowerCase() === (data.id || '').toLowerCase() && inPw === (data.password || ''));
    }catch(e){
      if(err) err.textContent = '확인 실패. 잠시 후 다시 시도하세요.';
      return;
    }
    if(!ok){ if(err) err.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.'; return; }
    window._isAdmin = true;
    sessionStorage.setItem(SS_KEY, '1');
    _adminCloseModal();
    _adminRenderBadge();
    if(typeof toast === 'function') toast('관리자 모드 ✓','s');
    // 6월 override 로드 후 현재 화면 갱신 (로드 완료돼야 수정본 반영)
    _adminLoadOverride('2026-06').then(function(){
      _adminRefreshView();
    });
  };

  window.adminLogout = function(){
    window._isAdmin = false;
    sessionStorage.removeItem(SS_KEY);
    _adminRenderLock();
    if(typeof toast === 'function') toast('관리자 모드 해제','s');
    _adminRefreshView();
  };

  // 비관리자: 작은 🔒 로그인 버튼 (좌하단)
  function _adminRenderLock(){
    var badge = document.getElementById('_adminBadge');
    if(badge) badge.remove();
    if(document.getElementById('_adminLock')) return;
    var b = document.createElement('div');
    b.id = '_adminLock';
    b.title = '관리자 로그인';
    b.onclick = adminLogin;
    b.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:99998;width:30px;height:30px;border-radius:50%;background:rgba(148,163,184,0.35);color:#475569;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.12)';
    b.textContent = '🔒';
    document.body.appendChild(b);
  }

  // 관리자: "관리자 모드" 배지 + 로그아웃 (좌하단)
  function _adminRenderBadge(){
    var lock = document.getElementById('_adminLock');
    if(lock) lock.remove();
    if(document.getElementById('_adminBadge')) return;
    var b = document.createElement('div');
    b.id = '_adminBadge';
    b.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:99998;background:#1d4ed8;color:#fff;padding:7px 12px;border-radius:20px;font-size:12px;font-weight:600;box-shadow:0 3px 10px rgba(0,0,0,0.2);display:flex;align-items:center;gap:8px;font-family:-apple-system,sans-serif';
    b.innerHTML = '🔓 관리자 모드 <span onclick="adminLogout()" style="cursor:pointer;text-decoration:underline;opacity:0.9">로그아웃</span>';
    document.body.appendChild(b);
  }

  // 제품 → 부위 설정 로드 (하드코딩 대신 데이터 — 게스트 포함 모두)
  window._loadProductParts = async function(){
    if(window._productPartsLoaded) return;
    window._productPartsLoaded = true;
    try{
      var doc = await db.collection('_config').doc('product_parts').get();
      var data = (doc.exists && doc.data()) ? doc.data() : null;
      if(data && data.parts) window._productParts = data.parts;
      // 가안 역산용 수율도 로드
      var doc2 = await db.collection('_config').doc('estimate_yields').get();
      var d2 = (doc2.exists && doc2.data()) ? doc2.data() : null;
      if(d2 && d2.yields) window._estYields = d2.yields;
    }catch(e){ window._productPartsLoaded = false; }
  };

  // 관리자 로그인/로그아웃 시 현재 보고 있는 화면 재렌더 (override 반영/해제)
  function _adminRefreshView(){
    try { if(typeof refreshCurrentTab_ === 'function') refreshCurrentTab_(); } catch(e){}   // 입력 모드
    try {
      if(typeof MODE !== 'undefined'){
        if(MODE === 'd'){                                                                    // 분석
          if(typeof DTAB !== 'undefined' && DTAB === 'monthly' && typeof renderMonthly === 'function') renderMonthly();
          else if(typeof DTAB !== 'undefined' && DTAB === 'daily' && typeof renderDaily === 'function') renderDaily();
        } else if(MODE === 'p'){                                                             // 실적관리(월단위생산량 등)
          if(typeof window._mpRerender === 'function') window._mpRerender();
        }
      }
    } catch(e){}
  }

  function _adminInitUI(){
    _loadProductParts();
    if(window._isAdmin){ _adminRenderBadge(); _adminLoadOverride('2026-06'); }
    else _adminRenderLock();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _adminInitUI);
  else _adminInitUI();
})();
