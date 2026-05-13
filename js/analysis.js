// ============================================================
// 분석 탭
// ============================================================
// toggleDatePicker 불필요 - input이 직접 클릭됨

// ============================================================
// 월별현황
// ============================================================
var _moYm = '';
var _moBarChart = null, _moDefChart = null, _moYieldChart = null;

function chMonth(dir) {
  if(!_moYm) _moYm = tod().slice(0,7);
  const [y,m] = _moYm.split('-').map(Number);
  const d = new Date(y, m-1+dir, 1);
  _moYm = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  renderMonthly();
}

// 메모리 캐시 — 입력 시 Firestore 재조회 안 하도록 (renderMonthly 시 갱신됨)
let _moMetaCache = {};

// ── 월간 메타(작업인원/Capa/메모) firestore 동기화 헬퍼 ─────────────────────
//
// 컬렉션: monthlyMeta, 문서ID: ym (예: '2026-04')
// 데이터 형태: { "2026-04-01": { workers, capa, note }, ... }
//
// 동작:
//  - 로드: firestore 우선, localStorage는 오프라인 fallback
//  - 마이그레이션: localStorage에 있고 firestore에 없으면 자동 업로드 (1회)
//  - 저장: firestore에 직접 (성공 후 localStorage 캐시 갱신)
//  - 입력 시 _moMetaCache 메모리 사용 (localStorage 의존 끊음)
async function _moLoadMeta(ym){
  const metaKey = 'moMeta_' + ym;
  let lsData = {};
  try { lsData = JSON.parse(localStorage.getItem(metaKey)||'{}'); } catch(e){}

  let fbData = null;
  try {
    if(typeof db !== 'undefined' && db) {
      const snap = await db.collection('monthlyMeta').doc(ym).get();
      if(snap.exists) {
        const raw = snap.data() || {};
        // 시스템 필드(_createdAt 등) 제거
        fbData = {};
        for(const k in raw){ if(!k.startsWith('_')) fbData[k] = raw[k]; }
      }
    }
  } catch(e) { console.warn('[월간메모] firestore 로드 실패, localStorage 사용:', e.message); }

  // 마이그레이션: localStorage에 있고 firestore에 없으면 자동 업로드
  if(fbData === null && Object.keys(lsData).length > 0) {
    if(typeof fbSave === 'function') {
      try {
        await fbSave('monthlyMeta', lsData, ym);
        console.log('[월간메모 마이그레이션] localStorage → firestore 완료', ym, Object.keys(lsData).length+'일');
      } catch(e) { console.warn('[월간메모 마이그레이션 실패]', e.message); }
    }
    return lsData;
  }

  // firestore가 우선. localStorage + 메모리 캐시 갱신
  if(fbData !== null) {
    try { localStorage.setItem(metaKey, JSON.stringify(fbData)); } catch(e){}
    _moMetaCache[ym] = fbData;
    return fbData;
  }
  _moMetaCache[ym] = lsData;
  return lsData;
}

async function _moSaveMeta(ym, mm){
  const metaKey = 'moMeta_' + ym;
  // ★ Firestore 우선 저장 (실패 시에만 throw)
  if(typeof fbSave !== 'function') {
    throw new Error('fbSave 함수 없음 — Firebase 초기화 실패');
  }
  await fbSave('monthlyMeta', mm, ym);  // 성공해야 다음으로
  // 성공 후 localStorage 캐시 갱신 (오프라인 대비, 보조 역할)
  try { localStorage.setItem(metaKey, JSON.stringify(mm)); } catch(e){}
  // 메모리 캐시도 갱신
  _moMetaCache[ym] = mm;
}



async function renderMonthly() {
  if(!_moYm) _moYm = tod().slice(0,7);
  const ym = _moYm;
  const from = ym+'-01';
  const lastDay = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5)), 0).getDate();
  const to = ym+'-'+String(lastDay).padStart(2,'0');
  const today = tod();
  const effectiveTo = to > today ? today : to;

  const months=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  setText('monthLbl', ym.slice(0,4)+'년 '+months[parseInt(ym.slice(5))-1]);

  const prevFrom=(()=>{const [y,m,dd]=from.split('-').map(Number);const dt=new Date(y,m-1,dd-1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;})();
  const [pk, op, ppMonth, thMonth, shMonth, ckMonth] = await Promise.all([
    fbGetRange('packing', from, effectiveTo),
    fbGetRange('outerpacking', from, effectiveTo),
    fbGetRange('preprocess', from, effectiveTo),
    fbGetRange('thawing', prevFrom, effectiveTo),
    fbGetRange('shredding', from, effectiveTo),
    fbGetRange('cooking', from, effectiveTo)
  ]);

  // ── KPI ──────────────────────────────────────────────────
  const opReal   = op.filter(r=>!r.testRun&&!r.isTest);
  // testRun 제외 필터
  const _kpiTestOpK=new Set(op.filter(r=>r.testRun||r.isTest).map(r=>`${String(r.date||'').slice(0,10)}_${r.product||''}`));
  const _kpiIsTest=r=>!!(r.testRun||r.isTest||_kpiTestOpK.has(`${String(r.date||'').slice(0,10)}_${r.product||''}`));
  const pkClean  = pk.filter(r=>!_kpiIsTest(r));
  const totalDef = pkClean.reduce((s,r)=>s+(parseFloat(r.defect)||0), 0);
  const workDays = new Set(pkClean.map(r=>String(r.date||'').slice(0,10)).filter(Boolean)).size;
  const totalBoxes   = opReal.reduce((s,r)=>s+(parseInt(r.outerBoxes)||0), 0);
  const totalOuterEA = opReal.reduce((s,r)=>s+opEa(r), 0);
  // 총 생산 EA = 테이블과 동일: 외포장 있으면 외포장EA, 없으면 내포장EA
  const _kpiOpMap={};
  opReal.forEach(r=>{ _kpiOpMap[`${String(r.date||'').slice(0,10)}_${r.product||''}`]=opEa(r); });
  const _kpiDpMap={};
  pkClean.forEach(r=>{ const key=`${String(r.date||'').slice(0,10)}_${r.product||''}`;
    if(!_kpiDpMap[key]) _kpiDpMap[key]=0;
    _kpiDpMap[key]+=parseFloat(r.ea)||0;
  });
  const totalEA = Object.entries(_kpiDpMap).reduce((s,[key,pkEa])=>s+(_kpiOpMap[key]||pkEa), 0);

  // ─── Phase 2.2 마이그레이션: dataLayer.getMonth 비교 모니터 (사용자 영향 0) ───
  if(typeof window !== 'undefined' && window.DL && typeof window.DL.getMonth === 'function'){
    try{
      const _dlM = window.DL.getMonth(ym);  // 'YYYY-MM' 문자열
      const _dlMS = _dlM && _dlM.monthSummary;
      if(_dlMS){
        const _dlPkEa = _dlMS.pkEaTotalDisp || 0;
        const _check = (label, legacy, dl, tol=1) => {
          const diff = Math.abs((legacy||0) - (dl||0));
          if(diff > tol) console.warn(`[Phase2.2 비교 차이] ${ym} ${label}: legacy=${legacy}, DL=${dl}, Δ=${diff.toFixed(2)}`);
        };
        _check('monthlyTotalEA', totalEA, _dlPkEa);
      }
    }catch(_e){
      console.error('[Phase2.2 DL 비교 오류]', _e.message);
    }
  }
  const avgEA    = workDays > 0 ? Math.round(totalEA/workDays) : 0;
  // 불량률 = 불량 ÷ 파우치사용량
  const _kpiPkEaTotal=pkClean.reduce((s,r)=>s+(parseFloat(r.ea)||0),0);
  const _kpiPouch=_kpiPkEaTotal+totalDef;
  const defRate  = _kpiPouch > 0 ? totalDef/_kpiPouch*100 : 0;

  setText('mo_ea',    totalEA.toLocaleString());
  // mo_avg는 _moLoadAndRenderPrevCmp에서 일평균 원육으로 갱신됨
  setText('mo_days',  workDays+'작업일');
  setText('mo_boxes', totalBoxes.toLocaleString()+'박스');
  setText('mo_outer_ea', totalOuterEA.toLocaleString()+' EA');
  const defEl = document.getElementById('mo_def');
  if(defEl){ defEl.textContent=defRate.toFixed(2)+'%'; defEl.style.color=defRate>2?'var(--d)':'var(--s)'; }

  // ── 제품별 테이블 ─────────────────────────────────────────
  // 월간생산일보와 동일 로직: testRun 제외 + 외포장 있으면 외포장EA, 없으면 내포장EA
  const byProd = {};
  const _testOpK=new Set(op.filter(r=>r.testRun||r.isTest).map(r=>`${String(r.date||'').slice(0,10)}_${r.product||''}`));
  const _isTestPk=r=>!!(r.testRun||r.isTest||_testOpK.has(`${String(r.date||'').slice(0,10)}_${r.product||''}`));
  // 외포장 map (date_product → outerEa)
  const _opEaMap={};
  opReal.forEach(r=>{ _opEaMap[`${String(r.date||'').slice(0,10)}_${r.product||''}`]=opEa(r); });
  // 날짜+제품 단위로 내포장 집계 (testRun 제외)
  const _dpMap={};
  pk.filter(r=>!_isTestPk(r)).forEach(r=>{
    const dt=String(r.date||'').slice(0,10), pr=r.product||'기타', key=dt+'_'+pr;
    if(!_dpMap[key]) _dpMap[key]={dt,pr,pkEa:0,defect:0};
    _dpMap[key].pkEa+=parseFloat(r.ea)||0;
    _dpMap[key].defect+=parseFloat(r.defect)||0;
  });
  Object.values(_dpMap).forEach(({dt,pr,pkEa,defect})=>{
    const ea=_opEaMap[dt+'_'+pr]||pkEa; // 외포장 있으면 외포장, 없으면 내포장
    if(!byProd[pr]) byProd[pr]={ea:0,defect:0,pkEa:0,days:new Set()};
    byProd[pr].ea+=ea; byProd[pr].defect+=defect;
    byProd[pr].pkEa+=pkEa; // 파우치 사용량 = 내포장 EA (불량 포함)
    byProd[pr].days.add(dt);
  });
  const opByProd = {};
  opReal.forEach(r=>{ const k=r.product||'기타';
    if(!opByProd[k]) opByProd[k]={outerEa:0,boxes:0};
    opByProd[k].outerEa+=opEa(r); opByProd[k].boxes+=parseInt(r.outerBoxes)||0;
  });
  const tbody=document.getElementById('mo_prod_tbl'), tfoot=document.getElementById('mo_prod_total');
  let totEA=0,totDef=0,totOuter=0,totBx=0,totPkEa=0;
  const rows=Object.entries(byProd).sort((a,b)=>b[1].ea-a[1].ea);
  // 제품명에서 그램 파싱 → 완제품 KG (예: 170g→0.17, 3KG→3)
  function _prodKgUnit(name){ const m=(name||'').match(/(\d+(?:\.\d+)?)\s*(g|KG)\b/i); if(!m) return 0; return m[2].toUpperCase()==='KG'?parseFloat(m[1]):parseFloat(m[1])/1000; }
  let totProdKg=0;
  if(tbody) tbody.innerHTML=rows.map(([prod,v])=>{
    const op_=opByProd[prod]||{outerEa:0,boxes:0};
    // 무게: 외포장 EA 우선, 외포장 안 끝났거나 없으면 내포장 EA로 환산
    // (외포장 ≤ 내포장 가정. 추후 외포장 100% 완료되면 자연스럽게 같은 값)
    const _eaForKg=op_.outerEa>0?op_.outerEa:(v.pkEa||0);
    const pkgKg=r2(_eaForKg*_prodKgUnit(prod));
    totEA+=v.ea; totDef+=v.defect; totOuter+=op_.outerEa; totBx+=op_.boxes; totPkEa+=(v.pkEa||0); totProdKg=r2(totProdKg+pkgKg);
    const _pouch=(v.pkEa||0)+v.defect;
    const dr=_pouch>0?(v.defect/_pouch*100).toFixed(2)+'%':'—';
    const dc=_pouch>0&&v.defect/_pouch*100>2?'var(--d)':'var(--s)';
    return `<tr>
      <td style="font-weight:500">${prod}</td>
      <td style="text-align:center">${v.days.size}일</td>
      <td style="text-align:center;font-weight:600;color:var(--p)">${(v.pkEa||0).toLocaleString()}</td>
      <td style="text-align:center">${(v.pkEa+v.defect)>0?(v.pkEa+v.defect).toLocaleString():'—'}</td>
      <td style="text-align:center;color:var(--s)">${pkgKg>0?pkgKg.toLocaleString()+'kg':'—'}</td>
      <td style="text-align:center;color:${dc}">${dr}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--g4);padding:1rem">데이터 없음</td></tr>';
  const totPouch=totPkEa+totDef;
  if(tfoot){ const tdr=totPouch>0?(totDef/totPouch*100).toFixed(2)+'%':'—';
    tfoot.innerHTML=`<tr style="font-weight:700;border-top:2px solid var(--g3)">
      <td>합계</td><td style="text-align:center">—</td>
      <td style="text-align:center;color:var(--p)">${totPkEa.toLocaleString()}</td>
      <td style="text-align:center">${(totPkEa+totDef)>0?(totPkEa+totDef).toLocaleString():'—'}</td>
      <td style="text-align:center;color:var(--s)">${totProdKg>0?totProdKg.toLocaleString()+'kg':'—'}</td>
      <td style="text-align:center;color:${totPouch>0&&totDef/totPouch*100>2?'var(--d)':'var(--s)'}">${tdr}</td>
    </tr>`; }

  // ── 차트 ─────────────────────────────────────────────────
  // pkClean: KPI와 일관성 — testRun/isTest 제외
  // 불량률 공식: defect / 파우치사용량 (= ea + defect) — KPI와 동일
  const byDate={};
  pkClean.forEach(r=>{ const d=String(r.date||'').slice(0,10);
    if(!byDate[d]) byDate[d]={ea:0,def:0};
    byDate[d].ea+=parseFloat(r.ea)||0; byDate[d].def+=parseFloat(r.defect)||0;
  });
  // 전역 저장 — _moRedrawDefChart에서 사용
  window._moCurByDate = byDate;
  window._moYm = _moYm;
  // 차트 그림 (전월 평균은 도착 후 자동 재그림)
  if(typeof _moRedrawDefChart === 'function') _moRedrawDefChart();

  // ── 테스트 체인 완전 역추적 (포장→파쇄→자숙→전처리→해동) ────────────────────
  // ① 외포장·내포장 기준 테스트 판별
  const testOpKeys = new Set(op.filter(r=>r.testRun||r.isTest).map(r=>`${String(r.date||'').slice(0,10)}_${r.product||''}`));
  const isTestPk = r => r.testRun || r.isTest || testOpKeys.has(`${String(r.date||'').slice(0,10)}_${r.product||''}`);
  const pkReport  = pk.filter(r => !isTestPk(r));

  // ② 날짜별로 전체 체인 추적 → 테스트 전처리 ID 집합 + 테스트 해동 와건 집합
  const testPpIds  = new Set();   // 제거할 전처리 레코드 ID
  const testThWByDate = {};       // 날짜별 제거할 해동 와건
  const testDates = [...new Set(pk.filter(isTestPk).map(r=>String(r.date||'').slice(0,10)))];

  testDates.forEach(d => {
    const tPkD  = pk.filter(isTestPk).filter(r=>String(r.date||'').slice(0,10)===d);
    const shD   = (shMonth||[]).filter(r=>String(r.date||'').slice(0,10)===d);
    const ckD   = (ckMonth||[]).filter(r=>String(r.date||'').slice(0,10)===d);
    const ppD   = (ppMonth||[]).filter(r=>String(r.date||'').slice(0,10)===d);

    // 포장 와건 / 카트
    const tPkW = new Set(tPkD.flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()).filter(Boolean)));
    const tPkC = new Set(tPkD.flatMap(r=>(r.cart ||'').split(',').map(w=>w.trim()).filter(Boolean)));
    // 파쇄: 포장 와건으로 wagonOut 매칭 OR 포장 카트로 cartOut 매칭 → wagonIn 추출
    const tSh  = shD.filter(r=>{
      const woMatch = (r.wagonOut||'').split(',').map(w=>w.trim()).some(w=>tPkW.has(w));
      const coMatch = (r.cartOut ||'').split(',').map(w=>w.trim()).some(w=>tPkC.has(w));
      return woMatch || coMatch;
    });
    const tShW = new Set(tSh.flatMap(r=>(r.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean)));
    // 자숙: 파쇄 wagonIn → wagonOut → cage 추출
    const tCk  = ckD.filter(r=>(r.wagonOut||'').split(',').map(w=>w.trim()).some(w=>tShW.has(w)));
    const tCkC = new Set(tCk.flatMap(r=>(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean)));
    // 전처리: cage 매칭 → 해동 wagons 추출
    const tPp  = ppD.filter(r=>(r.cage||'').split(',').map(c=>c.trim()).some(c=>tCkC.has(c)));
    const tPpW = new Set(tPp.flatMap(r=>(r.wagons||'').split(',').map(w=>w.trim()).filter(Boolean)));

    tPp.forEach(r => testPpIds.add(r.fbId||r.id));
    if(!testThWByDate[d]) testThWByDate[d] = new Set();
    tPpW.forEach(w => testThWByDate[d].add(w));
  });

  // ③ ppMonth에서 테스트 전처리 레코드 제거
  const ppMonthClean = (ppMonth||[]).filter(r => !testPpIds.has(r.fbId||r.id));

  // ④ thMonth에서 테스트 해동 와건 제거 (해동 날짜·익일 모두 체크)
  const thMonthClean = (thMonth||[]).filter(r => {
    const thD = String(r.date||'').slice(0,10);
    const w   = (r.cart||'').trim();
    if(!w) return true;
    if(testThWByDate[thD] && testThWByDate[thD].has(w)) return false;
    const nextD = (()=>{const dt=new Date(thD);dt.setDate(dt.getDate()+1);return dt.toISOString().slice(0,10);})();
    if(testThWByDate[nextD] && testThWByDate[nextD].has(w)) return false;
    return true;
  });
  // ─────────────────────────────────────────────────────────────────────────────
  renderMonthlyReport(pkReport, from, effectiveTo, ppMonthClean, thMonthClean, opReal, ckMonth, shMonth);
}

// 월간 생산 일보 렌더
async function renderMonthlyReport(pk, from, effectiveTo, ppMonth, thMonth, opData, ckMonth, shMonth) {
  const tbody = document.getElementById('mo_report_tbl');
  const tfoot = document.getElementById('mo_report_total');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--g4);padding:1rem">계산 중...</td></tr>';

  const ym = _moYm || tod().slice(0,7);
  const metaKey = 'moMeta_' + ym;
  // [메타 로드] firestore 우선, 없으면 localStorage fallback + 자동 마이그레이션
  let metaMap = await _moLoadMeta(ym);

  // 날짜별 + 제품별 집계 (작업인원 포함)
  const byDateProd = {};
  pk.forEach(r => {
    const d = String(r.date||'').slice(0,10);
    const prod = r.product||'기타';
    const key = d+'|'+prod;
    if(!byDateProd[key]) byDateProd[key] = {date:d, product:prod, ea:0, pkKg:0, workers:0};
    byDateProd[key].ea += parseFloat(r.ea)||0;
    const p = L.products.find(x=>x.name===prod);
    byDateProd[key].pkKg += p ? (parseFloat(r.ea)||0)*p.kgea : 0;
    byDateProd[key].workers = Math.max(byDateProd[key].workers, parseFloat(r.workers)||0);
  });

  // 날짜 목록
  const uniqueDates = [...new Set(Object.values(byDateProd).map(r=>r.date))].sort();

  // 날짜별 원육 투입
  const rmByDate = {};
  const rmByDatePart = {};  // {YYYY-MM-DD: {우둔: kg, 홍두깨: kg, ...}}
  for(const d of uniqueDates) {
    const ppDay=(ppMonth||[]).filter(r=>String(r.date||'').slice(0,10)===d);
    rmByDate[d] = getThKgByPP_(ppDay, thMonth||[], d);
    rmByDatePart[d] = getThByPartByPP_(ppDay, thMonth||[], d);
  }

  // 날짜별 그룹핑
  const rows = Object.values(byDateProd).sort((a,b)=>a.date===b.date?a.product.localeCompare(b.product):a.date.localeCompare(b.date));
  const grouped = {};
  rows.forEach(row => {
    if(!grouped[row.date]) grouped[row.date] = [];
    grouped[row.date].push(row);
  });
  const dayEntries = Object.entries(grouped).sort((a,b)=>a[0].localeCompare(b[0]));

  // 외포장 EA 맵 빌드: "YYYY-MM-DD|제품명" → outerEa 합계
  const opMap = {};
  (opData||[]).filter(r=>!r.testRun&&!r.isTest).forEach(r=>{
    const dk = (String(r.date||'').slice(0,10))+'|'+(r.product||'');
    opMap[dk] = (opMap[dk]||0) + opEa(r);
  });

  // 글로벌 저장 (필터용)
  window._moGD = { dayEntries, rmByDate, opMap, metaMap, thMonth: thMonth||[], ppMonth: ppMonth||[], metaKey };
  _moRenderRows(null);
  renderPackingChart(dayEntries, opMap, _moYm || tod().slice(0,7));
  // 일별 원육 사용량 차트
  window._moRmByDate = rmByDate;
  window._moRmByDatePart = rmByDatePart;
  if(typeof _moRenderRmChart === 'function'){
    _moRenderRmChart(rmByDate, _moYm || tod().slice(0,7), rmByDatePart);
  }

  // ── 수율 KPI 계산 ─────────────────────────────────────────
  {
    let moTotRm=0, moTotPkKg=0, moDays=0, moGoodDays=0;
    const dailyYields=[];
    dayEntries.forEach(([date, allR])=>{
      const dayRm=r2(rmByDate[date]||0);
      if(!dayRm) return;
      const effPkM={};
      allR.forEach(row=>{
        const oe=opMap[date+'|'+row.product]||0;
        const p=L.products.find(x=>x.name===row.product);
        effPkM[row.product]=oe>0&&p?r2(oe*p.kgea):row.pkKg;
      });
      const totalAllPk=r2(allR.reduce((s,r)=>s+(effPkM[r.product]||0),0));
      const dayPkKg=totalAllPk;
      moTotRm+=dayRm; moTotPkKg+=dayPkKg; moDays++;
      const yld=dayPkKg/dayRm*100;
      if(yld>=52) moGoodDays++;
      dailyYields.push({date, yld});
    });
    const moAvgYld=moTotRm>0?moTotPkKg/moTotRm*100:0;
    const moLossKg=r2(moTotRm*(0.55-moAvgYld/100));
    _moRenderYieldKPI(moTotRm, moTotPkKg, moAvgYld, moDays, moGoodDays, moLossKg);
    _moRenderYieldChart(dailyYields);

    // ★ 동일 작업일 탭용 — cur 일별 공정 합계 (전처리/자숙/파쇄/완제품 + 원육)
    const _curWorkDates = dayEntries.map(([d]) => d).filter(d => rmByDate[d]).sort();
    const _curByWorkDay = _curWorkDates.map((date, i) => {
      const rm = r2(rmByDate[date]||0);
      const ppKg = (ppMonth||[]).filter(r=>String(r.date||'').slice(0,10)===date).reduce((s,r)=>s+(parseFloat(r.kg)||0), 0);
      const ckKg = (ckMonth||[]).filter(r=>String(r.date||'').slice(0,10)===date).reduce((s,r)=>s+(parseFloat(r.kg)||0), 0);
      const shKg = (shMonth||[]).filter(r=>String(r.date||'').slice(0,10)===date).reduce((s,r)=>s+(parseFloat(r.kg)||0), 0);
      // 완제품 = dayEntries에서 이미 계산
      const dayEntry = dayEntries.find(([d]) => d === date);
      const allR = dayEntry ? dayEntry[1] : [];
      const effPkM = {};
      allR.forEach(row=>{
        const oe = opMap[date+'|'+row.product]||0;
        const p = L.products.find(x=>x.name===row.product);
        effPkM[row.product] = oe>0&&p ? r2(oe*p.kgea) : row.pkKg;
      });
      const pkKg = r2(allR.reduce((s,r)=>s+(effPkM[r.product]||0),0));
      return { idx:i+1, date, rm, ppKg, ckKg, shKg, pkKg };
    });
    window._moCurByWorkDay = _curByWorkDay;
    _moLoadAndRenderPrevCmp(moAvgYld, moTotRm, moTotPkKg, moDays);
    // KPI 일평균 원육 사용량
    setText('mo_avg', moDays>0?(moTotRm/moDays).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1}):'—');
  }

  /* ── DEAD CODE PLACEHOLDER (do not remove – replaced by _moRenderRows) ── */
  if(false) { let dayNo=0; dayEntries.forEach(([date, dayRows]) => {
    const cnt      = dayRows.length;
    const dayRm    = r2(rmByDate[date]||0);
    const dayPkKg  = r2(dayRows.reduce((s,r)=>s+r.pkKg,0));
    const dayYld   = dayRm>0 ? dayPkKg/dayRm*100 : null;
    const dow      = ['일','월','화','수','목','금','토'][new Date(date).getDay()];
    const meta     = metaMap[date]||{};
    const bg       = dayBg[(dayNo-1)%2];

    // 수율 색상 + 배경
    const yldTxt   = dayYld==null?'color:#aaa;':dayYld>=55?'color:#047857;':dayYld>=52?'color:#1d4ed8;':dayYld>=50?'color:#c2410c;':'color:#b91c1c;';
    const yldBg    = dayYld==null?bg:dayYld>=55?'background:#ecfdf5;':dayYld>=52?'background:#eff6ff;':dayYld>=50?'background:#fff7ed;':'background:#fef2f2;';

    // 작업인원
    const autoW    = dayRows.reduce((mx,r)=>Math.max(mx,r.workers||0),0);
    const workers  = meta.workers!=null ? meta.workers : (autoW||'');
    // Full Capa
    const firstProd = L.products.find(x=>x.name===dayRows[0].product);
    const autoCapa  = firstProd&&firstProd.capa ? firstProd.capa.toLocaleString() : '';
    const capa      = meta.capa!=null ? meta.capa : autoCapa;
    const note      = meta.note!=null ? meta.note : '';

    // 원육종류 배지
    const thDay    = (thMonth||[]).filter(r=>String(r.date||'').slice(0,10)===date);
    const meatParts= [...new Set(thDay.flatMap(r=>(r.type||'').split(',').map(s=>s.trim()).filter(Boolean)))];
    const meatStr  = meatParts.length
      ? meatParts.map(p=>`<span style="display:inline-block;background:#dbeafe;color:#1e40af;border-radius:3px;padding:1px 6px;font-size:11px;font-weight:600;white-space:nowrap;margin:1px 2px">${p}</span>`).join('')
      : '<span style="color:#ccc">—</span>';

    totRm   += dayRm;
    totPkKg += dayPkKg;

    const mkEdit = (field, val, display, style='') =>
      `<span class="mo-edit" data-date="${date}" data-field="${field}" title="클릭하여 수정" style="cursor:pointer;border-bottom:1px dashed #aaa;${style}">${display}</span>`;

    const editW    = mkEdit('workers', workers, workers||'—') + '명';
    const editCapa = mkEdit('capa', capa, capa||'—');
    const editNote = mkEdit('note', note, note||'＋메모', 'font-size:12px;color:#999;display:inline-block;min-width:40px');

    dayRows.forEach((row, ri) => {
      const isFirst   = ri===0;
      const isLast    = ri===cnt-1;
      const rowBorder = isLast ? 'border-bottom:2px solid #cbd5e1;' : 'border-bottom:1px solid #e2e8f0;';
      const pkDisp    = fmtKg(r2(row.pkKg));

      let cells = '';

      if(isFirst) {
        // 일수
        cells += `<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;font-weight:700;font-size:15px;color:#1e293b;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1;">${dayNo}</td>`;
        // 생산일자
        cells += `<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1;line-height:1.5">
          <span style="font-weight:600;font-size:13px;color:#334155">${date.slice(5).replace('-','/')}</span><br>
          <span style="font-size:10px;color:#94a3b8">(${dow})</span></td>`;
        // 작업인원 (생산일자 바로 다음)
        cells += `<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;color:#475569;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${editW}</td>`;
        // 원육종류
        cells += `<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${meatStr}</td>`;
      }

      // 제품명 (행마다)
      cells += `<td style="${vm}${PC}${bg}text-align:center;font-weight:500;color:#1e293b;border-right:1px solid #e2e8f0;${rowBorder}">${row.product}</td>`;
      // 생산량(EA): 외포장 완료분 우선, 없으면 내포장 수량
      const _opKey = date+'|'+row.product;
      const _opEa  = opMap[_opKey]||0;
      const _dispEa = _opEa>0 ? _opEa : (row.ea>0?Math.round(row.ea):0);
      const _eaLabel = _opEa>0
        ? `${_dispEa.toLocaleString()}<span style="font-size:10px;color:#6b7280;margin-left:2px">(외)</span>`
        : (_dispEa>0 ? `${_dispEa.toLocaleString()}<span style="font-size:10px;color:#9ca3af;margin-left:2px">(내)</span>` : '—');
      cells += `<td style="${vm}${PC}${bg}text-align:center;font-variant-numeric:tabular-nums;color:#374151;border-right:1px solid #e2e8f0;${rowBorder}">${_eaLabel}</td>`;
      // 완제품 중량(KG) (행마다)
      cells += `<td style="${vm}${PC}${bg}text-align:center;font-weight:600;font-variant-numeric:tabular-nums;color:#374151;border-right:1px solid #e2e8f0;${rowBorder}">${pkDisp}</td>`;

      if(isFirst) {
        // 원육사용량
        cells += `<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;font-variant-numeric:tabular-nums;color:#374151;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${fmtKg(dayRm)}</td>`;
        // 원육수율
        cells += `<td rowspan="${cnt}" style="${vm}${PC}${yldBg}text-align:center;font-weight:700;font-size:15px;${yldTxt}border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${dayYld!=null?dayYld.toFixed(1)+'%':'—'}</td>`;
        // Full Capa
        cells += `<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;color:#64748b;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${editCapa}</td>`;
        // 비고
        cells += `<td rowspan="${cnt}" style="${vm}${P}${bg}text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #cbd5e1;white-space:pre-wrap">${editNote}</td>`;
      }

      htmlParts.push(`<tr>${cells}</tr>`);
    });
    dayNo++;
  });

  tbody.innerHTML = htmlParts.join('') || `<tr><td colspan="11" style="text-align:center;color:#aaa;padding:2rem">데이터 없음</td></tr>`;

  // 합계 행
  const totYld = totRm>0 ? (totPkKg/totRm*100).toFixed(1)+'%' : '—';
  if(tfoot) tfoot.innerHTML = `<tr style="background:#1e293b;color:#fff;font-weight:700">
    <td colspan="3" style="padding:10px 8px;text-align:center;font-size:13px;letter-spacing:.5px">합 계 (${dayNo-1}일)</td>
    <td style="padding:10px 8px;border-left:1px solid #334155"></td>
    <td style="padding:10px 8px;border-left:1px solid #334155"></td>
    <td style="padding:10px 8px;border-left:1px solid #334155"></td>
    <td style="padding:10px 8px;text-align:center;border-left:1px solid #334155;font-variant-numeric:tabular-nums">${fmtKg(totPkKg)}</td>
    <td style="padding:10px 8px;text-align:center;border-left:1px solid #334155;font-variant-numeric:tabular-nums">${fmtKg(totRm)}</td>
    <td style="padding:10px 8px;text-align:center;border-left:1px solid #334155;color:#fcd34d">${totYld}</td>
    <td colspan="2" style="border-left:1px solid #334155"></td>
  </tr>`; } /* end if(false) dead code */

  // 필터 바 빌드
  const _fbar = document.getElementById('mo_filter_bar');
  if(_fbar) {
    const _allProds = [...new Set(dayEntries.flatMap(([,rs])=>rs.map(r=>r.product)))].sort();
    window._moFilterSel = new Set();
    _fbar.style.display = 'flex';
    _fbar.innerHTML = `<span style="font-size:12px;color:#64748b;font-weight:600;white-space:nowrap;padding:3px 4px">제품 필터:</span>`
      + _allProds.map(p=>`<button onclick="window._moToggleFilter(this,'${p.replace(/'/g,"\\'")}')" data-prod="${p.replace(/"/g,'&quot;')}" style="padding:3px 10px;border-radius:14px;border:1.5px solid #cbd5e1;background:#f1f5f9;color:#475569;font-size:12px;cursor:pointer">${p}</button>`).join('')
      + `<button onclick="window._moClearFilter()" style="padding:3px 10px;border-radius:14px;border:1.5px solid #94a3b8;background:#fff;color:#64748b;font-size:12px;cursor:pointer;margin-left:4px">전체</button>`;
  }

  // 엑셀용 캐시
  window._moReportRows = [];
  dayEntries.forEach(([date, dayRows]) => {
    const dayRm  = r2(rmByDate[date]||0);
    const dayPkKg= r2(dayRows.reduce((s,r)=>s+r.pkKg,0));
    const dayYld = dayRm>0?(dayPkKg/dayRm*100).toFixed(1)+'%':'—';
    const meta   = metaMap[date]||{};
    const autoW  = dayRows.reduce((mx,r)=>Math.max(mx,r.workers||0),0);
    const workers= meta.workers!=null?meta.workers:(autoW||'');
    const fp     = L.products.find(x=>x.name===dayRows[0].product);
    const capa   = meta.capa!=null?meta.capa:(fp&&fp.capa?fp.capa.toLocaleString():'');
    const note   = meta.note!=null?meta.note:'';
    const thD    = (thMonth||[]).filter(r=>String(r.date||'').slice(0,10)===date);
    const meatEx = [...new Set(thD.flatMap(r=>(r.type||'').split(',').map(s=>s.trim()).filter(Boolean)))].join(', ');
    dayRows.forEach((row, ri) => {
      window._moReportRows.push({
        dayNo:   ri===0 ? (dayEntries.findIndex(([d])=>d===date)+1) : '',
        date:    ri===0 ? date : '',
        product: row.product,
        meat:    ri===0 ? meatEx : '',
        workers: ri===0 ? workers : '',
        rm:      ri===0 ? (dayRm>0?dayRm.toFixed(1):'') : '',
        pkKg:    row.pkKg>0 ? r2(row.pkKg).toFixed(1) : '',
        yld:     ri===0 ? dayYld : '',
        capa:    ri===0 ? capa : '',
        note:    ri===0 ? note : ''
      });
    });
  });

  // 인라인 편집 이벤트 바인딩
  tbody.querySelectorAll('.mo-edit').forEach(el => {
    el.addEventListener('click', async function() {
      const field = this.dataset.field;
      const date  = this.dataset.field === 'note' ? this.dataset.date : this.dataset.date;
      const labels = {workers:'작업 인원 (명)', capa:'Full Capa (예: 10,000)', note:'비고'};
      // ★ 메모리 캐시(=Firestore 최신)에서 읽음. localStorage 의존 X
      const cacheData = _moMetaCache[ym] || {};
      let cur = (cacheData[date] || {})[field] || '';
      const val = prompt(labels[field]+' 입력 (비우면 자동값 사용):', cur);
      if(val===null) return;
      // ★ 캐시 deep copy해서 변경 (원본 변경 방지)
      const mm = JSON.parse(JSON.stringify(cacheData));
      if(!mm[date]) mm[date]={};
      if(val.trim()==='') {
        delete mm[date][field];
        if(Object.keys(mm[date]).length===0) delete mm[date];
      } else {
        mm[date][field] = (field==='note') ? val : (parseFloat(val.replace(/,/g,''))||val);
      }
      try {
        await _moSaveMeta(ym, mm);
        renderMonthly();
      } catch(e) {
        if(typeof toast === 'function') toast('저장 실패: ' + e.message, 'd');
        console.error('[월간메모 저장 실패]', e);
      }
    });
  });
}

// ── 월간 보고서 테이블 렌더 (필터 적용) ─────────────────────────────────────
function _moRenderRows(selProds) {
  const tbody = document.getElementById('mo_report_tbl');
  const tfoot = document.getElementById('mo_report_total');
  if(!tbody || !window._moGD) return;
  const {dayEntries, rmByDate, opMap, metaMap, thMonth, ppMonth, metaKey} = window._moGD;
  const fmtKg = v => v>0 ? v.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1}) : '—';
  const PC='padding:8px 8px;', P='padding:8px 10px;', vm='vertical-align:middle;';
  const dayBg=['background:#ffffff;','background:#f8fafc;'];
  let dayNo=1, totRm=0, totPkKg=0, totEa=0;
  const html=[];

  dayEntries.forEach(([date, allRows])=>{
    const dayRows = selProds&&selProds.size>0 ? allRows.filter(r=>selProds.has(r.product)) : allRows;
    if(!dayRows.length) return;
    const cnt    = dayRows.length;
    const dayRm  = r2(rmByDate[date]||0);
    // 외포장 EA 기준으로 완제품 중량 재계산 (필터 포함 전체 행 대상)
    const effPkMap = {};
    allRows.forEach(row=>{
      const _opEa2 = opMap[date+'|'+row.product]||0;
      const _p2 = L.products.find(x=>x.name===row.product);
      effPkMap[row.product] = _opEa2>0&&_p2 ? r2(_opEa2*_p2.kgea) : row.pkKg;
    });
    const totalAllPkKg = r2(allRows.reduce((s,r)=>s+(effPkMap[r.product]||0),0));
    const dayPkKg = r2(dayRows.reduce((s,r)=>s+(effPkMap[r.product]||0),0));
    // 비례 배분: 필터된 제품 비중만큼 원육 배분
    const propRm  = totalAllPkKg>0 ? r2(dayRm*(dayPkKg/totalAllPkKg)) : dayRm;
    const dayYld  = propRm>0 ? dayPkKg/propRm*100 : null;
    const dow    = ['일','월','화','수','목','금','토'][new Date(date).getDay()];
    const meta   = metaMap[date]||{};
    const bg     = dayBg[(dayNo-1)%2];
    const yldTxt = dayYld==null?'color:#aaa;':dayYld>=55?'color:#047857;':dayYld>=52?'color:#1d4ed8;':dayYld>=50?'color:#c2410c;':'color:#b91c1c;';
    const yldBg  = dayYld==null?bg:dayYld>=55?'background:#ecfdf5;':dayYld>=52?'background:#eff6ff;':dayYld>=50?'background:#fff7ed;':'background:#fef2f2;';
    const autoW  = allRows.reduce((mx,r)=>Math.max(mx,r.workers||0),0);
    const workers= meta.workers!=null?meta.workers:(autoW||'');
    const firstProd=L.products.find(x=>x.name===allRows[0].product);
    const capa   = meta.capa!=null?meta.capa:(firstProd&&firstProd.capa?firstProd.capa.toLocaleString():'');
    const note   = meta.note!=null?meta.note:'';
    const thDay  = thMonth.filter(r=>String(r.date||'').slice(0,10)===date);
    // 그날 모든 제품이 무육(메추리알 등)이면 부위 표시 안 함
    const _isAllNoMeat = dayRows.length>0 && dayRows.every(r => /메추리알/.test(r.product||''));
    let meatParts = _isAllNoMeat ? [] : [...new Set(thDay.flatMap(r=>(r.type||'').split(',').map(s=>s.trim()).filter(Boolean)))];
    // 방혈 type 없으면 전처리 type으로 fallback
    if(!meatParts.length && ppMonth && !_isAllNoMeat){
      const ppDay=(ppMonth||[]).filter(r=>String(r.date||'').slice(0,10)===date);
      meatParts=[...new Set(ppDay.flatMap(r=>(r.type||'').split(',').map(s=>s.trim()).filter(Boolean)))];
    }
    const meatStr= meatParts.length
      ? meatParts.map(p=>`<span style="display:inline-block;background:#dbeafe;color:#1e40af;border-radius:3px;padding:1px 6px;font-size:11px;font-weight:600;white-space:nowrap;margin:1px 2px">${p}</span>`).join('')
      : '<span style="color:#ccc">—</span>';
    totRm+=propRm; totPkKg+=dayPkKg;
    const mkEdit=(field,val,display,style='')=>`<span class="mo-edit" data-date="${date}" data-field="${field}" title="클릭하여 수정" style="cursor:pointer;border-bottom:1px dashed #aaa;${style}">${display}</span>`;
    const editW   =mkEdit('workers',workers,workers||'—')+'명';
    const editCapa=mkEdit('capa',capa,capa||'—');
    const editNote=mkEdit('note',note,note||'＋메모','font-size:12px;color:#999;display:inline-block;min-width:40px');

    dayRows.forEach((row,ri)=>{
      const isFirst=ri===0, isLast=ri===cnt-1;
      const rowBorder=isLast?'border-bottom:2px solid #cbd5e1;':'border-bottom:1px solid #e2e8f0;';
      const pkDisp=fmtKg(effPkMap[row.product]||r2(row.pkKg));
      let cells='';
      if(isFirst){
        cells+=`<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;font-weight:700;font-size:15px;color:#1e293b;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1;">${dayNo}</td>`;
        cells+=`<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1;line-height:1.5"><span style="font-weight:600;font-size:13px;color:#334155">${date.slice(5).replace('-','/')}</span><br><span style="font-size:10px;color:#94a3b8">(${dow})</span></td>`;
        cells+=`<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;color:#475569;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${editW}</td>`;
        cells+=`<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${meatStr}</td>`;
      }
      cells+=`<td style="${vm}${PC}${bg}text-align:center;font-weight:500;color:#1e293b;border-right:1px solid #e2e8f0;${rowBorder}">${row.product}</td>`;
      if(isFirst){
        cells+=`<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;font-variant-numeric:tabular-nums;color:#374151;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${fmtKg(propRm)}</td>`;
      }
      const _opEa=opMap[date+'|'+row.product]||0;
      const _dispEa=_opEa>0?_opEa:(row.ea>0?Math.round(row.ea):0);
      totEa+=_dispEa;
      const _lbl=_opEa>0?`${_dispEa.toLocaleString()}<span style="font-size:10px;color:#6b7280;margin-left:2px">(외)</span>`:(_dispEa>0?`${_dispEa.toLocaleString()}<span style="font-size:10px;color:#9ca3af;margin-left:2px">(내)</span>`:'—');
      cells+=`<td style="${vm}${PC}${bg}text-align:center;font-variant-numeric:tabular-nums;color:#374151;border-right:1px solid #e2e8f0;${rowBorder}">${_lbl}</td>`;
      cells+=`<td style="${vm}${PC}${bg}text-align:center;font-weight:600;font-variant-numeric:tabular-nums;color:#374151;border-right:1px solid #e2e8f0;${rowBorder}">${pkDisp}</td>`;
      if(isFirst){
        cells+=`<td rowspan="${cnt}" style="${vm}${PC}${yldBg}text-align:center;font-weight:700;font-size:15px;${yldTxt}border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${dayYld!=null?dayYld.toFixed(1)+'%':'—'}</td>`;
        cells+=`<td rowspan="${cnt}" style="${vm}${PC}${bg}text-align:center;color:#64748b;border-right:1px solid #e2e8f0;border-bottom:2px solid #cbd5e1">${editCapa}</td>`;
        cells+=`<td rowspan="${cnt}" style="${vm}${P}${bg}text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #cbd5e1;white-space:pre-wrap">${editNote}</td>`;
      }
      html.push(`<tr>${cells}</tr>`);
    });
    dayNo++;
  });

  tbody.innerHTML=html.join('')||`<tr><td colspan="11" style="text-align:center;color:#aaa;padding:2rem">데이터 없음</td></tr>`;

  const totYld=totRm>0?(totPkKg/totRm*100).toFixed(1)+'%':'—';
  const selLabel=selProds&&selProds.size>0?` [${[...selProds].join(' + ')}]`:'';
  if(tfoot) tfoot.innerHTML=`<tr style="background:#1e293b;color:#fff;font-weight:700">
    <td colspan="5" style="padding:10px 8px;text-align:center;font-size:13px;letter-spacing:.5px">합 계 (${dayNo-1}일)${selLabel}</td>
    <td style="padding:10px 8px;text-align:center;border-left:1px solid #334155;font-variant-numeric:tabular-nums">${fmtKg(totRm)}</td>
    <td style="padding:10px 8px;text-align:center;border-left:1px solid #334155;font-variant-numeric:tabular-nums">${totEa>0?totEa.toLocaleString():'—'}</td>
    <td style="padding:10px 8px;text-align:center;border-left:1px solid #334155;font-variant-numeric:tabular-nums">${fmtKg(totPkKg)}</td>
    <td style="padding:10px 8px;text-align:center;border-left:1px solid #334155;color:#fcd34d">${totYld}</td>
    <td colspan="2" style="border-left:1px solid #334155"></td>
  </tr>`;

  // 인라인 편집 이벤트 재바인딩
  tbody.querySelectorAll('.mo-edit').forEach(el=>{
    el.addEventListener('click',async function(){
      const field=this.dataset.field, date=this.dataset.date;
      const labels={workers:'작업 인원 (명)',capa:'Full Capa (예: 10,000)',note:'비고'};
      // ★ 메모리 캐시(=Firestore 최신)에서 읽음
      const cacheData = _moMetaCache[ym] || {};
      let cur = (cacheData[date]||{})[field] || '';
      const val=prompt(labels[field]+' 입력 (비우면 자동값 사용):',cur);
      if(val===null) return;
      const mm = JSON.parse(JSON.stringify(cacheData));
      if(!mm[date]) mm[date]={};
      if(val.trim()===''){
        delete mm[date][field];
        if(Object.keys(mm[date]).length===0) delete mm[date];
      } else {
        mm[date][field]=(field==='note')?val:(parseFloat(val.replace(/,/g,''))||val);
      }
      try {
        await _moSaveMeta(ym, mm);
        renderMonthly();
      } catch(e) {
        if(typeof toast === 'function') toast('저장 실패: ' + e.message, 'd');
        console.error('[월간메모 저장 실패]', e);
      }
    });
  });
}

// 제품 필터 토글
window._moToggleFilter = function(btn, prod) {
  if(!window._moFilterSel) window._moFilterSel=new Set();
  if(window._moFilterSel.has(prod)) window._moFilterSel.delete(prod);
  else window._moFilterSel.add(prod);
  document.querySelectorAll('#mo_filter_bar button[data-prod]').forEach(b=>{
    const active=window._moFilterSel.has(b.getAttribute('data-prod'));
    b.style.background=active?'#1e293b':'#f1f5f9';
    b.style.color=active?'#fff':'#475569';
    b.style.borderColor=active?'#1e293b':'#cbd5e1';
  });
  _moRenderRows(window._moFilterSel.size>0?window._moFilterSel:null);
};
window._moClearFilter = function() {
  window._moFilterSel=new Set();
  document.querySelectorAll('#mo_filter_bar button[data-prod]').forEach(b=>{
    b.style.background='#f1f5f9'; b.style.color='#475569'; b.style.borderColor='#cbd5e1';
  });
  _moRenderRows(null);
};

// ── 수율 KPI 카드 렌더 ──────────────────────────────────────
function _moRenderYieldKPI(totRm, totPkKg, avgYld, workDays, goodDays, lossKg) {
  const el=document.getElementById('mo_yield_kpi');
  if(!el) return;
  const _T = (typeof getTargets === 'function') ? getTargets() : {yieldGoal:55, yieldDanger:50};
  const _G = _T.yieldGoal;  // 목표 (예: 55)
  const _D = _T.yieldDanger;  // 위험 (예: 50)
  const _W = _G - 3;  // 주의 (목표-3, 예: 52)
  const yldColor=avgYld>=_G?'#047857':avgYld>=_W?'#1d4ed8':avgYld>=_D?'#c2410c':'#b91c1c';
  const yldBg=avgYld>=_G?'#ecfdf5':avgYld>=_W?'#eff6ff':avgYld>=_D?'#fff7ed':'#fef2f2';
  const lossIsGain=lossKg<=0;
  const lossColor=lossIsGain?'#047857':'#b91c1c';
  const lossIcon=lossIsGain?'▲':'▼';
  const lossLabel=lossIsGain?'목표 초과 절감':'목표 대비 손실';
  const pct=Math.min(100,avgYld>0?avgYld/_G*100:0);
  const fmt=v=>v>0?v.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1}):'—';
  el.innerHTML=`
    <div class="card" style="text-align:center;padding:16px 10px">
      <div style="font-size:11px;color:var(--g5);margin-bottom:6px">총 원육 사용량</div>
      <div style="font-size:24px;font-weight:700;color:#1e293b">${fmt(totRm)}</div>
      <div style="font-size:11px;color:var(--g4);margin-top:3px">KG · ${workDays}작업일</div>
    </div>
    <div class="card" style="padding:14px 10px;background:${yldBg}">
      <div style="font-size:11px;color:#64748b;margin-bottom:4px;text-align:center">평균 원육수율</div>
      <div style="font-size:28px;font-weight:700;color:${yldColor};text-align:center">${avgYld>0?avgYld.toFixed(1)+'%':'—'}</div>
      <div style="margin-top:8px;background:#e2e8f0;border-radius:4px;height:6px;overflow:hidden">
        <div style="height:100%;width:${pct.toFixed(1)}%;background:${yldColor};border-radius:4px"></div>
      </div>
      <div style="font-size:10px;color:#94a3b8;margin-top:3px;text-align:right">목표 ${_G}% 기준 ${pct.toFixed(0)}%</div>
    </div>
    <div class="card" style="text-align:center;padding:16px 10px">
      <div style="font-size:11px;color:var(--g5);margin-bottom:6px">${lossLabel}</div>
      <div style="font-size:24px;font-weight:700;color:${lossColor}">${lossIcon}${fmt(Math.abs(lossKg))}</div>
      <div style="font-size:11px;color:var(--g4);margin-top:3px">KG (${_G}% 기준 대비)</div>
    </div>
    <div class="card" style="text-align:center;padding:16px 10px">
      <div style="font-size:11px;color:var(--g5);margin-bottom:6px">수율 ${_W}% 이상 달성</div>
      <div style="font-size:24px;font-weight:700;color:#1e293b">${goodDays}<span style="font-size:14px;color:var(--g4)"> / ${workDays}일</span></div>
      <div style="font-size:11px;color:var(--g4);margin-top:3px">${workDays>0?(goodDays/workDays*100).toFixed(0)+'% 달성':''}</div>
    </div>`;
}

// ── 수율 일별 추이 차트 ──────────────────────────────────────
// 전월 데이터 도착 후 불량률 차트 재그림
// 그 달 평일(월~금) 전체 날짜 목록 ('YYYY-MM-DD' 배열)
function _moWeekdaysOf(ym){
  const [yy, mm] = ym.split('-').map(Number);
  const last = new Date(yy, mm, 0).getDate();
  const arr = [];
  for(let day=1; day<=last; day++){
    const dt = new Date(yy, mm-1, day);
    const w = dt.getDay();
    if(w===0 || w===6) continue;
    arr.push(yy+'-'+String(mm).padStart(2,'0')+'-'+String(day).padStart(2,'0'));
  }
  return arr;
}

// 차트용 X축 평일: (생산한 날) + (오늘 이후 미래 평일). 오늘 이전 + 생산 안 한 날은 제외.
function _moChartWeekdays(ym, producedSet){
  const today = tod();
  return _moWeekdaysOf(ym).filter(d => {
    if(producedSet.has(d)) return true;   // 생산한 날 = 무조건 표시
    if(d >= today) return true;            // 오늘 이후 미래 = 표시 (앞으로 채워질 자리)
    return false;                          // 오늘 이전 + 생산 안 함 = 제외
  });
}

function _moRedrawDefChart(){
  const ctx2 = document.getElementById('mo_def_chart');
  if(!ctx2) return;
  const byDate = window._moCurByDate || {};
  if(!Object.keys(byDate).length) return;

  // X축 = 생산한 날 + 오늘 이후 평일.
  const ym = (window._moYm || tod().slice(0,7));
  const producedSet = new Set(Object.keys(byDate));
  const weekdays = _moChartWeekdays(ym, producedSet);
  const labels = weekdays.map((d,i) => [(i+1)+'일차', d.slice(5)]);
  const defVals = weekdays.map(d => {
    const v = byDate[d];
    if(!v) return null;
    const pouch = v.ea + v.def;
    return pouch>0 ? parseFloat((v.def/pouch*100).toFixed(2)) : null;
  });
  const xLen = weekdays.length;
  // 이번달 평균 (생산한 날 기준)
  const _curVals = defVals.filter(v => v!=null);
  const _curAvg = _curVals.length ? (_curVals.reduce((s,v)=>s+v,0)/_curVals.length) : null;
  const ds = [
    {label:'이번달 불량률',data:defVals,borderColor:'#e24b4a',backgroundColor:'rgba(226,75,74,0.08)',fill:true,tension:0.3,pointRadius:4,borderWidth:2,spanGaps:false}
  ];
  if(_curAvg!=null){
    ds.push({label:'이번달 평균',data:Array(xLen).fill(parseFloat(_curAvg.toFixed(2))),borderColor:'#7c3aed',borderDash:[2,3],pointRadius:0,borderWidth:1.5,fill:false,_endLabel:_curAvg.toFixed(2)+'%'});
  }
  const _avgDef = window._moPrevAvgDef;
  if(_avgDef!=null){
    ds.push({label:'전월 일평균',data:Array(xLen).fill(parseFloat(_avgDef.toFixed(2))),borderColor:'#94a3b8',borderDash:[5,4],pointRadius:0,borderWidth:1.5,fill:false,_endLabel:_avgDef.toFixed(2)+'%'});
  }
  const _T_def = (typeof getTargets === 'function') ? getTargets() : {defGoal:2};
  ds.push({label:'목표',data:Array(xLen).fill(_T_def.defGoal),borderColor:'#f59e0b',borderDash:[5,4],pointRadius:0,borderWidth:1.5,fill:false,_endLabel:_T_def.defGoal.toFixed(2)+'%'});
  if(_moDefChart){_moDefChart.destroy();_moDefChart=null;}
  _moDefChart = new Chart(ctx2,{type:'line',plugins:[
    {id:'lineLbl',afterDatasetsDraw(chart){
      const {ctx}=chart; ctx.save();
      const ds = chart.data.datasets[0], meta = chart.getDatasetMeta(0);
      if(!ds || !meta) { ctx.restore(); return; }
      ctx.font='bold 11px sans-serif';
      const _lastIdx = meta.data.length - 1;
      meta.data.forEach((pt,j)=>{
        const v=ds.data[j];
        if(v==null) return;
        const txt = (typeof v==='number'?v.toFixed(1):String(v))+'%';
        const w = ctx.measureText(txt).width + 8;
        const h = 16;
        const goUp = (j % 2 === 0);
        const cy = pt.y + (goUp ? -16 : 16);
        // 마지막 데이터 점 = end 라벨과 겹침 방지 위해 왼쪽으로 이동
        const _isLast = (j === _lastIdx);
        const _cx = _isLast ? (pt.x - w/2 - 4) : pt.x;  // 마지막은 점 왼쪽으로 박스 통째 이동
        const x = _cx - w/2, y = cy - h/2;
        const ptColor = (Array.isArray(ds.pointBackgroundColor) ? ds.pointBackgroundColor[j] : ds.pointBackgroundColor) || ds.borderColor || '#475569';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = ptColor;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        if(ctx.roundRect) ctx.roundRect(x, y, w, h, 4); else ctx.rect(x, y, w, h);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = ptColor;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(txt, _cx, cy);
      });
      ctx.restore();
    }},
    {id:'endLbl',afterDatasetsDraw(chart){
      const {ctx, chartArea}=chart; ctx.save();
      ctx.font='bold 11px sans-serif';
      // 1) 끝 라벨이 있는 dataset 모음
      const endItems = [];
      chart.data.datasets.forEach((d,i)=>{
        if(!d._endLabel) return;
        const meta = chart.getDatasetMeta(i).data;
        if(!meta.length) return;
        const lastPt = meta[meta.length-1];
        endItems.push({ y: lastPt.y, x: chartArea.right + 10, fromX: chartArea.right, text: ' '+d._endLabel, color: d.borderColor||'#475569', dash: d.borderDash||[], bw: d.borderWidth||1.5 });
      });
      // 2) Y 기준 정렬 후 겹침 방지 (최소 간격 14px)
      endItems.sort((a,b) => a.y - b.y);
      const MIN_GAP = 18;
      for(let i=1; i<endItems.length; i++){
        if(endItems[i].y - endItems[i-1].y < MIN_GAP){
          endItems[i].y = endItems[i-1].y + MIN_GAP;
        }
      }
      // 3) 그리기
      // 점선 연장 X — Chart.js가 그린 원래 점선만 사용 (계단 효과 방지)
      endItems.forEach(item => {
        ctx.fillStyle = item.color;
        ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillText(item.text, item.x, item.y);
      });
      ctx.restore();
    }}
  ],data:{labels:labels,datasets:ds},options:{responsive:true,maintainAspectRatio:false,
    layout:{padding:{left:20, right:170, top:50, bottom:14}},
    plugins:{legend:{display:true,position:'top',labels:{font:{size:11},boxWidth:12,usePointStyle:true,padding:30}},
             tooltip:{callbacks:{label:v=>v.raw!=null?v.raw+'%':'—'}}},
    scales:{x:{ticks:{color:'#888',font:{size:9},autoSkip:false,maxRotation:0},grid:{display:false}},
            y:{ticks:{color:'#888',font:{size:10},callback:v=>v+'%'},
               grid:{color:'rgba(128,128,128,0.1)'},min:0,grace:'15%'}}}});
}

function _moRenderYieldChart(dailyYields) {
  const canvas=document.getElementById('mo_yield_chart');
  if(!canvas) return;
  if(_moYieldChart){_moYieldChart.destroy();_moYieldChart=null;}
  if(!dailyYields.length) return;
  // 전역 저장 — 전월 데이터 도착 시 차트 다시 그리기
  window._moCurYldDays = dailyYields;
  // X축 = 생산한 날 + 오늘 이후 평일.
  const ym = (window._moYm || tod().slice(0,7));
  const yldMap = {};
  dailyYields.forEach(d => { yldMap[d.date] = d.yld; });
  const producedSet = new Set(Object.keys(yldMap));
  const weekdays = _moChartWeekdays(ym, producedSet);
  const labels = weekdays.map((d,i) => [(i+1)+'일차', d.slice(5)]);
  const ylds = weekdays.map(d => yldMap[d]!=null ? parseFloat(yldMap[d].toFixed(1)) : null);
  const ptColors = ylds.map(v => v==null?'transparent':v>=55?'#047857':v>=52?'#3b82f6':v>=50?'#f59e0b':'#ef4444');
  const xLen = weekdays.length;
  // 이번달 평균
  const _curVals = ylds.filter(v => v!=null);
  const _curAvg = _curVals.length ? (_curVals.reduce((s,v)=>s+v,0)/_curVals.length) : null;
  const datasets = [
    {label:'이번달 수율',data:ylds,borderColor:'#64748b',backgroundColor:'rgba(100,116,139,0.08)',fill:true,tension:0.3,pointRadius:5,pointBackgroundColor:ptColors,pointBorderColor:ptColors,borderWidth:2,spanGaps:false}
  ];
  if(_curAvg!=null){
    datasets.push({label:'이번달 평균',data:Array(xLen).fill(parseFloat(_curAvg.toFixed(1))),borderColor:'#7c3aed',borderDash:[2,3],pointRadius:0,borderWidth:1.5,fill:false,_endLabel:_curAvg.toFixed(1)+'%'});
  }
  const _avgYld = window._moPrevAvgYld;
  if(_avgYld!=null){
    datasets.push({label:'전월 일평균',data:Array(xLen).fill(parseFloat(_avgYld.toFixed(1))),borderColor:'#94a3b8',borderDash:[5,4],pointRadius:0,borderWidth:1.5,fill:false,_endLabel:_avgYld.toFixed(1)+'%'});
  }
  const _T_y = (typeof getTargets === 'function') ? getTargets() : {yieldGoal:55, yieldDanger:50};
  datasets.push(
    {label:'목표',data:Array(xLen).fill(_T_y.yieldGoal),borderColor:'#047857',borderDash:[6,3],pointRadius:0,borderWidth:1.5,fill:false,_endLabel:_T_y.yieldGoal.toFixed(0)+'%'},
    {label:'위험',data:Array(xLen).fill(_T_y.yieldDanger),borderColor:'#ef4444',borderDash:[4,3],pointRadius:0,borderWidth:1.5,fill:false,_endLabel:_T_y.yieldDanger.toFixed(0)+'%'}
  );
  _moYieldChart=new Chart(canvas,{plugins:[
    {id:'lineLbl',afterDatasetsDraw(chart){
      const {ctx}=chart; ctx.save();
      const ds = chart.data.datasets[0], meta = chart.getDatasetMeta(0);
      if(!ds || !meta) { ctx.restore(); return; }
      ctx.font='bold 11px sans-serif';
      const _lastIdx = meta.data.length - 1;
      meta.data.forEach((pt,j)=>{
        const v=ds.data[j];
        if(v==null) return;
        const txt = (typeof v==='number'?v.toFixed(1):String(v))+'%';
        const w = ctx.measureText(txt).width + 8;
        const h = 16;
        const goUp = (j % 2 === 0);
        const cy = pt.y + (goUp ? -16 : 16);
        // 마지막 데이터 점 = end 라벨과 겹침 방지 위해 왼쪽으로 이동
        const _isLast = (j === _lastIdx);
        const _cx = _isLast ? (pt.x - w/2 - 4) : pt.x;  // 마지막은 점 왼쪽으로 박스 통째 이동
        const x = _cx - w/2, y = cy - h/2;
        const ptColor = (Array.isArray(ds.pointBackgroundColor) ? ds.pointBackgroundColor[j] : ds.pointBackgroundColor) || ds.borderColor || '#475569';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = ptColor;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        if(ctx.roundRect) ctx.roundRect(x, y, w, h, 4); else ctx.rect(x, y, w, h);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = ptColor;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(txt, _cx, cy);
      });
      ctx.restore();
    }},
    {id:'endLbl',afterDatasetsDraw(chart){
      const {ctx, chartArea}=chart; ctx.save();
      ctx.font='bold 11px sans-serif';
      const endItems = [];
      chart.data.datasets.forEach((d,i)=>{
        if(!d._endLabel) return;
        const meta = chart.getDatasetMeta(i).data;
        if(!meta.length) return;
        const lastPt = meta[meta.length-1];
        endItems.push({ y: lastPt.y, x: chartArea.right + 10, fromX: chartArea.right, text: ' '+d._endLabel, color: d.borderColor||'#475569', dash: d.borderDash||[], bw: d.borderWidth||1.5 });
      });
      endItems.sort((a,b) => a.y - b.y);
      const MIN_GAP = 18;
      for(let i=1; i<endItems.length; i++){
        if(endItems[i].y - endItems[i-1].y < MIN_GAP){
          endItems[i].y = endItems[i-1].y + MIN_GAP;
        }
      }
      // 점선 연장 X — Chart.js가 그린 원래 점선만 사용 (계단 효과 방지)
      endItems.forEach(item => {
        ctx.fillStyle = item.color;
        ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillText(item.text, item.x, item.y);
      });
      ctx.restore();
    }}
  ],
    type:'line',
    data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,
      layout:{padding:{left:20, right:170, top:50, bottom:14}},
      plugins:{legend:{display:true,position:'top',labels:{font:{size:10},boxWidth:12,usePointStyle:true,padding:30}},
               tooltip:{callbacks:{label:v=>v.dataset.label+': '+v.raw+'%'}}},
      scales:{x:{ticks:{color:'#888',font:{size:9},autoSkip:false,maxRotation:0},grid:{display:false}},
              y:{ticks:{color:'#888',font:{size:10},callback:v=>v+'%'},
                 grid:{color:'rgba(128,128,128,0.1)'},min:44,suggestedMax:60}}}
  });
}

// ── 전월 비교 로드 + 렌더 ────────────────────────────────────
async function _moLoadAndRenderPrevCmp(curYld, curRm, curPkKg, curDays) {
  const el=document.getElementById('mo_prev_cmp');
  if(!el) return;
  const ym=_moYm||tod().slice(0,7);
  const [y,m]=ym.split('-').map(Number);
  const prevM=m===1?12:m-1, prevY=m===1?y-1:y;
  const prevYm=`${prevY}-${String(prevM).padStart(2,'0')}`;
  const prevFrom=prevYm+'-01';
  const prevLastDay=new Date(prevY,prevM,0).getDate();
  const prevTo=prevYm+'-'+String(prevLastDay).padStart(2,'0');
  const prevPrevFrom=(()=>{const dt=new Date(prevY,prevM-2,1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-01`;})();
  try {
    const [prevPk,prevPp,prevTh,prevOp,prevCk,prevSh]=await Promise.all([
      fbGetRange('packing',prevFrom,prevTo),
      fbGetRange('preprocess',prevFrom,prevTo),
      fbGetRange('thawing',prevPrevFrom,prevTo),
      fbGetRange('outerpacking',prevFrom,prevTo),
      fbGetRange('cooking',prevFrom,prevTo),
      fbGetRange('shredding',prevFrom,prevTo)
    ]);

    // ── testRun 체인 역추적 (이번달과 동일 로직) ──────────────────
    const _prevTestOpK = new Set(prevOp.filter(r=>r.testRun||r.isTest).map(r=>`${String(r.date||'').slice(0,10)}_${r.product||''}`));
    const _prevIsTestPk = r => r.testRun || r.isTest || _prevTestOpK.has(`${String(r.date||'').slice(0,10)}_${r.product||''}`);
    const _prevPkClean2 = prevPk.filter(r=>!_prevIsTestPk(r));

    const _prevTestPpIds = new Set();
    const _prevTestThWByDate = {};
    const _prevTestDates = [...new Set(prevPk.filter(_prevIsTestPk).map(r=>String(r.date||'').slice(0,10)))];
    _prevTestDates.forEach(d => {
      const tPkD = prevPk.filter(_prevIsTestPk).filter(r=>String(r.date||'').slice(0,10)===d);
      const shD  = (prevSh||[]).filter(r=>String(r.date||'').slice(0,10)===d);
      const ckD  = (prevCk||[]).filter(r=>String(r.date||'').slice(0,10)===d);
      const ppD  = (prevPp||[]).filter(r=>String(r.date||'').slice(0,10)===d);
      const tPkW = new Set(tPkD.flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()).filter(Boolean)));
      const tPkC = new Set(tPkD.flatMap(r=>(r.cart ||'').split(',').map(w=>w.trim()).filter(Boolean)));
      const tSh  = shD.filter(r=>{
        const woMatch = (r.wagonOut||'').split(',').map(w=>w.trim()).some(w=>tPkW.has(w));
        const coMatch = (r.cartOut ||'').split(',').map(w=>w.trim()).some(w=>tPkC.has(w));
        return woMatch || coMatch;
      });
      const tShW = new Set(tSh.flatMap(r=>(r.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean)));
      const tCk  = ckD.filter(r=>(r.wagonOut||'').split(',').map(w=>w.trim()).some(w=>tShW.has(w)));
      const tCkC = new Set(tCk.flatMap(r=>(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean)));
      const tPp  = ppD.filter(r=>(r.cage||'').split(',').map(c=>c.trim()).some(c=>tCkC.has(c)));
      const tPpW = new Set(tPp.flatMap(r=>(r.wagons||'').split(',').map(w=>w.trim()).filter(Boolean)));
      tPp.forEach(r => _prevTestPpIds.add(r.fbId||r.id));
      if(!_prevTestThWByDate[d]) _prevTestThWByDate[d] = new Set();
      tPpW.forEach(w => _prevTestThWByDate[d].add(w));
    });
    const _prevPpClean = (prevPp||[]).filter(r => !_prevTestPpIds.has(r.fbId||r.id));
    const _prevThClean = (prevTh||[]).filter(r => {
      const thD = String(r.date||'').slice(0,10);
      const w   = (r.cart||'').trim();
      if(!w) return true;
      if(_prevTestThWByDate[thD] && _prevTestThWByDate[thD].has(w)) return false;
      const nxt = (()=>{const dt=new Date(thD);dt.setDate(dt.getDate()+1);return dt.toISOString().slice(0,10);})();
      if(_prevTestThWByDate[nxt] && _prevTestThWByDate[nxt].has(w)) return false;
      return true;
    });
    // ─────────────────────────────────────────────────────

    const prevOpMap={};
    prevOp.filter(r=>!r.testRun&&!r.isTest).forEach(r=>{
      const dk=String(r.date||'').slice(0,10)+'|'+(r.product||'');
      prevOpMap[dk]=(prevOpMap[dk]||0)+opEa(r);
    });
    const prevBDP={};
    _prevPkClean2.forEach(r=>{
      const d=String(r.date||'').slice(0,10), prod=r.product||'기타', key=d+'|'+prod;
      if(!prevBDP[key]) prevBDP[key]={date:d,product:prod,pkKg:0};
      const p=L.products.find(x=>x.name===prod);
      prevBDP[key].pkKg+=p?(parseFloat(r.ea)||0)*p.kgea:0;
    });
    const prevGrouped={};
    Object.values(prevBDP).forEach(row=>{if(!prevGrouped[row.date])prevGrouped[row.date]=[];prevGrouped[row.date].push(row);});
    let pRm=0,pPk=0,pDays=0;
    Object.entries(prevGrouped).forEach(([date,allR])=>{
      const ppDay=_prevPpClean.filter(r=>String(r.date||'').slice(0,10)===date);
      const dayRm=r2(getThKgByPP_(ppDay,_prevThClean,date));
      if(!dayRm) return;
      const effM={};
      allR.forEach(row=>{const oe=prevOpMap[date+'|'+row.product]||0;const p=L.products.find(x=>x.name===row.product);effM[row.product]=oe>0&&p?r2(oe*p.kgea):row.pkKg;});
      pRm+=dayRm; pPk+=r2(allR.reduce((s,r)=>s+(effM[r.product]||0),0)); pDays++;
    });
    const pYld=pRm>0?pPk/pRm*100:0;
    _moRenderPrevCmp(el,{yld:curYld,rm:curRm,pkKg:curPkKg,days:curDays},{yld:pYld,rm:pRm,pkKg:pPk,days:pDays},prevYm);

    // ★ 전월 차트 데이터 만들기 — 생산 일수 인덱스 비교용
    // 전월 (생산한 날만) 일별 = 불량률 / 내포장 EA·KG / 수율
    const _prevPkClean = _prevPkClean2;  // 체인 역추적된 것 재사용 (단순 testRun 필터만 아님)
    const _pByDate = {};
    _prevPkClean.forEach(r => {
      const d = String(r.date||'').slice(0,10);
      if(!_pByDate[d]) _pByDate[d] = { ea:0, def:0, kg:0 };
      _pByDate[d].ea += parseFloat(r.ea)||0;
      _pByDate[d].def += parseFloat(r.defect)||0;
      const p = L.products.find(x=>x.name===r.product);
      _pByDate[d].kg += p ? (parseFloat(r.ea)||0)*p.kgea : 0;
    });
    const _pDates = Object.keys(_pByDate).sort();
    // 생산일 인덱스(1,2,3...) 기준 데이터
    const prevByIdx = _pDates.map((d, i) => {
      const v = _pByDate[d];
      const pouch = v.ea + v.def;
      return {
        idx: i+1,
        date: d,
        ea: v.ea,
        kg: v.kg,
        defectPct: pouch>0 ? parseFloat((v.def/pouch*100).toFixed(2)) : null
      };
    });
    // 전월 일별 수율 (그날 원육 대비 그날 산출) — 체인 제외 데이터 사용
    const _pYldByIdx = [];
    Object.entries(prevGrouped).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([date,allR]) => {
      const ppDay = _prevPpClean.filter(r=>String(r.date||'').slice(0,10)===date);
      const dayRm = r2(getThKgByPP_(ppDay,_prevThClean,date));
      if(!dayRm) return;
      const effM = {};
      allR.forEach(row=>{
        const oe = prevOpMap[date+'|'+row.product]||0;
        const p = L.products.find(x=>x.name===row.product);
        effM[row.product] = oe>0&&p ? r2(oe*p.kgea) : row.pkKg;
      });
      const dayPk = r2(allR.reduce((s,r)=>s+(effM[r.product]||0),0));
      _pYldByIdx.push({ date, yld: dayRm>0 ? dayPk/dayRm*100 : 0 });
    });

    window._moPrevByIdx = prevByIdx;
    window._moPrevYldByIdx = _pYldByIdx;
    window._moPrevYm = prevYm;

    // ★ 동일 작업일 탭용 — prev 일별 공정 합계 (전처리/자숙/파쇄/완제품 + 원육)
    // 작업일 = 생산한 날 (prevGrouped 키, 정렬)
    const _prevWorkDates = Object.keys(prevGrouped).sort();
    const _prevByWorkDay = _prevWorkDates.map((date, i) => {
      // 그날 원육 — 체인 제외 데이터 사용
      const ppDay = _prevPpClean.filter(r=>String(r.date||'').slice(0,10)===date);
      const rm = r2(getThKgByPP_(ppDay,_prevThClean,date));
      // 그날 전처리/자숙/파쇄 합계
      const ppKg = ppDay.reduce((s,r)=>s+(parseFloat(r.kg)||0), 0);
      const ckKg = (prevCk||[]).filter(r=>String(r.date||'').slice(0,10)===date).reduce((s,r)=>s+(parseFloat(r.kg)||0), 0);
      const shKg = (prevSh||[]).filter(r=>String(r.date||'').slice(0,10)===date).reduce((s,r)=>s+(parseFloat(r.kg)||0), 0);
      // 그날 완제품 (effM에서 계산된 값)
      const allR = prevGrouped[date] || [];
      const effM = {};
      allR.forEach(row=>{
        const oe = prevOpMap[date+'|'+row.product]||0;
        const p = L.products.find(x=>x.name===row.product);
        effM[row.product] = oe>0&&p ? r2(oe*p.kgea) : row.pkKg;
      });
      const pkKg = r2(allR.reduce((s,r)=>s+(effM[r.product]||0),0));
      return { idx:i+1, date, rm, ppKg, ckKg, shKg, pkKg };
    });
    window._moPrevByWorkDay = _prevByWorkDay;

    // 4월 평균값 (한 줄 가로선용)
    const _avgDef = prevByIdx.length ? (prevByIdx.reduce((s,r)=>s+(r.defectPct||0),0)/prevByIdx.length) : null;
    const _avgYld = _pYldByIdx.length ? (_pYldByIdx.reduce((s,r)=>s+(r.yld||0),0)/_pYldByIdx.length) : null;
    // 4월 일평균 KG — 이번달 막대 그래프와 완전 동일하게:
    //   · testRun/isTest 제외
    //   · 그 날 그 제품의 ea 합 (record 여러 개면 합산)
    //   · outerpacking 있으면 outerEa로 대체
    //   · ea × prodGramPerEA / 1000 → 제품별 반올림 → 합 = dayTotal
    //   · dayTotal 들의 평균
    const _prevGramPerEA = full => {
      const m = (full||'').match(/(\d+(?:\.\d+)?)\s*(g|KG)\b/i);
      if (!m) return 0;
      return m[2].toUpperCase()==='KG' ? parseFloat(m[1])*1000 : parseFloat(m[1]);
    };
    // testRun 체인 역추적 결과(_prevPkClean2)를 그대로 사용 (위에서 이미 계산)
    // 1단계: 그 날 그 제품의 ea 합 (체인 제외 적용된 데이터로)
    const _prevByDateProd = {};
    _prevPkClean2.forEach(r=>{
      const d = String(r.date||'').slice(0,10);
      const prod = r.product||'기타';
      const key = d+'|'+prod;
      if(!_prevByDateProd[key]) _prevByDateProd[key] = {date:d, product:prod, ea:0};
      _prevByDateProd[key].ea += parseFloat(r.ea)||0;
    });
    // 외포장 EA 맵 (이번달과 동일 — outerEa 필드, testRun 제외)
    const _prevOpEaMap = {};
    (prevOp||[]).filter(r => !r.testRun && !r.isTest).forEach(r=>{
      const dk = (String(r.date||'').slice(0,10))+'|'+(r.product||'');
      _prevOpEaMap[dk] = (_prevOpEaMap[dk]||0) + opEa(r);
    });
    // 2단계: 일별 kg 합산 (이번달 _cellByDate 빌드 방식 그대로)
    const _prevDayKgMap = {};
    Object.values(_prevByDateProd).forEach(row => {
      const outerEa = _prevOpEaMap[row.date+'|'+row.product] || 0;
      const ea = outerEa > 0 ? outerEa : Math.round(row.ea || 0);
      if(ea <= 0) return;
      const gPerEA = _prevGramPerEA(row.product);
      const kg = Math.round(ea * gPerEA / 1000);
      _prevDayKgMap[row.date] = (_prevDayKgMap[row.date]||0) + kg;
    });
    // 3단계: 일평균
    const _prevDayKgs = Object.values(_prevDayKgMap).filter(v => v > 0);
    const _avgPkKg = _prevDayKgs.length ? Math.round(_prevDayKgs.reduce((s,v)=>s+v,0)/_prevDayKgs.length) : null;
    // 4월 일평균 원육 사용량 — pRm(원육 합) / pDays
    const _avgRmKg = pDays>0 ? pRm/pDays : null;
    window._moPrevAvgDef = _avgDef;
    window._moPrevAvgYld = _avgYld;
    window._moPrevAvgPkKg = _avgPkKg;
    window._moPrevAvgRmKg = _avgRmKg;
    // 차트 다시 그림 (전월 평균선 추가)
    if(window._moCurYldDays && typeof _moRenderYieldChart === 'function'){
      _moRenderYieldChart(window._moCurYldDays);
    }
    if(window._moCurByDate && typeof _moRedrawDefChart === 'function'){
      _moRedrawDefChart();
    }
    // 내포장 막대 차트도 재그림 (전월 평균선 반영 위해)
    if(typeof renderPackingChart === 'function' && window._moPackingArgs){
      renderPackingChart(window._moPackingArgs.dayEntries, window._moPackingArgs.opMap, window._moPackingArgs.ym);
    }
    // 일별 원육 차트도 재그림
    if(typeof _moRenderRmChart === 'function' && window._moRmByDate){
      _moRenderRmChart(window._moRmByDate, window._moPackingArgs ? window._moPackingArgs.ym : (window._moYm||tod().slice(0,7)), window._moRmByDatePart);
    }
  } catch(e) {
    // KPI 일평균 원육 사용량 갱신
    el.innerHTML=`<div class="ct">전월 비교</div><div style="text-align:center;color:#94a3b8;font-size:12px;padding:1.5rem">전월 데이터 없음</div>`;
  }
}
// 전월 비교 — 탭 모드: 'month'(월 전체, 디폴트), 'sameday'(동일 작업일), 'target'(목표 대비), 'yoy'(전년 동월)
window._moPrevCmpTab = window._moPrevCmpTab || 'month';

function _moRenderPrevCmp(el, cur, prev, prevYm) {
  const [py,pm]=prevYm.split('-');
  const months=['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const prevLbl=py+'년 '+months[parseInt(pm)-1];
  const [cy,cm]=(_moYm||tod().slice(0,7)).split('-');
  const curLbl=cy+'년 '+months[parseInt(cm)-1];
  const fmt=v=>v>0?v.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1}):'—';
  const delta=(c,p,up)=>{
    if(!c||!p) return '<span style="color:#94a3b8">—</span>';
    const d=c-p, good=up?(d>=0):(d<=0);
    const color=good?'#1a56db':'#e53935', icon=d>=0?'▲':'▼';
    return `<span style="color:${color};font-weight:600">${icon}${Math.abs(d).toFixed(1)}</span>`;
  };
  // 캐시 (탭 전환 시 재사용)
  window._moPrevCmpCache = { cur, prev, prevYm, prevLbl, curLbl };

  // 탭 헤더 (4개)
  const tab = window._moPrevCmpTab || 'month';
  const tabBtn = (id, label) => {
    const active = (tab===id);
    return `<button onclick="_moSetPrevCmpTab('${id}')" style="padding:5px 10px;font-size:11px;border:none;border-radius:4px;cursor:pointer;font-weight:${active?600:500};background:${active?'#fff':'transparent'};color:${active?'#1e293b':'#64748b'};box-shadow:${active?'0 1px 2px rgba(0,0,0,0.08)':'none'}">${label}</button>`;
  };
  const tabsHtml = `
    <div style="display:inline-flex;background:#f1f5f9;padding:3px;border-radius:6px;gap:2px;margin-bottom:10px;flex-wrap:wrap">
      ${tabBtn('month','📅 월 전체')}
      ${tabBtn('sameday','⚖️ 동일 작업일')}
      ${tabBtn('target','🎯 목표 대비')}
      ${tabBtn('yoy','📈 전년 동월')}
    </div>`;

  // 모드별 본문
  let bodyHtml = '';
  if(tab === 'month'){
    // ── 1) 월 전체 (현재 동작 그대로) ─────────────────
    bodyHtml = `
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr style="font-size:10px;color:#94a3b8;border-bottom:1px solid #f1f5f9">
          <td style="padding:5px 3px;text-align:center">항목</td>
          <td style="padding:5px 3px;text-align:center">${prevLbl}</td>
          <td style="padding:5px 3px;text-align:center">${curLbl}</td>
          <td style="padding:5px 3px;text-align:center">증감</td>
        </tr></thead>
        <tbody>
          <tr style="border-top:1px solid #f1f5f9">
            <td style="padding:7px 3px;color:#64748b">원육 사용량</td>
            <td style="padding:7px 3px;text-align:center">${fmt(prev.rm)}<span style="font-size:9px;color:#94a3b8">kg</span></td>
            <td style="padding:7px 3px;text-align:center;font-weight:600">${fmt(cur.rm)}<span style="font-size:9px;color:#94a3b8">kg</span></td>
            <td style="padding:7px 3px;text-align:center">${delta(cur.rm,prev.rm,true)}</td>
          </tr>
          <tr style="border-top:1px solid #f1f5f9">
            <td style="padding:7px 3px;color:#64748b">완제품 중량</td>
            <td style="padding:7px 3px;text-align:center">${fmt(prev.pkKg)}<span style="font-size:9px;color:#94a3b8">kg</span></td>
            <td style="padding:7px 3px;text-align:center;font-weight:600">${fmt(cur.pkKg)}<span style="font-size:9px;color:#94a3b8">kg</span></td>
            <td style="padding:7px 3px;text-align:center">${delta(cur.pkKg,prev.pkKg,true)}</td>
          </tr>
          <tr style="border-top:1px solid #f1f5f9;background:#f8fafc">
            <td style="padding:7px 3px;font-weight:700">평균 수율</td>
            <td style="padding:7px 3px;text-align:center">${prev.yld>0?prev.yld.toFixed(1)+'%':'—'}</td>
            <td style="padding:7px 3px;text-align:center;font-weight:700;color:${cur.yld>=52?'#1d4ed8':cur.yld>=50?'#c2410c':'#b91c1c'}">${cur.yld>0?cur.yld.toFixed(1)+'%':'—'}</td>
            <td style="padding:7px 3px;text-align:center">${delta(cur.yld,prev.yld,true)}</td>
          </tr>
          <tr style="border-top:1px solid #f1f5f9">
            <td style="padding:7px 3px;color:#64748b">작업일수</td>
            <td style="padding:7px 3px;text-align:center">${prev.days}일</td>
            <td style="padding:7px 3px;text-align:center;font-weight:600">${cur.days}일</td>
            <td style="padding:7px 3px;text-align:center">${delta(cur.days,prev.days,true)}</td>
          </tr>
          <tr style="border-top:1px solid #f1f5f9">
            <td style="padding:7px 3px;color:#64748b">일평균 원육</td>
            <td style="padding:7px 3px;text-align:center">${prev.days>0?fmt(prev.rm/prev.days):'—'}<span style="font-size:9px;color:#94a3b8">kg</span></td>
            <td style="padding:7px 3px;text-align:center;font-weight:600">${cur.days>0?fmt(cur.rm/cur.days):'—'}<span style="font-size:9px;color:#94a3b8">kg</span></td>
            <td style="padding:7px 3px;text-align:center">${cur.days>0&&prev.days>0?delta(cur.rm/cur.days,prev.rm/prev.days,true):'—'}</td>
          </tr>
        </tbody>
      </table>`;
  } else if(tab === 'sameday'){
    // ── 2) 동일 작업일 — N일차 매칭, 공정별 누적 수율 4행 ──
    const prevByWD = window._moPrevByWorkDay || [];
    const curByWD  = window._moCurByWorkDay  || [];
    const N = Math.min(prevByWD.length, curByWD.length);
    if(N === 0){
      bodyHtml = `<div style="text-align:center;color:#94a3b8;font-size:12px;padding:1.5rem">비교 가능한 작업일 없음</div>`;
    } else {
      // N일치 합계
      const sumPrev = { rm:0, pp:0, ck:0, sh:0, pk:0 };
      const sumCur  = { rm:0, pp:0, ck:0, sh:0, pk:0 };
      for(let i=0; i<N; i++){
        sumPrev.rm += prevByWD[i].rm||0; sumPrev.pp += prevByWD[i].ppKg||0;
        sumPrev.ck += prevByWD[i].ckKg||0; sumPrev.sh += prevByWD[i].shKg||0;
        sumPrev.pk += prevByWD[i].pkKg||0;
        sumCur.rm += curByWD[i].rm||0; sumCur.pp += curByWD[i].ppKg||0;
        sumCur.ck += curByWD[i].ckKg||0; sumCur.sh += curByWD[i].shKg||0;
        sumCur.pk += curByWD[i].pkKg||0;
      }
      const pct = (a,b) => b>0 ? (a/b*100) : 0;
      const stages = [
        { label:'전처리 후',     p:pct(sumPrev.pp, sumPrev.rm), c:pct(sumCur.pp, sumCur.rm) },
        { label:'자숙 후',       p:pct(sumPrev.ck, sumPrev.rm), c:pct(sumCur.ck, sumCur.rm) },
        { label:'파쇄 후',       p:pct(sumPrev.sh, sumPrev.rm), c:pct(sumCur.sh, sumCur.rm) },
        { label:'완제품 (최종)', p:pct(sumPrev.pk, sumPrev.rm), c:pct(sumCur.pk, sumCur.rm) }
      ];
      const rows = stages.map((s,idx) => {
        const isFinal = idx === stages.length-1;
        const yldDelta = (s.p>0 && s.c>0) ? delta(s.c, s.p, true) : '<span style="color:#94a3b8">—</span>';
        return `<tr style="border-top:1px solid #f1f5f9;${isFinal?'background:#eff6ff':''}">
          <td style="padding:8px 6px;color:#64748b;${isFinal?'font-weight:700;color:#1e293b':''}">${s.label}</td>
          <td style="padding:8px 6px;text-align:center;background:#f8fafc">${s.p>0?s.p.toFixed(1)+'%':'—'}</td>
          <td style="padding:8px 6px;text-align:center;font-weight:600${isFinal?';color:#1d4ed8':''}">${s.c>0?s.c.toFixed(1)+'%':'—'}</td>
          <td style="padding:8px 6px;text-align:center">${yldDelta}</td>
        </tr>`;
      }).join('');
      bodyHtml = `
        <div style="font-size:10px;color:#94a3b8;margin-bottom:6px">N일차끼리 매칭 (${N}일) — 공정별 누적 수율 = 산출 ÷ 원육</div>
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead><tr style="font-size:10px;color:#94a3b8;border-bottom:1px solid #e2e8f0">
            <td style="padding:6px 6px;text-align:left">공정 단계</td>
            <td style="padding:6px 6px;text-align:center;background:#f8fafc;font-weight:600;color:#64748b">${prevLbl}</td>
            <td style="padding:6px 6px;text-align:center;font-weight:600;color:#1e293b">${curLbl}</td>
            <td style="padding:6px 6px;text-align:center">증감</td>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }
  } else if(tab === 'target'){
    // ── 3) 목표 대비 ──────────────────────────────────
    const t = (typeof getTargets === 'function') ? getTargets() : {yieldGoal:55, yieldDanger:48, defGoal:2};
    const yldAch = t.yieldGoal>0 ? (cur.yld/t.yieldGoal*100) : 0;
    // 이번달 평균 불량률 (window._moCurAvgDef 또는 _moCurByDate에서 계산)
    const curByDate = window._moCurByDate || {};
    let totEa=0, totDef=0;
    Object.values(curByDate).forEach(v => { totEa += v.ea||0; totDef += v.def||0; });
    const curDef = (totEa+totDef)>0 ? (totDef/(totEa+totDef)*100) : 0;
    const defAch = t.defGoal>0 ? (curDef/t.defGoal*100) : 0;
    const status = (val, goal, up) => {
      if(!val) return '<span style="color:#94a3b8">데이터 없음</span>';
      const ok = up ? (val >= goal) : (val <= goal);
      return ok
        ? '<span style="color:#1d4ed8;font-weight:700">✓ 달성</span>'
        : '<span style="color:#b91c1c;font-weight:700">✗ 미달</span>';
    };
    bodyHtml = `
      <div style="font-size:10px;color:#94a3b8;margin-bottom:6px">설정한 목표값 기준 (설정 → 분석 목표에서 변경)</div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr style="font-size:10px;color:#94a3b8;border-bottom:1px solid #f1f5f9">
          <td style="padding:5px 3px;text-align:center">항목</td>
          <td style="padding:5px 3px;text-align:center">목표</td>
          <td style="padding:5px 3px;text-align:center">${curLbl}</td>
          <td style="padding:5px 3px;text-align:center">상태</td>
        </tr></thead>
        <tbody>
          <tr style="border-top:1px solid #f1f5f9;background:#f8fafc">
            <td style="padding:7px 3px;font-weight:700">평균 수율</td>
            <td style="padding:7px 3px;text-align:center">${t.yieldGoal.toFixed(1)}% 이상</td>
            <td style="padding:7px 3px;text-align:center;font-weight:700">${cur.yld>0?cur.yld.toFixed(1)+'%':'—'}</td>
            <td style="padding:7px 3px;text-align:center">${status(cur.yld, t.yieldGoal, true)}</td>
          </tr>
          <tr style="border-top:1px solid #f1f5f9">
            <td style="padding:7px 3px;color:#64748b">달성률</td>
            <td colspan="2" style="padding:7px 3px;text-align:center;color:#1e293b;font-weight:600">${yldAch>0?yldAch.toFixed(1)+'% (목표 대비)':'—'}</td>
            <td></td>
          </tr>
          <tr style="border-top:1px solid #f1f5f9;background:#f8fafc">
            <td style="padding:7px 3px;font-weight:700">평균 불량률</td>
            <td style="padding:7px 3px;text-align:center">${t.defGoal.toFixed(2)}% 이하</td>
            <td style="padding:7px 3px;text-align:center;font-weight:700">${curDef>0?curDef.toFixed(2)+'%':'—'}</td>
            <td style="padding:7px 3px;text-align:center">${status(curDef, t.defGoal, false)}</td>
          </tr>
          <tr style="border-top:1px solid #f1f5f9">
            <td style="padding:7px 3px;color:#64748b">위험선 (수율)</td>
            <td colspan="3" style="padding:7px 3px;text-align:center;color:#94a3b8;font-size:11px">${t.yieldDanger.toFixed(1)}% 미만 시 위험</td>
          </tr>
        </tbody>
      </table>`;
  } else if(tab === 'yoy'){
    // ── 4) 전년 동월 ─────────────────────────────────
    bodyHtml = `
      <div style="text-align:center;padding:2rem 1rem">
        <div style="font-size:32px;margin-bottom:8px">📊</div>
        <div style="font-size:13px;color:#64748b;font-weight:600;margin-bottom:6px">전년 동월 데이터 부족</div>
        <div style="font-size:11px;color:#94a3b8;line-height:1.5">계절성 분석을 위해서는<br>1년 이상의 데이터가 필요합니다.<br>내년부터 자동으로 비교 가능해집니다.</div>
      </div>`;
  }

  el.innerHTML = `<div class="ct">전월 비교</div>${tabsHtml}${bodyHtml}`;
}

// 탭 전환 핸들러
function _moSetPrevCmpTab(tab){
  window._moPrevCmpTab = tab;
  const cache = window._moPrevCmpCache;
  const el = document.getElementById('mo_prev_cmp');
  if(!cache || !el) return;
  _moRenderPrevCmp(el, cache.cur, cache.prev, cache.prevYm);
}

async function exportMonthlyReport() {
  const ym   = _moYm || tod().slice(0,7);
  const rows = window._moReportRows || [];
  if(!rows.length){ toast('데이터 없음','d'); return; }

  const [y,m]  = ym.split('-');
  const opMap  = (window._moGD && window._moGD.opMap) || {};
  const fmtNum = '#,##0.0';
  const fmtEa  = '#,##0';
  const fmtPct = '0.0%';
  const COL    = 'ABCDEFGHIJK';
  const NCOLS  = 11;

  // ── 스타일 정의 ──────────────────────────────────────────
  const borderAll = {
    top:    {style:'thin', color:{rgb:'BBBBBB'}},
    bottom: {style:'thin', color:{rgb:'BBBBBB'}},
    left:   {style:'thin', color:{rgb:'BBBBBB'}},
    right:  {style:'thin', color:{rgb:'BBBBBB'}}
  };
  const borderHeader = {
    top:    {style:'medium', color:{rgb:'3A5F8A'}},
    bottom: {style:'medium', color:{rgb:'3A5F8A'}},
    left:   {style:'thin',   color:{rgb:'3A5F8A'}},
    right:  {style:'thin',   color:{rgb:'3A5F8A'}}
  };
  const borderTotal = {
    top:    {style:'medium', color:{rgb:'444444'}},
    bottom: {style:'medium', color:{rgb:'444444'}},
    left:   {style:'thin',   color:{rgb:'888888'}},
    right:  {style:'thin',   color:{rgb:'888888'}}
  };

  function _sHdr(v) {
    return {
      t:'s', v,
      s:{ font:{bold:true, color:{rgb:'FFFFFF'}, sz:10},
          fill:{fgColor:{rgb:'2C5282'}},
          alignment:{horizontal:'center', vertical:'center', wrapText:true},
          border: borderHeader }
    };
  }
  function _sCell(t, v, extra) {
    return Object.assign({t, v}, extra||{}, {
      s: Object.assign({
        font:{sz:10},
        alignment:{horizontal:'center', vertical:'center'},
        border: borderAll
      }, (extra&&extra.s)||{})
    });
  }
  function _sCellF(f, z, sExtra) {
    return {
      t:'n', f, z,
      s: Object.assign({
        font:{sz:10},
        alignment:{horizontal:'center', vertical:'center'},
        border: borderAll
      }, sExtra||{})
    };
  }
  function _sTotalCell(t, v, extra) {
    return Object.assign({t, v}, extra||{}, {
      s: Object.assign({
        font:{bold:true, sz:10},
        fill:{fgColor:{rgb:'EBF2FF'}},
        alignment:{horizontal:'center', vertical:'center'},
        border: borderTotal
      }, (extra&&extra.s)||{})
    });
  }
  function _sTotalF(f, z) {
    return {
      t:'n', f, z,
      s:{ font:{bold:true, sz:10},
          fill:{fgColor:{rgb:'EBF2FF'}},
          alignment:{horizontal:'center', vertical:'center'},
          border: borderTotal }
    };
  }

  // 짝수 행 연하게
  function _rowFill(rIdx) { // rIdx: 0-based data row index
    return rIdx % 2 === 1 ? {fgColor:{rgb:'F7FAFF'}} : {fgColor:{rgb:'FFFFFF'}};
  }

  const wb = XLSX.utils.book_new();
  const ws = {};
  const merges = [];

  // ── 1행: 헤더 ────────────────────────────────────────────
  ['생산일수','생산일자','작업인원','원육종류','제품명',
   '원육 사용량(KG)','생산량(EA)','완제품 중량(KG)',
   '원육수율','Full Capa','비고'
  ].forEach((h,ci) => { ws[COL[ci]+'1'] = _sHdr(h); });

  let r = 2;
  let i = 0;
  let dayCnt = 0;
  let dataRowIdx = 0; // for alternating row color (per date group)

  while(i < rows.length) {
    let j = i + 1;
    while(j < rows.length && rows[j].dayNo === '') j++;
    const dayRows = rows.slice(i, j);
    const cnt    = dayRows.length;
    const rStart = r;
    const rEnd   = r + cnt - 1;
    const date   = dayRows[0].date;
    dayCnt++;
    const fill   = _rowFill(dataRowIdx);
    dataRowIdx++;

    dayRows.forEach((row, ri) => {
      const isFirst = ri === 0;
      const ea      = opMap[date+'|'+row.product] || 0;
      const rmVal   = isFirst ? (parseFloat(row.rm)||0) : 0;
      const pkVal   = parseFloat(row.pkKg)||0;
      const capaRaw = isFirst ? parseFloat(String(row.capa||'').replace(/,/g,'')) : NaN;
      const rowS    = { font:{sz:10}, fill, alignment:{horizontal:'center',vertical:'center'}, border:borderAll };

      // A: 일수
      ws['A'+r] = isFirst
        ? {t:'n', v:parseInt(row.dayNo)||dayCnt, s:Object.assign({},rowS,{font:{bold:true,sz:10}})}
        : {t:'s', v:'', s:rowS};
      // B: 날짜
      ws['B'+r] = isFirst
        ? {t:'s', v:date.slice(5).replace('-','/'), s:rowS}
        : {t:'s', v:'', s:rowS};
      // C: 인원
      ws['C'+r] = (isFirst && row.workers!=='')
        ? {t:'n', v:parseFloat(row.workers)||0, s:rowS}
        : {t:'s', v:'', s:rowS};
      // D: 원육종류
      ws['D'+r] = isFirst
        ? {t:'s', v:row.meat||'', s:rowS}
        : {t:'s', v:'', s:rowS};
      // E: 제품명 (왼쪽 정렬)
      ws['E'+r] = {t:'s', v:row.product||'',
        s:Object.assign({},rowS,{alignment:{horizontal:'left',vertical:'center',indent:1}})};
      // F: 원육 사용량
      ws['F'+r] = (isFirst && rmVal)
        ? {t:'n', v:rmVal, z:fmtNum, s:rowS}
        : {t:'s', v:'', s:rowS};
      // G: 생산량(EA)
      ws['G'+r] = ea>0
        ? {t:'n', v:ea, z:fmtEa, s:Object.assign({},rowS,{font:{bold:true,sz:10,color:{rgb:'1A56A0'}}})}
        : {t:'s', v:'', s:rowS};
      // H: 완제품 중량
      ws['H'+r] = pkVal>0
        ? {t:'n', v:pkVal, z:fmtNum, s:rowS}
        : {t:'s', v:'', s:rowS};
      // I: 원육수율 (수식)
      if(isFirst && rmVal) {
        const hRef = cnt>1 ? 'SUM(H'+rStart+':H'+rEnd+')' : 'H'+r;
        const yld  = cnt>1
          ? (dayRows.reduce((s,dr)=>(s+parseFloat(dr.pkKg)||0),0))/(rmVal)
          : (pkVal/rmVal);
        const yldColor = yld < 0.50 ? {rgb:'D44'} : yld >= 0.53 ? {rgb:'1A6F3C'} : {rgb:'B06000'};
        ws['I'+r] = {t:'n', f:hRef+'/F'+r, z:fmtPct,
          s:Object.assign({},rowS,{font:{bold:true,sz:10,color:yldColor}})};
      } else {
        ws['I'+r] = {t:'s', v:'', s:rowS};
      }
      // J: Full Capa
      ws['J'+r] = (isFirst && !isNaN(capaRaw) && capaRaw>0)
        ? {t:'n', v:capaRaw, z:fmtEa, s:Object.assign({},rowS,{font:{color:{rgb:'888888'},sz:10}})}
        : {t:'s', v:'', s:rowS};
      // K: 비고
      ws['K'+r] = isFirst
        ? {t:'s', v:row.note||'', s:Object.assign({},rowS,{alignment:{horizontal:'left',vertical:'center',indent:1}})}
        : {t:'s', v:'', s:rowS};
      r++;
    });

    // 다제품 날 병합
    if(cnt > 1) {
      [0,1,2,3,5,8,9,10].forEach(ci => {
        merges.push({s:{r:rStart-1,c:ci}, e:{r:rEnd-1,c:ci}});
      });
    }
    i = j;
  }

  // ── 합계 행 (SUBTOTAL — 필터 시 보이는 행만 집계) ────────
  const rF = r;
  const dataRange2 = 'F2:F'+(rF-1);
  const dataRange7 = 'G2:G'+(rF-1);
  const dataRange8 = 'H2:H'+(rF-1);

  ws['A'+rF] = _sTotalCell('s','합  계  ('+dayCnt+'일)');
  merges.push({s:{r:rF-1,c:0}, e:{r:rF-1,c:4}});
  // B~D: 병합 내 빈칸 스타일
  ['B','C','D','E'].forEach(c => { ws[c+rF] = _sTotalCell('s',''); });
  ws['F'+rF] = _sTotalF('SUBTOTAL(9,'+dataRange2+')', fmtNum);
  ws['G'+rF] = _sTotalF('SUBTOTAL(9,'+dataRange7+')', fmtEa);
  ws['H'+rF] = _sTotalF('SUBTOTAL(9,'+dataRange8+')', fmtNum);
  ws['I'+rF] = _sTotalF('H'+rF+'/F'+rF, fmtPct);
  ws['J'+rF] = _sTotalCell('s','');
  ws['K'+rF] = _sTotalCell('s','');

  // ── 자동필터 (헤더 행) ────────────────────────────────────
  ws['!autofilter'] = {ref: 'A1:K'+(rF-1)};

  ws['!merges'] = merges;
  ws['!ref']    = 'A1:K'+rF;
  ws['!cols']   = [
    {wch:6},{wch:10},{wch:8},{wch:12},{wch:24},
    {wch:14},{wch:12},{wch:18},{wch:10},{wch:10},{wch:20}
  ];
  // 행 높이: 헤더 30px, 데이터 22px
  ws['!rows'] = [{hpt:30}];
  for(let ri=2; ri<=rF; ri++) ws['!rows'][ri-1] = {hpt:22};

  XLSX.utils.book_append_sheet(wb, ws, y+'년'+parseInt(m,10)+'월');

  // 실제 Excel 차트 시트 추가 (JSZip으로 XML 직접 주입)
  try {
    const mainBuf = XLSX.write(wb, {bookType:'xlsx', type:'array'});
    const finalBuf = await _buildChartSheet(mainBuf, y, m);
    const blob = new Blob([finalBuf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ym+'_월간생산일보.xlsx';
    a.click();
    toast('엑셀 다운로드 완료 ✓','s');
    return;
  } catch(e) {
    console.warn('차트 시트 실패, 기본 저장:', e);
  }
  XLSX.writeFile(wb, ym+'_월간생산일보.xlsx');
  toast('엑셀 다운로드 완료 ✓','s');
}


var _calY = 0, _calM = 0;

function toggleCal(){
  var pop = document.getElementById('calPop');
  if(pop.style.display === 'none'){
    var parts = (DDATE||tod()).split('-').map(Number);
    _calY = parts[0]; _calM = parts[1];
    renderCal();
    pop.style.display = 'block';
    setTimeout(function(){ document.addEventListener('click', closeCal); }, 100);
  } else {
    pop.style.display = 'none';
    document.removeEventListener('click', closeCal);
  }
}

function closeCal(e){
  var pop = document.getElementById('calPop');
  var btn = document.getElementById('calBtn');
  if(pop && !pop.contains(e.target) && e.target !== btn){
    pop.style.display = 'none';
    document.removeEventListener('click', closeCal);
  }
}

function calMove(dir){
  _calM += dir;
  if(_calM > 12){ _calM = 1; _calY++; }
  if(_calM < 1){ _calM = 12; _calY--; }
  renderCal();
}

function renderCal(){
  var months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  document.getElementById('calTitle').textContent = _calY + '년 ' + months[_calM-1];
  var grid = document.getElementById('calGrid');
  var firstDay = new Date(_calY, _calM-1, 1).getDay();
  var lastDate = new Date(_calY, _calM, 0).getDate();
  var today = tod();
  var selected = DDATE || today;
  var html = '';
  for(var i=0;i<firstDay;i++) html += '<span></span>';
  for(var d=1;d<=lastDate;d++){
    var ds = _calY + '-' + String(_calM).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday = ds === today;
    var isSel = ds === selected;
    var dow = (firstDay + d - 1) % 7;
    var col = dow===0?'#e00':dow===6?'#00e':'#333';
    var bg = isSel ? '#1a56db' : isToday ? '#e8f0fe' : 'transparent';
    var tc = isSel ? '#fff' : col;
    html += '<span onclick="pickDate(\''+ds+'\')" style="cursor:pointer;padding:4px 2px;border-radius:4px;font-size:13px;background:'+bg+';color:'+tc+';display:block">'+d+'</span>';
  }
  grid.innerHTML = html;
}

function pickDate(dateStr){
  document.getElementById('calPop').style.display = 'none';
  document.removeEventListener('click', closeCal);
  goDate(dateStr);
}

function goDate(dateStr){
  if(!dateStr) return;
  DDATE = dateStr;
  renderDaily();
}

var _chDayDir=0;
var _chDayBusy=false;
async function chDay(d){
  if(_chDayBusy) return;
  _chDayBusy=true;
  try{
    // 로컬 날짜 문자열 변환 헬퍼 (시간대 무관)
    function _ld(date){
      return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
    }
    var dt=new Date(DDATE+'T00:00:00');  // 로컬 자정으로 파싱
    var todayStr = _ld(new Date());

    // packing 있는 날 = 생산일. 서버에서 직접 확인 (L 캐시 의존 안 함)
    for(var i=0;i<60;i++){
      dt.setDate(dt.getDate()+d);
      var ds = _ld(dt);
      // 미래 차단
      if(ds > todayStr){ toast('오늘 이후 날짜입니다','d'); return; }
      // 오늘은 packing 0건이어도 통과 (작업 중일 수 있음)
      if(ds === todayStr){ DDATE=ds; renderDaily(); return; }
      // 서버에서 packing 조회 — 1건이라도 있으면 생산일로 간주
      var has=false;
      try{
        var recs = await fbGetByDate('packing', ds);
        if(recs && recs.length) has=true;
      }catch(e){ /* 조회 실패 시 그 날 스킵 */ }
      if(has){ DDATE=ds; renderDaily(); return; }
    }
    toast('해당 방향에 데이터가 없습니다','d');
  } finally {
    _chDayBusy=false;
  }
}

// 전처리 wagons → 해동 매칭으로 원육KG 계산 (중복 와건 제거)
function getThKgByPP_(ppRecs, allThawing, packDate) {
  const prevD=(()=>{const [y,m,dd]=packDate.split('-').map(Number);const dt=new Date(y,m-1,dd-1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;})();
  const _normW=w=>String(w||'').replace(/[^0-9]/g,'')||String(w||'').trim();
  const wagons=[...new Set(ppRecs.flatMap(r=>(r.wagons||'').split(',').map(w=>_normW(w)).filter(Boolean)))];
  // end 가 packDate 와 매칭되는지 (datetime 'YYYY-MM-DD HH:MM' 또는 옛 'HH:MM' + date=packDate)
  const _endsOnDay=(r)=>{
    const e=String(r.end||'');
    if(!e) return false;
    if(e.length>=10 && e.slice(0,10)===packDate) return true;
    if(e.length<=5 && String(r.date||'').slice(0,10)===packDate) return true;
    return false;
  };
  // 후보: (date=prevD) + (date=packDate) 합집합. 그 중 end 가 작업일 매칭 + cart in wagons.
  const candidates=allThawing.filter(r=>{
    const rd=String(r.date||'').slice(0,10);
    return rd===prevD || rd===packDate;
  });
  let matched=[];
  if(wagons.length){
    matched=candidates.filter(r=>_endsOnDay(r) && wagons.includes(_normW(r.cart)));
    // 폴백 1: end 매칭 0 → cart 매칭만 (옛 record 호환)
    if(!matched.length){
      matched=candidates.filter(r=>wagons.includes(_normW(r.cart)));
    }
  } else {
    matched=candidates.filter(r=>_endsOnDay(r));
    if(!matched.length) matched=candidates;
  }
  // 폴백 2: 그래도 0 → 옛 동작 (date 기반)
  if(!matched.length){
    matched=allThawing.filter(r=>String(r.date||'').slice(0,10)===packDate);
    if(!matched.length) matched=allThawing.filter(r=>String(r.date||'').slice(0,10)===prevD);
  }
  // 재입력이 다음날로 저장된 경우 보정 (날짜 오입력 대비)
  if(wagons.length){
    const _nextD=addDays(packDate,1);
    const _nextMatched=allThawing.filter(r=>String(r.date||'').slice(0,10)===_nextD&&wagons.includes(_normW(r.cart)));
    const _curKg=r2(matched.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
    const _nxtKg=r2(_nextMatched.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
    if(_nextMatched.length && _nxtKg>_curKg*2) matched=_nextMatched;
  }
  const seen=new Set();
  const deduped=matched.filter(r=>{const k=(r.cart||'')+'|'+String(r.date||'').slice(0,10)+'|'+(r.type||'');if(seen.has(k))return false;seen.add(k);return true;});
  return r2(deduped.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
}

// getThKgByPP_와 동일한 매칭 로직, 부위별로 분해해서 리턴 — {우둔: 500, 홍두깨: 301, ...}
function getThByPartByPP_(ppRecs, allThawing, packDate) {
  const prevD=(()=>{const [y,m,dd]=packDate.split('-').map(Number);const dt=new Date(y,m-1,dd-1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;})();
  const _normW=w=>String(w||'').replace(/[^0-9]/g,'')||String(w||'').trim();
  const wagons=[...new Set(ppRecs.flatMap(r=>(r.wagons||'').split(',').map(w=>_normW(w)).filter(Boolean)))];
  const _endsOnDay=(r)=>{
    const e=String(r.end||'');
    if(!e) return false;
    if(e.length>=10 && e.slice(0,10)===packDate) return true;
    if(e.length<=5 && String(r.date||'').slice(0,10)===packDate) return true;
    return false;
  };
  const candidates=allThawing.filter(r=>{
    const rd=String(r.date||'').slice(0,10);
    return rd===prevD || rd===packDate;
  });
  let matched=[];
  if(wagons.length){
    matched=candidates.filter(r=>_endsOnDay(r) && wagons.includes(_normW(r.cart)));
    if(!matched.length){
      matched=candidates.filter(r=>wagons.includes(_normW(r.cart)));
    }
  } else {
    matched=candidates.filter(r=>_endsOnDay(r));
    if(!matched.length) matched=candidates;
  }
  if(!matched.length){
    matched=allThawing.filter(r=>String(r.date||'').slice(0,10)===packDate);
    if(!matched.length) matched=allThawing.filter(r=>String(r.date||'').slice(0,10)===prevD);
  }
  if(wagons.length){
    const _nextD=addDays(packDate,1);
    const _nextMatched=allThawing.filter(r=>String(r.date||'').slice(0,10)===_nextD&&wagons.includes(_normW(r.cart)));
    const _curKg=r2(matched.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
    const _nxtKg=r2(_nextMatched.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
    if(_nextMatched.length && _nxtKg>_curKg*2) matched=_nextMatched;
  }
  const seen=new Set();
  const deduped=matched.filter(r=>{const k=(r.cart||'')+'|'+String(r.date||'').slice(0,10)+'|'+(r.type||'');if(seen.has(k))return false;seen.add(k);return true;});
  const byPart={};
  deduped.forEach(r=>{
    const part=String(r.type||'기타').trim()||'기타';
    byPart[part]=(byPart[part]||0)+(parseFloat(r.totalKg)||0);
  });
  Object.keys(byPart).forEach(k=>{ byPart[k]=r2(byPart[k]); });
  return byPart;
}

async function renderDaily(){
  document.getElementById('dLbl').textContent=dateWithDay(DDATE);
  const prevD=(()=>{const [y,m,dd]=DDATE.split('-').map(Number);const dt=new Date(y,m-1,dd-1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;})();
  const nextD=addDays(DDATE,1);
  // nextD도 로드 → 방혈 재입력이 다음날로 저장된 경우 반영
  await Promise.all([loadFromServer(prevD), loadFromServer(DDATE), loadFromServer(nextD)]);
  renderDailyFromLocal_(DDATE);
}

function renderDailyFromLocal_(d){
  const prevD=(()=>{const [y,m,dd]=d.split('-').map(Number);const dt=new Date(y,m-1,dd-1);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;})();
  // ── 테스트 체인 역추적: 내포장 testRun → 파쇄 → 자숙 → 전처리 → 방혈 ──────
  const pkAll=L.packing.filter(r=>String(r.date||'').slice(0,10)===d);
  const shAll=L.shredding.filter(r=>String(r.date||'').slice(0,10)===d);
  const ckAll=L.cooking.filter(r=>String(r.date||'').slice(0,10)===d);
  const ppAll=L.preprocess.filter(r=>String(r.date||'').slice(0,10)===d);
  // 외포장 testRun → packing testRun 전파 (monthly_production과 룰 일관성)
  // 외포장만 testRun=true이고 packing.testRun=null인 케이스(예: 04-24 FC 3KG 8EA) 처리
  const opAll=(L.outerpacking||[]).filter(r=>String(r.date||'').slice(0,10)===d);
  const _testOpProds=new Set(opAll.filter(r=>r.testRun||r.isTest).map(r=>String(r.product||'')));

  // ① 내포장 중 테스트 레코드 와건 / 카트 추출 (외포장 매칭도 포함)
  const _testPk=pkAll.filter(r=>r.testRun||r.isTest||_testOpProds.has(String(r.product||'')));
  const _testPkW=new Set(_testPk.flatMap(r=>(r.wagon||'').split(',').map(w=>w.trim()).filter(Boolean)));
  const _testPkC=new Set(_testPk.flatMap(r=>(r.cart ||'').split(',').map(w=>w.trim()).filter(Boolean)));

  // ② 파쇄: 테스트 와건/카트로 나온(wagonOut/cartOut) 레코드 → wagonIn 추출
  const _testSh=shAll.filter(r=>{
    const woMatch = (r.wagonOut||'').split(',').map(w=>w.trim()).some(w=>_testPkW.has(w));
    const coMatch = (r.cartOut ||'').split(',').map(w=>w.trim()).some(w=>_testPkC.has(w));
    return woMatch || coMatch;
  });
  const _testShW=new Set(_testSh.flatMap(r=>(r.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean)));

  // ③ 자숙: 테스트 파쇄 wagonIn으로 나온(wagonOut) 레코드 → cage 추출
  const _testCk=ckAll.filter(r=>(r.wagonOut||'').split(',').map(w=>w.trim()).some(w=>_testShW.has(w)));
  const _testCkC=new Set(_testCk.flatMap(r=>(r.cage||'').split(',').map(c=>c.trim()).filter(Boolean)));

  // ④ 전처리: 테스트 자숙 cage 레코드 → wagons 추출
  const _testPp=ppAll.filter(r=>(r.cage||'').split(',').map(c=>c.trim()).some(c=>_testCkC.has(c)));
  const _testPpW=new Set(_testPp.flatMap(r=>(r.wagons||'').split(',').map(w=>w.trim()).filter(Boolean)));

  // ⑤ 각 공정 필터 (ID 기준 테스트 체인 제외)
  const _tPkId=new Set(_testPk.map(r=>r.fbId||r.id));
  const _tShId=new Set(_testSh.map(r=>r.fbId||r.id));
  const _tCkId=new Set(_testCk.map(r=>r.fbId||r.id));
  const _tPpId=new Set(_testPp.map(r=>r.fbId||r.id));

  const pk=pkAll.filter(r=>!_tPkId.has(r.fbId||r.id));
  const sh=shAll.filter(r=>!_tShId.has(r.fbId||r.id));
  const ck=ckAll.filter(r=>!_tCkId.has(r.fbId||r.id));
  const pp=ppAll.filter(r=>!_tPpId.has(r.fbId||r.id));
  // ────────────────────────────────────────────────────────────────────────────

  const bc=L.barcodes.filter(r=>String(r.date||'').slice(0,10)===prevD);
  // 방혈 데이터: 테스트 와건 제외
  const thByType={};
  L.thawing.filter(r=>String(r.date||'').slice(0,10)===d&&!_testPpW.has((r.cart||'').trim())).forEach(r=>{
    (r.type||'').split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>{
      if(!thByType[t]) thByType[t]=0;
      thByType[t]+=parseFloat(r.totalKg)||0;
    });
  });

  // 원육 계산: 전처리 wagons → 방혈 매칭
  // thawing.date = 입고일이므로 date 만 보면 당일 입고됐지만 아직 안 풀린 박스도 잡힘.
  // 정확한 매칭: end 가 작업일 d 와 매칭되는 record (= 실제 그날 풀린 박스)
  const _normW=w=>String(w||'').replace(/[^0-9]/g,'')||String(w||'').trim();
  const _ppWagons=[...new Set(pp.flatMap(r=>(r.wagons||'').split(',').map(w=>_normW(w)).filter(Boolean)))];
  // end 가 작업일 d 와 매칭되는지 (datetime 'YYYY-MM-DD HH:MM' 또는 옛 'HH:MM' + date=d)
  const _endsOnDay=(r,day)=>{
    const e=String(r.end||'');
    if(!e) return false; // 진행중 박스 제외
    if(e.length>=10 && e.slice(0,10)===day) return true;
    if(e.length<=5 && String(r.date||'').slice(0,10)===day) return true;
    return false;
  };
  let _rawTh=[];
  if(_ppWagons.length){
    // 후보: 전날 입고(date=d-1) + 당일 입고(date=d) 합집합
    // 그 중 end 가 d 와 매칭 + cart 가 ppWagons 와 매칭 + 테스트 cart 제외
    const candidates = L.thawing.filter(r=>{
      const rDate = String(r.date||'').slice(0,10);
      return (rDate===d || rDate===prevD) && !_testPpW.has((r.cart||'').trim());
    });
    _rawTh = candidates.filter(r => _endsOnDay(r,d) && _ppWagons.includes(_normW(r.cart)));
    // 폴백 1: end 매칭 0 → cart 매칭만 (옛 데이터 호환, end 비어있는 경우)
    if(!_rawTh.length){
      _rawTh = candidates.filter(r => _ppWagons.includes(_normW(r.cart)));
    }
    // 폴백 2: 그래도 0 → 당일 전체 → 전날 전체
    if(!_rawTh.length){
      _rawTh=L.thawing.filter(r=>String(r.date||'').slice(0,10)===d&&!_testPpW.has((r.cart||'').trim()));
      if(!_rawTh.length) _rawTh=L.thawing.filter(r=>String(r.date||'').slice(0,10)===prevD&&!_testPpW.has((r.cart||'').trim()));
    }
  } else {
    _rawTh=L.thawing.filter(r=>String(r.date||'').slice(0,10)===d&&!_testPpW.has((r.cart||'').trim()));
    if(!_rawTh.length) _rawTh=L.thawing.filter(r=>String(r.date||'').slice(0,10)===prevD&&!_testPpW.has((r.cart||'').trim()));
  }
  // 재입력이 다음날로 저장된 경우 보정 (날짜 미변경 입력 오류 대비)
  // 현재 찾은 방혈 totalKg보다 다음날 같은 wagon이 2배 이상이면 다음날 기록 우선 사용
  if(_ppWagons.length){
    const _nextD=addDays(d,1);
    const _nextRaw=L.thawing.filter(r=>String(r.date||'').slice(0,10)===_nextD&&!_testPpW.has((r.cart||'').trim())&&_ppWagons.includes(_normW(r.cart)));
    const _curKg=r2(_rawTh.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
    const _nxtKg=r2(_nextRaw.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
    if(_nextRaw.length && _nxtKg > _curKg*2) _rawTh=_nextRaw;
  }
  const _seenTh=new Set();
  const matchedTh=_rawTh.filter(r=>{const k=(r.cart||'')+'|'+String(r.date||'').slice(0,10)+'|'+(r.type||'');if(_seenTh.has(k))return false;_seenTh.add(k);return true;});
  const rmKg=r2(matchedTh.reduce((s,r)=>s+(parseFloat(r.totalKg)||0),0));
  // 원육 타입별 KG: matchedTh 기준으로 재계산 (바코드·중복 해동 오염 방지)
  Object.keys(thByType).forEach(k=>delete thByType[k]);
  matchedTh.forEach(r=>{(r.type||'').split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>{if(!thByType[t])thByType[t]=0;thByType[t]+=parseFloat(r.totalKg)||0;});});
  const ppKg=r2(pp.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const ckKg=r2(ck.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const shKg=r2(sh.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const totalEA=pk.reduce((s,r)=>s+(parseFloat(r.ea)||0),0);
  const totalMH=r2(sumMH(pp)+sumMH(ck)+sumMH(sh)+sumMH(pk));
  const defect=pk.reduce((s,r)=>s+(parseFloat(r.defect)||0),0);
  const defRate=totalEA>0?r2(defect/totalEA*100):0;
  // 원육수율 = 완제품 원료육(포장EA×원료육kgEA) / 원육투입
  const pkRawKg = r2(pk.reduce((s,r)=>{
    const p=L.products.find(x=>x.name===r.product);
    return s + (p ? (parseFloat(r.ea)||0)*p.kgea : 0);
  },0));
  const oYld = rmKg>0 ? r2(pkRawKg/rmKg*100) : 0;

  // ─── Phase 2.1 마이그레이션: dataLayer 결과 실시간 검증 (사용자 영향 0) ───
  // dataLayer.getDay() 결과가 legacy 계산과 일치하는지 운영 중 console에 비교 출력.
  // 차이 발생 시 즉시 감지 가능 → 향후 정식 교체 안전성 보장.
  if(typeof window !== 'undefined' && window.DL && typeof window.DL.getDay === 'function'){
    try{
      const _dl = window.DL.getDay(d);
      const _check = (label, legacy, dl, tol=0.5) => {
        const diff = Math.abs((legacy||0) - (dl||0));
        if(diff > tol) console.warn(`[Phase2.1 비교 차이] ${d} ${label}: legacy=${legacy}, DL=${dl}, Δ=${diff.toFixed(2)}`);
      };
      _check('rmKg', rmKg, _dl.summary.rmKgTotal);
      _check('ppKg', ppKg, _dl.summary._ppKgTotal);
      _check('ckKg', ckKg, _dl.summary._ckKgTotal);
      _check('shKg', shKg, _dl.summary._shKgTotal);
      const _dlEa = Object.values(_dl.summary.pkEaByPart||{}).reduce((a,b)=>a+b,0)
                  + (_dl.summary.pkEaNoMeat||0) + (_dl.summary.pkEaUnresolved||0);
      _check('totalEA', totalEA, _dlEa, 1);
    }catch(_e){
      console.error('[Phase2.1 DL 비교 오류]', _e.message);
    }
  }

  const _s=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  _s('d_ea', totalEA ? totalEA.toLocaleString() : '-');
  _s('d_yld', oYld ? parseFloat(oYld).toFixed(1)+'%' : '-');
  // 인시당 EA
  const mhPk = r2(sumMH(pk));
  const eaPerMh = mhPk>0 ? r2(totalEA/mhPk) : 0;
  _s('d_mh', eaPerMh||'-');
  // 포장불량 + 기준 2% 색상
  _s('d_def', defRate ? parseFloat(defRate).toFixed(1)+'%' : '-');
  const defEl = document.getElementById('d_def');
  if(defEl) defEl.style.color = defRate>2 ? 'var(--d)' : defRate>0 ? 'var(--s)' : '';
  const defLabel = document.getElementById('d_def_label');
  if(defLabel) defLabel.textContent = defRate>2 ? '% ▲기준초과' : defRate>0 ? '% ▼기준이하' : '%';

  // ============================================================
  // 일별 알람 체크 - 자숙/파쇄/포장 원육수율 이상 탐지
  // 원육수율 = 해당 공정 산출 / 원육 투입(rmKg) * 100
  // 임계값은 settings 페이지에서 조정 가능 (Firebase config/alarms)
  //
  // ★ 사용자분 룰 (2026-05-06): 공정이 다음 단계로 다 흘러갔을 때만 분석 표시
  //    = 진행 중에는 미완성 데이터로 잘못된 경고 띄우지 않음
  // ============================================================
  const _MIN_RM_KG = 100;       // 원육 100kg 미만이면 알람 전체 차단
  const _MIN_CK_KG = 50;        // 자숙 50kg 미만이면 자숙 알람 차단
  const _MIN_SH_KG = 50;        // 파쇄 50kg 미만이면 파쇄 알람 차단
  const _hasProduction = rmKg >= _MIN_RM_KG;

  // 공정 완료 검증
  // 1) 자숙 완료: 자숙 record들의 wagonOut → 모두 파쇄 record의 wagonIn에 등록
  function _isCookingFlowedToShredding() {
    if(!ck.length) return false;  // 자숙 0건 = 미시작
    const ckOuts = new Set();
    ck.forEach(r => {
      (r.wagonOut||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(w => ckOuts.add(w));
    });
    if(ckOuts.size === 0) return false;  // wagonOut 비어있으면 = 진행 중
    const shIns = new Set();
    sh.forEach(r => {
      (r.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(w => shIns.add(w));
    });
    // ck의 모든 wagonOut이 sh의 wagonIn에 등록되어야 완료
    for(const w of ckOuts) {
      if(!shIns.has(w)) return false;
    }
    // 그리고 자숙 record 모두 종료 (end 박힘)
    return ck.every(r => r.end && r.end !== '');
  }

  // 2) 파쇄 완료: 파쇄 record들의 wagonOut/cartOut → 모두 packing record의 cart/wagon에 사용 + 모두 종료
  function _isShreddingFlowedToPacking() {
    if(!sh.length) return false;
    const shOuts = new Set();
    sh.forEach(r => {
      (r.wagonOut||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(w => shOuts.add(w));
      (r.cartOut||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(w => shOuts.add(w));
    });
    if(shOuts.size === 0) return false;
    const pkUsed = new Set();
    pk.forEach(r => {
      const w = String(r.wagon||'').trim(); if(w) pkUsed.add(w);
      const c = String(r.cart||'').trim(); if(c) pkUsed.add(c);
      // 다중 wagon (배열) 형식도
      (r.wagons||[]).forEach(w2 => { const s=String(w2||'').trim(); if(s) pkUsed.add(s); });
    });
    for(const w of shOuts) {
      if(!pkUsed.has(w)) return false;
    }
    return sh.every(r => r.end && r.end !== '');
  }

  // 3) 포장 완료: 모든 packing record 종료 + 진행중(packing_pending) 0건
  function _isPackingDone() {
    if(!pk.length) return false;
    const allEnded = pk.every(r => r.end && r.end !== '');
    const noPending = !L.packing_pending || L.packing_pending.filter(r => 
      String(r.date||'').slice(0,10) === d
    ).length === 0;
    return allEnded && noPending;
  }

  const _ckDone = _isCookingFlowedToShredding();
  const _shDone = _isShreddingFlowedToPacking();
  const _pkDone = _isPackingDone();

  // metric: 완료 + 최소량 모두 통과해야 분석 (= 알람) 표시
  const _ppOYld = (_hasProduction && ppKg > 0 && rmKg > 0) ? r2(ppKg/rmKg*100) : null;
  const _ckOYld = (_hasProduction && ckKg >= _MIN_CK_KG && _ckDone) ? r2(ckKg/rmKg*100) : null;
  const _shOYld = (_hasProduction && shKg >= _MIN_SH_KG && _shDone) ? r2(shKg/rmKg*100) : null;
  const _pkOYld = (_hasProduction && pk.length > 0 && _pkDone) ? oYld : null;
  if(typeof renderDailyAlerts === 'function'){
    renderDailyAlerts({ preprocess: _ppOYld, cooking: _ckOYld, shredding: _shOYld, packing: _pkOYld }, d);
  }

  // 공정별 현황 - 파쇄 원육타입: 연결된 자숙 레코드에서 type 가져오기
  function getShType(shRecs, ckRecs) {
    const types = new Set();
    shRecs.forEach(sh => {
      const wIns = (sh.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean);
      wIns.forEach(wIn => {
        const ckRec2 = ckRecs.find(cr => (cr.wagonOut||'').split(',').map(w=>w.trim()).includes(wIn));
        if(ckRec2 && ckRec2.type) ckRec2.type.split(',').forEach(t=>{ if(t.trim()) types.add(t.trim()); });
      });
    });
    if(types.size) return [...types].join(',');
    // fallback: 자숙 전체 타입
    const fallback = [...new Set(ckRecs.map(c=>c.type||'').filter(Boolean))];
    return fallback.join(',') || '-';
  }
  // 타입별 그룹핑 헬퍼
  function groupByType(recs, kgField) {
    const map = {};
    recs.forEach(r => {
      const types = (r.type||'미분류').split(',').map(t=>t.trim()).filter(Boolean);
      types.forEach(t => {
        if(!map[t]) map[t] = {kg:0, mh:0, h:0, _recs:[]};
        map[t].kg += parseFloat(r[kgField]||0);
        map[t].mh += dur(r.start,r.end)*(parseFloat(r.workers)||0);
        map[t].h += dur(r.start,r.end);
        map[t]._recs.push(r);
      });
    });
    return map;
  }

  // 포장 와건/카트→파쇄→자숙 체인으로 원육타입 추적
  function getPkType(pkRec) {
    // noMeat 제품 (메추리알 등): 원육 추적 안 함 — 원육 칸 빈 값 처리
    const prod = (L.products||[]).find(x => x.name === pkRec.product);
    if(prod && prod.noMeat) return '';

    const wagons = (pkRec.wagon||'').split(',').map(w=>w.trim()).filter(Boolean);
    const carts  = (pkRec.cart ||'').split(',').map(w=>w.trim()).filter(Boolean);
    const types = new Set();
    // 와건 경로
    wagons.forEach(wNum => {
      const shRec = sh.find(r=>(r.wagonOut||'').split(',').map(w=>w.trim()).includes(wNum));
      if(shRec) {
        (shRec.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(wIn => {
          const ckRec = ck.find(r=>(r.wagonOut||'').split(',').map(w=>w.trim()).includes(wIn));
          if(ckRec && ckRec.type) ckRec.type.split(',').forEach(t=>types.add(t.trim()));
        });
      }
    });
    // 카트 경로 (FC 3kg 라인: 파쇄→카트로 배출된 후 포장)
    carts.forEach(cNum => {
      const shRec = sh.find(r=>(r.cartOut||'').split(',').map(w=>w.trim()).includes(cNum));
      if(shRec) {
        (shRec.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean).forEach(wIn => {
          const ckRec = ck.find(r=>(r.wagonOut||'').split(',').map(w=>w.trim()).includes(wIn));
          if(ckRec && ckRec.type) ckRec.type.split(',').forEach(t=>types.add(t.trim()));
        });
      }
    });
    if(types.size) return [...types].join(', ');
    // 폴백: 전처리 데이터에서 가장 많이 사용된 타입
    const ppTypes = pp.map(r=>r.type).filter(Boolean);
    if(ppTypes.length) return [...new Set(ppTypes)].join(', ');
    return '';
  }

  const ppGroup = groupByType(pp, 'kg');
  const ckGroup = groupByType(ck, 'kg');
  // 파쇄는 type 필드 없으므로 wagonIn → 자숙 wagonOut → 자숙 type으로 추적
  const shGroup = {};
  sh.forEach(r => {
    const wIns = (r.wagonIn||'').split(',').map(w=>w.trim()).filter(Boolean);
    let type = r.type || '';
    if(!type) {
      for(const wIn of wIns) {
        const ckRec = ck.find(c2=>(c2.wagonOut||'').split(',').map(w=>w.trim()).includes(wIn));
        if(ckRec && ckRec.type){ type = ckRec.type.split(',')[0].trim(); break; }
      }
    }
    if(!type) type = '미분류';
    if(!shGroup[type]) shGroup[type] = {kg:0, mh:0, h:0, _recs:[]};
    shGroup[type].kg += parseFloat(r.kg)||0;
    shGroup[type].mh += dur(r.start,r.end)*(parseFloat(r.workers)||0);
    shGroup[type].h += dur(r.start,r.end);
    shGroup[type]._recs.push(r);
  });

  // 원육타입별 투입KG + 박스수 (matchedTh 기준, 바코드 대체)
  const rmByType = {};
  const rmBoxByType = {};
  matchedTh.forEach(r=>{
    const t=(r.type||'미분류').split(',')[0].trim();
    if(!rmByType[t]) rmByType[t]=0;
    if(!rmBoxByType[t]) rmBoxByType[t]=0;
    rmByType[t]+=parseFloat(r.totalKg)||0;
    rmBoxByType[t]+=parseFloat(r.boxes)||1;
  });

  // 포장 원료육 계산은 위 KPI 섹션에서 처리

  // 행 조립
  const procRows = [];
  const allTypes = [...new Set([...Object.keys(ppGroup), ...Object.keys(ckGroup), ...Object.keys(shGroup)])];

  allTypes.forEach(t => {
    if(ppGroup[t]) {
      const inKg = r2(rmByType[t]||thByType[t]||rmKg||0);
      const ppWaste = r2((ppGroup[t]._recs||[]).reduce((s,r)=>s+(parseFloat(r.waste)||0),0));
      const ppWorkers = Math.round((ppGroup[t]._recs||[]).reduce((s,r)=>s+(parseFloat(r.workers)||0),0) / Math.max((ppGroup[t]._recs||[]).length,1));
      const ppBoxes = rmBoxByType[t]||0;
      procRows.push({name:'전처리', type:t, origKg:inKg, in:inKg, out:r2(ppGroup[t].kg), waste:ppWaste, mh:r2(ppGroup[t].mh), h:calcActualHours(ppGroup[t]._recs||[])||r2(ppGroup[t].h), workers:ppWorkers, boxes:ppBoxes});
    }
  });
  allTypes.forEach(t => {
    if(ckGroup[t]) {
      const ckInKg = r2((ppGroup[t]?.kg)||ppKg||0); // 자숙 투입 = 전처리 산출
      const ckOrigKg = r2(rmByType[t]||thByType[t]||rmKg||0);
      const ckWorkers = Math.round((ckGroup[t]._recs||[]).reduce((s,r)=>s+(parseFloat(r.workers)||0),0) / Math.max((ckGroup[t]._recs||[]).length,1));
      procRows.push({name:'자숙', type:t, origKg:ckOrigKg, in:ckInKg, out:r2(ckGroup[t].kg), waste:0, mh:r2(ckGroup[t].mh), h:calcActualHours(ckGroup[t]._recs||[])||r2(ckGroup[t].h), workers:ckWorkers});
    }
  });
  allTypes.forEach(t => {
    if(shGroup[t]) {
      // 타입별 독립 계산 (우둔/홍두께 각각 1:1 매칭)
      const _shShare = 1;
      const shOrigKg = r2((rmByType[t]||thByType[t]||0));
      const shRecs_t = shGroup[t]._recs||[]; const shH = calcActualHours(shRecs_t)||r2(shGroup[t].h)||calcActualHours(sh);
      // 투입 KG: 자숙 산출을 파쇄 타입 비중으로 비례 배분 (복수 파쇄 타입 이중계산 방지)
      const shInKg = r2((ckGroup[t]?.kg) ?? ckKg);
      const shWaste = r2((shRecs_t).reduce((s,r)=>s+(parseFloat(r.waste)||0),0));
      const shWorkers = Math.round(shRecs_t.reduce((s,r)=>s+(parseFloat(r.workers)||0),0) / Math.max(shRecs_t.length,1));
      procRows.push({name:'파쇄', type:t, origKg:shOrigKg, in:shInKg, out:r2(shGroup[t].kg), waste:shWaste, mh:r2(shGroup[t].mh), h:shH, workers:shWorkers});
    }
  });

  // 포장: 제품+원육타입 조합별
  const pkMap = {};
  pk.forEach(r => {
    const rawType = getPkType(r);
    const key = (rawType||r.product||'기타') + '__' + (r.product||'기타');
    if(!pkMap[key]) pkMap[key]={type:rawType, product:r.product||'기타', kg:0, mh:0, h:0};
    const p = L.products.find(x=>x.name===r.product);
    pkMap[key].kg += p ? (parseFloat(r.ea)||0)*p.kgea : 0;
    pkMap[key].ea = (pkMap[key].ea||0) + (parseFloat(r.ea)||0);
    pkMap[key].mh += dur(r.start,r.end)*(parseFloat(r.workers)||0);
    pkMap[key]._recs = pkMap[key]._recs||[]; pkMap[key]._recs.push(r);
    pkMap[key].h += dur(r.start,r.end);
  });
  // 포장 투입: wagonDist 있으면 그 합 그대로, 없으면 EA 비중 fallback
  // 각 packing의 wagonDist 합을 정확한 투입 kg으로 사용 (wagon 추적된 경우)
  function _sumWagonDist(rec){
    var wd = rec && rec.wagonDist;
    if(!wd || typeof wd !== 'object') return 0;
    return Object.values(wd).reduce(function(s,v){return s + (parseFloat(v)||0);}, 0);
  }
  const pkInKgMap = {}; // key별 투입KG 누적
  const pkOrigMap = {}; // key별 원육KG 누적
  const pkMapEntries = Object.entries(pkMap);
  Object.keys(shGroup).forEach(shType => {
    // 이 shType을 포함하는 포장 레코드들
    const relEntries = pkMapEntries.filter(([k,vv]) => {
      const types = (vv.type||'').split(',').map(t=>t.trim());
      return types.indexOf(shType) >= 0;
    });
    // wagonDist 있는 그룹과 없는 그룹 분리
    const wdEntries = []; // {k, vv, wdSum}
    const noWdEntries = []; // [k, vv]
    relEntries.forEach(([k,vv]) => {
      const wdSum = (vv._recs||[]).reduce((s,r)=>s+_sumWagonDist(r), 0);
      if(wdSum > 0){
        wdEntries.push({k:k, vv:vv, wdSum:wdSum});
      } else {
        noWdEntries.push([k, vv]);
      }
    });
    // wagonDist 있는 것: 그 합 그대로
    let usedKg = 0;
    wdEntries.forEach(e => {
      pkInKgMap[e.k] = r2((pkInKgMap[e.k]||0) + e.wdSum);
      usedKg += e.wdSum;
    });
    // wagonDist 없는 것: 잔여 파쇄량을 EA 비율로
    const remainingKg = Math.max(0, shGroup[shType].kg - usedKg);
    if(noWdEntries.length > 0 && remainingKg > 0){
      const totalRelEa = noWdEntries.reduce((s,[,vv])=>s+(vv.ea||0),0);
      noWdEntries.forEach(([k,vv]) => {
        const share = totalRelEa > 0 ? (vv.ea||0) / totalRelEa : 1/noWdEntries.length;
        pkInKgMap[k] = r2((pkInKgMap[k]||0) + remainingKg * share);
      });
    }
  });
  // rmByType도 동일 방식 (원육 분배)
  Object.keys(rmByType).forEach(rmType => {
    const relEntries = pkMapEntries.filter(([k,vv]) => {
      const types = (vv.type||'').split(',').map(t=>t.trim());
      return types.indexOf(rmType) >= 0;
    });
    // wagonDist 있는 그룹은 그 비율로 원육 분배 (정확)
    const wdEntries = []; const noWdEntries = [];
    let totalWdKg = 0;
    relEntries.forEach(([k,vv]) => {
      const wdSum = (vv._recs||[]).reduce((s,r)=>s+_sumWagonDist(r), 0);
      if(wdSum > 0){ wdEntries.push({k:k, vv:vv, wdSum:wdSum}); totalWdKg += wdSum; }
      else { noWdEntries.push([k, vv]); }
    });
    const totalRmKg = rmByType[rmType] || 0;
    // wagonDist 있는 것: wagonDist 비율로 원육 분배
    let usedRm = 0;
    if(totalWdKg > 0){
      const totalShKg = (shGroup[rmType] && shGroup[rmType].kg) || totalWdKg;
      // 원육 = 그 type 전체 원육 × (wd합 / 그 type 파쇄총합)
      wdEntries.forEach(e => {
        const ratio = e.wdSum / totalShKg;
        const orig = totalRmKg * ratio;
        pkOrigMap[e.k] = r2((pkOrigMap[e.k]||0) + orig);
        usedRm += orig;
      });
    }
    // wagonDist 없는 것: 잔여 원육을 EA 비율로
    const remainingRm = Math.max(0, totalRmKg - usedRm);
    if(noWdEntries.length > 0 && remainingRm > 0){
      const totalRelEa = noWdEntries.reduce((s,[,vv])=>s+(vv.ea||0),0);
      noWdEntries.forEach(([k,vv]) => {
        const share = totalRelEa > 0 ? (vv.ea||0) / totalRelEa : 1/noWdEntries.length;
        pkOrigMap[k] = r2((pkOrigMap[k]||0) + remainingRm * share);
      });
    }
  });
  Object.entries(pkMap).forEach(([key, v]) => {
    // noMeat 제품 판별: 첫 레코드의 제품으로 확인
    const firstRec = (v._recs||[])[0] || {};
    const prod = (L.products||[]).find(x => x.name === firstRec.product);
    const isNoMeat = !!(prod && prod.noMeat);

    // noMeat 제품: 원육 투입/배분 0 (메추리알 등은 원육 흐름 밖)
    const pkInKg = isNoMeat ? 0 : (pkInKgMap[key] || r2(shKg / Object.keys(pkMap).length));
    const pkOrig = isNoMeat ? 0 : (pkOrigMap[key] || r2(rmKg / Object.keys(pkMap).length));
    const label = v.type ? v.type+' · '+v.product : v.product;
    // 같은 호기(machine) 의 record 들은 같은 인원이 연속 작업한 것 → 평균.
    // 호기끼리는 합 (다른 호기 = 다른 사람). machine 빈값은 각자 별도 그룹 (옛 동작 유지).
    const _wByMachine = {};
    (v._recs||[]).forEach((r, idx) => {
      const m = String(r.machine||'').trim() || ('_no_'+idx);
      if(!_wByMachine[m]) _wByMachine[m] = [];
      _wByMachine[m].push(parseFloat(r.workers)||0);
    });
    const pkWorkers = Object.values(_wByMachine).reduce((s, ws) => {
      const avg = ws.length ? ws.reduce((a,b)=>a+b,0)/ws.length : 0;
      return s + avg;
    }, 0);
    procRows.push({name:'포장', type:label, origKg: isNoMeat ? 0 : (pkOrig||rmKg), in:pkInKg, out:r2(v.kg), waste:0, ea:v.ea||0, mh:r2(v.mh), h:calcActualHours(v._recs||[])||r2(v.h), workers:pkWorkers, noMeat:isNoMeat});
  });

  // 원육수율 색상 기준 (원육 투입 대비 각 공정 산출)
  function getOrigYldColor(name, y){
    if(y===null) return 'var(--g4)';
    if(name==='전처리') return y>=97?'var(--s)':y>=93?'var(--w)':'var(--d)';
    if(name==='자숙')   return y>=52?'var(--s)':y>=48?'var(--w)':'var(--d)';
    if(name==='파쇄')   return y>=48?'var(--s)':y>=44?'var(--w)':'var(--d)';
    return y>=48?'var(--s)':y>=44?'var(--w)':'var(--d)';
  }
  // 공정수율 색상 기준 (직전 공정 대비)
  function getProcYldColor(name, y){
    if(y===null) return 'var(--g4)';
    if(name==='전처리') return y>=97?'var(--s)':y>=93?'var(--w)':'var(--d)';
    if(name==='자숙')   return y>=54&&y<=58?'var(--s)':y>=50?'var(--w)':'var(--d)';
    if(name==='파쇄')   return y>=90?'var(--s)':y>=85?'var(--w)':'var(--d)';
    return y>=98&&y<=102?'var(--s)':y>=95?'var(--w)':'var(--d)';
  }


  _chDayDir=0;
  const tbody=document.getElementById('pTbl');
  let _prevName = '';
  if(tbody) tbody.innerHTML = procRows.map(p => {
    const showName = p.name !== _prevName;
    if(showName) _prevName = p.name;
    const oYld = p.origKg>0 ? p.out/p.origKg*100 : null;
    const pYld = p.in>0 ? p.out/p.in*100 : null;
    const borderTop = showName && procRows.indexOf(p)>0 ? 'border-top:2px solid var(--g2);' : '';
    // 생산성: 공정별 측정 기준 (작업자가 통제하는 것 기준)
    //  - 전처리: 투입(p.in = rmKg, 작업자가 받은 양)
    //  - 자숙:   투입(p.in = 케이지 채운 양)
    //  - 파쇄:   산출(p.out = 파쇄해서 다음 공정 보낸 양)
    //  - 포장:   산출 EA (p.ea)
    let productivity = '-';
    if(p.name==='포장' && p.mh>0 && p.ea>0) {
      productivity = r2(p.ea/p.mh).toLocaleString()+' EA/인시';
    } else if((p.name==='전처리' || p.name==='자숙') && p.mh>0 && p.in>0) {
      productivity = r2(p.in/p.mh).toFixed(1)+' kg/인시';
    } else if(p.name==='파쇄' && p.mh>0 && p.out>0) {
      productivity = r2(p.out/p.mh).toFixed(1)+' kg/인시';
    } else if(p.mh>0 && p.out>0) {
      // fallback: 모르는 공정명 → 산출 기준
      productivity = r2(p.out/p.mh).toFixed(1)+' kg/인시';
    }
    return `<tr style="${borderTop}">
      <td style="text-align:left;font-weight:600">${showName?p.name:''}</td>
      <td style="text-align:center;color:var(--g6);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.type||'-'}">${p.type||'-'}</td>
      <td style="text-align:center">${p.in>0?p.in.toFixed(2):'-'}${p.boxes?'<br><span style="font-size:11px;color:var(--g5)">'+p.boxes+'박스</span>':''}</td>
      <td style="text-align:center;font-weight:600">${p.noMeat?'-':p.out.toFixed(2)}</td>
      <td style="text-align:center;color:var(--d);font-size:12px">${p.waste>0?p.waste.toFixed(2)+'kg':'-'}</td>
      <td style="text-align:center;font-weight:600">${p.noMeat?'-':(oYld!==null?oYld.toFixed(1)+'%':'-')}</td>
      <td style="text-align:center;font-weight:600">${p.noMeat?'-':(pYld!==null?pYld.toFixed(1)+'%':'-')}</td>
      <td style="text-align:center">${p.h.toFixed(1)}h</td>
      <td style="text-align:center">${p.workers||'-'}명</td>
      <td style="text-align:center;font-size:12px;color:var(--g6)">${productivity}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;padding:1rem;color:var(--g4)">데이터 없음</td></tr>';

  // 포장 실적
  const pkTbody=document.getElementById('pkTbl');
  if(pkTbody){
    const byProd={};
    pk.forEach(r=>{ if(!byProd[r.product||'-']) byProd[r.product||'-']={ea:0,pouch:0,defect:0}; byProd[r.product||'-'].ea+=parseFloat(r.ea)||0; byProd[r.product||'-'].pouch+=parseFloat(r.pouch)||0; byProd[r.product||'-'].defect+=parseFloat(r.defect)||0; });
    pkTbody.innerHTML=Object.entries(byProd).map(([prod,v])=>`
      <tr>
        <td style="text-align:left">${prod}</td>
        <td style="text-align:center;font-weight:600">${v.ea.toLocaleString()}</td>
        <td style="text-align:center">${v.pouch.toLocaleString()}</td>
        <td style="text-align:center">${v.defect.toLocaleString()}</td>
        <td style="text-align:center;font-weight:600;color:${v.ea>0&&r2(v.defect/v.ea*100)<2?'var(--s)':'var(--d)'}">
          ${v.ea>0?r2(v.defect/v.ea*100).toFixed(2)+'%':'-'}
        </td>
      </tr>`).join('')||'<tr><td colspan="5" style="text-align:center;padding:1rem;color:var(--g4)">데이터 없음</td></tr>';
  }

  // 방혈 데이터도 타임라인에 포함
  renderTL(pp,ck,sh,pk);

  // 원육 검수
  const bcGd=bc.filter(b=>b.status==='적합');
  const bPart={};
  bcGd.forEach(b=>{if(!bPart[b.part])bPart[b.part]={count:0,kg:0};bPart[b.part].count++;bPart[b.part].kg+=parseFloat(b.weightKg)||0;});
  const bcSumEl=document.getElementById('bcSum');
  if(bcSumEl) bcSumEl.innerHTML=bc.length?
    `<div class="kg3" style="margin-bottom:1rem">
      <div class="kc inf"><div class="klb">총검수</div><div class="kv">${bc.length}</div></div>
      <div class="kc gd"><div class="klb">적합</div><div class="kv">${bcGd.length}</div></div>
      <div class="kc bd2"><div class="klb">부적합</div><div class="kv">${bc.length-bcGd.length}</div></div>
    </div>
    <table class="tbl"><thead><tr><th>부위</th><th class="tr">수량</th><th class="tr">총중량(kg)</th></tr></thead>
    <tbody>${Object.entries(bPart).map(([p,v])=>`<tr><td>${p}</td><td class="tr">${v.count}</td><td class="tr">${r2(v.kg).toFixed(2)}</td></tr>`).join('')}</tbody></table>`:
    '<div class="emp">데이터 없음 (전날 원육 검수)</div>';
}

var _tlMode = 'integrated';  // 'integrated' | 'byCart'
var _tlData = null;          // 마지막 데이터 캐시 (pp,ck,sh,pk)

// 막대 클릭 = 스티커 고정 토글. 한 번에 한 개만.
function tlPin(barEl){
  if(!barEl) return;
  const wrap = document.getElementById('tlWrap');
  if(!wrap) return;
  // 이미 핀되어 있던 막대?
  const wasPinned = barEl.classList.contains('tlPinned');
  // 기존 핀/스티커 모두 제거
  wrap.querySelectorAll('.tlPinned').forEach(el => el.classList.remove('tlPinned'));
  wrap.querySelectorAll('.tlSticker').forEach(el => el.remove());
  if(wasPinned) return;  // 같은 막대 다시 클릭 = 해제
  // 새로 핀
  barEl.classList.add('tlPinned');
  const txt = barEl.getAttribute('data-sticker') || '';
  const sticker = document.createElement('div');
  sticker.className = 'tlSticker';
  sticker.textContent = txt;
  // 막대 부모(.tlt)에 붙여서 X 좌표 동일선상에 위치
  const parent = barEl.parentElement;
  if(!parent) return;
  // 막대의 left%를 그대로 사용
  const left = barEl.style.left || '0%';
  sticker.style.left = left;
  parent.appendChild(sticker);
}

function setTlMode(mode){
  if(mode !== 'integrated' && mode !== 'byCart') return;
  _tlMode = mode;
  // 버튼 active 상태
  const a=document.getElementById('tlModeIntegrated'), b=document.getElementById('tlModeByCart');
  if(a) a.style.background = mode==='integrated' ? '#1a56db' : '';
  if(a) a.style.color      = mode==='integrated' ? '#fff' : '';
  if(b) b.style.background = mode==='byCart'     ? '#1a56db' : '';
  if(b) b.style.color      = mode==='byCart'     ? '#fff' : '';
  if(_tlData) renderTL(_tlData.pp, _tlData.ck, _tlData.sh, _tlData.pk);
}

function renderTL(pp,ck,sh,pk){
  _tlData = {pp,ck,sh,pk};
  // 버튼 active 동기화 (최초 진입 포함)
  const _a=document.getElementById('tlModeIntegrated'), _b=document.getElementById('tlModeByCart');
  if(_a){ _a.style.background = _tlMode==='integrated' ? '#1a56db' : ''; _a.style.color = _tlMode==='integrated' ? '#fff' : ''; }
  if(_b){ _b.style.background = _tlMode==='byCart'     ? '#1a56db' : ''; _b.style.color = _tlMode==='byCart'     ? '#fff' : ''; }

  const el=document.getElementById('tlWrap');
  if(!el) return;
  const all=[...pp.map(r=>({...r,lbl:'전처리',col:'#1a56db'})),...ck.map(r=>({...r,lbl:'자숙',col:'#0e9f6e'})),...sh.map(r=>({...r,lbl:'파쇄',col:'#c27803'})),...pk.map(r=>({...r,lbl:'포장',col:'#7e3af2'}))];
  if(!all.length){el.innerHTML='<div class="emp">데이터 없음</div>';return;}
  const toMin=t=>{if(!t)return null;const p=t.slice(0,5).split(':');return+p[0]*60+(+p[1]||0);};
  const mins=all.flatMap(r=>[toMin(r.start),toMin(r.end)]).filter(v=>v!==null);
  const minT=Math.min(...mins), maxT=Math.max(...mins);
  const headStart=Math.floor(minT/60)*60;
  const headEnd=Math.ceil(maxT/60)*60;
  const range=Math.max(60, headEnd-headStart);
  const hourCount=Math.ceil(maxT/60)-Math.floor(minT/60)+1;
  const headHtml=[];
  for(let i=0;i<hourCount;i++){
    const h=(Math.floor(minT/60)+i)%24;
    const hourMin=(Math.floor(minT/60)+i)*60;
    const leftPct=((hourMin-headStart)/range*100);
    let tx='translateX(-50%)';
    if(i===0) tx='translateX(0)';
    else if(i===hourCount-1) tx='translateX(-100%)';
    headHtml.push(`<div class="tlhr" style="left:${leftPct}%;transform:${tx}">${String(h).padStart(2,'0')}:00</div>`);
  }

  // 막대 한 줄 HTML 생성 헬퍼
  const _bar=(r)=>{
    const s=toMin(r.start),e=toMin(r.end);
    if(s===null||e===null) return '';
    const left=r2((s-headStart)/range*100), width=r2((e-s)/range*100);
    const ts=r.start?r.start.slice(0,5):'', te=r.end?r.end.slice(0,5):'';
    // 통합 모드 = 막대 안 텍스트 X (hover로만), 카트별 = 기존 텍스트
    const inner = (_tlMode==='integrated') ? '' : `${ts}-${te}`;
    const titleParts=[r.lbl, `${ts}~${te}`];
    if(r.type) titleParts.push(r.type);
    if(r.product) titleParts.push(r.product);
    if(r.cart) titleParts.push('카트 '+r.cart);
    else if(r.wagons) titleParts.push('카트 '+r.wagons);
    // 스티커용 라벨 (시간 + 부위/제품 등)
    const stickerParts=[`${ts}~${te}`];
    if(r.type) stickerParts.push(r.type);
    if(r.product) stickerParts.push(r.product);
    const stickerText = stickerParts.join(' · ').replace(/"/g,'&quot;');
    const clickAttr = (_tlMode==='integrated') ? ` onclick="tlPin(this)" data-sticker="${stickerText}"` : '';
    return `<div class="tlb" title="${titleParts.join(' · ')}"${clickAttr} style="left:${left}%;width:${Math.max(width,1.2)}%;background:${r.col}">${inner}</div>`;
  };

  let bodyHtml = '';
  if(_tlMode === 'integrated'){
    // 공정별 1줄, 같은 줄에 카트마다 별도 막대 + 우측 요약
    const groups = [
      {lbl:'전처리', col:'#1a56db', rows: pp},
      {lbl:'자숙',   col:'#0e9f6e', rows: ck},
      {lbl:'파쇄',   col:'#c27803', rows: sh},
      {lbl:'포장',   col:'#7e3af2', rows: pk}
    ];
    const _fmtDur = (mins) => {
      if(mins<=0) return '-';
      const h=Math.floor(mins/60), m=mins%60;
      return h>0 ? (m>0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    };
    bodyHtml = groups.filter(g=>g.rows && g.rows.length).map(g=>{
      const bars = g.rows.map(r=>_bar({...r, lbl:g.lbl, col:g.col})).join('');
      // 우측 요약 계산
      const validMins = g.rows.flatMap(r=>{
        const s=toMin(r.start), e=toMin(r.end);
        return (s===null||e===null) ? [] : [{s,e}];
      });
      let summary = '';
      if(validMins.length){
        const minS = Math.min(...validMins.map(x=>x.s));
        const maxE = Math.max(...validMins.map(x=>x.e));
        const totalDur = validMins.reduce((sum,x)=>sum+(x.e-x.s),0);
        const _hm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
        summary = `<div class="tlSum"><div class="tlSumTime">${_hm(minS)} ~ ${_hm(maxE)}</div><div class="tlSumMeta">${g.rows.length}건 · ${_fmtDur(totalDur)}</div></div>`;
      }
      return `<div class="tlr tlrInt"><div class="tll">${g.lbl}</div><div class="tlt">${bars}</div>${summary}</div>`;
    }).join('');
  } else {
    // 카트별 = 기존 동작 (각 row 1줄)
    bodyHtml = all.map(r=>{
      const bar=_bar(r);
      if(!bar) return '';
      return `<div class="tlr"><div class="tll">${r.lbl}</div><div class="tlt">${bar}</div></div>`;
    }).join('');
  }

  el.innerHTML=`<div class="tlw"><div class="tlg">
    <div class="tlh">${headHtml.join('')}</div>
    ${bodyHtml}
  </div></div>`;
}

// ============================================================
// 타임라인 엑셀 다운로드
// 현재 화면에 그려진 타임라인을 엑셀로 — 간트 차트 풍 (시간대 셀 색상)
// ============================================================
async function exportTimeline(){
  if(!_tlData || !(_tlData.pp.length+_tlData.ck.length+_tlData.sh.length+_tlData.pk.length)){
    if(typeof toast==='function') toast('타임라인 데이터가 없습니다','w'); else alert('타임라인 데이터가 없습니다');
    return;
  }
  if(typeof toast==='function') toast('타임라인 엑셀 생성 중...','i');

  const date = DDATE || (typeof tod==='function' ? tod() : new Date().toISOString().slice(0,10));
  const {pp,ck,sh,pk} = _tlData;

  const wb = XLSX.utils.book_new();

  const COL_PP = 'BFDBFE';  // 전처리 파랑 (연한)
  const COL_CK = 'BBF7D0';  // 자숙 초록
  const COL_SH = 'FED7AA';  // 파쇄 주황
  const COL_PK = 'E9D5FF';  // 포장 보라
  const HDR_BG = 'B4C6E7';
  const META_BG = 'D9E1F2';
  const BORDER_THIN = { style:'thin', color:{rgb:'B0B0B0'} };
  const BORDER_ALL = { top:BORDER_THIN, bottom:BORDER_THIN, left:BORDER_THIN, right:BORDER_THIN };
  const FONT_DEFAULT = { name:'맑은 고딕', sz:10 };
  const FONT_BOLD = { name:'맑은 고딕', sz:10, bold:true };
  const FONT_TITLE = { name:'맑은 고딕', sz:16, bold:true };
  const ALIGN_CENTER = { horizontal:'center', vertical:'center', wrapText:true };

  function colLetter(col){ let s='',n=col; while(n>=0){ s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; if(n<0)break; } return s; }
  function cellRef(r,c){ return colLetter(c)+(r+1); }
  function toMin(t){ if(!t) return null; const p=t.slice(0,5).split(':'); return +p[0]*60+(+p[1]||0); }
  function hm(m){ return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }

  // 시간 범위: 모든 start/end의 min~max를 30분 단위로 그리드
  const all = [...pp,...ck,...sh,...pk];
  const mins = all.flatMap(r=>[toMin(r.start),toMin(r.end)]).filter(v=>v!==null);
  if(!mins.length){ if(typeof toast==='function') toast('시간 정보가 없습니다','w'); return; }
  const SLOT = 30;  // 30분 단위
  const gridStart = Math.floor(Math.min(...mins)/SLOT)*SLOT;
  const gridEnd   = Math.ceil(Math.max(...mins)/SLOT)*SLOT;
  const slotCnt   = Math.max(1, (gridEnd-gridStart)/SLOT);

  // 헤더 라벨
  const timeHeaders = [];
  for(let i=0;i<slotCnt;i++) timeHeaders.push(hm(gridStart+i*SLOT));

  const aoa = [];
  const styles = {};
  const merges = [];
  let r = 0;

  // ── 메타박스 ──
  const sumKg = (arr) => arr.reduce((s,x)=>s+(parseFloat(x.kg)||parseFloat(x.totalKg)||0), 0);
  const ppKg = sumKg(pp), ckKg = sumKg(ck), shKg = sumKg(sh);
  const pkEa = pk.reduce((s,x)=>s+(parseFloat(x.ea)||0), 0);
  // 부위/제품 종류
  const types = [...new Set(pp.map(x=>x.type).filter(Boolean))];
  const products = [...new Set(pk.map(x=>x.product).filter(Boolean))];

  // 1번째 행: 제목 (좌측) + 작업일자 (우측)
  // 좌측 7열 병합으로 제목, 우측 2열로 라벨/값
  const metaRows = [
    ['작업일자', date],
    ['부위', types.join(', ') || '-'],
    ['제품', products.join(', ') || '-'],
    ['시간 범위', hm(gridStart)+' ~ '+hm(gridEnd)],
  ];
  const titleStartRow = r;
  metaRows.forEach((mr, idx) => {
    const row = new Array(2+slotCnt).fill('');
    if(idx === 0) row[0] = '공정 타임라인 — '+date;
    row[slotCnt] = mr[0];      // label (우측에서 두번째 칸)
    row[slotCnt+1] = mr[1];    // value (마지막 칸)
    aoa.push(row);

    // 좌측 제목 박스 (0 ~ slotCnt-1까지)
    for(let c=0;c<slotCnt;c++){
      styles[cellRef(r,c)] = { font: idx===0 ? FONT_TITLE : FONT_DEFAULT, alignment: ALIGN_CENTER, border: BORDER_ALL };
    }
    // 메타 라벨/값
    styles[cellRef(r,slotCnt)]   = { font: FONT_BOLD,    alignment: ALIGN_CENTER, fill:{fgColor:{rgb:META_BG}}, border: BORDER_ALL };
    styles[cellRef(r,slotCnt+1)] = { font: FONT_DEFAULT, alignment: ALIGN_CENTER, border: BORDER_ALL };
    r++;
  });
  const titleEndRow = r-1;
  // 좌측 제목 통째로 병합
  merges.push({ s:{r:titleStartRow,c:0}, e:{r:titleEndRow,c:slotCnt-1} });

  // 빈 행
  aoa.push(new Array(2+slotCnt).fill(''));
  r++;

  // ── 본문: 시간 헤더 행 ──
  const headerRow = r;
  const hdrRow = ['공정','요약', ...timeHeaders];
  aoa.push(hdrRow);
  for(let c=0;c<hdrRow.length;c++){
    styles[cellRef(r,c)] = { font: FONT_BOLD, alignment: ALIGN_CENTER, fill:{fgColor:{rgb:HDR_BG}}, border: BORDER_ALL };
  }
  r++;

  // ── 본문: 공정별 행 ──
  function _fmtDur(mins){ if(mins<=0) return '-'; const h=Math.floor(mins/60),m=mins%60; return h>0?(m>0?`${h}h ${m}m`:`${h}h`):`${m}m`; }
  function _summary(rows){
    const vm = rows.flatMap(x=>{ const s=toMin(x.start),e=toMin(x.end); return (s===null||e===null)?[]:[{s,e}]; });
    if(!vm.length) return '-';
    const minS=Math.min(...vm.map(x=>x.s)), maxE=Math.max(...vm.map(x=>x.e));
    const dur=vm.reduce((s,x)=>s+(x.e-x.s),0);
    return `${hm(minS)}~${hm(maxE)}\n${rows.length}건 · ${_fmtDur(dur)}`;
  }

  const groups = [
    { lbl:'전처리', col:COL_PP, rows: pp },
    { lbl:'자숙',   col:COL_CK, rows: ck },
    { lbl:'파쇄',   col:COL_SH, rows: sh },
    { lbl:'포장',   col:COL_PK, rows: pk },
  ];

  groups.filter(g=>g.rows && g.rows.length).forEach(g => {
    const row = new Array(2+slotCnt).fill('');
    row[0] = g.lbl;
    row[1] = _summary(g.rows);
    aoa.push(row);

    // 라벨/요약 스타일
    styles[cellRef(r,0)] = { font: FONT_BOLD,    alignment: ALIGN_CENTER, fill:{fgColor:{rgb:META_BG}}, border: BORDER_ALL };
    styles[cellRef(r,1)] = { font: FONT_DEFAULT, alignment: ALIGN_CENTER, border: BORDER_ALL };
    // 슬롯 셀: 시간 점유 여부에 따라 색상
    for(let i=0;i<slotCnt;i++){
      const slotStart = gridStart + i*SLOT;
      const slotEnd   = slotStart + SLOT;
      // 이 슬롯과 겹치는 row 있는가?
      const overlap = g.rows.some(x=>{
        const s=toMin(x.start),e=toMin(x.end);
        if(s===null||e===null) return false;
        return s < slotEnd && e > slotStart;
      });
      const cellStyle = { font: FONT_DEFAULT, alignment: ALIGN_CENTER, border: BORDER_ALL };
      if(overlap) cellStyle.fill = { fgColor:{rgb: g.col} };
      styles[cellRef(r, 2+i)] = cellStyle;
    }
    r++;
  });

  // 시트 생성
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 컬럼 너비: 공정 8, 요약 16, 시간 슬롯 5
  const cols = [{wch:8},{wch:18}];
  for(let i=0;i<slotCnt;i++) cols.push({wch:5});
  ws['!cols'] = cols;
  ws['!merges'] = merges;
  // 행 높이
  const rowHeights = [];
  for(let i=0;i<r;i++){
    if(i<=titleEndRow) rowHeights.push({hpt: 22});
    else if(i===headerRow) rowHeights.push({hpt: 24});
    else rowHeights.push({hpt: 30});
  }
  ws['!rows'] = rowHeights;

  Object.entries(styles).forEach(([addr,style])=>{
    if(ws[addr]) ws[addr].s = style;
    else ws[addr] = { v:'', s:style };
  });

  ws['!pageSetup'] = { orientation:'landscape', paperSize: 9, fitToWidth:1, fitToHeight:1 };
  ws['!margins'] = { left:0.3, right:0.3, top:0.3, bottom:0.3, header:0.2, footer:0.2 };
  ws['!printOptions'] = { horizontalCentered:true, verticalCentered:true };

  XLSX.utils.book_append_sheet(wb, ws, '타임라인');

  const fname = `공정타임라인_${date.replace(/-/g,'')}.xlsx`;
  if(typeof _saveXlsx==='function'){
    await _saveXlsx(wb, fname);
  } else {
    XLSX.writeFile(wb, fname);
  }
  if(typeof toast==='function') toast('타임라인 다운로드 완료 ✓','s');
}

// ============================================================
// 트렌드
// ============================================================
var _trendChart=null;
async function renderTrend(){
  const days = PD==='week'?7 : PD==='month'?30 : 90;
  const endDate = tod();
  const startDate = (()=>{ const d=new Date(); d.setDate(d.getDate()-(days-1)); return d.toISOString().slice(0,10); })();

  const [pkRecs,ppRecs,ckRecs,shRecs] = await Promise.all([
    fbGetRange('packing',startDate,endDate),
    fbGetRange('preprocess',startDate,endDate),
    fbGetRange('cooking',startDate,endDate),
    fbGetRange('shredding',startDate,endDate)
  ]);

  // 포장 완료된 날짜만 (작업일)
  const pkDates = new Set(pkRecs.map(r=>String(r.date||'').slice(0,10)).filter(Boolean));
  const allDays=[];
  for(let i=days-1;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); allDays.push(d.toISOString().slice(0,10)); }
  const activeDates = allDays.filter(ds=>pkDates.has(ds));
  if(!activeDates.length) return;

  const lbl = activeDates.map(ds=>ds.slice(5)+'('+dayOfWeek(ds)+')');

  // 데이터 계산
  const eaData  = activeDates.map(ds=>pkRecs.filter(r=>r.date===ds).reduce((s,r)=>s+(parseFloat(r.ea)||0),0));
  const rmData  = activeDates.map(ds=>ppRecs.filter(r=>r.date===ds).reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const ckYd    = activeDates.map(ds=>{ const rm=rmData[activeDates.indexOf(ds)]; const kg=ckRecs.filter(r=>r.date===ds).reduce((s,r)=>s+(parseFloat(r.kg)||0),0); return rm>0?r2(kg/rm*100):null; });
  const shYd    = activeDates.map(ds=>{ const rm=rmData[activeDates.indexOf(ds)]; const kg=shRecs.filter(r=>r.date===ds).reduce((s,r)=>s+(parseFloat(r.kg)||0),0); return rm>0?r2(kg/rm*100):null; });
  const pkYd    = activeDates.map(ds=>{ const rm=rmData[activeDates.indexOf(ds)]; const pkKg=pkRecs.filter(r=>r.date===ds).reduce((s,r)=>{ const p=L.products.find(x=>x.name===r.product); return s+(p?(parseFloat(r.ea)||0)*p.kgea:0); },0); return rm>0?r2(pkKg/rm*100):null; });
  const wasteData = activeDates.map(ds=>{
    const ppW=ppRecs.filter(r=>r.date===ds).reduce((s,r)=>s+(parseFloat(r.waste)||0),0);
    const shW=shRecs.filter(r=>r.date===ds).reduce((s,r)=>s+(parseFloat(r.waste)||0),0);
    const rm=rmData[activeDates.indexOf(ds)];
    return rm>0?r2((ppW+shW)/rm*100):null;
  });
  const defData  = activeDates.map(ds=>{ const ea=pkRecs.filter(r=>r.date===ds).reduce((s,r)=>s+(parseFloat(r.ea)||0),0); const def=pkRecs.filter(r=>r.date===ds).reduce((s,r)=>s+(parseFloat(r.defect)||0),0); return ea>0?r2(def/ea*100):null; });
  const mhEaData = activeDates.map((ds,i)=>{ const mh=sumMH([...ppRecs,...ckRecs,...shRecs,...pkRecs].filter(r=>r.date===ds)); return mh>0?r2(eaData[i]/mh):null; });

  // 이달 평균 / 전달 평균 (원육)
  const rmAvg = rmData.length>0 ? r2(rmData.reduce((s,v)=>s+v,0)/rmData.length) : 0;
  // 전달 평균 - 로컬 데이터에서
  const prevMonth = (()=>{ const d=new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); })();
  const prevPkRecs = (L.preprocess||[]).filter(r=>String(r.date||'').slice(0,7)===prevMonth);
  const prevRmAvg = prevPkRecs.length>0 ? r2(prevPkRecs.reduce((s,r)=>s+(parseFloat(r.kg)||0),0)/prevPkRecs.length) : 0;

  const baseOpts = (yLabel) => ({
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{display:false} },
    scales:{
      x:{ticks:{color:'#888',font:{size:10},maxRotation:45},grid:{display:false}},
      y:{ticks:{color:'#888',font:{size:10},callback:yLabel},grid:{color:'rgba(128,128,128,0.1)'}}
    }
  });
  const lineOpts = (yLabel) => ({...baseOpts(yLabel), plugins:{legend:{position:'top',display:true}}});

  // ① 일별 생산량
  const c1=document.getElementById('c_ea');
  if(c1){ if(window._eaChart) window._eaChart.destroy();
    const target = L.dbTarget||0;
    window._eaChart=new Chart(c1,{ type:'bar',
      data:{labels:lbl,datasets:[
        {label:'생산EA',data:eaData,backgroundColor:'rgba(26,86,219,.7)',borderRadius:4,borderSkipped:false},
        ...(target>0?[{label:'목표',data:Array(lbl.length).fill(target),type:'line',borderColor:'#f87171',borderDash:[4,3],pointRadius:0,borderWidth:1.5,fill:false}]:[])
      ]},
      options:{...baseOpts(v=>v>=1000?(v/1000).toFixed(0)+'k':v),plugins:{legend:{display:target>0,position:'top'}}} }); }

  // ② 원육 사용량 + 이달평균/전월평균
  const c2=document.getElementById('trendChart');
  if(c2){ if(_trendChart) _trendChart.destroy();
    _trendChart=new Chart(c2,{ type:'bar',
      data:{labels:lbl,datasets:[
        {label:'원육(kg)',data:rmData,backgroundColor:'rgba(14,159,110,.7)',borderRadius:4,borderSkipped:false},
        {label:'이달평균',data:Array(lbl.length).fill(rmAvg),type:'line',borderColor:'#f59e0b',borderDash:[4,3],pointRadius:0,borderWidth:2,fill:false},
        ...(prevRmAvg>0?[{label:'전월평균',data:Array(lbl.length).fill(prevRmAvg),type:'line',borderColor:'#f87171',borderDash:[4,3],pointRadius:0,borderWidth:2,fill:false}]:[])
      ]},
      options:{...baseOpts(v=>v.toFixed(0)+'kg'),plugins:{legend:{display:true,position:'top'}}} }); }

  // ③ 공정별 수율
  const c3=document.getElementById('c_yd');
  if(c3){ if(_ydChart) _ydChart.destroy();
    _ydChart=new Chart(c3,{ type:'line',
      data:{labels:lbl,datasets:[
        {label:'자숙수율',data:ckYd,borderColor:'#22c55e',fill:false,tension:.3,pointRadius:4,spanGaps:true},
        {label:'파쇄수율',data:shYd,borderColor:'#f97316',fill:false,tension:.3,pointRadius:4,spanGaps:true},
        {label:'포장수율',data:pkYd,borderColor:'#6d28d9',fill:false,tension:.3,pointRadius:4,spanGaps:true}
      ]},
      options:{...lineOpts(v=>v+'%'),scales:{...baseOpts().scales,y:{...baseOpts().scales.y,min:0,max:100,ticks:{color:'#888',font:{size:10},callback:v=>v+'%'}}}} }); }

  // ④ 비가식부 손실률
  const c4=document.getElementById('c_waste');
  if(c4){ if(window._wasteChart) window._wasteChart.destroy();
    window._wasteChart=new Chart(c4,{ type:'bar',
      data:{labels:lbl,datasets:[{label:'손실률',data:wasteData,backgroundColor:'rgba(107,114,128,.6)',borderRadius:4,borderSkipped:false}]},
      options:{...baseOpts(v=>v!=null?v+'%':'')} }); }

  // ⑤ 포장 불량률 + 목표 기준선
  const c5=document.getElementById('c_def');
  if(c5){ if(window._defChart) window._defChart.destroy();
    const _Tt = (typeof getTargets === 'function') ? getTargets() : {defGoal:2};
    window._defChart=new Chart(c5,{ type:'line',
      data:{labels:lbl,datasets:[
        {label:'불량률',data:defData,borderColor:'#e24b4a',backgroundColor:'rgba(226,75,74,0.1)',fill:true,tension:.3,pointRadius:4,spanGaps:true},
        {label:'목표',data:Array(lbl.length).fill(_Tt.defGoal),borderColor:'#f59e0b',borderDash:[4,3],pointRadius:0,borderWidth:1.5,fill:false}
      ]},
      options:{...lineOpts(v=>v+'%'),scales:{...baseOpts().scales,y:{...baseOpts().scales.y,min:0,ticks:{color:'#888',font:{size:10},callback:v=>v+'%'}}}} }); }

  // ⑥ 인시당 EA
  const c6=document.getElementById('c_mh');
  if(c6){ if(_mhChart) _mhChart.destroy();
    _mhChart=new Chart(c6,{ type:'bar',
      data:{labels:lbl,datasets:[{label:'인시당EA',data:mhEaData,backgroundColor:'rgba(194,120,3,.7)',borderRadius:4,borderSkipped:false}]},
      options:{...baseOpts(v=>v!=null?v.toFixed(1):''),plugins:{legend:{display:false}}} }); }
}


function setPd(pd, el){
  PD=pd;
  document.querySelectorAll('#p-trend .pt').forEach(b=>b.classList.remove('on'));
  if(el) el.classList.add('on');
  renderTrend();
}
// ============================================================
// 내포장 수량 차트 (월별현황 탭)
// ============================================================
var _moPackingChart = null;
var _moPackingMode = 'detail'; // 'ea' / 'weight' / 'detail'
var _moPackingArgs = null; // 마지막 렌더 인자 보관 (탭 전환 시 재사용)

function setPackingChartMode(mode){
  _moPackingMode = mode;
  // segmented control: 활성 버튼만 흰 배경 + 그림자, 나머지는 투명
  ['ea','weight','detail'].forEach(m => {
    const btn = document.getElementById('pkTab_'+m);
    if(!btn) return;
    if(m === mode){
      btn.style.background = '#fff';
      btn.style.color = '#1e293b';
      btn.style.fontWeight = '600';
      btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = '#64748b';
      btn.style.fontWeight = '500';
      btn.style.boxShadow = 'none';
    }
  });
  // 차트 다시 그리기
  if(_moPackingArgs){
    renderPackingChart(_moPackingArgs.dayEntries, _moPackingArgs.opMap, _moPackingArgs.ym);
  }
}

function renderPackingChart(dayEntries, opMap, ym) {
  // 인자 보관 (탭 전환 시 재사용)
  _moPackingArgs = { dayEntries, opMap, ym };
  window._moPackingArgs = _moPackingArgs;

  const canvas = document.getElementById('mo_bar_chart');
  if (!canvas) return;

  if (_moPackingChart) { _moPackingChart.destroy(); _moPackingChart = null; }

  const DOW = ['일','월','화','수','목','금','토'];
  function dLabel(dateStr) {
    const [y,m,d] = dateStr.split('-').map(Number);
    return d + '(' + DOW[new Date(y,m-1,d).getDay()] + ')';
  }
  function prodShort(full) {
    const m = (full||'').match(/(\d+(?:\.\d+)?)\s*(g|KG)\b/i);
    if (!m) return full.slice(0,6);
    return m[2].toUpperCase()==='KG' ? m[1]+'KG' : m[1]+'g';
  }
  // 제품명에서 g 단위 추출 → kg 환산용
  function prodGramPerEA(full) {
    const m = (full||'').match(/(\d+(?:\.\d+)?)\s*(g|KG)\b/i);
    if (!m) return 0;
    return m[2].toUpperCase()==='KG' ? parseFloat(m[1])*1000 : parseFloat(m[1]);
  }

  const COLORS = ['#1D9E75','#378ADD','#EF9F27','#0EA5E9','#F472B6','#64748B'];
  const prodColorMap = {};
  let colorIdx = 0;
  function getColor(prod) {
    if (!prodColorMap[prod]) prodColorMap[prod] = COLORS[colorIdx++ % COLORS.length];
    return prodColorMap[prod];
  }

  // 일자별 stack — 같은 날 여러 제품은 막대 한 개 안에 색깔로 분리.
  // 평일 X축: 생산한 날 + 오늘 이후 평일.
  const _producedSet = new Set(dayEntries.map(([d]) => d));
  const _useWeekdays = (typeof _moChartWeekdays === 'function')
    ? _moChartWeekdays(ym || tod().slice(0,7), _producedSet)
    : (function(){
        const today = tod();
        const [yy, mm] = (ym || tod().slice(0,7)).split('-').map(Number);
        const last = new Date(yy, mm, 0).getDate();
        const arr = [];
        for(let day=1; day<=last; day++){
          const dt = new Date(yy, mm-1, day);
          const w = dt.getDay();
          if(w===0 || w===6) continue;
          const ds = yy+'-'+String(mm).padStart(2,'0')+'-'+String(day).padStart(2,'0');
          if(_producedSet.has(ds) || ds>=today) arr.push(ds);
        }
        return arr;
      })();
  const _producedMap = {};
  dayEntries.forEach(([date, dayRows]) => { _producedMap[date] = dayRows; });

  // 등장하는 제품 목록 + 일자별 제품별 ea/kg 매트릭스
  const _prodSet = new Set();
  const _cellByDate = {}; // date → { product → {ea, kg} }
  _useWeekdays.forEach(date => {
    const dayRows = _producedMap[date] || [];
    const cell = {};
    dayRows.forEach(r => {
      const outerEa = opMap[date+'|'+r.product] || 0;
      const ea = outerEa > 0 ? outerEa : Math.round(r.ea || 0);
      if(ea <= 0) return;
      const gPerEA = prodGramPerEA(r.product);
      const kg = Math.round(ea * gPerEA / 1000);
      _prodSet.add(r.product);
      if(!cell[r.product]) cell[r.product] = { ea: 0, kg: 0 };
      cell[r.product].ea += ea;
      cell[r.product].kg += kg;
    });
    _cellByDate[date] = cell;
  });
  // 색상 안정성: 등장 순서가 아닌 제품명 기준
  const _allProds = [..._prodSet].sort();
  _allProds.forEach(p => getColor(p)); // prefill

  // 일자별 라벨 ['1일차','05-04']
  const labels = _useWeekdays.map((d, i) => [(i+1)+'일차', d.slice(5)]);

  // 모드: ea / weight / detail
  const mode = _moPackingMode || 'detail';
  const yUnit = (mode === 'ea') ? '' : 'kg';
  // dataset value picker
  const _val = (cell, p) => {
    const c = cell[p]; if(!c) return null;
    return (mode === 'ea') ? (c.ea > 0 ? c.ea : null) : (c.kg > 0 ? c.kg : null);
  };
  // 칸 안 / 위 라벨 함수
  const inCellLine1 = (cell, p) => {
    const c = cell[p]; if(!c) return '';
    if(mode === 'ea') return c.ea.toLocaleString()+'EA';
    if(mode === 'weight') return c.kg.toLocaleString()+'kg';
    return c.ea.toLocaleString()+'EA';
  };
  const inCellLine2 = (cell, p) => {
    if(mode !== 'detail') return '';
    const c = cell[p]; if(!c) return '';
    return c.kg.toLocaleString()+'kg';
  };
  const dayTotals = _useWeekdays.map(date => {
    const cell = _cellByDate[date] || {};
    return _allProds.reduce((s, p) => {
      const c = cell[p]; if(!c) return s;
      return s + (mode === 'ea' ? c.ea : c.kg);
    }, 0);
  });

  if(!_allProds.length || dayTotals.every(v => !v)) return;

  // 범례
  const legendEl = document.getElementById('mo_packing_legend');
  if (legendEl) {
    legendEl.innerHTML = Object.entries(prodColorMap).map(([name, color]) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:11px;color:var(--g5)">
        <span style="width:9px;height:9px;border-radius:2px;background:${color};flex-shrink:0"></span>${name}
      </span>`
    ).join('');
  }

  // 제목 월 업데이트
  const titleEl = document.getElementById('mo_packing_title');
  if (titleEl) {
    const [ty,tm] = ym.split('-');
    titleEl.textContent = '운영팀 ' + parseInt(tm) + '월 내포장 수량';
    // 다른 3개 차트 제목도 같은 월로 갱신
    const _mNum = parseInt(tm);
    const rmT = document.getElementById('mo_rm_title');
    if (rmT) rmT.textContent = '운영팀 ' + _mNum + '월 일별 원육 사용량';
    const defT = document.getElementById('mo_def_title');
    if (defT) defT.textContent = '운영팀 ' + _mNum + '월 불량률 추이';
    const yldT = document.getElementById('mo_yield_title');
    if (yldT) yldT.textContent = '운영팀 ' + _mNum + '월 원육수율 일별 추이';
  }

  // 부제목 (모드별 안내 문구)
  const subEl = document.getElementById('mo_packing_subtitle');
  if (subEl) {
    if (mode === 'ea')          subEl.textContent = '막대 = 일자별 합계 EA · 칸 안 = 제품별 EA';
    else if (mode === 'weight') subEl.textContent = '막대 = 일자별 합계 무게(kg) · 칸 안 = 제품별 kg';
    else                        subEl.textContent = '막대 = 일자별 합계 무게(kg) · 막대 위 = 합계 · 칸 안 = 제품별 EA / kg';
  }


  // 막대 위 라벨: 일자별 합계
  const topNumPlugin = {
    id: 'pkTopNum',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const barMetas = chart.data.datasets
        .map((d,i) => ({ds:d, meta: chart.getDatasetMeta(i)}))
        .filter(x => (x.ds.type||chart.config.type) === 'bar');
      if(!barMetas.length) return;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--g7') || '#1e293b';
      ctx.font = 'bold 11px sans-serif';
      const xCount = labels.length;
      for(let i=0; i<xCount; i++){
        const total = dayTotals[i]; if(!total) continue;
        let topY = Infinity, topX = null;
        barMetas.forEach(({meta}) => {
          const bar = meta.data[i]; if(!bar) return;
          if(bar.y < topY){ topY = bar.y; topX = bar.x; }
        });
        if(topX == null) continue;
        ctx.fillText(total.toLocaleString()+(yUnit||'EA'), topX, topY - 6);
      }
      ctx.restore();
    }
  };

  // 칸 안 라벨: 제품별 EA / kg
  const inCellPlugin = {
    id: 'pkInCell',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.textAlign = 'center';
      chart.data.datasets.forEach((ds, di) => {
        if((ds.type||chart.config.type) !== 'bar') return;
        const product = ds.label; if(!product) return;
        const meta = chart.getDatasetMeta(di);
        meta.data.forEach((bar, i) => {
          const date = _useWeekdays[i]; if(!date) return;
          const cell = _cellByDate[date] || {};
          const c = cell[product]; if(!c) return;
          const top = bar.y, base = bar.base;
          const h = Math.abs(base - top);
          const cx = bar.x;
          const cy = (top + base) / 2;
          const l1 = inCellLine1(cell, product);
          const l2 = inCellLine2(cell, product);
          // 막대 안 색상에 맞는 짙은 텍스트 — 모든 색상에서 가독 위해 동일한 어두운 톤
          ctx.fillStyle = '#0f172a';
          if(l2 && h >= 26){
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(l1, cx, cy - 4);
            ctx.font = '10px sans-serif';
            ctx.fillStyle = '#334155';
            ctx.fillText(l2, cx, cy + 10);
          } else if(h >= 14){
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(l1, cx, cy + 4);
          }
        });
      });
      ctx.restore();
    }
  };

  // 이번달 일평균 KG (생산한 날만)
  const _curDayKgs = [];
  dayEntries.forEach(([date, dayRows]) => {
    let dayTotal = 0;
    dayRows.forEach(r => {
      const oe = opMap[date+'|'+r.product] || 0;
      const ea = oe > 0 ? oe : Math.round(r.ea || 0);
      const gPerEA = prodGramPerEA(r.product);
      dayTotal += Math.round(ea * gPerEA / 1000);
    });
    if(dayTotal > 0) _curDayKgs.push(dayTotal);
  });
  const _curAvgKg = _curDayKgs.length ? Math.round(_curDayKgs.reduce((s,v)=>s+v,0)/_curDayKgs.length) : null;
  const _avgPkKg = window._moPrevAvgPkKg;
  const showAvgLine = (mode === 'weight' || mode === 'detail');

  // 제품별 stacked dataset
  const datasets = _allProds.map(p => ({
    type: 'bar', label: p,
    data: _useWeekdays.map(d => _val(_cellByDate[d] || {}, p)),
    backgroundColor: getColor(p) + 'dd',
    borderWidth: 0,
    stack: 'pk'
  }));

  if(showAvgLine && _curAvgKg != null){
    datasets.push({
      type: 'line', label: '이번달 일평균',
      data: Array(labels.length).fill(_curAvgKg),
      borderColor: '#7c3aed', borderDash: [2,3], pointRadius: 0, borderWidth: 1.5, fill: false, order: 0,
      _endLabel: _curAvgKg.toLocaleString()+'kg', xAxisID: 'x', yAxisID: 'y_avg'
    });
  }
  if(showAvgLine && _avgPkKg != null && _avgPkKg > 0){
    datasets.push({
      type: 'line', label: '전월 일평균',
      data: Array(labels.length).fill(Math.round(_avgPkKg)),
      borderColor: '#475569', borderDash: [5,4], pointRadius: 0, borderWidth: 1.8, fill: false, order: 0,
      _endLabel: Math.round(_avgPkKg).toLocaleString()+'kg', xAxisID: 'x', yAxisID: 'y_avg'
    });
  }

  _moPackingChart = new Chart(canvas, {
    type: 'bar',
    plugins: [topNumPlugin, inCellPlugin,
      {id:'endLbl',afterDatasetsDraw(chart){
        const {ctx, chartArea}=chart; ctx.save();
        ctx.font='bold 11px sans-serif';
        const endItems = [];
        chart.data.datasets.forEach((d,i)=>{
          if(!d._endLabel) return;
          const meta = chart.getDatasetMeta(i).data;
          if(!meta.length) return;
          const lastPt = meta[meta.length-1];
          // origY = 점선 원래 y (그대로 사용), labelY = 라벨 표시 위치 (충돌 시 밀림)
          endItems.push({ origY: lastPt.y, labelY: lastPt.y, x: chartArea.right, fromX: lastPt.x, text: ' '+d._endLabel, color: d.borderColor||'#475569', dash: d.borderDash||[], bw: d.borderWidth||1.5 });
        });
        endItems.sort((a,b) => a.labelY - b.labelY);
        const MIN_GAP = 18;
        for(let i=1; i<endItems.length; i++){
          if(endItems[i].labelY - endItems[i-1].labelY < MIN_GAP){
            endItems[i].labelY = endItems[i-1].labelY + MIN_GAP;
          }
        }
        // 점선 연장: 원래 y(origY) 그대로 사용 (계단 X)
        endItems.forEach(item => {
          if(item.fromX >= item.x - 1) return;
          ctx.strokeStyle = item.color;
          ctx.lineWidth = item.bw;
          ctx.setLineDash(item.dash);
          const _cyc = (item.dash[0]||0) + (item.dash[1]||0);
          ctx.lineDashOffset = _cyc>0 ? (item.fromX % _cyc) : 0;
          ctx.beginPath();
          ctx.moveTo(item.fromX, item.origY);
          ctx.lineTo(item.x, item.origY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        });
        // 라벨은 충돌 회피된 labelY 위치에
        endItems.forEach(item => {
          ctx.fillStyle = item.color;
          ctx.textAlign='left'; ctx.textBaseline='middle';
          ctx.fillText(item.text, item.x, item.labelY);
        });
        ctx.restore();
      }}
    ],
    data: {
      labels,
      datasets: datasets
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { left: 20, top: 50, bottom: 16, right: 170 } },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: {size:10}, boxWidth: 12, usePointStyle: true, padding: 24,
          filter: (item) => true } },
        tooltip: {
          callbacks: {
            title: ctx => {
              const i = ctx[0].dataIndex;
              const lbl = labels[i];
              return Array.isArray(lbl) ? lbl.join(' ') : String(lbl||'');
            },
            label: ctx => {
              const ds = ctx.dataset;
              if(ds.type === 'line') return ' '+(ds.label||'')+' '+(ctx.raw||0).toLocaleString()+'kg';
              const date = _useWeekdays[ctx.dataIndex];
              const cell = (_cellByDate[date] || {})[ds.label];
              if(!cell) return '';
              return ' '+ds.label+': '+cell.ea.toLocaleString()+'EA · '+cell.kg.toLocaleString()+'kg';
            },
            footer: items => {
              if(!items.length) return '';
              const total = dayTotals[items[0].dataIndex];
              return total ? '합계: '+total.toLocaleString()+(yUnit||'EA') : '';
            }
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: 'var(--g5)', font: { size: 10 }, autoSkip: false, maxRotation: 0 } },
        y: { stacked: true, grid: { color: 'rgba(100,116,139,0.1)' }, ticks: { color: 'var(--g5)', font: { size: 10 }, callback: v => v.toLocaleString() + (yUnit||'') }, beginAtZero: true, grace: '20%' },
        // 평균선 전용 — stacked 영향 안 받게 별도 축
        y_avg: { display: false, stacked: false, beginAtZero: true, grace: '20%',
          afterFit: function(scale){
            const yScale = scale.chart.scales.y;
            if(yScale){ scale.min = yScale.min; scale.max = yScale.max; }
          }
        }
      }
    }
  });
}

// 일별 원육 사용량 차트
var _moRmChart = null;
var _moRmTab = '종합';  // 현재 선택된 탭
// 부위별 색상 — 자동 깔끔하게 (부위 가나다순으로 매핑되도록 정렬해서 처리)
var _MO_RM_PALETTE = ['#1D9E75','#D85A30','#185FA5','#BA7517','#993556','#0F6E56','#534AB7'];
function _moRmColorFor(part, allParts){
  const idx = allParts.indexOf(part);
  if(idx < 0) return '#888780';
  return _MO_RM_PALETTE[idx % _MO_RM_PALETTE.length];
}

function _moRenderRmChart(rmByDate, ym, rmByDatePart){
  const canvas = document.getElementById('mo_rm_chart');
  if(!canvas) return;
  if(_moRmChart){_moRmChart.destroy();_moRmChart=null;}
  if(!rmByDate || !Object.keys(rmByDate).length) return;

  // 생산한 날만
  const producedDates = Object.keys(rmByDate).filter(d => rmByDate[d] > 0).sort();
  if(!producedDates.length) return;

  // X축 = 생산한 날 + 오늘 이후 평일
  const producedSet = new Set(producedDates);
  const weekdays = (typeof _moChartWeekdays === 'function')
    ? _moChartWeekdays(ym, producedSet) : producedDates;

  const labels = weekdays.map((d,i) => [(i+1)+'일차', d.slice(5)]);
  const xLen = weekdays.length;

  // 부위 목록 추출 (가나다 정렬, 동적)
  const partSet = new Set();
  if(rmByDatePart){
    Object.values(rmByDatePart).forEach(byPart => {
      Object.keys(byPart||{}).forEach(p => { if((byPart[p]||0) > 0) partSet.add(p); });
    });
  }
  const allParts = [...partSet].sort();

  // 탭 렌더 (종합 / 각 부위)
  const tabsEl = document.getElementById('mo_rm_tabs');
  if(tabsEl){
    const tabs = ['종합', ...allParts];
    if(!tabs.includes(_moRmTab)) _moRmTab = '종합';
    tabsEl.innerHTML = tabs.map(t => {
      const active = (t === _moRmTab);
      const bg = active ? '#1D9E75' : '#fff';
      const col = active ? '#fff' : '#475569';
      const bd = active ? '#1D9E75' : '#cbd5e1';
      return `<button type="button" onclick="_moSetRmTab('${t.replace(/'/g,"\\'")}')" style="padding:4px 10px;font-size:11px;border:1px solid ${bd};background:${bg};color:${col};border-radius:6px;cursor:pointer">${t}</button>`;
    }).join('');
  }

  // 데이터셋 구성
  const datasets = [];
  let topNumVals;  // 막대 위 합계 라벨용
  if(_moRmTab === '종합' && allParts.length > 0){
    // 부위별 stacked
    allParts.forEach(part => {
      const data = weekdays.map(d => {
        const byPart = (rmByDatePart||{})[d] || {};
        const v = byPart[part] || 0;
        return v > 0 ? Math.round(v) : null;
      });
      datasets.push({
        type:'bar', label: part, data,
        backgroundColor: _moRmColorFor(part, allParts),
        borderRadius: 2, stack: 'rm'
      });
    });
    topNumVals = weekdays.map(d => rmByDate[d] && rmByDate[d] > 0 ? Math.round(rmByDate[d]) : null);
  } else if(_moRmTab !== '종합'){
    // 특정 부위만
    const part = _moRmTab;
    const data = weekdays.map(d => {
      const byPart = (rmByDatePart||{})[d] || {};
      const v = byPart[part] || 0;
      return v > 0 ? Math.round(v) : null;
    });
    datasets.push({
      type:'bar', label: part, data,
      backgroundColor: _moRmColorFor(part, allParts),
      borderRadius: 3
    });
    topNumVals = data.slice();
  } else {
    // 부위 데이터 없음 — 옛 방식 단일 막대
    const rmVals = weekdays.map(d => rmByDate[d] && rmByDate[d] > 0 ? Math.round(rmByDate[d]) : null);
    datasets.push({ type:'bar', label:'원육 사용량', data: rmVals, backgroundColor: '#1D9E75dd', borderRadius: 3 });
    topNumVals = rmVals;
  }

  // 평균선 — 현재 탭에 해당하는 값 기준
  const _curVals = topNumVals.filter(v => v != null && v > 0);
  const _curAvg = _curVals.length ? Math.round(_curVals.reduce((s,v)=>s+v,0) / _curVals.length) : null;
  if(_curAvg != null){
    datasets.push({
      type: 'line', label: '이번달 일평균',
      data: Array(xLen).fill(_curAvg),
      borderColor: '#7c3aed', borderDash: [2,3], pointRadius: 0, borderWidth: 1.5, fill: false,
      _endLabel: _curAvg.toLocaleString()+'kg', stack: '_avg_cur', xAxisID: 'x', yAxisID: 'y_avg'
    });
  }
  const _avgRm = window._moPrevAvgRmKg;
  if(_moRmTab === '종합' && _avgRm != null){
    datasets.push({
      type:'line', label:'전월 일평균',
      data: Array(xLen).fill(Math.round(_avgRm)),
      borderColor: '#94a3b8', borderDash: [5,4], pointRadius: 0, borderWidth: 1.5, fill: false,
      _endLabel: Math.round(_avgRm).toLocaleString()+'kg', stack: '_avg_prev', xAxisID: 'x', yAxisID: 'y_avg'
    });
  }

  // stacked 여부
  const isStacked = (_moRmTab === '종합' && allParts.length > 0);

  _moRmChart = new Chart(canvas, {
    type: 'bar',
    plugins: [
      // 칸 안 라벨: stacked 종합 모드일 때 부위별 kg
      {id:'rmInCell',afterDatasetsDraw(chart){
        if(!isStacked) return;
        const {ctx} = chart;
        ctx.save();
        ctx.textAlign = 'center';
        chart.data.datasets.forEach((ds, di) => {
          if((ds.type||chart.config.type) !== 'bar') return;
          const meta = chart.getDatasetMeta(di);
          meta.data.forEach((bar, i) => {
            const v = ds.data[i];
            if(v == null || v <= 0) return;
            const top = bar.y, base = bar.base;
            const h = Math.abs(base - top);
            if(h < 14) return;
            const cx = bar.x;
            const cy = (top + base) / 2;
            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(Math.round(v).toLocaleString()+'kg', cx, cy + 4);
          });
        });
        ctx.restore();
      }},
      {id:'topNum',afterDatasetsDraw(chart){
        const {ctx} = chart; ctx.save();
        // 막대 위 합계 라벨 — stacked일 때는 마지막 bar dataset의 top, 단일은 그냥 bar 위
        // 가장 위에 있는 bar dataset의 meta를 기준으로 그림
        const barMetas = chart.data.datasets
          .map((d,i) => ({ds:d, meta: chart.getDatasetMeta(i)}))
          .filter(x => x.meta.type === 'bar' || (x.ds.type||chart.config.type) === 'bar');
        if(!barMetas.length) { ctx.restore(); return; }
        // 같은 x에서 가장 작은 y (가장 위) 골라야 함
        const xCount = topNumVals.length;
        for(let i=0; i<xCount; i++){
          const v = topNumVals[i];
          if(v == null || v <= 0) continue;
          let topY = Infinity, topX = null;
          barMetas.forEach(({meta}) => {
            const bar = meta.data[i];
            if(!bar) return;
            if(bar.y < topY){ topY = bar.y; topX = bar.x; }
          });
          if(topX == null) continue;
          ctx.fillStyle = '#1e293b'; ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(v.toLocaleString()+'kg', topX, topY - 4);
        }
        ctx.restore();
      }},
      {id:'endLbl',afterDatasetsDraw(chart){
        const {ctx, chartArea} = chart; ctx.save();
        ctx.font = 'bold 11px sans-serif';
        const endItems = [];
        chart.data.datasets.forEach((d,i) => {
          if(!d._endLabel) return;
          const meta = chart.getDatasetMeta(i).data;
          if(!meta.length) return;
          const lastPt = meta[meta.length-1];
          endItems.push({ y: lastPt.y, x: chartArea.right, fromX: lastPt.x, text: ' '+d._endLabel, color: d.borderColor || '#475569', dash: d.borderDash||[], bw: d.borderWidth||1.5 });
        });
        endItems.sort((a,b) => a.y - b.y);
        const MIN_GAP = 18;
        for(let i=1; i<endItems.length; i++){
          if(endItems[i].y - endItems[i-1].y < MIN_GAP){
            endItems[i].y = endItems[i-1].y + MIN_GAP;
          }
        }
        // 점선 연장: bar 마지막 위치(fromX) → chartArea.right (item.x)
        endItems.forEach(item => {
          if(item.fromX >= item.x - 1) return;
          ctx.strokeStyle = item.color;
          ctx.lineWidth = item.bw;
          ctx.setLineDash(item.dash);
          // dashOffset = 점선 사이클(dash[0]+dash[1])에 fromX 맞춰 정렬 → 기존 점선과 자연스럽게 이어짐
          const _cyc = (item.dash[0]||0) + (item.dash[1]||0);
          ctx.lineDashOffset = _cyc>0 ? (item.fromX % _cyc) : 0;
          ctx.beginPath();
          ctx.moveTo(item.fromX, item.y);
          ctx.lineTo(item.x, item.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        });
        endItems.forEach(item => {
          ctx.fillStyle = item.color;
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(item.text, item.x, item.y);
        });
        ctx.restore();
      }}
    ],
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { left: 20, top: 50, right: 170 } },
      plugins: {
        legend: { display: true, position: 'top',
          labels: { font: {size:10}, boxWidth: 12, usePointStyle: true, padding: 30,
            filter: (item) => {
              // stacked 종합 모드 = 부위 + 평균선 모두 노출
              // 부위 단일 탭 = 평균선만
              if(isStacked) return true;
              return item.text === '이번달 일평균' || item.text === '전월 일평균';
            } } },
        tooltip: { callbacks: {
          label: ctx => {
            const ds = ctx.dataset;
            if(ds.type === 'line') return '';
            return ' '+(ds.label||'')+' '+(ctx.raw||0).toLocaleString()+'kg';
          }
        } }
      },
      scales: {
        x: { stacked: isStacked, ticks: { font: {size:9}, autoSkip: false, maxRotation: 0 }, grid: { display: false } },
        y: { stacked: isStacked, ticks: { font: {size:10}, callback: v => v.toLocaleString()+'kg' }, beginAtZero: true, grace: '20%' },
        // 평균선 전용 — stacked 영향 안 받게 별도 축 (display:false). y와 같은 범위 사용.
        y_avg: { display: false, stacked: false, beginAtZero: true, grace: '20%',
          afterFit: function(scale){
            const yScale = scale.chart.scales.y;
            if(yScale){ scale.min = yScale.min; scale.max = yScale.max; }
          }
        }
      }
    }
  });
}

// 탭 클릭 핸들러
function _moSetRmTab(tab){
  _moRmTab = tab;
  if(typeof _moRenderRmChart === 'function' && window._moRmByDate){
    _moRenderRmChart(window._moRmByDate, window._moPackingArgs ? window._moPackingArgs.ym : (window._moYm||tod().slice(0,7)), window._moRmByDatePart);
  }
}

async function downloadRmChart(){
  await _downloadGenericChart('mo_rm_chart', _moRmChart, '일별 원육 사용량');
}

// 일반 차트(불량률/수율) 고화질 다운로드
async function _downloadGenericChart(canvasId, chart, title){
  if(!chart) { alert('차트 로딩 중'); return; }
  const ym = window._moYm || tod().slice(0,7);
  const [, m] = ym.split('-');
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;

  const S = 2;  // 2x 고해상도
  const W0 = 1280, H0 = 540, HD0 = 100;
  const W = W0 * S, H = H0 * S, HD = HD0 * S;

  // Chart.js 2x 렌더 + 사이즈 조정
  const origDPR = chart.options.devicePixelRatio;
  chart.options.devicePixelRatio = S;
  const wrapDiv = canvas.parentElement;
  const origWrapH = wrapDiv ? wrapDiv.style.height : '';
  if(wrapDiv) wrapDiv.style.height = (H0 - HD0) + 'px';
  chart.resize(W0, H0 - HD0);
  await new Promise(r => setTimeout(r, 350));

  // offscreen 캔버스 (흰 배경)
  const off = document.createElement('canvas');
  off.width  = W;
  off.height = H;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 제목 (회사명 + 차트명)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#94A3B8';
  ctx.font = (13*S) + 'px sans-serif';
  ctx.fillText('순수본 2공장', 24*S, 28*S);
  ctx.fillStyle = '#1E293B';
  ctx.font = 'bold ' + (22*S) + 'px sans-serif';
  ctx.fillText('운영팀 ' + parseInt(m) + '월 ' + title, 24*S, 60*S);

  // 차트 그리기
  ctx.drawImage(canvas, 0, HD, W, H - HD);

  // 원복
  chart.options.devicePixelRatio = origDPR;
  if(wrapDiv) wrapDiv.style.height = origWrapH;
  chart.resize();

  const a = document.createElement('a');
  a.download = ym + '_' + title + '_HD.png';
  a.href = off.toDataURL('image/png');
  a.click();
}

async function downloadDefChart(){
  await _downloadGenericChart('mo_def_chart', _moDefChart, '불량률 추이');
}

async function downloadYieldChart(){
  await _downloadGenericChart('mo_yield_chart', _moYieldChart, '원육수율 일별 추이');
}

async function downloadPackingChart() {
  const canvas = document.getElementById('mo_bar_chart');
  if (!canvas || !_moPackingChart) return;
  const ym = _moYm || tod().slice(0,7);
  const [, m] = ym.split('-');
  const mode = _moPackingMode || 'detail';
  const modeLbl = mode==='ea' ? 'EA' : mode==='weight' ? '중량(kg)' : '상세 (EA + 중량)';
  const subText = mode==='detail'
    ? '막대 = 생산 무게(kg) · 막대 위 = EA / 무게(kg)'
    : mode==='ea'
      ? '막대 = 생산 EA'
      : '막대 = 생산 무게(kg)';

  const S = 2;  // 2x 고해상도
  const W0 = 1280, H0 = 720, HD0 = 140;
  const W = W0 * S, H = H0 * S, HD = HD0 * S;

  // 1) Chart.js devicePixelRatio를 2로 → 차트 캔버스가 2x 픽셀로 렌더링
  const origDPR = _moPackingChart.options.devicePixelRatio;
  _moPackingChart.options.devicePixelRatio = S;

  const chartWrapDiv = canvas.parentElement;
  const origWrapH = chartWrapDiv ? chartWrapDiv.style.height : '';
  if (chartWrapDiv) chartWrapDiv.style.height = (H0 - HD0) + 'px';
  _moPackingChart.resize(W0, H0 - HD0);
  await new Promise(r => setTimeout(r, 350));

  // 2) offscreen canvas (실제 픽셀 = W x H = 2560 x 1440)
  const off = document.createElement('canvas');
  off.width  = W;
  off.height = H;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // 3) 제목 (모든 좌표/폰트 * S)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#94A3B8';
  ctx.font = (13*S) + 'px sans-serif';
  ctx.fillText('순수본 2공장', 24*S, 28*S);
  ctx.fillStyle = '#1E293B';
  ctx.font = 'bold ' + (24*S) + 'px sans-serif';
  ctx.fillText('운영팀 ' + parseInt(m) + '월 내포장 수량', 24*S, 60*S);

  // 부제
  ctx.fillStyle = '#475569';
  ctx.font = (13*S) + 'px sans-serif';
  ctx.fillText('[' + modeLbl + ']  ' + subText, 24*S, 84*S);

  // 4) 범례
  const legendEl = document.getElementById('mo_packing_legend');
  if (legendEl) {
    let lx = 24*S;
    Array.from(legendEl.children).forEach(sp => {
      const colorEl = sp.querySelector('span');
      if (!colorEl) return;
      const bg = colorEl.style.background || colorEl.style.backgroundColor || '#888';
      const label = sp.textContent.trim();
      ctx.fillStyle = bg;
      ctx.fillRect(lx, 108*S, 10*S, 10*S);
      ctx.fillStyle = '#444';
      ctx.font = (12*S) + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 14*S, 118*S);
      lx += ctx.measureText(label).width + 32*S;
    });
  }

  // 5) 차트 (실제 픽셀이 이미 2x로 렌더링됨)
  ctx.drawImage(canvas, 0, HD, W, H - HD);

  // 6) 원복
  _moPackingChart.options.devicePixelRatio = origDPR;
  if (chartWrapDiv) chartWrapDiv.style.height = origWrapH;
  _moPackingChart.resize();

  const a = document.createElement('a');
  a.download = ym + '_운영팀_내포장수량_HD.png';
  a.href = off.toDataURL('image/png');
  a.click();
}

async function exportPackingChartExcel() {
  const canvas = document.getElementById('mo_bar_chart');
  if (!canvas) { toast('차트 없음','d'); return; }

  // ExcelJS 동적 로드
  if (!window.ExcelJS) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  toast('엑셀 생성 중...','i');
  const ym  = _moYm || tod().slice(0,7);
  const [y, m] = ym.split('-');
  const sheetName = y+'년 '+parseInt(m)+'월';

  // 캔버스 → PNG base64
  const imgBase64 = canvas.toDataURL('image/png').split(',')[1];
  const imgW = canvas.width;
  const imgH = canvas.height;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  // 제목
  ws.mergeCells('A1:J1');
  ws.getCell('A1').value = '순수본 2공장';
  ws.getCell('A1').font = { size:10, color:{argb:'FF94A3B8'} };
  ws.getCell('A1').alignment = { horizontal:'center' };

  ws.mergeCells('A2:J2');
  ws.getCell('A2').value = '운영팀 ' + parseInt(m) + '월 내포장 수량';
  ws.getCell('A2').font  = { size:16, bold:true, color:{argb:'FF1E293B'} };
  ws.getCell('A2').alignment = { horizontal:'center', vertical:'middle' };
  ws.getRow(2).height = 28;

  // 이미지 삽입 (A4 셀부터)
  const imgId = wb.addImage({ base64: imgBase64, extension: 'png' });
  // 열 너비 조정 (총 10열, 각 10)
  for (let c = 1; c <= 10; c++) ws.getColumn(c).width = 10;
  ws.getRow(3).height = 6; // 여백

  // 이미지 크기: 900×300 포인트 정도 (약 10열 × 30행)
  ws.addImage(imgId, {
    tl: { col: 0, row: 3 },
    ext: { width: 900, height: 300 }
  });

  // 데이터 시트
  const ws2 = wb.addWorksheet('데이터');
  const rows2 = window._moReportRows || [];
  const opMap = (window._moGD && window._moGD.opMap) || {};

  // 헤더
  ws2.addRow(['날짜','제품명','생산량(EA)']);
  ws2.getRow(1).font = { bold:true };
  ws2.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2C5282'} };
  ws2.getRow(1).font = { bold:true, color:{argb:'FFFFFFFF'} };

  // 날짜별+제품별 데이터
  const dayEntries = (window._moGD && window._moGD.dayEntries) || [];
  dayEntries.forEach(([date, dayRows]) => {
    dayRows.forEach(row => {
      const ea = opMap[date+'|'+row.product] || Math.round(row.ea||0);
      if (!ea) return;
      const r = ws2.addRow([date.slice(5).replace('-','/'), row.product, ea]);
      r.getCell(3).numFmt = '#,##0';
    });
  });
  ws2.getColumn(1).width = 10;
  ws2.getColumn(2).width = 26;
  ws2.getColumn(3).width = 14;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ym + '_운영팀_내포장수량.xlsx';
  a.click();
  toast('엑셀 다운로드 완료 ✓','s');
}



// ============================================================
// 실제 Excel 차트 시트 주입 - 단일시리즈+dPt+multiLvlStrRef
// ============================================================
async function _buildChartSheet(mainBuf, y, m) {
  if (!window.JSZip) {
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload=res; s.onerror=rej; document.head.appendChild(s);
    });
  }
  const zip=await JSZip.loadAsync(mainBuf);
  const gd=window._moGD||{};
  const dayEntries=gd.dayEntries||[];
  const opMap=gd.opMap||{};
  const SNAME='내포장수량';

  const DOW=['일','월','화','수','목','금','토'];
  function dLabel(d){const[dy,dm,dd]=d.split('-').map(Number);return dd+'('+DOW[new Date(dy,dm-1,dd).getDay()]+')';}
  function colLetter(n){let r='';while(n>0){r=String.fromCharCode(65+(n-1)%26)+r;n=Math.floor((n-1)/26);}return r;}
  function ps(full){const mt=(full||'').match(/(\d+(?:\.\d+)?)\s*(g|KG)\b/i);if(!mt)return full.slice(0,8);return mt[2].toUpperCase()==='KG'?mt[1]+'KG':mt[1]+'g';}
  const PROD_COLORS={'시그니처 장조림 130g':'1D9E75','코스트코 장조림 170g':'378ADD','트레이더스 장조림 460g':'EF9F27','FC 장조림 3KG':'0EA5E9'};
  function pColor(p){return PROD_COLORS[p]||'888888';}

  // 행 펼치기
  const rows=[];
  dayEntries.forEach(([date,dayRows])=>{
    [...dayRows].sort((a,b)=>b.ea-a.ea).forEach(row=>{
      const ea=opMap[date+'|'+row.product]||Math.round(row.ea||0);
      if(ea>0) rows.push({dl:dLabel(date),ps:ps(row.product),pf:row.product,ea});
    });
  });
  const N=rows.length;

  // ── sheet2.xml: A=날짜(outer), B=제품(inner), C=EA ─────────
  // 범례 텍스트는 E열에 직접 표기
  const legendProds=[...new Set(rows.map(r=>r.pf))];
  let cells='';
  // 헤더
  cells+=`<row r="1"><c r="A1" t="inlineStr"><is><t>날짜</t></is></c><c r="B1" t="inlineStr"><is><t>제품</t></is></c><c r="C1" t="inlineStr"><is><t>EA</t></is></c><c r="E1" t="inlineStr"><is><t>범 례</t></is></c></row>`;
  rows.forEach((r,i)=>{
    const ri=i+2;
    cells+=`<row r="${ri}">`;
    cells+=`<c r="A${ri}" t="inlineStr"><is><t>${r.dl}</t></is></c>`;
    cells+=`<c r="B${ri}" t="inlineStr"><is><t>${r.ps}</t></is></c>`;
    cells+=`<c r="C${ri}"><v>${r.ea}</v></c>`;
    cells+=`</row>`;
  });
  // 범례 행 (E2~E5)
  // 범례 행은 데이터 아래 별도 처리
  const legendRows='';

  const sheet2xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="8" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/><col min="4" max="4" width="3" customWidth="1"/><col min="5" max="5" width="28" customWidth="1"/></cols><sheetData>${cells}${legendRows}</sheetData><drawing r:id="rId1"/></worksheet>`;

  // ── chart1.xml: 단일시리즈, dPt 색상, multiLvlStrRef ───────
  // 범례용 라인 시리즈 (투명, 데이터 없음 - 범례 항목만)
  const legendProdsUniq=[...new Set(rows.map(r=>r.pf))];
  let legendSerXml='';
  legendProdsUniq.forEach((prod,pi)=>{
    const c=pColor(prod);
    legendSerXml+=`<c:ser>
      <c:idx val="${pi+1}"/><c:order val="${pi+1}"/>
      <c:tx><c:strRef><c:f></c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${prod}</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:ln></c:spPr>
      <c:marker><c:symbol val="square"/><c:size val="8"/><c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>
      <c:cat><c:strRef><c:f></c:f><c:strCache><c:ptCount val="0"/></c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f></c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="0"/></c:numCache></c:numRef></c:val>
      <c:smooth val="0"/>
    </c:ser>`;
  });

  let dptXml='';
  rows.forEach((r,i)=>{
    dptXml+=`<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:spPr><a:solidFill><a:srgbClr val="${pColor(r.pf)}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`;
  });

  // outer=날짜(A col), inner=제품(B col) → 날짜 병합 + 제품명 막대 위
  // 연속 중복 날짜는 캐시에서 생략 → Excel이 같은 날짜를 하나로 병합
  const datePts =rows.map((r,i)=>i>0&&rows[i-1].dl===r.dl?'':`<c:pt idx="${i}"><c:v>${r.dl}</c:v></c:pt>`).join('');
  const prodPts =rows.map((r,i)=>`<c:pt idx="${i}"><c:v>${r.ps}</c:v></c:pt>`).join('');
  const valPts  =rows.map((r,i)=>`<c:pt idx="${i}"><c:v>${r.ea}</c:v></c:pt>`).join('');

  const chartXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:lang val="ko-KR"/>
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1" sz="1400"/></a:pPr><a:r><a:t>운영팀 ${parseInt(m)}월 내포장 수량</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/><c:order val="0"/>
          <c:spPr><a:solidFill><a:srgbClr val="888888"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>
          ${dptXml}
          <c:invertIfNegative val="0"/>
          <c:dLbls>
            <c:numFmt formatCode="#,##0" sourceLinked="0"/>
            <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
            <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1" sz="800"/></a:pPr></a:p></c:txPr>
            <c:dLblPos val="outEnd"/>
            <c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>
            <c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>
          </c:dLbls>
          <c:cat>
            <c:multiLvlStrRef>
              <c:f>${SNAME}!$A$2:$B$${N+1}</c:f>
              <c:multiLvlStrCache>
                <c:ptCount val="${N}"/>
                <c:lvl>${datePts}</c:lvl>
                <c:lvl>${prodPts}</c:lvl>
              </c:multiLvlStrCache>
            </c:multiLvlStrRef>
          </c:cat>
          <c:val>
            <c:numRef>
              <c:f>${SNAME}!$C$2:$C$${N+1}</c:f>
              <c:numCache><c:formatCode>#,##0</c:formatCode><c:ptCount val="${N}"/>${valPts}</c:numCache>
            </c:numRef>
          </c:val>
        </c:ser>
        <c:gapWidth val="60"/>
        <c:axId val="11111"/><c:axId val="22222"/>
      </c:barChart>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${legendSerXml}
        <c:axId val="11111"/><c:axId val="22222"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="11111"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/><c:axPos val="b"/>
        <c:numFmt formatCode="General" sourceLinked="0"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr><a:ln><a:solidFill><a:srgbClr val="DDDDDD"/></a:solidFill></a:ln></c:spPr>
        <c:crossAx val="22222"/>
        <c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>
        <c:noMultiLvlLbl val="0"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="22222"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/><c:axPos val="l"/>
        <c:numFmt formatCode="#,##0" sourceLinked="0"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr><a:ln><a:solidFill><a:srgbClr val="DDDDDD"/></a:solidFill></a:ln></c:spPr>
        <c:crossAx val="11111"/><c:crossBetween val="between"/>
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
  <c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>
</c:chartSpace>`;

  // ── drawing1.xml ──────────────────────────────────────────
  const drawingXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${N+6}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic>
    </xdr:graphicFrame><xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;

  const drawingRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`;
  const sheet2Rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;

  let ct=await zip.file('[Content_Types].xml').async('string');
  ct=ct.replace('</Types>',
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'+
    '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'+
    '</Types>');
  zip.file('[Content_Types].xml',ct);

  let wbx=await zip.file('xl/workbook.xml').async('string');
  wbx=wbx.replace('</sheets>',`<sheet name="${SNAME}" sheetId="2" r:id="rId99"/></sheets>`);
  zip.file('xl/workbook.xml',wbx);

  let wbr=await zip.file('xl/_rels/workbook.xml.rels').async('string');
  wbr=wbr.replace('</Relationships>',`<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`);
  zip.file('xl/_rels/workbook.xml.rels',wbr);

  zip.file('xl/worksheets/sheet2.xml',sheet2xml);
  zip.file('xl/worksheets/_rels/sheet2.xml.rels',sheet2Rels);
  zip.file('xl/drawings/drawing1.xml',drawingXml);
  zip.file('xl/drawings/_rels/drawing1.xml.rels',drawingRels);
  zip.file('xl/charts/chart1.xml',chartXml);

  return await zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'});
}

// ============================================================
// 일별 알람 카드 렌더링 (전처리/자숙/파쇄/포장 원육수율 이상 탐지)
// 임계값은 Firestore에서 로드 (settings 페이지에서 조정 가능)
// 사용자가 노란/빨간 차감(%P) 직접 입력 — 평균에서 X%P 떨어지면 알람
// ============================================================
const ALARM_DEFAULTS_FALLBACK = {
  preprocess: { mean: 0,     yel: 2, red: 3, enabled: true },
  cooking:    { mean: 54.50, yel: 2, red: 3, enabled: true },
  shredding:  { mean: 50.83, yel: 2, red: 3, enabled: true },
  packing:    { mean: 50.67, yel: 2, red: 3, enabled: true }
};
const ALARM_LABEL = {
  preprocess: '전처리 원육수율',
  cooking:    '자숙 원육수율',
  shredding:  '파쇄 원육수율',
  packing:    '포장 원육수율'
};

function _getAlarmThresholds(){
  // settings.js의 동기 헬퍼 → 기본값 (localStorage 사용 X)
  if(typeof getAlarmThresholdsSync === 'function') return getAlarmThresholdsSync();
  return JSON.parse(JSON.stringify(ALARM_DEFAULTS_FALLBACK));
}

function renderDailyAlerts(metrics, dateStr){
  const card = document.getElementById('alertCard');
  if(!card) return;

  const T = _getAlarmThresholds();
  const alerts = [];
  ['preprocess','cooking','shredding','packing'].forEach(k => {
    const t = T[k];
    if(!t || !t.enabled) return;
    const v = metrics[k];
    if(v == null || isNaN(v)) return;

    const yel = (typeof t.yel === 'number') ? t.yel : (t.std ? t.std*2 : 2);
    const red = (typeof t.red === 'number') ? t.red : (t.std ? t.std*3 : 3);

    let level = 'green';
    if(v <= t.mean - red) level = 'red';
    else if(v <= t.mean - yel) level = 'yellow';

    if(level !== 'green'){
      const diff = (v - t.mean).toFixed(2);  // 음수 (평소 대비 떨어진 %P)
      alerts.push({ key: k, label: ALARM_LABEL[k], value: v, mean: t.mean, level, diff });
    }
  });

  if(alerts.length === 0){
    card.style.display = 'none';
    return;
  }

  const colorMap = {
    red:    { bg:'#FEE2E2', bd:'#DC2626', tx:'#991B1B', icon:'●', word:'이상' },
    yellow: { bg:'#FEF3C7', bd:'#F59E0B', tx:'#92400E', icon:'●', word:'경고' }
  };

  card.style.display = 'block';
  card.innerHTML = alerts.map(a => {
    const c = colorMap[a.level];
    return `<div style="background:${c.bg};border:1px solid ${c.bd};border-radius:8px;padding:10px 14px;margin-bottom:6px;color:${c.tx};display:flex;align-items:center;gap:10px">
      <span style="font-size:14px;color:${c.bd}">${c.icon}</span>
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${a.label} ${c.word}</div>
        <div style="font-size:11px;opacity:0.85">평소 ${a.mean.toFixed(2)}% · 오늘 <b>${a.value.toFixed(2)}%</b> (평소 대비 ${a.diff}%P)</div>
      </div>
    </div>`;
  }).join('');

  // 빨간 알람 → 자동 카톡 발송 (kakao.js의 autoSendKakaoAlerts 호출)
  // 중복 방지: Firebase 이력 체크 후 안 보낸 것만 발송
  const redAlerts = alerts.filter(a => a.level === 'red');
  if(redAlerts.length > 0 && typeof autoSendKakaoAlerts === 'function'){
    autoSendKakaoAlerts(redAlerts, dateStr || (new Date().toISOString().slice(0,10)));
  }
}

// 탭 핸들러 글로벌 노출 (onclick에서 사용)
window._moSetPrevCmpTab = _moSetPrevCmpTab;

