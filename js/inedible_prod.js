/* ===========================================================
 * inedible_prod.js v1
 * 실적관리 > 비가식부·생산성 (월별)
 * - analysis.js 일별요약(공정별 현황)과 동일 정의로 날짜별 집계
 *   ▸ 원육투입 = matchedTh(그날 end된 방혈 totalKg)
 *   ▸ 비가식부: 전처리 Σwaste(÷원육), 파쇄 Σwaste(÷자숙산출)
 *   ▸ 생산성: 전처리=원육÷인시, 자숙=전처리산출÷인시,
 *            파쇄=파쇄산출÷인시, 포장=EA÷인시  (mh=sumMH=Σ dur×workers)
 *   ▸ 테스트 체인(내포장 testRun→파쇄→자숙→전처리→방혈) 제외
 *   ▸ 진행중(packing_pending) 날짜 제외 — 부분데이터 왜곡 방지
 * - 전역 헬퍼(r2/dur/sumMH/fbGetRange) 사용 (common.js)
 * =========================================================== */
(function(){
  'use strict';

  var _ipYm = null;
  var _ipBusy = false;

  /* ===== 유틸 ===== */
  function _ymToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _today(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function _prevYm(ym){ var p=ym.split('-').map(Number); var d=new Date(p[0],p[1]-2,1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _nextYm(ym){ var p=ym.split('-').map(Number); var d=new Date(p[0],p[1],1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _sl10(v){ return String(v||'').slice(0,10); }
  function _normW(w){ return String(w||'').replace(/[^0-9]/g,'') || String(w||'').trim(); }
  function _addDays(d,n){ var p=d.split('-').map(Number); var dt=new Date(p[0],p[1]-1,p[2]+n); return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
  function _num(v){ var n=parseFloat(v); return isFinite(n)?n:0; }

  /* ===== 하루치 집계 (analysis.js renderDailyFromLocal_ 정의 그대로) ===== */
  function _computeDay(d, DATA){
    var PP=DATA.pp, TH=DATA.th, SH=DATA.sh, CK=DATA.ck, PK=DATA.pk, OP=DATA.op;
    var prevD=_addDays(d,-1);
    var ppAll=PP.filter(function(r){return _sl10(r.date)===d;});
    var ckAll=CK.filter(function(r){return _sl10(r.date)===d;});
    var shAll=SH.filter(function(r){return _sl10(r.date)===d;});
    var pkAll=PK.filter(function(r){return _sl10(r.date)===d;});
    var opAll=OP.filter(function(r){return _sl10(r.date)===d;});

    // 테스트 체인 역추적: 내포장 testRun → 파쇄 → 자숙 → 전처리 → 방혈
    var _testOpProds=new Set(opAll.filter(function(r){return r.testRun||r.isTest;}).map(function(r){return String(r.product||'');}));
    var _testPk=pkAll.filter(function(r){return r.testRun||r.isTest||_testOpProds.has(String(r.product||''));});
    var _testPkW=new Set(_testPk.flatMap(function(r){return (r.wagon||'').split(',').map(function(w){return w.trim();}).filter(Boolean);}));
    var _testPkC=new Set(_testPk.flatMap(function(r){return (r.cart||'').split(',').map(function(w){return w.trim();}).filter(Boolean);}));
    var _testSh=shAll.filter(function(r){
      var wo=(r.wagonOut||'').split(',').map(function(w){return w.trim();}).some(function(w){return _testPkW.has(w);});
      var co=(r.cartOut||'').split(',').map(function(w){return w.trim();}).some(function(w){return _testPkC.has(w);});
      return wo||co;
    });
    var _testShW=new Set(_testSh.flatMap(function(r){return (r.wagonIn||'').split(',').map(function(w){return w.trim();}).filter(Boolean);}));
    var _testCk=ckAll.filter(function(r){return (r.wagonOut||'').split(',').map(function(w){return w.trim();}).some(function(w){return _testShW.has(w);});});
    var _testCkC=new Set(_testCk.flatMap(function(r){return (r.cage||'').split(',').map(function(c){return c.trim();}).filter(Boolean);}));
    var _testPp=ppAll.filter(function(r){return (r.cage||'').split(',').map(function(c){return c.trim();}).some(function(c){return _testCkC.has(c);});});
    var _testPpW=new Set(_testPp.flatMap(function(r){return (r.wagons||'').split(',').map(function(w){return w.trim();}).filter(Boolean);}));
    var _tPkId=new Set(_testPk.map(function(r){return r.fbId||r.id;}));
    var _tShId=new Set(_testSh.map(function(r){return r.fbId||r.id;}));
    var _tCkId=new Set(_testCk.map(function(r){return r.fbId||r.id;}));
    var _tPpId=new Set(_testPp.map(function(r){return r.fbId||r.id;}));
    var pk=pkAll.filter(function(r){return !_tPkId.has(r.fbId||r.id);});
    var sh=shAll.filter(function(r){return !_tShId.has(r.fbId||r.id);});
    var ck=ckAll.filter(function(r){return !_tCkId.has(r.fbId||r.id);});
    var pp=ppAll.filter(function(r){return !_tPpId.has(r.fbId||r.id);});

    // 원육투입 = 그날 end된 방혈 totalKg (matchedTh)
    var _ppWagons=[...new Set(pp.flatMap(function(r){return (r.wagons||'').split(',').map(function(w){return _normW(w);}).filter(Boolean);}))];
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
    var rmKg=r2(matchedTh.reduce(function(s,r){return s+_num(r.totalKg);},0));

    var ppKg=r2(pp.reduce(function(s,r){return s+_num(r.kg);},0));   // 전처리 산출 (=자숙 투입)
    var ckKg=r2(ck.reduce(function(s,r){return s+_num(r.kg);},0));   // 자숙 산출 (=파쇄 투입)
    var shKg=r2(sh.reduce(function(s,r){return s+_num(r.kg);},0));   // 파쇄 산출
    var ea  =pk.reduce(function(s,r){return s+_num(r.ea);},0);
    var ppWaste=r2(pp.reduce(function(s,r){return s+_num(r.waste);},0));
    var shWaste=r2(sh.reduce(function(s,r){return s+_num(r.waste);},0));
    var ppMH=sumMH(pp), ckMH=sumMH(ck), shMH=sumMH(sh), pkMH=sumMH(pk);

    return { date:d, rmKg:rmKg, ppKg:ppKg, ckKg:ckKg, shKg:shKg, ea:ea,
             ppWaste:ppWaste, shWaste:shWaste, ppMH:ppMH, ckMH:ckMH, shMH:shMH, pkMH:pkMH };
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
      + '#ipStatus{padding:10px 14px;color:#1b8a3a;font-size:13px;font-weight:500;background:#f0fdf4;border-bottom:1px solid #d1fae5}'
      + '#ipTblWrap{overflow:auto;background:#fff;padding-bottom:4px;max-height:calc(100vh - 280px);border:1px solid #e5e7eb;border-radius:6px}'
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
      + '.ip-red{color:#dc2626}'
      + '</style>'
      + '<div id="ipToolbar">'
      +   '<button class="btn" onclick="ipPrevMonth()">◀</button>'
      +   '<span class="lbl">'+y+'년 '+mIdx+'월</span>'
      +   '<button class="btn" onclick="ipNextMonth()">▶</button>'
      +   '<button class="btn" onclick="ipThisMonth()">이번달</button>'
      +   '<input type="month" value="'+ym+'" onchange="ipPickMonth(this.value)">'
      + '</div>'
      + '<div id="ipStatus">데이터 불러오는 중…</div>'
      + '<div id="ipTblWrap"><table id="ipTbl"></table></div>';
  }

  /* ===== 로드 + 렌더 ===== */
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
        var thFrom=_addDays(from,-1);     // 첫날 end매칭용 전날
        var thTo=_addDays(effTo,1);       // 마지막날 재입력 보정용 다음날

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

        // 진행중 날짜 제외
        var pendingDates=new Set();
        (R[6]||[]).forEach(function(r){ var d=_sl10(r.date); if(d) pendingDates.add(d); });

        // 데이터 있는 날짜 수집
        var dateSet=new Set();
        ['pp','sh','ck','pk'].forEach(function(key){
          DATA[key].forEach(function(r){ var d=_sl10(r.date); if(d>=from&&d<=effTo) dateSet.add(d); });
        });
        var dates=[...dateSet].filter(function(d){return !pendingDates.has(d);}).sort();

        var rows=dates.map(function(d){ return _computeDay(d, DATA); })
                      .filter(function(x){ return x.rmKg>0||x.ppKg>0||x.ckKg>0||x.shKg>0||x.ea>0; });

        _renderTable(rows, pendingDates.size);
      } catch(e){
        console.error('[inedible] reload error', e);
        var st=document.getElementById('ipStatus');
        if(st){ st.textContent='로드 오류: '+(e.message||e); st.style.color='#c0392b'; st.style.background='#fdecea'; }
      } finally {
        _ipBusy=false;
      }
    })();
  }

  /* ===== 표 렌더 ===== */
  function _prodKg(num, den){ return den>0 ? r2(num/den).toFixed(1) : '-'; }   // kg/인시
  function _prodEa(num, den){ return den>0 ? r2(num/den).toFixed(2) : '-'; }   // EA/인시
  function _wasteCell(kg, base){
    if(!(kg>0)) return ['-','-'];
    var pct = base>0 ? (kg/base*100).toFixed(1)+'%' : '-';
    return [kg.toFixed(2), pct];
  }

  function _renderTable(rows, pendingCnt){
    var tbl=document.getElementById('ipTbl'); if(!tbl) return;
    var st=document.getElementById('ipStatus');
    if(st){
      st.style.color=''; st.style.background='';
      st.textContent='총 '+rows.length+'일'+(pendingCnt?' (진행중 '+pendingCnt+'일 제외)':'')+' · 일별요약 기준';
    }

    var head=''
      + '<thead><tr>'
      + '<th>생산일자</th>'
      + '<th class="g-ined">전처리<br>비가식부(KG)</th>'
      + '<th class="g-ined">전처리<br>비가식부(%)</th>'
      + '<th class="g-ined">파쇄<br>비가식부(KG)</th>'
      + '<th class="g-ined">파쇄<br>비가식부(%)</th>'
      + '<th class="g-prod">생산성 전처리<br>(kg/인시)</th>'
      + '<th class="g-prod">생산성 자숙<br>(kg/인시)</th>'
      + '<th class="g-prod">생산성 파쇄<br>(kg/인시)</th>'
      + '<th class="g-prod">생산성 포장<br>(EA/인시)</th>'
      + '</tr></thead>';

    var body=rows.map(function(x){
      var ppW=_wasteCell(x.ppWaste, x.rmKg);
      var shW=_wasteCell(x.shWaste, x.ckKg);
      var mmdd=x.date.slice(5);
      return '<tr>'
        + '<td class="dt">'+mmdd+'</td>'
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

    // 합계/평균 (비율은 가중 = Σ분자/Σ분모)
    var S={rmKg:0,ppWaste:0,shWaste:0,ppKg:0,ckKg:0,shKg:0,ea:0,ppMH:0,ckMH:0,shMH:0,pkMH:0};
    rows.forEach(function(x){ for(var k in S) S[k]+=x[k]||0; });
    var n=rows.length||1;
    function totRow(cls, label, divisor){
      var sppW=_wasteCell(S.ppWaste, S.rmKg);
      var sshW=_wasteCell(S.shWaste, S.ckKg);
      var pw = divisor===1 ? S.ppWaste : r2(S.ppWaste/divisor);
      var sw = divisor===1 ? S.shWaste : r2(S.shWaste/divisor);
      return '<tr class="'+cls+'">'
        + '<td>'+label+'</td>'
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
                           : '<tbody><tr><td colspan="9" style="padding:1.5rem;color:#94a3b8">데이터 없음</td></tr></tbody>';
    tbl.innerHTML = head + foot;
  }

  /* ===== 진입점 / 네비 ===== */
  function renderInedibleProd(){
    if(!_ipYm) _ipYm=_ymToday();
    _renderShell();
    _reload();
  }
  function ipPrevMonth(){ _ipYm=_prevYm(_ipYm||_ymToday()); _renderShell(); _reload(); }
  function ipNextMonth(){ _ipYm=_nextYm(_ipYm||_ymToday()); _renderShell(); _reload(); }
  function ipThisMonth(){ _ipYm=_ymToday(); _renderShell(); _reload(); }
  function ipPickMonth(v){ if(!v) return; _ipYm=v; _renderShell(); _reload(); }

  window.renderInedibleProd = renderInedibleProd;
  window.ipPrevMonth = ipPrevMonth;
  window.ipNextMonth = ipNextMonth;
  window.ipThisMonth = ipThisMonth;
  window.ipPickMonth = ipPickMonth;
})();
