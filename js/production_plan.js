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
  // 전처리 인시 — 실측 (4월 22일 평균): 5명 98kg/인시, 7명 84kg/인시, 인원 늘수록 약간 감소
  preprocess_kg_per_manhour: 98,         // 5명 기준 표준
  preprocess_kg_per_manhour_large: 84,   // 7명 이상일 때
  cooking: {
    tanks_total: 6,
    tanks_pressure: 2,
    kg_per_tank: 800,
    target_kg_per_batch: 400,  // 실측: 회차당 약 400kg 분배 (운영자가 작게 자주)
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

// 기본값 보관 (초기화 버튼용)
var PP_STD_DEFAULTS = JSON.parse(JSON.stringify(PP_STD));

// ============================================================
// 파라미터 Firestore 동기화 (_config/production_plan_params)
// ============================================================
async function _ppLoadParams(){
  try {
    if(typeof db === 'undefined' || !db) return;
    var doc = await db.collection('_config').doc('production_plan_params').get();
    if(!doc.exists) return;
    var data = doc.data();
    if(!data || !data.params) return;
    // PP_STD에 덮어쓰기 (deep merge)
    _ppDeepMerge(PP_STD, data.params);
    console.log('[PP] params loaded from Firestore');
  } catch(e){
    console.warn('[PP] params load failed:', e);
  }
}
async function _ppSaveParams(){
  try {
    if(typeof db === 'undefined' || !db){ alert('Firestore 연결 안 됨'); return false; }
    // packing_lines의 productMatch 함수는 저장 불가 → 직렬화 시 제외
    var saveable = JSON.parse(JSON.stringify(PP_STD, function(k,v){
      if(typeof v === 'function') return undefined;
      return v;
    }));
    await db.collection('_config').doc('production_plan_params').set({
      params: saveable,
      updatedAt: new Date().toISOString()
    });
    console.log('[PP] params saved to Firestore');
    return true;
  } catch(e){
    console.warn('[PP] params save failed:', e);
    alert('파라미터 저장 실패: ' + e.message);
    return false;
  }
}
function _ppDeepMerge(target, src){
  for(var k in src){
    if(src.hasOwnProperty(k)){
      if(src[k] !== null && typeof src[k] === 'object' && !Array.isArray(src[k]) && typeof target[k] === 'object' && !Array.isArray(target[k])){
        _ppDeepMerge(target[k], src[k]);
      } else if(Array.isArray(src[k]) && Array.isArray(target[k])){
        // packing_lines 같은 배열: 인덱스별 덮어쓰기 (productMatch는 기본값 유지)
        src[k].forEach(function(item, i){
          if(target[k][i] && typeof item === 'object'){
            for(var kk in item){
              if(item.hasOwnProperty(kk) && kk !== 'productMatch'){
                target[k][i][kk] = item[kk];
              }
            }
          }
        });
      } else {
        target[k] = src[k];
      }
    }
  }
}
function _ppResetParams(){
  if(!confirm('파라미터를 기본값으로 초기화하시겠습니까? (Firestore에도 반영됨)')) return;
  // 함수 필드는 보존
  var pmList = PP_STD.packing_lines.map(function(l){return l.productMatch;});
  _ppDeepMerge(PP_STD, JSON.parse(JSON.stringify(PP_STD_DEFAULTS)));
  PP_STD.packing_lines.forEach(function(l,i){ l.productMatch = pmList[i]; });
  _ppSaveParams().then(function(){
    _ppRunSimulation(); // 재시뮬
    renderProductionPlan(); // UI 재렌더
  });
}

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

  // 둘 다 안 되면 → 인원 부족: 추천 인원 자동 탐색
  var recommendation = null;
  if(!scA.feasible && !scB.feasible){
    recommendation = _ppFindMinimalCrew(input);
  }

  _ppRenderResult(input, scA, scB, recommendation);
}

// ============================================================
// 추천 인원 탐색 — 입력 물량을 최대 종료시각 안에 끝낼 수 있는 최소 인원 조합 찾기
// 전략:
//   1. 조출(첫 시간대) 인원을 5,7,10,12,14명으로 키워가며 한국인 합류 조정
//   2. 각 조합으로 시뮬 돌려서 feasible & endTime ≤ maxEnd 만족하는 가장 적은 인원
//   3. 시간대 구조는 사용자 입력 그대로 유지 (조출 + 한국인 합류)
// ============================================================
function _ppFindMinimalCrew(originalInput){
  var maxEnd = _ppToMin(originalInput.maxEnd);
  var shifts = originalInput.shifts;
  if(!shifts || shifts.length === 0) return null;

  // 조출 인원 후보 (첫 시간대)
  var firstShift = shifts[0];
  var laterShifts = shifts.slice(1);
  var laterTotal = laterShifts.reduce(function(s,sh){return s + sh.workers;}, 0);

  // 1단계: 조출 인원 키우기 (5~16명)
  // 2단계: 한국인 추가 (laterTotal + 0,2,4,...,12명)
  var candidates = [];
  for(var early = Math.max(5, firstShift.workers); early <= 18; early += 1){
    for(var laterExtra = 0; laterExtra <= 16; laterExtra += 2){
      var newShifts = [{time: firstShift.time, workers: early}];
      laterShifts.forEach(function(sh, i){
        var extra = (i === 0) ? laterExtra : 0; // 한국인 합류 시간대에만 추가
        newShifts.push({time: sh.time, workers: sh.workers + extra});
      });
      var testInput = {
        shifts: newShifts,
        startTime: originalInput.startTime,
        maxEnd: originalInput.maxEnd,
        workers: early + laterTotal + laterExtra,
        products: originalInput.products
      };
      var scM = _ppSimulate(testInput, 'morning');
      var scA2 = _ppSimulate(testInput, 'afternoon');
      var best = null;
      if(scM.feasible && scA2.feasible){
        best = scM.endTime <= scA2.endTime ? scM : scA2;
      } else if(scM.feasible){ best = scM; }
      else if(scA2.feasible){ best = scA2; }

      if(best && best.feasible){
        candidates.push({
          totalWorkers: testInput.workers,
          earlyExtra: early - firstShift.workers,
          laterExtra: laterExtra,
          shifts: newShifts,
          endTime: best.endTime,
          mode: best.mode,
          original: {early: firstShift.workers, later: laterTotal}
        });
        break; // 이 조출 인원에서 만족하는 첫 번째 한국인 추가량을 찾음 → 다음 조출로
      }
    }
  }

  if(candidates.length === 0) return null;
  // 가장 적은 총 인원 추천
  candidates.sort(function(a,b){
    if(a.totalWorkers !== b.totalWorkers) return a.totalWorkers - b.totalWorkers;
    return a.endTime - b.endTime;
  });
  return candidates[0];
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
  // 회차 수 — 실측 패턴: 회차당 약 400kg (운영자가 작게 자주 나눠서 빨리 종료)
  // 단, 탱크 가용성(가압 2대/비가압 4대)도 고려
  function _calcCycles(total, isPressure){
    if(total <= 0) return 0;
    var target = ckRule.target_kg_per_batch; // 400kg
    var n = Math.ceil(total / target);
    // 탱크 가용 제약 — 동시 가용 탱크 수보다 너무 많은 회차는 의미 없음 (가용 후 다음 회차로 순환)
    var maxTanks = isPressure ? ckRule.tanks_pressure : (ckRule.tanks_total - ckRule.tanks_pressure);
    // 회차 수 = min(목표분할수, 적정 캡)
    // 실측: 1500kg+ 케이스도 2~4회차. 5회 이상은 비현실 (탱크 회전 시간 고려)
    n = Math.max(1, Math.min(n, 4));
    return n;
  }
  var pressureCycles = _calcCycles(prodPressureKg, true);
  var normalCycles   = _calcCycles(prodNormalKg, false);
  function _tankKgs(total, n){
    if(n === 0) return [];
    if(n === 1) return [total];
    var each = total / n;
    var arr = [];
    for(var j = 0; j < n; j++) arr.push(each);
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
  var transferWorkers = pkInfo.lines.length * PP_STD.transfer_workers_per_line; // 표시용
  var retortWorkers = PP_STD.retort.workers_total; // 1명 (표시용)
  var managerWorkers = PP_STD.manager_workers;     // 1명
  var cookWorkersFixed = ckRule.workers_per_batch; // 2명/회차

  // 내포장 가동 시 점유 인원 — 실측 패턴:
  //   호기 본 인원만 점유 (이송·외포장·레토르트는 잉여 인력이 자동 흡수)
  //   즉 28명 중 호기 6명만 빠지면 나머지 22명이 파쇄/외포장/이송/제수 등에 자유롭게 흐름
  var pkConsumeWorkers = packingWorkers + managerWorkers;

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

    // 전처리 처리 — 인원에 따라 인시 다름 (실측 4월 기준)
    if(ppRemain > 0 && ppAvail > 0){
      // 5명일 때 98 kg/인시, 7명 이상일 때 84 kg/인시
      var ppKgPH = ppAvail >= 7 ? PP_STD.preprocess_kg_per_manhour_large : PP_STD.preprocess_kg_per_manhour;
      var ppDone = (ppKgPH / 60) * ppAvail;
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
      // 탱크 번호: 가압은 1·2, 비가압은 3~6 중 가용한 것
      var usedTanks = cookSchedule.filter(function(c){return c.inTime <= t && c.outTime > t;}).map(function(c){return c.tank;});
      var tankRange = nx.type === 'pressure' ? [1,2] : [3,4,5,6];
      var tankNum = null;
      for(var ti = 0; ti < tankRange.length; ti++){
        if(usedTanks.indexOf(tankRange[ti]) === -1){ tankNum = tankRange[ti]; break; }
      }
      // 가압 가능 탱크 다 사용 중이면 비가압 탱크에 (안전쪽 — 실제 운영에서도 가능)
      if(tankNum === null){
        for(var ti2 = 1; ti2 <= ckRule.tanks_total; ti2++){
          if(usedTanks.indexOf(ti2) === -1){ tankNum = ti2; break; }
        }
      }
      cookSchedule.push({type:nx.type, kg:nx.kg, inTime:inT, outTime:outT, tank:tankNum, durMin:nx.durMin});
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

  // 호기별 가동 시각 (점심 반영) — 행 분할용
  pkInfo.lines.forEach(function(l){
    var lineEndPure = pkStart + (l.ea / l.ea_per_min);
    // 점심 통과 반영
    var lineEndLunch = _ppWorkWithLunch(pkStart, l.ea / l.ea_per_min);
    l.startMin = pkStart;
    l.endMin = Math.round(lineEndLunch);
    // 인시 생산성 (EA/인시)
    l.eaPerPersonHour = Math.round(l.ea_per_min * 60 / l.workers);
  });

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
  // (1) 내포장 가동 중 매 10분 가용 vs 필요
  // (2) 파쇄가 비현실적으로 늘어진 경우 (= 내포장 종료보다 1시간 이상 늦음 → 내포장이 파쇄 기다리느라 정지)
  var shortage = null;
  for(var tc = pkStart; tc < pkEnd; tc += 10){
    // 점심 시간은 체크 안함 — 점심 시 50% 속도는 자연스러운 운영
    var isLunch = (tc >= L1S && tc < L2E);
    if(isLunch) continue;
    var av = workersAt(tc);
    var cookNow = cookSchedule.filter(function(c){return c.inTime <= tc && c.outTime > tc;}).length;
    var need = pkConsumeWorkers + cookNow * cookWorkersFixed + 1; // +1 파쇄 최소
    if(av < need){
      if(!shortage) shortage = { time: tc, avail: av, need: need, isLunch: false, type:'workers' };
    }
  }
  // 파쇄가 못 따라가면 → 자연스럽게 endTime이 늘어나서 maxEnd 초과로 reject됨
  // 별도 shred_lag 체크는 불필요 (이중 처리)
  // 자숙 동시 진행 시 인력 부족도 사전 체크 (자숙 회차 다 펼쳐서 동시 active 시점)
  var maxConcurrentCook = 0;
  cookSchedule.forEach(function(c){
    var concurrent = cookSchedule.filter(function(c2){return c2.inTime <= c.inTime && c2.outTime > c.inTime;}).length;
    maxConcurrentCook = Math.max(maxConcurrentCook, concurrent);
  });
  if(!shortage && maxConcurrentCook > 0){
    // 자숙 시작 시점들에서 인력 체크 — 단 자숙만 가능하면 OK (관리·전처리는 1명 안 들어가도 가능)
    cookSchedule.forEach(function(c){
      if(shortage) return;
      var tc2 = c.inTime;
      var av2 = workersAt(tc2);
      var concurrent = cookSchedule.filter(function(c2){return c2.inTime <= tc2 && c2.outTime > tc2;}).length;
      var need2 = concurrent * cookWorkersFixed; // 자숙 인원만
      if(av2 < need2){
        shortage = { time: tc2, avail: av2, need: need2, isLunch:false, type:'cook_concurrent' };
      }
    });
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
  // 대표 alloc 선택: 내포장 + 파쇄 둘 다 가동 중인 시점 우선
  // 그 시점이 없으면 내포장 가동 중 첫 시점
  var repSlot = slots.find(function(s){
    return s.tMin >= pkStart && s.tMin < pkEnd && s.alloc.pk > 0 && s.alloc.sh > 0;
  });
  if(!repSlot){
    repSlot = slots.find(function(s){return s.tMin >= pkStart && s.tMin < pkEnd && s.alloc.pk > 0;});
  }
  if(!repSlot){
    repSlot = slots[Math.floor(slots.length/2)] || slots[0];
  }
  var allocRep = repSlot ? {
    preprocess: repSlot.alloc.pp, shredding: repSlot.alloc.sh, packing: repSlot.alloc.pk,
    trans: repSlot.alloc.trans, retort: repSlot.alloc.retort, cook: repSlot.alloc.cook, mgr: repSlot.alloc.mgr, idle: repSlot.alloc.idle
  } : { preprocess:0, shredding:0, packing:packingWorkers, trans:transferWorkers, retort:retortWorkers, cook:0, mgr:managerWorkers, idle:0 };

  var feasible = pkEnd <= maxEndMin && !shortage;
  var reason = null;
  if(shortage){
    feasible = false;
    if(shortage.type === 'shred_lag'){
      reason = '파쇄 인원 부족 — 내포장이 '+pkConsumeWorkers+'명 점유 후 파쇄 가용 약 '+shortage.avail+'명 (최대 '+SH_MAX_W+'명 필요). 호기 자체 가동 '+shortage.pkPureMin+'분인데 파쇄 못 따라가서 '+shortage.pkActualMin+'분 소요. 작업량 줄이거나 인원 추가 필요';
    } else if(shortage.type === 'cook_concurrent'){
      reason = _ppToTime(shortage.time) + ' 시점 자숙 동시 진행 인력 부족 — 필요 '+shortage.need+'명, 가용 '+shortage.avail+'명 (자숙 회차 분산 필요)';
    } else {
      var hint = shortage.isLunch ? ' (점심 시간대 절반만 가용)' : '';
      reason = _ppToTime(shortage.time) + ' 시점 ' + shortage.need + '명 필요 (가용 ' + shortage.avail + '명, 부족 ' + (shortage.need - shortage.avail) + '명)' + hint;
    }
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
      activeLines.push({
        id:l.id, name:l.name, ea:l.totalEa, workers:l.workers, ea_per_min:l.ea_per_min,
        minutes: min, products: l.products || []
      });
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
function _ppRenderResult(input, scA, scB, recommendation){
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
    : '<span style="background:#fee2e2;color:#b91c1c;border-radius:4px;padding:3px 10px;font-size:12px;font-weight:700">❌ 현재 인원으로 불가</span>';

  var html = '';

  // ── 추천 카드 (현재 인원으로 안 되면 → 어떻게 하면 되는지) ──
  if(recommendation){
    html += '<div style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);color:#fff;border-radius:12px;padding:20px 24px;margin-bottom:18px;box-shadow:0 4px 14px rgba(16,185,129,0.3)">';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:13px;background:rgba(255,255,255,0.25);padding:4px 12px;border-radius:20px;font-weight:700">💡 작업 가능한 방법</span></div>';
    html += '<div style="font-size:20px;font-weight:700;margin-bottom:10px">총 <b>'+recommendation.totalWorkers+'명</b>으로 가능 — 종료 '+_ppToTime(recommendation.endTime)+'</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px">';
    recommendation.shifts.forEach(function(sh, i){
      var orig = (i === 0) ? recommendation.original.early : 
                 (i === 1) ? recommendation.shifts[1].workers - (recommendation.laterExtra||0) : sh.workers;
      var diff = sh.workers - (i === 0 ? input.shifts[0].workers : (input.shifts[i] ? input.shifts[i].workers : 0));
      var extraTag = diff > 0 ? '<span style="background:#fbbf24;color:#1f2937;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:6px;font-weight:700">+'+diff+'명</span>' : '';
      html += '<div style="background:rgba(255,255,255,0.18);border-radius:8px;padding:12px">';
      html += '<div style="font-size:12px;opacity:0.9">'+sh.time+'</div>';
      html += '<div style="font-size:24px;font-weight:700;margin-top:4px">'+sh.workers+'명'+extraTag+'</div>';
      html += '</div>';
    });
    html += '</div>';
    var msg = '';
    if(recommendation.earlyExtra > 0){
      msg += '조출 <b>'+recommendation.earlyExtra+'명 추가</b>';
    }
    if(recommendation.laterExtra > 0){
      if(msg) msg += ' + ';
      msg += '한국인 합류 시 <b>'+recommendation.laterExtra+'명 추가</b>';
    }
    if(msg){
      html += '<div style="margin-top:12px;font-size:14px;background:rgba(0,0,0,0.15);padding:10px 14px;border-radius:6px">↳ '+msg+' 시 작업 가능</div>';
    }
    html += '</div>';
  }

  // ── 현재 입력 시뮬 결과 (참고용) ──
  html += '<div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);color:#fff;border-radius:12px;padding:20px 24px;margin-bottom:18px;box-shadow:0 4px 14px rgba(59,130,246,0.25)">';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:12px;background:rgba(255,255,255,0.25);padding:3px 10px;border-radius:20px;font-weight:600">'+(recommendation?'현재 입력':'추천')+'</span>'+recBadge+'</div>';
  html += '<div style="font-size:22px;font-weight:700;margin-bottom:4px">'+recLabel+'</div>';
  html += '<div style="font-size:14px;opacity:0.9">입력 인원 <b>'+input.workers+'명</b> · 종료 <b>'+_ppToTime(rec.endTime)+'</b>';
  if(!rec.feasible){
    if(rec.reason) html += '<div style="margin-top:8px;font-size:13px;background:rgba(0,0,0,0.2);padding:8px 12px;border-radius:6px;line-height:1.5">'+rec.reason+'</div>';
    else html += ' <span style="color:#fbbf24">(최대 '+_ppToTime(_ppToMin(input.maxEnd))+'보다 '+Math.round(rec.overrun)+'분 초과)</span>';
  }
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
  html += '<div>· 내포장 '+(sc.alloc.packing + sc.alloc.trans)+' (호기 '+sc.alloc.packing+' + 이송 '+sc.alloc.trans+') / 레토르트 '+sc.alloc.retort+' / 관리 '+sc.alloc.mgr+'</div>';
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
  // 행 구성 — 자숙은 회차별, 내포장은 호기별로 분할
  var rows = [];

  // 전처리
  var ppDurMin = t.pp.end - t.pp.start;
  var ppRate = PP_STD.preprocess_kg_per_manhour;
  var ppEstWorkers = ppDurMin > 0 ? Math.round(sc.ppOutKg / (ppRate * ppDurMin / 60)) : 0;
  rows.push({
    name: '🥩 전처리',
    start: t.pp.start, end: t.pp.end,
    w: ppEstWorkers > 0 ? '~'+ppEstWorkers : '-',
    color: '#fbbf24',
    tooltip: '전처리\\n시간: '+_ppFmtDur(ppDurMin)+'\\n처리량: '+Math.round(sc.ppOutKg)+'kg (산출 기준)\\n생산성: '+ppRate+' kg/인시\\n평균 인원: 약 '+ppEstWorkers+'명'
  });

  // 자숙 — 회차별 분할
  if(sc.cookSchedule && sc.cookSchedule.length){
    sc.cookSchedule.forEach(function(c, i){
      var typeLabel = c.type === 'pressure' ? '가압' : '비가압';
      var tankLabel = c.tank ? c.tank+'번 탱크' : '-';
      rows.push({
        name: '🍲 자숙 #'+(i+1)+' ('+typeLabel+')',
        start: c.inTime, end: c.outTime,
        w: sc.cookWorkers, color: c.type === 'pressure' ? '#f87171' : '#fca5a5',
        tooltip: '자숙 #'+(i+1)+' ('+typeLabel+')\\n시간: '+_ppFmtDur(c.outTime - c.inTime)+'\\n탱크: '+tankLabel+'\\n투입량: '+Math.round(c.kg)+'kg\\n산출량: '+Math.round(c.kg * PP_STD.yield.cooking)+'kg (수율 '+(PP_STD.yield.cooking*100).toFixed(0)+'%)\\n인원: '+sc.cookWorkers+'명/회차 고정'
      });
    });
  }

  // 파쇄
  var shDurMin = t.sh.end - t.sh.start;
  var shRate = PP_STD.shredding_kg_per_manhour;
  rows.push({
    name: '🔪 파쇄',
    start: t.sh.start, end: t.sh.end,
    w: '~'+sc.alloc.shredding,
    color: '#a78bfa',
    tooltip: '파쇄\\n시간: '+_ppFmtDur(shDurMin)+'\\n처리량: '+Math.round(sc.cookOutKg)+'kg → 산출 '+Math.round(sc.shredOutKg)+'kg\\n생산성: '+shRate+' kg/인시\\n최대 인원: '+PP_STD.shredding_max_workers+'명 (그 이상은 효율 X)\\n점심엔 절반 교대'
  });

  // 내포장 — 호기별 분할
  if(sc.pkInfo && sc.pkInfo.lines){
    sc.pkInfo.lines.forEach(function(l){
      var lineDurMin = (l.endMin || t.pk.end) - (l.startMin || t.pk.start);
      var prodNames = (l.products || []).map(function(p){return p.name;}).join(', ');
      rows.push({
        name: '📦 '+l.name,
        start: l.startMin || t.pk.start, end: l.endMin || t.pk.end,
        w: l.workers,
        color: '#34d399',
        tooltip: l.name+'\\n제품: '+(prodNames||'-')+'\\n시간: '+_ppFmtDur(lineDurMin)+'\\n처리량: '+l.ea.toLocaleString()+' EA\\n분당: '+l.ea_per_min+' EA/min\\n인시 생산성: '+l.eaPerPersonHour+' EA/인시\\n인원: '+l.workers+'명 + 이송 '+PP_STD.transfer_workers_per_line+'명'
      });
    });
  }

  // 레토르트
  var rtDurMin = t.retort.end - t.retort.start;
  rows.push({
    name: '🔥 레토르트',
    start: t.retort.start, end: t.retort.end,
    w: sc.retortWorkers,
    color: '#fb923c',
    tooltip: '레토르트\\n시간: '+_ppFmtDur(rtDurMin)+'\\n회차: '+sc.retortBatches+'회 × '+(sc.retortProfile?sc.retortProfile.minutes:120)+'분\\n대차당: '+(sc.retortProfile?sc.retortProfile.eaPerCart:'-')+' EA\\n3대 병렬 가동\\n인원: '+sc.retortWorkers+'명 고정'
  });

  var minT = Math.min.apply(null, rows.map(function(r){return r.start;}));
  var maxT = Math.max.apply(null, rows.map(function(r){return r.end;}));
  var span = Math.max(1, maxT - minT);

  var lunchStart = PP_STD.lunch.lunch1_s;
  var lunchEnd = PP_STD.lunch.lunch2_e;
  var lunchVisible = lunchStart >= minT && lunchEnd <= maxT;
  var lunchLeft = (lunchStart - minT) / span * 100;
  var lunchWidth = (lunchEnd - lunchStart) / span * 100;

  var html = '<table style="width:100%;font-size:12px;border-collapse:collapse">';
  html += '<thead><tr style="background:#f1f5f9"><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #cbd5e1;width:170px">공정</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:130px">시간</th><th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:60px">인원</th><th style="padding:6px;border-bottom:1px solid #cbd5e1">바</th></tr></thead><tbody>';
  rows.forEach(function(r){
    var leftPct = Math.max(0, (r.start - minT) / span * 100);
    var widthPct = Math.max(0.5, (r.end - r.start) / span * 100);
    var tipEsc = r.tooltip ? r.tooltip.replace(/"/g,'&quot;') : '';
    html += '<tr style="border-bottom:1px solid #f1f5f9" title="'+tipEsc+'">';
    html += '<td style="padding:8px;font-weight:600">'+r.name+'</td>';
    html += '<td style="text-align:center;padding:8px;color:#475569">'+_ppToTime(r.start)+' ~ '+_ppToTime(r.end)+'</td>';
    html += '<td style="text-align:center;padding:8px;font-weight:600">'+r.w+'명</td>';
    html += '<td style="padding:6px"><div style="position:relative;height:18px;background:#f1f5f9;border-radius:4px">';
    if(lunchVisible){
      html += '<div style="position:absolute;left:'+lunchLeft+'%;width:'+lunchWidth+'%;height:100%;background:repeating-linear-gradient(45deg,rgba(0,0,0,0.06),rgba(0,0,0,0.06) 4px,transparent 4px,transparent 8px);border-radius:4px" title="점심 반반 교대"></div>';
    }
    html += '<div style="position:absolute;left:'+leftPct+'%;width:'+widthPct+'%;height:100%;background:'+r.color+';border-radius:4px;opacity:0.92" title="'+tipEsc+'"></div>';
    html += '</div></td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

// 시간 포맷 (분 → "Xh Ym")
function _ppFmtDur(mins){
  mins = Math.max(0, Math.round(mins));
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  if(h === 0) return m+'분';
  if(m === 0) return h+'시간';
  return h+'시간 '+m+'분';
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

  var html = '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;min-width:760px">';
  html += '<thead><tr style="background:#f1f5f9">';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:60px">시각</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1;width:50px">가용</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">전처리</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">자숙</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">파쇄</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1" title="호기 + 이송 합계">내포장</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">레토르트</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">관리</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">점심</th>';
  html += '<th style="text-align:center;padding:6px;border-bottom:1px solid #cbd5e1">잉여</th>';
  html += '</tr></thead><tbody>';
  displayed.forEach(function(s){
    var a = s.alloc;
    var pkTotal = (a.pk||0) + (a.trans||0);
    var pkTip = a.pk>0 ? '호기 '+a.pk+'명 + 이송 '+a.trans+'명' : '';
    var idleColor = a.idle > 0 ? '#16a34a' : '#94a3b8';
    html += '<tr style="border-bottom:1px solid #f1f5f9">';
    html += '<td style="text-align:center;padding:6px;font-weight:600;color:#1e40af">'+_ppToTime(s.tMin)+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#64748b">'+s.avail+'</td>';
    html += '<td style="text-align:center;padding:6px">'+(a.pp||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px">'+(a.cook||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px">'+(a.sh||'-')+'</td>';
    html += '<td style="text-align:center;padding:6px;color:#15803d;font-weight:600" title="'+pkTip+'">'+(pkTotal||'-')+'</td>';
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
  html += '<div style="margin-bottom:4px">• <b>내포장 '+(sc.alloc.packing + sc.transferWorkers)+'명</b> = 호기 '+sc.alloc.packing+'명 + 이송 '+sc.transferWorkers+'명 (호기 '+(sc.pkInfo?sc.pkInfo.lines.length:0)+'대 × 2명)</div>';
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

    + _ppRenderAdvancedSettings()

    + '  <div id="pp_result"></div>'
    + '</div>';

  // Firestore에서 파라미터 로드 후 UI 반영
  _ppLoadParams().then(function(){
    _ppFillAdvancedInputs();
  });
}

// ============================================================
// 고급 설정 UI (파라미터 편집)
// ============================================================
function _ppRenderAdvancedSettings(){
  return ''
    + '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:14px">'
    + '  <div style="padding:14px 18px;cursor:pointer;display:flex;justify-content:space-between;align-items:center" onclick="_ppToggleAdv()">'
    + '    <div><span style="font-size:14px;font-weight:700;color:#1e293b">⚙ 고급 설정 (인시·생산성·시간)</span><span style="margin-left:10px;font-size:11px;color:#94a3b8">변경 시 모든 디바이스 공유</span></div>'
    + '    <div id="pp_adv_arrow" style="font-size:18px;color:#94a3b8">▾</div>'
    + '  </div>'
    + '  <div id="pp_adv_body" style="display:none;padding:0 18px 18px;border-top:1px solid #f1f5f9">'
    + _ppAdvancedSettingsBody()
    + '  </div>'
    + '</div>';
}

function _ppAdvancedSettingsBody(){
  var html = '';
  // 전처리/파쇄
  html += '<div style="margin-top:14px"><div style="font-weight:600;color:#1e40af;margin-bottom:8px;font-size:13px">🥩 전처리 & 🔪 파쇄</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">';
  html += _ppInputCell('pp_p_pre', '전처리 (kg/인시)', 'preprocess_kg_per_manhour', PP_STD.preprocess_kg_per_manhour, 0.1);
  html += _ppInputCell('pp_p_sh',  '파쇄 (kg/인시)', 'shredding_kg_per_manhour', PP_STD.shredding_kg_per_manhour, 0.1);
  html += _ppInputCell('pp_p_sh_max', '파쇄 최대 인원', 'shredding_max_workers', PP_STD.shredding_max_workers, 1);
  html += '</div></div>';

  // 자숙
  html += '<div style="margin-top:14px"><div style="font-weight:600;color:#1e40af;margin-bottom:8px;font-size:13px">🍲 자숙</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">';
  html += _ppInputCell('pp_p_ck_tank', '탱크당 kg', 'cooking.kg_per_tank', PP_STD.cooking.kg_per_tank, 10);
  html += _ppInputCell('pp_p_ck_p', '가압 시간(분)', 'cooking.minutes_pressure', PP_STD.cooking.minutes_pressure, 5);
  html += _ppInputCell('pp_p_ck_n', '비가압 시간(분)', 'cooking.minutes_normal', PP_STD.cooking.minutes_normal, 5);
  html += _ppInputCell('pp_p_ck_w', '회차당 인원', 'cooking.workers_per_batch', PP_STD.cooking.workers_per_batch, 1);
  html += _ppInputCell('pp_p_wagon', '와건 시간(분)', 'wagon_min', PP_STD.wagon_min, 5);
  html += '</div></div>';

  // 내포장 호기
  html += '<div style="margin-top:14px"><div style="font-weight:600;color:#1e40af;margin-bottom:8px;font-size:13px">📦 내포장 호기 (분당 EA · 인원)</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">';
  PP_STD.packing_lines.forEach(function(l, i){
    html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px">';
    html += '<div style="font-size:12px;font-weight:600;color:#1e40af;margin-bottom:6px">'+l.name+'</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    html += '<label style="font-size:11px;color:#64748b">분당 EA<input type="number" data-pp-key="packing_lines['+i+'].ea_per_min" value="'+l.ea_per_min+'" step="0.1" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;margin-top:2px"></label>';
    html += '<label style="font-size:11px;color:#64748b">인원<input type="number" data-pp-key="packing_lines['+i+'].workers" value="'+l.workers+'" step="1" min="1" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;margin-top:2px"></label>';
    html += '</div></div>';
  });
  html += '</div>';
  html += '<div style="margin-top:8px">'+_ppInputCell('pp_p_trans', '호기당 이송 인원', 'transfer_workers_per_line', PP_STD.transfer_workers_per_line, 1)+'</div>';
  html += '</div>';

  // 레토르트 제품별
  html += '<div style="margin-top:14px"><div style="font-weight:600;color:#1e40af;margin-bottom:8px;font-size:13px">🔥 레토르트 제품별 (대차당 EA · 시간)</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">';
  Object.keys(PP_STD.retort.profile).forEach(function(pname){
    var prof = PP_STD.retort.profile[pname];
    html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px">';
    html += '<div style="font-size:11px;font-weight:600;color:#1e40af;margin-bottom:6px">'+pname+'</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    html += '<label style="font-size:11px;color:#64748b">대차당 EA<input type="number" data-pp-key="retort.profile['+JSON.stringify(pname)+'].eaPerCart" value="'+prof.eaPerCart+'" step="1" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;margin-top:2px"></label>';
    html += '<label style="font-size:11px;color:#64748b">시간(분)<input type="number" data-pp-key="retort.profile['+JSON.stringify(pname)+'].minutes" value="'+prof.minutes+'" step="5" style="width:100%;padding:5px;border:1px solid #cbd5e1;border-radius:4px;margin-top:2px"></label>';
    html += '</div></div>';
  });
  html += '</div></div>';

  // 수율
  html += '<div style="margin-top:14px"><div style="font-weight:600;color:#1e40af;margin-bottom:8px;font-size:13px">📊 수율 (원육 대비 누적)</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">';
  html += _ppInputCell('pp_y_pp', '전처리 수율', 'yield.preprocess', PP_STD.yield.preprocess, 0.001);
  html += _ppInputCell('pp_y_ck', '자숙 수율', 'yield.cooking', PP_STD.yield.cooking, 0.001);
  html += _ppInputCell('pp_y_sh', '파쇄 수율', 'yield.shredding', PP_STD.yield.shredding, 0.001);
  html += '</div></div>';

  // 버튼
  html += '<div style="margin-top:18px;display:flex;gap:10px">';
  html += '<button onclick="_ppApplyParams()" style="flex:1;background:#16a34a;color:#fff;border:none;border-radius:6px;padding:10px;font-size:13px;font-weight:700;cursor:pointer">💾 적용 & 저장 (Firestore 공유)</button>';
  html += '<button onclick="_ppResetParams()" style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:10px 16px;font-size:13px;color:#dc2626;cursor:pointer">기본값으로 초기화</button>';
  html += '</div>';

  return html;
}

function _ppInputCell(id, label, key, val, step){
  return '<label style="display:block;font-size:11px;color:#64748b">'+label
    + '<input id="'+id+'" type="number" data-pp-key="'+key+'" value="'+val+'" step="'+step+'" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;margin-top:2px">'
    + '</label>';
}

function _ppToggleAdv(){
  var body = document.getElementById('pp_adv_body');
  var arrow = document.getElementById('pp_adv_arrow');
  if(!body) return;
  if(body.style.display === 'none'){
    body.style.display = 'block';
    if(arrow) arrow.textContent = '▴';
  } else {
    body.style.display = 'none';
    if(arrow) arrow.textContent = '▾';
  }
}

function _ppFillAdvancedInputs(){
  // 페이지 로드 후 input 값을 현재 PP_STD로 채움
  document.querySelectorAll('[data-pp-key]').forEach(function(el){
    var key = el.getAttribute('data-pp-key');
    var v = _ppGetByKey(PP_STD, key);
    if(v !== undefined) el.value = v;
  });
}

function _ppGetByKey(obj, key){
  // "cooking.kg_per_tank" 또는 "packing_lines[0].workers" 또는 "retort.profile[\"FC 장조림 3KG\"].eaPerCart"
  try {
    var path = key.replace(/\[/g,'.[').split('.').filter(Boolean);
    var cur = obj;
    for(var i = 0; i < path.length; i++){
      var p = path[i];
      if(p.startsWith('[')){
        var idx = p.slice(1, -1);
        if(idx.startsWith('"') || idx.startsWith("'")) idx = JSON.parse(idx);
        else idx = parseInt(idx);
        cur = cur[idx];
      } else {
        cur = cur[p];
      }
      if(cur === undefined) return undefined;
    }
    return cur;
  } catch(e){ return undefined; }
}

function _ppSetByKey(obj, key, val){
  try {
    var path = key.replace(/\[/g,'.[').split('.').filter(Boolean);
    var cur = obj;
    for(var i = 0; i < path.length - 1; i++){
      var p = path[i];
      if(p.startsWith('[')){
        var idx = p.slice(1, -1);
        if(idx.startsWith('"') || idx.startsWith("'")) idx = JSON.parse(idx);
        else idx = parseInt(idx);
        cur = cur[idx];
      } else {
        cur = cur[p];
      }
    }
    var last = path[path.length - 1];
    if(last.startsWith('[')){
      var idx2 = last.slice(1, -1);
      if(idx2.startsWith('"') || idx2.startsWith("'")) idx2 = JSON.parse(idx2);
      else idx2 = parseInt(idx2);
      cur[idx2] = val;
    } else {
      cur[last] = val;
    }
  } catch(e){ console.warn('set fail', key, e); }
}

async function _ppApplyParams(){
  // input들에서 값 수집해서 PP_STD 갱신
  document.querySelectorAll('[data-pp-key]').forEach(function(el){
    var key = el.getAttribute('data-pp-key');
    var v = parseFloat(el.value);
    if(isFinite(v)) _ppSetByKey(PP_STD, key, v);
  });
  var ok = await _ppSaveParams();
  if(ok){
    // 시뮬 결과가 이미 있으면 재실행
    var resultEl = document.getElementById('pp_result');
    if(resultEl && resultEl.children.length > 0){
      _ppRunSimulation();
    }
    // 토스트
    var t = document.createElement('div');
    t.textContent = '✅ 적용됨 (모든 디바이스 공유)';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 2000);
  }
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
window._ppToggleAdv = _ppToggleAdv;
window._ppApplyParams = _ppApplyParams;
window._ppResetParams = _ppResetParams;
