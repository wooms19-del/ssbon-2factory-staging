var GAS_URL = 'https://script.google.com/macros/s/AKfycby_Vr6xrvhnal5p9OQ5uXimY1tug5wt_qSH1eK6G2RDvzidWaYyZzWTJ9mZsHf0Rt-l8g/exec';


// GAS 백업 URL (구글시트 실시간 기록용)

var firebaseConfig = {
  apiKey: "AIzaSyA0Y6VK8EOahDE6O7LEWtyG9-U8YP3yqDE",
  authDomain: "ssbon-factory.firebaseapp.com",
  projectId: "ssbon-factory",
  storageBucket: "ssbon-factory.firebasestorage.app",
  messagingSenderId: "815013258298",
  appId: "1:815013258298:web:a80156143cf742ece8c103"
};

firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();

// ============================================================
// 🔧 STAGING MODE - production은 절대 영향받지 않음
// ============================================================
const _STAGING_MODE = true;

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
function pruneOldData(d) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  const cutStr = cutoff.toISOString().slice(0,10);
  ['barcodes','thawing','preprocess','cooking','shredding','packing','sauce'].forEach(k => {
    if(Array.isArray(d[k])) d[k] = d[k].filter(r => String(r.date||'').slice(0,10) >= cutStr);
  });
}
function loadL(){
  try{
    const raw = JSON.parse(localStorage.getItem(SK));
    if(!raw) return nL();
    const base = nL();
    ['barcodes','thawing','preprocess','cooking','shredding','packing','sauce',
     'packing_pending','cooking_pending'].forEach(k => { if(!Array.isArray(raw[k])) raw[k]=base[k]||[]; });
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
    pruneOldData(raw);
    return raw;
  }
  catch(e){ return nL(); }
}
function saveL(){ if(L) localStorage.setItem(SK, JSON.stringify(L)); }
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
      '99337638062761':'설도'
    },
    recipes:{}  // {제품명: {inner:[{name,qty,unit}], outer:[{name,qty,unit,pkgType}]}}
  };
}

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
  const d = new Date(); d.setDate(d.getDate()-1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function gid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function r2(v){ return Math.round(parseFloat(v)*100)/100; }
function dedupeRec(arr, keyFn){ const seen=new Set(); return arr.filter(r=>{ const k=keyFn(r); if(seen.has(k)) return false; seen.add(k); return true; }); }
function addDays(dateStr,n){var p=String(dateStr||'').split('-').map(Number);var dt=new Date(p[0],p[1]-1,p[2]+n);return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');}
function dur(s,e){
  if(!s||!e) return 0;
  const tm=t=>{const p=t.split(':');return+p[0]*60+(+p[1]||0);};
  let d=tm(e)-tm(s); if(d<0)d+=1440; return r2(d/60);
}

// 여러 레코드의 중복 제거한 실제 가동 시간 (병렬 작업 고려)
function calcActualHours(recs){
  const tm=t=>{const p=(t+'').split(':');return+p[0]*60+(+p[1]||0);};
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

// GAS 구글시트 실시간 기록 (백그라운드, 실패해도 무시)
async function gasRecord(action, data) {
  try {
    const payload = encodeURIComponent(JSON.stringify(data));
    await fetch(`${GAS_URL}?action=${action}&payload=${payload}`, {
      method: 'GET', redirect: 'follow'
    });
  } catch(e) {
    console.warn('GAS 기록 실패 (무시):', e);
  }
}

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
  try {
    let docId = customDocId || makeDocId(colName);
    // thawing 저장 시 무결성 검증·보정
    if(colName === 'thawing') {
      const today = tod();
      const tomorrow = addDays(today, 1);

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

      // (3) date 무조건 종료일 강제 (옛 클라이언트가 시작일 보내도 차단)
      data = {...data, date: tomorrow};

      // (4) 문서ID 무조건 종료일 prefix로 재생성
      const expectedPrefix = 'th_' + tomorrow.replace(/-/g,'') + '_';
      if(!docId.startsWith(expectedPrefix)) {
        const parts = docId.split('_');
        const tail = parts[parts.length-1] || (
          String(new Date().getHours()).padStart(2,'0') +
          String(new Date().getMinutes()).padStart(2,'0') +
          String(new Date().getSeconds()).padStart(2,'0') +
          String(new Date().getMilliseconds()).padStart(3,'0')
        );
        docId = expectedPrefix + tail;
        console.warn('[fbSave] thawing docId 종료일로 재생성:', docId);
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
  }
}

// 업데이트
async function fbUpdate(colName, fbId, data) {
  try {
    await db.collection(colName).doc(fbId).update( data);
    fbClearCache(colName); // 업데이트 후 캐시 무효화
    return true;
  } catch(e) {
    console.error('Firebase 업데이트 오류:', e);
    return false;
  }
}

// 삭제
async function fbDelete(colName, fbId) {
  try {
    await db.collection(colName).doc(fbId).delete();
    fbClearCache(colName); // 삭제 후 캐시 무효화
    return true;
  } catch(e) {
    console.error('Firebase 삭제 오류:', e);
    return false;
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
    const cols = ['barcodes','thawing','preprocess','cooking','shredding','packing','sauce'];
    const colMap = {barcodes:'barcode', thawing:'thawing', preprocess:'preprocess',
      cooking:'cooking', shredding:'shredding', packing:'packing', sauce:'sauce'};
    
    await Promise.all(cols.map(async lKey => {
      const fbCol = colMap[lKey] || lKey;
      const recs = await fbGetByDate(fbCol, date);
      // ★ DB 결과가 0건이어도 로컬 동기화 (다른 디바이스 삭제 반영)
      // pending(fbId 없는 새 record)은 보존 (Firebase 저장 응답 대기중)
      const pending = (L[lKey]||[]).filter(r => !r.fbId && String(r.date||'').slice(0,10) === date);
      L[lKey] = [
        ...(L[lKey]||[]).filter(x => String(x.date||'').slice(0,10) !== date),
        ...recs,
        ...pending
      ];
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
  // 포커스된 입력 요소가 있으면 입력 중
  const a = document.activeElement;
  if(a && (a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT')) return true;
  // 외포장 미완료 패널이 하나라도 열려있으면 입력 중
  const panels = document.querySelectorAll('[id^="op_panel_"]');
  if(Array.from(panels).some(p=>p.style.display!=='none')) return true;
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
  return false;
}

function startAutoRefresh() {
  if(_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(fetchTodayFromServer, 30000);
}

async function fetchTodayFromServer() {
  if(_isRefreshing) return;
  if(isUserEditing()) return;   // 입력 중·패널 열림 → 스킵
  _isRefreshing = true;
  try {
    await loadFromServer(tod());
    await loadOpenPacking();
    await loadOpenCooking();  // ★ Phase 2-A: cooking_pending도 매 30초 fresh
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
    else if(ITAB === 'preprocess') { loadOpenThawingAndRender(); renderPL('preprocess'); }
    else if(ITAB === 'outerpacking') loadOuterPacking();
    else renderPL(ITAB);
  }
}

// L 초기화 (페이지 로드 시 즉시)
if(!L) L = loadL();
