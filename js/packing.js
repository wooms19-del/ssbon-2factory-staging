// ============================================================
// 포장 탭 - 시작/진행중/종료 3단계
// ============================================================

var _pkRowIdx = 0;

// ============================================================
// 파쇄 완료 와건 잔량 표시 (포장 탭 상단)
// → 파쇄에서 산출된 와건 - 포장에서 사용된 양 = 잔량
// ============================================================

// ★ 파쇄 end 시간순으로 와건 목록 만들기 (공통 함수 - renderPkWagonList + addPkMachRow가 같은 순서 사용)
function getPkWagonsInOrder(){
  const today = tod();
  const ordered = [];  // [{wagon, type, kg, end}]  end 빠른 것부터
  // 파쇄 record를 end 시간순으로 정렬
  const shList = (L.shredding||[]).filter(r => {
    const d = String(r.date||'').slice(0,10);
    return d === today && r.end && (r.wagonOut || r.cartOut);
  }).sort((a, b) => {
    const ea = String(a.end||'');
    const eb = String(b.end||'');
    if(ea === eb) return 0;
    return ea < eb ? -1 : 1;
  });
  // 각 파쇄 record에서 와건 추출 (record의 end 시간 = 그 와건의 end 시간)
  const seen = new Set();
  shList.forEach(sh => {
    let wagonList = [];
    if(sh.wagonOutDist){
      wagonList = Object.entries(sh.wagonOutDist).map(([w, kg]) => ({w, kg: parseFloat(kg)||0}));
    } else if(sh.wagonOut){
      const ws = (sh.wagonOut||'').split(',').map(x => x.trim()).filter(Boolean);
      if(ws.length){
        const each = (parseFloat(sh.kg)||0) / ws.length;
        wagonList = ws.map(w => ({w, kg: each}));
      }
    }
    wagonList.forEach(({w, kg}) => {
      if(seen.has(w)){
        // 같은 와건이 여러 파쇄 record에 걸쳐있으면 kg만 합산 (순서는 첫 등장 유지)
        const existing = ordered.find(x => x.wagon === w);
        if(existing) existing.kg += kg;
        return;
      }
      seen.add(w);
      ordered.push({ wagon: w, type: sh.type || '', kg, end: sh.end });
    });
  });
  return ordered;
}

// ★ 와건별 사용량 (포장 + 진행중 포장)
function getPkUsedByWagon(){
  const today = tod();
  const usedMap = {};
  const pkRecs = [
    ...(L.packing||[]).filter(r => String(r.date||'').slice(0,10) === today),
    ...(L.packing_pending||[]).filter(r => String(r.date||'').slice(0,10) === today),
  ];
  pkRecs.forEach(pk => {
    if(pk.wagonDist){
      Object.entries(pk.wagonDist).forEach(([w, kg]) => {
        usedMap[w] = (usedMap[w] || 0) + (parseFloat(kg) || 0);
      });
    } else if(pk.wagon){
      const ws = (pk.wagon||'').split(',').map(x => x.trim()).filter(Boolean);
      if(ws.length){
        const each = (parseFloat(pk.kg || pk.totalKg)||0) / ws.length;
        ws.forEach(w => { usedMap[w] = (usedMap[w] || 0) + each; });
      }
    }
  });
  return usedMap;
}

function renderPkWagonList(){
  const el = document.getElementById('pk_wagonList');
  if(!el) return;
  const ordered = getPkWagonsInOrder();
  const usedMap = getPkUsedByWagon();
  const wagons = ordered.map(o => ({
    wagon: o.wagon,
    type: o.type,
    total: o.kg,
    used: usedMap[o.wagon] || 0,
    remain: o.kg - (usedMap[o.wagon] || 0),
  }));
  if(!wagons.length){
    el.innerHTML = '<div class="emp">파쇄 완료된 와건 없음</div>';
    return;
  }
  // 부위별 합계
  const byType = {};
  wagons.forEach(w => {
    if(!byType[w.type]) byType[w.type] = {total:0, remain:0};
    byType[w.type].total += w.total;
    byType[w.type].remain += w.remain;
  });
  const sumHtml = Object.entries(byType).map(([ty, v]) => {
    const color = v.remain < 0.01 ? '#9ca3af' : '#16a34a';
    return `
      <div style="background:#f0fdf4;border:1px solid #16a34a;border-radius:8px;padding:6px 12px;font-size:13px">
        <strong style="color:#16a34a">${ty}</strong> · 잔량 <strong style="color:${color}">${v.remain.toFixed(2)}kg</strong>
        <span style="font-size:11px;color:#6b7280;margin-left:4px">/ 산출 ${v.total.toFixed(2)}kg</span>
      </div>`;
  }).join('');
  // 와건별 칩 (파쇄 end 시간순)
  const chipHtml = wagons.map(w => {
    const done = w.remain < 0.01;
    const colorAfter = done ? '#9ca3af' : '#16a34a';
    const deco = done ? 'text-decoration:line-through;opacity:0.55' : '';
    return `
      <span style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:3px 8px;font-size:11px;${deco}">
        와건${w.wagon} (${w.type}) <strong style="color:${colorAfter}">${w.remain.toFixed(2)}kg</strong>
        ${w.used > 0 ? `<span style="font-size:10px;color:#6b7280;margin-left:3px">(사용 ${w.used.toFixed(2)})</span>` : ''}
      </span>`;
  }).join('');
  el.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">${sumHtml}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${chipHtml}</div>
  `;
}

// 설비 시작 행 추가
function addPkMachRow(){
  const idx = _pkRowIdx++;
  const prodOpts = '<option value="">선택</option>'+L.products.map(p=>`<option>${p.name}</option>`).join('');
  const subOpts = '<option value="">없음</option>'+(L.submats||[]).map(s=>`<option>${s}</option>`).join('');

  // 파쇄 완료 와건/카트 목록 생성 (kg 포함, wagonOutDist + cartOutDist 우선)
  // today만 봄 — 어제 파쇄된 건 위 "파쇄 완료 와건 현황"에도 안 보이므로 일관성 유지
  const today = tod();
  const yesterday = getYesterday_();
  const shWagonsMap = {}; // {와건번호: 총kg}
  const shCartsMap  = {}; // {카트번호: 총kg}
  L.shredding.filter(r=>{
    const d = String(r.date||'').slice(0,10);
    return d===today && (r.wagonOut || r.cartOut) && r.end;
  }).forEach(sh=>{
    if(sh.wagonOutDist){
      Object.entries(sh.wagonOutDist).forEach(([w,kg])=>{
        shWagonsMap[w] = (shWagonsMap[w]||0) + (parseFloat(kg)||0);
      });
    } else if(sh.wagonOut){
      // 호환: wagonOutDist 없으면 sh.kg을 와건들에 균등 분배 (추정)
      const ws = (sh.wagonOut||'').split(',').map(x=>x.trim()).filter(Boolean);
      if(ws.length){
        const each = (parseFloat(sh.kg)||0)/ws.length;
        ws.forEach(w => { shWagonsMap[w] = (shWagonsMap[w]||0) + each; });
      }
    }
    // 카트는 cartOutDist만 인식 (균등 폴백 없음 - 신규 필드라)
    if(sh.cartOutDist){
      Object.entries(sh.cartOutDist).forEach(([c,kg])=>{
        shCartsMap[c] = (shCartsMap[c]||0) + (parseFloat(kg)||0);
      });
    }
  });
  const shWagons = Object.keys(shWagonsMap);
  const shCarts  = Object.keys(shCartsMap);
  // 완료/사용중 판정 - 잔여 ≤ 0 이면 차단
  // (오늘 shredding output 와건만 보여주므로 사용량도 오늘 packing 만 차감.
  //  와건 번호는 매일 재사용되므로 어제 와건 6번 ≠ 오늘 와건 6번.)
  const usedMap = {};      // 와건 사용량
  const usedCartMap = {};  // 카트 사용량
  (L.packing||[]).filter(p => {
    const d = String(p.date||'').slice(0,10);
    return d===today;
  }).forEach(p => {
    if(p.wagonDist){
      Object.entries(p.wagonDist).forEach(([w,kg])=>{ usedMap[w]=(usedMap[w]||0)+(parseFloat(kg)||0); });
    } else if(p.wagon){
      (p.wagon||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(w=>{
        // wagonDist 없으면 와건의 총량을 다 썼다고 가정
        usedMap[w] = (usedMap[w]||0) + (shWagonsMap[w]||0);
      });
    }
    if(p.cartDist){
      Object.entries(p.cartDist).forEach(([c,kg])=>{ usedCartMap[c]=(usedCartMap[c]||0)+(parseFloat(kg)||0); });
    } else if(p.cart){
      (p.cart||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(c=>{
        usedCartMap[c] = (usedCartMap[c]||0) + (shCartsMap[c]||0);
      });
    }
  });
  (L.packing_pending||[]).filter(p => {
    const d = String(p.date||'').slice(0,10);
    if(d !== today) return false;
    // 옵션 C: 수정 중인 record는 자기 자신 점유분이라 사용량에서 제외
    if(_pkEditingId && p.id === _pkEditingId) return false;
    return true;
  }).forEach(p => {
    if(p.wagonDist){
      Object.entries(p.wagonDist).forEach(([w,kg])=>{ usedMap[w]=(usedMap[w]||0)+(parseFloat(kg)||0); });
    } else if(p.wagon){
      (p.wagon||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(w=>{
        usedMap[w] = (usedMap[w]||0) + (shWagonsMap[w]||0);
      });
    }
    if(p.cartDist){
      Object.entries(p.cartDist).forEach(([c,kg])=>{ usedCartMap[c]=(usedCartMap[c]||0)+(parseFloat(kg)||0); });
    } else if(p.cart){
      (p.cart||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(c=>{
        usedCartMap[c] = (usedCartMap[c]||0) + (shCartsMap[c]||0);
      });
    }
  });
  // ★ DOM에 있는 다른 설비 카드 입력값(아직 저장 안 됨)도 합산
  // 같은 와건을 다른 카드에서 못 쓰게 차단
  document.querySelectorAll('#pk_machRows .pk-w-entry-row').forEach(entryRow => {
    const wEl = entryRow.querySelector('.pk-w-num');
    const kgEl = entryRow.querySelector('.pk-w-kg');
    if(!wEl || !kgEl) return;
    const w = (wEl.value||'').trim();
    const kg = parseFloat(kgEl.value)||0;
    if(w && kg > 0){
      usedMap[w] = (usedMap[w]||0) + kg;
    }
  });
  document.querySelectorAll('#pk_machRows .pk-c-entry-row').forEach(entryRow => {
    const cEl = entryRow.querySelector('.pk-c-num');
    const kgEl = entryRow.querySelector('.pk-c-kg');
    if(!cEl || !kgEl) return;
    const c = (cEl.value||'').trim();
    const kg = parseFloat(kgEl.value)||0;
    if(c && kg > 0){
      usedCartMap[c] = (usedCartMap[c]||0) + kg;
    }
  });
  // ★ 와건 옵션/칩을 파쇄 end 시간순으로 정렬
  const orderedWagons = (typeof getPkWagonsInOrder==='function') ? getPkWagonsInOrder().map(o => o.wagon) : Object.keys(shWagonsMap);
  // shWagons 정렬 적용
  const shWagonsSorted = orderedWagons.filter(w => shWagonsMap[w] !== undefined);
  const wagonOpts = '<option value="">직접입력</option>' + shWagonsSorted.map(w=>`<option value="${w}">${w}번 와건</option>`).join('');

  const row = document.createElement('div');
  row.id = 'pkRow_'+idx;
  row.style.cssText = 'background:var(--g1);border-radius:8px;padding:12px;margin-bottom:8px;position:relative';
  row.innerHTML = `
    <button onclick="removePkRow(${idx})" style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--g4);font-size:16px;cursor:pointer">✕</button>
    <div class="fg">
      <div class="fgrp cs2">
        <label class="fl">제품명 <span class="req">*</span></label>
        <select class="fc pk-row-prod" data-idx="${idx}" onchange="onPkRowProd(${idx})">${prodOpts}</select>
      </div>
      <div class="fgrp">
        <label class="fl">설비 번호</label>
        <select class="fc pk-row-mach" data-idx="${idx}">
          <option value="">선택</option><option>1호기</option><option>2호기</option><option>3호기</option><option>4호기</option>
        </select>
      </div>
      <div class="fgrp cs2 pk-wagon-section">
        <label class="fl">투입 와건/카트 <span style="font-size:11px;color:var(--g4)">(버튼 토글 → 카드별 kg 분배)</span></label>
        <div id="pkWagonBtns_${idx}" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
          ${shWagonsSorted.map(w=>{
            const total = shWagonsMap[w]||0;
            const used = usedMap[w]||0;
            const remain = total - used;
            const isDone = remain < 0.01;
            const style = isDone
              ? 'padding:4px 10px;border-radius:16px;border:1.5px solid var(--g3);background:#f3f4f6;color:var(--g5);cursor:not-allowed;font-size:13px;text-decoration:line-through'
              : 'padding:4px 10px;border-radius:16px;border:1.5px solid #72243E;background:#fff;cursor:pointer;font-size:13px;color:#72243E';
            const onclick = isDone ? `toast('${w}번 와건은 이미 포장 완료됨','d')` : `togglePkWagon(${idx},'${w}','wagon')`;
            const remText = isDone ? '(완료)' : `(${remain.toFixed(0)}kg)`;
            return `<button type="button" class="pk-wagon-btn" data-idx="${idx}" data-w="${w}" data-kind="wagon" data-total="${total}" data-done="${isDone}" onclick="${onclick}" style="${style}">와건${w}번 <span class="pk-w-rem" style="color:${isDone?'var(--g5)':'var(--g5)'}">${remText}</span></button>`;
          }).join('')}
          ${shCarts.map(w=>{
            const total = shCartsMap[w]||0;
            const used = usedCartMap[w]||0;
            const remain = total - used;
            const isDone = remain < 0.01;
            const style = isDone
              ? 'padding:4px 10px;border-radius:16px;border:1.5px solid var(--g3);background:#f3f4f6;color:var(--g5);cursor:not-allowed;font-size:13px;text-decoration:line-through'
              : 'padding:4px 10px;border-radius:16px;border:1.5px solid #1a56db;background:#fff;cursor:pointer;font-size:13px;color:#1a56db';
            const onclick = isDone ? `toast('${w}번 카트는 이미 포장 완료됨','d')` : `togglePkWagon(${idx},'${w}','cart')`;
            const remText = isDone ? '(완료)' : `(${remain.toFixed(0)}kg)`;
            return `<button type="button" class="pk-wagon-btn" data-idx="${idx}" data-w="${w}" data-kind="cart" data-total="${total}" data-done="${isDone}" onclick="${onclick}" style="${style}">카트${w}번 <span class="pk-w-rem" style="color:${isDone?'var(--g5)':'var(--g5)'}">${remText}</span></button>`;
          }).join('')}
        </div>
        <input type="hidden" class="pk-row-wagon" data-idx="${idx}" value="">
        <!-- 와건/카트별 kg 분배 -->
        <div style="margin-top:6px;padding:6px;background:#fff;border-radius:6px;border:1px dashed var(--g3)">
          <div style="font-size:11px;color:var(--g5);margin-bottom:4px">투입 와건/카트별 사용 kg</div>
          <div class="pk-wagon-dist" id="pkWagonDist_${idx}" style="display:flex;flex-direction:column;gap:4px"></div>
          <div style="display:flex;gap:4px;margin-top:4px;align-items:center;justify-content:space-between;font-size:11px;flex-wrap:wrap">
            <div style="display:flex;gap:4px">
              <button onclick="pkAddWagonRow(${idx},'','wagon')" style="padding:3px 8px;font-size:11px;border:1px dashed #72243E;background:#fff;color:#72243E;border-radius:4px;cursor:pointer">+ 와건</button>
              <button onclick="pkAddWagonRow(${idx},'','cart')" style="padding:3px 8px;font-size:11px;border:1px dashed #1a56db;background:#fff;color:#1a56db;border-radius:4px;cursor:pointer">+ 카트</button>
            </div>
            <span id="pkWagonSum_${idx}" style="color:var(--g5);font-weight:500">합계 0kg</span>
          </div>
        </div>
      </div>
      <div class="fgrp cs2 pk-type-section">
        <label class="fl">원육 타입 <span style="font-size:11px;color:var(--g4)">(와건 선택 시 자동, 여러 종류면 자동 분리)</span></label>
        <!-- 단일 셀렉트 (호환용) -->
        <select class="fc pk-row-type" data-idx="${idx}" style="display:none">
          <option value="">자동감지</option><option>설도</option><option>홍두깨</option><option>우둔</option>
        </select>
        <!-- 단일 표시 -->
        <div class="pk-type-single" id="pkTypeSingle_${idx}" style="background:var(--g2);padding:8px 10px;border-radius:6px;font-size:13px;color:var(--g6)">와건 선택 시 자동 감지</div>
        <!-- 다중(원육별 kg) -->
        <div class="pk-type-multi" id="pkTypeMulti_${idx}" style="display:none;padding:8px;background:#f0f7ff;border:1px dashed #1a56db;border-radius:6px">
          <div style="font-size:11px;color:#1a56db;font-weight:600;margin-bottom:4px">⚠ 와건 원육 2종 이상 — 원육별 사용량</div>
          <div class="pk-type-rows" id="pkTypeRows_${idx}" style="display:flex;flex-direction:column;gap:4px"></div>
        </div>
      </div>
      <div class="fgrp">
        <label class="fl">인원</label>
        <input class="fc pk-row-workers" type="number" placeholder="0" data-idx="${idx}">
      </div>
      <div class="fgrp">
        <label class="fl">시작시간 <span class="req">*</span></label>
        <input class="fc pk-row-start" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" data-idx="${idx}">
      </div>
      <div class="fgrp" style="display:flex;align-items:flex-end">
        <button type="button" class="btn bo bsm" onclick="setPkRowNow(${idx})">🕐 지금으로</button>
      </div>
      <!-- 소스 탱크: 시작 시점에는 입력 안 함 → 종료 시 입력 -->
      <select class="fc pk-row-stank" data-idx="${idx}" style="display:none">
        <option value="">선택</option>
      </select>
      <div class="fgrp" id="pkRowSubBox_${idx}" style="display:none">
        <label class="fl">부재료명</label>
        <select class="fc pk-row-subnm" data-idx="${idx}">${subOpts}</select>
      </div>
      <div class="fgrp cs2">
        <div class="fc" id="pkRowSi_${idx}" style="background:var(--g2);color:var(--g5);font-size:13px;margin-top:4px">제품 선택 후 원료육 자동 계산</div>
      </div>
    </div>`;
  document.getElementById('pk_machRows').appendChild(row);
  // ★ 새 카드 추가 시 다른 카드의 입력값까지 반영해 와건/카트 칩 갱신
  if(typeof pkRefreshWagonRemain === 'function') pkRefreshWagonRemain();
}

// 와건/카트 버튼 토글 (다중 선택)
function togglePkWagon(idx, w, kind){
  kind = kind === 'cart' ? 'cart' : 'wagon';
  const btn = document.querySelector(`#pkRow_${idx} .pk-wagon-btn[data-w="${w}"][data-kind="${kind}"]`);
  const distC = document.getElementById('pkWagonDist_'+idx);
  if(!btn) return;
  const existingRow = distC ? distC.querySelector(`.pk-wd-row[data-w="${w}"][data-kind="${kind}"]`) : null;
  const baseColor = kind === 'cart' ? '#1a56db' : '#72243E';
  if(existingRow){
    existingRow.remove();
    btn.style.background='#fff'; btn.style.color=baseColor; btn.style.borderColor=baseColor;
  } else {
    btn.style.background=baseColor; btn.style.color='#fff'; btn.style.borderColor=baseColor;
    pkAddWagonRow(idx, w, kind);
  }
  // hidden wagon 필드는 와건만 — 카트는 cart hidden 별도 (저장 시 dist에서 재구성)
  const hidden = document.querySelector(`#pkRow_${idx} .pk-row-wagon`);
  if(hidden && distC){
    const wagonRows = [...distC.querySelectorAll('.pk-wd-row[data-kind="wagon"]')];
    hidden.value = wagonRows.map(r => r.dataset.w).filter(Boolean).join(',');
  }
  pkWagonSumChange(idx);
}

function pkAddWagonRow(idx, prefilledW, kind){
  kind = kind === 'cart' ? 'cart' : 'wagon';
  const c = document.getElementById('pkWagonDist_'+idx);
  if(!c) return;
  const row = document.createElement('div');
  row.className = 'pk-wd-row';
  row.dataset.w = prefilledW || '';
  row.dataset.kind = kind;
  row.style.cssText = 'display:grid;grid-template-columns:60px 1fr 1fr 28px;gap:4px;align-items:center';

  // 잔여만큼 기본값 (와건/카트 토글로 추가된 경우)
  let defaultKg = '';
  if(prefilledW){
    const total = pkGetWagonTotal(prefilledW, kind);
    const used = pkGetWagonGlobalUsed();
    const usedFor = (kind === 'cart' ? used.cart : used.wagon)[prefilledW] || 0;
    const remain = total - usedFor;
    if(remain > 0.01) defaultKg = remain.toFixed(2);
  }

  const label = kind === 'cart'
    ? '<span style="font-size:11px;font-weight:600;color:#1a56db;background:#e0f2fe;padding:3px 6px;border-radius:4px;text-align:center">카트</span>'
    : '<span style="font-size:11px;font-weight:600;color:#72243E;background:#fde7ef;padding:3px 6px;border-radius:4px;text-align:center">와건</span>';
  const placeholder = kind === 'cart' ? '카트번호' : '와건번호';

  row.innerHTML = `
    ${label}
    <input class="fc pk-wd-num" type="text" value="${prefilledW||''}" placeholder="${placeholder}" oninput="this.closest('.pk-wd-row').dataset.w=this.value;pkWagonSumChange(${idx})" style="padding:5px 7px;font-size:12px;box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:2px">
      <input class="fc pk-wd-kg" type="number" step="0.01" value="${defaultKg}" placeholder="0" oninput="pkWagonSumChange(${idx})" style="padding:5px 7px;font-size:12px;box-sizing:border-box;flex:1;text-align:right">
      <span style="font-size:11px;color:var(--g5)">kg</span>
    </div>
    <button onclick="pkRemoveWagonRow(this,${idx})" style="width:24px;height:28px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:var(--d);font-size:13px;cursor:pointer;padding:0">−</button>`;
  c.appendChild(row);
  pkWagonSumChange(idx);
}

// dist 행 삭제 시 매칭 와건/카트 버튼 상태도 같이 unselected 로 풀기
function pkRemoveWagonRow(btnEl, idx){
  const row = btnEl.closest('.pk-wd-row');
  if(!row) return;
  const w = row.dataset.w || '';
  const kind = row.dataset.kind === 'cart' ? 'cart' : 'wagon';
  // 매칭 와건/카트 버튼 색상/상태 reset
  if(w){
    const wagonBtn = document.querySelector(`#pkRow_${idx} .pk-wagon-btn[data-w="${w}"][data-kind="${kind}"]`);
    if(wagonBtn){
      const baseColor = kind === 'cart' ? '#1a56db' : '#72243E';
      wagonBtn.style.background = '#fff';
      wagonBtn.style.color = baseColor;
      wagonBtn.style.borderColor = baseColor;
      wagonBtn.style.textDecoration = '';
      wagonBtn.style.cursor = '';
      wagonBtn.dataset.done = 'false';
      wagonBtn.onclick = function(){ togglePkWagon(idx, w, kind); };
    }
  }
  row.remove();
  // hidden wagon 필드 갱신 (와건만)
  const distC = document.getElementById('pkWagonDist_'+idx);
  const hidden = document.querySelector(`#pkRow_${idx} .pk-row-wagon`);
  if(hidden && distC){
    const wagonRows = [...distC.querySelectorAll('.pk-wd-row[data-kind="wagon"]')];
    hidden.value = wagonRows.map(r => r.dataset.w).filter(Boolean).join(',');
  }
  pkWagonSumChange(idx);
}

function pkWagonSumChange(idx){
  const c = document.getElementById('pkWagonDist_'+idx);
  if(!c) return;
  let sum = 0;
  // 와건/카트별 kg + 원육 추적 → 원육별 합산
  const typeKg = {}; // {원육: kg}
  c.querySelectorAll('.pk-wd-row').forEach(r => {
    const wn = (r.querySelector('.pk-wd-num')||{}).value || '';
    const kg = parseFloat((r.querySelector('.pk-wd-kg')||{}).value) || 0;
    const kind = r.dataset.kind === 'cart' ? 'cart' : 'wagon';
    sum += kg;
    if(wn && kg){
      const t = pkResolveTypeFromWagon(String(wn).trim(), kind);
      if(t){
        typeKg[t] = (typeKg[t]||0) + kg;
      }
    }
  });
  const sumEl = document.getElementById('pkWagonSum_'+idx);
  if(sumEl) sumEl.textContent = `합계 ${sum.toFixed(2)}kg`;

  // 원육 타입 표시 갱신
  refreshPkTypeUI(idx, typeKg);

  // 전역 잔여 갱신 (모든 설비 카드 + pending 합산)
  pkRefreshWagonRemain();
}

// 와건/카트번호 → 원육 타입 (cooking/preprocess 추적)
function pkResolveTypeFromWagon(wNum, kind, pkDate){
  kind = kind === 'cart' ? 'cart' : 'wagon';
  // packing 날짜 — 인자로 받았거나, 기본 오늘
  const targetDate = pkDate || (typeof tod==='function' ? tod() : '');
  // shredding 에서 해당 번호의 wagonOut/cartOut 찾기 (★ 같은 날짜 우선, 없으면 어제)
  const shList = (L.shredding||[]).filter(r => {
    const d = String(r.date||'').slice(0,10);
    if(targetDate && d !== targetDate) return false;
    if(kind === 'cart'){
      if(r.cartOutDist && r.cartOutDist[wNum] != null) return true;
      return (r.cartOut||'').split(',').map(x=>x.trim()).includes(wNum);
    }
    if(r.wagonOutDist && r.wagonOutDist[wNum] != null) return true;
    return (r.wagonOut||'').split(',').map(x=>x.trim()).includes(wNum);
  });
  const sh = shList[0];
  if(!sh) return '';
  // ★ 같은 날짜의 cooking으로 제한 — 와곤번호는 날짜별 재사용되므로 다른 날짜 cooking과 매칭되면 부위 오추론
  const shDate = String(sh.date||'').slice(0,10);
  const wIns = (sh.wagonIn||'').split(',').map(x=>x.trim()).filter(Boolean);
  for(const wIn of wIns){
    const ck = (L.cooking||[]).find(r =>
      String(r.date||'').slice(0,10) === shDate &&
      (r.wagonOut||'').split(',').map(x=>x.trim()).includes(wIn)
    );
    if(ck && ck.type) return ck.type.split(',')[0].trim();
  }
  return '';
}

// 원육 단일/다중 자동 전환 + 사용자 수정 보존
function refreshPkTypeUI(idx, typeKg){
  const single = document.getElementById('pkTypeSingle_'+idx);
  const multi  = document.getElementById('pkTypeMulti_'+idx);
  const rows   = document.getElementById('pkTypeRows_'+idx);
  const hidden = document.querySelector(`#pkRow_${idx} .pk-row-type`);
  if(!single || !multi || !rows) return;

  const types = Object.keys(typeKg);

  // 0종 → 단일 안내
  if(types.length === 0){
    single.style.display = 'block';
    single.style.background = 'var(--g2)';
    single.style.color = 'var(--g6)';
    single.textContent = '와건 선택 시 자동 감지';
    multi.style.display = 'none';
    if(hidden) hidden.value = '';
    return;
  }

  // 1종 → 단일 표시
  if(types.length === 1){
    single.style.display = 'block';
    single.style.background = '#e6f4ea';
    single.style.color = '#1e7e34';
    single.textContent = `${types[0]} (자동 감지)`;
    multi.style.display = 'none';
    if(hidden) hidden.value = types[0];
    return;
  }

  // 2종 이상 → 다중 표시
  single.style.display = 'none';
  multi.style.display = 'block';
  if(hidden) hidden.value = '혼합';

  // 기존 입력값 보존
  const prev = {};
  rows.querySelectorAll('.pk-type-inp').forEach(i => prev[i.dataset.type] = i.value);

  rows.innerHTML = types.map(t => {
    const auto = typeKg[t];
    const v = prev[t] !== undefined ? prev[t] : auto.toFixed(2);
    return `
      <div style="display:grid;grid-template-columns:90px 1fr 30px;gap:4px;align-items:center">
        <span style="font-size:12px;color:var(--g6);font-weight:500">${t}</span>
        <input class="fc pk-type-inp" type="number" step="0.01" data-type="${t}" data-auto="${auto}" value="${v}" style="padding:4px 6px;font-size:12px;text-align:right">
        <span style="font-size:11px;color:var(--g5)">kg</span>
      </div>`;
  }).join('');
}

// 저장 시 원육별 사용량 (다중일 때만)
function getPkTypeKgs(idx){
  const rows = document.getElementById('pkTypeRows_'+idx);
  if(!rows) return null;
  const inps = rows.querySelectorAll('.pk-type-inp');
  if(inps.length < 2) return null;
  const m = {};
  inps.forEach(i => {
    const v = parseFloat(i.value) || 0;
    if(v) m[i.dataset.type] = v;
  });
  return Object.keys(m).length ? m : null;
}

function getPkWagonDist(idx){
  const c = document.getElementById('pkWagonDist_'+idx);
  if(!c) return null;
  const dist = {};
  c.querySelectorAll('.pk-wd-row').forEach(r => {
    if(r.dataset.kind === 'cart') return; // 카트는 따로
    const wn = (r.querySelector('.pk-wd-num')||{}).value || '';
    const kg = parseFloat((r.querySelector('.pk-wd-kg')||{}).value) || 0;
    if(wn && kg) dist[String(wn).trim()] = (dist[String(wn).trim()]||0) + kg;
  });
  return Object.keys(dist).length ? dist : null;
}

function getPkCartDist(idx){
  const c = document.getElementById('pkWagonDist_'+idx);
  if(!c) return null;
  const dist = {};
  c.querySelectorAll('.pk-wd-row').forEach(r => {
    if(r.dataset.kind !== 'cart') return;
    const wn = (r.querySelector('.pk-wd-num')||{}).value || '';
    const kg = parseFloat((r.querySelector('.pk-wd-kg')||{}).value) || 0;
    if(wn && kg) dist[String(wn).trim()] = (dist[String(wn).trim()]||0) + kg;
  });
  return Object.keys(dist).length ? dist : null;
}

// ===== 와건/카트 전역 사용량/잔여 추적 =====
// 모든 설비 카드 + pending에서 와건/카트별 사용 kg 합산 → {wagon:{}, cart:{}}
function pkGetWagonGlobalUsed(){
  const used = { wagon: {}, cart: {} };
  const today = tod();
  const yesterday = (typeof getYesterday_==='function') ? getYesterday_() : '';
  // 1) 현재 입력 중인 카드들 (모든 설비 카드)
  document.querySelectorAll('.pk-wd-row').forEach(r => {
    const wn = (r.querySelector('.pk-wd-num')||{}).value || '';
    const kg = parseFloat((r.querySelector('.pk-wd-kg')||{}).value) || 0;
    const kind = r.dataset.kind === 'cart' ? 'cart' : 'wagon';
    if(wn && kg) used[kind][String(wn).trim()] = (used[kind][String(wn).trim()]||0) + kg;
  });
  // 2) pending (이미 시작된 다른 설비) - today+yesterday
  const accumPending = (p)=>{
    if(p.wagonDist){
      Object.entries(p.wagonDist).forEach(([w,kg])=>{
        used.wagon[w] = (used.wagon[w]||0) + (parseFloat(kg)||0);
      });
    }
    if(p.cartDist){
      Object.entries(p.cartDist).forEach(([c,kg])=>{
        used.cart[c] = (used.cart[c]||0) + (parseFloat(kg)||0);
      });
    }
  };
  (L.packing_pending||[]).filter(r => {
    const d = String(r.date||'').slice(0,10);
    return d===today;
  }).forEach(accumPending);
  // 3) 완료된 packing - today만 (와건 번호는 매일 재사용 — 어제 6번 ≠ 오늘 6번)
  (L.packing||[]).filter(r => {
    const d = String(r.date||'').slice(0,10);
    return d===today;
  }).forEach(p => {
    if(p.wagonDist){
      Object.entries(p.wagonDist).forEach(([w,kg])=>{
        used.wagon[w] = (used.wagon[w]||0) + (parseFloat(kg)||0);
      });
    } else if(p.wagon){
      // wagonDist 없으면 와건 전체 사용으로 간주
      (p.wagon||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(w=>{
        const total = pkGetWagonTotal(w, 'wagon');
        if(total > 0) used.wagon[w] = (used.wagon[w]||0) + total;
      });
    }
    if(p.cartDist){
      Object.entries(p.cartDist).forEach(([c,kg])=>{
        used.cart[c] = (used.cart[c]||0) + (parseFloat(kg)||0);
      });
    } else if(p.cart){
      (p.cart||'').split(',').map(x=>x.trim()).filter(Boolean).forEach(c=>{
        const total = pkGetWagonTotal(c, 'cart');
        if(total > 0) used.cart[c] = (used.cart[c]||0) + total;
      });
    }
  });
  return used;
}

// 와건/카트의 총량 (shredding 기준)
function pkGetWagonTotal(wNum, kind){
  kind = kind === 'cart' ? 'cart' : 'wagon';
  // 화면에 그려진 버튼의 data-total 우선
  const btn = document.querySelector(`.pk-wagon-btn[data-w="${wNum}"][data-kind="${kind}"]`);
  if(btn && btn.dataset.total) return parseFloat(btn.dataset.total) || 0;
  // 없으면 직접 계산
  let total = 0;
  (L.shredding||[]).forEach(sh => {
    if(kind === 'cart'){
      if(sh.cartOutDist && sh.cartOutDist[wNum]) total += parseFloat(sh.cartOutDist[wNum])||0;
      // 카트는 균등분배 폴백 없음
    } else {
      if(sh.wagonOutDist && sh.wagonOutDist[wNum]) total += parseFloat(sh.wagonOutDist[wNum])||0;
      else if((sh.wagonOut||'').split(',').map(x=>x.trim()).includes(wNum)){
        const ws = (sh.wagonOut||'').split(',').map(x=>x.trim()).filter(Boolean);
        total += (parseFloat(sh.kg)||0)/ws.length;
      }
    }
  });
  return total;
}

// 모든 와건/카트 버튼 라벨 갱신 (잔여 표시) + 매트릭스 색상
function pkRefreshWagonRemain(){
  const used = pkGetWagonGlobalUsed();
  document.querySelectorAll('.pk-wagon-btn').forEach(btn => {
    const w = btn.dataset.w;
    const kind = btn.dataset.kind === 'cart' ? 'cart' : 'wagon';
    const total = parseFloat(btn.dataset.total) || 0;
    const u = (kind === 'cart' ? used.cart : used.wagon)[w] || 0;
    const remain = total - u;
    const remEl = btn.querySelector('.pk-w-rem');
    const isDone = remain < 0.01 && total > 0;
    const label = kind === 'cart' ? '카트' : '와건';
    const idx = btn.dataset.idx;
    const baseColor = kind === 'cart' ? '#1a56db' : '#72243E';
    // 완료 상태 동적 갱신 (완전 소진되면 즉시 차단)
    if(isDone && btn.dataset.done !== 'true'){
      btn.dataset.done = 'true';
      btn.style.background = '#f3f4f6';
      btn.style.color = 'var(--g5)';
      btn.style.cursor = 'not-allowed';
      btn.style.textDecoration = 'line-through';
      btn.onclick = () => toast(w+'번 '+label+'은 이미 포장 완료됨','d');
    } else if(!isDone && btn.dataset.done === 'true'){
      // done 상태 해제 (사용량 줄어듦 — 예: dist 행 삭제로 used=0)
      btn.dataset.done = 'false';
      btn.style.background = '#fff';
      btn.style.color = baseColor;
      btn.style.borderColor = baseColor;
      btn.style.cursor = 'pointer';
      btn.style.textDecoration = '';
      btn.onclick = () => togglePkWagon(idx, w, kind);
    }
    if(remEl){
      if(isDone) remEl.textContent = '(완료)';
      else if(u > 0) remEl.textContent = `(잔여 ${remain.toFixed(0)}kg)`;
      else remEl.textContent = `(${total.toFixed(0)}kg)`;
      remEl.style.color = remain < -0.01 ? 'var(--d)' : 'var(--g5)';
    }
  });
  // 매트릭스 행 색상 갱신
  document.querySelectorAll('.pk-wd-row').forEach(r => {
    const wn = (r.querySelector('.pk-wd-num')||{}).value || '';
    const kgInp = r.querySelector('.pk-wd-kg');
    if(!kgInp || !wn) return;
    const kind = r.dataset.kind === 'cart' ? 'cart' : 'wagon';
    const total = pkGetWagonTotal(wn, kind);
    const totalUsed = (kind === 'cart' ? used.cart : used.wagon)[wn] || 0;
    if(total > 0 && totalUsed > total + 0.01){
      kgInp.style.background = '#FBEAF0';
      kgInp.style.color = 'var(--d)';
      kgInp.title = `초과! 총 ${total}kg, 사용 ${totalUsed.toFixed(2)}kg`;
    } else {
      kgInp.style.background = '';
      kgInp.style.color = '';
      kgInp.title = '';
    }
  });
}
function pkAddStankRow(idx){
  const c = document.getElementById('pkStank_'+idx);
  if(!c) return;
  const row = document.createElement('div');
  row.className = 'pk-stank-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 28px;gap:4px;align-items:center';
  row.innerHTML = `
    <select class="fc pk-stank-sel" onchange="pkStankSumChange(${idx})" style="padding:5px 7px;font-size:12px">
      <option value="">탱크</option>
      <option value="1번탱크">1번</option>
      <option value="2번탱크">2번</option>
      <option value="3번탱크">3번</option>
      <option value="4번탱크">4번</option>
      <option value="5번탱크">5번</option>
      <option value="6번탱크">6번</option>
      <option value="7번탱크">7번</option>
    </select>
    <div style="display:flex;align-items:center;gap:2px">
      <input class="fc pk-stank-kg" type="number" step="0.01" placeholder="0" oninput="pkStankSumChange(${idx})" style="padding:5px 7px;font-size:12px;flex:1;text-align:right">
      <span style="font-size:11px;color:var(--g5)">kg</span>
    </div>
    <button onclick="this.closest('.pk-stank-row').remove();pkStankSumChange(${idx})" style="width:24px;height:28px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:var(--d);font-size:13px;cursor:pointer;padding:0">−</button>`;
  c.appendChild(row);
  pkStankSumChange(idx);
}

function pkStankSumChange(idx){
  const c = document.getElementById('pkStank_'+idx);
  if(!c) return;
  let sum = 0;
  const tanks = [];
  c.querySelectorAll('.pk-stank-row').forEach(r => {
    const t = (r.querySelector('.pk-stank-sel')||{}).value || '';
    const kg = parseFloat((r.querySelector('.pk-stank-kg')||{}).value) || 0;
    if(t) tanks.push(t);
    sum += kg;
  });
  const sumEl = document.getElementById('pkStankSum_'+idx);
  if(sumEl) sumEl.textContent = `합계 ${sum.toFixed(2)}kg`;
  // 호환용 hidden select에 첫 탱크 또는 콤마 (string)
  const stkSel = document.querySelector(`#pkRow_${idx} .pk-row-stank`);
  if(stkSel){
    const joined = tanks.join(',');
    // select 옵션에 임시 추가
    if(joined && !stkSel.querySelector(`option[value="${joined}"]`)){
      const opt = document.createElement('option');
      opt.value = joined; opt.textContent = joined;
      stkSel.appendChild(opt);
    }
    stkSel.value = joined;
  }
}

function getPkSauceTanks(idx){
  const c = document.getElementById('pkStank_'+idx);
  if(!c) return null;
  const tanks = [];
  c.querySelectorAll('.pk-stank-row').forEach(r => {
    const t = (r.querySelector('.pk-stank-sel')||{}).value || '';
    const kg = parseFloat((r.querySelector('.pk-stank-kg')||{}).value) || 0;
    if(t) tanks.push({tank: t, kg: kg});
  });
  return tanks.length ? tanks : null;
}

function removePkRow(idx){
  const el = document.getElementById('pkRow_'+idx);
  if(el) el.remove();
}

// ★ 제품에 부재료가 필요한지 판정 (옵션 C: 레시피 inner 부분 일치 + 제품명 폴백)
// 반환: 필요한 부재료명(string) 또는 '' (불필요)
function pkNeedsSubmat(productName){
  if(!productName) return '';
  const submats = L.submats || [];
  const p = (L.products||[]).find(x => x.name === productName);
  if(!p) return '';
  // 1순위: 레시피 inner에 submats가 부분 일치
  const rc = (L.recipes||{})[productName];
  if(rc && Array.isArray(rc.inner)){
    for(const item of rc.inner){
      const itemName = String(item.name||'');
      const matched = submats.find(s => itemName.includes(s));
      if(matched) return matched;
    }
  }
  // 2순위: 제품명에 submats 이름 포함
  const matched = submats.find(s => productName.includes(s));
  if(matched) return matched;
  return '';
}

function onPkRowProd(idx){
  const row = document.getElementById('pkRow_'+idx);
  if(!row) return;
  const p = L.products.find(x=>x.name===row.querySelector('.pk-row-prod').value);
  const si = document.getElementById('pkRowSi_'+idx);
  if(!si) return;
  if(p){
    const subInfo = p.subName ? ` · 부재료 ${p.subName}${p.subKgea?' '+p.subKgea+'kg/EA':''}` : '';
    if(p.noMeat){
      si.textContent = `Capa ${p.capa}kg · 소스 ${p.sauce||'-'}${subInfo}`;
    } else {
      si.textContent = `원료육 ${p.kgea}kg/EA · Capa ${p.capa}kg · 소스 ${p.sauce||'-'}${subInfo}`;
    }
    si.style.color='var(--p)';
  }
  else { si.textContent='제품 선택 후 원료육 자동 계산'; si.style.color='var(--g5)'; }

  // noMeat 제품(메추리알 등): 와건/카트 영역 + 원육 타입 영역 숨김
  const wagonSection = row.querySelector('.pk-wagon-section');
  const typeSection  = row.querySelector('.pk-type-section');
  const isNoMeat = !!(p && p.noMeat);
  if(wagonSection) wagonSection.style.display = isNoMeat ? 'none' : '';
  if(typeSection)  typeSection.style.display  = isNoMeat ? 'none' : '';
  // 숨길 때 hidden 값 비우기 (저장 시 wagon 비어있게)
  if(isNoMeat){
    const hidden = row.querySelector('.pk-row-wagon');
    if(hidden) hidden.value = '';
    const distC = document.getElementById('pkWagonDist_'+idx);
    if(distC) distC.querySelectorAll('.pk-wd-row').forEach(r=>r.remove());
  }
  // 제품에 기본 부재료(subName)가 박혀있으면 드롭다운 자동 선택
  if(p && p.subName){
    const subSel = row.querySelector('.pk-row-subnm');
    if(subSel){
      // 옵션 중에 일치하는 것 있으면 선택
      const opt = [...subSel.options].find(o => o.value === p.subName || o.textContent === p.subName);
      if(opt) subSel.value = opt.value;
    }
  }

  // ★ 부재료 박스 표시/숨김 (옵션 C: 공통 함수 pkNeedsSubmat)
  const subBox = document.getElementById('pkRowSubBox_'+idx);
  if(subBox && p){
    const neededSubmat = pkNeedsSubmat(p.name);
    if(neededSubmat){
      subBox.style.display = '';
      const subSel = row.querySelector('.pk-row-subnm');
      if(subSel){
        subSel.innerHTML = `<option value="${neededSubmat}">${neededSubmat}</option>`;
        subSel.value = neededSubmat;
      }
    } else {
      subBox.style.display = 'none';
      const subSel = row.querySelector('.pk-row-subnm');
      if(subSel) subSel.value = '';
    }
  } else if(subBox){
    subBox.style.display = 'none';
  }
}

// 지금 시간으로 자동 입력
function setPkNow(){
  document.getElementById('pk_startTime').value = nowHM();
}

function setPkRowNow(idx){
  const row = document.getElementById('pkRow_'+idx);
  if(row){ const inp = row.querySelector('.pk-row-start'); if(inp) inp.value = nowHM(); }
}

// 시작 → pending 레코드 생성
async function onPkStartBtn(){
  const rows = document.querySelectorAll('#pk_machRows > div');
  if(!rows.length){ toast('설비를 먼저 추가하세요','d'); return; }

  // 각 행별 시작시간은 행 내부에서 읽음
  if(!L.packing_pending) L.packing_pending = [];

  let added = 0;
  rows.forEach(row => {
    const product = row.querySelector('.pk-row-prod').value;
    const startTime = row.querySelector('.pk-row-start')?.value || '';
    if(!startTime){ toast('시작시간을 입력하세요','d'); return; }
    if(!product){ toast('제품명을 선택하세요','d'); return; }
    const machine = row.querySelector('.pk-row-mach').value;
    const wagonHidden = row.querySelector('.pk-row-wagon');
    const wagonDirect = row.querySelector('.pk-row-wagon-input');
    let wagon = (wagonHidden ? wagonHidden.value : (wagonDirect ? wagonDirect.value : '')).trim();
    const workers = parseFloat(row.querySelector('.pk-row-workers').value)||0;
    const type = row.querySelector('.pk-row-type')?.value||'';
    const sauceTank = row.querySelector('.pk-row-stank').value;
    const subName = row.querySelector('.pk-row-subnm').value;
    // 와건/카트별 kg 분배
    const idxAttr = parseInt(row.id.replace('pkRow_',''));
    const wagonDist = (typeof getPkWagonDist==='function') ? getPkWagonDist(idxAttr) : null;
    const cartDist  = (typeof getPkCartDist ==='function') ? getPkCartDist(idxAttr)  : null;
    const typeKgs = (typeof getPkTypeKgs==='function') ? getPkTypeKgs(idxAttr) : null;

    // wagon 비어있으면 wagonDist 키로 자동 채움 (토글 버그 fallback)
    if(!wagon && wagonDist){
      wagon = Object.keys(wagonDist).join(',');
    }
    // cart 문자열은 cartDist에서 재구성
    const cart = cartDist ? Object.keys(cartDist).join(',') : '';

    const rec = {
      id: gid(), date: tod(),
      product, machine, wagon, cart, workers, type,
      start: startTime,
      sauceTank, subName,
      end:'', ea:0, pouch:0, defect:0, sauceKg:0, subKg:0
    };
    if(wagonDist) rec.wagonDist = wagonDist;
    if(cartDist)  rec.cartDist  = cartDist;
    if(typeKgs) rec.typeKgs = typeKgs;
    // 옵션 C: 수정 모드면 기존 record 업데이트 (첫 row만 적용)
    if(_pkEditingId && added===0){
      const existing = L.packing_pending.find(r=>r.id===_pkEditingId);
      if(existing){
        // id, fbId, date는 보존
        Object.assign(existing, {
          product, machine, wagon, cart, workers, type,
          start: startTime,
          sauceTank, subName,
        });
        // 분배 필드는 새 값 있으면 갱신, 없으면 제거
        if(wagonDist) existing.wagonDist = wagonDist; else delete existing.wagonDist;
        if(cartDist) existing.cartDist = cartDist; else delete existing.cartDist;
        if(typeKgs) existing.typeKgs = typeKgs; else delete existing.typeKgs;
        added++;
        return;  // forEach 콜백 종료 — 새 record는 push 안 함
      }
    }
    L.packing_pending.push(rec);
    added++;
  });

  if(!added) return;
  saveL();

  // Firebase 처리
  if(_pkEditingId){
    // 수정 모드: 기존 record fbId로 update
    const edited = L.packing_pending.find(r=>r.id===_pkEditingId);
    if(edited && edited.fbId){
      const {id, fbId, ...updateData} = edited;
      try { await fbUpdate('packing_pending', fbId, updateData); }
      catch(e){ console.error('Firebase packing_pending 수정 오류',e); toast('Firebase 저장 실패 - 로컬만 반영','w'); }
    }
  } else {
    // 신규 모드: 새 fbSave
    const pendingToSave = L.packing_pending.filter(r => !r.fbId && String(r.date||'').slice(0,10) === tod());
    for(const rec of pendingToSave) {
      const fbId = await fbSave('packing_pending', rec);
      if(fbId) { rec.fbId = fbId; }
    }
  }
  saveL();

  document.getElementById('pk_machRows').innerHTML='';
  _pkRowIdx = 0;
  document.querySelectorAll('.pk-wagon-cb').forEach(c=>c.checked=false);

  document.getElementById('pk_startCard').style.display='none';
  document.getElementById('pk_pendingCard').style.display='';

  const wasEditing = !!_pkEditingId;
  _pkEditingId = null;  // ★ renderPkPending 호출 전에 클리어 (수정 중 배지 안 남게)
  renderPkPending();
  // ★ 수정 모드 UI 복구
  _restorePkStartCardUI();
  // ★ 파쇄 완료 와건 현황 갱신 (와건 사용 변경 시 즉시 차감 표시)
  if(typeof renderPkWagonList === 'function') renderPkWagonList();
  toast(wasEditing ? '포장 수정됨 ✓' : `포장 시작 — ${added}개 설비 진행중 ✓`, wasEditing ? 's' : 'i');
}

// ★ 수정 모드 UI 복구 (시작 카드 원래 상태로)
function _restorePkStartCardUI(){
  const banner = document.getElementById('pk_editBanner');
  const title = document.getElementById('pk_startCardTitle');
  const addBtn = document.getElementById('pk_addMachBtn');
  const startBtn = document.getElementById('pk_startBtn');
  if(banner) banner.style.display = 'none';
  if(title) title.style.display = '';
  if(addBtn) addBtn.style.display = '';
  if(startBtn) startBtn.textContent = '시작';
}

// ★ 수정 취소
function cancelEditPkPending(){
  _pkEditingId = null;
  _restorePkStartCardUI();
  // 입력 카드 비우고 닫기
  const machRows = document.getElementById('pk_machRows');
  if(machRows) machRows.innerHTML = '';
  _pkRowIdx = 0;
  // 진행중 있으면 시작 카드 닫고 진행중 카드 표시
  const hasPending = (L.packing_pending||[]).some(r => String(r.date||'').slice(0,10) === tod());
  if(hasPending){
    document.getElementById('pk_startCard').style.display = 'none';
    document.getElementById('pk_pendingCard').style.display = '';
  }
  // 진행중 카드 다시 그림 (수정 중 표시 해제)
  if(typeof renderPkPending === 'function') renderPkPending();
  toast('수정 취소','i');
}

// + 추가 설비 시작 버튼
function showPkStartCard(){
  document.getElementById('pk_startCard').style.display='';
  document.getElementById('pk_startCard').scrollIntoView({behavior:'smooth', block:'start'});
}

// 진행중 설비 렌더링
function renderPkPending(){
  if(!L.packing_pending) L.packing_pending = [];
  const pending = L.packing_pending.filter(r => String(r.date||'').slice(0,10) === tod());
  const el = document.getElementById('pk_pendingList');
  const cntEl = document.getElementById('pk_pendingCnt');
  const card = document.getElementById('pk_pendingCard');
  if(!el) return;

  if(cntEl) cntEl.textContent = pending.length + '개';

  if(!pending.length){
    card.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  card.style.display = '';

  el.innerHTML = pending.map(r => {
    const prod = (L.products||[]).find(x => x.name === r.product);
    const isNoMeat = !!(prod && prod.noMeat);
    let wcText;
    if(isNoMeat){
      wcText = ''; // 메추리알 등 noMeat 제품: 와건/카트 표시 안 함
    } else {
      const parts = [];
      // ★ wagon 비어있으면 wagonDist 키로 폴백
      const wagonStr = r.wagon || (r.wagonDist ? Object.keys(r.wagonDist).join(',') : '');
      const cartStr  = r.cart  || (r.cartDist  ? Object.keys(r.cartDist).join(',')  : '');
      if(wagonStr) parts.push(`와건 ${wagonStr}`);
      if(cartStr)  parts.push(`카트 ${cartStr}`);
      wcText = parts.length ? parts.join(' · ') : '와건 -';
    }
    const subText = `${wcText ? wcText+' · ' : ''}시작 ${r.start} · ${r.workers}명`;
    // ★ 수정 모드: 현재 수정 중인 record는 회색 처리 + 버튼 비활성화
    const isEditing = (_pkEditingId === r.id);
    const cardStyle = isEditing
      ? 'border:1px solid var(--g3);border-radius:8px;margin-bottom:10px;overflow:hidden;opacity:0.6;background:#f3f4f6'
      : 'border:1px solid var(--g2);border-radius:8px;margin-bottom:10px;overflow:hidden';
    const headBg = isEditing ? '#f3f4f6' : 'var(--pl)';
    const editingBadge = isEditing
      ? '<span style="background:#fb923c;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-right:6px;font-weight:600">수정 중</span>'
      : '';
    const btnDisabled = isEditing ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    return `
    <div id="pkPend_${r.id}" style="${cardStyle}">
      <!-- 헤더 -->
      <div style="background:${headBg};padding:12px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--g8)">${editingBadge}${r.machine||'설비미정'} · ${r.product}</div>
          <div style="font-size:12px;color:var(--g5);margin-top:3px">
            ${subText}
            ${r.sauceTank ? ' · 소스 '+r.sauceTank : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn bs bsm" ${btnDisabled} ${isEditing?'':`onclick="togglePkEndForm('${r.id}')"`}>종료 입력</button>
          <button class="btn bo bsm" ${btnDisabled} ${isEditing?'':`onclick="startEditPkPending('${r.id}')"`}>수정</button>
          <button class="btn bo bsm" ${btnDisabled} style="color:var(--d);border-color:var(--d)${isEditing?';opacity:0.5;cursor:not-allowed':''}" ${isEditing?'':`onclick="deletePkPending('${r.id}')"`}>삭제</button>
        </div>
      </div>
      <!-- 종료 입력 폼 (숨김) -->
      <div id="pkEndForm_${r.id}" style="display:none;padding:12px;background:#fff">
        <div class="fg">
          <div class="fgrp">
            <label class="fl">종료시간 <span class="req">*</span></label>
            <input class="fc" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" id="pkEnd_t_${r.id}">
          </div>
          <div class="fgrp">
            <label class="fl">생산 EA <span class="req">*</span></label>
            <input class="fc" type="number" id="pkEnd_ea_${r.id}" placeholder="0">
          </div>
          <div class="fgrp">
            <label class="fl">파우치 사용량</label>
            <input class="fc" type="number" id="pkEnd_pouch_${r.id}" placeholder="0">
          </div>
          <div class="fgrp">
            <label class="fl">불량 수량(EA)</label>
            <input class="fc" type="number" id="pkEnd_defect_${r.id}" placeholder="0">
          </div>
          <div class="fgrp cs2">
            <label class="fl">소스 탱크 <span style="font-size:11px;color:var(--g4)">(탱크 + kg, 도중에 바뀐 경우 여러 개 추가)</span></label>
            <!-- 호환용 hidden 합계 -->
            <input type="hidden" id="pkEnd_skg_${r.id}" value="0">
            <div class="pk-end-stank-list" id="pkEndStank_${r.id}" style="display:flex;flex-direction:column;gap:4px"></div>
            <div style="display:flex;gap:4px;margin-top:4px;align-items:center;justify-content:space-between;font-size:11px">
              <button onclick="pkEndAddStankRow('${r.id}')" style="padding:3px 8px;font-size:11px;border:1px dashed #1a56db;background:#fff;color:#1a56db;border-radius:4px;cursor:pointer">+ 소스탱크 추가</button>
              <span id="pkEndStankSum_${r.id}" style="color:var(--g5);font-weight:500">합계 0kg</span>
            </div>
          </div>
          ${pkNeedsSubmat(r.product) ? `
          <div class="fgrp">
            <label class="fl">부재료량 (${pkNeedsSubmat(r.product)})</label>
            <input class="fc" type="number" step="0.01" id="pkEnd_subkg_${r.id}" placeholder="0.00">
          </div>` : `<input type="hidden" id="pkEnd_subkg_${r.id}" value="0">`}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn bs bblk" style="flex:1" onclick="savePkEnd('${r.id}')">종료 저장</button>
          <button class="btn bo bsm" onclick="togglePkEndForm('${r.id}')">취소</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// 종료 폼 - 소스 탱크 다중 입력
function pkEndAddStankRow(pendId){
  const c = document.getElementById('pkEndStank_'+pendId);
  if(!c) return;
  const row = document.createElement('div');
  row.className = 'pk-end-stank-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 28px;gap:4px;align-items:center';
  row.innerHTML = `
    <select class="fc pk-end-stank-sel" onchange="pkEndStankSumChange('${pendId}')" style="padding:5px 7px;font-size:12px">
      <option value="">탱크</option>
      <option value="1번탱크">1번</option>
      <option value="2번탱크">2번</option>
      <option value="3번탱크">3번</option>
      <option value="4번탱크">4번</option>
      <option value="5번탱크">5번</option>
      <option value="6번탱크">6번</option>
      <option value="7번탱크">7번</option>
    </select>
    <div style="display:flex;align-items:center;gap:2px">
      <input class="fc pk-end-stank-kg" type="number" step="0.01" placeholder="0" oninput="pkEndStankSumChange('${pendId}')" style="padding:5px 7px;font-size:12px;flex:1;text-align:right">
      <span style="font-size:11px;color:var(--g5)">kg</span>
    </div>
    <button onclick="this.closest('.pk-end-stank-row').remove();pkEndStankSumChange('${pendId}')" style="width:24px;height:28px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:var(--d);font-size:13px;cursor:pointer;padding:0">−</button>`;
  c.appendChild(row);
  pkEndStankSumChange(pendId);
}

function pkEndStankSumChange(pendId){
  const c = document.getElementById('pkEndStank_'+pendId);
  if(!c) return;
  let sum = 0;
  c.querySelectorAll('.pk-end-stank-row').forEach(r => {
    sum += parseFloat((r.querySelector('.pk-end-stank-kg')||{}).value) || 0;
  });
  const sumEl = document.getElementById('pkEndStankSum_'+pendId);
  if(sumEl) sumEl.textContent = `합계 ${sum.toFixed(2)}kg`;
  // hidden에 합계 저장 (sauceKg 호환)
  const skg = document.getElementById('pkEnd_skg_'+pendId);
  if(skg) skg.value = sum.toFixed(2);
}

function getPkEndSauceTanks(pendId){
  const c = document.getElementById('pkEndStank_'+pendId);
  if(!c) return null;
  const tanks = [];
  c.querySelectorAll('.pk-end-stank-row').forEach(r => {
    const t = (r.querySelector('.pk-end-stank-sel')||{}).value || '';
    const kg = parseFloat((r.querySelector('.pk-end-stank-kg')||{}).value) || 0;
    if(t) tanks.push({tank: t, kg: kg});
  });
  return tanks.length ? tanks : null;
}

// 진행중 포장 삭제 (cooking deleteCkPending 패턴)
async function deletePkPending(id){
  if(!confirm('진행중인 포장을 삭제하시겠습니까?')) return;
  if(!L.packing_pending) L.packing_pending=[];
  const rec = L.packing_pending.find(r=>r.id===id);
  if(rec && rec.fbId){
    try { await fbDelete('packing_pending', rec.fbId); }
    catch(e){ console.error('Firebase packing_pending 삭제 오류',e); }
  }
  L.packing_pending = L.packing_pending.filter(r=>r.id!==id);
  saveL();
  // ★ 수정 중이던 record를 삭제한 경우 — 수정 모드 UI 정리
  if(_pkEditingId === id){
    _pkEditingId = null;
    if(typeof _restorePkStartCardUI === 'function') _restorePkStartCardUI();
    const machRows = document.getElementById('pk_machRows');
    if(machRows) machRows.innerHTML = '';
    _pkRowIdx = 0;
    document.getElementById('pk_startCard').style.display = 'none';
  }
  renderPkPending();
  // 진행중이 더 이상 없으면 진행중 카드 숨김
  const hasPending = (L.packing_pending||[]).some(r => String(r.date||'').slice(0,10) === tod());
  document.getElementById('pk_pendingCard').style.display = hasPending ? '' : 'none';
  if(!hasPending) document.getElementById('pk_startCard').style.display = '';
  // ★ 파쇄 완료 와건 현황 갱신 (삭제 시 잔량 복귀)
  if(typeof renderPkWagonList === 'function') renderPkWagonList();
  toast('포장 삭제됨','i');
}

// 옵션 C: 진행중 record를 입력 폼에 불러와 수정
// 저장 시 onPkStartBtn에서 _pkEditingId 있으면 기존 record 업데이트
var _pkEditingId = null;
function startEditPkPending(id){
  if(!L.packing_pending) L.packing_pending=[];
  const rec = L.packing_pending.find(r=>r.id===id);
  if(!rec){ toast('데이터 없음','d'); return; }
  // 편집 모드 마킹 (addPkMachRow가 사용량 계산 시 본 record 제외하도록 먼저 설정)
  _pkEditingId = id;
  // ★ 수정 모드 UI 활성화
  const banner = document.getElementById('pk_editBanner');
  const target = document.getElementById('pk_editTarget');
  const title = document.getElementById('pk_startCardTitle');
  const addBtn = document.getElementById('pk_addMachBtn');
  const startBtn = document.getElementById('pk_startBtn');
  if(banner) banner.style.display = 'flex';
  if(target) target.textContent = `${rec.machine||'설비'} · ${rec.product||''}`;
  if(title) title.style.display = 'none';
  if(addBtn) addBtn.style.display = 'none';  // 수정 모드에선 행 추가 X
  if(startBtn) startBtn.textContent = '수정 저장';
  // 진행중 카드 다시 그려서 수정 중인 카드 비활성화 표시
  if(typeof renderPkPending === 'function') renderPkPending();
  // 입력 카드 펼침 + 새 row 추가
  document.getElementById('pk_startCard').style.display='';
  document.getElementById('pk_machRows').innerHTML='';
  _pkRowIdx = 0;
  if(typeof addPkMachRow==='function') addPkMachRow();
  // row의 idx (방금 추가한 row)
  const row = document.querySelector('#pk_machRows > div');
  if(!row){ toast('row 생성 실패','d'); return; }
  const idx = parseInt(row.id.replace('pkRow_',''));
  // 값 채움 (제품/설비/와건/시작시간/인원/소스탱크/부재료)
  const prodSel = row.querySelector('.pk-row-prod');
  if(prodSel && rec.product){
    prodSel.value = rec.product;
    // 제품 onchange는 셀렉트 옵션을 다시 그리므로 수동 호출
    if(typeof onPkRowProd==='function') onPkRowProd(idx);
  }
  // 약간 지연: onPkRowProd가 비동기로 셀렉트 옵션 다시 그리므로
  setTimeout(()=>{
    const r2 = document.getElementById('pkRow_'+idx);
    if(!r2) return;
    const machSel = r2.querySelector('.pk-row-mach');
    if(machSel && rec.machine) machSel.value = rec.machine;
    const startInp = r2.querySelector('.pk-row-start');
    if(startInp) startInp.value = rec.start||'';
    const workersInp = r2.querySelector('.pk-row-workers');
    if(workersInp) workersInp.value = rec.workers||'';
    const stankSel = r2.querySelector('.pk-row-stank');
    if(stankSel && rec.sauceTank) stankSel.value = rec.sauceTank;
    const subSel = r2.querySelector('.pk-row-subnm');
    if(subSel && rec.subName) subSel.value = rec.subName;
    // 와건 hidden + 토글 버튼 클릭 시뮬 (wagon 비어있으면 wagonDist 키로 폴백)
    const wagonStr = rec.wagon || (rec.wagonDist ? Object.keys(rec.wagonDist).join(',') : '');
    if(wagonStr){
      const wagons = wagonStr.split(',').map(x=>x.trim()).filter(Boolean);
      wagons.forEach(w=>{
        const btn = r2.querySelector(`.pk-wagon-btn[data-w="${w}"][data-kind="wagon"]`);
        if(btn && btn.dataset.done!=='true') btn.click();
      });
    }
    const cartStr = rec.cart || (rec.cartDist ? Object.keys(rec.cartDist).join(',') : '');
    if(cartStr){
      const carts = cartStr.split(',').map(x=>x.trim()).filter(Boolean);
      carts.forEach(c=>{
        const btn = r2.querySelector(`.pk-wagon-btn[data-w="${c}"][data-kind="cart"]`);
        if(btn && btn.dataset.done!=='true') btn.click();
      });
    }
    // 와건별 kg 분배 채우기 (wagonDist/cartDist) — togglePkWagon이 row 추가했으니 그 안의 kg input 갱신
    if(rec.wagonDist){
      setTimeout(()=>{
        Object.entries(rec.wagonDist).forEach(([w,kg])=>{
          const wdRow = r2.querySelector(`.pk-wd-row[data-w="${w}"][data-kind="wagon"]`);
          if(wdRow){
            const kgInp = wdRow.querySelector('.pk-wd-kg');
            if(kgInp) kgInp.value = kg;
          }
        });
        if(typeof pkWagonSumChange==='function') pkWagonSumChange(idx);
      }, 100);
    }
    if(rec.cartDist){
      setTimeout(()=>{
        Object.entries(rec.cartDist).forEach(([c,kg])=>{
          const wdRow = r2.querySelector(`.pk-wd-row[data-w="${c}"][data-kind="cart"]`);
          if(wdRow){
            const kgInp = wdRow.querySelector('.pk-wd-kg');
            if(kgInp) kgInp.value = kg;
          }
        });
        if(typeof pkWagonSumChange==='function') pkWagonSumChange(idx);
      }, 100);
    }
  }, 50);
  // 시작 카드로 스크롤
  document.getElementById('pk_startCard').scrollIntoView({behavior:'smooth', block:'start'});
  toast('수정 모드: 값을 고치고 시작 저장','i');
}

function togglePkEndForm(id){
  const form = document.getElementById('pkEndForm_'+id);
  if(!form) return;
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : '';
  // 처음 펼치는 거면 첫 행 자동 추가
  if(!isOpen){
    const stankList = document.getElementById('pkEndStank_'+id);
    if(stankList && stankList.children.length === 0){
      pkEndAddStankRow(id);
    }
  }
}

async function savePkEnd(id){
  if(!L.packing_pending) L.packing_pending = [];
  const rec = L.packing_pending.find(r=>r.id===id);
  if(!rec){ toast('데이터 없음','d'); return; }

  const end = document.getElementById('pkEnd_t_'+id).value;
  const ea = parseFloat(document.getElementById('pkEnd_ea_'+id).value)||0;
  const pouch = parseFloat(document.getElementById('pkEnd_pouch_'+id).value)||0;
  const defect = parseFloat(document.getElementById('pkEnd_defect_'+id).value)||0;
  const sauceKg = parseFloat(document.getElementById('pkEnd_skg_'+id).value)||0;
  const subKg = parseFloat(document.getElementById('pkEnd_subkg_'+id).value)||0;
  const sauceTanks = (typeof getPkEndSauceTanks==='function') ? getPkEndSauceTanks(id) : null;

  if(!end){ toast('종료시간을 입력하세요','d'); return; }
  if(!ea){ toast('생산 EA를 입력하세요','d'); return; }

  // 완성된 레코드
  const completed = {...rec, end, ea, pouch, defect, sauceKg, subKg};
  delete completed.fbId;  // ★ saveCkEnd와 동일 — rec(packing_pending)의 fbId가 packing으로 옮겨가지 않게
  if(sauceTanks){
    completed.sauceTanks = sauceTanks;
    // sauceTank 호환 필드 (콤마 문자열)
    completed.sauceTank = sauceTanks.map(s=>s.tank).join(',');
  }

  // pending에서 제거
  L.packing_pending = L.packing_pending.filter(r=>r.id!==id);
  saveL();

  // Firebase packing_pending 삭제
  if(rec.fbId) {
    try { await fbDelete('packing_pending', rec.fbId); }
    catch(e){ console.error('packing_pending 삭제 실패', e); }
  }

  // Firebase packing 저장 → fbId 받은 후 메모리에 push
  const fbId = await fbSave('packing', completed);
  if(fbId) completed.fbId = fbId;
  L.packing.push(completed);
  saveL();
  if(fbId) toast(`${completed.machine||'설비'} 종료 저장됨 ✓`);
  else toast('저장 실패 - 로컬에만 저장됨','d');

  // ★ 수정 모드 종료 (이 record가 편집 중이었으면)
  if(_pkEditingId === id){
    _pkEditingId = null;
    _restorePkStartCardUI();
    const machRows = document.getElementById('pk_machRows');
    if(machRows) machRows.innerHTML = '';
    _pkRowIdx = 0;
    document.getElementById('pk_startCard').style.display = 'none';
    document.getElementById('pk_pendingCard').style.display = '';
  }

  renderPkPending();
  renderPL('packing');
  // ★ 파쇄 완료 와건 현황 갱신 (사용량 즉시 차감 표시)
  if(typeof renderPkWagonList === 'function') renderPkWagonList();
}

// onPkWagonChange - 마지막 설비 행 와건에 자동 입력
function onPkWagonChange(){
  const checked = [...document.querySelectorAll('.pk-wagon-cb:checked')];
  if(!checked.length) return;
  const rows = document.querySelectorAll('#pk_machRows > div');
  if(rows.length){
    const lastRow = rows[rows.length-1];
    const wInput = lastRow.querySelector('.pk-row-wagon');
    if(wInput) wInput.value = checked.map(w=>w.dataset.wagon).join(',');
  }
}

// onProd - 레거시 호환 (pk_prod 없어도 에러 안 나게)
function onProd(){
  const el = document.getElementById('pk_prod');
  if(!el) return;
  const nm = el.value;
  const p = L.products.find(x=>x.name===nm);
  const siEl = document.getElementById('pkSi');
  if(!p||!siEl){ if(siEl) siEl.classList.add('hid'); return; }
  siEl.innerHTML=`<div class="al al-i">원료육 ${p.kgea}kg/EA · FullCapa ${p.capa}kg · 소스 ${p.sauce||'-'}</div>`;
  siEl.classList.remove('hid');
}