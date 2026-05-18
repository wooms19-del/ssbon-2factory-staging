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
  cooking_workers_per_batch: 2,    // 자숙 회차당 인원
  cooking_batch_minutes: 120,      // 자숙 회차 시간 (2시간)
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
  var startStr = document.getElementById('pp_startTime').value || '06:00';
  var maxEndStr = document.getElementById('pp_maxEnd').value || '18:00';
  var availWorkers = parseInt(document.getElementById('pp_workers').value, 10) || 28;

  // 제품 수량 수집
  var products = [];
  document.querySelectorAll('.pp-prod-row').forEach(function(row){
    var name = row.querySelector('.pp-prod-name').value;
    var qty = parseInt(row.querySelector('.pp-prod-qty').value, 10) || 0;
    if(name && qty > 0) products.push({ name: name, qty: qty });
  });
  if(!products.length){
    alert('제품을 1개 이상 입력하세요.');
    return;
  }

  var input = {
    startTime: startStr,
    maxEnd: maxEndStr,
    workers: availWorkers,
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
  var totalQty = input.products.reduce(function(s,p){return s + p.qty;}, 0);

  // 1. 필요 파쇄 kg 역산 (제품 EA × kg/EA / 공정수율)
  var totalPackKg = 0;
  input.products.forEach(function(p){
    var prod = (L.products||[]).find(function(x){return x.name === p.name;});
    var kgEa = prod ? prod.kgea : 0.025;
    totalPackKg += p.qty * kgEa;
  });
  // 파쇄 산출 = 내포장 사용 kg (공정수율 99% 가정)
  var shredOutKg = totalPackKg / 0.99;
  // 자숙 산출 = 파쇄 산출 / 자숙→파쇄 수율
  var cookOutKg = shredOutKg / PP_STD.yield.shredding;
  // 전처리 산출 = 자숙 산출 / 전처리→자숙 수율
  var ppOutKg = cookOutKg / PP_STD.yield.cooking;
  // 원육 = 전처리 산출 / 전처리 수율
  var rawKg = ppOutKg / PP_STD.yield.preprocess;

  // 2. 각 공정 소요시간 (인원 배분 후 결정)
  // 자숙: 회차 수 = ceil(전처리산출 / 회차당처리량). 자숙 자체는 회차당 120분 고정.
  // 일단 자숙 한 회차당 처리량 = 약 300kg(타사 평균이지만 데이터 기반 추정)
  var cookKgPerBatch = 350; // 자숙 한 회차당 kg (대략)
  var cookBatches = Math.ceil(ppOutKg / cookKgPerBatch);

  // 3. 인원 배분 — 시작 시점 (전처리 + 자숙)
  // 모드별로 내포장 시작 시점 달라짐
  // - morning: 파쇄 1대차(~96EA, 약 25kg) 쌓이면 즉시 내포장 시작
  // - afternoon: 파쇄 충분히(전체의 30~50%) 쌓인 후 내포장 시작

  // 공정 작업 시간 계산 (인원 1명 기준 시간, 실제는 N명으로 분담)
  var cookWorkers = PP_STD.cooking_workers_per_batch; // 2명 고정
  var retortWorkers = PP_STD.retort.workers_per_batch; // 2명 고정

  // 전처리 + 파쇄 + 내포장 인원 분배
  // 가용 인원 - 자숙 2 - 레토르트 2 = 나머지로 전처리/파쇄/내포장
  var flexWorkers = input.workers - cookWorkers - retortWorkers;
  if(flexWorkers <= 0){
    return { feasible: false, reason: '가용 인원 부족 (자숙 2명 + 레토르트 2명 + 나머지 공정 필요)' };
  }

  // ★ 모드별 인원 분배 전략
  // morning: 전처리 적게, 내포장 일찍 시작 + 많이
  // afternoon: 전처리 풀, 내포장 오후 시작
  var alloc;
  if(mode === 'morning'){
    // 전처리 30% / 파쇄 25% / 내포장 45%
    alloc = {
      preprocess: Math.max(2, Math.round(flexWorkers * 0.30)),
      shredding:  Math.max(2, Math.round(flexWorkers * 0.25)),
      packing:    Math.max(4, Math.round(flexWorkers * 0.45))
    };
  } else {
    // 전처리 45% / 파쇄 25% / 내포장 30%
    alloc = {
      preprocess: Math.max(2, Math.round(flexWorkers * 0.45)),
      shredding:  Math.max(2, Math.round(flexWorkers * 0.25)),
      packing:    Math.max(4, Math.round(flexWorkers * 0.30))
    };
  }
  // 합계 조정 (반올림 오차)
  var allocSum = alloc.preprocess + alloc.shredding + alloc.packing;
  while(allocSum > flexWorkers){
    if(alloc.packing > 2){ alloc.packing--; allocSum--; }
    else if(alloc.preprocess > 2){ alloc.preprocess--; allocSum--; }
    else break;
  }

  // 잉여 인력 (외포장 등)
  var leftover = input.workers - cookWorkers - retortWorkers - alloc.preprocess - alloc.shredding - alloc.packing;

  // 4. 공정별 소요시간 계산
  // 전처리: kg / (kg/인시 × 인원)
  var ppHours = ppOutKg / (PP_STD.preprocess_kg_per_manhour * alloc.preprocess);
  // 자숙: 회차 수 × 회차시간 (자숙은 직렬, 회차당 120분)
  var cookHours = cookBatches * (PP_STD.cooking_batch_minutes / 60);
  // 파쇄: kg / (kg/인시 × 인원)
  var shHours = shredOutKg / (PP_STD.shredding_kg_per_manhour * alloc.shredding);
  // 내포장: EA / (EA/인시 × 인원) - 제품별 가중평균
  var pkRateAvg = _ppAvgPackRate(input.products);
  var pkHours = totalQty / (pkRateAvg * alloc.packing);

  // 5. 공정 시작 시점 (Flow-based)
  // 전처리 시작 = startMin
  // 자숙 시작 = 전처리 첫 케이지 분량 (~250kg) 쌓이면 시작 (전체의 약 15%)
  // 파쇄 시작 = 자숙 첫 와건 (~150kg) 쌓이면 시작 (자숙 회차 1회 후)
  // 내포장 시작 (mode별):
  //   morning: 파쇄 1대차(~25kg) 쌓이는 시점
  //   afternoon: 파쇄 50% 쌓이는 시점

  var ppStart = startMin;
  var ppEnd = ppStart + ppHours * 60;

  // 자숙: 전처리 첫 케이지 분량 쌓이면 즉시. 첫 케이지 = ppOutKg의 15% 가정
  var cookFirstBatchReady = ppStart + (ppHours * 60) * 0.15;
  var cookStart = cookFirstBatchReady;
  var cookEnd = cookStart + cookHours * 60;

  // 파쇄: 자숙 첫 회차 끝나면 시작 (= cookStart + 120분)
  var shStart = cookStart + PP_STD.cooking_batch_minutes;
  var shEnd = shStart + shHours * 60;

  // 내포장
  var pkStart;
  if(mode === 'morning'){
    pkStart = shStart + (shHours * 60) * 0.05;  // 파쇄 5% (1대차) 쌓이면
  } else {
    pkStart = shStart + (shHours * 60) * 0.50;  // 파쇄 50% 쌓이면
  }
  var pkEnd = pkStart + pkHours * 60;

  // 레토르트: 내포장 첫 회차(4대차) 쌓이면 시작. 첫 회차 = 전체 EA의 약 15%
  var retortStart = pkStart + (pkHours * 60) * 0.15;
  // 레토르트 회차 수
  var firstRetortCarts = Math.ceil(totalQty / Object.values(PP_STD.retort.ea_per_cart)[0]); // 일단 첫 제품 기준
  var retortBatches = Math.ceil(firstRetortCarts / (PP_STD.retort.machines * PP_STD.retort.carts_per_batch));
  var retortHours = retortBatches * (PP_STD.retort.minutes_per_batch / 60);
  var retortEnd = retortStart + retortHours * 60;

  var endTime = pkEnd; // 사용자 기준: 내포장 종료 = 최종 종료시간
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
    cookBatches: cookBatches,
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

function _ppAvgPackRate(products){
  var totalQty = products.reduce(function(s,p){return s+p.qty;}, 0);
  var weighted = 0;
  products.forEach(function(p){
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
  var prodList = input.products.map(function(p){return p.name+' '+p.qty.toLocaleString()+'EA';}).join(' + ');
  var html = '<div style="font-size:13px;line-height:1.9;color:#334155">';
  html += '<div style="margin-bottom:6px"><b>작업량:</b> '+prodList+' (총 '+sc.totalQty.toLocaleString()+'EA)</div>';
  html += '<div style="margin-bottom:6px"><b>원육 필요:</b> 약 '+sc.rawKg.toFixed(0)+' kg (수율 역산)</div>';
  html += '<div style="margin-bottom:14px"><b>가용 인원:</b> '+input.workers+'명</div>';

  html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:8px">';
  html += '<div style="font-weight:600;color:#1e40af;margin-bottom:8px">공정별 인원 배치 근거</div>';
  html += '<div style="margin-bottom:4px">• <b>자숙 '+sc.cookWorkers+'명</b> — 표준값 (회차당 2명 고정)</div>';
  html += '<div style="margin-bottom:4px">• <b>레토르트 '+sc.retortWorkers+'명</b> — 표준값 (회차당 2명 고정)</div>';
  html += '<div style="margin-bottom:4px">• <b>전처리 '+sc.alloc.preprocess+'명</b> — '+sc.ppOutKg.toFixed(0)+'kg 처리 / '+PP_STD.preprocess_kg_per_manhour+'kg/인시 = 약 '+(sc.ppOutKg/PP_STD.preprocess_kg_per_manhour/sc.alloc.preprocess).toFixed(1)+'시간 소요</div>';
  html += '<div style="margin-bottom:4px">• <b>파쇄 '+sc.alloc.shredding+'명</b> — '+sc.shredOutKg.toFixed(0)+'kg 처리 / '+PP_STD.shredding_kg_per_manhour+'kg/인시 = 약 '+(sc.shredOutKg/PP_STD.shredding_kg_per_manhour/sc.alloc.shredding).toFixed(1)+'시간 소요</div>';
  html += '<div style="margin-bottom:4px">• <b>내포장 '+sc.alloc.packing+'명</b> — '+sc.totalQty.toLocaleString()+'EA 처리 / 약 '+_ppAvgPackRate(input.products).toFixed(0)+'EA/인시 = 약 '+(sc.totalQty/_ppAvgPackRate(input.products)/sc.alloc.packing).toFixed(1)+'시간 소요</div>';
  if(sc.leftover > 0){
    html += '<div style="margin-top:8px;color:#16a34a">✓ <b>잉여 '+sc.leftover+'명</b> — 외포장·제수 작업에 자동 투입 가능</div>';
  } else if(sc.leftover === 0){
    html += '<div style="margin-top:8px;color:#64748b">○ 가용 인원 모두 본 공정에 투입됨 (외포장은 본 작업 종료 후)</div>';
  } else {
    html += '<div style="margin-top:8px;color:#dc2626">⚠ 가용 인원 부족 — '+(-sc.leftover)+'명 추가 필요</div>';
  }
  html += '</div>';

  // 가능 여부 판정
  if(sc.feasible){
    html += '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:10px 14px;color:#15803d;font-weight:600">✅ 이 작업은 '+input.workers+'명으로 가능합니다. 종료 예정: '+_ppToTime(sc.endTime)+'</div>';
  } else {
    var addWorkers = Math.ceil(sc.overrun / 30); // 30분 단축당 1명 추가 가정 (rough)
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

  // 가용 인원 자동 (오늘 출퇴근 기반) — 일단 기본 28
  var defWorkers = 28;
  try {
    if(typeof db !== 'undefined' && db && typeof tod === 'function'){
      // attendance 비동기 fetch는 별도, 일단 기본값
    }
  } catch(e){}

  var productOptions = (L.products || []).map(function(p){
    return '<option value="'+p.name+'">'+p.name+'</option>';
  }).join('');

  pg.innerHTML = ''
    + '<div style="max-width:1200px;margin:0 auto;padding:0 8px">'
    + '  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:14px">'
    + '    <h2 style="margin:0 0 14px;font-size:16px;color:#1e293b">📅 생산 계획 시뮬레이션</h2>'
    + '    <p style="margin:0 0 16px;font-size:12px;color:#64748b">시작·종료시간과 제품·수량을 입력하면 두 가지 시나리오(내포장 오전 시작 vs 오후 시작)를 시뮬레이션하여 추천합니다.</p>'

    + '    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">'
    + '      <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">시작 시간</label>'
    + '        <input id="pp_startTime" type="time" value="06:00" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:5px"></div>'
    + '      <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">최대 종료시간 (내포장 기준)</label>'
    + '        <input id="pp_maxEnd" type="time" value="18:00" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:5px"></div>'
    + '      <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">가용 인원</label>'
    + '        <input id="pp_workers" type="number" value="'+defWorkers+'" min="1" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:5px"></div>'
    + '    </div>'

    + '    <div style="margin-bottom:14px">'
    + '      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    + '        <label style="font-size:12px;color:#64748b;font-weight:600">생산 제품 목록</label>'
    + '        <button onclick="_ppAddProdRow()" style="background:#fff;border:1px solid #cbd5e1;padding:5px 12px;border-radius:5px;font-size:12px;color:#1e40af;cursor:pointer">+ 제품 추가</button>'
    + '      </div>'
    + '      <div id="pp_prodList">'
    + _ppProdRowHtml(productOptions, '시그니처 장조림 130g', 8000)
    + '      </div>'
    + '    </div>'

    + '    <button onclick="_ppRunSimulation()" style="width:100%;background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">🚀 시뮬레이션 실행</button>'
    + '  </div>'

    + '  <div id="pp_result"></div>'
    + '</div>';
}

function _ppProdRowHtml(productOptions, defName, defQty){
  return ''
    + '<div class="pp-prod-row" style="display:grid;grid-template-columns:1fr 140px 40px;gap:8px;margin-bottom:6px">'
    + '  <select class="pp-prod-name" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'+(productOptions ? productOptions.replace('value="'+defName+'"', 'value="'+defName+'" selected') : '')+'</select>'
    + '  <input class="pp-prod-qty" type="number" placeholder="EA 수량" value="'+(defQty||'')+'" min="1" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'
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
