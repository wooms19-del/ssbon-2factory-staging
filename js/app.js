// ============================================================
// CSV 내보내기
// ============================================================
function expCSV(type){
  const items=L[type].filter(r=>String(r.date||'').slice(0,10)===tod());
  if(!items.length){toast('데이터 없음','d');return;}
  const ks=Object.keys(items[0]).filter(k=>k!=='id'&&k!=='fbId');
  dlCSV(`${type}_${tod()}.csv`,[ks,...items.map(r=>ks.map(k=>r[k]??''))]);
}
function dlCSV(fn,rows){
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  a.download=fn; a.click();
}

function resetAll(){ if(!confirm('⚠ 모든 로컬 데이터 초기화?'))return; L=nL(); saveL(); toast('초기화 완료','d'); renderSettings(); }

// ============================================================
// 토스트
// ============================================================
function toast(msg,t='s'){
  const el=document.createElement('div');
  el.className=`toast ${t}`; el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),2500);
}

// ============================================================
// 탭 네비게이션
// ============================================================
function setMode(m){
  MODE=m;
  document.getElementById('modeI').classList.toggle('on',m==='i'); 
  document.getElementById('modeD').classList.toggle('on',m==='d'); 
  document.getElementById('attHdBtn').classList.remove('on');
  var _mp=document.getElementById('modeP'); if(_mp) _mp.classList.remove('on');
  var _mai=document.getElementById('modeAI'); if(_mai) _mai.classList.toggle('on',m==='ai');
  document.getElementById('inav').classList.toggle('hid',m!=='i');
  document.getElementById('dnav').classList.toggle('hid',m!=='d');
  document.getElementById('mscroll').scrollTop=0;
  if(m==='ai'){
    document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
    var pgAi = document.getElementById('p-ai');
    if(pgAi){
      pgAi.classList.add('on');
      _renderAIPage(pgAi);
    }
    return;
  }
  if(m==='i') showTab('i',ITAB); else showTab('d',DTAB);
}

// AI 분석 페이지 렌더 (탭 진입 시 1회)
function _renderAIPage(el){
  if(el.dataset.rendered === '1') return;
  el.dataset.rendered = '1';
  var today = (typeof tod === 'function') ? tod() : new Date().toISOString().slice(0,10);
  var monthAgo = (typeof addDays === 'function') ? addDays(today, -7) : today;
  el.innerHTML = `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:16px">
      <h2 style="margin:0 0 4px;color:#0f172a;font-size:20px">🤖 AI 분석</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:16px">기간을 선택하면 AI가 모든 공정 데이터를 종합 분석합니다.</div>
      
      <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
        <div>
          <label style="display:block;font-size:12px;color:#475569;margin-bottom:4px">시작일</label>
          <input type="date" id="ai_from" value="${monthAgo}" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">
        </div>
        <div>
          <label style="display:block;font-size:12px;color:#475569;margin-bottom:4px">종료일</label>
          <input type="date" id="ai_to" value="${today}" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">
        </div>
        <button id="ai_run_btn" onclick="runAIAnalysis()" style="padding:10px 20px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">🤖 AI 분석 시작</button>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:8px">최대 35일까지 가능. 기간이 길수록 분석 시간 증가 (10~30초). · API 키는 분석 → 설정 → 🤖 AI 설정에서 변경</div>
    </div>
    
    <div id="ai_result"></div>
  `;
}

function showTab(mode,tab){
  if(mode==='i') ITAB=tab; else DTAB=tab;
  const nav=mode==='i'?'inav':'dnav';
  const tabs=mode==='i'?['barcode','thawing','preprocess','cooking','shredding','packing','sauce','outerpacking','attendance']:['daily','monthly','trace','recipe','settings'];
  document.querySelectorAll(`#${nav} .ti`).forEach((el,i)=>el.classList.toggle('on',tabs[i]===tab));
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  const pg=document.getElementById('p-'+tab); if(pg) pg.classList.add('on');
  document.getElementById('mscroll').scrollTop=0;

  const today=tod();
  if(tab==='thawing'){
    const yd=getYesterday_();
    Promise.all([loadFromServer(today), loadFromServer(yd)]).then(()=>{ renderThawWaiting(); renderThawList(); });
  } else if(tab==='barcode'){
    loadFromServer(today).then(()=>renderBC());
  } else if(tab==='preprocess'){
    const yd2=getYesterday_();
    Promise.all([loadOpenThawing(), loadFromServer(today), loadFromServer(yd2)])
      .then(()=>{ updateThawInfo(); updPpWagon(); renderPL('preprocess'); });
  } else if(tab==='cooking'){
    if(!L.cooking_pending) L.cooking_pending=[];
    // ★ loadOpenCooking 추가 (다른 디바이스 진행중 자숙 가시성)
    Promise.all([loadFromServer(today), loadOpenCooking()]).then(()=>{
      renderCkCageList(); renderPL('cooking'); renderCkPending();
      const hasPending = L.cooking_pending.some(r=>String(r.date||'').slice(0,10)===tod());
      document.getElementById('ck_startCard').style.display = hasPending ? 'none' : '';
      document.getElementById('ck_pendingCard').style.display = hasPending ? '' : 'none';
    });
  } else if(tab==='shredding'){
    // ★ loadOpenPacking 추가 — shredding은 packing/packing_pending도 표시 (사용된 wagon 추적)
    Promise.all([loadFromServer(today), loadOpenPacking()]).then(()=>{ renderShWagonList(); renderPL('shredding'); });
  } else if(tab==='packing'){
    if(!L.packing_pending) L.packing_pending = [];
    Promise.all([loadFromServer(today), loadOpenPacking()]).then(()=>{
      renderPkWagonList();
      renderPL('packing');
      renderPkPending();
      // 진행중 있으면 진행중 카드 표시, 없으면 시작 카드 표시
      const hasPending = L.packing_pending.some(r=>String(r.date||'').slice(0,10)===tod());
      document.getElementById('pk_startCard').style.display = hasPending ? 'none' : '';
      document.getElementById('pk_pendingCard').style.display = hasPending ? '' : 'none';
    });
  } else if(tab==='sauce'){
    loadFromServer(today).then(()=>renderPL(tab));
  } else if(tab==='monthly'){
    renderMonthly();
  } else if(tab==='daily'){
    renderDaily();
  } else if(tab==='trace'){
    renderTrTbl();
  } else if(tab==='settings'){
    loadSettings_().then(()=>renderSettings()).catch(()=>renderSettings());
    // AI key 상태도 함께 표시 (acc-ai 펼치지 않아도 미리 로드)
    if(typeof aiKeyRefresh === 'function') setTimeout(aiKeyRefresh, 100);
  } else if(tab==='schedule'){
    if(typeof initSchedule==='function') initSchedule();
  } else if(tab==='outerpacking'){
    loadOuterPacking();
  } else if(tab==='attendance'){
    initAttendance();
  } else if(tab==='recipe'){
    updDD();
    renderRcList();
  }
}

// ============================================================
// 초기화
// ============================================================
function clearStaleLocalData(){
  L.barcodes=L.barcodes.filter(b=>String(b.date||'').slice(0,10)===tod());
  ['thawing','preprocess','cooking','shredding','packing','sauce'].forEach(key=>{
    const seen=new Set();
    L[key]=L[key].filter(r=>{ const k=r.id||JSON.stringify(r); if(seen.has(k))return false; seen.add(k);return true; });
  });
  saveL();
}

function init(){
  if(!L) L = loadL(); // 여기서 초기화
  // 일지 출력 날짜 기본값
  const upDate = document.getElementById('up_date');
  if(upDate) upDate.value = tod();
  const expDate = document.getElementById('exp_date');
  if(expDate) expDate.value = tod();
  const n=new Date(), dys=['일','월','화','수','목','금','토'];
  document.getElementById('hDate').textContent=`${n.getMonth()+1}/${n.getDate()}(${dys[n.getDay()]})`;
  // 날짜 클릭 시 날짜 변경 (테스트용)
  // 날짜 클릭 시 변경
  document.getElementById('hDate').style.cursor='pointer';
  document.getElementById('hDate').title='클릭하여 날짜 변경';
  document.getElementById('hDate').onclick=()=>{
    const val = prompt('날짜 입력 (예: 2026-04-13)', tod());
    if(!val) return;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(val)){ toast('날짜 형식 오류 (YYYY-MM-DD)','d'); return; }
    const d=new Date(val+'T00:00:00');
    const dys2=['일','월','화','수','목','금','토'];
    document.getElementById('hDate').textContent=`${d.getMonth()+1}/${d.getDate()}(${dys2[d.getDay()]}) ✏️`;
    window._testDate = val;
    window.tod = ()=> window._testDate || new Date().toISOString().slice(0,10);
    toast(`날짜 변경: ${val}`,'i');
    // 날짜 변경 후 어제+오늘 데이터 새로 로드
    const yd = (()=>{const d=new Date(val+'T00:00:00');d.setDate(d.getDate()-1);return d.toISOString().slice(0,10);})();
    Promise.all([loadFromServer(val), loadFromServer(yd)]).then(()=>{
      showTab(MODE, MODE==='i'?ITAB:DTAB);
    });
  };
  clearStaleLocalData();
  updDD();
  renderBC();
  ['preprocess','cooking','shredding','packing','sauce'].forEach(t=>renderPL(t));
  renderThawList();
  loadSettings_();
  startAutoRefresh();
  loadFromServer(tod()).then(()=>{
    renderBC();
    renderThawWaiting();
    renderThawList();
  });
}
function setModeAtt(){
  // 입력/분석 버튼 off
  document.querySelectorAll('.mb').forEach(function(b){b.classList.remove('on');});
  document.getElementById('attHdBtn').classList.add('on');
  // 모든 nav 숨김
  ['inav','dnav'].forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.className='tnav hid';
  });
  // 모든 pg 숨김 후 출퇴근만 표시
  document.querySelectorAll('.pg').forEach(function(p){p.classList.remove('on');});
  var ap=document.getElementById('p-attendance');
  if(ap)ap.classList.add('on');
  document.getElementById('mscroll').scrollTop=0;
  initAttendance();
}
