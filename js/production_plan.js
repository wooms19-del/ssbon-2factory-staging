// ============================================================
// 생산 계획 시뮬레이션 (production_plan.js)
// ============================================================
// 목적:
//   사용자가 시작시간/최대종료시간/제품+수량/가용인원 입력 →
//   "내포장 오전 시작" vs "내포장 오후 시작" 두 시나리오 시뮬레이션 →
//   가능한 시나리오 중 종료시간 빠른 쪽을 추천 →
//   필요 인원 + 그 이유를 표시
//
// 핵심 룰 (메모리):
//   - 시간 경계 하드코딩 금지 (13:30 내포장 시작 같은 거 금지)
//   - 내포장 시작 = 파쇄 1대차(~96EA) 쌓이고 인력 가용 시 즉시
//   - 의미있는 시간 슬롯으로 표현 (1분 단위 X)
//   - 레토르트: 1대 4대차, 3대 운영, 회차 150분
// ============================================================

// 공정별 생산성 표준 (최근 30일 데이터 기반, 사용자 덮어쓰기 가능)
// 자동 fetch로 갱신됨
var PP_STD = {
  preprocess_kg_per_manhour: 79,   // 전처리 1인시간당 kg
  cooking: {
    tanks_total: 6,              // 자숙 탱크 총 6대
    tanks_pressure: 2,           // 그중 가압 탱크 2대 (가압회차 시간 단축)
    kg_per_tank: 800,            // 탱크당 최대 800kg
    minutes_pressure: 150,       // 가압 회차 = 2시간 30분
    minutes_normal: 240,         // 비가압 회차 = 4시간
    workers_per_batch: 2,        // 회차당 2명
    // 제품별 가압 가능 여부 (false = 가압 불가, FC만)
    pressure_allowed: {
      'FC 장조림 3KG': false,
      '기본값': true
    }
  },
  shredding_kg_per_manhour: 18.5,  // 파쇄 1인시간당 kg
  packing_ea_per_manhour: {        // 내포장 제품별 EA/인시
    '코스트코 장조림 170g': 291,
    '시그니처 장조림 130g': 251,
    '시그니처 장조림 130g 마트용': 203,
    'FC 장조림 3KG': 45,
    '미니쇠고기장조림 70g 낱개': 327,
    '메추리알 장조림 180g': 273,
    '기본값': 200
  },
  retort: {
    machines: 3,           // 레토르트 3대
    carts_per_batch: 4,    // 1회차 4대차
    minutes_per_batch: 150,// 회차당 150분
    workers_per_batch: 2,  // 회차당 인원
    ea_per_cart: {         // 대차당 EA (제품별)
      '시그니처 장조림 130g': 800,
      '시그니처 장조림 130g 마트용': 800,
      '코스트코 장조림 170g': 800,
      'FC 장조림 3KG': 96,
      '기본값': 500
    }
  },
  // 공정 수율 (원육 대비)
  yield: {
    preprocess: 0.89,  // 원육 → 전처리 89%
    cooking: 0.58,    // 전처리 → 자숙 58% (=> 원육의 51%)
    shredding: 0.97,  // 자숙 → 파쇄 97% (=> 원육의 50%)
  }
};

// ============================================================
// 입력 검증 + 시뮬레이션 진입점
// ============================================================
async function _ppRunSimulation(){
  // 시간대별 출근 수집
  var shifts = [];
  document.querySelectorAll('.pp-shift-row').forEach(function(row){
    var time = row.querySelector('.pp-shift-time').value;
    var w = parseInt(row.querySelector('.pp-shift-workers').value, 10) || 0;
    if(time && w > 0) shifts.push({ time: time, workers: w });
  });
  if(!shifts.length){
    alert('출근 시간대를 1개 이상 입력하세요.');
    return;
  }
  // 시간순 정렬
  shifts.sort(function(a,b){ return _ppToMin(a.time) - _ppToMin(b.time); });

  var maxEndStr = document.getElementById('pp_maxEnd').value || '18:00';

  // 제품 + 원육 kg 수집
  var products = [];
  document.querySelectorAll('.pp-prod-row').forEach(function(row){
    var name = row.querySelector('.pp-prod-name').value;
    var rawKg = parseFloat(row.querySelector('.pp-prod-rawkg').value) || 0;
    if(name && rawKg > 0) products.push({ name: name, rawKg: rawKg });
  });
  if(!products.length){
    alert('생산 작업을 1개 이상 입력하세요.');
    return;
  }

  // 총 가용 인원 (시간대 합계)
  var totalWorkers = shifts.reduce(function(s,sh){return s + sh.workers;}, 0);

  var input = {
    shifts: shifts,            // [{time, workers}, ...]
    startTime: shifts[0].time, // 가장 빠른 출근 = 작업 시작
    maxEnd: maxEndStr,
    workers: totalWorkers,
    products: products
  };

  // 두 시나리오 시뮬레이션
  var scA = _ppSimulate(input, 'morning'); // 내포장 오전 시작
  var scB = _ppSimulate(input, 'afternoon');// 내포장 오후 시작

  _ppRenderResult(input, scA, scB);
}

// ============================================================
// 시뮬레이션 엔진 (Flow-based)
// ============================================================
function _ppSimulate(input, mode){
  var startMin = _ppToMin(input.startTime);
  var maxEndMin = _ppToMin(input.maxEnd);

  // 1. 입력은 원육 kg → 각 공정 산출 kg 정방향 계산
  var rawKg = input.products.reduce(function(s,p){return s + p.rawKg;}, 0);
  var ppOutKg = rawKg * PP_STD.yield.preprocess;       // 원육 → 전처리
  var cookOutKg = ppOutKg * PP_STD.yield.cooking;      // 전처리 → 자숙
  var shredOutKg = cookOutKg * PP_STD.yield.shredding; // 자숙 → 파쇄
  // 내포장 EA = 파쇄 kg / kgEA (제품별 분배는 입력 비율로)
  var totalPackKg = shredOutKg;
  // 제품별 EA 환산 (kgEA 사용)
  var totalQty = 0;
  var prodEa = [];
  input.products.forEach(function(p){
    var prod = (L.products||[]).find(function(x){return x.name === p.name;});
    var kgEa = prod ? prod.kgea : 0.025;
    // 이 제품의 비율
    var ratio = rawKg > 0 ? p.rawKg / rawKg : 0;
    var pkKg = totalPackKg * ratio;
    var ea = Math.round(pkKg / kgEa);
    prodEa.push({ name: p.name, qty: ea, kgea: kgEa });
    totalQty += ea;
  });

  // 2. 자숙 회차 계산 — 제품별로 가압가능/불가 분리
  var ckRule = PP_STD.cooking;
  var prodPressureKg = 0, prodNormalKg = 0;
  input.products.forEach(function(p){
    var canPressure = ckRule.pressure_allowed[p.name];
    if(canPressure === undefined) canPressure = ckRule.pressure_allowed['기본값'];
    var pkProdCookKg = p.rawKg * PP_STD.yield.preprocess;
    if(canPressure) prodPressureKg += pkProdCookKg;
    else prodNormalKg += pkProdCookKg;
  });
  var pressureTankCapacity = ckRule.tanks_pressure * ckRule.kg_per_tank;     // 1600
  var allTankCapacity = ckRule.tanks_total * ckRule.kg_per_tank;             // 4800
  var pressureBatches = prodPressureKg > 0 ? Math.ceil(prodPressureKg / pressureTankCapacity) : 0;
  var normalBatches = prodNormalKg > 0 ? Math.ceil(prodNormalKg / allTankCapacity) : 0;
  var cookHours = (pressureBatches * ckRule.minutes_pressure + normalBatches * ckRule.minutes_normal) / 60;
  var cookBatches = pressureBatches + normalBatches;

  // 3. 인원 배분 — 가용 인원 = 출근 시간대 합계
  var cookWorkers = ckRule.workers_per_batch;
  var retortWorkers = PP_STD.retort.workers_per_batch;
  var flexWorkers = input.workers - cookWorkers - retortWorkers;
  if(flexWorkers <= 0){
    return { feasible: false, reason: '가용 인원 부족 (자숙 2명 + 레토르트 2명 + 나머지 공정 필요)' };
  }

  // 모드별 인원 분배
  var alloc;
  if(mode === 'morning'){
    alloc = {
      preprocess: Math.max(2, Math.round(flexWorkers * 0.30)),
      shredding:  Math.max(2, Math.round(flexWorkers * 0.25)),
      packing:    Math.max(4, Math.round(flexWorkers * 0.45))
    };
  } else {
    alloc = {
      preprocess: Math.max(2, Math.round(flexWorkers * 0.45)),
      shredding:  Math.max(2, Math.round(flexWorkers * 0.25)),
      packing:    Math.max(4, Math.round(flexWorkers * 0.30))
    };
  }
  var allocSum = alloc.preprocess + alloc.shredding + alloc.packing;
  while(allocSum > flexWorkers){
    if(alloc.packing > 2){ alloc.packing--; allocSum--; }
    else if(alloc.preprocess > 2){ alloc.preprocess--; allocSum--; }
    else break;
  }
  var leftover = input.workers - cookWorkers - retortWorkers - alloc.preprocess - alloc.shredding - alloc.packing;

  // 4. 공정별 소요시간
  var ppHours = ppOutKg / (PP_STD.preprocess_kg_per_manhour * alloc.preprocess);
  var shHours = shredOutKg / (PP_STD.shredding_kg_per_manhour * alloc.shredding);
  var pkRateAvg = _ppAvgPackRate(prodEa);
  var pkHours = totalQty / (pkRateAvg * alloc.packing);

  // 5. 공정 시작 시점 — 시간대별 출근 고려
  // 전처리 시작: 첫 출근 시간 + 전처리 인원이 충분히 모인 시점
  // 단순화: 첫 출근 시점부터 전처리 시작 (조출이 전처리 담당 가정)
  var ppStart = startMin;
  var ppEnd = ppStart + ppHours * 60;

  // 자숙: 전처리 첫 케이지 분량 쌓이면 (전체의 15%)
  var cookStart = ppStart + (ppHours * 60) * 0.15;
  var cookEnd = cookStart + cookHours * 60;

  // 파쇄: 자숙 첫 회차 끝나면 (가압 회차 있으면 가압 우선이라 150분, 없으면 240분)
  var firstBatchMin = pressureBatches > 0 ? ckRule.minutes_pressure : ckRule.minutes_normal;
  var shStart = cookStart + firstBatchMin;
  var shEnd = shStart + shHours * 60;

  // 내포장
  var pkStart;
  if(mode === 'morning'){
    pkStart = shStart + (shHours * 60) * 0.05;
  } else {
    pkStart = shStart + (shHours * 60) * 0.50;
  }
  var pkEnd = pkStart + pkHours * 60;

  // 레토르트
  var retortStart = pkStart + (pkHours * 60) * 0.15;
  var firstRetortEaPerCart = (PP_STD.retort.ea_per_cart[input.products[0].name] || PP_STD.retort.ea_per_cart['기본값']);
  var firstRetortCarts = Math.ceil(totalQty / firstRetortEaPerCart);
  var retortBatches = Math.ceil(firstRetortCarts / (PP_STD.retort.machines * PP_STD.retort.carts_per_batch));
  var retortHours = retortBatches * (PP_STD.retort.minutes_per_batch / 60);
  var retortEnd = retortStart + retortHours * 60;

  var endTime = pkEnd;
  var feasible = endTime <= maxEndMin;

  return {
    mode: mode,
    feasible: feasible,
    alloc: alloc,
    cookWorkers: cookWorkers,
    retortWorkers: retortWorkers,
    leftover: leftover,
    rawKg: rawKg,
    ppOutKg: ppOutKg,
    cookOutKg: cookOutKg,
    shredOutKg: shredOutKg,
    totalPackKg: totalPackKg,
    totalQty: totalQty,
    prodEa: prodEa,
    cookBatches: cookBatches,
    pressureBatches: pressureBatches,
    normalBatches: normalBatches,
    retortBatches: retortBatches,
    timeline: {
      pp: { start: ppStart, end: ppEnd },
      cook: { start: cookStart, end: cookEnd },
      sh: { start: shStart, end: shEnd },
      pk: { start: pkStart, end: pkEnd },
      retort: { start: retortStart, end: retortEnd }
    },
    endTime: endTime,
    overrun: feasible ? 0 : (endTime - maxEndMin)
  };
}

function _ppAvgPackRate(prodEa){
  var totalQty = prodEa.reduce(function(s,p){return s+p.qty;}, 0);
  var weighted = 0;
  prodEa.forEach(function(p){
    var rate = PP_STD.packing_ea_per_manhour[p.name] || PP_STD.packing_ea_per_manhour['기본값'];
    weighted += rate * p.qty;
  });
  return totalQty > 0 ? weighted / totalQty : PP_STD.packing_ea_per_manhour['기본값'];
}

function _ppToMin(t){ var p = t.split(':'); return (+p[0])*60 + (+p[1]); }
function _ppToTime(m){
  m = Math.round(m);
  var h = Math.floor(m/60), mi = m % 60;
  return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0');
}

// ============================================================
// 결과 렌더 (디자인 — 두 시나리오 비교 + 추천)
// ============================================================
function _ppRenderResult(input, scA, scB){
  var el = document.getElementById('pp_result');
  if(!el) return;

  // 추천 결정
  var rec = null;
  if(scA.feasible && scB.feasible){
    rec = (scA.endTime <= scB.endTime) ? scA : scB;
  } else if(scA.feasible){
    rec = scA;
  } else if(scB.feasible){
    rec = scB;
  } else {
    // 둘 다 불가 — 종료시간 빠른 쪽 (가까운 쪽)
    rec = (scA.endTime <= scB.endTime) ? scA : scB;
  }

  var recLabel = rec === scA ? '내포장 오전 시작' : '내포장 오후 시작';
  var recBadge = rec.feasible
    ? '<span style="background:#dcfce7;color:#15803d;border-radius:4px;padding:3px 10px;font-size:12px;font-weight:700">✅ 가능</span>'
    : '<span style="background:#fee2e2;color:#b91c1c;border-radius:4px;padding:3px 10px;font-size:12px;font-weight:700">❌ 종료시간 초과</span>';

  var html = '';

  // 추천 요약 헤더
  html += '<div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);color:#fff;border-radius:12px;padding:20px 24px;margin-bottom:18px;box-shadow:0 4px 14px rgba(59,130,246,0.25)">';
  html += '  <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:12px;background:rgba(255,255,255,0.25);padding:3px 10px;border-radius:20px;font-weight:600">추천</span>'+recBadge+'</div>';
  html += '  <div style="font-size:22px;font-weight:700;margin-bottom:4px">'+recLabel+'</div>';
  html += '  <div style="font-size:14px;opacity:0.9">필요 인원 <b>'+input.workers+'명</b> · 종료 <b>'+_ppToTime(rec.endTime)+'</b>';
  if(!rec.feasible) html += ' <span style="color:#fbbf24">(최대 종료시간 '+_ppToTime(_ppToMin(input.maxEnd))+'보다 '+Math.round(rec.overrun)+'분 초과)</span>';
  html += '</div>';
  html += '</div>';

  // 두 시나리오 비교 카드
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">';
  html += _ppRenderScenarioCard(scA, '🌅 내포장 오전 시작', rec === scA);
  html += _ppRenderScenarioCard(scB, '🌆 내포장 오후 시작', rec === scB);
  html += '</div>';

  // 추천 시나리오 상세 타임라인
  html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:18px">';
  html += '<h3 style="margin:0 0 14px;font-size:15px;color:#1e293b;font-weight:700">📋 추천 시나리오 상세 — '+recLabel+'</h3>';
  html += _ppRenderTimeline(rec);
  html += '</div>';

  // 인원 산출 근거
  html += '<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:18px">';
  html += '<h3 style="margin:0 0 14px;font-size:15px;color:#1e293b;font-weight:700">🧮 인원 산출 근거</h3>';
  html += _ppRenderWorkforceReason(input, rec);
  html += '</div>';

  el.innerHTML = html;
}

function _ppRenderScenarioCard(sc, title, isRec){
  var bg = isRec ? '#eff6ff' : '#fff';
  var border = isRec ? '2px solid #3b82f6' : '1px solid #e5e7eb';
  var feasibleBadge = sc.feasible
    ? '<span style="background:#dcfce7;color:#15803d;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">✅ 가능</span>'
    : '<span style="background:#fee2e2;color:#b91c1c;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">❌ 시간 초과</span>';
  var html = '<div style="background:'+bg+';border:'+border+';border-radius:10px;padding:16px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
  html += '<div style="font-weight:700;color:#1e293b;font-size:14px">'+title+'</div>'+feasibleBadge+'</div>';
  html += '<div style="font-size:13px;line-height:1.7;color:#475569">';
  html += '<div>종료시간: <b style="color:#1e40af">'+_ppToTime(sc.endTime)+'</b></div>';
  html += '<div>내포장 시작: <b>'+_ppToTime(sc.timeline.pk.start)+'</b></div>';
  html += '<div>전처리: '+sc.alloc.preprocess+'명 / 파쇄: '+sc.alloc.shredding+'명 / 내포장: '+sc.alloc.packing+'명</div>';
  html += '<div>잉여 인력: <b style="color:#16a34a">'+sc.leftover+'명</b> (외포장 가능)</div>';
  html += '</div></div>';
  return html;
}

function _ppRenderTimeline(sc){
  var t = sc.timeline;
  var rows = [
    { name: '🥩 전처리', start: t.pp.start, end: t.pp.end, w: sc.alloc.preprocess, color: '#fbbf24' },
    { name: '🍲 자숙',   start: t.cook.start, end: t.cook.end, w: sc.cookWorkers, color: '#f87171' },
    { name: '🔪 파쇄',   start: t.sh.start, end: t.sh.end, w: sc.alloc.shredding, color: '#a78bfa' },
    { name: '📦 내포장', start: t.pk.start, end: t.pk.end, w: sc.alloc.packing, color: '#34d399' },
    { name: '🔥 레토르트', start: t.retort.start, end: t.retort.end, w: sc.retortWorkers, color: '#fb923c' },
  ];
  // 시간 범위
  var minT = Math.min.apply(null, rows.map(function(r){return r.start;}));
  var maxT = Math.max.apply(null, rows.map(function(r){return r.end;}));
  var span = maxT - minT;
  var html = '<table style="width:100%;font-size:12px;border-collapse:collapse">';
  html += '<thead><tr style="background:#f1f5f9"><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;width:80px">공정</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:120px">시간</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:60px">인원</th><th style="padding:6px;border-bottom:1px solid #cbd5e1">바</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var leftPct = (r.start - minT) / span * 100;
    var widthPct = (r.end - r.start) / span * 100;
    html += '<tr style="border-bottom:1px solid #f1f5f9">';
    html += '<td style="padding:8px 8px;font-weight:600">'+r.name+'</td>';
    html += '<td style="text-align:center;padding:8px;color:#475569">'+_ppToTime(r.start)+' ~ '+_ppToTime(r.end)+'</td>';
    html += '<td style="text-align:center;padding:8px;font-weight:600">'+r.w+'명</td>';
    html += '<td style="padding:6px"><div style="position:relative;height:18px;background:#f1f5f9;border-radius:4px">';
    html += '<div style="position:absolute;left:'+leftPct+'%;width:'+widthPct+'%;height:100%;background:'+r.color+';border-radius:4px"></div>';
    html += '</div></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function _ppRenderWorkforceReason(input, sc){
  var prodList = input.products.map(function(p){return p.name+' 원육 '+p.rawKg.toLocaleString()+'kg';}).join(' + ');
  var shiftList = input.shifts.map(function(s){return s.time+'('+s.workers+'명)';}).join(' / ');
  var html = '<div style="font-size:13px;line-height:1.9;color:#334155">';
  html += '<div style="margin-bottom:6px"><b>작업량:</b> '+prodList+' (원육 총 '+sc.rawKg.toFixed(0)+'kg → 완제품 '+sc.totalQty.toLocaleString()+'EA)</div>';
  html += '<div style="margin-bottom:6px"><b>출근 시간대:</b> '+shiftList+' (총 '+input.workers+'명)</div>';

  // 자숙 회차 상세
  if(sc.pressureBatches > 0 || sc.normalBatches > 0){
    var batchDetail = [];
    if(sc.pressureBatches > 0) batchDetail.push('가압 회차 '+sc.pressureBatches+'회 (2시간 30분/회)');
    if(sc.normalBatches > 0) batchDetail.push('비가압 회차 '+sc.normalBatches+'회 (4시간/회)');
    html += '<div style="margin-bottom:14px"><b>자숙 회차:</b> '+batchDetail.join(' + ')+'</div>';
  }

  html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:8px">';
  html += '<div style="font-weight:600;color:#1e40af;margin-bottom:8px">공정별 인원 배치 근거</div>';
  html += '<div style="margin-bottom:4px">• <b>자숙 '+sc.cookWorkers+'명</b> — 표준값 (회차당 2명 고정)</div>';
  html += '<div style="margin-bottom:4px">• <b>레토르트 '+sc.retortWorkers+'명</b> — 표준값 (회차당 2명 고정)</div>';
  html += '<div style="margin-bottom:4px">• <b>전처리 '+sc.alloc.preprocess+'명</b> — '+sc.ppOutKg.toFixed(0)+'kg 처리 / '+PP_STD.preprocess_kg_per_manhour+'kg/인시 = 약 '+(sc.ppOutKg/PP_STD.preprocess_kg_per_manhour/sc.alloc.preprocess).toFixed(1)+'시간 소요</div>';
  html += '<div style="margin-bottom:4px">• <b>파쇄 '+sc.alloc.shredding+'명</b> — '+sc.shredOutKg.toFixed(0)+'kg 처리 / '+PP_STD.shredding_kg_per_manhour+'kg/인시 = 약 '+(sc.shredOutKg/PP_STD.shredding_kg_per_manhour/sc.alloc.shredding).toFixed(1)+'시간 소요</div>';
  var pkRate = _ppAvgPackRate(sc.prodEa);
  html += '<div style="margin-bottom:4px">• <b>내포장 '+sc.alloc.packing+'명</b> — '+sc.totalQty.toLocaleString()+'EA 처리 / 약 '+pkRate.toFixed(0)+'EA/인시 = 약 '+(sc.totalQty/pkRate/sc.alloc.packing).toFixed(1)+'시간 소요</div>';
  if(sc.leftover > 0){
    html += '<div style="margin-top:8px;color:#16a34a">✓ <b>잉여 '+sc.leftover+'명</b> — 외포장·제수 작업에 자동 투입 가능</div>';
  } else if(sc.leftover === 0){
    html += '<div style="margin-top:8px;color:#64748b">○ 가용 인원 모두 본 공정에 투입됨 (외포장은 본 작업 종료 후)</div>';
  } else {
    html += '<div style="margin-top:8px;color:#dc2626">⚠ 가용 인원 부족 — '+(-sc.leftover)+'명 추가 필요</div>';
  }
  html += '</div>';

  if(sc.feasible){
    html += '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:10px 14px;color:#15803d;font-weight:600">✅ 이 작업은 '+input.workers+'명으로 가능합니다. 종료 예정: '+_ppToTime(sc.endTime)+'</div>';
  } else {
    var addWorkers = Math.ceil(sc.overrun / 30);
    html += '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;color:#92400e">';
    html += '⚠️ <b>이 작업은 무리</b> — 종료시간이 '+_ppToTime(_ppToMin(input.maxEnd))+'을 '+Math.round(sc.overrun)+'분 초과 ('+_ppToTime(sc.endTime)+' 종료 예상)<br>';
    html += '<span style="font-size:12px">대안: 인원 약 '+addWorkers+'명 추가 / 수량 감소 / 시작시간 앞당기기</span>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// ============================================================
// 화면 렌더 (입력 폼)
// ============================================================
function renderProductionPlan(){
  var pg = document.getElementById('p-production_plan');
  if(!pg) return;

  var productOptions = (L.products || []).map(function(p){
    return '<option value="'+p.name+'">'+p.name+'</option>';
  }).join('');

  pg.innerHTML = ''
    + '<div style="max-width:1200px;margin:0 auto;padding:0 8px">'
    + '  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px">'
    + '    <h2 style="margin:0 0 14px;font-size:16px;color:#1e293b">📅 생산 계획 시뮬레이션</h2>'
    + '    <p style="margin:0 0 16px;font-size:12px;color:#64748b">시간대별 출근 인원과 원육 kg을 입력하면 두 시나리오(내포장 오전 시작 vs 오후 시작)를 시뮬레이션하여 추천합니다.</p>'

    // 시간대별 출근
    + '    <div style="margin-bottom:14px">'
    + '      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    + '        <label style="font-size:12px;color:#64748b;font-weight:600">출근 시간대별 인원</label>'
    + '        <button onclick="_ppAddShiftRow()" style="background:#fff;border:1px solid #cbd5e1;padding:5px 12px;border-radius:5px;font-size:12px;color:#1e40af;cursor:pointer">+ 시간대 추가</button>'
    + '      </div>'
    + '      <div id="pp_shiftList">'
    + _ppShiftRowHtml('06:00', 6)
    + _ppShiftRowHtml('08:00', 22)
    + '      </div>'
    + '    </div>'

    // 최대 종료시간
    + '    <div style="margin-bottom:14px;max-width:360px">'
    + '      <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">최대 종료시간 (내포장 기준)</label>'
    + '      <input id="pp_maxEnd" type="time" value="18:00" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:5px">'
    + '    </div>'

    // 생산 작업 (원육 kg)
    + '    <div style="margin-bottom:14px">'
    + '      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    + '        <label style="font-size:12px;color:#64748b;font-weight:600">생산 작업 (원육 kg 기준)</label>'
    + '        <button onclick="_ppAddProdRow()" style="background:#fff;border:1px solid #cbd5e1;padding:5px 12px;border-radius:5px;font-size:12px;color:#1e40af;cursor:pointer">+ 작업 추가</button>'
    + '      </div>'
    + '      <div id="pp_prodList">'
    + _ppProdRowHtml(productOptions, '시그니처 장조림 130g', 1500)
    + '      </div>'
    + '    </div>'

    + '    <button onclick="_ppRunSimulation()" style="width:100%;background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">🚀 시뮬레이션 실행</button>'
    + '  </div>'

    + '  <div id="pp_result"></div>'
    + '</div>';
}

function _ppShiftRowHtml(time, workers){
  return ''
    + '<div class="pp-shift-row" style="display:grid;grid-template-columns:160px 1fr 40px;gap:8px;margin-bottom:6px;align-items:center">'
    + '  <input class="pp-shift-time" type="time" value="'+time+'" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'
    + '  <input class="pp-shift-workers" type="number" placeholder="인원 수" value="'+(workers||'')+'" min="1" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'
    + '  <button onclick="this.parentElement.remove()" style="background:#fee2e2;border:none;border-radius:5px;color:#dc2626;font-weight:700;cursor:pointer;height:34px">×</button>'
    + '</div>';
}

function _ppAddShiftRow(){
  var list = document.getElementById('pp_shiftList');
  if(!list) return;
  var div = document.createElement('div');
  div.innerHTML = _ppShiftRowHtml('08:00', '');
  list.appendChild(div.firstElementChild);
}

function _ppProdRowHtml(productOptions, defName, defRawKg){
  var opts = productOptions || '';
  if(defName){
    opts = opts.replace('value="'+defName+'"', 'value="'+defName+'" selected');
  }
  return ''
    + '<div class="pp-prod-row" style="display:grid;grid-template-columns:1fr 140px 40px;gap:8px;margin-bottom:6px">'
    + '  <select class="pp-prod-name" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'+opts+'</select>'
    + '  <input class="pp-prod-rawkg" type="number" placeholder="원육 kg" value="'+(defRawKg||'')+'" min="1" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'
    + '  <button onclick="this.parentElement.remove()" style="background:#fee2e2;border:none;border-radius:5px;color:#dc2626;font-weight:700;cursor:pointer">×</button>'
    + '</div>';
}

function _ppAddProdRow(){
  var productOptions = (L.products || []).map(function(p){
    return '<option value="'+p.name+'">'+p.name+'</option>';
  }).join('');
  var list = document.getElementById('pp_prodList');
  if(!list) return;
  var div = document.createElement('div');
  div.innerHTML = _ppProdRowHtml(productOptions, '', '');
  list.appendChild(div.firstElementChild);
}

window.renderProductionPlan = renderProductionPlan;
window._ppRunSimulation = _ppRunSimulation;
window._ppAddProdRow = _ppAddProdRow;
window._ppAddShiftRow = _ppAddShiftRow;
