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
  document.getElementById('modeI').classList.toggle('on',m==='i'); document.getElementById('modeD').classList.toggle('on',m==='d'); document.getElementById('attHdBtn').classList.remove('on');
  var _mp=document.getElementById('modeP'); if(_mp) _mp.classList.remove('on');
  document.getElementById('inav').classList.toggle('hid',m!=='i');
  document.getElementById('dnav').classList.toggle('hid',m!=='d');
  document.getElementById('mscroll').scrollTop=0;
  if(m==='i') showTab('i',ITAB); else showTab('d',DTAB);
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
