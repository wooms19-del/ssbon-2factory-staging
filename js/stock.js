// ============================================================
// 입고관리 탭
// Firestore 컬렉션: stockIn  ({date, type, boxes, note, _createdAt})
// 잔여(부위) = stockIn 누적(boxes) - thawing 누적(boxes)
// ============================================================

var _stockData = { stockIn: [], thawing: [] };
var _stockLoading = false;

function _stockToday(){
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

async function renderStock(){
  if(_stockLoading) return;
  _stockLoading = true;
  var pg = document.getElementById('p-stock');
  if(!pg){ _stockLoading=false; return; }
  pg.innerHTML = '<div style="padding:20px;text-align:center;color:#6b7280">불러오는 중…</div>';

  // 충분히 긴 기간 (1년 6개월) — 누적 정확성
  var today = new Date();
  var from = new Date(today.getFullYear()-1, today.getMonth()-6, 1);
  var fromStr = from.toISOString().slice(0,10);
  var toStr = today.toISOString().slice(0,10);

  try {
    var R = await Promise.all([
      fbGetRange('stockIn', fromStr, toStr),
      fbGetRange('thawing', fromStr, toStr)
    ]);
    _stockData.stockIn = R[0] || [];
    _stockData.thawing = R[1] || [];
    _renderStockShell();
  } catch(e){
    pg.innerHTML = '<div style="padding:20px;color:#c0392b">로드 오류: '+(e.message||e)+'</div>';
  } finally {
    _stockLoading = false;
  }
}

function _renderStockShell(){
  var pg = document.getElementById('p-stock');
  if(!pg) return;

  // 부위별 누적 계산
  var inByType = {};   // {부위: 박스 합}
  var outByType = {};  // {부위: 박스 합}
  _stockData.stockIn.forEach(function(r){
    var t = (r.type||'').trim(); if(!t) return;
    inByType[t] = (inByType[t]||0) + (parseInt(r.boxes,10)||0);
  });
  _stockData.thawing.forEach(function(r){
    // thawing.type은 콤마 구분 가능 (예: "우둔,홍두깨") 박스도 합산값
    // 단순화: 첫 type만 사용. 추후 정교화 필요 시 별도 확장.
    var types = (r.type||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    var boxes = parseInt(r.boxes,10)||0;
    if(types.length === 0) return;
    // 박스를 type 수로 균등 분배 (개선 여지 있음)
    var per = boxes / types.length;
    types.forEach(function(t){
      outByType[t] = (outByType[t]||0) + per;
    });
  });

  // 모든 부위 합집합
  var allTypes = Array.from(new Set([].concat(Object.keys(inByType), Object.keys(outByType)))).sort();

  // 현재 잔여
  var remainHtml = allTypes.map(function(t){
    var ins = inByType[t]||0;
    var outs = outByType[t]||0;
    var rem = ins - outs;
    var color = rem < 50 ? '#dc2626' : rem < 200 ? '#f59e0b' : '#16a34a';
    return '<div style="flex:1;min-width:140px;padding:14px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">'
      + '<div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:6px">'+t+'</div>'
      + '<div style="font-size:22px;font-weight:700;color:'+color+'">'+Math.round(rem).toLocaleString()+' <span style="font-size:13px;color:#9ca3af;font-weight:500">박스</span></div>'
      + '<div style="font-size:11px;color:#9ca3af;margin-top:4px">입고 '+Math.round(ins).toLocaleString()+' · 사용 '+Math.round(outs).toLocaleString()+'</div>'
      + '</div>';
  }).join('');
  if(!remainHtml) remainHtml = '<div style="color:#9ca3af;padding:20px">입고 데이터 없음</div>';

  // 입고 이력 (최신순)
  var historyHtml = _stockData.stockIn.slice().sort(function(a,b){
    return String(b.date||'').localeCompare(String(a.date||''));
  }).map(function(r){
    var fbId = r.fbId || r.id || '';
    var note = r.note ? ' · '+String(r.note).replace(/'/g,"&#39;") : '';
    return '<tr>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:600">'+(r.date||'-')+'</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">'+(r.type||'-')+'</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600">'+(parseInt(r.boxes,10)||0).toLocaleString()+'박스</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px">'+(r.note||'')+'</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center">'
      +   '<button class="btn bo bsm" onclick="stockEdit(\''+fbId+'\')" style="margin-right:4px">수정</button>'
      +   '<button class="btn bd bsm" onclick="stockDelete(\''+fbId+'\')">삭제</button>'
      + '</td></tr>';
  }).join('');
  if(!historyHtml) historyHtml = '<tr><td colspan="5" style="padding:20px;text-align:center;color:#9ca3af">입고 이력 없음</td></tr>';

  pg.innerHTML =
      '<div style="max-width:1100px;margin:0 auto;padding:16px">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    +     '<h2 style="margin:0;font-size:18px;color:#1e293b">📦 원육 재고 현황</h2>'
    +     '<button class="btn bg bsm" onclick="renderStock()">🔄 새로고침</button>'
    +   '</div>'

    // 부위별 잔여 카드
    +   '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">'+remainHtml+'</div>'

    // 입고 입력 폼
    +   '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:24px">'
    +     '<div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px">➕ 입고 추가</div>'
    +     '<div style="display:grid;grid-template-columns:140px 160px 110px 1fr auto;gap:10px;align-items:end">'
    +       '<div><div style="font-size:11px;color:#6b7280;margin-bottom:4px">입고일</div>'
    +         '<input type="date" id="stIn_date" value="'+_stockToday()+'" class="fc" style="padding:7px 10px;width:100%;box-sizing:border-box;height:36px"></div>'
    +       '<div><div style="font-size:11px;color:#6b7280;margin-bottom:4px">부위</div>'
    +         '<input type="text" id="stIn_type" placeholder="우둔/홍두깨/설도..." class="fc" style="padding:7px 10px;width:100%;box-sizing:border-box;height:36px"></div>'
    +       '<div><div style="font-size:11px;color:#6b7280;margin-bottom:4px">박스 수</div>'
    +         '<input type="number" id="stIn_boxes" placeholder="0" class="fc" style="padding:7px 10px;width:100%;box-sizing:border-box;height:36px;text-align:right"></div>'
    +       '<div><div style="font-size:11px;color:#6b7280;margin-bottom:4px">메모(원산지/로트 등)</div>'
    +         '<input type="text" id="stIn_note" placeholder="(선택)" class="fc" style="padding:7px 10px;width:100%;box-sizing:border-box;height:36px"></div>'
    +       '<button class="btn bp" onclick="stockAdd()" style="padding:0 20px;height:36px;white-space:nowrap">저장</button>'
    +     '</div>'
    +     '<div style="font-size:11px;color:#9ca3af;margin-top:10px">※ 초기 재고도 "입고"로 입력하세요. 예) 2026-05-01 우둔 247박스 (메모: 초기재고)</div>'
    +   '</div>'

    // 입고 이력 테이블
    +   '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">'
    +     '<div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#1e293b">📋 입고 이력</div>'
    +     '<table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed">'
    +       '<colgroup>'
    +         '<col style="width:120px">'
    +         '<col style="width:120px">'
    +         '<col style="width:120px">'
    +         '<col>'
    +         '<col style="width:160px">'
    +       '</colgroup>'
    +       '<thead><tr style="background:#f9fafb">'
    +         '<th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">입고일</th>'
    +         '<th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">부위</th>'
    +         '<th style="padding:10px 12px;text-align:right;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">박스</th>'
    +         '<th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">메모</th>'
    +         '<th style="padding:10px 12px;text-align:center;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">관리</th>'
    +       '</tr></thead>'
    +       '<tbody>'+historyHtml+'</tbody>'
    +     '</table>'
    +   '</div>'
    + '</div>';
}

async function stockAdd(){
  var date = (document.getElementById('stIn_date')||{}).value || '';
  var type = (document.getElementById('stIn_type')||{}).value.trim();
  var boxes = parseInt((document.getElementById('stIn_boxes')||{}).value, 10);
  var note = (document.getElementById('stIn_note')||{}).value.trim();

  if(!date){ if(typeof toast==='function') toast('입고일을 입력하세요','d'); return; }
  if(!type){ if(typeof toast==='function') toast('부위를 입력하세요','d'); return; }
  if(!boxes || boxes <= 0){ if(typeof toast==='function') toast('박스 수는 1 이상','d'); return; }

  var rec = {
    id: (typeof gid==='function') ? gid() : ('stk_'+Date.now()),
    date: date,
    type: type,
    boxes: boxes,
    note: note
  };

  if(typeof toast==='function') toast('저장 중...','i');
  try {
    var fbId = await fbSave('stockIn', rec);
    if(fbId){
      rec.fbId = fbId;
      _stockData.stockIn.push(rec);
      if(typeof toast==='function') toast('✓ '+type+' '+boxes+'박스 저장됨','s');
      // 입력칸 초기화 (날짜는 유지)
      document.getElementById('stIn_type').value = '';
      document.getElementById('stIn_boxes').value = '';
      document.getElementById('stIn_note').value = '';
      _renderStockShell();
    } else {
      if(typeof toast==='function') toast('저장 실패','d');
    }
  } catch(e){
    console.error('[stock] 저장 오류:', e);
    if(typeof toast==='function') toast('저장 오류: '+(e.message||e),'d');
  }
}

async function stockEdit(fbId){
  if(!fbId) return;
  var rec = _stockData.stockIn.find(function(r){ return (r.fbId||r.id)===fbId; });
  if(!rec){ if(typeof toast==='function') toast('레코드를 찾을 수 없음','d'); return; }

  var newType = prompt('부위:', rec.type||'');
  if(newType === null) return;
  var newBoxes = prompt('박스 수:', String(parseInt(rec.boxes,10)||0));
  if(newBoxes === null) return;
  var newNote = prompt('메모:', rec.note||'');
  if(newNote === null) return;

  newType = String(newType).trim();
  var nb = parseInt(newBoxes, 10);
  if(!newType || !nb || nb <= 0){ if(typeof toast==='function') toast('입력값 오류','d'); return; }

  try {
    if(typeof fbUpdate === 'function'){
      await fbUpdate('stockIn', fbId, {type:newType, boxes:nb, note:String(newNote).trim()});
    } else {
      // fbUpdate 없으면 delete+save 패턴
      await fbDelete('stockIn', fbId);
      var newRec = Object.assign({}, rec, {type:newType, boxes:nb, note:String(newNote).trim()});
      delete newRec.fbId;
      var newId = await fbSave('stockIn', newRec);
      newRec.fbId = newId;
      _stockData.stockIn = _stockData.stockIn.filter(function(r){ return (r.fbId||r.id)!==fbId; });
      _stockData.stockIn.push(newRec);
    }
    rec.type = newType; rec.boxes = nb; rec.note = String(newNote).trim();
    if(typeof toast==='function') toast('✓ 수정됨','s');
    _renderStockShell();
  } catch(e){
    console.error('[stock] 수정 오류:', e);
    if(typeof toast==='function') toast('수정 오류: '+(e.message||e),'d');
  }
}

async function stockDelete(fbId){
  if(!fbId) return;
  if(!confirm('이 입고 레코드를 삭제하시겠습니까?')) return;
  try {
    await fbDelete('stockIn', fbId);
    _stockData.stockIn = _stockData.stockIn.filter(function(r){ return (r.fbId||r.id)!==fbId; });
    if(typeof toast==='function') toast('✓ 삭제됨','s');
    _renderStockShell();
  } catch(e){
    console.error('[stock] 삭제 오류:', e);
    if(typeof toast==='function') toast('삭제 오류: '+(e.message||e),'d');
  }
}

// globals
window.renderStock = renderStock;
window.stockAdd = stockAdd;
window.stockEdit = stockEdit;
window.stockDelete = stockDelete;
