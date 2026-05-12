// ============================================================
// shredding_v2.js — 새 파쇄 UI (스테이징 전용, 테이블 행 방식)
//
// 핵심:
// - 한 행 = 한 작업 (투입 와건 1개)
// - 투입 와건 셀렉트: cooking에서 잔량 있는 와건 (FIFO 순서 — cooking.end 오래된 것부터)
// - 부위/투입KG는 자동 (cooking에서)
// - 산출 와건 자유 텍스트, 산출 KG 사용자 입력
// - 인원은 행마다 (동적)
// - 기존 스키마 호환: wagonIn, kgIn, wagonOut, wagonOutDist, cartOut, cartOutDist, waste
// ============================================================

const SH2_INIT_ROWS = 8;
let _sh2RowIdx = 0;

async function sh2Render(){
  const root = document.getElementById('p-shredding');
  if(!root) return;
  root.innerHTML = `
    <div class="card">
      <div class="ct">🔗 자숙 완료 와건 (FIFO 차감 대상)</div>
      <div id="sh2_remain">${sh2RenderRemain()}</div>
    </div>
    <div class="card">
      <div class="ct" style="margin-bottom:10px">파쇄 입력 (와건별)</div>
      <div style="overflow-x:auto">
        <table id="sh2_table" style="width:100%;border-collapse:collapse;font-size:12px;min-width:1000px">
          <thead>
            <tr style="background:#dc2626;color:#fff">
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:30px">#</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:130px">투입 와건</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:70px">부위</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:70px">투입KG</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c">산출 와건</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:80px">산출 KG</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:70px">비가식부</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:60px">인원</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:70px">시작</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:70px">종료</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:60px">작업</th>
              <th style="padding:6px 4px;border:1px solid #b91c1c;width:36px"></th>
            </tr>
          </thead>
          <tbody id="sh2_tbody"></tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn bo bsm" onclick="sh2AddRow()" style="flex:1;padding:8px">+ 행 추가</button>
        <button class="btn bp bblk" onclick="sh2SaveAll()" style="flex:2;padding:8px">전체 저장</button>
      </div>
      <div style="font-size:11px;color:var(--g5);margin-top:6px;text-align:center">
        ※ 필수칸(투입와건·산출와건·산출KG·인원·시작·종료) 다 채우면 자동 저장. ⨯로 행 제거.
      </div>
    </div>
    <div class="card">
      <div class="ct">오늘 파쇄</div>
      <div id="sh2_list">${sh2RenderTodayList()}</div>
    </div>
  `;
  _sh2RowIdx = 0;
  for(let i = 0; i < SH2_INIT_ROWS; i++) sh2AddRow();
}

// ============================================================
// 자숙 와건 잔량 계산 — cooking의 wagonDist에서 이미 파쇄에 쓰인 양 빼기
// ============================================================
function sh2GetWagonAvail(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  // cooking 와건들: end 있고, date 오늘
  const ckList = (L.cooking||[]).filter(c => c.date === today && c.end);
  // 와건 → {type, kg, ckStart, ckEnd, cooking_id, used: 0}
  const avail = {};  // key: "{cookingId}|{wagon}"
  ckList.forEach(c => {
    if(!c.wagonDist) return;
    Object.entries(c.wagonDist).forEach(([w, kg]) => {
      const key = `${c.id}|${w}`;
      avail[key] = {
        wagon: w,
        type: c.type,
        kg: parseFloat(kg) || 0,
        ckStart: c.start,
        ckEnd: c.end,
        ckId: c.id,
        ckFbId: c.fbId,
        cage: c.cage,
        used: 0,
      };
    });
  });
  // 사용량 = 같은 와건이 shredding에 wagonIn으로 들어간 양 (kgIn 기준)
  (L.shredding||[]).filter(r => r.date === today).forEach(s => {
    const w = String(s.wagonIn || '').trim();
    if(!w) return;
    // 어느 cooking 와건에서 왔는지 ckId 매칭
    const matchKey = Object.keys(avail).find(k => avail[k].wagon === w);
    if(matchKey){
      avail[matchKey].used += parseFloat(s.kgIn) || 0;
    }
  });
  // 잔여 계산
  const result = [];
  Object.entries(avail).forEach(([key, v]) => {
    const remain = v.kg - v.used;
    if(remain > 0.01){
      result.push({...v, remain, key});
    }
  });
  // FIFO 정렬 — cooking.end 오래된 것부터
  result.sort((a, b) => (a.ckEnd || '').localeCompare(b.ckEnd || ''));
  return result;
}

function sh2RenderRemain(){
  const avail = sh2GetWagonAvail();
  if(!avail.length) return '<div class="emp">자숙 완료된 와건 없음 (또는 모두 파쇄됨)</div>';
  const byType = {};
  avail.forEach(a => {
    byType[a.type] = (byType[a.type] || 0) + a.remain;
  });
  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      ${Object.entries(byType).map(([ty, kg]) => `
        <div style="background:#f0fdf4;border:1px solid #16a34a;border-radius:8px;padding:6px 12px;font-size:13px">
          <strong style="color:#16a34a">${ty}</strong> · ${kg.toFixed(2)}kg
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${avail.map(a => `
        <span style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:3px 8px;font-size:11px">
          와건${a.wagon} (${a.type}) ${a.remain.toFixed(2)}kg
        </span>
      `).join('')}
    </div>
  `;
}

// ============================================================
// 행 추가
// ============================================================
function sh2AddRow(data){
  data = data || {};
  const idx = _sh2RowIdx++;
  const tbody = document.getElementById('sh2_tbody');
  if(!tbody) return;

  const avail = sh2GetWagonAvail();
  // 셀렉트 옵션: 와건 + (부위, 잔여) 표시. FIFO 순서.
  // 수정 모드 (data.wagonIn)면 그 와건 강제 포함
  const wagonOpts = '<option value="">선택</option>' +
    avail.map(a => {
      const sel = (a.wagon === data.wagonIn) ? 'selected' : '';
      return `<option value="${a.key}" ${sel}>와건${a.wagon} (${a.type}) ${a.remain.toFixed(2)}kg</option>`;
    }).join('') +
    (data.wagonIn && !avail.find(a => a.wagon === data.wagonIn)
      ? `<option value="__manual__" selected>와건${data.wagonIn} (${data.type||'?'}) ${(data.kgIn||0).toFixed(2)}kg</option>`
      : '');

  // 이전 행 종료 시각 → 이 행 시작 기본값
  let defaultStart = data.start || '';
  if(!defaultStart && tbody.lastElementChild){
    const lastEnd = tbody.lastElementChild.querySelector('.sh2-end')?.value || '';
    if(lastEnd) defaultStart = lastEnd;
  }

  const tr = document.createElement('tr');
  tr.id = 'sh2Tr_'+idx;
  tr.dataset.idx = idx;
  tr.style.cssText = 'background:#fef3c7';
  tr.innerHTML = `
    <td style="border:1px solid #ddd;text-align:center;padding:4px;background:#fff">${tbody.children.length + 1}</td>
    <td style="border:1px solid #ddd;padding:2px">
      <select class="sh2-wagon-in" style="width:100%;border:none;padding:4px 2px;background:transparent;font-size:11px" onchange="sh2OnWagonInChange(${idx})">${wagonOpts}</select>
    </td>
    <td class="sh2-type" style="border:1px solid #ddd;text-align:center;padding:4px;background:#fff;color:var(--g6);font-size:11px">${data.type||'-'}</td>
    <td class="sh2-kg-in" style="border:1px solid #ddd;text-align:right;padding:4px;background:#fff;color:var(--g6);font-size:11px">${data.kgIn ? parseFloat(data.kgIn).toFixed(2) : '-'}</td>
    <td style="border:1px solid #ddd;padding:2px">
      <input class="sh2-wagon-out" type="text" value="${data.wagonOut||''}" placeholder="예: 14,17"
             style="width:100%;border:none;padding:4px 2px;background:transparent;font-size:11px;text-align:center"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:2px">
      <input class="sh2-kg" type="number" step="0.01" placeholder="0.00" value="${data.kg||''}"
             style="width:100%;border:none;padding:4px 2px;background:transparent;font-size:11px;text-align:right"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:2px">
      <input class="sh2-waste" type="number" step="0.01" placeholder="0.00" value="${data.waste||''}"
             style="width:100%;border:none;padding:4px 2px;background:transparent;font-size:11px;text-align:right"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:2px">
      <input class="sh2-workers" type="number" placeholder="0" value="${data.workers||''}"
             style="width:100%;border:none;padding:4px 2px;background:transparent;font-size:11px;text-align:center"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:2px">
      <input class="sh2-start" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" value="${defaultStart}"
             style="width:100%;border:none;padding:4px 2px;background:transparent;font-size:11px;text-align:center"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:2px">
      <input class="sh2-end" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" value="${data.end||''}"
             style="width:100%;border:none;padding:4px 2px;background:transparent;font-size:11px;text-align:center"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td class="sh2-dur" style="border:1px solid #ddd;text-align:center;padding:4px;background:#fff;color:var(--g5);font-size:11px">-</td>
    <td style="border:1px solid #ddd;text-align:center;padding:2px;background:#fff">
      <button onclick="sh2RemoveRow(${idx})" style="background:none;border:none;color:var(--g4);font-size:14px;cursor:pointer">⨯</button>
    </td>
  `;
  // 수정 모드면 cooking 정보를 dataset에 저장
  if(data._ckId){
    tr.dataset.ckId = data._ckId;
    tr.dataset.ckFbId = data._ckFbId || '';
    tr.dataset.wagon = data.wagonIn || '';
    tr.dataset.cage = data._cage || '';
  }
  tbody.appendChild(tr);
}

function sh2RemoveRow(idx){
  const tr = document.getElementById('sh2Tr_'+idx);
  if(tr) tr.remove();
  sh2ReindexRows();
}

function sh2ReindexRows(){
  const tbody = document.getElementById('sh2_tbody');
  if(!tbody) return;
  [...tbody.querySelectorAll('tr')].forEach((tr, i) => {
    const first = tr.querySelector('td');
    if(first) first.textContent = i + 1;
  });
}

// ============================================================
// 셀렉트 변경 시 부위/투입KG 자동 채움
// ============================================================
function sh2OnWagonInChange(idx){
  const tr = document.getElementById('sh2Tr_'+idx);
  if(!tr) return;
  const sel = tr.querySelector('.sh2-wagon-in');
  const key = sel.value;
  if(!key || key === '__manual__'){
    tr.querySelector('.sh2-type').textContent = '-';
    tr.querySelector('.sh2-kg-in').textContent = '-';
    return;
  }
  const avail = sh2GetWagonAvail();
  const a = avail.find(x => x.key === key);
  if(a){
    tr.querySelector('.sh2-type').textContent = a.type;
    tr.querySelector('.sh2-kg-in').textContent = a.remain.toFixed(2);
    tr.dataset.ckId = a.ckId;
    tr.dataset.ckFbId = a.ckFbId || '';
    tr.dataset.wagon = a.wagon;
    tr.dataset.cage = a.cage || '';
  }
  sh2OnCellChange(idx);
}

// ============================================================
// 셀 변경 — 작업시간 자동 + 필수 채워지면 자동 저장
// ============================================================
function sh2OnCellChange(idx){
  const tr = document.getElementById('sh2Tr_'+idx);
  if(!tr) return;
  const start = tr.querySelector('.sh2-start').value.trim();
  const end = tr.querySelector('.sh2-end').value.trim();
  const dur = sh2CalcDur(start, end);
  const durCell = tr.querySelector('.sh2-dur');
  if(durCell) durCell.textContent = dur !== null ? dur.toFixed(2) : '-';

  const d = sh2GetRowData(idx);
  if(!d) return;
  if(d.wagonIn && d.wagonOut && d.kg > 0 && d.workers > 0
     && /^\d{1,2}:\d{2}$/.test(d.start) && /^\d{1,2}:\d{2}$/.test(d.end)
     && !tr.dataset.saved){
    sh2SaveOne(idx);
  }
}

function sh2CalcDur(start, end){
  if(!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh*60+em) - (sh*60+sm);
  if(mins < 0) mins += 24*60;
  return mins / 60;
}

// ============================================================
// 데이터 추출
// ============================================================
function sh2GetRowData(idx){
  const tr = document.getElementById('sh2Tr_'+idx);
  if(!tr) return null;
  const wagonIn = tr.dataset.wagon || '';
  const type = tr.querySelector('.sh2-type').textContent.trim();
  const kgInText = tr.querySelector('.sh2-kg-in').textContent.trim();
  const kgIn = kgInText === '-' ? 0 : parseFloat(kgInText) || 0;
  return {
    wagonIn,
    type,
    kgIn,
    wagonOut: tr.querySelector('.sh2-wagon-out').value.trim(),
    kg: parseFloat(tr.querySelector('.sh2-kg').value) || 0,
    waste: parseFloat(tr.querySelector('.sh2-waste').value) || 0,
    workers: parseInt(tr.querySelector('.sh2-workers').value) || 0,
    start: tr.querySelector('.sh2-start').value.trim(),
    end: tr.querySelector('.sh2-end').value.trim(),
    ckId: tr.dataset.ckId || '',
    ckFbId: tr.dataset.ckFbId || '',
  };
}

function sh2ValidateRow(d){
  if(!d.wagonIn) return '투입 와건';
  if(!d.wagonOut) return '산출 와건';
  if(!(d.kg > 0)) return '산출 KG';
  if(!(d.workers > 0)) return '인원';
  if(!/^\d{1,2}:\d{2}$/.test(d.start)) return '시작 (HH:MM)';
  if(!/^\d{1,2}:\d{2}$/.test(d.end)) return '종료 (HH:MM)';
  if(d.waste < 0) return '비가식부 음수 불가';
  return null;
}

// ============================================================
// record 생성 — 기존 스키마 호환
// ============================================================
function sh2BuildRecord(d){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const id = (typeof gid==='function') ? gid() : ('sh2_'+Date.now());

  // 산출 와건 균등 분배 (사용자가 와건별 무게 입력 안 함 — 총량만 입력)
  const outs = d.wagonOut.split(',').map(x => x.trim()).filter(Boolean);
  const wagonOutDist = {};
  if(outs.length > 0){
    const each = d.kg / outs.length;
    outs.forEach(w => { wagonOutDist[w] = parseFloat(each.toFixed(2)); });
  }

  return {
    id, date: today,
    wagonIn: d.wagonIn,
    kgIn: parseFloat(d.kgIn.toFixed(2)),
    wagonOut: d.wagonOut,
    wagonOutDist,
    cartOut: '',
    cartOutDist: {},
    kg: parseFloat(d.kg.toFixed(2)),
    waste: parseFloat(d.waste.toFixed(2)),
    workers: d.workers,
    start: d.start,
    end: d.end,
    type: d.type,
    _ckId: d.ckId,
    _v: 2,
  };
}

// ============================================================
// 저장 (단일)
// ============================================================
async function sh2SaveOne(idx){
  const tr = document.getElementById('sh2Tr_'+idx);
  if(!tr || tr.dataset.saved) return;
  const d = sh2GetRowData(idx);
  if(!d) return;
  const err = sh2ValidateRow(d);
  if(err){ toast(`${err} 입력 필요`,'d'); return; }
  tr.dataset.saved = '1';

  const rec = sh2BuildRecord(d);
  if(!L.shredding) L.shredding = [];
  L.shredding.push(rec);

  if(typeof fbSave==='function'){
    try {
      const fbId = await fbSave('shredding', rec);
      if(fbId) rec.fbId = fbId;
    } catch(e){ console.error('shredding fbSave 실패', e); }
  }
  if(typeof saveL==='function') saveL();

  tr.style.background = '#dcfce7';
  await sh2Refresh();
  toast(`와건${d.wagonIn} 파쇄 저장 ✓`,'s');
}

async function sh2SaveAll(){
  const tbody = document.getElementById('sh2_tbody');
  if(!tbody) return;
  const rows = [...tbody.querySelectorAll('tr')].filter(tr => !tr.dataset.saved);
  if(!rows.length){ toast('저장할 행 없음','i'); return; }
  let saved = 0;
  for(const tr of rows){
    const idx = parseInt(tr.dataset.idx);
    const d = sh2GetRowData(idx);
    if(!d.wagonIn && !d.wagonOut && !d.kg) continue;
    if(sh2ValidateRow(d)) continue;
    await sh2SaveOne(idx);
    saved++;
  }
  if(!saved) toast('저장된 행 없음 (필수칸 미입력)','i');
}

async function sh2Refresh(){
  const remEl = document.getElementById('sh2_remain');
  if(remEl) remEl.innerHTML = sh2RenderRemain();
  const listEl = document.getElementById('sh2_list');
  if(listEl) listEl.innerHTML = sh2RenderTodayList();
  // 행마다 와건 셀렉트 옵션 재생성
  const tbody = document.getElementById('sh2_tbody');
  if(!tbody) return;
  const avail = sh2GetWagonAvail();
  [...tbody.querySelectorAll('tr')].forEach(tr => {
    if(tr.dataset.saved) return; // 저장된 행은 건드리지 않음
    const sel = tr.querySelector('.sh2-wagon-in');
    if(!sel) return;
    const cur = sel.value;
    const newOpts = '<option value="">선택</option>' +
      avail.map(a => {
        const sel2 = (a.key === cur) ? 'selected' : '';
        return `<option value="${a.key}" ${sel2}>와건${a.wagon} (${a.type}) ${a.remain.toFixed(2)}kg</option>`;
      }).join('');
    sel.innerHTML = newOpts;
  });
}

// ============================================================
// 오늘 작업 목록
// ============================================================
function sh2RenderTodayList(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const list = (L.shredding||[])
    .filter(r => r.date === today)
    .sort((a,b) => (a.start||'').localeCompare(b.start||''));
  if(!list.length) return '<div class="emp">데이터 없음</div>';
  let totalKg = 0, totalKgIn = 0, totalWaste = 0;
  list.forEach(r => {
    totalKg += parseFloat(r.kg)||0;
    totalKgIn += parseFloat(r.kgIn)||0;
    totalWaste += parseFloat(r.waste)||0;
  });
  const yieldText = totalKgIn > 0
    ? ` · 공정수율 ${(totalKg / totalKgIn * 100).toFixed(2)}%`
    : '';
  return `
    <div style="background:#f8fafc;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px">
      총 ${list.length}건 · 투입 ${totalKgIn.toFixed(2)}kg → 산출 ${totalKg.toFixed(2)}kg · 비가식부 ${totalWaste.toFixed(2)}kg${yieldText}
    </div>
    ${list.map(r => `
      <div style="border:1px solid var(--g2);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <strong style="font-size:14px">와건${r.wagonIn} → 와건${r.wagonOut} · ${r.type||'-'}</strong>
            <span style="font-size:12px;color:var(--g5);margin-left:8px">${r.start||'-'} ~ ${r.end||'-'}</span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn bo bsm" onclick="sh2EditRecord('${r.id}')">수정</button>
            <button class="btn bo bsm" style="color:var(--d);border-color:var(--d)" onclick="sh2DeleteRecord('${r.id}')">삭제</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--g6)">
          투입 ${(parseFloat(r.kgIn)||0).toFixed(2)}kg → 산출 ${(parseFloat(r.kg)||0).toFixed(2)}kg · 비가식부 ${(parseFloat(r.waste)||0).toFixed(2)}kg · 인원 ${r.workers||0}명
        </div>
      </div>
    `).join('')}
  `;
}

// ============================================================
// 수정 / 삭제
// ============================================================
async function sh2EditRecord(id){
  const rec = (L.shredding||[]).find(r => r.id === id);
  if(!rec){ toast('데이터 없음','d'); return; }
  if(!confirm('이 record를 수정하시겠습니까?')) return;
  await sh2DeleteRecordInternal(id, true);
  sh2AddRow({
    wagonIn: rec.wagonIn,
    type: rec.type,
    kgIn: rec.kgIn,
    wagonOut: rec.wagonOut,
    kg: rec.kg,
    waste: rec.waste,
    workers: rec.workers,
    start: rec.start,
    end: rec.end,
    _ckId: rec._ckId,
  });
  toast('수정 모드: 값 고치면 자동 저장','i');
  document.getElementById('sh2_table')?.scrollIntoView({behavior:'smooth', block:'start'});
}

async function sh2DeleteRecord(id){
  if(!confirm('이 record를 삭제하시겠습니까?')) return;
  await sh2DeleteRecordInternal(id);
}

async function sh2DeleteRecordInternal(id, silent){
  const rec = (L.shredding||[]).find(r => r.id === id);
  if(!rec){ if(!silent) toast('데이터 없음','d'); return; }
  if(rec.fbId && typeof fbDelete==='function'){
    try { await fbDelete('shredding', rec.fbId); }
    catch(e){ console.error('shredding 삭제 실패', e); }
  }
  L.shredding = (L.shredding||[]).filter(r => r.id !== id);
  if(typeof saveL==='function') saveL();
  await sh2Refresh();
  if(!silent) toast('삭제됨','i');
}

if(typeof window !== 'undefined'){
  window.sh2Render = sh2Render;
  window.sh2AddRow = sh2AddRow;
  window.sh2RemoveRow = sh2RemoveRow;
  window.sh2OnWagonInChange = sh2OnWagonInChange;
  window.sh2OnCellChange = sh2OnCellChange;
  window.sh2SaveOne = sh2SaveOne;
  window.sh2SaveAll = sh2SaveAll;
  window.sh2EditRecord = sh2EditRecord;
  window.sh2DeleteRecord = sh2DeleteRecord;
}
