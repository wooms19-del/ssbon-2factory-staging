// ============================================================
// timetable.js — 공정 타임테이블 (데이터 기반 의사결정 도구)
// 본질: 사용자 입력 → DB 데이터로 시뮬레이션 → 보고용 분석 결과
// 다중 디바이스 동기: 모든 입력값은 휘발성, 캐시 v= 항상 증가
// ============================================================

const TTT_PIN = '1234';

// 자숙·레토르트는 고정값 (DB 없음 / 사용자 명시값)
const TTT_FIXED = {
  cookHours: 4,        // 자숙 사이클 (시간)
  wagonMin: 30,        // 와건 시간 (분)
  tankKg: 800,         // 탱크당 자숙 max (kg) — 사용자분 시스템
  retortCycleMin: 150, // 레토르트 사이클 (2.5h)
  retortPerCycle: 384, // 1회차 처리량 (96 × 4대차)
};

// 자숙 수율 기본값 (자동 분석 실패/데이터 없음 시 사용) — cooking 컬렉션에서 type별로 계산
const TTT_COOK_YIELD_DEFAULT = {
  '홍두깨': 56.8,
  '우둔':   55.0,
  '설도':   58.0,
};

// 내포장 수율 (모든 원육 공통)
const TTT_PACK_YIELD = 99.8;
const TTT_PACK_KG_PER_POUCH = 1.35;

// 자동 분석 결과 (UI에 표시할 자동값 + n)
let TTT_AUTO = {
  yPre: { val: 89.3, n: 0 },
  yCook: { val: 56.8, n: 0 },
  yCrush: { val: 96.1, n: 0 },
  pPre: { val: 48.2, n: 0 },
  pCrush: { val: 17.2, n: 0 },
  pPackEa: { val: 8, n: 0 },
};

// 다중 작업용 두 번째 제품 자동값 (비-FC 원육 + 선택 제품)
// 단일 작업 모드에서는 사용 안 함
let TTT_AUTO_OTHER = {
  yPre: { val: 89.3, n: 0 },
  yCook: { val: 55.0, n: 0 },
  yCrush: { val: 96.1, n: 0 },
  pPre: { val: 48.2, n: 0 },
  pCrush: { val: 17.2, n: 0 },
  pPackEa: { val: 16, n: 0 },  // 비-FC는 일반적으로 EA/분 더 높음 (작은 제품)
};

// ── 진입 시 자동 초기화 ──────────────────────────────────
function tttInit() {
  tttAutoAnalyze().then(() => tttAutoAnalyzeOther().then(tttRender));
  if (!window.__tttTipInited) {
    window.__tttTipInited = true;
    document.addEventListener('mouseover', function(e) {
      const bar = e.target.closest('.ttt-bar');
      if (!bar) return;
      const tip = document.getElementById('tttTip');
      if (!tip) return;
      const title = bar.dataset.tipTitle || '';
      const info = (bar.dataset.tipInfo || '').split('|').filter(Boolean);
      tip.innerHTML = `<div class="ttt-tip-title">${title}</div>` + info.map(l => `<div>${l}</div>`).join('');
      tip.style.display = 'block';
    });
    document.addEventListener('mousemove', function(e) {
      const tip = document.getElementById('tttTip');
      if (tip && tip.style.display === 'block') {
        tip.style.left = Math.min(e.clientX + 16, window.innerWidth - 300) + 'px';
        tip.style.top  = Math.min(e.clientY + 16, window.innerHeight - 160) + 'px';
      }
    });
    document.addEventListener('mouseout', function(e) {
      if (e.target.closest('.ttt-bar')) {
        const tip = document.getElementById('tttTip');
        if (tip) tip.style.display = 'none';
      }
    });
  }
}

// 사용자가 자숙 분배 방식 클릭 → 화면 전체 재렌더
function tttSelectTankMode(mode) {
  window.tttSelectedTankMode = mode;
  tttRender();
}

// 동시 작업 토글 (체크박스 onchange)
function tttToggleDual() {
  const enabled = document.getElementById('ttt-dual-enabled')?.checked;
  const block = document.getElementById('ttt-dual-block');
  if (block) block.style.display = enabled ? 'flex' : 'none';
  // 토글 시 잔존 상태 리셋 - 이전 모드의 사용자 선택 초기화
  window.tttSelectedTankMode = null;
  // dual용 박스/이미지 잔존 DOM 제거 (있으면)
  const dualBox = document.getElementById('ttt-dual-result-box');
  if (dualBox) dualBox.remove();
  tttRender();
}

// 페이지 진입 시 (탭 활성화 등에서 호출)
if (typeof window !== 'undefined') {
  window.tttInit = tttInit;
  window.tttSelectTankMode = tttSelectTankMode;
  window.tttToggleDual = tttToggleDual;
}

// ── 시간 유틸 ────────────────────────────────────────────
function tttFmt(m) {
  const h = Math.floor(m / 60) % 24, n = Math.round(m % 60);
  return `${String(h).padStart(2,'0')}:${String(n).padStart(2,'0')}`;
}
function tttDur(m) {
  const h = Math.floor(m / 60), n = Math.round(m % 60);
  return h ? (n ? `${h}시간 ${n}분` : `${h}시간`) : `${n}분`;
}
function tttToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ── 입력값 수집 ──────────────────────────────────────────
function tttGetInputs() {
  const get = (id, def) => {
    const el = document.getElementById(id);
    if (!el) return def;
    const v = parseFloat(el.value);
    return isFinite(v) ? v : def;
  };
  const getStr = (id, def) => document.getElementById(id)?.value || def;
  const total = get('ttt-total', 28);
  const wkPack = get('ttt-wk-pack', 6);
  const wkTrans = get('ttt-wk-trans', 2);
  const mgr = get('ttt-mgr', 2);
  const wkLeftover = get('ttt-wk-leftover', 0);  // 제수 (전날 제품 외포장)
  // 파쇄 풀가동 (13:30~) = 총원 - 내포장 - 이송 - 관리 - 제수
  const autoCrushPeak = Math.max(0, total - wkPack - wkTrans - mgr - wkLeftover);
  // 파쇄 점심후 (12:30~13:30, 이송 합류 전) = autoCrushPeak - 4 (전처리조 4명 뒤늦게 합류)
  // 단순 가정: 풀가동에서 4명 빼면 점심후 (운영 모델)
  const autoCrushBeforePeak = Math.max(0, autoCrushPeak - 4);
  return {
    meatType: getStr('ttt-meat', '홍두깨'),
    meatKg: get('ttt-kg', 1600),
    startTime: getStr('ttt-start', '05:00'),
    earlyWorkers: get('ttt-early', 7),
    mgrTime: getStr('ttt-mgr-time', '07:00'),
    mgrWorkers: mgr,
    joinTime: getStr('ttt-join', '09:00'),
    totalWorkers: total,
    wkPre: get('ttt-wk-pre', 10),
    wkCrush: autoCrushBeforePeak,           // ★ 자동 계산
    wkPackPeak: autoCrushPeak,              // ★ 자동 계산
    wkPack: wkPack,
    wkTrans: wkTrans,
    wkLeftover: wkLeftover,                 // 제수
    yPre: get('ttt-y-pre', TTT_AUTO.yPre.val),
    yCrush: get('ttt-y-crush', TTT_AUTO.yCrush.val),
    pPre: get('ttt-p-pre', TTT_AUTO.pPre.val),
    pCrush: get('ttt-p-crush', TTT_AUTO.pCrush.val),
    pPackEa: get('ttt-p-pack', TTT_AUTO.pPackEa.val),
  };
}

// ── 누적 데이터 자동 분석 ────────────────────────────────
// 수율 정의:
//   - 전처리: 단계수율 = (kg - waste) / kg (원육 직접 측정이므로 단계=원육기준 동일)
//   - 자숙:   단계수율 = kg / kgIn  (cooking 컬렉션 자체에 투입·산출 다 있음)
//   - 파쇄:   원육 기준 누적수율 = 파쇄 산출 kg / 같은 chain의 원육 kg
//             (chain: shredding.wagonIn → cooking.wagonOut 매칭 → cooking.cage/type → preprocess.kg)
// 분류:
//   - "홍두깨" 선택  = FC 제품 (product에 'FC' 포함)
//   - "우둔/설도" 선택 = 비-FC 제품 (FC 미포함)
//   - 원육 type은 preprocess/cooking 필터에만 사용
async function tttAutoAnalyze() {
  const period = document.getElementById('ttt-period')?.value || 'all';
  const meatType = document.getElementById('ttt-meat')?.value || '홍두깨';
  const isFC = (meatType === '홍두깨');
  const todayStr = (typeof tod === 'function') ? tod() : (new Date()).toISOString().slice(0,10);
  // fromDate 계산 (로컬 시간 기준, tod() 사용)
  const [ty,tm,td] = todayStr.split('-').map(Number);
  const todayLocal = new Date(ty, tm-1, td);
  const fmt = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  let fromDate = '2020-01-01', toDate = todayStr;
  if (period === 'today') fromDate = todayStr;
  else if (period === 'week') {
    const d = new Date(todayLocal); d.setDate(d.getDate() - 7); fromDate = fmt(d);
  }
  else if (period === 'month') {
    fromDate = fmt(new Date(ty, tm-1, 1));
  }
  else if (period === 'last30') {
    const d = new Date(todayLocal); d.setDate(d.getDate() - 30); fromDate = fmt(d);
  }

  try {
    const [preDocs, cookDocs, crushDocs, packDocs, thawDocs] = await Promise.all([
      db.collection('preprocess').get(),
      db.collection('cooking').get(),
      db.collection('shredding').get(),
      db.collection('packing').get(),
      db.collection('thawing').get(),
    ]);
    const inRange = d => d >= fromDate && d <= toDate;
    const minutesBetween = (s, e) => {
      if (!s || !e) return 0;
      const [sh, sm] = String(s).split(':').map(Number);
      const [eh, em] = String(e).split(':').map(Number);
      let diff = (eh*60+em) - (sh*60+sm);
      return diff < 0 ? diff + 1440 : diff;
    };

    // ── 전처리: 공정수율 (일별요약과 동일 정의) + 생산성 ──
    // 공정수율 = preprocess.kg / thawing.totalKg (해동 원물 = rmKg)
    // thawing 매칭: end가 분석 기간 내이고 type 일치 (일별요약 _endsOnDay 단순화)
    // 생산성: preInP=산출 누계, preInPIn=투입 누계 (=산출+비가식부, 작업자 처리량)
    let preInP=0, preInPIn=0, prePH=0, preN=0;
    preDocs.forEach(d => {
      const r = d.data();
      if (!inRange(r.date) || r.type !== meatType) return;
      const kg = +r.kg||0, w = +r.waste||0, wk = +r.workers||0;
      const m = minutesBetween(r.start, r.end);
      if (kg <= 0 || wk <= 0 || m <= 0) return;
      preInP += kg;            // 산출 기준 (다음 공정에 넘긴 양)
      preInPIn += (kg + w);    // 투입 기준 (작업자가 받은 양 = 산출 + 비가식부)
      prePH += wk * (m/60);
      preN++;
    });

    // 전처리 공정수율 분모: thawing 중 type 일치 + end가 분석 기간 내
    // end 형식 호환 (일별요약 _endsOnDay 로직):
    //  - datetime 'YYYY-MM-DD HH:MM' → end 첫 10글자 사용
    //  - 옛 형식 'HH:MM'             → thawing.date 사용
    //  - 비어있음                     → 진행중 제외
    let preRmKg = 0;
    thawDocs.forEach(d => {
      const r = d.data();
      const endStr = String(r.end||'');
      if (!endStr) return; // 진행중 제외
      let endDate;
      if (endStr.length >= 10 && endStr[4]==='-') endDate = endStr.slice(0,10);
      else endDate = String(r.date||'').slice(0,10); // 옛 'HH:MM' 형식 → date 사용
      if (!endDate || !inRange(endDate)) return;
      if ((r.type||'') !== meatType) return;
      preRmKg += +r.totalKg||0;
    });

    // ── 자숙: cooking.kgIn(투입) → cooking.kg(산출), type 필터 ──
    let ckInY=0, ckOutY=0, ckN=0;
    // 동시에 chain-trace용 인덱스 구축: cooking.wagonOut(콤마구분)별로 type 매핑
    const cookByWagonOut = {}; // { 'YYYY-MM-DD|wagonNo': type }
    cookDocs.forEach(d => {
      const r = d.data();
      if (!inRange(r.date)) return;
      const kgIn = +r.kgIn||0, kgOut = +r.kg||0;
      if (r.type === meatType && kgIn > 0 && kgOut > 0) {
        ckInY += kgIn; ckOutY += kgOut; ckN++;
      }
      // chain-trace 인덱스 (해당 기간 모든 type)
      const wOutStr = String(r.wagonOut||'');
      if (wOutStr && r.type) {
        wOutStr.split(',').map(s=>s.trim()).filter(Boolean).forEach(w => {
          cookByWagonOut[r.date+'|'+w] = r.type;
        });
      }
    });

    // ── 파쇄: chain-trace로 type 추론, 원육 기준 누적수율 ──
    // shredding.kg = 산출 (이전 코드의 큰 버그: 입력으로 잘못 사용했었음)
    // 원육 기준 누적수율 = shredding.kg / (해당 chain의 원육 kg)
    // 원육 kg = 같은 날짜 preprocess.kg (선택된 meatType 합산)
    //
    // 단순화: 같은 날 같은 type의 모든 shredding 산출 합 ÷ 같은 날 같은 type preprocess 입력 합
    // type 추론: shredding.wagonIn → cookByWagonOut에서 type 가져옴
    let crInP=0, crInPOut=0, crPH=0, crN=0;       // 생산성용 (모든 데이터)
                                                    // crInP=투입 누계(kgIn), crInPOut=산출 누계(kg)
    const crByDay = {};  // { date: { sumOut: kg, hasMatchingType: bool } } — 원육기준 수율용

    crushDocs.forEach(d => {
      const r = d.data();
      if (!inRange(r.date)) return;
      const kg = +r.kg||0, kgIn = +r.kgIn||0, wk = +r.workers||0;
      const m = minutesBetween(r.start, r.end);
      if (kg <= 0 || wk <= 0 || m <= 0) return;

      // chain-trace: wagonIn 콤마구분 각각에 대해 cooking type 매칭
      const wInStr = String(r.wagonIn||'');
      const wIns = wInStr.split(',').map(s=>s.trim()).filter(Boolean);
      let matchedType = null;
      for (const w of wIns) {
        const t = cookByWagonOut[r.date+'|'+w];
        if (t) { matchedType = t; break; }
      }
      if (matchedType !== meatType) return; // 선택 원육 아닌 데이터 제외

      // 생산성: kgIn 우선, 없으면 kg 사용
      const prodKg = kgIn > 0 ? kgIn : kg;
      crInP += prodKg;        // 투입 기준
      crInPOut += kg;          // 산출 기준
      crPH += wk * (m/60);
      crN++;

      // 원육기준 수율: 같은 날 산출량 합산
      if (!crByDay[r.date]) crByDay[r.date] = { sumOut: 0 };
      crByDay[r.date].sumOut += kg;
    });

    // 원육 기준 분모: 같은 날 같은 type의 preprocess.kg 합
    const preByDay = {}; // { date: sumKg }
    preDocs.forEach(d => {
      const r = d.data();
      if (!inRange(r.date) || r.type !== meatType) return;
      const kg = +r.kg||0;
      if (kg <= 0) return;
      preByDay[r.date] = (preByDay[r.date]||0) + kg;
    });

    let crYldNum=0, crYldDen=0;
    Object.keys(crByDay).forEach(date => {
      const out = crByDay[date].sumOut;
      const orig = preByDay[date];
      if (out > 0 && orig > 0) {
        crYldNum += out;
        crYldDen += orig;
      }
    });

    // ── 내포장: FC vs 비-FC 이분법 ──
    let pkEa=0, pkMin=0, pkN=0;
    packDocs.forEach(d => {
      const r = d.data();
      if (!inRange(r.date)) return;
      const ea = +r.ea||0, m = minutesBetween(r.start, r.end);
      if (ea <= 0 || m <= 0) return;
      const prod = (r.product||'').toString();
      const isFCProd = /FC/i.test(prod);
      if (isFC !== isFCProd) return; // FC면 FC제품만, 비-FC면 비-FC제품만
      pkEa += ea; pkMin += m; pkN++;
    });

    // ── TTT_AUTO 갱신 ──
    // 전처리 공정수율 = preprocess.kg 합 / thawing.totalKg 합 (일별요약 정의와 동일)
    if (preRmKg > 0 && preInP > 0) {
      TTT_AUTO.yPre = { val: +(preInP/preRmKg*100).toFixed(1), n: preN };
    } else {
      TTT_AUTO.yPre = { ...TTT_AUTO.yPre, n: preN };
    }

    if (ckInY > 0) TTT_AUTO.yCook = { val: +(ckOutY/ckInY*100).toFixed(1), n: ckN };
    else TTT_AUTO.yCook = { val: TTT_COOK_YIELD_DEFAULT[meatType] || 56.8, n: 0 };

    // 파쇄 수율 = 단계수율 (시뮬 식 crushOut = crushIn × yCrush / 100과 일치)
    // 단계수율은 같은 레코드 안의 kg/kgIn이라 진행 중인 날에도 정확함
    // 원육기준 누적수율은 참고용으로 별도 보관 (valOrig)
    if (crInP > 0) {
      const stageYld = +(crInPOut/crInP*100).toFixed(1);
      const origYld = crYldDen > 0 ? +(crYldNum/crYldDen*100).toFixed(1) : null;
      TTT_AUTO.yCrush = { val: stageYld, valOrig: origYld, n: crN };
    } else {
      TTT_AUTO.yCrush = { ...TTT_AUTO.yCrush, n: crN };
    }

    // pPre.val=투입 기준 (전처리 표준 — thawing.totalKg / mh = 일별요약과 동일)
    // pPre.valOut=산출 기준 (참고 — preprocess.kg / mh)
    // pCrush.val=산출 기준 (파쇄 표준)
    if (prePH > 0) {
      const valIn = preRmKg > 0 ? +(preRmKg/prePH).toFixed(1) : +(preInPIn/prePH).toFixed(1);  // 폴백: preInPIn
      TTT_AUTO.pPre = { val: valIn, valOut: +(preInP/prePH).toFixed(1), n: preN };
    }
    if (crPH > 0) TTT_AUTO.pCrush = { val: +(crInPOut/crPH).toFixed(1), valIn: +(crInP/crPH).toFixed(1), n: crN };
    if (pkMin > 0) TTT_AUTO.pPackEa = { val: +(pkEa/pkMin).toFixed(1), n: pkN };

    // ── 다중 모드: 두 번째 제품(비-FC) 자동값 별도 계산 ──
    // 단일 모드에서는 사용되지 않지만 미리 채워둠 (토글 켜는 즉시 사용 가능)
    // 첫 번째가 FC면 두 번째는 비-FC. 첫 번째가 비-FC면 두 번째도 비-FC(다른 제품).
    // 단순화: 비-FC 통계만 계산하고 보관 (실제 사용은 tttGetInputs에서)
    {
      const otherMeatType = isFC ? '우둔' : meatType; // FC 분석 중이면 우둔을 비교용으로
      // 전처리 (다른 type) - 공정수율은 일별요약 정의 (preprocess.kg / thawing.totalKg)
      let oPreInP=0, oPrePH=0, oPreN=0;
      preDocs.forEach(d => {
        const r = d.data();
        if (!inRange(r.date)) return;
        if (isFC ? r.type === meatType : r.type !== meatType) return; // 반대 type만
        const kg = +r.kg||0, wk = +r.workers||0;
        const m = minutesBetween(r.start, r.end);
        if (kg <= 0 || wk <= 0 || m <= 0) return;
        oPreInP += kg;
        oPrePH += wk * (m/60);
        oPreN++;
      });
      // 다른 type의 thawing 합 (end가 분석 기간 내, 형식 호환)
      let oPreRmKg = 0;
      thawDocs.forEach(d => {
        const r = d.data();
        const endStr = String(r.end||'');
        if (!endStr) return;
        let endDate;
        if (endStr.length >= 10 && endStr[4]==='-') endDate = endStr.slice(0,10);
        else endDate = String(r.date||'').slice(0,10);
        if (!endDate || !inRange(endDate)) return;
        const rType = r.type||'';
        if (isFC ? rType === meatType : rType !== meatType) return;
        oPreRmKg += +r.totalKg||0;
      });
      // 자숙 (다른 type)
      let oCkInY=0, oCkOutY=0, oCkN=0;
      cookDocs.forEach(d => {
        const r = d.data();
        if (!inRange(r.date)) return;
        if (isFC ? r.type === meatType : r.type !== meatType) return;
        const kgIn = +r.kgIn||0, kgOut = +r.kg||0;
        if (kgIn > 0 && kgOut > 0) { oCkInY += kgIn; oCkOutY += kgOut; oCkN++; }
      });
      // 내포장 (반대 분류)
      let oPkEa=0, oPkMin=0, oPkN=0;
      packDocs.forEach(d => {
        const r = d.data();
        if (!inRange(r.date)) return;
        const ea = +r.ea||0, m = minutesBetween(r.start, r.end);
        if (ea <= 0 || m <= 0) return;
        const prod = (r.product||'').toString();
        const isFCProd = /FC/i.test(prod);
        if (isFC === isFCProd) return; // 반대 분류만
        oPkEa += ea; oPkMin += m; oPkN++;
      });
      // 파쇄: 비-FC 원육은 보통 한 종류(우둔)만 작업하므로 단순 합산 (chain-trace 생략)
      // 단일 모드 검증에는 영향 없음
      if (oPreRmKg > 0 && oPreInP > 0) TTT_AUTO_OTHER.yPre = { val: +(oPreInP/oPreRmKg*100).toFixed(1), n: oPreN };
      if (oCkInY > 0) TTT_AUTO_OTHER.yCook = { val: +(oCkOutY/oCkInY*100).toFixed(1), n: oCkN };
      else TTT_AUTO_OTHER.yCook = { val: TTT_COOK_YIELD_DEFAULT[otherMeatType] || 55.0, n: 0 };
      if (oPrePH > 0) {
        const valIn = oPreRmKg > 0 ? +(oPreRmKg/oPrePH).toFixed(1) : +(oPreInP/oPrePH).toFixed(1);
        TTT_AUTO_OTHER.pPre = { val: valIn, n: oPreN };
      }
      if (oPkMin > 0) TTT_AUTO_OTHER.pPackEa = { val: +(oPkEa/oPkMin).toFixed(1), n: oPkN };
    }

    tttFillAutoValues();
  } catch (e) {
    console.error('[TT] 자동 분석 실패:', e);
  }
}

async function tttAutoAnalyzeOther() {
  // FP 분석 기간 + 원육 종류 선택 기반으로 TTT_AUTO_OTHER 갱신
  const periodDays = parseInt(document.getElementById('ttt-period2')?.value) || 30;
  const fpMeatType = document.getElementById('ttt-meattype2')?.value || '우둔';
  const todayStr = (typeof tod === 'function') ? tod() : new Date().toISOString().slice(0,10);
  const [ty,tm,td] = todayStr.split('-').map(Number);
  const todayLocal = new Date(ty, tm-1, td);
  const d = new Date(todayLocal); d.setDate(d.getDate() - periodDays);
  const fmt = x => x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
  const fromDate = fmt(d);
  const inRange = s => s >= fromDate && s <= todayStr;
  const minutesBetween = (s, e) => {
    if (!s || !e) return 0;
    const [sh,sm] = String(s).split(':').map(Number);
    const [eh,em] = String(e).split(':').map(Number);
    let diff = (eh*60+em)-(sh*60+sm);
    return diff < 0 ? diff+1440 : diff;
  };
  // 원육 종류 필터 함수
  const isFpType = (type) => {
    if (fpMeatType === '기타') return type !== '홍두깨' && type !== '우둔' && type !== '설도' && type !== '코코';
    return type === fpMeatType;
  };
  try {
    const [preDocs, crushDocs, cookDocs, packDocs, thawDocs] = await Promise.all([
      db.collection('preprocess').get(),
      db.collection('shredding').get(),
      db.collection('cooking').get(),
      db.collection('packing').get(),
      db.collection('thawing').get(),
    ]);
    // ── FP 전처리 수율: FC와 동일 방식 (thawing end 기준 날짜 매칭) ──
    let preKg=0,preKgIn=0,prePH=0,preN=0,preRmKg=0;
    preDocs.forEach(d => {
      const r=d.data(); if (!inRange(r.date)||!isFpType(r.type||'')) return;
      const kg=+r.kg||0,w=+r.waste||0,wk=+r.workers||0,m=minutesBetween(r.start,r.end);
      if (kg>0&&wk>0&&m>0) { preKg+=kg; preKgIn+=(kg+w); prePH+=wk*(m/60); preN++; }
    });
    thawDocs.forEach(d => {
      const r=d.data();
      if (!isFpType(r.type||'')) return;
      const endStr=String(r.end||'');
      if (!endStr) return;
      let endDate;
      if (endStr.length>=10&&endStr[4]==='-') endDate=endStr.slice(0,10);
      else endDate=String(r.date||'').slice(0,10);
      if (!endDate||!inRange(endDate)) return;
      preRmKg+=+r.totalKg||0;
    });
    let ckIn=0,ckOut=0,ckN=0;
    cookDocs.forEach(d => {
      const r=d.data(); if (!inRange(r.date)||!isFpType(r.type||'')) return;
      if (+r.kgIn>0&&+r.kg>0) { ckIn+=+r.kgIn; ckOut+=+r.kg; ckN++; }
    });
    let crIn=0,crOut=0,crPH=0,crN=0;
    crushDocs.forEach(d => {
      const r=d.data(); if (!inRange(r.date)||!isFpType(r.type||'')) return;
      const kg=+r.kg||0,kgIn=+r.kgIn||+r.inputKg||0,wk=+r.workers||0,m=minutesBetween(r.start,r.end);
      if (kg>0&&wk>0&&m>0) { crIn+=kgIn||kg; crOut+=kg; crPH+=wk*(m/60); crN++; }
    });
    // FP 내포장 생산성 (pPackEa): packing 컬렉션
    // FC가 아닌 것 + 원육종류 필터 + 기간
    // 측정: ea / (작업시간 분)
    let pkEa=0, pkMin=0, pkN=0;
    packDocs.forEach(d => {
      const r=d.data(); if (!inRange(r.date)) return;
      const prod = String(r.product||'');
      // FC 제외 (3KG 포함된 제품)
      if (prod.indexOf('3KG') >= 0 || prod.indexOf('3kg') >= 0) return;
      const type = r.type || '';
      if (type && !isFpType(type)) return;
      const ea = +r.ea || 0;
      const m = minutesBetween(r.start, r.end);
      if (ea > 0 && m > 0) { pkEa += ea; pkMin += m; pkN++; }
    });
    const yPre = preRmKg>0 ? Math.round(preKg/preRmKg*1000)/10 : TTT_AUTO_OTHER.yPre.val;
    const pPre = prePH>0 ? Math.round(preRmKg/prePH*10)/10 : TTT_AUTO_OTHER.pPre.val;
    const yCrush = crIn>0 ? Math.round(crOut/crIn*1000)/10 : TTT_AUTO_OTHER.yCrush.val;
    const pCrush = crPH>0 ? Math.round(crOut/crPH*10)/10 : TTT_AUTO_OTHER.pCrush.val;
    const yCook = ckIn>0 ? Math.round(ckOut/ckIn*1000)/10 : TTT_AUTO_OTHER.yCook?.val || 55.0;
    const pPackEa = pkMin>0 ? Math.round(pkEa/pkMin*10)/10 : TTT_AUTO_OTHER.pPackEa.val;
    TTT_AUTO_OTHER.yPre = { val: yPre, n: preN };
    TTT_AUTO_OTHER.pPre = { val: pPre, n: preN };
    TTT_AUTO_OTHER.yCrush = { val: yCrush, n: crN };
    TTT_AUTO_OTHER.pCrush = { val: pCrush, n: crN };
    TTT_AUTO_OTHER.yCook = { val: yCook, n: ckN };
    TTT_AUTO_OTHER.pPackEa = { val: pPackEa, n: pkN };
    // summary 표시
    const el = document.getElementById('ttt-fp-auto-summary');
    if (el) el.textContent = `전처리 ${yPre}% · ${pPre}kg/인시 | 파쇄 ${yCrush}% · ${pCrush}kg/인시 | 자숙 ${yCook}% (n=${preN}/${crN})`;
    // FP 카드 자동값 채우기 (user가 직접 수정하지 않은 경우에만)
    const fpSetAuto = (id, val, autoId) => {
      const inp = document.getElementById(id);
      if (inp) { inp.value = val; delete inp.dataset.userEdited; }
      const autoEl = document.getElementById(autoId);
      if (autoEl) autoEl.textContent = `자동: ${val} (n=${preN})`;
    };
    fpSetAuto('ttt-fp-y-pre',   yPre,   'ttt-fp-y-pre-auto');
    fpSetAuto('ttt-fp-p-pre',   pPre,   'ttt-fp-p-pre-auto');
    fpSetAuto('ttt-fp-y-crush', yCrush, 'ttt-fp-y-crush-auto');
    fpSetAuto('ttt-fp-p-crush', pCrush, 'ttt-fp-p-crush-auto');
    fpSetAuto('ttt-fp-p-pack',  pPackEa,'ttt-fp-p-pack-auto');
    tttRender();
  } catch(e) {
    console.error('[TTM] FP 분석 실패:', e);
  }
}
if (typeof window !== 'undefined') window.tttAutoAnalyzeOther = tttAutoAnalyzeOther;

function tttFillAutoValues() {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.dataset.userEdited || el.dataset.userEdited === 'false') el.value = v;
  };
  setVal('ttt-y-pre', TTT_AUTO.yPre.val);
  setVal('ttt-y-crush', TTT_AUTO.yCrush.val);
  setVal('ttt-p-pre', TTT_AUTO.pPre.val);
  setVal('ttt-p-crush', TTT_AUTO.pCrush.val);
  setVal('ttt-p-pack', TTT_AUTO.pPackEa.val);
  // 자동값 라벨 갱신
  const lab = (id, info) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = info.n > 0 ? `자동: ${info.val} (n=${info.n})` : `자동: ${info.val} · 데이터 없음`;
  };
  lab('ttt-y-pre-auto', TTT_AUTO.yPre);
  // 파쇄 수율: 공정수율(val)이 표준 + 원육기준(valOrig)은 참고용
  {
    const el = document.getElementById('ttt-y-crush-auto');
    if (el) {
      const i = TTT_AUTO.yCrush;
      if (i.n > 0 && i.valOrig != null) {
        el.textContent = `자동: 공정 ${i.val}% / 원육기준 ${i.valOrig}% (n=${i.n})`;
      } else {
        el.textContent = i.n > 0 ? `자동: ${i.val} (n=${i.n})` : `자동: ${i.val} · 데이터 없음`;
      }
    }
  }
  // 전처리 생산성: 투입 기준이 표준 (val), 산출도 참고용으로 같이 표시
  {
    const el = document.getElementById('ttt-p-pre-auto');
    if (el) {
      const i = TTT_AUTO.pPre;
      el.textContent = i.n > 0
        ? `자동: 투입 ${i.val} / 산출 ${i.valOut ?? i.val} kg/인시 (n=${i.n})`
        : `자동: ${i.val} · 데이터 없음`;
    }
  }
  // 파쇄 생산성: 산출 기준이 표준 (val), 투입도 참고용으로 같이 표시
  {
    const el = document.getElementById('ttt-p-crush-auto');
    if (el) {
      const i = TTT_AUTO.pCrush;
      el.textContent = i.n > 0
        ? `자동: 투입 ${i.valIn ?? i.val} / 산출 ${i.val} kg/인시 (n=${i.n})`
        : `자동: ${i.val} · 데이터 없음`;
    }
  }
  lab('ttt-p-pack-auto', TTT_AUTO.pPackEa);
}

function tttMarkEdited(el) {
  el.dataset.userEdited = 'true';
  tttRender();
}

function tttResetField(id, autoKey) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = TTT_AUTO[autoKey].val;
  el.dataset.userEdited = 'false';
  tttRender();
}

// 분석 기간 / 원육 종류 변경 시 → 자동 분석 재실행
async function tttPeriodChange() {
  // 사용자 수정한 입력 초기화
  ['ttt-y-pre','ttt-y-crush','ttt-p-pre','ttt-p-crush','ttt-p-pack'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dataset.userEdited = 'false';
  });
  await tttAutoAnalyze();
  tttRender();
}

// ── 시뮬레이션 엔진 ──────────────────────────────────────
function tttSimulate(inp, tankMode) {
  // tankMode: 'A' (잔량 먼저 + 800kg씩 - 자숙·파쇄 빨리 시작), 'B' (N등분 균등), 'E' (1호 작게 빨리시작 + 나머지 균등)
  tankMode = tankMode || 'A';
  const startMin = tttToMin(inp.startTime);
  const joinMin = tttToMin(inp.joinTime);
  const cookYield = (TTT_AUTO.yCook && TTT_AUTO.yCook.n > 0) ? TTT_AUTO.yCook.val : (TTT_COOK_YIELD_DEFAULT[inp.meatType] || 56.8);

  const preIn = inp.meatKg;
  const preOut = preIn * inp.yPre / 100;
  const cookIn = preOut;
  const cookOut = cookIn * cookYield / 100;
  const crushIn = cookOut;
  const crushOut = crushIn * inp.yCrush / 100;
  const packIn = crushOut;
  const packOut = packIn * TTT_PACK_YIELD / 100;
  // 제품별 kg/EA: FC는 1.35kg, 비-FC는 productInfo에서 받음
  const kgPerEaUsed = (inp.productInfo && inp.productInfo.kgPerEa) ? inp.productInfo.kgPerEa : TTT_PACK_KG_PER_POUCH;
  const pouches = Math.floor(packOut / kgPerEaUsed);

  // 전처리 시간
  const phase1Min = Math.max(0, joinMin - startMin);
  const phase1Kg = inp.pPre * inp.earlyWorkers * (phase1Min / 60);
  const remainingKg = Math.max(0, preIn - phase1Kg);
  const phase2Min = remainingKg / (inp.pPre * inp.wkPre) * 60;
  const preEndMin = joinMin + Math.round(phase2Min);
  const preHours = (preEndMin - startMin) / 60;

  // 자숙 탱크 분배 (tankMode별)
  const cookCycles = Math.max(1, Math.ceil(cookIn / TTT_FIXED.tankKg));
  let tankKgs;  // 각 탱크 자숙 산출 량 (= 자숙 투입 - 자숙수율 손실 후)... 정확히는 자숙 투입량
  if (tankMode === 'A') {
    // 잔량 먼저 → 1호 가득 (작은 수량 먼저 시작해서 자숙·파쇄 빨리 시작)
    tankKgs = [];
    const remainder = Math.max(0, cookIn - (cookCycles - 1) * TTT_FIXED.tankKg);
    if (cookCycles === 1) {
      tankKgs = [cookIn];
    } else {
      tankKgs.push(remainder);
      for (let i = 1; i < cookCycles; i++) tankKgs.push(TTT_FIXED.tankKg);
    }
  } else if (tankMode === 'B') {
    // N등분 균등
    tankKgs = Array(cookCycles).fill(cookIn / cookCycles);
  } else if (tankMode === 'E') {
    // 1호 작게 (외국인 1.5h 분량) → 나머지 균등
    // 외국인 7명 1.5h = 약 552kg 원육 → 자숙 투입 = 552 × yPre = ~510kg
    const firstTankIn = Math.min(510, cookIn);
    if (cookCycles === 1) {
      tankKgs = [cookIn];
    } else {
      const rest = (cookIn - firstTankIn) / (cookCycles - 1);
      tankKgs = [firstTankIn, ...Array(cookCycles - 1).fill(rest)];
    }
  } else {
    tankKgs = Array(cookCycles).fill(cookIn / cookCycles);
  }

  // 각 탱크 투입 시각 = 그 탱크의 cumulative 자숙 투입량 도달 시점
  const tankInTimes = [];
  let cumOut = 0;  // 자숙 투입 누적 (= 전처리 산출 누적)
  for (let i = 0; i < cookCycles; i++) {
    cumOut += tankKgs[i];
    // 전처리 누적 투입 = 자숙 투입 누적 / yPre%
    const targetInKg = cumOut / (inp.yPre / 100);
    let tankInMin;
    if (targetInKg <= phase1Kg) {
      tankInMin = startMin + Math.round(targetInKg / (inp.pPre * inp.earlyWorkers) * 60);
    } else {
      const extraKg = targetInKg - phase1Kg;
      tankInMin = joinMin + Math.round(extraKg / (inp.pPre * inp.wkPre) * 60);
    }
    if (i === cookCycles - 1 && tankInMin > preEndMin) tankInMin = preEndMin;
    tankInTimes.push(tankInMin);
  }
  const tankOutTimes = tankInTimes.map(t => t + TTT_FIXED.cookHours * 60);
  const wagonEndTimes = tankOutTimes.map(t => t + TTT_FIXED.wagonMin);

  // 파쇄: 자숙 1호 와건 종료부터 시작
  // 종료는 두 조건 중 늦은 쪽:
  //  (1) 파쇄 자체 처리 완료 = crushStart + (총kg / 속도 / 인원)
  //  (2) 자숙 마지막 와건 종료 + 잔량 처리 시간 (마지막 탱크 출하 후 그 분량 파쇄)
  const crushStartMin = wagonEndTimes[0];
  const lastWagonEnd = wagonEndTimes[wagonEndTimes.length - 1];
  // 마지막 탱크 자숙 산출 = 마지막 탱크 자숙 투입량 × 수율 (모드별 다를 수 있음)
  const lastTankInKg = tankKgs[tankKgs.length - 1];
  const lastTankOutKg = lastTankInKg * (cookYield / 100);

  // ── 파쇄 시뮬: 시간대별 가용 인원 동적 계산 ──
  //
  // 핵심 원칙: 점심 시간대에 가용한 인원이 있으면 파쇄 라인에 자동 투입
  //
  // 11:30~12:30 (점심 1차 - 후공정조 차례):
  //   · 전처리가 11:30 전에 끝났으면 → 전처리조 wkPre명이 파쇄 가능
  //   · 전처리가 진행 중이면 → 전처리조는 자기 일, 파쇄 0명
  //   · (후공정조는 점심이라 못 옴)
  //
  // 12:30~13:30 (점심 2차 - 전처리조 차례):
  //   · 전처리조는 점심
  //   · 후공정조 복귀 → 파쇄 = wkCrush + wkTrans (이송 합류, 내포장 시작 전)
  //
  // 13:30~ (풀가동):
  //   · 파쇄 = wkPackPeak (전처리조 일부 합류)
  const LUNCH1_S = 11*60 + 30;
  const LUNCH1_E = 12*60 + 30;
  const LUNCH2_E = 13*60 + 30;

  const crushWorkersAt = (t) => {
    if (t < LUNCH1_S) return inp.wkCrush;
    // 11:30~12:30: 점심 1차
    if (t < LUNCH1_E) {
      // 전처리가 이미 끝났으면 → 전처리조가 파쇄로 합류
      if (preEndMin <= LUNCH1_S) return inp.wkPre;
      // 전처리가 진행 중 → 파쇄 0명
      return 0;
    }
    // 12:30~13:30: 점심 2차
    if (t < LUNCH2_E) {
      return inp.wkCrush + inp.wkTrans;  // 후공정조 복귀 + 이송 합류
    }
    // 13:30~: 풀가동
    return inp.wkPackPeak;
  };
  // 파쇄 자체 시간: crushStart 부터 1분씩 진행
  let crushSelfEndMin = crushStartMin;
  let crushProcessed = 0;
  for (let t = crushStartMin; t < 26*60 && crushProcessed < crushIn; t++) {
    const w = crushWorkersAt(t);
    if (w > 0) crushProcessed += inp.pCrush * w / 60;
    crushSelfEndMin = t + 1;
  }
  // 마지막 탱크 산출분 처리 (참고용, crushEndMin은 아래에서 tankCrushTimes 마지막 호로 정의)
  let lastTankCrushEndMin = lastWagonEnd;
  let lastTankProcessed = 0;
  for (let t = lastWagonEnd; t < 26*60 && lastTankProcessed < lastTankOutKg; t++) {
    const w = crushWorkersAt(t);
    if (w > 0) lastTankProcessed += inp.pCrush * w / 60;
    lastTankCrushEndMin = t + 1;
  }

  // ── 각 자숙 호별 파쇄 처리 종료 시점 시뮬 ──
  // i호 와건 종료 → 그 산출(tankOutKg)이 파쇄 처리되는 종료 시점
  // 단 이전 호 처리가 끝나야 시작 (FIFO)
  const tankCrushTimes = []; // [{호:i, start:와건종료, end:처리종료, kg:산출량}]
  let prevTankEnd = wagonEndTimes[0];  // 첫 호는 자기 와건 종료 시점부터 시작
  for (let i = 0; i < tankInTimes.length; i++) {
    const tankKg = tankKgs[i];  // 모드별 분배된 탱크 투입량
    const tankOutKg = tankKg * cookYield / 100;
    // 시작 = max(이전 호 처리 종료, 이 호의 와건 종료)
    const startMin = Math.max(prevTankEnd, wagonEndTimes[i]);
    let processed = 0;
    let endMin = startMin;
    for (let t = startMin; t < 28*60 && processed < tankOutKg; t++) {
      const w = crushWorkersAt(t);
      if (w > 0) processed += inp.pCrush * w / 60;
      endMin = t + 1;
    }
    tankCrushTimes.push({ idx: i+1, start: startMin, end: endMin, kg: tankOutKg, tankInKg: tankKg });
    prevTankEnd = endMin;
  }
  // 파쇄 종료 = 마지막 자숙 호 파쇄 종료 (호별 FIFO 흐름이 정답)
  const crushEndMin = tankCrushTimes[tankCrushTimes.length - 1].end;
  const crushHours = (crushEndMin - crushStartMin) / 60;
  // ── 내포장 시뮬: 동적 ──
  //
  // 점심 1차에 전처리조가 파쇄 합류 → 파쇄 산출도 그만큼 누적
  // 내포장은 그 산출이 충분히 누적된 뒤 시작 가능
  // 단순화: 전처리 끝났으면 → 12:30부터 시작 가능 (파쇄가 1시간 가동했으니까)
  //         전처리 안 끝났으면 → 13:30부터 (모드 A 동일)
  // ── 내포장 시작 시점 ──
  // 규칙: 13:30 시점에 파쇄 산출 ≥ 200kg이면 13:30 시작
  //       부족하면 → 200kg 도달할 때까지 대기
  const PACK_START_BASE = 13*60 + 30;
  const PACK_START_MIN_KG = 200;  // 산출 누적 200kg 이상
  // crushStartMin부터 분당 누적 (crushWorkersAt × pCrush × yCrush)
  let crushAccumOut = 0;
  let packStartMin = PACK_START_BASE;
  let kgAtBase = 0;
  for (let t = crushStartMin; t < 28*60; t++) {
    const w = crushWorkersAt(t);
    if (w > 0) crushAccumOut += inp.pCrush * w / 60 * (inp.yCrush / 100);
    if (t + 1 === PACK_START_BASE) kgAtBase = crushAccumOut;
    if (t + 1 >= PACK_START_BASE && crushAccumOut >= PACK_START_MIN_KG) {
      packStartMin = t + 1;
      break;
    }
  }
  // 내포장 인원 충분히 있으면 듀얼 가능 (제품이 maxLines=2일 때)
  // 한 라인 = wkPack 명 + 이송 wkTrans 명
  // 듀얼 = wkPack*2 + wkTrans*2 명 필요
  const pInfoForLines = inp.productInfo || { maxLines: 1 };
  const maxLines = pInfoForLines.maxLines || 1;
  const WK_PER_LINE = inp.wkPack || 6;
  const WK_TRANS_PER_LINE = inp.wkTrans || 2;
  const CREW_FOR_1_LINE = WK_PER_LINE + WK_TRANS_PER_LINE;       // 8명
  const CREW_FOR_2_LINES = WK_PER_LINE * 2 + WK_TRANS_PER_LINE;  // 14명 (이송 공유)

  const packWorkersAt = (t) => {
    if (t < packStartMin) return 0;
    return inp.wkPack;
  };
  // 동적 라인 수: 매 분마다 인원 가용량 기반
  // inp.wkPackAvailable이 있으면 그 값으로 듀얼 판정 (동시작업 FP)
  // 없으면 inp.wkPack (단일 모드)
  const linesAt = (t) => {
    if (t < packStartMin) return 0;
    const avail = inp.wkPackAvailable || inp.wkPack || 0;
    if (maxLines >= 2 && avail >= CREW_FOR_2_LINES) return 2;
    return 1;
  };
  const eaPerMinPerLine = inp.pPackEa;
  const packSpeedAt = (t) => linesAt(t) * eaPerMinPerLine;

  // 자체 처리 시간: packStart부터 처리량이 pouches 도달까지 (정지 시간 자동 반영)
  let packSelfEndMin = packStartMin;
  let packProcessed = 0;
  for (let t = packStartMin; t < 28*60 && packProcessed < pouches; t++) {
    packProcessed += packSpeedAt(t);
    packSelfEndMin = t + 1;
  }
  // 마지막 파쇄 산출분이 내포장 라인 통과 (파쇄 종료 후)
  const lastTankPackEa = Math.round(lastTankOutKg * (inp.yCrush / 100) / TTT_PACK_KG_PER_POUCH);
  let lastBatchPackEndMin = crushEndMin;
  let lastBatchProcessed = 0;
  for (let t = crushEndMin; t < 28*60 && lastBatchProcessed < lastTankPackEa; t++) {
    lastBatchProcessed += packSpeedAt(t);
    lastBatchPackEndMin = t + 1;
  }
  // 둘 중 늦은 쪽
  const packEndMin = Math.max(packSelfEndMin, lastBatchPackEndMin);
  const packMin = packEndMin - packStartMin;

  // 호기별 가동 구간 (lineSegments)
  // packStartMin ~ packEndMin 구간 분 단위로 훑으면서 호기 1, 2 가동 구간
  const lineSegments = { 1: [], 2: [] };
  let lineState = { 1: null, 2: null };
  for (let t = packStartMin; t <= packEndMin; t++) {
    const n = linesAt(t);
    if (n >= 1) {
      if (lineState[1] === null) lineState[1] = { start: t };
    } else {
      if (lineState[1] !== null) {
        lineState[1].end = t;
        lineSegments[1].push(lineState[1]);
        lineState[1] = null;
      }
    }
    if (n >= 2) {
      if (lineState[2] === null) lineState[2] = { start: t };
    } else {
      if (lineState[2] !== null) {
        lineState[2].end = t;
        lineSegments[2].push(lineState[2]);
        lineState[2] = null;
      }
    }
  }
  if (lineState[1] !== null) { lineState[1].end = packEndMin; lineSegments[1].push(lineState[1]); }
  if (lineState[2] !== null) { lineState[2].end = packEndMin; lineSegments[2].push(lineState[2]); }

  // 레토르트: 3대 병렬 + 대차 8개, EA 균등 분배 (전체 회차에 고르게)
  //
  // 룰:
  //  - 회차 수 = ceil(pouches / 384) (대차 4개 한도, 최소 회차 수)
  //  - 회차당 EA = 균등 분배 (예: 796 EA / 3회차 = 265, 265, 266)
  //  - 회차당 대차 = ceil(EA / 96)
  //  - 가동 시점 = 그 회차 EA 누적 + 대차 가용 + 설비 가용
  //  - 마지막 회차 = max(누적 시점, 내포장 종료)
  //
  // 효과: 4대차 가득 모을 필요 없음 → 회차 빨리 시작 → 전체 종료 빠름
  // 제품별 상수 (단일 모드는 FC, 다중 모드의 비-FC 시뮬은 productInfo로 갈아끼움)
  const pInfo = inp.productInfo || { eaPerCart: 96, retortCycleMin: TTT_FIXED.retortCycleMin };
  const EA_PER_CART = pInfo.eaPerCart;
  const RETORT_CYCLE_MIN = pInfo.retortCycleMin;
  const MAX_CARTS_PER_BATCH = 4;
  const MAX_EA_PER_BATCH = EA_PER_CART * MAX_CARTS_PER_BATCH;
  const retortCycles = Math.ceil(pouches / MAX_EA_PER_BATCH);
  const eaPerMin = inp.pPackEa;
  const NUM_RETORTS = 3;
  const TOTAL_CARTS = 8;

  // EA 균등 분배 (정수 단위, 마지막에 잔여 합산)
  const eaPerBatch = Math.floor(pouches / retortCycles);
  const eaRemainder = pouches - eaPerBatch * retortCycles;
  const batchEa = [];
  for (let i = 0; i < retortCycles; i++) {
    // 잔여 EA를 마지막 회차에 합산
    batchEa.push(i === retortCycles - 1 ? eaPerBatch + eaRemainder : eaPerBatch);
  }
  // 회차당 대차 수 = ceil(EA / 96), 최대 4
  const batchCarts = batchEa.map(ea => Math.min(MAX_CARTS_PER_BATCH, Math.ceil(ea / EA_PER_CART)));

  const retortStartTimes = [];
  const retortEndTimes = [];
  const retortFreeAt = [0, 0, 0];

  for (let i = 0; i < retortCycles; i++) {
    const isLast = i === retortCycles - 1;
    // i회차 누적 EA = 0~i까지 합
    const cumEa = batchEa.slice(0, i + 1).reduce((a, b) => a + b, 0);
    let accumulateMin = packStartMin + Math.round(cumEa / eaPerMin);
    if (isLast) accumulateMin = Math.max(accumulateMin, packEndMin);
    else if (accumulateMin > packEndMin) accumulateMin = packEndMin;

    const earliestRetort = retortFreeAt.indexOf(Math.min(...retortFreeAt));
    const retortAvailMin = retortFreeAt[earliestRetort];

    // 대차 가용 (현재 진행 중 대차 빼고)
    const cartsAvailableAt = (t) => {
      let inUse = 0;
      for (let k = 0; k < retortStartTimes.length; k++) {
        if (retortStartTimes[k] <= t && t < retortEndTimes[k]) {
          inUse += batchCarts[k];  // 그 회차의 실제 대차 수
        }
      }
      return TOTAL_CARTS - inUse;
    };

    let candidateStart = Math.max(retortAvailMin, accumulateMin);
    // 이 회차에 필요한 대차 수만큼 가용까지 대기
    while (cartsAvailableAt(candidateStart) < batchCarts[i]) {
      const ongoing = retortEndTimes.filter((e, k) => retortStartTimes[k] <= candidateStart && candidateStart < e);
      if (ongoing.length === 0) break;
      candidateStart = Math.min(...ongoing);
    }

    const start = candidateStart;
    const end = start + RETORT_CYCLE_MIN;
    retortStartTimes.push(start);
    retortEndTimes.push(end);
    retortFreeAt[earliestRetort] = end;
  }
  const retortStartMin = retortStartTimes[0];
  const retortEndMin = Math.max(...retortEndTimes);

  return {
    tankMode,
    tankKgs,
    preIn, preOut, cookIn, cookOut, crushIn, crushOut, packIn, packOut, pouches,
    preHours, crushHours, packMin,
    startMin, preEndMin, joinMin,
    phase1Min, phase1Kg,
    tankInTimes, tankOutTimes, wagonEndTimes,
    tankCrushTimes,
    crushStartMin, crushEndMin,
    crushSelfEndMin, lastTankCrushEndMin, lastTankOutKg,
    packStartMin, packEndMin,
    packSelfEndMin, lastBatchPackEndMin, lastTankPackEa,
    retortStartMin, retortEndMin, retortCycles,
    retortStartTimes, retortEndTimes,
    batchEa, batchCarts,
    cookYield,
    lineSegments, maxLines, eaPerMinPerLine,
    productInfo: inp.productInfo,
  };
}

// ── 다중 작업 시뮬 (순차 파이프라인) ───────────────────────
// 두 번째 제품별 대차/레토르트 사이클 정보
const TTT_PRODUCT_INFO = {
  // FC 3KG (홍두깨) — 2호기 1대만 (maxLines=1)
  'fc':     { name: 'FC 3KG',        eaPerCart: 96,    retortCycleMin: 150, kgPerEa: 1.3,   maxLines: 1, availableLines: [2] },
  // 두 번째 후보들 (비-FC)
  // FP 시그/코스트코/트레이더 → 3·4호기 (maxLines=2, 듀얼 가능)
  // 미니 → 1호기만 (maxLines=1)
  'trader': { name: '트레이더스 460g', eaPerCart: 380,  retortCycleMin: 120, kgPerEa: 0.147, maxLines: 2, availableLines: [3, 4] },
  'costco': { name: '코스트코 170g',   eaPerCart: 800,  retortCycleMin: 120, kgPerEa: 0.054, maxLines: 2, availableLines: [3, 4] },
  'sig':    { name: '시그니처 130g',   eaPerCart: 1024, retortCycleMin: 120, kgPerEa: 0.025, maxLines: 2, availableLines: [3, 4] },
  'mini':   { name: '미니 70g 5개입',  eaPerCart: 1280, retortCycleMin: 120, kgPerEa: 0.024, maxLines: 1, availableLines: [1] },
};

// FP 카드 자동값 복원
function tttFpResetField(inputId, key) {
  const val = TTT_AUTO_OTHER[key]?.val;
  if (val == null) return;
  const el = document.getElementById(inputId);
  if (el) { el.value = val; tttRender(); }
}

// 두 번째 제품용 inp 구성 — 화면 FP 카드 값 직접 읽음
function tttBuildSecondInp(inp, firstSim) {
  const meat2 = document.getElementById('ttt-meat2')?.value || 'trader';
  const kg2 = parseFloat(document.getElementById('ttt-kg2')?.value) || 500;
  const info = TTT_PRODUCT_INFO[meat2] || TTT_PRODUCT_INFO['trader'];

  const secondStartMin = firstSim.preEndMin;
  const fmtTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

  // 화면 FP 카드에서 읽기 (없으면 FC 값 fallback)
  const fpYPre    = parseFloat(document.getElementById('ttt-fp-y-pre')?.value)    || inp.yPre;
  const fpYCrush  = parseFloat(document.getElementById('ttt-fp-y-crush')?.value)  || inp.yCrush;
  const fpPPre    = parseFloat(document.getElementById('ttt-fp-p-pre')?.value)    || inp.pPre;
  const fpPCrush  = parseFloat(document.getElementById('ttt-fp-p-crush')?.value)  || inp.pCrush;
  const fpPPackEa = parseFloat(document.getElementById('ttt-fp-p-pack')?.value)   || inp.pPackEa;
  const fpWkPre   = parseInt(document.getElementById('ttt-fp-wk-pre')?.value)     || inp.wkPre;
  const fpWkPack  = parseInt(document.getElementById('ttt-fp-wk-pack')?.value)    || inp.wkPack;

  // FP가 듀얼 가능 제품(maxLines=2)이면 inp.wkPackAvailable에 가용 인원 표시
  // wkPack은 라인당 인원(6명), wkPackAvailable은 듀얼 가동 시 필요 총인원(14명)
  // tttSimulate의 linesAt이 이 값으로 듀얼 여부 결정
  const dualPossible = (info.maxLines || 1) >= 2;
  const wkPackAvailable = dualPossible ? Math.max(fpWkPack, 14) : fpWkPack;

  return {
    ...inp,
    meatType: '우둔',
    meatKg: kg2,
    startTime: fmtTime(secondStartMin),
    joinTime: fmtTime(secondStartMin),
    earlyWorkers: fpWkPre,
    wkPre: fpWkPre,
    wkPack: fpWkPack,
    wkPackAvailable,
    yPre: fpYPre,
    yCrush: fpYCrush,
    pPre: fpPPre,
    pCrush: fpPCrush,
    pPackEa: fpPPackEa,
    productInfo: info,
  };
}

// 다중 작업 종합 시뮬: 순서대로 두 시뮬 실행
function tttSimulateDual(inp, tankMode) {
  const order = document.getElementById('ttt-order')?.value || 'fc-first';
  const pkLines = parseInt(document.getElementById('ttt-pk-lines')?.value) || 2;

  if (order === 'fc-first') {
    const sim1 = tttSimulate(inp, tankMode);  // FC 먼저
    const inp2 = tttBuildSecondInp(inp, sim1);
    const sim2 = tttSimulate(inp2, tankMode);
    return { sim1, sim2, inp1: inp, inp2, order, pkLines };
  } else {
    // 두 번째 먼저: 두 번째를 첫째 위치로 보내고, FC를 두 번째 위치로
    // 임시로 첫째 인풋을 비-FC 기본 inp로 만들고, FC inp를 둘째에 둠
    // 단순화: order='other-first'면 tttBuildSecondInp 로직을 반대로
    const otherFirstInp = tttBuildOtherFirstInp(inp);
    const sim1 = tttSimulate(otherFirstInp, tankMode);
    const fcSecondInp = tttBuildFCSecondInp(inp, sim1);
    const sim2 = tttSimulate(fcSecondInp, tankMode);
    return { sim1, sim2, inp1: otherFirstInp, inp2: fcSecondInp, order, pkLines };
  }
}

// other-first 케이스: 비-FC를 첫째로
function tttBuildOtherFirstInp(inp) {
  const meat2 = document.getElementById('ttt-meat2')?.value || 'trader';
  const kg2 = parseFloat(document.getElementById('ttt-kg2')?.value) || 500;
  const info = TTT_PRODUCT_INFO[meat2] || TTT_PRODUCT_INFO['trader'];

  const fpYPre    = parseFloat(document.getElementById('ttt-fp-y-pre')?.value)    || TTT_AUTO_OTHER.yPre.val;
  const fpYCrush  = parseFloat(document.getElementById('ttt-fp-y-crush')?.value)  || TTT_AUTO_OTHER.yCrush.val;
  const fpPPre    = parseFloat(document.getElementById('ttt-fp-p-pre')?.value)    || TTT_AUTO_OTHER.pPre.val;
  const fpPCrush  = parseFloat(document.getElementById('ttt-fp-p-crush')?.value)  || TTT_AUTO_OTHER.pCrush.val;
  const fpPPackEa = parseFloat(document.getElementById('ttt-fp-p-pack')?.value)   || TTT_AUTO_OTHER.pPackEa.val;
  const fpWkPre   = parseInt(document.getElementById('ttt-fp-wk-pre')?.value)     || inp.wkPre;
  const fpWkPack  = parseInt(document.getElementById('ttt-fp-wk-pack')?.value)    || inp.wkPack;
  // FP 듀얼 가능 제품(maxLines=2)이면 가용 인원 14명 표시 → 듀얼 가동
  const dualPossible = (info.maxLines || 1) >= 2;
  const wkPackAvailable = dualPossible ? Math.max(fpWkPack, 14) : fpWkPack;

  return {
    ...inp,
    meatType: '우둔',
    meatKg: kg2,
    wkPre: fpWkPre,
    wkPack: fpWkPack,
    wkPackAvailable,
    earlyWorkers: fpWkPre,
    yPre: fpYPre,
    yCrush: fpYCrush,
    pPre: fpPPre,
    pCrush: fpPCrush,
    pPackEa: fpPPackEa,
    productInfo: info,
  };
}

// other-first 케이스: FC를 둘째로 (첫째 비-FC 종료 후)
function tttBuildFCSecondInp(inp, firstSim) {
  const secondStartMin = firstSim.preEndMin;
  const fmtTime = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  return {
    ...inp,
    startTime: fmtTime(secondStartMin),
    joinTime: fmtTime(secondStartMin),
    earlyWorkers: inp.wkPre,
    productInfo: TTT_PRODUCT_INFO['fc'],
  };
}

// 동시 작업 토글 상태 확인
function tttIsDualMode() {
  return document.getElementById('ttt-dual-enabled')?.checked === true;
}

// ── 인원 운용 슬롯 자동 ─────────────────────────────────
function tttPlanSlots(inp, sim) {
  const total = inp.totalWorkers;
  const mgr = inp.mgrWorkers;
  const early = inp.earlyWorkers;
  const slots = [];
  const LUNCH1_S = 11*60+30;
  const preEndedBeforeLunch = sim.preEndMin <= LUNCH1_S;

  // 슬롯 1: 조출~관리자 출근
  const mgrTime = tttToMin(inp.mgrTime);
  if (mgrTime > sim.startMin) {
    slots.push({
      range: `${tttFmt(sim.startMin)}~${inp.mgrTime}`,
      cells: { 전처리: early },
      sum: early,
    });
  }
  // 슬롯 2: 관리자 출근~한국인 합류
  if (sim.joinMin > mgrTime) {
    slots.push({
      range: `${inp.mgrTime}~${inp.joinTime}`,
      cells: { 전처리: early, 관리: mgr },
      sum: early + mgr,
    });
  }
  // 슬롯 3: 한국인 합류~점심 1차 (전처리 끝 시각 기준으로 분리)
  const remainPeak1 = total - inp.wkPre - mgr;
  const settingDefault = 3;
  const outerPack1 = Math.max(0, remainPeak1 - settingDefault);
  const joinMin = tttToMin(inp.joinTime);

  if (sim.preEndMin > joinMin && sim.preEndMin < LUNCH1_S) {
    slots.push({
      range: `${inp.joinTime}~${tttFmt(sim.preEndMin)}`,
      cells: { 전처리: inp.wkPre, 외포장: outerPack1, 세팅: Math.min(settingDefault, remainPeak1), 관리: mgr },
      sum: total,
    });
    const crushOnlyNow = Math.max(0, total - inp.wkPre - inp.wkPack - inp.wkTrans - mgr);
    const restNow = total - crushOnlyNow - mgr;
    slots.push({
      range: `${tttFmt(sim.preEndMin)}~11:30`,
      cells: { 파쇄: crushOnlyNow, 외포장: restNow, 관리: mgr },
      sum: total,
    });
  } else {
    slots.push({
      range: `${inp.joinTime}~11:30`,
      cells: { 전처리: inp.wkPre, 외포장: outerPack1, 세팅: Math.min(settingDefault, remainPeak1), 관리: mgr },
      sum: total,
    });
  }

  // 슬롯 4·5: 점심 반반 (total/2씩)
  const half1 = Math.ceil(total / 2);
  const half2 = total - half1;
  slots.push({
    range: `11:30~12:30`,
    cells: { 파쇄: total - half1 - 1, 점심: half1, 관리: 1 },
    sum: total,
  });
  slots.push({
    range: `12:30~13:30`,
    cells: { 파쇄: total - half2 - 1, 점심: half2, 관리: 1 },
    sum: total,
  });

  // 슬롯 6: 풀가동 (13:30~내포장종료)
  slots.push({
    range: `13:30~${tttFmt(sim.packEndMin)}`,
    cells: {
      파쇄: inp.wkPackPeak,
      내포장: inp.wkPack,
      이송: inp.wkTrans,
      ...(inp.wkLeftover > 0 ? { 외포장: inp.wkLeftover } : {}),
      관리: mgr,
    },
    sum: total,
  });
  // 슬롯 7: 내포장 종료 = 그날 작업 끝 (인원 표시 X)
  // 청소 슬롯 제거 (사용자분: '내포장 종료하면 그냥 인원은 없다고 보면 됨')

  return slots;
}

function tttPlanNarrative(inp, sim, slots) {
  const total = inp.totalWorkers;
  const lines = [];
  lines.push(`<strong>${tttFmt(sim.startMin)} (조출)</strong> · 외국인 ${inp.earlyWorkers}명 전처리 시작`);
  lines.push(`<strong>${inp.mgrTime}</strong> · 관리자 ${inp.mgrWorkers}명 출근 (전처리는 그대로 ${inp.earlyWorkers}명)`);
  if (inp.wkPre > inp.earlyWorkers) {
    const hanCnt = inp.wkPre - inp.earlyWorkers;
    lines.push(`<strong>${inp.joinTime}</strong> · 한국인 ${hanCnt}명 합류 → 전처리 ${inp.wkPre}명 가동 + 외포장·세팅 병행 (${total}명 풀가동)`);
  } else {
    lines.push(`<strong>${inp.joinTime}</strong> · 한국인 합류 없음 (전처리 ${inp.earlyWorkers}명 유지) + 외포장·세팅 병행`);
  }
  lines.push(`<strong>${tttFmt(sim.crushStartMin)}</strong> · 자숙 1호 출하 → <strong style="color:#BA7517">파쇄 ${inp.wkCrush}명 투입 시작</strong>`);
  const half1n = Math.ceil(total / 2);
  const half2n = total - half1n;
  lines.push(`<strong>11:30~12:30</strong> · 점심 1차 ${half1n}명 · 작업 ${total - half1n - 1}명 파쇄 + 관리 1명`);
  lines.push(`<strong>12:30~13:30</strong> · 점심 2차 ${half2n}명 · 작업 ${total - half2n - 1}명 파쇄 + 관리 1명`);
  lines.push(`<strong>13:30~${tttFmt(sim.packEndMin)}</strong> · <strong style="color:#7F77DD">파쇄 ${inp.wkPackPeak}명 + 내포장 ${inp.wkPack}명 + 이송 ${inp.wkTrans}명 풀가동</strong>`);
  lines.push(`<strong>${tttFmt(sim.packEndMin)}</strong> · 내포장 종료 (그날 작업 끝)`);
  lines.push(`<strong>레토르트</strong> · ${tttFmt(sim.retortStartMin)} 시작 · ${sim.retortCycles}회차 · 최종 ${tttFmt(sim.retortEndMin)}`);
  return lines.join('<br>');
}

// ── 메인 렌더링 ──────────────────────────────────────────
function tttRender() {
  let inp = tttGetInputs();
  const dualMode = tttIsDualMode();
  let dualResult = null;  // {sim1, sim2, inp1, inp2, order, pkLines}
  if (dualMode) {
    // 다중 모드: 첫째 sim을 tttRender의 메인 sim으로 사용 (기존 path 재활용)
    // 둘째 sim은 결과 박스 아래에 별도 표시
    // tankMode는 사용자가 클릭한 게 있으면 그것, 없으면 일단 'A'로 시뮬해서 best 선정
    // (best 선정 자체는 첫째 기준)
    const userMode = window.tttSelectedTankMode || null;
    if (userMode) {
      dualResult = tttSimulateDual(inp, userMode);
    } else {
      // 3 mode 다 시뮬해서 best
      const dA = tttSimulateDual(inp, 'A');
      const dB = tttSimulateDual(inp, 'B');
      const dE = tttSimulateDual(inp, 'E');
      // dual best: 두 번째 sim retortEndMin 빠른 것 (전체 종료)
      const candidates = [['A',dA],['B',dB],['E',dE]];
      candidates.sort((a,b) => a[1].sim2.retortEndMin - b[1].sim2.retortEndMin);
      dualResult = candidates[0][1];
    }
    inp = dualResult.inp1;
  }

  // 자동 계산된 파쇄 인원을 입력란 영역에 표시
  const dispPeak = document.getElementById('ttt-crush-peak-display');
  const dispPre = document.getElementById('ttt-crush-pre-display');
  if (dispPeak) dispPeak.textContent = `풀가동: ${inp.wkPackPeak}명`;
  if (dispPre) dispPre.textContent = `점심후: ${inp.wkCrush}명`;

  if (!inp.meatKg || inp.meatKg <= 0) {
    document.getElementById('ttt-result').innerHTML = `
      <div style="background:var(--color-background-secondary);border-radius:12px;padding:30px;text-align:center;color:var(--color-text-secondary);font-size:13px">
        원육량을 입력해주세요
      </div>`;
    return;
  }
  // ★ 3가지 자숙 탱크 분배 방식 자동 시뮬 → 사용자가 선택하거나 베스트 자동
  const tankSimA = tttSimulate(inp, 'A');
  const tankSimB = tttSimulate(inp, 'B');
  const tankSimE = tttSimulate(inp, 'E');
  const tankResults = [
    { mode: 'A', name: '잔량 먼저 시작', desc: '작은 수량 1호 → 800kg씩 나머지 (자숙·파쇄 빨리)', sim: tankSimA },
    { mode: 'B', name: 'N등분 균등', desc: '총량 ÷ 탱크수 = 모든 탱크 동일량', sim: tankSimB },
    { mode: 'E', name: '1호 작게 빨리시작', desc: '1호 510kg(외국인 1.5h) + 나머지 균등', sim: tankSimE },
  ];
  // 베스트 (레토르트 종료 빠른 순) — 정렬은 표에 차이 표시용
  const tankBest = [...tankResults].sort((a, b) => a.sim.retortEndMin - b.sim.retortEndMin)[0];
  // 사용자가 클릭한 모드 있으면 그것 사용, 없으면 베스트
  const userTankMode = window.tttSelectedTankMode || null;
  const tankSelected = userTankMode
    ? tankResults.find(r => r.mode === userTankMode) || tankBest
    : tankBest;
  const sim = tankSelected.sim;
  const slots = tttPlanSlots(inp, sim);
  const narrative = tttPlanNarrative(inp, sim, slots);

  const conclusion = `
    <div style="background:linear-gradient(135deg,#E6F1FB 0%,#f3f9fd 100%);border:1px solid #185FA5;border-radius:12px;padding:18px 22px;margin-bottom:16px">
      <div style="font-size:11px;color:#185FA5;font-weight:600;letter-spacing:0.5px;margin-bottom:6px">📊 데이터 기반 분석 결과 · 자숙 분배 방식 ${tankSelected.mode} (${tankSelected.name})${tankSelected.mode===tankBest.mode?' ★ 베스트':' — 사용자 선택'}</div>
      <div style="font-size:19px;font-weight:600;color:var(--color-text-primary);margin-bottom:6px">
        ${inp.meatType} ${inp.meatKg.toLocaleString()}kg → 약 <span style="color:#0F6E56">${sim.pouches.toLocaleString()}개</span> 생산 ·
        <strong style="color:#185FA5">${tttFmt(sim.packEndMin)} 종료</strong>
      </div>
      <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.6">
        시작 ${inp.startTime} · 총 ${tttDur(sim.packEndMin - sim.startMin)} · 내포장 종료 ${tttFmt(sim.packEndMin)} · 레토르트 최종 ${tttFmt(sim.retortEndMin)} (${sim.retortCycles}회차)
      </div>
    </div>`;

  const planBox = `
    <div style="background:#FFF7ED;border:1px solid #BA7517;border-radius:12px;padding:16px 20px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:600;color:#BA7517;margin-bottom:10px">👥 인원 운용 전략 (총 ${inp.totalWorkers}명)</div>
      <div style="font-size:12px;color:var(--color-text-primary);line-height:1.85">${narrative}</div>
    </div>`;

  // 공정 타임라인 SVG
  const tlMin = sim.startMin;
  const tlMax = Math.max(sim.retortEndMin, sim.packEndMin) + 30;
  const span = Math.max(1, tlMax - tlMin);  // span=0 방지 (xPos -Infinity 방지)
  const SVG_W = 800, LEFT = 100, RIGHT = 780;
  const xPos = m => {
    if (typeof m !== 'number' || !isFinite(m)) return LEFT;  // 방어: undefined/NaN/Infinity → LEFT
    return LEFT + (m - tlMin) / span * (RIGHT - LEFT);
  };
  let ticks = '', grid = '';
  for (let h = Math.floor(tlMin/60); h <= Math.ceil(tlMax/60); h++) {
    const x = xPos(h*60);
    if (x >= LEFT && x <= RIGHT + 10) {
      ticks += `<text x="${x}" y="20" text-anchor="middle" font-size="11" fill="var(--color-text-secondary)">${String(h%24).padStart(2,'0')}</text>`;
      grid += `<line x1="${x}" y1="28" x2="${x}" y2="380" stroke="#e5e3da" stroke-width="0.5" stroke-dasharray="2 3"/>`;
    }
  }

  // 점심 영역 음영
  const LUNCH1_S = 11*60+30, LUNCH1_E = 12*60+30, LUNCH2_E = 13*60+30;
  const lunchBg = `
    <rect x="${xPos(LUNCH1_S)}" y="28" width="${xPos(LUNCH1_E)-xPos(LUNCH1_S)}" height="999" fill="#FFF7ED" opacity="0.6"/>
    <rect x="${xPos(LUNCH1_E)}" y="28" width="${xPos(LUNCH2_E)-xPos(LUNCH1_E)}" height="999" fill="#FFF7ED" opacity="0.4"/>`;

  // 분할 막대 함수: 호버 데이터 포함
  const segBar = (y, h, s, e, color, txt, tipTitle, tipInfo, opts={}) => {
    const x1 = xPos(s), x2 = xPos(e);
    const w = Math.max(x2-x1, 2);
    const fillOp = opts.fillOpacity || 1;
    const stroke = opts.stroke || 'none';
    const strokeW = opts.strokeWidth || 0;
    const dash = opts.dash || '';
    const fontSize = opts.fontSize || 10;
    const fontWeight = opts.fontWeight || 600;
    return `<g class="ttt-bar" data-tip-title="${tipTitle}" data-tip-info="${tipInfo}">
      <rect x="${x1}" y="${y}" width="${w}" height="${h}" rx="3" fill="${color}" fill-opacity="${fillOp}" stroke="${stroke}" stroke-width="${strokeW}" stroke-dasharray="${dash}"/>
      ${txt && w > 30 ? `<text x="${(x1+x2)/2}" y="${y+h/2+4}" text-anchor="middle" font-size="${fontSize}" fill="#fff" font-weight="${fontWeight}" pointer-events="none">${txt}</text>` : ''}
    </g>`;
  };
  const rowLabel = (y, h, label) => `<text x="${LEFT-8}" y="${y+h/2+4}" text-anchor="end" font-size="12" fill="var(--color-text-secondary)" font-weight="500">${label}</text>`;

  let bars = '';
  let yCursor = 36;
  const ROW_H = 28;
  const WAGON_H = 24;
  const BAR_H = 26;

  // ── 전처리 (2분할: Phase1 / Phase2) ──
  bars += rowLabel(yCursor, BAR_H, '전처리');
  // Phase 1: startMin ~ joinMin (외국인)
  if (sim.joinMin > sim.startMin) {
    const p1Kg = Math.round(sim.phase1Kg);
    bars += segBar(yCursor, BAR_H, sim.startMin, Math.min(sim.joinMin, sim.preEndMin), '#185FA5',
      `${inp.earlyWorkers}명 · ${p1Kg.toLocaleString()}kg`,
      `전처리 Phase 1`,
      `시각: ${tttFmt(sim.startMin)}~${tttFmt(Math.min(sim.joinMin, sim.preEndMin))}|인원: 외국인 ${inp.earlyWorkers}명|처리량: ${p1Kg.toLocaleString()} kg|계산: ${inp.pPre} × ${inp.earlyWorkers} × ${(sim.phase1Min/60).toFixed(1)}h = ${p1Kg.toLocaleString()}kg`,
      {fillOpacity: 0.7});
  }
  // Phase 2: joinMin ~ preEndMin (한국인 합류)
  if (sim.preEndMin > sim.joinMin) {
    const p2Kg = Math.max(0, Math.round(sim.preIn - sim.phase1Kg));
    bars += segBar(yCursor, BAR_H, sim.joinMin, sim.preEndMin, '#185FA5',
      `${inp.wkPre}명 · ${p2Kg.toLocaleString()}kg`,
      `전처리 Phase 2`,
      `시각: ${tttFmt(sim.joinMin)}~${tttFmt(sim.preEndMin)}|인원: ${inp.wkPre}명 (한국인 합류 후)|처리량: ${p2Kg.toLocaleString()} kg|계산: 잔량 ${p2Kg.toLocaleString()}kg ÷ (${inp.pPre}×${inp.wkPre}) × 60 = ${(sim.preEndMin-sim.joinMin)}분`);
  }
  // 막대 끝 라벨: 수율·생산성
  bars += `<text x="${xPos(sim.preEndMin) + 6}" y="${yCursor + BAR_H/2 + 4}" text-anchor="start" font-size="10" fill="#185FA5" font-weight="600">${inp.yPre}% · ${inp.pPre}kg/인시</text>`;
  yCursor += ROW_H;

  // ── 자숙 (각 호별 + 와건) ──
  sim.tankInTimes.forEach((t, i) => {
    const isLast = i === sim.tankInTimes.length - 1;
    const lastTankKg = sim.tankKgs[i];
    const tankOutKg = lastTankKg * sim.cookYield / 100;
    bars += rowLabel(yCursor, BAR_H, `자숙 ${i+1}호`);
    bars += segBar(yCursor, BAR_H, t, sim.tankOutTimes[i], '#0F6E56',
      `${Math.round(lastTankKg)}kg → ${Math.round(tankOutKg)}kg`,
      `자숙 ${i+1}호`,
      `투입: ${tttFmt(t)}|자숙 종료: ${tttFmt(sim.tankOutTimes[i])}|와건 종료: ${tttFmt(sim.wagonEndTimes[i])}|용량: ${Math.round(lastTankKg)}kg|산출: ${Math.round(tankOutKg)}kg (수율 ${sim.cookYield}%)|사이클: 4h + 와건 30분`);
    // 와건 (자숙 종료 ~ 와건 종료)
    bars += segBar(yCursor, BAR_H, sim.tankOutTimes[i], sim.wagonEndTimes[i], '#D85A30',
      ``,
      `자숙 ${i+1}호 와건`,
      `시각: ${tttFmt(sim.tankOutTimes[i])}~${tttFmt(sim.wagonEndTimes[i])} (30분)|자숙 후 냉각|이후 파쇄 라인 투입`);
    // 마지막 호: 원육 기준 누적 수율 라벨 (전체 자숙 끝)
    if (isLast) {
      const cookBaseYield = (inp.yPre * sim.cookYield) / 100;
      bars += `<text x="${xPos(sim.wagonEndTimes[i]) + 6}" y="${yCursor + BAR_H/2 + 4}" text-anchor="start" font-size="10" fill="#0F6E56" font-weight="600">${cookBaseYield.toFixed(1)}%</text>`;
    }
    yCursor += ROW_H;
  });

  // ── 파쇄 (자숙 호별 분할) ──
  bars += rowLabel(yCursor, BAR_H, '파쇄');
  // 호별 색상 명확히 다르게 (구분 잘 보이도록)
  const tankCrushColors = ['#BA7517', '#D89A3D', '#8B5A0F', '#E8B05A'];
  sim.tankCrushTimes.forEach((tc, i) => {
    const color = tankCrushColors[i % tankCrushColors.length];
    const durMin = tc.end - tc.start;
    // 막대 사이 1px gap (다음 호 시작 1분 비움 = 시각적 구분)
    const isLast = i === sim.tankCrushTimes.length - 1;
    const adjustedEnd = isLast ? tc.end : tc.end - 1;
    const crossLunch1 = tc.start < LUNCH1_S && tc.end > LUNCH1_S;
    const crossLunch2 = tc.start < LUNCH1_E && tc.end > LUNCH1_E;
    const crossPeak = tc.start < LUNCH2_E && tc.end > LUNCH2_E;
    const tCrushOnly = Math.max(0, inp.wkPackPeak - inp.wkPre);
    const tHalf1 = Math.ceil(inp.totalWorkers / 2);
    const tHalf2 = inp.totalWorkers - tHalf1;
    const segmentInfo = [];
    if (tc.start < LUNCH1_S) segmentInfo.push(`${tttFmt(tc.start)}~${tttFmt(Math.min(LUNCH1_S, tc.end))}: ${tCrushOnly}명`);
    if (crossLunch1 || (tc.start >= LUNCH1_S && tc.start < LUNCH1_E)) {
      const segS = Math.max(tc.start, LUNCH1_S);
      const segE = Math.min(tc.end, LUNCH1_E);
      if (segE > segS) segmentInfo.push(`${tttFmt(segS)}~${tttFmt(segE)}: ${inp.totalWorkers - tHalf1 - 1}명 파쇄 (점심1차 ${tHalf1}명)`);
    }
    if (crossLunch2 || (tc.start >= LUNCH1_E && tc.start < LUNCH2_E)) {
      const segS = Math.max(tc.start, LUNCH1_E);
      const segE = Math.min(tc.end, LUNCH2_E);
      if (segE > segS) segmentInfo.push(`${tttFmt(segS)}~${tttFmt(segE)}: ${inp.totalWorkers - tHalf2 - 1}명 파쇄 (점심2차 ${tHalf2}명)`);
    }
    if (tc.end > LUNCH2_E) {
      const segS = Math.max(tc.start, LUNCH2_E);
      segmentInfo.push(`${tttFmt(segS)}~${tttFmt(tc.end)}: ${inp.wkPackPeak}명 풀가동`);
    }
    // 막대 너비에 따라 텍스트 표시 분기
    // 좁은 막대(< ~50px) = 호 번호만, 넓은 막대 = 호 + kg
    const widthPx = xPos(adjustedEnd) - xPos(tc.start);
    const label = widthPx >= 70
      ? `${tc.idx}호 ${Math.round(tc.kg)}kg`
      : widthPx >= 30
        ? `${tc.idx}호`
        : '';
    bars += segBar(yCursor, BAR_H, tc.start, adjustedEnd, color,
      label,
      `자숙 ${tc.idx}호분 파쇄`,
      `자숙 ${tc.idx}호 산출: ${Math.round(tc.kg)}kg|시각: ${tttFmt(tc.start)}~${tttFmt(tc.end)} (${durMin}분)|와건 종료: ${tttFmt(sim.wagonEndTimes[i])}|${segmentInfo.join('|')}`,
      {fillOpacity: 0.9, stroke: '#fff', strokeWidth: 1});
  });
  // 막대 끝 라벨: 원육 기준 누적 수율 · 생산성
  // 원육 → 전처리(yPre) → 자숙(cookYield) → 파쇄(yCrush)
  const crushBaseYield = (inp.yPre * sim.cookYield * inp.yCrush) / 10000;
  bars += `<text x="${xPos(sim.crushEndMin) + 6}" y="${yCursor + BAR_H/2 + 4}" text-anchor="start" font-size="10" fill="#BA7517" font-weight="600">${crushBaseYield.toFixed(1)}% · ${inp.pCrush}kg/인시</text>`;
  yCursor += ROW_H;

  // ── 내포장 (호기별 분할) ──
  // maxLines=2 제품 + 인원 충분: 호기 2개로 분할
  // maxLines=1 또는 인원 부족: 호기 1개
  const availLines = (sim.productInfo && sim.productInfo.availableLines) || [2];
  const usedMaxLines = sim.maxLines || 1;
  const eaPerLine = sim.eaPerMinPerLine || inp.pPackEa;
  const packBaseYield = (inp.yPre * sim.cookYield * inp.yCrush * TTT_PACK_YIELD) / 1000000;

  for (let lineIdx = 0; lineIdx < usedMaxLines; lineIdx++) {
    const lineNum = availLines[lineIdx] || (lineIdx + 1);
    const segs = (sim.lineSegments && sim.lineSegments[lineIdx + 1]) || [];
    bars += rowLabel(yCursor, BAR_H, `내포장 ${lineNum}호기`);
    segs.forEach(seg => {
      const segMin = seg.end - seg.start;
      const segEa = Math.round(segMin * eaPerLine);
      bars += segBar(yCursor, BAR_H, seg.start, seg.end, '#7F77DD',
        `${inp.wkPack||6}명 · ${eaPerLine}EA/분`,
        `내포장 ${lineNum}호기`,
        `시각: ${tttFmt(seg.start)}~${tttFmt(seg.end)} (${segMin}분)|속도: ${eaPerLine} EA/분|이 호기 산출: ${segEa.toLocaleString()} EA`);
    });
    if (segs.length > 0 && lineIdx === 0) {
      const lastEnd = segs[segs.length - 1].end;
      bars += `<text x="${xPos(lastEnd) + 6}" y="${yCursor + BAR_H/2 + 4}" text-anchor="start" font-size="10" fill="#7F77DD" font-weight="600">${packBaseYield.toFixed(1)}%</text>`;
    }
    yCursor += ROW_H;
  }

  // ── 레토르트 (각 회차별 - EA 균등 분배) ──
  for (let i = 0; i < sim.retortCycles; i++) {
    const s = sim.retortStartTimes[i];
    const e = sim.retortEndTimes[i];
    const isLast = i === sim.retortCycles - 1;
    const cycleEa = sim.batchEa[i];
    const cycleCarts = sim.batchCarts[i];
    bars += rowLabel(yCursor, BAR_H-2, `레토르트 ${i+1}${isLast ? ' ★' : ''}`);
    bars += segBar(yCursor, BAR_H-2, s, e, '#A32D2D',
      `${cycleEa} EA · ${cycleCarts}대차`,
      `레토르트 ${i+1}회차${isLast ? ' (마지막)' : ''}`,
      `시각: ${tttFmt(s)}~${tttFmt(e)}|EA: ${cycleEa}개 (${cycleCarts}대차)|사이클: 2.5h|EA 균등 분배 (전체 ${sim.pouches}EA ÷ ${sim.retortCycles}회차)${isLast ? '|★ 내포장 종료('+tttFmt(sim.packEndMin)+') 후 시작' : ''}`,
      isLast ? {stroke: '#7a1a1a', strokeWidth: 1.5} : {});
    yCursor += ROW_H;
  }

  // ── 점심 (1차 + 2차) ──
  bars += rowLabel(yCursor, BAR_H, '점심');
  const _th1 = Math.ceil(inp.totalWorkers / 2);
  const _th2 = inp.totalWorkers - _th1;
  bars += segBar(yCursor, BAR_H, LUNCH1_S, LUNCH1_E, '#888780',
    `1차 ${_th1}명`,
    '점심 1차',
    `시각: 11:30~12:30|인원: ${_th1}명 점심|작업: ${inp.totalWorkers - _th1 - 1}명 파쇄 + 관리 1명`,
    {fillOpacity: 0.7});
  bars += segBar(yCursor, BAR_H, LUNCH1_E, LUNCH2_E, '#888780',
    `2차 ${_th2}명`,
    '점심 2차',
    `시각: 12:30~13:30|인원: ${_th2}명 점심|작업: ${inp.totalWorkers - _th2 - 1}명 파쇄 + 관리 1명|13:30 전원 복귀 → 풀가동`,
    {fillOpacity: 0.85});
  yCursor += ROW_H;

  // 점선 (내포장 종료 + 전체 종료)
  const lineBottom = yCursor + 4;
  bars += `
    <line x1="${xPos(sim.packEndMin)}" y1="36" x2="${xPos(sim.packEndMin)}" y2="${lineBottom}" stroke="#7F77DD" stroke-width="1" stroke-dasharray="4 3"/>
    <text x="${xPos(sim.packEndMin)}" y="${lineBottom + 14}" text-anchor="middle" font-size="11" fill="#7F77DD" font-weight="700">${tttFmt(sim.packEndMin)} 내포장</text>
    <line x1="${xPos(sim.retortEndMin)}" y1="36" x2="${xPos(sim.retortEndMin)}" y2="${lineBottom}" stroke="#A32D2D" stroke-width="1.5" stroke-dasharray="5 3"/>
    <text x="${xPos(sim.retortEndMin)}" y="${lineBottom + 28}" text-anchor="middle" font-size="11" fill="#A32D2D" font-weight="700">${tttFmt(sim.retortEndMin)} 종료</text>`;
  const svgH = lineBottom + 38;

  const timelineSvg = `
    <style>
      .ttt-bar { cursor:pointer; transition:filter 0.15s; }
      .ttt-bar:hover rect { filter:brightness(1.15); stroke:#000 !important; stroke-width:1 !important; stroke-dasharray:none !important; }
      .ttt-tip { position:fixed; background:#222; color:#fff; padding:10px 14px; border-radius:6px; font-size:12px; line-height:1.7; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:9999; pointer-events:none; max-width:340px; display:none; }
      .ttt-tip-title { color:#FFD27A; font-weight:700; margin-bottom:4px; }
      .ttt-cell { transition:background 0.1s; }
      .ttt-cell:hover { background:#FFF5CC !important; cursor:default; }
    </style>
    <svg width="100%" viewBox="0 0 ${SVG_W} ${svgH}" role="img" id="tttTimelineSvg">
      ${lunchBg}${ticks}${grid}${bars}
    </svg>
    <div id="tttTip" class="ttt-tip"></div>`;

  // 시간대별 인원 활용 표 (시안 3 + 격자 + 호버)
  const wkHeads = ['전처리','파쇄','내포장','이송','외포장','세팅','청소','점심','관리'];
  const wkColors = ['#185FA5','#BA7517','#7F77DD','#534AB7','#1D9E75','#EF9F27','#888780','#BA7517','#5F5E5A'];
  const slotsRows = slots.map(slot => ({
    range: slot.range,
    cells: wkHeads.map(h => slot.cells[h] || 0),
    sum: slot.sum,
    isFull: slot.sum === inp.totalWorkers,
  }));
  const wkTbl = `
    <div style="border:2px solid #185FA5;border-radius:6px;flex:1;display:flex;overflow:hidden">
    <table style="width:100%;height:100%;border-collapse:collapse;font-size:13px;background:#fff;table-layout:fixed">
      <colgroup>
        ${Array(11).fill(0).map(() => `<col style="width:9.09%">`).join('')}
      </colgroup>
      <thead>
        <tr style="background:linear-gradient(135deg,#185FA5,#1a6db5);color:#fff;height:36px">
          <th style="padding:0 4px;font-weight:700;text-align:center;border:1px solid #0d4a8a;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">시간대</th>
          ${wkHeads.map((h,i) => `<th style="padding:0 2px;font-weight:700;border:1px solid #0d4a8a;font-size:12px;text-align:center">${h}</th>`).join('')}
          <th style="padding:0 4px;font-weight:700;background:#0d4a8a;border:1px solid #0d4a8a;font-size:12px;text-align:center">합계</th>
        </tr>
      </thead>
      <tbody>
      ${slotsRows.map((r, idx) => {
        const stripe = idx % 2 === 1 ? 'background:#f7f9fc' : '';
        // 모든 행 동일 높이 = 100% / 행수 (tbody 안에서)
        const rowH = `height:${(100/slotsRows.length).toFixed(2)}%`;
        return `<tr style="${stripe};${rowH}">
          <td class="ttt-cell" style="padding:6px 2px;font-weight:600;border:1px solid #ddd;font-size:11px;vertical-align:middle;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.range}</td>
          ${r.cells.map((v, ci) => {
            const isZero = v === 0;
            const color = isZero ? '#ccc' : wkColors[ci];
            const fw = isZero ? 'normal' : (v >= 10 ? 700 : 600);
            return `<td class="ttt-cell" style="padding:6px 2px;text-align:center;border:1px solid #ddd;color:${color};font-weight:${fw};font-size:13px;vertical-align:middle">${v||'·'}</td>`;
          }).join('')}
          <td class="ttt-cell" style="padding:6px 2px;text-align:center;font-weight:700;color:${r.isFull?'#0F6E56':'#999'};font-size:13px;border:1px solid #ddd;vertical-align:middle">${r.sum}${r.isFull?' ✓':''}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
    </div>`;

  // 좌(타임라인) + 우(인원표) - 1:1 비율, 세로 같이 늘어남
  // SVG의 viewBox 높이가 좌측 카드 높이를 결정 → 우측 카드는 align-items:stretch로 따라감
  const svgRatio = svgH / SVG_W;  // SVG 높이/너비 비율
  const splitView = `
    <style>
      @media (max-width: 900px) { #ttt-split { grid-template-columns: 1fr !important; } }
      #tttTimelineSvg { display:block; width:100%; height:auto; }
    </style>
    <div id="ttt-split" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;align-items:stretch">
      <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:14px;min-width:0;display:flex;flex-direction:column">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;flex-shrink:0">📋 공정 타임라인</div>
        <div style="flex:1;display:flex;align-items:flex-start;min-height:0">${timelineSvg}</div>
      </div>
      <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:14px;min-width:0;display:flex;flex-direction:column">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;flex-shrink:0">👥 시간대별 인원 활용</div>
        <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:8px;flex-shrink:0">정원 ${inp.totalWorkers}명 · 합계 일치 ✓</div>
        <div style="flex:1;display:flex;flex-direction:column;min-height:0">${wkTbl}</div>
      </div>
    </div>`;

  // 공정별 현황 표 (수율·생산성 직접 수정 가능)
  const editYield = (id, val, autoVal, n) => `
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
      <input type="number" step="0.1" value="${val}" 
        oninput="document.getElementById('${id}').value=this.value;document.getElementById('${id}').dataset.userEdited='true';tttRender()"
        style="width:70px;height:26px;font-size:12px;text-align:right;padding:0 6px;border:0.5px solid var(--color-border-secondary);border-radius:4px;background:#fff">
      <div style="font-size:9px;color:var(--color-text-tertiary)">자동: ${autoVal}${n!==undefined?` (n=${n})`:''}</div>
    </div>`;
  const editProd = (id, val, unit, autoVal, n) => `
    <div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px">
      <div style="display:flex;align-items:center;gap:4px">
        <input type="number" step="0.1" value="${val}"
          oninput="document.getElementById('${id}').value=this.value;document.getElementById('${id}').dataset.userEdited='true';tttRender()"
          style="width:60px;height:26px;font-size:12px;text-align:right;padding:0 6px;border:0.5px solid var(--color-border-secondary);border-radius:4px;background:#fff">
        <span style="font-size:10px;color:var(--color-text-secondary)">${unit}</span>
      </div>
      <div style="font-size:9px;color:var(--color-text-tertiary)">자동: ${autoVal}${n!==undefined?` (n=${n})`:''}</div>
    </div>`;

  const procRows = [
    {
      p:'전처리',
      i:Math.round(sim.preIn), o:Math.round(sim.preOut),
      yEdit: editYield('ttt-y-pre', inp.yPre, TTT_AUTO.yPre.val, TTT_AUTO.yPre.n),
      prodEdit: editProd('ttt-p-pre', inp.pPre, 'kg/인시', TTT_AUTO.pPre.val, TTT_AUTO.pPre.n),
      h:sim.preHours.toFixed(1)+'h', w:`${inp.wkPre}명`,
      formula:`${Math.round(sim.preIn).toLocaleString()} ÷ (${inp.pPre} × ${inp.wkPre}) = ${sim.preHours.toFixed(2)}h`,
    },
    {
      p:'자숙',
      i:Math.round(sim.cookIn), o:Math.round(sim.cookOut),
      yEdit: `<span style="font-size:11px;color:var(--color-text-secondary)">${sim.cookYield.toFixed(1)}% (고정)</span>`,
      prodEdit: `<span style="font-size:10px;color:var(--color-text-tertiary)">4h × ${sim.tankInTimes.length}탱크 (고정)</span>`,
      h:`${TTT_FIXED.cookHours*sim.tankInTimes.length}h (병렬)`, w:'2명',
      formula:`탱크당 ${TTT_FIXED.tankKg}kg × ${sim.cookYield}% = ${Math.round(TTT_FIXED.tankKg*sim.cookYield/100)}kg/탱크`,
    },
    {
      p:'파쇄',
      i:Math.round(sim.crushIn), o:Math.round(sim.crushOut),
      yEdit: editYield('ttt-y-crush', inp.yCrush, TTT_AUTO.yCrush.val, TTT_AUTO.yCrush.n),
      prodEdit: editProd('ttt-p-crush', inp.pCrush, 'kg/인시', TTT_AUTO.pCrush.val, TTT_AUTO.pCrush.n),
      h:sim.crushHours.toFixed(1)+'h', w:`${inp.wkCrush}→${inp.wkPackPeak}명`,
      formula:`${Math.round(sim.crushIn).toLocaleString()} ÷ (${inp.pCrush} × ${inp.wkPackPeak}) = ${sim.crushHours.toFixed(2)}h`,
    },
    {
      p:'내포장',
      i:Math.round(sim.packIn), o:Math.round(sim.packOut),
      yEdit: `<span style="font-size:11px;color:var(--color-text-secondary)">${TTT_PACK_YIELD}% (고정)</span>`,
      prodEdit: editProd('ttt-p-pack', inp.pPackEa, 'EA/분', TTT_AUTO.pPackEa.val, TTT_AUTO.pPackEa.n),
      h:(sim.packMin/60).toFixed(1)+'h', w:`${inp.wkPack}명`,
      formula:`${sim.pouches.toLocaleString()}EA ÷ ${inp.pPackEa}EA/분 = ${Math.round(sim.packMin)}분`,
    },
    {
      p:'레토르트',
      i:sim.pouches+'EA', o:sim.pouches+'EA',
      yEdit: `<span style="font-size:11px;color:var(--color-text-secondary)">100% (고정)</span>`,
      prodEdit: `<span style="font-size:10px;color:var(--color-text-tertiary)">${TTT_FIXED.retortCycleMin/60}h × ${sim.retortCycles}회 (대차 8개)</span>`,
      h:`${(sim.retortCycles*TTT_FIXED.retortCycleMin/60).toFixed(1)}h (순차)`, w:'2명',
      formula:`${sim.pouches.toLocaleString()}EA ÷ 384EA/회 = ${sim.retortCycles}회차`,
    },
  ];
  const procTbl = `
    <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:16px">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">📐 공정별 현황 — 수율·생산성 직접 수정 가능</div>
      <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:12px">자동값(DB)이 채워져 있습니다. 입력칸 클릭해서 직접 수정하면 즉시 결과가 갱신됩니다.</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:0.5px solid var(--color-border-secondary);background:var(--color-background-secondary)">
            <th style="text-align:left;padding:10px 8px;font-weight:500">공정</th>
            <th style="text-align:right;padding:10px 8px;font-weight:500">투입</th>
            <th style="text-align:right;padding:10px 8px;font-weight:500">산출</th>
            <th style="text-align:right;padding:10px 8px;font-weight:500">수율 (수정)</th>
            <th style="text-align:left;padding:10px 8px;font-weight:500">생산성 (수정)</th>
            <th style="text-align:right;padding:10px 8px;font-weight:500">시간</th>
            <th style="text-align:right;padding:10px 8px;font-weight:500">인원</th>
            <th style="text-align:left;padding:10px 8px;font-weight:500;font-size:10px">계산 근거</th>
          </tr></thead>
          <tbody>${procRows.map(r => `
            <tr style="border-bottom:0.5px solid var(--color-border-tertiary)">
              <td style="padding:11px 8px;font-weight:500">${r.p}</td>
              <td style="padding:11px 8px;text-align:right">${typeof r.i === 'number' ? r.i.toLocaleString()+' kg' : r.i}</td>
              <td style="padding:11px 8px;text-align:right;font-weight:500">${typeof r.o === 'number' ? r.o.toLocaleString()+' kg' : r.o}</td>
              <td style="padding:8px;text-align:right">${r.yEdit}</td>
              <td style="padding:8px">${r.prodEdit}</td>
              <td style="padding:11px 8px;text-align:right">${r.h}</td>
              <td style="padding:11px 8px;text-align:right">${r.w}</td>
              <td style="padding:11px 8px;font-size:10px;color:var(--color-text-tertiary);font-family:monospace">${r.formula}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  // ── 공정별 "왜 저 시간인지" 설명 카드 ──────────────────
  const lastTankKg = TTT_FIXED.tankKg * sim.cookYield / 100;
  const lastTankCrushMin = Math.round(lastTankKg / (inp.pCrush * inp.wkPackPeak / 60));
  const lastPackEa = Math.round(lastTankKg * inp.yCrush / 100 / TTT_PACK_KG_PER_POUCH);
  const lastBatchPackMin = Math.round(lastPackEa / inp.pPackEa);

  // 인원 변화에 따라 시간이 어떻게 영향받는지 안내 (레토르트는 인원 무관)
  const whyCards = `
    <div style="margin-bottom:16px">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">📐 각 공정이 왜 그 시간인지</div>
      <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:10px">대표님이 어떤 막대 가리키셔도 즉답 가능 — 모든 숫자 추적</div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:8px">

        <!-- 전처리 -->
        <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-left:4px solid #185FA5;border-radius:8px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:0.5px dashed var(--color-border-tertiary)">
            <div><strong style="color:#185FA5;font-size:12px">전처리</strong>
            <span style="font-size:10.5px;color:var(--color-text-secondary);margin-left:6px">${tttFmt(sim.startMin)}~${tttFmt(sim.preEndMin)} · ${inp.earlyWorkers}→${inp.wkPre}명</span></div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${Math.round(sim.preIn).toLocaleString()} → ${Math.round(sim.preOut).toLocaleString()}kg</div>
          </div>
          <div style="font-size:11px;color:var(--color-text-secondary);line-height:1.6;font-family:monospace">
            🕐 ${tttFmt(sim.startMin)} 외국인 조출<br>
            P1 (${tttFmt(sim.startMin)}~${inp.joinTime}, ${inp.earlyWorkers}명): ${inp.pPre}×${inp.earlyWorkers}×${(sim.phase1Min/60).toFixed(0)}h = ${Math.round(sim.phase1Kg).toLocaleString()}kg<br>
            P2 (${inp.joinTime}~, ${inp.wkPre}명): 잔량 ${Math.max(0, Math.round(sim.preIn - sim.phase1Kg)).toLocaleString()}kg ÷ (${inp.pPre}×${inp.wkPre})×60 = ${Math.max(0, sim.preEndMin - sim.joinMin)}분<br>
            📊 ${inp.pPre} kg/인시 (자동 ${TTT_AUTO.pPre.val} · n=${TTT_AUTO.pPre.n})
          </div>
        </div>

        <!-- 자숙 -->
        <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-left:4px solid #0F6E56;border-radius:8px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:0.5px dashed var(--color-border-tertiary)">
            <div><strong style="color:#0F6E56;font-size:12px">자숙 (${sim.tankInTimes.length}탱크 병렬)</strong>
            <span style="font-size:10.5px;color:var(--color-text-secondary);margin-left:6px">${tttFmt(sim.tankInTimes[0])}~${tttFmt(sim.wagonEndTimes[sim.wagonEndTimes.length-1])} · 2명</span></div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${Math.round(sim.cookIn).toLocaleString()} → ${Math.round(sim.cookOut).toLocaleString()}kg</div>
          </div>
          <div style="font-size:11px;color:var(--color-text-secondary);line-height:1.6;font-family:monospace">
            🔢 ${Math.round(sim.cookIn)} ÷ ${TTT_FIXED.tankKg} = ${(sim.cookIn/TTT_FIXED.tankKg).toFixed(2)} → ${sim.tankInTimes.length}탱크<br>
            ⏱ 4h + 와건 30분 (고정) · 수율 ${sim.cookYield}% (고정)<br>
            ${sim.tankInTimes.map((t, i) => `└ ${i+1}호 ${tttFmt(t)} → 와건 ${tttFmt(sim.wagonEndTimes[i])}`).join('<br>')}
          </div>
        </div>

        <!-- 파쇄 -->
        <div style="background:linear-gradient(to right,#FFF7ED 0%,#fffbf5 100%);border:1px solid #BA7517;border-radius:8px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:0.5px dashed rgba(186,117,23,0.3)">
            <div><strong style="color:#BA7517;font-size:12px">파쇄</strong>
            <span style="font-size:10.5px;color:var(--color-text-secondary);margin-left:6px">${tttFmt(sim.crushStartMin)}~${tttFmt(sim.crushEndMin)} · ${inp.wkCrush}→${inp.wkPackPeak}명</span></div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${Math.round(sim.crushIn).toLocaleString()} → ${Math.round(sim.crushOut).toLocaleString()}kg</div>
          </div>
          <div style="font-size:11px;color:var(--color-text-secondary);line-height:1.6;font-family:monospace">
            🕐 ${tttFmt(sim.crushStartMin)} = 자숙 1호 와건 종료<br>
            <strong>종료 ${tttFmt(sim.crushEndMin)} = 마지막 자숙 호 파쇄 처리 종료 (FIFO)</strong><br>
            참고 자체속도: ${Math.round(sim.crushIn)}kg ÷ (${inp.pCrush}×${inp.wkPackPeak}) = ${(sim.crushIn / (inp.pCrush*inp.wkPackPeak)).toFixed(2)}h → ${tttFmt(sim.crushSelfEndMin)}<br>
            참고 마지막 탱크 단독 처리: 와건 ${tttFmt(sim.wagonEndTimes[sim.wagonEndTimes.length-1])} + ${Math.round(sim.lastTankOutKg)}kg(${lastTankCrushMin}분) = ${tttFmt(sim.lastTankCrushEndMin)}<br>
            📊 ${inp.pCrush} kg/인시 (자동 ${TTT_AUTO.pCrush.val} · n=${TTT_AUTO.pCrush.n})
          </div>
        </div>

        <!-- 내포장 -->
        <div style="background:linear-gradient(to right,#F4F2FB 0%,#faf9fd 100%);border:1px solid #7F77DD;border-radius:8px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:0.5px dashed rgba(127,119,221,0.3)">
            <div><strong style="color:#7F77DD;font-size:12px">내포장</strong>
            <span style="font-size:10.5px;color:var(--color-text-secondary);margin-left:6px">${tttFmt(sim.packStartMin)}~${tttFmt(sim.packEndMin)} · ${inp.wkPack}명</span></div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${Math.round(sim.packIn).toLocaleString()}kg → ${sim.pouches.toLocaleString()}EA</div>
          </div>
          <div style="font-size:11px;color:var(--color-text-secondary);line-height:1.6;font-family:monospace">
            🕐 ${tttFmt(sim.packStartMin)} = 파쇄(${tttFmt(sim.crushStartMin)})+1h<br>
            <strong>종료 ${tttFmt(sim.packEndMin)} = max(둘 중 늦은):</strong><br>
            ① 자체: ${sim.pouches}EA ÷ ${inp.pPackEa}/분 = ${Math.round(sim.pouches / inp.pPackEa)}분 → ${tttFmt(sim.packSelfEndMin)}<br>
            ② 파쇄 종료 후 마지막 ${sim.lastTankPackEa}EA: ${tttFmt(sim.crushEndMin)}+${lastBatchPackMin}분 = ${tttFmt(sim.lastBatchPackEndMin)}<br>
            📊 ${inp.pPackEa} EA/분 — <strong style="color:#7F77DD">기계 1대 한도 (인원 무관)</strong>
          </div>
        </div>

        <!-- 레토르트 -->
        <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-left:4px solid #A32D2D;border-radius:8px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:6px;border-bottom:0.5px dashed var(--color-border-tertiary)">
            <div><strong style="color:#A32D2D;font-size:12px">레토르트 (${sim.retortCycles}회차)</strong>
            <span style="font-size:10.5px;color:var(--color-text-secondary);margin-left:6px">${tttFmt(sim.retortStartTimes[0])}~${tttFmt(sim.retortEndMin)} · 2명</span></div>
            <div style="font-size:10px;color:var(--color-text-tertiary)">${sim.pouches.toLocaleString()}EA</div>
          </div>
          <div style="font-size:11px;color:var(--color-text-secondary);line-height:1.6;font-family:monospace">
            🔢 ${sim.pouches} ÷ 384 = ${(sim.pouches/384).toFixed(2)} → ${sim.retortCycles}회차<br>
            ⏱ 2.5h 사이클 (설비 3대 + 대차 8개 한도)<br>
            <strong style="color:#A32D2D">★ 인원 늘려도 시간 안 변함 — 설비·내포장 속도(8 EA/분)가 진짜 병목</strong><br>
            ${sim.retortStartTimes.map((s, i) => {
              const e = sim.retortEndTimes[i];
              const isLast = i === sim.retortStartTimes.length - 1;
              return `└ ${i+1}회차 ${tttFmt(s)}~${tttFmt(e)}${isLast ? ' ★ 내포장 후' : ''}`;
            }).join('<br>')}
          </div>
        </div>

      </div>
    </div>`;

  // ── 분석 보고서 (숫자로 검증된 의사결정 근거) ──
  const dT = (a, b) => {
    const d = b - a;
    if (d === 0) return '동일';
    return d > 0 ? `+${d}분` : `${d}분`;
  };
  const tankReport = tankResults.map(r => {
    const isSelected = r.mode === tankSelected.mode;
    const isBest = r.mode === tankBest.mode;
    const diff = r.sim.retortEndMin - tankBest.sim.retortEndMin;
    const tankKgsStr = r.sim.tankKgs.map(k => Math.round(k)).join(', ');
    const bg = isSelected ? 'background:#E8F3DE;font-weight:600' : 'background:#fff';
    const cursor = 'cursor:pointer';
    return `<tr style="${bg};${cursor}" onclick="tttSelectTankMode('${r.mode}')" onmouseover="this.style.background='#FFF5CC'" onmouseout="this.style.background='${isSelected?'#E8F3DE':'#fff'}'">
      <td style="padding:8px 10px;border:1px solid #ddd;font-size:12px">
        ${isSelected?'👁 ':''}${isBest?'★ ':''}<strong>${r.mode}</strong> ${r.name}
      </td>
      <td style="padding:8px 10px;border:1px solid #ddd;font-size:11px;color:#666">[${tankKgsStr}]</td>
      <td style="padding:8px 10px;text-align:center;border:1px solid #ddd;font-size:12px">${tttFmt(r.sim.tankInTimes[0])}</td>
      <td style="padding:8px 10px;text-align:center;border:1px solid #ddd;font-size:12px">${tttFmt(r.sim.crushEndMin)}</td>
      <td style="padding:8px 10px;text-align:center;border:1px solid #ddd;font-size:12px">${tttFmt(r.sim.packEndMin)}</td>
      <td style="padding:8px 10px;text-align:center;border:1px solid #ddd;font-size:12px;${isBest?'color:#0F6E56;font-weight:700':''}">${tttFmt(r.sim.retortEndMin)}</td>
      <td style="padding:8px 10px;text-align:center;border:1px solid #ddd;font-size:11px;color:${diff===0?'#0F6E56':'#A32D2D'}">${diff===0?'★ 베스트':`+${diff}분`}</td>
    </tr>`;
  }).join('');

  // 점심 운영 분석
  const preEndedBefore = sim.preEndMin <= 11*60+30;
  const lunchAnalysis = preEndedBefore
    ? `전처리 ${tttFmt(sim.preEndMin)} 종료 → 11:30 시점에 전처리조 ${inp.wkPre}명 가용 → 파쇄 라인 합류 (정지 시간 0분)`
    : `전처리 ${tttFmt(sim.preEndMin)} 종료 (11:30 이후) → 11:30~12:30 파쇄 정지 (1시간 손실)`;

  // 병목 분석
  const isLastBottleneck = sim.lastTankCrushEndMin > sim.crushSelfEndMin;
  const crushBottleneck = isLastBottleneck
    ? `마지막 자숙 와건(${tttFmt(sim.wagonEndTimes[sim.wagonEndTimes.length-1])}) 후 처리에 묶임 — 인원 늘려도 큰 단축 어려움`
    : `자체 처리 시간이 결정 — 인원 늘리면 단축 가능`;
  const packBottleneck = `8 EA/분 기계 한도 (인원 무관) — 내포장 인원 늘려도 시간 동일`;
  const retortBottleneck = `2.5h × ${sim.retortCycles}회차 + 마지막 회차는 내포장 종료(${tttFmt(sim.packEndMin)}) 후 시작`;

  // 인원 자동 계산 근거
  const autoPersonnel = `총원 ${inp.totalWorkers}명 - 내포장 ${inp.wkPack} - 이송 ${inp.wkTrans} - 관리 ${inp.mgrWorkers} - 제수 ${inp.wkLeftover} = <strong>파쇄 풀가동 ${inp.wkPackPeak}명</strong> (점심후 ${inp.wkCrush}명)`;

  const reportBox = `
    <div style="background:var(--color-background-primary);border:1px solid #d4a82c;border-radius:12px;padding:18px 22px;margin-bottom:16px">
      <div style="font-size:14px;font-weight:700;color:#9a7a1a;margin-bottom:14px">📋 분석 보고서 — 의사결정 근거 (숫자 기반)</div>

      <!-- ① 자숙 탱크 분배 -->
      <div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--color-text-primary)">① 자숙 탱크 분배 방식 — 3가지 시뮬 비교 <span style="font-size:11px;color:#185FA5;font-weight:500">(클릭하면 그 방식으로 타임라인·인원표가 바뀜)</span></div>
        <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:8px">자숙 1호를 어떻게 채울지 = 시작 시각 + 마지막 탱크 종료 시각이 다름 → 전체 종료 시각 차이 발생</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff">
          <thead>
            <tr style="background:#185FA5;color:#fff">
              <th style="padding:8px 10px;text-align:left;border:1px solid #185FA5;font-size:11px">방식</th>
              <th style="padding:8px 10px;text-align:left;border:1px solid #185FA5;font-size:11px">탱크 분배 (kg)</th>
              <th style="padding:8px 10px;text-align:center;border:1px solid #185FA5;font-size:11px">자숙 1호 투입</th>
              <th style="padding:8px 10px;text-align:center;border:1px solid #185FA5;font-size:11px">파쇄 종료</th>
              <th style="padding:8px 10px;text-align:center;border:1px solid #185FA5;font-size:11px">내포장 종료</th>
              <th style="padding:8px 10px;text-align:center;border:1px solid #185FA5;font-size:11px">레토르트 종료</th>
              <th style="padding:8px 10px;text-align:center;border:1px solid #185FA5;font-size:11px">차이</th>
            </tr>
          </thead>
          <tbody>${tankReport}</tbody>
        </table>
        <div style="font-size:11px;margin-top:6px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span style="color:#0F6E56;font-weight:600">★ 베스트: ${tankBest.mode} (${tankBest.name}) — ${tttFmt(tankBest.sim.retortEndMin)}</span>
          <span style="color:${tankSelected.mode===tankBest.mode?'#0F6E56':'#185FA5'};font-weight:600">👁 현재 표시: ${tankSelected.mode} ${tankSelected.mode===tankBest.mode?'(베스트)':'(사용자 선택)'}</span>
        </div>
      </div>

      <!-- ② 점심 운영 -->
      <div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--color-text-primary)">② 점심 시간대 인원 운영</div>
        <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.7;font-family:monospace;background:#f7f9fc;padding:8px 12px;border-radius:6px">
          ${lunchAnalysis}<br>
          <strong>11:30~12:30</strong>: ${preEndedBefore ? `파쇄 ${inp.wkPre}명 (전처리조 합류)` : '파쇄 0명 (정지)'} · 점심 ${inp.totalWorkers - (preEndedBefore ? inp.wkPre : inp.wkPre) - 1}명<br>
          <strong>12:30~13:30</strong>: 파쇄 ${inp.wkCrush + inp.wkTrans}명 (이송 합류) · 점심 ${inp.totalWorkers - inp.wkCrush - inp.wkTrans - 1}명<br>
          <strong>13:30~${tttFmt(sim.packEndMin)}</strong>: 파쇄 ${inp.wkPackPeak} + 내포장 ${inp.wkPack} + 이송 ${inp.wkTrans} + 관리 ${inp.mgrWorkers} 풀가동
        </div>
      </div>

      <!-- ③ 인원 자동 분배 근거 -->
      <div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--color-text-primary)">③ 파쇄 인원 자동 계산</div>
        <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.7;font-family:monospace;background:#f7f9fc;padding:8px 12px;border-radius:6px">
          ${autoPersonnel}
        </div>
      </div>

      <!-- ④ 병목 분석 -->
      <div>
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--color-text-primary)">④ 병목 분석 — 어디서 시간이 결정되는가</div>
        <div style="font-size:12px;color:var(--color-text-secondary);line-height:1.7;font-family:monospace;background:#FFF7ED;padding:8px 12px;border-radius:6px">
          <strong style="color:#BA7517">파쇄 ${tttFmt(sim.crushEndMin)}</strong>: ${crushBottleneck}<br>
          <strong style="color:#7F77DD">내포장 ${tttFmt(sim.packEndMin)}</strong>: ${packBottleneck}<br>
          <strong style="color:#A32D2D">레토르트 ${tttFmt(sim.retortEndMin)}</strong>: ${retortBottleneck}
        </div>
      </div>
    </div>`;

  // 다중 작업 모드: 두 번째 작업 박스 (sim2 기반)
  let dualBox = '';
  if (dualMode && dualResult) {
    const sim2 = dualResult.sim2;
    const inp2 = dualResult.inp2;
    const orderLabel = dualResult.order === 'fc-first' ? 'FC → FP' : 'FP → FC';
    const productName = (inp2.productInfo && inp2.productInfo.name) || '제품';
    const totalEndMin = Math.max(sim2.retortEndMin, sim.retortEndMin);
    const fcEa = (dualResult.order === 'fc-first') ? sim.pouches : sim2.pouches;
    const otherEa = (dualResult.order === 'fc-first') ? sim2.pouches : sim.pouches;
    dualBox = `
    <div style="background:linear-gradient(135deg,#FFF4E6 0%,#fef9f3 100%);border:1px solid #D88A30;border-radius:12px;padding:18px 22px;margin-top:14px;margin-bottom:16px">
      <div style="font-size:11px;color:#9A5D17;font-weight:600;letter-spacing:0.5px;margin-bottom:8px">⚡ 동시 작업 · 순서: ${orderLabel} (파이프라인 순차)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:12px">
        <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:10px 14px">
          <div style="font-size:11px;color:#185FA5;font-weight:600;margin-bottom:4px">① ${inp.meatType} ${inp.meatKg.toLocaleString()}kg</div>
          <div style="color:var(--color-text-secondary)">전처리 ${tttFmt(sim.startMin)}~${tttFmt(sim.preEndMin)} → 내포장 ${tttFmt(sim.packEndMin)}</div>
          <div style="color:var(--color-text-secondary)">레토르트 종료: <strong>${tttFmt(sim.retortEndMin)}</strong> · ${sim.pouches.toLocaleString()}개</div>
        </div>
        <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:10px 14px">
          <div style="font-size:11px;color:#D88A30;font-weight:600;margin-bottom:4px">② ${productName} ${inp2.meatKg.toLocaleString()}kg</div>
          <div style="color:var(--color-text-secondary)">전처리 ${tttFmt(sim2.startMin)}~${tttFmt(sim2.preEndMin)} → 내포장 ${tttFmt(sim2.packEndMin)}</div>
          <div style="color:var(--color-text-secondary)">레토르트 종료: <strong>${tttFmt(sim2.retortEndMin)}</strong> · ${sim2.pouches.toLocaleString()}개</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--color-text-primary);margin-top:10px;padding-top:8px;border-top:0.5px dashed rgba(0,0,0,0.1)">
        <strong style="color:#0F6E56">총 종료: ${tttFmt(totalEndMin)}</strong>
        · 총 산출: FC ${fcEa.toLocaleString()} + 비-FC ${otherEa.toLocaleString()} = ${(fcEa+otherEa).toLocaleString()}개
        · 내포장 라인 ${dualResult.pkLines}대 (이송 ${dualResult.pkLines * 2}명)
      </div>
    </div>`;
  }

  // dual 모드: ttmRender가 ttt-result를 채움 / 단일 모드: 결과 합성해서 채움
  if (dualMode) {
    document.getElementById('ttt-result').innerHTML = '';
    if (typeof ttmRender === 'function') ttmRender();
  } else {
    // 단일 모드 결과 합성
    const resultEl = document.getElementById('ttt-result');
    if (resultEl) {
      // 만들어진 HTML 변수들 모두 합성
      // conclusion (요약) + planBox (계획) + lunchBg + splitView (타임라인+인원표 grid)
      //   + procTbl + whyCards + reportBox + dualBox
      // 주의: timelineSvg, wkTbl은 splitView 안에 이미 들어있음 → 중복 X
      let html = '';
      if (typeof conclusion === 'string') html += conclusion;
      if (typeof planBox === 'string') html += planBox;
      if (typeof lunchBg === 'string') html += lunchBg;
      if (typeof splitView === 'string') html += splitView;
      if (typeof procTbl === 'string') html += procTbl;
      if (typeof whyCards === 'string') html += whyCards;
      if (typeof reportBox === 'string') html += reportBox;
      if (typeof dualBox === 'string') html += dualBox;
      resultEl.innerHTML = html;
    }
  }
}

// ============================================================
// 수동 시나리오 모드 (Manual Scenario) - FP + FC 동시 작업 정밀 시뮬
// ============================================================
//
// 모델:
// - 전처리·파쇄: 라인 1개 (시간 순차)
// - 자숙: FP는 가압 5호, FC는 일반 1·2호 (탱크 분리)
// - 내포장: 라인 1개 (시간 순차), 한 라인당 이송 2명 자동
// - 레토르트: 3대, 1대당 회차 최대 4대차, 회차 150분, B룰(회차마다 비어있는 호)
// - 시간: FP 자숙 150분 + 와건 30분 = 180분. FC 자숙 240분 + 와건 30분 = 270분
// ============================================================

const TTM_FIXED = {
  preprocessLines: 1,
  crushLines: 1,
  packingLines: 1,
  retortMachines: 3,
  retortCartsPerCycle: 4,
  retortCycleMin: 150,
  fpCookMin: 150,  // FP 자숙
  fcCookMin: 240,  // FC 자숙
  cookWagonMin: 30, // 와건 (자숙 후 출하 준비)
  packTransfer: 2,  // 내포장 1라인당 이송 인원
};

// FP 시나리오 입력 구성 (실제 데이터 또는 사용자 입력)
function ttmGetScenario() {
  // 사용자 입력에서 기본값 가져옴
  const startTime = document.getElementById('ttt-start')?.value || '05:00';
  const startMin = tttToMin(startTime);

  // FP (두 번째 제품) 입력
  const meatType2 = document.getElementById('ttt-meat2')?.value || 'sig';
  const fpInfo = {
    sig:    { name: '시그니처 130g', kgPerEa: 0.025, eaPerCart: 1024, packEaMin: 25, maxLines: 2, availableLines: [3, 4] },
    trader: { name: '트레이더스 460g', kgPerEa: 0.147, eaPerCart: 380,  packEaMin: 16, maxLines: 2, availableLines: [3, 4] },
    mini:   { name: '미니 70g',     kgPerEa: 0.024, eaPerCart: 1280, packEaMin: 24, maxLines: 1, availableLines: [1] },
  }[meatType2] || { name: '시그니처 130g', kgPerEa: 0.025, eaPerCart: 1024, packEaMin: 25, maxLines: 2, availableLines: [3, 4] };

  const fpKg = parseFloat(document.getElementById('ttt-kg2')?.value) || 200;
  const fcKg = parseFloat(document.getElementById('ttt-kg')?.value) || 1200;

  // 수율·생산성 (분석 자동값 우선)
  const fpYpre = TTT_AUTO_OTHER.yPre.val;
  const fpYcook = TTT_COOK_YIELD_DEFAULT['우둔'] || 55.0;
  const fpYcrush = TTT_AUTO_OTHER.yCrush.val;
  const fpPpre = TTT_AUTO_OTHER.pPre.val;
  const fpPcrush = TTT_AUTO_OTHER.pCrush.val;

  const fcYpre = TTT_AUTO.yPre.val;
  const fcYcook = TTT_AUTO.yCook.val || 56.8;
  const fcYcrush = TTT_AUTO.yCrush.val;
  const fcPpre = TTT_AUTO.pPre.val;
  const fcPcrush = TTT_AUTO.pCrush.val;

  return {
    startMin,
    order: document.getElementById('ttt-order')?.value || 'fc-first',
    joinTime: document.getElementById('ttt-join')?.value || '09:00',
    earlyWorkers: parseInt(document.getElementById('ttt-early')?.value) || 7,
    fp: { kg: fpKg, info: fpInfo, yPre: fpYpre, yCook: fpYcook, yCrush: fpYcrush, pPre: fpPpre, pCrush: fpPcrush },
    fc: { kg: fcKg, kgPerEa: TTT_PACK_KG_PER_POUCH, eaPerCart: 96, packEaMin: 3.9, yPre: fcYpre, yCook: fcYcook, yCrush: fcYcrush, pPre: fcPpre, pCrush: fcPcrush },
  };
}

// 인원 + 수율 + 생산성 기본값 (자동값으로 시작)
function ttmDefaultWorkers() {
  return {
    preFp: 7, preFc: 7,
    crushFp: 10, crushFc: 10,  // 사용자 룰: 파쇄 10명만 있어도 충분
    packFp: 6, packFc: 6,
    // 수율·생산성 (자동값으로 시작)
    yPreFp: TTT_AUTO_OTHER.yPre.val,  yPreFc: TTT_AUTO.yPre.val,
    yCrushFp: TTT_AUTO_OTHER.yCrush.val, yCrushFc: TTT_AUTO.yCrush.val,
    pPreFp: TTT_AUTO_OTHER.pPre.val, pPreFc: TTT_AUTO.pPre.val,
    pCrushFp: TTT_AUTO_OTHER.pCrush.val, pCrushFc: TTT_AUTO.pCrush.val,
    pPackFp: 22, // 시그 기본 (Fp가 시그 기본일 때)
    pPackFc: TTT_AUTO.pPackEa.val,
  };
}

// 시나리오 시뮬: 시각별 작업 단위 배치
function ttmSimulate(scen, workers) {
  const r2 = n => Math.round(n);
  const round1 = n => Math.round(n*10)/10;

  // ====================================================================
  // 공정 흐름 시뮬레이션 (사용자 룰 기반)
  //
  // 핵심 원칙:
  //   1. 인원 슬롯은 시뮬 자체에서 결정 (인원표는 그대로 표시)
  //   2. 슬롯 = 인원표 슬롯과 동일 (05/07/09/11:30/12:30/13:30/17/끝)
  //   3. 슬롯 안 호기 수 고정 (분 단위 깜빡임 방지)
  //   4. 정원 절대 초과 X
  // ====================================================================

  // === 1. FP 공정 시간 계산 ===
  const fpYpre = workers.yPreFp;
  const fpYcrush = workers.yCrushFp;
  const fpPpre = workers.pPreFp;
  const fpPcrush = workers.pCrushFp;
  const fpPpackEaMin = workers.pPackFp;
  const fpPreIn = scen.fp.kg;
  const fpPreOut = fpPreIn * fpYpre / 100;
  const fpCookIn = fpPreOut;
  const fpCookOut = fpCookIn * scen.fp.yCook / 100;
  const fpCrushIn = fpCookOut;
  const fpCrushOut = fpCrushIn * fpYcrush / 100;
  const fpPackIn = fpCrushOut;
  const fpEa = Math.floor(fpPackIn / scen.fp.info.kgPerEa);

  const fpPreMin = Math.ceil(fpPreIn / (fpPpre * workers.preFp) * 60);
  const fpCrushMin = Math.ceil(fpCrushIn / (fpPcrush * workers.crushFp) * 60);

  // === 2. FC 공정 시간 계산 ===
  const fcYpre = workers.yPreFc;
  const fcYcrush = workers.yCrushFc;
  const fcPpre = workers.pPreFc;
  const fcPcrush = workers.pCrushFc;
  const fcPpackEaMin = workers.pPackFc;
  const fcPreIn = scen.fc.kg;
  const fcPreOut = fcPreIn * fcYpre / 100;
  const fcCookIn = fcPreOut;
  const fcCookOut = fcCookIn * scen.fc.yCook / 100;
  const fcCrushIn = fcCookOut;
  const fcCrushOut = fcCrushIn * fcYcrush / 100;
  const fcPackIn = fcCrushOut;
  const fcEa = Math.floor(fcPackIn / scen.fc.kgPerEa);
  const fcPreMin = Math.ceil(fcPreIn / (fcPpre * workers.preFc) * 60);
  const fcCrushMin = Math.ceil(fcCrushIn / (fcPcrush * workers.crushFc) * 60);
  const fcPackMin = Math.ceil(fcEa / fcPpackEaMin);

  // === 3. 타임라인 배치 ===
  const t0 = scen.startMin;
  const fcFirst = scen.order === 'fc-first';

  // 전처리 — FP 먼저면 t0~ FP끝, 그 후 FC. FC 먼저면 반대.
  const fpPre = fcFirst
    ? { s: t0 + fcPreMin, e: t0 + fcPreMin + fpPreMin }
    : { s: t0,            e: t0 + fpPreMin };
  const fcPre = fcFirst
    ? { s: t0,        e: t0 + fcPreMin }
    : { s: fpPre.e,   e: fpPre.e + fcPreMin };

  // FP 자숙 — 단일 회차 (시그/마트 가압 150분)
  const fpCook = { s: fpPre.e, e: fpPre.e + (TTM_FIXED.fpCookMin + TTM_FIXED.cookWagonMin), tank: 5 };

  // === 4. FC 자숙 탱크 분배 ===
  const fcTankKg = 800;
  const fcCookCycles = Math.max(1, Math.ceil(fcCookIn / fcTankKg));
  const fcTankKgs = Array(fcCookCycles).fill(fcCookIn / fcCookCycles);

  // 각 탱크 순차 투입 시각 (전처리 속도 기반)
  const fcKgPerMin = fcPreIn / fcPreMin;
  const fcCook = [];
  let fcCookLineEnd = fcPre.s;
  for (let i = 0; i < fcCookCycles; i++) {
    const tankReadyKg = (i + 1) * (fcCookIn / fcCookCycles);
    const tankReadyKgIn = tankReadyKg / (fcYpre / 100);
    const investAt = Math.max(fcPre.s, fcPre.s + Math.ceil(tankReadyKgIn / fcKgPerMin));
    const investStart = Math.max(investAt, fcCookLineEnd);
    const cookEnd = investStart + TTM_FIXED.fcCookMin + TTM_FIXED.cookWagonMin;
    fcCook.push({ s: investStart, e: cookEnd, tank: i + 1, kg: r2(fcTankKgs[i]) });
    fcCookLineEnd = investStart; // 다음 탱크는 이전과 동시 가능 (4탱크 운영)
  }

  // === 5. FP 파쇄 (점심 시간 회피 - 점심엔 인원 부족으로 정지) ===
  // 점심 시간(11:30~13:30) 동안 파쇄 멈춤. 그만큼 종료 늦어짐.
  const LUNCH_S = 11*60+30;
  const LUNCH_E = 13*60+30;
  const addWithLunchSkip = (start, duration) => {
    // start부터 duration 분만큼 작업. 점심 시간 만나면 그만큼 미룸.
    let elapsed = 0;
    let t = start;
    while (elapsed < duration) {
      // 현재 시점이 점심 시간이면 점심 끝까지 건너뛰기
      if (t >= LUNCH_S && t < LUNCH_E) {
        t = LUNCH_E;
        continue;
      }
      // 점심 시간 들어가기 전까지 작업
      const nextLunch = (t < LUNCH_S) ? LUNCH_S : Infinity;
      const remaining = duration - elapsed;
      const canDo = Math.min(remaining, nextLunch - t);
      elapsed += canDo;
      t += canDo;
    }
    return t;
  };
  const fpCrushEnd = addWithLunchSkip(fpCook.e, fpCrushMin);
  const fpCrush = { s: fpCook.e, e: fpCrushEnd };

  // === 6. FC 파쇄 (회차별, FP 파쇄 후, 점심 시간 회피) ===
  const fcCrushes = [];
  let fcCrushLineEnd = fpCrush.e;
  for (let i = 0; i < fcCook.length; i++) {
    const tankEnd = fcCook[i].e;
    // 자숙 yield + 파쇄 yield 적용 (사용자 콘솔 로그로 확인됨)
    const tankKg = fcTankKgs[i] * (scen.fc.yCook / 100) * (fcYcrush / 100);
    const tankCrushMin = Math.ceil(tankKg / (fcPcrush * workers.crushFc) * 60);
    const crushStart = Math.max(tankEnd, fcCrushLineEnd);
    const crushEnd = addWithLunchSkip(crushStart, tankCrushMin);
    fcCrushes.push({ s: crushStart, e: crushEnd, tank: i + 1, kg: r2(tankKg) });
    fcCrushLineEnd = crushEnd;
  }
  const fcCrushStart = fcCrushes[0].s;
  const fcCrushEnd = fcCrushes[fcCrushes.length - 1].e;
  const fcCrush = { s: fcCrushStart, e: fcCrushEnd };

  // === 7. 슬롯 정의 (인원표와 동일) ===
  const slotBoundaries = [
    t0, 7*60, 9*60, 11*60+30, 12*60+30, 13*60+30, 17*60, 28*60
  ];
  const LUNCH_START = 11*60+30;
  const LUNCH_END = 13*60+30;

  // === 8. FP 내포장 시작 시점 ===
  let fpPackStart;
  if (scen.fp.kg <= 400) {
    fpPackStart = fpCrush.e;
  } else {
    const fpCrushRateKgMin = fpCrushOut / fpCrushMin;
    const fp200kgMin = Math.ceil(200 / fpCrushRateKgMin);
    fpPackStart = fpCrush.s + fp200kgMin;
  }

  // === 9. FP 내포장 시뮬 - 슬롯별 동적 호기 ===
  // 가용 인원 계산 함수 (각 시점 t)
  const totalWorkers = parseInt(document.getElementById('ttt-total')?.value) || 28;
  const earlyWorkers = parseInt(document.getElementById('ttt-early')?.value) || 7;
  const mgrCount = parseInt(document.getElementById('ttt-mgr')?.value) || 2;
  const mgrTime = tttToMin(document.getElementById('ttt-mgr-time')?.value || '07:00');
  const joinTime = tttToMin(document.getElementById('ttt-join')?.value || '09:00');

  const fpMaxLines = scen.fp.info.maxLines || 1;
  const fpAvailLines = scen.fp.info.availableLines || [3, 4];

  // 가용 인원 = 출근 - 자숙 - 식사 - 관리 - 전처리/파쇄
  // 단, 점심 시간엔 전처리/파쇄 안 함
  const availAt = (t) => {
    let onsite;
    if (t < mgrTime) onsite = earlyWorkers;
    else if (t < joinTime) onsite = earlyWorkers + mgrCount;
    else onsite = totalWorkers;
    let occupied = 1; // 관리
    if (t >= fpCook.s && t < fpCook.e) occupied += 2;
    fcCook.forEach(c => { if (t >= c.s && t < c.e) occupied += 2; });
    const isLunch = t >= LUNCH_START && t < LUNCH_END;
    if (isLunch) {
      occupied += 14;
    } else {
      if (t >= fpPre.s && t < fpPre.e) occupied += workers.preFp;
      if (t >= fcPre.s && t < fcPre.e) occupied += workers.preFc;
      if (t >= fpCrush.s && t < fpCrush.e) occupied += workers.crushFp;
      fcCrushes.forEach(c => { if (t >= c.s && t < c.e) occupied += workers.crushFc; });
    }
    return Math.max(0, onsite - occupied);
  };

  const CREW_1_LINE = workers.packFp + 2;            // 6 + 이송 2 = 8
  const CREW_2_LINES = workers.packFp * 2 + 2;        // 6×2 + 이송 2 = 14
  const fpLineSegments = { 1: [], 2: [] };
  let fpProcessed = 0;
  let fpPackEnd = fpPackStart;

  // 슬롯별 호기 시뮬 1차
  for (let si = 0; si < slotBoundaries.length - 1; si++) {
    const slotStart = Math.max(slotBoundaries[si], fpPackStart);
    const slotEnd = slotBoundaries[si + 1];
    if (slotStart >= slotEnd) continue;
    if (fpProcessed >= fpEa) break;
    const slotMid = (slotStart + slotEnd) / 2;
    const avail = availAt(slotMid);
    const isLunch = slotMid >= LUNCH_START && slotMid < LUNCH_END;
    let lines = 0;
    if (isLunch) lines = (avail >= CREW_1_LINE) ? 1 : 0;
    else if (fpMaxLines >= 2 && avail >= CREW_2_LINES) lines = 2;
    else if (avail >= CREW_1_LINE) lines = 1;
    if (lines === 0) continue;
    const slotEffectiveEnd = Math.min(slotEnd, slotStart + Math.ceil((fpEa - fpProcessed) / (fpPpackEaMin * lines)));
    const minutesUsed = slotEffectiveEnd - slotStart;
    fpProcessed += fpPpackEaMin * lines * minutesUsed;
    fpPackEnd = slotEffectiveEnd;
    if (lines >= 1) fpLineSegments[1].push({ start: slotStart, end: slotEffectiveEnd });
    if (lines >= 2) fpLineSegments[2].push({ start: slotStart, end: slotEffectiveEnd });
  }

  // 호기 2 짧은 슬롯 제거 (60분 미만)
  const FP_DUAL_SLOT_MIN = 60;
  fpLineSegments[2] = fpLineSegments[2].filter(seg => (seg.end - seg.start) >= FP_DUAL_SLOT_MIN);

  // 호기 2 총 가동 60분 미만이면 모두 취소 + 1호기만 재시뮬
  const line2TotalMin = fpLineSegments[2].reduce((s, seg) => s + (seg.end - seg.start), 0);
  if (line2TotalMin === 0 || line2TotalMin < FP_DUAL_SLOT_MIN) {
    fpLineSegments[2] = [];
    fpLineSegments[1] = [];
    fpProcessed = 0;
    fpPackEnd = fpPackStart;
    for (let si = 0; si < slotBoundaries.length - 1; si++) {
      const slotStart = Math.max(slotBoundaries[si], fpPackStart);
      const slotEnd = slotBoundaries[si + 1];
      if (slotStart >= slotEnd) continue;
      if (fpProcessed >= fpEa) break;
      const slotMid = (slotStart + slotEnd) / 2;
      const avail = availAt(slotMid);
      if (avail < CREW_1_LINE) continue;
      const slotEffectiveEnd = Math.min(slotEnd, slotStart + Math.ceil((fpEa - fpProcessed) / fpPpackEaMin));
      const minutesUsed = slotEffectiveEnd - slotStart;
      fpProcessed += fpPpackEaMin * minutesUsed;
      fpPackEnd = slotEffectiveEnd;
      fpLineSegments[1].push({ start: slotStart, end: slotEffectiveEnd });
    }
  }
  const fpPack = { s: fpPackStart, e: fpPackEnd, segments: fpLineSegments };

  // === 10. FC 내포장 - 잔량 통과 모델 ===
  let fcPackReadyMin;
  if (scen.fc.kg <= 400) {
    fcPackReadyMin = fcCrush.e;
  } else {
    const fcCrushRateKgMin = fcCrushOut / fcCrushMin;
    const fc200kgMin = Math.ceil(200 / fcCrushRateKgMin);
    fcPackReadyMin = fcCrushStart + fc200kgMin;
  }
  const fcPackStart = Math.max(fcPackReadyMin, fpPack.e);
  const fcPackEndRaw = fcPackStart + fcPackMin;
  // 잔량 = fcEa - (파쇄 끝까지 가동 시간 × 속도)
  const fcPackMinDuringCrush = Math.max(0, fcCrushEnd - fcPackStart);
  const fcEaProcessedDuringCrush = Math.min(fcEa, fcPackMinDuringCrush * fcPpackEaMin);
  const fcRemainEa = Math.max(0, fcEa - fcEaProcessedDuringCrush);
  const fcRemainPackMin = Math.ceil(fcRemainEa / fcPpackEaMin);
  const fcLastBatchEnd = fcCrushEnd + fcRemainPackMin;
  const fcPackEnd = Math.max(fcPackEndRaw, fcLastBatchEnd);
  const fcPack = { s: fcPackStart, e: fcPackEnd };


  // === 11. 레토르트 회차 분배 ===
  // 새 룰 (사용자 요청):
  //   - 각 호기 비면 즉시 가동 (4대차 풀 충전 기다리지 X)
  //   - 내포장 라인 60분 이상 멈춤 = 그 시점 카트 송출
  //   - FP/FC 모두 부분 대차 OK
  const RETORT_GAP_MIN = 60;
  const fpRetort = [];
  const fcRetort = [];
  const retortBusy = [0, 0, 0];

  // FP 라인 1, 2 별로 처리
  for (const line of [1, 2]) {
    const lineSegs = fpLineSegments[line];
    if (lineSegs.length === 0) continue;
    let accumEa = 0;
    for (let i = 0; i < lineSegs.length; i++) {
      const seg = lineSegs[i];
      const minutes = seg.end - seg.start;
      accumEa += fpPpackEaMin * minutes;
      // 송출 시점: 마지막 세그먼트 또는 다음 세그먼트와 60분+ 간격
      const nextSeg = lineSegs[i + 1];
      const shouldSend = !nextSeg || (nextSeg.start - seg.end >= RETORT_GAP_MIN);
      if (!shouldSend) continue;
      // 누적된 EA를 4대차씩 분배 (남는 건 부분)
      while (accumEa > 0) {
        const cycleEa = Math.min(accumEa, TTM_FIXED.retortCartsPerCycle * scen.fp.info.eaPerCart);
        const cartsThis = round1(cycleEa / scen.fp.info.eaPerCart);
        let host = 0;
        for (let h = 1; h < 3; h++) if (retortBusy[h] < retortBusy[host]) host = h;
        const start = Math.max(seg.end, retortBusy[host]);
        const end = start + TTM_FIXED.retortCycleMin;
        retortBusy[host] = end;
        fpRetort.push({ s: start, e: end, host: host+1, carts: cartsThis, ea: r2(cycleEa) });
        accumEa -= cycleEa;
      }
    }
  }

  // FC 레토르트 (한 라인, 4대차씩 분배)
  {
    let remaining = fcEa;
    while (remaining > 0) {
      const cycleEa = Math.min(remaining, TTM_FIXED.retortCartsPerCycle * scen.fc.eaPerCart);
      const cartsThis = round1(cycleEa / scen.fc.eaPerCart);
      let host = 0;
      for (let h = 1; h < 3; h++) if (retortBusy[h] < retortBusy[host]) host = h;
      const start = Math.max(fcPack.e, retortBusy[host]);
      const end = start + TTM_FIXED.retortCycleMin;
      retortBusy[host] = end;
      fcRetort.push({ s: start, e: end, host: host+1, carts: cartsThis, ea: r2(cycleEa) });
      remaining -= cycleEa;
    }
  }

  // === 12. 슬롯별 인원 배치 (시뮬에서 결정) ===
  // 시뮬과 인원표가 자동 일치
  // overlap 50%: 슬롯의 절반 이상 가동되면 가동 표시 (짧은 가동 누락 방지)
  const overlap = (s, e, ps, pe) => Math.max(0, Math.min(pe, e) - Math.max(ps, s)) >= (e - s) * 0.5;
  const workerSlots = [];
  for (let si = 0; si < slotBoundaries.length - 1; si++) {
    const s = Math.max(slotBoundaries[si], t0);
    const e = Math.min(slotBoundaries[si + 1], Math.max(...retortBusy, fpPack.e, fcPack.e));
    if (e <= s) continue;
    const mid = (s + e) / 2;
    let onsite;
    if (mid < mgrTime) onsite = earlyWorkers;
    else if (mid < joinTime) onsite = earlyWorkers + mgrCount;
    else onsite = totalWorkers;
    const mgr = mid >= mgrTime ? mgrCount : 0;
    const isLunch = mid >= LUNCH_START && mid < LUNCH_END;
    const lunch = isLunch ? 14 : 0;
    let mgrActual = isLunch ? 1 : mgr;

    // 자숙 인원 (회차당 2명, 자동) — 이 셀은 인원표에 표시 안 함 but onsite 차감
    let cook = 0;
    if (overlap(s, e, fpCook.s, fpCook.e)) cook += 2;
    fcCook.forEach(c => { if (overlap(s, e, c.s, c.e)) cook += 2; });

    // 가동 검사 (슬롯과 50% 이상 겹침)
    let pre = 0, crush = 0, pack = 0, trans = 0;
    if (!isLunch) {
      if (overlap(s, e, fpPre.s, fpPre.e)) pre += workers.preFp;
      if (overlap(s, e, fcPre.s, fcPre.e)) pre += workers.preFc;
    }
    // 파쇄 - 라인 1개 공유 - 점심 시간도 가동되면 인원 카운트 (시뮬과 일치)
    // 사용자 룰: 파쇄 10명 고정
    const fpCrushActive = overlap(s, e, fpCrush.s, fpCrush.e);
    const fcCrushActive = fcCrushes.some(c => overlap(s, e, c.s, c.e));
    if (fpCrushActive || fcCrushActive) crush = 10;
    // 내포장 - 슬롯별 호기 세그먼트로
    let fpLines = 0;
    fpLineSegments[1].forEach(seg => { if (overlap(s, e, seg.start, seg.end)) fpLines = Math.max(fpLines, 1); });
    fpLineSegments[2].forEach(seg => { if (overlap(s, e, seg.start, seg.end)) fpLines = Math.max(fpLines, 2); });
    if (fpLines > 0) { pack += workers.packFp * fpLines; trans += 2; }
    if (overlap(s, e, fcPack.s, fcPack.e)) { pack += workers.packFc; trans += 2; }

    // 인원 분배:
    //  1. 자숙 + 관리 + 점심 + 내포장 + 이송 + 파쇄(10 고정) = 점유
    //  2. 남는 인원 → 외포장 또는 세팅
    const occupied = pre + crush + pack + trans + mgrActual + lunch + cook;
    let slack = Math.max(0, onsite - occupied);
    let outer = 0, setting = 0;
    // 세팅 시간대 (09:00~11:30 + 파쇄/내포장 가동 전)
    if (mid >= joinTime && mid < 11*60+30 && crush === 0 && pack === 0) {
      setting = Math.min(3, slack);
      slack -= setting;
    }
    outer = slack;

    workerSlots.push({
      s, e, mid, onsite,
      pre, crush, pack, trans, outer, setting, lunch, mgr: mgrActual, cook,
      total: pre + crush + pack + trans + outer + setting + lunch + mgrActual + cook,
      fpLines,
    });
  }

  // === 13. 종합 ===
  const endMin = Math.max(...retortBusy, fpPack.e, fcPack.e);

  return {
    fp: { pre: fpPre, cook: fpCook, crush: fpCrush, pack: fpPack, retort: fpRetort, kg: fpPreIn, ea: fpEa, packIn: fpPackIn, availLines: fpAvailLines, lineSegments: fpLineSegments },
    fc: { pre: fcPre, cook: fcCook, crush: fcCrush, crushes: fcCrushes, pack: fcPack, retort: fcRetort, kg: fcPreIn, ea: fcEa, packIn: fcPackIn, tanks: fcTankKgs },
    workerSlots,
    endMin,
  };
}


// ============================================================
// 행 분리 SVG 렌더 (한 행 = 한 작업 단위)
// ============================================================
function ttmRenderTimeline(scen, workers, sim) {
  const fmt = m => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const fpName = scen.fp.info.name;

  const SVG_W = 800, LEFT = 100, RIGHT = 780;
  const tMin = Math.min(sim.fp.pre.s, sim.fc.pre.s);  // 두 제품 중 더 일찍 시작
  const tMax = sim.endMin + 30;
  const span = Math.max(1, tMax - tMin);
  const xPos = m => LEFT + (m - tMin) / span * (RIGHT - LEFT);
  const ROW_H = 30, BAR_H = 26;

  // 눈금 + 그리드
  let ticks = '', grid = '';
  for (let h = Math.floor(tMin/60); h <= Math.ceil(tMax/60); h++) {
    const x = xPos(h*60);
    if (x >= LEFT && x <= RIGHT + 10) {
      ticks += `<text x="${x}" y="20" text-anchor="middle" font-size="11" fill="var(--color-text-secondary)">${String(h%24).padStart(2,'0')}</text>`;
      grid  += `<line x1="${x}" y1="28" x2="${x}" y2="999" stroke="#e5e3da" stroke-width="0.5" stroke-dasharray="2 3"/>`;
    }
  }

  // 점심 음영
  const lunchBg = `
    <rect x="${xPos(11*60+30)}" y="28" width="${xPos(12*60+30)-xPos(11*60+30)}" height="999" fill="#FFF7ED" opacity="0.6"/>
    <rect x="${xPos(12*60+30)}" y="28" width="${xPos(13*60+30)-xPos(12*60+30)}" height="999" fill="#FFF7ED" opacity="0.4"/>`;

  // 막대 함수 (원본 스타일: 내부 텍스트 + 우측 라벨 + 호버)
  const dur = m => { const h=Math.floor(m/60),min=m%60; return min===0?`${h}h`:`${h}h ${min}분`; };
  const bar = (y, s, e, color, innerTxt, rightTxt, tipTitle, tipLines) => {
    const x1 = xPos(s), x2 = xPos(e), w = Math.max(x2-x1, 3);
    const lines = tipLines.map((l,i) => i===0 ? l+` (${dur(e-s)})` : l);
    const tipInfo = lines.join('|');
    return `<g class="ttt-bar" data-tip-title="${tipTitle}" data-tip-info="${tipInfo}">
      <rect x="${x1}" y="${y}" width="${w}" height="${BAR_H}" rx="3" fill="${color}"/>
      ${innerTxt && w > 40 ? `<text x="${(x1+x2)/2}" y="${y+BAR_H/2+4}" text-anchor="middle" font-size="10" fill="#fff" font-weight="600" pointer-events="none">${innerTxt}</text>` : ''}
    </g>
    ${rightTxt ? `<text x="${x2+5}" y="${y+BAR_H/2+4}" text-anchor="start" font-size="9.5" fill="${color}" pointer-events="none">${rightTxt}</text>` : ''}`;
  };
  const label = (y, txt) => `<text x="${LEFT-8}" y="${y+BAR_H/2+4}" text-anchor="end" font-size="12" fill="var(--color-text-secondary)" font-weight="500">${txt}</text>`;

  let bars = '';
  let yCursor = 36;

  // FP 전처리
  bars += label(yCursor, '전처리');
  bars += bar(yCursor, sim.fp.pre.s, sim.fp.pre.e, '#7F77DD',
    `${workers.preFp}명 · ${scen.fp.kg}kg`,
    `${scen.fp.kg}kg`,
    `${fpName} 전처리`,
    [`시각: ${fmt(sim.fp.pre.s)}~${fmt(sim.fp.pre.e)}`, `인원: ${workers.preFp}명`, `원육: ${scen.fp.kg}kg`]);
  yCursor += ROW_H;

  // FC 전처리
  bars += label(yCursor, '전처리 1');
  bars += bar(yCursor, sim.fc.pre.s, sim.fc.pre.e, '#185FA5',
    `${workers.preFc}명 · ${scen.fc.kg}kg`,
    `${workers.yCrushFc ? workers.yCrushFc+'%' : ''} · ${workers.pPreFc}kg/인시`,
    `FC 전처리`,
    [`시각: ${fmt(sim.fc.pre.s)}~${fmt(sim.fc.pre.e)}`, `인원: ${workers.preFc}명`, `원육: ${scen.fc.kg}kg`, `생산성: ${workers.pPreFc}kg/인시`]);
  yCursor += ROW_H;

  // FP 자숙
  bars += label(yCursor, '자숙');
  bars += bar(yCursor, sim.fp.cook.s, sim.fp.cook.e, '#5DCAA5',
    `${fpName} · 가압`,
    ``,
    `${fpName} 자숙`,
    [`시각: ${fmt(sim.fp.cook.s)}~${fmt(sim.fp.cook.e)}`, `탱크: 가압 5호`, `자숙: 150분`]);
  yCursor += ROW_H;

  // FC 자숙 탱크별
  sim.fc.cook.forEach((c, i) => {
    bars += label(yCursor, `자숙 ${i+1}`);
    bars += bar(yCursor, c.s, c.e, '#0F6E56',
      `${c.kg}kg`,
      `${c.kg}kg`,
      `FC 자숙 ${i+1}호`,
      [`시각: ${fmt(c.s)}~${fmt(c.e)}`, `탱크: ${c.tank}호`, `투입: ${c.kg}kg`, `자숙: 240분`]);
    yCursor += ROW_H;
  });

  // FP 파쇄
  bars += label(yCursor, '파쇄');
  bars += bar(yCursor, sim.fp.crush.s, sim.fp.crush.e, '#7F77DD',
    `${workers.crushFp}명`,
    `${workers.yCrushFp}% · ${workers.pCrushFp}kg/인시`,
    `${fpName} 파쇄`,
    [`시각: ${fmt(sim.fp.crush.s)}~${fmt(sim.fp.crush.e)}`, `인원: ${workers.crushFp}명`, `수율: ${workers.yCrushFp}%`, `생산성: ${workers.pCrushFp}kg/인시`]);
  yCursor += ROW_H;

  // FC 파쇄 탱크별
  (sim.fc.crushes || [sim.fc.crush]).forEach((c, i) => {
    bars += label(yCursor, `파쇄 ${i+1}`);
    bars += bar(yCursor, c.s, c.e, '#BA7517',
      `${c.tank}호 · ${c.kg}kg`,
      `${c.kg}kg`,
      `FC 파쇄 ${c.tank}호`,
      [`시각: ${fmt(c.s)}~${fmt(c.e)}`, `탱크: ${c.tank}호`, `파쇄량: ${c.kg}kg`, `인원: ${workers.crushFc}명`]);
    yCursor += ROW_H;
  });

  // FP 내포장 (호기별 세그먼트 분할 - 점심 시간 단일 가동 반영)
  const fpAvail = sim.fp.availLines || [3, 4];
  const fpSegs = sim.fp.pack.segments || { 1: [{ start: sim.fp.pack.s, end: sim.fp.pack.e }], 2: [] };
  const fpMaxLinesUsed = fpSegs[2].length > 0 ? 2 : 1;
  for (let li = 0; li < fpMaxLinesUsed; li++) {
    const lineNum = fpAvail[li] || (li + 1);
    const segs = fpSegs[li + 1] || [];
    bars += label(yCursor, `내포장 ${lineNum}호기`);
    segs.forEach(seg => {
      bars += bar(yCursor, seg.start, seg.end, '#9B59B6',
        `6명`,
        `${fpName}`,
        `${fpName} 내포장 ${lineNum}호기`,
        [`시각: ${fmt(seg.start)}~${fmt(seg.end)}`, `인원: 6명`]);
    });
    yCursor += ROW_H;
  }

  // FC 내포장 (2호기 고정)
  bars += label(yCursor, '내포장 2호기');
  bars += bar(yCursor, sim.fc.pack.s, sim.fc.pack.e, '#534AB7',
    `${workers.packFc}명 · ${sim.fc.ea.toLocaleString()}EA`,
    `${sim.fc.ea.toLocaleString()}EA`,
    `FC 내포장`,
    [`시각: ${fmt(sim.fc.pack.s)}~${fmt(sim.fc.pack.e)}`, `인원: ${workers.packFc}명 + 이송2`, `산출: ${sim.fc.ea.toLocaleString()}EA`]);
  yCursor += ROW_H;

  // 레토르트
  [...sim.fp.retort.map(r=>({...r,isFp:true})), ...sim.fc.retort.map(r=>({...r,isFp:false}))].forEach((r, i) => {
    const lbl = i===0 ? '레토르트' : `레토르트 ${i+1}`;
    const color = r.isFp ? '#993556' : '#A32D2D';
    const nm = r.isFp ? fpName : 'FC';
    bars += label(yCursor, lbl);
    bars += bar(yCursor, r.s, r.e, color,
      `${r.carts}대차 · ${r.ea.toLocaleString()}EA`,
      `${r.ea.toLocaleString()}EA`,
      `${nm} 레토르트 ${r.host}호`,
      [`시각: ${fmt(r.s)}~${fmt(r.e)}`, `레토르트: ${r.host}호`, `대차: ${r.carts}대차`, `수량: ${r.ea.toLocaleString()}EA`]);
    yCursor += ROW_H;
  });

  // 점심
  bars += label(yCursor, '점심');
  bars += bar(yCursor, 11*60+30, 12*60+30, '#E8A838', '1차', '', '점심 1차', [`11:30~12:30`]);
  bars += bar(yCursor, 12*60+30, 13*60+30, '#C8882A', '2차', '', '점심 2차', [`12:30~13:30`]);
  yCursor += ROW_H;

  // 종료선 — 내포장 종료(보라) + 최종 종료(빨강)
  const fpPackEnd = sim.fp.pack.e;
  const fcPackEnd = sim.fc.pack.e;
  // 두 제품 내포장 종료선 (같은 시각이면 한 줄만)
  const drawPackEndLine = (t, txt, yOffset) => `
    <line x1="${xPos(t)}" y1="28" x2="${xPos(t)}" y2="${yCursor}" stroke="#7F77DD" stroke-width="1" stroke-dasharray="4 3" opacity="0.85"/>
    <text x="${xPos(t)}" y="${yCursor + yOffset}" text-anchor="middle" font-size="11" fill="#7F77DD" font-weight="700">${fmt(t)} ${txt}</text>`;
  if (fpPackEnd === fcPackEnd) {
    bars += drawPackEndLine(fpPackEnd, '내포장', 14);
  } else {
    bars += drawPackEndLine(fpPackEnd, 'FP 내포장', 14);
    bars += drawPackEndLine(fcPackEnd, 'FC 내포장', 28);
  }
  // 최종 종료선 (빨강)
  const endLabelY = (fpPackEnd !== fcPackEnd) ? 42 : 28;
  bars += `<line x1="${xPos(sim.endMin)}" y1="28" x2="${xPos(sim.endMin)}" y2="${yCursor}" stroke="#A32D2D" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.8"/>
    <text x="${xPos(sim.endMin)}" y="${yCursor + endLabelY}" text-anchor="middle" font-size="11" fill="#A32D2D" font-weight="700">${fmt(sim.endMin)} 종료</text>`;

  const svgH = yCursor + endLabelY + 10;
  return `
    <style>
      .ttt-bar { cursor:pointer; }
      .ttt-bar:hover rect { filter:brightness(1.12); }
      #tttTip { position:fixed; background:#222; color:#fff; padding:8px 12px; border-radius:6px; font-size:12px; line-height:1.6; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:9999; pointer-events:none; max-width:280px; display:none; }
      .ttt-tip-title { font-weight:700; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.2); padding-bottom:3px; }
    </style>
    <svg width="100%" viewBox="0 0 ${SVG_W} ${svgH}">
      ${lunchBg}${ticks}${grid}${bars}
    </svg>
    <div id="tttTip"></div>`;
}

// ============================================================
// 시간대별 인원 현황표 (사진 4 오른쪽 패턴)
// 사용자가 입력한 인원 + 시뮬 시간 기준으로 시간 슬롯 × 공정 분포 자동 계산
// ============================================================
function ttmRenderWorkerSlots(scen, workers, sim) {
  const fmt = m => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

  const totalWorkers = parseInt(document.getElementById('ttt-total')?.value) || 28;
  const earlyWorkers = parseInt(document.getElementById('ttt-early')?.value) || 7;
  const mgrMin       = parseInt(document.getElementById('ttt-mgr')?.value)   || 2;
  const mgrTimeMin   = tttToMin(document.getElementById('ttt-mgr-time')?.value || '07:00');
  const joinTimeMin  = tttToMin(document.getElementById('ttt-join')?.value || '09:00');

  const earlyFpCrush = sim.fp.crush.s < 8*60+30;
  const earlyFcCrush = (sim.fc.crushes?.[0]?.s ?? sim.fc.crush.s) < 8*60+30;

  // 시뮬에서 결정된 인원 슬롯 사용 (인원표 = 시뮬 자동 일치)
  const slots = (sim.workerSlots || []).map(ws => ({
    label: `${fmt(ws.s)}~${fmt(ws.e)}`,
    pre: ws.pre, cook: ws.cook || 0, crush: ws.crush, pack: ws.pack, trans: ws.trans,
    outer: ws.outer, setting: ws.setting, lunch: ws.lunch, mgr: ws.mgr,
    idle: 0, total: ws.total, onsite: ws.onsite,
  }));

  const wkColors = ['#185FA5','#0F6E56','#BA7517','#7F77DD','#534AB7','#1D9E75','#EF9F27','#888780','#5F5E5A','#B4B2A9'];
  const heads = ['전처리','자숙','파쇄','내포장','이송','외포장','세팅','점심','관리','유휴'];
  const keys  = ['pre','cook','crush','pack','trans','outer','setting','lunch','mgr','idle'];

  const rows = slots.map((r, idx) => {
    const stripe = idx%2===1 ? 'background:#f7f9fc' : '';
    const isFull = r.total === r.onsite;
    const sumMark = isFull
      ? `<span style="color:#0F6E56">${r.total} ✓</span>`
      : `<span style="color:#A32D2D">${r.total}/${r.onsite}</span>`;
    const rowH = `height:${(100/Math.max(1,slots.length)).toFixed(2)}%`;
    return `<tr style="${stripe};${rowH}">
      <td style="padding:6px 4px;border:1px solid #ddd;font-weight:600;font-size:11px;text-align:center;white-space:nowrap;vertical-align:middle">${r.label}</td>
      ${keys.map((k,ci) => {
        const v = r[k];
        const color = v ? wkColors[ci] : '#ccc';
        const fw = v >= 10 ? 700 : 600;
        return `<td style="padding:6px 2px;text-align:center;border:1px solid #ddd;color:${color};font-weight:${fw};font-size:13px;vertical-align:middle">${v||'·'}</td>`;
      }).join('')}
      <td style="padding:6px 2px;text-align:center;font-weight:700;font-size:13px;border:1px solid #ddd;background:#f8f7f3;vertical-align:middle">${sumMark}</td>
    </tr>`;
  }).join('');

  const headerStyle = 'padding:0 4px;font-weight:700;border:1px solid #0d4a8a;font-size:12px;text-align:center';
  const earlyNote = (earlyFpCrush || earlyFcCrush) ? ' · ⚠️ 파쇄 조기출근 필요' : '';
  return `
    <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:8px;flex-shrink:0">
      정원 ${totalWorkers}명 · 외국인 ${earlyWorkers}명(${fmt(sim.fp.pre.s)}~), 관리 +${mgrMin}명(${fmt(mgrTimeMin)}~), 한국인(${fmt(joinTimeMin)}~)${earlyNote}
    </div>
    <div style="border:2px solid #185FA5;border-radius:6px;flex:1;display:flex;overflow:hidden">
    <table style="width:100%;height:100%;border-collapse:collapse;font-size:13px;background:#fff">
      <thead>
        <tr style="background:linear-gradient(135deg,#185FA5,#1a6db5);color:#fff;height:36px">
          <th style="${headerStyle}">시간대</th>
          ${heads.map(h => `<th style="${headerStyle}">${h}</th>`).join('')}
          <th style="${headerStyle};background:#0d4a8a">합계</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

// ============================================================
// 공정별 입력 통합 (인원·수율·생산성 - 모두 수정 가능 + 자동값 표시)
// ============================================================
function ttmRenderWorkers(workers) {
  const scen = ttmGetScenario();
  // 자동값 (참고용 표시)
  const a = {
    fpYpre: TTT_AUTO_OTHER.yPre.val, fpYcrush: TTT_AUTO_OTHER.yCrush.val,
    fpPpre: TTT_AUTO_OTHER.pPre.val, fpPcrush: TTT_AUTO_OTHER.pCrush.val,
    fpPpack: TTT_AUTO_OTHER.pPackEa.val,
    fcYpre: TTT_AUTO.yPre.val, fcYcrush: TTT_AUTO.yCrush.val,
    fcPpre: TTT_AUTO.pPre.val, fcPcrush: TTT_AUTO.pCrush.val,
    fcPpack: TTT_AUTO.pPackEa.val,
  };
  const inputCell = (id, val, step='1', max='20') =>
    `<input type="number" id="${id}" value="${val}" min="0" max="${max}" step="${step}" oninput="ttmOnWorkerChange()" style="width:60px;text-align:center;padding:3px 6px;border:0.5px solid var(--color-border-secondary);border-radius:4px;font-size:11.5px">`;
  const td = (content, autoText) =>
    `<td style="padding:5px;border:0.5px solid var(--color-border-tertiary);text-align:center">${content}${autoText?`<div style="font-size:9px;color:var(--color-text-tertiary);margin-top:2px">${autoText}</div>`:''}</td>`;
  const labelTd = (txt) =>
    `<td style="padding:6px 8px;border:0.5px solid var(--color-border-tertiary);text-align:right;font-weight:500;font-size:11.5px;background:var(--color-background-secondary)">${txt}</td>`;
  return `
    <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:14px;margin-top:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">📐 공정별 입력 (수정 시 자동 재계산)</div>
      <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:10px">자동값(DB) 위에 직접 입력해 수정. 한 라인당 이송 2명 자동.</div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px">
        <thead>
          <tr style="background:var(--color-background-secondary)">
            <th style="padding:7px;border:0.5px solid var(--color-border-tertiary);text-align:center">공정</th>
            <th style="padding:7px;border:0.5px solid var(--color-border-tertiary);text-align:center">항목</th>
            <th style="padding:7px;border:0.5px solid var(--color-border-tertiary);text-align:center;color:#7F77DD">FP (시그)</th>
            <th style="padding:7px;border:0.5px solid var(--color-border-tertiary);text-align:center;color:#185FA5">FC (홍두깨)</th>
          </tr>
        </thead>
        <tbody>
          <tr>${labelTd('전처리')}${labelTd('인원')}${td(inputCell('ttm-w-pre-fp', workers.preFp))}${td(inputCell('ttm-w-pre-fc', workers.preFc))}</tr>
          <tr><td style="border:0.5px solid var(--color-border-tertiary)"></td>${labelTd('공정수율(%)')}${td(inputCell('ttm-y-pre-fp', workers.yPreFp, '0.1', '100'), `자동 ${a.fpYpre}`)}${td(inputCell('ttm-y-pre-fc', workers.yPreFc, '0.1', '100'), `자동 ${a.fcYpre}`)}</tr>
          <tr><td style="border:0.5px solid var(--color-border-tertiary)"></td>${labelTd('생산성(kg/인시)')}${td(inputCell('ttm-p-pre-fp', workers.pPreFp, '0.1', '200'), `자동 ${a.fpPpre}`)}${td(inputCell('ttm-p-pre-fc', workers.pPreFc, '0.1', '200'), `자동 ${a.fcPpre}`)}</tr>
          <tr>${labelTd('파쇄')}${labelTd('인원')}${td(inputCell('ttm-w-crush-fp', workers.crushFp))}${td(inputCell('ttm-w-crush-fc', workers.crushFc))}</tr>
          <tr><td style="border:0.5px solid var(--color-border-tertiary)"></td>${labelTd('공정수율(%)')}${td(inputCell('ttm-y-crush-fp', workers.yCrushFp, '0.1', '100'), `자동 ${a.fpYcrush}`)}${td(inputCell('ttm-y-crush-fc', workers.yCrushFc, '0.1', '100'), `자동 ${a.fcYcrush}`)}</tr>
          <tr><td style="border:0.5px solid var(--color-border-tertiary)"></td>${labelTd('생산성(kg/인시)')}${td(inputCell('ttm-p-crush-fp', workers.pCrushFp, '0.1', '200'), `자동 ${a.fpPcrush}`)}${td(inputCell('ttm-p-crush-fc', workers.pCrushFc, '0.1', '200'), `자동 ${a.fcPcrush}`)}</tr>
          <tr>${labelTd('내포장')}${labelTd('인원')}${td(inputCell('ttm-w-pack-fp', workers.packFp, '1', '15'))}${td(inputCell('ttm-w-pack-fc', workers.packFc, '1', '15'))}</tr>
          <tr><td style="border:0.5px solid var(--color-border-tertiary)"></td>${labelTd('생산성(EA/분)')}${td(inputCell('ttm-p-pack-fp', workers.pPackFp, '0.1', '50'), `자동 ${scen.fp.info.packEaMin}`)}${td(inputCell('ttm-p-pack-fc', workers.pPackFc, '0.1', '50'), `자동 ${a.fcPpack}`)}</tr>
        </tbody>
      </table>
    </div>`;
}

// ============================================================
// 상부 보고서 형식
// ============================================================
function ttmRenderReport(scen, workers, sim) {
  const fmt = m => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const dur = m => `${Math.floor(m/60)}시간 ${m%60}분`;
  const fpName = scen.fp.info.name;
  const totalMin = sim.endMin - scen.startMin;

  const fpRetortStr = sim.fp.retort.map((r, i) => `회차${i+1} ${fmt(r.s)}~${fmt(r.e)} (${r.host}호, ${r.carts}대차, ${r.ea.toLocaleString()}EA)`).join('<br>      ');
  const fcRetortStr = sim.fc.retort.map((r, i) => `회차${i+1} ${fmt(r.s)}~${fmt(r.e)} (${r.host}호, ${r.carts}대차, ${r.ea.toLocaleString()}EA)`).join('<br>      ');

  return `
    <div style="background:#f8f7f3;border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:18px 22px;margin-top:14px;font-size:12.5px;line-height:1.85">
      <div style="font-size:15px;font-weight:600;margin-bottom:12px;color:var(--color-text-primary)">📋 작업 계획 보고서</div>

      <div style="font-weight:600;margin-top:10px;margin-bottom:4px;color:#185FA5">【작업 개요】</div>
      <div>• ${fpName}: ${scen.fp.kg}kg → 약 ${sim.fp.ea.toLocaleString()} EA 생산 (예상)</div>
      <div>• FC 장조림 3KG: ${scen.fc.kg}kg → 약 ${sim.fc.ea.toLocaleString()} EA 생산 (예상)</div>
      <div>• 작업 시작 ${fmt(scen.startMin)} · 종료 ${fmt(sim.endMin)} · 총 ${dur(totalMin)}</div>

      <div style="font-weight:600;margin-top:12px;margin-bottom:4px;color:#185FA5">【공정별 일정】</div>
      <div>1. 전처리 (단일 라인)</div>
      <div style="padding-left:12px">- ${fpName}: ${fmt(sim.fp.pre.s)}~${fmt(sim.fp.pre.e)} (${dur(sim.fp.pre.e - sim.fp.pre.s)}, ${workers.preFp}명)</div>
      <div style="padding-left:12px">- FC: ${fmt(sim.fc.pre.s)}~${fmt(sim.fc.pre.e)} (${dur(sim.fc.pre.e - sim.fc.pre.s)}, ${workers.preFc}명)</div>

      <div>2. 자숙 (탱크 분산)</div>
      <div style="padding-left:12px">- ${fpName}: 가압5호 ${fmt(sim.fp.cook.s)}~${fmt(sim.fp.cook.e)} (자숙 150분 + 와건 30분)</div>
      <div style="padding-left:12px">- FC: ${sim.fc.cook.map(c => `${c.tank}호`).join('·')} 평행 ${fmt(sim.fc.cook[0].s)}~${fmt(sim.fc.cook[0].e)} (자숙 240분 + 와건 30분)</div>

      <div>3. 파쇄 (단일 라인)</div>
      <div style="padding-left:12px">- ${fpName}: ${fmt(sim.fp.crush.s)}~${fmt(sim.fp.crush.e)} (${dur(sim.fp.crush.e - sim.fp.crush.s)}, ${workers.crushFp}명)</div>
      <div style="padding-left:12px">- FC: ${fmt(sim.fc.crush.s)}~${fmt(sim.fc.crush.e)} (${dur(sim.fc.crush.e - sim.fc.crush.s)}, ${workers.crushFc}명)</div>

      <div>4. 내포장 (1라인 + 이송 2명)</div>
      <div style="padding-left:12px">- ${fpName}: ${fmt(sim.fp.pack.s)}~${fmt(sim.fp.pack.e)} (${dur(sim.fp.pack.e - sim.fp.pack.s)}, ${workers.packFp}명+이송2)</div>
      <div style="padding-left:12px">- FC: ${fmt(sim.fc.pack.s)}~${fmt(sim.fc.pack.e)} (${dur(sim.fc.pack.e - sim.fc.pack.s)}, ${workers.packFc}명+이송2)</div>

      <div>5. 레토르트 (3대 운영, 1대당 4대차 한도)</div>
      <div style="padding-left:12px">- ${fpName}: ${fpRetortStr}</div>
      <div style="padding-left:12px">- FC: ${fcRetortStr}</div>

      <div style="font-weight:600;margin-top:12px;margin-bottom:4px;color:#185FA5">【주요 시점】</div>
      <div>• ${fmt(sim.fp.pack.e)} ${fpName} 내포장 완료</div>
      <div>• ${fmt(sim.fp.retort[sim.fp.retort.length-1].e)} ${fpName} 작업 완전 종료 (레토르트 포함)</div>
      <div>• ${fmt(sim.fc.pack.e)} FC 내포장 완료</div>
      <div>• <strong>${fmt(sim.endMin)} 전체 종료</strong></div>

      <div style="font-weight:600;margin-top:12px;margin-bottom:4px;color:#185FA5">【생산성 지표 (예상)】</div>
      <div>• ${fpName}: ${sim.fp.ea.toLocaleString()} EA</div>
      <div>• FC: ${sim.fc.ea.toLocaleString()} EA</div>
      <div>• 총 산출: ${(sim.fp.ea + sim.fc.ea).toLocaleString()} EA</div>
    </div>`;
}

// ============================================================
// 인원 변경 시 재계산
// ============================================================
function ttmOnWorkerChange() {
  ttmRender();
}

// 현재 인원 입력 읽기
// 현재 인원 입력 읽기 — FP 카드(ttt-fp-*)와 FC 카드(ttt-wk-* 등) 직접 읽음
function ttmGetCurrentWorkers() {
  const getN = (id, def) => {
    const v = parseFloat(document.getElementById(id)?.value);
    return isFinite(v) && v > 0 ? v : def;
  };
  const def = ttmDefaultWorkers();
  return {
    // FP: 화면 FP 카드에서
    preFp:    getN('ttt-fp-wk-pre',   def.preFp),
    crushFp:  def.crushFp,  // 자동 계산
    packFp:   getN('ttt-fp-wk-pack',  def.packFp),
    yPreFp:   getN('ttt-fp-y-pre',    def.yPreFp),
    yCrushFp: getN('ttt-fp-y-crush',  def.yCrushFp),
    pPreFp:   getN('ttt-fp-p-pre',    def.pPreFp),
    pCrushFp: getN('ttt-fp-p-crush',  def.pCrushFp),
    pPackFp:  getN('ttt-fp-p-pack',   def.pPackFp),
    // FC: 화면 FC 카드에서
    preFc:    getN('ttt-wk-pre',      def.preFc),
    crushFc:  def.crushFc,  // 자동 계산
    packFc:   getN('ttt-wk-pack',     def.packFc),
    yPreFc:   getN('ttt-y-pre',       def.yPreFc),
    yCrushFc: getN('ttt-y-crush',     def.yCrushFc),
    pPreFc:   getN('ttt-p-pre',       def.pPreFc),
    pCrushFc: getN('ttt-p-crush',     def.pCrushFc),
    pPackFc:  getN('ttt-p-pack',      def.pPackFc),
  };
}

// 시나리오 모드 메인 렌더 (사진 패턴: 좌 타임라인 + 우 인원표)
function ttmRender() {
  try {
    const scen = ttmGetScenario();
    const workers = ttmGetCurrentWorkers();
    // FP 듀얼 가능 제품(maxLines=2)이고 packFp가 12 미만이면 자동 12명 (듀얼 가동)
    const fpMaxLines = scen.fp.info.maxLines || 1;
    const fpInputEl = document.getElementById('ttt-fp-wk-pack');
    const userEditedFp = fpInputEl && fpInputEl.dataset.userEdited === 'true';
    // FP 듀얼 가동은 사용자가 명시적으로 12명 이상 입력했을 때만
    // (기본은 1대로 충분히 길게 - 사용자 룰)
    // 이전: 자동 12명 강제 → 정원 초과 발생, 듀얼 강박
    // 이전 자동 듀얼 강제 코드 제거됨
    const sim = ttmSimulate(scen, workers);
    const html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;margin-top:14px">
        <div style="font-size:14px;font-weight:600">📅 시나리오 타임라인 + 시간대별 인원 활용</div>
        <button onclick="ttmDownloadExcel()" style="background:#185FA5;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:500">📥 엑셀 다운로드</button>
      </div>
      <style>
        @media (max-width: 900px) { #ttm-split { grid-template-columns: 1fr !important; } }
      </style>
      <div id="ttm-split" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;align-items:stretch">
        <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:14px;min-width:0;display:flex;flex-direction:column">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;flex-shrink:0">📋 공정 타임라인</div>
          <div style="flex:1;display:flex;align-items:flex-start;min-height:0">${ttmRenderTimeline(scen, workers, sim)}</div>
        </div>
        <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:14px;min-width:0;display:flex;flex-direction:column">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;flex-shrink:0">👥 시간대별 인원 활용</div>
          <div style="flex:1;display:flex;flex-direction:column;min-height:0">${ttmRenderWorkerSlots(scen, workers, sim)}</div>
        </div>
      </div>
      ${ttmRenderReport(scen, workers, sim)}`;
    const out = document.getElementById('ttt-result');
    if (out) out.innerHTML = html;
  } catch (e) {
    console.error('[ttm] render error:', e);
    const out = document.getElementById('ttt-result');
    if (out) out.innerHTML = `<div style="color:#A32D2D;padding:20px">시뮬 오류: ${e.message}</div>`;
  }
}

if (typeof window !== 'undefined') {
  window.ttmRender = ttmRender;
  window.ttmOnWorkerChange = ttmOnWorkerChange;
}

// ============================================================
// 엑셀 다운로드 (수식 포함 — 엑셀에서 인원 바꾸면 시간 자동 계산)
// ============================================================
function ttmDownloadExcel() {
  const scen = ttmGetScenario();
  const workers = ttmGetCurrentWorkers();
  const sim = ttmSimulate(scen, workers);

  // CSV 대신 SpreadsheetML (xls) 또는 단순 CSV with formulas
  // 간단히: 인원 셀(B열) + 시간 계산 수식(C·D·E열) 박은 표
  // Excel은 CSV 안의 수식도 인식. ="=" prefix로 강제

  const fmt = m => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const round1 = n => Math.round(n*10)/10;

  // CSV 형식 (UTF-8 BOM, 엑셀 친화)
  // 행: 공정, 제품, 원육량, 인원, 생산성, 소요시간(수식), 시작, 종료
  const sep = ',';
  const lines = [];
  lines.push(['공정','제품','원육량(kg)','EA','인원','수율(%)','생산성','소요(분)','시작','종료'].join(sep));

  // FP 전처리
  lines.push(['전처리', scen.fp.info.name, scen.fp.kg, '-', workers.preFp, scen.fp.yPre, scen.fp.pPre + ' kg/인시', `=CEILING(C2*60/(G2*E2)*1,1)`, fmt(sim.fp.pre.s), fmt(sim.fp.pre.e)].join(sep));
  // FC 전처리
  lines.push(['전처리 1', 'FC 장조림 3KG', scen.fc.kg, '-', workers.preFc, scen.fc.yPre, scen.fc.pPre + ' kg/인시', `=CEILING(C3*60/(G3*E3)*1,1)`, fmt(sim.fc.pre.s), fmt(sim.fc.pre.e)].join(sep));
  // FP 자숙
  lines.push(['자숙', scen.fp.info.name, sim.fp.packIn ? round1(scen.fp.kg * scen.fp.yPre / 100) : '-', '-', '자동', scen.fp.yCook, '-', '180 (150+와건30)', fmt(sim.fp.cook.s), fmt(sim.fp.cook.e)].join(sep));
  // FC 자숙
  sim.fc.cook.forEach((c, i) => {
    lines.push([`자숙 ${i+1}`, 'FC 장조림 3KG', c.kg, '-', '자동', scen.fc.yCook, '-', '270 (240+와건30)', fmt(c.s), fmt(c.e)].join(sep));
  });
  // FP 파쇄
  lines.push(['파쇄', scen.fp.info.name, round1(sim.fp.kg * scen.fp.yPre/100 * scen.fp.yCook/100), '-', workers.crushFp, scen.fp.yCrush, scen.fp.pCrush + ' kg/인시', '계산', fmt(sim.fp.crush.s), fmt(sim.fp.crush.e)].join(sep));
  // FC 파쇄
  lines.push(['파쇄 1', 'FC 장조림 3KG', round1(sim.fc.kg * scen.fc.yPre/100 * scen.fc.yCook/100), '-', workers.crushFc, scen.fc.yCrush, scen.fc.pCrush + ' kg/인시', '계산', fmt(sim.fc.crush.s), fmt(sim.fc.crush.e)].join(sep));
  // FP 내포장
  lines.push(['내포장', scen.fp.info.name, '-', sim.fp.ea, workers.packFp + '+이송2', '-', scen.fp.info.packEaMin + ' EA/분', '계산', fmt(sim.fp.pack.s), fmt(sim.fp.pack.e)].join(sep));
  // FC 내포장
  lines.push(['내포장 1', 'FC 장조림 3KG', '-', sim.fc.ea, workers.packFc + '+이송2', '-', scen.fc.packEaMin + ' EA/분', '계산', fmt(sim.fc.pack.s), fmt(sim.fc.pack.e)].join(sep));
  // FP 레토르트
  sim.fp.retort.forEach((r, i) => {
    lines.push([(i===0?'레토르트':`레토르트 ${i+1}`), scen.fp.info.name, '-', r.ea, `${r.host}호`, '-', `${r.carts}대차`, '150', fmt(r.s), fmt(r.e)].join(sep));
  });
  // FC 레토르트
  const fpRetortCount = sim.fp.retort.length;
  sim.fc.retort.forEach((r, i) => {
    lines.push([`레토르트 ${fpRetortCount + i + 1 - (fpRetortCount===0?1:0)}`, 'FC 장조림 3KG', '-', r.ea, `${r.host}호`, '-', `${r.carts}대차`, '150', fmt(r.s), fmt(r.e)].join(sep));
  });

  const csv = '\uFEFF' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `타임테이블_시나리오_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

if (typeof window !== 'undefined') {
  window.ttmDownloadExcel = ttmDownloadExcel;
}
