// ============================================================
// preprocess_v2.js — 새 전처리 UI (스테이징 전용, 테이블 행 방식)
//
// 핵심:
// - 한 행 = 한 작업 record (케이지 번호는 자유 텍스트 "9,10" 가능)
// - 공통 인원 1칸 (상단), 모든 행에 자동 적용
// - 자동 저장: 한 행 필수 필드 채우면 자동 저장
// - FIFO 차감: 같은 부위 thawing 중 가장 오래된 것부터
// - "오늘 전처리 종료" 버튼 → 남은 잔량 0 (수율 즉시 정확)
// - 기존 스키마 호환: thawingTouches, distribution, cageTanks, wagons 등 그대로
// ============================================================

const PP2_TYPES = ['우둔', '홍두깨', '설도'];
const PP2_INIT_ROWS = 6;
let _pp2RowIdx = 0;

// 매칭 룰: 어제 방혈 시작분만 오늘 전처리에 보임 (그 이전은 X)
function pp2StartDateOf(t){
  const s = t.start || '';
  return s.slice(0, 10);  // "2026-05-12 11:46" → "2026-05-12"
}
function pp2YesterdayOf(today){
  // today = "2026-05-12" → "2026-05-11"
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function pp2IsWorkingToday(t, today){
  const startDate = pp2StartDateOf(t);
  if(!startDate) return false;
  return startDate === pp2YesterdayOf(today);  // 정확히 어제만
}

async function loadOpenThawingAndRender(){ await pp2Render(); }

async function pp2Render(){
  const root = document.getElementById('p-preprocess');
  if(!root) return;
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const todayRecs = (L.preprocess||[]).filter(p => p.date === today);
  const lastWorkers = todayRecs.length
    ? (parseInt(todayRecs[todayRecs.length-1].workers) || 7)
    : 7;

  root.innerHTML = `
    <div class="card">
      <div class="ct">🧊 방혈 잔량 (FIFO 차감 대상)</div>
      <div id="pp2_remain">${pp2RenderRemain()}</div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="ct" style="margin:0">전처리 케이지 입력</div>
        <div id="pp2_topbtns" style="display:flex;gap:6px">
          ${pp2HasFinishedToday() ? `<button class="btn bo bsm" style="color:#0891b2;border-color:#0891b2;font-weight:600" onclick="pp2UnfinishDay()">↩ 종료 취소</button>` : ''}
          <button class="btn bo bsm" style="color:var(--d);border-color:var(--d);font-weight:600" onclick="pp2FinishDay()">⏹ 오늘 전처리 종료</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 12px;background:#f0f7ff;border:1px solid #bfdbfe;border-radius:6px">
        <label style="font-size:13px;font-weight:600;color:#1a56db">인원</label>
        <input type="number" id="pp2_workers" value="${lastWorkers}" min="0" step="1"
               style="width:60px;text-align:center;padding:4px 6px;border:1px solid var(--g3);border-radius:4px;font-size:13px">
        <span style="font-size:11px;color:var(--g5)">명 · 변경 시 다음 저장부터 적용</span>
      </div>
      <div style="overflow-x:auto">
        <table id="pp2_table" style="width:100%;border-collapse:collapse;font-size:14px;min-width:900px">
          <thead>
            <tr style="background:#dc2626;color:#fff">
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:40px;font-size:13px">#</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:110px;font-size:13px">부위</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:120px;font-size:13px">케이지번호</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:90px;font-size:13px">시작</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:90px;font-size:13px">종료</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:130px;font-size:13px">전처리KG</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:120px;font-size:13px">비가식부</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:80px;font-size:13px">작업시간</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:44px;font-size:13px"></th>
            </tr>
          </thead>
          <tbody id="pp2_tbody"></tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn bo bsm" onclick="pp2AddRow()" style="flex:1;padding:8px">+ 행 추가</button>
        <button class="btn bp bblk" onclick="pp2SaveAll()" style="flex:2;padding:8px">전체 저장</button>
      </div>
      <div style="font-size:11px;color:var(--g5);margin-top:6px;text-align:center">
        ※ 입력 후 [전체 저장] 버튼을 눌러야 저장됨. ⨯ 로 행 제거.
      </div>
    </div>
    <div class="card">
      <div class="ct">오늘 전처리</div>
      <div id="pp2_list">${pp2RenderTodayList()}</div>
    </div>
  `;
  _pp2RowIdx = 0;
  for(let i = 0; i < PP2_INIT_ROWS; i++) pp2AddRow();
}

function pp2RenderRemain(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const thList = (L.thawing||[]).filter(t => pp2IsWorkingToday(t, today) && (parseFloat(t.remainKg)||0) > 0.01);
  // ★ 입력 중(미저장)인 행의 (kg+waste)를 부위별로 빼기 (미리보기)
  const previewByType = {};
  const tbody = document.getElementById('pp2_tbody');
  if(tbody){
    [...tbody.querySelectorAll('tr')].forEach(tr => {
      if(tr.dataset.saved === '1') return;  // 이미 저장된 행은 잔량에 이미 반영됨
      const type = (tr.querySelector('.pp2-type')||{}).value || '';
      const kg = parseFloat((tr.querySelector('.pp2-kg')||{}).value) || 0;
      const waste = parseFloat((tr.querySelector('.pp2-waste')||{}).value) || 0;
      if(type && (kg + waste) > 0){
        previewByType[type] = (previewByType[type]||0) + kg + waste;
      }
    });
  }
  if(!thList.length && Object.keys(previewByType).length === 0)
    return '<div class="emp">방혈 완료된 원육 없음 (또는 모두 차감됨)</div>';
  const remainByType = {};
  thList.forEach(t => {
    const ty = t.type || '?';
    remainByType[ty] = (remainByType[ty]||0) + (parseFloat(t.remainKg)||0);
  });
  // 부위별 잔량 - 미리보기 차감
  const allTypes = new Set([...Object.keys(remainByType), ...Object.keys(previewByType)]);
  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${[...allTypes].map(ty => {
        const remain = remainByType[ty] || 0;
        const preview = previewByType[ty] || 0;
        const after = remain - preview;
        if(preview > 0){
          // 미리보기 있는 경우 → 차감 표시
          const colorAfter = after < 0 ? '#dc2626' : '#16a34a';
          return `
            <div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:6px 12px;font-size:13px">
              <strong style="color:#92400e">${ty}</strong>
              <span style="color:#9ca3af;text-decoration:line-through">${remain.toFixed(2)}kg</span>
              <span style="margin:0 4px;color:#92400e">→</span>
              <strong style="color:${colorAfter}">${after.toFixed(2)}kg</strong>
              <span style="font-size:11px;color:#92400e;margin-left:4px">(입력중 −${preview.toFixed(2)})</span>
            </div>`;
        }
        return `
          <div style="background:#f0f7ff;border:1px solid #1a56db;border-radius:8px;padding:6px 12px;font-size:13px">
            <strong style="color:#1a56db">${ty}</strong> · ${remain.toFixed(2)}kg
          </div>`;
      }).join('')}
    </div>
  `;
}

function pp2AddRow(data){
  data = data || {};
  const idx = _pp2RowIdx++;
  const tbody = document.getElementById('pp2_tbody');
  if(!tbody) return;
  // 부위 옵션: 오늘 thawing에 잔량 있는 부위만
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const availTypes = [...new Set(
    (L.thawing||[])
      .filter(t => pp2IsWorkingToday(t, today) && (parseFloat(t.remainKg)||0) > 0.01 && t.type)
      .map(t => t.type)
  )];
  // 수정 모드(data.type)에선 잔량 0이어도 그 부위는 포함
  if(data.type && !availTypes.includes(data.type)) availTypes.push(data.type);
  // 잔량 있는 부위만. 잔량 없으면 빈 셀렉트 (작업 불가 상태)
  const typeList = availTypes;
  const typeOpts = '<option value="">선택</option>' +
    typeList.map(t => `<option ${t===data.type?'selected':''}>${t}</option>`).join('');

  // 이전 행의 종료 시각 → 이 행 시작 기본값
  let defaultStart = data.start || '';
  if(!defaultStart && tbody.lastElementChild){
    const lastEnd = tbody.lastElementChild.querySelector('.pp2-end')?.value || '';
    if(lastEnd) defaultStart = lastEnd;
  }

  const tr = document.createElement('tr');
  tr.id = 'pp2Tr_'+idx;
  tr.dataset.idx = idx;
  tr.style.cssText = 'background:#fef3c7';
  tr.innerHTML = `
    <td style="border:1px solid #ddd;text-align:center;padding:8px 4px;background:#fff;font-size:13px;font-weight:600">${tbody.children.length + 1}</td>
    <td style="border:1px solid #ddd;padding:0">
      <select class="pp2-type" style="width:100%;height:42px;border:none;padding:0 6px;background:transparent;font-size:14px" onchange="pp2OnCellChange(${idx})">${typeOpts}</select>
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="pp2-cage" type="text" value="${data.cage||''}" placeholder="예: 9,10"
             style="width:100%;height:42px;border:none;padding:0 6px;background:transparent;font-size:14px;text-align:center"
             onchange="pp2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="pp2-start" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM"
             value="${defaultStart}"
             style="width:100%;height:42px;border:none;padding:0 6px;background:transparent;font-size:14px;text-align:center"
             onchange="pp2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="pp2-end" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM"
             value="${data.end||''}"
             style="width:100%;height:42px;border:none;padding:0 6px;background:transparent;font-size:14px;text-align:center"
             onchange="pp2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="pp2-kg" type="number" step="0.01" placeholder="0.00"
             value="${data.kg||''}"
             style="width:100%;height:42px;border:none;padding:0 8px;background:transparent;font-size:14px;text-align:right"
             onchange="pp2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="pp2-waste" type="number" step="0.01" placeholder="0.00"
             value="${data.waste||''}"
             style="width:100%;height:42px;border:none;padding:0 8px;background:transparent;font-size:14px;text-align:right"
             onchange="pp2OnCellChange(${idx})">
    </td>
    <td class="pp2-dur" style="border:1px solid #ddd;text-align:center;padding:8px 4px;background:#fff;color:var(--g5);font-size:13px">-</td>
    <td style="border:1px solid #ddd;text-align:center;padding:0;background:#fff">
      <button onclick="pp2RemoveRow(${idx})" style="width:36px;height:42px;background:none;border:none;color:var(--g4);font-size:18px;cursor:pointer">⨯</button>
    </td>
  `;
  tbody.appendChild(tr);
}

async function pp2RemoveRow(idx){
  const tr = document.getElementById('pp2Tr_'+idx);
  if(!tr) return;
  // ★ 이미 저장된 행이면 DB에서도 삭제 + 잔량 복원
  if(tr.dataset.saved === '1' && tr.dataset.recId){
    if(!confirm('이 행은 이미 저장되었습니다. DB에서도 삭제하시겠습니까?')){
      return;
    }
    const recId = tr.dataset.recId;
    const rec = (L.preprocess||[]).find(p => p.id === recId);
    if(rec){
      await pp2RestoreTouches(rec);
      await pp2DeleteRecordInternal(recId);
    }
  }
  tr.remove();
  pp2ReindexRows();
  // 잔량 카드 갱신 (미리보기 + 복원 둘 다 반영)
  const remEl = document.getElementById('pp2_remain');
  if(remEl) remEl.innerHTML = pp2RenderRemain();
}

function pp2ReindexRows(){
  const tbody = document.getElementById('pp2_tbody');
  if(!tbody) return;
  [...tbody.querySelectorAll('tr')].forEach((tr, i) => {
    const first = tr.querySelector('td');
    if(first) first.textContent = i + 1;
  });
}

function pp2OnCellChange(idx){
  const tr = document.getElementById('pp2Tr_'+idx);
  if(!tr) return;
  const start = tr.querySelector('.pp2-start').value.trim();
  const end = tr.querySelector('.pp2-end').value.trim();
  const dur = pp2CalcDur(start, end);
  const durCell = tr.querySelector('.pp2-dur');
  if(durCell) durCell.textContent = dur !== null ? dur.toFixed(2) : '-';
  // ★ 잔량 카드 실시간 미리보기 차감
  const remEl = document.getElementById('pp2_remain');
  if(remEl) remEl.innerHTML = pp2RenderRemain();
}

function pp2CalcDur(start, end){
  if(!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh*60+em) - (sh*60+sm);
  if(mins < 0) mins += 24*60;
  return mins / 60;
}

function pp2GetRowData(idx){
  const tr = document.getElementById('pp2Tr_'+idx);
  if(!tr) return null;
  return {
    type: tr.querySelector('.pp2-type').value || '',
    cage: tr.querySelector('.pp2-cage').value.trim() || '',
    start: tr.querySelector('.pp2-start').value.trim() || '',
    end: tr.querySelector('.pp2-end').value.trim() || '',
    kg: parseFloat(tr.querySelector('.pp2-kg').value) || 0,
    waste: parseFloat(tr.querySelector('.pp2-waste').value) || 0,
  };
}

function pp2GetWorkers(){
  return parseInt(document.getElementById('pp2_workers')?.value) || 0;
}

function pp2ValidateRow(d){
  if(!d.type) return '부위';
  if(!d.cage) return '케이지번호';
  if(!/^\d{1,2}:\d{2}$/.test(d.start)) return '시작 (HH:MM)';
  if(!/^\d{1,2}:\d{2}$/.test(d.end)) return '종료 (HH:MM)';
  if(!(d.kg > 0)) return '전처리KG';
  if(d.waste < 0) return '비가식부 음수 불가';
  return null;
}

// ★ 차감 직전 방혈 최신화 (어제+오늘 서버 재조회) — 연속/동시 저장 시 중복 차감 방지
async function pp2ReloadThawing(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const dy = new Date(); dy.setDate(dy.getDate()-1);
  const yest = dy.getFullYear()+'-'+String(dy.getMonth()+1).padStart(2,'0')+'-'+String(dy.getDate()).padStart(2,'0');
  try {
    if(typeof fbGetByDate !== 'function') return;
    const [a, b] = await Promise.all([fbGetByDate('thawing', today), fbGetByDate('thawing', yest)]);
    const fresh = [...(a||[]), ...(b||[])];
    // 오늘·어제 날짜 thawing은 서버 최신으로 교체, 그 외 날짜는 메모리 유지
    L.thawing = (L.thawing||[]).filter(t => {
      const d = String(t.date||'').slice(0,10);
      return d !== today && d !== yest;
    }).concat(fresh);
    if(typeof saveL==='function') saveL();
  } catch(e){ console.warn('[pp2] 방혈 재조회 실패, 캐시 사용:', e && e.message); }
}

function pp2FifoDeduct(type, totalKg){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const candidates = (L.thawing||[])
    .filter(t => pp2IsWorkingToday(t, today) && t.type === type && (parseFloat(t.remainKg)||0) > 0.01)
    .sort((a,b) => {
      const aT = a.start || a._id || a.id || '';
      const bT = b.start || b._id || b.id || '';
      return aT.localeCompare(bT);
    });

  const touches = [];
  let need = totalKg;
  for(const th of candidates){
    if(need <= 0.01) break;
    const avail = parseFloat(th.remainKg) || 0;
    const take = Math.min(avail, need);
    if(take > 0.01){
      touches.push({
        thId: th.id,
        thFbId: th.fbId || null,
        cart: th.cart || '',
        deductKg: parseFloat(take.toFixed(2)),
      });
      th.remainKg = parseFloat((avail - take).toFixed(2));
      need = parseFloat((need - take).toFixed(2));
    }
  }
  return { touches, shortage: need > 0.01 ? need : 0 };
}

function pp2BuildRecord(d, workers, touches){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const id = (typeof gid==='function') ? gid() : ('pp2_'+Date.now());
  const wagons = [...new Set(touches.map(t => t.cart).filter(Boolean))].join(',');
  const distribution = {};
  touches.forEach(t => {
    if(!t.cart) return;
    if(!distribution[t.cart]){
      distribution[t.cart] = { type: d.type, start: d.start, end: d.end, cages: {}, cart: t.cart };
    }
    // 한 행에 케이지 여러 개(예 "9,10")인 경우 단순화: 전체 케이지 문자열을 키로
    distribution[t.cart].cages[d.cage] =
      (distribution[t.cart].cages[d.cage] || 0) + t.deductKg;
  });
  const cageTanks = { [d.cage]: '' };

  return {
    id, date: today,
    type: d.type,
    cage: d.cage,
    cageTanks,
    wagons,
    distribution,
    thawingTouches: touches,
    kg: parseFloat(d.kg.toFixed(2)),
    waste: parseFloat(d.waste.toFixed(2)),
    workers,
    start: d.start,
    end: d.end,
    _v: 2,
  };
}

async function pp2SaveOne(idx){
  const tr = document.getElementById('pp2Tr_'+idx);
  if(!tr || tr.dataset.saved) return;
  const d = pp2GetRowData(idx);
  if(!d) return;
  const err = pp2ValidateRow(d);
  if(err){ toast(`${err} 입력 필요`,'d'); return; }
  const workers = pp2GetWorkers();
  if(workers <= 0){ toast('인원 입력 필요','d'); return; }

  tr.dataset.saved = '1';

  // ★ 차감 직전 방혈 잔량을 서버에서 최신화 (중복 차감 방지 핵심)
  await pp2ReloadThawing();

  const totalDeduct = d.kg + d.waste;
  const {touches, shortage} = pp2FifoDeduct(d.type, totalDeduct);
  if(shortage > 0.01){
    const conf = confirm(
      `${d.type} 잔량 ${shortage.toFixed(2)}kg 부족\n` +
      `(필요 ${totalDeduct.toFixed(2)}kg, 가능 ${(totalDeduct-shortage).toFixed(2)}kg)\n\n` +
      `그대로 저장하시겠어요?`
    );
    if(!conf){ tr.dataset.saved = ''; return; }
  }

  const rec = pp2BuildRecord(d, workers, touches);
  if(!L.preprocess) L.preprocess = [];
  L.preprocess.push(rec);
  tr.dataset.recId = rec.id;  // ★ X 삭제 시 DB 삭제 위해

  if(typeof fbSave==='function'){
    try {
      const fbId = await fbSave('preprocess', rec);
      if(fbId) rec.fbId = fbId;
    } catch(e){ console.error('preprocess fbSave 실패', e); }
  }
  // 차감된 thawing들 — remainKg 갱신 + end 비어있으면 전처리 시작시각으로 자동 채움
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const ppStartFull = `${today} ${d.start}`;  // 예: "2026-05-12 05:00"
  for(const t of touches){
    const th = (L.thawing||[]).find(x => x.id === t.thId);
    if(!th) continue;
    const update = { remainKg: th.remainKg };
    // 방혈 종료 자동 채움 (비어있을 때만)
    if(!th.end || String(th.end).trim() === ''){
      th.end = ppStartFull;
      update.end = ppStartFull;
    }
    if(th.fbId && typeof fbUpdate==='function'){
      try { await fbUpdate('thawing', th.fbId, update); }
      catch(e){ console.error('thawing 갱신 실패', e); }
    }
  }
  if(typeof saveL==='function') saveL();

  tr.style.background = '#dcfce7';
  await pp2Refresh();
  toast(`케이지 ${d.cage} 저장 ✓`,'s');
}

async function pp2SaveAll(){
  const tbody = document.getElementById('pp2_tbody');
  if(!tbody) return;
  const rows = [...tbody.querySelectorAll('tr')].filter(tr => !tr.dataset.saved);
  if(!rows.length){ toast('저장할 행 없음','i'); return; }
  let saved = 0;
  for(const tr of rows){
    const idx = parseInt(tr.dataset.idx);
    const d = pp2GetRowData(idx);
    if(!d.type && !d.cage && !d.start && !d.end && !d.kg) continue;
    if(pp2ValidateRow(d)) continue;
    await pp2SaveOne(idx);
    saved++;
  }
  if(!saved) toast('저장 완료된 행 없음 (필수칸 미입력)','i');
}

async function pp2Refresh(){
  const remEl = document.getElementById('pp2_remain');
  if(remEl) remEl.innerHTML = pp2RenderRemain();
  const listEl = document.getElementById('pp2_list');
  if(listEl) listEl.innerHTML = pp2RenderTodayList();
  // 헤더 종료/종료취소 버튼 갱신
  const btnsEl = document.getElementById('pp2_topbtns');
  if(btnsEl){
    btnsEl.innerHTML = `
      ${pp2HasFinishedToday() ? `<button class="btn bo bsm" style="color:#0891b2;border-color:#0891b2;font-weight:600" onclick="pp2UnfinishDay()">↩ 종료 취소</button>` : ''}
      <button class="btn bo bsm" style="color:var(--d);border-color:var(--d);font-weight:600" onclick="pp2FinishDay()">⏹ 오늘 전처리 종료</button>
    `;
  }
}

function pp2RenderTodayList(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const list = (L.preprocess||[])
    .filter(p => p.date === today)
    .sort((a,b) => (a.start||'').localeCompare(b.start||''));
  if(!list.length) return '<div class="emp">데이터 없음</div>';
  let totalKg = 0, totalWaste = 0;
  list.forEach(p => { totalKg += parseFloat(p.kg)||0; totalWaste += parseFloat(p.waste)||0; });
  const thTotalToday = (L.thawing||[]).filter(t => pp2IsWorkingToday(t, today))
    .reduce((s,t) => s + (parseFloat(t.totalKg)||0), 0);
  const yieldText = thTotalToday > 0
    ? ` · 수율 ${(totalKg / thTotalToday * 100).toFixed(2)}%`
    : '';
  return `
    <div style="background:#f8fafc;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px">
      총 ${list.length}건 · 케이지 합계 ${totalKg.toFixed(2)}kg · 비가식부 ${totalWaste.toFixed(2)}kg${yieldText}
    </div>
    ${list.map(p => `
      <div id="pp2RecCard_${p.id}" style="border:1px solid var(--g2);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <strong style="font-size:14px">케이지 ${p.cage} · ${p.type}</strong>
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
        ${p.thawingTouches && p.thawingTouches.length ? `
          <div style="font-size:11px;color:var(--g5);margin-top:4px;padding-top:6px;border-top:1px dashed var(--g2)">
            대차 차감: ${p.thawingTouches.map(t => `카트${t.cart||'-'} ${(parseFloat(t.deductKg)||0).toFixed(2)}kg`).join(' · ')}
          </div>
        ` : ''}
      </div>
    `).join('')}
  `;
}

async function pp2EditRecord(id){
  const rec = (L.preprocess||[]).find(p => p.id === id);
  if(!rec){ toast('데이터 없음','d'); return; }
  const card = document.getElementById('pp2RecCard_'+id);
  if(!card) return;
  // 카드 내용을 input 폼으로 교체
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const availTypes = [...new Set(
    (L.thawing||[])
      .filter(t => pp2IsWorkingToday(t, today) && t.type)
      .map(t => t.type)
  )];
  if(!availTypes.includes(rec.type)) availTypes.push(rec.type);
  const typeOpts = availTypes.map(t => `<option ${t===rec.type?'selected':''}>${t}</option>`).join('');
  card.innerHTML = `
    <div style="background:#fff7ed;border:1px solid #fb923c;border-radius:6px;padding:10px">
      <div style="font-size:11px;color:#c2410c;font-weight:600;margin-bottom:8px">✏️ 수정 중</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:8px">
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;color:#475569;font-weight:600">부위</span>
          <select id="pp2Ed_type_${id}" style="height:34px;padding:0 8px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-size:13px">${typeOpts}</select>
        </label>
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;color:#475569;font-weight:600">케이지번호</span>
          <input id="pp2Ed_cage_${id}" type="text" value="${rec.cage||''}" placeholder="예: 1,2" style="height:34px;padding:0 8px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-size:13px;text-align:center">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;color:#475569;font-weight:600">시작</span>
          <input id="pp2Ed_start_${id}" type="text" maxlength="5" placeholder="HH:MM" value="${rec.start||''}" style="height:34px;padding:0 8px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-size:13px;text-align:center">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;color:#475569;font-weight:600">종료</span>
          <input id="pp2Ed_end_${id}" type="text" maxlength="5" placeholder="HH:MM" value="${rec.end||''}" style="height:34px;padding:0 8px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-size:13px;text-align:center">
        </label>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px">
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;color:#475569;font-weight:600">전처리 KG</span>
          <input id="pp2Ed_kg_${id}" type="number" step="0.01" value="${rec.kg||0}" style="height:34px;padding:0 8px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-size:13px;text-align:right">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;color:#475569;font-weight:600">비가식부 KG</span>
          <input id="pp2Ed_waste_${id}" type="number" step="0.01" value="${rec.waste||0}" style="height:34px;padding:0 8px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-size:13px;text-align:right">
        </label>
        <label style="display:flex;flex-direction:column;gap:3px">
          <span style="font-size:11px;color:#475569;font-weight:600">인원</span>
          <input id="pp2Ed_workers_${id}" type="number" value="${rec.workers||0}" style="height:34px;padding:0 8px;border:1px solid #94a3b8;border-radius:4px;background:#fff;font-size:13px;text-align:center">
        </label>
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn bo bsm" onclick="pp2EditCancel('${id}')">취소</button>
        <button class="btn bp bsm" onclick="pp2EditSave('${id}')">저장</button>
      </div>
    </div>
  `;
}

async function pp2EditCancel(id){
  // 단순 다시 렌더
  await pp2Refresh();
}

async function pp2EditSave(id){
  const rec = (L.preprocess||[]).find(p => p.id === id);
  if(!rec){ toast('데이터 없음','d'); return; }
  const d = {
    type:    document.getElementById('pp2Ed_type_'+id).value,
    cage:    document.getElementById('pp2Ed_cage_'+id).value.trim(),
    start:   document.getElementById('pp2Ed_start_'+id).value.trim(),
    end:     document.getElementById('pp2Ed_end_'+id).value.trim(),
    kg:      parseFloat(document.getElementById('pp2Ed_kg_'+id).value) || 0,
    waste:   parseFloat(document.getElementById('pp2Ed_waste_'+id).value) || 0,
    workers: parseInt(document.getElementById('pp2Ed_workers_'+id).value) || 0,
  };
  const err = pp2ValidateRow(d);
  if(err){ toast(`${err} 입력 필요`,'d'); return; }
  if(d.workers <= 0){ toast('인원 입력 필요','d'); return; }
  // 1) 기존 touches 복원
  await pp2RestoreTouches(rec);
  // ★ 복원 반영된 방혈 최신화 후 재차감 (중복 차감 방지)
  await pp2ReloadThawing();
  // 2) 새 FIFO 차감
  const totalDeduct = d.kg + d.waste;
  const {touches, shortage} = pp2FifoDeduct(d.type, totalDeduct);
  if(shortage > 0.01){
    if(!confirm(`${d.type} 잔량 ${shortage.toFixed(2)}kg 부족\n그대로 저장?`)){
      // 복원해 둔 것 다시 차감(원상복구) — 간단히 전체 새로고침으로 처리
      await pp2Refresh();
      return;
    }
  }
  // 3) 레코드 업데이트
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const wagons = [...new Set(touches.map(t => t.cart).filter(Boolean))].join(',');
  const distribution = {};
  touches.forEach(t => {
    if(!t.cart) return;
    if(!distribution[t.cart]){
      distribution[t.cart] = { type: d.type, start: d.start, end: d.end, cages: {}, cart: t.cart };
    }
    distribution[t.cart].cages[d.cage] =
      (distribution[t.cart].cages[d.cage] || 0) + t.deductKg;
  });
  rec.type = d.type;
  rec.cage = d.cage;
  rec.cageTanks = { [d.cage]: '' };
  rec.start = d.start;
  rec.end = d.end;
  rec.kg = parseFloat(d.kg.toFixed(2));
  rec.waste = parseFloat(d.waste.toFixed(2));
  rec.workers = d.workers;
  rec.wagons = wagons;
  rec.distribution = distribution;
  rec.thawingTouches = touches;
  if(rec.fbId && typeof fbUpdate==='function'){
    try { await fbUpdate('preprocess', rec.fbId, {
      type: rec.type, cage: rec.cage, cageTanks: rec.cageTanks,
      start: rec.start, end: rec.end,
      kg: rec.kg, waste: rec.waste, workers: rec.workers,
      wagons: rec.wagons, distribution: rec.distribution,
      thawingTouches: rec.thawingTouches,
    }); }
    catch(e){ console.error('preprocess 수정 저장 실패', e); }
  }
  if(typeof saveL==='function') saveL();
  await pp2Refresh();
  toast('수정 완료 ✓','s');
}

async function pp2DeleteRecord(id){
  if(!confirm('이 record를 삭제하시겠습니까?\n(대차 차감도 되돌려집니다)')) return;
  const rec = (L.preprocess||[]).find(p => p.id === id);
  if(rec) await pp2RestoreTouches(rec);
  await pp2DeleteRecordInternal(id);
  // 마지막 record였고 + 오늘 종료 백업이 남아있으면 → 같이 취소 제안
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const remainingToday = (L.preprocess||[]).filter(p => p.date === today).length;
  if(remainingToday === 0 && pp2HasFinishedToday()){
    if(confirm(
      `오늘 마지막 전처리 record가 삭제됐습니다.\n\n` +
      `"오늘 전처리 종료" 버튼으로 깎인 잔량도 함께 복원할까요?`
    )) {
      await pp2UnfinishDay();
    }
  }
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

async function pp2RestoreTouches(rec){
  const touches = rec.thawingTouches || [];
  for(const t of touches){
    const th = (L.thawing||[]).find(x => x.id === t.thId);
    if(!th) continue;
    th.remainKg = parseFloat(((parseFloat(th.remainKg)||0) + (parseFloat(t.deductKg)||0)).toFixed(2));
    if(th.fbId && typeof fbUpdate==='function'){
      try { await fbUpdate('thawing', th.fbId, {remainKg: th.remainKg}); }
      catch(e){ console.error('thawing 복원 실패', e); }
    }
  }
}

async function pp2FinishDay(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const remaining = (L.thawing||[]).filter(t => pp2IsWorkingToday(t, today) && (parseFloat(t.remainKg)||0) > 0.01);
  if(!remaining.length){ toast('남은 잔량 없음','i'); return; }
  const totalRem = remaining.reduce((s,t) => s + (parseFloat(t.remainKg)||0), 0);
  if(!confirm(
    `오늘 전처리 종료\n\n` +
    `남은 대차 ${remaining.length}건 · 합계 ${totalRem.toFixed(2)}kg\n` +
    `→ 모두 0으로 처리 (핏물/자연감량)\n\n` +
    `※ 실수했을 경우 "종료 취소" 버튼으로 되돌릴 수 있음\n\n` +
    `진행?`
  )) return;
  // ★ 그날 마지막으로 끝낸 전처리 종료시각 (없으면 현재시각)
  const _ppToday = (L.preprocess||[]).filter(p => String(p.date||'').slice(0,10)===today && p.end);
  const _lastEnd = _ppToday.map(p => String(p.end).trim()).filter(Boolean).sort().pop() || (typeof nowHM==='function' ? nowHM() : '');
  const _finEnd = today + ' ' + _lastEnd;
  for(const th of remaining){
    th._finishedRemainBackup = parseFloat(th.remainKg) || 0;
    th._finishedDate = today;
    th.remainKg = 0;
    const upd = { remainKg: 0, _finishedRemainBackup: th._finishedRemainBackup, _finishedDate: today };
    // ★ 종료시각 비어있으면 그날 마지막 전처리 종료시각으로 채움 → 일별요약 투입 정확
    if(!th.end || String(th.end).trim() === ''){
      th.end = _finEnd;
      upd.end = th.end;
    }
    if(th.fbId && typeof fbUpdate==='function'){
      try { await fbUpdate('thawing', th.fbId, upd); }
      catch(e){ console.error('thawing 종료 실패', e); }
    }
  }
  if(typeof saveL==='function') saveL();
  await pp2Refresh();
  toast(`전처리 종료 — ${remaining.length}건 잔량 0 ✓`,'s');
}

async function pp2UnfinishDay(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const finished = (L.thawing||[]).filter(t => t._finishedDate === today && (parseFloat(t._finishedRemainBackup)||0) > 0.01);
  if(!finished.length){ toast('취소할 종료 기록 없음','i'); return; }
  const totalRestore = finished.reduce((s,t) => s + (parseFloat(t._finishedRemainBackup)||0), 0);
  if(!confirm(
    `오늘 전처리 종료를 취소합니다.\n\n` +
    `복원 대상: ${finished.length}건 · 합계 ${totalRestore.toFixed(2)}kg\n\n` +
    `진행?`
  )) return;
  for(const th of finished){
    th.remainKg = parseFloat(th._finishedRemainBackup) || 0;
    delete th._finishedRemainBackup;
    delete th._finishedDate;
    if(th.fbId && typeof fbUpdate==='function'){
      try { await fbUpdate('thawing', th.fbId, {
        remainKg: th.remainKg,
        _finishedRemainBackup: null,
        _finishedDate: null,
      }); }
      catch(e){ console.error('thawing 종료 취소 실패', e); }
    }
  }
  if(typeof saveL==='function') saveL();
  await pp2Refresh();
  toast(`종료 취소 — ${finished.length}건 잔량 복원 ✓`,'s');
}

function pp2HasFinishedToday(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  return (L.thawing||[]).some(t => t._finishedDate === today && (parseFloat(t._finishedRemainBackup)||0) > 0.01);
}

if(typeof window !== 'undefined'){
  window.loadOpenThawingAndRender = loadOpenThawingAndRender;
  window.pp2Render = pp2Render;
  window.pp2Refresh = pp2Refresh;
  window.pp2AddRow = pp2AddRow;
  window.pp2RemoveRow = pp2RemoveRow;
  window.pp2OnCellChange = pp2OnCellChange;
  window.pp2SaveOne = pp2SaveOne;
  window.pp2SaveAll = pp2SaveAll;
  window.pp2EditRecord = pp2EditRecord;
  window.pp2EditCancel = pp2EditCancel;
  window.pp2EditSave = pp2EditSave;
  window.pp2DeleteRecord = pp2DeleteRecord;
  window.pp2FinishDay = pp2FinishDay;
  window.pp2UnfinishDay = pp2UnfinishDay;
}
