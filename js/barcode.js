// ============================================================
// 바코드 파싱
// ============================================================
var OM={'01':'호주','02':'뉴질랜드','03':'미국','04':'멕시코','05':'캐나다',
  '12':'칠레','16':'덴마크','19':'프랑스','25':'아일랜드','35':'네덜란드','48':'우루과이'};

function cleanBC(v){ return String(v||'').replace(/[^\d]/g,'').trim(); }

function detT(code){
  if(!code) return '';
  if(/^8\d{11}$/.test(code)) return 'trace';
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

function parseImp(bc){
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
  document.getElementById('mscroll').addEventListener('click', ()=>{
    if(MODE==='i'&&ITAB==='barcode') focusBC();
  });
});

function procBC(code){
  const type=detT(code);
  if(!type){ setBcAl('❌ 인식 불가: '+code.slice(0,12),'d'); return; }

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

  const imp=parseImp(iCode), tr=parseTr(tCode), judge=judgeBC(imp,tr);
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
  if(judge.status==='적합')
    setBcAl(`✅ 적합 — ${imp.part} / ${tr.origin} / ${imp.weightKg}kg · 해동종료 ${rfEnd}`,'s');
  else
    setBcAl(`❌ 부적합 — ${judge.reason}`,'d');

  // Firebase 저장 + 구글시트 백업 (동시, 비동기)
  fbSave('barcode', rec).then(fbId => {
    if(fbId) { rec.fbId = fbId; saveL(); }
  });
  gasRecord('saveBarcode', rec); // 구글시트 백업
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
  el.innerHTML=[...items].reverse().map(b=>`
    <div class="bcitem ${b.status==='적합'?'gd':'bd'}">
      <span class="bcst ${b.status==='적합'?'sg':'sb'}">${b.status}</span>
      <div class="bcinfo">
        <div class="bcm">${b.part||'-'} · ${b.origin||'-'} · ${b.weightKg||'-'}kg</div>
        <div class="bcd">🕐 해동기 ${b.rfStart?b.rfStart.slice(0,5):'-'} → 종료 ${b.rfEnd||'-'}${b.status==='부적합'?' · '+b.reason:' · 소비기한 '+(b.expiryDate||'-')}</div>
      </div>
      <button class="bcdel" onclick="delBC('${b.id}','${b.fbId||''}')">×</button>
    </div>`).join('');
  renderBcSummaryCard();
}

function delBC(id,fbId){
  const rec = L.barcodes.find(b=>b.id===id);
  L.barcodes=L.barcodes.filter(b=>b.id!==id); saveL(); renderBC();
  if(fbId) fbDelete('barcode', fbId);
  if(rec) gasRecord('deleteRecord', {type:'barcode', date:rec.date||tod(), importCode:rec.importCode||''});
}
function clrToday(){
  if(!confirm('오늘 해동기 데이터 삭제?'))return;
  const toDelete = L.barcodes.filter(r=>String(r.date||'').slice(0,10)===tod());
  toDelete.forEach(r=>{ if(r.fbId) fbDelete('barcode', r.fbId); });
  L.barcodes=L.barcodes.filter(r=>String(r.date||'').slice(0,10)!==tod());
  saveL(); renderBC();
}