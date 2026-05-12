// 모든 함수가 로드된 후 window 등록
document.addEventListener('DOMContentLoaded', function() {
  window.saveSettings = saveSettings;
  window.showTab = showTab;
  window.savePkEdit = savePkEdit;
  window.chMonth = chMonth;
  window.renderMonthly = renderMonthly;
  window.exportMonthlyReport = exportMonthlyReport;


  window.setMode = setMode;
  window.focusBC = focusBC;
  window.delBC = delBC;
  window.clrToday = clrToday;
  window.expCSV = expCSV;
  window.expAll = expAll;
  window.resetAll = resetAll;
  window.startThawing = startThawing;
  window.renderThawWaiting = renderThawWaiting;
  window.updateTwSummary = updateTwSummary;
  window.saveP = saveP;
  window.delR = delR;
  window.chDay = chDay;
  window.addProd = addProd;
  window.onNpNoMeatToggle = onNpNoMeatToggle;
  window.delProd = delProd;
  window.cancelEditProd = cancelEditProd;
  window.startEditProd = startEditProd;
  window.addSc = addSc;
  window.delSc = delSc;
  window.addSub = addSub;
  window.delSub = delSub;
  window.onProd = onProd;
  window.renderDashboard = renderDashboard;
  window.calcDbTarget = calcDbTarget;
  window.saveDbTarget = saveDbTarget;
  window.renderDashboard = renderDashboard;
  window.setDbPeriod = setDbPeriod;
  window.calcDbTarget = calcDbTarget;
  window.saveDbTarget = saveDbTarget;
  window.doTrace = doTrace;
  window.showTraceDetail = showTraceDetail;
  window.renderTrTbl = renderTrTbl;
  window.renderProduct = renderProduct;
  window.renderTrend = renderTrend;
  window.renderDaily = renderDaily;
  window.setPd = setPd;
  window.addGt = addGt;
  window.delGt = delGt;
  window.loadRecipe = loadRecipe;
  window.addRecipeRow = addRecipeRow;
  window.delRecipeRow = delRecipeRow;
  window.rcRowChange = rcRowChange;
  window.saveRecipe = saveRecipe;
  window.delRecipe = delRecipe;
  window.selectRecipe = selectRecipe;
  window.renderCkCageList = renderCkCageList;
  window.onCkCageChange = onCkCageChange;
  function onPkWagonDirectInput(idx){
    const directInput = document.querySelector(`#pkRow_${idx} .pk-row-wagon-input`);
    const hidden = document.querySelector(`#pkRow_${idx} .pk-row-wagon`);
    if(!hidden||!directInput) return;
    hidden.value = directInput.value;
    // 버튼 상태 동기화
    const vals = directInput.value.split(',').map(x=>x.trim()).filter(Boolean);
    document.querySelectorAll(`#pkWagonBtns_${idx} .pk-wagon-btn`).forEach(btn=>{
      const w = btn.dataset.w;
      if(vals.includes(w)){
        btn.style.background='var(--p)'; btn.style.borderColor='var(--p)'; btn.style.color='#fff';
      } else {
        btn.style.background='#fff'; btn.style.borderColor='var(--g3)'; btn.style.color='';
      }
    });
  }
  window.onPkWagonChange = onPkWagonChange;
  window.uploadCSV = uploadBarcodes;
  window.uploadBarcodes = uploadBarcodes;
  window.previewUpload = previewUpload;
  window.exportDailyReport = exportDailyReport;
  window.exportThawingChecklist_daily = exportThawingChecklist_daily;
  window.downloadPackingChart = downloadPackingChart;
  // 자숙 pending
  window.addCkTankRow = addCkTankRow;
  window.removeCkRow = removeCkRow;
  window.setCkNow = setCkNow;
  window.setCkRowNow = setCkRowNow;
  window.showCkStartCard = showCkStartCard;
  window.onCkStartBtn = onCkStartBtn;
  window.renderCkPending = renderCkPending;
  window.toggleCkEndForm = toggleCkEndForm;
  window.saveCkEnd = saveCkEnd;
  window.onCkRowGroupChange = onCkRowGroupChange;  // ★ v2: 묶음 선택 시 부위 자동 채움
  window.ckEditPending = ckEditPending;
  window.ckEditPendingCancel = ckEditPendingCancel;
  window.ckEditPendingSave = ckEditPendingSave;
  // 아코디언
  window.toggleAcc = toggleAcc;
  // 자숙 새 함수
  window.onCkStartBtn = onCkStartBtn;
  window.addCkTankRow = addCkTankRow;
  window.removeCkRow = removeCkRow;
  // 포장 새 함수
  window.setPkNow = setPkNow;
  window.addPkMachRow = addPkMachRow;
  window.removePkRow = removePkRow;
  window.onPkRowProd = onPkRowProd;
  window.onPkStartBtn = onPkStartBtn;
  window.showPkStartCard = showPkStartCard;
  window.renderPkPending = renderPkPending;
  window.startEditPkPending = startEditPkPending;
  window.cancelEditPkPending = cancelEditPkPending;
  window.renderPkWagonList = renderPkWagonList;
  window.togglePkEndForm = togglePkEndForm;
  window.savePkEnd = savePkEnd;
  // ============================================================
  // 앱 초기화
  // ============================================================
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
});