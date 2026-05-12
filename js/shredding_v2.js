// ============================================================
// shredding_v2.js — 새 파쇄 UI (스테이징 전용)
//
// 핵심:
// - 한 행 입력: 부위 / 산출 와건 / 산출 KG / 비가식부 / 인원 / 시작 / 종료
// - 시스템 자동: 같은 부위 자숙 와건 중 FIFO로 (산출+비가식) 만큼 차감
// - 차감된 와건들 = record의 wagonIn (다중 와건 콤마)
// - "오늘 파쇄 종료" 버튼: 자숙 와건 잔량 모두 0
// - 인원은 행마다 (동적)
// - 기존 스키마 호환: wagonIn, kgIn, wagonOut, wagonOutDist, cartOut, cartOutDist
// ============================================================

const SH2_INIT_ROWS = 6;
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="ct" style="margin:0">파쇄 입력</div>
        <button class="btn bo bsm" style="color:var(--d);border-color:var(--d);font-weight:600" onclick="sh2FinishDay()">⏹ 오늘 파쇄 종료</button>
      </div>
      <div style="overflow-x:auto">
        <table id="sh2_table" style="width:100%;border-collapse:collapse;font-size:14px;min-width:980px">
          <thead>
            <tr style="background:#dc2626;color:#fff">
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:40px;font-size:13px">#</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:110px;font-size:13px">부위</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:120px;font-size:13px">산출 와건</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:90px;font-size:13px">시작</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:90px;font-size:13px">종료</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:130px;font-size:13px">산출 KG</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:120px;font-size:13px">비가식부</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:80px;font-size:13px">인원</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:80px;font-size:13px">작업시간</th>
              <th style="padding:10px 4px;border:1px solid #b91c1c;width:44px;font-size:13px"></th>
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
        ※ 필수칸(부위·산출와건·산출KG·인원·시작·종료) 다 채우면 자동 저장.
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
// 자숙 와건 잔량 계산
// ============================================================
function sh2GetWagonAvail(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const ckList = (L.cooking||[]).filter(c => c.date === today && c.end);
  const avail = {};  // key: "{cookingId}|{wagon}"
  ckList.forEach(c => {
    if(!c.wagonDist) return;
    Object.entries(c.wagonDist).forEach(([w, kg]) => {
      const key = `${c.id}|${w}`;
      avail[key] = {
        wagon: w, type: c.type, kg: parseFloat(kg) || 0,
        ckStart: c.start, ckEnd: c.end,
        ckId: c.id, ckFbId: c.fbId,
        used: 0,
      };
    });
  });
  // 사용량 = shredding의 wagonIn(콤마 분리) 별 kgIn 비례 분배
  (L.shredding||[]).filter(r => r.date === today).forEach(s => {
    if(!s.wagonInDist){
      // wagonIn 단일/콤마 단순 처리
      const ws = String(s.wagonIn || '').split(',').map(x => x.trim()).filter(Boolean);
      const kgIn = parseFloat(s.kgIn) || 0;
      if(ws.length === 1){
        const k = Object.keys(avail).find(k => avail[k].wagon === ws[0]);
        if(k) avail[k].used += kgIn;
      } else if(ws.length > 1){
        // 비례 분배 추정 — 균등
        const each = kgIn / ws.length;
        ws.forEach(w => {
          const k = Object.keys(avail).find(k => avail[k].wagon === w);
          if(k) avail[k].used += each;
        });
      }
    } else {
      Object.entries(s.wagonInDist).forEach(([w, kg]) => {
        const k = Object.keys(avail).find(k => avail[k].wagon === w);
        if(k) avail[k].used += parseFloat(kg) || 0;
      });
    }
  });
  const result = [];
  Object.entries(avail).forEach(([key, v]) => {
    const remain = v.kg - v.used;
    if(remain > 0.01) result.push({...v, remain, key});
  });
  // FIFO 정렬 — cooking.end 오래된 순
  result.sort((a, b) => (a.ckEnd || '').localeCompare(b.ckEnd || ''));
  return result;
}

function sh2RenderRemain(){
  const avail = sh2GetWagonAvail();
  if(!avail.length) return '<div class="emp">자숙 완료된 와건 없음 (또는 모두 파쇄됨)</div>';
  const byType = {};
  avail.forEach(a => { byType[a.type] = (byType[a.type] || 0) + a.remain; });
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

  // 부위 옵션: 자숙 잔량 있는 부위만
  const avail = sh2GetWagonAvail();
  const availTypes = [...new Set(avail.map(a => a.type))];
  if(data.type && !availTypes.includes(data.type)) availTypes.push(data.type);
  const typeOpts = '<option value="">선택</option>' +
    availTypes.map(t => `<option ${t===data.type?'selected':''}>${t}</option>`).join('');

  // 이전 행 종료 → 이 행 시작
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
    <td style="border:1px solid #ddd;text-align:center;padding:8px 4px;background:#fff;font-size:13px;font-weight:600">${tbody.children.length + 1}</td>
    <td style="border:1px solid #ddd;padding:0">
      <select class="sh2-type" style="width:100%;height:42px;border:none;padding:0 6px;background:transparent;font-size:14px" onchange="sh2OnCellChange(${idx})">${typeOpts}</select>
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="sh2-wagon-out" type="text" value="${data.wagonOut||''}" placeholder="예: 14,17"
             style="width:100%;height:42px;border:none;padding:0 6px;background:transparent;font-size:14px;text-align:center"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="sh2-start" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" value="${defaultStart}"
             style="width:100%;height:42px;border:none;padding:0 6px;background:transparent;font-size:14px;text-align:center"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="sh2-end" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" value="${data.end||''}"
             style="width:100%;height:42px;border:none;padding:0 6px;background:transparent;font-size:14px;text-align:center"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="sh2-kg" type="number" step="0.01" placeholder="0.00" value="${data.kg||''}"
             style="width:100%;height:42px;border:none;padding:0 8px;background:transparent;font-size:14px;text-align:right"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="sh2-waste" type="number" step="0.01" placeholder="0.00" value="${data.waste||''}"
             style="width:100%;height:42px;border:none;padding:0 8px;background:transparent;font-size:14px;text-align:right"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td style="border:1px solid #ddd;padding:0">
      <input class="sh2-workers" type="number" placeholder="0" value="${data.workers||''}"
             style="width:100%;height:42px;border:none;padding:0 8px;background:transparent;font-size:14px;text-align:center"
             onchange="sh2OnCellChange(${idx})">
    </td>
    <td class="sh2-dur" style="border:1px solid #ddd;text-align:center;padding:8px 4px;background:#fff;color:var(--g5);font-size:13px">-</td>
    <td style="border:1px solid #ddd;text-align:center;padding:0;background:#fff">
      <button onclick="sh2RemoveRow(${idx})" style="width:36px;height:42px;background:none;border:none;color:var(--g4);font-size:18px;cursor:pointer">⨯</button>
    </td>
  `;
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
  if(d.type && d.wagonOut && d.kg > 0 && d.workers > 0
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

function sh2GetRowData(idx){
  const tr = document.getElementById('sh2Tr_'+idx);
  if(!tr) return null;
  return {
    type: tr.querySelector('.sh2-type').value || '',
    wagonOut: tr.querySelector('.sh2-wagon-out').value.trim(),
    kg: parseFloat(tr.querySelector('.sh2-kg').value) || 0,
    waste: parseFloat(tr.querySelector('.sh2-waste').value) || 0,
    workers: parseInt(tr.querySelector('.sh2-workers').value) || 0,
    start: tr.querySelector('.sh2-start').value.trim(),
    end: tr.querySelector('.sh2-end').value.trim(),
  };
}

function sh2ValidateRow(d){
  if(!d.type) return '부위';
  if(!d.wagonOut) return '산출 와건';
  if(!(d.kg > 0)) return '산출 KG';
  if(!(d.workers > 0)) return '인원';
  if(!/^\d{1,2}:\d{2}$/.test(d.start)) return '시작 (HH:MM)';
  if(!/^\d{1,2}:\d{2}$/.test(d.end)) return '종료 (HH:MM)';
  if(d.waste < 0) return '비가식부 음수 불가';
  return null;
}

// ============================================================
// FIFO 차감 — 같은 부위 자숙 와건 중 오래된 것부터
// ============================================================
function sh2FifoDeduct(type, totalKg){
  const avail = sh2GetWagonAvail().filter(a => a.type === type);
  // 이미 FIFO 정렬됨 (ckEnd 오래된 순)
  const touches = [];
  let need = totalKg;
  for(const a of avail){
    if(need <= 0.01) break;
    const take = Math.min(a.remain, need);
    if(take > 0.01){
      touches.push({
        wagon: a.wagon,
        ckId: a.ckId,
        ckFbId: a.ckFbId || null,
        deductKg: parseFloat(take.toFixed(2)),
      });
      need = parseFloat((need - take).toFixed(2));
    }
  }
  return { touches, shortage: need > 0.01 ? need : 0 };
}

// ============================================================
// record 생성 — 기존 스키마 호환
// ============================================================
function sh2BuildRecord(d, touches){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const id = (typeof gid==='function') ? gid() : ('sh2_'+Date.now());

  // 투입 와건 정보 (다중)
  const wagonIn = touches.map(t => t.wagon).join(',');
  const wagonInDist = {};
  touches.forEach(t => { wagonInDist[t.wagon] = t.deductKg; });
  const kgIn = touches.reduce((s, t) => s + t.deductKg, 0);

  // 산출 와건 균등 분배
  const outs = d.wagonOut.split(',').map(x => x.trim()).filter(Boolean);
  const wagonOutDist = {};
  if(outs.length > 0){
    const each = d.kg / outs.length;
    outs.forEach(w => { wagonOutDist[w] = parseFloat(each.toFixed(2)); });
  }

  return {
    id, date: today,
    wagonIn,
    wagonInDist,
    kgIn: parseFloat(kgIn.toFixed(2)),
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
    _shTouches: touches,
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

  // FIFO 차감
  const totalDeduct = d.kg + d.waste;
  const {touches, shortage} = sh2FifoDeduct(d.type, totalDeduct);
  if(shortage > 0.01){
    const conf = confirm(
      `${d.type} 자숙 잔량 ${shortage.toFixed(2)}kg 부족\n` +
      `(필요 ${totalDeduct.toFixed(2)}kg, 가능 ${(totalDeduct-shortage).toFixed(2)}kg)\n\n` +
      `그대로 저장하시겠어요?`
    );
    if(!conf){ tr.dataset.saved = ''; return; }
  }

  const rec = sh2BuildRecord(d, touches);
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
  toast(`파쇄 ${d.type} ${d.kg}kg 저장 ✓`,'s');
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
    if(!d.type && !d.wagonOut && !d.kg) continue;
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
}

// ============================================================
// 오늘 파쇄 종료 — 자숙 와건 잔량 모두 0 처리
// → 자숙 record들의 wagonDist를 0으로 마킹할 수 없으니, 별도 'shutdown' 마커
// → 가장 단순: 미사용 자숙 와건들에 대해 가짜 shredding record를 만들어 잔량 소진
//   또는 cooking record에 _shClosedDate 마커. → 단순화: cooking record에 _closed 필드
// ============================================================
async function sh2FinishDay(){
  const avail = sh2GetWagonAvail();
  if(!avail.length){ toast('남은 잔량 없음','i'); return; }
  const totalRem = avail.reduce((s,a) => s + a.remain, 0);
  if(!confirm(
    `오늘 파쇄 종료\n\n` +
    `남은 자숙 와건 ${avail.length}건 · 합계 ${totalRem.toFixed(2)}kg\n` +
    `→ 모두 0으로 처리 (잔량 소진 마킹)\n\n` +
    `진행?`
  )) return;

  // cooking record들에 잔량 소진 마커 (wagonDistShClosed)
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const ckIds = [...new Set(avail.map(a => a.ckId))];
  for(const ckId of ckIds){
    const ck = (L.cooking||[]).find(c => c.id === ckId);
    if(!ck) continue;
    ck._shClosed = today;  // 마커
    if(ck.fbId && typeof fbUpdate==='function'){
      try { await fbUpdate('cooking', ck.fbId, {_shClosed: today}); }
      catch(e){ console.error('cooking 마커 실패', e); }
    }
  }
  if(typeof saveL==='function') saveL();
  await sh2Refresh();
  toast(`파쇄 종료 — ${avail.length}건 잔량 소진 ✓`,'s');
}

// sh2GetWagonAvail에서 _shClosed 마커 있는 cooking은 제외하도록 보강 필요
// → 위 함수 수정
const _origSh2GetWagonAvail = sh2GetWagonAvail;
sh2GetWagonAvail = function(){
  const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);
  const ckList = (L.cooking||[]).filter(c => c.date === today && c.end && c._shClosed !== today);
  const avail = {};
  ckList.forEach(c => {
    if(!c.wagonDist) return;
    Object.entries(c.wagonDist).forEach(([w, kg]) => {
      const key = `${c.id}|${w}`;
      avail[key] = {
        wagon: w, type: c.type, kg: parseFloat(kg) || 0,
        ckStart: c.start, ckEnd: c.end,
        ckId: c.id, ckFbId: c.fbId,
        used: 0,
      };
    });
  });
  (L.shredding||[]).filter(r => r.date === today).forEach(s => {
    if(s.wagonInDist){
      Object.entries(s.wagonInDist).forEach(([w, kg]) => {
        const k = Object.keys(avail).find(k => avail[k].wagon === w);
        if(k) avail[k].used += parseFloat(kg) || 0;
      });
    } else {
      const ws = String(s.wagonIn || '').split(',').map(x => x.trim()).filter(Boolean);
      const kgIn = parseFloat(s.kgIn) || 0;
      if(ws.length === 1){
        const k = Object.keys(avail).find(k => avail[k].wagon === ws[0]);
        if(k) avail[k].used += kgIn;
      }
    }
  });
  const result = [];
  Object.entries(avail).forEach(([key, v]) => {
    const remain = v.kg - v.used;
    if(remain > 0.01) result.push({...v, remain, key});
  });
  result.sort((a, b) => (a.ckEnd || '').localeCompare(b.ckEnd || ''));
  return result;
};

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
            <strong style="font-size:14px">${r.type||'-'} · 와건${r.wagonIn} → 와건${r.wagonOut}</strong>
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
    type: rec.type,
    wagonOut: rec.wagonOut,
    kg: rec.kg,
    waste: rec.waste,
    workers: rec.workers,
    start: rec.start,
    end: rec.end,
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
  window.sh2OnCellChange = sh2OnCellChange;
  window.sh2SaveOne = sh2SaveOne;
  window.sh2SaveAll = sh2SaveAll;
  window.sh2EditRecord = sh2EditRecord;
  window.sh2DeleteRecord = sh2DeleteRecord;
  window.sh2FinishDay = sh2FinishDay;
}
