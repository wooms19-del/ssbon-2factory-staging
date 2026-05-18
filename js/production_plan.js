// ============================================================
// 생산 계획 시뮬레이션 v2 (production_plan.js)
// ============================================================
// 변경 사항 (v2):
//  - 내포장: 호기별 모델 (1호기 미니, 2호기 FC, 3·4호기 나머지) + 분당 EA
//  - 점심 교대 11:30~13:30 (인원 50%) 반영
//  - 자숙: 탱크 6대 (가압 2 + 일반 4), 회차당 800kg, 가압 2.5h / 비가압 4h
//  - 입력: 원육 kg 직접 + 시간대별 출근 인원
//  - 모드 비교: 내포장 오전 시작 vs 오후 시작
// ============================================================

var PP_STD = {
  preprocess_kg_per_manhour: 79,
  cooking: {
    tanks_total: 6,
    tanks_pressure: 2,
    kg_per_tank: 800,
    minutes_pressure: 150,
    minutes_normal: 240,
    workers_per_batch: 2,
    pressure_allowed: {
      'FC 장조림 3KG': false,
      '기본값': true
    }
  },
  shredding_kg_per_manhour: 18.5,
  packing_lines: [
    { id:1, name:'1호기', workers:12, ea_per_min:45 },
    { id:2, name:'2호기', workers:8,  ea_per_min:8  },
    { id:3, name:'3호기', workers:8,  ea_per_min:23 },
    { id:4, name:'4호기', workers:8,  ea_per_min:23 }
  ],
  retort: {
    machines: 3,
    carts_per_batch: 4,
    minutes_per_batch: 150,
    workers_per_batch: 2,
    ea_per_cart: {
      '시그니처 장조림 130g': 800,
      '시그니처 장조림 130g 마트용': 800,
      '코스트코 장조림 170g': 800,
      'FC 장조림 3KG': 96,
      '기본값': 500
    }
  },
  yield: {
    preprocess: 0.89,
    cooking: 0.58,
    shredding: 0.97
  },
  lunch: {
    startMin: 11*60 + 30,
    endMin: 13*60 + 30,
    workerRatio: 0.5
  }
};

// ============================================================
// 점심 교대 반영한 종료시각 계산
// ============================================================
function _ppWorkWithLunch(startMin, totalWorkMinutes){
  var LL = PP_STD.lunch;
  var t = startMin;
  var remain = totalWorkMinutes;
  if(t < LL.startMin){
    var beforeLunch = Math.min(LL.startMin - t, remain);
    remain -= beforeLunch;
    t += beforeLunch;
  }
  if(remain > 0 && t < LL.endMin){
    var lunchAvail = LL.endMin - t;
    var effectiveWork = lunchAvail * LL.workerRatio;
    if(effectiveWork >= remain){
      var portionUsed = remain / LL.workerRatio;
      return t + portionUsed;
    } else {
      remain -= effectiveWork;
      t = LL.endMin;
    }
  }
  return t + remain;
}

// ============================================================
// 시뮬레이션 진입
// ============================================================
async function _ppRunSimulation(){
  var shifts = [];
  document.querySelectorAll('.pp-shift-row').forEach(function(row){
    var time = row.querySelector('.pp-shift-time').value;
    var w = parseInt(row.querySelector('.pp-shift-workers').value, 10) || 0;
    if(time && w > 0) shifts.push({ time: time, workers: w });
  });
  if(!shifts.length){ alert('출근 시간대를 1개 이상 입력하세요.'); return; }
  shifts.sort(function(a,b){ return _ppToMin(a.time) - _ppToMin(b.time); });

  var maxEndStr = document.getElementById('pp_maxEnd').value || '18:00';

  var products = [];
  document.querySelectorAll('.pp-prod-row').forEach(function(row){
    var name = row.querySelector('.pp-prod-name').value;
    var rawKg = parseFloat(row.querySelector('.pp-prod-rawkg').value) || 0;
    if(name && rawKg > 0) products.push({ name: name, rawKg: rawKg });
  });
  if(!products.length){ alert('생산 작업을 1개 이상 입력하세요.'); return; }

  var totalWorkers = shifts.reduce(function(s,sh){return s+sh.workers;}, 0);

  var input = {
    shifts: shifts,
    startTime: shifts[0].time,
    maxEnd: maxEndStr,
    workers: totalWorkers,
    products: products
  };

  var scA = _ppSimulate(input, 'morning');
  var scB = _ppSimulate(input, 'afternoon');
  _ppRenderResult(input, scA, scB);
}

// ============================================================
// 시뮬레이션 엔진 v2
// ============================================================
function _ppSimulate(input, mode){
  var startMin = _ppToMin(input.startTime);
  var maxEndMin = _ppToMin(input.maxEnd);
  var ckRule = PP_STD.cooking;

  // 1. 원육 → 산출
  var rawKg = input.products.reduce(function(s,p){return s+p.rawKg;}, 0);
  var ppOutKg = rawKg * PP_STD.yield.preprocess;
  var cookOutKg = ppOutKg * PP_STD.yield.cooking;
  var shredOutKg = cookOutKg * PP_STD.yield.shredding;

  // 제품별 EA
  var prodEa = [];
  var totalQty = 0;
  input.products.forEach(function(p){
    var prod = (L.products||[]).find(function(x){return x.name === p.name;});
    var kgEa = prod ? prod.kgea : 0.025;
    var ratio = rawKg > 0 ? p.rawKg / rawKg : 0;
    var pkKg = shredOutKg * ratio;
    var ea = Math.round(pkKg / kgEa);
    prodEa.push({ name: p.name, qty: ea, kgea: kgEa, rawKg: p.rawKg });
    totalQty += ea;
  });

  // 2. 자숙 회차 (탱크 800kg씩, A모드: 잔량 먼저 → 빨리 시작)
  // 가압 가능 / 불가 분리 처리
  var prodPressureKg = 0, prodNormalKg = 0;
  input.products.forEach(function(p){
    var canPressure = ckRule.pressure_allowed[p.name];
    if(canPressure === undefined) canPressure = ckRule.pressure_allowed['기본값'];
    var ck = p.rawKg * PP_STD.yield.preprocess;
    if(canPressure) prodPressureKg += ck;
    else prodNormalKg += ck;
  });
  // 회차 = 탱크당 800kg, 잔량 먼저 분배
  var pressureCycles = prodPressureKg > 0 ? Math.ceil(prodPressureKg / ckRule.kg_per_tank) : 0;
  var normalCycles = prodNormalKg > 0 ? Math.ceil(prodNormalKg / ckRule.kg_per_tank) : 0;

  // 각 회차의 투입 kg (잔량 먼저 모드)
  function _makeTankKgs(totalKg, cycles){
    if(cycles === 0) return [];
    if(cycles === 1) return [totalKg];
    var arr = [];
    var remainder = Math.max(0, totalKg - (cycles - 1) * ckRule.kg_per_tank);
    arr.push(remainder); // 첫 회차 = 잔량 (작게)
    for(var i = 1; i < cycles; i++) arr.push(ckRule.kg_per_tank);
    return arr;
  }
  var pressureTankKgs = _makeTankKgs(prodPressureKg, pressureCycles);
  var normalTankKgs = _makeTankKgs(prodNormalKg, normalCycles);

  // 회차 수 (호환용)
  var pressureBatches = pressureCycles;
  var normalBatches = normalCycles;
  var cookBatches = pressureBatches + normalBatches;

  // 3. 내포장 호기 배정
  var lineAssignment = _ppAssignToLines(prodEa);
  var pkInfo = _ppCalcPackingHours(lineAssignment);
  var packingWorkers = pkInfo.totalWorkers;

  // 4. 인원 배분
  var cookWorkers = ckRule.workers_per_batch;
  var retortWorkers = PP_STD.retort.workers_per_batch;
  var flexForPpAndSh = input.workers - cookWorkers - retortWorkers - packingWorkers;
  if(flexForPpAndSh <= 0){
    return {
      feasible: false,
      reason: '인원 부족 — 내포장 호기 ' + packingWorkers + '명 + 자숙 2 + 레토르트 2 = ' + (packingWorkers+4) + '명 필요. 가용 ' + input.workers + '명',
      mode: mode,
      totalQty: totalQty, rawKg: rawKg,
      prodEa: prodEa, pkInfo: pkInfo,
      cookWorkers: cookWorkers, retortWorkers: retortWorkers,
      alloc: { preprocess: 0, shredding: 0, packing: packingWorkers },
      leftover: -(packingWorkers + 4 - input.workers),
      timeline: { pp:{start:0,end:0}, cook:{start:0,end:0}, sh:{start:0,end:0}, pk:{start:0,end:0}, retort:{start:0,end:0} },
      endTime: 0, overrun: 0,
      pressureBatches: pressureBatches, normalBatches: normalBatches,
      ppOutKg: ppOutKg, cookOutKg: cookOutKg, shredOutKg: shredOutKg
    };
  }

  var alloc;
  if(mode === 'morning'){
    alloc = {
      preprocess: Math.max(3, Math.round(flexForPpAndSh * 0.45)),
      shredding:  Math.max(3, Math.round(flexForPpAndSh * 0.55))
    };
  } else {
    alloc = {
      preprocess: Math.max(3, Math.round(flexForPpAndSh * 0.50)),
      shredding:  Math.max(3, Math.round(flexForPpAndSh * 0.50))
    };
  }
  if(alloc.preprocess + alloc.shredding > flexForPpAndSh){
    var over = alloc.preprocess + alloc.shredding - flexForPpAndSh;
    if(alloc.shredding - over >= 3) alloc.shredding -= over;
    else alloc.preprocess -= over;
  }
  alloc.packing = packingWorkers;
  var leftover = input.workers - cookWorkers - retortWorkers - alloc.preprocess - alloc.shredding - alloc.packing;

  // 5. 소요시간 (점심 반영)
  var ppPureMin = (ppOutKg / PP_STD.preprocess_kg_per_manhour / alloc.preprocess) * 60;
  var shPureMin = (shredOutKg / PP_STD.shredding_kg_per_manhour / alloc.shredding) * 60;
  var pkPureMin = pkInfo.runtimeMin;

  // 6. 공정 타임라인 — 전처리 누적량과 연동
  var ppStart = startMin;
  var ppEnd = _ppWorkWithLunch(ppStart, ppPureMin);
  // 전처리 시간당 산출 = preprocess_kg_per_manhour × 인원
  var ppKgPerMin = PP_STD.preprocess_kg_per_manhour * alloc.preprocess / 60;
  // 점심 시간대엔 절반
  // 단순화: 전체 ppOutKg을 ppPureMin에 풀어, 시점 t의 누적 산출 = ratio 계산
  // 누적 N kg에 도달하는 시점 = ppStart + (N / ppOutKg) × ppPureMin (점심 미반영, 단순화)
  function ppTimeAtKg(targetKg){
    if(targetKg <= 0) return ppStart;
    if(targetKg >= ppOutKg) return ppEnd;
    var ratio = targetKg / ppOutKg;
    return _ppWorkWithLunch(ppStart, ppPureMin * ratio);
  }

  // 자숙 회차별 투입 시각 (가압 회차 + 비가압 회차 합쳐서 시간순)
  // 누적 자숙 투입 kg 계산: 가압 먼저 → 비가압
  var cookSchedule = []; // [{batchIdx, type:'pressure'|'normal', kg, inTime, outTime}]
  var cumKg = 0;
  pressureTankKgs.forEach(function(kg, i){
    cumKg += kg;
    var inT = ppTimeAtKg(cumKg);
    var outT = inT + ckRule.minutes_pressure;
    cookSchedule.push({ type:'pressure', kg:kg, inTime: inT, outTime: outT });
  });
  normalTankKgs.forEach(function(kg, i){
    cumKg += kg;
    var inT = ppTimeAtKg(cumKg);
    var outT = inT + ckRule.minutes_normal;
    cookSchedule.push({ type:'normal', kg:kg, inTime: inT, outTime: outT });
  });

  var cookStart = cookSchedule.length ? cookSchedule[0].inTime : ppStart;
  var cookEnd = cookSchedule.length ? Math.max.apply(null, cookSchedule.map(function(s){return s.outTime;})) : ppEnd;
  var cookTotalMin = cookEnd - cookStart;

  // 파쇄: 자숙 첫 회차 종료 시점부터
  var shStart = cookSchedule.length ? cookSchedule[0].outTime : ppEnd;
  // 파쇄도 자숙 마지막 회차 산출량 처리하려면 그 시점 이후까지 진행
  var shEndByWork = _ppWorkWithLunch(shStart, shPureMin);
  // 자숙 마지막 회차 종료 + 그 회차 산출량 파쇄 시간
  var lastCookOut = cookSchedule.length ? cookSchedule[cookSchedule.length-1].outTime : ppEnd;
  var lastShredKg = cookSchedule.length ? cookSchedule[cookSchedule.length-1].kg * PP_STD.yield.shredding : 0;
  var lastShredMin = (lastShredKg / PP_STD.shredding_kg_per_manhour / alloc.shredding) * 60;
  var shEndByLastBatch = lastCookOut + lastShredMin;
  var shEnd = Math.max(shEndByWork, shEndByLastBatch);

  // 내포장
  var pkStart;
  if(mode === 'morning'){
    // 파쇄 1대차 분량 쌓이면 (약 96EA)
    pkStart = shStart + 30; // 파쇄 시작 30분 후 정도 (1대차 분량 쌓임)
  } else {
    pkStart = shStart + (shEnd - shStart) * 0.50;
  }
  var pkEnd = _ppWorkWithLunch(pkStart, pkPureMin);

  // 레토르트
  var retortStart = pkStart + pkPureMin * 0.15;
  var firstProd = input.products[0].name;
  var eaPerCart = PP_STD.retort.ea_per_cart[firstProd] || PP_STD.retort.ea_per_cart['기본값'];
  var totalCarts = Math.ceil(totalQty / eaPerCart);
  var retortBatches = Math.ceil(totalCarts / (PP_STD.retort.machines * PP_STD.retort.carts_per_batch));
  var retortTotalMin = retortBatches * PP_STD.retort.minutes_per_batch;
  var retortEnd = retortStart + retortTotalMin;

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
    totalQty: totalQty,
    prodEa: prodEa,
    cookBatches: cookBatches,
    pressureBatches: pressureBatches,
    normalBatches: normalBatches,
    cookSchedule: cookSchedule,
    pressureTankKgs: pressureTankKgs,
    normalTankKgs: normalTankKgs,
    retortBatches: retortBatches,
    pkInfo: pkInfo,
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

// 호기 배정
function _ppAssignToLines(prodEa){
  var lines = PP_STD.packing_lines.map(function(l){
    return { id:l.id, name:l.name, products:[], totalEa:0, workers:l.workers, ea_per_min:l.ea_per_min };
  });
  prodEa.forEach(function(p){
    if(p.name.indexOf('미니') >= 0){
      lines[0].products.push({name:p.name, qty:p.qty});
      lines[0].totalEa += p.qty;
    } else if(p.name.indexOf('FC') === 0 || p.name.indexOf('FC ') >= 0){
      lines[1].products.push({name:p.name, qty:p.qty});
      lines[1].totalEa += p.qty;
    } else {
      var half = Math.ceil(p.qty / 2);
      lines[2].products.push({name:p.name, qty:half});
      lines[2].totalEa += half;
      lines[3].products.push({name:p.name, qty:p.qty - half});
      lines[3].totalEa += (p.qty - half);
    }
  });
  return lines;
}

function _ppCalcPackingHours(lineAssignment){
  var maxLineMin = 0;
  var totalWorkers = 0;
  var activeLines = [];
  lineAssignment.forEach(function(l){
    if(l.totalEa > 0){
      var min = l.totalEa / l.ea_per_min;
      maxLineMin = Math.max(maxLineMin, min);
      totalWorkers += l.workers;
      activeLines.push({ id:l.id, name:l.name, ea:l.totalEa, workers:l.workers, ea_per_min:l.ea_per_min, minutes: min });
    }
  });
  return {
    totalWorkers: totalWorkers,
    runtimeMin: maxLineMin,
    lines: activeLines
  };
}

function _ppToMin(t){ var p = String(t).split(':'); return (+p[0])*60 + (+(p[1]||'0')); }
function _ppToTime(m){
  m = Math.max(0, Math.round(m));
  var h = Math.floor(m/60), mi = m % 60;
  return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0');
}

// ============================================================
// 결과 렌더
// ============================================================
function _ppRenderResult(input, scA, scB){
  var el = document.getElementById('pp_result');
  if(!el) return;

  var rec;
  if(scA.feasible && scB.feasible) rec = (scA.endTime <= scB.endTime) ? scA : scB;
  else if(scA.feasible) rec = scA;
  else if(scB.feasible) rec = scB;
  else rec = (scA.endTime <= scB.endTime) ? scA : scB;

  var recLabel = rec === scA ? '내포장 오전 시작' : '내포장 오후 시작';
  var recBadge = rec.feasible
    ? '<span style="background:#dcfce7;color:#15803d;border-radius:4px;padding:3px 10px;font-size:12px;font-weight:700">✅ 가능</span>'
    : '<span style="background:#fee2e2;color:#b91c1c;border-radius:4px;padding:3px 10px;font-size:12px;font-weight:700">❌ 종료시간 초과</span>';

  var html = '';

  html += '<div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);color:#fff;border-radius:12px;padding:20px 24px;margin-bottom:18px;box-shadow:0 4px 14px rgba(59,130,246,0.25)">';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:12px;background:rgba(255,255,255,0.25);padding:3px 10px;border-radius:20px;font-weight:600">추천</span>'+recBadge+'</div>';
  html += '<div style="font-size:22px;font-weight:700;margin-bottom:4px">'+recLabel+'</div>';
  html += '<div style="font-size:14px;opacity:0.9">필요 인원 <b>'+input.workers+'명</b> · 종료 <b>'+_ppToTime(rec.endTime)+'</b>';
  if(!rec.feasible) html += ' <span style="color:#fbbf24">(최대 '+_ppToTime(_ppToMin(input.maxEnd))+'보다 '+Math.round(rec.overrun)+'분 초과)</span>';
  html += '</div></div>';

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">';
  html += _ppRenderScenarioCard(scA, '🌅 내포장 오전 시작', rec === scA);
  html += _ppRenderScenarioCard(scB, '🌆 내포장 오후 시작', rec === scB);
  html += '</div>';

  // 호기별 가동
  if(rec.pkInfo && rec.pkInfo.lines.length){
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:18px">';
    html += '<h3 style="margin:0 0 12px;font-size:15px;color:#1e293b;font-weight:700">🏭 내포장 호기 배정 ('+recLabel+')</h3>';
    html += _ppRenderLines(rec);
    html += '</div>';
  }

  if(rec.feasible || rec.endTime > 0){
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:18px">';
    html += '<h3 style="margin:0 0 14px;font-size:15px;color:#1e293b;font-weight:700">📋 추천 시나리오 상세 — '+recLabel+'</h3>';
    html += _ppRenderTimeline(rec);
    html += '<div style="margin-top:8px;font-size:11px;color:#94a3b8">※ 점심 교대 11:30~13:30 (2조 교대, 작업속도 50%) 반영됨 (사선 음영)</div>';
    html += '</div>';
  }

  html += '<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:18px">';
  html += '<h3 style="margin:0 0 14px;font-size:15px;color:#1e293b;font-weight:700">🧮 인원 산출 근거</h3>';
  html += _ppRenderWorkforceReason(input, rec);
  html += '</div>';

  el.innerHTML = html;
}

function _ppRenderScenarioCard(sc, title, isRec){
  if(!sc.feasible && sc.reason){
    return '<div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:10px;padding:16px">'
      + '<div style="font-weight:700;color:#991b1b;font-size:14px;margin-bottom:6px">'+title+'</div>'
      + '<div style="font-size:12px;color:#7f1d1d">❌ '+sc.reason+'</div></div>';
  }
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
  html += '<div>잉여 인력: <b style="color:'+(sc.leftover>=0?'#16a34a':'#dc2626')+'">'+sc.leftover+'명</b></div>';
  html += '</div></div>';
  return html;
}

function _ppRenderLines(sc){
  var html = '<table style="width:100%;font-size:13px;border-collapse:collapse">';
  html += '<thead><tr style="background:#f1f5f9"><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1">호기</th><th style="text-align:left;padding:6px;border-bottom:1px solid #cbd5e1">제품</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">EA</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">분당 EA</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">가동 시간</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">인원</th></tr></thead><tbody>';
  sc.pkInfo.lines.forEach(function(l){
    var prodInfo = sc.prodEa.filter(function(p){
      if(l.id===1) return p.name.indexOf('미니')>=0;
      if(l.id===2) return p.name.indexOf('FC')===0;
      return p.name.indexOf('미니')<0 && p.name.indexOf('FC')!==0;
    }).map(function(p){return p.name;}).join(', ');
    html += '<tr style="border-bottom:1px solid #f1f5f9">';
    html += '<td style="padding:8px;font-weight:700;color:#1e40af">'+l.name+'</td>';
    html += '<td style="padding:8px;color:#475569">'+(prodInfo||'-')+'</td>';
    html += '<td style="text-align:center;padding:8px">'+l.ea.toLocaleString()+'</td>';
    html += '<td style="text-align:center;padding:8px;color:#64748b">'+l.ea_per_min+'</td>';
    html += '<td style="text-align:center;padding:8px;color:#1e40af;font-weight:600">'+(l.minutes/60).toFixed(1)+'h</td>';
    html += '<td style="text-align:center;padding:8px;font-weight:600">'+l.workers+'명</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function _ppRenderTimeline(sc){
  var t = sc.timeline;
  var rows = [
    { name: '🥩 전처리', start: t.pp.start, end: t.pp.end, w: sc.alloc.preprocess, color: '#fbbf24' },
    { name: '🍲 자숙',   start: t.cook.start, end: t.cook.end, w: sc.cookWorkers, color: '#f87171' },
    { name: '🔪 파쇄',   start: t.sh.start, end: t.sh.end, w: sc.alloc.shredding, color: '#a78bfa' },
    { name: '📦 내포장', start: t.pk.start, end: t.pk.end, w: sc.alloc.packing, color: '#34d399' },
    { name: '🔥 레토르트', start: t.retort.start, end: t.retort.end, w: sc.retortWorkers, color: '#fb923c' }
  ];
  var minT = Math.min.apply(null, rows.map(function(r){return r.start;}));
  var maxT = Math.max.apply(null, rows.map(function(r){return r.end;}));
  var span = Math.max(1, maxT - minT);

  var lunchStart = PP_STD.lunch.startMin;
  var lunchEnd = PP_STD.lunch.endMin;
  var lunchVisible = lunchStart >= minT && lunchEnd <= maxT;
  var lunchLeft = (lunchStart - minT) / span * 100;
  var lunchWidth = (lunchEnd - lunchStart) / span * 100;

  var html = '<table style="width:100%;font-size:12px;border-collapse:collapse">';
  html += '<thead><tr style="background:#f1f5f9"><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;width:80px">공정</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:130px">시간</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:60px">인원</th><th style="padding:6px;border-bottom:1px solid #cbd5e1">바</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var leftPct = (r.start - minT) / span * 100;
    var widthPct = (r.end - r.start) / span * 100;
    html += '<tr style="border-bottom:1px solid #f1f5f9">';
    html += '<td style="padding:8px;font-weight:600">'+r.name+'</td>';
    html += '<td style="text-align:center;padding:8px;color:#475569">'+_ppToTime(r.start)+' ~ '+_ppToTime(r.end)+'</td>';
    html += '<td style="text-align:center;padding:8px;font-weight:600">'+r.w+'명</td>';
    html += '<td style="padding:6px"><div style="position:relative;height:18px;background:#f1f5f9;border-radius:4px">';
    if(lunchVisible){
      html += '<div style="position:absolute;left:'+lunchLeft+'%;width:'+lunchWidth+'%;height:100%;background:repeating-linear-gradient(45deg,rgba(0,0,0,0.06),rgba(0,0,0,0.06) 4px,transparent 4px,transparent 8px);border-radius:4px" title="점심 교대"></div>';
    }
    html += '<div style="position:absolute;left:'+leftPct+'%;width:'+widthPct+'%;height:100%;background:'+r.color+';border-radius:4px;opacity:0.92"></div>';
    html += '</div></td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

function _ppRenderWorkforceReason(input, sc){
  var prodList = input.products.map(function(p){return p.name+' 원육 '+p.rawKg.toLocaleString()+'kg';}).join(' + ');
  var shiftList = input.shifts.map(function(s){return s.time+'('+s.workers+'명)';}).join(' / ');
  var html = '<div style="font-size:13px;line-height:1.9;color:#334155">';
  html += '<div style="margin-bottom:6px"><b>작업량:</b> '+prodList+' (원육 '+sc.rawKg.toFixed(0)+'kg → 완제품 '+sc.totalQty.toLocaleString()+'EA)</div>';
  html += '<div style="margin-bottom:6px"><b>출근 시간대:</b> '+shiftList+' (총 '+input.workers+'명)</div>';

  if(sc.pressureBatches > 0 || sc.normalBatches > 0){
    var bd = [];
    if(sc.pressureBatches > 0) bd.push('가압 회차 '+sc.pressureBatches+'회 (2.5h/회)');
    if(sc.normalBatches > 0) bd.push('비가압 회차 '+sc.normalBatches+'회 (4h/회)');
    html += '<div style="margin-bottom:6px"><b>자숙 회차:</b> '+bd.join(' + ')+'</div>';
    // 회차별 투입량 (잔량 먼저)
    if(sc.cookSchedule && sc.cookSchedule.length){
      var details = sc.cookSchedule.map(function(s, i){
        var typeLabel = s.type === 'pressure' ? '가압' : '비가압';
        return '#'+(i+1)+' '+typeLabel+' '+s.kg.toFixed(0)+'kg ('+_ppToTime(s.inTime)+'→'+_ppToTime(s.outTime)+')';
      }).join(' / ');
      html += '<div style="margin-bottom:14px;font-size:12px;color:#64748b">↳ '+details+'</div>';
    } else {
      html += '<div style="margin-bottom:14px"></div>';
    }
  }

  html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:8px">';
  html += '<div style="font-weight:600;color:#1e40af;margin-bottom:8px">공정별 인원 배치 근거</div>';
  html += '<div style="margin-bottom:4px">• <b>자숙 '+sc.cookWorkers+'명</b> — 회차당 2명 고정</div>';
  html += '<div style="margin-bottom:4px">• <b>레토르트 '+sc.retortWorkers+'명</b> — 회차당 2명 고정</div>';
  if(sc.alloc.preprocess > 0){
    html += '<div style="margin-bottom:4px">• <b>전처리 '+sc.alloc.preprocess+'명</b> — '+sc.ppOutKg.toFixed(0)+'kg / '+PP_STD.preprocess_kg_per_manhour+'kg/인시 = 약 '+(sc.ppOutKg/PP_STD.preprocess_kg_per_manhour/sc.alloc.preprocess).toFixed(1)+'h</div>';
    html += '<div style="margin-bottom:4px">• <b>파쇄 '+sc.alloc.shredding+'명</b> — '+sc.shredOutKg.toFixed(0)+'kg / '+PP_STD.shredding_kg_per_manhour+'kg/인시 = 약 '+(sc.shredOutKg/PP_STD.shredding_kg_per_manhour/sc.alloc.shredding).toFixed(1)+'h</div>';
  }
  html += '<div style="margin-bottom:4px">• <b>내포장 '+sc.alloc.packing+'명</b> — 호기 가동 합계 (위 호기 표 참조)</div>';
  if(sc.leftover > 0){
    html += '<div style="margin-top:8px;color:#16a34a">✓ <b>잉여 '+sc.leftover+'명</b> — 외포장·제수 작업 가능</div>';
  } else if(sc.leftover === 0){
    html += '<div style="margin-top:8px;color:#64748b">○ 가용 인원 모두 본 공정에 투입됨</div>';
  } else {
    html += '<div style="margin-top:8px;color:#dc2626">⚠ 가용 인원 부족 — '+(-sc.leftover)+'명 추가 필요</div>';
  }
  html += '</div>';

  if(sc.feasible){
    html += '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:10px 14px;color:#15803d;font-weight:600">✅ 이 작업은 '+input.workers+'명으로 가능합니다. 종료 예정: '+_ppToTime(sc.endTime)+'</div>';
  } else if(sc.endTime > 0){
    html += '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;color:#92400e">';
    html += '⚠️ <b>이 작업은 무리</b> — 종료시간 '+_ppToTime(_ppToMin(input.maxEnd))+'을 '+Math.round(sc.overrun)+'분 초과 ('+_ppToTime(sc.endTime)+' 종료)<br>';
    html += '<span style="font-size:12px">대안: 인원 추가 / 수량 감소 / 시작시간 앞당기기</span>';
    html += '</div>';
  } else {
    html += '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:10px 14px;color:#991b1b;font-weight:600">❌ '+sc.reason+'</div>';
  }

  html += '</div>';
  return html;
}

// ============================================================
// 입력 폼
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
    + '    <p style="margin:0 0 16px;font-size:12px;color:#64748b">호기별 모델 + 점심 교대(11:30~13:30) + 자숙 탱크 6대 룰 반영</p>'

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

    + '    <div style="margin-bottom:14px;max-width:360px">'
    + '      <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">최대 종료시간 (내포장 기준)</label>'
    + '      <input id="pp_maxEnd" type="time" value="18:00" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:5px">'
    + '    </div>'

    + '    <div style="margin-bottom:14px">'
    + '      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    + '        <label style="font-size:12px;color:#64748b;font-weight:600">생산 작업 (원육 kg)</label>'
    + '        <button onclick="_ppAddProdRow()" style="background:#fff;border:1px solid #cbd5e1;padding:5px 12px;border-radius:5px;font-size:12px;color:#1e40af;cursor:pointer">+ 작업 추가</button>'
    + '      </div>'
    + '      <div id="pp_prodList">'
    + _ppProdRowHtml(productOptions, '시그니처 장조림 130g', 800)
    + '      </div>'
    + '    </div>'

    + '    <button onclick="_ppRunSimulation()" style="width:100%;background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:12px;font-size:14px;font-weight:700;cursor:pointer">🚀 시뮬레이션 실행</button>'
    + '  </div>'

    + '  <div id="pp_result"></div>'
    + '</div>';
}

function _ppShiftRowHtml(time, workers){
  return '<div class="pp-shift-row" style="display:grid;grid-template-columns:160px 1fr 40px;gap:8px;margin-bottom:6px;align-items:center">'
    + '<input class="pp-shift-time" type="time" value="'+time+'" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'
    + '<input class="pp-shift-workers" type="number" placeholder="인원" value="'+(workers||'')+'" min="1" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'
    + '<button onclick="this.parentElement.remove()" style="background:#fee2e2;border:none;border-radius:5px;color:#dc2626;font-weight:700;cursor:pointer;height:34px">×</button>'
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
  if(defName) opts = opts.replace('value="'+defName+'"', 'value="'+defName+'" selected');
  return '<div class="pp-prod-row" style="display:grid;grid-template-columns:1fr 140px 40px;gap:8px;margin-bottom:6px">'
    + '<select class="pp-prod-name" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'+opts+'</select>'
    + '<input class="pp-prod-rawkg" type="number" placeholder="원육 kg" value="'+(defRawKg||'')+'" min="1" style="padding:7px 9px;border:1px solid #cbd5e1;border-radius:5px;font-size:13px">'
    + '<button onclick="this.parentElement.remove()" style="background:#fee2e2;border:none;border-radius:5px;color:#dc2626;font-weight:700;cursor:pointer">×</button>'
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
