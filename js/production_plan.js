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
  shredding_max_workers: 20,
  wagon_min: 30, // 와건 시간
  // 내포장 호기 — 실측 기반 (4-03 등 데이터 분석)
  // 호기 1대당 분당 EA = 약 5명 기준; 인원/속도 모두 호기당 고정
  packing_lines: [
    { id:1, name:'1호기 (미니)',    workers:6, ea_per_min:30, productMatch:function(n){return n.indexOf('미니')>=0;} },
    { id:2, name:'2호기 (FC)',      workers:6, ea_per_min:5,  productMatch:function(n){return n.indexOf('FC')===0 || n.indexOf('FC ')>=0;} },
    { id:3, name:'3호기 (일반)',    workers:6, ea_per_min:27, productMatch:null },  // 시그·코스트코·트레이더스 등
    { id:4, name:'4호기 (일반)',    workers:6, ea_per_min:27, productMatch:null }
  ],
  transfer_workers_per_line: 2, // 호기 1대당 이송 인원
  retort: {
    machines: 3,
    carts_per_batch: 4,
    max_carts: 8,
    workers_total: 1, // 외포장조에서 1명 차출
    // 제품별 (실측/메모리):
    //   FC 3KG: 대차당 380 EA, 150분
    //   시그/코스트코/시그마트용: 대차당 1024 EA, 120분
    //   미니: 대차당 1280 EA, 120분
    //   트레이더스 460g: 대차당 380 EA, 120분
    profile: {
      'FC 장조림 3KG':              { eaPerCart: 380,  minutes: 150 },
      '시그니처 장조림 130g':       { eaPerCart: 1024, minutes: 120 },
      '시그니처 장조림 130g 마트용':{ eaPerCart: 1024, minutes: 120 },
      '시그니처 장조림 120g':       { eaPerCart: 1024, minutes: 120 },
      '코스트코 장조림 170g':       { eaPerCart: 1024, minutes: 120 },
      '미니쇠고기장조림 70g 5입':   { eaPerCart: 1280, minutes: 120 },
      '미니쇠고기장조림 70g 낱개':  { eaPerCart: 1280, minutes: 120 },
      '트레이더스 장조림 460g':     { eaPerCart: 380,  minutes: 120 },
      '기본값':                     { eaPerCart: 500,  minutes: 120 }
    }
  },
  yield: {
    preprocess: 0.89,
    cooking: 0.58,
    shredding: 0.97
  },
  lunch: {
    // 반반 교대: 11:30~12:30 1차 (half1 식사), 12:30~13:30 2차 (half2 식사)
    // 식사 중이 아닌 인원은 계속 작업 (파쇄/내포장 등)
    lunch1_s: 11*60 + 30,
    lunch1_e: 12*60 + 30,
    lunch2_s: 12*60 + 30,
    lunch2_e: 13*60 + 30
  },
  manager_workers: 1 // 관리자 1명 (전공정 항상 1명 점유)
};

// ============================================================
// 점심 시간 = 반반 교대 (전체 가동, 인원만 반)
// 작업 시간 → 점심 통과 시 50% 속도 (1차 + 2차 합쳐 1시간씩, 총 2시간 = 1시간만큼 손실)
// ============================================================
function _ppWorkWithLunch(startMin, totalWorkMinutes){
  var LL = PP_STD.lunch;
  var LS = LL.lunch1_s; // 11:30
  var LE = LL.lunch2_e; // 13:30
  var t = startMin;
  var remain = totalWorkMinutes;
  // 점심 전
  if(t < LS){
    var beforeLunch = Math.min(LS - t, remain);
    remain -= beforeLunch;
    t += beforeLunch;
  }
  // 점심 중: 작업 진행되지만 절반 속도 (절반은 식사, 절반은 일)
  if(remain > 0 && t < LE){
    var lunchAvail = LE - t;
    var effectiveWork = lunchAvail * 0.5; // 절반 속도
    if(effectiveWork >= remain){
      var portionUsed = remain / 0.5;
      return t + portionUsed;
    } else {
      remain -= effectiveWork;
      t = LE;
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
// 시뮬레이션 엔진 v5 — timetable.js + timetable_test.js 기반
// ============================================================
// 핵심 룰 (정확한 도메인 모델):
//   1. 외포장은 별도 점유 X (잉여 인력 자동 흡수)
//   2. 점심: 반반 교대 (11:30~12:30 1차 / 12:30~13:30 2차), 작업은 계속 (절반 속도)
//   3. 호기 ea_per_min은 호기 1대당 실측값 (시그 27, 미니 30, FC 5)
//   4. 레토르트 EA/대차 & 시간은 제품별 (PP_STD.retort.profile)
//   5. 자숙: 회차당 2명 고정, 가압 150분/비가압 240분
//   6. 파쇄: 분당 18.5 kg/인시, 최대 20명
//   7. 내포장: 가용 인원이 호기 풀가동에 충분하면 그 시점 시작 (오전), 또는 13:30 (오후)
// ============================================================
function _ppSimulate(input, mode){
  var startMin = _ppToMin(input.startTime);
  var maxEndMin = _ppToMin(input.maxEnd);
  var ckRule = PP_STD.cooking;
  var L1S = PP_STD.lunch.lunch1_s; // 11:30
  var L2E = PP_STD.lunch.lunch2_e; // 13:30
  var SH_MAX_W = PP_STD.shredding_max_workers;
  var SH_KGPH = PP_STD.shredding_kg_per_manhour;
  var PP_KGPH = PP_STD.preprocess_kg_per_manhour;

  // ── 1. 산출량 ──
  var rawKg = input.products.reduce(function(s,p){return s+p.rawKg;}, 0);
  var ppOutKg = rawKg * PP_STD.yield.preprocess;
  var cookOutKg = ppOutKg * PP_STD.yield.cooking;
  var shredOutKg = cookOutKg * PP_STD.yield.shredding;

  // 제품별 EA (kgea 정확 사용)
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

  // ── 2. 자숙 회차 분배 (잔량 먼저, 가압/비가압) ──
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

  // 회차 큐 (가압 먼저 → 비가압, 전처리 누적 충족 순)
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

  // ── 3. 호기 배정 ──
  var lineAssignment = _ppAssignToLines(prodEa);
  var pkInfo = _ppCalcPackingHours(lineAssignment);
  var packingWorkers = pkInfo.totalWorkers;
  var transferWorkers = pkInfo.lines.length * PP_STD.transfer_workers_per_line;
  var retortWorkers = PP_STD.retort.workers_total; // 1명
  var managerWorkers = PP_STD.manager_workers;     // 1명
  var cookWorkersFixed = ckRule.workers_per_batch; // 2명/회차

  // 내포장 가동 시 최소 필요 인원 (호기 본 + 이송 + 레토르트 1 + 관리 1)
  var pkConsumeWorkers = packingWorkers + transferWorkers + retortWorkers + managerWorkers;

  // 시간대별 누적 출근
  function workersAt(t){
    var n = 0;
    for(var i = 0; i < input.shifts.length; i++){
      var sh = input.shifts[i];
      if(t >= _ppToMin(sh.time)) n += sh.workers;
      else break;
    }
    return n;
  }

  // ── 4. 전처리 + 자숙 회차 시뮬레이션 (1분 단위) ──
  // 전처리 = 전 인원에서 자숙 점유분 빼고 처리
  // 자숙 = 전처리 누적량 충족 시 투입 (회차당 2명)
  var ppStart = startMin;
  var ppRemain = ppOutKg;
  var ppCumKg = 0;
  var ppEndMin = -1;
  var cookActiveUntil = [];
  var nextCookIdx = 0;
  var cookSchedule = [];

  var MAX_T = 26 * 60;
  for(var t = ppStart; t <= MAX_T; t++){
    // 자숙 회차 마감
    cookActiveUntil = cookActiveUntil.filter(function(ot){ return ot > t; });
    var cookActiveCount = cookActiveUntil.length;

    var avail = workersAt(t);
    // 점심 시간엔 절반만 가용 (반반 교대)
    var isLunch = (t >= L1S && t < L2E);
    var effAvail = isLunch ? Math.floor(avail * 0.5) : avail;

    // 자숙 점유 차감
    var ppAvail = Math.max(0, effAvail - cookActiveCount * cookWorkersFixed - managerWorkers);

    // 전처리 처리
    if(ppRemain > 0 && ppAvail > 0){
      var ppDone = (PP_KGPH / 60) * ppAvail;
      if(ppDone > ppRemain) ppDone = ppRemain;
      ppRemain -= ppDone;
      ppCumKg += ppDone;
    }

    // 자숙 회차 투입
    while(nextCookIdx < cookQueue.length){
      var nx = cookQueue[nextCookIdx];
      if(ppCumKg < nx.ppCumNeed - 0.5) break;
      if(cookActiveCount >= ckRule.tanks_total) break;
      // 인력 2명 가용?
      var availForCook = effAvail - cookActiveCount * cookWorkersFixed - managerWorkers;
      if(availForCook < cookWorkersFixed) break;
      var inT = t;
      var outT = t + nx.durMin;
      cookSchedule.push({type:nx.type, kg:nx.kg, inTime:inT, outTime:outT});
      cookActiveUntil.push(outT);
      cookActiveCount++;
      nextCookIdx++;
    }

    if(ppRemain <= 0.5 && ppEndMin < 0){ ppEndMin = t + 1; }
    if(ppRemain <= 0.5 && nextCookIdx >= cookQueue.length && cookActiveUntil.length === 0) break;
  }
  if(ppEndMin < 0) ppEndMin = MAX_T;
  var lastCookOutTime = cookSchedule.length ? Math.max.apply(null, cookSchedule.map(function(c){return c.outTime;})) : ppEndMin;
  var firstCookOut = cookSchedule.length ? Math.min.apply(null, cookSchedule.map(function(c){return c.outTime;})) : ppEndMin;
  var cookStartMin = cookSchedule.length ? cookSchedule[0].inTime : ppStart;
  var cookEndMin = lastCookOutTime;

  // 파쇄 시작 = 자숙 1호 종료 + 와건 30분
  var shStart = firstCookOut + PP_STD.wagon_min;

  // ── 5. 파쇄 종료시각 계산 + 내포장 시작 결정 ──
  // 파쇄 처리해야 할 총 kg = cookOutKg (자숙 산출 = 파쇄 입력)
  // 분당 처리 = min(SH_MAX_W, 가용 인원) × 18.5 / 60 kg/min
  // 점심 시간엔 가용 인원 절반
  // 내포장 가동 시 인력 차감
  function shredEnd(pkStartGuess){
    var idx = 0;
    var sortedCook = cookSchedule.slice().sort(function(a,b){return a.outTime - b.outTime;});
    var shRemainKg = 0;
    var shProcessedKg = 0;
    var totalShIn = cookOutKg;
    var lastInputT = sortedCook.length ? sortedCook[sortedCook.length-1].outTime + PP_STD.wagon_min : shStart;
    for(var t = shStart; t <= MAX_T; t++){
      // 자숙 회차 종료 + 와건시간 후 산출 가능
      while(idx < sortedCook.length && sortedCook[idx].outTime + PP_STD.wagon_min <= t){
        shRemainKg += sortedCook[idx].kg * PP_STD.yield.cooking;
        idx++;
      }
      if(shRemainKg <= 0 && shProcessedKg >= totalShIn - 0.5 && t >= lastInputT) return t;

      var avail = workersAt(t);
      var isLunch = (t >= L1S && t < L2E);
      var effAvail = isLunch ? Math.floor(avail * 0.5) : avail;

      // 점유 차감
      var cookActiveNow = sortedCook.filter(function(c){return c.inTime <= t && c.outTime > t;}).length;
      var reserved = cookActiveNow * cookWorkersFixed + managerWorkers;
      if(t >= pkStartGuess) reserved += pkConsumeWorkers;
      var shAvail = Math.max(0, effAvail - reserved);
      var shW = Math.min(SH_MAX_W, shAvail);

      var shDone = (SH_KGPH / 60) * shW;
      if(shDone > shRemainKg) shDone = shRemainKg;
      shRemainKg -= shDone;
      shProcessedKg += shDone;
    }
    return MAX_T;
  }

  // 내포장 호기 자체 가동시간 (점심 50%, 반반 교대)
  function pkSelfMin(startGuess){
    return _ppWorkWithLunch(startGuess, totalQty / pkInfo.lineSpeedSum);
  }

  // 호기 분당 처리 합
  pkInfo.lineSpeedSum = pkInfo.lines.reduce(function(s,l){return s + l.ea_per_min;}, 0);

  // ── 6. 내포장 시작 시각 결정 ──
  // 오전 모드: 자숙 1호 와건 종료 후 일정 시간 (파쇄 산출 누적) + 가용 인원 충분 시
  // 오후 모드: 13:30 강제 시작
  var pkStart;
  if(mode === 'afternoon'){
    pkStart = Math.max(L2E, shStart + 30);
  } else {
    // 파쇄 시작 후 30분 (산출 일부 쌓임) + 가용 인원 체크
    pkStart = shStart + 30;
    // 가용 인원이 pkConsumeWorkers + 자숙 점유 + 관리 + 파쇄최소1 = pkConsumeWorkers + 2 + 1 + 1
    // 안 되면 늦춤
    while(pkStart < L2E + 60){
      var aval = workersAt(pkStart);
      var isLunch = (pkStart >= L1S && pkStart < L2E);
      var effAval = isLunch ? Math.floor(aval * 0.5) : aval;
      var cookNow = cookSchedule.filter(function(c){return c.inTime <= pkStart && c.outTime > pkStart;}).length;
      var need = pkConsumeWorkers + cookNow * cookWorkersFixed + 1; // +1 = 파쇄 최소
      if(effAval >= need) break;
      pkStart += 5;
    }
  }

  // 파쇄 종료 시각
  var shEnd = shredEnd(pkStart);

  // 내포장 종료 = pkStart + 자체 가동시간 (단 파쇄 종료 + 마지막 산출분 처리 시간보다 늦어야)
  var avgKgPerEa = totalQty > 0 ? shredOutKg / totalQty : 0.025;
  var lastCookKg = cookSchedule.length ? cookSchedule[cookSchedule.length-1].kg : 0;
  var lastShredOutKg = lastCookKg * PP_STD.yield.cooking * PP_STD.yield.shredding / PP_STD.yield.cooking; // = lastCookKg × 0.97
  var lastEa = avgKgPerEa > 0 ? Math.round(lastShredOutKg * PP_STD.yield.cooking / avgKgPerEa) : 0;
  // 단순화: 파쇄 종료 후 마지막 산출분이 호기 통과 시간 = lastEa / 호기속도
  var tailMin = pkInfo.lineSpeedSum > 0 ? Math.ceil(lastEa / pkInfo.lineSpeedSum) : 0;

  var pkSelfEnd = Math.round(pkSelfMin(pkStart));
  var pkEnd = Math.max(pkSelfEnd, shEnd + tailMin);

  // ── 7. 레토르트 (제품별 EA/대차 + 시간) ──
  // 회차 균등 분배 + 대차 8 한도 + 3대 병렬
  var firstProd = prodEa[0] ? prodEa[0].name : '기본값';
  var rtProf = PP_STD.retort.profile[firstProd] || PP_STD.retort.profile['기본값'];
  var EA_PER_CART = rtProf.eaPerCart;
  var RT_MIN = rtProf.minutes;
  var MAX_EA_PER_BATCH = EA_PER_CART * PP_STD.retort.carts_per_batch;
  var retortCycles = Math.max(1, Math.ceil(totalQty / MAX_EA_PER_BATCH));
  var retortStart = pkStart + 30; // 첫 산출 후 시작 (단순화)
  var retortEnd = retortStart + retortCycles * RT_MIN; // 단순: 순차 (실제 3대 병렬이지만 안전쪽)
  // 더 정확: 3대 병렬 회차 = ceil(cycles/3) × RT_MIN
  var retortEndParallel = retortStart + Math.ceil(retortCycles / PP_STD.retort.machines) * RT_MIN;
  retortEnd = Math.max(retortEndParallel, pkEnd + Math.round(RT_MIN * 0.3)); // 내포장 종료 후 마지막 회차도 살균 필요

  // ── 8. 인원 부족 체크 ──
  // 내포장 가동 중 매 10분마다 가용 vs 필요 비교
  var shortage = null;
  for(var tc = pkStart; tc < pkEnd; tc += 10){
    var av = workersAt(tc);
    var isLunch = (tc >= L1S && tc < L2E);
    var effAv = isLunch ? Math.floor(av * 0.5) : av;
    var cookNow = cookSchedule.filter(function(c){return c.inTime <= tc && c.outTime > tc;}).length;
    var need = pkConsumeWorkers + cookNow * cookWorkersFixed + 1; // +1 파쇄 최소
    if(effAv < need){
      if(!shortage) shortage = { time: tc, avail: effAv, need: need, isLunch: isLunch };
    }
  }

  // ── 9. 시간대별 슬롯 (timetable_test 방식: 의미있는 경계만) ──
  var checkpoints = [ppStart];
  input.shifts.forEach(function(sh){ checkpoints.push(_ppToMin(sh.time)); });
  checkpoints.push(L1S, PP_STD.lunch.lunch1_e, L2E);
  cookSchedule.forEach(function(c){ checkpoints.push(c.inTime, c.outTime); });
  checkpoints.push(ppEndMin, firstCookOut, shStart, shEnd, pkStart, pkEnd, retortEnd);
  checkpoints = checkpoints.filter(function(x){return x>=ppStart && x<=retortEnd+30;});
  checkpoints.sort(function(a,b){return a-b;});
  var uniq = [];
  checkpoints.forEach(function(x){ if(uniq.length === 0 || uniq[uniq.length-1] !== x) uniq.push(x); });

  var slots = uniq.map(function(t){
    var av = workersAt(t);
    var isLunch = (t >= L1S && t < L2E);
    var effAv = isLunch ? Math.floor(av * 0.5) : av;
    var aLunch = isLunch ? (av - effAv) : 0;
    var cookNow = cookSchedule.filter(function(c){return c.inTime <= t && c.outTime > t;}).length;
    var aCook = cookNow * cookWorkersFixed;
    var aMgr = managerWorkers;
    var aPk = 0, aTrans = 0, aRetort = 0;
    if(t >= pkStart && t < pkEnd){
      aPk = packingWorkers; aTrans = transferWorkers; aRetort = retortWorkers;
    }
    var rem = effAv - aCook - aMgr - aPk - aTrans - aRetort;
    var aSh = 0;
    if(t >= shStart && t < shEnd){
      aSh = Math.min(SH_MAX_W, Math.max(0, rem));
      rem -= aSh;
    }
    var aPp = 0;
    if(t < ppEndMin){
      aPp = Math.max(0, rem);
      rem = 0;
    }
    var aIdle = Math.max(0, rem); // 잉여 = 외포장/제수로 자동 흡수
    return {tMin:t, avail:av, effAvail:effAv, lunch:aLunch, alloc:{pp:aPp, sh:aSh, pk:aPk, trans:aTrans, retort:aRetort, cook:aCook, mgr:aMgr, idle:aIdle}};
  });

  // 평균 잉여 (의미 있는 슬롯들)
  var idleSum = 0, idleCnt = 0;
  slots.forEach(function(s){ if(s.tMin >= ppStart && s.tMin < pkEnd){ idleSum += s.alloc.idle; idleCnt++; } });
  var avgIdle = idleCnt > 0 ? Math.round(idleSum / idleCnt) : 0;

  // 대표 alloc (내포장 가동 중)
  var repSlot = slots.find(function(s){return s.tMin >= pkStart + 10 && s.tMin < pkEnd;}) || slots[Math.floor(slots.length/2)] || slots[0];
  var allocRep = repSlot ? {
    preprocess: repSlot.alloc.pp, shredding: repSlot.alloc.sh, packing: repSlot.alloc.pk,
    trans: repSlot.alloc.trans, retort: repSlot.alloc.retort, cook: repSlot.alloc.cook, mgr: repSlot.alloc.mgr, idle: repSlot.alloc.idle
  } : { preprocess:0, shredding:0, packing:packingWorkers, trans:transferWorkers, retort:retortWorkers, cook:0, mgr:managerWorkers, idle:0 };

  var feasible = pkEnd <= maxEndMin && !shortage;
  var reason = null;
  if(shortage){
    feasible = false;
    var hint = shortage.isLunch ? ' (점심 시간대 절반만 가용)' : '';
    reason = _ppToTime(shortage.time) + ' 시점 ' + shortage.need + '명 필요 (가용 ' + shortage.avail + '명, 부족 ' + (shortage.need - shortage.avail) + '명)' + hint;
  }

  return {
    mode: mode,
    feasible: feasible,
    reason: reason,
    alloc: allocRep,
    cookWorkers: cookWorkersFixed,
    retortWorkers: retortWorkers,
    transferWorkers: transferWorkers,
    managerWorkers: managerWorkers,
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
    retortBatches: retortCycles,
    retortProfile: { product: firstProd, eaPerCart: EA_PER_CART, minutes: RT_MIN },
    pkInfo: pkInfo,
    timeline: {
      pp: { start: ppStart, end: ppEndMin },
      cook: { start: cookStartMin, end: cookEndMin },
      sh: { start: shStart, end: shEnd },
      pk: { start: pkStart, end: pkEnd },
      retort: { start: retortStart, end: retortEnd }
    },
    endTime: pkEnd,
    overrun: feasible ? 0 : Math.max(0, pkEnd - maxEndMin),
    shifts: slots,
    shortage: shortage
  };
}

// 호기 배정 (productMatch 사용)
function _ppAssignToLines(prodEa){
  var lines = PP_STD.packing_lines.map(function(l){
    return { id:l.id, name:l.name, products:[], totalEa:0, workers:l.workers, ea_per_min:l.ea_per_min, productMatch:l.productMatch };
  });
  prodEa.forEach(function(p){
    // 1호기 미니, 2호기 FC, 그 외는 3·4호기 균등 분할
    var matched = false;
    for(var i = 0; i < 2; i++){ // 1·2호기 (특수)
      if(lines[i].productMatch && lines[i].productMatch(p.name)){
        lines[i].products.push({name:p.name, qty:p.qty});
        lines[i].totalEa += p.qty;
        matched = true;
        break;
      }
    }
    if(!matched){
      // 3·4호기 균등 분할
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
    html += '<div style="margin-top:8px;font-size:11px;color:#94a3b8">※ 점심 11:30~13:30 = 반반 교대 (사선 음영, 절반 속도). 전처리·파쇄는 시간대별로 인원 변동.</div>';
    html += '</div>';
  }

  // 시간대별 인력 배치 슬롯
  if(rec.shifts && rec.shifts.length){
    html += '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:18px">';
    html += '<h3 style="margin:0 0 12px;font-size:15px;color:#1e293b;font-weight:700">👥 시간대별 인력 배치</h3>';
    html += _ppRenderShifts(rec);
    html += '<div style="margin-top:8px;font-size:11px;color:#94a3b8">※ 점심 11:30~13:30 = 반반 교대 (절반 식사 / 절반 작업 계속, 가용 절반). 외포장은 잉여 인력으로 자동 투입.</div>';
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
  html += '<div>· 내포장 '+sc.alloc.packing+' / 이송 '+sc.alloc.trans+' / 레토르트 '+sc.alloc.retort+' / 관리 '+sc.alloc.mgr+'</div>';
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
    { name: '🚚 이송',   start: t.pk.start, end: t.pk.end, w: sc.transferWorkers, color: '#60a5fa' },
    { name: '🔥 레토르트', start: t.retort.start, end: t.retort.end, w: sc.retortWorkers, color: '#fb923c' }
  ];
  var minT = Math.min.apply(null, rows.map(function(r){return r.start;}));
  var maxT = Math.max.apply(null, rows.map(function(r){return r.end;}));
  var span = Math.max(1, maxT - minT);

  var lunchStart = PP_STD.lunch.lunch1_s;
  var lunchEnd = PP_STD.lunch.lunch2_e;
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
    var sameAlloc = prev.avail === s.avail && prev.lunch === s.lunch && p.pp === c.pp && p.sh === c.sh && p.pk === c.pk && p.trans === c.trans && p.retort === c.retort && p.cook === c.cook && p.mgr === c.mgr;
    if(!sameAlloc || (s.tMin - prev.tMin) >= 30){
      displayed.push(s);
    }
  }
  // 종료 시각도 추가
  var lastShift = slots[slots.length - 1];
  if(displayed[displayed.length - 1] !== lastShift) displayed.push(lastShift);

  var html = '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:820px">';
  html += '<thead><tr style="background:#f1f5f9">';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:60px">시각</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:50px">가용</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">전처리</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">자숙</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">파쇄</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">내포장</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">이송</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">레토르트</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">관리</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">점심</th>';
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
    html += '<td style="text-align:center;padding:6px;color:#1e40af">'+(a.trans||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#ea580c">'+(a.retort||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#64748b">'+(a.mgr||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#a16207">'+(s.lunch>0?s.lunch+'명':'-')+'</td>';
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
  html += '<div style="font-weight:600;color:#1e40af;margin-bottom:8px">공정별 인원 배치 근거</div>';
  html += '<div style="margin-bottom:4px">• <b>자숙 '+sc.cookWorkers+'명</b> (고정) — 회차당 2명, 회차 중에만 점유</div>';
  html += '<div style="margin-bottom:4px">• <b>내포장 '+sc.alloc.packing+'명</b> — 호기별 인원 합 ('+(sc.pkInfo?sc.pkInfo.lines.map(function(l){return l.name+' '+l.workers;}).join(' / '):'')+')</div>';
  html += '<div style="margin-bottom:4px">• <b>이송 '+sc.transferWorkers+'명</b> — 가동 호기 '+(sc.pkInfo?sc.pkInfo.lines.length:0)+'대 × 2명</div>';
  html += '<div style="margin-bottom:4px">• <b>레토르트 '+sc.retortWorkers+'명</b> — 내포장 가동 중 1명 고정</div>';
  html += '<div style="margin-bottom:4px">• <b>관리 '+sc.managerWorkers+'명</b> — 전 공정 항상 1명</div>';
  html += '<div style="margin-bottom:4px">• <b>전처리/파쇄</b> — 시간대별 가용 인원 동적 배치, 점심엔 반반 교대 (절반 식사, 절반 일)</div>';
  html += '<div style="margin-bottom:4px;color:#64748b;font-size:12px">↳ 산출량: 전처리 '+sc.ppOutKg.toFixed(0)+'kg / 자숙 '+sc.cookOutKg.toFixed(0)+'kg / 파쇄 '+sc.shredOutKg.toFixed(0)+'kg / 내포장 '+sc.totalQty.toLocaleString()+'EA</div>';
  if(sc.retortProfile){
    html += '<div style="margin-bottom:4px;color:#64748b;font-size:12px">↳ 레토르트: '+sc.retortBatches+'회차 × '+sc.retortProfile.minutes+'분 (대차당 '+sc.retortProfile.eaPerCart+' EA)</div>';
  }
  if(sc.leftover > 0){
    html += '<div style="margin-top:8px;color:#16a34a">✓ 평균 잉여 <b>'+sc.leftover+'명</b> — 외포장·제수 자동 투입</div>';
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
