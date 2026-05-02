/* ===========================================================
 * monthly_production.js v7
 * - 월별현황(analysis.js)의 데이터 처리 로직 그대로 사용
 *   ▸ L.products의 kgea (제품 마스터) 사용
 *   ▸ getThKgByPP_ : 시차 매칭된 정확한 원육 사용량
 *   ▸ 외포장 EA 우선 (없으면 내포장 EA)
 *   ▸ 테스트 체인 완전 역추적 (wagon/cage 매칭)
 * - 표시 양식만 36컬럼 운영팀 월단위 생산량 양식
 * =========================================================== */

(function(){
  'use strict';

  /* ===== 상태 ===== */
  var _mpYm = null;
  var _mpData = null;
  var _mpPrevData = null;
  var _mpBusy = false;
  var _mpGrp = {
    inout: true, workers: false, hours: false, prod: false, yield: false
  };
  try {
    var saved = localStorage.getItem('ssbon_v6_mpGrp');
    if(saved) _mpGrp = Object.assign(_mpGrp, JSON.parse(saved));
  } catch(e){}

  /* ===== 유틸 ===== */
  function _ymToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _prevYm(ym){ var p=ym.split('-').map(Number); var d=new Date(p[0],p[1]-2,1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _r2(n){ if(!isFinite(+n)) return 0; return Math.round((+n)*100)/100; }
  function _num(v){ var n=parseFloat(v); return isFinite(n)?n:0; }
  function _today(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function _t2m(t){ if(!t||typeof t!=='string') return 0; var p=t.split(':'); return (parseInt(p[0],10)||0)*60+(parseInt(p[1],10)||0); }
  function _hoursFromSE(start, end){
    var s=_t2m(start), e=_t2m(end);
    if(!s&&!e) return 0;
    if(e<s) e += 24*60;
    return Math.round((e-s)/60*100)/100;
  }
  function _prevDStr(date){
    var p=date.split('-').map(Number);
    var dt=new Date(p[0],p[1]-1,p[2]-1);
    return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
  }

  // 무육 제품 판별 (메추리알 장조림 등)
  function _isNoMeat(name){
    return /메추리알/.test(name||'');
  }

  // 제품명에서 1봉당 전체 kg 파싱 (월별현황 _prodKgUnit 동일)
  function _prodKgUnit(name){
    var m = (name||'').match(/(\d+(?:\.\d+)?)\s*(g|KG)\b/i);
    if(!m) return 0;
    return m[2].toUpperCase()==='KG' ? parseFloat(m[1]) : parseFloat(m[1])/1000;
  }
  // L.products에서 1봉당 메인(고기) kg
  function _prodKgea(name){
    if(typeof L==='undefined' || !L || !L.products) return 0;
    var p = L.products.find(function(x){ return x.name===name; });
    return p ? (parseFloat(p.kgea)||0) : 0;
  }

  function _prodNoMeat(name){
    if(typeof L==='undefined' || !L || !L.products) return false;
    var p = L.products.find(function(x){ return x.name===name; });
    return !!(p && p.noMeat);
  }

  /* ===== 메인 메뉴 → 실적관리 ===== */
  function showPerf(){
    if(typeof setModePerf==='function') setModePerf();
    var pnav=document.getElementById('pnav'); if(pnav) pnav.classList.remove('hid');
    showPerfSub('daily');
  }

  function showPerfSub(name){
    var pnav=document.getElementById('pnav');
    if(pnav){
      pnav.querySelectorAll('.ti').forEach(function(t,i){
        t.classList.toggle('on', (i===0&&name==='daily') || (i===1&&name==='monthly'));
      });
    }
    var perfPg = document.getElementById('p-performance');
    var moPg   = document.getElementById('p-monthly-prod');
    if(name==='daily'){
      if(perfPg) perfPg.classList.add('on');
      if(moPg)   moPg.classList.remove('on');
    } else {
      if(perfPg) perfPg.classList.remove('on');
      if(moPg)   moPg.classList.add('on');
      if(!_mpYm) _mpYm = _ymToday();
      _mpRenderShell();
      _mpReload();
    }
    var ms=document.getElementById('mscroll'); if(ms) ms.scrollTop=0;
  }

  /* ===== 셸 렌더 ===== */
  function _mpRenderShell(){
    var pg = document.getElementById('p-monthly-prod');
    if(!pg) return;
    var ym = _mpYm || _ymToday();
    var y=ym.slice(0,4), mIdx=parseInt(ym.slice(5),10);
    var monthLbl = y+'년 '+mIdx+'월';

    var html = ''
      + '<style>'
      + '#mpToolbar{padding:12px 14px;background:#f5f6fa;border-bottom:1px solid #ddd;display:flex;flex-wrap:wrap;gap:8px;align-items:center}'
      + '#mpToolbar .btn{padding:7px 14px;border:1px solid #bbb;background:#fff;border-radius:5px;cursor:pointer;font-size:13px}'
      + '#mpToolbar .btn:hover{background:#eee}'
      + '#mpToolbar .btn.dl{background:#1f7a3a;color:#fff;border-color:#1f7a3a;font-weight:600}'
      + '#mpToolbar .btn.dl:hover{background:#176029}'
      + '#mpToolbar .lbl{font-weight:700;color:#1e293b;margin:0 8px;font-size:15px}'
      + '#mpToolbar2 .grp{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#fff;border:1px solid #ddd;border-radius:5px;cursor:pointer;font-size:12px;user-select:none}'
      + '#mpToolbar2 .grp input{margin:0;cursor:pointer}'
      + '#mpToolbar2 .grp.on{background:#e7f0ff;border-color:#3b6fb8;color:#1e3a8a;font-weight:600}'
      + '#mpStatus{padding:10px 14px;color:#1b8a3a;font-size:13px;font-weight:500;background:#f0fdf4;border-bottom:1px solid #d1fae5}'
      + '#mpTblWrap{overflow:auto;background:#fff;padding-bottom:4px;max-height:calc(100vh - 320px);border:1px solid #e5e7eb;border-radius:6px}'
      + '#mpTbl{border-collapse:separate;border-spacing:0;font-size:12.5px;white-space:nowrap;min-width:100%;font-variant-numeric:tabular-nums}'
      + '#mpTbl th,#mpTbl td{border-right:1px solid #d1d5db;border-bottom:1px solid #d1d5db;padding:7px 8px;text-align:center;vertical-align:middle}'
      + '#mpTbl thead th{background:#374151;color:#fff;font-weight:600;position:sticky;top:0;z-index:10;padding:9px 8px;line-height:1.35;font-size:12px;border-color:#1f2937;box-shadow:inset 0 -2px 0 #1f2937}'
      // 헤더 그룹별 색상 — 미묘하게만 (회색 톤 안에서)
      + '#mpTbl thead th.grp-base{background:#1e293b}'                    // 기본: 진남색
      + '#mpTbl thead th.grp-inout{background:#374151}'                   // 투입: 회색
      + '#mpTbl thead th.grp-workers{background:#475569}'                 // 인원: 슬레이트
      + '#mpTbl thead th.grp-hours{background:#475569}'                   // 시간: 슬레이트
      + '#mpTbl thead th.grp-prod{background:#0e7490}'                    // 생산성: 청록 (강조)
      + '#mpTbl thead th.grp-yield{background:#7e22ce}'                   // 수율: 보라 (강조)
      // 수율 서브그룹: 원료육수율(보라) vs 공정수율(자홍)
      + '#mpTbl thead th.yield-rm{background:#7e22ce}'                    // 원료육수율: 보라
      + '#mpTbl thead th.yield-pr{background:#be185d}'                    // 공정수율: 자홍
      // 본문도 그룹별로 미묘한 배경 색상
      + '#mpTbl tbody td.grp-prod{background:#f0fdfa}'                    // 매우 연한 청록
      + '#mpTbl tbody td.yield-rm{background:#faf5ff}'                    // 매우 연한 보라
      + '#mpTbl tbody td.yield-pr{background:#fdf2f8}'                    // 매우 연한 핑크
      // 그룹 경계: 첫 컬럼 좌측에 굵은 세로선 (생산성 / 수율만)
      + '#mpTbl thead th.grp-first.grp-prod,#mpTbl tbody td.grp-first.grp-prod{border-left:2px solid #0e7490}'
      + '#mpTbl thead th.grp-first.grp-yield,#mpTbl tbody td.grp-first.grp-yield{border-left:2px solid #7e22ce}'
      // 공정수율 시작 컬럼 좌측에 분리선 (원료육 ↔ 공정)
      + '#mpTbl thead th.first-pr,#mpTbl tbody td.first-pr{border-left:2px solid #be185d}'
      // ── 왼쪽 3컬럼 sticky 고정 (class 기반: rowspan과 호환)
      + '#mpTbl th.col-dayno,#mpTbl td.col-dayno{position:sticky;left:0;min-width:55px;width:55px;z-index:5;background:#fff}'
      + '#mpTbl th.col-date,#mpTbl td.col-date{position:sticky;left:55px;min-width:90px;width:90px;z-index:5;background:#fff}'
      + '#mpTbl th.col-product,#mpTbl td.col-product{position:sticky;left:145px;min-width:220px;width:220px;z-index:5;background:#fff;box-shadow:4px 0 6px -3px rgba(0,0,0,0.12)}'
      // 좌상단 모서리 (헤더 + 좌측 고정의 교차) z-index 가장 높게
      + '#mpTbl thead th.col-dayno,#mpTbl thead th.col-date,#mpTbl thead th.col-product{z-index:15;background:#1e293b}'
      // 짝수 행 zebra: sticky 셀도 같은 색
      + '#mpTbl tbody tr:nth-child(even):not(.sumRow):not(.avgRow):not(.prevRow):not(.diffRow) td{background:#fafbfc}'
      + '#mpTbl tbody tr:hover:not(.sumRow):not(.avgRow):not(.prevRow):not(.diffRow) td{background:#fef9c3}'
      // 합계/평균 등 sticky 셀 배경 일치
      + '#mpTbl tr.sumRow td{background:#fef3c7;font-weight:700;color:#78350f;border-top:2px solid #92400e;padding:9px 8px}'
      + '#mpTbl tr.avgRow td{background:#dcfce7;font-weight:600;color:#14532d;padding:9px 8px}'
      + '#mpTbl tr.prevRow td{background:#f1f5f9;color:#475569;padding:9px 8px}'
      + '#mpTbl tr.diffRow td{background:#fee2e2;font-style:normal;font-weight:600;padding:9px 8px;border-bottom:2px solid #b91c1c}'
      // 합계/평균 행은 colspan="3" 한 셀이 3컬럼 차지 → 그 셀에 sum-label 클래스로 sticky
      + '#mpTbl tr.sumRow td.sum-label,#mpTbl tr.avgRow td.sum-label,#mpTbl tr.prevRow td.sum-label,#mpTbl tr.diffRow td.sum-label{position:sticky;left:0;z-index:5;box-shadow:4px 0 6px -3px rgba(0,0,0,0.12)}'
      + '#mpTbl td.product{font-weight:500;color:#1e40af}'
      + '#mpTbl td.dateCell{font-weight:600;color:#1e293b}'
      + '#mpTbl td.dayNoCell{color:#6b7280;font-size:11.5px}'
      + '#mpTbl td.eaSrc{font-size:10px;color:#9ca3af;margin-left:3px;font-weight:400}'
      + '#mpCmp{margin:14px;padding:14px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.04)}'
      + '#mpCmp h3{margin:0 0 10px 0;font-size:14px;color:#1e293b;font-weight:700}'
      + '#mpCmp table{border-collapse:collapse;font-size:13px;width:100%;font-variant-numeric:tabular-nums}'
      + '#mpCmp th,#mpCmp td{border:1px solid #d1d5db;padding:8px 14px;text-align:center}'
      + '#mpCmp th{background:#374151;color:#fff;font-weight:600}'
      + '#mpCmp tr:nth-child(even) td{background:#fafbfc}'
      + '</style>'
      + '<div id="mpToolbar">'
      + '<button class="btn" onclick="mpPrevMonth()">◀</button>'
      + '<span class="lbl" id="mpYmLbl">'+monthLbl+'</span>'
      + '<button class="btn" onclick="mpNextMonth()">▶</button>'
      + '<button class="btn" onclick="mpThisMonth()">이번달</button>'
      + '<input type="month" value="'+ym+'" onchange="mpPickMonth(this.value)" style="padding:6px 8px;border:1px solid #bbb;border-radius:4px;font-size:13px">'
      + '<span style="flex:1"></span>'
      + '<button class="btn dl" onclick="mpDownload()">📥 엑셀 다운로드</button>'
      + '</div>'
      + '<div id="mpToolbar2" style="padding:8px 14px;background:#fafafa;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-bottom:1px solid #e5e7eb">'
      + '<span style="font-size:12px;color:#555;font-weight:600">컬럼 표시:</span>'
      + _grpChip('inout','투입/배출')
      + _grpChip('workers','작업인원')
      + _grpChip('hours','작업시간')
      + _grpChip('prod','생산성')
      + _grpChip('yield','수율')
      + '</div>'
      + '<div id="mpStatus">데이터 불러오는 중…</div>'
      + '<div id="mpTblWrap" style="display:none"><table id="mpTbl"></table></div>'
      + '<div id="mpCmp" style="display:none"></div>';
    pg.innerHTML = html;
  }

  function _grpChip(key, lbl){
    var on = _mpGrp[key];
    return '<label class="grp'+(on?' on':'')+'" onclick="mpToggleGrp(\''+key+'\')">'
         + '<input type="checkbox" '+(on?'checked':'')+' onclick="event.stopPropagation()" onchange="mpToggleGrp(\''+key+'\')">'+lbl+'</label>';
  }

  /* ===== 데이터 로드 ===== */
  function _mpReload(){
    if(_mpBusy) return;
    _mpBusy = true;
    (async function(){
      try {
        var ym = _mpYm || _ymToday();
        var from = ym+'-01';
        var lastDay = new Date(parseInt(ym.slice(0,4),10), parseInt(ym.slice(5),10), 0).getDate();
        var to = ym+'-'+String(lastDay).padStart(2,'0');
        var today = _today();
        var effTo = to>today ? today : to;
        var prevFrom = _prevDStr(from);

        var pYm = _prevYm(ym);
        var pFrom = pYm+'-01';
        var pLast = new Date(parseInt(pYm.slice(0,4),10), parseInt(pYm.slice(5),10), 0).getDate();
        var pTo = pYm+'-'+String(pLast).padStart(2,'0');
        var pPrevFrom = _prevDStr(pFrom);

        if(typeof _cacheClear==='function'){ try{_cacheClear();}catch(e){} }

        var st=document.getElementById('mpStatus');
        if(st) st.textContent='Firebase에서 데이터 불러오는 중…';

        var R = await Promise.all([
          fbGetRange('packing',      from,     effTo),
          fbGetRange('outerpacking', from,     effTo),
          fbGetRange('preprocess',   from,     effTo),
          fbGetRange('thawing',      prevFrom, effTo),
          fbGetRange('shredding',    from,     effTo),
          fbGetRange('cooking',      from,     effTo),
          fbGetRange('packing',      pFrom,    pTo),
          fbGetRange('outerpacking', pFrom,    pTo),
          fbGetRange('preprocess',   pFrom,    pTo),
          fbGetRange('thawing',      pPrevFrom,pTo),
          fbGetRange('shredding',    pFrom,    pTo),
          fbGetRange('cooking',      pFrom,    pTo)
        ]);

        _mpData     = _mpProcess(R[0],R[1],R[2],R[3],R[4],R[5]);
        _mpPrevData = _mpProcess(R[6],R[7],R[8],R[9],R[10],R[11]);
        _mpRender();
      } catch(e){
        console.error('[mp] reload error', e);
        var st=document.getElementById('mpStatus');
        if(st){ st.style.display=''; st.textContent='로드 오류: '+(e.message||e); st.style.color='#c0392b'; }
      } finally {
        _mpBusy = false;
      }
    })();
  }

  /* ===== 데이터 처리 (월별현황 로직 카피) ===== */
  function _mpProcess(pk, op, ppMonth, thMonth, shMonth, ckMonth){
    pk = pk||[]; op = op||[]; ppMonth = ppMonth||[]; thMonth = thMonth||[];
    shMonth = shMonth||[]; ckMonth = ckMonth||[];

    // 외포장 정상분
    var opReal = op.filter(function(r){ return !r.testRun && !r.isTest; });

    // 테스트 packing 식별
    var testOpKeys = new Set();
    op.filter(function(r){ return r.testRun||r.isTest; }).forEach(function(r){
      testOpKeys.add(String(r.date||'').slice(0,10)+'_'+(r.product||''));
    });
    function isTestPk(r){
      return r.testRun || r.isTest || testOpKeys.has(String(r.date||'').slice(0,10)+'_'+(r.product||''));
    }

    // 테스트 체인 완전 역추적
    var testPpIds = new Set();
    var testShIds = new Set();
    var testCkIds = new Set();
    var testThWByDate = {};
    var testDates = [];
    var seenD = {};
    pk.filter(isTestPk).forEach(function(r){
      var d=String(r.date||'').slice(0,10);
      if(!seenD[d]){ seenD[d]=1; testDates.push(d); }
    });

    testDates.forEach(function(d){
      var tPkD = pk.filter(isTestPk).filter(function(r){return String(r.date||'').slice(0,10)===d;});
      var shD = shMonth.filter(function(r){return String(r.date||'').slice(0,10)===d;});
      var ckD = ckMonth.filter(function(r){return String(r.date||'').slice(0,10)===d;});
      var ppD = ppMonth.filter(function(r){return String(r.date||'').slice(0,10)===d;});

      var tPkW = new Set(), tPkC = new Set();
      tPkD.forEach(function(r){
        (r.wagon||'').split(',').map(function(w){return w.trim();}).filter(Boolean).forEach(function(w){tPkW.add(w);});
        (r.cart ||'').split(',').map(function(w){return w.trim();}).filter(Boolean).forEach(function(w){tPkC.add(w);});
      });

      var tSh = shD.filter(function(r){
        var woMatch = (r.wagonOut||'').split(',').map(function(w){return w.trim();}).some(function(w){return tPkW.has(w);});
        var coMatch = (r.cartOut ||'').split(',').map(function(w){return w.trim();}).some(function(w){return tPkC.has(w);});
        return woMatch || coMatch;
      });
      tSh.forEach(function(r){ testShIds.add(r.fbId||r.id); });
      var tShW = new Set();
      tSh.forEach(function(r){
        (r.wagonIn||'').split(',').map(function(w){return w.trim();}).filter(Boolean).forEach(function(w){tShW.add(w);});
      });

      var tCk = ckD.filter(function(r){
        return (r.wagonOut||'').split(',').map(function(w){return w.trim();}).some(function(w){return tShW.has(w);});
      });
      tCk.forEach(function(r){ testCkIds.add(r.fbId||r.id); });
      var tCkC = new Set();
      tCk.forEach(function(r){
        (r.cage||'').split(',').map(function(c){return c.trim();}).filter(Boolean).forEach(function(c){tCkC.add(c);});
      });

      var tPp = ppD.filter(function(r){
        return (r.cage||'').split(',').map(function(c){return c.trim();}).some(function(c){return tCkC.has(c);});
      });
      tPp.forEach(function(r){ testPpIds.add(r.fbId||r.id); });
      var tPpW = new Set();
      tPp.forEach(function(r){
        (r.wagons||'').split(',').map(function(w){return w.trim();}).filter(Boolean).forEach(function(w){tPpW.add(w);});
      });
      if(!testThWByDate[d]) testThWByDate[d] = new Set();
      tPpW.forEach(function(w){ testThWByDate[d].add(w); });
    });

    var pkClean = pk.filter(function(r){ return !isTestPk(r); });
    var ppClean = ppMonth.filter(function(r){ return !testPpIds.has(r.fbId||r.id); });
    var shClean = shMonth.filter(function(r){ return !testShIds.has(r.fbId||r.id); });
    var ckClean = ckMonth.filter(function(r){ return !testCkIds.has(r.fbId||r.id); });
    var thClean = thMonth.filter(function(r){
      var thD = String(r.date||'').slice(0,10);
      var w = (r.cart||'').trim();
      if(!w) return true;
      if(testThWByDate[thD] && testThWByDate[thD].has(w)) return false;
      var nextD = (function(){var dt=new Date(thD); dt.setDate(dt.getDate()+1); return dt.toISOString().slice(0,10);})();
      if(testThWByDate[nextD] && testThWByDate[nextD].has(w)) return false;
      return true;
    });

    // 외포장 EA 맵
    var opMap = {};
    opReal.forEach(function(r){
      var k = String(r.date||'').slice(0,10)+'|'+(r.product||'');
      opMap[k] = (opMap[k]||0) + (parseInt(r.outerEa,10)||0);
    });

    // 부위(type) 추출 헬퍼
    function recType(r){ return (r.type||'').trim(); }

    // shredding의 부위는 같은 날 cooking의 wagonOut과 매칭해서 결정
    function buildShTypeMap(shArr, ckArr){
      // 일자별 wagon→type 맵 (같은 wagon 번호가 다른 날 다른 부위로 쓰일 수 있어 일자별로 분리)
      var dayWagonType = {};
      ckArr.forEach(function(c){
        var t = recType(c);
        if(!t) return;
        var d = String(c.date||'').slice(0,10);
        if(!dayWagonType[d]) dayWagonType[d] = {};
        (c.wagonOut||'').split(',').map(function(w){return w.trim();}).filter(Boolean).forEach(function(w){
          dayWagonType[d][w] = t;
        });
      });
      return shArr.map(function(s){
        var t = recType(s);
        if(!t){
          var sd = String(s.date||'').slice(0,10);
          var dayMap = dayWagonType[sd] || {};
          var wIns = (s.wagonIn||'').split(',').map(function(w){return w.trim();}).filter(Boolean);
          for(var i=0;i<wIns.length;i++){
            if(dayMap[wIns[i]]){ t = dayMap[wIns[i]]; break; }
          }
        }
        return Object.assign({}, s, {_type: t});
      });
    }

    // 일자별, 부위별 합산 (인시 방식)
    function sumByDateType(arr, getType){
      // 키: date|type → {kg, hours, personHours, workers}
      var m = {};
      arr.forEach(function(r){
        var dt = String(r.date||'').slice(0,10);
        if(!dt) return;
        var t = (getType ? getType(r) : recType(r)) || '_';
        var k = dt+'|'+t;
        if(!m[k]) m[k] = {kg:0,hours:0,personHours:0,workers:0,date:dt,type:t};
        var h = _hoursFromSE(r.start, r.end);
        var w = _num(r.workers);
        m[k].kg += _num(r.kg);
        m[k].hours += h;
        m[k].personHours += h*w;
      });
      Object.keys(m).forEach(function(k){
        m[k].workers = m[k].hours>0 ? m[k].personHours/m[k].hours : 0;
      });
      return m;
    }

    // thawing은 일자별·부위별 totalKg
    var thByDateType = {};
    thClean.forEach(function(r){
      var dt = String(r.date||'').slice(0,10);
      var t = recType(r) || '_';
      if(!dt) return;
      var k = dt+'|'+t;
      thByDateType[k] = (thByDateType[k]||0) + _num(r.totalKg);
    });

    var ppByDT = sumByDateType(ppClean);
    var ckByDT = sumByDateType(ckClean);
    var shTagged = buildShTypeMap(shClean, ckClean);
    var shByDT = sumByDateType(shTagged, function(r){ return r._type; });

    // packing 그룹핑 (인시 방식) — type 정보 보존
    var byDP = {};
    pkClean.forEach(function(r){
      var dt = String(r.date||'').slice(0,10);
      var prod = r.product||'';
      if(!dt||!prod) return;
      var k = dt+'|'+prod;
      if(!byDP[k]) byDP[k] = {date:dt, product:prod, ea:0, hours:0, personHours:0, workers:0, types:{}};
      byDP[k].ea += _num(r.ea);
      var h = _hoursFromSE(r.start, r.end);
      var w = _num(r.workers);
      byDP[k].hours += h;
      byDP[k].personHours += h*w;
      // packing의 type 누적 (가장 많이 나온 type)
      var t = recType(r);
      if(t) byDP[k].types[t] = (byDP[k].types[t]||0) + _num(r.ea);
    });
    Object.keys(byDP).forEach(function(k){
      var p = byDP[k];
      p.workers = p.hours>0 ? p.personHours/p.hours : 0;
      var oe = opMap[k] || 0;
      p.eaDisp = oe>0 ? oe : p.ea;
      p.eaSrc  = oe>0 ? '외' : '내';
      // noMeat 제품: type 자동 추론 안 함 (무육은 부위 그룹에 끼면 안 됨)
      var isNoMeat = _prodNoMeat(p.product);
      // 1) packing 자체의 type — kg(EA) 큰 순으로 모두 typeList에 포함
      var typeList = Object.keys(p.types).sort(function(a,b){return (p.types[b]||0)-(p.types[a]||0);});
      // 2) packing에 type 없으면 → 그날 thawing 부위들 자동 추론 (noMeat 제외)
      if(typeList.length === 0 && !isNoMeat){
        var thTypes = {};
        Object.keys(thByDateType).forEach(function(thk){
          var pp=thk.split('|');
          if(pp[0]===p.date && pp[1]!=='_' && thByDateType[thk]>0){
            thTypes[pp[1]] = (thTypes[pp[1]]||0) + thByDateType[thk];
          }
        });
        typeList = Object.keys(thTypes).sort(function(a,b){return thTypes[b]-thTypes[a];});
      }
      p.type = typeList[0] || null;
      p.typeList = typeList;
      p.isNoMeat = isNoMeat;
    });

    // 각 packing 행에 부위 매칭된 데이터 할당 (필요시 비율 분배)
    // 같은 (date,type) 그룹의 packing들 사이에서 EA*kgea 비율로 분배
    function _allocByRatio(packs, totalKg){
      // packs: [{p, kgea}], totalKg: 분배할 양
      var totalMeat = packs.reduce(function(s,x){return s + x.p.eaDisp * (x.kgea||1);}, 0);
      if(!totalMeat) return packs.map(function(){return 0;});
      return packs.map(function(x){ return totalKg * (x.p.eaDisp * (x.kgea||1) / totalMeat); });
    }

    // 일자별 그룹핑
    var byDate = {};
    Object.keys(byDP).forEach(function(k){
      var p = byDP[k];
      if(!byDate[p.date]) byDate[p.date] = [];
      byDate[p.date].push(p);
    });

    var allocMap = {};   // key 'date|product' → {rmKg, ppKg, ckKg, shKg, ppHours, ppPH, ppWorkers, ...}

    // 부위별 데이터 추출 함수 (재사용을 위해 외부 정의)
    function _dataByType(d, t){
      return {
        rmKg: thByDateType[d+'|'+t] || 0,
        pp:   ppByDT[d+'|'+t] || {kg:0,hours:0,personHours:0,workers:0},
        ck:   ckByDT[d+'|'+t] || {kg:0,hours:0,personHours:0,workers:0},
        sh:   shByDT[d+'|'+t] || {kg:0,hours:0,personHours:0,workers:0}
      };
    }
    function _dataAll(d){
      var rm=0, pp={kg:0,hours:0,personHours:0,workers:0}, ck={kg:0,hours:0,personHours:0,workers:0}, sh={kg:0,hours:0,personHours:0,workers:0};
      Object.keys(thByDateType).forEach(function(k){
        if(k.indexOf(d+'|')===0) rm += thByDateType[k];
      });
      function add(target, src){
        target.kg+=src.kg; target.hours+=src.hours; target.personHours+=src.personHours;
      }
      Object.keys(ppByDT).forEach(function(k){ if(k.indexOf(d+'|')===0) add(pp, ppByDT[k]); });
      Object.keys(ckByDT).forEach(function(k){ if(k.indexOf(d+'|')===0) add(ck, ckByDT[k]); });
      Object.keys(shByDT).forEach(function(k){ if(k.indexOf(d+'|')===0) add(sh, shByDT[k]); });
      pp.workers = pp.hours>0 ? pp.personHours/pp.hours : 0;
      ck.workers = ck.hours>0 ? ck.personHours/ck.hours : 0;
      sh.workers = sh.hours>0 ? sh.personHours/sh.hours : 0;
      return {rmKg:rm, pp:pp, ck:ck, sh:sh};
    }

    Object.keys(byDate).forEach(function(d){
      var packs = byDate[d];

      // packing들을 부위별로 그룹핑
      var byType = {};   // type or '_'
      packs.forEach(function(p){
        var t = p.type || '_';
        if(!byType[t]) byType[t] = [];
        byType[t].push(p);
      });

      Object.keys(byType).forEach(function(t){
        var group = byType[t];
        // 부위 데이터
        var src = (t==='_') ? _dataAll(d) : _dataByType(d, t);
        // 부위 데이터가 비어있으면 (type 명시했으나 그 부위 thawing 0) → 그날 전체 사용
        if(t!=='_' && src.rmKg===0 && src.pp.kg===0){
          src = _dataAll(d);
        }
        // 같은 부위에 여러 packing이면 EA*kgea 비율로 분배
        var totalMeat = group.reduce(function(s,p){return s + p.eaDisp * (_prodKgea(p.product)||0.05);}, 0);

        group.forEach(function(p){
          var kgea = _prodKgea(p.product);
          var ratio;
          if(group.length===1) ratio = 1;
          else if(totalMeat>0) ratio = (p.eaDisp * (kgea||0.05)) / totalMeat;
          else ratio = 1/group.length;

          allocMap[d+'|'+p.product] = {
            rmKg: src.rmKg * ratio,
            ppKg: src.pp.kg * ratio,
            ppHours: src.pp.hours * ratio,
            ppPersonHours: src.pp.personHours * ratio,
            ppWorkers: src.pp.workers,
            ckKg: src.ck.kg * ratio,
            ckHours: src.ck.hours * ratio,
            ckPersonHours: src.ck.personHours * ratio,
            ckWorkers: src.ck.workers,
            shKg: src.sh.kg * ratio,
            shHours: src.sh.hours * ratio,
            shPersonHours: src.sh.personHours * ratio,
            shWorkers: src.sh.workers
          };
        });
      });
    });

    var keys = Object.keys(byDP).sort();
    var dates = Array.from(new Set(keys.map(function(k){return k.split('|')[0];}))).sort();
    var dayNo = {};
    dates.forEach(function(d,i){ dayNo[d]=i+1; });

    var prodCnt = {};
    var rows = [];
    function r1(x){ return Math.round(x*10)/10; }

    keys.forEach(function(k){
      var p = byDP[k];
      var dt = p.date;
      var noMeat = _isNoMeat(p.product);
      var kgea = _prodKgea(p.product);
      var kgTot = _prodKgUnit(p.product);

      // 무육이거나 부위 0~1개면 단일 행
      if(noMeat || !p.typeList || p.typeList.length<=1){
        prodCnt[dt] = prodCnt[dt]||0;
        var idx = prodCnt[dt];
        prodCnt[dt] += 1;

        var alloc;
        if(noMeat){
          alloc = {rmKg:0, ppKg:0, ppHours:0, ppPersonHours:0, ppWorkers:0,
                   ckKg:0, ckHours:0, ckPersonHours:0, ckWorkers:0,
                   shKg:0, shHours:0, shPersonHours:0, shWorkers:0};
        } else {
          alloc = allocMap[dt+'|'+p.product] || {
            rmKg:0, ppKg:0, ppHours:0, ppPersonHours:0, ppWorkers:0,
            ckKg:0, ckHours:0, ckPersonHours:0, ckWorkers:0,
            shKg:0, shHours:0, shPersonHours:0, shWorkers:0
          };
        }

        rows.push({
          date: dt, dayNo: dayNo[dt], dateRowIdx: idx,
          product: p.product,
          rmKg: _r2(alloc.rmKg),
          ppKg: _r2(alloc.ppKg), ppHours: _r2(alloc.ppHours), ppWorkers: r1(alloc.ppWorkers), ppPersonHours: _r2(alloc.ppPersonHours),
          ckKg: _r2(alloc.ckKg), ckHours: _r2(alloc.ckHours), ckWorkers: r1(alloc.ckWorkers), ckPersonHours: _r2(alloc.ckPersonHours),
          shKg: _r2(alloc.shKg), shHours: _r2(alloc.shHours), shWorkers: r1(alloc.shWorkers), shPersonHours: _r2(alloc.shPersonHours),
          pkEa: p.eaDisp, pkEaSrc: p.eaSrc, pkEaInner: p.ea,
          pkHours: _r2(p.hours), pkWorkers: r1(p.workers), pkPersonHours: _r2(p.personHours),
          kgea: kgea, kgTot: kgTot,
          type: p.type || (noMeat ? '무육' : ''),
          typeList: p.typeList || [],
          noMeat: noMeat
        });
        return;
      }

      // 여러 부위 → 부위마다 별도 행
      // EA 분배 우선순위: (1) packing에 type 명시된 EA 비율 (2) thawing kg 비율
      var hasPkTypes = Object.keys(p.types).length > 0;
      var ratios;
      if(hasPkTypes){
        var totalPkType = p.typeList.reduce(function(s,t){return s+(p.types[t]||0);},0);
        ratios = p.typeList.map(function(t){
          return totalPkType>0 ? (p.types[t]||0)/totalPkType : 1/p.typeList.length;
        });
      } else {
        var thKgs = p.typeList.map(function(t){ return thByDateType[dt+'|'+t] || 0; });
        var totalTh = thKgs.reduce(function(a,b){return a+b;}, 0);
        ratios = totalTh>0
          ? thKgs.map(function(x){return x/totalTh;})
          : p.typeList.map(function(){return 1/p.typeList.length;});
      }

      p.typeList.forEach(function(t, i){
        var src = _dataByType(dt, t);
        // 부위 데이터 비어있으면 그날 전체 데이터로 폴백
        if(src.rmKg===0 && src.pp.kg===0) src = _dataAll(dt);
        var ratio = ratios[i];
        prodCnt[dt] = prodCnt[dt]||0;
        var idx2 = prodCnt[dt];
        prodCnt[dt] += 1;

        rows.push({
          date: dt, dayNo: dayNo[dt], dateRowIdx: idx2,
          product: p.product,
          rmKg: _r2(src.rmKg),
          ppKg: _r2(src.pp.kg),
          ppHours: _r2(src.pp.hours),
          ppWorkers: r1(src.pp.workers),
          ppPersonHours: _r2(src.pp.personHours),
          ckKg: _r2(src.ck.kg),
          ckHours: _r2(src.ck.hours),
          ckWorkers: r1(src.ck.workers),
          ckPersonHours: _r2(src.ck.personHours),
          shKg: _r2(src.sh.kg),
          shHours: _r2(src.sh.hours),
          shWorkers: r1(src.sh.workers),
          shPersonHours: _r2(src.sh.personHours),
          pkEa: Math.round(p.eaDisp * ratio),
          pkEaSrc: p.eaSrc,
          pkEaInner: Math.round(p.ea * ratio),
          pkHours: _r2(p.hours * ratio),
          pkWorkers: r1(p.workers),
          pkPersonHours: _r2(p.personHours * ratio),
          kgea: kgea, kgTot: kgTot,
          type: t,
          typeList: [t],
          noMeat: false
        });
      });
    });

    // ★ 같은 (date, type) 그룹: 행은 따로 두고 부위 컬럼만 rowspan 표시용
    //   → 같은 그룹 첫 row만 부위 KG/시간/인원/인시 + meatKg(그룹 합산)을 보유,
    //     나머지 row는 0 (화면에서 td 자체를 안 그림 → 부위 컬럼 rowspan 효과)
    //   ★ 분배합이 누락되는 경우가 있어 thByDateType/ppByDT/ckByDT/shByDT 직접 조회
    var __PART_KEYS = ['rmKg','ppKg','ppHours','ppPersonHours','ppWorkers',
                       'ckKg','ckHours','ckPersonHours','ckWorkers',
                       'shKg','shHours','shPersonHours','shWorkers'];
    var __grpMap = {};
    rows.forEach(function(r){
      if(r.noMeat){ r._grpKey = null; return; }
      var key = r.date + '|' + (r.type || '');
      if(!__grpMap[key]) __grpMap[key] = [];
      r._grpKey = key;
      __grpMap[key].push(r);
    });
    Object.keys(__grpMap).forEach(function(key){
      var grp = __grpMap[key];
      var parts = key.split('|');
      var d = parts[0], t = parts[1];
      // 부위 전체 데이터 (분배 무시, 직접 조회)
      var rmTotal = thByDateType[d+'|'+t] || 0;
      var ppItem  = ppByDT[d+'|'+t] || {kg:0, hours:0, personHours:0};
      var ckItem  = ckByDT[d+'|'+t] || {kg:0, hours:0, personHours:0};
      var shItem  = shByDT[d+'|'+t] || {kg:0, hours:0, personHours:0};
      // 그룹 합산 완제품 고기 (yieldPk 계산용)
      var grpMeatKg = grp.reduce(function(s,r){
        return s + (r.pkEa||0) * (r.kgea||0);
      }, 0);
      grp.forEach(function(r, i){
        r._grpSize  = grp.length;
        r._grpFirst = (i===0);
        r._grpRowIdx = i;
        if(grp.length > 1){
          if(i === 0){
            r.rmKg = _r2(rmTotal);
            r.ppKg = _r2(ppItem.kg);
            r.ppHours = _r2(ppItem.hours);
            r.ppPersonHours = _r2(ppItem.personHours);
            r.ppWorkers = ppItem.hours>0 ? r1(ppItem.personHours/ppItem.hours) : 0;
            r.ckKg = _r2(ckItem.kg);
            r.ckHours = _r2(ckItem.hours);
            r.ckPersonHours = _r2(ckItem.personHours);
            r.ckWorkers = ckItem.hours>0 ? r1(ckItem.personHours/ckItem.hours) : 0;
            r.shKg = _r2(shItem.kg);
            r.shHours = _r2(shItem.hours);
            r.shPersonHours = _r2(shItem.personHours);
            r.shWorkers = shItem.hours>0 ? r1(shItem.personHours/shItem.hours) : 0;
            r._grpMeatKg = grpMeatKg;
          } else {
            __PART_KEYS.forEach(function(k){ r[k] = 0; });
          }
        } else {
          // 단일 row 그룹: 그대로 두되 _grpMeatKg만 부여
          r._grpMeatKg = grpMeatKg;
        }
      });
    });
    // dateRowIdx 재정렬
    var __byDateG = {};
    rows.forEach(function(r){
      if(!__byDateG[r.date]) __byDateG[r.date] = [];
      __byDateG[r.date].push(r);
    });
    Object.keys(__byDateG).forEach(function(d){
      __byDateG[d].forEach(function(r, i){ r.dateRowIdx = i; });
    });

    return {
      rows: rows,
      testCount: pk.filter(isTestPk).length
    };
  }

  /* ===== 합계 ===== */
  function _mpAggregate(rows){
    var sum = {rmKg:0,ppKg:0,ppHours:0,ppWorkers:0,ppPersonHours:0,
               ckKg:0,ckHours:0,ckWorkers:0,ckPersonHours:0,
               shKg:0,shHours:0,shWorkers:0,shPersonHours:0,
               pkEa:0,pkHours:0,pkWorkers:0,pkPersonHours:0,
               meatKg:0, prodKg:0};
    var ratioKeys = ['prodPp','prodCk','prodSh','prodPk','prodAll',
                     'yieldRmPp','yieldRmCk','yieldRmSh','yieldRmPk',
                     'yieldPp','yieldCk','yieldSh','yieldPk'];
    var ratioBucket = {};
    ratioKeys.forEach(function(k){ ratioBucket[k] = []; });

    var dates = {};
    rows.forEach(function(r){
      sum.rmKg += r.rmKg||0;
      sum.ppKg += r.ppKg||0; sum.ppHours += r.ppHours||0; sum.ppWorkers += r.ppWorkers||0;
      sum.ppPersonHours += r.ppPersonHours||0;
      sum.ckKg += r.ckKg||0; sum.ckHours += r.ckHours||0; sum.ckWorkers += r.ckWorkers||0;
      sum.ckPersonHours += r.ckPersonHours||0;
      sum.shKg += r.shKg||0; sum.shHours += r.shHours||0; sum.shWorkers += r.shWorkers||0;
      sum.shPersonHours += r.shPersonHours||0;
      sum.pkEa += r.pkEa||0; sum.pkHours += r.pkHours||0; sum.pkWorkers += r.pkWorkers||0;
      sum.pkPersonHours += r.pkPersonHours||0;
      sum.meatKg += (r.pkEa||0) * (r.kgea||0);
      sum.prodKg += (r.pkEa||0) * (r.kgTot||0);
      ratioKeys.forEach(function(k){
        if(r[k]>0 && isFinite(r[k])) ratioBucket[k].push(r[k]);
      });
      if(r.date) dates[r.date]=true;
    });
    sum.dayCount = Object.keys(dates).length;
    // alias for _calcRatio (legacy keys)
    sum.ppTotal = sum.ppPersonHours;
    sum.ckTotal = sum.ckPersonHours;
    sum.shTotal = sum.shPersonHours;
    sum.pkTotal = sum.pkPersonHours;
    ratioKeys.forEach(function(k){
      var arr = ratioBucket[k];
      sum[k] = arr.length ? arr.reduce(function(a,b){return a+b;},0)/arr.length : 0;
    });
    return sum;
  }

  /* ===== 화면 렌더 ===== */
  function _mpRender(){
    var pg = document.getElementById('p-monthly-prod');
    if(!pg) return;
    var st=document.getElementById('mpStatus');
    var tw=document.getElementById('mpTblWrap');
    var tbl=document.getElementById('mpTbl');
    var cmp=document.getElementById('mpCmp');

    var rows0 = (_mpData && _mpData.rows) || [];

    // ─── Phase 2.3 마이그레이션: dataLayer.getMonth 비교 모니터 (사용자 영향 0) ───
    if(rows0.length && typeof window!=='undefined' && window.DL && typeof window.DL.getMonth==='function'){
      try{
        var _dlM = window.DL.getMonth(_mpYm);  // 'YYYY-MM' 문자열
        var _dlMS = _dlM && _dlM.monthSummary;
        if(_dlMS){
          var _legAgg = _mpAggregate(rows0);
          var _check = function(label, legacy, dl, tol){
            tol = tol || 1;
            var diff = Math.abs((legacy||0) - (dl||0));
            if(diff > tol) console.warn('[Phase2.3 비교 차이] '+_mpYm+' '+label+': legacy='+legacy+', DL='+dl+', Δ='+diff.toFixed(2));
          };
          _check('rmKgTotal', _legAgg.rmKg, _dlMS.rmKgTotal);
          _check('ppKgTotal', _legAgg.ppKg, _dlMS._ppKgTotal);
          _check('ckKgTotal', _legAgg.ckKg, _dlMS._ckKgTotal);
          _check('shKgTotal', _legAgg.shKg, _dlMS._shKgTotal);
          _check('pkEaTotal', _legAgg.pkEa, _dlMS.pkEaTotalDisp || 0);
        }
      }catch(_e){
        console.error('[Phase2.3 DL 비교 오류]', _e.message);
      }
    }

    if(!rows0.length){
      if(st){ st.style.display=''; st.textContent='이 달의 데이터가 없습니다.'; st.style.color='#c0392b'; }
      if(tw) tw.style.display='none';
      if(cmp) cmp.style.display='none';
      return;
    }

    var COLS = [
      ['dayNo',     'base',    '생산\n일수'],
      ['date',      'base',    '생산일자'],
      ['product',   'base',    '제품명'],
      ['rmKg',      'base',    '원육 사용량\n(KG)'],
      ['ppKg',      'inout',   '전처리\n(KG)'],
      ['ppHours',   'hours',   '전처리\n작업시간'],
      ['ppWorkers', 'workers', '전처리\n작업인원'],
      ['ppPersonHours','hours','전처리\n총작업(인시)'],
      ['ckKg',      'inout',   '자숙\n(KG)'],
      ['ckHours',   'hours',   '자숙\n작업시간'],
      ['ckWorkers', 'workers', '자숙\n작업인원'],
      ['ckPersonHours','hours','자숙\n총작업(인시)'],
      ['shKg',      'inout',   '파쇄\n(KG)'],
      ['shHours',   'hours',   '파쇄\n작업시간'],
      ['shWorkers', 'workers', '파쇄\n작업인원'],
      ['shPersonHours','hours','파쇄\n총작업(인시)'],
      ['pkEa',      'base',    '내포장\n(EA)'],
      ['pkHours',   'hours',   '내포장\n작업시간'],
      ['pkWorkers', 'workers', '내포장\n작업인원'],
      ['pkPersonHours','hours','내포장\n총작업(인시)'],
      ['meatKg',    'base',    '완제품 고기\n중량(KG)'],
      ['prodKg',    'base',    '완제품 중량\n(KG)'],
      ['prodPp',    'prod',    '생산성\n전처리'],
      ['prodCk',    'prod',    '생산성\n자숙'],
      ['prodSh',    'prod',    '생산성\n파쇄'],
      ['prodPk',    'prod',    '생산성\n포장'],
      ['prodAll',   'prod',    '생산성\n전체'],
      ['yieldRmPp', 'yield',   '원료육수율\n전처리'],
      ['yieldRmCk', 'yield',   '원료육수율\n자숙'],
      ['yieldRmSh', 'yield',   '원료육수율\n파쇄'],
      ['yieldRmPk', 'yield',   '원료육수율\n포장'],
      ['yieldPp',   'yield',   '공정수율\n전처리'],
      ['yieldCk',   'yield',   '공정수율\n자숙'],
      ['yieldSh',   'yield',   '공정수율\n파쇄'],
      ['yieldPk',   'yield',   '공정수율\n포장']
    ];
    var visibleCols = COLS.filter(function(c){
      if(c[1]==='base') return true;
      return _mpGrp[c[1]];
    });

    var calcRows = rows0.map(function(r){
      var ppT = r.ppPersonHours || 0;
      var ckT = r.ckPersonHours || 0;
      var shT = r.shPersonHours || 0;
      var pkT = r.pkPersonHours || 0;
      var meatKg = r.pkEa * (r.kgea||0);
      var prodKg = r.pkEa * (r.kgTot||0);
      var rm = r.rmKg;
      // 그룹 단위 yield: 첫 row만 표시 (둘째 row 이후는 부위 KG가 0이라 자동으로 0)
      var grpMeat = r._grpMeatKg || meatKg;
      return Object.assign({}, r, {
        meatKg:_r2(meatKg), prodKg:_r2(prodKg),
        prodPp: rm&&ppT?_r2(rm/ppT):0,
        prodCk: rm&&ckT?_r2(rm/ckT):0,
        prodSh: rm&&shT?_r2(rm/shT):0,
        prodPk: rm&&pkT?_r2(rm/pkT):0,
        prodAll: rm&&(ppT+ckT+shT+pkT)?_r2(rm/(ppT+ckT+shT+pkT)):0,
        yieldRmPp: rm?_r2(r.ppKg/rm*100)/100:0,
        yieldRmCk: rm?_r2(r.ckKg/rm*100)/100:0,
        yieldRmSh: rm?_r2(r.shKg/rm*100)/100:0,
        yieldRmPk: rm?_r2(grpMeat/rm*100)/100:0,
        yieldPp:   rm?_r2(r.ppKg/rm*100)/100:0,
        yieldCk:   r.ppKg?_r2(r.ckKg/r.ppKg*100)/100:0,
        yieldSh:   r.ckKg?_r2(r.shKg/r.ckKg*100)/100:0,
        yieldPk:   r.shKg?_r2(grpMeat/r.shKg*100)/100:0
      });
    });

    var sum = _mpAggregate(calcRows);
    var prevRows = (_mpPrevData && _mpPrevData.rows) || [];
    var prevSum = _mpAggregate(prevRows.map(function(r){
      var ppT=r.ppPersonHours||0, ckT=r.ckPersonHours||0, shT=r.shPersonHours||0, pkT=r.pkPersonHours||0;
      var meatKg = r.pkEa*(r.kgea||0);
      var rm=r.rmKg;
      return Object.assign({}, r, {
        meatKg:meatKg, prodKg:r.pkEa*(r.kgTot||0),
        prodPp: rm&&ppT?rm/ppT:0,
        prodCk: rm&&ckT?rm/ckT:0,
        prodSh: rm&&shT?rm/shT:0,
        prodPk: rm&&pkT?rm/pkT:0,
        prodAll: rm&&(ppT+ckT+shT+pkT)?rm/(ppT+ckT+shT+pkT):0,
        yieldRmPp: rm?r.ppKg/rm:0, yieldRmCk: rm?r.ckKg/rm:0,
        yieldRmSh: rm?r.shKg/rm:0, yieldRmPk: rm?meatKg/rm:0,
        yieldPp: rm?r.ppKg/rm:0, yieldCk: r.ppKg?r.ckKg/r.ppKg:0,
        yieldSh: r.ckKg?r.shKg/r.ckKg:0, yieldPk: r.shKg?meatKg/r.shKg:0
      });
    }));

    // 그룹 첫 컬럼 판정 (좌측 경계선)
    function _isFirstOfGroup(c, idx){
      if(idx===0) return true;
      return visibleCols[idx-1][1] !== c[1];
    }
    function _grpCls(c, idx){
      var sub = '';
      // 수율 서브그룹: 원료육수율(yield-rm) vs 공정수율(yield-pr)
      if(c[0] && c[0].indexOf('yieldRm')===0) sub = ' yield-rm';
      else if(c[1]==='yield') sub = ' yield-pr';
      // 공정수율 시작 컬럼 (yieldPp) → 좌측 경계선
      if(c[0]==='yieldPp') sub += ' first-pr';
      return 'grp-'+c[1] + (_isFirstOfGroup(c, idx) ? ' grp-first' : '') + sub;
    }

    var thHtml = '<tr>'+visibleCols.map(function(c, i){
      var stickyCls = '';
      if(c[0]==='dayNo')   stickyCls = ' col-dayno';
      else if(c[0]==='date')    stickyCls = ' col-date';
      else if(c[0]==='product') stickyCls = ' col-product';
      return '<th class="'+_grpCls(c, i)+stickyCls+'">'+c[2].replace(/\n/g,'<br>')+'</th>';
    }).join('')+'</tr>';

    // 숫자 포맷터: 천단위 콤마 + 자리수
    function fmtCell(v, c){
      if(v==null) return '-';
      if(typeof v!=='number') return String(v);
      if(!isFinite(v)) return '-';
      if(v===0) return '-';
      var grp = c[1];
      // 수율: % 표시
      if(grp==='yield') return (v*100).toFixed(1) + '%';
      // 생산성: kg/인시
      if(grp==='prod') return v.toFixed(2);
      if(c[0]==='pkEa' || c[0]==='dayNo') return Math.round(v).toLocaleString();
      if(c[0]==='ppWorkers'||c[0]==='ckWorkers'||c[0]==='shWorkers'||c[0]==='pkWorkers') return v.toFixed(1);
      if(c[0]==='ppHours'||c[0]==='ckHours'||c[0]==='shHours'||c[0]==='pkHours') return v.toFixed(2);
      if(c[0]==='ppPersonHours'||c[0]==='ckPersonHours'||c[0]==='shPersonHours'||c[0]==='pkPersonHours') return v.toFixed(1);
      return v%1===0 ? v.toLocaleString() : v.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:2});
    }

    // 같은 날짜 행 수 계산 (병합용)
    var dateCntMap = {};
    calcRows.forEach(function(r){ dateCntMap[r.date] = (dateCntMap[r.date]||0)+1; });

    // ★ 부위 컬럼 (그룹 단위로 rowspan 처리) — 제품별이 아닌 컬럼
    var __PART_COLS = {
      'rmKg':1,'ppKg':1,'ppHours':1,'ppWorkers':1,'ppPersonHours':1,
      'ckKg':1,'ckHours':1,'ckWorkers':1,'ckPersonHours':1,
      'shKg':1,'shHours':1,'shWorkers':1,'shPersonHours':1,
      'prodPp':1,'prodCk':1,'prodSh':1,
      'yieldRmPp':1,'yieldRmCk':1,'yieldRmSh':1,'yieldRmPk':1,
      'yieldPp':1,'yieldCk':1,'yieldSh':1,'yieldPk':1
    };

    var bodyHtml = calcRows.map(function(r){
      var cnt = dateCntMap[r.date] || 1;
      var grpCnt = r._grpSize || 1;
      var isGrpFirst = r._grpFirst !== false;
      return '<tr>'+visibleCols.map(function(c,_i_){
        var v = r[c[0]];
        // dayNo, date: 그날 첫 행에만 rowspan 출력. 둘째 부위 행부터는 td 생략
        if(c[0]==='dayNo'){
          if(r.dateRowIdx===0){
            return '<td class="dayNoCell col-dayno"'+(cnt>1?' rowspan="'+cnt+'"':'')+'>'+(v||'')+'</td>';
          }
          return '';  // 두 번째 행부터 dayNo td 생략
        }
        if(c[0]==='date'){
          if(r.dateRowIdx===0){
            return '<td class="dateCell col-date"'+(cnt>1?' rowspan="'+cnt+'"':'')+'>'+(v||'').slice(5)+'</td>';
          }
          return '';
        }
        if(c[0]==='product') {
          // 부위별 색상 팔레트
          var typeColors = {
            '설도':   {bg:'#dbeafe', fg:'#1e40af'},  // 파랑
            '우둔':   {bg:'#ede9fe', fg:'#6d28d9'},  // 보라
            '홍두깨': {bg:'#ffedd5', fg:'#c2410c'},  // 주황
            '무육':   {bg:'#fee2e2', fg:'#b91c1c'}   // 빨강
          };
          var typeBadges = '';
          if(r.noMeat){
            var c0 = typeColors['무육'];
            typeBadges = '<span style="display:inline-block;background:'+c0.bg+';color:'+c0.fg+';border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600;margin-left:4px">무육</span>';
          } else {
            var list = (r.typeList && r.typeList.length) ? r.typeList : (r.type ? [r.type] : []);
            typeBadges = list.map(function(t){
              var col = typeColors[t] || {bg:'#e5e7eb', fg:'#374151'};
              return '<span style="display:inline-block;background:'+col.bg+';color:'+col.fg+';border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600;margin-left:4px">'+t+'</span>';
            }).join('');
          }
          return '<td class="product col-product" style="text-align:center">'+(v||'')+typeBadges+'</td>';
        }
        // 부위 컬럼: 그룹 첫 row만 td 출력 (rowspan으로 병합), 나머지 row는 td 생략
        if(__PART_COLS[c[0]]){
          if(grpCnt > 1 && !isGrpFirst) return '';  // 두번째 row부터 부위 컬럼 생략
          var rs = (grpCnt > 1) ? ' rowspan="'+grpCnt+'"' : '';
          if(typeof v === 'number'){
            return '<td class="'+_grpCls(c, _i_)+'"'+rs+'>'+fmtCell(v, c)+'</td>';
          }
          return '<td class="'+_grpCls(c, _i_)+'"'+rs+'>'+(v==null?'-':v)+'</td>';
        }
        if(c[0]==='pkEa') {
          var s = v ? Math.round(v).toLocaleString() : '-';
          return '<td class="'+_grpCls(c, _i_)+'">'+s+'<span class="eaSrc">('+(r.pkEaSrc||'')+')</span></td>';
        }
        if(typeof v==='number'){
          return '<td class="'+_grpCls(c, _i_)+'">'+fmtCell(v, c)+'</td>';
        }
        return '<td class="'+_grpCls(c, _i_)+'">'+(v==null?'-':v)+'</td>';
      }).join('')+'</tr>';
    }).join('');

    function fmtNum(v, c){
      if(v==null) return '';
      if(typeof v!=='number') return String(v);
      if(!isFinite(v)) return '';
      // 수율은 %, 생산성은 소수
      if(c && c[1]==='yield') return (v*100).toFixed(1) + '%';
      if(c && c[1]==='prod') return v.toFixed(2);
      var key = c ? c[0] : '';
      if(key==='pkEa' || key==='dayNo') return Math.round(v).toLocaleString();
      if(key==='ppWorkers'||key==='ckWorkers'||key==='shWorkers'||key==='pkWorkers') return v.toFixed(1);
      if(key==='ppHours'||key==='ckHours'||key==='shHours'||key==='pkHours') return v.toFixed(2);
      if(key==='ppPersonHours'||key==='ckPersonHours'||key==='shPersonHours'||key==='pkPersonHours') return v.toFixed(1);
      return v%1===0 ? v.toLocaleString() : v.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:2});
    }
    function isRatio(c){ return c[1]==='yield'||c[1]==='prod'; }

    // 합계 행에서 비율 재계산 (행별 평균이 아니라 합계끼리 나눔 — 가중평균)
    function _calcRatio(c, agg){
      if(!agg) return 0;
      var rm = agg.rmKg||0;
      var ppKg = agg.ppKg||0, ckKg = agg.ckKg||0, shKg = agg.shKg||0;
      var meatKg = agg.meatKg||0;
      var ppT = agg.ppTotal||0, ckT = agg.ckTotal||0, shT = agg.shTotal||0, pkT = agg.pkTotal||0;
      switch(c[0]){
        case 'prodPp':  return rm&&ppT?rm/ppT:0;
        case 'prodCk':  return rm&&ckT?rm/ckT:0;
        case 'prodSh':  return rm&&shT?rm/shT:0;
        case 'prodPk':  return rm&&pkT?rm/pkT:0;
        case 'prodAll': return rm&&(ppT+ckT+shT+pkT)?rm/(ppT+ckT+shT+pkT):0;
        case 'yieldRmPp': return rm?ppKg/rm:0;
        case 'yieldRmCk': return rm?ckKg/rm:0;
        case 'yieldRmSh': return rm?shKg/rm:0;
        case 'yieldRmPk': return rm?meatKg/rm:0;
        case 'yieldPp': return rm?ppKg/rm:0;
        case 'yieldCk': return ppKg?ckKg/ppKg:0;
        case 'yieldSh': return ckKg?shKg/ckKg:0;
        case 'yieldPk': return shKg?meatKg/shKg:0;
      }
      return 0;
    }

    var sumHtml = '<tr class="sumRow"><td colspan="3" class="sum-label">합 계</td>'
      + visibleCols.slice(3).map(function(c,_i_){
          if(isRatio(c)){
            var v = _calcRatio(c, sum);
            return '<td class="'+_grpCls(c, _i_+3)+'">'+(v>0?fmtNum(v, c):'—')+'</td>';
          }
          return '<td class="'+_grpCls(c, _i_+3)+'">'+fmtNum(sum[c[0]], c)+'</td>';
        }).join('')
      + '</tr>';

    var dc = sum.dayCount||1;
    var avgHtml = '<tr class="avgRow"><td colspan="3" class="sum-label">일 평 균</td>'
      + visibleCols.slice(3).map(function(c,_i_){
          if(isRatio(c)){
            // 비율은 합계끼리 나누는 게 정확 (가중평균)
            var v = _calcRatio(c, sum);
            return '<td class="'+_grpCls(c, _i_+3)+'">'+(v>0?fmtNum(v, c):'—')+'</td>';
          }
          var v2 = sum[c[0]]; if(v2==null||typeof v2!=='number') return '<td class="'+_grpCls(c, _i_+3)+'">—</td>';
          return '<td class="'+_grpCls(c, _i_+3)+'">'+fmtNum(v2/dc, c)+'</td>';
        }).join('')
      + '</tr>';

    var pdc = prevSum.dayCount||1;
    var prevHtml = '<tr class="prevRow"><td colspan="3" class="sum-label">전월 평균</td>'
      + visibleCols.slice(3).map(function(c,_i_){
          if(isRatio(c)){
            var v = _calcRatio(c, prevSum);
            return '<td class="'+_grpCls(c, _i_+3)+'">'+(v>0?fmtNum(v, c):'—')+'</td>';
          }
          var v2 = prevSum[c[0]]; if(v2==null||typeof v2!=='number') return '<td class="'+_grpCls(c, _i_+3)+'">—</td>';
          return '<td class="'+_grpCls(c, _i_+3)+'">'+fmtNum(v2/pdc, c)+'</td>';
        }).join('')
      + '</tr>';

    var diffHtml = '<tr class="diffRow"><td colspan="3" class="sum-label">전월 대비 증감</td>'
      + visibleCols.slice(3).map(function(c,_i_){
          var thisV, prevV;
          if(isRatio(c)){
            thisV = _calcRatio(c, sum);
            prevV = _calcRatio(c, prevSum);
          } else {
            var v = sum[c[0]]||0;
            var p = prevSum[c[0]]||0;
            if(!p) return '<td class="'+_grpCls(c, _i_+3)+'">—</td>';
            thisV = v/dc;
            prevV = p/pdc;
          }
          if(prevV==null || (!isRatio(c) && !prevV)) return '<td class="'+_grpCls(c, _i_+3)+'">—</td>';

          // 수율(yield)은 퍼센트포인트(%p) 차이, 그 외는 변화율(%)
          var isYield = (c[1]==='yield');
          var color, arrow, label;
          if(isYield){
            // %p 절대차 (thisV, prevV는 0~1 비율 → ×100)
            var pp = (thisV - prevV) * 100;
            if(Math.abs(pp) < 0.05) return '<td class="'+_grpCls(c, _i_+3)+'" style="color:#475569">— 0.0%p</td>';
            color = pp>0?'#15803d':'#b91c1c';
            arrow = pp>0?'▲':'▼';
            label = arrow+' '+Math.abs(pp).toFixed(1)+'%p';
          } else {
            if(!prevV) return '<td class="'+_grpCls(c, _i_+3)+'">—</td>';
            var pct = (thisV - prevV)/prevV*100;
            if(Math.abs(pct) < 0.05) return '<td class="'+_grpCls(c, _i_+3)+'" style="color:#475569">— 0.0%</td>';
            color = pct>0?'#15803d':'#b91c1c';
            arrow = pct>0?'▲':'▼';
            label = arrow+' '+Math.abs(pct).toFixed(1)+'%';
          }
          return '<td class="'+_grpCls(c, _i_+3)+'" style="color:'+color+'">'+label+'</td>';
        }).join('')
      + '</tr>';

    tbl.innerHTML = '<thead>'+thHtml+'</thead><tbody>'+bodyHtml+sumHtml+avgHtml+prevHtml+diffHtml+'</tbody>';
    if(tw) tw.style.display='';

    if(st){
      st.style.display='none';
    }

    var ymThis=(_mpYm||_ymToday()), ymPrev=_prevYm(ymThis);
    var thisAvg = sum.dayCount?(sum.rmKg/sum.dayCount):0;
    var prevAvg = prevSum.dayCount?(prevSum.rmKg/prevSum.dayCount):0;
    var diff = thisAvg-prevAvg;
    var diffPct = prevAvg?(diff/prevAvg*100):0;
    function nf(v, dec){ if(!isFinite(v)) return '-'; return v.toLocaleString(undefined,{minimumFractionDigits:dec||0,maximumFractionDigits:dec||0}); }
    function diffColor(d){ return d>0?'#15803d':(d<0?'#b91c1c':'#475569'); }
    function arr(d){ return d>0?'▲':(d<0?'▼':''); }
    cmp.innerHTML = '<h3>📊 전월 대비 비교</h3>'
      + '<table>'
      + '<thead><tr><th>구분</th><th>'+ymThis.replace('-','년 ')+'월</th><th>'+ymPrev.replace('-','년 ')+'월</th><th>차이</th><th>증감율</th></tr></thead>'
      + '<tbody>'
      + '<tr><td><strong>일평균 원육사용량</strong></td><td>'+nf(thisAvg,2)+' kg</td><td>'+nf(prevAvg,2)+' kg</td>'
      +   '<td style="color:'+diffColor(diff)+';font-weight:600">'+arr(diff)+' '+nf(Math.abs(diff),2)+' kg</td>'
      +   '<td style="color:'+diffColor(diffPct)+';font-weight:600">'+arr(diffPct)+' '+nf(Math.abs(diffPct),1)+'%</td></tr>'
      + '<tr><td><strong>생산일수</strong></td><td>'+sum.dayCount+'일</td><td>'+prevSum.dayCount+'일</td>'
      +   '<td style="color:'+diffColor(sum.dayCount-prevSum.dayCount)+';font-weight:600">'+arr(sum.dayCount-prevSum.dayCount)+' '+Math.abs(sum.dayCount-prevSum.dayCount)+'일</td><td>—</td></tr>'
      + '<tr><td><strong>월 누적 원육사용량</strong></td><td>'+nf(sum.rmKg,2)+' kg</td><td>'+nf(prevSum.rmKg,2)+' kg</td>'
      +   '<td style="color:'+diffColor(sum.rmKg-prevSum.rmKg)+';font-weight:600">'+arr(sum.rmKg-prevSum.rmKg)+' '+nf(Math.abs(sum.rmKg-prevSum.rmKg),2)+' kg</td><td>—</td></tr>'
      + '<tr><td><strong>월 누적 EA (외포장)</strong></td><td>'+nf(sum.pkEa,0)+'</td><td>'+nf(prevSum.pkEa,0)+'</td>'
      +   '<td style="color:'+diffColor(sum.pkEa-prevSum.pkEa)+';font-weight:600">'+arr(sum.pkEa-prevSum.pkEa)+' '+nf(Math.abs(sum.pkEa-prevSum.pkEa),0)+'</td><td>—</td></tr>'
      + '<tr><td><strong>완제품 고기중량</strong></td><td>'+nf(sum.meatKg,2)+' kg</td><td>'+nf(prevSum.meatKg,2)+' kg</td>'
      +   '<td style="color:'+diffColor(sum.meatKg-prevSum.meatKg)+';font-weight:600">'+arr(sum.meatKg-prevSum.meatKg)+' '+nf(Math.abs(sum.meatKg-prevSum.meatKg),2)+' kg</td><td>—</td></tr>'
      + '</tbody></table>';
    cmp.style.display='';
  }

  /* ===== 엑셀 다운로드 ===== */
  function _mpDownload(){
    var rows = (_mpData && _mpData.rows) || [];
    if(!rows.length){ alert('데이터가 없습니다.'); return; }
    if(typeof XLSX==='undefined'){ alert('XLSX 라이브러리 로딩 안됨'); return; }

    var ym = _mpYm||_ymToday();
    var y=ym.slice(0,4), mIdx=parseInt(ym.slice(5),10);
    var sheetName = y+'년 '+String(mIdx).padStart(2,'0')+'월';

    // 정렬 (화면과 동일)
    rows.sort(function(a,b){
      if(a.date!==b.date) return a.date<b.date?-1:1;
      return (a.dateRowIdx||0) - (b.dateRowIdx||0);
    });

    var aoa = [];

    // 1행: 메인 제목
    aoa.push([y+'년 '+mIdx+'월 운영팀 월단위 생산량']);
    // 2행: 헤더
    aoa.push([
      '생산\n일수','생산일자','제품명','원육 사용량\n(KG)',
      '전처리\n(KG)','전처리\n작업시간','전처리\n작업인원','전처리\n총작업(인시)',
      '자숙\n(KG)','자숙\n작업시간','자숙\n작업인원','자숙\n총작업(인시)',
      '파쇄\n(KG)','파쇄\n작업시간','파쇄\n작업인원','파쇄\n총작업(인시)',
      '내포장\n(EA)','내포장\n작업시간','내포장\n작업인원','내포장\n총작업(인시)',
      '완제품 고기\n중량(KG)','완제품 중량\n(KG)',
      '생산성\n전처리','생산성\n자숙','생산성\n파쇄','생산성\n포장','생산성\n전체',
      '원료육수율\n전처리','원료육수율\n자숙','원료육수율\n파쇄','원료육수율\n포장',
      '공정수율\n전처리','공정수율\n자숙','공정수율\n파쇄','공정수율\n포장'
    ]);

    var startDataRow = 3;  // 1-indexed: 제목 1행 + 헤더 2행, 데이터는 3행부터

    // 데이터 행
    rows.forEach(function(r, i){
      var rowN = startDataRow + i;
      var isFirst = (r.dateRowIdx===0);
      var meatPerEa = r.kgea || 0;
      var totalPerEa = r.kgTot || 0;

      // 제품명 + 부위 표시
      var prodLabel = r.product;
      if(r.noMeat){
        prodLabel += ' [무육]';
      } else if(r.typeList && r.typeList.length){
        prodLabel += ' [' + r.typeList.join(',') + ']';
      }

      aoa.push([
        isFirst ? r.dayNo : '',
        isFirst ? r.date : '',
        prodLabel,
        r.rmKg || '',
        r.ppKg || '',
        r.ppHours || '',
        r.ppWorkers || '',
        {f:'IFERROR(F'+rowN+'*G'+rowN+',"")'},
        r.ckKg || '',
        r.ckHours || '',
        r.ckWorkers || '',
        {f:'IFERROR(J'+rowN+'*K'+rowN+',"")'},
        r.shKg || '',
        r.shHours || '',
        r.shWorkers || '',
        {f:'IFERROR(N'+rowN+'*O'+rowN+',"")'},
        r.pkEa || '',
        r.pkHours || '',
        r.pkWorkers || '',
        {f:'IFERROR(R'+rowN+'*S'+rowN+',"")'},
        meatPerEa ? {f:'IFERROR(Q'+rowN+'*'+meatPerEa+',"")'} : '',
        totalPerEa ? {f:'IFERROR(Q'+rowN+'*'+totalPerEa+',"")'} : '',
        {f:'IFERROR(D'+rowN+'/H'+rowN+',"")'},
        {f:'IFERROR(D'+rowN+'/L'+rowN+',"")'},
        {f:'IFERROR(D'+rowN+'/P'+rowN+',"")'},
        {f:'IFERROR(D'+rowN+'/T'+rowN+',"")'},
        {f:'IFERROR(D'+rowN+'/SUM(H'+rowN+',L'+rowN+',P'+rowN+',T'+rowN+'),"")'},
        {f:'IFERROR(E'+rowN+'/D'+rowN+',"")'},
        {f:'IFERROR(I'+rowN+'/D'+rowN+',"")'},
        {f:'IFERROR(M'+rowN+'/D'+rowN+',"")'},
        {f:'IFERROR(U'+rowN+'/D'+rowN+',"")'},
        {f:'IFERROR(I'+rowN+'/E'+rowN+',"")'},
        {f:'IFERROR(M'+rowN+'/I'+rowN+',"")'},
        {f:'IFERROR(U'+rowN+'/M'+rowN+',"")'},
        ''
      ]);
    });

    var lastDataRow = startDataRow + rows.length - 1;
    function subSum(col){ return {f:'SUBTOTAL(9,'+col+startDataRow+':'+col+lastDataRow+')'}; }
    function subAvg(col){ return {f:'SUBTOTAL(1,'+col+startDataRow+':'+col+lastDataRow+')'}; }

    // 합계 행
    aoa.push([
      '', '', '월 합계',
      subSum('D'),subSum('E'),'','',subSum('H'),
      subSum('I'),'','',subSum('L'),
      subSum('M'),'','',subSum('P'),
      subSum('Q'),'','',subSum('T'),
      subSum('U'),subSum('V'),
      '','','','','',
      '','','','',
      '','','',''
    ]);
    // 평균 행
    aoa.push([
      '', '', '월 평균',
      subAvg('D'),subAvg('E'),subAvg('F'),subAvg('G'),subAvg('H'),
      subAvg('I'),subAvg('J'),subAvg('K'),subAvg('L'),
      subAvg('M'),subAvg('N'),subAvg('O'),subAvg('P'),
      subAvg('Q'),subAvg('R'),subAvg('S'),subAvg('T'),
      subAvg('U'),subAvg('V'),
      subAvg('W'),subAvg('X'),subAvg('Y'),subAvg('Z'),subAvg('AA'),
      subAvg('AB'),subAvg('AC'),subAvg('AD'),subAvg('AE'),
      subAvg('AF'),subAvg('AG'),subAvg('AH'),subAvg('AI')
    ]);

    var sumRowIdx = aoa.length - 2;  // 0-indexed
    var avgRowIdx = aoa.length - 1;

    // 수식 -> null 처리 (값만 저장)
    var aoaClean = aoa.map(function(row){
      return row.map(function(v){
        return (v && typeof v==='object' && v.f) ? null : v;
      });
    });
    var ws = XLSX.utils.aoa_to_sheet(aoaClean);

    var totalCols = 35;  // A~AI

    // 수식 셀 + 숫자 포맷 적용
    // 컬럼별 숫자 포맷: 0=정수콤마, 1=소수1콤마, 2=소수2, 3=백분율
    // [생산일수, 생산일자, 제품명, 원육KG, 전처리(KG/시간/인원/인시), 자숙, 파쇄, 내포장(EA/시간/인원/인시), 완제품, 생산성×5, 원료육수율×4, 공정수율×4]
    var colFormat = [
      'general','general','general',                // 0~2: 일수/일자/제품명
      '#,##0.0',                                    // 3: 원육
      '#,##0.0','0.00','0.0','0.0',                // 4~7: 전처리 KG/시간/인원/인시
      '#,##0.0','0.00','0.0','0.0',                // 8~11: 자숙
      '#,##0.0','0.00','0.0','0.0',                // 12~15: 파쇄
      '#,##0','0.00','0.0','0.0',                  // 16~19: 내포장 (EA는 정수)
      '#,##0.0','#,##0.0',                          // 20~21: 완제품
      '0.00','0.00','0.00','0.00','0.00',          // 22~26: 생산성 (kg/인시)
      '0.0%','0.0%','0.0%','0.0%',                 // 27~30: 원료육수율
      '0.0%','0.0%','0.0%','0.0%'                  // 31~34: 공정수율
    ];

    for(var R=0;R<aoa.length;R++){
      for(var C=0;C<aoa[R].length;C++){
        var v = aoa[R][C];
        var addr = XLSX.utils.encode_cell({r:R, c:C});
        if(v && typeof v==='object' && v.f){
          ws[addr] = {t:'n', f:v.f};
        }
        // 숫자 포맷 적용 (데이터 행 + 합계/평균 행)
        if(R >= 2 && ws[addr] && (ws[addr].t==='n' || typeof aoa[R][C]==='number')){
          ws[addr].z = colFormat[C] || 'general';
        }
      }
    }

    // === 셀 스타일 적용 (xlsx-js-style) ===
    function setStyle(addr, st){
      if(!ws[addr]){ ws[addr] = {t:'s', v:''}; }
      ws[addr].s = st;
    }

    // 메인 제목 (A1)
    setStyle('A1', {
      font: { bold:true, sz:18, color:{rgb:'1E293B'} },
      alignment: { horizontal:'center', vertical:'center' }
    });

    // 헤더 (2행) - 그룹별 색상
    function colGroup(c){
      if(c<=2) return 'base';
      if(c===3) return 'base';
      if(c>=4 && c<=19) return 'inout';   // 공정 KG/시간/인원/인시
      if(c===20 || c===21) return 'base';
      if(c>=22 && c<=26) return 'prod';
      if(c>=27 && c<=30) return 'rm';
      if(c>=31 && c<=34) return 'pr';
      return 'base';
    }
    var groupBg = {
      base: '1E293B',
      inout: '475569',
      prod: '0E7490',
      rm: '7E22CE',
      pr: 'BE185D'
    };
    for(var c=0; c<totalCols; c++){
      var addr = XLSX.utils.encode_cell({r:1, c:c});
      var bg = groupBg[colGroup(c)];
      setStyle(addr, {
        font: { bold:true, sz:11, color:{rgb:'FFFFFF'} },
        fill: { fgColor:{rgb:bg}, patternType:'solid' },
        alignment: { horizontal:'center', vertical:'center', wrapText:true },
        border: {
          top:    { style:'thin', color:{rgb:'1F2937'} },
          bottom: { style:'medium', color:{rgb:'1F2937'} },
          left:   { style:'thin', color:{rgb:'1F2937'} },
          right:  { style:'thin', color:{rgb:'1F2937'} }
        }
      });
    }

    // 데이터 행: 가는 회색 border + 정렬
    var dataStartR = 2;
    var dataEndR = dataStartR + rows.length - 1;
    for(var rr=dataStartR; rr<=dataEndR; rr++){
      for(var cc=0; cc<totalCols; cc++){
        var a = XLSX.utils.encode_cell({r:rr, c:cc});
        if(!ws[a]) ws[a] = {t:'s', v:''};
        var halign = (cc===2) ? 'left' : (cc<=2 ? 'center' : 'right');
        ws[a].s = {
          font: { sz:10, color:{rgb:'1F2937'} },
          alignment: { horizontal:halign, vertical:'center' },
          border: {
            top:    { style:'thin', color:{rgb:'E5E7EB'} },
            bottom: { style:'thin', color:{rgb:'E5E7EB'} },
            left:   { style:'thin', color:{rgb:'E5E7EB'} },
            right:  { style:'thin', color:{rgb:'E5E7EB'} }
          }
        };
        // 짝수 행 zebra
        if((rr-dataStartR) % 2 === 1){
          ws[a].s.fill = { fgColor:{rgb:'F9FAFB'}, patternType:'solid' };
        }
      }
    }

    // 합계 행: 진한 주황
    for(var c2=0; c2<totalCols; c2++){
      var a2 = XLSX.utils.encode_cell({r:sumRowIdx, c:c2});
      if(!ws[a2]) ws[a2] = {t:'s', v:''};
      var ha = (c2===2) ? 'center' : 'right';
      ws[a2].s = {
        font: { bold:true, sz:11, color:{rgb:'78350F'} },
        fill: { fgColor:{rgb:'FEF3C7'}, patternType:'solid' },
        alignment: { horizontal:ha, vertical:'center' },
        border: {
          top:    { style:'medium', color:{rgb:'92400E'} },
          bottom: { style:'thin', color:{rgb:'92400E'} },
          left:   { style:'thin', color:{rgb:'F3F4F6'} },
          right:  { style:'thin', color:{rgb:'F3F4F6'} }
        }
      };
      if(ws[a2].z===undefined) ws[a2].z = colFormat[c2] || 'general';
    }
    // 평균 행: 연녹색
    for(var c3=0; c3<totalCols; c3++){
      var a3 = XLSX.utils.encode_cell({r:avgRowIdx, c:c3});
      if(!ws[a3]) ws[a3] = {t:'s', v:''};
      var ha2 = (c3===2) ? 'center' : 'right';
      ws[a3].s = {
        font: { bold:true, sz:11, color:{rgb:'14532D'} },
        fill: { fgColor:{rgb:'DCFCE7'}, patternType:'solid' },
        alignment: { horizontal:ha2, vertical:'center' },
        border: {
          top:    { style:'thin', color:{rgb:'14532D'} },
          bottom: { style:'medium', color:{rgb:'14532D'} },
          left:   { style:'thin', color:{rgb:'F3F4F6'} },
          right:  { style:'thin', color:{rgb:'F3F4F6'} }
        }
      };
      if(ws[a3].z===undefined) ws[a3].z = colFormat[c3] || 'general';
    }

    ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:aoa.length-1, c:totalCols-1}});

    // 컬럼 너비
    ws['!cols'] = [
      {wch:7},                                     // 생산일수
      {wch:12},                                    // 생산일자
      {wch:32},                                    // 제품명+부위
      {wch:13},                                    // 원육 사용량
      {wch:11},{wch:11},{wch:11},{wch:14},        // 전처리 4
      {wch:11},{wch:11},{wch:11},{wch:14},        // 자숙 4
      {wch:11},{wch:11},{wch:11},{wch:14},        // 파쇄 4
      {wch:11},{wch:11},{wch:11},{wch:14},        // 내포장 4
      {wch:13},{wch:13},                          // 완제품 2
      {wch:11},{wch:11},{wch:11},{wch:11},{wch:11},  // 생산성 5
      {wch:13},{wch:11},{wch:11},{wch:11},        // 원료육수율 4
      {wch:13},{wch:11},{wch:11},{wch:11}         // 공정수율 4
    ];

    // 메인 제목(1행) 전체 병합
    ws['!merges'] = [
      {s:{r:0,c:0}, e:{r:0,c:totalCols-1}}
    ];

    // 행 높이
    ws['!rows'] = [
      {hpt: 32},  // 제목
      {hpt: 40}   // 헤더
    ];

    // 자동 필터 (헤더 ~ 데이터 끝까지)
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({s:{r:1,c:0}, e:{r:lastDataRow-1, c:totalCols-1}}) };

    // 첫 행(고정 영역) 잠금
    ws['!freeze'] = { xSplit:3, ySplit:2 };

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, ym+'_운영팀_월단위_생산량.xlsx');
    if(typeof toast==='function') toast('엑셀 다운로드 완료 ✓','s');
  }

  /* ===== 월 이동 ===== */
  function mpPrevMonth(){ _mpYm = _prevYm(_mpYm||_ymToday()); _mpRenderShell(); _mpReload(); }
  function mpNextMonth(){
    var p=_mpYm.split('-').map(Number);
    var d=new Date(p[0],p[1],1);
    _mpYm=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    _mpRenderShell(); _mpReload();
  }
  function mpThisMonth(){ _mpYm=_ymToday(); _mpRenderShell(); _mpReload(); }
  function mpPickMonth(v){ if(!v) return; _mpYm=v; _mpRenderShell(); _mpReload(); }

  function mpToggleGrp(key){
    _mpGrp[key] = !_mpGrp[key];
    try{ localStorage.setItem('ssbon_v6_mpGrp', JSON.stringify(_mpGrp)); }catch(e){}
    _mpRenderShell(); _mpRender();
  }

  /* ===== window 노출 ===== */
  window.showPerf       = showPerf;
  window.showPerfSub    = showPerfSub;
  window.mpPrevMonth    = mpPrevMonth;
  window.mpNextMonth    = mpNextMonth;
  window.mpThisMonth    = mpThisMonth;
  window.mpPickMonth    = mpPickMonth;
  window.mpDownload     = _mpDownload;
  window.mpToggleGrp    = mpToggleGrp;

  ['setMode','setModeSchedule','setModeAtt'].forEach(function(fn){
    var orig = window[fn];
    if(typeof orig==='function'){
      window[fn] = function(){
        var pnav=document.getElementById('pnav'); if(pnav) pnav.classList.add('hid');
        var moPg=document.getElementById('p-monthly-prod'); if(moPg) moPg.classList.remove('on');
        return orig.apply(this, arguments);
      };
    }
  });

})();
