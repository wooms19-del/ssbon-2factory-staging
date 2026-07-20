// ============================================================
// 바코드 파싱
// ============================================================
var OM={'01':'호주','02':'뉴질랜드','03':'미국','04':'멕시코','05':'캐나다',
  '12':'칠레','16':'덴마크','19':'프랑스','25':'아일랜드','35':'네덜란드','48':'우루과이'};

function cleanBC(v){ return String(v||'').replace(/[^\d]/g,'').trim(); }

function detT(code){
  if(!code) return '';
  if(/^8\d{11}$/.test(code)) return 'trace';
  if(/^02\d{14}$/.test(code)) return 'import';   // 호주 EST224 16자리
  let n=code;
  if(!n.startsWith('01')&&n.startsWith('1')) n='0'+n;
  if(n.includes('310')||n.includes('320')||n.includes('11')||
     n.includes('13')||n.includes('15')||n.includes('17')) return 'import';
  if(n.length>=20) return 'import';
  return '';
}

function fmtD(s){
  if(!s || s.length !== 6) return '';
  // YYMMDD → YYYY-MM-DD 변환
  const yy = s.slice(0,2);
  const mm = s.slice(2,4);
  const dd = s.slice(4,6);
  // 유효성 검사
  const month = parseInt(mm);
  const day = parseInt(dd);
  if(month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `20${yy}-${mm}-${dd}`;
}

function add24m(ds){
  if(!ds) return '';
  const d=new Date(ds+'T00:00:00');
  d.setMonth(d.getMonth()+24); d.setDate(d.getDate()-1);
  return d.toISOString().slice(0,10);
}

// ============================================================
// 호주 EST224 (16자리) 바코드
//   02 | 2035 | 527  | 0207 | 542
//      제품코드  포장일  CTN   무게×20
//   포장일: 율리우스식 3자리 (344=25년 344일째=12/10, 5xx=26년 x일째)
//   무게: 값/20 (0.05kg 단위)
// ============================================================
var AU224_PART = { '2035':'홍두깨', '8299':'홍두깨' };   // EYE ROUND. 다른 부위코드는 확인되면 추가

function isAU224(code){ return /^02\d{14}$/.test(String(code||'')); }

function _au224Date(j){
  // j: 3자리. 344 → 2025년 344일째 / 5xx → 2026년 (x)일째
  var n = parseInt(j,10);
  if(!isFinite(n) || n<=0) return '';
  var year, doy;
  if(n>=500){ year=2026; doy=n-500; }
  else { year=2025; doy=n; }
  if(doy<1 || doy>366) return '';
  var d = new Date(Date.UTC(year,0,1));
  d.setUTCDate(d.getUTCDate() + (doy-1));
  return d.toISOString().slice(0,10);
}

function parseAU224(bc){
  var r={gtin:'',part:'확인필요',weightKg:'',packDate:'',expiryDate:'',ctn:''};
  var c=String(bc||'');
  if(!isAU224(c)) return r;
  var item = c.slice(2,6);      // 2035
  var jul  = c.slice(6,9);      // 527
  var ctn  = c.slice(9,13);     // 0207
  var wRaw = c.slice(13,16);    // 542
  r.gtin = item;
  r.ctn  = String(parseInt(ctn,10)||'');
  if(AU224_PART[item]) r.part = AU224_PART[item];
  else if(L && L.gtinMap && L.gtinMap['AU'+item]) r.part = L.gtinMap['AU'+item];  // 현장에서 등록한 신규 제품코드
  var w = parseInt(wRaw,10);
  if(isFinite(w) && w>0) r.weightKg = r2(w/20);   // 0.05kg 단위
  r.packDate = _au224Date(jul);
  if(r.packDate) r.expiryDate = add24m(r.packDate);
  return r;
}

function parseImp(bc){
  if(isAU224(bc)) return parseAU224(bc);   // 호주 EST224 16자리
  const r={gtin:'',part:'확인필요',weightKg:'',packDate:'',expiryDate:''};
  if(!bc) return r;
  let c=bc;
  if(!c.startsWith('01')&&c.startsWith('1')) c='0'+c;
  let i=0;
  while(i<c.length){
    const a2=c.slice(i,i+2), a3=c.slice(i,i+3);
    if(a2==='01'&&i+16<=c.length){r.gtin=c.slice(i+2,i+16);i+=16;continue;}
    if(a3==='310'&&i+10<=c.length){const d=+c[i+3],raw=c.slice(i+4,i+10);r.weightKg=r2(+raw/Math.pow(10,d));i+=10;continue;}
    if(a3==='320'&&i+10<=c.length){const d=+c[i+3],raw=c.slice(i+4,i+10);r.weightKg=r2(+raw/Math.pow(10,d)*0.45359237);i+=10;continue;}
    if((a2==='11'||a2==='13')&&i+8<=c.length){r.packDate=fmtD(c.slice(i+2,i+8));if(!r.expiryDate)r.expiryDate=add24m(r.packDate);i+=8;continue;}
    if((a2==='15'||a2==='17')&&i+8<=c.length){const nd=fmtD(c.slice(i+2,i+8));if(nd)r.expiryDate=nd;i+=8;continue;}
    if(a2==='21'&&i+14<=c.length){i+=14;continue;}  // AI 21 시리얼 12자 skip (시리얼 안의 '15'/'17' 우연 매칭 방지)
    i++;
  }
  if(L.gtinMap[r.gtin]) r.part=L.gtinMap[r.gtin];
  return r;
}

function parseTr(code){
  if(!/^\d{12}$/.test(code)) return {origin:''};
  return {origin: OM[code.slice(1,3)]||'확인필요'};
}

function judgeBC(imp,tr){
  const rs=[];
  if(!tr.origin||tr.origin==='확인필요') rs.push('원산지 판독 실패');
  if(imp.weightKg===''||imp.weightKg===null) rs.push('중량 판독 실패');
  if(!imp.expiryDate) rs.push('소비기한 판독 실패');
  if(!imp.part||imp.part==='확인필요') rs.push('부위 확인 필요');
  return rs.length?{status:'부적합',reason:rs.join(', ')}:{status:'적합',reason:'정상'};
}

function calcRfEnd(t){
  if(!t) return '--:--';
  const p=t.slice(0,5).split(':');
  const tot=+p[0]*60+(+p[1]||0)+30;
  return String(Math.floor(tot/60)%24).padStart(2,'0')+':'+String(tot%60).padStart(2,'0');
}

// ============================================================
// 수동 입력 (수입 바코드 손상 시) — 저장 눌러야 들어감, 여러 건 연속 가능
// ============================================================
function toggleManual(){
  const f=document.getElementById('mnForm'), t=document.getElementById('mnToggle');
  const open = f.style.display==='none';
  f.style.display = open ? 'block':'none';
  t.textContent = open ? '📝 바코드 손상 시 수동 입력 ▴' : '📝 바코드 손상 시 수동 입력 ▾';
  if(open) fillManualOpts();
}
function fillManualOpts(){
  const os=document.getElementById('mnOrigin');
  if(os && !os.dataset.filled){
    os.innerHTML='<option value="">선택</option><option>호주</option><option>뉴질랜드</option>';
    os.dataset.filled='1';
  }
  const ps=document.getElementById('mnPart');
  if(ps && !ps.dataset.filled){
    const parts=[...new Set(Object.values(L.gtinMap||{}).filter(Boolean))];
    const base=parts.length?parts:['홍두깨','설도','우둔'];
    ps.innerHTML='<option value="">선택</option>'+base.map(p=>`<option>${p}</option>`).join('')+'<option value="__custom">기타(직접 입력)</option>';
    ps.dataset.filled='1';
  }
}
function mnPartChange(){
  const cu=document.getElementById('mnPartCustom');
  cu.style.display = document.getElementById('mnPart').value==='__custom' ? 'block':'none';
}
async function saveManual(){
  const origin=document.getElementById('mnOrigin').value;
  let part=document.getElementById('mnPart').value;
  if(part==='__custom') part=document.getElementById('mnPartCustom').value.trim();
  const kg=parseFloat(document.getElementById('mnKg').value);
  const exp=document.getElementById('mnExp').value;
  const al=document.getElementById('mnAl');
  const bad=(m)=>{ al.innerHTML='<span style="color:#dc2626;font-size:13px">⚠️ '+m+'</span>'; };
  if(!origin){ bad('원산지 입력 필요'); return; }
  if(!part){ bad('원육 종류 입력 필요'); return; }
  if(!kg || kg<=0){ bad('중량 입력 필요'); return; }
  if(!exp){ bad('소비기한 입력 필요'); return; }

  const today=tod(), st=nowHM();
  const seq=L.barcodes.filter(b=>String(b.date||'').slice(0,10)===today && String(b.importCode||'').startsWith('MANUAL-')).length + 1;
  const code='MANUAL-'+today.replace(/-/g,'')+'-'+String(seq).padStart(3,'0');
  const rec={
    id:gid(), date:today, rfStart:st, rfEnd:calcRfEnd(st),
    importCode:code, traceCode:'', status:'적합',
    part, origin, weightKg:parseFloat(kg.toFixed(2)),
    packDate:'', expiryDate:exp, reason:'수동입력', manual:true
  };
  L.barcodes.push(rec); saveL(); renderBC();
  al.innerHTML='<span style="color:#16a34a;font-size:13px">✅ 저장됨 — '+part+' / '+origin+' / '+kg+'kg ('+code+')</span>';
  // 중량·소비기한만 비움 (원산지·종류는 같은 로트 연속입력 위해 유지)
  document.getElementById('mnKg').value='';
  document.getElementById('mnExp').value='';
  document.getElementById('mnKg').focus();
  fbSave('barcode', rec).then(fbId=>{ if(fbId){ rec.fbId=fbId; saveL(); } });
}

// ============================================================
// 바코드 스캔
// ============================================================
function focusBC(){ document.getElementById('bcInput').focus(); }

// 24시간 HH:MM 자동 포맷터
document.addEventListener('input', function(e){
  const el = e.target;
  if(el.placeholder !== 'HH:MM') return;
  let v = el.value.replace(/[^0-9]/g,'');
  if(v.length > 4) v = v.slice(0,4);
  if(v.length >= 3) v = v.slice(0,2) + ':' + v.slice(2);
  el.value = v;
}, true);
document.addEventListener('blur', function(e){
  const el = e.target;
  if(el.placeholder !== 'HH:MM') return;
  if(document.getElementById('timePicker').style.display !== 'none') return;
  if(!el.value) return;
  const m = el.value.match(/^(\d{1,2}):?(\d{0,2})$/);
  if(!m) { el.value=''; return; }
  let h = parseInt(m[1]||0), min = parseInt(m[2]||0);
  if(h>23) h=23; if(min>59) min=59;
  el.value = String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');
}, true);

document.addEventListener('DOMContentLoaded', ()=>{
  const inp = document.getElementById('bcInput');
  inp.addEventListener('keydown', e=>{
    if(e.key==='Enter'){
      const v=cleanBC(e.target.value); e.target.value='';
      if(v) procBC(v);
    }
  });
  document.getElementById('mscroll').addEventListener('click', (e)=>{
    if(e.target.closest('#mnForm')) return;
    if(MODE==='i'&&ITAB==='barcode') focusBC();
  });
});

async function procBC(code){
  const type=detT(code);
  if(!type){ setBcAl('❌ 인식 불가: '+code.slice(0,12),'d'); return; }

  // ── 호주 EST224: 바코드 1개로 완결 (이력코드 없음, 원산지=호주 고정) ──
  if(isAU224(code)){
    PEND=null;
    document.getElementById('bcArea').classList.remove('wait');
    const imp=parseAU224(code);
    const tr={origin:'호주'};
    const judge=judgeBC(imp,tr);
    const now=new Date();
    const st=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    const rfEnd=calcRfEnd(st);
    const today=tod();
    if(L.barcodes.some(b=>String(b.date||'').slice(0,10)===today&&b.importCode===code)){
      setBcAl(`⚠️ 이미 스캔된 수입코드 — ${code.slice(-8)}`,'d');
      return;
    }
    const rec={
      id:gid(), date:today, rfStart:st, rfEnd:rfEnd,
      importCode:code, traceCode:'',
      status:judge.status, part:imp.part, origin:tr.origin,
      weightKg:imp.weightKg, packDate:imp.packDate,
      expiryDate:imp.expiryDate, reason:judge.reason
    };
    L.barcodes.push(rec); saveL(); renderBC();
    const hint=document.getElementById('bcHint');
    hint.className='bc-hint';
    if(judge.status==='적합'){
      setBcAl(`✅ 적합 — ${imp.part} / ${tr.origin} / ${imp.weightKg}kg · 해동종료 ${rfEnd}`,'s');
      hint.textContent=`✅ ${imp.part} · ${tr.origin} · ${imp.weightKg}kg`;
      document.getElementById('bcSub').textContent=`해동기 ${st.slice(0,5)} → 종료 ${rfEnd} · 소비기한 ${imp.expiryDate||'-'}`;
    } else {
      setBcAl(`❌ 부적합 — ${judge.reason}`,'d');
      hint.textContent=`❌ 부적합 — ${imp.part||'?'} · ${tr.origin||'?'}`;
      document.getElementById('bcSub').textContent=judge.reason;
    }
    fbSave('barcode', rec).then(fbId=>{ if(fbId){ rec.fbId=fbId; saveL(); } });
    return;
  }

  if(!PEND){
    PEND={code,type}; _lastCode=code;
    document.getElementById('bcArea').classList.add('wait');
    const h=document.getElementById('bcHint');
    h.className='bc-hint wait';
    h.textContent=(type==='import'?'수입코드':'이력코드')+' 인식됨 — 나머지 스캔';
    document.getElementById('bcSub').textContent='';
    return;
  }

  const prev=PEND; PEND=null;
  document.getElementById('bcArea').classList.remove('wait');
  document.getElementById('bcHint').className='bc-hint';
  document.getElementById('bcHint').textContent='바코드 스캔 대기중';
  document.getElementById('bcSub').textContent='수입코드 + 이력코드 (순서 무관)';

  const t1=prev.type, t2=type;
  let iCode, tCode;
  if(t1==='import'&&t2==='trace'){iCode=prev.code; tCode=code;}
  else if(t1==='trace'&&t2==='import'){tCode=prev.code; iCode=code;}
  else{ setBcAl('❌ 수입코드+이력코드 조합이 아닙니다','d'); return; }

  // GTIN 판단표(gtinMap)가 Firestore에서 아직 안 온 상태면 등록된 GTIN도
  // '확인필요'로 잘못 찍혀 부적합 저장됨. 판정 직전에 sync 한 번 보장.
  let imp=parseImp(iCode);
  if((!imp.part||imp.part==='확인필요') && typeof syncGtinMapFromFirestore==='function'){
    try{ await syncGtinMapFromFirestore(); imp=parseImp(iCode); }catch(e){ console.warn('[procBC] gtinMap sync 실패',e); }
  }
  const tr=parseTr(tCode), judge=judgeBC(imp,tr);
  const now=new Date();
  const st=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
  const rfEnd=calcRfEnd(st);

  // 로컬 중복 체크
  const today=tod();
  if(L.barcodes.some(b=>String(b.date||'').slice(0,10)===today&&b.importCode===iCode)){
    setBcAl(`⚠️ 이미 스캔된 수입코드 — ${iCode.slice(-8)}`,'d');
    return;
  }

  const rec={
    id:gid(), date:today,
    rfStart:st, rfEnd:rfEnd,
    importCode:iCode, traceCode:tCode,
    status:judge.status, part:imp.part, origin:tr.origin,
    weightKg:imp.weightKg, packDate:imp.packDate,
    expiryDate:imp.expiryDate, reason:judge.reason
  };

  L.barcodes.push(rec); saveL();
  renderBC();
  if(judge.status==='적합'){
    setBcAl(`✅ 적합 — ${imp.part} / ${tr.origin} / ${imp.weightKg}kg · 해동종료 ${rfEnd}`,'s');
    // 박스 안에 마지막 스캔 정보 영구 표시 (다음 스캔 전까지)
    document.getElementById('bcHint').textContent=`✅ ${imp.part} · ${tr.origin} · ${imp.weightKg}kg`;
    document.getElementById('bcHint').className='bc-hint';
    document.getElementById('bcSub').textContent=`해동기 ${st.slice(0,5)} → 종료 ${rfEnd} · 소비기한 ${imp.expiryDate||'-'}`;
  } else {
    setBcAl(`❌ 부적합 — ${judge.reason}`,'d');
    document.getElementById('bcHint').textContent=`❌ 부적합 — ${imp.part||'?'} · ${tr.origin||'?'}`;
    document.getElementById('bcHint').className='bc-hint';
    document.getElementById('bcSub').textContent=judge.reason;
  }

  // Firebase 저장 + 구글시트 백업 (동시, 비동기)
  fbSave('barcode', rec).then(fbId => {
    if(fbId) { rec.fbId = fbId; saveL(); }
  });
}

function setBcAl(msg,t){
  const el=document.getElementById('bcAl');
  el.innerHTML=`<div class="al al-${t==='s'?'s':t==='d'?'d':'i'}">${msg}</div>`;
  setTimeout(()=>el.innerHTML='',4000);
}

function renderBcSummaryCard(){
  const today = tod();
  const tomorrow = (function(){var d=new Date();d.setDate(d.getDate()+1);return d.toISOString().slice(0,10);})();
  const bc = L.barcodes.filter(function(r){var d=String(r.date||'').slice(0,10);return d===today||d===tomorrow;});
  const el = document.getElementById('bc_summary');
  if(!el) return;
  if(!bc.length){ el.innerHTML='<div class="emp">스캔 데이터 없음</div>'; return; }

  const map = {};
  bc.forEach(function(b){
    const key = (b.part||'-') + '__' + (b.origin||'-');
    if(!map[key]) map[key] = {part:b.part||'-', origin:b.origin||'-', count:0, kg:0};
    map[key].count++;
    map[key].kg += parseFloat(b.weightKg)||0;
  });

  const rows = Object.values(map);
  const totalCount = rows.reduce(function(s,r){return s+r.count;},0);
  const totalKg = r2(rows.reduce(function(s,r){return s+r.kg;},0));

  let html = '<div style="overflow-x:auto"><table class="tbl" style="width:100%">';
  html += '<thead><tr>';
  html += '<th style="text-align:left">부위</th>';
  html += '<th style="text-align:left">원산지</th>';
  html += '<th style="text-align:center">박스</th>';
  html += '<th style="text-align:center">총 중량 (kg)</th>';
  html += '</tr></thead><tbody>';
  rows.forEach(function(row){
    html += '<tr>';
    html += '<td style="font-weight:600">'+row.part+'</td>';
    html += '<td style="color:var(--g5)">'+row.origin+'</td>';
    html += '<td style="text-align:center">'+row.count+'</td>';
    html += '<td style="text-align:center;font-weight:600">'+r2(row.kg).toFixed(2)+'</td>';
    html += '</tr>';
  });
  html += '</tbody><tfoot><tr style="border-top:2px solid var(--g3)">';
  html += '<td style="font-weight:600" colspan="2">합계</td>';
  html += '<td style="text-align:center;font-weight:600">'+totalCount+'</td>';
  html += '<td style="text-align:center;font-weight:600;color:var(--p)">'+totalKg.toFixed(2)+'</td>';
  html += '</tr></tfoot></table></div>';
  el.innerHTML = html;
}

async function renderBC(){
  const today=tod();
  // Firebase fresh fetch — DB가 진실. 다른 디바이스 변경 즉시 반영
  try {
    const fbItems = await fbGetByDate('barcode', today);
    // 로컬에 fbId 없는 = 방금 스캔된 pending. 보존 (Firebase 저장 응답 대기중)
    const pending = L.barcodes.filter(b => !b.fbId && String(b.date||'').slice(0,10)===today);
    L.barcodes = [
      ...L.barcodes.filter(b => String(b.date||'').slice(0,10) !== today),
      ...fbItems,
      ...pending
    ];
    saveL();
  } catch(e) {
    console.warn('Firebase fetch 실패 — 로컬 캐시로 표시:', e);
  }
  const items=L.barcodes.filter(b=>String(b.date||'').slice(0,10)===today);
  document.getElementById('bcCnt').textContent=items.length+'건';
  document.getElementById('bcTot').textContent=items.length;
  document.getElementById('bcGd').textContent=items.filter(b=>b.status==='적합').length;
  document.getElementById('bcBd').textContent=items.filter(b=>b.status==='부적합').length;
  const el=document.getElementById('bcList');
  if(!items.length){el.innerHTML='<div class="emp">스캔 데이터 없음</div>';renderBcSummaryCard();return;}
  // 최신 스캔이 맨 위 (rfStart DESC) — 같은 시각이면 id로 보조 정렬
  const sorted=[...items].sort((a,b)=>{
    const ta=(a.rfStart||''), tb=(b.rfStart||'');
    if(ta!==tb) return tb.localeCompare(ta);
    return String(b.id||'').localeCompare(String(a.id||''));
  });
  el.innerHTML=sorted.map(b=>`
    <div class="bcitem ${b.status==='적합'?'gd':'bd'}">
      <span class="bcst ${b.status==='적합'?'sg':'sb'}">${b.status}</span>
      <div class="bcinfo">
        <div class="bcm">${b.part||'-'} · ${b.origin||'-'} · ${b.weightKg||'-'}kg${b.manual?' <span style="background:#dbeafe;color:#1e40af;font-size:11px;padding:1px 7px;border-radius:9px;font-weight:600">📝 수동입력</span>':''}${b.sample?' <span style="background:#fef3c7;color:#92400e;font-size:11px;padding:1px 7px;border-radius:9px;font-weight:600">🧪 샘플 (무게 제외)</span>':''}</div>
        <div class="bcd">🕐 해동기 ${b.rfStart?b.rfStart.slice(0,5):'-'} → 종료 ${b.rfEnd||'-'}${b.status==='부적합'?' · '+b.reason:' · 소비기한 '+(b.expiryDate||'-')}</div>
      </div>
      <button class="bcdel" style="margin-right:4px;font-size:11px;width:auto;padding:0 8px;border-radius:10px;${b.sample?'background:#92400e;color:#fff':''}" title="샘플 지정/해제 — 박스수에는 포함, 무게에서는 제외" onclick="toggleSampleBC('${b.id}','${b.fbId||''}')">${b.sample?'샘플해제':'샘플'}</button>
      <button class="bcdel" onclick="delBC('${b.id}','${b.fbId||''}')">×</button>
    </div>`).join('');
  renderBcSummaryCard();
  // 부적합 1건 이상이면 미등록 GTIN 배너 (어제 만든 기능)
  _bcCheckUnknownGtinsBanner();
}

// 부적합 화면 위에 미등록 GTIN 배너 표시 (stock.js의 기능 재사용)
async function _bcCheckUnknownGtinsBanner(){
  // 기존 배너 제거
  var oldBanner = document.getElementById('bcGtinBanner');
  if(oldBanner) oldBanner.remove();
  if(typeof findUnknownGtins !== 'function') return;
  try {
    var unknown = await findUnknownGtins();
    if(!unknown || !unknown.length) return;
    var listEl = document.getElementById('bcList');
    if(!listEl) return;
    var banner = document.createElement('div');
    banner.id = 'bcGtinBanner';
    var totalCnt = unknown.reduce(function(s,u){return s + u.count;}, 0);
    banner.innerHTML = ''
      + '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:14px 18px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'
      + '  <div style="flex:1;min-width:200px">'
      + '    <div style="font-size:14px;font-weight:700;color:#92400e">⚠️ 미등록 GTIN ' + unknown.length + '개 발견 (총 ' + totalCnt + '건 부적합)</div>'
      + '    <div style="font-size:12px;color:#78350f;margin-top:3px">새로 들어온 원육 박스 GTIN이 시스템에 등록되지 않아 부적합으로 표시되고 있습니다.</div>'
      + '  </div>'
      + '  <button onclick="_openGtinRegisterModal()" style="background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">등록하고 정리하기</button>'
      + '</div>';
    listEl.parentNode.insertBefore(banner, listEl);
  } catch(e){
    console.warn('[bcGtinBanner] 검사 실패:', e);
  }
}
window._bcCheckUnknownGtinsBanner = _bcCheckUnknownGtinsBanner;

async function toggleSampleBC(id,fbId){
  const rec=L.barcodes.find(b=>b.id===id);
  if(!rec) return;
  const nv=!rec.sample;
  if(nv && !confirm(`이 박스(${rec.part} ${rec.weightKg}kg)를 샘플로 지정할까요?\n박스 수에는 포함되고, 방혈 대차 무게에서는 제외됩니다.`)) return;
  if(fbId){
    const ok=await fbUpdate('barcode', fbId, {sample:nv});
    if(ok===false){ toast('저장 실패','d'); return; }
  }
  rec.sample=nv; saveL(); renderBC();
  toast(nv?'샘플 지정 ✓ (무게 제외)':'샘플 해제 ✓');
}
function delBC(id,fbId){
  const rec = L.barcodes.find(b=>b.id===id);
  L.barcodes=L.barcodes.filter(b=>b.id!==id); saveL(); renderBC();
  if(fbId) fbDelete('barcode', fbId);
}
function clrToday(){
  if(!confirm('오늘 해동기 데이터 삭제?'))return;
  const toDelete = L.barcodes.filter(r=>String(r.date||'').slice(0,10)===tod());
  toDelete.forEach(r=>{ if(r.fbId) fbDelete('barcode', r.fbId); });
  L.barcodes=L.barcodes.filter(r=>String(r.date||'').slice(0,10)!==tod());
  saveL(); renderBC();
}