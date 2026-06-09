/* ── 레토르트 (멸균·살균) 입력 ─────────────────────────────────
   회차 단위 기록: ①가동시작(t1) ②온도도달(t2) ③가열종료(t3, 온도) ④배출완료(t4)
   CCP 구간 = t2~t3. 구분(ccp): '2B'(121℃/18분) | '3B-A'(95℃/30분) | '3B-B'(121℃/18분)
   판정 자동. Firestore 'retort' 컬렉션, localStorage 작업데이터 저장 없음.       */

const RT_MACHINES = ['1','2','3'];
const RT_CCP = {
  '2B':   {label:'CCP-2B (멸균 121℃·18분↑)',  temp:121, min:18, defTemp:121},
  '3B':   {label:'CCP-3B (살균 95℃·30분↑)',   temp:95,  min:30, defTemp:115},
  '3B-A': {label:'CCP-3B (살균 95℃·30분↑)',   temp:95,  min:30, defTemp:115},  // 구버전 호환
  '3B-B': {label:'CCP-3B (살균 95℃·30분↑)',   temp:95,  min:30, defTemp:115},  // 구버전 호환
};
const RT_BATCH=['A','B','C','D','E','F'];  // 3B 자숙 배치 구분

function _rtToday(){ return (L.retort||[]).filter(r=>String(r.date||'').slice(0,10)===tod()); }
function _rtViewDate(){ return window._rtViewDt || tod(); }
function _rtViewRecs(){ const d=_rtViewDate(); return (L.retort||[]).filter(r=>String(r.date||'').slice(0,10)===d); }
async function rtDateChanged(){
  const dEl=document.getElementById('rt_ccp_date');
  const d=(dEl&&dEl.value)||tod();
  window._rtViewDt=d;
  if(d!==tod()){
    try{
      const recs=await fbGetByDate('retort', d);
      L.retort=(L.retort||[]).filter(r=>String(r.date||'').slice(0,10)!==d).concat(recs);
    }catch(e){ console.error('[레토르트] 날짜 조회 실패', e); }
  }
  renderRetort();
}
function _rtMin(a,b){ // 'HH:MM' 차이(분), 자정 넘김 보정
  if(!a||!b) return null;
  const [h1,m1]=a.split(':').map(Number), [h2,m2]=b.split(':').map(Number);
  let d=(h2*60+m2)-(h1*60+m1); if(d<0) d+=1440; return d;
}
function _rtJudge(ccp, min, temp){
  if(min==null||!(temp>0)) return null;
  if(_rtIs3B(ccp)){
    // 3B는 A형(95℃·30분↑) 또는 B형(121℃·18분↑) 중 하나 충족이면 적합
    return ((temp>=95&&min>=30)||(temp>=121&&min>=18)) ? '적합' : '부적합';
  }
  const std=RT_CCP[ccp]; if(!std) return null;
  return (temp>=std.temp && min>=std.min) ? '적합' : '부적합';
}
// 3B 적용 조건 판별: B형(121℃·18분)으로만 충족하면 'B', 그 외 'A'
function _rt3bCond(min, temp){
  if(temp>=121&&min>=18&&!(temp>=95&&min>=30)) return 'B';
  return 'A';
}
// 배치 문자열(예: "A:50, B:46")에서 수량 합계 추출 — 숫자 없으면 null
function _rtBatchSum(str){
  const nums=String(str||'').match(/\d+/g);
  if(!nums||!nums.length) return null;
  return nums.reduce((s,n)=>s+parseInt(n),0);
}
function _rtDefaultCcp(product){ return /3\s*KG/i.test(product||'') ? '3B' : '2B'; }
function _rtIs3B(ccp){ return String(ccp||'').indexOf('3B')===0; }

// 당일 내포장 제품 후보 (+전체 제품 fallback)
function _rtProductOptions(sel){
  // 오늘 내포장(완료+진행중) 제품만 후보로
  const src=[...(L.packing||[]), ...(L.packing_pending||[])];
  const list=[...new Set(src.filter(r=>String(r.date||'').slice(0,10)===tod()).map(r=>r.product).filter(Boolean))];
  return list.map(n=>`<option value="${n.replace(/"/g,'&quot;')}" ${n===sel?'selected':''}>${n}</option>`).join('');
}

async function renderRetort(){
  const wrap=document.getElementById('rt_machines');
  const listEl=document.getElementById('rt_list');
  if(!wrap) return;
  const dEl=document.getElementById('rt_ccp_date');
  if(dEl && !dEl.value) dEl.value=tod();
  const recs=_rtToday();
  const viewDate=_rtViewDate();
  const titleEl=document.getElementById('rt_list_title');
  if(titleEl) titleEl.textContent = viewDate===tod() ? '오늘 회차 기록' : viewDate+' 회차 기록';

  // ── 호기 카드
  wrap.innerHTML = RT_MACHINES.map(m=>{
    const mine=recs.filter(r=>String(r.machine)===m).sort((a,b)=>(a.round||0)-(b.round||0));
    const cur=mine.find(r=>!r.t4);                 // 진행중 회차
    const nextRound=(mine.length?Math.max(...mine.map(r=>r.round||0)):0)+1;
    const head=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="font-weight:700;font-size:15px">${m}호기 <span style="font-size:11px;color:var(--g5);font-weight:400">${cur?cur.round+'회차':nextRound+'회차 대기'}</span></span>
      ${cur ? (cur.t3
        ? '<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px">냉각 중</span>'
        : cur.t2
          ? '<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px">가열 중</span>'
          : '<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px">승온 중</span>')
        : '<span style="font-size:11px;background:var(--g1);color:var(--g5);padding:2px 8px;border-radius:10px">대기</span>'}
    </div>`;

    if(!cur){
      return `<div class="card" style="margin:0">
        ${head}
        <select id="rt_prod_${m}" class="fc" style="width:100%;margin-bottom:6px" onchange="rtProdChanged('${m}')">
          <option value="">${_rtProductOptions('')?'제품 선택':'오늘 내포장 제품 없음'}</option>${_rtProductOptions('')}
        </select>
        <input type="number" id="rt_ea_${m}" class="fc" placeholder="수량 (EA)" style="width:100%;margin-bottom:6px">
        <div id="rt_batchbox_${m}" style="display:none;margin-bottom:8px">
          <div style="font-size:12px;color:var(--g5);margin-bottom:4px">자숙 배치별 수량</div>
          <div id="rt_brows_${m}"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
            <button class="btn bo bsm" onclick="rtAddBatchRow('${m}')">＋ 배치 추가</button>
            <span style="font-size:12px;color:var(--g6);font-weight:600">합계 <span id="rt_bsum_${m}">0</span> EA</span>
          </div>
        </div>
        <button class="btn bp bblk" onclick="rtStart('${m}')">① 가동 시작</button>
      </div>`;
    }

    const ccpStd=RT_CCP[cur.ccp]||RT_CCP['2B'];
    const tRow=(lbl,key)=>`<tr><td style="color:var(--g5);padding:3px 0;font-size:12.5px">${lbl}</td>
      <td style="text-align:right;font-size:12.5px">${cur[key]
        ? `${cur[key]} <span style="cursor:pointer;color:var(--g4)" onclick="rtEditTime('${cur.fbId}','${key}')">✎</span>`
        : '<span style="color:var(--g3)">—</span>'}</td></tr>`;
    let action='';
    if(!cur.t2) action=`<button class="btn bp bblk" onclick="rtMark('${cur.fbId}','t2')">② 온도 도달 (${ccpStd.defTemp||ccpStd.temp}℃)</button>`;
    else if(!cur.t3) action=`<div style="display:flex;gap:6px;align-items:center">
        <button class="btn bp" style="flex:1" onclick="rtMark('${cur.fbId}','t3')">③ 가열 종료</button>
        <input type="number" id="rt_temp_${cur.fbId}" class="fc" value="${cur.temp||ccpStd.defTemp||ccpStd.temp}" style="width:64px;text-align:center">
        <span style="font-size:12px;color:var(--g5)">℃</span></div>`;
    else action=`<button class="btn bp bblk" onclick="rtMark('${cur.fbId}','t4')">④ 배출 완료</button>`;

    const ccpMin=_rtMin(cur.t2,cur.t3);
    const judge=cur.t3 ? _rtJudge(cur.ccp, ccpMin, cur.temp) : null;
    const judgeHtml = judge==null ? '' :
      judge==='적합'
        ? `<div style="font-size:12px;color:#047857;background:#ecfdf5;padding:5px 9px;border-radius:6px;margin-top:8px">CCP ${ccpMin}분 · ${cur.temp}℃ — 적합</div>`
        : `<div style="font-size:12px;color:#b91c1c;background:#fef2f2;padding:5px 9px;border-radius:6px;margin-top:8px">CCP ${ccpMin}분 · ${cur.temp}℃ — 부적합 (기준 ${ccpStd.temp}℃·${ccpStd.min}분↑) — HACCP팀장 보고</div>`;

    return `<div class="card" style="margin:0;border-color:var(--p)">
      ${head}
      <div style="font-size:13px;font-weight:600;margin-bottom:2px">${cur.product||''}${cur.ea?` <span style="font-weight:400;color:var(--g5);font-size:12px">· ${Number(cur.ea).toLocaleString()}EA</span>`:''}</div>
      <div style="font-size:11px;color:var(--g5);margin-bottom:6px">${ccpStd.label}${cur.batch?` · 배치 ${cur.batch}`:''}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        ${tRow('① 가동 시작','t1')}${tRow('② 온도 도달','t2')}${tRow('③ 가열 종료','t3')}${tRow('④ 배출 완료','t4')}
      </table>
      ${action}${judgeHtml}
    </div>`;
  }).join('');

  // ── 회차 목록 (선택 날짜 기준, 시작시각 순)
  const rows=_rtViewRecs().slice().sort((a,b)=>String(a.t1||'').localeCompare(String(b.t1||'')));
  if(!rows.length){ listEl.innerHTML='<div style="color:var(--g4);font-size:13px;padding:14px;text-align:center">'+(viewDate===tod()?'오늘':viewDate)+' 회차 기록 없음</div>'; return; }
  listEl.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:12.5px">
    <tr style="background:var(--g1);color:var(--g5)">
      <td style="padding:7px 10px">호기·회차</td><td style="padding:7px 6px">제품</td><td style="padding:7px 6px">수량</td><td style="padding:7px 6px">구분</td>
      <td style="padding:7px 6px">① 시작</td><td style="padding:7px 6px">CCP ②~③</td><td style="padding:7px 6px">④ 배출</td>
      <td style="padding:7px 6px">온도</td><td style="padding:7px 6px">판정</td><td style="padding:7px 6px;text-align:right"></td>
    </tr>
    ${rows.map(r=>{
      const min=_rtMin(r.t2,r.t3);
      const judge=_rtJudge(r.ccp,min,r.temp);
      const bad=judge==='부적합';
      const ed=k=>`title="클릭하여 수정" style="cursor:pointer" onclick="rtEditTime('${r.fbId}','${k}')"`;
      const tCell=k=> r[k] ? `<span ${ed(k)}>${r[k]}</span>` : `<span ${ed(k)} style="cursor:pointer;color:var(--g3)">—</span>`;
      return `<tr style="border-top:1px solid var(--g2)">
        <td style="padding:7px 10px">${r.machine}호기 ${r.round||'?'}회차</td>
        <td style="padding:7px 6px;cursor:pointer" title="클릭하여 수정" onclick="rtEditProd('${r.fbId}')">${r.product||''}</td>
        <td style="padding:7px 6px;cursor:pointer" title="클릭하여 수정" onclick="rtEditEa('${r.fbId}')">${r.ea?Number(r.ea).toLocaleString():'—'}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:var(--g5);cursor:pointer" title="클릭하여 수정" onclick="rtEditCcp('${r.fbId}')">${(_rtIs3B(r.ccp)?'3B':(r.ccp||''))+(r.batch?' · '+r.batch:'')}</td>
        <td style="padding:7px 6px">${tCell('t1')}</td>
        <td style="padding:7px 6px">${tCell('t2')}→${tCell('t3')}${min!=null?` · <span style="${bad?'color:#b91c1c;font-weight:600':''}">${min}분</span>`:''}</td>
        <td style="padding:7px 6px">${tCell('t4')}</td>
        <td style="padding:7px 6px;cursor:pointer" title="클릭하여 수정" onclick="rtEditTemp('${r.fbId}')">${r.temp?r.temp+'℃':'—'}</td>
        <td style="padding:7px 6px;${bad?'color:#b91c1c;font-weight:600':judge?'color:#047857':''}">${judge||'진행중'}</td>
        <td style="padding:7px 6px;text-align:right;white-space:nowrap">
          <span style="cursor:pointer;color:var(--g4)" title="삭제" onclick="rtDelete('${r.fbId}')">✕</span>
        </td>
      </tr>`;
    }).join('')}
  </table>`;
}

const RT_ABC='ABCDEFGHIJ';
function rtAddBatchRow(m, letter){
  const rows=document.getElementById('rt_brows_'+m);
  if(!rows) return;
  const idx=rows.children.length;
  if(idx>=RT_ABC.length) return;
  const lt=letter||RT_ABC[idx];
  const div=document.createElement('div');
  div.style.cssText='display:flex;gap:6px;align-items:center;margin-bottom:4px';
  div.innerHTML=`<select class="fc rt-bl" style="width:64px">${RT_ABC.split('').map(c=>`<option ${c===lt?'selected':''}>${c}</option>`).join('')}</select>
    <input type="number" class="fc rt-bn" placeholder="수량" style="flex:1" oninput="rtBatchSum('${m}')">
    <span style="cursor:pointer;color:var(--g4);padding:0 4px" onclick="this.parentElement.remove();rtBatchSum('${m}')">✕</span>`;
  rows.appendChild(div);
  const inp=div.querySelector('.rt-bn'); if(inp) inp.focus();
}
function rtBatchSum(m){
  const rows=document.getElementById('rt_brows_'+m);
  const eaEl=document.getElementById('rt_ea_'+m);
  const sumEl=document.getElementById('rt_bsum_'+m);
  if(!rows) return;
  let sum=0;
  rows.querySelectorAll('.rt-bn').forEach(i=>{ sum+=parseInt(i.value)||0; });
  if(sumEl) sumEl.textContent=sum.toLocaleString();
  if(eaEl) eaEl.value=sum||'';
}
function rtProdChanged(m){
  const prod=document.getElementById('rt_prod_'+m).value;
  const box=document.getElementById('rt_batchbox_'+m);
  const eaEl=document.getElementById('rt_ea_'+m);
  if(!box) return;
  box.style.display = prod ? '' : 'none';
  if(eaEl) eaEl.style.display = prod ? 'none' : '';
  if(prod){
    const rows=document.getElementById('rt_brows_'+m);
    if(rows && !rows.children.length) rtAddBatchRow(m,'A');
  }
}

async function rtStart(m){
  const prod=document.getElementById('rt_prod_'+m).value;
  if(!prod){ toast('제품을 선택하세요','d'); return; }
  const ccp=_rtDefaultCcp(prod);
  let batch='', ea=0;
  {
    const rows=document.getElementById('rt_brows_'+m);
    const parts=[];
    if(rows) rows.querySelectorAll('div').forEach(div=>{
      const lt=div.querySelector('.rt-bl'), n=div.querySelector('.rt-bn');
      if(!lt) return;
      const cnt=parseInt(n&&n.value)||0;
      parts.push(cnt>0 ? `${lt.value}:${cnt}` : lt.value);
      ea+=cnt;
    });
    batch=parts.join(', ');
    if(!ea){ const eaEl=document.getElementById('rt_ea_'+m); ea=eaEl?(parseInt(eaEl.value)||0):0; }
  }
  const mine=_rtToday().filter(r=>String(r.machine)===m);
  if(mine.some(r=>!r.t4)){ toast(m+'호기는 진행 중 회차가 있습니다','d'); return; }
  const round=(mine.length?Math.max(...mine.map(r=>r.round||0)):0)+1;
  const rec={ id:gid(), date:tod(), machine:m, round, product:prod, ccp, batch, ea,
              t1:nowHM(), t2:'', t3:'', t4:'', temp:null };
  toast('저장중...','i');
  const fbId=await fbSave('retort', rec);
  if(fbId){ rec.fbId=fbId; if(!L.retort) L.retort=[]; L.retort.push(rec); renderRetort();
            toast(`${m}호기 ${round}회차 가동 시작 ✓`); }
  else toast('저장 실패 — 네트워크 확인','d');
}

async function rtMark(fbId, step){
  const rec=(L.retort||[]).find(r=>r.fbId===fbId);
  if(!rec){ toast('기록을 찾을 수 없습니다','d'); return; }
  const patch={ [step]: nowHM() };
  if(step==='t3'){
    const tEl=document.getElementById('rt_temp_'+fbId);
    const temp=parseFloat(tEl&&tEl.value);
    if(!(temp>0)){ toast('멸균 온도를 입력하세요','d'); return; }
    patch.temp=temp;
  }
  const ok=await fbUpdate('retort', fbId, patch);
  if(ok===false){ toast('저장 실패','d'); return; }
  Object.assign(rec, patch);
  // ③ 시점 자동 판정 — 미달이면 즉시 경고
  if(step==='t3'){
    const min=_rtMin(rec.t2,rec.t3);
    const judge=_rtJudge(rec.ccp,min,rec.temp);
    if(judge==='부적합'){
      const std=RT_CCP[rec.ccp];
      alert(`⚠ CCP 기준 미달\n\n구간 ${min}분 · ${rec.temp}℃\n기준: ${std.temp}℃ 이상 · ${std.min}분 이상\n\nHACCP팀장 보고 및 재가열 검토가 필요합니다.`);
    }
  }
  renderRetort();
}

async function rtEditTime(fbId, key){
  const rec=(L.retort||[]).find(r=>r.fbId===fbId);
  if(!rec) return;
  const lbl={t1:'① 가동 시작',t2:'② 온도 도달',t3:'③ 가열 종료',t4:'④ 배출 완료'}[key];
  let v=prompt(lbl+' 시각 (HH:MM)', rec[key]||'');
  if(v==null) return;
  v=v.trim();
  if(/^\d{3,4}$/.test(v)) v=v.padStart(4,'0').replace(/(\d\d)(\d\d)/,'$1:$2'); // 1030→10:30
  if(!/^\d{1,2}:\d{2}$/.test(v)){ toast('HH:MM 형식으로 입력하세요','d'); return; }
  v=v.padStart(5,'0');
  const ok=await fbUpdate('retort', fbId, {[key]:v});
  if(ok===false){ toast('저장 실패','d'); return; }
  rec[key]=v; renderRetort();
}

async function rtDelete(fbId){
  const rec=(L.retort||[]).find(r=>r.fbId===fbId);
  if(!rec) return;
  if(!confirm(`${rec.machine}호기 ${rec.round}회차 (${rec.product}) 기록을 삭제할까요?`)) return;
  const ok=await fbDelete('retort', fbId);
  if(ok===false){ toast('삭제 실패','d'); return; }
  L.retort=(L.retort||[]).filter(r=>r.fbId!==fbId);
  renderRetort();
  toast('삭제됨 ✓');
}

/* ── 회차 필드 수정 (온도/구분/제품) ───────────────────────── */
async function rtEditTemp(fbId){
  const rec=(L.retort||[]).find(r=>r.fbId===fbId); if(!rec) return;
  const v=prompt('멸균(살균) 온도 ℃', rec.temp||'');
  if(v==null) return;
  const t=parseFloat(v);
  if(!(t>0)){ toast('숫자를 입력하세요','d'); return; }
  if(await fbUpdate('retort',fbId,{temp:t})===false){ toast('저장 실패','d'); return; }
  rec.temp=t; renderRetort();
}
async function rtEditCcp(fbId){
  const rec=(L.retort||[]).find(r=>r.fbId===fbId); if(!rec) return;
  const v=prompt('자숙 배치 (예: A 또는 A:50, B:46)', rec.batch||'');
  if(v==null) return;
  const b=v.trim().toUpperCase();
  const patch={batch:b};
  const sum=_rtBatchSum(b);
  if(sum!=null) patch.ea=sum;
  if(await fbUpdate('retort',fbId,patch)===false){ toast('저장 실패','d'); return; }
  Object.assign(rec,patch); renderRetort();
}
async function rtEditEa(fbId){
  const rec=(L.retort||[]).find(r=>r.fbId===fbId); if(!rec) return;
  const v=prompt('수량 (EA)', rec.ea||'');
  if(v==null) return;
  const ea=parseInt(v)||0;
  if(await fbUpdate('retort',fbId,{ea})===false){ toast('저장 실패','d'); return; }
  rec.ea=ea; renderRetort();
}
async function rtEditProd(fbId){
  const rec=(L.retort||[]).find(r=>r.fbId===fbId); if(!rec) return;
  const v=prompt('제품명', rec.product||'');
  if(v==null || !v.trim()) return;
  if(await fbUpdate('retort',fbId,{product:v.trim()})===false){ toast('저장 실패','d'); return; }
  rec.product=v.trim(); renderRetort();
}

/* ── CCP 점검표 — 인쇄(PDF) ───────────────────────────────── */
// CCP 점검표 인쇄용 HTML 생성 (A4 세로, 원본 양식 재현)
function _rtCcpHtml(is3B, rows, dateStr){
  const [yy,mm,dd]=dateStr.split('-');
  const dateTxt=`${yy} 년 &nbsp; ${parseInt(mm)} 월 &nbsp; ${parseInt(dd)} 일`;
  const judgeCell=(judge)=>{
    const a=judge==='적합'?'<span class="cir">적</span>':'적';
    const b=judge==='부적합'?'<span class="cir">부</span>':'부';
    return `${a} <span class="bar">│</span> ${b}`;
  };
  const condCell=(min,temp)=>{
    const cond=(temp>=121&&min>=18&&!(temp>=95&&min>=30))?'B':'A';
    const a=cond==='A'?'<span class="cir">A</span>':'A';
    const b=cond==='B'?'<span class="cir">B</span>':'B';
    return `${a} <span class="bar">/</span> ${b}`;
  };
  let bodyRows='';
  const TOTAL=Math.max(11, rows.length);
  for(let i=0;i<TOTAL;i++){
    const r=rows[i];
    if(r){
      const min=_rtMin(r.t2,r.t3), judge=_rtJudge(r.ccp,min,r.temp);
      if(is3B){
        bodyRows+=`<tr><td>${r.machine}</td><td>${condCell(min,r.temp)}</td><td class="pname">${r.product||''}</td><td>${r.t2||''}</td><td>${r.t3||''}</td><td>${min}분</td><td>${r.temp}℃</td><td>${judgeCell(judge)}</td><td></td></tr>`;
      } else {
        bodyRows+=`<tr><td>${r.machine}</td><td class="pname" colspan="2">${r.product||''}</td><td>${r.t2||''}</td><td>${r.t3||''}</td><td>${min}분</td><td>${r.temp}℃</td><td>${judgeCell(judge)}</td><td></td></tr>`;
      }
    } else {
      bodyRows+= is3B
        ? `<tr><td></td><td>A <span class="bar">/</span> B</td><td></td><td></td><td></td><td>분</td><td>℃</td><td>적 <span class="bar">│</span> 부</td><td></td></tr>`
        : `<tr><td></td><td colspan="2"></td><td></td><td></td><td>분</td><td>℃</td><td>적 <span class="bar">│</span> 부</td><td></td></tr>`;
    }
  }
  const limitRows = is3B
    ? `<tr><td class="lab" rowspan="2">한계기준</td><td>구분</td><td colspan="2">살균온도</td><td colspan="2">살균시간</td><td colspan="3">비고</td></tr>
       <tr><td>A / B</td><td colspan="2">A: 95℃이상 / B: 121℃</td><td colspan="2">A: 30분↑ / B: 18분↑</td><td colspan="3"></td></tr>`
    : `<tr><td class="lab">한계기준</td><td>멸균 온도</td><td colspan="3">121℃</td><td>멸균시간</td><td colspan="3">18분 이상</td></tr>`;
  const head = is3B
    ? `<tr><th>호기</th><th>구분</th><th>제품명</th><th>시작</th><th>종료</th><th>살균시간</th><th>살균온도</th><th>판정</th><th>서명</th></tr>`
    : `<tr><th>멸균기<br>No.</th><th colspan="2">제품명</th><th>시작</th><th>종료</th><th>멸균시간</th><th>멸균온도</th><th>판정</th><th>서명</th></tr>`;
  const title=is3B?'CCP-3B(살균공정) 점검표':'CCP-2B(멸균공정) 점검표';
  const docNo=is3B?'PBⅡ-HI-04-02':'PBⅡ-HI-04-01';
  const method=`${is3B?'살균':'멸균'}온도 : 설비의 판넬 온도계를 이용하여 온도를 확인한 후 기록한다.<br>${is3B?'살균':'멸균'}시간 : 온도가 기준 이상 확인된 시점부터 공정이 종료되는데 걸리는 시간을 설비 자체 판넬 타이머를 확인하여 측정하고 기록한다.`;
  return `<div class="sheet">
    <table class="hdr"><tr>
      <td class="logo" rowspan="2">BON</td>
      <td class="ttl" rowspan="2">${title}</td>
      <td class="gj">결재</td><td>작성</td><td>검토</td><td>승인</td>
    </tr><tr><td></td><td></td><td></td><td></td></tr>
    <tr><td class="docno" colspan="6">${docNo}</td></tr></table>
    <table class="meta">
      <tr><td class="lab">점검일자</td><td class="date">${dateTxt}</td><td class="lab">점검자</td><td></td></tr>
    </table>
    <table class="lim">${limitRows}</table>
    <table class="lim">
      <tr><td class="lab">주　기</td><td class="lt">매 작업시 마다</td></tr>
      <tr><td class="lab">방　법</td><td class="lt">${method}</td></tr>
    </table>
    <table class="care">
      <tr><td class="lab" rowspan="3">개선조치방법</td><td class="sub">한계기준<br>이탈 시 (초과)</td><td class="lt">공정을 중단하고 HACCP팀장에게 보고한다. 제품을 육안으로 확인하여 제품검사기준에 따라 폐기 또는 정상제품으로 처리. 이탈사항 및 개선조치사항을 모니터링 일지에 기록한다.</td></tr>
      <tr><td class="sub">한계기준<br>이탈 시 (미달)</td><td class="lt">공정을 중단하고 HACCP팀장에게 보고한다. 설비의 온도 및 시간을 조절하여 재가열한 후 제품을 육안으로 확인하여 제품검사기준에 따라 폐기 또는 정상제품으로 처리. 이탈사항 및 개선조치사항을 모니터링 일지에 기록한다.</td></tr>
      <tr><td class="sub">시설·설비<br>고장 시</td><td class="lt">기기 고장 시 HACCP팀장에게 보고 후 단시간에 수리가 가능한 경우 공정품을 보관하였다가 기기가 정상작동하면 재가열한다. 단시간에 수리가 불가능한 경우 공정품을 폐기한다. 이탈사항 및 개선조치사항을 모니터링 일지에 기록한다.</td></tr>
    </table>
    <table class="rec"><thead>${head}</thead><tbody>${bodyRows}</tbody></table>
    <table class="foot">
      <tr><td class="lab">이탈내용</td><td class="lab">개선조치 및 결과</td><td class="lab">조치자</td><td class="lab">확인</td></tr>
      <tr><td class="bk"></td><td class="bk"></td><td class="bk"></td><td class="bk"></td></tr>
    </table>
  </div>`;
}

const _RT_CCP_CSS = `*{margin:0;padding:0;box-sizing:border-box;font-family:'Malgun Gothic','맑은 고딕',sans-serif}
body{background:#fff}
.sheet{width:190mm;margin:0 auto;padding:4mm;page-break-after:always}
table{width:100%;border-collapse:collapse;table-layout:fixed}
td,th{border:0.6px solid #333;padding:2px 4px;font-size:9px;text-align:center;vertical-align:middle;word-break:keep-all}
.hdr td{height:14px}
.hdr .logo{width:18%;color:#2c7a4b;font-weight:bold;font-size:18px;border:none}
.hdr .ttl{font-size:16px;font-weight:bold}
.hdr .gj{width:6%;background:#f0f0f0}
.hdr .docno{text-align:left;font-size:8px;border:none;padding-top:1px}
.meta .lab,.lim .lab,.care .lab,.foot .lab{background:#eaeaea;font-weight:bold;width:14%}
.meta .date{font-weight:bold;font-size:11px}
.lim .lt,.care .lt{text-align:left;line-height:1.5}
.care .sub{background:#f5f5f5;width:14%;font-size:8.5px}
.rec th{background:#eaeaea;font-weight:bold;height:18px}
.rec td{height:20px}
.rec .pname{font-weight:bold;text-align:left;padding-left:6px;overflow:hidden;white-space:nowrap}
.foot .lab{height:16px}
.foot .bk{height:30px}
.cir{display:inline-block;border:1.5px solid #c00;border-radius:50%;width:15px;height:15px;line-height:12px;color:#c00;font-weight:bold}
.bar{color:#999}
@page{size:A4 portrait;margin:6mm}
`;
async function rtDownloadCcp(){
  try{
    const dEl=document.getElementById('rt_ccp_date');
    const dateStr=(dEl&&dEl.value)||tod();
    toast('점검표 준비중...','i');
    const recs=(await fbGetByDate('retort', dateStr)).filter(r=>r.t2&&r.t3)
      .sort((a,b)=>String(a.t2||'').localeCompare(String(b.t2||'')));
    const r2b=recs.filter(r=>!_rtIs3B(r.ccp));
    const r3b=recs.filter(r=>_rtIs3B(r.ccp));
    if(!r2b.length && !r3b.length){ toast('해당 날짜에 완료된 회차가 없습니다','d'); return; }
    let body='';
    if(r2b.length) body+=_rtCcpHtml(false, r2b, dateStr);
    if(r3b.length) body+=_rtCcpHtml(true,  r3b, dateStr);
    const w=window.open('', '_blank');
    if(!w){ alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>CCP 점검표 '+dateStr+'</title><style>'+_RT_CCP_CSS+'</style></head><body>'+body+'</body></html>');
    w.document.close();
    w.focus();
    setTimeout(()=>{ w.print(); }, 350);
  }catch(e){
    console.error('[CCP 점검표]',e);
    alert('점검표 생성 실패: '+e.message);
  }
}
