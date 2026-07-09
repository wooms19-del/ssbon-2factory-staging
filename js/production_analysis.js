/* ============================================================
 * 생산 분석 (1~12월 요약) — 제조원가율 형식
 * - 월 아래 [원육·생산량·수율(+개당원육·생산성)] 하위 칸
 * - 제품 한 줄씩 / 전체 종합 줄 / 제품별·부위별 전환
 * - 데이터 있는 달만 표시, 전월 대비 방향 색
 * - 숫자는 월단위생산량과 동일 집계(_mpAggregate)
 * ============================================================ */
(function(){
  var PA_YEAR = 2026;
  var _paData = null;
  var _paBusy = false;
  var _paMode = 'prod';         // 'prod' | 'part'
  var _paHidden = {'개당원육':true,'생산성':true};  // 기본: 원육·생산량·수율
  var _paOff = {};

  function _f(n){ if(n==null||!isFinite(n)) return ''; return Math.round(n).toLocaleString(); }
  function _f1(n){ if(n==null||!isFinite(n)) return ''; return (Math.round(n*10)/10).toLocaleString(); }
  function _ym(m){ return PA_YEAR+'-'+String(m).padStart(2,'0'); }
  function _prevDStr(date){ var d=new Date(date+'T00:00:00'); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }

  async function _paFetchMonth(ym){
    var from = ym+'-01';
    var lastDay = new Date(parseInt(ym.slice(0,4),10), parseInt(ym.slice(5),10), 0).getDate();
    var to = ym+'-'+String(lastDay).padStart(2,'0');
    var today = (function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})();
    var effTo = to>today ? today : to;
    if(from>today) return [];
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

  function _agg(rows){ return (typeof window._mpAggregate==='function') ? window._mpAggregate(rows) : null; }
  function _totalOf(ym){ return _agg(_paData.rowsByYm[ym]||[]); }
  function _totalCum(){ return _agg(_paData.allRows); }
  function _itemAgg(ym, item){
    var key = _paMode==='prod' ? 'product' : 'type';
    return _agg((_paData.rowsByYm[ym]||[]).filter(function(r){ return (r[key]||'')===item; }));
  }
  function _itemCum(item){
    var key = _paMode==='prod' ? 'product' : 'type';
    return _agg(_paData.allRows.filter(function(r){ return (r[key]||'')===item; }));
  }
  function _items(){
    var key = _paMode==='prod' ? 'product' : 'type';
    var vol={};
    _paData.allRows.forEach(function(r){ var k=r[key]||''; if(!k) return; vol[k]=(vol[k]||0)+(r.rmKg||0); });
    return Object.keys(vol).sort(function(a,b){ return vol[b]-vol[a]; });
  }
  // 데이터 있는 달만
  function _activeMonths(){
    var arr=[];
    for(var m=1;m<=12;m++){ var a=_totalOf(_ym(m)); if(a && a.rmKg>0) arr.push(m); }
    return arr;
  }

  // 하위 지표 (goodDir: +1 오르면 좋음 / -1 내리면 좋음 / 0 중립)
  var SUB = [
    { key:'원육',   k:'원육',  u:'kg', dec:0, good:0,  get:function(a){return a?a.rmKg:null;} },
    { key:'생산량', k:'생산량', u:'EA', dec:0, good:0,  get:function(a){return a?a.pkEa:null;} },
    { key:'수율',   k:'수율',  u:'%', dec:1, good:1,  badLow:88, get:function(a){return a?a.yieldRmPk*100:null;} },
    { key:'개당원육', k:'개당원육', u:'g', dec:1, good:-1, itemOnly:true, get:function(a){return a&&a.pkEa?a.rmKg*1000/a.pkEa:null;} },
    { key:'생산성', k:'생산성', u:'', dec:1, good:1,  get:function(a){return a?a.prodAll:null;} },
  ];

  // 행(전체/항목) × 지표 → 월별 값 배열 + 누적
  function _series(kind, item, metric, months){
    var arr = months.map(function(m){
      if(metric.itemOnly && kind==='total') return null;
      var a = kind==='total' ? _totalOf(_ym(m)) : _itemAgg(_ym(m), item);
      return metric.get(a);
    });
    var cum;
    if(metric.itemOnly && kind==='total') cum=null;
    else cum = metric.get(kind==='total' ? _totalCum() : _itemCum(item));
    return {arr:arr, cum:cum};
  }
  // 전월 대비 색
  function _momColor(metric, v, prev){
    if(metric.good===0 || v==null || prev==null) return null;
    var d=v-prev; if(Math.abs(d)<1e-9) return null;
    var better = metric.good>0 ? d>0 : d<0;
    return better ? '#1d4ed8' : '#dc2626';
  }

  function _render(){
    var host=document.getElementById('p-prod-analysis');
    if(!host) return;
    if(!_paData){ host.innerHTML='<div style="padding:30px;text-align:center;color:#6b7280">불러오는 중…</div>'; return; }

    var months = _activeMonths();
    var subVis = SUB.filter(function(s){ return !_paHidden[s.key]; });
    var items = _items().filter(function(x){ return !_paOff[x]; });
    var bd="0.5px solid #e5e7eb", bdS="0.5px solid #cbd5e1", bdM="2px solid #94a3b8";

    var h='';
    // 툴바
    h+='<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 8px 10px">';
    h+='<div style="display:inline-flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden">'
      +'<button onclick="paSetMode(\'prod\')" style="font-size:13px;padding:6px 16px;border:none;cursor:pointer;background:'+(_paMode==='prod'?'#1d4ed8':'#f8fafc')+';color:'+(_paMode==='prod'?'#fff':'#475569')+'">제품별</button>'
      +'<button onclick="paSetMode(\'part\')" style="font-size:13px;padding:6px 16px;border:none;cursor:pointer;background:'+(_paMode==='part'?'#1d4ed8':'#f8fafc')+';color:'+(_paMode==='part'?'#fff':'#475569')+'">부위별</button>'
      +'</div>';
    h+='<span style="font-size:12px;color:#94a3b8;margin:0 2px">| 월별 표시 지표</span>';
    SUB.forEach(function(s){
      var on=!_paHidden[s.key];
      h+='<button onclick="paToggleMetric(\''+s.key+'\')" style="font-size:12px;padding:5px 11px;border-radius:20px;border:1px solid #cbd5e1;cursor:pointer;background:'+(on?'#1d4ed8':'#f1f5f9')+';color:'+(on?'#fff':'#94a3b8')+'">'+s.k+'</button>';
    });
    h+='</div>';

    if(!months.length){ host.innerHTML=h+'<div style="padding:30px 8px;color:#9ca3af">아직 '+PA_YEAR+'년 데이터가 없습니다.</div>'; return; }
    if(!subVis.length){ host.innerHTML=h+'<div style="padding:30px 8px;color:#9ca3af">표시할 지표를 하나 이상 켜세요.</div>'; return; }

    // 표
    h+='<div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:8px;margin:0 8px">';
    h+='<table style="border-collapse:collapse;font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums;min-width:100%">';
    // 헤더 2줄
    h+='<thead>';
    h+='<tr style="background:#374151;color:#fff">';
    h+='<th rowspan="2" style="position:sticky;left:0;z-index:6;background:#1e293b;padding:8px 10px;text-align:left;min-width:118px;border-bottom:'+bd+'">'+(_paMode==='prod'?'제품':'부위')+'</th>';
    months.forEach(function(m,mi){ h+='<th colspan="'+subVis.length+'" style="padding:7px 6px;text-align:center;border-bottom:'+bd+';border-left:'+(mi===0?bdM:'1px solid #6b7280')+'">'+m+'월</th>'; });
    h+='<th colspan="'+subVis.length+'" style="padding:7px 6px;text-align:center;border-bottom:'+bd+';border-left:2px solid #065f46;background:#065f46">누적</th>';
    h+='</tr>';
    h+='<tr style="background:#4b5563;color:#e5e7eb;font-size:9.5px">';
    months.forEach(function(m,mi){ subVis.forEach(function(s,si){ h+='<th style="padding:4px 8px;text-align:right;border-bottom:'+bd+';'+(si===0?'border-left:'+(mi===0?bdM:'1px solid #6b7280'):'')+'">'+s.k+'</th>'; }); });
    subVis.forEach(function(s,si){ h+='<th style="padding:4px 8px;text-align:right;border-bottom:'+bd+';background:#065f46;color:#d1fae5;'+(si===0?'border-left:2px solid #065f46':'')+'">'+s.k+'</th>'; });
    h+='</tr></thead><tbody>';

    // 행 렌더 헬퍼
    function rowHtml(kind, item, ri){
      var isTot = kind==='total';
      var bg = isTot ? '#eaf1f6' : (ri%2?'#ffffff':'#fafafa');
      var lbg = isTot ? '#dce8f0' : (ri%2?'#ffffff':'#f7f7f4');
      var lcol = isTot ? '#1e3a8a' : '#1e40af';
      var name = isTot ? '■ 전체' : item;
      // 지표별 시리즈 미리 계산
      var series = subVis.map(function(s){ return _series(kind, item, s, months); });
      var r='<tr style="background:'+bg+'">';
      r+='<td style="position:sticky;left:0;z-index:4;background:'+lbg+';padding:8px 10px;text-align:left;font-weight:'+(isTot?700:600)+';color:'+lcol+';border-right:'+bdS+';border-bottom:'+(isTot?bdS:bd)+'">'+name+'</td>';
      months.forEach(function(m,mi){
        subVis.forEach(function(s,si){
          var v=series[si].arr[mi];
          // 전월(데이터 있는) 대비
          var prev=null; for(var j=mi-1;j>=0;j--){ if(series[si].arr[j]!=null){prev=series[si].arr[j];break;} }
          var col=_momColor(s,v,prev) || '#1e293b';
          var bgc='transparent';
          if(s.badLow!=null && v!=null && v<s.badLow){ col='#dc2626'; bgc='#fee2e2'; }
          r+='<td style="padding:8px 8px;text-align:right;color:'+col+';background:'+bgc+';border-bottom:'+(isTot?bdS:bd)+';'+(si===0?'border-left:'+(mi===0?bdM:'1px solid #e5e7eb'):'')+'">'+(v==null?'':(s.dec?_f1(v):_f(v)))+'</td>';
        });
      });
      subVis.forEach(function(s,si){
        var cv=series[si].cum;
        r+='<td style="padding:8px 8px;text-align:right;font-weight:600;color:#1d4ed8;background:#f0fdf4;border-bottom:'+(isTot?bdS:bd)+';'+(si===0?'border-left:2px solid #a7f3d0':'')+'">'+(cv==null?'':(s.dec?_f1(cv):_f(cv)))+'</td>';
      });
      r+='</tr>';
      return r;
    }

    h+=rowHtml('total', null, 0);
    items.forEach(function(it,ri){ h+=rowHtml('item', it, ri); });
    h+='</tbody></table></div>';

    // 항목 탭
    var allItems=_items();
    h+='<div style="font-size:12px;color:#94a3b8;margin:14px 8px 6px">'+(_paMode==='prod'?'제품':'부위')+' (누르면 빠짐)</div>';
    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 8px 8px">';
    allItems.forEach(function(x){
      var on=!_paOff[x];
      h+='<button onclick="paToggleItem(\''+x.replace(/'/g,"\\'")+'\')" style="font-size:12px;padding:5px 12px;border-radius:20px;border:1px solid #cbd5e1;cursor:pointer;background:'+(on?'#fff':'#f1f5f9')+';color:'+(on?'#1e293b':'#94a3b8')+';'+(on?'':'text-decoration:line-through;')+'">'+x+'</button>';
    });
    h+='</div>';

    h+='<div style="font-size:11.5px;color:#9ca3af;line-height:1.6;padding:6px 8px 20px">'
      +'전체 종합 + '+(_paMode==='prod'?'제품별':'부위별')+' · 월 아래 하위 칸에 지표 · 데이터 있는 달만 표시 · 전월보다 좋아지면 파랑, 나빠지면 빨강(수율↑·생산성↑·개당원육↓이 좋음) · 수율 88%↓ 빨강 · 숫자는 월단위생산량과 동일 집계</div>';

    host.innerHTML=h;
  }

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
})();
