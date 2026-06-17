/* ===========================================================
 * inedible_prod.js v2
 * 실적관리 > 비가식부·생산성 (월별, 원육 부위별)
 * - analysis.js 일별요약(공정별 현황)과 동일 정의로 (날짜×부위) 집계
 *   ▸ 원육 무게 = matchedTh(그날 end된 방혈 totalKg) 부위별
 *   ▸ 비가식부: 전처리 Σwaste(÷원육), 파쇄 Σwaste(÷자숙산출)
 *   ▸ 생산성: 전처리=원육÷인시, 자숙=전처리산출÷인시,
 *            파쇄=파쇄산출÷인시, 포장=EA÷인시  (mh=Σ dur×workers)
 *   ▸ 부위 그룹: 전처리/자숙 type 필드, 파쇄 wagonIn→자숙 type,
 *               포장 wagon/cart→파쇄→자숙 type 추적(getPkType)
 *   ▸ 테스트 체인·진행중(packing_pending) 날짜 제외
 *   ▸ 원육별 필터 지원
 * - 전역 헬퍼(r2/dur/fbGetRange) 사용 (common.js)
 * =========================================================== */
(function(){
  'use strict';

  var _ipYm = null;
  var _ipBusy = false;
  var _ipType = null;     // 필터: null=전체, 아니면 부위명
  var _ipRows = [];       // 현재 월 (날짜×부위) 행 캐시
  var _ipTypes = [];      // 현재 월 부위 목록 (rmKg 내림차순)

  /* ===== 유틸 ===== */
  function _ymToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _today(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function _prevYm(ym){ var p=ym.split('-').map(Number); var d=new Date(p[0],p[1]-2,1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _nextYm(ym){ var p=ym.split('-').map(Number); var d=new Date(p[0],p[1],1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
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

  /* ===== 하루치 (날짜×부위) 집계 — analysis.js renderDailyFromLocal_ 정의 ===== */
  function _computeDayRows(d, DATA){
    var PP=DATA.pp, TH=DATA.th, SH=DATA.sh, CK=DATA.ck, PK=DATA.pk, OP=DATA.op;
    var prevD=_addDays(d,-1);
    var ppAll=PP.filter(function(r){return _sl10(r.date)===d;});
    var ckAll=CK.filter(function(r){return _sl10(r.date)===d;});
    var shAll=SH.filter(function(r){return _sl10(r.date)===d;});
    var pkAll=PK.filter(function(r){return _sl10(r.date)===d;});
    var opAll=OP.filter(function(r){return _sl10(r.date)===d;});

    // 테스트 체인 역추적
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

    // 원육투입 matchedTh
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

    // 부위별 원육
    var rmByType={};
    matchedTh.forEach(function(r){ var ts=_splitT(r.type); if(!ts.length) ts=['미분류']; ts.forEach(function(t){ rmByType[t]=(rmByType[t]||0)+_num(r.totalKg); }); });

    // 전처리/자숙 그룹 (type 필드)
    function _grp(recs, kf){ var m={}; recs.forEach(function(r){ var ts=_splitT(r.type||'미분류'); ts.forEach(function(t){ if(!m[t]) m[t]={kg:0,waste:0,mh:0}; m[t].kg+=_num(r[kf]); m[t].waste+=_num(r.waste); m[t].mh+=dur(r.start,r.end)*_num(r.workers); }); }); return m; }
    var ppG=_grp(pp,'kg'), ckG=_grp(ck,'kg');

    // 파쇄 그룹: type 또는 wagonIn→자숙 type
    var shG={};
    sh.forEach(function(r){
      var t=(r.type||'').trim();
      if(!t){ var wIns=_splitT(r.wagonIn); for(var i=0;i<wIns.length;i++){ var c=ck.find(function(c2){return _splitT(c2.wagonOut).includes(wIns[i]);}); if(c&&c.type){ t=_splitT(c.type)[0]; break; } } }
      if(!t) t='미분류';
      if(!shG[t]) shG[t]={kg:0,waste:0,mh:0};
      shG[t].kg+=_num(r.kg); shG[t].waste+=_num(r.waste); shG[t].mh+=dur(r.start,r.end)*_num(r.workers);
    });

    // 포장 그룹: getPkType (wagon/cart→파쇄→자숙 type)
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
    pk.forEach(function(r){ var t=_pkType(r); if(!t) return; if(!pkG[t]) pkG[t]={ea:0,mh:0}; pkG[t].ea+=_num(r.ea); pkG[t].mh+=dur(r.start,r.end)*_num(r.workers); });

    var hasPp=Object.keys(ppG).length>0;
    var types=[...new Set([].concat(Object.keys(ppG),Object.keys(ckG),Object.keys(shG),Object.keys(pkG)))]
      .filter(function(t){ return t && (t!=='미분류' || !hasPp); });

    return types.map(function(t){
      return { date:d, type:t,
        rmKg:r2(rmByType[t]||0),
        ppKg:r2((ppG[t]||{}).kg||0), ppWaste:r2((ppG[t]||{}).waste||0), ppMH:r2((ppG[t]||{}).mh||0),
        ckKg:r2((ckG[t]||{}).kg||0), ckMH:r2((ckG[t]||{}).mh||0),
        shKg:r2((shG[t]||{}).kg||0), shWaste:r2((shG[t]||{}).waste||0), shMH:r2((shG[t]||{}).mh||0),
        ea:(pkG[t]||{}).ea||0, pkMH:r2((pkG[t]||{}).mh||0) };
    }).filter(function(x){ return x.rmKg||x.ppKg||x.ckKg||x.shKg||x.ea; });
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
      + '#ipToolbar .lbl{font-weight:700;color:#1e293b;margin:0 8px;font-size:15px}'
      + '#ipToolbar input[type=month]{padding:6px 8px;border:1px solid #bbb;border-radius:5px;font-size:13px}'
      + '#ipFilter{padding:8px 14px;background:#fff;border-bottom:1px solid #eee;display:flex;flex-wrap:wrap;gap:6px;align-items:center}'
      + '#ipFilter .flb{font-size:12px;color:#64748b;font-weight:600;margin-right:4px}'
      + '#ipFilter .chip{padding:5px 12px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;cursor:pointer;font-size:12.5px;color:#334155;user-select:none}'
      + '#ipFilter .chip:hover{background:#f1f5f9}'
      + '#ipFilter .chip.on{background:#0e7490;border-color:#0e7490;color:#fff;font-weight:600}'
      + '#ipStatus{padding:10px 14px;color:#1b8a3a;font-size:13px;font-weight:500;background:#f0fdf4;border-bottom:1px solid #d1fae5}'
      + '#ipTblWrap{overflow:auto;background:#fff;padding-bottom:4px;max-height:calc(100vh - 320px);border:1px solid #e5e7eb;border-radius:6px}'
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
      + '.ip-red{color:#dc2626}'
      + '</style>'
      + '<div id="ipToolbar">'
      +   '<button class="btn" onclick="ipPrevMonth()">◀</button>'
      +   '<span class="lbl">'+y+'년 '+mIdx+'월</span>'
      +   '<button class="btn" onclick="ipNextMonth()">▶</button>'
      +   '<button class="btn" onclick="ipThisMonth()">이번달</button>'
      +   '<input type="month" value="'+ym+'" onchange="ipPickMonth(this.value)">'
      + '</div>'
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
        var from=ym+'-01';
        var lastDay=new Date(parseInt(ym.slice(0,4),10), parseInt(ym.slice(5),10), 0).getDate();
        var to=ym+'-'+String(lastDay).padStart(2,'0');
        var today=_today();
        var effTo=to>today?today:to;
        var thFrom=_addDays(from,-1);
        var thTo=_addDays(effTo,1);

        var R=await Promise.all([
          fbGetRange('preprocess',   from,   effTo),
          fbGetRange('thawing',      thFrom, thTo),
          fbGetRange('shredding',    from,   effTo),
          fbGetRange('cooking',      from,   effTo),
          fbGetRange('packing',      from,   effTo),
          fbGetRange('outerpacking', from,   effTo),
          fbGetRange('packing_pending', from, effTo).catch(function(){return [];})
        ]);
        var DATA={ pp:R[0], th:R[1], sh:R[2], ck:R[3], pk:R[4], op:R[5] };

        var pendingDates=new Set();
        (R[6]||[]).forEach(function(r){ var d=_sl10(r.date); if(d) pendingDates.add(d); });

        var dateSet=new Set();
        ['pp','sh','ck','pk'].forEach(function(key){
          DATA[key].forEach(function(r){ var d=_sl10(r.date); if(d>=from&&d<=effTo) dateSet.add(d); });
        });
        var dates=[...dateSet].filter(function(d){return !pendingDates.has(d);}).sort();

        var rows=[];
        dates.forEach(function(d){ _computeDayRows(d, DATA).forEach(function(r){ rows.push(r); }); });

        // 부위 목록 (월 전체 rmKg 내림차순)
        var byT={};
        rows.forEach(function(r){ byT[r.type]=(byT[r.type]||0)+r.rmKg; });
        var typeList=Object.keys(byT).sort(function(a,b){ return byT[b]-byT[a]; });

        _ipRows=rows;
        _ipTypes=typeList;
        if(_ipType && typeList.indexOf(_ipType)<0) _ipType=null;  // 필터 부위가 이 달에 없으면 전체
        _ipPendingCnt=pendingDates.size;
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
  var _ipPendingCnt=0;

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
    // 정렬: 날짜 → 부위 rmKg 내림차순
    rows=rows.slice().sort(function(a,b){ if(a.date!==b.date) return a.date<b.date?-1:1; return b.rmKg-a.rmKg; });

    var st=document.getElementById('ipStatus');
    var days=new Set(rows.map(function(r){return r.date;})).size;
    if(st){
      st.style.color=''; st.style.background='';
      st.textContent=(_ipType?'['+_ipType+'] ':'')+days+'일 · '+rows.length+'행'+(_ipPendingCnt?' (진행중 '+_ipPendingCnt+'일 제외)':'')+' · 일별요약 기준';
    }

    var head=''
      + '<thead><tr>'
      + '<th>생산일자</th>'
      + '<th>원육 종류</th>'
      + '<th>원육 무게<br>(KG)</th>'
      + '<th class="g-ined">전처리<br>비가식부(KG)</th>'
      + '<th class="g-ined">전처리<br>비가식부(%)</th>'
      + '<th class="g-ined">파쇄<br>비가식부(KG)</th>'
      + '<th class="g-ined">파쇄<br>비가식부(%)</th>'
      + '<th class="g-prod">생산성 전처리<br>(kg/인시)</th>'
      + '<th class="g-prod">생산성 자숙<br>(kg/인시)</th>'
      + '<th class="g-prod">생산성 파쇄<br>(kg/인시)</th>'
      + '<th class="g-prod">생산성 포장<br>(EA/인시)</th>'
      + '</tr></thead>';

    var _prevDate='';
    var body=rows.map(function(x){
      var ppW=_wasteCell(x.ppWaste, x.rmKg);
      var shW=_wasteCell(x.shWaste, x.ckKg);
      var showDate = x.date!==_prevDate; _prevDate=x.date;
      return '<tr>'
        + '<td class="dt">'+(showDate?x.date.slice(5):'')+'</td>'
        + '<td class="ty">'+_esc(x.type)+'</td>'
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

    var S={rmKg:0,ppWaste:0,shWaste:0,ppKg:0,ckKg:0,shKg:0,ea:0,ppMH:0,ckMH:0,shMH:0,pkMH:0};
    rows.forEach(function(x){ for(var k in S) S[k]+=x[k]||0; });
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
                           : '<tbody><tr><td colspan="11" style="padding:1.5rem;color:#94a3b8">데이터 없음</td></tr></tbody>';
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

  window.renderInedibleProd = renderInedibleProd;
  window.ipPrevMonth = ipPrevMonth;
  window.ipNextMonth = ipNextMonth;
  window.ipThisMonth = ipThisMonth;
  window.ipPickMonth = ipPickMonth;
  window.ipSetType   = ipSetType;
})();
