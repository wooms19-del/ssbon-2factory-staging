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
  shredding_max_workers: 20,  // 이 이상 투입해도 설비 한계로 효율 안 늘어남 (실측: 19명 이상부터 급락)
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
// 시뮬레이션 엔진 v4 — 구간 계산 모델
// ============================================================
// 알고리즘:
//   1) 산출량 (yield)
//   2) 자숙 회차 분배 (잔량 먼저, 가압/비가압)
//   3) 호기 배정
//   4) 전처리 종료시각 — 시간대별 출근 인원 (자숙 active시 -2명)
//   5) 자숙 회차 시각 — 전처리 누적량 기반
//   6) 파쇄 종료시각 — 2구간 모델 (내포장 시작 전: 풀인원 / 후: 축소인원), 점심 50%
//   7) 내포장 시작시점 = 파쇄 종료시각 - 호기 자체 가동시간 (점심반영) 으로 역산
//      → 파쇄가 미리 충분히 쌓이고 종료 동기화되는 시점
//   8) 인원 부족 체크 — 내포장 가동 구간 필요인원 vs 가용
//   9) 시간대별 슬롯 출력
// ============================================================
function _ppSimulate(input, mode){
  var startMin = _ppToMin(input.startTime);
  var maxEndMin = _ppToMin(input.maxEnd);
  var ckRule = PP_STD.cooking;
  var LUNCH_S = PP_STD.lunch.startMin;
  var LUNCH_E = PP_STD.lunch.endMin;
  var LUNCH_R = PP_STD.lunch.workerRatio;
  var SH_MAX_W = PP_STD.shredding_max_workers;
  var SH_KGPH = PP_STD.shredding_kg_per_manhour;
  var PP_KGPH = PP_STD.preprocess_kg_per_manhour;

  // ── 1. 산출량 ──
  var rawKg = input.products.reduce(function(s,p){return s+p.rawKg;}, 0);
  var ppOutKg = rawKg * PP_STD.yield.preprocess;
  var cookOutKg = ppOutKg * PP_STD.yield.cooking;
  var shredOutKg = cookOutKg * PP_STD.yield.shredding;

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

  // ── 2. 자숙 회차 분배 ──
  var prodPressureKg = 0, prodNormalKg = 0;
  input.products.forEach(function(p){
    var canPressure = ckRule.pressure_allowed[p.name];
    if(canPressure === undefined) canPressure = ckRule.pressure_allowed['기본값'];
    var ck = p.rawKg * PP_STD.yield.preprocess;
    if(canPressure) prodPressureKg += ck;
    else prodNormalKg += ck;
  });
  var pressureCycles = prodPressureKg > 0 ? Math.ceil(prodPressureKg / ckRule.kg_per_tank) : 0;
  var normalCycles   = prodNormalKg   > 0 ? Math.ceil(prodNormalKg   / ckRule.kg_per_tank) : 0;
  function _tankKgs(total, n){
    if(n === 0) return [];
    if(n === 1) return [total];
    var arr = [];
    var rem = Math.max(0, total - (n-1)*ckRule.kg_per_tank);
    arr.push(rem);
    for(var i = 1; i < n; i++) arr.push(ckRule.kg_per_tank);
    return arr;
  }
  var pressureTankKgs = _tankKgs(prodPressureKg, pressureCycles);
  var normalTankKgs   = _tankKgs(prodNormalKg,   normalCycles);
  var cookBatches = pressureCycles + normalCycles;

  // ── 3. 호기 배정 ──
  var lineAssignment = _ppAssignToLines(prodEa);
  var pkInfo = _ppCalcPackingHours(lineAssignment);
  var activeLineCount = pkInfo.lines.length;
  var packingWorkers = pkInfo.totalWorkers;
  var outerWorkers = activeLineCount * 2;
  var retortWorkers = 1;
  var cookWorkersFixed = ckRule.workers_per_batch;
  // 내포장 가동 구간 필요인원 (자숙 active 가능성 고려해서 +2)
  var pkConsumeWorkers = packingWorkers + outerWorkers + retortWorkers;

  // 시간대별 누적 출근 인원
  function workersAt(t){
    var n = 0;
    for(var i = 0; i < input.shifts.length; i++){
      var sh = input.shifts[i];
      if(t >= _ppToMin(sh.time)) n += sh.workers;
      else break;
    }
    return n;
  }
  // 점심 시간 가용
  function availableAt(t){
    var w = workersAt(t);
    if(t >= LUNCH_S && t < LUNCH_E) w = Math.floor(w * LUNCH_R);
    return w;
  }

  // ── 4. 전처리 종료시각 ──
  // 시간대별 가용 인원에서 자숙 시작 후엔 -2명, 점심 50%
  // 전처리 시작 시점부터 1분씩 처리량 누적
  // (자숙 회차 시각은 전처리 누적량에 의존하므로 동시에 계산 — 단순화: 전처리 진행 중에 자숙 회차들이 차례로 시작)
  // 이 단계에선 자숙 시작 영향은 미미하다고 가정하고 일단 전처리만 계산
  // 점심 통과 케이스도 분당 누적으로 처리
  var ppStart = startMin;
  var ppRemain = ppOutKg;
  var ppCumKg = 0;
  var ppCumByMin = []; // [{t, cumKg}] — 자숙 회차 투입 시점 역산용
  var ppEndMin = -1;
  // 자숙 active 추적용 (전처리 단계에서 자숙 active 인원 차감 반영)
  var cookActiveCount = 0;
  var cookActiveUntil = []; // [outTime, outTime, ...] 정렬됨
  // 자숙 회차 큐
  var cookQueue = [];
  var cumNeed = 0;
  pressureTankKgs.forEach(function(kg){
    cumNeed += kg;
    cookQueue.push({type:'pressure', kg:kg, ppCumNeed:cumNeed, durMin:ckRule.minutes_pressure});
  });
  normalTankKgs.forEach(function(kg){
    cumNeed += kg;
    cookQueue.push({type:'normal', kg:kg, ppCumNeed:cumNeed, durMin:ckRule.minutes_normal});
  });
  var nextCookIdx = 0;
  var cookSchedule = []; // {type, kg, inTime, outTime}

  var MAX_T = 26 * 60;
  for(var t = ppStart; t <= MAX_T; t++){
    // 자숙 active 마감
    cookActiveUntil = cookActiveUntil.filter(function(ot){ return ot > t; });
    cookActiveCount = cookActiveUntil.length;

    // 가용 인원 - 자숙 점유분
    var avail = availableAt(t);
    var ppAvail = Math.max(0, avail - cookActiveCount * cookWorkersFixed);

    // 전처리 처리
    if(ppRemain > 0 && ppAvail > 0){
      var ppDone = (PP_KGPH / 60) * ppAvail;
      if(ppDone > ppRemain) ppDone = ppRemain;
      ppRemain -= ppDone;
      ppCumKg += ppDone;
    }
    ppCumByMin.push({t:t, cumKg:ppCumKg});

    // 자숙 회차 투입 (전처리 누적 충족 + 인력 2명 가용 + 동시 가용 = 자숙 6대 한계 미만)
    while(nextCookIdx < cookQueue.length){
      var nx = cookQueue[nextCookIdx];
      if(ppCumKg < nx.ppCumNeed - 0.5) break;
      if(cookActiveCount >= ckRule.tanks_total) break; // 탱크 한계
      // 인력 체크: 이 시점 가용 인원이 자숙 + 다른 회차 + 전처리(최소 1) 가능한지
      if(avail < (cookActiveCount + 1) * cookWorkersFixed) break;
      // 투입
      var inT = t;
      var outT = t + nx.durMin;
      cookSchedule.push({type:nx.type, kg:nx.kg, inTime:inT, outTime:outT});
      cookActiveUntil.push(outT);
      cookActiveCount++;
      nextCookIdx++;
    }

    if(ppRemain <= 0.5 && ppEndMin < 0){ ppEndMin = t + 1; }
    if(ppRemain <= 0.5 && nextCookIdx >= cookQueue.length && cookActiveCount === 0){
      // 전처리도 끝나고 자숙도 끝났으면 break (자숙 종료 시각 위해 계속)
      // 여기선 자숙 종료 시각까지 알아야 함
    }
    // 자숙 진행은 계속 — 마지막 자숙 종료까지 ppCumByMin도 채워야 함
    if(ppRemain <= 0.5 && nextCookIdx >= cookQueue.length && cookActiveUntil.length === 0) break;
  }
  if(ppEndMin < 0) ppEndMin = MAX_T;
  // 자숙 종료 시각
  var lastCookOutTime = cookSchedule.length ? Math.max.apply(null, cookSchedule.map(function(c){return c.outTime;})) : ppEndMin;
  var cookStartMin = cookSchedule.length ? cookSchedule[0].inTime : ppStart;
  var cookEndMin = lastCookOutTime;

  // ── 5. 마지막 자숙 회차 산출 (파쇄 들어갈 마지막 분량) ──
  var lastCookKgOut = cookSchedule.length ? cookSchedule[cookSchedule.length-1].kg * PP_STD.yield.cooking : 0;

  // ── 6. 파쇄 종료시각 계산 (2구간 모델) ──
  // 파쇄 입력 총량 (= 자숙 산출 총합) = cookOutKg
  // 파쇄 산출 총량 = shredOutKg = cookOutKg × 0.97
  // 파쇄 시작 = 자숙 1호 종료 시점
  // 파쇄가 처리할 수 있는 양은 시점 t까지 자숙 누적 산출 (FIFO)
  // 시점 t의 파쇄 인원 = min(SH_MAX_W, 가용 - 자숙 active*2 - (내포장 active면 호기+외포장+레토르트))
  //
  // 파쇄 종료시각을 내포장 시작시각의 함수로 두고 반복 수렴:
  //   초기: 내포장 시작 = pkStartGuess (오전: 자숙 첫 종료 + 30분, 오후: 13:30)
  //   파쇄 종료 = sim_shred_end(pkStart)
  //   pkStart_new = 파쇄 종료 - pkSelfMin (호기 자체 가동시간 점심반영) + α
  //   수렴까지 반복 (5회 정도면 충분)
  //
  // 호기 자체 가동시간 (점심 50% 손실 반영):
  //   pkSelfMin(start, totalEaPerMin, totalQty) — 점심 구간 통과 시 추가 시간 계산
  function pkSelfMinFrom(start, lineSpeedSum, qty){
    // qty / lineSpeedSum 분 동안 처리, 점심 구간 50%
    var remain = qty;
    var t2 = start;
    var iter = 0;
    while(remain > 0 && iter < 24*60){
      var spd = lineSpeedSum;
      if(t2 >= LUNCH_S && t2 < LUNCH_E) spd = spd * LUNCH_R;
      remain -= spd;
      t2++;
      iter++;
    }
    return t2 - start;
  }

  function shredEnd(pkStartGuess){
    // 파쇄 시뮬 (분 단위, 자숙 회차 종료마다 +kg, 인력은 내포장 active 여부에 따라 변동)
    var shStart = cookSchedule.length ? cookSchedule[0].outTime : ppEndMin;
    var shRemainKg = 0;
    var shInputTotalKg = cookOutKg;
    var shProcessedKg = 0;
    var idx = 0; // 다음 자숙 회차 인덱스 (출시 순)
    var sortedCookByOut = cookSchedule.slice().sort(function(a,b){return a.outTime - b.outTime;});

    for(var t = shStart; t <= MAX_T; t++){
      // 자숙 회차 종료분 추가
      while(idx < sortedCookByOut.length && sortedCookByOut[idx].outTime <= t){
        shRemainKg += sortedCookByOut[idx].kg * PP_STD.yield.cooking;
        idx++;
      }
      if(shRemainKg <= 0 && shProcessedKg >= shInputTotalKg - 0.5) return t;

      // 시점 t의 가용
      var avail = availableAt(t);
      // 자숙 active 차감
      var cookActiveNow = sortedCookByOut.filter(function(c){return c.inTime <= t && c.outTime > t;}).length;
      var reserved = cookActiveNow * cookWorkersFixed;
      // 내포장 active 차감
      if(t >= pkStartGuess) reserved += pkConsumeWorkers;
      var shAvail = Math.max(0, avail - reserved);
      var shW = Math.min(SH_MAX_W, shAvail);

      var shDone = (SH_KGPH / 60) * shW;
      if(t >= LUNCH_S && t < LUNCH_E) shDone = shDone * LUNCH_R;
      if(shDone > shRemainKg) shDone = shRemainKg;
      shRemainKg -= shDone;
      shProcessedKg += shDone;
    }
    return MAX_T;
  }

  // 호기 속도 합
  var lineSpeedSum = pkInfo.lines.reduce(function(s,l){return s + l.ea_per_min;}, 0);

  // ── 7. 내포장 시작시점 역산 ──
  // 초기 추정
  var firstCookOut = cookSchedule.length ? cookSchedule[0].outTime : ppEndMin;
  var pkStartGuess;
  if(mode === 'morning'){
    // 자숙 첫 회차 종료 + 약간 (파쇄 산출 시작)
    pkStartGuess = firstCookOut + 30;
  } else {
    // 오후 모드: 13:30 강제
    pkStartGuess = Math.max(13*60 + 30, firstCookOut + 30);
  }

  // 반복 수렴 (최대 6회)
  var pkStart, pkEnd, shEnd, pkSelfMin;
  for(var iter = 0; iter < 6; iter++){
    shEnd = shredEnd(pkStartGuess);
    // 내포장 호기 자체 가동시간 (역방향으로 계산: shEnd에서 끝나려면 언제 시작?)
    // 단순화: pkStartGuess부터 호기 자체 시뮬 (점심반영)
    pkSelfMin = pkSelfMinFrom(pkStartGuess, lineSpeedSum, totalQty);
    pkEnd = pkStartGuess + pkSelfMin;
    // 파쇄 산출이 내포장에 충분히 공급되는지 확인 — 두 종료 시점이 비슷하면 OK
    // 두 종료 시점 차이를 줄이는 방향으로 pkStart 조정
    // pkEnd < shEnd → 내포장이 빨리 끝남 (정상 아님 — 파쇄 산출 못 받음)
    //   → pkStart를 늦춤 (더 늦게 시작)
    // pkEnd > shEnd → 내포장이 늦게 끝남 (정상, 마지막 산출분 처리)
    //   → pkStart 그대로 또는 약간 앞당김
    var diff = pkEnd - shEnd;
    if(mode === 'afternoon'){
      // 오후 모드는 강제 13:30 시작이므로 한 번만 계산
      break;
    }
    if(Math.abs(diff) <= 5) break; // 5분 이내면 수렴
    if(pkEnd < shEnd){
      // 내포장이 너무 빨리 끝남 → 시작을 늦춤
      pkStartGuess += Math.min(60, shEnd - pkEnd);
    } else {
      // 내포장이 너무 늦게 끝남 → 시작을 앞당김 (단 파쇄 첫 산출 이후만)
      pkStartGuess = Math.max(firstCookOut + 10, pkStartGuess - Math.min(30, diff - 5));
    }
  }
  pkStart = pkStartGuess;

  // 마지막 파쇄 산출분 처리 시간 (호기 자체 속도로 lastCookKgOut × yShred 만큼 추가)
  var lastShredOutKg = lastCookKgOut * PP_STD.yield.shredding;
  var avgKgPerEa = totalQty > 0 ? shredOutKg / totalQty : 0.13;
  var lastEa = avgKgPerEa > 0 ? lastShredOutKg / avgKgPerEa : 0;
  // 파쇄 종료 후 마지막 분량 호기 통과 시간
  var alphaMin = lineSpeedSum > 0 ? Math.ceil(lastEa / lineSpeedSum) : 0;
  // 내포장 종료 = max(자기 가동 종료, 파쇄 종료 + α)
  var pkEndAdjusted = Math.max(pkEnd, shEnd + alphaMin);

  // 레토르트: 내포장 시작 ~ 내포장 종료 + 마지막 회차 살균
  var retortStart = pkStart;
  var retortEnd = pkEndAdjusted + Math.round(PP_STD.retort.minutes_per_batch * 0.3);

  // ── 8. 인원 부족 체크 ──
  // 내포장 가동 구간(pkStart~pkEndAdjusted) 동안 매 시점 가용 ≥ 필요?
  // 필요 인원: pkConsumeWorkers + cookActive(2명/회차) + 파쇄 최소 1명
  var shortage = null;
  for(var tc = pkStart; tc < pkEndAdjusted; tc += 10){
    var availNow = availableAt(tc);
    var cookCount = cookSchedule.filter(function(c){return c.inTime <= tc && c.outTime > tc;}).length;
    var needNow = pkConsumeWorkers + cookCount * cookWorkersFixed + 1; // +1 = 파쇄 최소
    if(availNow < needNow){
      if(!shortage){
        shortage = { time: tc, avail: availNow, need: needNow };
      }
    }
  }

  // ── 9. 시간대별 슬롯 (출력용) ──
  // 핵심 변화 시점들: 출근 시간, 전처리 끝, 자숙 회차 in/out, 파쇄 시작/끝, 내포장 시작/끝, 점심 시작/끝
  var checkpoints = [ppStart];
  input.shifts.forEach(function(sh){ checkpoints.push(_ppToMin(sh.time)); });
  checkpoints.push(LUNCH_S, LUNCH_E);
  cookSchedule.forEach(function(c){ checkpoints.push(c.inTime, c.outTime); });
  checkpoints.push(ppEndMin, firstCookOut, shEnd, pkStart, pkEndAdjusted, retortEnd);
  checkpoints = checkpoints.filter(function(x){return x>=ppStart && x<=retortEnd+30;});
  checkpoints.sort(function(a,b){return a-b;});
  // 중복 제거
  var uniq = [];
  checkpoints.forEach(function(x){ if(uniq.length === 0 || uniq[uniq.length-1] !== x) uniq.push(x); });

  var slots = uniq.map(function(t){
    var avail = availableAt(t);
    var cookCount = cookSchedule.filter(function(c){return c.inTime <= t && c.outTime > t;}).length;
    var aCook = cookCount * cookWorkersFixed;
    var aPk = 0, aOuter = 0, aRetort = 0;
    if(t >= pkStart && t < pkEndAdjusted){
      aPk = packingWorkers; aOuter = outerWorkers; aRetort = retortWorkers;
    }
    var rem = avail - aCook - aPk - aOuter - aRetort;
    // 파쇄: 자숙 종료 후~파쇄 종료까지 가용 인원
    var aSh = 0;
    if(t >= firstCookOut && t < shEnd){
      aSh = Math.min(SH_MAX_W, Math.max(0, rem));
      rem -= aSh;
    }
    // 전처리: 전처리 진행 중이면 나머지 인원
    var aPp = 0;
    if(t < ppEndMin){
      aPp = Math.max(0, rem);
      rem = 0;
    }
    var aIdle = Math.max(0, rem);
    return {tMin:t, avail:avail, alloc:{pp:aPp, sh:aSh, pk:aPk, outer:aOuter, retort:aRetort, cook:aCook, idle:aIdle}};
  });

  // 평균 잉여 (의미 있는 슬롯들)
  var idleSum = 0, idleCnt = 0;
  slots.forEach(function(s){ if(s.tMin >= ppStart && s.tMin < pkEndAdjusted){ idleSum += s.alloc.idle; idleCnt++; } });
  var avgIdle = idleCnt > 0 ? Math.round(idleSum / idleCnt) : 0;

  // 대표 alloc (내포장 가동 중 시점)
  var repSlot = slots.find(function(s){return s.tMin >= pkStart + 10 && s.tMin < pkEndAdjusted;}) || slots[Math.floor(slots.length/2)] || slots[0];
  var allocRep = repSlot ? {
    preprocess: repSlot.alloc.pp, shredding: repSlot.alloc.sh, packing: repSlot.alloc.pk,
    outer: repSlot.alloc.outer, retort: repSlot.alloc.retort, cook: repSlot.alloc.cook, idle: repSlot.alloc.idle
  } : { preprocess:0, shredding:0, packing:packingWorkers, outer:outerWorkers, retort:retortWorkers, cook:0, idle:0 };

  var feasible = pkEndAdjusted <= maxEndMin && !shortage;
  var reason = null;
  if(shortage){
    feasible = false;
    reason = _ppToTime(shortage.time) + ' 시점 ' + shortage.need + '명 필요 (가용 ' + shortage.avail + '명, 부족 ' + (shortage.need - shortage.avail) + '명)';
  }

  return {
    mode: mode,
    feasible: feasible,
    reason: reason,
    alloc: allocRep,
    cookWorkers: cookWorkersFixed,
    retortWorkers: retortWorkers,
    outerWorkers: outerWorkers,
    leftover: avgIdle,
    rawKg: rawKg,
    ppOutKg: ppOutKg,
    cookOutKg: cookOutKg,
    shredOutKg: shredOutKg,
    totalQty: totalQty,
    prodEa: prodEa,
    cookBatches: cookBatches,
    pressureBatches: pressureCycles,
    normalBatches: normalCycles,
    cookSchedule: cookSchedule,
    pressureTankKgs: pressureTankKgs,
    normalTankKgs: normalTankKgs,
    retortBatches: Math.ceil(totalQty / ((PP_STD.retort.ea_per_cart[input.products[0].name] || PP_STD.retort.ea_per_cart['기본값']) * PP_STD.retort.machines * PP_STD.retort.carts_per_batch)),
    pkInfo: pkInfo,
    timeline: {
      pp: { start: ppStart, end: ppEndMin },
      cook: { start: cookStartMin, end: cookEndMin },
      sh: { start: firstCookOut, end: shEnd },
      pk: { start: pkStart, end: pkEndAdjusted },
      retort: { start: retortStart, end: retortEnd }
    },
    endTime: pkEndAdjusted,
    overrun: feasible ? 0 : Math.max(0, pkEndAdjusted - maxEndMin),
    shifts: slots,
    shortage: shortage
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
    html += '<div style="margin-top:8px;font-size:11px;color:#94a3b8">※ 점심 교대 11:30~13:30 (작업속도 50%) 반영됨 (사선 음영). 전처리·파쇄는 시간대별로 인원 변동.</div>';
    html += '</div>';
  }

  // 시간대별 인력 배치 슬롯
  if(rec.shifts && rec.shifts.length){
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:18px">';
    html += '<h3 style="margin:0 0 12px;font-size:15px;color:#1e293b;font-weight:700">👥 시간대별 인력 배치</h3>';
    html += _ppRenderShifts(rec);
    html += '<div style="margin-top:8px;font-size:11px;color:#94a3b8">※ 가용 = 그 시점 출근 누적 (점심엔 50%). 인력은 자숙→내포장+외포장+레토르트→파쇄→전처리 우선순위로 배치.</div>';
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
  html += '<div style="font-size:12px;color:#64748b">대표시점 배치 (내포장 가동중):</div>';
  html += '<div>· 전처리 '+sc.alloc.preprocess+' / 파쇄 '+sc.alloc.shredding+' / 자숙 '+sc.alloc.cook+'</div>';
  html += '<div>· 내포장 '+sc.alloc.packing+' / 외포장 '+sc.alloc.outer+' / 레토르트 '+sc.alloc.retort+'</div>';
  html += '<div>평균 잉여: <b style="color:'+(sc.leftover>=0?'#16a34a':'#dc2626')+'">'+sc.leftover+'명</b> (외포장/제수 가용)</div>';
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
    { name: '🥩 전처리', start: t.pp.start, end: t.pp.end, w: '~'+sc.alloc.preprocess, color: '#fbbf24' },
    { name: '🍲 자숙',   start: t.cook.start, end: t.cook.end, w: sc.cookWorkers, color: '#f87171' },
    { name: '🔪 파쇄',   start: t.sh.start, end: t.sh.end, w: '~'+sc.alloc.shredding, color: '#a78bfa' },
    { name: '📦 내포장', start: t.pk.start, end: t.pk.end, w: sc.alloc.packing, color: '#34d399' },
    { name: '📤 외포장', start: t.pk.start, end: t.pk.end, w: sc.outerWorkers, color: '#60a5fa' },
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

// 시간대별 인력 배치 슬롯 표
function _ppRenderShifts(sc){
  if(!sc.shifts || !sc.shifts.length) return '';
  // 의미 있는 슬롯만 추출: 직전 슬롯과 alloc이 변경되거나 30분 이상 지났을 때
  var slots = sc.shifts;
  var displayed = [];
  for(var i = 0; i < slots.length; i++){
    var s = slots[i];
    if(displayed.length === 0){ displayed.push(s); continue; }
    var prev = displayed[displayed.length - 1];
    var p = prev.alloc, c = s.alloc;
    var sameAlloc = prev.avail === s.avail && p.pp === c.pp && p.sh === c.sh && p.pk === c.pk && p.outer === c.outer && p.retort === c.retort && p.cook === c.cook;
    if(!sameAlloc || (s.tMin - prev.tMin) >= 30){
      displayed.push(s);
    }
  }
  // 종료 시각도 추가
  var lastShift = slots[slots.length - 1];
  if(displayed[displayed.length - 1] !== lastShift) displayed.push(lastShift);

  var html = '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:760px">';
  html += '<thead><tr style="background:#f1f5f9">';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:60px">시각</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:50px">가용</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">전처리</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">자숙</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">파쇄</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">내포장</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">외포장</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">레토르트</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">잉여</th>';
  html += '</tr></thead><tbody>';
  displayed.forEach(function(s){
    var a = s.alloc;
    var idleColor = a.idle > 0 ? '#16a34a' : '#94a3b8';
    html += '<tr style="border-bottom:1px solid #f1f5f9">';
    html += '<td style="text-align:center;padding:6px;font-weight:600;color:#1e40af">'+_ppToTime(s.tMin)+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#64748b">'+s.avail+'</td>';
    html += '<td style="text-align:center;padding:6px">'+(a.pp||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px">'+(a.cook||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px">'+(a.sh||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#15803d;font-weight:600">'+(a.pk||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#1e40af">'+(a.outer||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#ea580c">'+(a.retort||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px;color:'+idleColor+';font-weight:'+(a.idle>0?'700':'400')+'">'+(a.idle||0)+'</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
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
  html += '<div style="font-weight:600;color:#1e40af;margin-bottom:8px">공정별 인원 배치 근거 (동적 모델)</div>';
  html += '<div style="margin-bottom:4px">• <b>자숙 '+sc.cookWorkers+'명</b> (고정) — 회차당 2명, 회차 중에만 점유</div>';
  html += '<div style="margin-bottom:4px">• <b>내포장 '+sc.alloc.packing+'명</b> — 호기별 인원 합 (1호기 12 / 2호기 8 / 3·4호기 8씩 중 가동 호기)</div>';
  html += '<div style="margin-bottom:4px">• <b>외포장 '+sc.outerWorkers+'명</b> — 가동 호기 '+(sc.pkInfo?sc.pkInfo.lines.length:0)+'대 × 2명</div>';
  html += '<div style="margin-bottom:4px">• <b>레토르트 '+sc.retortWorkers+'명</b> — 내포장 가동 중 고정 1명</div>';
  html += '<div style="margin-bottom:4px">• <b>전처리/파쇄</b> — 시간대별 가용 인원 동적 배치 (전처리는 산출 누적, 파쇄는 자숙 회차 종료마다 FIFO 처리)</div>';
  html += '<div style="margin-bottom:4px;color:#64748b;font-size:12px">↳ 산출량: 전처리 '+sc.ppOutKg.toFixed(0)+'kg / 자숙 '+sc.cookOutKg.toFixed(0)+'kg / 파쇄 '+sc.shredOutKg.toFixed(0)+'kg / 내포장 '+sc.totalQty.toLocaleString()+'EA</div>';
  if(sc.leftover > 0){
    html += '<div style="margin-top:8px;color:#16a34a">✓ 평균 잉여 <b>'+sc.leftover+'명</b> — 외포장·제수 추가 작업 가능</div>';
  } else if(sc.leftover === 0){
    html += '<div style="margin-top:8px;color:#64748b">○ 가용 인원 모두 본 공정에 투입됨</div>';
  } else {
    html += '<div style="margin-top:8px;color:#dc2626">⚠ 평균적으로 인원 부족</div>';
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
