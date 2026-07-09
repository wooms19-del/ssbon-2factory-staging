/* ============================================================
 * 생산 분석 (1~12월 요약)
 * - 월단위생산량(_mpProcess/_mpAggregate)을 1~12월 돌려서 요약
 * - 숫자는 전부 _mpAggregate 경로 → 월단위생산량과 100% 일치
 * - 전체(회사) 블록 + 제품별/부위별 전환 + 지표/항목 껐다 켜기 + 누적
 * ============================================================ */
(function(){
  var PA_YEAR = 2026;
  var _paData = null;      // { rowsByYm:{ '2026-01':[...], ... }, allRows:[...] }
  var _paBusy = false;
  var _paMode = 'prod';    // 'prod' | 'part'
  var _paHidden = {};      // 숨긴 지표
  var _paOff = {};         // 숨긴 항목(제품/부위)

  function _f(n){ if(n==null||!isFinite(n)) return ''; return Math.round(n).toLocaleString(); }
  function _f1(n){ if(n==null||!isFinite(n)) return ''; return (Math.round(n*10)/10).toLocaleString(); }
  function _ym(m){ return PA_YEAR+'-'+String(m).padStart(2,'0'); }
  function _prevDStr(date){ var d=new Date(date+'T00:00:00'); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }

  // ── 한 달 데이터 로드 → _mpProcess로 행 생성 (월단위생산량과 동일 입력) ──
  async function _paFetchMonth(ym){
    var from = ym+'-01';
    var lastDay = new Date(parseInt(ym.slice(0,4),10), parseInt(ym.slice(5),10), 0).getDate();
    var to = ym+'-'+String(lastDay).padStart(2,'0');
    var today = (function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})();
    var effTo = to>today ? today : to;
    if(from>today) return [];  // 미래 달
    var prevFrom = _prevDStr(from);
    var R = await Promise.all([
      fbGetRange('packing',      from,     effTo).catch(function(){return [];}),
      fbGetRange('outerpacking', from,     effTo).catch(function(){return [];}),
      fbGetRange('preprocess',   from,     effTo).catch(function(){return [];}),
      fbGetRange('thawing',      prevFrom, effTo).catch(function(){return [];}),
      fbGetRange('shredding',    from,     effTo).catch(function(){return [];}),
      fbGetRange('cooking',      from,     effTo).catch(function(){return [];})
    ]);
    if(typeof window._mpProcess !== 'function') return [];
    var res = window._mpProcess(R[0],R[1],R[2],R[3],R[4],R[5], null, 'none');
    var rows = (res && res.rows) || [];
    // 메인 행만 (부위 보조행 제외) + ym 태그
    return rows.filter(function(r){ return r._isMainRow !== false; })
               .map(function(r){ r._ym = ym; return r; });
  }

  async function _paLoad(){
    var rowsByYm = {}, allRows = [];
    for(var m=1;m<=12;m++){
      var ym=_ym(m);
      var rows = await _paFetchMonth(ym);
      rowsByYm[ym]=rows;
      allRows = allRows.concat(rows);
    }
    _paData = { rowsByYm:rowsByYm, allRows:allRows };
  }

  // ── 집계: 월단위생산량과 동일하게 _mpAggregate 경로 사용 ──
  function _agg(rows){
    if(typeof window._mpAggregate === 'function') return window._mpAggregate(rows);
    return null;
  }
  // 전체(회사) 월별 집계
  function _totalOf(ym){ return _agg((_paData.rowsByYm[ym]||[])); }
  function _totalCum(){ return _agg(_paData.allRows); }
  // 항목(제품/부위)별 월별 집계
  function _itemAgg(ym, item){
    var key = _paMode==='prod' ? 'product' : 'type';
    return _agg((_paData.rowsByYm[ym]||[]).filter(function(r){ return (r[key]||'')===item; }));
  }
  function _itemCum(item){
    var key = _paMode==='prod' ? 'product' : 'type';
    return _agg(_paData.allRows.filter(function(r){ return (r[key]||'')===item; }));
  }

  // 존재하는 항목 목록 (그 해 등장한 제품/부위, 데이터 많은 순)
  function _items(){
    var key = _paMode==='prod' ? 'product' : 'type';
    var vol={};
    _paData.allRows.forEach(function(r){
      var k=r[key]||''; if(!k) return;
      vol[k]=(vol[k]||0)+(r.rmKg||0);
    });
    return Object.keys(vol).sort(function(a,b){ return vol[b]-vol[a]; });
  }

  // ── 지표 정의 ──
  // 전체 블록
  var TOTAL_METRICS = [
    { k:'총 원육',    u:'kg', get:function(a){return a?a.rmKg:null;}, dec:0, cum:'sum' },
    { k:'일 평균 원육', u:'kg', get:function(a){return a&&a.dayCount?a.rmKg/a.dayCount:null;}, dec:0, cum:'dayavg' },
    { k:'총 생산량',  u:'EA', get:function(a){return a?a.pkEa:null;}, dec:0, cum:'sum' },
    { k:'원료육 수율', u:'%', get:function(a){return a?a.yieldRmPk*100:null;}, dec:1, cum:'yield', badLow:88 },
    { k:'전체 생산성', u:'',  get:function(a){return a?a.prodAll:null;}, dec:1, cum:'prod' },
    { k:'생산일수',   u:'일', get:function(a){return a?a.dayCount:null;}, dec:0, cum:'sum' },
  ];
  // 제품/부위 지표
  var ITEM_METRICS = [
    { key:'원육',   k:'원육',    u:'kg', get:function(a){return a?a.rmKg:null;}, dec:0, cum:'sum' },
    { key:'생산량', k:'생산량',  u:'EA', get:function(a){return a?a.pkEa:null;}, dec:0, cum:'sum' },
    { key:'개당원육', k:'개당원육', u:'g', get:function(a){return a&&a.pkEa?a.rmKg*1000/a.pkEa:null;}, dec:1, cum:'cmeat', heat:true },
    { key:'수율',   k:'수율',    u:'%', get:function(a){return a?a.yieldRmPk*100:null;}, dec:1, cum:'yield', badLow:88 },
    { key:'생산성', k:'생산성',  u:'',  get:function(a){return a?a.prodAll:null;}, dec:1, cum:'prod' },
  ];

  function _heat(v,avg,sp){
    if(v==null||!sp) return 'transparent';
    var z=(v-avg)/sp;
    if(z>0.15) return z>0.7?'rgba(216,90,48,0.28)':'rgba(216,90,48,0.13)';
    if(z<-0.15) return z<-0.7?'rgba(29,158,117,0.22)':'rgba(29,158,117,0.11)';
    return 'transparent';
  }

  // 월별 값 배열 + 누적값
  function _seriesTotal(metric){
    var arr=[];
    for(var m=1;m<=12;m++){ arr.push(metric.get(_totalOf(_ym(m)))); }
    var cum=_cumVal(metric, _totalCum(), arr);
    return {arr:arr, cum:cum};
  }
  function _seriesItem(metric, item){
    var arr=[];
    for(var m=1;m<=12;m++){ arr.push(metric.get(_itemAgg(_ym(m), item))); }
    var cum=_cumVal(metric, _itemCum(item), arr);
    return {arr:arr, cum:cum};
  }
  function _cumVal(metric, cumAgg, arr){
    if(metric.cum==='sum'){ var s=0,any=false; arr.forEach(function(v){if(v!=null){s+=v;any=true;}}); return any?s:null; }
    // 나머지(수율/생산성/개당원육/일평균)는 전체 누적 집계에서 다시 계산 → 정확
    return metric.get(cumAgg);
  }

  // ── 렌더 ──
  function _render(){
    var host=document.getElementById('p-prod-analysis');
    if(!host) return;
    if(!_paData){ host.innerHTML='<div style="padding:30px;text-align:center;color:#6b7280">불러오는 중…</div>'; return; }

    var M=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    var bd='0.5px solid #e5e7eb', bdS='0.5px solid #cbd5e1';
    var metrics = ITEM_METRICS.filter(function(m){ return !_paHidden[m.key]; });
    var items = _items().filter(function(x){ return !_paOff[x]; });

    var h='';
    // 툴바
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 8px 10px">';
    h+='<div style="display:inline-flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden">'
      + '<button onclick="paSetMode(\'prod\')" style="font-size:13px;padding:6px 16px;border:none;cursor:pointer;background:'+(_paMode==='prod'?'#1d4ed8':'#f8fafc')+';color:'+(_paMode==='prod'?'#fff':'#475569')+'">제품별</button>'
      + '<button onclick="paSetMode(\'part\')" style="font-size:13px;padding:6px 16px;border:none;cursor:pointer;background:'+(_paMode==='part'?'#1d4ed8':'#f8fafc')+';color:'+(_paMode==='part'?'#fff':'#475569')+'">부위별</button>'
      + '</div>';
    h+='<span style="font-size:12px;color:#94a3b8;margin:0 2px">|  지표</span>';
    ITEM_METRICS.forEach(function(m){
      var on=!_paHidden[m.key];
      h+='<button onclick="paToggleMetric(\''+m.key+'\')" style="font-size:12px;padding:5px 11px;border-radius:20px;border:1px solid #cbd5e1;cursor:pointer;background:'+(on?'#1d4ed8':'#f1f5f9')+';color:'+(on?'#fff':'#94a3b8')+'">'+m.k+'</button>';
    });
    h+='<button class="btn dl" onclick="paDownload()" style="margin-left:auto;font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid #1f7a3a;background:#1f7a3a;color:#fff;cursor:pointer">엑셀 다운로드</button>';
    h+='</div>';

    // 표
    h+='<div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px;margin:0 8px">';
    h+='<table style="border-collapse:collapse;font-size:11.5px;white-space:nowrap;font-variant-numeric:tabular-nums;min-width:100%">';
    // 헤더
    h+='<thead><tr style="background:#374151;color:#fff">';
    h+='<th style="position:sticky;left:0;z-index:6;background:#1e293b;padding:8px 10px;text-align:left;min-width:92px">구분</th>';
    h+='<th style="position:sticky;left:92px;z-index:6;background:#1e293b;padding:8px 10px;text-align:left;min-width:88px;border-right:'+bdS+'">지표</th>';
    M.forEach(function(m){ h+='<th style="padding:8px 8px;text-align:right;min-width:52px;border-right:'+bd+'">'+m+'</th>'; });
    h+='<th style="padding:8px 10px;text-align:right;min-width:64px;background:#065f46">누적</th>';
    h+='</tr></thead><tbody>';

    // ── 전체 블록 ──
    var totVis = TOTAL_METRICS.filter(function(m){
      if(m.k==='총 생산량') return !_paHidden['생산량'];
      if(m.k==='원료육 수율') return !_paHidden['수율'];
      if(m.k==='전체 생산성') return !_paHidden['생산성'];
      return true;
    });
    totVis.forEach(function(m,i){
      var s=_seriesTotal(m);
      var last=i===totVis.length-1;
      h+='<tr style="background:#eaf1f6">';
      if(i===0) h+='<td rowspan="'+totVis.length+'" style="position:sticky;left:0;z-index:4;background:#dce8f0;padding:7px 10px;text-align:left;font-weight:700;color:#1e3a8a;vertical-align:top;border-bottom:'+bdS+'">■ 전체</td>';
      h+='<td style="position:sticky;left:92px;z-index:4;background:#eaf1f6;padding:6px 10px;text-align:left;font-weight:600;border-right:'+bdS+';border-bottom:'+(last?bdS:bd)+'">'+m.k+(m.u?' <span style="font-size:9px;color:#94a3b8">'+m.u+'</span>':'')+'</td>';
      s.arr.forEach(function(v){
        var cl='#1e293b'; if(m.badLow!=null && v!=null && v<m.badLow) cl='#dc2626';
        h+='<td style="padding:6px 8px;text-align:right;font-weight:600;color:'+cl+';border-right:'+bd+';border-bottom:'+(last?bdS:bd)+'">'+(v==null?'':(m.dec?_f1(v):_f(v)))+'</td>';
      });
      h+='<td style="padding:6px 10px;text-align:right;font-weight:700;color:#1d4ed8;border-bottom:'+(last?bdS:bd)+'">'+(s.cum==null?'':(m.dec?_f1(s.cum):_f(s.cum)))+'</td>';
      h+='</tr>';
    });

    // ── 항목별(제품/부위) ──
    if(!metrics.length){
      h+='<tr><td colspan="'+(M.length+3)+'" style="padding:14px;text-align:center;color:#9ca3af">지표를 하나 이상 켜세요</td></tr>';
    }
    items.forEach(function(it,ii){
      metrics.forEach(function(m,mi){
        var s=_seriesItem(m, it);
        var last=mi===metrics.length-1;
        var vals=s.arr.filter(function(x){return x!=null;});
        var avg=vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;
        var sp=(Math.max.apply(null,vals.concat([0]))-Math.min.apply(null,vals.concat([avg])))||1;
        h+='<tr style="background:'+(ii%2?'#ffffff':'#fafafa')+'">';
        if(mi===0) h+='<td rowspan="'+metrics.length+'" style="position:sticky;left:0;z-index:4;background:'+(ii%2?'#ffffff':'#f7f7f4')+';padding:7px 10px;text-align:left;font-weight:600;color:#1e40af;vertical-align:top;border-bottom:'+bdS+'">'+it+'</td>';
        h+='<td style="position:sticky;left:92px;z-index:4;background:'+(ii%2?'#ffffff':'#f7f7f4')+';padding:6px 10px;text-align:left;color:#475569;border-right:'+bdS+';border-bottom:'+(last?bdS:bd)+'">'+m.k+(m.u?' <span style="font-size:9px;color:#94a3b8">'+m.u+'</span>':'')+'</td>';
        s.arr.forEach(function(v){
          var bg='transparent', cl='#1e293b';
          if(m.heat) bg=_heat(v,avg,sp);
          if(m.badLow!=null && v!=null && v<m.badLow){ cl='#dc2626'; bg='#fee2e2'; }
          h+='<td style="padding:6px 8px;text-align:right;color:'+cl+';background:'+bg+';border-right:'+bd+';border-bottom:'+(last?bdS:bd)+'">'+(v==null?'':(m.dec?_f1(v):_f(v)))+'</td>';
        });
        h+='<td style="padding:6px 10px;text-align:right;font-weight:600;color:#1d4ed8;border-bottom:'+(last?bdS:bd)+'">'+(s.cum==null?'':(m.dec?_f1(s.cum):_f(s.cum)))+'</td>';
        h+='</tr>';
      });
    });
    h+='</tbody></table></div>';

    // 항목 탭
    var allItems=_items();
    h+='<div style="font-size:12px;color:#94a3b8;margin:14px 8px 6px">'+(_paMode==='prod'?'제품':'부위')+' (누르면 표에서 빠짐)</div>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 8px 8px">';
    allItems.forEach(function(x){
      var on=!_paOff[x];
      h+='<button onclick="paToggleItem(\''+x.replace(/'/g,"\\'")+'\')" style="font-size:12px;padding:5px 12px;border-radius:20px;border:1px solid #cbd5e1;cursor:pointer;background:'+(on?'#fff':'#f1f5f9')+';color:'+(on?'#1e293b':'#94a3b8')+';'+(on?'':'text-decoration:line-through;')+'">'+x+'</button>';
    });
    h+='</div>';

    h+='<div style="font-size:11.5px;color:#9ca3af;line-height:1.6;padding:6px 8px 20px">'
      + '전체 = 회사 월별 종합 · 그 아래 '+(_paMode==='prod'?'제품별':'부위별')+' · 1~12월 + 누적 · 숫자는 월단위생산량과 동일 집계 · 개당원육 붉을수록 원가↑, 수율 88%↓ 빨강 · 부위별 원육은 그 부위(홍두깨·설도·우둔)로 잡힌 생산분 합산</div>';

    host.innerHTML=h;
  }

  // ── 엔트리 ──
  function renderProdAnalysis(){
    var host=document.getElementById('p-prod-analysis');
    if(host) host.innerHTML='<div style="padding:40px;text-align:center;color:#6b7280;font-size:14px">1~12월 데이터 불러오는 중…</div>';
    if(_paBusy) return;
    _paBusy=true;
    (async function(){
      try{ await _paLoad(); _render(); }
      catch(e){ console.error('[생산분석] 오류', e); if(host) host.innerHTML='<div style="padding:30px;text-align:center;color:#c0392b">불러오기 오류: '+(e.message||e)+'</div>'; }
      finally{ _paBusy=false; }
    })();
  }
  window.renderProdAnalysis = renderProdAnalysis;
  window.paSetMode = function(m){ _paMode=m; _paOff={}; _render(); };
  window.paToggleMetric = function(k){ _paHidden[k]=!_paHidden[k]; _render(); };
  window.paToggleItem = function(x){ _paOff[x]=!_paOff[x]; _render(); };
  window.paDownload = function(){ if(typeof toast==='function') toast('엑셀 다운로드는 곧 추가됩니다','i'); };
})();
