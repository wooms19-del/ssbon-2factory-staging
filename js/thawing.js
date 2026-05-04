// ============================================================
// 방혈 탭
// ============================================================
async function renderThawWaiting(){
  const today=tod();
  const nowMin=(()=>{const n=new Date();return n.getHours()*60+n.getMinutes();})();
  const toMin=t=>{if(!t)return 9999;const p=t.slice(0,5).split(':');return+p[0]*60+(+p[1]||0);};

  // 방혈 대기: 오늘(시간조건있음) + 어제(시간조건없음 - 이미 해동완료)
  const yesterday=getYesterday_();

  // ★ Firebase fresh fetch: 오늘+어제 thawing 모두 (다른 디바이스/마이그레이션 반영)
  // 실패 시 L.thawing 기존 캐시로 fallback (오프라인 동작 유지)
  let todayThArr = [], ystThArr = [];
  try {
    [todayThArr, ystThArr] = await Promise.all([
      fbGetByDate('thawing', today),
      fbGetByDate('thawing', yesterday)
    ]);
    // L.thawing의 today/yesterday 데이터 fresh로 교체 (다른 날짜는 그대로)
    L.thawing = [
      ...L.thawing.filter(t => {
        const d = String(t.date||'').slice(0,10);
        return d !== today && d !== yesterday;
      }),
      ...todayThArr,
      ...ystThArr
    ];
    saveL();
  } catch(e) {
    console.warn('[thawing] fresh fetch 실패, L.thawing 캐시 사용:', e && e.message);
  }

  const scanned=L.barcodes.filter(b=>{
    const d=String(b.date||'').slice(0,10);
    if(d===yesterday&&b.status==='적합') return true;
    if(d===today&&b.status==='적합'){
      if(!b.rfEnd) return true;
      return toMin(b.rfEnd)<=nowMin;
    }
    return false;
  });

  // startedCodes: L.thawing (이미 fresh로 갱신됨) 기준으로 통합
  const startedCodes=new Set(L.thawing.flatMap(t=>t.importCodes||[]));

  // importCodes 없는 방혈 레코드: L.thawing(fresh) 사용, 중복 제거
  const _noCodeSrc = dedupeRec([...L.thawing], r=>(r.fbId||r.id));
  const noCodeTh = _noCodeSrc.filter(t=>{
    if(t.importCodes&&t.importCodes.length>0) return false;
    const d=String(t.date||'').slice(0,10);
    return d===today||d===yesterday;
  });
  let filtered = scanned.filter(b=>!startedCodes.has(b.importCode));
  if(noCodeTh.length>0){
    const skipByPart={};
    noCodeTh.forEach(t=>{
      const types=(t.type||'').split(',').map(s=>s.trim()).filter(Boolean);
      if(types.length){
        types.forEach(tp=>{ skipByPart[tp]=(skipByPart[tp]||0)+(parseInt(t.boxes)||0); });
      } else {
        // type 없는 경우: _any 버킷 → part 구분 없이 순서대로 차감
        skipByPart['_any']=(skipByPart['_any']||0)+(parseInt(t.boxes)||0);
      }
    });
    const partCount={};
    filtered = filtered.filter(b=>{
      const p=b.part||'';
      if(skipByPart[p]){
        partCount[p]=(partCount[p]||0)+1;
        if(partCount[p]<=skipByPart[p]) return false;
        return true;
      }
      if(skipByPart['_any']){
        partCount['_any']=(partCount['_any']||0)+1;
        if(partCount['_any']<=skipByPart['_any']) return false;
        return true;
      }
      return true;
    });
  }
  const waiting = filtered;

  const byPart={};
  waiting.forEach(b=>{
    if(!byPart[b.part]) byPart[b.part]={kg:0,count:0,ystCount:0,barcodes:[]};
    const bKg=parseFloat(b.weightKg)||0;
    byPart[b.part].kg+=bKg;
    byPart[b.part].count++;
    if(String(b.date||'').slice(0,10)===yesterday) byPart[b.part].ystCount++;
    byPart[b.part].barcodes.push(b);
  });

  const el=document.getElementById('thawWaiting');
  if(!waiting.length){
    el.innerHTML='<div class="emp">해동기 완료 대기중인 원육 없음</div>';
    document.getElementById('twPartChecks').innerHTML='';
    document.getElementById('tw_summary').innerHTML='';
    return;
  }

  const totalKg=r2(Object.values(byPart).reduce((s,v)=>s+v.kg,0));
  const totalYst=Object.values(byPart).reduce((s,v)=>s+v.ystCount,0);
  el.innerHTML=Object.entries(byPart).map(([part,v])=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--g2)">
      <span style="font-size:14px;font-weight:600">${part}</span>
      <span style="font-size:14px;color:var(--g5)">${v.count}박스 · <b style="color:var(--p)">${r2(v.kg).toFixed(2)}kg</b>${v.ystCount>0?` <span style="font-size:11px;color:var(--g4)">(전일이월 ${v.ystCount}박스)</span>`:''}</span>
    </div>`).join('')+
    `<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700">
      <span>합계${totalYst>0?` <span style="font-size:11px;color:var(--g4);font-weight:400">(전일이월 ${totalYst}박스 포함)</span>`:''}</span><span style="color:var(--p);font-size:16px">${totalKg.toFixed(2)}kg</span>
    </div>`;

  document.getElementById('twPartChecks').innerHTML=
    '<div style="font-size:12px;font-weight:600;color:var(--g6);margin-bottom:8px">이번 대차에 넣을 박스수 입력</div>'+
    Object.entries(byPart).map(([part,v])=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--g2)">
        <span style="font-size:14px;font-weight:600;min-width:60px">${part}</span>
        <span style="font-size:13px;color:var(--g5);flex:1">총 ${v.count}박스 · ${r2(v.kg).toFixed(2)}kg</span>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="number" class="tw-box-cnt fc" data-part="${part}"
            data-max="${v.count}" data-totalkg="${r2(v.kg)}"
            data-barcodes='${JSON.stringify(v.barcodes.map(b=>b.importCode))}'
            data-weights='${JSON.stringify(v.barcodes.map(b=>parseFloat(b.weightKg)||0))}'
            min="0" max="${v.count}" value="${v.count}"
            style="width:70px;text-align:center" oninput="updateTwSummary()">
          <span style="font-size:12px;color:var(--g5)">박스</span>
        </div>
      </div>`).join('');

  updateTwSummary();
}

function updateTwSummary(){
  const inputs=[...document.querySelectorAll('.tw-box-cnt')];
  if(!inputs.length){ document.getElementById('tw_summary').innerHTML=''; return; }
  let totalBoxes=0, totalKg=0;
  const parts=[];
  inputs.forEach(inp=>{
    const cnt=parseInt(inp.value)||0;
    const max=parseInt(inp.dataset.max)||0;
    const totalKgAll=parseFloat(inp.dataset.totalkg)||0;
    if(cnt>0){
      parts.push(inp.dataset.part+' '+cnt+'박스');
      totalBoxes+=cnt;
      // 비례 계산: 전체 중량 * (선택박스/전체박스)
      const partKg = cnt===max ? totalKgAll : r2(totalKgAll * cnt / max);
      totalKg=r2(totalKg + partKg);
    }
  });
  const el=document.getElementById('tw_summary');
  if(!totalBoxes){el.innerHTML='';return;}
  el.innerHTML=`<div class="al al-i">${parts.join(', ')} → 합계 <b>${totalKg.toFixed(2)}kg</b></div>`;
}

async function startThawing(){
  const cartNo=document.getElementById('tw_cart').value.trim();
  if(!cartNo){toast('해동대차 번호 입력하세요','d');return;}
  const startTime=document.getElementById('tw_start').value||nowHM();

  const inputs=[...document.querySelectorAll('.tw-box-cnt')];
  if(!inputs.length){toast('방혈 대기 원육이 없습니다','d');return;}

  let totalBoxes=0, totalKg=0;
  const importCodes=[], typeArr=[];
  let hasError=false;

  inputs.forEach(inp=>{
    const cnt=parseInt(inp.value)||0;
    if(cnt<=0) return;
    const max=parseInt(inp.dataset.max)||0;
    if(cnt>max){toast(`${inp.dataset.part}: 최대 ${max}박스`,'d');hasError=true;return;}
    totalBoxes+=cnt;
    const tkAll=parseFloat(inp.dataset.totalkg)||0;
    const maxB=parseInt(inp.dataset.max)||1;
    // 선택된 바코드들의 실제 중량 합으로 계산
    const allCodes=JSON.parse(inp.dataset.barcodes||'[]');
    const selectedCodes=allCodes.slice(0,cnt);
    // 전체 합계 기준 비례 계산으로 일관성 보장
    const partKg2 = cnt===maxB ? tkAll : r2(tkAll * cnt / maxB);
    totalKg=r2(totalKg+partKg2);
    typeArr.push(inp.dataset.part);
    importCodes.push(...selectedCodes);
  });

  if(hasError||!totalBoxes){toast('박스수를 입력하세요','d');return;}
  const type=typeArr.join(',');

  document.getElementById('tw_cart').value='';
  document.getElementById('tw_start').value='';
  document.getElementById('twPartChecks').innerHTML='';
  document.getElementById('tw_summary').innerHTML='';

  const rec = {
    id:gid(), date:addDays(tod(),1), cart:cartNo, type,
    start:startTime, end:'',
    boxes:totalBoxes, totalKg, remainKg:totalKg,
    importCodes
  };

  toast('방혈 저장중...','i');
  const fbId = await fbSave('thawing', rec);
  if(fbId){
    rec.fbId = fbId;
    L.thawing.push(rec); saveL();
    gasRecord('saveThawing', {cart:cartNo, type, start:startTime, end:'', boxes:totalBoxes, totalKg, importCodes});
    // ★ 저장 후 fresh fetch — async 화면들 await로 호출 (다른 디바이스 동시 작업 record 병합)
    await renderThawWaiting();
    await renderThawList();
    toast(`방혈 시작 — 해동대차 ${cartNo} · ${totalKg.toFixed(2)}kg ✓`);
  } else {
    toast('방혈 저장 실패','d');
  }
}

async function renderThawList(){
  const today=tod();
  const tomorrow=addDays(today, 1);

  // ★ Firebase fresh fetch: 미종료 thawing 전체를 L.thawing에 갱신
  // (loadOpenThawing은 common.js에 있는 헬퍼 — 미종료 thawing fetch + L 갱신 + saveL)
  // 실패 시 L.thawing 기존 캐시로 fallback
  try {
    if(typeof loadOpenThawing === 'function') {
      await loadOpenThawing();
    }
  } catch(e) {
    console.warn('[thawing] renderThawList fresh fetch 실패, 캐시 사용:', e && e.message);
  }

  const items=L.thawing.filter(r=>{
    if(r.end&&r.end!=='') return false;  // 진행중인 방혈만
    const d=String(r.date||'').slice(0,10);
    // thawing.date = 종료일 기준이므로:
    //   오늘 종료(어제 시작) 또는 내일 종료(오늘 시작) 표시
    return d===today||d===tomorrow;
  });
  const el=document.getElementById('list-thawing');
  if(!el) return;
  if(!items.length){el.innerHTML='<div class="emp">데이터 없음</div>';return;}
  el.innerHTML='<div class="rl">'+items.map(r=>`
    <div class="ri">
      <div>
        <div class="rm">${r.cart||r.wagon||'(대차없음)'} · ${r.totalKg||0}kg · ${r.boxes||0}박스</div>
        <div class="rs">${r.type||'-'} · 시작 ${(()=>{const d=new Date(r.date||tod());d.setDate(d.getDate()-1);return (d.getMonth()+1+'').padStart(2,'0')+'-'+(d.getDate()+'').padStart(2,'0');})()  } ${r.start||'-'} · 잔여 ${r.remainKg!==undefined?r.remainKg:r.totalKg}kg ${r.end?(()=>{const e=r.end||'';const endDisp=e.length>8?e.slice(5,10)+' '+e.slice(11,16):tod().slice(5)+' '+e;return '✅종료 '+endDisp;})():'🔄방혈중'}</div>
      </div>
      <button class="btn bo bsm" onclick="delR('thawing','${r.id}','${r.fbId||''}')">삭제</button>
    </div>`).join('')+'</div>';
}