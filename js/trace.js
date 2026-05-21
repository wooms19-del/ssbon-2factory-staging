// ============================================================
// 아코디언 (설정 탭)
// ============================================================
function toggleAcc(id){
  const body = document.getElementById(id);
  const hd = body ? body.previousElementSibling : null;
  if(!body) return;
  const isClosed = body.classList.contains('closed');
  if(isClosed){
    body.classList.remove('closed');
    body.style.maxHeight = body.scrollHeight + 'px';
    if(hd) hd.classList.add('open');
  } else {
    body.classList.add('closed');
    body.style.maxHeight = '0';
    if(hd) hd.classList.remove('open');
  }
}

// 아코디언 카운트 업데이트
function updateAccCounts(){
  const pdCnt = document.getElementById('acc-prod-cnt');
  const scCnt = document.getElementById('acc-sauce-cnt');
  const subCnt = document.getElementById('acc-sub-cnt');
  const gtCnt = document.getElementById('acc-gtin-cnt');
  const rcCnt = document.getElementById('acc-recipe-cnt');
  if(pdCnt) pdCnt.textContent = (L.products||[]).length+'개';
  if(scCnt) scCnt.textContent = (L.sauces||[]).length+'개';
  if(subCnt) subCnt.textContent = (L.submats||[]).length+'개';
  if(gtCnt) gtCnt.textContent = Object.keys(L.gtinMap||{}).length+'개';
  if(rcCnt) rcCnt.textContent = Object.keys(L.recipes||{}).length+'개';
}

// ============================================================
// ============================================================
// 이력추적 - 아코디언 클릭 방식
// ============================================================
var _traceData = {}; // 조회된 데이터 저장

async function doTrace(){
  const q = document.getElementById('trQ').value.trim();
  const el = document.getElementById('trRes');
  if(!q){ toast('날짜를 입력하세요','d'); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(q)){ toast('날짜 형식: 2026-04-17','d'); return; }

  el.innerHTML = '<div class="emp">조회중...</div>';
  document.getElementById('trDetail').style.display = 'none';



  // ① 포장 (당일)
  const pk = dedupeRec(await fbGetByDate('packing', q), r=>r.machine+'|'+String(r.date||'').slice(0,10)+'|'+r.start+'|'+r.ea);
  if(!pk.length){
    el.innerHTML = '<div class="emp">해당 날짜 포장 데이터 없음</div>';
    return;
  }

  // ② 포장 → 파쇄 (포장 당일만, 배출와건/배출카트 매칭)
  const pkWagons = [...new Set(pk.flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()).filter(Boolean)))];
  const pkCarts  = [...new Set(pk.flatMap(r=>(r.cart ||'').split(',').map(w=>w.trim()).filter(Boolean)))];
  const _shRaw = await fbGetByDate('shredding', q);
  const shAll = dedupeRec(_shRaw, r=>r.wagonIn+'|'+String(r.date||'').slice(0,10)+'|'+r.start+'|'+r.kg);
  const sh = shAll.filter(r => {
    const woMatch = pkWagons.some(w=>(r.wagonOut||'').split(',').map(x=>x.trim()).includes(w));
    const coMatch = pkCarts .some(c=>(r.cartOut ||'').split(',').map(x=>x.trim()).includes(c));
    return woMatch || coMatch;
  });

  // ③ 파쇄 → 자숙 (파쇄 당일만)
  const shWagons = [...new Set(sh.flatMap(r=>(r.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean)))];
  const shDates = [...new Set(sh.map(r=>String(r.date||'').slice(0,10)))];
  let ckAll = [];
  for(const d of (shDates.length ? shDates : [q])){
    ckAll.push(...await fbGetByDate('cooking', d));
  }
  const ckAllD = dedupeRec(ckAll, r=>r.tank+'|'+String(r.date||'').slice(0,10)+'|'+r.start+'|'+r.kg); ckAll.length=0; ckAll.push(...ckAllD);
  const ckByWagon = {};
  ckAll
    .filter(r => shWagons.some(w=>(r.wagonOut||'').split(',').map(x=>x.trim()).includes(w)))
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
    .forEach(r=>{
      (r.wagonOut||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(w=>{
        if(shWagons.includes(w) && !ckByWagon[w]) ckByWagon[w]=r;
      });
    });
  const ckIds = new Set(Object.values(ckByWagon).map(r=>r.id));
  const ck = ckAll.filter(r=>ckIds.has(r.id));

  // ④ 자숙 → 전처리 (자숙 당일만, 케이지번호 매칭)
  const ckCages = [...new Set(ck.flatMap(r=>(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean)))];
  const ckDates = [...new Set(ck.map(r=>String(r.date||'').slice(0,10)))];
  let ppAll = [];
  for(const d of (ckDates.length ? ckDates : [q])){
    ppAll.push(...await fbGetByDate('preprocess', d));
  }
  const ppAllD = dedupeRec(ppAll, r=>r.cage+'|'+String(r.date||'').slice(0,10)+'|'+r.start+'|'+r.kg); ppAll.length=0; ppAll.push(...ppAllD);
  const ppByCage = {};
  ppAll
    .filter(r=>ckCages.some(c=>(r.cage||'').split(',').map(x=>x.trim()).includes(c)))
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
    .forEach(r=>{
      (r.cage||'').split(',').map(c=>c.trim()).filter(Boolean).forEach(c=>{
        if(ckCages.includes(c) && !ppByCage[c]) ppByCage[c]=r;
      });
    });
  const ppIds = new Set(Object.values(ppByCage).map(r=>r.id));
  const pp = ppAll.filter(r=>ppIds.has(r.id));

  // ⑤ 전처리 → 방혈 (전처리 날짜 당일 그대로 조회 - 방혈=포장날짜 기본정보로 저장됨)
  const ppWagons = [...new Set(pp.flatMap(r=>(r.wagons||'').split(',').map(w=>w.trim()).filter(Boolean)))];
  const ppDates  = [...new Set(pp.map(r=>String(r.date||'').slice(0,10)))];
  let thAll = [];
  for(const d of (ppDates.length ? ppDates : [q])){
    // 당일 방혈 우선 매칭 (와건 재사용시 전날 배치 오염 방지)
    const _sameTh = (await fbGetByDate('thawing', d)).filter(r=>ppWagons.length===0||ppWagons.some(w=>((r.cart||'').trim())===w));
    if(_sameTh.length > 0){
      // 당일 방혈이 있어도 다음날에 더 많은 일치 기록이 있으면 다음날 우선 (날짜 오입력 보정)
      const _sameKg = r2(_sameTh.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
      const _nextTh = ppWagons.length>0 ? (await fbGetByDate('thawing', addDays(d,1))).filter(r=>ppWagons.some(w=>((r.cart||'').trim())===w)) : [];
      const _nextKg = r2(_nextTh.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
      if(_nextTh.length && _nextKg > _sameKg*2){
        thAll.push(..._nextTh); // 다음날 기록이 2배 이상이면 다음날 사용 (재입력 오류 보정)
      } else {
        thAll.push(..._sameTh);
      }
    } else {
      // 당일 없으면 전날 방혈
      const _prevTh = (await fbGetByDate('thawing', addDays(d,-1))).filter(r=>ppWagons.length===0||ppWagons.some(w=>((r.cart||'').trim())===w));
      thAll.push(...(_prevTh.length > 0 ? _prevTh : await fbGetByDate('thawing', d)));
    }
  }
  const thAllD = dedupeRec(thAll, r=>(r.cart||'')+'|'+r.type+'|'+String(r.date||'').slice(0,10)+'|'+r.totalKg); thAll.length=0; thAll.push(...thAllD);
  let th = thAll;

  // ⑥ 바코드: 해동 전날 스캔 우선, 전날 없으면 당일 (배치 혼입 방지)
  const _thDates = new Set(th.map(r=>String(r.date||'').slice(0,10)));
  const _prevDates = new Set([..._thDates].map(d=>addDays(d,-1)));
  const _bcLoadDates = new Set([..._thDates, ..._prevDates]);
  let bc = [];
  for(const d of [..._bcLoadDates]){
    bc.push(...await fbGetByDate('barcode', d));
  }
  // 전날 바코드가 있으면 전날만, 없으면 당일
  const _prevBc = bc.filter(r=>_prevDates.has(String(r.date||'').slice(0,10)));
  const _sameBc = bc.filter(r=>_thDates.has(String(r.date||'').slice(0,10)));
  bc = _prevBc.length > 0 ? _prevBc : _sameBc;
  const bcMap = new Map();
  bc.forEach(r=>{ if(!bcMap.has(r.importCode)) bcMap.set(r.importCode, r); });
  bc = [...bcMap.values()];

  // 해동 요약: 바코드(bc) 기준으로 계산 (방혈 박스/kg 아님)
  const thBoxes = bc.length;
  const thKg    = r2(bc.reduce((s,r)=>s+(parseFloat(r.weightKg)||0),0));
  // 방혈 전용 박스/kg (방혈 요약용)
  const thBoxesRaw = th.reduce((s,r)=>s+(parseFloat(r.boxes)||0),0);
  const thKgRaw    = r2(th.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
  const ppKg    = r2(pp.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const ckKg    = r2(ck.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const shKg    = r2(sh.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const totalEA = pk.reduce((s,r)=>s+(parseFloat(r.ea)||0),0);

  const dateRange = (recs) => {
    const dates = [...new Set(recs.map(r=>String(r.date||'').slice(0,10)).filter(Boolean))].sort();
    return dates.length > 1 ? `${dates[0]} ~ ${dates[dates.length-1]}` : (dates[0]||'-');
  };

  _traceData = { bc, th, pp, ck, sh, pk, date: q };

  // ─── Phase 2.5 마이그레이션: dataLayer.getDay 비교 모니터 (사용자 영향 0) ───
  // 이력추적은 단일 날짜 q 기반이므로 DL.getDay와 직접 비교 가능
  if(typeof window !== 'undefined' && window.DL && typeof window.DL.getDay === 'function'){
    try{
      const _dlD = window.DL.getDay(q);
      const _checkT = (label, legacy, dl, tol=0.5) => {
        const diff = Math.abs((legacy||0) - (dl||0));
        if(diff > tol) console.warn(`[Phase2.5 비교 차이] ${q} ${label}: legacy=${legacy}, DL=${dl}, Δ=${diff.toFixed(2)}`);
      };
      // ⚠ trace는 자체 체인 추적이므로 DL과 약간 다를 수 있음 (testRun 처리 룰 차이)
      // 그래도 큰 차이(>1) 발생 시 리포팅
      if(_dlD.summary){
        _checkT('rmKg(trace vs DL)', thKgRaw, _dlD.summary.rmKgTotal, 1);
        _checkT('ppKg', ppKg, _dlD.summary._ppKgTotal, 1);
        _checkT('ckKg', ckKg, _dlD.summary._ckKgTotal, 1);
        _checkT('shKg', shKg, _dlD.summary._shKgTotal, 1);
        const _dlEa = Object.values(_dlD.summary.pkEaByPart||{}).reduce((a,b)=>a+b,0)
                    + (_dlD.summary.pkEaNoMeat||0) + (_dlD.summary.pkEaUnresolved||0);
        _checkT('totalEA', totalEA, _dlEa, 5);
      }
    }catch(_e){
      console.error('[Phase2.5 DL 비교 오류]', _e.message);
    }
  }

  const items = [
    { key:'bc',  label:'해동',   sub:`${thBoxes}박스 · ${thKg}kg`,                                  color:'var(--p)',  dateStr: dateRange(th) },
    { key:'th',  label:'방혈',   sub:`${th.length}건 · ${thBoxesRaw}박스 · ${thKgRaw}kg`,                  color:'#0369a1',  dateStr: dateRange(th) },
    { key:'pp',  label:'전처리', sub:`${pp.length}건 · ${ppKg}kg`,                                  color:'var(--s)', dateStr: dateRange(pp) },
    { key:'ck',  label:'자숙',   sub:`${ck.length}건 · ${ckKg}kg`,                                  color:'#c27803',  dateStr: dateRange(ck) },
    { key:'sh',  label:'파쇄',   sub:`${sh.length}건 · ${shKg}kg`,                                  color:'#c27803',  dateStr: dateRange(sh) },
    { key:'pk',  label:'포장',   sub:`${pk.length}건 · ${totalEA.toLocaleString()}EA`,               color:'#6d28d9',  dateStr: dateRange(pk) },
  ];

  document.getElementById('trTimeline') && (document.getElementById('trTimeline').innerHTML = '');
  setTimeout(renderTraceTimeline, 0);
  el.innerHTML = `
    <div style="font-size:12px;color:var(--g5);margin-bottom:8px">📅 ${q} 포장 기준 역추적 · 클릭하면 세부내용</div>
    ${items.map(item => `
      <div onclick="showTraceDetail('${item.key}')"
           style="display:flex;justify-content:space-between;align-items:center;
                  padding:12px 14px;border-radius:8px;margin-bottom:6px;cursor:pointer;
                  border:1px solid var(--g2);background:#fff;transition:background .15s"
           onmouseover="this.style.background='var(--g1)'"
           onmouseout="this.style.background='#fff'">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:14px;font-weight:600;color:${item.color}">${item.label}</span>
          <span style="font-size:11px;color:var(--g4)">${item.dateStr}</span>
        </div>
        <span style="font-size:13px;color:var(--g5)">${item.sub}</span>
      </div>`).join('')}`;
}

function showTraceDetail(key){
  const detail = document.getElementById('trDetail');
  const title  = document.getElementById('trDetailTitle');
  const body   = document.getElementById('trDetailBody');
  const d = _traceData;
  if(!d || !d.date){ return; }

  if(detail.style.display !== 'none' && detail.dataset.key === key){
    detail.style.display = 'none';
    return;
  }
  detail.dataset.key = key;

  const labels = { bc:'해동', th:'방혈', pp:'전처리', ck:'자숙', sh:'파쇄', pk:'포장' };
  title.textContent = labels[key];
  detail.style.display = '';

  if(key === 'bc'){
    const bc = d.bc;
    if(!bc.length){ body.innerHTML='<div class="emp">데이터 없음</div>'; return; }
    const byPart = {};
    bc.filter(b=>b.status==='적합').forEach(b=>{
      const p = b.part||'기타';
      if(!byPart[p]) byPart[p] = {cnt:0, kg:0};
      byPart[p].cnt++;
      byPart[p].kg += parseFloat(b.weightKg)||0;
    });
    body.innerHTML = `<div style="overflow-x:auto"><table class="tbl" style="width:100%">
      <thead><tr>
        <th style="text-align:center">NO</th><th style="text-align:center">날짜</th>
        <th style="text-align:center">부위</th><th style="text-align:center">원산지</th>
        <th style="text-align:center">중량(kg)</th><th style="text-align:center">소비기한</th>
        <th style="text-align:center">판정</th><th style="text-align:center">수입코드</th>
      </tr></thead>
      <tbody>${bc.map((b,i)=>`<tr>
        <td style="text-align:center">${i+1}</td>
        <td style="text-align:center">${String(b.date||'').slice(0,10)}</td>
        <td style="text-align:center">${b.part||'-'}</td>
        <td style="text-align:center">${b.origin||'-'}</td>
        <td style="text-align:center">${b.weightKg||'-'}</td>
        <td style="text-align:center">${b.expiryDate||b.expiry||'-'}</td>
        <td style="text-align:center;font-weight:600;color:${b.status==='적합'?'var(--s)':'var(--d)'}">${b.status||'-'}</td>
        <td style="font-size:11px;color:var(--g5);text-align:center">${(b.importCode||'').slice(-16)}</td>
      </tr>`).join('')}
      ${Object.entries(byPart).map(([p,v])=>`<tr style="background:var(--g1)">
        <td colspan="3" style="text-align:center;font-weight:600;color:var(--p)">${p} 소계</td>
        <td style="text-align:center;font-weight:600;color:var(--p)">${v.cnt}박스</td>
        <td style="text-align:center;font-weight:600;color:var(--p)">${r2(v.kg)}kg</td>
        <td colspan="3"></td>
      </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="4" style="text-align:center;font-weight:600">전체합계</td>
        <td style="text-align:center;font-weight:600;color:var(--p)">${r2(bc.filter(b=>b.status==='적합').reduce((s,b)=>s+(parseFloat(b.weightKg)||0),0))}kg</td>
        <td colspan="3"></td>
      </tr></tfoot>
    </table></div>`;
  }
  else if(key === 'th'){
    const th = d.th.filter((r,i,a)=>a.findIndex(x=>x.cart===r.cart&&x.type===r.type&&x.date===r.date&&x.totalKg===r.totalKg)===i);
    if(!th.length){ body.innerHTML='<div class="emp">데이터 없음</div>'; return; }
    const fmtDT = (date, time) => {
      const d = String(date||'').slice(2,10).replace(/-/g,'.'); // 26.04.07
      return d && time ? d+' '+time : (d||time||'-');
    };
    // 원육타입별 소계
    const thByType = {};
    th.forEach(r=>{
      const t = r.type||'기타';
      if(!thByType[t]) thByType[t] = {boxes:0, kg:0};
      thByType[t].boxes += parseFloat(r.boxes)||0;
      thByType[t].kg += parseFloat(r.totalKg)||0;
    });
    const typeSummary = Object.entries(thByType).map(([t,v])=>
      `<tr style="background:var(--g1)">
        <td colspan="3" style="text-align:center;font-weight:600;color:var(--p)">${t} 소계</td>
        <td colspan="2"></td>
        <td style="text-align:center;font-weight:600;color:var(--p)">${v.boxes}박스</td>
        <td style="text-align:center;font-weight:600;color:var(--p)">${r2(v.kg)}kg</td>
      </tr>`).join('');
    body.innerHTML = `<div style="overflow-x:auto"><table class="tbl" style="width:100%">
      <thead><tr><th style="text-align:center">날짜</th><th style="text-align:center">대차번호</th><th style="text-align:center">원육타입</th>
      <th style="text-align:center">시작</th><th style="text-align:center">종료</th>
      <th style="text-align:center">박스</th><th style="text-align:center">총중량(kg)</th></tr></thead>
      <tbody>${th.map(r=>`<tr>
        <td style="text-align:center">${String(r.date||'').slice(0,10)}</td>
        <td style="text-align:center;font-weight:600">${r.cart||'-'}</td>
        <td style="text-align:center">${r.type||'-'}</td>
        <td style="text-align:center">${fmtDT(addDays(String(r.date||'').slice(0,10),-1), r.start)}</td>
        <td style="text-align:center">${d.pp&&d.pp.length ? fmtDT(d.pp[0].date, d.pp[0].start) : fmtDT(addDays(String(r.date||'').slice(0,10),-1), r.end)}</td>
        <td style="text-align:center">${r.boxes||0}</td>
        <td style="text-align:center">${r2(parseFloat(r.totalKg)||0)}</td>
      </tr>`).join('')}${typeSummary}</tbody>
      <tfoot><tr>
        <td colspan="5" style="text-align:center;font-weight:600">합계</td>
        <td style="text-align:center;font-weight:600;color:var(--p)">${th.reduce((s,r)=>s+(parseFloat(r.boxes)||0),0)}박스</td>
        <td style="text-align:center;font-weight:600;color:var(--p)">${r2(th.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0))}kg</td>
      </tr></tfoot>
    </table></div>`;
  }
  else if(key === 'pp'){
    const pp = d.pp.filter((r,i,a)=>a.findIndex(x=>x.cage===r.cage&&x.date===r.date&&x.start===r.start&&x.kg===r.kg)===i);
    if(!pp.length){ body.innerHTML='<div class="emp">데이터 없음</div>'; return; }
    body.innerHTML = `<div style="overflow-x:auto"><table class="tbl" style="width:100%">
      <th style="text-align:center"ead><tr><th style="text-align:center">날짜</th><th style="text-align:center">대차</th><th style="text-align:center">케이지</th><th style="text-align:center">원육타입</th><th style="text-align:center">시작</th><th style="text-align:center">종료</th>
      <th style="text-align:center" class="tr">인원</th><th style="text-align:center" class="tr">전처리KG</th><th style="text-align:center" class="tr">비가식부KG</th></tr></thead>
      <tbody>${pp.map(r=>`<tr>
        <td style="text-align:center">${String(r.date||'').slice(0,10)}</td>
        <td style="text-align:center">${r.wagons||'-'}</td>
        <td style="text-align:center;font-weight:600">${r.cage||'-'}</td>
        <td style="text-align:center">${r.type||'-'}</td>
        <td style="text-align:center">${r.start||'-'}</td>
        <td style="text-align:center">${r.end||'-'}</td>
        <td style="text-align:center">${r.workers||0}</td>
        <td style="text-align:center" style="font-weight:600;color:var(--s)">${r2(parseFloat(r.kg)||0)}</td>
        <td style="text-align:center">${r2(parseFloat(r.waste)||0)}</td>
      </tr>`).join('')}
      ${(()=>{ const byT={}; pp.forEach(r=>{ const t=r.type||'기타'; if(!byT[t]) byT[t]=0; byT[t]+=parseFloat(r.kg)||0; }); return Object.entries(byT).map(([t,v])=>`<tr style="background:var(--g1)"><td colspan="7" style="text-align:center;font-weight:600;color:var(--s)">${t} 소계</td><td style="text-align:center;font-weight:600;color:var(--s)">${r2(v)}kg</td><td></td></tr>`).join(''); })()}
      </tbody><tfoot><tr><td colspan="7" style="text-align:center;font-weight:600">합계</td><td style="text-align:center;font-weight:600;color:var(--s)">${r2(pp.reduce((s,r)=>s+(parseFloat(r.kg)||0),0))}kg</td><td></td></tr></tfoot>
    </table></div>`;
  }
  else if(key === 'ck'){
    const ck = d.ck.filter((r,i,a)=>a.findIndex(x=>x.tank===r.tank&&x.date===r.date&&x.start===r.start&&x.kg===r.kg)===i);
    if(!ck.length){ body.innerHTML='<div class="emp">데이터 없음</div>'; return; }
    body.innerHTML = `<div style="overflow-x:auto"><table class="tbl" style="width:100%">
      <th style="text-align:center"ead><tr><th style="text-align:center">날짜</th><th style="text-align:center">탱크</th><th style="text-align:center">케이지</th><th style="text-align:center">원육타입</th><th style="text-align:center">시작</th><th style="text-align:center">종료</th>
      <th style="text-align:center" class="tr">자숙KG</th><th style="text-align:center">배출와건</th></tr></thead>
      <tbody>${ck.map(r=>`<tr>
        <td style="text-align:center">${String(r.date||'').slice(0,10)}</td>
        <td style="text-align:center;font-weight:600">${r.tank||'-'}</td>
        <td style="text-align:center">${r.cage||'-'}</td>
        <td style="text-align:center">${r.type||'-'}</td>
        <td style="text-align:center">${r.start||'-'}</td>
        <td style="text-align:center">${r.end||'-'}</td>
        <td style="text-align:center" style="font-weight:600;color:var(--s)">${r2(parseFloat(r.kg)||0)}</td>
        <td style="text-align:center">${r.wagonOut||'-'}</td>
      </tr>`).join('')}
      ${(()=>{ const byT={}; ck.forEach(r=>{ const t=r.type||'기타'; if(!byT[t]) byT[t]=0; byT[t]+=parseFloat(r.kg)||0; }); return Object.entries(byT).map(([t,v])=>`<tr style="background:var(--g1)"><td colspan="5" style="text-align:center;font-weight:600;color:#c27803">${t} 소계</td><td style="text-align:center;font-weight:600;color:#c27803">${r2(v)}kg</td><td></td></tr>`).join(''); })()}
      </tbody><tfoot><tr><td colspan="5" style="text-align:center;font-weight:600">합계</td><td style="text-align:center;font-weight:600;color:#c27803">${r2(ck.reduce((s,r)=>s+(parseFloat(r.kg)||0),0))}kg</td><td></td></tr></tfoot>
    </table></div>`;
  }
  else if(key === 'sh'){
    const sh = d.sh.filter((r,i,a)=>a.findIndex(x=>x.wagonIn===r.wagonIn&&x.date===r.date&&x.start===r.start&&x.kg===r.kg)===i);
    if(!sh.length){ body.innerHTML='<div class="emp">데이터 없음</div>'; return; }
    body.innerHTML = `<div style="overflow-x:auto"><table class="tbl" style="width:100%">
      <th style="text-align:center"ead><tr><th style="text-align:center">날짜</th><th style="text-align:center">투입와건</th><th style="text-align:center">시작</th><th style="text-align:center">종료</th>
      <th style="text-align:center" class="tr">인원</th><th style="text-align:center" class="tr">파쇄KG</th><th style="text-align:center" class="tr">비가식부KG</th><th style="text-align:center">배출와건</th></tr></thead>
      <tbody>${sh.map(r=>`<tr>
        <td style="text-align:center">${String(r.date||'').slice(0,10)}</td>
        <td style="text-align:center;font-weight:600">${r.wagonIn||'-'}</td>
        <td style="text-align:center">${r.start||'-'}</td>
        <td style="text-align:center">${r.end||'-'}</td>
        <td style="text-align:center">${r.workers||0}</td>
        <td style="text-align:center" style="font-weight:600;color:var(--s)">${r2(parseFloat(r.kg)||0)}</td>
        <td style="text-align:center">${r2(parseFloat(r.waste)||0)}</td>
        <td style="text-align:center">${r.wagonOut||'-'}</td>
      </tr>`).join('')}
      </tbody><tfoot><tr><td colspan="5" style="text-align:center;font-weight:600">합계</td><td style="text-align:center;font-weight:600;color:#c27803">${r2(sh.reduce((s,r)=>s+(parseFloat(r.kg)||0),0))}kg</td><td></td><td></td></tr></tfoot>
    </table></div>`;
  }
  else if(key === 'pk'){
    const pk = d.pk.filter((r,i,a)=>a.findIndex(x=>x.machine===r.machine&&x.date===r.date&&x.start===r.start&&x.ea===r.ea)===i);
    if(!pk.length){ body.innerHTML='<div class="emp">데이터 없음</div>'; return; }
    body.innerHTML = `<div style="overflow-x:auto"><table class="tbl" style="width:100%">
      <th style="text-align:center"ead><tr><th style="text-align:center">날짜</th><th style="text-align:center">설비</th><th style="text-align:center">제품명</th><th style="text-align:center">와건</th><th style="text-align:center">시작</th><th style="text-align:center">종료</th>
      <th style="text-align:center" class="tr">생산EA</th><th style="text-align:center" class="tr">불량EA</th><th style="text-align:center" class="tr">불량률</th></tr></thead>
      <tbody>${pk.map(r=>{
        const defR = parseFloat(r.ea)>0 ? r2(parseFloat(r.defect)/parseFloat(r.ea)*100).toFixed(2)+'%' : '-';
        return `<tr>
          <td style="text-align:center">${String(r.date||'').slice(0,10)}</td>
          <td style="text-align:center">${r.machine||'-'}</td>
          <td>${r.product||'-'}</td>
          <td style="text-align:center">${r.wagon||r.cart||'-'}</td>
          <td style="text-align:center">${r.start||'-'}</td>
          <td style="text-align:center">${r.end||'-'}</td>
          <td style="text-align:center" style="font-weight:600;color:var(--p)">${(parseFloat(r.ea)||0).toLocaleString()}</td>
          <td style="text-align:center">${r.defect||0}</td>
          <td style="text-align:center" style="color:var(--d)">${defR}</td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr>
        <td colspan="6" style="text-align:center;font-weight:600">합계</td>
        <td style="text-align:center" style="font-weight:600;color:var(--p)">${pk.reduce((s,r)=>s+(parseFloat(r.ea)||0),0).toLocaleString()}</td>
        <td style="text-align:center">${pk.reduce((s,r)=>s+(parseFloat(r.defect)||0),0)}</td>
        <td style="text-align:center"></td>
      </tr></tfoot>
    </table></div>`;
  }

  detail.scrollIntoView({behavior:'smooth', block:'start'});
}

async function renderTrTbl(){ /* 더 이상 사용 안 함 */ }

// ============================================================
// ============================================================
// 이력추적 타임라인 렌더링
// ============================================================
function renderTraceTimeline() {
  const d = _traceData;
  const el = document.getElementById('trTimeline');
  const card = document.getElementById('trTimelineCard');
  if (!el) return;
  if (!d || !d.pk || !d.pk.length) { el.innerHTML = ''; if(card) card.style.display='none'; return; }
  if(card) card.style.display='';

  // 시간(HH:MM) → 분
  const toMin = t => { if(!t) return null; const [h,m]=t.split(':').map(Number); return h*60+m; };
  // 분 → HH:MM
  const toHHMM = m => { const h=Math.floor(m/60); return String(h).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); };

  // 시간 → 퍼센트 (05:00 ~ 20:30)
  const START_MIN = 5*60;
  const TOTAL_MIN = 15*60; // 05:00~20:00
  const pct = t => {
    const m = toMin(t);
    if(m===null) return null;
    return Math.max(0, Math.min(100, ((m - START_MIN) / TOTAL_MIN) * 100));
  };
  const widthPct = (s,e) => {
    const sp=pct(s), ep=pct(e);
    if(sp===null||ep===null) return 0;
    return Math.max(0.5, ep-sp);
  };

  // 원육타입 목록
  const types = [...new Set([...d.pp,...d.ck,...d.sh,...d.pk].map(r=>r.type).filter(Boolean))];

  // 와건→타입 매핑
  const wagonType = {};
  d.ck.forEach(r => {
    const t = r.type||'';
    (r.wagonOut||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(w=>{ wagonType[w]=t; });
  });
  d.sh.forEach(r => {
    const w=(r.wagonIn||'').trim();
    if(w && !wagonType[w]) wagonType[w]=r.type||'';
  });

  // 와건 색상 매핑
  const wagonPalette = ['#FEF3C7|#92400E','#D1FAE5|#065F46','#EDE9FE|#5B21B6','#FCE7F3|#9D174D','#FFEDD5|#7C2D12','#E0F2FE|#0C4A6E','#FEE2E2|#991B1B','#ECFCCB|#365314'];
  const allWagons = [...new Set([...d.sh.map(r=>r.wagonIn),...d.pk.flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()))].filter(Boolean))];
  const wCM = {};
  allWagons.forEach((w,i)=>{ wCM[w]=wagonPalette[i%wagonPalette.length]; });

  const wBadge = w => {
    if(!w) return '';
    const [bg,col]=(wCM[w]||'#F3F4F6|#374151').split('|');
    return `<span style="display:inline-block;font-size:9px;padding:1px 4px;border-radius:3px;background:${bg};color:${col};font-weight:600;margin:0 1px">${w}</span>`;
  };

  const barC = {
    pp:{bg:'#B5D4F4',c:'#0C447C'},
    ck:{bg:'#9FE1CB',c:'#085041'},
    sh:{bg:'#FAC775',c:'#633806'},
    pk:{bg:'#CE93D8',c:'#4B1528'},
    rt:{bg:'#FDA4AF',c:'#9F1239'},
  };

  const LW = 120; // 라벨 width

  const makeBar = (kind, left, width, label) => {
    const c = barC[kind];
    return `<div style="position:absolute;left:${left.toFixed(1)}%;width:${Math.max(width,0.5).toFixed(1)}%;height:100%;border-radius:3px;background:${c.bg};display:flex;align-items:center;overflow:hidden">
      <span style="font-size:9px;padding:0 4px;white-space:nowrap;color:${c.c}">${label}</span></div>`;
  };

  const makeRow = (label, bar, dtype) =>
    `<div class="tr-tl-row" data-type="${dtype}" style="display:flex;align-items:center;margin-bottom:2px;min-height:18px">
      <div style="width:${LW}px;flex-shrink:0;font-size:9px;color:var(--g4);text-align:right;padding-right:6px;line-height:1.4;word-break:keep-all">${label}</div>
      <div style="flex:1;height:16px;background:var(--g1);border-radius:3px;position:relative">${bar}</div>
    </div>`;

  const secLbl = txt =>
    `<div style="font-size:9px;color:var(--g3);padding-left:${LW}px;margin:6px 0 2px;font-weight:500;letter-spacing:.2px">— ${txt}</div>`;

  let rows = '';

  // ── 전처리 (타입별 1행)
  rows += secLbl('전처리');
  const ppByType = {};
  d.pp.forEach(r => {
    const t=r.type||'기타';
    if(!ppByType[t]) ppByType[t]={starts:[],ends:[],cages:[]};
    ppByType[t].starts.push(r.start);
    ppByType[t].ends.push(r.end);
    ppByType[t].cages.push(...(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean));
  });
  Object.entries(ppByType).forEach(([t,v]) => {
    const s=v.starts.filter(Boolean).sort()[0];
    const e=v.ends.filter(Boolean).sort().pop();
    const sp=pct(s), wp=widthPct(s,e);
    if(sp!==null) {
      const cages=[...new Set(v.cages)].join(',');
      rows += makeRow(`${t} → 케이지 ${cages||'-'}`, makeBar('pp',sp,wp,`${s}→${e}`), t);
    }
  });

  // ── 자숙 (탱크별, 배출와건 표시)
  rows += secLbl('자숙');
  d.ck.forEach(r => {
    const sp=pct(r.start), wp=widthPct(r.start,r.end);
    if(sp===null) return;
    const t=r.type||'-';
    const outW=(r.wagonOut||'').split(',').map(w=>w.trim()).filter(Boolean);
    const wBadgesHtml = outW.map(wBadge).join('');
    rows += `<div class="tr-tl-row" data-type="${t}" style="display:flex;align-items:flex-start;margin-bottom:2px">
      <div style="width:${LW}px;flex-shrink:0;font-size:9px;color:var(--g4);text-align:right;padding-right:6px;padding-top:2px;line-height:1.5">
        ${r.tank||''}탱크·${r.cage||''}<br>→ ${wBadgesHtml||'-'}
      </div>
      <div style="flex:1;height:16px;background:var(--g1);border-radius:3px;position:relative;margin-top:2px">${makeBar('ck',sp,wp,`${r.start}→${r.end}`)}</div>
    </div>`;
  });

  // ── 파쇄 (와건별)
  rows += secLbl('파쇄');
  d.sh.forEach(r => {
    const sp=pct(r.start), wp=widthPct(r.start,r.end);
    if(sp===null) return;
    const w=(r.wagonIn||'').trim();
    const t=wagonType[w]||r.type||'-';
    const outW=(r.wagonOut||'').split(',').map(x=>x.trim()).filter(Boolean);
    rows += makeRow(
      `${wBadge(w)}→${outW.map(wBadge).join('')||wBadge(w)}`,
      makeBar('sh',sp,wp,`${r.start}→${r.end}`), t);
  });

  // ── 내포장 (포장건별)
  rows += secLbl('내포장');
  d.pk.forEach(r => {
    const sp=pct(r.start), wp=widthPct(r.start,r.end);
    if(sp===null) return;
    const wagons=[...(r.wagon||'').split(','),...(r.cart||'').split(',')].map(w=>w.trim()).filter(Boolean);
    const t=r.type||(wagons.length?wagonType[wagons[0]]:'')||'-';
    rows += makeRow(
      `${r.machine||''} ${wagons.map(wBadge).join('')}`,
      makeBar('pk',sp,wp,`${r.start}→${r.end} · ${(r.ea||0).toLocaleString()}EA`), t);
  });

  // ── 레토르트 (FC/홍두깨, 2차 가열 입력 기준 계산)
  const fcPk = d.pk.filter(r=>(r.product||'').includes('FC')||(r.product||'').includes('3KG'));
  if(fcPk.length) {
    const RT_TOTAL = 135; // 총 135분
    const RT_2ND_OFFSET = 25; // 시작 후 25분 = 2차 가열 시작
    const rtType = '홍두깨';
    rows += secLbl('레토르트');

    // 내포장 마지막 종료 시간
    const pkEndMin = fcPk.map(r=>toMin(r.end)).filter(v=>v!==null).reduce((a,b)=>Math.max(a,b), 0);

    // 레토르트 2호기 (먼저 돈 것): 2차 가열 17:22 입력 기준
    // 시작 = 2차가열 - 25분, 종료 = 시작 + 135분
    const rt2nd_2h = toMin('17:22'); // 2호기 2차 가열 시작
    const rt2hStart = rt2nd_2h - RT_2ND_OFFSET;
    const rt2hEnd   = rt2hStart + RT_TOTAL;
    const sp2h=pct(toHHMM(rt2hStart)), wp2h=widthPct(toHHMM(rt2hStart),toHHMM(rt2hEnd));
    if(sp2h!==null) rows += makeRow(
      `레토르트 2호기`,
      makeBar('rt',sp2h,wp2h,`${toHHMM(rt2hStart)}→${toHHMM(rt2hEnd)}`), rtType);

    // 레토르트 1호기 (나중에 돈 것): 내포장 종료 후 시작, 2차 가열 25분 후
    const rt1hStart = pkEndMin;
    const rt1hEnd   = rt1hStart + RT_TOTAL;
    const sp1h=pct(toHHMM(rt1hStart)), wp1h=widthPct(toHHMM(rt1hStart),toHHMM(rt1hEnd));
    if(sp1h!==null) rows += makeRow(
      `레토르트 1호기`,
      makeBar('rt',sp1h,wp1h,`${toHHMM(rt1hStart)}→${toHHMM(rt1hEnd)}`), rtType);
  }

  // ── 필터 버튼
  const filterBtns = ['전체',...types].map(t =>
    `<button onclick="trTlFilter('${t}',this)" style="font-size:11px;padding:3px 10px;border-radius:20px;border:0.5px solid var(--g2);background:${t==='전체'?'var(--s)':'var(--bg)'};color:${t==='전체'?'#fff':'var(--g5)'};cursor:pointer;font-weight:${t==='전체'?'500':'400'}">${t}</button>`
  ).join('');

  // 시간축 — 절대 위치로 막대와 정확히 매칭
  const tlLabels = ['05:00','07:00','09:00','11:00','13:00','15:00','17:00','19:00','20:00'];
  const timeAxis = `<div style="position:relative;margin-left:${LW}px;height:16px;margin-bottom:4px">
    ${tlLabels.map(l=>{
      const p = pct(l);
      return p!==null ? `<div style="position:absolute;left:${p.toFixed(1)}%;font-size:9px;color:var(--g3);transform:translateX(-50%)">${l}</div>` : '';
    }).join('')}
  </div>`;

  // 범례
  const legend = `<div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
    ${[['전처리','#B5D4F4'],['자숙','#9FE1CB'],['파쇄','#FAC775'],['내포장','#CE93D8'],['레토르트','#FDA4AF']].map(([l,c])=>
      `<div style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--g4)">
        <div style="width:9px;height:9px;border-radius:2px;background:${c}"></div>${l}</div>`).join('')}
    <div style="font-size:10px;color:var(--g3)">· 와건 색상 = 공정 간 연결</div>
  </div>`;

  el.innerHTML = `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--g2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:12px;font-weight:600;color:var(--g5)">공정 이력 타임라인</div>
        <div style="display:flex;gap:4px" id="trTlFilters">${filterBtns}</div>
      </div>
      <div style="overflow-x:auto;background:var(--bg);border:1px solid var(--g2);border-radius:8px;padding:10px 12px">
        <div style="min-width:500px">
          ${timeAxis}${rows}
        </div>
      </div>
      ${legend}
    </div>`;
}

function trTlFilter(type, btn) {
  document.querySelectorAll('#trTlFilters button').forEach(b => {
    b.style.background = 'var(--bg)';
    b.style.color = 'var(--g5)';
    b.style.fontWeight = '400';
  });
  btn.style.background = 'var(--s)';
  btn.style.color = '#fff';
  btn.style.fontWeight = '500';
  document.querySelectorAll('.tr-tl-row').forEach(row => {
    if (type === '전체') {
      row.style.display = 'flex';
    } else {
      row.style.display = row.dataset.type === type ? 'flex' : 'none';
    }
  });
}
