// ============================================================
// 방혈 탭
// ============================================================
async function renderThawWaiting(){
  const today=tod();
  const nowMin=(()=>{const n=new Date();return n.getHours()*60+n.getMinutes();})();
  const toMin=t=>{if(!t)return 9999;const p=t.slice(0,5).split(':');return+p[0]*60+(+p[1]||0);};

  // 방혈 대기: 오늘 종료(어제 시작) + 내일 종료(오늘 시작)
  // date 룰 변경: date=종료일이라 yesterday 대신 tomorrow를 fetch (thawing)
  // yesterday는 barcode용으로 별도 보존 (barcode.date=스캔일이라 어제도 표시)
  const tomorrow=addDays(today,1);
  const yesterday=getYesterday_();

  // ★ Firebase fresh fetch: thawing + barcode 모두 (다른 디바이스/마이그레이션 반영)
  // 실패 시 L.thawing/L.barcodes 기존 캐시로 fallback (오프라인 동작 유지)
  let todayThArr = [], ystThArr = [];
  let todayBcArr = [], ystBcArr = [];
  try {
    [todayThArr, ystThArr, todayBcArr, ystBcArr] = await Promise.all([
      fbGetByDate('thawing', today),
      fbGetByDate('thawing', tomorrow),
      fbGetByDate('barcode', today),
      fbGetByDate('barcode', tomorrow)
    ]);
    // L.thawing의 today/tomorrow 데이터 fresh로 교체 (다른 날짜는 그대로)
    L.thawing = [
      ...L.thawing.filter(t => {
        const d = String(t.date||'').slice(0,10);
        return d !== today && d !== tomorrow;
      }),
      ...todayThArr,
      ...ystThArr
    ];
    // L.barcodes도 today/tomorrow fresh 교체 (pending — fbId 없는 record는 보존)
    const pendingBc = L.barcodes.filter(b => {
      const d = String(b.date||'').slice(0,10);
      return !b.fbId && (d === today || d === tomorrow);
    });
    L.barcodes = [
      ...L.barcodes.filter(b => {
        const d = String(b.date||'').slice(0,10);
        return d !== today && d !== tomorrow;
      }),
      ...todayBcArr,
      ...ystBcArr,
      ...pendingBc
    ];
    saveL();
  } catch(e) {
    console.warn('[thawing] fresh fetch 실패, L.thawing/L.barcodes 캐시 사용:', e && e.message);
  }

  const scanned_raw=L.barcodes.filter(b=>{
    const d=String(b.date||'').slice(0,10);
    if(d===yesterday&&b.status==='적합') return true;
    if(d===today&&b.status==='적합'){
      if(!b.rfEnd) return true;
      return toMin(b.rfEnd)<=nowMin;
    }
    return false;
  });
  // ★ importCode 기준 중복 제거 (옛 캐시 + fresh fetch 동일 record 중복 방지)
  const _seenCodes = new Set();
  const scanned = scanned_raw.filter(b => {
    const code = b.importCode || '';
    if(!code) return true;  // importCode 없으면 그대로
    if(_seenCodes.has(code)) return false;
    _seenCodes.add(code);
    return true;
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
    if(!byPart[b.part]) byPart[b.part]={kg:0,count:0,ystCount:0,ystKg:0,todCount:0,todKg:0,sampleCount:0,barcodes:[]};
    const bKg=b.sample?0:(parseFloat(b.weightKg)||0);   // ★ 샘플은 무게 제외 (박스 수에는 포함)
    if(b.sample) byPart[b.part].sampleCount++;
    byPart[b.part].kg+=bKg;
    byPart[b.part].count++;
    const bd=String(b.date||'').slice(0,10);
    if(bd===yesterday){ byPart[b.part].ystCount++; byPart[b.part].ystKg+=bKg; }
    else { byPart[b.part].todCount++; byPart[b.part].todKg+=bKg; }
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
  const totalYstKg=r2(Object.values(byPart).reduce((s,v)=>s+v.ystKg,0));
  const totalTodKg=r2(Object.values(byPart).reduce((s,v)=>s+v.todKg,0));
  // ★ 상시 경고 배너 — 이월분 또는 해동 종료 후 90분 지난 미등록 박스 (토스트와 달리 사라지지 않음)
  const _nm=nowHM().split(':'), _bnNowMin=(+_nm[0])*60+(+_nm[1]);
  let staleCnt=0, staleKg=0;
  waiting.forEach(b=>{
    if(String(b.date||'').slice(0,10)!==tod()) return;
    const re=String(b.rfEnd||'').slice(0,5);
    if(!/^\d{2}:\d{2}$/.test(re)) return;
    const m=(+re.slice(0,2))*60+(+re.slice(3,5));
    if(_bnNowMin-m>=90){ staleCnt++; staleKg+=b.sample?0:(parseFloat(b.weightKg)||0); }
  });
  let warnBanner='';
  if(totalYst>0 || staleCnt>0){
    const msgs=[];
    if(totalYst>0) msgs.push(`어제 스캔분 ${totalYst}박스(${totalYstKg.toFixed(2)}kg)`);
    if(staleCnt>0) msgs.push(`해동 끝난 지 1시간30분 넘은 ${staleCnt}박스(${r2(staleKg).toFixed(2)}kg)`);
    // ★ 이월 원클릭 흡수 버튼 — 어제 시작한 마지막 대차를 찾아 이월분 전부 추가 제안
    let absorbBtn='';
    if(totalYst>0){
      const ystBoxes=waiting.filter(b=>String(b.date||'').slice(0,10)===yesterday);
      const ystCarts=dedupeRec([...L.thawing], r=>(r.fbId||r.id))
        .filter(t=>t.fbId && String(t.start||'').slice(0,10)===yesterday)
        .sort((a,b)=>String(a.start).localeCompare(String(b.start)));
      const lastCart=ystCarts[ystCarts.length-1];
      const partsOk=lastCart && ystBoxes.every(b=>String(lastCart.type||'').split(',').map(s=>s.trim()).includes(b.part));
      if(lastCart && partsOk){
        window._twYstAbsorb={
          fbId:lastCart.fbId, cartNo:lastCart.cart,
          codes:ystBoxes.map(b=>b.importCode),
          addKg:r2(ystBoxes.reduce((s,b)=>s+(b.sample?0:(parseFloat(b.weightKg)||0)),0)),
          addBoxes:ystBoxes.length,
          curCodes:lastCart.importCodes||[], curBoxes:parseInt(lastCart.boxes)||0,
          curTotalKg:parseFloat(lastCart.totalKg)||0, curRemainKg:parseFloat(lastCart.remainKg)||0
        };
        absorbBtn=`<button onclick="absorbYstLeftover()" style="margin-top:8px;padding:7px 14px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">↩ ${ystBoxes.length}박스를 어제 마지막 대차(${lastCart.cart}번)에 추가</button>`;
      }
    }
    warnBanner=`<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:10px;color:#991b1b;font-weight:700;font-size:13px">⚠ 대차 등록 안 된 박스 있음 — ${msgs.join(' · ')}<div style="font-weight:400;font-size:12px;margin-top:3px">실물이 대차에 실렸다면 박스수가 빠진 것 → 등록 확인 필요</div>${absorbBtn}</div>`;
  }
  el.innerHTML=warnBanner+Object.entries(byPart).map(([part,v])=>`
    <div style="padding:10px 0;border-bottom:1px solid var(--g2)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:14px;font-weight:600">${part}</span>
        <span style="font-size:14px;color:var(--g5)">${v.count}박스 · <b style="color:var(--p)">${r2(v.kg).toFixed(2)}kg</b>${v.sampleCount?` <span style="font-size:11px;color:#92400e">(🧪샘플 ${v.sampleCount}박스 무게제외)</span>`:''}</span>
      </div>
      ${v.ystCount>0?`
      <div style="display:flex;gap:14px;margin-top:6px;font-size:12px">
        <span style="color:#d97706">↩ 어제(이월): ${v.ystCount}박스 · ${r2(v.ystKg).toFixed(2)}kg</span>
        <span style="color:#1d4ed8">📅 오늘: ${v.todCount}박스 · ${r2(v.todKg).toFixed(2)}kg</span>
      </div>`:''}
    </div>`).join('')+
    `<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:700">
      <span>합계${totalYst>0?` <span style="font-size:11px;color:#d97706;font-weight:400">(어제이월 ${totalYst}박스 ${totalYstKg.toFixed(2)}kg + 오늘 ${totalTodKg.toFixed(2)}kg)</span>`:''}</span><span style="color:var(--p);font-size:16px">${totalKg.toFixed(2)}kg</span>
    </div>`;

  document.getElementById('twPartChecks').innerHTML=
    '<div style="font-size:12px;font-weight:600;color:var(--g6);margin-bottom:8px">이번 대차에 넣을 박스수 입력</div>'+
    Object.entries(byPart).map(([part,v])=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--g2)">
        <span style="font-size:14px;font-weight:600;min-width:60px">${part}</span>
        <span style="font-size:13px;color:var(--g5);flex:1">총 ${v.count}박스 · ${r2(v.kg).toFixed(2)}kg${v.sampleCount?` <span style="font-size:11px;color:#92400e">(샘플 ${v.sampleCount})</span>`:''}</span>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="number" class="tw-box-cnt fc" data-part="${part}"
            data-max="${v.count}" data-totalkg="${r2(v.kg)}"
            data-barcodes='${JSON.stringify(v.barcodes.map(b=>b.importCode))}'
            data-weights='${JSON.stringify(v.barcodes.map(b=>b.sample?0:(parseFloat(b.weightKg)||0)))}'
            data-rfends='${JSON.stringify(v.barcodes.map(b=>String(b.rfEnd||"").slice(0,5)))}'
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
  const parts=[], leftWarn=[];
  inputs.forEach(inp=>{
    const cnt=parseInt(inp.value)||0;
    const max=parseInt(inp.dataset.max)||0;
    // ★ 대기보다 적게 입력하면 잔여를 실시간 빨간 표시 (카운트 미스 즉시 감지)
    if(cnt<max){
      const weights=JSON.parse(inp.dataset.weights||'[]');
      const leftKg=r2(weights.slice(cnt).reduce((s,w)=>s+(parseFloat(w)||0),0));
      leftWarn.push(`${inp.dataset.part} ${max-cnt}박스(${leftKg.toFixed(2)}kg)`);
    }
    if(cnt>0){
      parts.push(inp.dataset.part+' '+cnt+'박스');
      totalBoxes+=cnt;
      // ★ 실제 박스별 무게 합 사용 (찍은 순서대로 cnt개)
      const weights=JSON.parse(inp.dataset.weights||'[]');
      const partKg = r2(weights.slice(0,cnt).reduce((s,w)=>s+(parseFloat(w)||0),0));
      totalKg=r2(totalKg + partKg);
    }
  });
  const el=document.getElementById('tw_summary');
  const warnHtml=leftWarn.length?`<div style="color:#dc2626;font-weight:700;font-size:13px;margin-top:6px">⚠ ${leftWarn.join(' · ')} 남음 — 마지막 대차면 전부 포함하세요!</div>`:'';
  if(!totalBoxes){el.innerHTML=warnHtml;return;}
  el.innerHTML=`<div class="al al-i">${parts.join(', ')} → 합계 <b>${totalKg.toFixed(2)}kg</b>${warnHtml}</div>`;
}

// ★ 이월 원클릭 흡수 — 어제 마지막 대차에 이월 박스 전부 추가 (확인 후 실행)
async function absorbYstLeftover(){
  const a=window._twYstAbsorb;
  if(!a){ toast('흡수 대상 정보 없음 — 새로고침 후 다시 시도','d'); return; }
  if(!confirm(`이월 ${a.addBoxes}박스(${a.addKg.toFixed(2)}kg)를 어제 ${a.cartNo}번 대차에 추가할까요?\n\n실물이 그 대차에 실려 방혈된 경우에만 진행하세요.`)) return;
  toast('추가 중...','i');
  const ok=await fbUpdate('thawing', a.fbId, {
    boxes: a.curBoxes + a.addBoxes,
    totalKg: r2(a.curTotalKg + a.addKg),
    remainKg: r2(a.curRemainKg + a.addKg),
    importCodes: [...a.curCodes, ...a.codes]
  });
  if(ok){
    window._twYstAbsorb=null;
    await renderThawWaiting();
    await renderThawList();
    toast(`✓ ${a.cartNo}번 대차에 ${a.addBoxes}박스 추가 완료 — 이월 해소`);
  } else {
    toast('추가 실패 — 다시 시도해주세요','d');
  }
}
window.absorbYstLeftover=absorbYstLeftover;

async function startThawing(){
  const cartNo=document.getElementById('tw_cart').value.trim();
  if(!cartNo){toast('해동대차 번호 입력하세요','d');return;}
  const manualTime=document.getElementById('tw_start').value;

  const inputs=[...document.querySelectorAll('.tw-box-cnt')];
  if(!inputs.length){toast('방혈 대기 원육이 없습니다','d');return;}

  let totalBoxes=0, totalKg=0;
  const importCodes=[], typeArr=[], rfEnds=[];
  let hasError=false;

  inputs.forEach(inp=>{
    const cnt=parseInt(inp.value)||0;
    if(cnt<=0) return;
    const max=parseInt(inp.dataset.max)||0;
    if(cnt>max){toast(`${inp.dataset.part}: 최대 ${max}박스`,'d');hasError=true;return;}
    totalBoxes+=cnt;
    // ★ 실제 박스별 무게 합 사용 (찍은 순서대로 cnt개) — 비례 계산 금지
    const allCodes=JSON.parse(inp.dataset.barcodes||'[]');
    const allWeights=JSON.parse(inp.dataset.weights||'[]');
    const allRfEnds=JSON.parse(inp.dataset.rfends||'[]');
    const selectedCodes=allCodes.slice(0,cnt);
    const selectedWeights=allWeights.slice(0,cnt);
    rfEnds.push(...allRfEnds.slice(0,cnt).filter(Boolean));
    const partKg2 = r2(selectedWeights.reduce((s,w)=>s+(parseFloat(w)||0),0));
    totalKg=r2(totalKg+partKg2);
    typeArr.push(inp.dataset.part);
    importCodes.push(...selectedCodes);
  });

  if(hasError||!totalBoxes){toast('박스수를 입력하세요','d');return;}
  const type=typeArr.join(',');
  // ★ 방혈 시작 = 수동 입력 > 해동 종료(rfEnd) 마지막 시각 > 현재 시각
  //   (해동기에서 나오는 즉시 방혈통 투입 — 입력 지연이 있어도 실제 시각 기준)
  const startTime = manualTime || (rfEnds.length ? rfEnds.sort()[rfEnds.length-1] : nowHM());

  document.getElementById('tw_cart').value='';
  document.getElementById('tw_start').value='';
  document.getElementById('twPartChecks').innerHTML='';
  document.getElementById('tw_summary').innerHTML='';

  const rec = {
    id:gid(), date:addDays(tod(),1), cart:cartNo, type,
    start:tod()+' '+startTime, end:'',
    boxes:totalBoxes, totalKg, remainKg:totalKg,
    importCodes
  };

  toast('방혈 저장중...','i');
  const fbId = await fbSave('thawing', rec);
  if(fbId){
    rec.fbId = fbId;
    // ★ localStorage push 제거 — Firebase가 진실. 다음 render에서 fresh fetch로 가져옴
    // ★ 저장 후 fresh fetch — async 화면들 await로 호출 (다른 디바이스 동시 작업 record 병합)
    await renderThawWaiting();
    await renderThawList();
    toast(`방혈 시작 — 해동대차 ${cartNo} · ${totalKg.toFixed(2)}kg ✓`);
    // ★ 미등록 잔여 경고 — 스캔됐는데 어느 대차에도 안 담긴 박스가 남으면 크게 알림 (카운트 미스 방지)
    const leftMsgs=[];
    inputs.forEach(inp=>{
      const cnt=parseInt(inp.value)||0;
      const max=parseInt(inp.dataset.max)||0;
      const left=max-cnt;
      if(left>0){
        const ws=JSON.parse(inp.dataset.weights||'[]');
        const leftKg=r2(ws.slice(cnt).reduce((s,w)=>s+(parseFloat(w)||0),0));
        leftMsgs.push(`${inp.dataset.part} ${left}박스(${leftKg.toFixed(2)}kg)`);
      }
    });
    if(leftMsgs.length){
      setTimeout(()=>toast(`⚠ 미등록 잔여: ${leftMsgs.join(', ')} — 대차에 실렸으면 박스수 다시 확인!`,'d'),1200);
    }
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
    const d=String(r.date||'').slice(0,10);
    // thawing.date = 종료일 기준이므로:
    //   오늘 종료(어제 시작) 또는 내일 종료(오늘 시작) 모두 표시
    //   ★ 종료된 record도 포함 (사용자: "오늘 방혈 현황"엔 완료된 것도 보여야)
    return d===today||d===tomorrow;
  });
  const el=document.getElementById('list-thawing');
  if(!el) return;
  if(!items.length){el.innerHTML='<div class="emp">데이터 없음</div>';return;}
  el.innerHTML='<div class="rl">'+items.map(r=>`
    <div class="ri">
      <div>
        <div class="rm">${r.cart||r.wagon||'(대차없음)'} · ${r.totalKg||0}kg · ${r.boxes||0}박스</div>
        <div class="rs">${r.type||'-'} · 시작 ${(()=>{const d=new Date(r.date||tod());d.setDate(d.getDate()-1);return (d.getMonth()+1+'').padStart(2,'0')+'-'+(d.getDate()+'').padStart(2,'0');})()  } ${_hm(r.start)||'-'} · 잔여 ${r.remainKg!==undefined?r.remainKg:r.totalKg}kg ${r.end?(()=>{const e=r.end||'';const endDisp=e.length>8?e.slice(5,10)+' '+e.slice(11,16):tod().slice(5)+' '+e;return '✅종료 '+endDisp;})():'🔄방혈중'}</div>
      </div>
      <button class="btn bo bsm" onclick="delR('thawing','${r.id}','${r.fbId||''}')">삭제</button>
    </div>`).join('')+'</div>';
}