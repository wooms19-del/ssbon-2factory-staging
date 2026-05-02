// ============================================================
// 실적관리 (월별 생산일지)  js/performance.js  v1
// ─ 외포장 testRun 기준 자동 역추적으로 테스트 제외
// ─ 월 선택 + 엑셀 다운로드 + 자동 갱신
// ============================================================
(function(){
'use strict';

var _perfYm = '';
var _perfTimer = null;
var _perfBusy = false;

function _perfTodayYm(){ return tod().slice(0,7); }
function _perfMonths(){ return ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']; }
function _perfDateWith(y,m,d){return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
function _perfPrevD(d){var p=d.split('-').map(Number);var dt=new Date(p[0],p[1]-1,p[2]-1);return _perfDateWith(dt.getFullYear(),dt.getMonth()+1,dt.getDate());}
function _perfSplit(s){return String(s||'').split(',').map(function(x){return x.trim();}).filter(Boolean);}
function _perfR2(v){return Math.round((parseFloat(v)||0)*100)/100;}

// ── 모드 진입 ─────────────────────────────────────────────────
function setModePerf(){
  document.querySelectorAll('.mb').forEach(function(b){b.classList.remove('on');});
  var pb=document.getElementById('modeP'); if(pb) pb.classList.add('on');
  var inav=document.getElementById('inav'); if(inav) inav.classList.add('hid');
  var dnav=document.getElementById('dnav'); if(dnav) dnav.classList.add('hid');
  document.querySelectorAll('.pg').forEach(function(p){p.classList.remove('on');});
  var pg=document.getElementById('p-performance'); if(pg) pg.classList.add('on');
  var ms=document.getElementById('mscroll'); if(ms) ms.scrollTop=0;
  if(typeof MODE!=='undefined') MODE='p';
  if(!_perfYm) _perfYm=_perfTodayYm();
  _perfRenderShell();
  _perfReload(true);
  _perfStartAutoRefresh();
}
window.setModePerf = setModePerf;

// ── inner 폭 원복 (다른 탭으로 빠져나갈 때) ────────────────────
function _perfRestoreInner(){
  var inner = document.querySelector('.main .inner') || document.querySelector('.inner');
  if(inner){ inner.style.maxWidth=''; inner.style.padding=''; }
  if(_perfTimer){ clearInterval(_perfTimer); _perfTimer=null; }
}

// 다른 setMode 함수 패치 (한 번만)
(function patchOtherSetters(){
  if(window._perfPatched) return;
  window._perfPatched = true;
  var origSetMode = window.setMode;
  if(typeof origSetMode === 'function'){
    window.setMode = function(m){
      _perfRestoreInner();
      return origSetMode.apply(this, arguments);
    };
  }
  var origSetModeAtt = window.setModeAtt;
  if(typeof origSetModeAtt === 'function'){
    window.setModeAtt = function(){
      _perfRestoreInner();
      return origSetModeAtt.apply(this, arguments);
    };
  }
  var origSetModeSchedule = window.setModeSchedule;
  if(typeof origSetModeSchedule === 'function'){
    window.setModeSchedule = function(){
      _perfRestoreInner();
      return origSetModeSchedule.apply(this, arguments);
    };
  }
})();

// ── 외부에서 부를 수 있게 ─────────────────────────────────────
function _perfStartAutoRefresh(){
  if(_perfTimer) clearInterval(_perfTimer);
  // 30초마다 백그라운드 갱신 (현재 탭이 실적관리인 동안만)
  _perfTimer = setInterval(function(){
    var pg=document.getElementById('p-performance');
    if(pg && pg.classList.contains('on')) _perfReload(false);
    else { clearInterval(_perfTimer); _perfTimer=null; }
  }, 30000);
}

// ── 월 이동 ───────────────────────────────────────────────────
function perfPrevMonth(){var p=_perfYm.split('-').map(Number);var d=new Date(p[0],p[1]-2,1);_perfYm=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');_perfRenderShell();_perfReload(true);}
function perfNextMonth(){var p=_perfYm.split('-').map(Number);var d=new Date(p[0],p[1],1);_perfYm=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');_perfRenderShell();_perfReload(true);}
function perfThisMonth(){_perfYm=_perfTodayYm();_perfRenderShell();_perfReload(true);}
function perfPickMonth(v){if(!v)return;_perfYm=v;_perfRenderShell();_perfReload(true);}
window.perfPrevMonth=perfPrevMonth; window.perfNextMonth=perfNextMonth;
window.perfThisMonth=perfThisMonth; window.perfPickMonth=perfPickMonth;

// ── 셸 렌더 (헤더/툴바) ────────────────────────────────────────
function _perfRenderShell(){
  var pg=document.getElementById('p-performance'); if(!pg) return;
  var ym=_perfYm||_perfTodayYm();
  var y=ym.slice(0,4), mIdx=parseInt(ym.slice(5))-1;
  var lbl=y+'년 '+_perfMonths()[mIdx];
  // 부모 .inner의 max-width 제거 (실적관리 활성 시) - 한페이지 꽉 차게
  var inner = document.querySelector('.main .inner') || document.querySelector('.inner');
  if(inner){ inner.style.maxWidth='none'; inner.style.padding='4px 6px'; }
  pg.innerHTML =
    '<style>'+
      '#p-performance .pf-card{padding:8px;background:var(--c);border:var(--br);border-radius:6px;margin-bottom:6px}'+
      '#p-performance table.perf-tbl{width:100%;border-collapse:collapse;font-size:.85rem;table-layout:auto}'+
      '#p-performance table.perf-tbl thead th{background:#1F4E79;color:#fff;font-weight:600;text-align:center;padding:6px 4px;border:1px solid #999;white-space:nowrap;position:sticky;top:0;z-index:2;line-height:1.25}'+
      '#p-performance table.perf-tbl td{padding:5px 5px;border:1px solid #ddd;white-space:nowrap;line-height:1.4}'+
      '#p-performance table.perf-tbl tr.row-test td{background:#fff3cd;font-style:italic;color:#856404}'+
      '#p-performance table.perf-tbl tr.row-pending td{background:#dbeafe;color:#1e40af}'+   /* 외포장 미완료: 연하늘 */
      '#p-performance table.perf-tbl tr.row-bg0 td{background:#ffffff}'+
      '#p-performance table.perf-tbl tr.row-bg1 td{background:#f8fafc}'+
      '#p-performance .perf-wrap{overflow-x:auto;max-width:100%}'+
    '</style>'+
    '<div class="pf-card">'+
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
        '<button class="btn" onclick="perfPrevMonth()" style="padding:4px 10px">◀</button>'+
        '<div style="font-weight:700;font-size:1.05rem;min-width:130px;text-align:center" id="perfMonthLbl">'+lbl+'</div>'+
        '<button class="btn" onclick="perfNextMonth()" style="padding:4px 10px">▶</button>'+
        '<input type="month" value="'+ym+'" onchange="perfPickMonth(this.value)" style="padding:4px 8px;border:var(--br);border-radius:4px;font-size:.9rem">'+
        '<button class="btn" onclick="perfThisMonth()" style="padding:4px 10px">이번달</button>'+
        '<div style="flex:1"></div>'+
        '<span style="font-size:.78rem;color:var(--g4)">'+
          '<span style="display:inline-block;width:10px;height:10px;background:#fff3cd;border:1px solid #d4a017;vertical-align:middle"></span> 테스트 &nbsp; '+
          '<span style="display:inline-block;width:10px;height:10px;background:#dbeafe;border:1px solid #3b82f6;vertical-align:middle"></span> 외포장 미완료'+
        '</span>'+
        '<button class="btn p" onclick="perfDownloadXlsx()" style="padding:6px 14px">📥 엑셀 다운로드</button>'+
        '<button class="btn" onclick="_perfReload(true)" title="새로고침" style="padding:4px 10px">🔄</button>'+
      '</div>'+
      '<div style="margin-top:4px;color:var(--g4);font-size:.75rem">테스트 = 외포장 testRun 자동 식별 / 외포장 미완료 = 완박스 0건 / 30초마다 자동 갱신</div>'+
    '</div>'+
    '<div class="pf-card" style="padding:0">'+
      '<div id="perfStatus" style="padding:1rem;text-align:center;color:var(--g4)">데이터 불러오는 중…</div>'+
      '<div id="perfTblWrap" class="perf-wrap" style="display:none"></div>'+
    '</div>';
}

// ── 데이터 로드 + 렌더 ────────────────────────────────────────
async function _perfReload(showLoading){
  if(_perfBusy) return; _perfBusy=true;
  try{
    var ym=_perfYm||_perfTodayYm();
    var from=ym+'-01';
    var lastDay=new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5)), 0).getDate();
    var to=ym+'-'+String(lastDay).padStart(2,'0');
    var today=tod();
    var effTo = to>today ? today : to;
    var prevFrom = _perfPrevD(from);

    if(showLoading){
      var st=document.getElementById('perfStatus');
      if(st){st.style.display='';st.textContent='데이터 불러오는 중…';}
      var tw=document.getElementById('perfTblWrap'); if(tw) tw.style.display='none';
    }

    // 캐시 무효화 (자동 갱신용)
    if(typeof _cacheClear==='function'){
      try{ _cacheClear(); }catch(e){}
    }

    var results = await Promise.all([
      fbGetRange('thawing', prevFrom, effTo),
      fbGetRange('preprocess', from, effTo),
      fbGetRange('cooking', from, effTo),
      fbGetRange('shredding', from, effTo),
      fbGetRange('packing', from, effTo),
      fbGetRange('outerpacking', from, effTo),
      fbGetRange('sauce', from, effTo)
    ]);
    var th=results[0], pp=results[1], ck=results[2], sh=results[3], pk=results[4], op=results[5], sc=results[6];

    var rows = _perfBuildRows(th, pp, ck, sh, pk, op, sc);
    window._perfRows = rows;        // 다운로드용
    window._perfMeta = {ym: ym, lbl: ym.slice(0,4)+'년 '+_perfMonths()[parseInt(ym.slice(5))-1]};

    // ─── Phase 2.4 마이그레이션: dataLayer.getMonth 비교 모니터 (사용자 영향 0) ───
    if(rows.length && typeof window!=='undefined' && window.DL && typeof window.DL.getMonth==='function'){
      try{
        var _dlPM = window.DL.getMonth(ym);  // 'YYYY-MM' 문자열
        var _dlPMS = _dlPM && _dlPM.monthSummary;
        if(_dlPMS){
          // performance.js의 rows에서 합계 계산 (testRow 제외)
          var _legSum = {rmKg:0, ppKg:0, ckKg:0, shKg:0, pkEa:0};
          rows.forEach(function(r){
            if(r.isTest) return;
            _legSum.rmKg += parseFloat(r.rmKg)||0;
            _legSum.ppKg += parseFloat(r.ppKg)||0;
            _legSum.ckKg += parseFloat(r.ckKg)||0;
            _legSum.shKg += parseFloat(r.shKg)||0;
            _legSum.pkEa += parseInt(r.innerEa||r.pkEa)||0;
          });
          var _checkP = function(label, legacy, dl, tol){
            tol = tol || 1;
            var diff = Math.abs((legacy||0) - (dl||0));
            if(diff > tol) console.warn('[Phase2.4 비교 차이] '+ym+' '+label+': legacy='+legacy.toFixed(2)+', DL='+dl+', Δ='+diff.toFixed(2));
          };
          _checkP('rmKgTotal', _legSum.rmKg, _dlPMS.rmKgTotal);
          _checkP('ppKgTotal', _legSum.ppKg, _dlPMS._ppKgTotal);
          _checkP('ckKgTotal', _legSum.ckKg, _dlPMS._ckKgTotal);
          _checkP('shKgTotal', _legSum.shKg, _dlPMS._shKgTotal);
        }
      }catch(_e){
        console.error('[Phase2.4 DL 비교 오류]', _e.message);
      }
    }

    _perfRenderTable(rows);
  } catch(e){
    console.error(e);
    var st2=document.getElementById('perfStatus');
    if(st2){st2.style.display='';st2.textContent='로드 오류: '+(e.message||e);}
  } finally {
    _perfBusy=false;
  }
}
window._perfReload = _perfReload;

// ── B방식 역추적 + 일자별 행 빌드 ──────────────────────────
function _perfBuildRows(th, pp, ck, sh, pk, op, sc){
  var d = function(r){return String(r.date||'').slice(0,10);};
  var idOf = function(r){return r.fbId||r.id||r._id||'';};

  // 0) sauce 날짜별 FP/FC 집계
  var scFP={}, scFC={};
  (sc||[]).forEach(function(r){
    var dt=d(r); var nm=r.name||''; var kg=parseInt(r.kg)||0;
    if(nm.indexOf('FP')>=0){ scFP[dt]=(scFP[dt]||0)+kg; }
    else if(nm.indexOf('FC')>=0){ scFC[dt]=(scFC[dt]||0)+kg; }
  });

  // 1) 외포장 testRun 키 (date|product) 셋
  var opTestKeys = new Set();
  op.forEach(function(r){ if(r.testRun===true||r.isTest===true) opTestKeys.add(d(r)+'|'+(r.product||'')); });
  var isTestPk = function(r){
    if(r.testRun===true||r.isTest===true) return true;
    return opTestKeys.has(d(r)+'|'+(r.product||''));
  };

  // 2) 테스트 packing 식별
  var testPk = pk.filter(isTestPk);
  var testPkIds = new Set(testPk.map(idOf));

  // 3) 일자별 역추적 → th/pp/ck/sh 테스트 ID 셋
  var testThIds=new Set(), testPpIds=new Set(), testCkIds=new Set(), testShIds=new Set();
  var byDateTestPk = {};
  testPk.forEach(function(r){
    var k=d(r); if(!byDateTestPk[k]) byDateTestPk[k]=[]; byDateTestPk[k].push(r);
  });
  Object.keys(byDateTestPk).forEach(function(date){
    var rows=byDateTestPk[date];
    var pkW=new Set();
    rows.forEach(function(r){_perfSplit(r.wagon).forEach(function(w){pkW.add(w);});});

    var shDay=sh.filter(function(r){return d(r)===date && _perfSplit(r.wagonOut).some(function(w){return pkW.has(w);});});
    var shW=new Set();
    shDay.forEach(function(r){_perfSplit(r.wagonIn).forEach(function(w){shW.add(w);}); testShIds.add(idOf(r));});

    var ckDay=ck.filter(function(r){return d(r)===date && _perfSplit(r.wagonOut).some(function(w){return shW.has(w);});});
    var ckC=new Set();
    ckDay.forEach(function(r){_perfSplit(r.cage).forEach(function(c){ckC.add(c);}); testCkIds.add(idOf(r));});

    var ppDay=pp.filter(function(r){return d(r)===date && _perfSplit(r.cage).some(function(c){return ckC.has(c);});});
    var ppW=new Set();
    ppDay.forEach(function(r){_perfSplit(r.wagons).forEach(function(w){ppW.add(w);}); testPpIds.add(idOf(r));});

    var prevD=_perfPrevD(date);
    var thMatch=th.filter(function(r){return d(r)===date && ppW.has(String(r.cart||'').trim());});
    if(!thMatch.length) thMatch=th.filter(function(r){return d(r)===prevD && ppW.has(String(r.cart||'').trim());});
    thMatch.forEach(function(r){testThIds.add(idOf(r));});
  });

  // 4) 클린(non-test) 데이터
  var pkClean = pk.filter(function(r){return !testPkIds.has(idOf(r));});
  var ppClean = pp.filter(function(r){return !testPpIds.has(idOf(r));});
  var thClean = th.filter(function(r){return !testThIds.has(idOf(r));});

  // 5) 일자×제품 packing 집계
  var byDP={};
  pkClean.forEach(function(r){
    var key=d(r)+'|'+(r.product||'기타');
    if(!byDP[key]) byDP[key]={ea:0,pouch:0,defect:0,workers:0,subKg:0,subName:'',sauceKg:0};
    byDP[key].ea += parseFloat(r.ea)||0;
    byDP[key].pouch += parseFloat(r.pouch)||0;
    byDP[key].defect += parseFloat(r.defect)||0;
    byDP[key].workers = Math.max(byDP[key].workers, parseFloat(r.workers)||0);
    if(r.subKg) byDP[key].subKg += parseFloat(r.subKg)||0;
    if(r.subName && !byDP[key].subName) byDP[key].subName=r.subName;
    if(r.sauceKg) byDP[key].sauceKg += parseFloat(r.sauceKg)||0;
  });

  // 6) 외포장 매핑 (테스트 제외)
  var opMap={};
  op.forEach(function(r){
    if(r.testRun||r.isTest) return;
    var key=d(r)+'|'+(r.product||'');
    if(!opMap[key]) opMap[key]={ea:0,boxes:0,tray:0,trayDef:0,unitCnt:0,boxDef:0};
    opMap[key].ea += parseInt(r.outerEa)||0;
    opMap[key].boxes += parseInt(r.outerBoxes)||0;
    opMap[key].tray += parseInt(r.trayUsed||r.tray)||0;
    opMap[key].trayDef += parseInt(r.trayDefect)||0;
    opMap[key].unitCnt += parseInt(r.unitCount||r.remainEa)||0;
    opMap[key].boxDef += parseInt(r.boxDefect)||0;
  });

  // 7) 일자별 자숙/파쇄/전처리 (테스트 제외)
  function sumKg(coll, idset){
    var m={};
    coll.forEach(function(r){
      if(idset.has(idOf(r))) return;
      var k=d(r); m[k]=(m[k]||0)+(parseFloat(r.kg)||0);
    });
    return m;
  }
  var ckMap=sumKg(ck, testCkIds);
  var shMap=sumKg(sh, testShIds);
  var ppMap=sumKg(pp, testPpIds);

  // 8) 원육 사용량 (전처리 wagons → 방혈 cart 매칭)
  function getThKg(date){
    var ppDay = ppClean.filter(function(r){return d(r)===date;});
    var wagons = new Set();
    ppDay.forEach(function(r){_perfSplit(r.wagons).forEach(function(w){wagons.add(w);});});
    var thList=thClean;
    var prevD=_perfPrevD(date);
    var matched=[];
    if(wagons.size){
      var sameTh = thList.filter(function(r){return d(r)===date && wagons.has(String(r.cart||'').trim());});
      if(sameTh.length){
        matched=sameTh;
      } else {
        var sameAny = thList.filter(function(r){return d(r)===date;});
        var prevTh = thList.filter(function(r){return d(r)===prevD && wagons.has(String(r.cart||'').trim());});
        if(sameAny.length) matched=sameAny;
        else if(prevTh.length) matched=prevTh;
      }
    } else {
      matched=thList.filter(function(r){return d(r)===date;});
      if(!matched.length) matched=thList.filter(function(r){return d(r)===prevD;});
    }
    var seen=new Set(); var ded=[];
    matched.forEach(function(r){
      var k=(r.cart||'')+'|'+d(r)+'|'+(r.type||'');
      if(seen.has(k)) return; seen.add(k); ded.push(r);
    });
    return _perfR2(ded.reduce(function(s,r){return s+(parseFloat(r.totalKg)||0);},0));
  }

  // 9) 원육 종류별 박스 (설도/홍두깨/우둔)
  function getThPartBoxes(date){
    var ppDay = ppClean.filter(function(r){return d(r)===date;});
    var wagons = new Set();
    ppDay.forEach(function(r){_perfSplit(r.wagons).forEach(function(w){wagons.add(w);});});
    var thList=thClean;
    var prevD=_perfPrevD(date);
    var matched=[];
    if(wagons.size){
      var sameTh=thList.filter(function(r){return d(r)===date && wagons.has(String(r.cart||'').trim());});
      if(sameTh.length){ matched=sameTh; }
      else {
        var sameAny=thList.filter(function(r){return d(r)===date;});
        var prevTh=thList.filter(function(r){return d(r)===prevD && wagons.has(String(r.cart||'').trim());});
        if(sameAny.length) matched=sameAny;
        else if(prevTh.length) matched=prevTh;
      }
    } else {
      matched=thList.filter(function(r){return d(r)===date;});
      if(!matched.length) matched=thList.filter(function(r){return d(r)===prevD;});
    }
    var seen=new Set(); var ded=[];
    matched.forEach(function(r){var k=(r.cart||'')+'|'+d(r)+'|'+(r.type||''); if(seen.has(k))return; seen.add(k); ded.push(r);});
    var partType={}, partKgM={};
    ded.forEach(function(r){
      var p=r.part||r.type||'';
      var bx=parseInt(r.boxes)||0;
      var kgv=parseFloat(r.totalKg)||0;
      partType[p]=(partType[p]||0)+bx;
      partKgM[p]=(partKgM[p]||0)+kgv;
    });
    return {bx:partType, kg:partKgM};
  }

  // 9-2) 제품별 와곤 풀 추적 → 부위/박스/KG (같은 날 우선)
  // 룰: packing.wagon/cart → sh.wagonOut/cartOut → sh.wagonIn → ck.wagonOut → ck.cage → pp.cage → pp.wagons → th.cart
  // 각 단계 같은 날 매칭 우선, 매칭 0건일 때만 전날 확장. 데이터 누락 시 빈 결과 + console.warn.
  function _pickSameOrPrev(coll, date, prevD, predicate){
    var same = coll.filter(function(r){ return d(r)===date && predicate(r); });
    if(same.length) return {recs:same, used:'SAME'};
    var prev = coll.filter(function(r){ return d(r)===prevD && predicate(r); });
    if(prev.length) return {recs:prev, used:'PREV'};
    return {recs:[], used:'NONE'};
  }
  function getProductPartBoxes(date, product){
    var pInfo = (typeof L!=='undefined' && L && L.products) ? L.products.find(function(x){return x.name===product;}) : null;
    var isNoMeat = !!(pInfo && pInfo.noMeat);
    if(isNoMeat){
      return {bx:{}, kg:{}, poolKey:'NOMEAT-'+product, status:'NOMEAT'};
    }
    // fallback: 그날 thClean 합계 + poolKey도 그날 thClean 기준 (trace 성공 제품과 같은 풀이면 같은 poolKey가 됨)
    var _fallback = function(status){
      var thDay = thClean.filter(function(r){ return d(r)===date; });
      var seen = new Set(); var ded = [];
      thDay.forEach(function(r){
        var k = (r.cart||'')+'|'+d(r)+'|'+(r.type||'');
        if(seen.has(k)) return; seen.add(k); ded.push(r);
      });
      var bx={}, kg={};
      ded.forEach(function(r){
        var p = r.part||r.type||'';
        bx[p] = (bx[p]||0) + (parseInt(r.boxes)||0);
        kg[p] = (kg[p]||0) + (parseFloat(r.totalKg)||0);
      });
      var poolKey = ded.map(function(r){ return d(r)+'|'+r.cart+'|'+(r.part||r.type); }).sort().join(';');
      // 그날 thClean도 0건이면 정말 빈칸 (poolKey 고유로)
      if(!ded.length) poolKey = status+'-'+date+'-'+product;
      return {bx:bx, kg:kg, poolKey:poolKey, status:status, fallback:true};
    };
    var pkD = pkClean.filter(function(r){ return d(r)===date && r.product===product; });
    if(!pkD.length) return {bx:{}, kg:{}, poolKey:'NODATA-'+date+'-'+product, status:'NODATA'};
    var pkW = new Set(); var pkC = new Set();
    pkD.forEach(function(r){
      _perfSplit(r.wagon).forEach(function(w){pkW.add(w);});
      _perfSplit(r.cart).forEach(function(c){pkC.add(c);});
    });
    if(!pkW.size && !pkC.size){
      try{ console.warn('[부위추적 PK_EMPTY → fallback]', date, product, '- packing wagon/cart 둘 다 빈값. 그날 thawing 합계로 추정.'); }catch(_){}
      return _fallback('PK_EMPTY');
    }
    var prevD = _perfPrevD(date);
    // sh
    var shRes = _pickSameOrPrev(sh, date, prevD, function(r){
      return _perfSplit(r.wagonOut).some(function(w){return pkW.has(w);}) ||
             _perfSplit(r.cartOut).some(function(c){return pkC.has(c);});
    });
    if(shRes.used==='PREV'){ try{ console.warn('[부위추적 SH_PREV]', date, product, '- 같은 날 sh 0건, 전날 매칭 사용.'); }catch(_){} }
    if(shRes.used==='NONE'){
      try{ console.warn('[부위추적 SH_NONE → fallback]', date, product, '- sh 매칭 0건. 그날 thawing 합계로 추정.'); }catch(_){}
      return _fallback('SH_NONE');
    }
    var shWi = new Set();
    shRes.recs.forEach(function(r){_perfSplit(r.wagonIn).forEach(function(w){shWi.add(w);});});
    // ck
    var ckRes = _pickSameOrPrev(ck, date, prevD, function(r){
      return _perfSplit(r.wagonOut).some(function(w){return shWi.has(w);});
    });
    if(ckRes.used==='PREV'){ try{ console.warn('[부위추적 CK_PREV]', date, product, '- 같은 날 ck 0건, 전날 매칭 사용.'); }catch(_){} }
    if(ckRes.used==='NONE'){
      try{ console.warn('[부위추적 CK_NONE → fallback]', date, product, '- ck 매칭 0건. 그날 thawing 합계로 추정.'); }catch(_){}
      return _fallback('CK_NONE');
    }
    var ckCg = new Set();
    ckRes.recs.forEach(function(r){_perfSplit(r.cage).forEach(function(c){ckCg.add(c);});});
    // pp
    var ppRes = _pickSameOrPrev(pp, date, prevD, function(r){
      return _perfSplit(r.cage).some(function(c){return ckCg.has(c);});
    });
    if(ppRes.used==='PREV'){ try{ console.warn('[부위추적 PP_PREV]', date, product, '- 같은 날 pp 0건, 전날 매칭 사용.'); }catch(_){} }
    if(ppRes.used==='NONE'){
      try{ console.warn('[부위추적 PP_NONE → fallback]', date, product, '- pp 매칭 0건. 그날 thawing 합계로 추정.'); }catch(_){}
      return _fallback('PP_NONE');
    }
    var ppWg = new Set();
    ppRes.recs.forEach(function(r){_perfSplit(r.wagons).forEach(function(w){ppWg.add(w);});});
    if(!ppWg.size){
      try{ console.warn('[부위추적 PP_WAGONS_EMPTY → fallback]', date, product, '- pp 매칭됐으나 wagons 빈값. 그날 thawing 합계로 추정.'); }catch(_){}
      return _fallback('PP_WAGONS_EMPTY');
    }
    // th: 같은 날 우선, 없으면 전날
    var thM = thClean.filter(function(r){ return d(r)===date && ppWg.has(String(r.cart||'').trim()); });
    var thUsed = 'SAME';
    if(!thM.length){ thM = thClean.filter(function(r){ return d(r)===prevD && ppWg.has(String(r.cart||'').trim()); }); thUsed='PREV'; }
    if(!thM.length){
      try{ console.warn('[부위추적 TH_NONE → fallback]', date, product, '- thawing 매칭 0건. 그날 thawing 합계로 추정.'); }catch(_){}
      return _fallback('TH_NONE');
    }
    if(thUsed==='PREV'){ try{ console.warn('[부위추적 TH_PREV]', date, product, '- 같은 날 thawing 0건, 전날 매칭 사용.'); }catch(_){} }
    var seen = new Set(); var ded = [];
    thM.forEach(function(r){
      var k = (r.cart||'')+'|'+d(r)+'|'+(r.type||'');
      if(seen.has(k)) return; seen.add(k); ded.push(r);
    });
    var bx={}, kg={};
    ded.forEach(function(r){
      var p = r.part||r.type||'';
      bx[p] = (bx[p]||0) + (parseInt(r.boxes)||0);
      kg[p] = (kg[p]||0) + (parseFloat(r.totalKg)||0);
    });
    var poolKey = ded.map(function(r){ return d(r)+'|'+r.cart+'|'+(r.part||r.type); }).sort().join(';');
    return {bx:bx, kg:kg, poolKey:poolKey, status:'OK'};
  }

  // 10) 일자별 행 빌드 (제품별)
  var unique = Object.keys(byDP).map(function(k){return k.split('|')[0];});
  var dates = [];
  unique.forEach(function(x){if(dates.indexOf(x)<0) dates.push(x);});
  dates.sort();

  var rows=[];
  var dayNo=0;
  dates.forEach(function(date){
    dayNo++;
    var prods=Object.keys(byDP).filter(function(k){return k.indexOf(date+'|')===0;}).map(function(k){return k.split('|')[1];}).sort();
    var rmKg = getThKg(date);
    var partInfo = getThPartBoxes(date);  // {bx, kg}
    var partBx = partInfo.bx, partKg = partInfo.kg;
    var ckD=_perfR2(ckMap[date]||0);
    var shD=_perfR2(shMap[date]||0);
    var ppD=_perfR2(ppMap[date]||0);
    // 부위 목록 (박스 많은 순)
    var partList = Object.keys(partBx).filter(function(k){return k && partBx[k]>0;}).sort(function(a,b){return partBx[b]-partBx[a];});

    // 첫 비-무육 제품 인덱스 (메추리알 등 무육이 앞에 있어도 다음 비-무육에 원육 정보 부여)
    var firstMeatPi = -1;
    for(var __k=0; __k<prods.length; __k++){
      var __info = (typeof L!=='undefined' && L && L.products) ? L.products.find(function(x){return x.name===prods[__k];}) : null;
      if(!(__info && __info.noMeat)){ firstMeatPi = __k; break; }
    }

    // === [신규] 제품별 부위 추적 + 같은 풀 그룹화 ===
    // 1) 제품별 trace
    var traced = prods.map(function(p){
      var t = getProductPartBoxes(date, p);
      t.product = p;
      t.pi = prods.indexOf(p);
      return t;
    });
    // 2) poolKey로 그룹화 (같은 풀 = 같은 와곤 풀 공유)
    var groupOrder = [];
    var groupMembers = {};
    traced.forEach(function(t){
      if(!groupMembers[t.poolKey]){
        groupMembers[t.poolKey] = [];
        groupOrder.push(t.poolKey);
      }
      groupMembers[t.poolKey].push(t);
    });

    // 3) 그룹별 행 빌드
    groupOrder.forEach(function(poolKey, groupIdx){
      var members = groupMembers[poolKey];
      members.forEach(function(t, mIdx){
        var prod = t.product;
        var pi = t.pi;
        var pkr = byDP[date+'|'+prod];
        var opR = opMap[date+'|'+prod] || {ea:0,boxes:0,tray:0,trayDef:0,unitCnt:0,boxDef:0};
        var innerEa = opR.ea>0 ? opR.ea : Math.round(pkr.ea);
        var defPouch = Math.max(0, Math.round(pkr.pouch) - innerEa);
        var boxUse = opR.boxes + opR.boxDef;
        var qaiKg = (pkr.subKg>0) ? _perfR2(pkr.subKg) : 0;
        var isNoMeatProd = (t.status === 'NOMEAT');
        // 소비기한
        var dt0 = new Date(date+'T00:00:00');
        var is3kg = (prod.indexOf('3KG')>=0)||(prod.indexOf('3kg')>=0);
        if(is3kg){ dt0.setDate(dt0.getDate()+59); }
        else { dt0.setMonth(dt0.getMonth()+12); dt0.setDate(dt0.getDate()-1); }
        var expDate = dt0.getFullYear()+'-'+String(dt0.getMonth()+1).padStart(2,'0')+'-'+String(dt0.getDate()).padStart(2,'0');

        var isPending = (opR.boxes||0)===0 && (opR.boxDef||0)===0;
        var isKostco = prod.indexOf('코스트코')>=0||prod.indexOf('코코')>=0;
        var outBoxVal = isKostco ? (opR.tray||0) : opR.boxes;

        var isGroupFirst = (mIdx === 0);
        var isDayFirst = (groupIdx === 0 && mIdx === 0);  // 그날 전체 첫 행
        var groupSize = members.length;
        var partList = Object.keys(t.bx||{}).filter(function(k){return k && t.bx[k]>0;}).sort(function(a,b){return t.bx[b]-t.bx[a];});

        // 그룹의 첫 제품 + 부위 2개 이상 → 부위별 sub-row 분리
        if(isGroupFirst && partList.length>1 && !isNoMeatProd){
          partList.forEach(function(pn, ppi){
            var isFR = ppi===0;  // 첫 sub-row
            var isDF = isDayFirst && isFR;
            rows.push({
              date: date, dayNo: dayNo, product: prod,
              productIndex: pi, subRowIdx: ppi, totalSub: partList.length,
              groupIdx: groupIdx, groupRowIdx: mIdx, groupSize: groupSize, isGroupFirst: isGroupFirst,
              isNoMeat: false,
              expDate: isFR ? expDate : '',
              workers: isDF ? Math.round(pkr.workers||0) : 0,
              rmType: pn,
              rmKg: _perfR2(t.kg[pn]||0),
              boxSeoldo: pn==='설도' ? t.bx[pn] : 0,
              boxHongdu: (pn==='홍두깨'||pn==='홍두께') ? t.bx[pn] : 0,
              boxUdun:   pn==='우둔' ? t.bx[pn] : 0,
              ppKg: isDF ? ppD : 0,
              ckKg: isDF ? ckD : 0,
              shKg: isDF ? shD : 0,
              sauceKg: isFR ? _perfR2(pkr.sauceKg) : 0,
              innerEa: isFR ? innerEa : 0,
              defPouch: isFR ? defPouch : 0,
              outerBoxes: isFR ? opR.boxes : 0,
              boxDef: isFR ? opR.boxDef : 0,
              tray: isFR ? opR.tray : 0,
              trayDef: isFR ? opR.trayDef : 0,
              unitCnt: isFR ? opR.unitCnt : 0,
              outBoxes: isFR ? outBoxVal : 0,
              sauceFP: isDF ? (scFP[date]||0) : 0,
              sauceFC: isDF ? (scFC[date]||0) : 0,
              qaiKg: isFR ? qaiKg : 0,
              pouch: isFR ? Math.round(pkr.pouch) : 0,
              boxUse: isFR ? boxUse : 0,
              isTest: false,
              isPending: isPending
            });
          });
        } else {
          // 그룹의 첫 제품 (단일 부위 or NOMEAT/누락 빈칸) 또는 그룹의 멤버(병합 대상)
          var rmTypeStr = '', rmKgVal = 0;
          var sd=0, hd=0, ud=0;
          if(isGroupFirst && !isNoMeatProd && partList.length===1){
            rmTypeStr = partList[0];
            rmKgVal = _perfR2(t.kg[partList[0]]||0);
            sd = t.bx['설도']||0;
            hd = t.bx['홍두깨']||t.bx['홍두께']||0;
            ud = t.bx['우둔']||0;
          }
          // isGroupFirst이지만 partList.length===0 (NOMEAT 또는 누락) → 부위 빈칸
          // !isGroupFirst → 같은 풀 멤버, 부위 빈칸 (rowspan으로 받음)
          rows.push({
            date: date, dayNo: dayNo, product: prod,
            productIndex: pi, subRowIdx: 0, totalSub: 1,
            groupIdx: groupIdx, groupRowIdx: mIdx, groupSize: groupSize, isGroupFirst: isGroupFirst,
            isNoMeat: isNoMeatProd,
            expDate: expDate,
            workers: isDayFirst ? Math.round(pkr.workers||0) : 0,
            rmType: rmTypeStr,
            rmKg: rmKgVal,
            boxSeoldo: sd, boxHongdu: hd, boxUdun: ud,
            ppKg: isDayFirst ? ppD : 0,
            ckKg: isDayFirst ? ckD : 0,
            shKg: isDayFirst ? shD : 0,
            sauceKg: _perfR2(pkr.sauceKg),
            innerEa: innerEa, defPouch: defPouch,
            outerBoxes: opR.boxes, boxDef: opR.boxDef,
            tray: opR.tray, trayDef: opR.trayDef,
            unitCnt: opR.unitCnt, outBoxes: outBoxVal,
            sauceFP: isDayFirst ? (scFP[date]||0) : 0,
            sauceFC: isDayFirst ? (scFC[date]||0) : 0,
            qaiKg: qaiKg,
            pouch: Math.round(pkr.pouch), boxUse: boxUse,
            isTest: false,
            isPending: isPending
          });
        }
      });
    });
  });

  // 11) 테스트 행 별도 수집
  var testPkByKey={};
  testPk.forEach(function(r){
    var key=d(r)+'|'+(r.product||'');
    if(!testPkByKey[key]) testPkByKey[key]={date:d(r),product:r.product||'',ea:0,pouch:0,defect:0};
    testPkByKey[key].ea+=parseFloat(r.ea)||0;
    testPkByKey[key].pouch+=parseFloat(r.pouch)||0;
    testPkByKey[key].defect+=parseFloat(r.defect)||0;
  });
  var testOpByKey={};
  op.filter(function(r){return r.testRun||r.isTest;}).forEach(function(r){
    var key=d(r)+'|'+(r.product||'');
    if(!testOpByKey[key]) testOpByKey[key]={ea:0,boxes:0};
    testOpByKey[key].ea+=parseInt(r.outerEa)||0;
    testOpByKey[key].boxes+=parseInt(r.outerBoxes)||0;
  });
  var testRows=[];
  Object.keys(testPkByKey).sort().forEach(function(key){
    var r=testPkByKey[key];
    var opT=testOpByKey[key]||{ea:0,boxes:0};
    var innerEa=opT.ea>0?opT.ea:Math.round(r.ea);
    var defPouch=Math.max(0,Math.round(r.pouch)-innerEa);
    // 해당 날짜(또는 전날)의 테스트 thawing 찾아서 원육 정보 추가
    var tDate=r.date; var prevD=_perfPrevD(tDate);
    var testThDay=th.filter(function(t){return testThIds.has(idOf(t))&&d(t)===tDate;});
    if(!testThDay.length) testThDay=th.filter(function(t){return testThIds.has(idOf(t))&&d(t)===prevD;});
    var tRmKg=0, tBxS=0, tBxH=0, tBxU=0, tParts=[];
    testThDay.forEach(function(t){
      tRmKg+=parseFloat(t.totalKg)||0;
      var p=t.part||t.type||'';
      if(p==='설도') tBxS+=parseInt(t.boxes)||0;
      else if(p==='홍두깨'||p==='홍두께') tBxH+=parseInt(t.boxes)||0;
      else if(p==='우둔') tBxU+=parseInt(t.boxes)||0;
      if(p&&tParts.indexOf(p)<0) tParts.push(p);
    });
    var tRmType=tParts.length?tParts.join(', '):'홍두깨';
    testRows.push({
      date:r.date, dayNo:0, product:r.product+' (테스트)', productIndex:0,
      subRowIdx:0, totalSub:1,
      expDate:'', rmType:tRmType, rmKg:_perfR2(tRmKg),
      boxSeoldo:tBxS, boxHongdu:tBxH, boxUdun:tBxU,
      ppKg:0, ckKg:0, shKg:0, sauceKg:0,
      innerEa:innerEa, defPouch:defPouch,
      outerBoxes:opT.boxes, boxDef:0, tray:0, trayDef:0, unitCnt:0,
      outBoxes:opT.boxes, sauceFP:0, sauceFC:0, qaiKg:0,
      pouch:Math.round(r.pouch), boxUse:opT.boxes,
      isTest:true, isPending:false
    });
  });

  // 12) 날짜 순서로 일반 행 + 테스트 행 통합 (같은 날짜면 일반 먼저, 테스트 나중)
  var combined=[];
  var allDates=[]; var seen_d={};
  rows.concat(testRows).forEach(function(r){if(!seen_d[r.date]){seen_d[r.date]=true;allDates.push(r.date);}});
  allDates.sort();
  allDates.forEach(function(dt){
    rows.filter(function(r){return r.date===dt;}).forEach(function(r){combined.push(r);});
    testRows.filter(function(r){return r.date===dt;}).forEach(function(r){combined.push(r);});
  });

  // 날짜별 dayRowIdx / dayTotalSpan 계산 (테스트 행 제외)
  // testRow는 day-level 메타데이터를 일반 행과 분리 처리:
  // - dayRowIdx, dayTotalSpan, dayAllSingle, dayFirstMeatIdx, dayMeatSpan 모두 명시 초기화
  // - 이 분리가 일관성 있게 적용되어야 isRMcol skip 룰(line 641)이 testRow를 잘못 처리하지 않음
  var _dayIdx={}, _dayCnt={};
  combined.forEach(function(r){
    if(r.isTest){
      r.dayRowIdx=-1;
      r.dayTotalSpan=1;
      r.dayAllSingle=false;       // testRow는 dayAllSingle 룰 적용 X (자기 cells[4-8] 항상 표시)
      r.dayFirstMeatIdx=-1;       // 일반 행 first idx와 매칭 안 됨
      r.dayMeatSpan=0;            // dayMeatSpan>0 조건 안 통과
      r.isGroupFirst = r.isGroupFirst === true;  // testRow는 자기 행에 부위 표시
      r.groupSize = r.groupSize || 1;
      r.groupAllSingle = false;
      return;
    }
    if(_dayIdx[r.date]===undefined) _dayIdx[r.date]=0;
    r.dayRowIdx = _dayIdx[r.date]++;
    _dayCnt[r.date] = (_dayCnt[r.date]||0)+1;
  });
  combined.forEach(function(r){
    if(r.isTest) return;
    r.dayTotalSpan = _dayCnt[r.date]||1;
  });
  // 날짜 내 모든 행이 단일 부위(totalSub=1)인지 → DAY_MCOLS 병합 가능 여부 (날짜 단위)
  var _dayAllSingle={};
  combined.forEach(function(r){
    if(r.isTest) return;
    if((r.totalSub||1)>1) _dayAllSingle[r.date]=false;
    else if(_dayAllSingle[r.date]===undefined) _dayAllSingle[r.date]=true;
  });
  combined.forEach(function(r){
    if(r.isTest) return;
    r.dayAllSingle=(_dayAllSingle[r.date]!==false);
  });
  // 무육 제외 — 첫 비-무육 행 idx + 그날 비-무육 행 수 (legacy 호환용, 부위 컬럼 rowspan은 group 단위로 별도 결정)
  var _dayFirstMeatIdx = {};
  var _dayMeatCnt = {};
  combined.forEach(function(r){
    if(r.isTest || r.isNoMeat) return;
    if(_dayFirstMeatIdx[r.date] === undefined) _dayFirstMeatIdx[r.date] = r.dayRowIdx;
    _dayMeatCnt[r.date] = (_dayMeatCnt[r.date]||0)+1;
  });
  combined.forEach(function(r){
    if(r.isTest) return;
    r.dayFirstMeatIdx = _dayFirstMeatIdx[r.date];
    r.dayMeatSpan = _dayMeatCnt[r.date] || 0;
  });

  // === [신규] 그룹 단위 메타 (부위 컬럼 rowspan 결정용) ===
  // groupKey = date + '|' + groupIdx  (빌드 시 부여된 groupIdx는 그날 안에서 0,1,2...)
  // groupAllSingle: 그룹 내 모든 행이 단일 부위(totalSub<=1) → 부위 컬럼 rowspan 가능
  //                 그룹 내에 sub-row 분리(totalSub>1) 있으면 rowspan 처리 X (각 sub-row 자기 부위 표시)
  var _groupAllSingle = {};
  combined.forEach(function(r){
    if(r.isTest) return;
    var gk = r.date + '|' + (r.groupIdx||0);
    if((r.totalSub||1)>1) _groupAllSingle[gk] = false;
    else if(_groupAllSingle[gk] === undefined) _groupAllSingle[gk] = true;
  });
  combined.forEach(function(r){
    if(r.isTest) return;
    var gk = r.date + '|' + (r.groupIdx||0);
    r.groupAllSingle = (_groupAllSingle[gk] !== false);
  });
  return combined;
}

// ── 표 렌더 ───────────────────────────────────────────────────
function _perfRenderTable(rows){
  var wrap=document.getElementById('perfTblWrap');
  var st=document.getElementById('perfStatus');
  if(!wrap) return;
  if(!rows||!rows.length){
    if(st){st.style.display='';st.textContent='이 달의 생산 데이터가 없습니다.';}
    wrap.style.display='none'; return;
  }
  if(st) st.style.display='none';
  wrap.style.display='';

  // 0~3: 일수·날짜·소비기한·제품명  4~8: 원육  9~11: 공정kg  12: 소스kg(비병합)
  // 13~20: 내포장~출고박스  21~22: FP·FC소스  23: 메추리알  24~25: 파우치·박스합계
  var MCOLS=new Set([0,1,2,3,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]);
  // 날짜별 공유 병합 대상 (일수·날짜·소비기한·전처리·자숙·파쇄)
  var DAY_MCOLS=new Set([0,1,2,9,10,11]);

  var headers=[
    '일수','날짜','소비기한','제품명',
    '원육종류','원육<br>(kg)','설도','홍두깨','우둔',
    '전처리<br>(kg)','자숙<br>(kg)','파쇄<br>(kg)','소스<br>(kg)',
    '내포장<br>(EA)','불량<br>파우치','완박스','불량<br>박스',
    '트레이','트레이<br>불량','출고<br>박스',
    'FP소스<br>(kg)','FC소스<br>(kg)','메추리<br>알(kg)','파우치<br>합계','박스<br>합계'
  ];
  var html='<table class="perf-tbl"><thead><tr>';
  headers.forEach(function(h){ html+='<th>'+h+'</th>'; });
  html+='</tr></thead><tbody>';
  rows.forEach(function(r){
    var rowCls;
    if(r.isTest){ rowCls='row-test'; }
    else if(r.isPending){ rowCls='row-pending'; }
    else { rowCls='row-bg'+((r.dayNo)%2); }
    var isSubRow = r.subRowIdx > 0;
    var span = (!isSubRow && r.totalSub > 1) ? r.totalSub : 1;
    // 숫자 포맷: 0이면 빈칸, 소수점 있으면 그대로, 천단위 콤마
    var fmt=function(v,isInt){
      if(v===null||v===undefined||v==='') return '';
      var n=parseFloat(v); if(!n) return '';
      if(isInt) return Math.round(n).toLocaleString('ko-KR');
      return n%1===0 ? n.toLocaleString('ko-KR')
           : n.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:4});
    };
    var cells=[
      (r.dayNo>0 && r.dayRowIdx===0 && !isSubRow) ? r.dayNo : '',
      (r.dayRowIdx===0 && !isSubRow) ? r.date.slice(5) : '',
      (r.dayRowIdx===0 && !isSubRow && r.expDate) ? r.expDate.slice(2).replace(/-/g,'.') : '',
      !isSubRow ? r.product : '',
      r.rmType||'',
      fmt(r.rmKg), r.boxSeoldo||'', r.boxHongdu||'', r.boxUdun||'',
      fmt(r.ppKg), fmt(r.ckKg), fmt(r.shKg), fmt(r.sauceKg,1),
      r.innerEa ? r.innerEa.toLocaleString('ko-KR') : '', fmt(r.defPouch,1),
      fmt(r.outerBoxes,1), r.boxDef||'',
      fmt(r.tray,1), r.trayDef||'', fmt(r.outBoxes,1),
      fmt(r.sauceFP,1), fmt(r.sauceFC,1), fmt(r.qaiKg),
      r.pouch ? r.pouch.toLocaleString('ko-KR') : '', fmt(r.boxUse,1)
    ];
    html+='<tr class="'+rowCls+'">';
    cells.forEach(function(c, i){
      // 부위 분리 행: MCOLS 컬럼 skip
      if(isSubRow && MCOLS.has(i)) return;
      // 날짜 2번째+ 행: DAY_MCOLS 컬럼 skip
      if(r.dayRowIdx>0 && DAY_MCOLS.has(i)) return;
      // 원육 컬럼(4~8): 무육 행은 자기 행에 빈칸 출력 (rowspan 받지 않음)
      var isRMcol=(i>=4&&i<=8);
      if(isRMcol && r.isNoMeat){
        html+='<td style="text-align:center"></td>';
        return;
      }
      // 원육 컬럼 그룹 단위 rowspan 룰 (testRow 제외):
      // - 그룹 멤버 행 (isGroupFirst=false) + 그룹이 모두 단일 부위: skip (rowspan으로 받음)
      // - 그룹 첫 행 + 그룹이 모두 단일 부위 + groupSize>1: rowspan=groupSize
      // - 그 외 (그룹 첫 행 + 단일 + groupSize=1, 또는 sub-row 분리): 자기 행에 표시 (rowspan 없음)
      if(isRMcol && !r.isTest && r.groupAllSingle && r.groupSize>1 && !r.isGroupFirst && !isSubRow) return;
      var rs='';
      var dts = r.dayTotalSpan||1;
      var gSize = r.groupSize||1;
      if(DAY_MCOLS.has(i) && dts>1 && r.dayRowIdx===0 && !isSubRow){
        rs=' rowspan="'+dts+'"';
      } else if(isRMcol && !r.isTest && r.groupAllSingle && gSize>1 && r.isGroupFirst && !isSubRow){
        rs=' rowspan="'+gSize+'"';
      } else if(MCOLS.has(i) && span>1 && !isSubRow && !DAY_MCOLS.has(i)){
        rs=' rowspan="'+span+'"';
      }
      var vstyle = rs ? 'vertical-align:middle;' : '';
      html+='<td'+rs+' style="text-align:center;'+vstyle+'">'+(c==null?'':c)+'</td>';
    });
    html+='</tr>';
  });
  html+='</tbody></table>';
  wrap.innerHTML=html;
}

// ── 엑셀 다운로드 ─────────────────────────────────────────────
function perfDownloadXlsx(){
  var rows=window._perfRows||[];
  if(!rows.length){ toast('데이터가 없습니다','d'); return; }
  var meta=window._perfMeta||{ym:_perfYm, lbl:_perfYm};
  var ym=meta.ym||_perfYm;

  var headers=[
    '일수','날짜','소비기한','제품명',
    '원육종류','원육사용량(kg)','설도(박스)','홍두깨(박스)','우둔(박스)',
    '전처리(kg)','자숙(kg)','파쇄(kg)','소스사용량(kg)',
    '내포장수량(EA)','불량파우치(EA)','완박스','불량박스',
    '트레이(EA)','트레이불량(EA)','출고박스',
    'FP소스배합(kg)','FC소스배합(kg)','깐메추리알(kg)','파우치사용량','박스사용량'
  ];
  var MCOLS_ARR=[0,1,2,3,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24];
  var MCOLS=new Set(MCOLS_ARR);

  var aoa=[headers];
  var merges=[];
  rows.forEach(function(r){
    var rowIdx=aoa.length;
    var isSubRow=r.subRowIdx>0;
    var span=(r.totalSub||1);
    aoa.push([
      (!isSubRow && r.dayNo>0 && r.dayRowIdx===0) ? r.dayNo : '',
      (!isSubRow && r.dayRowIdx===0) ? r.date : '',
      (!isSubRow && r.dayRowIdx===0) ? r.expDate : '',
      !isSubRow ? r.product : '',
      r.rmType||'',
      r.rmKg||'', r.boxSeoldo||'', r.boxHongdu||'', r.boxUdun||'',
      (!isSubRow) ? (r.ppKg||'') : '',
      (!isSubRow) ? (r.ckKg||'') : '',
      (!isSubRow) ? (r.shKg||'') : '',
      (!isSubRow) ? (r.sauceKg||'') : '',
      (!isSubRow) ? (r.innerEa||'') : '',
      (!isSubRow) ? (r.defPouch||'') : '',
      (!isSubRow) ? (r.outerBoxes||'') : '',
      (!isSubRow) ? (r.boxDef||'') : '',
      (!isSubRow) ? (r.tray||'') : '',
      (!isSubRow) ? (r.trayDef||'') : '',
      (!isSubRow) ? (r.outBoxes||'') : '',
      (!isSubRow) ? (r.sauceFP||'') : '',
      (!isSubRow) ? (r.sauceFC||'') : '',
      (!isSubRow) ? (r.qaiKg||'') : '',
      (!isSubRow) ? (r.pouch||'') : '',
      (!isSubRow) ? (r.boxUse||'') : ''
    ]);
    // 병합 추가
    if(!isSubRow){
      var dts2=r.dayTotalSpan||1;
      // 날짜 기반 병합 (DAY_MCOLS: 일수·날짜·소비기한·전처리·자숙·파쇄)
      if(r.dayRowIdx===0 && dts2>1){
        [0,1,2,9,10,11].forEach(function(c){
          merges.push({s:{r:rowIdx,c:c},e:{r:rowIdx+dts2-1,c:c}});
        });
      }
      // 그룹 단위 부위 컬럼(4~8) 병합: 그룹 첫 행 + 그룹 모두 단일 부위 + groupSize>1
      var gSize = r.groupSize||1;
      if(!r.isTest && r.isGroupFirst && r.groupAllSingle && gSize>1 && !r.isNoMeat){
        [4,5,6,7,8].forEach(function(c){
          merges.push({s:{r:rowIdx,c:c},e:{r:rowIdx+gSize-1,c:c}});
        });
      }
      // 부위 sub-row 분리 기반 병합 (DAY_MCOLS, 부위 컬럼 제외 나머지)
      if(span>1){
        MCOLS_ARR.filter(function(c){return ![0,1,2,4,5,6,7,8,9,10,11].includes(c);}).forEach(function(c){
          merges.push({s:{r:rowIdx,c:c},e:{r:rowIdx+span-1,c:c}});
        });
      }
    }
  });

  var wb=XLSX.utils.book_new();
  var ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[
    {wch:5},{wch:11},{wch:11},{wch:24},
    {wch:10},{wch:11},{wch:7},{wch:8},{wch:7},
    {wch:10},{wch:9},{wch:9},{wch:11},
    {wch:12},{wch:10},{wch:8},{wch:8},
    {wch:9},{wch:11},{wch:9},
    {wch:11},{wch:11},{wch:10},{wch:11},{wch:9}
  ];
  if(merges.length) ws['!merges']=merges;
  ws['!freeze']={xSplit:4,ySplit:1};
  XLSX.utils.book_append_sheet(wb, ws, ym+' 실적');

  var fname='순수본2공장_실적관리_'+ym+'.xlsx';
  if(typeof _saveXlsx==='function'){
    _saveXlsx(wb, fname);
  } else {
    XLSX.writeFile(wb, fname);
  }
  toast('엑셀 다운로드 완료','s');
}
window.perfDownloadXlsx = perfDownloadXlsx;

})();
