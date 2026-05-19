// ============================================================
// alt_calc.js — Alt + 드래그로 셀 범위 선택 → 계산기 팝업
// 전역 작동: 모든 화면의 <table>에서 자동
// 합계 / 평균 / 개수 탭
// ============================================================

(function(){
  'use strict';

  let isAltDragging = false;
  let dragStartCell = null;
  let selectedCells = [];
  let popupEl = null;

  // 셀 텍스트에서 숫자 추출 (1,234.56 / 1234 / 12.3% 등 처리)
  function _extractNum(text) {
    if (!text) return null;
    // 콤마 제거, % 제거, 공백 제거
    const cleaned = String(text).replace(/,/g, '').replace(/%/g, '').replace(/\s/g, '').trim();
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }

  // 셀이 숫자 셀인지
  function _isNumCell(td) {
    if (!td || td.tagName !== 'TD') return false;
    // 내부 input이 있으면 input value
    const inp = td.querySelector('input[type="number"]');
    if (inp) return _extractNum(inp.value) !== null;
    return _extractNum(td.textContent) !== null;
  }

  function _getCellNum(td) {
    if (!td) return null;
    const inp = td.querySelector('input[type="number"]');
    if (inp) return _extractNum(inp.value);
    return _extractNum(td.textContent);
  }

  // 셀 강조
  function _highlightCells() {
    document.querySelectorAll('.ac-selected').forEach(el => el.classList.remove('ac-selected'));
    selectedCells.forEach(td => td.classList.add('ac-selected'));
  }

  // 시작 마우스 좌표 저장용
  let dragStartX = 0, dragStartY = 0;

  // 시작 셀(닻점)과 현재 마우스가 가리키는 셀 사이 영역 선택
  // - 두 셀의 "중심점"을 기준으로 사각형 정의 (셀 영역 전체 X)
  // - 셀의 중심점이 그 사각형 안에 있어야 선택
  // - 결과: 사용자가 한 컬럼 세로로 이동하면 그 컬럼만 잡힘
  function _selectByAnchor(anchorCell, endCell) {
    if (!anchorCell) return [];
    const table = anchorCell.closest('table');
    if (!table) return [];
    if (!endCell || endCell === anchorCell) {
      return _isNumCell(anchorCell) ? [anchorCell] : [];
    }
    if (endCell.closest('table') !== table) return [anchorCell];

    const aR = anchorCell.getBoundingClientRect();
    const eR = endCell.getBoundingClientRect();
    // 두 셀의 중심점
    const aCx = (aR.left + aR.right) / 2;
    const aCy = (aR.top + aR.bottom) / 2;
    const eCx = (eR.left + eR.right) / 2;
    const eCy = (eR.top + eR.bottom) / 2;
    // 두 중심점 사이 사각형
    const x1 = Math.min(aCx, eCx);
    const x2 = Math.max(aCx, eCx);
    const y1 = Math.min(aCy, eCy);
    const y2 = Math.max(aCy, eCy);
    const PAD = 1;

    const cells = [];
    table.querySelectorAll('td').forEach(td => {
      const r = td.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      // 셀 중심점이 사각형 안에 있어야 선택
      if (cx >= x1 - PAD && cx <= x2 + PAD && cy >= y1 - PAD && cy <= y2 + PAD) {
        if (_isNumCell(td)) cells.push(td);
      }
    });
    return cells;
  }

  // 통계 계산
  function _calcStats(cells) {
    const nums = cells.map(_getCellNum).filter(n => n !== null);
    if (nums.length === 0) return { sum: 0, avg: 0, count: 0, min: 0, max: 0 };
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      sum: sum,
      avg: sum / nums.length,
      count: nums.length,
      min: Math.min(...nums),
      max: Math.max(...nums)
    };
  }

  // 숫자 포맷 (소수 자릿수 자동)
  function _fmt(n) {
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  // 팝업 생성/업데이트
  function _showPopup(stats, x, y) {
    if (!popupEl) {
      popupEl = document.createElement('div');
      popupEl.id = 'ac-popup';
      popupEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:8px 12px">
          <div style="font-size:11px;color:#6b7280;font-weight:500">계산기</div>
          <button type="button" id="ac-close" style="background:none;border:none;cursor:pointer;font-size:14px;color:#6b7280;line-height:1;padding:0 4px">×</button>
        </div>
        <div style="display:flex;border-bottom:1px solid #e5e7eb">
          <button type="button" data-tab="sum" class="ac-tab ac-tab-active" style="flex:1;padding:8px 4px;background:none;border:none;cursor:pointer;font-size:11px;color:#1d4ed8;font-weight:600;border-bottom:2px solid #1d4ed8">합계</button>
          <button type="button" data-tab="avg" class="ac-tab" style="flex:1;padding:8px 4px;background:none;border:none;cursor:pointer;font-size:11px;color:#6b7280">평균</button>
          <button type="button" data-tab="count" class="ac-tab" style="flex:1;padding:8px 4px;background:none;border:none;cursor:pointer;font-size:11px;color:#6b7280">개수</button>
        </div>
        <div id="ac-value" style="padding:14px 16px;text-align:center;font-size:20px;font-weight:700;color:#111827;min-width:140px"></div>
        <div id="ac-sub" style="padding:0 16px 10px;font-size:10px;color:#9ca3af;text-align:center"></div>
      `;
      popupEl.style.cssText = 'position:fixed;background:#fff;border:1px solid #d1d5db;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.12);z-index:99999;font-family:system-ui,-apple-system,sans-serif;user-select:none';
      document.body.appendChild(popupEl);

      // 탭 클릭
      popupEl.querySelectorAll('.ac-tab').forEach(btn => {
        btn.addEventListener('click', function(){
          popupEl.querySelectorAll('.ac-tab').forEach(b => {
            b.classList.remove('ac-tab-active');
            b.style.color = '#6b7280';
            b.style.borderBottom = 'none';
            b.style.fontWeight = '400';
          });
          this.classList.add('ac-tab-active');
          this.style.color = '#1d4ed8';
          this.style.borderBottom = '2px solid #1d4ed8';
          this.style.fontWeight = '600';
          _updatePopupValue(this.dataset.tab);
        });
      });
      // 닫기
      popupEl.querySelector('#ac-close').addEventListener('click', _hidePopup);
    }
    popupEl._stats = stats;
    popupEl.style.display = 'block';
    // 위치 - 화면 밖 안 가게
    const popW = 200, popH = 120;
    const left = Math.min(x + 12, window.innerWidth - popW - 10);
    const top = Math.min(y + 12, window.innerHeight - popH - 10);
    popupEl.style.left = left + 'px';
    popupEl.style.top = top + 'px';
    // 현재 탭 값 업데이트
    const activeTab = popupEl.querySelector('.ac-tab-active');
    _updatePopupValue(activeTab ? activeTab.dataset.tab : 'sum');
  }

  function _updatePopupValue(tab) {
    if (!popupEl || !popupEl._stats) return;
    const s = popupEl._stats;
    const valEl = popupEl.querySelector('#ac-value');
    const subEl = popupEl.querySelector('#ac-sub');
    if (tab === 'sum') {
      valEl.textContent = _fmt(s.sum);
      subEl.textContent = `${s.count}개 항목`;
    } else if (tab === 'avg') {
      valEl.textContent = _fmt(s.avg);
      subEl.textContent = `${s.count}개 평균`;
    } else if (tab === 'count') {
      valEl.textContent = s.count.toString();
      subEl.textContent = `최소 ${_fmt(s.min)} / 최대 ${_fmt(s.max)}`;
    }
  }

  function _hidePopup() {
    if (popupEl) popupEl.style.display = 'none';
    document.querySelectorAll('.ac-selected').forEach(el => el.classList.remove('ac-selected'));
    selectedCells = [];
  }

  // 스타일 (한 번만)
  function _injectCSS() {
    if (document.getElementById('ac-styles')) return;
    const s = document.createElement('style');
    s.id = 'ac-styles';
    s.textContent = `
      .ac-selected { background-color: #bfdbfe !important; outline: 1px solid #3b82f6 !important; transition: background-color 0.1s; }
      .ac-dragging * { user-select: none !important; -webkit-user-select: none !important; }
    `;
    document.head.appendChild(s);
  }
  _injectCSS();

  // 마우스 이벤트 — Alt 키 누르고 드래그
  document.addEventListener('mousedown', function(e){
    if (!e.altKey) return;
    const td = e.target.closest('td');
    if (!td || !_isNumCell(td)) return;
    // input 내부 클릭이면 안 함
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    isAltDragging = true;
    dragStartCell = td;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    selectedCells = [td];
    _highlightCells();
    document.body.classList.add('ac-dragging');
  });

  document.addEventListener('mousemove', function(e){
    if (!isAltDragging) return;
    if (!dragStartCell) return;
    // 현재 마우스가 가리키는 셀
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const td = el ? el.closest('td') : null;
    // 시작 셀(닻점) ~ 현재 셀 사이 사각형 영역
    selectedCells = _selectByAnchor(dragStartCell, td);
    _highlightCells();
  });

  document.addEventListener('mouseup', function(e){
    if (!isAltDragging) return;
    isAltDragging = false;
    document.body.classList.remove('ac-dragging');
    if (selectedCells.length === 0) {
      _hidePopup();
      return;
    }
    const stats = _calcStats(selectedCells);
    if (stats.count === 0) {
      _hidePopup();
      return;
    }
    _showPopup(stats, e.clientX, e.clientY);
  });

  // ESC로 닫기 / 외부 클릭으로 닫기
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') _hidePopup();
  });
  document.addEventListener('mousedown', function(e){
    if (popupEl && popupEl.style.display !== 'none' && !popupEl.contains(e.target) && !e.altKey) {
      _hidePopup();
    }
  });

  console.log('[alt_calc] 초기화됨 - Alt + 드래그로 셀 합계 확인');
})();
