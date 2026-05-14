// ============================================================
// 입고관리 — 2공장/1공장 서브탭, 각자 입고/출고 이력
// 컬렉션:
//   stockIn        : 2공장 외부 입고
//   stockIn_f1     : 1공장 외부 입고
//   transfer       : 공장간 이동 (direction:'F1toF2'|'F2toF1')
// ============================================================

var _stockData = { stockIn: [], stockIn_f1: [], transfer: [], thawing: [] };
var _stockLoading = false;
var _stockSubTab = 'f2';

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

  var stockInFrom = '2026-05-01';
  var thawingFrom = '2026-04-29';
  var today = new Date();
  var toStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  var tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate()+1);
  var toStrThawing = tomorrow.getFullYear()+'-'+String(tomorrow.getMonth()+1).padStart(2,'0')+'-'+String(tomorrow.getDate()).padStart(2,'0');

  try {
    var R = await Promise.all([
      fbGetRange('stockIn', stockInFrom, toStr),
      fbGetRange('stockIn_f1', stockInFrom, toStr).catch(function(){return [];}),
      fbGetRange('transfer', stockInFrom, toStr).catch(function(){return [];}),
      fbGetRange('thawing', thawingFrom, toStrThawing)
    ]);
    _stockData.stockIn = R[0] || [];
    _stockData.stockIn_f1 = R[1] || [];
    _stockData.transfer = R[2] || [];
    _stockData.thawing = R[3] || [];
    _renderStockShell();
  } catch(e){
    pg.innerHTML = '<div style="padding:20px;color:#c0392b">로드 오류: '+(e.message||e)+'</div>';
  } finally {
    _stockLoading = false;
  }
}

function _switchStockSubTab(tab){
  _stockSubTab = tab;
  _renderStockShell();
}
window._switchStockSubTab = _switchStockSubTab;

function _renderStockShell(){
  var pg = document.getElementById('p-stock');
  if(!pg) return;

  var INITIAL = { '우둔': 247, '홍두깨': 1024, '설도': 0 };
  var START_DATE = '2026-05-01';
  var KG_PER_BOX = 20;
  var allTypes = ['설도','우둔','홍두깨'];
  var today = tod();

  // === 2공장 누적 ===
  var f2In = {}, f2Out = {}, f2InProgress = {}, f2FromF1 = {}, f2ToF1 = {};
  _stockData.stockIn.forEach(function(r){
    var d = String(r.date||'').slice(0,10);
    if(d < START_DATE) return;
    var t = String(r.type||'').trim();
    var b = parseInt(r.boxes,10)||0;
    if(!t || !b) return;
    f2In[t] = (f2In[t]||0) + b;
  });
  _stockData.thawing.forEach(function(r){
    var od = String(r.date||'').slice(0,10);
    if(od < START_DATE) return;
    if(!r.end) return;
    if(od > today) return;
    var types = (r.type||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    var boxes = parseInt(r.boxes,10)||0;
    if(!types.length) return;
    var per = boxes/types.length;
    types.forEach(function(t){ f2Out[t] = (f2Out[t]||0) + per; });
  });
  _stockData.thawing.forEach(function(r){
    var d = String(r.date||'').slice(0,10);
    if(d < START_DATE) return;
    var isInProg = (!r.end) || (d > today);
    if(!isInProg) return;
    var types = (r.type||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    var boxes = parseInt(r.boxes,10)||0;
    if(!types.length) return;
    var per = boxes/types.length;
    types.forEach(function(t){ f2InProgress[t] = (f2InProgress[t]||0) + per; });
  });
  _stockData.transfer.forEach(function(r){
    var d = String(r.date||'').slice(0,10);
    if(d < START_DATE) return;
    var t = String(r.type||'').trim();
    var b = parseInt(r.boxes,10)||0;
    var dir = r.direction || 'F1toF2';
    if(!t || !b) return;
    if(dir === 'F1toF2'){ f2FromF1[t] = (f2FromF1[t]||0) + b; }
    else if(dir === 'F2toF1'){ f2ToF1[t] = (f2ToF1[t]||0) + b; }
  });

  // === 1공장 누적 ===
  var f1In = {};
  _stockData.stockIn_f1.forEach(function(r){
    var d = String(r.date||'').slice(0,10);
    if(d < START_DATE) return;
    var t = String(r.type||'').trim();
    var b = parseInt(r.boxes,10)||0;
    if(!t || !b) return;
    f1In[t] = (f1In[t]||0) + b;
  });

  // === 카드 (2공장) ===
  function _f2Card(t){
    var init = INITIAL[t]||0;
    var ins = f2In[t]||0;
    var outs = f2Out[t]||0;
    var inProg = Math.round(f2InProgress[t]||0);
    var fromF1 = f2FromF1[t]||0;
    var toF1 = f2ToF1[t]||0;
    var rem = Math.round(init + ins + fromF1 - toF1 - outs);
    var remNext = rem - inProg;
    var outsNext = Math.round(outs) + inProg;
    var estKg = Math.round(rem * KG_PER_BOX);
    var estKgNext = Math.round(remNext * KG_PER_BOX);
    var color = rem < 50 ? '#dc2626' : rem < 200 ? '#f59e0b' : '#16a34a';
    var hasProg = inProg > 0;

    var todayCell = '<div style="flex:1">'
      + '<div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:6px">'+t+'</div>'
      + '<div style="font-size:22px;font-weight:700;color:'+color+';line-height:1.2">'+rem.toLocaleString()+' <span style="font-size:13px;color:#9ca3af;font-weight:500">박스</span></div>'
      + '<div style="font-size:12px;color:#6b7280;margin-top:4px">약 '+estKg.toLocaleString()+' kg</div>'
      + '<div style="font-size:11px;color:#9ca3af;margin-top:4px">입고 '+Math.round(ins).toLocaleString()+' · 사용 '+Math.round(outs).toLocaleString()+'</div>'
      + '</div>';

    var tomorrowCell = hasProg
      ? '<div style="font-size:22px;color:#9ca3af;font-weight:300;align-self:center;padding:0 4px">→</div>'
        + '<div style="flex:1">'
          + '<div style="margin-bottom:6px;min-height:18px"><span style="font-size:11px;color:#2563eb;font-weight:600;background:#eff6ff;padding:2px 7px;border-radius:4px">해동중 '+inProg+'박스</span></div>'
          + '<div style="font-size:22px;font-weight:700;color:#374151;line-height:1.2">'+remNext.toLocaleString()+' <span style="font-size:13px;color:#9ca3af;font-weight:500">박스</span></div>'
          + '<div style="font-size:12px;color:#6b7280;margin-top:4px">약 '+estKgNext.toLocaleString()+' kg</div>'
          + '<div style="font-size:11px;color:#9ca3af;margin-top:4px">사용 '+outsNext.toLocaleString()+'</div>'
        + '</div>'
      : '';

    return '<div style="flex:1;min-width:200px;padding:14px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">'
      + '<div style="display:flex;align-items:flex-start;gap:6px">'+todayCell+tomorrowCell+'</div></div>';
  }

  // === 카드 (1공장) ===
  function _f1Card(t){
    var ins = f1In[t]||0;
    var fromF1 = f2FromF1[t]||0;
    var toF1 = f2ToF1[t]||0;
    var rem = ins - fromF1 + toF1;
    var estKg = Math.round(rem * KG_PER_BOX);
    var color = rem === 0 ? '#9ca3af' : rem < 50 ? '#f59e0b' : '#16a34a';
    return '<div style="flex:1;min-width:160px;padding:14px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">'
      + '<div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:6px">'+t+'</div>'
      + '<div style="font-size:22px;font-weight:700;color:'+color+';line-height:1.2">'+rem.toLocaleString()+' <span style="font-size:13px;color:#9ca3af;font-weight:500">박스</span></div>'
      + '<div style="font-size:12px;color:#6b7280;margin-top:4px">약 '+estKg.toLocaleString()+' kg</div>'
      + '<div style="font-size:11px;color:#9ca3af;margin-top:4px">입고 '+ins.toLocaleString()+' · 2공장이동 '+fromF1.toLocaleString()+'</div>'
      + '</div>';
  }

  // 이력 row 헬퍼
  function _row(date, type, boxes, note, source, fbId, collection){
    return '<tr>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;font-weight:600">'+date+'</td>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;text-align:center">'+type+'</td>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;text-align:center"><span style="font-size:11px;color:#475569;font-weight:500;background:#f1f5f9;padding:2px 8px;border-radius:4px">'+source+'</span></td>'
      + '<td style="padding:8px 24px 8px 16px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600">'+boxes.toLocaleString()+'</td>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;color:#6b7280">'+(note||'-')+'</td>'
      + '<td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;text-align:center">'
        + (fbId ? '<button onclick="stockGenericDelete(\''+collection+'\',\''+fbId+'\')" style="padding:4px 10px;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer">삭제</button>' : '-')
      + '</td></tr>';
  }

  // === 2공장 이력 ===
  // 입고: stockIn (외부) + transfer F1→F2
  var f2InRows = [];
  _stockData.stockIn.forEach(function(r){
    f2InRows.push({date:r.date||'-',type:r.type||'-',boxes:parseInt(r.boxes,10)||0,note:r.note||'',source:'외부 입고',fbId:r.fbId||r.id||'',collection:'stockIn'});
  });
  _stockData.transfer.forEach(function(r){
    if(r.direction !== 'F1toF2') return;
    f2InRows.push({date:r.date||'-',type:r.type||'-',boxes:parseInt(r.boxes,10)||0,note:r.note||'',source:'1공장 ← 이동',fbId:r.fbId||r.id||'',collection:'transfer'});
  });
  f2InRows.sort(function(a,b){return String(b.date).localeCompare(String(a.date));});
  var f2InHtml = f2InRows.map(function(x){return _row(x.date,x.type,x.boxes,x.note,x.source,x.fbId,x.collection);}).join('');

  // 출고: transfer F2→F1
  var f2OutRows = [];
  _stockData.transfer.forEach(function(r){
    if(r.direction !== 'F2toF1') return;
    f2OutRows.push({date:r.date||'-',type:r.type||'-',boxes:parseInt(r.boxes,10)||0,note:r.note||'',source:'1공장 → 이동',fbId:r.fbId||r.id||'',collection:'transfer'});
  });
  f2OutRows.sort(function(a,b){return String(b.date).localeCompare(String(a.date));});
  var f2OutHtml = f2OutRows.map(function(x){return _row(x.date,x.type,x.boxes,x.note,x.source,x.fbId,x.collection);}).join('');

  // === 1공장 이력 ===
  var f1InRows = [];
  _stockData.stockIn_f1.forEach(function(r){
    f1InRows.push({date:r.date||'-',type:r.type||'-',boxes:parseInt(r.boxes,10)||0,note:r.note||'',source:'외부 입고',fbId:r.fbId||r.id||'',collection:'stockIn_f1'});
  });
  _stockData.transfer.forEach(function(r){
    if(r.direction !== 'F2toF1') return;
    f1InRows.push({date:r.date||'-',type:r.type||'-',boxes:parseInt(r.boxes,10)||0,note:r.note||'',source:'2공장 ← 이동',fbId:r.fbId||r.id||'',collection:'transfer'});
  });
  f1InRows.sort(function(a,b){return String(b.date).localeCompare(String(a.date));});
  var f1InHtml = f1InRows.map(function(x){return _row(x.date,x.type,x.boxes,x.note,x.source,x.fbId,x.collection);}).join('');

  var f1OutRows = [];
  _stockData.transfer.forEach(function(r){
    if(r.direction !== 'F1toF2') return;
    f1OutRows.push({date:r.date||'-',type:r.type||'-',boxes:parseInt(r.boxes,10)||0,note:r.note||'',source:'2공장 → 이동',fbId:r.fbId||r.id||'',collection:'transfer'});
  });
  f1OutRows.sort(function(a,b){return String(b.date).localeCompare(String(a.date));});
  var f1OutHtml = f1OutRows.map(function(x){return _row(x.date,x.type,x.boxes,x.note,x.source,x.fbId,x.collection);}).join('');

  // 테이블 헬퍼
  function _table(rowsHtml, emptyMsg){
    if(!rowsHtml) return '<div style="text-align:center;color:#9ca3af;padding:12px;font-size:13px">'+emptyMsg+'</div>';
    return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr style="background:#f9fafb">'
        + '<th style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:left;font-weight:600;color:#475569">날짜</th>'
        + '<th style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;color:#475569">부위</th>'
        + '<th style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;color:#475569">구분</th>'
        + '<th style="padding:8px 24px 8px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#475569">박스</th>'
        + '<th style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:left;font-weight:600;color:#475569">메모</th>'
        + '<th style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;color:#475569">관리</th>'
      + '</tr></thead><tbody>'+rowsHtml+'</tbody></table></div>';
  }

  function _section(title, body){
    return '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px 20px;margin-bottom:14px">'
      + '<h3 style="margin:0 0 12px;font-size:15px;color:#0f172a;font-weight:700">'+title+'</h3>'
      + body + '</div>';
  }

  // 서브탭
  var subTabHtml = '<div style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:14px">'
    + '<button onclick="_switchStockSubTab(\'f2\')" style="padding:10px 18px;background:none;border:none;border-bottom:2px solid '+(_stockSubTab==='f2'?'#2563eb':'transparent')+';color:'+(_stockSubTab==='f2'?'#2563eb':'#64748b')+';font-size:14px;font-weight:'+(_stockSubTab==='f2'?'600':'500')+';cursor:pointer;margin-bottom:-2px">🏭 2공장</button>'
    + '<button onclick="_switchStockSubTab(\'f1\')" style="padding:10px 18px;background:none;border:none;border-bottom:2px solid '+(_stockSubTab==='f1'?'#7c3aed':'transparent')+';color:'+(_stockSubTab==='f1'?'#7c3aed':'#64748b')+';font-size:14px;font-weight:'+(_stockSubTab==='f1'?'600':'500')+';cursor:pointer;margin-bottom:-2px">📦 1공장</button>'
    + '</div>';

  // 입력 폼 — 2공장 입고
  var f2InputForm = '<div style="background:#fafafa;border:1px dashed #e5e7eb;border-radius:8px;padding:14px;margin-bottom:14px">'
    + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">입고일</label><input type="date" id="stIn_date" value="'+_stockToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">부위</label>'
        + '<div style="display:flex;gap:4px">'
        + '<button type="button" onclick="document.getElementById(\'stIn_type\').value=\'우둔\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">우둔</button>'
        + '<button type="button" onclick="document.getElementById(\'stIn_type\').value=\'홍두깨\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">홍두깨</button>'
        + '<button type="button" onclick="document.getElementById(\'stIn_type\').value=\'설도\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">설도</button>'
        + '<input type="text" id="stIn_type" placeholder="직접입력" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100px"></div></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">박스 수</label><input type="number" id="stIn_boxes" min="1" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:90px;text-align:right"></div>'
      + '<div style="flex:1;min-width:160px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="stIn_note" placeholder="원산지/로트 등" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
      + '<button onclick="stockAdd()" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">저장</button>'
    + '</div></div>';

  // 입력 폼 — 1공장 입고
  var f1InputForm = '<div style="background:#fafafa;border:1px dashed #e5e7eb;border-radius:8px;padding:14px;margin-bottom:14px">'
    + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">입고일</label><input type="date" id="f1In_date" value="'+_stockToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">부위</label>'
        + '<div style="display:flex;gap:4px">'
        + '<button type="button" onclick="document.getElementById(\'f1In_type\').value=\'우둔\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">우둔</button>'
        + '<button type="button" onclick="document.getElementById(\'f1In_type\').value=\'홍두깨\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">홍두깨</button>'
        + '<button type="button" onclick="document.getElementById(\'f1In_type\').value=\'설도\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">설도</button>'
        + '<input type="text" id="f1In_type" placeholder="직접입력" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100px"></div></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">박스 수</label><input type="number" id="f1In_boxes" min="1" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:90px;text-align:right"></div>'
      + '<div style="flex:1;min-width:160px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="f1In_note" placeholder="원산지/로트 등" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
      + '<button onclick="stockF1Add()" style="padding:8px 16px;background:#7c3aed;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">저장</button>'
    + '</div></div>';

  // 이동 폼
  function _transferForm(defaultDir){
    return '<div style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:8px;padding:14px;margin-bottom:14px">'
      + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
        + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">이동일</label><input type="date" id="trf_date" value="'+_stockToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
        + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">방향</label>'
          + '<select id="trf_dir" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px">'
          + '<option value="F1toF2"'+(defaultDir==='F1toF2'?' selected':'')+'>1공장 → 2공장</option>'
          + '<option value="F2toF1"'+(defaultDir==='F2toF1'?' selected':'')+'>2공장 → 1공장</option>'
          + '</select></div>'
        + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">부위</label>'
          + '<div style="display:flex;gap:4px">'
          + '<button type="button" onclick="document.getElementById(\'trf_type\').value=\'우둔\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">우둔</button>'
          + '<button type="button" onclick="document.getElementById(\'trf_type\').value=\'홍두깨\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">홍두깨</button>'
          + '<button type="button" onclick="document.getElementById(\'trf_type\').value=\'설도\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">설도</button>'
          + '<input type="text" id="trf_type" placeholder="직접입력" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100px"></div></div>'
        + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">박스 수</label><input type="number" id="trf_boxes" min="1" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:90px;text-align:right"></div>'
        + '<div style="flex:1;min-width:140px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="trf_note" placeholder="사유 등" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
        + '<button onclick="transferAdd()" style="padding:8px 16px;background:#d97706;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">이동 저장</button>'
      + '</div></div>';
  }

  // === 2공장 화면 ===
  var f2Html = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">'+allTypes.map(_f2Card).join('')+'</div>'
    + _section('➕ 2공장 입고 추가', f2InputForm)
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">'
      + '<div style="flex:1;min-width:340px">' + _section('📥 입고 이력 (외부 + 1공장 이동)', _table(f2InHtml, '입고 이력 없음')) + '</div>'
      + '<div style="flex:1;min-width:340px">' + _section('📤 출고 이력 (1공장으로 이동)', _table(f2OutHtml, '출고 이력 없음')) + '</div>'
    + '</div>'
    + _section('🚚 1공장으로 이동', _transferForm('F2toF1'));

  // === 1공장 화면 ===
  var f1Html = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">'+allTypes.map(_f1Card).join('')+'</div>'
    + _section('➕ 1공장 입고 추가', f1InputForm)
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">'
      + '<div style="flex:1;min-width:340px">' + _section('📥 입고 이력 (외부 + 2공장 이동)', _table(f1InHtml, '입고 이력 없음')) + '</div>'
      + '<div style="flex:1;min-width:340px">' + _section('📤 출고 이력 (2공장으로 이동)', _table(f1OutHtml, '출고 이력 없음')) + '</div>'
    + '</div>'
    + _section('🚚 2공장으로 이동', _transferForm('F1toF2'));

  pg.innerHTML = '<div style="padding:16px 20px;max-width:1300px;margin:0 auto">'
    + subTabHtml
    + (_stockSubTab === 'f2' ? f2Html : f1Html)
    + '<div style="text-align:right;padding:8px 0"><button onclick="renderStock()" style="padding:6px 14px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;color:#475569;cursor:pointer">🔄 새로고침</button></div>'
    + '</div>';
}

// === 저장 함수 ===
async function stockAdd(){
  var date = document.getElementById('stIn_date').value;
  var type = String(document.getElementById('stIn_type').value||'').trim();
  var boxes = parseInt(document.getElementById('stIn_boxes').value, 10);
  var note = String(document.getElementById('stIn_note').value||'').trim();
  if(!date){ toast && toast('입고일','d'); return; }
  if(!type){ toast && toast('부위','d'); return; }
  if(!boxes || boxes<=0){ toast && toast('박스 수','d'); return; }
  var rec = { id: (typeof gid==='function')?gid():('stk_'+Date.now()), date:date, type:type, boxes:boxes, note:note };
  toast && toast('저장 중...','i');
  try {
    var fbId = await fbSave('stockIn', rec);
    if(fbId){ rec.fbId = fbId; _stockData.stockIn.push(rec); toast && toast('✓ '+type+' '+boxes+'박스 저장','s'); _renderStockShell(); }
    else { toast && toast('저장 실패','d'); }
  } catch(e){ console.error(e); toast && toast('오류: '+(e.message||e),'d'); }
}

async function stockF1Add(){
  var date = document.getElementById('f1In_date').value;
  var type = String(document.getElementById('f1In_type').value||'').trim();
  var boxes = parseInt(document.getElementById('f1In_boxes').value, 10);
  var note = String(document.getElementById('f1In_note').value||'').trim();
  if(!date){ toast && toast('입고일','d'); return; }
  if(!type){ toast && toast('부위','d'); return; }
  if(!boxes || boxes<=0){ toast && toast('박스 수','d'); return; }
  var rec = { id: (typeof gid==='function')?gid():('stkf1_'+Date.now()), date:date, type:type, boxes:boxes, note:note };
  toast && toast('저장 중...','i');
  try {
    var fbId = await fbSave('stockIn_f1', rec);
    if(fbId){ rec.fbId = fbId; _stockData.stockIn_f1.push(rec); toast && toast('✓ 1공장 '+type+' '+boxes+'박스 저장','s'); _renderStockShell(); }
    else { toast && toast('저장 실패','d'); }
  } catch(e){ console.error(e); toast && toast('오류: '+(e.message||e),'d'); }
}

async function transferAdd(){
  var date = document.getElementById('trf_date').value;
  var direction = document.getElementById('trf_dir').value;
  var type = String(document.getElementById('trf_type').value||'').trim();
  var boxes = parseInt(document.getElementById('trf_boxes').value, 10);
  var note = String(document.getElementById('trf_note').value||'').trim();
  if(!date){ toast && toast('이동일','d'); return; }
  if(!type){ toast && toast('부위','d'); return; }
  if(!boxes || boxes<=0){ toast && toast('박스 수','d'); return; }
  var rec = { id: (typeof gid==='function')?gid():('trf_'+Date.now()), date:date, type:type, boxes:boxes, direction:direction, note:note };
  toast && toast('저장 중...','i');
  try {
    var fbId = await fbSave('transfer', rec);
    if(fbId){
      rec.fbId = fbId; _stockData.transfer.push(rec);
      var dirLbl = direction === 'F2toF1' ? '2공장→1공장' : '1공장→2공장';
      toast && toast('✓ '+dirLbl+' '+type+' '+boxes+'박스','s');
      _renderStockShell();
    } else { toast && toast('저장 실패','d'); }
  } catch(e){ console.error(e); toast && toast('오류: '+(e.message||e),'d'); }
}

async function stockGenericDelete(collection, fbId){
  if(!fbId) return;
  if(!confirm('이 레코드를 삭제하시겠습니까?')) return;
  try {
    await fbDelete(collection, fbId);
    if(collection === 'stockIn') _stockData.stockIn = _stockData.stockIn.filter(function(r){return (r.fbId||r.id)!==fbId;});
    else if(collection === 'stockIn_f1') _stockData.stockIn_f1 = _stockData.stockIn_f1.filter(function(r){return (r.fbId||r.id)!==fbId;});
    else if(collection === 'transfer') _stockData.transfer = _stockData.transfer.filter(function(r){return (r.fbId||r.id)!==fbId;});
    toast && toast('✓ 삭제됨','s');
    _renderStockShell();
  } catch(e){ console.error(e); toast && toast('삭제 오류: '+(e.message||e),'d'); }
}

window.renderStock = renderStock;
window.stockAdd = stockAdd;
window.stockF1Add = stockF1Add;
window.transferAdd = transferAdd;
window.stockGenericDelete = stockGenericDelete;
