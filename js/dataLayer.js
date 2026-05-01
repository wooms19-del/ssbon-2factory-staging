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

    // 다음 Step에서 추가될 함수들 placeholder
    normalizePacking: null,
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
