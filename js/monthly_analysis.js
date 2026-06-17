/* ===========================================================
 * monthly_analysis.js
 * 월단위생산량 > 생산 분석 카드
 *  - KPI 대시보드(당월 + 동기간 대비 변동)
 *  - 월별 추이 차트 2종: 원육투입량(bar) / 누적 수율(line)  [Chart.js]
 *  - 전월 대비(동기간 N일치) 표
 *  - 자동 인사이트(계산값 기반)
 * 데이터: 추이는 window.ipMonthSummary(검증된 비가식부 월집계) 재사용
 *         당월/전월 수치는 monthly_production.js가 넘겨주는 ctx 사용
 * =========================================================== */
(function(){
  'use strict';

  var _charts = {};
  var _trendCache = {};   // ym -> [summaries]

  function _today(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function _prevYm(ym){ var p=ym.split('-').map(Number); var d=new Date(p[0],p[1]-2,1); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
  function _monthBounds(ym){ var from=ym+'-01'; var last=new Date(parseInt(ym.slice(0,4),10),parseInt(ym.slice(5),10),0).getDate(); return {from:from, to:ym+'-'+String(last).padStart(2,'0')}; }
  function _addDays(d,n){ var p=d.split('-').map(Number); var dt=new Date(p[0],p[1]-1,p[2]+n); return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
  function nf(v,dec){ if(v==null||!isFinite(v)) return '-'; return v.toLocaleString(undefined,{minimumFractionDigits:dec||0,maximumFractionDigits:dec||0}); }
  function _col(d){ return d>0?'#15803d':(d<0?'#b91c1c':'#475569'); }   // 증가=녹색, 감소=빨강 (값이 클수록 좋은 지표용)
  function _arr(d){ return d>0?'▲':(d<0?'▼':''); }
  function _mIdx(ym){ return parseInt(ym.slice(5),10); }

  /* ===== KPI 배지 ===== */
  function _badge(cur, prev, unit, isPct){
    if(cur==null||prev==null||!isFinite(prev)||prev===0) return '';
    var d=cur-prev;
    var txt = isPct ? (_arr(d)+' '+nf(Math.abs(d),1)+'%p') : (_arr(d)+' '+nf(Math.abs(d/prev*100),1)+'%');
    return '<span style="color:'+_col(d)+';font-weight:600;font-size:11.5px">'+txt+' <span style="color:#94a3b8;font-weight:400">vs 동기간</span></span>';
  }

  /* ===== 전월대비 표(동기간) 행 헬퍼 ===== */
  function _rowAbs(S, P, F, label, key, unit, dec){
    var t=S[key]||0, s=P[key]||0, f=F[key]||0, d=t-s, dp=s?d/s*100:0, u=unit?' '+unit:'';
    return '<tr><td class="l">'+label+'</td><td>'+nf(t,dec)+u+'</td><td>'+nf(s,dec)+u+'</td><td>'+nf(f,dec)+u+'</td>'
      +'<td style="color:'+_col(d)+';font-weight:600">'+_arr(d)+' '+nf(Math.abs(d),dec)+u+'</td>'
      +'<td style="color:'+_col(dp)+';font-weight:600">'+_arr(dp)+' '+nf(Math.abs(dp),1)+'%</td></tr>';
  }
  function _rowYield(S, P, F, label, key){
    var t=S.rmKg?S[key]/S.rmKg*100:0, s=P.rmKg?P[key]/P.rmKg*100:0, f=F.rmKg?F[key]/F.rmKg*100:0;
    var dp=t-s, dpc=s?dp/s*100:0;
    return '<tr><td class="l">'+label+'</td><td>'+nf(t,1)+'%</td><td>'+nf(s,1)+'%</td><td>'+nf(f,1)+'%</td>'
      +'<td style="color:'+_col(dp)+';font-weight:600">'+_arr(dp)+' '+nf(Math.abs(dp),1)+'%p</td>'
      +'<td style="color:'+_col(dpc)+';font-weight:600">'+_arr(dpc)+' '+nf(Math.abs(dpc),1)+'%</td></tr>';
  }

  /* ===== 인사이트 ===== */
  function _insights(ctx){
    var S=ctx.sum, P=ctx.prevSumSame;
    var ins=[];
    var avgD=ctx.thisAvg-ctx.sameAvg, avgDp=ctx.sameAvg?avgD/ctx.sameAvg*100:0;
    if(Math.abs(avgDp)>=5) ins.push('일평균 원육사용량이 동기간 대비 '+(avgD>0?'<span style="color:#15803d;font-weight:600">▲'+nf(Math.abs(avgDp),1)+'%</span>':'<span style="color:#b91c1c;font-weight:600">▼'+nf(Math.abs(avgDp),1)+'%</span>')+' ('+nf(ctx.sameAvg,0)+'→'+nf(ctx.thisAvg,0)+'kg)로 생산 규모가 '+(avgD>0?'확대':'축소')+'됐습니다.');
    var eaD=P.pkEa?(S.pkEa-P.pkEa)/P.pkEa*100:0, meatD=P.meatKg?(S.meatKg-P.meatKg)/P.meatKg*100:0;
    if(S.pkEa&&P.pkEa&&eaD<-5&&meatD>5) ins.push('월 누적 EA(외포장)는 동기간 대비 <span style="color:#b91c1c;font-weight:600">▼'+nf(Math.abs(eaD),1)+'%</span> 줄었지만 완제품 고기중량은 <span style="color:#15803d;font-weight:600">▲'+nf(meatD,1)+'%</span> 늘었습니다 — FC 3KG처럼 대용량 제품 비중이 높아 EA(개수)는 단순 비교가 어렵습니다. 실제 생산량은 <b>고기중량</b>으로 보시는 게 정확합니다.');
    [['전처리','ppKg'],['자숙','ckKg'],['파쇄','shKg'],['최종','meatKg']].forEach(function(p){
      var t=S.rmKg?S[p[1]]/S.rmKg*100:0, s=P.rmKg?P[p[1]]/P.rmKg*100:0, d=t-s;
      if(s>0&&Math.abs(d)>=1) ins.push('<b>'+p[0]+' 수율</b>이 동기간 대비 '+(d>0?'<span style="color:#15803d;font-weight:600">▲'+nf(d,1)+'%p 상승</span>':'<span style="color:#b91c1c;font-weight:600">▼'+nf(Math.abs(d),1)+'%p 하락</span>')+' ('+nf(s,1)+'% → '+nf(t,1)+'%).');
    });
    return ins.length ? ('<ul class="mpan-ins"><li>'+ins.join('</li><li>')+'</li></ul>') : '<div style="font-size:12.5px;color:#94a3b8">특이사항 없음</div>';
  }

  /* ===== 진입점 ===== */
  function renderMonthlyAnalysis(cmp, ctx){
    if(!cmp) return;
    var S=ctx.sum, P=ctx.prevSumSame, F=ctx.prevSum;
    var ymThis=ctx.ymThis, ymPrev=ctx.ymPrev, ndays=ctx.ndays;
    var finalY  = S.rmKg? S.meatKg/S.rmKg*100 : 0;
    var finalYp = P.rmKg? P.meatKg/P.rmKg*100 : 0;

    cmp.innerHTML = ''
      + '<style>'
      + '.mpan-card{margin:14px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff}'
      + '.mpan-hd{background:#0f3a4d;color:#fff;padding:10px 14px;font-weight:700;font-size:14px}'
      + '.mpan-sec{padding:14px;border-bottom:1px solid #f0f0f0}.mpan-sec:last-child{border-bottom:none}'
      + '.mpan-sec h4{margin:0 0 10px;font-size:13px;color:#0f3a4d;font-weight:700}'
      + '.mpan-kpis{display:flex;flex-wrap:wrap;gap:12px}'
      + '.mpan-kpi{flex:1 1 170px;min-width:160px;border:1px solid #e2e8f0;border-radius:9px;padding:12px 14px;background:#f8fafc}'
      + '.mpan-kpi .k{font-size:12px;color:#64748b}.mpan-kpi .v{font-size:21px;font-weight:800;color:#0f172a;margin:4px 0 2px}'
      + '.mpan-charts{display:flex;flex-wrap:wrap;gap:16px}'
      + '.mpan-chartbox{flex:1 1 380px;min-width:320px;border:1px solid #e2e8f0;border-radius:9px;padding:10px 12px;background:#fff}'
      + '.mpan-chartbox .ct{font-size:12.5px;font-weight:700;color:#334155;margin-bottom:6px}'
      + '.mpan-chartbox .cw{position:relative;height:240px}'
      + '.mpan-tbl{border-collapse:collapse;font-size:12.5px;width:100%;max-width:940px}'
      + '.mpan-tbl th,.mpan-tbl td{border:1px solid #e2e8f0;padding:6px 10px;text-align:center}'
      + '.mpan-tbl th{background:#eef2f7;color:#1e293b;font-weight:600}.mpan-tbl td.l{text-align:left;font-weight:600}'
      + '.mpan-ins{margin:0;padding-left:18px;font-size:13px;line-height:1.9;color:#1f2937}.mpan-ins li{margin:2px 0}'
      + '.mpan-note{font-size:11.5px;color:#64748b;margin-top:8px;line-height:1.6}'
      + '.mpan-load{font-size:12.5px;color:#94a3b8;padding:30px 0;text-align:center}'
      + '</style>'
      + '<div class="mpan-card">'
      + '<div class="mpan-hd">📊 '+ymThis.replace('-','년 ')+'월 생산 분석</div>'
      // KPI
      + '<div class="mpan-sec"><h4>이번 달 요약 ('+ndays+'일 기준)</h4><div class="mpan-kpis">'
      +   '<div class="mpan-kpi"><div class="k">생산일수</div><div class="v">'+S.dayCount+'일</div></div>'
      +   '<div class="mpan-kpi"><div class="k">원육 투입량</div><div class="v">'+nf(S.rmKg,0)+'<span style="font-size:13px;font-weight:600"> kg</span></div>'+_badge(S.rmKg,P.rmKg)+'</div>'
      +   '<div class="mpan-kpi"><div class="k">완제품 고기중량</div><div class="v">'+nf(S.meatKg,0)+'<span style="font-size:13px;font-weight:600"> kg</span></div>'+_badge(S.meatKg,P.meatKg)+'</div>'
      +   '<div class="mpan-kpi"><div class="k">최종 수율</div><div class="v">'+nf(finalY,1)+'<span style="font-size:13px;font-weight:600">%</span></div>'+_badge(finalY,finalYp,'',true)+'</div>'
      +   '<div class="mpan-kpi"><div class="k">월 누적 EA(외포장)</div><div class="v">'+nf(S.pkEa,0)+'</div>'+_badge(S.pkEa,P.pkEa)+'</div>'
      + '</div></div>'
      // 차트
      + '<div class="mpan-sec"><h4>월별 추이</h4><div class="mpan-charts">'
      +   '<div class="mpan-chartbox"><div class="ct">원육 투입량 (kg)</div><div class="cw"><canvas id="mpanChartRm"></canvas></div></div>'
      +   '<div class="mpan-chartbox"><div class="ct">누적 수율 추이 (원육 대비, %)</div><div class="cw"><canvas id="mpanChartYield"></canvas></div></div>'
      + '</div><div class="mpan-note" id="mpanTrendNote">추이 데이터 불러오는 중…</div></div>'
      // 전월대비
      + '<div class="mpan-sec"><h4>전월 대비 — '+ymPrev.replace('-','년 ')+'월 동기간('+ndays+'일치) 비교</h4>'
      +   '<table class="mpan-tbl"><thead><tr><th>지표</th><th>'+ymThis.replace('-','년 ')+'월</th>'
      +     '<th>'+ymPrev.replace('-','년 ')+'월 동기간</th><th>'+ymPrev.replace('-','년 ')+'월 전체</th>'
      +     '<th>증감 (vs 동기간)</th><th>증감율</th></tr></thead><tbody>'
      +     '<tr><td class="l">일평균 원육사용량</td><td>'+nf(ctx.thisAvg,0)+' kg</td><td>'+nf(ctx.sameAvg,0)+' kg</td><td>'+nf(ctx.fullAvg,0)+' kg</td>'
      +       '<td style="color:'+_col(ctx.thisAvg-ctx.sameAvg)+';font-weight:600">'+_arr(ctx.thisAvg-ctx.sameAvg)+' '+nf(Math.abs(ctx.thisAvg-ctx.sameAvg),0)+' kg</td>'
      +       '<td style="color:'+_col(ctx.thisAvg-ctx.sameAvg)+';font-weight:600">'+_arr(ctx.thisAvg-ctx.sameAvg)+' '+nf(ctx.sameAvg?Math.abs((ctx.thisAvg-ctx.sameAvg)/ctx.sameAvg*100):0,1)+'%</td></tr>'
      +     _rowAbs(S,P,F,'월 누적 원육사용량','rmKg','kg',0)
      +     _rowAbs(S,P,F,'월 누적 EA (외포장)','pkEa','',0)
      +     _rowAbs(S,P,F,'완제품 고기중량','meatKg','kg',0)
      +     _rowYield(S,P,F,'전처리 수율','ppKg')
      +     _rowYield(S,P,F,'자숙 수율','ckKg')
      +     _rowYield(S,P,F,'파쇄 수율','shKg')
      +     _rowYield(S,P,F,'최종 수율','meatKg')
      +   '</tbody></table>'
      +   '<div class="mpan-note">※ 동기간 비교 = 이번 달 '+ndays+'일치를 전월 같은 일수(첫 '+ndays+'일)와 비교 — 진행 중인 달을 공정하게 보기 위함입니다. 수율은 원육 대비 누적 기준입니다.</div>'
      + '</div>'
      // 인사이트
      + '<div class="mpan-sec"><h4>주목할 점</h4>'+_insights(ctx)+'</div>'
      + '</div>';

    _loadTrend(ymThis);
  }

  /* ===== 추이 로드 + 차트 ===== */
  async function _fetchMonthSummary(ym){
    if(typeof window.ipMonthSummary!=='function' || typeof fbGetRange!=='function') return null;
    var today=_today();
    var b=_monthBounds(ym);
    if(b.from>today) return null;
    var effTo = b.to>today ? today : b.to;
    try {
      var R=await Promise.all([
        fbGetRange('preprocess',   b.from,            effTo),
        fbGetRange('thawing',      _addDays(b.from,-1),_addDays(effTo,1)),
        fbGetRange('shredding',    b.from,            effTo),
        fbGetRange('cooking',      b.from,            effTo),
        fbGetRange('packing',      b.from,            effTo),
        fbGetRange('outerpacking', b.from,            effTo),
        fbGetRange('packing_pending', b.from,         effTo).catch(function(){return [];})
      ]);
      var DATA={ pp:R[0], th:R[1], sh:R[2], ck:R[3], pk:R[4], op:R[5] };
      var pend=new Set(); (R[6]||[]).forEach(function(r){ var d=String(r.date||'').slice(0,10); if(d) pend.add(d); });
      var s=window.ipMonthSummary(DATA, b.from, effTo, pend);
      s.ym=ym;
      return s;
    } catch(e){ console.error('[mpan] trend fetch', ym, e); return null; }
  }

  async function _loadTrend(ymThis){
    var note=document.getElementById('mpanTrendNote');
    try {
      var yms=[]; var ym=ymThis;
      for(var i=0;i<6;i++){ yms.unshift(ym); ym=_prevYm(ym); }
      var res;
      if(_trendCache[ymThis]){ res=_trendCache[ymThis]; }
      else {
        res=await Promise.all(yms.map(_fetchMonthSummary));
        _trendCache[ymThis]=res;
      }
      // 유효월: 생산일 3일 이상 (1~2일짜리 시범가동 제외)
      var T=res.filter(function(s){ return s && s.days>=3 && s.rmKg>0; });
      if(!T.length){ if(note) note.textContent='추이를 표시할 데이터가 충분하지 않습니다.'; return; }

      var labels = T.map(function(s){ return _mIdx(s.ym)+'월'; });
      var curIdx = T.findIndex(function(s){ return s.ym===ymThis; });
      var rmData = T.map(function(s){ return Math.round(s.rmKg); });
      var yPp = T.map(function(s){ return s.rmKg? +(s.ppKg/s.rmKg*100).toFixed(1):null; });
      var yCk = T.map(function(s){ return s.rmKg? +(s.ckKg/s.rmKg*100).toFixed(1):null; });
      var ySh = T.map(function(s){ return s.rmKg? +(s.shKg/s.rmKg*100).toFixed(1):null; });

      if(typeof Chart==='undefined'){ if(note) note.textContent='차트 라이브러리를 불러오지 못했습니다.'; return; }
      if(_charts.rm){ _charts.rm.destroy(); _charts.rm=null; }
      if(_charts.yield){ _charts.yield.destroy(); _charts.yield=null; }

      var rmEl=document.getElementById('mpanChartRm');
      var yEl=document.getElementById('mpanChartYield');
      if(rmEl){
        _charts.rm=new Chart(rmEl, {
          type:'bar',
          data:{ labels:labels, datasets:[{ label:'원육 투입량(kg)', data:rmData,
            backgroundColor: T.map(function(s,i){ return i===curIdx ? '#0e7490' : '#7dd3e0'; }),
            borderRadius:4 }]},
          options:{ responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{display:false},
              tooltip:{ callbacks:{ label:function(c){ return nf(c.parsed.y,0)+' kg'; } } } },
            scales:{ y:{ beginAtZero:true, ticks:{ callback:function(v){ return nf(v,0); } } } } }
        });
      }
      if(yEl){
        _charts.yield=new Chart(yEl, {
          type:'line',
          data:{ labels:labels, datasets:[
            { label:'전처리(누적)', data:yPp, borderColor:'#2563eb', backgroundColor:'#2563eb', tension:.25, spanGaps:true },
            { label:'자숙(누적)',   data:yCk, borderColor:'#f59e0b', backgroundColor:'#f59e0b', tension:.25, spanGaps:true },
            { label:'파쇄(누적)',   data:ySh, borderColor:'#16a34a', backgroundColor:'#16a34a', tension:.25, spanGaps:true }
          ]},
          options:{ responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{ position:'bottom', labels:{ boxWidth:14, font:{size:11} } },
              tooltip:{ callbacks:{ label:function(c){ return c.dataset.label+': '+c.parsed.y+'%'; } } } },
            scales:{ y:{ ticks:{ callback:function(v){ return v+'%'; } } } } }
        });
      }
      if(note){
        var curIsPartial = (ymThis === _today().slice(0,7));
        note.innerHTML = '4월부터 누적된 월별 추이입니다.' + (curIsPartial ? ' 이번 달('+_mIdx(ymThis)+'월)은 진행 중('+(T[curIdx]?T[curIdx].days:'')+'일)이라 원육 총량은 아직 누적 중입니다 — 수율(%)은 일수와 무관하게 비교 가능합니다.' : '');
      }
    } catch(e){
      console.error('[mpan] trend render', e);
      if(note) note.textContent='추이 로드 오류: '+(e.message||e);
    }
  }

  window.renderMonthlyAnalysis = renderMonthlyAnalysis;
})();
