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
    getDay: null,
    getMonth: null,
    resolveType: null,
    validate: null,
  };

  console.log('[DL] dataLayer.js v' + DL_VERSION + ' 로드됨 (Phase 1 진행 중)');

})(window);
