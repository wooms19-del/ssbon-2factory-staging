// ============================================================
// preprocess_v2.js — 새 전처리 UI (스테이징 전용)
//
// 변경 핵심:
// - 작업자 입력: 케이지 번호 / 부위 / 무게 / 비가식부 / 시작-종료
// - 대차 선택 X → 시스템이 FIFO로 자동 차감 (같은 부위 thawing 중 가장 오래된 것부터)
// - "오늘 전처리 종료" 버튼 → 남은 대차 잔량 모두 0 (핏물 손실 처리)
// - 이력 추적: 케이지 record에 fifoDeducts 배열 저장
// ============================================================

// 외부 호환 — 탭 진입 시 호출되는 함수 이름 동일 유지
async function loadOpenThawingAndRender(){
  await pp2Render();
}
// 외부 호환 — 기존 코드가 호출하던 onPpStartBtn (사용 안 함, 빈 함수)
function onPpStartBtn(){ pp2SaveAll(); }
// 외부 호환 — globals.js가 참조하는 onPpWagonChange (v2에선 사용 안 함, 빈 stub)
function onPpWagonChange(){ /* v2 미사용 */ }

let _pp2RowIdx = 0;

// ============================================================
// 메인 렌더
// ============================================================
async function pp2Render(){
  const root = document.getElementById('p-preprocess');
  if(!root) return;

  // thawing 데이터에서 부위/잔량 집계
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const thList = (L.thawing||[]).filter(t => t.date === today && (parseFloat(t.remainKg)||0) > 0.01);
  const remainByType = {};
  thList.forEach(t => {
    const ty = t.type || '?';
    remainByType[ty] = (remainByType[ty]||0) + (parseFloat(t.remainKg)||0);
  });

  // 사용 가능한 부위 = thawing에 잔량 있는 것 + 기존 케이지 부위
  const allTypes = new Set(Object.keys(remainByType));
  (L.preprocess||[]).filter(p => p.date === today).forEach(p => {
    if(p.type) allTypes.add(p.type);
  });
  const typeOptions = ['우둔', '홍두깨', '도가니', '아롱사태', '사태', '안창살'];
  typeOptions.forEach(t => {
    if(remainByType[t] !== undefined) allTypes.add(t);
  });

  root.innerHTML = `
    <!-- 방혈 잔량 현황 -->
    <div class="card">
      <div class="ct">🧊 방혈 잔량 (FIFO 차감 대상)</div>
      <div id="pp2_remain">${pp2RenderRemain(thList, remainByType)}</div>
    </div>

    <!-- 입력 카드 -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="ct" style="margin:0">전처리 케이지 입력</div>
        <button class="btn bo bsm" style="color:var(--d);border-color:var(--d);font-weight:600" onclick="pp2FinishDay()">⏹ 오늘 전처리 종료</button>
      </div>
      <div style="font-size:11px;color:var(--g5);margin-bottom:8px">
        케이지 번호 · 부위 · 무게 · 비가식부 · 시작/종료만 입력하면 시스템이 대차에서 가장 오래된 순서대로 자동 차감
      </div>
      <div id="pp2_rows"></div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="btn bo bsm" onclick="pp2AddRow()" style="flex:1;padding:10px">+ 케이지 추가</button>
        <button class="btn bp bblk" onclick="pp2SaveAll()" style="flex:2;padding:10px">전체 저장</button>
      </div>
    </div>

    <!-- 오늘 전처리 목록 -->
    <div class="card">
      <div class="ct">오늘 전처리</div>
      <div id="pp2_list">${pp2RenderTodayList()}</div>
    </div>
  `;

  // 초기 row 1개 자동 추가
  _pp2RowIdx = 0;
  pp2AddRow();
}

// ============================================================
// 방혈 잔량 표시
// ============================================================
function pp2RenderRemain(thList, remainByType){
  if(!thList.length) return '<div class="emp">방혈 완료된 원육 없음</div>';
  const types = Object.entries(remainByType);
  return `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      ${types.map(([ty, kg]) => `
        <div style="background:#f0f7ff;border:1px solid #1a56db;border-radius:8px;padding:8px 14px;font-size:13px">
          <strong style="color:#1a56db">${ty}</strong> · ${kg.toFixed(2)}kg
        </div>
      `).join('')}
    </div>
    <div style="font-size:11px;color:var(--g5)">
      ※ FIFO 차감: 가장 오래된 대차부터 (케이지 무게 + 비가식부) 만큼 자동 차감
    </div>
  `;
}

// ============================================================
// 입력 row 추가
// ============================================================
function pp2AddRow(data){
  data = data || {};
  const idx = _pp2RowIdx++;
  const types = new Set();
  (L.thawing||[]).forEach(t => {
    if(t.date === ((typeof tod==='function')?tod():'') && (parseFloat(t.remainKg)||0) > 0.01){
      if(t.type) types.add(t.type);
    }
  });
  // 표시할 부위 목록 — 잔량 있는 것
  const typeList = [...types];
  if(!typeList.length){
    // 잔량 없으면 기본 옵션
    typeList.push('우둔','홍두깨');
  }
  const typeOpts = '<option value="">선택</option>' + typeList.map(t =>
    `<option value="${t}" ${t===data.type?'selected':''}>${t}</option>`
  ).join('');

  // 케이지 번호 1~10
  const cageOpts = '<option value="">선택</option>' +
    [1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}" ${n==data.cage?'selected':''}>케이지 ${n}번</option>`).join('');

  const c = document.getElementById('pp2_rows');
  if(!c) return;

  const row = document.createElement('div');
  row.id = 'pp2Row_'+idx;
  row.dataset.idx = idx;
  row.style.cssText = 'background:var(--g1);border-radius:8px;padding:12px;margin-bottom:8px;position:relative';
  row.innerHTML = `
    <button onclick="pp2RemoveRow(${idx})" style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--g4);font-size:16px;cursor:pointer">✕</button>
    <div class="fg">
      <div class="fgrp">
        <label class="fl">케이지 <span class="req">*</span></label>
        <select class="fc pp2-cage" data-idx="${idx}">${cageOpts}</select>
      </div>
      <div class="fgrp">
        <label class="fl">부위 <span class="req">*</span></label>
        <select class="fc pp2-type" data-idx="${idx}">${typeOpts}</select>
      </div>
      <div class="fgrp">
        <label class="fl">케이지 무게 (kg) <span class="req">*</span></label>
        <input class="fc pp2-kg" type="number" step="0.01" placeholder="0.00" data-idx="${idx}" value="${data.kg||''}">
      </div>
      <div class="fgrp">
        <label class="fl">비가식부 (kg)</label>
        <input class="fc pp2-waste" type="number" step="0.01" placeholder="0.00" data-idx="${idx}" value="${data.waste||''}">
      </div>
      <div class="fgrp">
        <label class="fl">인원</label>
        <input class="fc pp2-workers" type="number" placeholder="0" data-idx="${idx}" value="${data.workers||''}">
      </div>
      <div class="fgrp">
        <label class="fl">시작 <span class="req">*</span></label>
        <div style="display:flex;gap:4px">
          <input class="fc pp2-start" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" data-idx="${idx}" value="${data.start||''}" style="flex:1">
          <button class="btn bo bsm" onclick="pp2SetNow(${idx},'start')" style="white-space:nowrap;padding:0 10px">지금</button>
        </div>
      </div>
      <div class="fgrp">
        <label class="fl">종료 <span class="req">*</span></label>
        <div style="display:flex;gap:4px">
          <input class="fc pp2-end" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" data-idx="${idx}" value="${data.end||''}" style="flex:1">
          <button class="btn bo bsm" onclick="pp2SetNow(${idx},'end')" style="white-space:nowrap;padding:0 10px">지금</button>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn bs bsm" onclick="pp2SaveOne(${idx})" style="flex:1">이 케이지만 저장</button>
    </div>
  `;
  c.appendChild(row);
}

function pp2RemoveRow(idx){
  const el = document.getElementById('pp2Row_'+idx);
  if(el) el.remove();
}

function pp2SetNow(idx, kind){
  const el = document.querySelector(`#pp2Row_${idx} .pp2-${kind}`);
  if(el) el.value = (typeof nowHM==='function') ? nowHM() : new Date().toTimeString().slice(0,5);
}

// ============================================================
// row 데이터 추출 + 검증
// ============================================================
function pp2GetRowData(idx){
  const row = document.getElementById('pp2Row_'+idx);
  if(!row) return null;
  return {
    cage: parseInt(row.querySelector('.pp2-cage').value) || 0,
    type: row.querySelector('.pp2-type').value || '',
    kg: parseFloat(row.querySelector('.pp2-kg').value) || 0,
    waste: parseFloat(row.querySelector('.pp2-waste').value) || 0,
    workers: parseInt(row.querySelector('.pp2-workers').value) || 0,
    start: row.querySelector('.pp2-start').value.trim(),
    end: row.querySelector('.pp2-end').value.trim(),
  };
}

function pp2Validate(d){
  if(!d.cage){ return '케이지 번호 선택'; }
  if(!d.type){ return '부위 선택'; }
  if(!(d.kg > 0)){ return '케이지 무게 입력'; }
  if(d.waste < 0){ return '비가식부 음수 불가'; }
  if(!/^\d{1,2}:\d{2}$/.test(d.start)){ return '시작시간 HH:MM'; }
  if(!/^\d{1,2}:\d{2}$/.test(d.end)){ return '종료시간 HH:MM'; }
  return null;
}

// ============================================================
// FIFO 차감 — 같은 부위 thawing 중 오래된 것부터
// ============================================================
function pp2FifoDeduct(type, totalKg){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  // 같은 부위, 오늘, 잔량>0
  const candidates = (L.thawing||[])
    .filter(t => t.date === today && t.type === type && (parseFloat(t.remainKg)||0) > 0.01)
    .sort((a,b) => {
      // 가장 오래된 것부터 — start 시각 기준, 없으면 _id timestamp
      const aT = a.start || a._id || a.id || '';
      const bT = b.start || b._id || b.id || '';
      return aT.localeCompare(bT);
    });

  const deducts = [];
  let need = totalKg;
  for(const th of candidates){
    if(need <= 0.01) break;
    const avail = parseFloat(th.remainKg) || 0;
    const take = Math.min(avail, need);
    if(take > 0.01){
      deducts.push({
        thId: th.id,
        fbId: th.fbId || null,
        importCode: th.importCode || '',
        kg: parseFloat(take.toFixed(2)),
      });
      th.remainKg = parseFloat((avail - take).toFixed(2));
      need = parseFloat((need - take).toFixed(2));
    }
  }
  return { deducts, shortage: need > 0.01 ? need : 0 };
}

// ============================================================
// 저장 (개별 1개)
// ============================================================
async function pp2SaveOne(idx){
  const d = pp2GetRowData(idx);
  if(!d) return;
  const err = pp2Validate(d);
  if(err){ toast(err,'d'); return; }
  await pp2SaveRecords([{idx, data:d}]);
}

// ============================================================
// 저장 (전체)
// ============================================================
async function pp2SaveAll(){
  const rows = document.querySelectorAll('#pp2_rows > div[id^="pp2Row_"]');
  if(!rows.length){ toast('입력된 케이지 없음','d'); return; }
  const items = [];
  for(const row of rows){
    const idx = parseInt(row.dataset.idx);
    const d = pp2GetRowData(idx);
    if(!d) continue;
    const err = pp2Validate(d);
    if(err){ toast(`케이지 ${d.cage||'?'}번: ${err}`,'d'); return; }
    items.push({idx, data:d});
  }
  if(!items.length){ toast('저장할 데이터 없음','d'); return; }
  await pp2SaveRecords(items);
}

// ============================================================
// 실제 저장 로직
// ============================================================
async function pp2SaveRecords(items){
  if(!L.preprocess) L.preprocess = [];
  if(!L.thawing) L.thawing = [];

  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const savedIdxs = [];

  for(const {idx, data:d} of items){
    const totalDeduct = d.kg + d.waste;
    // FIFO 차감
    const {deducts, shortage} = pp2FifoDeduct(d.type, totalDeduct);
    if(shortage > 0.01){
      const conf = confirm(
        `${d.type} 잔량이 ${shortage.toFixed(2)}kg 부족합니다.\n` +
        `(필요: ${totalDeduct.toFixed(2)}kg, 차감 가능: ${(totalDeduct-shortage).toFixed(2)}kg)\n\n` +
        `그대로 저장하시겠어요? (대차 잔량은 가능한 만큼만 차감)`
      );
      if(!conf) continue;
    }

    // 케이지 record 생성
    const rec = {
      id: (typeof gid==='function') ? gid() : ('pp2_'+Date.now()+'_'+idx),
      date: today,
      cage: d.cage,
      type: d.type,
      kg: parseFloat(d.kg.toFixed(2)),
      waste: parseFloat(d.waste.toFixed(2)),
      workers: d.workers,
      start: d.start,
      end: d.end,
      fifoDeducts: deducts,           // 이력 추적
      _v: 2,                          // 새 UI로 만든 record 마커
    };
    L.preprocess.push(rec);

    // Firebase 저장 — preprocess
    if(typeof fbSave === 'function'){
      try {
        const fbId = await fbSave('preprocess', rec);
        if(fbId) rec.fbId = fbId;
      } catch(e){ console.error('preprocess fbSave 실패', e); }
    }
    // Firebase 갱신 — thawing remainKg
    for(const ded of deducts){
      const th = L.thawing.find(t => t.id === ded.thId);
      if(th && th.fbId && typeof fbUpdate==='function'){
        try { await fbUpdate('thawing', th.fbId, {remainKg: th.remainKg}); }
        catch(e){ console.error('thawing remainKg 갱신 실패', e); }
      }
    }
    savedIdxs.push(idx);
  }

  if(typeof saveL === 'function') saveL();

  // 저장된 row 제거
  savedIdxs.forEach(i => pp2RemoveRow(i));
  // row 다 없어졌으면 새 row 1개 추가
  const rows = document.querySelectorAll('#pp2_rows > div[id^="pp2Row_"]');
  if(!rows.length) pp2AddRow();

  // 화면 재렌더 (잔량/목록 갱신)
  await pp2Refresh();
  toast(`전처리 ${savedIdxs.length}건 저장 ✓`,'s');
}

// ============================================================
// 부분 갱신 (전체 리렌더 안 하고 잔량+목록만)
// ============================================================
async function pp2Refresh(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const thList = (L.thawing||[]).filter(t => t.date === today && (parseFloat(t.remainKg)||0) > 0.01);
  const remainByType = {};
  thList.forEach(t => {
    const ty = t.type || '?';
    remainByType[ty] = (remainByType[ty]||0) + (parseFloat(t.remainKg)||0);
  });
  const remEl = document.getElementById('pp2_remain');
  if(remEl) remEl.innerHTML = pp2RenderRemain(thList, remainByType);

  const listEl = document.getElementById('pp2_list');
  if(listEl) listEl.innerHTML = pp2RenderTodayList();
}

// ============================================================
// 오늘 작업 목록
// ============================================================
function pp2RenderTodayList(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const list = (L.preprocess||[])
    .filter(p => p.date === today)
    .sort((a,b) => (a.start||'').localeCompare(b.start||''));

  if(!list.length) return '<div class="emp">데이터 없음</div>';

  let totalKg = 0, totalWaste = 0;
  list.forEach(p => { totalKg += parseFloat(p.kg)||0; totalWaste += parseFloat(p.waste)||0; });

  return `
    <div style="background:#f8fafc;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px">
      총 ${list.length}건 · 케이지 합계 ${totalKg.toFixed(2)}kg · 비가식부 ${totalWaste.toFixed(2)}kg
    </div>
    ${list.map(p => `
      <div style="border:1px solid var(--g2);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <strong style="font-size:14px">케이지 ${p.cage}번 · ${p.type}</strong>
            <span style="font-size:12px;color:var(--g5);margin-left:8px">${p.start||'-'} ~ ${p.end||'-'}</span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn bo bsm" onclick="pp2EditRecord('${p.id}')">수정</button>
            <button class="btn bo bsm" style="color:var(--d);border-color:var(--d)" onclick="pp2DeleteRecord('${p.id}')">삭제</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--g6)">
          무게 ${(parseFloat(p.kg)||0).toFixed(2)}kg · 비가식부 ${(parseFloat(p.waste)||0).toFixed(2)}kg · 인원 ${p.workers||0}명
        </div>
        ${p.fifoDeducts && p.fifoDeducts.length ? `
          <div style="font-size:11px;color:var(--g5);margin-top:4px;padding-top:6px;border-top:1px dashed var(--g2)">
            대차 차감: ${p.fifoDeducts.map(d => `${d.kg.toFixed(2)}kg(${d.importCode ? d.importCode.slice(-8) : d.thId.slice(0,8)})`).join(' · ')}
          </div>
        ` : ''}
      </div>
    `).join('')}
  `;
}

// ============================================================
// 수정 / 삭제
// ============================================================
async function pp2EditRecord(id){
  const rec = (L.preprocess||[]).find(p => p.id === id);
  if(!rec){ toast('데이터 없음','d'); return; }
  // 먼저 차감 되돌리기 (이 record의 fifoDeducts를 thawing에 다시 더함)
  if(!confirm('이 케이지 record를 수정합니다.\n기존 차감을 되돌리고 입력 폼에 값을 채워줄까요?')) return;
  await pp2RestoreDeducts(rec);
  // record 제거
  await pp2DeleteRecordInternal(id, /*silent*/ true);
  // 입력 폼에 채움
  pp2AddRow({
    cage: rec.cage,
    type: rec.type,
    kg: rec.kg,
    waste: rec.waste,
    workers: rec.workers,
    start: rec.start,
    end: rec.end,
  });
  toast('수정 모드: 값을 고치고 저장','i');
  // 스크롤
  document.getElementById('pp2_rows')?.scrollIntoView({behavior:'smooth', block:'start'});
}

async function pp2DeleteRecord(id){
  if(!confirm('이 케이지 record를 삭제하시겠습니까?\n(대차 차감도 되돌려집니다)')) return;
  const rec = (L.preprocess||[]).find(p => p.id === id);
  if(rec) await pp2RestoreDeducts(rec);
  await pp2DeleteRecordInternal(id);
}

async function pp2DeleteRecordInternal(id, silent){
  const rec = (L.preprocess||[]).find(p => p.id === id);
  if(!rec){ if(!silent) toast('데이터 없음','d'); return; }
  if(rec.fbId && typeof fbDelete==='function'){
    try { await fbDelete('preprocess', rec.fbId); }
    catch(e){ console.error('preprocess 삭제 실패', e); }
  }
  L.preprocess = (L.preprocess||[]).filter(p => p.id !== id);
  if(typeof saveL==='function') saveL();
  await pp2Refresh();
  if(!silent) toast('삭제됨','i');
}

// 차감 되돌리기 (수정/삭제 시 thawing remainKg 복원)
async function pp2RestoreDeducts(rec){
  if(!rec.fifoDeducts || !rec.fifoDeducts.length) return;
  if(!L.thawing) L.thawing = [];
  for(const ded of rec.fifoDeducts){
    const th = L.thawing.find(t => t.id === ded.thId);
    if(!th) continue;
    th.remainKg = parseFloat(((parseFloat(th.remainKg)||0) + ded.kg).toFixed(2));
    if(th.fbId && typeof fbUpdate==='function'){
      try { await fbUpdate('thawing', th.fbId, {remainKg: th.remainKg}); }
      catch(e){ console.error('thawing 복원 실패', e); }
    }
  }
}

// ============================================================
// 오늘 전처리 종료 — 남은 대차 잔량 모두 0
// ============================================================
async function pp2FinishDay(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const remaining = (L.thawing||[]).filter(t => t.date === today && (parseFloat(t.remainKg)||0) > 0.01);
  if(!remaining.length){ toast('남은 잔량 없음','i'); return; }

  const totalRem = remaining.reduce((s,t) => s + (parseFloat(t.remainKg)||0), 0);
  if(!confirm(
    `오늘 전처리를 종료합니다.\n\n` +
    `남은 대차 ${remaining.length}건의 잔량 합계 ${totalRem.toFixed(2)}kg을 0으로 처리합니다.\n` +
    `(자연 감량/핏물로 처리되어 수율 계산에 반영됩니다.)\n\n` +
    `진행하시겠어요?`
  )) return;

  for(const th of remaining){
    th.remainKg = 0;
    if(th.fbId && typeof fbUpdate==='function'){
      try { await fbUpdate('thawing', th.fbId, {remainKg: 0}); }
      catch(e){ console.error('thawing 종료 실패', e); }
    }
  }
  if(typeof saveL==='function') saveL();
  await pp2Refresh();
  toast(`전처리 종료 — ${remaining.length}건 잔량 0 처리 ✓`,'s');
}

// ============================================================
// window export (다른 코드에서 호출)
// ============================================================
if(typeof window !== 'undefined'){
  window.loadOpenThawingAndRender = loadOpenThawingAndRender;
  window.onPpStartBtn = onPpStartBtn;
  window.pp2Render = pp2Render;
  window.pp2AddRow = pp2AddRow;
  window.pp2RemoveRow = pp2RemoveRow;
  window.pp2SetNow = pp2SetNow;
  window.pp2SaveOne = pp2SaveOne;
  window.pp2SaveAll = pp2SaveAll;
  window.pp2EditRecord = pp2EditRecord;
  window.pp2DeleteRecord = pp2DeleteRecord;
  window.pp2FinishDay = pp2FinishDay;
}
