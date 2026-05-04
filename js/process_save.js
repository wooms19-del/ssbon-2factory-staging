// ============================================================
// 공정 저장 (전처리/자숙/파쇄/포장/소스)
// ============================================================
var PF={
  preprocess:[{i:'pp_type',k:'type'},{i:'pp_cage',k:'cage'},{i:'pp_start',k:'start'},{i:'pp_end',k:'end'},{i:'pp_workers',k:'workers',n:1},{i:'pp_kg',k:'kg',n:1},{i:'pp_waste',k:'waste',n:1}],
  cooking:   [{i:'ck_type',k:'type'},{i:'ck_cage',k:'cage'},{i:'ck_tank',k:'tank'},{i:'ck_start',k:'start'},{i:'ck_end',k:'end'},{i:'ck_workers',k:'workers',n:1},{i:'ck_kg',k:'kg',n:1},{i:'ck_wOut',k:'wagonOut'},{i:'ck_note',k:'note'}],
  shredding: [{i:'sh_wIn',k:'wagonIn'},{i:'sh_start',k:'start'},{i:'sh_end',k:'end'},{i:'sh_workers',k:'workers',n:1},{i:'sh_kg',k:'kg',n:1},{i:'sh_waste',k:'waste',n:1},{i:'sh_wOut',k:'wagonOut'}],
  packing:   [{i:'pk_prod',k:'product'},{i:'pk_mach',k:'machine'},{i:'pk_wagon',k:'wagon'},{i:'pk_start',k:'start'},{i:'pk_end',k:'end'},{i:'pk_workers',k:'workers',n:1},{i:'pk_ea',k:'ea',n:1},{i:'pk_pouch',k:'pouch',n:1},{i:'pk_defect',k:'defect',n:1},{i:'pk_stank',k:'sauceTank'},{i:'pk_skg',k:'sauceKg',n:1},{i:'pk_subkg',k:'subKg',n:1},{i:'pk_subnm',k:'subName'}],
  sauce:     [{i:'sc_nm',k:'name'},{i:'sc_tank',k:'tank'},{i:'sc_kg',k:'kg',n:1},{i:'sc_note',k:'note'}],
};
var FBCOL={preprocess:'preprocess',cooking:'cooking',shredding:'shredding',packing:'packing',sauce:'sauce'};
var PNM={preprocess:'전처리',cooking:'자숙',shredding:'파쇄',packing:'포장',sauce:'소스'};

async function saveP(type){
  const d={id:gid(),date:DDATE||tod()};
  PF[type].forEach(f=>{
    const el=document.getElementById(f.i);
    if(!el) return;
    d[f.k]=f.n?(parseFloat(el.value)||0):el.value;
  });

  // 전처리: 선택 대차 목록 저장 + 잔여중량 차감
  if(type==='preprocess'){
    // ★ Firebase fresh fetch: L.thawing 최신화 (시작~저장 갭 동안 변경 반영, 5/4 사고 재발 방지)
    try {
      if(typeof loadOpenThawing === 'function') {
        await loadOpenThawing();
      }
    } catch(e) {
      console.warn('[preprocess save] thawing fresh fetch 실패, 캐시 사용:', e && e.message);
    }

    // 지금시작 시 저장한 대차 목록 우선, 없으면 현재 체크박스에서 읽기
    const curWagons = getSelectedWagons ? getSelectedWagons().map(t=>t.cart||'').filter(Boolean) : [];
    d.wagons = (_ppSelectedWagons.length ? _ppSelectedWagons : curWagons).join(',');
    // 대차 번호 없으면 저장 거부 (사용자가 명시적으로 선택해야 함)
    // ⚠ 옛날 자동 배정 로직 제거 (2026-05-04):
    //    랜덤 번호 배정 + 기존 thawing.cart 덮어쓰기 → 사용자 입력값(10/8/3) 잃음
    //    대신 명시적 오류로 사용자에게 알리고 저장 중단
    if(!d.wagons) {
      console.error('[preprocess] 대차 번호 미선택 — 저장 거부');
      toast('대차 번호를 선택해주세요','d');
      return;
    }
    const wagons = _ppSelectedWagons.length
      ? _ppSelectedWagons.map(w => L.thawing.find(t=>t.cart===w)).filter(Boolean)
      : (getSelectedWagons ? getSelectedWagons() : []);

    // 매트릭스(distribution) 우선 - 대차별 차감량은 매트릭스 합계 기준
    const mxDeduct = (typeof getPpDeductByCart==='function') ? getPpDeductByCart() : {};
    const mxDist   = (typeof getPpDistribution==='function') ? getPpDistribution() : {};
    if(Object.keys(mxDist).length){
      d.distribution = mxDist; // {"5":{type,start,end,cages:{"7":80,...},cageTanks:{"7":"1",...},total}}
    }
    // 케이지 → 탱크 매핑 (전역, 자숙 추적용)
    if(typeof getPpCageTankMap==='function'){
      const ctMap = getPpCageTankMap();
      if(Object.keys(ctMap).length) d.cageTanks = ctMap;
    }
    // 원육별 비가식부 (2종 이상 섞일 때)
    if(typeof getPpWasteByType==='function'){
      const wbt = getPpWasteByType();
      if(wbt) d.wasteByType = wbt;
    }

    // 잔여중량 차감 (매트릭스 사용 시 매트릭스 합계 기준, 아니면 기존 방식)
    // 방혈 종료(end 있음)된 cart도 차감해야 함 - 잔여중량 추적 위해
    const skipped = []; // 차감 SKIP된 cart (저장 직전 검증)
    const updateFailedCarts = []; // ★ Firebase 갱신 실패한 cart (사용자 알림용)
    // 전처리 record가 어느 thawing record를 건드렸는지 추적 (삭제 시 정확한 복원 위해)
    // 형식: [{thFbId, thId, cart, deductKg, prevEnd}]
    const thawingTouches = [];
    // ★ for...of로 변경 (forEach(async)는 await 안 먹음 → silent fail 원인)
    for(const rec of wagons){
      if(!rec) continue;
      let deductKg = mxDeduct[rec.id] || 0;
      if(!deductKg){
        const kgInp=document.querySelector('.pp-wagon-kg[data-id="'+rec.id+'"]');
        deductKg=parseFloat(kgInp&&kgInp.value)||0;
      }
      if(!deductKg){
        skipped.push(rec.cart);
        continue;
      }
      const cur=rec.remainKg!==undefined?rec.remainKg:rec.totalKg;
      const remain=r2(cur-deductKg);
      const prevEnd = rec.end || ''; // 차감 전 end 값 보존 (복원 시 사용)
      rec.remainKg=remain<0?0:remain;
      // end는 이미 채워져 있으면 유지, 없으면 현재 시각 (방혈 진행중→종료)
      if(!rec.end || rec.end==='') rec.end = d.start || nowHM();
      saveL();
      let fbId = rec.fbId;
      if(!fbId) {
        const rows = await fbGetByDate('thawing', String(rec.date||'').slice(0,10));
        const match = rows.find(r=>r.cart===rec.cart);
        if(match) { fbId=match.fbId; rec.fbId=fbId; saveL(); }
      }
      // ★ fbUpdate await + try/catch + 실패 시 사용자 알림 (5/4 사고 silent fail 차단)
      if(fbId){
        const upd={remainKg:rec.remainKg, end:rec.end};
        try {
          await fbUpdate('thawing', fbId, upd);
        } catch(e) {
          console.error('[preprocess save] thawing 갱신 실패 fbId='+fbId+' cart='+rec.cart+':', e);
          updateFailedCarts.push(rec.cart || '?');
        }
      }
      // touch 기록 (전처리 record에 함께 저장 → 삭제 시 정확한 복원)
      thawingTouches.push({
        thFbId: fbId || '',
        thId: rec.id || '',
        cart: rec.cart || '',
        deductKg: deductKg,
        prevEnd: prevEnd
      });
    }
    // 전처리 record에 touch 정보 첨부 (삭제 시 사용)
    if(thawingTouches.length) d.thawingTouches = thawingTouches;
    if(skipped.length){
      toast(`⚠️ ${skipped.join(', ')}번 cart 차감 누락 (kg 입력 확인)`,'w');
      console.warn('[preprocess] 차감 SKIP된 cart:', skipped);
    }
    // ★ Firebase 갱신 실패 시 사용자에게 즉시 알림 (5/4 사고처럼 모르고 지나가는 거 방지)
    if(updateFailedCarts.length){
      toast(`⚠️ 방혈 갱신 실패: cart ${updateFailedCarts.join(', ')} — 새로고침 후 확인 필요`,'d');
      console.error('[preprocess save] thawing 갱신 실패 cart 목록:', updateFailedCarts);
    }
  }

  L[type].push(d); saveL();

  // 폼 초기화
  PF[type].forEach(f=>{
    const el=document.getElementById(f.i);
    if(el&&!f.h) el.value='';
  });
  if(type==='preprocess'){
    const startBtn = document.getElementById('pp_startBtn');
    if(startBtn){
      startBtn.textContent='지금 시작';
      startBtn.style.background='';
    }
    const startDisp = document.getElementById('pp_startDisplay');
    if(startDisp) startDisp.textContent='';
    const startInp = document.getElementById('pp_start');
    if(startInp) startInp.value='';
    document.querySelectorAll('.pp-wagon-ck').forEach(c=>c.checked=false);
    const wagonInfo = document.getElementById('ppWagonInfo');
    if(wagonInfo) wagonInfo.classList.add('hid');
    _ppSelectedWagons = [];
    // 새 매트릭스 폼 필드들도 초기화
    document.querySelectorAll('.pp-wagon-input').forEach(w => w.style.display = 'none');
    document.querySelectorAll('.pp-w-cagerow').forEach(r => r.remove());
  }

  renderPL(type);

  // Firebase 저장 + 구글시트 백업
  const fbId = await fbSave(FBCOL[type], d);
  if(fbId){
    d.fbId=fbId; saveL();
    const gasAction = {preprocess:'savePreprocess',cooking:'saveCooking',shredding:'saveShredding',packing:'savePacking',sauce:'saveSauce'}[type];
    if(gasAction) gasRecord(gasAction, d);
    toast(PNM[type]+' 저장됨 ✓');
  } else {
    toast(PNM[type]+' 저장 실패 - 로컬에만 저장됨','d');
  }
}

// ============================================================
// 공정 리스트 렌더링
// ============================================================
var PH={
  preprocess:(r)=>`${r.type||'-'} · ${r.kg||0}kg`,
  cooking:   (r)=>`${r.type||'-'} · ${r.kg||0}kg · 탱크 ${r.tank||'-'}`,
  shredding: (r)=>{
    const out = [r.wagonOut||'', (r.cartOut?'카트:'+r.cartOut:'')].filter(Boolean).join(' / ') || '-';
    return `${r.wagonIn||'-'} → ${out} · ${r.kg||0}kg`;
  },
  packing:   (r)=>`${r.product||'-'} · ${r.ea||0}EA`,
  sauce:     (r)=>`${r.name||'-'} · ${r.kg||0}kg`,
};
var PS={
  preprocess:(r)=>`케이지 ${r.cage||'-'} · ${r.start||'-'}~${r.end||'-'} · ${r.workers||0}명`,
  cooking:   (r)=>`케이지 ${r.cage||'-'} · ${r.start||'-'}~${r.end||'-'} · ${r.workers||0}명`,
  shredding: (r)=>`${r.start||'-'}~${r.end||'-'} · ${r.workers||0}명`,
  packing:   (r)=>`${r.start||'-'}~${r.end||'-'} · ${r.workers||0}명 · 파우치 ${r.pouch||0}`,
  sauce:     (r)=>`탱크 ${r.tank||'-'} · ${r.note||''}`,
};

// type별 수정 가능 필드 정의
var PE_FIELDS = {
  preprocess: [
    {key:'cage', label:'케이지', kind:'text'},
    {key:'start', label:'시작', kind:'time'},
    {key:'end', label:'종료', kind:'time'},
    {key:'kg', label:'KG', kind:'number'},
    {key:'waste', label:'비가식부', kind:'number'},
    {key:'workers', label:'인원', kind:'number'},
  ],
  cooking: [
    {key:'cage', label:'케이지', kind:'text'},
    {key:'tank', label:'탱크', kind:'text'},
    {key:'wagonOut', label:'와건Out', kind:'text'},
    {key:'start', label:'시작', kind:'time'},
    {key:'end', label:'종료', kind:'time'},
    {key:'kg', label:'KG', kind:'number'},
    {key:'workers', label:'인원', kind:'number'},
  ],
  shredding: [
    {key:'wagonIn', label:'와건In', kind:'text'},
    {key:'wagonOut', label:'와건Out', kind:'text'},
    {key:'cartOut', label:'카트Out', kind:'text'},
    {key:'start', label:'시작', kind:'time'},
    {key:'end', label:'종료', kind:'time'},
    {key:'kg', label:'KG', kind:'number'},
    {key:'waste', label:'비가식부', kind:'number'},
    {key:'workers', label:'인원', kind:'number'},
  ],
};

function buildEditForm(type, r) {
  const fields = PE_FIELDS[type];
  if(!fields) return '';
  const cols = fields.length <= 6 ? 3 : 4;
  const inputs = fields.map(f => {
    const inputAttr = f.kind === 'number' 
      ? 'type="number" step="0.01"' 
      : f.kind === 'time' 
        ? 'type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM"' 
        : 'type="text"';
    const val = r[f.key] !== undefined && r[f.key] !== null ? r[f.key] : '';
    return `<div><label style="font-size:11px;color:var(--g5);display:block">${f.label}</label><input class="fc" ${inputAttr} style="padding:4px 8px;font-size:12px;width:100%" id="pe_${type}_${f.key}_${r.id}" value="${val}"></div>`;
  }).join('');

  // 신규 매트릭스 필드 편집 영역
  const matrixEdit = buildMatrixEditForm(type, r);

  return `<div id="peEdit_${type}_${r.id}" style="display:none;background:#f8f9fa;border-radius:6px;padding:10px;margin-top:6px;font-size:12px"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;margin-bottom:8px">${inputs}</div>${matrixEdit}<div style="display:flex;gap:6px"><button class="btn bp bsm" onclick="savePEdit('${type}','${r.id}','${r.fbId||''}')">✔ 저장</button><button class="btn bo bsm" onclick="document.getElementById('peEdit_${type}_${r.id}').style.display='none'">취소</button></div></div>`;
}

// type별 신규 매트릭스 필드 편집 영역
function buildMatrixEditForm(type, r){
  if(type === 'preprocess'){
    let html = '<div style="margin-bottom:8px;padding:8px;background:#fff;border-radius:6px;border:1px dashed #1a56db">';
    html += '<div style="font-size:11px;font-weight:600;color:#1a56db;margin-bottom:4px">대차→케이지 분배 (kg) / 탱크</div>';
    const dist = r.distribution || {};
    const cageTanks = r.cageTanks || {};
    Object.keys(dist).forEach(cart => {
      const d = dist[cart] || {};
      const cages = d.cages || {};
      html += `<div style="margin-bottom:6px;padding:6px;background:#f8f9fa;border-radius:4px"><div style="font-size:11px;font-weight:500;margin-bottom:3px">대차 ${cart}번 (${d.type||'-'})</div>`;
      Object.keys(cages).forEach(cage => {
        const tank = (d.cageTanks && d.cageTanks[cage]) || cageTanks[cage] || '';
        html += `<div style="display:grid;grid-template-columns:60px 1fr 70px;gap:4px;align-items:center;margin-bottom:3px">
          <span style="font-size:11px">${cage}번</span>
          <input class="fc pe-pp-cagekg" data-cart="${cart}" data-cage="${cage}" type="number" step="0.01" value="${cages[cage]||0}" style="padding:3px 6px;font-size:11px;text-align:right">
          <select class="fc pe-pp-tank" data-cage="${cage}" style="padding:3px 6px;font-size:11px;background:#f0fff4">
            <option value="">탱크</option>
            <option value="1" ${tank==='1'?'selected':''}>1번</option>
            <option value="2" ${tank==='2'?'selected':''}>2번</option>
            <option value="3" ${tank==='3'?'selected':''}>3번</option>
            <option value="4" ${tank==='4'?'selected':''}>4번</option>
            <option value="5" ${tank==='5'?'selected':''}>5번</option>
            <option value="6" ${tank==='6'?'selected':''}>6번</option>
          </select>
        </div>`;
      });
      html += '</div>';
    });
    if(!Object.keys(dist).length){
      html += '<div style="font-size:11px;color:var(--g5);text-align:center;padding:6px">분배 정보 없음 (구버전 데이터)</div>';
    }
    // 비가식부 원육별
    const wbt = r.wasteByType || {};
    if(Object.keys(wbt).length){
      html += '<div style="margin-top:6px;padding:6px;background:#f8f9fa;border-radius:4px"><div style="font-size:11px;font-weight:500;margin-bottom:3px">원육별 비가식부</div>';
      Object.keys(wbt).forEach(t => {
        html += `<div style="display:grid;grid-template-columns:90px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px">${t}</span><input class="fc pe-pp-waste" data-type="${t}" type="number" step="0.01" value="${wbt[t]||0}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }
  if(type === 'cooking'){
    const wd = r.wagonDist || {};
    if(!Object.keys(wd).length) return '';
    let html = '<div style="margin-bottom:8px;padding:8px;background:#fff;border-radius:6px;border:1px dashed #1a56db"><div style="font-size:11px;font-weight:600;color:#1a56db;margin-bottom:4px">배출 와건별 KG</div>';
    Object.keys(wd).forEach(w => {
      html += `<div style="display:grid;grid-template-columns:80px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px">${w}번 와건</span><input class="fc pe-ck-wkg" data-w="${w}" type="number" step="0.01" value="${wd[w]||0}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
    });
    html += '</div>';
    return html;
  }
  if(type === 'shredding'){
    const wod = r.wagonOutDist || {};
    const cod = r.cartOutDist  || {};
    if(!Object.keys(wod).length && !Object.keys(cod).length) return '';
    let html = '<div style="margin-bottom:8px;padding:8px;background:#fff;border-radius:6px;border:1px dashed #72243E"><div style="font-size:11px;font-weight:600;color:#72243E;margin-bottom:4px">배출 와건/카트별 KG</div>';
    Object.keys(wod).forEach(w => {
      html += `<div style="display:grid;grid-template-columns:80px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px;color:#72243E">와건 ${w}</span><input class="fc pe-sh-wkg" data-w="${w}" data-kind="wagon" type="number" step="0.01" value="${wod[w]||0}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
    });
    Object.keys(cod).forEach(c => {
      html += `<div style="display:grid;grid-template-columns:80px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px;color:#1a56db">카트 ${c}</span><input class="fc pe-sh-wkg" data-w="${c}" data-kind="cart" type="number" step="0.01" value="${cod[c]||0}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
    });
    html += '</div>';
    return html;
  }
  return '';
}

async function savePEdit(type, id, fbId) {
  const list = L[type] || [];
  const rec = list.find(r => r.id === id);
  if(!rec) { toast('기록 없음','d'); return; }
  const fields = PE_FIELDS[type] || [];
  const updates = {};
  fields.forEach(f => {
    const el = document.getElementById(`pe_${type}_${f.key}_${id}`);
    if(!el) return;
    let v = el.value;
    if(f.kind === 'number') v = parseFloat(v) || 0;
    updates[f.key] = v;
  });

  // 신규 매트릭스 필드 수집
  const editRoot = document.getElementById('peEdit_'+type+'_'+id);
  if(editRoot){
    if(type === 'preprocess'){
      // distribution.cages, cageTanks 수정
      const dist = JSON.parse(JSON.stringify(rec.distribution || {}));
      const cageTanks = {};
      editRoot.querySelectorAll('.pe-pp-cagekg').forEach(el => {
        const cart = el.dataset.cart, cage = el.dataset.cage;
        if(!dist[cart]) dist[cart] = {cages:{}};
        if(!dist[cart].cages) dist[cart].cages = {};
        dist[cart].cages[cage] = parseFloat(el.value) || 0;
        // total 재계산
        let t = 0; Object.values(dist[cart].cages).forEach(v => t+=parseFloat(v)||0);
        dist[cart].total = t;
      });
      editRoot.querySelectorAll('.pe-pp-tank').forEach(el => {
        if(el.value) cageTanks[el.dataset.cage] = el.value;
      });
      if(Object.keys(dist).length) updates.distribution = dist;
      if(Object.keys(cageTanks).length) updates.cageTanks = cageTanks;
      // distribution 안의 cageTanks도 같이 동기화
      Object.keys(dist).forEach(cart => {
        const ct = {};
        Object.keys(dist[cart].cages || {}).forEach(cg => {
          if(cageTanks[cg]) ct[cg] = cageTanks[cg];
        });
        if(Object.keys(ct).length) dist[cart].cageTanks = ct;
      });
      // 비가식부 원육별
      const wbt = {};
      editRoot.querySelectorAll('.pe-pp-waste').forEach(el => {
        const v = parseFloat(el.value) || 0;
        if(v) wbt[el.dataset.type] = v;
      });
      if(Object.keys(wbt).length) updates.wasteByType = wbt;
    } else if(type === 'cooking'){
      const wd = {};
      editRoot.querySelectorAll('.pe-ck-wkg').forEach(el => {
        const v = parseFloat(el.value) || 0;
        if(v) wd[el.dataset.w] = v;
      });
      if(Object.keys(wd).length){
        updates.wagonDist = wd;
        // kg 합계 재계산
        let total = 0; Object.values(wd).forEach(v => total += parseFloat(v)||0);
        updates.kg = total;
      }
    } else if(type === 'shredding'){
      const wod = {};
      const cod = {};
      editRoot.querySelectorAll('.pe-sh-wkg').forEach(el => {
        const v = parseFloat(el.value) || 0;
        if(v){
          if(el.dataset.kind === 'cart') cod[el.dataset.w] = v;
          else wod[el.dataset.w] = v;
        }
      });
      if(Object.keys(wod).length || Object.keys(cod).length){
        if(Object.keys(wod).length) updates.wagonOutDist = wod;
        if(Object.keys(cod).length) updates.cartOutDist  = cod;
        updates.wagonOut = Object.keys(wod).join(',');
        updates.cartOut  = Object.keys(cod).join(',');
        let total = 0;
        Object.values(wod).forEach(v => total += parseFloat(v)||0);
        Object.values(cod).forEach(v => total += parseFloat(v)||0);
        updates.kg = total;
      }
    }
  }

  Object.assign(rec, updates);
  saveL();
  renderPL(type);
  if(typeof renderDailyFromLocal_ === 'function') {
    try { renderDailyFromLocal_(tod()); } catch(e){}
  }
  if(fbId) fbUpdate(FBCOL[type] || type, fbId, updates);
  toast((PNM && PNM[type] ? PNM[type] : type) + ' 수정됨 ✓', 's');
}

function renderPL(type){
  const today=tod();
  const items=(L[type]||[]).filter(r=>String(r.date||'').slice(0,10)===today);
  const el=document.getElementById('list-'+type);
  if(!el) return;
  if(!items.length){el.innerHTML='<div class="emp">데이터 없음</div>';return;}
  el.innerHTML='<div class="rl">'+items.map(r=>{
    // packing은 기존 pkEdit 폼 유지, 나머지는 통합 buildEditForm
    let editForm = '';
    let editToggle = '';
    if(type==='packing') {
      // noMeat 제품 (메추리알 등): 와건/카트 입력 칸 + 와건/카트 매트릭스 숨김
      const _prod = (L.products||[]).find(x => x.name === r.product);
      const _isNoMeat = !!(_prod && _prod.noMeat);

      // 신규 매트릭스 영역
      let pkMatrix = '<div style="margin:8px 0;padding:8px;background:#fff;border-radius:6px;border:1px dashed var(--g3)">';
      const wd = r.wagonDist || {};
      const cd = r.cartDist || {};
      const tk = r.typeKgs || {};
      // 와건별 kg (noMeat 아니면 항상 표시 — 와건번호 input 변경 시 동적 갱신)
      if(!_isNoMeat){
        pkMatrix += '<div id="pkEdWdBox_'+r.id+'">';
        pkMatrix += '<div style="font-size:11px;font-weight:600;color:#72243E;margin-bottom:4px">와건별 사용 kg</div>';
        // 초기 렌더: wagonDist 키 우선, 없으면 wagon 문자열에서 추출
        const wKeys = Object.keys(wd).length
          ? Object.keys(wd)
          : (r.wagon ? String(r.wagon).split(',').map(w=>w.trim()).filter(Boolean) : []);
        if(wKeys.length){
          wKeys.forEach(w => {
            pkMatrix += `<div style="display:grid;grid-template-columns:80px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px;color:#72243E">와건 ${w}</span><input class="fc pkEd-wd" data-w="${w}" data-kind="wagon" type="number" step="0.01" value="${wd[w]||0}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
          });
        } else {
          pkMatrix += '<div style="font-size:11px;color:var(--g4);padding:4px 0">와건번호 입력 후 자동 생성</div>';
        }
        pkMatrix += '</div>';
      }
      // 카트별 kg (noMeat 아니면 항상)
      if(!_isNoMeat){
        pkMatrix += '<div id="pkEdCdBox_'+r.id+'" style="margin-top:6px">';
        const cKeys = Object.keys(cd).length
          ? Object.keys(cd)
          : (r.cart ? String(r.cart).split(',').map(c=>c.trim()).filter(Boolean) : []);
        if(cKeys.length){
          pkMatrix += '<div style="font-size:11px;font-weight:600;color:#1a56db;margin-bottom:4px">카트별 사용 kg</div>';
          cKeys.forEach(c => {
            pkMatrix += `<div style="display:grid;grid-template-columns:80px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px;color:#1a56db">카트 ${c}</span><input class="fc pkEd-wd" data-w="${c}" data-kind="cart" type="number" step="0.01" value="${cd[c]||0}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
          });
        }
        pkMatrix += '</div>';
      }
      // 소스 탱크
      const st = r.sauceTanks || [];
      if(st.length){
        pkMatrix += '<div style="font-size:11px;font-weight:600;color:#27500A;margin:6px 0 4px">소스 탱크</div>';
        st.forEach((s,i) => {
          pkMatrix += `<div style="display:grid;grid-template-columns:90px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px">${s.tank||'-'}</span><input class="fc pkEd-st" data-tank="${s.tank||''}" data-idx="${i}" type="number" step="0.01" value="${s.kg||0}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
        });
      }
      // 원육별 kg (항상 표시 — 빈 typeKgs라도 부위 추가 가능)
      if(!_isNoMeat){
        pkMatrix += '<div id="pkEdTkBox_'+r.id+'" style="margin-top:6px">';
        pkMatrix += '<div style="font-size:11px;font-weight:600;color:#72243E;margin-bottom:4px">원육별 사용 kg</div>';
        const tKeys = Object.keys(tk);
        if(tKeys.length){
          tKeys.forEach(t => {
            pkMatrix += `<div style="display:grid;grid-template-columns:90px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px">${t}</span><input class="fc pkEd-tk" data-type="${t}" type="number" step="0.01" value="${tk[t]||0}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
          });
        } else {
          // 빈 typeKgs: 부위 직접 추가 가능한 select
          ['우둔','홍두깨','설도'].forEach(t => {
            pkMatrix += `<div style="display:grid;grid-template-columns:90px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px;color:var(--g5)">${t}</span><input class="fc pkEd-tk" data-type="${t}" type="number" step="0.01" placeholder="0" value="" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
          });
        }
        pkMatrix += '</div>';
      }
      pkMatrix += '</div>';

      editForm = `
    <div id="pkEdit_${r.id}" style="display:none;background:#f8f9fa;border-radius:6px;padding:10px;margin-top:6px;font-size:12px">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
        <div><label style="font-size:11px;color:var(--g5);display:block">설비번호</label><input class="fc" style="padding:4px 8px;font-size:12px;width:100%" id="pkEd_machine_${r.id}" value="${r.machine||''}"></div>
        ${_isNoMeat ? '' : `<div><label style="font-size:11px;color:#72243E;display:block">와건번호</label><input class="fc" style="padding:4px 8px;font-size:12px;width:100%" id="pkEd_wagon_${r.id}" value="${r.wagon||''}" oninput="pkEdRefreshMatrix('${r.id}','wagon')"></div>`}
        ${_isNoMeat ? '' : `<div><label style="font-size:11px;color:#1a56db;display:block">카트번호</label><input class="fc" style="padding:4px 8px;font-size:12px;width:100%" id="pkEd_cart_${r.id}" value="${r.cart||''}" oninput="pkEdRefreshMatrix('${r.id}','cart')"></div>`}
        <div><label style="font-size:11px;color:var(--g5);display:block">생산 EA</label><input class="fc" type="number" style="padding:4px 8px;font-size:12px;width:100%" id="pkEd_ea_${r.id}" value="${r.ea||0}"></div>
        <div><label style="font-size:11px;color:var(--g5);display:block">불량 EA</label><input class="fc" type="number" style="padding:4px 8px;font-size:12px;width:100%" id="pkEd_defect_${r.id}" value="${r.defect||0}"></div>
        <div><label style="font-size:11px;color:var(--g5);display:block">시작</label><input class="fc" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" style="padding:4px 8px;font-size:12px;width:100%" id="pkEd_start_${r.id}" value="${r.start||''}"></div>
        <div><label style="font-size:11px;color:var(--g5);display:block">종료</label><input class="fc" type="text" inputmode="decimal" maxlength="5" placeholder="HH:MM" style="padding:4px 8px;font-size:12px;width:100%" id="pkEd_end_${r.id}" value="${r.end||''}"></div>
        <div><label style="font-size:11px;color:var(--g5);display:block">인원</label><input class="fc" type="number" style="padding:4px 8px;font-size:12px;width:100%" id="pkEd_workers_${r.id}" value="${r.workers||0}"></div>
      </div>
      ${pkMatrix}
      <div style="display:flex;gap:6px">
        <button class="btn bp bsm" onclick="savePkEdit('${r.id}','${r.fbId||''}')">✔ 저장</button>
        <button class="btn bo bsm" onclick="document.getElementById('pkEdit_${r.id}').style.display='none'">취소</button>
      </div>
    </div>`;
      editToggle = `<button class="btn bo bsm" onclick="document.getElementById('pkEdit_${r.id}').style.display=document.getElementById('pkEdit_${r.id}').style.display==='none'?'block':'none'">✏️</button>`;
    } else if(PE_FIELDS[type]) {
      editForm = buildEditForm(type, r);
      editToggle = `<button class="btn bo bsm" onclick="document.getElementById('peEdit_${type}_${r.id}').style.display=document.getElementById('peEdit_${type}_${r.id}').style.display==='none'?'block':'none'">✏️</button>`;
    }
    return `
    <div class="ri">
      <div>
        <div class="rm">${(PH[type]||((r)=>r.id))(r)}</div>
        <div class="rs">${(PS[type]||((r)=>''))(r)}</div>
      </div>
      <div style="display:flex;gap:4px">
        ${editToggle}
        <button class="btn bo bsm" onclick="delR('${type}','${r.id}','${r.fbId||''}')">삭제</button>
      </div>
    </div>${editForm}`;
  }).join('')+'</div>';
}

// 수정 폼: 와곤/카트번호 input 변경 시 와곤별 사용 kg 입력칸 동적 갱신
function pkEdRefreshMatrix(id, kind){
  const inputId = kind==='cart' ? 'pkEd_cart_'+id : 'pkEd_wagon_'+id;
  const boxId   = kind==='cart' ? 'pkEdCdBox_'+id  : 'pkEdWdBox_'+id;
  const inp = document.getElementById(inputId);
  const box = document.getElementById(boxId);
  if(!inp || !box) return;

  const nums = inp.value.split(',').map(s=>s.trim()).filter(Boolean);
  // 기존 입력값 보존
  const existing = {};
  box.querySelectorAll('.pkEd-wd[data-kind="'+kind+'"]').forEach(el => {
    existing[el.dataset.w] = parseFloat(el.value) || 0;
  });

  const labelTxt = kind==='cart' ? '카트별 사용 kg' : '와건별 사용 kg';
  const color = kind==='cart' ? '#1a56db' : '#72243E';
  const prefix = kind==='cart' ? '카트' : '와건';

  let html = '';
  if(nums.length){
    html = `<div style="font-size:11px;font-weight:600;color:${color};margin-bottom:4px">${labelTxt}</div>`;
    nums.forEach(w => {
      const v = existing[w] || 0;
      html += `<div style="display:grid;grid-template-columns:80px 1fr 30px;gap:4px;align-items:center;margin-bottom:3px"><span style="font-size:11px;color:${color}">${prefix} ${w}</span><input class="fc pkEd-wd" data-w="${w}" data-kind="${kind}" type="number" step="0.01" value="${v}" style="padding:3px 6px;font-size:11px;text-align:right"><span style="font-size:10px;color:var(--g5)">kg</span></div>`;
    });
  } else {
    html = `<div style="font-size:11px;color:var(--g4);padding:4px 0">${prefix}번호 입력 후 자동 생성</div>`;
  }
  box.innerHTML = html;
}

function savePkEdit(id, fbId) {
  const rec = L.packing.find(r=>r.id===id);
  if(!rec){ toast('기록 없음','d'); return; }
  const machine = document.getElementById('pkEd_machine_'+id)?.value||'';
  // noMeat 제품은 와건/카트 input이 없으므로 기존 값 유지
  const wagonEl = document.getElementById('pkEd_wagon_'+id);
  const wagon   = wagonEl ? wagonEl.value : (rec.wagon || '');
  const cartEl  = document.getElementById('pkEd_cart_'+id);
  const cart    = cartEl ? cartEl.value : (rec.cart || '');
  const ea      = parseFloat(document.getElementById('pkEd_ea_'+id)?.value)||0;
  const defect  = parseFloat(document.getElementById('pkEd_defect_'+id)?.value)||0;
  const start   = document.getElementById('pkEd_start_'+id)?.value||'';
  const end_    = document.getElementById('pkEd_end_'+id)?.value||'';
  const workers = parseFloat(document.getElementById('pkEd_workers_'+id)?.value)||0;

  // 신규 매트릭스 필드 수집
  const editRoot = document.getElementById('pkEdit_'+id);
  const matrixUpdates = {};
  if(editRoot){
    // 와건/카트별 kg (data-kind로 분리)
    const wd = {};
    const cdMap = {};
    editRoot.querySelectorAll('.pkEd-wd').forEach(el => {
      const v = parseFloat(el.value) || 0;
      if(v){
        if(el.dataset.kind === 'cart') cdMap[el.dataset.w] = v;
        else wd[el.dataset.w] = v;
      }
    });
    if(Object.keys(wd).length)    matrixUpdates.wagonDist = wd;
    if(Object.keys(cdMap).length) matrixUpdates.cartDist  = cdMap;
    // 소스 탱크
    const st = [];
    editRoot.querySelectorAll('.pkEd-st').forEach(el => {
      const tank = el.dataset.tank;
      const kg = parseFloat(el.value) || 0;
      if(tank) st.push({tank, kg});
    });
    if(st.length){
      matrixUpdates.sauceTanks = st;
      // sauceKg 합계 갱신
      let total = 0; st.forEach(x => total += x.kg);
      matrixUpdates.sauceKg = total;
    }
    // 원육별 kg
    const tk = {};
    editRoot.querySelectorAll('.pkEd-tk').forEach(el => {
      const v = parseFloat(el.value) || 0;
      if(v) tk[el.dataset.type] = v;
    });
    if(Object.keys(tk).length) matrixUpdates.typeKgs = tk;
  }

  Object.assign(rec, {machine, wagon, cart, ea, defect, start, end:end_, workers}, matrixUpdates);
  saveL();
  renderPL('packing');
  renderDailyFromLocal_(tod());
  const updates = Object.assign({machine, wagon, cart, ea, defect, start, end:end_, workers}, matrixUpdates);
  if(fbId) {
    fbUpdate('packing', fbId, updates);
  } else {
    (async () => {
      const rows = await fbGetByDate('packing', String(rec.date||'').slice(0,10));
      const match = rows.find(r => r.id === id);
      if(match && match.fbId) {
        rec.fbId = match.fbId; saveL();
        fbUpdate('packing', match.fbId, updates);
      } else {
        toast('Firebase ID 없음 - 로컬만 수정됨','w');
      }
    })();
  }
  toast('포장 기록 수정됨 ✓','s');
}

// ============================================================
// 삭제
// ============================================================
function delR(type,id,fbId){
  const rec = L[type].find(r=>r.id===id);
  L[type]=L[type].filter(r=>r.id!==id); saveL(); renderPL(type);
  if(fbId) fbDelete(FBCOL[type]||type, fbId);
  if(type==='thawing') renderThawList();

  // 전처리 삭제 시 → 연결된 방혈 대차 잔여중량 복원
  // 우선순위 1: thawingTouches (저장 시 정확한 추적 정보) → fbId/id로 정확 매칭
  // 우선순위 2: wagons + date + cart 매칭 (구버전 호환, 부정확할 수 있음)
  if(type==='preprocess' && rec) {
    const touches = rec.thawingTouches || [];

    if(touches.length){
      // 정확한 복원: 저장 시 기록한 thFbId/thId/deductKg/prevEnd 그대로 되돌림
      touches.forEach(async t => {
        // L.thawing에서 정확한 record 찾기
        let th = null;
        if(t.thFbId) th = L.thawing.find(x => x.fbId === t.thFbId);
        if(!th && t.thId) th = L.thawing.find(x => x.id === t.thId);
        if(!th){
          toast(`복원 SKIP: cart ${t.cart} (thawing record 없음)`,'w');
          return;
        }
        // 정확한 deductKg만큼 더해서 복원 + end는 이전 값 그대로 복원
        th.remainKg = r2((parseFloat(th.remainKg)||0) + (parseFloat(t.deductKg)||0));
        th.end = t.prevEnd || ''; // 차감 전의 end 값 정확히 복원 ('' = 미종료)
        saveL();
        if(t.thFbId){
          fbUpdate('thawing', t.thFbId, {remainKg: th.remainKg, end: th.end});
        }
      });
    } else {
      // 구버전 호환: wagons 문자열 + date + cart로 매칭 (부정확할 수 있음)
      const ppKg = parseFloat(rec.kg)||0;
      const wagonsStr = rec.wagons||'';
      const ppDate = String(rec.date||'').slice(0,10);
      const dist = rec.distribution || {};

      wagonsStr.split(',').map(w=>w.trim()).filter(Boolean).forEach(async wagonNum => {
        let th = L.thawing.find(t => t.cart===wagonNum && String(t.date||'').slice(0,10) === ppDate);
        if(!th){
          const yst = (typeof getYesterday_==='function') ? getYesterday_() : addDays(ppDate,-1);
          th = L.thawing.find(t => t.cart===wagonNum && String(t.date||'').slice(0,10) === yst);
        }
        if(!th){
          toast(`복원 SKIP: ${wagonNum}번 cart (${ppDate} 매칭 없음)`,'w');
          return;
        }
        let restoreKg = 0;
        if(dist[wagonNum]){
          restoreKg = parseFloat(dist[wagonNum].totalIn || dist[wagonNum].total || 0) || 0;
        }
        if(!restoreKg){
          const cartCount = wagonsStr.split(',').filter(s=>s.trim()).length;
          restoreKg = cartCount ? ppKg/cartCount : 0;
        }
        th.remainKg = r2((parseFloat(th.remainKg)||0) + restoreKg);
        th.end = ''; // 구버전: end 무조건 복원
        saveL();
        let fbThId = th.fbId;
        if(!fbThId) {
          const rows = await fbGetByDate('thawing', String(th.date||'').slice(0,10));
          const match = rows.find(r=>r.cart===wagonNum);
          if(match) { fbThId=match.fbId; th.fbId=fbThId; saveL(); }
        }
        if(fbThId) fbUpdate('thawing', fbThId, {remainKg:th.remainKg, end:''});
      });
    }
    updPpWagon();
    updateThawInfo();
  }

  // 구글시트에서도 삭제
  if(rec) gasRecord('deleteRecord', {
    type: FBCOL[type]||type,
    date: rec.date||tod(),
    importCode: rec.importCode||'',
    start: rec.start||'',
    wagon: rec.wagon||''
  });
}
