// ============================================================
// 일일 작업 일지 엑셀 출력 (SheetJS)


// ============================================================
// 대시보드
// ============================================================
var _dbWeekChart=null, _dbBarChart=null, _dbYldChart=null;
var _dbPeriod='today';

function setDbPeriod(period){
  _dbPeriod=period;
  const today=tod();
  let from=today, to=today;
  if(period==='week'){
    const d=new Date(); const day=d.getDay()||7; d.setDate(d.getDate()-day+1);
    from=d.toISOString().slice(0,10); to=today;
  } else if(period==='month'){
    from=today.slice(0,7)+'-01'; to=today;
  } else if(period==='custom'){
    from=document.getElementById('db_date_from')?.value||today;
    to=document.getElementById('db_date_to')?.value||today;
  }

  // 버튼 스타일
  ['today','week','month'].forEach(p=>{
    const btn=document.getElementById('db_btn_'+p);
    if(!btn) return;
    if(p===period){ btn.className='btn bp'; }
    else { btn.className='btn'; }
  });

  // 오늘/기간 섹션 토글
  const isToday = period==='today';
  const todaySection=document.getElementById('db_today_section');
  const rangeSection=document.getElementById('db_range_section');
  const targetBar=document.getElementById('db_target_bar');
  if(todaySection) todaySection.style.display=isToday?'':'none';
  if(rangeSection) rangeSection.style.display=isToday?'none':'';
  if(targetBar) targetBar.style.display=isToday?'':'none';

  // 라벨
  const lblMap={today:'오늘 '+today, week:'이번 주 '+from+' ~ '+to, month:'이번 달 '+today.slice(0,7), custom:from+' ~ '+to};
  setText('db_period_label', lblMap[period]||'');

  // 주간차트 타이틀
  setText('db_week_title', period==='month'?'월간 주별 생산량':'주간 생산량');

  renderDashboard(from, to);
}

async function renderDashboard(fromDate, toDate){
  const today=tod();
  const from=fromDate||today;
  const to=toDate||today;
  const isToday=from===to&&from===today;

  // 데이터 로드
  const [pk,pp,ck,sh]=await Promise.all([
    fbGetRange('packing',from,to), fbGetRange('preprocess',from,to),
    fbGetRange('cooking',from,to), fbGetRange('shredding',from,to)
  ]);

  // 바코드: 작업이 있는 날의 전날 바코드만 가져옴
  let bc=[];
  if(isToday){
    // 오늘 스캔된 바코드만 표시 (전날꺼 안가져옴)
    const _localTodayBc=(L.barcodes||[]).filter(b=>String(b.date||'').slice(0,10)===today);
    const _fbTodayBc=await fbGetByDate('barcode',today);
    const _bcMap=new Map();
    [..._localTodayBc,..._fbTodayBc].forEach(b=>{if(b.id||b.importCode)_bcMap.set(b.id||b.importCode,b);});
    bc=[..._bcMap.values()];
  } else {
    // 기간 조회: 작업 날짜 기반 전날들
    const _wdSet=new Set([...pk,...pp,...ck,...sh].map(r=>String(r.date||'').slice(0,10)).filter(Boolean));
    const _prevDays=[..._wdSet].map(d=>{const[y,m,dd]=d.split('-').map(Number);const dt=new Date(y,m-1,dd-1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;});
    const _bcMap=new Map();
    for(const _pd of [...new Set(_prevDays)]){
      const _fbBc=await fbGetByDate('barcode',_pd);
      const _localBc=(L.barcodes||[]).filter(b=>String(b.date||'').slice(0,10)===_pd);
      [..._localBc,..._fbBc].forEach(b=>{if(b.id||b.importCode)_bcMap.set(b.id||b.importCode,b);});
    }
    bc=[..._bcMap.values()];
  }

  const rmKg=r2(bc.filter(b=>b.status==='적합').reduce((s,b)=>s+(parseFloat(b.weightKg)||0),0));
  const ppKg=r2(pp.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const ckKg=r2(ck.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const shKg=r2(sh.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const totalEA=pk.reduce((s,r)=>s+(parseFloat(r.ea)||0),0);
  const defEA=pk.reduce((s,r)=>s+(parseFloat(r.defect)||0),0);
  const pkKg=r2(pk.reduce((s,r)=>{const p=L.products.find(x=>x.name===r.product);return s+(p?(parseFloat(r.ea)||0)*p.kgea:0);},0));
  const totalMH=r2(sumMH(pp)+sumMH(ck)+sumMH(sh)+sumMH(pk));
  const yld=rmKg>0?r2(pkKg/rmKg*100):0;
  const defRate=(totalEA+defEA)>0?r2(defEA/(totalEA+defEA)*100):0;
  const eaMH=totalMH>0?r2(totalEA/totalMH):0;

  // KPI
  setText('db_ea', totalEA.toLocaleString());
  setText('db_yld', rmKg>0 ? yld+'%' : '—');
  setText('db_def', defRate+'%');
  setText('db_eamh', eaMH.toFixed(1));
  setText('db_mh_total', '총인시 '+totalMH);
  setText('db_rm', rmKg.toFixed(2));
  const bcParts=[...new Set(bc.filter(b=>b.status==='적합').map(b=>b.part||''))].filter(Boolean).join('/');
  setText('db_rm_sub', bc.filter(b=>b.status==='적합').length+'박스'+(bcParts?' · '+bcParts:''));

  if(isToday){
    await calcDbTarget(rmKg, yld);
    renderDbProcStatus(pp,ck,sh,pk,rmKg,ppKg,ckKg,shKg,totalEA);
    renderDbMachines(pk);
    renderDbProdProgress(pp,ck,sh,pk,rmKg,totalEA);
  } else {
    // 기간 테이블 + 차트
    await renderDbRangeView(from,to,_dbPeriod);
  }

  renderDbProdTable(pk,rmKg);
  renderDbWeekChart(from,to,_dbPeriod);
}

async function calcDbTarget(rmKg,todayYld){
  const basis=document.getElementById('db_yld_basis')?.value||'month';
  const today=tod();
  let yldToUse=todayYld||0;

  if(basis!=='manual'){
    let startDate;
    if(basis==='month') startDate=today.slice(0,7)+'-01';
    else if(basis==='30d'){ const d=new Date();d.setDate(d.getDate()-29);startDate=d.toISOString().slice(0,10); }
    else { const d=new Date();d.setDate(d.getDate()-6);startDate=d.toISOString().slice(0,10); }
    const pkR=await fbGetRange('packing',startDate,today);
    const dates=[...new Set(pkR.map(r=>String(r.date||'').slice(0,10)))];
    let totRm=0,totPk=0;
    for(const d of dates){
      const prevD=(()=>{const [y,m,dd]=d.split('-').map(Number);const dt=new Date(y,m-1,dd-1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;})();
      const bcR=await fbGetByDate('barcode',prevD);
      totRm+=bcR.filter(b=>b.status==='적합').reduce((s,b)=>s+(parseFloat(b.weightKg)||0),0);
      totPk+=pkR.filter(r=>String(r.date||'').slice(0,10)===d).reduce((s,r)=>{const p=L.products.find(x=>x.name===r.product);return s+(p?(parseFloat(r.ea)||0)*p.kgea:0);},0);
    }
    if(totRm>0) yldToUse=r2(totPk/totRm*100);
  }

  const yldEl=document.getElementById('db_yld_val');
  if(yldEl&&(!yldEl.value||basis!=='manual')) yldEl.value=yldToUse;

  const rm=rmKg||0;
  const useYld=parseFloat(yldEl?.value||yldToUse)/100;
  const products=L.products.filter(p=>p.kgea>0);
  let autoTarget=0;
  if(products.length>0&&rm>0){ autoTarget=Math.round(rm*useYld/products[0].kgea); }
  setText('db_auto_target', autoTarget.toLocaleString());

  const manualEl=document.getElementById('db_target_manual');
  const target=parseInt(manualEl?.value)||autoTarget;
  if(target){ L.dbTarget=target; saveL(); }

  const ea=pk_today_ea||0;
  const rate=target>0?Math.min(100,r2(ea/target*100)):0;
  setText('db_ea_rate', rate.toFixed(1)+'%');
  setText('db_achieve_rate', rate.toFixed(1)+'%');
  const bar=document.getElementById('db_achieve_bar');
  if(bar) bar.style.width=rate+'%';
}

var pk_today_ea=0;

function saveDbTarget(val){ if(val){L.dbTarget=val;saveL();} }

function renderDbProcStatus(pp,ck,sh,pk,rmKg,ppKg,ckKg,shKg,totalEA){
  pk_today_ea=totalEA;
  const el=document.getElementById('db_proc_status');
  if(!el) return;
  const procs=[
    {name:'해동',  done:rmKg>0&&pp.length>0, running:false, kg:rmKg, unit:'kg'},
    {name:'전처리',done:ppKg>0&&pp.some(r=>r.end), running:pp.some(r=>r.start&&!r.end), kg:ppKg, unit:'kg'},
    {name:'자숙',  done:ckKg>0&&ck.some(r=>r.end), running:ck.some(r=>r.start&&!r.end), kg:ckKg, unit:'kg'},
    {name:'파쇄',  done:shKg>0&&sh.some(r=>r.end), running:sh.some(r=>r.start&&!r.end), kg:shKg, unit:'kg'},
    {name:'포장',  done:totalEA>0&&pk.some(r=>r.end), running:(L.packing_pending||[]).length>0, kg:totalEA, unit:'EA'},
  ];
  el.innerHTML=procs.map(p=>{
    const pct=p.unit==='kg'?(rmKg>0?Math.min(100,r2(p.kg/rmKg*100)):0):(L.dbTarget?Math.min(100,r2(p.kg/(L.dbTarget||1)*100)):0);
    const color=p.running?'var(--p)':(p.done?'var(--s)':'var(--g2)');
    const badge=p.running
      ?`<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:var(--p);color:#fff;flex-shrink:0">진행중</span>`
      :p.done
        ?`<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:var(--g1);color:var(--s);flex-shrink:0">완료</span>`
        :`<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:var(--g1);color:var(--g4);flex-shrink:0">대기</span>`;
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <span style="font-size:12px;color:var(--g6);width:36px;flex-shrink:0">${p.name}</span>
      <div style="flex:1;height:10px;background:var(--g1);border-radius:5px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:5px"></div>
      </div>
      <span style="font-size:11px;color:var(--g6);width:64px;text-align:right;flex-shrink:0">${p.kg>0?(p.unit==='EA'?p.kg.toLocaleString():p.kg.toFixed(2))+p.unit:'—'}</span>
      ${badge}
    </div>`;
  }).join('');

  // 타임라인
  const tlEl=document.getElementById('db_timeline');
  if(!tlEl) return;
  const tm=t=>{if(!t)return null;const[h,m]=t.split(':').map(Number);return h*60+m;};
  const minT=300,maxT=1080;
  const toP=t=>Math.max(0,Math.min(100,r2((t-minT)/(maxT-minT)*100)));
  const groups={전처리:{recs:pp,color:'#3b82f6'},자숙:{recs:ck,color:'#22c55e'},파쇄:{recs:sh,color:'#f97316'},포장:{recs:pk,color:'#a855f7'}};
  tlEl.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--g4);margin-bottom:4px"><span>05:00</span><span>08:00</span><span>11:00</span><span>14:00</span><span>17:00</span></div>`+
    Object.entries(groups).map(([name,{recs,color}])=>recs.length?`
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:10px;color:var(--g5);width:32px;flex-shrink:0">${name}</span>
        <div style="flex:1;height:18px;background:var(--g1);border-radius:4px;position:relative">
          ${recs.map(r=>{const s=tm(r.start),e=tm(r.end||nowHM());if(!s)return'';const l=toP(s),w=Math.max(2,toP(e)-toP(s));return`<div style="position:absolute;left:${l}%;width:${w}%;height:100%;background:${color};border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;overflow:hidden;white-space:nowrap">${r.start}${r.end?'~'+r.end:''}</div>`;}).join('')}
        </div>
      </div>`:'').join('');
}

function renderDbMachines(pk){
  const el=document.getElementById('db_machines');
  if(!el) return;
  const pending=L.packing_pending||[];
  const machines=[
    ...pending.map(r=>({machine:r.machine||'-',product:r.product||'-',ea:0,running:true})),
    ...pk.map(r=>({machine:r.machine||'-',product:r.product||'-',ea:parseFloat(r.ea)||0,running:false}))
  ];
  if(!machines.length){el.innerHTML='<div style="font-size:12px;color:var(--g4)">가동중인 설비 없음</div>';return;}
  el.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`+
    machines.map(m=>`<div style="background:var(--g1);border-radius:6px;padding:9px 11px;border-left:3px solid ${m.running?'var(--p)':'var(--g3)'}">
      <div style="font-size:10px;color:var(--g5);margin-bottom:3px">${m.machine}</div>
      <div style="font-size:13px;font-weight:600;color:${m.running?'var(--p)':'var(--s)'}">${m.running?'진행중':'완료'}</div>
      <div style="font-size:10px;color:var(--g4);margin-top:2px">${m.product.slice(0,12)}${m.ea>0?' · '+m.ea.toLocaleString()+'EA':''}</div>
    </div>`).join('')+'</div>';
}

function renderDbProdProgress(pp,ck,sh,pk,rmKg,totalEA){
  const el=document.getElementById('db_proc_progress');
  if(!el) return;
  const ppKg=r2(pp.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const ckKg=r2(ck.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const shKg=r2(sh.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const target=L.dbTarget||0;
  const rows=[
    {name:'전처리',val:rmKg>0?r2(ppKg/rmKg*100):0,unit:'%',label:'수율'},
    {name:'자숙',  val:rmKg>0?r2(ckKg/rmKg*100):0,unit:'%',label:'수율'},
    {name:'파쇄',  val:rmKg>0?r2(shKg/rmKg*100):0,unit:'%',label:'수율'},
    {name:'포장',  val:target>0?Math.min(100,r2(totalEA/target*100)):0,unit:'%',label:'달성률'},
  ];
  el.innerHTML=rows.map(row=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <span style="font-size:11px;color:var(--g5);width:36px;flex-shrink:0">${row.name}</span>
    <div style="flex:1;height:7px;background:var(--g1);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${row.val}%;background:${row.val>=90?'var(--s)':row.val>=70?'var(--w)':'var(--d)'};border-radius:4px"></div>
    </div>
    <span style="font-size:11px;width:42px;text-align:right;flex-shrink:0;color:${row.val>=90?'var(--s)':row.val>=70?'var(--w)':'var(--d)'}">${row.val}%</span>
  </div>`).join('');
}

async function renderDbRangeView(from,to,period){
  // 날짜별 집계
  const allDates=[];
  const cur=new Date(from+'T00:00:00');
  const end=new Date(to+'T00:00:00');
  while(cur<=end){ allDates.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }

  const rows=[];
  for(const d of allDates){
    const [pkD,ppD,ckD,shD]=await Promise.all([fbGetByDate('packing',d),fbGetByDate('preprocess',d),fbGetByDate('cooking',d),fbGetByDate('shredding',d)]);
    const prevD=(()=>{const [y,m,dd]=d.split('-').map(Number);const dt=new Date(y,m-1,dd-1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;})();
    let bcD=await fbGetByDate('barcode',prevD);
    if(!bcD.length) bcD=(L.barcodes||[]).filter(b=>String(b.date||'').slice(0,10)===prevD);
    const rmD=r2(bcD.filter(b=>b.status==='적합').reduce((s,b)=>s+(parseFloat(b.weightKg)||0),0));
    const eaD=pkD.reduce((s,r)=>s+(parseFloat(r.ea)||0),0);
    const defD=pkD.reduce((s,r)=>s+(parseFloat(r.defect)||0),0);
    const pkKgD=r2(pkD.reduce((s,r)=>{const p=L.products.find(x=>x.name===r.product);return s+(p?(parseFloat(r.ea)||0)*p.kgea:0);},0));
    const mhD=r2(sumMH(ppD)+sumMH(ckD)+sumMH(shD)+sumMH(pkD));
    if(eaD>0||rmD>0) rows.push({date:d,rm:rmD,ea:eaD,def:defD,pkKg:pkKgD,mh:mhD});
  }

  // 테이블
  const tbody=document.getElementById('db_range_tbl');
  const tfoot=document.getElementById('db_range_total');
  if(tbody) tbody.innerHTML=rows.map(row=>{
    const yld=row.rm>0?r2(row.pkKg/row.rm*100).toFixed(2)+'%':'—';
    const defR=row.ea>0?r2(row.def/row.ea*100).toFixed(2)+'%':'—';
    const eaMH=row.mh>0?r2(row.ea/row.mh).toFixed(1):'—';
    return `<tr>
      <td style="text-align:left">${row.date}</td>
      <td style="text-align:center">${row.rm.toFixed(2)}</td>
      <td style="text-align:center;font-weight:600;color:var(--p)">${row.ea.toLocaleString()}</td>
      <td style="text-align:center;color:var(--w)">${yld}</td>
      <td style="text-align:center;color:${row.ea>0&&r2(row.def/row.ea*100)>2?'var(--d)':'var(--s)'}">${defR}</td>
      <td style="text-align:center">${row.mh}</td>
      <td style="text-align:center">${eaMH}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--g4);padding:1rem">데이터 없음</td></tr>';

  const totRm=r2(rows.reduce((s,r)=>s+r.rm,0));
  const totEA=rows.reduce((s,r)=>s+r.ea,0);
  const totDef=rows.reduce((s,r)=>s+r.def,0);
  const totPkKg=r2(rows.reduce((s,r)=>s+r.pkKg,0));
  const totMH=r2(rows.reduce((s,r)=>s+r.mh,0));
  if(tfoot) tfoot.innerHTML=`<tr style="font-weight:600;border-top:1px solid var(--g2)">
    <td style="text-align:left">합계</td>
    <td style="text-align:center">${totRm.toFixed(2)}</td>
    <td style="text-align:center;color:var(--p)">${totEA.toLocaleString()}</td>
    <td style="text-align:center;color:var(--w)">${totRm>0?r2(totPkKg/totRm*100).toFixed(2)+'%':'—'}</td>
    <td style="text-align:center;color:${totEA>0&&r2(totDef/totEA*100)>2?'var(--d)':'var(--s)'}">${totEA>0?r2(totDef/totEA*100).toFixed(2)+'%':'—'}</td>
    <td style="text-align:center">${totMH}</td>
    <td style="text-align:center">${totMH>0?r2(totEA/totMH).toFixed(1):'—'}</td>
  </tr>`;

  // 차트
  if(_dbBarChart) _dbBarChart.destroy();
  if(_dbYldChart) _dbYldChart.destroy();
  const ctx1=document.getElementById('db_bar_chart');
  const ctx2=document.getElementById('db_yld_chart');
  if(ctx1) _dbBarChart=new Chart(ctx1,{type:'bar',data:{labels:rows.map(r=>r.date.slice(5)+'('+dayOfWeek(r.date)+')'),datasets:[{label:'생산EA',data:rows.map(r=>r.ea),backgroundColor:'#3b82f6',borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#888',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#888',font:{size:10},callback:v=>v>=1000?(v/1000).toFixed(0)+'k':''},grid:{color:'rgba(128,128,128,0.1)'}}}}});
  if(ctx2) _dbYldChart=new Chart(ctx2,{type:'line',data:{labels:rows.map(r=>r.date.slice(5)+'('+dayOfWeek(r.date)+')'),datasets:[{label:'수율',data:rows.map(r=>r.rm>0?r2(r.pkKg/r.rm*100):null),borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,0.1)',fill:true,tension:0.3,pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#888',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#888',font:{size:10},callback:v=>v+'%'},grid:{color:'rgba(128,128,128,0.1)'},min:0,max:100}}}});
}

function renderDbProdTable(pk,rmKg){
  const tbody=document.getElementById('db_prod_tbl');
  const tfoot=document.getElementById('db_prod_total');
  if(!tbody) return;
  const byProd={};
  pk.forEach(r=>{
    const k=r.product||'기타';
    if(!byProd[k]) byProd[k]={ea:0,defect:0,mh:0,kg:0};
    byProd[k].ea+=parseFloat(r.ea)||0;
    byProd[k].defect+=parseFloat(r.defect)||0;
    byProd[k].mh+=dur(r.start,r.end)*(parseFloat(r.workers)||0);
    const p=L.products.find(x=>x.name===k);
    byProd[k].kg+=p?(parseFloat(r.ea)||0)*p.kgea:0;
  });
  const target=L.dbTarget||0;
  let totEA=0,totDef=0,totMH=0,totKg=0;
  tbody.innerHTML=Object.entries(byProd).map(([prod,v])=>{
    totEA+=v.ea;totDef+=v.defect;totMH+=v.mh;totKg+=v.kg;
    const yld=rmKg>0?r2(v.kg/rmKg*100).toFixed(2)+'%':'—';
    const defR=(v.ea+v.defect)>0?r2(v.defect/(v.ea+v.defect)*100).toFixed(2)+'%':'—';
    const eaMH=v.mh>0?r2(v.ea/v.mh).toFixed(1):'—';
    const ach=target>0?r2(v.ea/target*100).toFixed(1)+'%':'—';
    return `<tr><td style="text-align:left">${prod}</td>
      <td style="text-align:center">${target>0?target.toLocaleString():'—'}</td>
      <td style="text-align:center;font-weight:600;color:var(--p)">${v.ea.toLocaleString()}</td>
      <td style="text-align:center;color:var(--p)">${ach}</td>
      <td style="text-align:center;color:var(--w)">${yld}</td>
      <td style="text-align:center;color:${(v.ea+v.defect)>0&&r2(v.defect/(v.ea+v.defect)*100)>2?'var(--d)':'var(--s)'}">${defR}</td>
      <td style="text-align:center">${eaMH}</td></tr>`;
  }).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--g4);padding:1rem">데이터 없음</td></tr>';
  if(tfoot) tfoot.innerHTML=`<tr style="font-weight:600;border-top:1px solid var(--g2)">
    <td style="text-align:left">전체 합계</td>
    <td style="text-align:center">${target>0?target.toLocaleString():'—'}</td>
    <td style="text-align:center;color:var(--p)">${totEA.toLocaleString()}</td>
    <td style="text-align:center;color:var(--p)">${target>0?r2(totEA/target*100).toFixed(1)+'%':'—'}</td>
    <td style="text-align:center;color:var(--w)">${rmKg>0?r2(totKg/rmKg*100).toFixed(2)+'%':'—'}</td>
    <td style="text-align:center;color:${totEA>0&&r2(totDef/totEA*100)>2?'var(--d)':'var(--s)'}">${totEA>0?r2(totDef/totEA*100).toFixed(2)+'%':'—'}</td>
    <td style="text-align:center">${totMH>0?r2(totEA/totMH).toFixed(1):'—'}</td>
  </tr>`;
}

async function renderDbWeekChart(from,to,period){
  const today=tod();
  const labels=[],vals=[],colors=[];
  if(period==='month'){
    // 월간: 주별 집계
    const startDate=today.slice(0,7)+'-01';
    const cur=new Date(startDate+'T00:00:00');
    const endD=new Date(today+'T00:00:00');
    while(cur<=endD){
      const wStart=cur.toISOString().slice(0,10);
      const wEndD=new Date(cur);wEndD.setDate(wEndD.getDate()+6);
      const wEnd=wEndD>endD?today:wEndD.toISOString().slice(0,10);
      const pkW=await fbGetRange('packing',wStart,wEnd);
      const ea=pkW.reduce((s,r)=>s+(parseFloat(r.ea)||0),0);
      labels.push(wStart.slice(5)+'~'+wEnd.slice(5));
      vals.push(ea);
      colors.push('#3b82f6');
      cur.setDate(cur.getDate()+7);
    }
  } else {
    // 7일
    for(let i=6;i>=0;i--){
      const d=new Date();d.setDate(d.getDate()-i);
      const ds=d.toISOString().slice(0,10);
      const recs=await fbGetByDate('packing',ds);
      const ea=recs.reduce((s,r)=>s+(parseFloat(r.ea)||0),0);
      if(ea>0||ds===today){
        labels.push(ds.slice(5)+'('+dayOfWeek(ds)+')');
        vals.push(ea);
        colors.push(ds===today?'#22c55e':'#3b82f6');
      }
    }
  }
  const target=L.dbTarget||0;
  const ctx=document.getElementById('db_week_chart');
  if(!ctx) return;
  if(_dbWeekChart) _dbWeekChart.destroy();
  _dbWeekChart=new Chart(ctx,{type:'bar',data:{labels,datasets:[
    {label:'생산EA',data:vals,backgroundColor:colors,borderRadius:4,borderSkipped:false},
    ...(target>0?[{label:'목표',data:Array(labels.length).fill(target),type:'line',borderColor:'#f87171',borderDash:[4,3],pointRadius:0,borderWidth:1.5,fill:false}]:[])
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>v.raw>0?v.raw.toLocaleString()+' EA':'-'}}},scales:{x:{ticks:{color:'#888',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#888',font:{size:10},callback:v=>v>=1000?(v/1000).toFixed(0)+'k':''},grid:{color:'rgba(128,128,128,0.1)'},min:0}}}});
}



function renderSettings(){
  updateAccCounts();
  // 제품 목록
  const pdEl = document.getElementById('pdList');
  if(pdEl){
    if(!L.products.length){ pdEl.innerHTML='<div class="emp">등록된 제품 없음</div>'; }
    else {
      pdEl.innerHTML = L.products.map((p,i)=>{
        const r = p.recipe||{};
        const innerSummary = (r.inner||[]).map(x=>`${x.item} ${x.qty}${x.unit}`).join(' · ');
        const outerSummary = (r.outer||[]).length ? (r.outer||[]).map(x=>`${x.item} ${x.qty}${x.unit}`).join(' · ') : '';
        const noMeatBadge = p.noMeat ? '<span style="display:inline-block;padding:1px 6px;background:#fef3c7;color:#92400e;border-radius:3px;font-size:10px;margin-left:4px">원육X</span>' : '';
        const subPart = p.subName ? ` · 부재료 ${p.subName}${p.subKgea?' '+p.subKgea+'kg/EA':''}` : '';
        const sumLine = p.noMeat
          ? `Capa ${p.capa}kg${p.sauce?' · '+p.sauce:''}${subPart}`
          : `${p.kgea}kg/EA · Capa ${p.capa}kg${p.sauce?' · '+p.sauce:''}${subPart}`;
        return `
        <div class="si" id="pdItem_${i}">
          <div style="flex:1;min-width:0">
            <div class="sn">${p.name}${noMeatBadge}</div>
            <div class="ss">${sumLine}</div>
            ${innerSummary?`<div class="ss" style="color:var(--p);margin-top:2px">📋 ${innerSummary}</div>`:''}
            ${outerSummary?`<div class="ss" style="color:var(--s);margin-top:1px">📦 ${outerSummary}</div>`:''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn bo bsm" onclick="startEditProd(${i})">✏️수정</button>
            <button class="btn bd bsm" onclick="delProd(${i})">삭제</button>
          </div>
        </div>`;
      }).join('');
    }
    // 소스 선택지 업데이트 (신규 추가 폼)
    const npSc = document.getElementById('np_sc');
    if(npSc) npSc.innerHTML='<option value="">없음</option>'+(L.sauces||[]).map(s=>`<option>${s.name}</option>`).join('');
    // 부재료 선택지 업데이트 (신규 추가 폼)
    const npSub = document.getElementById('np_sub');
    if(npSub) npSub.innerHTML='<option value="">없음</option>'+(L.submats||[]).map(s=>`<option>${s}</option>`).join('');
  }

  // 소스 목록
  const scEl = document.getElementById('scList');
  if(scEl){
    if(!L.sauces.length){ scEl.innerHTML='<div class="emp">등록된 소스 없음</div>'; }
    else {
      scEl.innerHTML = L.sauces.map((s,i)=>`
        <div class="si">
          <div><div class="sn">${s.name}</div><div class="ss">${s.memo||''}</div></div>
          <button class="btn bd bsm" onclick="delSc(${i})">삭제</button>
        </div>`).join('');
    }
  }

  // 부재료 목록
  const subEl = document.getElementById('subList');
  if(subEl){
    const mats = L.submats||[];
    if(!mats.length){ subEl.innerHTML='<div class="emp">등록된 부재료 없음</div>'; }
    else {
      subEl.innerHTML = mats.map((s,i)=>`
        <div class="si">
          <div class="sn">${s}</div>
          <button class="btn bd bsm" onclick="delSub(${i})">삭제</button>
        </div>`).join('');
    }
  }

  // GTIN 목록
  const gtEl = document.getElementById('gtList');
  if(gtEl){
    const entries = Object.entries(L.gtinMap||{});
    if(!entries.length){ gtEl.innerHTML='<div class="emp">등록된 GTIN 없음</div>'; }
    else {
      gtEl.innerHTML = entries.map(([g,p])=>`
        <div class="si">
          <div><div class="sn">${g}</div><div class="ss">${p}</div></div>
          <button class="btn bd bsm" onclick="delGt('${g}')">삭제</button>
        </div>`).join('');
    }
  }

  // 레시피 목록
  renderRecipeSelect();
  renderRcList();
}

// 제품 수정 시작 - 폼에 기존값 채우기
function startEditProd(i){
  _editProdIdx = i;
  const p = L.products[i];
  if(!p) return;
  document.getElementById('np_nm').value = p.name;
  document.getElementById('np_ke').value = p.kgea||'';
  document.getElementById('np_cp').value = p.capa||'';
  const npSc = document.getElementById('np_sc');
  if(npSc) npSc.value = p.sauce||'';
  const npSub = document.getElementById('np_sub');
  if(npSub) npSub.value = p.subName||'';
  const npSubKe = document.getElementById('np_subke');
  if(npSubKe) npSubKe.value = p.subKgea||'';
  const npNm = document.getElementById('np_nomeat');
  if(npNm){ npNm.checked = !!p.noMeat; if(typeof onNpNoMeatToggle==='function') onNpNoMeatToggle(); }
  fillRecipeForm(p.recipe||null);
  const addBtn = document.querySelector('#p-settings .btn.bs[onclick="addProd()"]');
  if(addBtn){ addBtn.textContent='✔ 수정 저장'; addBtn.style.background='var(--w)'; }
  const cancelBtn = document.getElementById('prodEditCancel');
  if(cancelBtn) cancelBtn.style.display='';
  document.querySelectorAll('[id^="pdItem_"]').forEach(el=>el.style.background='');
  const item = document.getElementById('pdItem_'+i);
  if(item) item.style.background='var(--wl)';
  toast('수정 모드: '+p.name,'i');
  document.getElementById('np_nm').scrollIntoView({behavior:'smooth', block:'center'});
  document.getElementById('np_nm').focus();
}


function updDD(){
  // 제품 선택 (포장 탭)
  const sel=document.getElementById('pk_prod');
  if(sel) sel.innerHTML='<option value="">선택</option>'+L.products.map(p=>`<option>${p.name}</option>`).join('');
  // 레시피 제품 선택 (완제품 + 소스 구분)
  const rcProd=document.getElementById('rc_prod');
  if(rcProd){
    let opts='<option value="">선택</option>';
    if(L.products.length) opts+='<optgroup label="완제품">'+L.products.map(p=>`<option data-type="product">${p.name}</option>`).join('')+'</optgroup>';
    if((L.sauces||[]).length) opts+='<optgroup label="소스">'+L.sauces.map(s=>`<option data-type="sauce">${s.name}</option>`).join('')+'</optgroup>';
    rcProd.innerHTML=opts;
  }
  // 소스 선택
  const scNm=document.getElementById('sc_nm');
  if(scNm) scNm.innerHTML='<option value="">선택</option>'+L.sauces.map(s=>`<option>${s.name}</option>`).join('');
  // 부재료 선택
  const subNm=document.getElementById('pk_subnm');
  if(subNm) subNm.innerHTML='<option value="">선택</option>'+(L.submats||[]).map(s=>`<option>${s}</option>`).join('');
}

async function renderProduct(){
  const endDate=tod();
  const startDate=(()=>{const d=new Date();d.setDate(d.getDate()-29);return d.toISOString().slice(0,10);})();
  const recs = await fbGetRange('packing', startDate, endDate);

  const byProd={};
  recs.forEach(r=>{
    const nm=r.product||'기타';
    if(!byProd[nm]) byProd[nm]={ea:0,defect:0,days:new Set()};
    byProd[nm].ea+=parseFloat(r.ea)||0;
    byProd[nm].defect+=parseFloat(r.defect)||0;
    byProd[nm].days.add(r.date);
  });

  const labels=Object.keys(byProd);
  const eaData=labels.map(k=>byProd[k].ea);
  const defData=labels.map(k=>(byProd[k].ea+byProd[k].defect)>0?r2(byProd[k].defect/(byProd[k].ea+byProd[k].defect)*100):0);

  const c1=document.getElementById('c_pe');
  const c2=document.getElementById('c_pd');
  if(c1){if(_prodChart)_prodChart.destroy();_prodChart=new Chart(c1,{type:'bar',data:{labels,datasets:[{label:'생산EA',data:eaData,backgroundColor:'rgba(26,86,219,.7)'}]},options:{responsive:true,maintainAspectRatio:false}});}
  if(c2){if(_prodDefChart)_prodDefChart.destroy();_prodDefChart=new Chart(c2,{type:'bar',data:{labels,datasets:[{label:'불량률%',data:defData,backgroundColor:'rgba(224,36,36,.7)'}]},options:{responsive:true,maintainAspectRatio:false}});}

  const tbl=document.getElementById('pdTbl');
  if(tbl) tbl.innerHTML=labels.map(k=>`<tr><td>${k}</td><td class="tr">${byProd[k].ea.toLocaleString()}</td><td class="tr">${(byProd[k].ea+byProd[k].defect)>0?r2(byProd[k].defect/(byProd[k].ea+byProd[k].defect)*100)+'%':'-'}</td><td class="tr">${byProd[k].days.size}일</td></tr>`).join('') || '<tr><td colspan="4" class="emp">데이터 없음</td></tr>';
}

// ============================================================