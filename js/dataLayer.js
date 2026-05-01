/* ============================================================
 * dataLayer.js — 통합 데이터 레이어
 * ============================================================
 * 목적: 모든 화면이 Firebase/localStorage를 직접 읽지 않고
 *       이 모듈만 통해 데이터 조회. 한 곳에서 정규화·검증·계산.
 *
 * 사용:
 *   const day = DL.getDay('2026-04-30');
 *   const month = DL.getMonth('2026-04');
 *   const type = DL.resolveType('2026-04-30', '6');
 *   const issues = DL.validate('2026-04-30');
 *
 * 단일 출처 원칙:
 *   - kgea, noMeat → L.products만 조회 (하드코딩 0)
 *   - testRun 판정 → DL._isTestRun() 한 곳
 *   - 와곤→부위 추적 → DL.resolveType() 한 곳
 *
 * 작성일: 2026-05-01
 * Phase 1 진행 중
 * ============================================================ */

(function(global){
  'use strict';

  // ─── 버전 ─────────────────────────────────────────────
  const DL_VERSION = '0.1.0';

  // ─── 유틸: 숫자 안전 변환 ──────────────────────────────
  function _num(v){
    if(v === null || v === undefined) return 0;
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  function _r2(n){
    if(!isFinite(+n)) return 0;
    return Math.round((+n)*100)/100;
  }
  function _str(v){ return v == null ? '' : String(v); }
  function _trim(v){ return _str(v).trim(); }

  // ─── 제품 정보 조회 (L.products 단일 출처) ─────────────
  function _getProduct(name){
    if(typeof L === 'undefined' || !L || !Array.isArray(L.products)) return null;
    return L.products.find(function(p){ return p.name === name; }) || null;
  }
  function _getKgea(name){
    const p = _getProduct(name);
    return p ? (parseFloat(p.kgea) || 0) : 0;
  }
  function _isNoMeat(name){
    const p = _getProduct(name);
    return !!(p && p.noMeat === true);
  }
  function _getKgTot(name){
    const p = _getProduct(name);
    return p ? (parseFloat(p.kgTot) || parseFloat(p.kgea) || 0) : 0;
  }

  // ─── testRun 판정 (단일 룰) ────────────────────────────
  function _isTestRun(record){
    if(!record) return false;
    return !!(record.testRun || record.isTest);
  }

  // ─── Packing 정규화 ────────────────────────────────────
  // record를 받아서 표준 형식으로 변환 (원본 필드 모두 보존 + _ prefix 부착)
  // 위험 시나리오 사전 점검:
  //   - typeKgs 빈값 다수: typeList는 wagon 추론 등으로 fallback
  //   - testRun/isTest 둘 다 가능: DL.isTestRun()이 둘 다 처리
  //   - wagon/cart 빈값 (noMeat 케이스): 정상 처리
  //   - 음수 ea/defect: 그대로 보존 (사용자 입력 신뢰)
  //   - id/fbId/_id 세 식별자: 모두 보존
  function _normalizePacking(record){
    if(!record || typeof record !== 'object') return null;

    // 원본 필드 그대로 보존
    var out = Object.assign({}, record);

    // 안전 변환
    out.date = _trim(record.date).slice(0, 10);
    out.product = _trim(record.product);
    out.ea = _num(record.ea);
    out.defect = _num(record.defect);
    out.pouch = _num(record.pouch);
    out.workers = _num(record.workers);
    out.machine = _trim(record.machine);
    out.start = _trim(record.start);
    out.end = _trim(record.end);
    out.wagon = _trim(record.wagon);
    out.cart = _trim(record.cart);

    // 객체형 필드 (None 방어)
    out.wagonDist = (record.wagonDist && typeof record.wagonDist === 'object') ? record.wagonDist : {};
    out.cartDist  = (record.cartDist  && typeof record.cartDist  === 'object') ? record.cartDist  : {};
    out.typeKgs   = (record.typeKgs   && typeof record.typeKgs   === 'object') ? record.typeKgs   : {};
    out.sauceTanks = Array.isArray(record.sauceTanks) ? record.sauceTanks : [];

    // ── 정규화 추가 필드 (_ prefix) ──
    out._kgea = _getKgea(out.product);
    out._isNoMeat = _isNoMeat(out.product);
    out._isTestRun = _isTestRun(record);

    // wagonDistSum / cartDistSum / typeKgsSum
    out._wagonDistSum = Object.keys(out.wagonDist).reduce(function(s, k){
      return s + _num(out.wagonDist[k]);
    }, 0);
    out._cartDistSum = Object.keys(out.cartDist).reduce(function(s, k){
      return s + _num(out.cartDist[k]);
    }, 0);
    out._typeKgsSum = Object.keys(out.typeKgs).reduce(function(s, k){
      return s + _num(out.typeKgs[k]);
    }, 0);

    // meatKg = ea × kgea (완제품 고기 무게)
    out._meatKg = _r2(out.ea * out._kgea);

    // typeList 결정 (우선순위)
    //   1. typeKgs 키들 (kg 큰 순)
    //   2. type 필드 (단일 string)
    //   3. wagon → 추적 (resolveType, 다음 step에서 구현 — 지금은 빈값)
    //   4. 빈 배열
    var typeList = [];
    var tkKeys = Object.keys(out.typeKgs).filter(function(k){ return _num(out.typeKgs[k]) > 0; });
    if(tkKeys.length > 0){
      typeList = tkKeys.sort(function(a,b){ return _num(out.typeKgs[b]) - _num(out.typeKgs[a]); });
    } else if(_trim(record.type)){
      typeList = [_trim(record.type)];
    }
    // noMeat 제품은 type 자동 추론 절대 안 함
    if(out._isNoMeat){
      typeList = [];
    }
    out._typeList = typeList;
    out._primaryType = typeList[0] || '';

    // 정합성 체크: wagonDistSum이 typeKgsSum과 일치하는지 (둘 다 있을 때만)
    if(out._wagonDistSum > 0 && out._typeKgsSum > 0){
      out._isConsistent = Math.abs(out._wagonDistSum - out._typeKgsSum) < 0.5;  // 0.5kg 오차 허용
    } else {
      out._isConsistent = true;  // 한 쪽만 있으면 검증 불가 → 통과
    }

    return out;
  }


  // ─── Shredding 정규화 ──────────────────────────────────
  // 위험 시나리오:
  //   - wagonOutDist 빈값 / cartOutDist 빈값 → 정상
  //   - kgIn 누락 가능
  //   - waste 음수 가능 (방어)
  //   - type 필드 없음 (cooking에서 추론) → 별도 step에서
  function _normalizeShredding(record){
    if(!record || typeof record !== 'object') return null;
    var out = Object.assign({}, record);
    out.date = _trim(record.date).slice(0, 10);
    out.kg = _num(record.kg);
    out.kgIn = _num(record.kgIn);
    out.waste = _num(record.waste);
    out.workers = _num(record.workers);
    out.start = _trim(record.start);
    out.end = _trim(record.end);
    out.wagonIn = _trim(record.wagonIn);
    out.wagonOut = _trim(record.wagonOut);
    out.cartOut = _trim(record.cartOut);
    out.wagonOutDist = (record.wagonOutDist && typeof record.wagonOutDist === 'object') ? record.wagonOutDist : {};
    out.cartOutDist  = (record.cartOutDist  && typeof record.cartOutDist  === 'object') ? record.cartOutDist  : {};

    out._isTestRun = _isTestRun(record);
    out._wagonOutSum = Object.keys(out.wagonOutDist).reduce(function(s,k){ return s + _num(out.wagonOutDist[k]); }, 0);
    out._cartOutSum  = Object.keys(out.cartOutDist).reduce(function(s,k){ return s + _num(out.cartOutDist[k]); }, 0);
    out._totalDistSum = out._wagonOutSum + out._cartOutSum;
    // 정합성: wagonOutDist/cartOutDist 모두 빈값이면 검증 불가 → 통과
    //         값이 있으면 totalDistSum이 kg과 일치해야 (waste는 보통 별도 처리)
    if(out._totalDistSum === 0){
      out._isConsistent = true;  // 분배 정보 없음 → 검증 안 함
    } else {
      out._isConsistent = Math.abs(out.kg - out._totalDistSum) < 1.0;
    }
    return out;
  }

  // ─── Thawing 정규화 ───────────────────────────────────
  // 위험 시나리오:
  //   - workers가 string 빈값 ('') → _num이 0 처리
  //   - importCodes 배열 길이 다양 (1~50)
  //   - part vs type 둘 다 있음 (type 우선, part는 fallback)
  //   - testRun 3건만, 대다수는 정상
  function _normalizeThawing(record){
    if(!record || typeof record !== 'object') return null;
    var out = Object.assign({}, record);
    out.date = _trim(record.date).slice(0, 10);
    out.totalKg = _num(record.totalKg);
    out.remainKg = _num(record.remainKg);
    out.boxes = _num(record.boxes);
    out.workers = _num(record.workers);
    out.start = _trim(record.start);
    out.end = _trim(record.end);
    out.cart = _trim(record.cart);
    out.wagon = _trim(record.wagon);
    out.importCodes = Array.isArray(record.importCodes) ? record.importCodes : [];

    // type 우선, 없으면 part
    out.type = _trim(record.type) || _trim(record.part);
    out._isTestRun = _isTestRun(record);
    out._isNoMeat = !out.type;  // 부위 없으면 무육 추정
    return out;
  }

  // ─── Cooking 정규화 ───────────────────────────────────
  // 위험 시나리오:
  //   - wagonDist / wagonInDist 둘 다 있음 (의미 다름)
  //   - cage가 콤마 분리 string ("9,10")
  //   - tank 정보 (소스 탱크와 다름, 자숙 탱크)
  function _normalizeCooking(record){
    if(!record || typeof record !== 'object') return null;
    var out = Object.assign({}, record);
    out.date = _trim(record.date).slice(0, 10);
    out.kg = _num(record.kg);
    out.kgIn = _num(record.kgIn);
    out.workers = _num(record.workers);
    out.start = _trim(record.start);
    out.end = _trim(record.end);
    out.cage = _trim(record.cage);
    out.tank = _trim(record.tank);
    out.type = _trim(record.type);
    out.wagonOut = _trim(record.wagonOut);
    out.wagonDist = (record.wagonDist && typeof record.wagonDist === 'object') ? record.wagonDist : {};
    out.wagonInDist = (record.wagonInDist && typeof record.wagonInDist === 'object') ? record.wagonInDist : {};

    out._isTestRun = _isTestRun(record);
    out._wagonOutSum = Object.keys(out.wagonDist).reduce(function(s,k){ return s + _num(out.wagonDist[k]); }, 0);
    out._wagonInSum = Object.keys(out.wagonInDist).reduce(function(s,k){ return s + _num(out.wagonInDist[k]); }, 0);
    return out;
  }

  // ─── Preprocess 정규화 ──────────────────────────────────
  // 위험 시나리오:
  //   - distribution 객체가 복잡 (cage별 type/start/end/cages/cagesIn 등)
  //   - cageTanks 객체
  //   - waste 음수 가능
  //   - wagons 콤마 분리 가능
  function _normalizePreprocess(record){
    if(!record || typeof record !== 'object') return null;
    var out = Object.assign({}, record);
    out.date = _trim(record.date).slice(0, 10);
    out.kg = _num(record.kg);
    out.waste = _num(record.waste);
    out.workers = _num(record.workers);
    out.start = _trim(record.start);
    out.end = _trim(record.end);
    out.cage = _trim(record.cage);
    out.wagons = _trim(record.wagons);
    out.type = _trim(record.type);
    out.distribution = (record.distribution && typeof record.distribution === 'object') ? record.distribution : {};
    out.cageTanks = (record.cageTanks && typeof record.cageTanks === 'object') ? record.cageTanks : {};

    out._isTestRun = _isTestRun(record);
    return out;
  }

  // ─── Outerpacking 정규화 ───────────────────────────────
  // 위험 시나리오:
  //   - product 필드 있음 (packing과 다름)
  //   - innerEa는 float 가능 (4718.0)
  //   - materials 배열 (자재 사용량)
  //   - outerBoxes float (1179.0)
  function _normalizeOuterpacking(record){
    if(!record || typeof record !== 'object') return null;
    var out = Object.assign({}, record);
    out.date = _trim(record.date).slice(0, 10);
    out.product = _trim(record.product);
    out.innerEa = _num(record.innerEa);
    out.outerEa = _num(record.outerEa);
    out.outerBoxes = _num(record.outerBoxes);
    out.boxDefect = _num(record.boxDefect);
    out.trayDefect = _num(record.trayDefect);
    out.trayUsed = _num(record.trayUsed);
    out.partialBoxEa = _num(record.partialBoxEa);
    out.remainBoxes = _num(record.remainBoxes);
    out.remainEa = _num(record.remainEa);
    out.productDefect = _num(record.productDefect);
    out.sample = _num(record.sample);
    out.defectRate = _num(record.defectRate);
    out.materials = Array.isArray(record.materials) ? record.materials : [];

    out._kgea = _getKgea(out.product);
    out._isNoMeat = _isNoMeat(out.product);
    out._isTestRun = _isTestRun(record);
    out._meatKg = _r2(out.outerEa * out._kgea);
    return out;
  }

  // ─── 시간 유틸 ────────────────────────────────────────
  function _t2m(t){
    if(!t) return null;
    var p = String(t).split(':');
    if(p.length < 2) return null;
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if(!isFinite(h) || !isFinite(m)) return null;
    return h*60 + m;
  }
  function _r4(n){ if(!isFinite(+n)) return 0; return Math.round((+n)*10000)/10000; }

  // ─── 인원·시간 계산 (사용자분 룰 적용) ─────────────────
  // 룰:
  //   - 시간 = 설비 가동 시간 = 인터벌 머지(겹친 시간 1번만 카운트), 그룹 duration 합
  //   - 인원 = 시간 겹치는 작업끼리는 합산, 안 겹치면 max (작은 쪽은 옮겨갔다고 봄)
  //         → "그날 그 공정에 사용된 실제 인원 수"
  //   - testRun 제외, start/end 빈값 record는 skip
  // opts.cookingRule: 'always_max' (자숙 전용 룰 — 시간 겹침 무관 max)
  function _calcWH(records, opts){
    opts = opts || {};
    var intervals = [];
    records.forEach(function(r){
      if(r._isTestRun) return;
      var s = _t2m(r.start), e = _t2m(r.end);
      if(s == null || e == null) return;
      if(e < s) e += 24*60;  // 자정 넘김
      intervals.push({ s: s, e: e, w: _num(r.workers) });
    });
    if(!intervals.length) return { workers: 0, hours: 0 };
    intervals.sort(function(a,b){ return a.s - b.s; });

    // 그룹핑 (transitive overlap): 시작 시각 < 그룹 내 max(end) → 같은 그룹
    //   ※ 경계만 맞닿는 케이스(예: 10:00~10:45 + 10:45~11:30)는 "안 겹침"
    //     → 같은 사람이 이어서 일한 것으로 봐서 max 처리
    var groups = [[intervals[0]]];
    var groupMaxEnd = intervals[0].e;
    for(var i=1; i<intervals.length; i++){
      var cur = intervals[i];
      if(cur.s < groupMaxEnd){
        groups[groups.length-1].push(cur);
        if(cur.e > groupMaxEnd) groupMaxEnd = cur.e;
      } else {
        groups.push([cur]);
        groupMaxEnd = cur.e;
      }
    }

    var groupSums = groups.map(function(g){
      var sumW = g.reduce(function(s,x){ return s + x.w; }, 0);
      var maxW = g.reduce(function(m,x){ return Math.max(m, x.w); }, 0);
      var minS = Math.min.apply(null, g.map(function(x){return x.s;}));
      var maxE = Math.max.apply(null, g.map(function(x){return x.e;}));
      return {
        workers: sumW,    // 시간 겹침 = 다른 사람 = 합산
        maxWorkers: maxW, // 같은 그룹 내 max (cooking 룰 등에서 사용)
        hours: (maxE - minS) / 60
      };
    });

    var totalWorkers;
    if(opts.cookingRule === 'always_max'){
      // 자숙 전용: 시간 겹침 무관, 항상 max (보통 2명 거의 고정)
      // → 모든 record의 인원 중 max
      totalWorkers = intervals.reduce(function(m,x){ return Math.max(m, x.w); }, 0);
    } else {
      // 표준 룰: 시간겹침 합산 → 그룹별 합 중 max
      totalWorkers = groupSums.reduce(function(m,x){ return Math.max(m, x.workers); }, 0);
    }
    var totalHours = groupSums.reduce(function(s,x){ return s + x.hours; }, 0);
    return { workers: totalWorkers, hours: _r2(totalHours) };
  }

  // ─── 데이터 로드 헬퍼 (L 글로벌 또는 opts override) ───
  function _loadColl(coll, opts){
    if(opts && Array.isArray(opts[coll])) return opts[coll];
    if(typeof L === 'undefined' || !L) return [];
    return Array.isArray(L[coll]) ? L[coll] : [];
  }

  // ─── DL.getDay(date) ──────────────────────────────────
  // 하루치 모든 공정 데이터 + summary + validation
  // 위험 시나리오 사전 점검:
  //   - testRun 제외 (DECISIONS 룰)
  //   - noMeat 제품: 부위 그룹과 완전 분리 (DECISIONS 룰)
  //   - _typeList 빈값 packing: pkEaUnresolved로 분리, warning
  //   - multi-type packing: typeKgs 비율로 분배, 비율 못 정하면 균등
  //   - multi-type thawing (콤마): warning, 첫 부위에 카운트
  //   - 데이터 없는 공정: 0 처리
  //   - 모든 record 빈값 (날짜 매칭 0): 빈 day 객체 반환
  function _getDay(date, opts){
    date = _trim(date).slice(0, 10);
    opts = opts || {};

    function filterAndNorm(coll, normFn){
      return _loadColl(coll, opts)
        .filter(function(r){ return _trim(r && r.date).slice(0,10) === date; })
        .map(normFn)
        .filter(Boolean);
    }

    var thawing      = filterAndNorm('thawing',      _normalizeThawing);
    var preprocess   = filterAndNorm('preprocess',   _normalizePreprocess);
    var cooking      = filterAndNorm('cooking',      _normalizeCooking);
    var shredding    = filterAndNorm('shredding',    _normalizeShredding);
    var packing      = filterAndNorm('packing',      _normalizePacking);
    var outerpacking = filterAndNorm('outerpacking', _normalizeOuterpacking);

    // testRun 제외 헬퍼
    function ex(arr){ return arr.filter(function(r){ return !r._isTestRun; }); }
    var thRec = ex(thawing);
    var ppRec = ex(preprocess);
    var ckRec = ex(cooking);
    var shRec = ex(shredding);
    var pkRec = ex(packing);

    // ── 원육 부위별 KG (thawing) ──
    var rmKgByPart = {};
    var thMultiTypeFound = [];
    thRec.forEach(function(r){
      var t = (r.type || '').trim();
      if(!t) return;
      // multi-type 처리: 콤마 분리
      if(t.indexOf(',') !== -1){
        thMultiTypeFound.push(r._id || r.id);
        // 일단 첫 부위에 카운트 (warning에 표시됨)
        t = t.split(',')[0].trim();
      }
      rmKgByPart[t] = (rmKgByPart[t] || 0) + r.totalKg;
    });
    Object.keys(rmKgByPart).forEach(function(k){ rmKgByPart[k] = _r2(rmKgByPart[k]); });
    var rmKgTotal = _r2(thRec.reduce(function(s,r){ return s + r.totalKg; }, 0));

    // ── 포장 EA / meatKg 부위별 ──
    var pkEaByPart = {};
    var meatKgByPart = {};
    var pkEaUnresolved = 0;
    var pkEaNoMeat = 0;
    var pkUnresolvedIds = [];
    pkRec.forEach(function(r){
      if(r._isNoMeat){
        pkEaNoMeat += r.ea;
        return;
      }
      var tl = r._typeList || [];
      if(tl.length === 0){
        pkEaUnresolved += r.ea;
        pkUnresolvedIds.push(r._id || r.id);
        return;
      }
      if(tl.length === 1){
        var t1 = tl[0];
        pkEaByPart[t1] = (pkEaByPart[t1] || 0) + r.ea;
        meatKgByPart[t1] = (meatKgByPart[t1] || 0) + r._meatKg;
      } else {
        // multi-type: typeKgs 비율로 분배
        var totalKgs = r._typeKgsSum;
        if(totalKgs > 0){
          tl.forEach(function(t){
            var ratio = _num(r.typeKgs[t]) / totalKgs;
            pkEaByPart[t] = (pkEaByPart[t] || 0) + r.ea * ratio;
            meatKgByPart[t] = (meatKgByPart[t] || 0) + r._meatKg * ratio;
          });
        } else {
          // 비율 못 정함 → 균등 분배
          var n = tl.length;
          tl.forEach(function(t){
            pkEaByPart[t] = (pkEaByPart[t] || 0) + r.ea / n;
            meatKgByPart[t] = (meatKgByPart[t] || 0) + r._meatKg / n;
          });
        }
      }
    });
    Object.keys(pkEaByPart).forEach(function(k){ pkEaByPart[k] = Math.round(pkEaByPart[k]); });
    Object.keys(meatKgByPart).forEach(function(k){ meatKgByPart[k] = _r2(meatKgByPart[k]); });
    var meatKgTotal = _r2(Object.keys(meatKgByPart).reduce(function(s,k){ return s + meatKgByPart[k]; }, 0));

    // ── 공정 KG (수율 계산용) ──
    var ppKg = _r2(ppRec.reduce(function(s,r){ return s + r.kg; }, 0));
    var ckKg = _r2(ckRec.reduce(function(s,r){ return s + r.kg; }, 0));
    var shKg = _r2(shRec.reduce(function(s,r){ return s + r.kg; }, 0));

    // ── 수율 (소수, 0~1 범위) ──
    var origYield = rmKgTotal > 0 ? _r4(meatKgTotal / rmKgTotal) : 0;
    var procYields = {
      전처리: rmKgTotal > 0 ? _r4(ppKg / rmKgTotal) : 0,
      자숙:   ppKg > 0 ? _r4(ckKg / ppKg) : 0,
      파쇄:   ckKg > 0 ? _r4(shKg / ckKg) : 0,
      포장:   shKg > 0 ? _r4(meatKgTotal / shKg) : 0
    };

    // ── noMeat 수율 (별도) ──
    // 무육 제품을 subName(메인 부재료)별로 그룹핑
    //   이론량 = sum(EA × subKgea)
    //   실제량 = sum(subKg)
    //   수율 = 이론량 / 실제량
    // ※ 시그니처 130g 같은 일반 제품에 들어간 깐메추리알(부재료)은 별도 로직 필요 — Step 1.5+
    var noMeatYields = {};
    var nmGroups = {};  // {subName: {theoretical, actual}}
    pkRec.forEach(function(r){
      if(!r._isNoMeat) return;
      var prod = _getProduct(r.product);
      if(!prod) return;
      var subName = (prod.subName || '').trim();
      if(!subName) return;
      var subKgea = parseFloat(prod.subKgea) || 0;
      if(!nmGroups[subName]) nmGroups[subName] = { theoretical: 0, actual: 0 };
      nmGroups[subName].theoretical += r.ea * subKgea;
      nmGroups[subName].actual += _num(r.subKg);
    });
    Object.keys(nmGroups).forEach(function(sub){
      var g = nmGroups[sub];
      noMeatYields[sub] = {
        theoreticalKg: _r2(g.theoretical),
        actualKg: _r2(g.actual),
        yield: g.actual > 0 ? _r4(g.theoretical / g.actual) : 0
      };
    });

    // ── workers / hours per stage ──
    // 자숙은 "항상 2명 거의 고정" 룰 → opts.cookingRule='always_max' 적용
    var ppWH = _calcWH(ppRec);
    var ckWH = _calcWH(ckRec, { cookingRule: 'always_max' });
    var shWH = _calcWH(shRec);
    var pkWH = _calcWH(pkRec);

    var summary = {
      rmKgByPart: rmKgByPart,
      rmKgTotal: rmKgTotal,
      pkEaByPart: pkEaByPart,
      pkEaNoMeat: pkEaNoMeat,
      pkEaUnresolved: pkEaUnresolved,
      meatKgByPart: meatKgByPart,
      meatKgTotal: meatKgTotal,
      yields: {
        원육수율: origYield,
        공정수율: procYields
      },
      noMeatYields: noMeatYields,
      workers: {
        preprocess: ppWH.workers,
        cooking:    ckWH.workers,
        shredding:  shWH.workers,
        packing:    pkWH.workers
      },
      hours: {
        preprocess: ppWH.hours,
        cooking:    ckWH.hours,
        shredding:  shWH.hours,
        packing:    pkWH.hours
      },
      // 디버깅·검증용 보조 (KG 합계)
      _ppKgTotal: ppKg,
      _ckKgTotal: ckKg,
      _shKgTotal: shKg
    };

    // ── validation (errors / warnings) ──
    var errors = [];
    var warnings = [];

    if(pkEaUnresolved > 0){
      warnings.push({
        code: 'PK_TYPE_UNRESOLVED',
        msg: '부위 정보 없는 packing record ' + pkUnresolvedIds.length + '건 (Step 1.6 resolveType 필요)',
        ea: pkEaUnresolved,
        ids: pkUnresolvedIds
      });
    }
    if(thMultiTypeFound.length > 0){
      warnings.push({
        code: 'TH_MULTI_TYPE',
        msg: 'thawing.type에 콤마 (' + thMultiTypeFound.length + '건). 첫 부위에 카운트',
        ids: thMultiTypeFound
      });
    }
    // 정합성 깨진 packing
    var inconsistent = pkRec.filter(function(r){ return r._isConsistent === false; });
    if(inconsistent.length > 0){
      warnings.push({
        code: 'PK_INCONSISTENT',
        msg: 'wagonDistSum != typeKgsSum (' + inconsistent.length + '건)',
        ids: inconsistent.map(function(r){ return r._id || r.id; })
      });
    }
    // 수율 100% 초과 (단, 파쇄는 자숙 후 물 흡수로 중량 증가가 정상이므로 검증 안 함)
    if(rmKgTotal > 0 && ppKg > rmKgTotal){
      errors.push({ code: 'YIELD_PP_OVER', msg: '전처리 KG > 원육 KG (' + ppKg + ' > ' + rmKgTotal + ')' });
    }
    if(ppKg > 0 && ckKg > ppKg){
      errors.push({ code: 'YIELD_CK_OVER', msg: '자숙 KG > 전처리 KG (' + ckKg + ' > ' + ppKg + ')' });
    }
    // 파쇄 KG > 자숙 KG: 정상 현상 (자숙→파쇄 사이 원육이 물 흡수해서 중량 증가)
    // → 검증 X. 단, 너무 비정상적으로 큰 경우만 info 수준 알림
    if(ckKg > 0 && shKg > ckKg * 1.5){
      warnings.push({
        code: 'SH_GAIN_HIGH',
        msg: '파쇄 KG가 자숙 대비 50%+ 증가 (' + ckKg + ' → ' + shKg + ', +' + (((shKg/ckKg-1)*100).toFixed(1)) + '%)',
        ckKg: ckKg, shKg: shKg
      });
    }

    var validation = { errors: errors, warnings: warnings };

    return {
      date: date,
      thawing: thawing,
      preprocess: preprocess,
      cooking: cooking,
      shredding: shredding,
      packing: packing,
      outerpacking: outerpacking,
      summary: summary,
      validation: validation
    };
  }

  // ─── 외부 노출 ─────────────────────────────────────────
  global.DL = {
    VERSION: DL_VERSION,

    // 내부 유틸 (다른 모듈도 쓸 수 있게 노출)
    _num: _num,
    _r2: _r2,
    _str: _str,
    _trim: _trim,

    // 제품 조회
    getProduct: _getProduct,
    getKgea: _getKgea,
    isNoMeat: _isNoMeat,
    getKgTot: _getKgTot,

    // testRun
    isTestRun: _isTestRun,

    // 정규화 함수 (Step 1.2~1.3에서 작성)
    normalizePacking: _normalizePacking,
    normalizeShredding: _normalizeShredding,
    normalizeThawing: _normalizeThawing,
    normalizeCooking: _normalizeCooking,
    normalizePreprocess: _normalizePreprocess,
    normalizeOuterpacking: _normalizeOuterpacking,

    // 시간/인원 계산 헬퍼 (외부에서 검증·재사용 가능)
    _calcWH: _calcWH,
    _t2m: _t2m,
    _r4: _r4,

    // 조회
    getDay: _getDay,
    getMonth: null,
    resolveType: null,
    validate: null,
  };

  console.log('[DL] dataLayer.js v' + DL_VERSION + ' 로드됨 (Phase 1 진행 중)');

})(window);
