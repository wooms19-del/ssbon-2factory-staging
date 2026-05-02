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
        <td style="text-align:center">${r.totalKg||0}</td>
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
        <td style="text-align:center" style="font-weight:600;color:var(--s)">${r.kg||0}</td>
        <td style="text-align:center">${r.waste||0}</td>
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
        <td style="text-align:center" style="font-weight:600;color:var(--s)">${r.kg||0}</td>
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
        <td style="text-align:center" style="font-weight:600;color:var(--s)">${r.kg||0}</td>
        <td style="text-align:center">${r.waste||0}</td>
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
          <td style="text-align:center">${r.cart||'-'}</td>
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