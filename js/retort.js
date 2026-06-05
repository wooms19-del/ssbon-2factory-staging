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

/* ── CCP 점검표 엑셀 — 실물 양식(원본 템플릿)에 데이터 주입 ── */
function _rtXset(xml,ref,val,newS){
  const re=new RegExp('<c r="'+ref+'"([^>]*?)(/>|>[\\s\\S]*?</c>)');
  if(!re.test(xml)) return xml;
  return xml.replace(re,(m0,attrs)=>{
    let st=(attrs.match(/s="\d+"/)||[''])[0];
    if(newS!=null) st='s="'+newS+'"';
    const esc=String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return '<c r="'+ref+'" '+st+' t="inlineStr"><is><t xml:space="preserve">'+esc+'</t></is></c>';
  });
}
// styles.xml에 base xf 복제 + shrinkToFit 추가, 새 인덱스 반환
function _rtAddShrink(z, dec, enc, baseIdx){
  let st=dec.decode(z['xl/styles.xml']);
  const xfs=st.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if(!xfs) return null;
  const cnt=parseInt(xfs[1]);
  const all=xfs[2].match(/<xf\b[\s\S]*?(?:\/>|<\/xf>)/g);
  if(!all||!all[baseIdx]) return null;
  let base=all[baseIdx], nx;
  if(/<alignment/.test(base)) nx=base.replace(/<alignment/,'<alignment shrinkToFit="1"');
  else if(base.endsWith('/>')) nx=base.replace('<xf','<xf applyAlignment="1"').replace(/\/>$/,'><alignment shrinkToFit="1"/></xf>');
  else nx=base.replace('</xf>','<alignment shrinkToFit="1"/></xf>');
  st=st.replace('<cellXfs count="'+cnt+'">','<cellXfs count="'+(cnt+1)+'">').replace('</cellXfs>',nx+'</cellXfs>');
  z['xl/styles.xml']=enc.encode(st);
  return cnt;
}
async function _rtFillTemplate(tplPath, outName, rows, is3B, dateTxt){
  const buf=await (await fetch(tplPath)).arrayBuffer();
  const z=fflate.unzipSync(new Uint8Array(buf));
  const dec=new TextDecoder(), enc=new TextEncoder();
  let xml=dec.decode(z['xl/worksheets/sheet1.xml']);
  const CIRC='\u20DD';  // 글자 뒤 결합 동그라미
  // 제품명 칸 자동축소 스타일 (긴 제품명 잘림 방지)
  const prodBase = is3B ? 27 : 57;
  const shrinkIdx = _rtAddShrink(z, dec, enc, prodBase);
  xml=_rtXset(xml,'E6',dateTxt);
  rows.forEach((r,i)=>{
    const R=24+i; if(R>34) return;
    const min=_rtMin(r.t2,r.t3);
    const judge=_rtJudge(r.ccp,min,r.temp);
    xml=_rtXset(xml,'A'+R,r.machine||'');
    if(is3B){
      // 구분 = 살균 조건 A/B (해당 조건에 동그라미). 배치는 시스템 데이터로만 보관
      const cond=_rt3bCond(min, r.temp);
      xml=_rtXset(xml,'B'+R, cond==='B' ? ('A / B'+CIRC) : ('A'+CIRC+' / B'));
      xml=_rtXset(xml,'D'+R,r.product||'', shrinkIdx);
    } else {
      xml=_rtXset(xml,'C'+R,r.product||'', shrinkIdx);
    }
    xml=_rtXset(xml,'G'+R,r.t2||''); xml=_rtXset(xml,'K'+R,r.t3||'');
    xml=_rtXset(xml,'O'+R,min!=null?min+'분':'');
    xml=_rtXset(xml,'Q'+R,r.temp?r.temp+'℃':'');
    // 판정: 원본 '적 │ 부' 유지 + 해당 글자에 동그라미
    let sv='적 │ 부';
    if(judge==='적합') sv='적'+CIRC+' │ 부';
    else if(judge==='부적합') sv='적 │ 부'+CIRC;
    xml=_rtXset(xml,'S'+R,sv);
  });
  z['xl/worksheets/sheet1.xml']=enc.encode(xml);
  const blob=new Blob([fflate.zipSync(z)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=outName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
}
async function rtDownloadCcp(){
  try{
    const dEl=document.getElementById('rt_ccp_date');
    const dateStr=(dEl&&dEl.value)||tod();
    toast('점검표 생성중...','i');
    const recs=(await fbGetByDate('retort', dateStr)).filter(r=>r.t2&&r.t3)
      .sort((a,b)=>String(a.t2||'').localeCompare(String(b.t2||'')));
    const r2b=recs.filter(r=>!_rtIs3B(r.ccp));
    const r3b=recs.filter(r=>_rtIs3B(r.ccp));
    if(!r2b.length && !r3b.length){ toast('해당 날짜에 완료된 회차가 없습니다','d'); return; }
    if(r2b.length>11||r3b.length>11) alert('회차가 11건을 넘어 양식 초과분은 점검표에서 제외됩니다.');
    const [yy,mm,dd]=dateStr.split('-');
    const dateTxt=yy+' 년   '+parseInt(mm)+' 월   '+parseInt(dd)+' 일';
    if(r2b.length) await _rtFillTemplate('assets/ccp2b.xlsx','CCP-2B_점검표_'+dateStr+'.xlsx', r2b, false, dateTxt);
    if(r3b.length) await _rtFillTemplate('assets/ccp3b.xlsx','CCP-3B_점검표_'+dateStr+'.xlsx', r3b, true, dateTxt);
    toast('CCP 점검표 다운로드 ✓','s');
  }catch(e){
    console.error('[CCP 점검표]',e);
    alert('점검표 생성 실패: '+e.message);
  }
}
