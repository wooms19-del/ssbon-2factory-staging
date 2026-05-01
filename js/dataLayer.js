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
    normalizeShredding: null,
    normalizeThawing: null,
    normalizeCooking: null,
    normalizePreprocess: null,
    getDay: null,
    getMonth: null,
    resolveType: null,
    validate: null,
  };

  console.log('[DL] dataLayer.js v' + DL_VERSION + ' 로드됨 (Phase 1 진행 중)');

})(window);
