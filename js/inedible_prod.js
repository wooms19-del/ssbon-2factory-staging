/* ===========================================================
 * inedible_prod.js v3
 * 실적관리 > 비가식부·생산성 (월별, 원육 부위별 + 제품명 + 분석)
 * - analysis.js 일별요약 정의로 (날짜×부위) 집계
 *   ▸ 원육 무게 = matchedTh(그날 end된 방혈 totalKg) 부위별
 *   ▸ 비가식부: 전처리 Σwaste(÷원육), 파쇄 Σwaste(÷자숙산출)
 *   ▸ 생산성: 전처리=원육÷인시, 자숙=전처리산출÷인시,
 *            파쇄=파쇄산출÷인시, 포장=EA÷인시  (mh=Σ dur×workers)
 *   ▸ 제품명 = 포장 레코드(getPkType로 부위 매칭)의 product
 *   ▸ 테스트 체인·진행중(packing_pending) 날짜 제외
 *   ▸ 원육별 필터 + 분석(부위별 요약/전월 대비/자동 인사이트)
 * - 전역 헬퍼(r2/dur/fbGetRange) 사용 (common.js)
 * =========================================================== */
(function(){
  'use strict';

  var _ipYm = null;
  var _ipBusy = false;
  var _ipType = null;
  var _ipRows = [];
  var _ipPrevRows = [];
  var _ipTypes = [];
  var _ipPendingCnt = 0;
  var _ipShowAnalysis = true;

  /* ===== 유틸 ===== */
  function _ymToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _today(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function _prevYm(ym){ var p=ym.split('-').map(Number); var d=new Date(p[0],p[1]-2,1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _nextYm(ym){ var p=ym.split('-').map(Number); var d=new Date(p[0],p[1],1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _monthBounds(ym){
    var from=ym+'-01';
    var lastDay=new Date(parseInt(ym.slice(0,4),10), parseInt(ym.slice(5),10), 0).getDate();
    var to=ym+'-'+String(lastDay).padStart(2,'0');
    return {from:from, to:to};
  }
  function _sl10(v){ return String(v||'').slice(0,10); }
  function _normW(w){ return String(w||'').replace(/[^0-9]/g,'') || String(w||'').trim(); }
  function _addDays(d,n){ var p=d.split('-').map(Number); var dt=new Date(p[0],p[1]-1,p[2]+n); return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
  function _num(v){ var n=parseFloat(v); return isFinite(n)?n:0; }
  function _splitT(t){ return (t||'').split(',').map(function(x){return x.trim();}).filter(Boolean); }
  function _esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function _isNoMeatProduct(name){
    try { if(typeof L!=='undefined'&&L&&L.products){ var p=L.products.find(function(x){return x.name===name;}); return !!(p&&p.noMeat); } } catch(e){}
    return false;
  }

  /* ===== 하루치 (날짜×부위) 집계 ===== */
  function _computeDayRows(d, DATA){
    var PP=DATA.pp, TH=DATA.th, SH=DATA.sh, CK=DATA.ck, PK=DATA.pk, OP=DATA.op;
    var prevD=_addDays(d,-1);
    var ppAll=PP.filter(function(r){return _sl10(r.date)===d;});
    var ckAll=CK.filter(function(r){return _sl10(r.date)===d;});
    var shAll=SH.filter(function(r){return _sl10(r.date)===d;});
    var pkAll=PK.filter(function(r){return _sl10(r.date)===d;});
    var opAll=OP.filter(function(r){return _sl10(r.date)===d;});

    var _testOpProds=new Set(opAll.filter(function(r){return r.testRun||r.isTest;}).map(function(r){return String(r.product||'');}));
    var _testPk=pkAll.filter(function(r){return r.testRun||r.isTest||_testOpProds.has(String(r.product||''));});
    var _testPkW=new Set(_testPk.flatMap(function(r){return _splitT(r.wagon);}));
    var _testPkC=new Set(_testPk.flatMap(function(r){return _splitT(r.cart);}));
    var _testSh=shAll.filter(function(r){ return _splitT(r.wagonOut).some(function(w){return _testPkW.has(w);}) || _splitT(r.cartOut).some(function(w){return _testPkC.has(w);}); });
    var _testShW=new Set(_testSh.flatMap(function(r){return _splitT(r.wagonIn);}));
    var _testCk=ckAll.filter(function(r){return _splitT(r.wagonOut).some(function(w){return _testShW.has(w);});});
    var _testCkC=new Set(_testCk.flatMap(function(r){return _splitT(r.cage);}));
    var _testPp=ppAll.filter(function(r){return _splitT(r.cage).some(function(c){return _testCkC.has(c);});});
    var _testPpW=new Set(_testPp.flatMap(function(r){return _splitT(r.wagons);}));
    var _idset=function(s){return new Set(s.map(function(r){return r.fbId||r.id;}));};
    var _tPk=_idset(_testPk),_tSh=_idset(_testSh),_tCk=_idset(_testCk),_tPp=_idset(_testPp);
    var pk=pkAll.filter(function(r){return !_tPk.has(r.fbId||r.id);});
    var sh=shAll.filter(function(r){return !_tSh.has(r.fbId||r.id);});
    var ck=ckAll.filter(function(r){return !_tCk.has(r.fbId||r.id);});
    var pp=ppAll.filter(function(r){return !_tPp.has(r.fbId||r.id);});

    var _ppWagons=[...new Set(pp.flatMap(function(r){return _splitT(r.wagons).map(_normW);}))];
    function _endsOnDay(r,day){ var e=String(r.end||''); if(!e) return false; if(e.length>=10&&e.slice(0,10)===day) return true; if(e.length<=5&&_sl10(r.date)===day) return true; return false; }
    var _cand=TH.filter(function(r){ var rd=_sl10(r.date); return (rd===d||rd===prevD)&&!_testPpW.has((r.cart||'').trim()); });
    var _rawTh=_cand.filter(function(r){return _endsOnDay(r,d);});
    if(!_rawTh.length){
      if(_ppWagons.length){ _rawTh=_cand.filter(function(r){return _ppWagons.includes(_normW(r.cart));}); }
      else {
        _rawTh=TH.filter(function(r){return _sl10(r.date)===d&&!_testPpW.has((r.cart||'').trim());});
        if(!_rawTh.length) _rawTh=TH.filter(function(r){return _sl10(r.date)===prevD&&!_testPpW.has((r.cart||'').trim());});
      }
    }
    if(_ppWagons.length){
      var _nextD=_addDays(d,1);
      var _nextRaw=TH.filter(function(r){return _sl10(r.date)===_nextD&&!_testPpW.has((r.cart||'').trim())&&_ppWagons.includes(_normW(r.cart));});
      var _cur=r2(_rawTh.reduce(function(s,r){return s+_num(r.totalKg);},0));
      var _nxt=r2(_nextRaw.reduce(function(s,r){return s+_num(r.totalKg);},0));
      if(_nextRaw.length&&_nxt>_cur*2) _rawTh=_nextRaw;
    }
    var _seen=new Set();
    var matchedTh=_rawTh.filter(function(r){ var k=(r.cart||'')+'|'+_sl10(r.date)+'|'+(r.type||''); if(_seen.has(k)) return false; _seen.add(k); return true; });

    var rmByType={};
    matchedTh.forEach(function(r){ var ts=_splitT(r.type); if(!ts.length) ts=['미분류']; ts.forEach(function(t){ rmByType[t]=(rmByType[t]||0)+_num(r.totalKg); }); });

    function _grp(recs, kf){ var m={}; recs.forEach(function(r){ var ts=_splitT(r.type||'미분류'); ts.forEach(function(t){ if(!m[t]) m[t]={kg:0,waste:0,mh:0}; m[t].kg+=_num(r[kf]); m[t].waste+=_num(r.waste); m[t].mh+=dur(r.start,r.end)*_num(r.workers); }); }); return m; }
    var ppG=_grp(pp,'kg'), ckG=_grp(ck,'kg');

    var shG={};
    sh.forEach(function(r){
      var t=(r.type||'').trim();
      if(!t){ var wIns=_splitT(r.wagonIn); for(var i=0;i<wIns.length;i++){ var c=ck.find(function(c2){return _splitT(c2.wagonOut).includes(wIns[i]);}); if(c&&c.type){ t=_splitT(c.type)[0]; break; } } }
      if(!t) t='미분류';
      if(!shG[t]) shG[t]={kg:0,waste:0,mh:0};
      shG[t].kg+=_num(r.kg); shG[t].waste+=_num(r.waste); shG[t].mh+=dur(r.start,r.end)*_num(r.workers);
    });

    function _pkType(r){
      if(_isNoMeatProduct(r.product)) return '';
      var set=new Set();
      _splitT(r.wagon).forEach(function(wn){ var s=sh.find(function(x){return _splitT(x.wagonOut).includes(wn);}); if(s) _splitT(s.wagonIn).forEach(function(wi){ var c=ck.find(function(x){return _splitT(x.wagonOut).includes(wi);}); if(c&&c.type) _splitT(c.type).forEach(function(t){set.add(t);}); }); });
      _splitT(r.cart).forEach(function(cn){ var s=sh.find(function(x){return _splitT(x.cartOut).includes(cn);}); if(s) _splitT(s.wagonIn).forEach(function(wi){ var c=ck.find(function(x){return _splitT(x.wagonOut).includes(wi);}); if(c&&c.type) _splitT(c.type).forEach(function(t){set.add(t);}); }); });
      if(set.size) return [...set][0];
      var ppt=pp.map(function(r){return r.type;}).filter(Boolean);
      return ppt.length ? _splitT(ppt[0])[0] : '미분류';
    }
    var pkG={};
    pk.forEach(function(r){ var t=_pkType(r); if(!t) return; if(!pkG[t]) pkG[t]={ea:0,mh:0,prods:{}}; pkG[t].ea+=_num(r.ea); pkG[t].mh+=dur(r.start,r.end)*_num(r.workers); if(r.product) pkG[t].prods[r.product]=(pkG[t].prods[r.product]||0)+_num(r.ea); });

    var hasPp=Object.keys(ppG).length>0;
    var types=[...new Set([].concat(Object.keys(ppG),Object.keys(ckG),Object.keys(shG),Object.keys(pkG)))]
      .filter(function(t){ return t && (t!=='미분류' || !hasPp); });

    return types.map(function(t){
      var prods=(pkG[t]||{}).prods||{};
      var prodName=Object.keys(prods).sort(function(a,b){return prods[b]-prods[a];}).join(', ');
      return { date:d, type:t, product:prodName,
        rmKg:r2(rmByType[t]||0),
        ppKg:r2((ppG[t]||{}).kg||0), ppWaste:r2((ppG[t]||{}).waste||0), ppMH:r2((ppG[t]||{}).mh||0),
        ckKg:r2((ckG[t]||{}).kg||0), ckMH:r2((ckG[t]||{}).mh||0),
        shKg:r2((shG[t]||{}).kg||0), shWaste:r2((shG[t]||{}).waste||0), shMH:r2((shG[t]||{}).mh||0),
        ea:(pkG[t]||{}).ea||0, pkMH:r2((pkG[t]||{}).mh||0) };
    }).filter(function(x){ return x.rmKg||x.ppKg||x.ckKg||x.shKg||x.ea; });
  }

  /* ===== 월 전체 행 빌드 ===== */
  function _buildMonthRows(DATA, from, effTo, pendingDates){
    var dateSet=new Set();
    ['pp','sh','ck','pk'].forEach(function(key){
      DATA[key].forEach(function(r){ var d=_sl10(r.date); if(d>=from&&d<=effTo) dateSet.add(d); });
    });
    var dates=[...dateSet].filter(function(d){return !pendingDates.has(d);}).sort();
    var rows=[];
    dates.forEach(function(d){ _computeDayRows(d, DATA).forEach(function(r){ rows.push(r); }); });
    return rows;
  }

  /* ===== 집계 ===== */
  function _agg(rows){
    var S={rmKg:0,ppWaste:0,shWaste:0,ppKg:0,ckKg:0,shKg:0,ea:0,ppMH:0,ckMH:0,shMH:0,pkMH:0};
    rows.forEach(function(x){ for(var k in S) S[k]+=x[k]||0; });
    S.days=new Set(rows.map(function(r){return r.date;})).size;
    S.ppWastePct = S.rmKg>0 ? S.ppWaste/S.rmKg*100 : null;
    S.shWastePct = S.ckKg>0 ? S.shWaste/S.ckKg*100 : null;
    S.prodPp = S.ppMH>0 ? S.rmKg/S.ppMH : null;
    S.prodCk = S.ckMH>0 ? S.ppKg/S.ckMH : null;
    S.prodSh = S.shMH>0 ? S.shKg/S.shMH : null;
    S.prodPk = S.pkMH>0 ? S.ea/S.pkMH : null;
    return S;
  }

  /* ===== 셸 ===== */
  function _renderShell(){
    var pg=document.getElementById('p-inedible'); if(!pg) return;
    var ym=_ipYm||_ymToday();
    var y=ym.slice(0,4), mIdx=parseInt(ym.slice(5),10);
    pg.innerHTML = ''
      + '<style>'
      + '#ipToolbar{padding:12px 14px;background:#f5f6fa;border-bottom:1px solid #ddd;display:flex;flex-wrap:wrap;gap:8px;align-items:center}'
      + '#ipToolbar .btn{padding:7px 14px;border:1px solid #bbb;background:#fff;border-radius:5px;cursor:pointer;font-size:13px}'
      + '#ipToolbar .btn:hover{background:#eee}'
      + '#ipToolbar .btn.an{background:#0e7490;color:#fff;border-color:#0e7490;font-weight:600}'
      + '#ipToolbar .lbl{font-weight:700;color:#1e293b;margin:0 8px;font-size:15px}'
      + '#ipToolbar input[type=month]{padding:6px 8px;border:1px solid #bbb;border-radius:5px;font-size:13px}'
      + '#ipAnalysis{padding:0 14px}'
      + '.an-card{margin:14px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}'
      + '.an-hd{background:#0f3a4d;color:#fff;padding:10px 14px;font-weight:700;font-size:14px}'
      + '.an-sec{padding:12px 14px;border-bottom:1px solid #f0f0f0}'
      + '.an-sec:last-child{border-bottom:none}'
      + '.an-sec h4{margin:0 0 8px;font-size:13px;color:#0f3a4d;font-weight:700}'
      + '.an-tbl{border-collapse:collapse;font-size:12.5px;width:100%;max-width:880px}'
      + '.an-tbl th,.an-tbl td{border:1px solid #e2e8f0;padding:6px 10px;text-align:center}'
      + '.an-tbl th{background:#eef2f7;color:#1e293b;font-weight:600}'
      + '.an-tbl td.l{text-align:left;font-weight:600}'
      + '.an-ins{margin:0;padding-left:18px;font-size:13px;line-height:1.9;color:#1f2937}'
      + '.an-ins li{margin:2px 0}'
      + '.up{color:#dc2626;font-weight:600}'   /* 나쁨/증가 */
      + '.dn{color:#1d4ed8;font-weight:600}'   /* 좋음/감소 */
      + '#ipFilter{padding:8px 14px;background:#fff;border-bottom:1px solid #eee;display:flex;flex-wrap:wrap;gap:6px;align-items:center}'
      + '#ipFilter .flb{font-size:12px;color:#64748b;font-weight:600;margin-right:4px}'
      + '#ipFilter .chip{padding:5px 12px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;cursor:pointer;font-size:12.5px;color:#334155;user-select:none}'
      + '#ipFilter .chip:hover{background:#f1f5f9}'
      + '#ipFilter .chip.on{background:#0e7490;border-color:#0e7490;color:#fff;font-weight:600}'
      + '#ipStatus{padding:10px 14px;color:#1b8a3a;font-size:13px;font-weight:500;background:#f0fdf4;border-bottom:1px solid #d1fae5}'
      + '#ipTblWrap{overflow:auto;background:#fff;padding-bottom:4px;max-height:calc(100vh - 340px);border:1px solid #e5e7eb;border-radius:6px}'
      + '#ipTbl{border-collapse:separate;border-spacing:0;font-size:12.5px;white-space:nowrap;min-width:100%;font-variant-numeric:tabular-nums}'
      + '#ipTbl th,#ipTbl td{border-right:1px solid #d1d5db;border-bottom:1px solid #d1d5db;padding:7px 10px;text-align:center;vertical-align:middle}'
      + '#ipTbl thead th{background:#374151;color:#fff;font-weight:600;position:sticky;top:0;z-index:10;line-height:1.35;font-size:12px;border-color:#1f2937}'
      + '#ipTbl thead th.g-ined{background:#b91c1c}'
      + '#ipTbl thead th.g-prod{background:#0e7490}'
      + '#ipTbl tbody td.c-ined{background:#fef2f2}'
      + '#ipTbl tbody td.c-prod{background:#f0fdfa}'
      + '#ipTbl tbody tr.sum td{background:#fef9e7;font-weight:700;border-top:2px solid #cbd5e1}'
      + '#ipTbl tbody tr.avg td{background:#eef6ec;font-weight:600}'
      + '#ipTbl tbody td.dt{font-weight:600}'
      + '#ipTbl tbody td.ty{font-weight:600;color:#0f172a}'
      + '#ipTbl tbody td.pd{color:#334155}'
      + '.ip-red{color:#dc2626}'
      + '</style>'
      + '<div id="ipToolbar">'
      +   '<button class="btn" onclick="ipPrevMonth()">◀</button>'
      +   '<span class="lbl">'+y+'년 '+mIdx+'월</span>'
      +   '<button class="btn" onclick="ipNextMonth()">▶</button>'
      +   '<button class="btn" onclick="ipThisMonth()">이번달</button>'
      +   '<input type="month" value="'+ym+'" onchange="ipPickMonth(this.value)">'
      +   '<button class="btn'+(_ipShowAnalysis?' an':'')+'" onclick="ipToggleAnalysis()">📊 분석</button>'
      + '</div>'
      + '<div id="ipAnalysis"></div>'
      + '<div id="ipFilter"></div>'
      + '<div id="ipStatus">데이터 불러오는 중…</div>'
      + '<div id="ipTblWrap"><table id="ipTbl"></table></div>';
  }

  /* ===== 로드 ===== */
  function _reload(){
    if(_ipBusy) return;
    _ipBusy=true;
    (async function(){
      try {
        var ym=_ipYm||_ymToday();
        var cur=_monthBounds(ym);
        var today=_today();
        var effTo=cur.to>today?today:cur.to;
        var pYm=_prevYm(ym), prev=_monthBounds(pYm);
        var pEffTo=prev.to>today?today:prev.to;

        var R=await Promise.all([
          fbGetRange('preprocess',   cur.from,        effTo),
          fbGetRange('thawing',      _addDays(cur.from,-1), _addDays(effTo,1)),
          fbGetRange('shredding',    cur.from,        effTo),
          fbGetRange('cooking',      cur.from,        effTo),
          fbGetRange('packing',      cur.from,        effTo),
          fbGetRange('outerpacking', cur.from,        effTo),
          fbGetRange('packing_pending', cur.from,     effTo).catch(function(){return [];}),
          fbGetRange('preprocess',   prev.from,       pEffTo),
          fbGetRange('thawing',      _addDays(prev.from,-1), _addDays(pEffTo,1)),
          fbGetRange('shredding',    prev.from,       pEffTo),
          fbGetRange('cooking',      prev.from,       pEffTo),
          fbGetRange('packing',      prev.from,       pEffTo),
          fbGetRange('outerpacking', prev.from,       pEffTo),
          fbGetRange('packing_pending', prev.from,    pEffTo).catch(function(){return [];})
        ]);
        var CUR={ pp:R[0], th:R[1], sh:R[2], ck:R[3], pk:R[4], op:R[5] };
        var PRV={ pp:R[7], th:R[8], sh:R[9], ck:R[10], pk:R[11], op:R[12] };

        var pendCur=new Set(); (R[6]||[]).forEach(function(r){ var d=_sl10(r.date); if(d) pendCur.add(d); });
        var pendPrv=new Set(); (R[13]||[]).forEach(function(r){ var d=_sl10(r.date); if(d) pendPrv.add(d); });

        _ipRows     = _buildMonthRows(CUR, cur.from, effTo, pendCur);
        _ipPrevRows = _buildMonthRows(PRV, prev.from, pEffTo, pendPrv);
        _ipPendingCnt = pendCur.size;

        var byT={}; _ipRows.forEach(function(r){ byT[r.type]=(byT[r.type]||0)+r.rmKg; });
        _ipTypes=Object.keys(byT).sort(function(a,b){ return byT[b]-byT[a]; });
        if(_ipType && _ipTypes.indexOf(_ipType)<0) _ipType=null;

        _renderAnalysis();
        _renderFilter();
        _renderTable();
      } catch(e){
        console.error('[inedible] reload error', e);
        var st=document.getElementById('ipStatus');
        if(st){ st.textContent='로드 오류: '+(e.message||e); st.style.color='#c0392b'; st.style.background='#fdecea'; }
      } finally {
        _ipBusy=false;
      }
    })();
  }

  /* ===== 분석 ===== */
  function _fx(v,dg){ return v==null?'-':(dg===2?r2(v).toFixed(2):r2(v).toFixed(1)); }
  function _delta(cur, prev, goodWhenDown, unit, dg){
    // goodWhenDown: 값이 내려가면 좋음(비가식부) → 증가=red(up), 감소=blue(dn)
    //               false → 생산성: 증가=blue, 감소=red
    if(cur==null||prev==null) return '-';
    var d=cur-prev;
    var sign=d>0?'+':'';
    var bad = goodWhenDown ? (d>0) : (d<0);
    var cls = Math.abs(d)<0.0001 ? '' : (bad?'up':'dn');
    var txt=sign+(dg===2?r2(d).toFixed(2):r2(d).toFixed(1))+(unit||'');
    return cls?('<span class="'+cls+'">'+txt+'</span>'):txt;
  }

  function _renderAnalysis(){
    var el=document.getElementById('ipAnalysis'); if(!el) return;
    if(!_ipShowAnalysis){ el.innerHTML=''; return; }
    if(!_ipRows.length){ el.innerHTML=''; return; }

    var cur=_agg(_ipRows);
    var prev=_ipPrevRows.length?_agg(_ipPrevRows):null;

    // 부위별 집계
    var types={};
    _ipRows.forEach(function(r){ (types[r.type]=types[r.type]||[]).push(r); });
    var typeList=Object.keys(types).sort(function(a,b){ return _agg(types[b]).rmKg-_agg(types[a]).rmKg; });
    var typeAgg={}; typeList.forEach(function(t){ typeAgg[t]=_agg(types[t]); });

    // ── 부위별 요약 ──
    var sec1='<h4>부위별 요약</h4><table class="an-tbl"><thead><tr>'
      +'<th>부위</th><th>원육(kg)</th><th>전처리 비가식%</th><th>파쇄 비가식%</th>'
      +'<th>생산성 전처리</th><th>생산성 자숙</th><th>생산성 파쇄</th><th>생산성 포장</th></tr></thead><tbody>';
    typeList.forEach(function(t){
      var a=typeAgg[t];
      sec1+='<tr><td class="l">'+_esc(t)+'</td>'
        +'<td>'+r2(a.rmKg).toLocaleString()+'</td>'
        +'<td class="ip-red">'+_fx(a.ppWastePct)+'%</td>'
        +'<td class="ip-red">'+_fx(a.shWastePct)+'%</td>'
        +'<td>'+_fx(a.prodPp)+'</td><td>'+_fx(a.prodCk)+'</td><td>'+_fx(a.prodSh)+'</td><td>'+_fx(a.prodPk,2)+'</td></tr>';
    });
    sec1+='</tbody></table>';

    // ── 전월 대비 ──
    var sec2='';
    if(prev && prev.rmKg>0){
      var pYm=_prevYm(_ipYm||_ymToday());
      sec2='<h4>전월 대비 ('+pYm.replace('-','년 ')+'월 → 이번 달)</h4><table class="an-tbl"><thead><tr>'
        +'<th>지표</th><th>이번 달</th><th>전월</th><th>증감</th></tr></thead><tbody>'
        +'<tr><td class="l">총 원육(kg)</td><td>'+r2(cur.rmKg).toLocaleString()+'</td><td>'+r2(prev.rmKg).toLocaleString()+'</td><td>'+_delta(cur.rmKg,prev.rmKg,false,'',1)+'</td></tr>'
        +'<tr><td class="l">전처리 비가식부율</td><td>'+_fx(cur.ppWastePct)+'%</td><td>'+_fx(prev.ppWastePct)+'%</td><td>'+_delta(cur.ppWastePct,prev.ppWastePct,true,'%p',1)+'</td></tr>'
        +'<tr><td class="l">파쇄 비가식부율</td><td>'+_fx(cur.shWastePct)+'%</td><td>'+_fx(prev.shWastePct)+'%</td><td>'+_delta(cur.shWastePct,prev.shWastePct,true,'%p',1)+'</td></tr>'
        +'<tr><td class="l">생산성 전처리(kg/인시)</td><td>'+_fx(cur.prodPp)+'</td><td>'+_fx(prev.prodPp)+'</td><td>'+_delta(cur.prodPp,prev.prodPp,false,'',1)+'</td></tr>'
        +'<tr><td class="l">생산성 자숙(kg/인시)</td><td>'+_fx(cur.prodCk)+'</td><td>'+_fx(prev.prodCk)+'</td><td>'+_delta(cur.prodCk,prev.prodCk,false,'',1)+'</td></tr>'
        +'<tr><td class="l">생산성 파쇄(kg/인시)</td><td>'+_fx(cur.prodSh)+'</td><td>'+_fx(prev.prodSh)+'</td><td>'+_delta(cur.prodSh,prev.prodSh,false,'',1)+'</td></tr>'
        +'<tr><td class="l">생산성 포장(EA/인시)</td><td>'+_fx(cur.prodPk,2)+'</td><td>'+_fx(prev.prodPk,2)+'</td><td>'+_delta(cur.prodPk,prev.prodPk,false,'',2)+'</td></tr>'
        +'</tbody></table>'
        +'<div style="font-size:11.5px;color:#64748b;margin-top:6px;line-height:1.6">※ 전체 평균값은 부위·제품 구성에 따라 달라집니다(예: 홍두깨·FC 비중이 높은 달은 비가식부율↑·포장 EA/인시↓). 공정 자체 비교는 위 <b>부위별 요약</b>을 참고하세요.</div>';
    }

    // ── 자동 인사이트 (계산값 기반, 부위별 비교 중심) ──
    var ins=[];
    var prevTypes={}; _ipPrevRows.forEach(function(r){ (prevTypes[r.type]=prevTypes[r.type]||[]).push(r); });
    var prevTypeAgg={}; Object.keys(prevTypes).forEach(function(t){ prevTypeAgg[t]=_agg(prevTypes[t]); });

    // 1) 부위 간 전처리 비가식부율 격차 (구성 무관, 순수 비교)
    var withRm=typeList.filter(function(t){return typeAgg[t].ppWastePct!=null && typeAgg[t].rmKg>0;});
    if(withRm.length>=2){
      var sorted=withRm.slice().sort(function(a,b){return typeAgg[b].ppWastePct-typeAgg[a].ppWastePct;});
      var hi=sorted[0], lo=sorted[sorted.length-1];
      var gap=typeAgg[hi].ppWastePct-typeAgg[lo].ppWastePct;
      if(gap>=2) ins.push('전처리 비가식부율은 <b>'+_esc(hi)+' '+_fx(typeAgg[hi].ppWastePct)+'%</b>로 '+_esc(lo)+'('+_fx(typeAgg[lo].ppWastePct)+'%)보다 <span class="up">'+_fx(gap)+'%p</span> 높습니다. '+_esc(hi)+' 손질 손실을 점검해 볼 만합니다.');
    }
    // 2) 같은 부위 평균 대비 높았던 날
    var bigDays=_ipRows.filter(function(r){ return r.rmKg>=500 && r.ppWaste>0 && typeAgg[r.type] && typeAgg[r.type].ppWastePct!=null; });
    if(bigDays.length){
      var worst=bigDays.slice().sort(function(a,b){return (b.ppWaste/b.rmKg)-(a.ppWaste/a.rmKg);})[0];
      var wp=worst.ppWaste/worst.rmKg*100;
      var base=typeAgg[worst.type].ppWastePct;
      if(wp>=base+2) ins.push('<b>'+worst.date.slice(5)+' '+_esc(worst.type)+'</b> 전처리 비가식부율이 <span class="up">'+_fx(wp)+'%</span>로 '+_esc(worst.type)+' 평균('+_fx(base)+'%)보다 높았습니다.');
    }
    // 3) 부위별 전월 대비 (구성 영향 제거 — 같은 부위끼리만 비교)
    typeList.forEach(function(t){
      var c=typeAgg[t], p=prevTypeAgg[t];
      if(c && p && c.ppWastePct!=null && p.ppWastePct!=null && c.rmKg>=1000){
        var dpp=c.ppWastePct-p.ppWastePct;
        if(Math.abs(dpp)>=1) ins.push('<b>'+_esc(t)+'</b> 전처리 비가식부율 전월 대비 '+(dpp>0?'<span class="up">'+_fx(dpp)+'%p 상승</span>':'<span class="dn">'+_fx(-dpp)+'%p 개선</span>')+' ('+_fx(p.ppWastePct)+'% → '+_fx(c.ppWastePct)+'%).');
      }
    });
    // 4) 전체 평균 변화는 구성 영향임을 안내
    if(prev && prev.ppWastePct!=null && cur.ppWastePct!=null && Math.abs(cur.ppWastePct-prev.ppWastePct)>=1){
      ins.push('전체 평균 비가식부율은 '+_fx(prev.ppWastePct)+'% → '+_fx(cur.ppWastePct)+'%로 바뀌었지만 이는 부위 구성 영향을 받으니, 공정 비교는 위 부위별 수치를 참고하세요.');
    }
    // 5) 생산성 측정 특성 안내
    var prodTypes=typeList.filter(function(t){return typeAgg[t].prodPp!=null;});
    if(prodTypes.length>=2){
      var lowPp=prodTypes.slice().sort(function(a,b){return typeAgg[a].prodPp-typeAgg[b].prodPp;})[0];
      ins.push('전처리 생산성은 <b>'+_esc(lowPp)+'</b>가 '+_fx(typeAgg[lowPp].prodPp)+' kg/인시로 가장 낮습니다(투입량이 많은 부위일수록 인시당 처리량이 낮게 나오는 경향).');
    }
    var sec3='<h4>주목할 점</h4>'+(ins.length?('<ul class="an-ins"><li>'+ins.join('</li><li>')+'</li></ul>'):'<div style="font-size:12.5px;color:#94a3b8">특이사항 없음</div>');

    el.innerHTML='<div class="an-card"><div class="an-hd">📊 '+(_ipYm||'').replace('-','년 ')+'월 비가식부·생산성 분석</div>'
      +'<div class="an-sec">'+sec1+'</div>'
      +(sec2?('<div class="an-sec">'+sec2+'</div>'):'')
      +'<div class="an-sec">'+sec3+'</div></div>';
  }

  /* ===== 필터 칩 ===== */
  function _renderFilter(){
    var el=document.getElementById('ipFilter'); if(!el) return;
    var html='<span class="flb">원육별</span>';
    html+='<span class="chip'+(_ipType===null?' on':'')+'" onclick="ipSetType(null)">전체</span>';
    _ipTypes.forEach(function(t){
      html+='<span class="chip'+(_ipType===t?' on':'')+'" onclick="ipSetType(\''+_esc(t)+'\')">'+_esc(t)+'</span>';
    });
    el.innerHTML=html;
  }

  /* ===== 표 ===== */
  function _prodKg(num, den){ return den>0 ? r2(num/den).toFixed(1) : '-'; }
  function _prodEa(num, den){ return den>0 ? r2(num/den).toFixed(2) : '-'; }
  function _wasteCell(kg, base){
    if(!(kg>0)) return ['-','-'];
    return [kg.toFixed(2), base>0 ? (kg/base*100).toFixed(1)+'%' : '-'];
  }

  function _renderTable(){
    var tbl=document.getElementById('ipTbl'); if(!tbl) return;
    var rows=_ipType===null ? _ipRows : _ipRows.filter(function(r){return r.type===_ipType;});
    rows=rows.slice().sort(function(a,b){ if(a.date!==b.date) return a.date<b.date?-1:1; return b.rmKg-a.rmKg; });

    var st=document.getElementById('ipStatus');
    var days=new Set(rows.map(function(r){return r.date;})).size;
    if(st){
      st.style.color=''; st.style.background='';
      st.textContent=(_ipType?'['+_ipType+'] ':'')+days+'일 · '+rows.length+'행'+(_ipPendingCnt?' (진행중 '+_ipPendingCnt+'일 제외)':'')+' · 일별요약 기준';
    }

    var head=''
      + '<thead><tr>'
      + '<th>생산일자</th><th>원육 종류</th><th>제품명</th><th>원육 무게<br>(KG)</th>'
      + '<th class="g-ined">전처리<br>비가식부(KG)</th><th class="g-ined">전처리<br>비가식부(%)</th>'
      + '<th class="g-ined">파쇄<br>비가식부(KG)</th><th class="g-ined">파쇄<br>비가식부(%)</th>'
      + '<th class="g-prod">생산성 전처리<br>(kg/인시)</th><th class="g-prod">생산성 자숙<br>(kg/인시)</th>'
      + '<th class="g-prod">생산성 파쇄<br>(kg/인시)</th><th class="g-prod">생산성 포장<br>(EA/인시)</th>'
      + '</tr></thead>';

    var _prevDate='';
    var body=rows.map(function(x){
      var ppW=_wasteCell(x.ppWaste, x.rmKg);
      var shW=_wasteCell(x.shWaste, x.ckKg);
      var showDate = x.date!==_prevDate; _prevDate=x.date;
      return '<tr>'
        + '<td class="dt">'+(showDate?x.date.slice(5):'')+'</td>'
        + '<td class="ty">'+_esc(x.type)+'</td>'
        + '<td class="pd">'+(x.product?_esc(x.product):'-')+'</td>'
        + '<td>'+(x.rmKg>0?x.rmKg.toLocaleString():'-')+'</td>'
        + '<td class="c-ined ip-red">'+ppW[0]+'</td>'
        + '<td class="c-ined ip-red">'+ppW[1]+'</td>'
        + '<td class="c-ined ip-red">'+shW[0]+'</td>'
        + '<td class="c-ined ip-red">'+shW[1]+'</td>'
        + '<td class="c-prod">'+_prodKg(x.rmKg, x.ppMH)+'</td>'
        + '<td class="c-prod">'+_prodKg(x.ppKg, x.ckMH)+'</td>'
        + '<td class="c-prod">'+_prodKg(x.shKg, x.shMH)+'</td>'
        + '<td class="c-prod">'+_prodEa(x.ea,   x.pkMH)+'</td>'
        + '</tr>';
    }).join('');

    var S=_agg(rows);
    var n=days||1;
    function totRow(cls, label, divisor){
      var sppW=_wasteCell(S.ppWaste, S.rmKg);
      var sshW=_wasteCell(S.shWaste, S.ckKg);
      var rm = divisor===1 ? S.rmKg : r2(S.rmKg/divisor);
      var pw = divisor===1 ? S.ppWaste : r2(S.ppWaste/divisor);
      var sw = divisor===1 ? S.shWaste : r2(S.shWaste/divisor);
      return '<tr class="'+cls+'">'
        + '<td>'+label+'</td>'
        + '<td>'+(_ipType?_esc(_ipType):'전체')+'</td>'
        + '<td>-</td>'
        + '<td>'+(rm>0?rm.toLocaleString():'-')+'</td>'
        + '<td class="ip-red">'+(pw>0?pw.toFixed(2):'-')+'</td>'
        + '<td class="ip-red">'+sppW[1]+'</td>'
        + '<td class="ip-red">'+(sw>0?sw.toFixed(2):'-')+'</td>'
        + '<td class="ip-red">'+sshW[1]+'</td>'
        + '<td>'+_prodKg(S.rmKg, S.ppMH)+'</td>'
        + '<td>'+_prodKg(S.ppKg, S.ckMH)+'</td>'
        + '<td>'+_prodKg(S.shKg, S.shMH)+'</td>'
        + '<td>'+_prodEa(S.ea,   S.pkMH)+'</td>'
        + '</tr>';
    }
    var foot = rows.length ? ('<tbody>'+body+totRow('sum','합 계',1)+totRow('avg','일 평균',n)+'</tbody>')
                           : '<tbody><tr><td colspan="12" style="padding:1.5rem;color:#94a3b8">데이터 없음</td></tr></tbody>';
    tbl.innerHTML = head + foot;
  }

  /* ===== 진입점 / 네비 / 필터 ===== */
  function renderInedibleProd(){
    if(!_ipYm) _ipYm=_ymToday();
    _renderShell();
    _reload();
  }
  function ipPrevMonth(){ _ipYm=_prevYm(_ipYm||_ymToday()); _renderShell(); _reload(); }
  function ipNextMonth(){ _ipYm=_nextYm(_ipYm||_ymToday()); _renderShell(); _reload(); }
  function ipThisMonth(){ _ipYm=_ymToday(); _renderShell(); _reload(); }
  function ipPickMonth(v){ if(!v) return; _ipYm=v; _renderShell(); _reload(); }
  function ipSetType(t){ _ipType = (t===null||t==='null') ? null : t; _renderFilter(); _renderTable(); }
  function ipToggleAnalysis(){ _ipShowAnalysis=!_ipShowAnalysis; _renderShell(); _renderAnalysis(); _renderFilter(); _renderTable(); }

  window.renderInedibleProd = renderInedibleProd;
  window.ipPrevMonth = ipPrevMonth;
  window.ipNextMonth = ipNextMonth;
  window.ipThisMonth = ipThisMonth;
  window.ipPickMonth = ipPickMonth;
  window.ipSetType   = ipSetType;
  window.ipToggleAnalysis = ipToggleAnalysis;
})();
