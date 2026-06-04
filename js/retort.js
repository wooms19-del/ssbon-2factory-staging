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
function _rtMin(a,b){ // 'HH:MM' 차이(분), 자정 넘김 보정
  if(!a||!b) return null;
  const [h1,m1]=a.split(':').map(Number), [h2,m2]=b.split(':').map(Number);
  let d=(h2*60+m2)-(h1*60+m1); if(d<0) d+=1440; return d;
}
function _rtJudge(ccp, min, temp){
  const std=RT_CCP[ccp]; if(!std||min==null||!(temp>0)) return null;
  return (temp>=std.temp && min>=std.min) ? '적합' : '부적합';
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
  const recs=_rtToday();

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

  // ── 오늘 회차 목록 (완료된 것 + 진행중 포함 전체, 시작시각 순)
  const rows=recs.slice().sort((a,b)=>String(a.t1||'').localeCompare(String(b.t1||'')));
  if(!rows.length){ listEl.innerHTML='<div style="color:var(--g4);font-size:13px;padding:14px;text-align:center">오늘 회차 기록 없음</div>'; return; }
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

/* ── CCP 점검표 엑셀 (CCP-2B / CCP-3B 시트 2장, A4 세로 한 장) ── */
async function rtDownloadCcp(){
  try{
    const dEl=document.getElementById('rt_ccp_date');
    const dateStr=(dEl&&dEl.value)||tod();
    toast('점검표 생성중...','i');
    const recs=(await fbGetByDate('retort', dateStr)).filter(r=>r.t2&&r.t3)
      .sort((a,b)=>String(a.t2||'').localeCompare(String(b.t2||'')));
    const r2b=recs.filter(r=>r.ccp==='2B');
    const r3b=recs.filter(r=>_rtIs3B(r.ccp));

    const B={top:{style:'thin',color:{rgb:'444444'}},bottom:{style:'thin',color:{rgb:'444444'}},
             left:{style:'thin',color:{rgb:'444444'}},right:{style:'thin',color:{rgb:'444444'}}};
    const sBase={font:{sz:9},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:B};
    const sHdr=Object.assign({},sBase,{font:{sz:9,bold:true},fill:{fgColor:{rgb:'E8E8E8'}}});
    const sLeft=Object.assign({},sBase,{alignment:{horizontal:'left',vertical:'center',wrapText:true}});
    const C=(v,s)=>({t:'s',v:String(v==null?'':v),s:s||sBase});
    const [yy,mm,dd]=dateStr.split('-');

    function buildSheet(is3B, rows){
      const ws={}; const merges=[]; const rowH=[];
      const COLN = 9;
      const cols='ABCDEFGHI';
      const M=(r1,c1,r2,c2)=>merges.push({s:{r:r1-1,c:c1-1},e:{r:r2-1,c:c2-1}});
      const set=(r,c,cell)=>{ ws[cols[c-1]+r]=cell; };
      const fillRow=(r,s)=>{ for(let c=1;c<=COLN;c++) if(!ws[cols[c-1]+r]) set(r,c,C('',s||sBase)); };
      let r=1;
      // 제목/결재란
      set(r,1,C('BON',Object.assign({},sBase,{font:{sz:12,bold:true,color:{rgb:'2C7A4B'}}})));
      M(r,1,r+1,2);
      set(r,3,C(is3B?'CCP-3B(살균공정) 점검표':'CCP-2B(멸균공정) 점검표',Object.assign({},sBase,{font:{sz:15,bold:true}})));
      M(r,3,r+1,6);
      set(r,7,C('결재',sHdr)); M(r,7,r+1,7);
      set(r,8,C('작성',sHdr)); set(r,9,C('검토 / 승인',sHdr));
      set(r+1,8,C('')); set(r+1,9,C(''));
      fillRow(r); fillRow(r+1); rowH[r-1]={hpt:20}; rowH[r]={hpt:26}; r+=2;
      // 문서번호
      set(r,1,C(is3B?'PBⅡ-HI-04-02':'PBⅡ-HI-04-01',Object.assign({},sLeft,{font:{sz:8}}))); M(r,1,r,9); fillRow(r); rowH[r-1]={hpt:13}; r++;
      // 점검일자/점검자
      set(r,1,C('점검일자',sHdr)); M(r,1,r,2);
      set(r,3,C(`${yy}년 ${parseInt(mm)}월 ${parseInt(dd)}일`,sBase)); M(r,3,r,6);
      set(r,7,C('점검자',sHdr));
      set(r,8,C('')); M(r,8,r,9);
      fillRow(r); rowH[r-1]={hpt:20}; r++;
      // 한계기준
      if(is3B){
        set(r,1,C('한계기준',sHdr)); M(r,1,r+1,2);
        set(r,3,C('구분',sHdr)); set(r,4,C('살균온도',sHdr)); M(r,4,r,5); set(r,6,C('살균시간',sHdr)); M(r,6,r,7);
        set(r,8,C('비고',sHdr)); M(r,8,r,9); fillRow(r);
        rowH[r-1]={hpt:16}; r++;
        set(r,3,C('A: 95℃ 이상 · 30분 이상    /    B: 121℃ · 18분 이상',sBase)); M(r,3,r,9); fillRow(r);
        rowH[r-1]={hpt:16}; r++;
      } else {
        set(r,1,C('한계기준',sHdr)); M(r,1,r,2);
        set(r,3,C('멸균 온도',sHdr)); set(r,4,C('121℃',sBase)); M(r,4,r,5);
        set(r,6,C('멸균시간',sHdr)); M(r,6,r,7);
        set(r,8,C('18분 이상',sBase)); M(r,8,r,9);
        fillRow(r); rowH[r-1]={hpt:18}; r++;
      }
      // 주기
      set(r,1,C('주기',sHdr)); M(r,1,r,2);
      set(r,3,C('매 작업시 마다',sLeft)); M(r,3,r,9); fillRow(r); rowH[r-1]={hpt:16}; r++;
      // 방법
      set(r,1,C('방법',sHdr)); M(r,1,r,2);
      set(r,3,C((is3B?'살균':'멸균')+'온도: 설비의 판넬 온도계를 이용하여 온도를 확인한 후 기록한다\n'+(is3B?'살균':'멸균')+'시간: 온도가 기준 이상 확인된 시점부터 공정이 종료되는데 걸리는 시간을 설비 자체 판넬 타이머를 확인하여 측정하고 기록한다',sLeft)); M(r,3,r,9); fillRow(r); rowH[r-1]={hpt:34}; r++;
      // 개선조치방법
      const careTop=r;
      set(r,1,C('개선조치방법',sHdr)); M(r,1,r+2,1);
      set(r,2,C('한계기준 이탈 시 (초과)',sHdr));
      set(r,3,C('공정을 중단하고 HACCP팀장에게 보고한다. 제품을 육안으로 확인하여 제품검사기준에 따라 폐기 또는 정상제품으로 처리. 이탈사항 및 개선조치사항을 모니터링 일지에 기록한다.',sLeft)); M(r,3,r,9); fillRow(r); rowH[r-1]={hpt:40}; r++;
      set(r,2,C('한계기준 이탈 시 (미달)',sHdr));
      set(r,3,C('공정을 중단하고 HACCP팀장에게 보고한다. 설비의 온도 및 시간을 조절하여 재가열한 후 제품을 육안으로 확인하여 제품검사기준에 따라 폐기 또는 정상제품으로 처리. 이탈사항 및 개선조치사항을 모니터링 일지에 기록한다.',sLeft)); M(r,3,r,9); fillRow(r); rowH[r-1]={hpt:40}; r++;
      set(r,2,C('시설·설비 고장 시',sHdr));
      set(r,3,C('기기 고장 시 HACCP팀장에게 보고 후 단시간에 수리가 가능한 경우 공정품을 보관하였다가 기기가 정상작동하면 재가열한다. 단시간에 수리가 불가능한 경우 공정품을 폐기한다. 이탈사항 및 개선조치사항을 모니터링 일지에 기록한다.',sLeft)); M(r,3,r,9); fillRow(r); rowH[r-1]={hpt:44}; r++;
      // 기록 테이블 헤더
      if(is3B){
        set(r,1,C('호기',sHdr)); set(r,2,C('구분',sHdr)); set(r,3,C('제품명',sHdr));
        set(r,4,C('시작',sHdr)); set(r,5,C('종료',sHdr));
        set(r,6,C('살균시간',sHdr)); set(r,7,C('살균온도',sHdr)); set(r,8,C('판정',sHdr)); set(r,9,C('서명',sHdr));
      } else {
        set(r,1,C('멸균기 No.',sHdr)); set(r,2,C('제품명',sHdr)); M(r,2,r,3);
        set(r,4,C('시작',sHdr)); set(r,5,C('종료',sHdr));
        set(r,6,C('멸균시간',sHdr)); set(r,7,C('멸균온도',sHdr)); set(r,8,C('판정',sHdr)); set(r,9,C('서명',sHdr));
      }
      fillRow(r); rowH[r-1]={hpt:18}; r++;
      // 데이터 행 (최소 10행)
      const totalRows=Math.max(10, rows.length);
      for(let i=0;i<totalRows;i++){
        const rec=rows[i];
        if(rec){
          const min=_rtMin(rec.t2,rec.t3);
          const judge=_rtJudge(rec.ccp,min,rec.temp);
          const jTxt=judge==='적합'?'적':judge==='부적합'?'부':'';
          if(is3B){
            set(r,1,C(rec.machine,sBase)); set(r,2,C(rec.batch||'',sBase)); set(r,3,C(rec.product,sBase));
            set(r,4,C(rec.t2,sBase)); set(r,5,C(rec.t3,sBase));
            set(r,6,C(min+'분',sBase)); set(r,7,C(rec.temp+'℃',sBase)); set(r,8,C(jTxt,sBase)); set(r,9,C('',sBase));
          } else {
            set(r,1,C(rec.machine,sBase)); set(r,2,C(rec.product,sBase)); M(r,2,r,3);
            set(r,4,C(rec.t2,sBase)); set(r,5,C(rec.t3,sBase));
            set(r,6,C(min+'분',sBase)); set(r,7,C(rec.temp+'℃',sBase)); set(r,8,C(jTxt,sBase)); set(r,9,C('',sBase));
          }
        } else if(!is3B){ M(r,2,r,3); }
        fillRow(r); rowH[r-1]={hpt:20}; r++;
      }
      // 하단 이탈/개선조치
      set(r,1,C('이탈내용',sHdr)); M(r,1,r,3);
      set(r,4,C('개선조치 및 결과',sHdr)); M(r,4,r,7);
      set(r,8,C('조치자',sHdr)); set(r,9,C('확인',sHdr));
      fillRow(r); rowH[r-1]={hpt:16}; r++;
      M(r,1,r+1,3); M(r,4,r+1,7); M(r,8,r+1,8); M(r,9,r+1,9);
      fillRow(r); fillRow(r+1); rowH[r-1]={hpt:18}; rowH[r]={hpt:18}; r+=2;

      ws['!ref']='A1:I'+(r-1);
      ws['!merges']=merges;
      ws['!rows']=rowH;
      ws['!cols']=[{wch:9},{wch:13},{wch:16},{wch:8},{wch:8},{wch:9},{wch:9},{wch:7},{wch:9}];
      return ws;
    }

    const wb=XLSX.utils.book_new();
    wb.SheetNames.push('CCP-2B'); wb.Sheets['CCP-2B']=buildSheet(false, r2b);
    wb.SheetNames.push('CCP-3B'); wb.Sheets['CCP-3B']=buildSheet(true,  r3b);

    // A4 세로 한 장 (fflate XML 주입 — xlsx-js-style은 pageSetup 미출력)
    const arr=XLSX.write(wb,{type:'array',bookType:'xlsx',cellStyles:true});
    const z=fflate.unzipSync(new Uint8Array(arr));
    const dec=new TextDecoder(), enc=new TextEncoder();
    const ps='<pageMargins left="0.35" right="0.35" top="0.4" bottom="0.4" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/>';
    Object.keys(z).forEach(k=>{
      if(/^xl\/worksheets\/sheet\d+\.xml$/.test(k)){
        let xml=dec.decode(z[k]);
        if(xml.indexOf('<sheetPr')<0) xml=xml.replace(/(<worksheet[^>]*>)/,'$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
        xml = xml.indexOf('<ignoredErrors')>=0 ? xml.replace('<ignoredErrors', ps+'<ignoredErrors') : xml.replace('</worksheet>', ps+'</worksheet>');
        z[k]=enc.encode(xml);
      }
    });
    const blob=new Blob([fflate.zipSync(z)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`CCP점검표_${dateStr}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
    toast('CCP 점검표 다운로드 ✓','s');
  }catch(e){
    console.error('[CCP 점검표]',e);
    alert('점검표 생성 실패: '+e.message);
  }
}
