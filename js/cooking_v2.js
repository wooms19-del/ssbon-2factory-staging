// ============================================================
// 공정 연동: 전처리 완료 케이지 → 자숙 탭
// ============================================================
function renderCkCageList() {
  const today = tod();
  const ppList = L.preprocess.filter(r =>
    String(r.date||'').slice(0,10)===today && r.cage && r.end
  );
  const usedCages = new Set([
    ...L.cooking.filter(r=>String(r.date||'').slice(0,10)===today)
      .flatMap(r=>(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean)),
    ...(L.cooking_pending||[]).filter(r=>String(r.date||'').slice(0,10)===today)
      .flatMap(r=>(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean))
  ]);
  const el = document.getElementById('ck_cageList');
  if(!el) return;

  // 케이지별 전처리 배출량 합산 (distribution.cages 우선, 없으면 분배 추정)
  const cageOutKg = {}; // {케이지번호: kg}
  ppList.forEach(pp => {
    if(pp.distribution){
      Object.values(pp.distribution).forEach(d => {
        const cgs = d.cages || {};
        Object.entries(cgs).forEach(([k,v])=>{
          cageOutKg[k] = (cageOutKg[k]||0) + (parseFloat(v)||0);
        });
      });
    } else {
      // 호환: distribution 없으면 kg을 cage들에 균등 분배
      const cs = (pp.cage||'').split(',').map(c=>c.trim()).filter(Boolean);
      if(cs.length && pp.kg){
        const each = parseFloat(pp.kg)/cs.length;
        cs.forEach(c => { cageOutKg[c] = (cageOutKg[c]||0) + each; });
      }
    }
  });

  // ★ v2: 묶음 단위 (preprocess record = 케이지 묶음 1개)
  // 케이지 칸에 "1,2"로 저장된 record는 묶음 "1,2"로 그대로
  const groups = [];  // [{cage:"1,2", type:"우둔", kg:280, used:false}, ...]
  ppList.forEach(pp => {
    const cageGroup = (pp.cage||'').trim();
    if(!cageGroup) return;
    // 그 묶음의 모든 케이지가 다 사용됐는지 (자숙에서 같은 묶음 통째로 가져갔는지)
    const cageNums = cageGroup.split(',').map(c=>c.trim()).filter(Boolean);
    const allUsed = cageNums.every(cn => usedCages.has(cn));
    // 그 묶음의 총 산출량 (distribution에서 더하거나, kg 그대로)
    let groupKg = 0;
    if(pp.distribution){
      Object.values(pp.distribution).forEach(d => {
        const cgs = d.cages || {};
        cageNums.forEach(cn => { groupKg += (parseFloat(cgs[cn])||0); });
      });
    }
    if(groupKg === 0) groupKg = parseFloat(pp.kg)||0;
    // 같은 묶음 중복 방지
    if(!groups.find(g => g.cage === cageGroup && g.type === (pp.type||''))){
      groups.push({ cage: cageGroup, type: pp.type||'', kg: groupKg, used: allUsed, ppId: pp.id });
    }
  });
  if(!groups.length) { el.innerHTML='<div class="emp">전처리 완료된 케이지 없음</div>'; return; }
  const pending = groups.filter(g=>!g.used);
  const done    = groups.filter(g=>g.used);
  el.innerHTML =
    (pending.length ? '<div style="font-size:12px;font-weight:600;color:var(--g6);margin-bottom:8px">자숙 시작 시 묶음 단위로 선택</div>' : '') +
    pending.map(g => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#E6F1FB;border:1px solid #B5D4F4;border-radius:8px;margin-bottom:6px">
        <span style="font-size:14px;font-weight:700;color:#0C447C">케이지 ${g.cage}</span>
        <span style="font-size:13px;color:#185FA5;margin-left:8px">${g.type||'-'}</span>
        <span style="font-size:13px;color:#0F6E56;font-weight:600;margin-left:auto">${g.kg.toFixed(2)}kg</span>
      </div>`).join('') +
    done.map(g => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f3f4f6;border-radius:8px;margin-bottom:6px;opacity:0.55">
        <span style="font-size:14px;font-weight:700;text-decoration:line-through;color:var(--g5)">케이지 ${g.cage}</span>
        <span style="font-size:13px;color:var(--g5);margin-left:8px">${g.type||'-'}</span>
        <span style="font-size:12px;color:#4caf50;font-weight:600;margin-left:auto">✅자숙완료</span>
      </div>`).join('');
}

function onCkCageChange() {
  const checked = [...document.querySelectorAll('.ck-cage-cb:checked')];
  if(!checked.length) return;
  const cageNums = checked.map(c=>c.dataset.cage).join(',');
  const type = checked[0].dataset.type;
  // 마지막 탱크 행에 자동 입력
  const rows = document.querySelectorAll('#ck_tankRows > div');
  if(rows.length){
    const lastRow = rows[rows.length-1];
    const cageEl = lastRow.querySelector('.ck-row-cage');
    const typeEl = lastRow.querySelector('.ck-row-type');
    if(cageEl) cageEl.value = cageNums;
    if(typeEl && type) typeEl.value = type;
  }
}

// ============================================================
// 자숙 탭 - 포장형식 pending (시작/진행중/종료)
// ============================================================
var _ckRowIdx = 0;

function addCkTankRow(){
  const idx = _ckRowIdx++;
  // 현재 사용 가능한 묶음 옵션 만들기
  const today = tod();
  const ppList = L.preprocess.filter(r =>
    String(r.date||'').slice(0,10)===today && r.cage && r.end
  );
  const usedCages = new Set([
    ...L.cooking.filter(r=>String(r.date||'').slice(0,10)===today)
      .flatMap(r=>(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean)),
    ...(L.cooking_pending||[]).filter(r=>String(r.date||'').slice(0,10)===today)
      .flatMap(r=>(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean))
  ]);
  const groupOpts = [];
  ppList.forEach(pp => {
    const cg = (pp.cage||'').trim();
    if(!cg) return;
    const nums = cg.split(',').map(c=>c.trim()).filter(Boolean);
    const allUsed = nums.every(n => usedCages.has(n));
    if(allUsed) return;
    const key = cg + '|' + (pp.type||'');
    if(!groupOpts.find(o => o.key === key)){
      groupOpts.push({ key, cage: cg, type: pp.type||'' });
    }
  });
  const optsHtml = '<option value="">선택</option>' +
    groupOpts.map(g => `<option value="${g.key}">케이지 ${g.cage} (${g.type})</option>`).join('');

  const row = document.createElement('div');
  row.id = 'ckRow_'+idx;
  row.style.cssText = 'background:var(--g1);border-radius:8px;padding:12px;margin-bottom:8px;position:relative';
  row.innerHTML = `
    <button onclick="removeCkRow(${idx})" style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--g4);font-size:16px;cursor:pointer">✕</button>
    <div style="font-size:12px;font-weight:700;color:var(--g6);margin-bottom:8px">탱크 ${idx+1}</div>
    <div class="fg">
      <div class="fgrp">
        <label class="fl">탱크 번호 <span class="req">*</span></label>
        <select class="fc ck-row-tank" data-idx="${idx}">
          <option value="">선택</option>
          <option>1번탱크</option><option>2번탱크</option><option>3번탱크</option><option>4번탱크</option>
          <option>5번탱크</option><option>6번탱크</option><option>7번탱크</option>
        </select>
      </div>
      <div class="fgrp cs2">
        <label class="fl">케이지 묶음 <span class="req">*</span></label>
        <select class="fc ck-row-group" data-idx="${idx}" onchange="onCkRowGroupChange(${idx})">
          ${optsHtml}
        </select>
      </div>
      <div class="fgrp">
        <label class="fl">부위</label>
        <input class="fc ck-row-type" type="text" readonly placeholder="(자동)" data-idx="${idx}" style="background:#f3f4f6;color:var(--g6)">
      </div>
      <input type="hidden" class="ck-row-cage" data-idx="${idx}">
      <div class="fgrp">
        <label class="fl">시작시간 <span class="req">*</span></label>
        <input class="fc ck-row-start" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" data-idx="${idx}">
      </div>
      <div class="fgrp" style="display:flex;align-items:flex-end">
        <button type="button" class="btn bo bsm" onclick="setCkRowNow(${idx})">🕐 지금으로</button>
      </div>
    </div>`;
  document.getElementById('ck_tankRows').appendChild(row);
}

function onCkRowGroupChange(idx){
  const row = document.getElementById('ckRow_'+idx);
  if(!row) return;
  const val = row.querySelector('.ck-row-group').value;
  const [cage, type] = val.split('|');
  row.querySelector('.ck-row-cage').value = cage || '';
  row.querySelector('.ck-row-type').value = type || '';
}

function removeCkRow(idx){
  const el = document.getElementById('ckRow_'+idx);
  if(el) el.remove();
}

function setCkNow(){
  document.getElementById('ck_startTime').value = nowHM();
}
function setCkRowNow(idx){
  const row=document.getElementById('ckRow_'+idx);
  if(row){ const inp=row.querySelector('.ck-row-start'); if(inp) inp.value=nowHM(); }
}

function showCkStartCard(){
  document.getElementById('ck_startCard').style.display='';
  document.getElementById('ck_startCard').scrollIntoView({behavior:'smooth', block:'start'});
}

async function onCkStartBtn(){
  const rows = document.querySelectorAll('#ck_tankRows > div');
  if(!rows.length){ toast('탱크를 먼저 추가하세요','d'); return; }
  if(!L.cooking_pending) L.cooking_pending = [];
  // 공통 인원
  const workers = parseFloat((document.getElementById('ck_workers')||{}).value) || 0;
  if(workers <= 0){ toast('인원을 입력하세요','d'); return; }
  let added = 0;
  let abort = false;
  rows.forEach(row => {
    if(abort) return;
    const tank = row.querySelector('.ck-row-tank').value;
    if(!tank){ toast('탱크번호를 선택하세요','d'); abort=true; return; }
    const startTime = row.querySelector('.ck-row-start')?.value || '';
    if(!startTime){ toast('시작시간을 입력하세요','d'); abort=true; return; }
    const type = row.querySelector('.ck-row-type').value;
    const cage = row.querySelector('.ck-row-cage').value.trim();
    if(!cage){ toast('케이지 묶음을 선택하세요','d'); abort=true; return; }
    L.cooking_pending.push({ id:gid(), date:DDATE||tod(), tank, type, cage, workers, start:startTime, end:'', kg:0, wagonOut:'', note:'' });
    added++;
  });
  if(abort) return;

  if(!added) return;
  saveL();

  // ★ Firebase 동기화 (packing_pending 패턴 — 다른 디바이스 가시성 확보)
  // 5/4 사고와 같은 종류의 위험 차단: cooking_pending이 localStorage 전용이던 결함 해결
  const pendingToSave = L.cooking_pending.filter(r => !r.fbId && String(r.date||'').slice(0,10) === tod() && (!r.end || r.end === ''));
  for(const rec of pendingToSave) {
    try {
      const fbId = await fbSave('cooking_pending', rec);
      if(fbId) { rec.fbId = fbId; }
    } catch(e) {
      console.error('[cooking] cooking_pending Firebase 저장 실패:', e);
      toast('자숙 시작 동기화 실패: 다른 기기에서 안 보일 수 있음','w');
    }
  }
  saveL();

  document.getElementById('ck_tankRows').innerHTML='';
  document.getElementById('ck_startTime').value='';
  _ckRowIdx=0;
  document.querySelectorAll('.ck-cage-cb').forEach(c=>c.checked=false);

  document.getElementById('ck_startCard').style.display='none';
  document.getElementById('ck_pendingCard').style.display='';
  renderCkPending();
  toast(`자숙 시작 — ${added}개 탱크 진행중 ✓`,'i');
}

function renderCkPending(){
  if(!L.cooking_pending) L.cooking_pending=[];
  const pending = L.cooking_pending.filter(r=>String(r.date||'').slice(0,10)===tod());
  const el = document.getElementById('ck_pendingList');
  const cntEl = document.getElementById('ck_pendingCnt');
  const card = document.getElementById('ck_pendingCard');
  if(!el) return;
  if(cntEl) cntEl.textContent = pending.length+'개';
  if(!pending.length){ card.style.display='none'; el.innerHTML=''; return; }
  card.style.display='';

  el.innerHTML = pending.map(r=>`
    <div id="ckPend_${r.id}" style="border:1px solid var(--g2);border-radius:8px;margin-bottom:10px;overflow:hidden">
      <div style="background:#f0fdf4;padding:12px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--g8)">${r.tank} · ${r.type||'타입미정'} · 케이지 ${r.cage||'-'}</div>
          <div style="font-size:12px;color:var(--g5);margin-top:3px">시작 ${r.start} · ${r.workers}명</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn bs bsm" onclick="toggleCkEndForm('${r.id}')">종료 입력</button>
          <button class="btn bo bsm" style="color:var(--d);border-color:var(--d)" onclick="deleteCkPending('${r.id}')">삭제</button>
        </div>
      </div>
      <div id="ckEndForm_${r.id}" style="display:none;padding:12px;background:#fff">
        <div class="fg" style="margin-bottom:8px">
          <div class="fgrp">
            <label class="fl">종료시간 <span class="req">*</span></label>
            <input class="fc" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" id="ckEnd_t_${r.id}">
          </div>
          <div class="fgrp" style="display:flex;align-items:flex-end">
            <button type="button" class="btn bo bsm" onclick="document.getElementById('ckEnd_t_${r.id}').value=nowHM()">⏱지금</button>
          </div>
        </div>
        <div style="font-size:11px;color:var(--g5);margin-bottom:4px">배출 와건 분배 (와건번호 + kg)</div>
        <div class="ck-end-wagons" id="ckEnd_wagons_${r.id}" style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px"></div>
        <div style="display:flex;gap:4px;margin-bottom:8px;align-items:center;justify-content:space-between;font-size:11px">
          <button onclick="ckAddWagon('${r.id}')" style="padding:4px 8px;font-size:11px;border:1px dashed #1a56db;background:#fff;color:#1a56db;border-radius:4px;cursor:pointer">+ 와건 추가</button>
          <span id="ckEnd_sum_${r.id}" style="color:var(--g5);font-weight:500">합계 0kg</span>
        </div>
        <div class="fg">
          <div class="fgrp">
            <label class="fl">자숙 KG <span style="font-size:11px;color:var(--g4)">(자동)</span></label>
            <input class="fc" type="number" step="0.01" id="ckEnd_kg_${r.id}" placeholder="0.00" readonly style="background:#f8f8f8">
          </div>
          <div class="fgrp">
            <label class="fl">특이사항</label>
            <input class="fc" type="text" id="ckEnd_note_${r.id}">
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn bs bblk" style="flex:1" onclick="saveCkEnd('${r.id}')">종료 저장</button>
          <button class="btn bo bsm" onclick="toggleCkEndForm('${r.id}')">취소</button>
        </div>
      </div>
    </div>`).join('');
}

function ckAddWagon(pendId){
  const c = document.getElementById('ckEnd_wagons_'+pendId);
  if(!c) return;
  const row = document.createElement('div');
  row.className = 'ck-end-wrow';
  row.style.cssText = 'display:grid;grid-template-columns:80px 1fr 1fr 28px;gap:4px;align-items:center';
  row.innerHTML = `
    <input class="fc ck-w-num" type="text" placeholder="와건" oninput="ckSumChange('${pendId}')" style="padding:5px 7px;font-size:12px;box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:2px">
      <input class="fc ck-w-in" type="number" step="0.01" placeholder="투입" oninput="ckSumChange('${pendId}')" style="padding:5px 7px;font-size:12px;box-sizing:border-box;flex:1;text-align:right;background:#fff5f5">
      <span style="font-size:10px;color:var(--g5)">kg</span>
    </div>
    <div style="display:flex;align-items:center;gap:2px">
      <input class="fc ck-w-kg" type="number" step="0.01" placeholder="배출" oninput="ckSumChange('${pendId}')" style="padding:5px 7px;font-size:12px;box-sizing:border-box;flex:1;text-align:right;background:#f5fff5">
      <span style="font-size:10px;color:var(--g5)">kg</span>
    </div>
    <button onclick="this.closest('.ck-end-wrow').remove();ckSumChange('${pendId}')" style="width:24px;height:28px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:var(--d);font-size:13px;cursor:pointer;padding:0">−</button>`;
  c.appendChild(row);
  ckSumChange(pendId);
}

function ckSumChange(pendId){
  const c = document.getElementById('ckEnd_wagons_'+pendId);
  if(!c) return;
  let sumIn = 0, sumOut = 0;
  c.querySelectorAll('.ck-end-wrow').forEach(row => {
    sumIn += parseFloat((row.querySelector('.ck-w-in')||{}).value) || 0;
    sumOut += parseFloat((row.querySelector('.ck-w-kg')||{}).value) || 0;
  });
  const sumEl = document.getElementById('ckEnd_sum_'+pendId);
  if(sumEl) sumEl.innerHTML = `투입 <b style="color:#b91c1c">${sumIn.toFixed(2)}kg</b> · 배출 <b style="color:#16a34a">${sumOut.toFixed(2)}kg</b>`;
  // 자숙 KG = 배출 (다음 공정으로)
  const kgInp = document.getElementById('ckEnd_kg_'+pendId);
  if(kgInp) kgInp.value = sumOut ? sumOut.toFixed(2) : '';
}

function toggleCkEndForm(id){
  const form = document.getElementById('ckEndForm_'+id);
  if(form){
    form.style.display = form.style.display==='none'?'':'none';
    // 처음 펼칠 때 와건 행 자동 1개 추가
    if(form.style.display !== 'none'){
      const c = document.getElementById('ckEnd_wagons_'+id);
      if(c && c.children.length === 0) ckAddWagon(id);
    }
  }
}

async function deleteCkPending(id){
  if(!confirm('진행중인 자숙을 삭제하시겠습니까?')) return;
  if(!L.cooking_pending) L.cooking_pending=[];
  const rec = L.cooking_pending.find(r=>r.id===id);
  if(rec && rec.fbId){
    // ★ 'cooking' → 'cooking_pending' 정정 (이전 코드는 잘못된 컬렉션 참조 = dead code)
    try { await fbDelete('cooking_pending', rec.fbId); }
    catch(e){ console.error('Firebase cooking_pending 삭제 오류',e); }
  }
  L.cooking_pending = L.cooking_pending.filter(r=>r.id!==id);
  saveL();
  renderCkPending();
  toast('자숙 삭제됨','i');
}

async function saveCkEnd(id){
  if(!L.cooking_pending) L.cooking_pending=[];
  const rec = L.cooking_pending.find(r=>r.id===id);
  if(!rec){ toast('데이터 없음','d'); return; }
  const end = document.getElementById('ckEnd_t_'+id).value;
  const note = document.getElementById('ckEnd_note_'+id).value.trim();
  if(!end){ toast('종료시간을 입력하세요','d'); return; }

  // 와건 분배 수집 (투입 + 배출)
  const wagonDist = {};   // 배출 (와건에 담긴 양)
  const wagonInDist = {}; // 투입 (케이지에서 빠진 양)
  const wagonList = [];
  let commaErr = false;
  const c = document.getElementById('ckEnd_wagons_'+id);
  if(c){
    c.querySelectorAll('.ck-end-wrow').forEach(row => {
      const wn = (row.querySelector('.ck-w-num')||{}).value || '';
      const inKg = parseFloat((row.querySelector('.ck-w-in')||{}).value) || 0;
      const outKg = parseFloat((row.querySelector('.ck-w-kg')||{}).value) || 0;
      if(wn && wn.includes(',')){ commaErr = true; return; }
      if(wn && (inKg || outKg)){
        const key = String(wn).trim();
        if(outKg) wagonDist[key] = (wagonDist[key]||0) + outKg;
        if(inKg) wagonInDist[key] = (wagonInDist[key]||0) + inKg;
        if(!wagonList.includes(key)) wagonList.push(key);
      }
    });
  }
  if(commaErr){ toast('산출 와건은 1개씩 입력 (여러 개면 행 추가)','d'); return; }
  let totalIn = 0, totalOut = 0;
  Object.values(wagonInDist).forEach(v => totalIn += v);
  Object.values(wagonDist).forEach(v => totalOut += v);
  if(!totalOut && !totalIn){ toast('배출 와건 분배를 입력하세요','d'); return; }

  const completed = {
    ...rec,
    end,
    kg: totalOut,                 // 자숙 kg = 배출 기준
    kgIn: totalIn,                // 신규: 투입 (케이지에서)
    wagonOut: wagonList.join(','),
    wagonDist: wagonDist,         // 배출 (와건에 들어간 양)
    wagonInDist: wagonInDist,     // 투입 (케이지에서 빠진 양)
    note
  };
  L.cooking_pending = L.cooking_pending.filter(r=>r.id!==id);
  L.cooking.push(completed);
  saveL();

  // ★ cooking_pending Firebase에서 삭제 (packing 패턴 동일)
  if(rec.fbId) {
    try { await fbDelete('cooking_pending', rec.fbId); }
    catch(e) { console.error('[cooking] cooking_pending 삭제 실패:', e); }
  }

  const fbId = await fbSave('cooking', completed);
  if(fbId){ completed.fbId=fbId; saveL(); toast(`${completed.tank} 종료 저장됨 ✓`); }
  else { toast('저장 실패 - 로컬에만 저장됨','d'); }

  renderCkPending();
  renderPL('cooking');
  if(typeof sh2Render==='function') sh2Render();
}