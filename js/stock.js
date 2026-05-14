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

  // ★ 시작일 고정: 2026-05-01 (이 시점부터 입고/출고 누적해서 잔여 계산)
  //   thawing 출고는 end 기준이라, start가 4/30이고 end가 5/1인 케이스 포함하려고
  //   thawing은 4/29부터 fetch (출고 판정은 _renderStockShell에서 end 기준으로)
  var stockInFrom = '2026-05-01';
  var thawingFrom = '2026-04-29';
  var today = new Date();
  var toStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');

  try {
    var R = await Promise.all([
      fbGetRange('stockIn', stockInFrom, toStr),
      fbGetRange('thawing', thawingFrom, toStr)
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

  // ★ date 룰 통일: thawing.date = 종료일 (= 실제 제품 만들어지는 날 = 박스 출고일)
  //   별도 보정 로직 불필요. r.date 그대로 사용.

  // ★ 5/1 기초 재고 (화면에는 안 보이고 잔여 계산에만 반영)
  //   다음 월 첫날 이월값은 자동 누적 (5/1 이후 모든 입고+기초 - 모든 사용)
  var INITIAL = { '우둔': 247, '홍두깨': 1024, '설도': 0 };

  // 부위별 누적 계산 (5/1 시작점 적용)
  var START_DATE = '2026-05-01';
  var inByType = {};   // {부위: 박스 합}
  var outByType = {};  // {부위: 박스 합}
  _stockData.stockIn.forEach(function(r){
    var t = (r.type||'').trim(); if(!t) return;
    var d = String(r.date||'').slice(0,10);
    if(d < START_DATE) return;
    inByType[t] = (inByType[t]||0) + (parseInt(r.boxes,10)||0);
  });
  _stockData.thawing.forEach(function(r){
    var outDate = String(r.date||'').slice(0,10);  // date = 종료일 = 출고일
    if(outDate < START_DATE) return;
    // thawing.type은 콤마 구분 가능 (예: "우둔,홍두깨") 박스도 합산값
    var types = (r.type||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    var boxes = parseInt(r.boxes,10)||0;
    if(types.length === 0) return;
    // 박스를 type 수로 균등 분배 (개선 여지 있음)
    var per = boxes / types.length;
    types.forEach(function(t){
      outByType[t] = (outByType[t]||0) + per;
    });
  });

  // 해동중 (date > 오늘 = 오늘 시작했고 미래에 끝날 예정인 박스) 별도 집계
  var today = tod();
  var inProgressByType = {};
  _stockData.thawing.forEach(function(r){
    var outDate = String(r.date||'').slice(0,10);
    if(outDate <= today) return;  // 오늘 이전 종료 = 이미 끝남, 해동중 아님
    var types = (r.type||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    var boxes = parseInt(r.boxes,10)||0;
    if(types.length === 0) return;
    var per = boxes / types.length;
    types.forEach(function(t){
      inProgressByType[t] = (inProgressByType[t]||0) + per;
    });
  });

  // 모든 부위 합집합 (INITIAL 키도 포함)
  var allTypes = Array.from(new Set([].concat(Object.keys(INITIAL), Object.keys(inByType), Object.keys(outByType)))).sort();

  // 현재 잔여 = 기초 + 입고 - 사용
  var KG_PER_BOX = 20;  // 박스당 추정 무게 (모든 부위 공통)
  var remainHtml = allTypes.map(function(t){
    var init = INITIAL[t]||0;
    var ins = inByType[t]||0;
    var outs = outByType[t]||0;
    var inProg = inProgressByType[t]||0;
    var rem = init + ins - outs;  // ★ 기초 재고 반영
    var estKg = Math.round(rem * KG_PER_BOX);
    var color = rem < 50 ? '#dc2626' : rem < 200 ? '#f59e0b' : '#16a34a';
    var progressBadge = inProg > 0
      ? '<span style="margin-left:6px;font-size:11px;color:#2563eb;font-weight:600;background:#eff6ff;padding:2px 6px;border-radius:4px">해동중 '+Math.round(inProg)+'</span>'
      : '';
    return '<div style="flex:1;min-width:140px;padding:14px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">'
      + '<div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:6px">'+t+'</div>'
      + '<div style="font-size:22px;font-weight:700;color:'+color+'">'+Math.round(rem).toLocaleString()+' <span style="font-size:13px;color:#9ca3af;font-weight:500">박스</span>'+progressBadge+'</div>'
      + '<div style="font-size:12px;color:#6b7280;margin-top:3px">약 '+estKg.toLocaleString()+' kg</div>'
      + '<div style="font-size:11px;color:#9ca3af;margin-top:4px">입고 '+Math.round(ins).toLocaleString()+' · 사용 '+Math.round(outs).toLocaleString()+'</div>'
      + '</div>';
  }).join('');
  if(!remainHtml) remainHtml = '<div style="color:#9ca3af;padding:20px">입고 데이터 없음</div>';

  // 입고 이력 (최신순)
  var historyHtml = _stockData.stockIn.slice().sort(function(a,b){
    return String(b.date||'').localeCompare(String(a.date||''));
  }).map(function(r){
    var fbId = r.fbId || r.id || '';
    return '<tr>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;font-weight:600">'+(r.date||'-')+'</td>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;text-align:center">'+(r.type||'-')+'</td>'
      + '<td style="padding:8px 24px 8px 16px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600">'+(parseInt(r.boxes,10)||0).toLocaleString()+'</td>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px">'+(r.note||'')+'</td>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;text-align:center">'
      +   '<button class="btn bo bsm" onclick="stockEdit(\''+fbId+'\')" style="margin-right:6px">수정</button>'
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
    +     '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
    +       '<div><div style="font-size:11px;color:#6b7280;margin-bottom:4px">입고일</div>'
    +         '<input type="date" id="stIn_date" value="'+_stockToday()+'" class="fc" style="padding:7px 10px;width:140px;box-sizing:border-box;height:36px"></div>'
    +       '<div><div style="font-size:11px;color:#6b7280;margin-bottom:4px">부위</div>'
    +         '<div style="display:flex;gap:4px;align-items:center">'
    +           '<button type="button" onclick="_stockPickType(\'우둔\')" id="stIn_btn_우둔" class="btn bo bsm" style="height:36px;padding:0 12px">우둔</button>'
    +           '<button type="button" onclick="_stockPickType(\'홍두깨\')" id="stIn_btn_홍두깨" class="btn bo bsm" style="height:36px;padding:0 12px">홍두깨</button>'
    +           '<button type="button" onclick="_stockPickType(\'설도\')" id="stIn_btn_설도" class="btn bo bsm" style="height:36px;padding:0 12px">설도</button>'
    +           '<input type="text" id="stIn_type" placeholder="직접입력" class="fc" style="padding:7px 10px;width:100px;box-sizing:border-box;height:36px">'
    +         '</div>'
    +       '</div>'
    +       '<div><div style="font-size:11px;color:#6b7280;margin-bottom:4px">박스 수</div>'
    +         '<input type="number" id="stIn_boxes" placeholder="0" class="fc" style="padding:7px 10px;width:100px;box-sizing:border-box;height:36px;text-align:right"></div>'
    +       '<div style="min-width:200px;max-width:280px"><div style="font-size:11px;color:#6b7280;margin-bottom:4px">메모 (선택)</div>'
    +         '<input type="text" id="stIn_note" placeholder="원산지/로트 등" class="fc" style="padding:7px 10px;width:100%;box-sizing:border-box;height:36px"></div>'
    +       '<button class="btn bp" onclick="stockAdd()" style="padding:0 20px;height:36px;white-space:nowrap">저장</button>'
    +     '</div>'
    +     '<div style="font-size:11px;color:#9ca3af;margin-top:10px">※ 초기 재고도 "입고"로 입력하세요. 예) 2026-05-01 우둔 247박스 (메모: 초기재고)</div>'
    +   '</div>'

    // 입고 이력 테이블
    +   '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">'
    +     '<div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#1e293b">📋 입고 이력</div>'
    +     '<table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed">'
    +       '<colgroup>'
    +         '<col style="width:140px">'
    +         '<col style="width:120px">'
    +         '<col style="width:140px">'
    +         '<col>'
    +         '<col style="width:170px">'
    +       '</colgroup>'
    +       '<thead><tr style="background:#f9fafb">'
    +         '<th style="padding:10px 16px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">입고일</th>'
    +         '<th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">부위</th>'
    +         '<th style="padding:10px 24px 10px 16px;text-align:right;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">박스</th>'
    +         '<th style="padding:10px 16px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">메모</th>'
    +         '<th style="padding:10px 16px;text-align:center;font-weight:600;color:#475569;border-bottom:1px solid #e5e7eb">관리</th>'
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

function _stockPickType(t){
  var inp = document.getElementById('stIn_type');
  if(inp) inp.value = t;
}

// globals
window.renderStock = renderStock;
window.stockAdd = stockAdd;
window.stockEdit = stockEdit;
window.stockDelete = stockDelete;
window._stockPickType = _stockPickType;
