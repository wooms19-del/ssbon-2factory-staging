/* ── 레토르트 (멸균·살균) 입력 ─────────────────────────────────
   회차 단위 기록: ①가동시작(t1) ②온도도달(t2) ③가열종료(t3, 온도) ④배출완료(t4)
   CCP 구간 = t2~t3. 구분(ccp): '2B'(121℃/18분) | '3B-A'(95℃/30분) | '3B-B'(121℃/18분)
   판정 자동. Firestore 'retort' 컬렉션, localStorage 작업데이터 저장 없음.       */

const RT_MACHINES = ['1','2','3'];
const RT_CCP = {
  '2B':   {label:'CCP-2B (멸균 121℃·18분↑)',  temp:121, min:18},
  '3B-A': {label:'CCP-3B A형 (95℃·30분↑)',    temp:95,  min:30},
  '3B-B': {label:'CCP-3B B형 (121℃·18분↑)',   temp:121, min:18},
};

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
function _rtDefaultCcp(product){ return /3\s*KG/i.test(product||'') ? '3B-A' : '2B'; }

// 당일 내포장 제품 후보 (+전체 제품 fallback)
function _rtProductOptions(sel){
  const todayPk=[...new Set((L.packing||[]).filter(r=>String(r.date||'').slice(0,10)===tod()).map(r=>r.product).filter(Boolean))];
  const all=(L.products||[]).map(p=>p.name);
  const list=[...new Set([...todayPk, ...all])];
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
          <option value="">제품 선택</option>${_rtProductOptions('')}
        </select>
        <select id="rt_ccp_${m}" class="fc" style="width:100%;margin-bottom:8px">
          ${Object.keys(RT_CCP).map(k=>`<option value="${k}">${RT_CCP[k].label}</option>`).join('')}
        </select>
        <button class="btn bp bblk" onclick="rtStart('${m}')">① 가동 시작</button>
      </div>`;
    }

    const ccpStd=RT_CCP[cur.ccp]||RT_CCP['2B'];
    const tRow=(lbl,key)=>`<tr><td style="color:var(--g5);padding:3px 0;font-size:12.5px">${lbl}</td>
      <td style="text-align:right;font-size:12.5px">${cur[key]
        ? `${cur[key]} <span style="cursor:pointer;color:var(--g4)" onclick="rtEditTime('${cur.fbId}','${key}')">✎</span>`
        : '<span style="color:var(--g3)">—</span>'}</td></tr>`;
    let action='';
    if(!cur.t2) action=`<button class="btn bp bblk" onclick="rtMark('${cur.fbId}','t2')">② 온도 도달 (${ccpStd.temp}℃)</button>`;
    else if(!cur.t3) action=`<div style="display:flex;gap:6px;align-items:center">
        <button class="btn bp" style="flex:1" onclick="rtMark('${cur.fbId}','t3')">③ 가열 종료</button>
        <input type="number" id="rt_temp_${cur.fbId}" class="fc" value="${cur.temp||ccpStd.temp}" style="width:64px;text-align:center">
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
      <div style="font-size:13px;font-weight:600;margin-bottom:2px">${cur.product||''}</div>
      <div style="font-size:11px;color:var(--g5);margin-bottom:6px">${ccpStd.label}</div>
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
      <td style="padding:7px 10px">호기·회차</td><td style="padding:7px 6px">제품</td><td style="padding:7px 6px">구분</td>
      <td style="padding:7px 6px">① 시작</td><td style="padding:7px 6px">CCP ②~③</td><td style="padding:7px 6px">④ 배출</td>
      <td style="padding:7px 6px">온도</td><td style="padding:7px 6px">판정</td><td style="padding:7px 6px;text-align:right"></td>
    </tr>
    ${rows.map(r=>{
      const min=_rtMin(r.t2,r.t3);
      const judge=_rtJudge(r.ccp,min,r.temp);
      const bad=judge==='부적합';
      return `<tr style="border-top:1px solid var(--g2)">
        <td style="padding:7px 10px">${r.machine}호기 ${r.round||'?'}회차</td>
        <td style="padding:7px 6px">${r.product||''}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:var(--g5)">${r.ccp||''}</td>
        <td style="padding:7px 6px">${r.t1||'—'}</td>
        <td style="padding:7px 6px">${r.t2&&r.t3?`${r.t2}→${r.t3} · <span style="${bad?'color:#b91c1c;font-weight:600':''}">${min}분</span>`:'—'}</td>
        <td style="padding:7px 6px">${r.t4||'—'}</td>
        <td style="padding:7px 6px">${r.temp?r.temp+'℃':'—'}</td>
        <td style="padding:7px 6px;${bad?'color:#b91c1c;font-weight:600':judge?'color:#047857':''}">${judge||'진행중'}</td>
        <td style="padding:7px 6px;text-align:right;white-space:nowrap">
          <span style="cursor:pointer;color:var(--g4)" title="삭제" onclick="rtDelete('${r.fbId}')">✕</span>
        </td>
      </tr>`;
    }).join('')}
  </table>`;
}

function rtProdChanged(m){
  const prod=document.getElementById('rt_prod_'+m).value;
  const ccpSel=document.getElementById('rt_ccp_'+m);
  if(ccpSel && prod) ccpSel.value=_rtDefaultCcp(prod);
}

async function rtStart(m){
  const prod=document.getElementById('rt_prod_'+m).value;
  if(!prod){ toast('제품을 선택하세요','d'); return; }
  const ccp=document.getElementById('rt_ccp_'+m).value;
  const mine=_rtToday().filter(r=>String(r.machine)===m);
  if(mine.some(r=>!r.t4)){ toast(m+'호기는 진행 중 회차가 있습니다','d'); return; }
  const round=(mine.length?Math.max(...mine.map(r=>r.round||0)):0)+1;
  const rec={ id:gid(), date:tod(), machine:m, round, product:prod, ccp,
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
