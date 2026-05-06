// ============================================================
// 공정 연동: 자숙 완료 와건 → 파쇄 탭
// ============================================================
function renderShWagonList() {
  const today = tod();
  const ckList = L.cooking.filter(r => String(r.date||'').slice(0,10)===today && r.wagonOut && r.end);
  const usedWagons = new Set(L.shredding
    .filter(r=>String(r.date||'').slice(0,10)===today)
    .flatMap(r=>(r.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean)));
  const el = document.getElementById('sh_wagonList');
  if(!el) return;

  // 와건별 자숙 배출량 (wagonDist 우선)
  const wagonOutKg = {};
  ckList.forEach(ck => {
    if(ck.wagonDist){
      Object.entries(ck.wagonDist).forEach(([w,kg])=>{
        wagonOutKg[w] = (wagonOutKg[w]||0) + (parseFloat(kg)||0);
      });
    } else {
      // 호환: wagonDist 없으면 균등 분배
      const ws = (ck.wagonOut||'').split(',').map(x=>x.trim()).filter(Boolean);
      if(ws.length && ck.kg){
        const each = parseFloat(ck.kg)/ws.length;
        ws.forEach(w => { wagonOutKg[w] = (wagonOutKg[w]||0) + each; });
      }
    }
  });

  const wagons = [];
  ckList.forEach(ck => {
    (ck.wagonOut||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(wNum => {
      if(!wagons.find(w=>w.num===wNum))
        wagons.push({ num: wNum, type: ck.type||'', cage: ck.cage||'', used: usedWagons.has(wNum) });
    });
  });
  if(!wagons.length) { el.innerHTML='<div class="emp">자숙 완료된 와건 없음</div>'; return; }
  const pending = wagons.filter(w=>!w.used);
  const done    = wagons.filter(w=>w.used);
  el.innerHTML =
    (pending.length ? '<div style="font-size:12px;font-weight:600;color:var(--g6);margin-bottom:8px">와건 선택 → 자동 입력</div>' : '') +
    pending.map(w => {
      const outKg = wagonOutKg[w.num] || 0;
      const kgText = outKg ? `<span style="font-size:12px;color:#16a34a;font-weight:600;margin-left:8px">${outKg.toFixed(3)}kg</span>` : '';
      return `
      <label style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--g1);border-radius:8px;margin-bottom:6px;cursor:pointer">
        <input type="checkbox" class="sh-wagon-cb" data-wagon="${w.num}" data-type="${w.type}" data-outkg="${outKg}"
          onchange="onShWagonChange()" style="width:18px;height:18px;accent-color:var(--p)">
        <span style="font-size:14px;font-weight:700">${w.num}번 와건</span>
        <span style="font-size:13px;color:var(--g5);margin-left:auto">${w.type||'-'} · 케이지 ${w.cage||'-'}</span>
        ${kgText}
      </label>`;
    }).join('') +
    done.map(w => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f3f4f6;border-radius:8px;margin-bottom:6px;opacity:0.55;cursor:not-allowed">
        <input type="checkbox" disabled style="width:18px;height:18px">
        <span style="font-size:14px;font-weight:700;text-decoration:line-through;color:var(--g5)">${w.num}번 와건</span>
        <span style="font-size:13px;color:var(--g5);margin-left:auto">${w.type||'-'} · 케이지 ${w.cage||'-'}</span>
        <span style="font-size:12px;color:#4caf50;font-weight:600">✅파쇄완료</span>
      </div>`).join('');
  // 입력 행 초기화 보장
  if(typeof initShRows==='function') initShRows();
}

function renderPkWagonList() {
  const today = tod();
  const shList = L.shredding.filter(r => String(r.date||'').slice(0,10)===today && (r.wagonOut || r.cartOut) && r.end);
  // 와건 사용 추적
  const usedWagonInPk = new Set([
    ...L.packing.filter(r=>String(r.date||'').slice(0,10)===today).flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()).filter(Boolean)),
    ...(L.packing_pending||[]).filter(r=>String(r.date||'').slice(0,10)===today).flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()).filter(Boolean))
  ]);
  const inPkWagonDone = new Set(
    L.packing.filter(r=>String(r.date||'').slice(0,10)===today).flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()).filter(Boolean))
  );
  const inPkWagonPending = new Set(
    (L.packing_pending||[]).filter(r=>String(r.date||'').slice(0,10)===today).flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()).filter(Boolean))
  );
  // 카트 사용 추적
  const usedCartInPk = new Set([
    ...L.packing.filter(r=>String(r.date||'').slice(0,10)===today).flatMap(r=>(r.cart||'').split(',').map(w=>w.trim()).filter(Boolean)),
    ...(L.packing_pending||[]).filter(r=>String(r.date||'').slice(0,10)===today).flatMap(r=>(r.cart||'').split(',').map(w=>w.trim()).filter(Boolean))
  ]);
  const inPkCartDone = new Set(
    L.packing.filter(r=>String(r.date||'').slice(0,10)===today).flatMap(r=>(r.cart||'').split(',').map(w=>w.trim()).filter(Boolean))
  );
  const inPkCartPending = new Set(
    (L.packing_pending||[]).filter(r=>String(r.date||'').slice(0,10)===today).flatMap(r=>(r.cart||'').split(',').map(w=>w.trim()).filter(Boolean))
  );
  const el = document.getElementById('pk_wagonList');
  if(!el) return;
  const items = []; // {num, kind, kg, used}
  shList.forEach(sh => {
    // 와건
    if(sh.wagonOutDist){
      Object.entries(sh.wagonOutDist).forEach(([wNum, kg])=>{
        const exist = items.find(x=>x.num===wNum && x.kind==='wagon');
        if(exist) exist.kg += parseFloat(kg)||0;
        else items.push({ num: wNum, kind:'wagon', kg: parseFloat(kg)||0, used: usedWagonInPk.has(wNum) });
      });
    } else {
      (sh.wagonOut||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(wNum => {
        const exist = items.find(x=>x.num===wNum && x.kind==='wagon');
        if(exist) exist.kg += parseFloat(sh.kg)||0;
        else items.push({ num: wNum, kind:'wagon', kg: parseFloat(sh.kg)||0, used: usedWagonInPk.has(wNum) });
      });
    }
    // 카트
    if(sh.cartOutDist){
      Object.entries(sh.cartOutDist).forEach(([cNum, kg])=>{
        const exist = items.find(x=>x.num===cNum && x.kind==='cart');
        if(exist) exist.kg += parseFloat(kg)||0;
        else items.push({ num: cNum, kind:'cart', kg: parseFloat(kg)||0, used: usedCartInPk.has(cNum) });
      });
    }
  });
  if(!items.length) { el.innerHTML='<div class="emp">파쇄 완료된 와건/카트 없음</div>'; return; }

  const getBadge = (num, kind) => {
    let badge = '<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:#e0f2fe;color:#0369a1;font-weight:600">파쇄완료</span>';
    const done = kind === 'cart' ? inPkCartDone : inPkWagonDone;
    const pending = kind === 'cart' ? inPkCartPending : inPkWagonPending;
    if(done.has(num)) badge += ' <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:var(--sl);color:var(--s);font-weight:600">포장완료</span>';
    else if(pending.has(num)) badge += ' <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:var(--pl);color:var(--p);font-weight:600">포장중</span>';
    return badge;
  };

  el.innerHTML = items.map(w => {
    const kindLabel = w.kind === 'cart'
      ? '<span style="font-size:11px;font-weight:600;color:#1a56db;background:#e0f2fe;padding:2px 6px;border-radius:4px;margin-right:6px">카트</span>'
      : '<span style="font-size:11px;font-weight:600;color:#72243E;background:#fde7ef;padding:2px 6px;border-radius:4px;margin-right:6px">와건</span>';
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--g1);border-radius:8px;margin-bottom:6px;${w.used?'opacity:0.8':''}">
      <span style="font-size:14px;font-weight:700">${kindLabel}${w.num}번</span>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:13px;color:var(--g5)">${(parseFloat(w.kg)||0).toFixed(2)}kg</span>
        ${getBadge(w.num, w.kind)}
      </div>
    </div>`;
  }).join('');
}
function onShWagonChange() {
  const checked = [...document.querySelectorAll('.sh-wagon-cb:checked')];
  const c = document.getElementById('sh_rows');
  if(!c) return;
  // 기존 행 입력값 보존
  const existingRows = [...c.querySelectorAll('.sh-row')].map(row => ({
    wagonIn: row.querySelector('.sh-wIn').value.trim(),
    kgIn: (row.querySelector('.sh-in-kg')||{}).value || '',
    start: row.querySelector('.sh-start').value.trim(),
    end: row.querySelector('.sh-end').value.trim(),
    kg: row.querySelector('.sh-kg').value,
    waste: row.querySelector('.sh-waste').value,
    workers: row.querySelector('.sh-workers').value
  }));
  c.innerHTML = '';
  if(checked.length === 0){
    if(existingRows.length) existingRows.forEach(r => shAddRow(r));
    else shAddRow();
    return;
  }
  // 체크된 와건마다 행 생성 + 자숙배출량 자동 채움
  checked.forEach(cb => {
    const wNum = cb.dataset.wagon;
    const existing = existingRows.find(r => r.wagonIn === wNum);
    const data = existing || { wagonIn: wNum };
    // 자숙배출량 자동 채움 (existing kgIn 없을 때만)
    if(!data.kgIn){
      const outKg = parseFloat(cb.dataset.outkg) || 0;
      if(outKg) data.kgIn = outKg.toFixed(3);
    }
    shAddRow(data);
  });
}

// ============================================================
// 파쇄 다행 입력 (와건 → 와건 N:N 분배)
// ============================================================
function _shRowHtml(idx, data){
  data = data || {};
  return `
    <div class="sh-row" data-idx="${idx}" style="border:1px solid var(--g3);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--g1)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong style="font-size:13px;color:var(--g7)">투입 와건 #${idx+1}</strong>
        <button onclick="shRemoveRow(this)" style="font-size:12px;color:var(--d);background:none;border:none;cursor:pointer;padding:4px 8px">✕ 삭제</button>
      </div>
      <div class="fg" style="margin-bottom:8px">
        <div class="fgrp">
          <label class="fl">투입 와건</label>
          <input class="fc sh-wIn" type="text" value="${data.wagonIn||''}" placeholder="예: 22" oninput="shAutoFillIn(this)">
        </div>
        <div class="fgrp">
          <label class="fl">투입 KG <span style="font-size:11px;color:var(--g4)">(자숙배출 자동)</span></label>
          <input class="fc sh-in-kg" type="number" step="0.01" placeholder="0.00" value="${data.kgIn||''}">
        </div>
        <div class="fgrp">
          <label class="fl">시작</label>
          <div style="display:flex;gap:3px">
            <input class="fc sh-start" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" value="${data.start||''}" style="flex:1">
            <button onclick="this.previousElementSibling.value=nowHM()" style="padding:0 8px;font-size:11px;background:#1a56db;color:#fff;border:none;border-radius:4px;cursor:pointer">⏱지금</button>
          </div>
        </div>
        <div class="fgrp">
          <label class="fl">종료</label>
          <div style="display:flex;gap:3px">
            <input class="fc sh-end" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" value="${data.end||''}" style="flex:1">
            <button onclick="this.previousElementSibling.value=nowHM()" style="padding:0 8px;font-size:11px;background:var(--s);color:#fff;border:none;border-radius:4px;cursor:pointer">⏱지금</button>
          </div>
        </div>
        <div class="fgrp">
          <label class="fl">배출 KG <span style="font-size:11px;color:var(--g4)">(자동)</span></label>
          <input class="fc sh-kg" type="number" step="0.01" placeholder="0.00" value="${data.kg||''}" readonly style="background:#f8f8f8">
        </div>
        <div class="fgrp">
          <label class="fl">비가식부 KG</label>
          <input class="fc sh-waste" type="number" step="0.01" placeholder="0.00" value="${data.waste||''}">
        </div>
        <div class="fgrp">
          <label class="fl">인원</label>
          <input class="fc sh-workers" type="number" placeholder="0" value="${data.workers||''}">
        </div>
      </div>
      <div style="font-size:11px;color:var(--g5);margin-bottom:4px">배출 (와건/카트 + kg)</div>
      <div class="sh-out-list" style="display:flex;flex-direction:column;gap:4px"></div>
      <div style="display:flex;gap:4px;margin-top:6px;align-items:center;justify-content:space-between;font-size:11px;flex-wrap:wrap">
        <div style="display:flex;gap:4px">
          <button onclick="shAddOutWagon(this,'wagon')" style="padding:4px 8px;font-size:11px;border:1px dashed #72243E;background:#fff;color:#72243E;border-radius:4px;cursor:pointer">+ 배출 와건</button>
          <button onclick="shAddOutWagon(this,'cart')" style="padding:4px 8px;font-size:11px;border:1px dashed #1a56db;background:#fff;color:#1a56db;border-radius:4px;cursor:pointer">+ 배출 카트</button>
        </div>
        <span class="sh-out-sum" style="color:var(--g5);font-weight:500">배출 0kg</span>
      </div>
    </div>`;
}

// 투입 와건번호 입력 시 자숙 배출량 자동 채움
function shAutoFillIn(inputEl){
  const wn = String(inputEl.value||'').trim();
  if(!wn) return;
  const row = inputEl.closest('.sh-row');
  if(!row) return;
  const inKgInp = row.querySelector('.sh-in-kg');
  if(!inKgInp || inKgInp.value) return; // 이미 값 있으면 덮지 않음
  // 자숙에서 해당 와건 배출량 찾기
  let kg = 0;
  L.cooking.forEach(ck => {
    if(ck.wagonDist && ck.wagonDist[wn]){
      kg += parseFloat(ck.wagonDist[wn])||0;
    } else if((ck.wagonOut||'').split(',').map(x=>x.trim()).includes(wn)){
      const ws = (ck.wagonOut||'').split(',').map(x=>x.trim()).filter(Boolean);
      if(ws.length) kg += (parseFloat(ck.kg)||0)/ws.length;
    }
  });
  if(kg) inKgInp.value = kg.toFixed(2);
}

function shAddOutWagon(btnInRow, kind){
  kind = kind === 'cart' ? 'cart' : 'wagon';
  const row = btnInRow.closest('.sh-row');
  if(!row) return;
  const list = row.querySelector('.sh-out-list');
  const oRow = document.createElement('div');
  oRow.className = 'sh-out-row';
  oRow.dataset.kind = kind;
  oRow.style.cssText = 'display:grid;grid-template-columns:60px 1fr 1fr 28px;gap:4px;align-items:center';
  const label = kind === 'cart'
    ? '<span style="font-size:11px;font-weight:600;color:#1a56db;background:#e0f2fe;padding:3px 6px;border-radius:4px;text-align:center">카트</span>'
    : '<span style="font-size:11px;font-weight:600;color:#72243E;background:#fde7ef;padding:3px 6px;border-radius:4px;text-align:center">와건</span>';
  const placeholder = kind === 'cart' ? '배출 카트번호' : '배출 와건번호';
  oRow.innerHTML = `
    ${label}
    <input class="fc sh-out-num" type="text" placeholder="${placeholder}" oninput="shOutSumChange(this)" style="padding:5px 7px;font-size:12px;box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:2px">
      <input class="fc sh-out-kg" type="number" step="0.01" placeholder="0" oninput="shOutSumChange(this)" style="padding:5px 7px;font-size:12px;box-sizing:border-box;flex:1;text-align:right">
      <span style="font-size:11px;color:var(--g5)">kg</span>
    </div>
    <button onclick="this.closest('.sh-out-row').remove();shOutSumChange(this)" style="width:24px;height:28px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:var(--d);font-size:13px;cursor:pointer;padding:0">−</button>`;
  list.appendChild(oRow);
}

function shOutSumChange(el){
  const row = el.closest('.sh-row');
  if(!row) return;
  let sum = 0;
  row.querySelectorAll('.sh-out-row').forEach(r => {
    sum += parseFloat((r.querySelector('.sh-out-kg')||{}).value) || 0;
  });
  const sumEl = row.querySelector('.sh-out-sum');
  if(sumEl) sumEl.textContent = `배출 ${sum.toFixed(2)}kg`;
  const kgInp = row.querySelector('.sh-kg');
  if(kgInp) kgInp.value = sum ? sum.toFixed(2) : '';
}

function shAddRow(data){
  const c = document.getElementById('sh_rows');
  if(!c) return;
  const idx = c.children.length;
  const wrap = document.createElement('div');
  wrap.innerHTML = _shRowHtml(idx, data).trim();
  c.appendChild(wrap.firstChild);
  // 첫 배출 와건 행 자동 추가 — '+ 배출 와건' 버튼만 정확히 찾기
  const newRow = c.lastElementChild;
  if(newRow && typeof shAddOutWagon === 'function'){
    const addBtn = [...newRow.querySelectorAll('button')]
      .find(b => /shAddOutWagon\(this,'wagon'\)/.test(b.getAttribute('onclick')||''));
    if(addBtn) shAddOutWagon(addBtn, 'wagon');
  }
}

function shRemoveRow(btn){
  const row = btn.closest('.sh-row');
  if(row) row.remove();
  document.querySelectorAll('#sh_rows .sh-row').forEach((r,i)=>{
    r.dataset.idx = i;
    const s = r.querySelector('strong'); if(s) s.textContent = '와건 #'+(i+1);
  });
  const c = document.getElementById('sh_rows');
  if(c && c.children.length===0) shAddRow();
}

async function saveShAll(){
  const rows = [...document.querySelectorAll('#sh_rows .sh-row')];
  if(!rows.length){ toast('입력된 와건이 없습니다','d'); return; }

  const recs = [];
  rows.forEach(row => {
    // 배출 분배 수집 (와건 / 카트 분리)
    const wagonOutDist = {};
    const cartOutDist  = {};
    const wagonOutList = [];
    const cartOutList  = [];
    row.querySelectorAll('.sh-out-row').forEach(o => {
      const kind = o.dataset.kind === 'cart' ? 'cart' : 'wagon';
      const wn = (o.querySelector('.sh-out-num')||{}).value || '';
      const kg = parseFloat((o.querySelector('.sh-out-kg')||{}).value) || 0;
      if(wn && kg){
        const key = String(wn).trim();
        if(kind === 'cart'){
          cartOutDist[key] = (cartOutDist[key]||0) + kg;
          if(!cartOutList.includes(key)) cartOutList.push(key);
        } else {
          wagonOutDist[key] = (wagonOutDist[key]||0) + kg;
          if(!wagonOutList.includes(key)) wagonOutList.push(key);
        }
      }
    });
    let totalOutKg = 0;
    Object.values(wagonOutDist).forEach(v => totalOutKg += v);
    Object.values(cartOutDist ).forEach(v => totalOutKg += v);

    const d = {
      id: gid(),
      date: (typeof DDATE!=='undefined' && DDATE) || tod(),
      wagonIn: row.querySelector('.sh-wIn').value.trim(),
      wagonOut: wagonOutList.join(','),
      wagonOutDist: wagonOutDist,
      cartOut: cartOutList.join(','),
      cartOutDist: cartOutDist,
      start: row.querySelector('.sh-start').value.trim(),
      end: row.querySelector('.sh-end').value.trim(),
      kg: totalOutKg,                                             // 배출 (다음 공정으로) - 와건+카트 합산
      kgIn: parseFloat((row.querySelector('.sh-in-kg')||{}).value) || 0, // 투입 (자숙에서 빠짐)
      waste: parseFloat(row.querySelector('.sh-waste').value) || 0,
      workers: parseFloat(row.querySelector('.sh-workers').value) || 0
    };
    if(!d.wagonIn && !d.kg && !d.start) return;
    recs.push(d);
  });

  if(!recs.length){ toast('저장할 내용 없음','d'); return; }

  toast(`파쇄 ${recs.length}건 저장중...`,'i');
  let okCount = 0, failCount = 0;
  for(const d of recs){
    L.shredding.push(d); saveL();
    const fbId = await fbSave('shredding', d);
    if(fbId){
      d.fbId = fbId; saveL();
      okCount++;
    } else {
      failCount++;
    }
  }

  // 폼 초기화
  document.getElementById('sh_rows').innerHTML = '';
  shAddRow();
  document.querySelectorAll('.sh-wagon-cb:checked').forEach(cb => cb.checked = false);

  if(typeof renderPL==='function') renderPL('shredding');
  if(typeof renderShWagonList==='function') renderShWagonList();
  if(typeof renderPkWagonList==='function') renderPkWagonList();

  if(failCount===0) toast(`파쇄 ${okCount}건 저장됨 ✓`,'s');
  else toast(`파쇄 ${okCount}건 저장, ${failCount}건 실패`,'d');
}

// 초기 빈 행 보장
function initShRows(){
  const c = document.getElementById('sh_rows');
  if(c && c.children.length === 0) shAddRow();
}

// ============================================================
// 파쇄 탭 - 지금시작 버튼 (제거됨, 다행 구조에서는 카드별 시간 입력)
// ============================================================
var _shStartTime = '';

function onShStartBtn(){ /* deprecated */ }