// (GAS_URL 제거됨 — 구글시트 백업 안 씀)


var firebaseConfig = {
  apiKey: "AIzaSyA0Y6VK8EOahDE607LEWtyG9-U8YP3yqDE",
  authDomain: "ssbon-factory.firebaseapp.com",
  projectId: "ssbon-factory",
  storageBucket: "ssbon-factory.firebasestorage.app",
  messagingSenderId: "815013258298",
  appId: "1:815013258298:web:a80156143cf742ece8c103"
};

firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();

// ============================================================
// 🔐 익명 인증 — 외부 무단 접근 차단용
// 앱 시작 시 자동으로 익명 로그인. 사용자는 아무것도 안 함(화면 변화 없음).
// Firestore 규칙을 "request.auth != null" 로 잠그면, 통행증 없는
// 외부 요청은 차단되고 이 앱에서 온 요청만 통과.
// 실패해도 앱은 계속 동작(규칙 잠그기 전까지는 영향 없음).
// ============================================================
window._authReady = false;
if (firebase.auth) {
  firebase.auth().signInAnonymously().then(function(){
    window._authReady = true;
    console.log('[auth] 익명 로그인 성공');
  }).catch(function(err){
    console.warn('[auth] 익명 로그인 실패 (무시):', err && err.message);
  });
} else {
  console.warn('[auth] firebase.auth 미로드 — Auth SDK 확인 필요');
}

// ============================================================
// 외포장 완료 EA 계산 헬퍼
// outerEa(박스×입수) + remainEa(잔량 EA) 합산
// 외포장 EA를 표시/집계하는 모든 곳에서 사용
// ============================================================
function opEa(r){
  if(!r) return 0;
  var oe = parseInt(r.outerEa)||0;
  // ★ 잔량 EA(remainEa)는 2026-05-01부터 적용 (4월 이전은 outerEa만)
  var date = String(r.date||'').slice(0,10);
  if(date && date >= '2026-05-01'){
    return oe + (parseInt(r.remainEa)||0);
  }
  return oe;
}

// ============================================================
// 🔄 자동 reload — 새 코드 배포 시 모든 디바이스 즉시 reload
// 사용 예: deploy 후 _config/version 문서의 value를 새 timestamp로 set
// 태블릿이 며칠 켜져있어도 자동 갱신됨
//
// 입력 중 가드: 사용자가 input/textarea에 값 적고 있거나 focus되어 있으면
//             reload 미루고 토스트로 알림. 입력 끝나면 자동 reload.
// ============================================================

// 입력 중 여부 판단
function _isUserBusy(){
  // -1. 비동기 저장/삭제/갱신 진행 중이면 busy (race condition 차단)
  if((window._inProgress||0) > 0) return true;
  // 0. 최근 30초 내 사용자 활동 (마우스/터치/키보드) 있으면 busy
  //    "시작" 같은 액션 직후 폼이 비워져도 reload 미루기 위함
  if(window._lastActivityAt && (Date.now() - window._lastActivityAt) < 30000) return true;
  // 1. 현재 focus된 요소가 input/textarea/select?
  const ae = document.activeElement;
  if(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')){
    if(!ae.disabled && !ae.readOnly) return true;
  }
  // 2. 어떤 input/textarea에 값이 들어가 있는데 비워지지 않은 상태?
  const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="time"], input[type="date"], textarea');
  for(const el of inputs){
    if(el.disabled || el.readOnly) continue;
    if(el.value && el.value.trim() !== '' && el.value !== el.defaultValue){
      // placeholder만 있는 빈 입력칸이 아니라, 사용자가 뭔가 적어둠
      return true;
    }
  }
  return false;
}

// 사용자 활동 추적 — _isUserBusy 의 "최근 30초" 체크용
window._lastActivityAt = Date.now();
['mousemove','click','keydown','touchstart','scroll'].forEach(function(ev){
  document.addEventListener(ev, function(){ window._lastActivityAt = Date.now(); }, {passive:true, capture:true});
});

// 대기 중인 새 버전
window._pendingNewVer = null;

// 토스트 한 번만 띄움
window._reloadToastShown = false;
function _showReloadToast(newVer){
  if(window._reloadToastShown) return;
  window._reloadToastShown = true;
  // 기존 toast 함수 있으면 사용, 없으면 직접 div 띄움
  const div = document.createElement('div');
  div.id = '_reloadBanner';
  div.style.cssText = 'position:fixed;top:60px;right:16px;z-index:9999;background:#1d4ed8;color:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);font-size:13px;max-width:320px';
  div.innerHTML = '🔄 새 버전 있음<div style="font-size:11px;opacity:0.85;margin-top:4px">작업 중인 입력이 있어 자동 적용을 기다리고 있습니다</div><div style="margin-top:8px;display:flex;gap:6px"><button onclick="_applyReloadNow()" style="background:#fff;color:#1d4ed8;border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">지금 적용</button><button onclick="document.getElementById(\'_reloadBanner\').remove();window._reloadToastShown=false" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px">나중에</button></div>';
  document.body.appendChild(div);
}

window._applyReloadNow = function(){
  console.log('[auto-reload] 사용자가 즉시 적용 선택');
  location.reload(true);
};

// 1초마다 입력 비었는지 체크 → 비었으면 reload (자동)
setInterval(function(){
  if(!window._pendingNewVer) return;
  if(!_isUserBusy()){
    console.log('[auto-reload] 입력 종료 감지 — reload');
    location.reload(true);
  }
}, 1000);

db.collection('_config').doc('version').onSnapshot(function(snap){
  if(!snap.exists) return;
  var v = snap.data() && snap.data().value;
  if(!v) return;
  if(window._appVer && window._appVer !== v){
    if(_isUserBusy()){
      console.log('[auto-reload] 입력 중 — reload 대기:', window._appVer, '→', v);
      window._pendingNewVer = v;
      _showReloadToast(v);
      // _appVer 갱신 안 함 → 다음 onSnapshot도 같은 비교 가능
    } else {
      console.log('[auto-reload] 새 버전 감지 — 즉시 reload:', window._appVer, '→', v);
      location.reload(true);
    }
  }
  if(!window._pendingNewVer) window._appVer = v;
}, function(err){
  console.warn('[auto-reload] listener 오류 (무시):', err && err.message);
});

// ============================================================
// 🔄 listener fault tolerance — onSnapshot 끊겨도 새 버전 감지
// 문제: 모바일/태블릿 백그라운드·절전·장시간 켜둔 경우 onSnapshot 연결 끊김.
//       이 디바이스는 _config/version PATCH 받지 못해 영영 옛 코드 실행.
// 해결: (1) 탭 다시 활성화될 때 (2) 창 focus될 때 (3) 60초마다
//       manual fetch로 version 비교 → onSnapshot과 같은 reload 분기 실행.
// 영향: listener 살아있으면 중복 동작이지만 무해 (같은 _appVer면 분기 통과 X).
//       listener 끊긴 디바이스는 이 셋 중 하나라도 trigger되면 reload.
// ============================================================
window._checkVersionNow = function(reason){
  db.collection('_config').doc('version').get().then(function(snap){
    if(!snap.exists) return;
    var v = snap.data() && snap.data().value;
    if(!v) return;
    if(window._appVer && window._appVer !== v){
      if(_isUserBusy()){
        console.log('[version-check:'+reason+'] 입력 중 — reload 대기:', window._appVer, '→', v);
        window._pendingNewVer = v;
        _showReloadToast(v);
      } else {
        console.log('[version-check:'+reason+'] 새 버전 감지 — 즉시 reload:', window._appVer, '→', v);
        location.reload(true);
      }
    }
    if(!window._pendingNewVer && !window._appVer) window._appVer = v;
  }).catch(function(err){
    console.warn('[version-check:'+reason+'] fetch 실패 (무시):', err && err.message);
  });
};

// (1) 탭 visibility — 백그라운드에서 다시 보일 때
document.addEventListener('visibilitychange', function(){
  if(!document.hidden) window._checkVersionNow('visibility');
});

// (2) 창 focus — 다른 앱에서 돌아올 때
window.addEventListener('focus', function(){
  window._checkVersionNow('focus');
});

// (3) 60초 폴링 — 위 둘 다 안 트리거되는 극단 케이스 안전망
setInterval(function(){ window._checkVersionNow('poll'); }, 60000);

// ============================================================
// 🔄 BFCache 무효화 — 태블릿 잠금 풀고 페이지 부활 시 강제 reload
// 문제: Chrome Android는 페이지를 메모리에 통째로 보존하는 BFCache 사용.
//      잠금 풀 때 메모리에서 부활 → 옛 코드 그대로 실행.
//      자동 reload listener도 1~2분 lag 있어 그 사이 옛 코드로 저장 가능.
// 해결: pageshow 이벤트의 e.persisted=true (BFCache 부활) 시 즉시 reload.
// 영향: 잠금 풀고 들어왔을 때 한 번 reload → 새 코드 보장.
//      신규 페이지 진입은 영향 X (e.persisted=false).
// ============================================================
window.addEventListener('pageshow', function(e){
  if(e.persisted){
    console.log('[bfcache] 페이지 부활 감지 — reload (옛 코드 방지)');
    location.reload();
  }
});

// ============================================================
// 🔧 STAGING MODE - production은 절대 영향받지 않음
// ============================================================
const _STAGING_MODE = false;

if(_STAGING_MODE){
  // 1) 화면에 "STAGING" 빨간 배지 표시
  window.addEventListener('DOMContentLoaded', function(){
    var badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;top:0;right:0;background:#dc2626;color:#fff;padding:6px 14px;font-weight:700;font-size:12px;z-index:99999;border-bottom-left-radius:8px;font-family:system-ui;box-shadow:0 2px 8px rgba(0,0,0,0.3);letter-spacing:0.5px';
    badge.innerHTML = '🔧 STAGING — 저장 차단됨';
    badge.title = '리팩토링 테스트 환경입니다. 모든 저장 동작이 콘솔로만 출력되고 실제 DB에 반영되지 않습니다.';
    document.body.appendChild(badge);
    console.log('%c🔧 STAGING MODE', 'background:#dc2626;color:#fff;padding:4px 8px;font-size:14px;font-weight:bold');
    console.log('%c모든 Firebase write가 차단됩니다 (read만 가능)', 'color:#dc2626;font-weight:bold');
  });

  // 2) Firebase write 차단
  //    common.js 뒤쪽에서 fbSave/fbUpdate/fbDelete 정의되므로
  //    setTimeout으로 정의 후 wrap
  setTimeout(function(){
    var origSave   = window.fbSave;
    var origUpdate = window.fbUpdate;
    var origDelete = window.fbDelete;
    var origSet    = window.fbSet;

    window.fbSave = function(coll, data){
      console.log('[STAGING] fbSave 차단:', coll, data);
      if(typeof toast === 'function') toast('🔧 STAGING - 저장 시뮬레이션 (실제 저장 안됨)','d');
      return Promise.resolve({id: 'staging-' + Date.now()});
    };
    window.fbUpdate = function(coll, id, data){
      console.log('[STAGING] fbUpdate 차단:', coll, id, data);
      return Promise.resolve();
    };
    window.fbDelete = function(coll, id){
      console.log('[STAGING] fbDelete 차단:', coll, id);
      return Promise.resolve();
    };
    if(origSet){
      window.fbSet = function(coll, id, data){
        console.log('[STAGING] fbSet 차단:', coll, id, data);
        return Promise.resolve();
      };
    }
    console.log('%c[STAGING] Firebase write 차단 완료', 'color:#16a34a');
  }, 100);

  // 4) localStorage 차단 (production과 origin 같아 공유되는 문제 해결)
  //    메모리 객체에만 저장 — staging 새로고침 시 초기화 (의도된 동작)
  (function(){
    var _stagingMem = {};
    var _origGet = localStorage.getItem.bind(localStorage);
    var _origSet = localStorage.setItem.bind(localStorage);
    var _origRemove = localStorage.removeItem.bind(localStorage);
    var _origClear = localStorage.clear.bind(localStorage);

    // staging이 격리해야 할 키 패턴
    function _isStagingKey(k){
      if(!k) return false;
      return k.startsWith('att_day_') ||
             k.startsWith('att_employees') ||
             k.startsWith('ssbon_') ||
             k.startsWith('schedule_') ||
             k.startsWith('recipe_') ||
             k.startsWith('inventory_') ||
             k.startsWith('settings_');
    }

    Storage.prototype.setItem = function(k, v){
      if(this === localStorage && _isStagingKey(k)){
        _stagingMem[k] = String(v);
        console.log('[STAGING] localStorage.setItem 격리:', k);
        return;
      }
      return _origSet(k, v);
    };
    Storage.prototype.getItem = function(k){
      if(this === localStorage && _isStagingKey(k)){
        // 메모리 우선, 없으면 production 데이터를 한 번 read하지만 staging 메모리에는 복사 안 함
        // 즉 처음 읽을 땐 production 데이터 보여주되, 수정 시작하면 staging 메모리에서만 동작
        if(_stagingMem[k] !== undefined) return _stagingMem[k];
        return _origGet(k);  // production 캐시 읽기는 허용 (read-only 효과)
      }
      return _origGet(k);
    };
    Storage.prototype.removeItem = function(k){
      if(this === localStorage && _isStagingKey(k)){
        delete _stagingMem[k];
        console.log('[STAGING] localStorage.removeItem 격리:', k);
        return;
      }
      return _origRemove(k);
    };

    console.log('%c[STAGING] localStorage 격리 완료 (메모리에만 저장, production 오염 차단)', 'color:#16a34a');
  })();

  // 3) Firestore 직접 호출도 차단 (firebase.firestore().collection().add() 등)
  //    SDK 자체를 wrap
  if(typeof firebase !== 'undefined' && firebase.firestore){
    var _origFirestore = firebase.firestore;
    firebase.firestore = function(){
      var fs = _origFirestore.apply(firebase, arguments);
      var _origCollection = fs.collection.bind(fs);
      fs.collection = function(name){
        var coll = _origCollection(name);
        var _origAdd = coll.add ? coll.add.bind(coll) : null;
        var _origDoc = coll.doc.bind(coll);
        if(_origAdd){
          coll.add = function(data){
            console.log('[STAGING] firestore add 차단:', name, data);
            return Promise.resolve({id: 'staging-' + Date.now()});
          };
        }
        coll.doc = function(id){
          var doc = _origDoc(id);
          var _origSet = doc.set.bind(doc);
          var _origUpdate = doc.update.bind(doc);
          var _origDelete = doc.delete.bind(doc);
          doc.set = function(data, opts){
            console.log('[STAGING] firestore set 차단:', name, id, data);
            return Promise.resolve();
          };
          doc.update = function(data){
            console.log('[STAGING] firestore update 차단:', name, id, data);
            return Promise.resolve();
          };
          doc.delete = function(){
            console.log('[STAGING] firestore delete 차단:', name, id);
            return Promise.resolve();
          };
          return doc;
        };
        return coll;
      };
      return fs;
    };
  }
}
// ============================================================


// ============================================================
// 상태 변수
// ============================================================
var SK = 'ssbon_v6';
var MODE='i', ITAB='barcode', DTAB='daily', DDATE=tod(), PD='week';
var PEND=null, _lastCode='';
var _ppSelectedWagons = []; // 전처리 지금시작 시 선택된 대차 저장
var L; // Firebase 초기화 후 로드
var _unsubscribes = [];

// ============================================================
// 로컬 스토리지 (오프라인 버퍼)
// ============================================================
// ============================================================
// 작업 데이터 (thawing/preprocess/cooking/shredding/packing/sauce, _pending 포함, barcodes)
// → localStorage에 절대 저장하지 않음. Firestore가 단일 source of truth.
// 설정 데이터 (products/sauces/submats/gtinMap/recipes) → localStorage OK (별도 정리 예정).
// ============================================================
const WORK_KEYS = ['barcodes','thawing','preprocess','cooking','shredding','packing','sauce',
                   'packing_pending','cooking_pending'];

function pruneOldData(d) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  const cutStr = cutoff.toISOString().slice(0,10);
  WORK_KEYS.filter(k => k !== 'packing_pending' && k !== 'cooking_pending').forEach(k => {
    if(Array.isArray(d[k])) d[k] = d[k].filter(r => String(r.date||'').slice(0,10) >= cutStr);
  });
}
function loadL(){
  try{
    const raw = JSON.parse(localStorage.getItem(SK));
    const base = nL();
    if(!raw){
      return base;  // 작업 데이터 모두 빈 배열 (Firestore 로드 대기)
    }
    // ★ 작업 데이터는 localStorage 무시 — 항상 빈 배열로 시작 (Firestore가 채움)
    WORK_KEYS.forEach(k => { raw[k] = []; });
    // 설정 데이터만 localStorage 사용
    if(!raw.products || !raw.products.length) raw.products = base.products;
    else {
      // 베이스에 추가된 신제품이 있으면 자동 병합 (사용자 localStorage에 누락된 것)
      base.products.forEach(bp => {
        if(!raw.products.find(p => p.name === bp.name)){
          raw.products.push(bp);
        }
      });
    }
    if(!raw.sauces)   raw.sauces   = base.sauces;
    if(!raw.submats)  raw.submats  = base.submats;
    if(!raw.gtinMap)  raw.gtinMap  = base.gtinMap;
    if(!raw.recipes)  raw.recipes  = {};
    return raw;
  }
  catch(e){ return nL(); }
}
function saveL(){
  if(!L) return;
  // ★ 작업 데이터는 localStorage에서 제외하고 설정 데이터만 저장
  const persist = {};
  Object.keys(L).forEach(k => {
    if(!WORK_KEYS.includes(k)) persist[k] = L[k];
  });
  try { localStorage.setItem(SK, JSON.stringify(persist)); }
  catch(e){ console.warn('saveL 실패:', e); }
}
function nL(){
  return {
    barcodes:[], thawing:[], preprocess:[], cooking:[], shredding:[], packing:[], sauce:[],
    packing_pending:[], cooking_pending:[],
    products:[
      {name:'코스트코 장조림 170g',   kgea:0.054, capa:1500, sauce:'FC 장조림 소스'},
      {name:'시그니처 장조림 130g',   kgea:0.025, capa:800,  sauce:'FC 장조림 소스'},
      {name:'미니쇠고기장조림 70g 낱개', kgea:0.024, capa:700,  sauce:'FC 장조림 소스'},
      {name:'미니쇠고기장조림 70g 5입',  kgea:0.024, capa:700,  sauce:'FC 장조림 소스'},
      {name:'시그니처 장조림 120g',   kgea:0.030, capa:700,  sauce:'FC 장조림 소스'},
      {name:'시그니처 장조림 130g 마트용', kgea:0.025, capa:800, sauce:'FC 장조림 소스'},
      {name:'FC 장조림 3KG',          kgea:1.3,   capa:500,  sauce:'FC 장조림 소스'},
      {name:'트레이더스 장조림 460g', kgea:0.147, capa:2100, sauce:'FC 장조림 소스'},
    ],
    sauces:[{name:'FC 장조림 소스', memo:'기본 배합'},{name:'FP 장조림 소스', memo:'기본 배합'}],
    submats:['메추리알','버터'],
    gtinMap:{
      '99351990207011':'설도','99331079038156':'설도',
      '99401040912614':'홍두깨','99331079060461':'우둔',
      '99337638062761':'설도','99331079015898':'설도'
    },
    recipes:{}  // {제품명: {inner:[{name,qty,unit}], outer:[{name,qty,unit,pkgType}]}}
  };
}

// ============================================================
// GTIN 마스터 — Firestore 공유 저장소
// _config/gtin_map: { map: {gtin: part, ...} }
// ============================================================
async function syncGtinMapFromFirestore(){
  try {
    if(typeof db === 'undefined' || !db){ return false; }
    const doc = await db.collection('_config').doc('gtin_map').get();
    if(!doc.exists){
      // Firestore에 없으면 현재 로컬 값으로 초기화
      await db.collection('_config').doc('gtin_map').set({
        map: L.gtinMap || {},
        updatedAt: new Date().toISOString()
      });
      return true;
    }
    const data = doc.data() || {};
    const remoteMap = data.map || {};
    if(!L) L = nL();
    // Firestore가 진실의 출처 — 로컬은 폴백
    L.gtinMap = Object.assign({}, L.gtinMap, remoteMap);
    saveL();
    return true;
  } catch(e){
    console.warn('[gtinMap] Firestore sync 실패 (로컬 폴백 사용):', e);
    return false;
  }
}

// 수입코드 → gtinMap 키
//   01... : 일반 GS1 (AI 01 뒤 14자리 GTIN)
//   02... : 호주 EST224 16자리 (제품코드 4자리, 'AU' 접두 — 숫자 시작 필드경로 회피)
function gtinKeyOf(importCode){
  const ic = String(importCode || '');
  if(ic.startsWith('01')) return ic.slice(2,16);
  if(/^02\d{14}$/.test(ic)) return 'AU' + ic.slice(2,6);
  return '';
}

// 신규 GTIN 등록
async function registerGtin(gtin, part){
  gtin = String(gtin||'').trim();
  part = String(part||'').trim();
  if(!gtin || !part) throw new Error('GTIN과 부위는 필수입니다');
  if(!L) L = nL();
  L.gtinMap[gtin] = part;
  saveL();
  // Firestore 업데이트 — ★ 해당 GTIN 필드만 update (통째 set 금지: 다른 기기 등록분 덮어쓰기 방지)
  if(typeof db !== 'undefined' && db){
    try {
      const upd = { updatedAt: new Date().toISOString() };
      upd['map.'+gtin] = part;
      await db.collection('_config').doc('gtin_map').update(upd);
    } catch(e){
      // 문서가 없을 때만 set으로 생성 (최신 원격본 병합 후)
      await syncGtinMapFromFirestore();
      L.gtinMap[gtin] = part;
      saveL();
      await db.collection('_config').doc('gtin_map').set({
        map: L.gtinMap,
        updatedAt: new Date().toISOString()
      });
    }
  }
  return true;
}

// GTIN 삭제
async function unregisterGtin(gtin){
  gtin = String(gtin||'').trim();
  if(!gtin) return false;
  if(!L) L = nL();
  delete L.gtinMap[gtin];
  saveL();
  // ★ 해당 GTIN 필드만 삭제 (통째 set 금지: 다른 기기 등록분 덮어쓰기 방지)
  if(typeof db !== 'undefined' && db){
    try {
      const upd = { updatedAt: new Date().toISOString() };
      upd['map.'+gtin] = firebase.firestore.FieldValue.delete();
      await db.collection('_config').doc('gtin_map').update(upd);
    } catch(e){
      console.warn('[gtinMap] 삭제 update 실패:', e);
    }
  }
  return true;
}

// 부적합/확인필요 barcode record 자동 재판정
// 반환: { fixed: N, stillUnknown: M, unknownGtins: [...] }
async function rejudgeBarcodes(){
  if(typeof db === 'undefined' || !db) throw new Error('Firestore 미연결');
  if(!L) L = nL();

  // 1) 부적합/확인필요 record 찾기 (status='부적합' OR part='확인필요' OR type='')
  // Firestore는 OR 쿼리 제한 있어서 두 번 fetch 후 merge
  const set = {};
  const q1 = await db.collection('barcode').where('status','==','부적합').get();
  q1.forEach(d => { set[d.id] = d.data(); });
  const q2 = await db.collection('barcode').where('part','==','확인필요').get();
  q2.forEach(d => { set[d.id] = d.data(); });

  let fixed = 0;
  const stillUnknown = {};
  for(const [docId, rec] of Object.entries(set)){
    const ic = String(rec.importCode || '');
    const gtin = gtinKeyOf(ic);
    const newPart = L.gtinMap[gtin];
    if(!newPart){
      if(gtin) stillUnknown[gtin] = (stillUnknown[gtin]||0) + 1;
      continue;
    }
    // 재판정: part, type, status, reason 필드 업데이트
    await db.collection('barcode').doc(docId).update({
      part: newPart,
      type: newPart,
      status: '적합',
      reason: ''
    });
    fixed++;
  }
  return { fixed, stillUnknown };
}

// 미등록 GTIN 자동 추출 (현재 부적합 record에서)
async function findUnknownGtins(){
  if(typeof db === 'undefined' || !db) return [];
  if(!L) L = nL();
  const set = {};
  const q1 = await db.collection('barcode').where('status','==','부적합').get();
  q1.forEach(d => { set[d.id] = d.data(); });
  const q2 = await db.collection('barcode').where('part','==','확인필요').get();
  q2.forEach(d => { set[d.id] = d.data(); });
  const counts = {};
  for(const rec of Object.values(set)){
    const ic = String(rec.importCode || '');
    const gtin = gtinKeyOf(ic);
    if(!gtin) continue;
    if(L.gtinMap[gtin]) continue;  // 이미 등록된 건 제외
    counts[gtin] = (counts[gtin]||0) + 1;
  }
  return Object.entries(counts).map(([gtin, cnt]) => ({ gtin, count: cnt }));
}

// 전역 노출
window.syncGtinMapFromFirestore = syncGtinMapFromFirestore;
window.gtinKeyOf = gtinKeyOf;
window.registerGtin = registerGtin;
window.unregisterGtin = unregisterGtin;
window.rejudgeBarcodes = rejudgeBarcodes;
window.findUnknownGtins = findUnknownGtins;


// ============================================================
// 유틸
// ============================================================
function tod(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
const DAYS=['일','월','화','수','목','금','토'];
function dayOfWeek(dateStr){ const d=new Date(dateStr+'T00:00:00'); return DAYS[d.getDay()]; }
function dateWithDay(dateStr){ return dateStr+' ('+dayOfWeek(dateStr)+')'; }
function setText(id,v){ const el=document.getElementById(id); if(el) el.textContent=v; }
function getYesterday_(){
  // ★ tod() 기반 (헤더 날짜 변경 반영) + 로컬 컴포넌트 직접 조립 (UTC 어긋남 방지)
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate()-1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function gid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function r2(v){ return Math.round(parseFloat(v)*100)/100; }
function dedupeRec(arr, keyFn){ const seen=new Set(); return arr.filter(r=>{ const k=keyFn(r); if(seen.has(k)) return false; seen.add(k); return true; }); }
function addDays(dateStr,n){var p=String(dateStr||'').split('-').map(Number);var dt=new Date(p[0],p[1]-1,p[2]+n);return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');}
// HH:MM 추출 (datetime "YYYY-MM-DD HH:MM" 또는 HH:MM 둘 다 처리)
function _hm(s){ return s ? (String(s).length > 5 ? String(s).slice(-5) : String(s).slice(0,5)) : ''; }
function dur(s,e){
  if(!s||!e) return 0;
  const tm=t=>{const hm=_hm(t);const p=hm.split(':');return+p[0]*60+(+p[1]||0);};
  let d=tm(e)-tm(s); if(d<0)d+=1440; return r2(d/60);
}

// 여러 레코드의 중복 제거한 실제 가동 시간 (병렬 작업 고려)
function calcActualHours(recs){
  const tm=t=>{const hm=_hm(t);const p=hm.split(':');return+p[0]*60+(+p[1]||0);};
  const intervals=[];
  recs.forEach(r=>{
    if(!r.start||!r.end) return;
    let s=tm(r.start), e=tm(r.end);
    if(e<s) e+=1440;
    intervals.push([s,e]);
  });
  if(!intervals.length) return 0;
  intervals.sort((a,b)=>a[0]-b[0]);
  const merged=[intervals[0].slice()];
  for(let i=1;i<intervals.length;i++){
    const last=merged[merged.length-1];
    if(intervals[i][0]<=last[1]) last[1]=Math.max(last[1],intervals[i][1]);
    else merged.push(intervals[i].slice());
  }
  return r2(merged.reduce((s,[a,b])=>s+(b-a),0)/60);
}
function sumMH(recs){ return r2(recs.reduce((s,r)=>s+dur(r.start,r.end)*(parseFloat(r.workers)||0),0)); }
function nowHM(){
  const n=new Date();
  return String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
}

// ============================================================
// Firebase CRUD
// ============================================================

// (gasRecord 제거됨 — Firestore가 단일 진실 원천. 구글시트 백업 없음.)

// 읽기 쉬운 문서 ID 생성 (공정prefix_날짜_시간)
function makeDocId(colName) {
  const prefix = {barcode:'bc',thawing:'th',preprocess:'pp',cooking:'ck',shredding:'sh',packing:'pk',sauce:'sc'};
  const now = new Date();
  // 로컬 날짜 문자열 (타임존 안전)
  const todayStr = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  // thawing은 종료일(다음날) 기준으로 ID 생성
  const dateStr = (colName === 'thawing') ? addDays(todayStr, 1) : todayStr;
  const d = dateStr.replace(/-/g,'');
  // 시각은 실제 시작 시각(now) 그대로 + 밀리초까지 (docId 충돌 방지)
  const t = String(now.getHours()).padStart(2,'0') +
    String(now.getMinutes()).padStart(2,'0') +
    String(now.getSeconds()).padStart(2,'0') +
    String(now.getMilliseconds()).padStart(3,'0');
  return `${prefix[colName]||colName}_${d}_${t}`;
}

// 저장
async function fbSave(colName, data, customDocId) {
  window._inProgress = (window._inProgress||0) + 1;
  try {
    let docId = customDocId || makeDocId(colName);
    // thawing 저장 시 무결성 검증·보정
    if(colName === 'thawing') {
      // (1) 옛 코드 잔재 정리: wagon 필드 있으면 cart로 흡수 후 wagon 삭제
      //     (방혈은 cart만 사용. wagon 필드는 thawing record에 절대 남기지 않음)
      if(data.wagon !== undefined) {
        if(!data.cart) data = {...data, cart: data.wagon};
        const cleaned = {...data};
        delete cleaned.wagon;
        data = cleaned;
      }

      // (2) cart 필수 검증: 비어있으면 저장 거부 (조용한 폴백 X)
      if(!data.cart || String(data.cart).trim() === '') {
        console.error('[fbSave] thawing 저장 거부 — cart 필수');
        toast('방혈 저장 실패: 해동대차 번호 필수','d');
        return null;
      }

      // (3) start 형식 검증 — datetime("YYYY-MM-DD HH:MM") 강제. 옛 페이지는 시간만 보내므로 거부.
      if(!data.start || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(data.start)) {
        console.error('[fbSave] thawing 저장 거부 — start는 "YYYY-MM-DD HH:MM" 형식 필수. 페이지 새로고침 필요.', data.start);
        toast('방혈 저장 실패: 페이지 새로고침 필요 (Ctrl+Shift+R)','d');
        return null;
      }

      // (4) date = 종료일 (= 시작일 + 1일 = 작업일 = 박스 출고일). 룰 통일.
      //     클라이언트가 보낸 date 무시하고, start datetime에서 +1일 계산해 강제 정정.
      const startDate = data.start.slice(0,10);
      const endDate = addDays(startDate, 1);
      data = {...data, date: endDate};

      // (5) 문서ID 무조건 종료일(=date) prefix로 재생성
      const expectedPrefix = 'th_' + endDate.replace(/-/g,'') + '_';
      if(!docId.startsWith(expectedPrefix)) {
        const parts = docId.split('_');
        const tail = parts[parts.length-1] || (
          String(new Date().getHours()).padStart(2,'0') +
          String(new Date().getMinutes()).padStart(2,'0') +
          String(new Date().getSeconds()).padStart(2,'0') +
          String(new Date().getMilliseconds()).padStart(3,'0')
        );
        docId = expectedPrefix + tail;
        console.warn('[fbSave] thawing docId 시작일+1일 prefix로 재생성:', docId);
      }

      // (5) 중복 저장 방지: 같은 importCodes[0] + 진행중인 레코드 있으면 차단
      if(data.importCodes && data.importCodes.length > 0) {
        try {
          const dupSnap = await db.collection('thawing')
            .where('importCodes', 'array-contains', data.importCodes[0])
            .where('end', '==', '').get();
          if(!dupSnap.empty) {
            console.warn('[fbSave] thawing 중복 차단:', data.importCodes[0]);
            return dupSnap.docs[0].id; // 기존 docId 반환 (재저장 안 함)
          }
        } catch(e) { /* 검증 실패해도 저장은 진행 */ }
      }
    }
    await db.collection(colName).doc(docId).set({
      ...data,
      _createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    fbClearCache(colName);
    return docId;
  } catch(e) {
    console.error('Firebase 저장 오류:', e);
    return null;
  } finally {
    window._inProgress--;
  }
}

// 업데이트
async function fbUpdate(colName, fbId, data) {
  window._inProgress = (window._inProgress||0) + 1;
  try {
    await db.collection(colName).doc(fbId).update( data);
    fbClearCache(colName); // 업데이트 후 캐시 무효화
    return true;
  } catch(e) {
    console.error('Firebase 업데이트 오류:', e);
    return false;
  } finally {
    window._inProgress--;
  }
}

// 삭제
async function fbDelete(colName, fbId) {
  window._inProgress = (window._inProgress||0) + 1;
  try {
    await db.collection(colName).doc(fbId).delete();
    fbClearCache(colName); // 삭제 후 캐시 무효화
    return true;
  } catch(e) {
    console.error('Firebase 삭제 오류:', e);
    return false;
  } finally {
    window._inProgress--;
  }
}

// 날짜별 조회
// ============================================================
// Firebase 세션 캐시 (같은 날짜/범위 재조회 방지)
// ============================================================
var _fbCache = {};
const _CACHE_TTL = 2 * 60 * 1000; // 2분

function fbClearCache(colName) {
  if(colName) {
    Object.keys(_fbCache).forEach(k => { if(k.startsWith(colName+'__')) delete _fbCache[k]; });
  } else {
    _fbCache = {};
  }
}

function _cacheGet(key) {
  const e = _fbCache[key];
  if(!e) return null;
  if(Date.now() - e.ts > _CACHE_TTL) { delete _fbCache[key]; return null; }
  return e.data;
}
function _cacheSet(key, data) { _fbCache[key] = {data, ts: Date.now()}; }

async function fbGetByDate(colName, date) {
  const key = colName + '__' + date;
  const cached = _cacheGet(key); if(cached) return cached;
  try {
    const snap = await db.collection(colName).where('date', '==', date).get();
    const result = snap.docs.map(d => ({fbId: d.id, ...d.data()}));
    _cacheSet(key, result);
    return result;
  } catch(e) {
    console.error('Firebase 조회 오류:', e);
    return [];
  }
}

// 미종료 방혈 조회 (종료시간 없는 것 전체)
async function fbGetOpenThawing() {
  try {
    const snap = await db.collection('thawing').where('end', '==', '').get();
    return snap.docs.map(d => ({fbId: d.id, ...d.data()}));
  } catch(e) {
    console.error('Firebase 미종료 방혈 조회 오류:', e);
    return [];
  }
}

// 미종료 포장 진행중 조회 (종료시간 없는 것 전체)
async function fbGetOpenPacking() {
  try {
    const snap = await db.collection('packing_pending').where('end', '==', '').get();
    return snap.docs.map(d => ({fbId: d.id, ...d.data()}));
  } catch(e) {
    console.error('Firebase 미종료 포장 조회 오류:', e);
    return [];
  }
}

// 미종료 자숙 진행중 조회 (종료시간 없는 것 전체)
// packing_pending과 동일 패턴 — 다른 디바이스 동시 작업 가시성 확보
async function fbGetOpenCooking() {
  try {
    const snap = await db.collection('cooking_pending').where('end', '==', '').get();
    return snap.docs.map(d => ({fbId: d.id, ...d.data()}));
  } catch(e) {
    console.error('Firebase 미종료 자숙 조회 오류:', e);
    return [];
  }
}

// 날짜 범위 조회 (분석용)
async function fbGetRange(colName, startDate, endDate) {
  const key = colName + '__range__' + startDate + '__' + endDate;
  const cached = _cacheGet(key); if(cached) return cached;
  try {
    const snap = await db.collection(colName)
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .get();
    const result = snap.docs.map(d => ({fbId: d.id, ...d.data()}));
    _cacheSet(key, result);
    return result;
  } catch(e) {
    console.error('Firebase 범위 조회 오류:', e);
    return [];
  }
}

// ============================================================
// 서버(Firebase)에서 오늘 데이터 로드
// ============================================================
async function loadFromServer(date) {
  try {
    const cols = ['barcodes','thawing','preprocess','cooking','shredding','packing','sauce','retort'];
    const colMap = {barcodes:'barcode', thawing:'thawing', preprocess:'preprocess',
      cooking:'cooking', shredding:'shredding', packing:'packing', sauce:'sauce', retort:'retort'};
    // ★ 잘못된 fbId prefix 검출용 (컬렉션별 정상 fbId prefix)
    // cooking record가 cooking_pending_ 시작 fbId 가지면 잘못됨 (saveCkEnd 옛 버그 잔여)
    const wrongPrefix = {
      cooking: 'cooking_pending_',
      packing: 'packing_pending_',
    };
    
    await Promise.all(cols.map(async lKey => {
      const fbCol = colMap[lKey] || lKey;
      const recs = await fbGetByDate(fbCol, date);
      // ★ DB 결과가 0건이어도 로컬 동기화 (다른 디바이스 삭제 반영)
      // pending(fbId 없는 새 record)은 보존 (Firebase 저장 응답 대기중)
      const pending = (L[lKey]||[]).filter(r => !r.fbId && String(r.date||'').slice(0,10) === date);
      const merged = [
        ...(L[lKey]||[]).filter(x => String(x.date||'').slice(0,10) !== date),
        ...recs,
        ...pending
      ];
      // ★ 잘못된 fbId 자동 정리 (saveCkEnd 옛 버그 잔여물 청소)
      const badPrefix = wrongPrefix[lKey];
      if(badPrefix){
        merged.forEach(r => {
          if(r.fbId && String(r.fbId).startsWith(badPrefix)){
            console.warn(`[loadFromServer] ${lKey} record의 잘못된 fbId 정리:`, r.fbId);
            r.fbId = null;
          }
        });
      }
      // ★ id 기준 중복 제거 (DB record 우선)
      const seen = new Set();
      L[lKey] = merged.filter(r => {
        const k = r.id || r.fbId;
        if(!k) return true;
        if(seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }));
    saveL();
    return true;
  } catch(e) {
    console.error('서버 로드 오류:', e);
    return false;
  }
}

// 미종료 방혈 로드
async function loadOpenThawing() {
  try {
    const recs = await fbGetOpenThawing();
    // Firebase를 source of truth로 사용 - localOnly 제거하여 유령데이터 방지
    const closed = L.thawing.filter(t => t.end && t.end !== '');
    L.thawing = [...closed, ...recs];
    const seen = new Set();
    L.thawing = L.thawing.filter(t => {
      // 중복 제거 키: fbId 우선 (같은 cart+date여도 다른 레코드면 둘 다 살림)
      // cart는 같은 날 세척 후 재사용 가능하므로 cart+date만으로 묶으면 안 됨
      const k = t.fbId || t.id || ((t.cart||'')+'|'+String(t.date||'').slice(0,10)+'|'+(t.start||''));
      if(seen.has(k)) return false;
      seen.add(k); return true;
    });
    saveL();
  } catch(e) {
    console.error('미종료 방혈 로드 오류:', e);
  }
}

// 미종료 포장 pending 로드
async function loadOpenPacking() {
  try {
    // 로컬에 fbId 없는 pending → Firebase에 올리기
    const localOnly = (L.packing_pending||[]).filter(r => !r.fbId && (!r.end || r.end === ''));
    for(const rec of localOnly) {
      const fbId = await fbSave('packing_pending', rec);
      if(fbId) { rec.fbId = fbId; }
    }
    if(localOnly.length) saveL();

    // Firebase에서 전체 미종료 로드
    const recs = await fbGetOpenPacking();
    const completed = (L.packing_pending||[]).filter(r => r.end && r.end !== '');
    L.packing_pending = [...completed, ...recs];
    const seen = new Set();
    L.packing_pending = L.packing_pending.filter(r => {
      const k = r.fbId || r.id;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    });
    saveL();
  } catch(e) {
    console.error('미종료 포장 로드 오류:', e);
  }
}

// 미종료 자숙 pending 로드 (loadOpenPacking 패턴 동일)
// 5/4 사고와 같은 종류의 위험 차단:
//  - 기존: cooking_pending이 localStorage 전용 → 다른 디바이스에서 진행중 자숙 안 보임
//  - 변경: Firebase 동기화 → 어느 디바이스에서든 진행중 자숙 가시
async function loadOpenCooking() {
  try {
    // 로컬에 fbId 없는 pending → Firebase에 올리기 (마이그레이션 + 신규 저장)
    const localOnly = (L.cooking_pending||[]).filter(r => !r.fbId && (!r.end || r.end === ''));
    for(const rec of localOnly) {
      const fbId = await fbSave('cooking_pending', rec);
      if(fbId) { rec.fbId = fbId; }
    }
    if(localOnly.length) saveL();

    // Firebase에서 전체 미종료 로드
    const recs = await fbGetOpenCooking();
    const completed = (L.cooking_pending||[]).filter(r => r.end && r.end !== '');
    L.cooking_pending = [...completed, ...recs];
    const seen = new Set();
    L.cooking_pending = L.cooking_pending.filter(r => {
      const k = r.fbId || r.id;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    });
    saveL();
  } catch(e) {
    console.error('미종료 자숙 로드 오류:', e);
  }
}

// ============================================================
// 자동 갱신 (30초)
// ============================================================
var _editProdIdx = -1;
var _refreshTimer = null;
var _isRefreshing = false;

// 사용자가 입력 중이거나 패널이 열려있으면 true
function isUserEditing() {
  // 최근 30초 내 터치/키보드/스크롤 활동이 있으면 입력 중 (창 닫힘 방지)
  if(window._lastActivityAt && (Date.now() - window._lastActivityAt) < 30000) return true;
  // 포커스된 입력 요소가 있으면 입력 중
  const a = document.activeElement;
  if(a && (a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT')) return true;
  // 외포장 미완료 패널이 하나라도 열려있으면 입력 중
  const panels = document.querySelectorAll('[id^="op_panel_"]');
  if(Array.from(panels).some(p=>p.style.display!=='none')) return true;
  // 외포장 완료 상세 펼침/기록 수정 폼이 열려있으면 입력 중
  const doneOpen = document.querySelectorAll('[id^="op_done_panel_"],[id^="op_edit_"]');
  if(Array.from(doneOpen).some(p=>p.style.display!=='none')) return true;
  // 수정 폼이 열려있으면 입력 중
  const editForms = document.querySelectorAll('[id^="ppEdit_"],[id^="pkEdit_"],[id^="peEdit_"]');
  if(Array.from(editForms).some(p=>p.style.display!=='none')) return true;
  // 전처리: 대차 카드(체크박스로 펼친 입력 폼)가 열려있으면 입력 중
  const ppOpen = document.querySelectorAll('.pp-wagon-input');
  if(Array.from(ppOpen).some(p=>p.style.display!=='none')) return true;
  // 전처리: 비가식부 분리 입력 영역이 열려있으면 입력 중
  const wasteArea = document.getElementById('pp_wasteByTypeBox');
  if(wasteArea && wasteArea.style.display !== 'none') return true;
  // 자숙: 종료 매트릭스 폼이 열려있으면 입력 중
  const ckEnd = document.querySelectorAll('[id^="ckEndForm_"]');
  if(Array.from(ckEnd).some(p=>p.style.display && p.style.display !== 'none')) return true;
  // 자숙: 케이지가 1개라도 체크돼있으면 입력 중
  if(document.querySelector('.ck-cage-cb:checked')) return true;
  // 파쇄: 와건이 1개라도 체크돼있으면 입력 중
  if(document.querySelector('.sh-wagon-cb:checked')) return true;
  // 파쇄: 입력 행에 값이 하나라도 들어있으면 입력 중
  const shInputs = document.querySelectorAll('#sh_rows input');
  if(Array.from(shInputs).some(i => (i.value||'').trim() !== '')) return true;
  // 포장: 설비 카드가 1개라도 펼쳐져 있으면 입력 중
  const pkRows = document.querySelectorAll('[id^="pkRow_"]');
  if(pkRows.length > 0) return true;
  // v2 (전처리/파쇄): 입력 테이블의 input/select에 값이 들어있으면 입력 중
  // (부위 select가 비어있지 않거나, text/number input이 비어있지 않으면)
  const v2Selects = document.querySelectorAll('#pp2_tbody select, #sh2_tbody select');
  if(Array.from(v2Selects).some(s => s.value && s.value !== '')) return true;
  const v2TextInputs = document.querySelectorAll('#pp2_tbody input[type="text"], #sh2_tbody input[type="text"]');
  if(Array.from(v2TextInputs).some(i => (i.value||'').trim() !== '')) return true;
  const v2NumInputs = document.querySelectorAll('#pp2_tbody input[type="number"], #sh2_tbody input[type="number"]');
  if(Array.from(v2NumInputs).some(i => (i.value||'').trim() !== '' && parseFloat(i.value) > 0)) return true;
  // v2 인라인 수정 폼이 열려있으면 입력 중
  const v2EditForms = document.querySelectorAll('[id^="pp2Ed_"],[id^="sh2Ed_"]');
  if(v2EditForms.length > 0) return true;
  return false;
}

function startAutoRefresh() {
  if(_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(fetchTodayFromServer, 30000);
}

// ============================================================
// 자정 지나 날짜가 바뀌면 자동 리로드 (오늘 데이터·재고·출고대기 기준 갱신)
//   입력 중이면 미루고, 입력 끝나면 리로드 → 값 날아감 방지
// ============================================================
window._appDay = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
setInterval(function(){
  var now = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  if(now === window._appDay) return;                                    // 날짜 그대로면 스킵
  if(typeof isUserEditing==='function' && isUserEditing()) return;      // 입력 중이면 미룸(다음 체크 때 재시도)
  console.log('[midnight-reload] 날짜 변경 감지', window._appDay, '->', now);
  location.reload(true);
}, 30000);

async function fetchTodayFromServer() {
  if(_isRefreshing) return;
  if(isUserEditing()) return;   // 입력 중·패널 열림 → 스킵
  _isRefreshing = true;
  try {
    const today = tod();
    // 어제 날짜 (KST 로컬 컴포넌트로 안전하게)
    const ydDate = new Date(today + 'T00:00:00');
    ydDate.setDate(ydDate.getDate() - 1);
    const yd = ydDate.getFullYear()+'-'+String(ydDate.getMonth()+1).padStart(2,'0')+'-'+String(ydDate.getDate()).padStart(2,'0');
    await loadFromServer(today);
    await loadFromServer(yd);          // ★ 전처리/파쇄가 어제 thawing/cooking 필요
    await loadOpenPacking();
    await loadOpenCooking();
    refreshCurrentTab_();
  } catch(e) {
    console.warn('자동갱신 오류:', e);
  } finally {
    _isRefreshing = false;
  }
}

function refreshCurrentTab_() {
  if(MODE === 'i') {
    if(ITAB === 'barcode') renderBC();
    else if(ITAB === 'thawing') { renderThawWaiting(); renderThawList(); }
    else if(ITAB === 'preprocess') { if(typeof pp2Refresh==='function') pp2Refresh(); }
    else if(ITAB === 'shredding') { if(typeof sh2Refresh==='function') sh2Refresh(); }
    else if(ITAB === 'outerpacking') loadOuterPacking();
    else renderPL(ITAB);
  }
}

// L 초기화 (페이지 로드 시 즉시)
if(!L) L = loadL();
