// ============================================================
// 입고관리 — 2공장/1공장/천안물류 서브탭, 각자 입고/출고 이력
// 컬렉션:
//   stockIn        : 2공장 외부 입고
//   stockIn_f1     : 1공장 외부 입고
//   stockIn_ca     : 천안물류 외부 입고
//   transfer       : 위치간 이동 (from/to:'F2'|'F1'|'CA'; 구버전 direction:'F1toF2'|'F2toF1' 호환)
//   ※ 천안물류 = 보관·경유 창고 (사용/생산 없음)
// ============================================================

var _stockData = { stockIn: [], stockIn_f1: [], stockIn_ca: [], transfer: [], thawing: [] };
var _stockLoading = false;
var _stockSubTab = 'f2';

// 위치 코드 ↔ 탭키 ↔ 이름
var STK_LOCS = ['f2','f1','ca'];
var STK_LOC_CODE = { f2:'F2', f1:'F1', ca:'CA' };
var STK_CODE_LOC = { F2:'f2', F1:'f1', CA:'ca' };
var STK_LOC_NAME = { f2:'2공장', f1:'1공장', ca:'천안물류' };
var STK_IN_COLL  = { f2:'stockIn', f1:'stockIn_f1', ca:'stockIn_ca' };
// 이동 from/to 정규화 (신규 from/to 우선, 없으면 구버전 direction 해석)
function _trFromTo(r){
  if(r && r.from && r.to) return { from:r.from, to:r.to };
  if(r && r.direction==='F1toF2') return { from:'F1', to:'F2' };
  if(r && r.direction==='F2toF1') return { from:'F2', to:'F1' };
  return { from:'', to:'' };
}

function _stockThisMonth(){
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function _ymOf(date){ return String(date||'').slice(0,7); }
function _ymPrev(ym){
  var p = (ym||'').split('-'); if(p.length<2) return ym;
  var y=parseInt(p[0],10), m=parseInt(p[1],10)-1;
  if(m<1){ m=12; y--; }
  return y+'-'+String(m).padStart(2,'0');
}
function _ymNext(ym){
  var p = (ym||'').split('-'); if(p.length<2) return ym;
  var y=parseInt(p[0],10), m=parseInt(p[1],10)+1;
  if(m>12){ m=1; y++; }
  return y+'-'+String(m).padStart(2,'0');
}
function _ymLabel(ym){
  var p = (ym||'').split('-');
  if(p.length<2) return ym||'';
  return p[0]+'년 '+parseInt(p[1],10)+'월';
}

// === 일자 단위 헬퍼 ===
function _dateShift(ds, delta){
  var p=(ds||'').split('-'); if(p.length<3) return ds;
  var d=new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));
  d.setDate(d.getDate()+delta);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function _dateLabel(ds){
  var p=(ds||'').split('-'); if(p.length<3) return ds||'';
  var d=new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));
  var w=['일','월','화','수','목','금','토'][d.getDay()];
  return p[0]+'년 '+parseInt(p[1],10)+'월 '+parseInt(p[2],10)+'일('+w+')';
}

var _stockDateF2 = null;  // 선택일 (null=오늘, _renderStockShell에서 초기화)
var _stockDateF1 = null;
var _stockDateCa = null;
var _stockDateSum = null;
// 캐시된 최소 fetch 시작일 (이 날짜 이전 데이터는 아직 안 가져옴)
var _stockFetchedFrom = null;

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
      fbGetRange('thawing', thawingFrom, toStrThawing),
      fbGetRange('barcode', thawingFrom, toStrThawing).catch(function(){return [];}),
      fbGetRange('stockIn_ca', stockInFrom, toStr).catch(function(){return [];})
    ]);
    _stockData.stockIn = R[0] || [];
    _stockData.stockIn_f1 = R[1] || [];
    _stockData.transfer = R[2] || [];
    _stockData.thawing = R[3] || [];
    _stockData.barcode = R[4] || [];
    _stockData.stockIn_ca = R[5] || [];
    _stockFetchedFrom = stockInFrom;  // 캐시 시작 기록
    _renderStockShell();
    // 미등록 GTIN 배너는 입력>해동기 화면에서만 처리 (바코드 스캔 위치)
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

  var INITIAL = {
    f2: { '우둔':247, '홍두깨':1022, '설도':0 },
    f1: {},
    ca: {}   // 천안물류 초기재고 없음 (0)
  };
  var START_DATE = '2026-05-01';
  var KG_PER_BOX = 20;
  var allTypes = ['설도','우둔','홍두깨'];
  var today = tod();

  // 선택일 초기화 (최초 진입 시 오늘)
  if(!_stockDateF2) _stockDateF2 = today;
  if(!_stockDateF1) _stockDateF1 = today;
  if(!_stockDateCa) _stockDateCa = today;
  if(!_stockDateSum) _stockDateSum = today;
  // 현재 서브탭의 선택일 = 누적 기준일
  var selDate = (_stockSubTab==='f1') ? _stockDateF1 : (_stockSubTab==='ca') ? _stockDateCa : (_stockSubTab==='sum') ? _stockDateSum : _stockDateF2;

  // === 위치별 집계 (선택일까지 누적) ===
  var ext = {f2:{}, f1:{}, ca:{}};    // 외부입고
  var mvIn = {f2:{}, f1:{}, ca:{}};   // 이동 IN
  var mvOut = {f2:{}, f1:{}, ca:{}};  // 이동 OUT
  var dayIn = {f2:{}, f1:{}, ca:{}};  // 선택일 입고(외부+이동IN)
  var dayOut = {f2:{}, f1:{}, ca:{}}; // 선택일 이동출고
  STK_LOCS.forEach(function(loc){
    (_stockData[STK_IN_COLL[loc]]||[]).forEach(function(r){
      var d=String(r.date||'').slice(0,10); if(d<START_DATE||d>selDate) return;
      var t=String(r.type||'').trim(); var b=parseInt(r.boxes,10)||0; if(!t||!b) return;
      ext[loc][t]=(ext[loc][t]||0)+b;
      if(d===selDate) dayIn[loc][t]=(dayIn[loc][t]||0)+b;
    });
  });
  _stockData.transfer.forEach(function(r){
    var d=String(r.date||'').slice(0,10); if(d<START_DATE||d>selDate) return;
    var t=String(r.type||'').trim(); var b=parseInt(r.boxes,10)||0; if(!t||!b) return;
    var ft=_trFromTo(r); var fl=STK_CODE_LOC[ft.from], tl=STK_CODE_LOC[ft.to];
    if(tl){ mvIn[tl][t]=(mvIn[tl][t]||0)+b; if(d===selDate) dayIn[tl][t]=(dayIn[tl][t]||0)+b; }
    if(fl){ mvOut[fl][t]=(mvOut[fl][t]||0)+b; if(d===selDate) dayOut[fl][t]=(dayOut[fl][t]||0)+b; }
  });

  // === 2공장 사용(해동)/해동중 = barcode(해동 시작 = 창고에서 빠진 시점) 기준 ===
  var f2Out = {}, f2InProgress = {}, f2OutDay = {};
  var _prevDay = _dateShift(selDate, -1);
  (_stockData.barcode || []).forEach(function(b){
    var d = String(b.date||'').slice(0,10); if(d < START_DATE) return;
    var t = String(b.part||'').trim(); if(!t) return;
    if(d < selDate){ f2Out[t]=(f2Out[t]||0)+1; if(d===_prevDay) f2OutDay[t]=(f2OutDay[t]||0)+1; }
    else if(d === selDate) f2InProgress[t]=(f2InProgress[t]||0)+1;
  });

  // === 카드 (2공장: 사용/해동중 있음) ===
  function _f2Card(t){
    var init = INITIAL.f2[t]||0;
    var ins = ext.f2[t]||0;
    var mi = mvIn.f2[t]||0, mo = mvOut.f2[t]||0;
    var outs = f2Out[t]||0;
    var insDay = Math.round(dayIn.f2[t]||0);
    var outsDay = Math.round(f2OutDay[t]||0);
    var inProg = Math.round(f2InProgress[t]||0);
    var rem = Math.round(init + ins + mi - mo - outs);
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
      + '<div style="font-size:11px;color:#9ca3af;margin-top:4px">당일 입고 '+insDay.toLocaleString()+' · 사용 '+outsDay.toLocaleString()+'</div>'
      + '<div style="font-size:10px;color:#cbd5e1;margin-top:2px">누적: 입고 '+Math.round(ins).toLocaleString()+' · 사용 '+Math.round(outs).toLocaleString()+'</div>'
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

  // === 카드 (1공장/천안물류: 사용 없음 — 보관·이동만) ===
  function _genCard(loc, t){
    var init = INITIAL[loc][t]||0;
    var ins = ext[loc][t]||0;
    var mi = mvIn[loc][t]||0, mo = mvOut[loc][t]||0;
    var rem = init + ins + mi - mo;
    var estKg = Math.round(rem * KG_PER_BOX);
    var color = rem === 0 ? '#9ca3af' : rem < 50 ? '#f59e0b' : '#16a34a';
    return '<div style="flex:1;min-width:160px;padding:14px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">'
      + '<div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:6px">'+t+'</div>'
      + '<div style="font-size:22px;font-weight:700;color:'+color+';line-height:1.2">'+rem.toLocaleString()+' <span style="font-size:13px;color:#9ca3af;font-weight:500">박스</span></div>'
      + '<div style="font-size:12px;color:#6b7280;margin-top:4px">약 '+estKg.toLocaleString()+' kg</div>'
      + '<div style="font-size:11px;color:#9ca3af;margin-top:4px">'+(init?'초기 '+init.toLocaleString()+' · ':'')+'입고 '+ins.toLocaleString()+' · 이동입고 '+mi.toLocaleString()+' · 이동출고 '+mo.toLocaleString()+'</div>'
      + '</div>';
  }
  function _f1Card(t){ return _genCard('f1', t); }
  function _caCard(t){ return _genCard('ca', t); }

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

  // === 일자 필터 헬퍼 (그 날짜 하루) ===
  // 이력: 선택일까지 전부 (그 날짜 이후 미래 입출고는 숨김)
  function _filterByDate(rows, ds){
    return rows.filter(function(r){ return String(r.date||'').slice(0,10) <= ds; });
  }

  // 일자 선택기 UI (◀ YYYY년 M월 D일(요일) 📅 ▶) — 달력으로 직접 선택 가능
  function _datePicker(ds, tabKey){
    var isToday = (ds === tod());
    var atMax = (ds >= tod());  // 오늘 이상이면 ▶ 막기
    return '<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:14px;padding:8px 0">'
      + '<button onclick="_stockDateShift(\''+tabKey+'\',-1)" style="padding:6px 13px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:14px;cursor:pointer;color:#475569" title="이전 날">◀</button>'
      + '<span style="font-size:15px;font-weight:700;color:#1e293b;min-width:175px;text-align:center">'+_dateLabel(ds)+(isToday?' <span style="font-size:10px;color:#10b981;font-weight:600;margin-left:2px">오늘</span>':'')+'</span>'
      + '<label style="cursor:pointer;padding:6px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:14px;color:#475569;position:relative" title="날짜 선택">📅'
        + '<input type="date" value="'+ds+'" max="'+tod()+'" onchange="_stockDateSet(\''+tabKey+'\',this.value)" style="position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;cursor:pointer">'
      + '</label>'
      + (atMax
          ? '<button disabled style="padding:6px 13px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;font-size:14px;color:#cbd5e1;cursor:not-allowed" title="오늘 이후는 볼 수 없음">▶</button>'
          : '<button onclick="_stockDateShift(\''+tabKey+'\',1)" style="padding:6px 13px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:14px;cursor:pointer;color:#475569" title="다음 날">▶</button>')
      + '<button onclick="_stockDateSet(\''+tabKey+'\',\''+tod()+'\')" style="padding:6px 12px;background:#f1f5f9;border:1px solid #d1d5db;border-radius:5px;font-size:13px;cursor:pointer;color:#475569" title="오늘로">오늘</button>'
      + '</div>';
  }

  // === 위치별 입출고 이력 (선택일까지) ===
  function _locHist(loc){
    var code = STK_LOC_CODE[loc];
    var selD = (loc==='f1')?_stockDateF1:(loc==='ca')?_stockDateCa:_stockDateF2;
    var inRows=[], outRows=[];
    (_stockData[STK_IN_COLL[loc]]||[]).forEach(function(r){
      inRows.push({date:r.date||'-',type:r.type||'-',boxes:parseInt(r.boxes,10)||0,note:r.note||'',source:'외부 입고',fbId:r.fbId||r.id||'',collection:STK_IN_COLL[loc]});
    });
    _stockData.transfer.forEach(function(r){
      var ft=_trFromTo(r); var b=parseInt(r.boxes,10)||0;
      if(ft.to===code)   inRows.push({date:r.date||'-',type:r.type||'-',boxes:b,note:r.note||'',source:(STK_LOC_NAME[STK_CODE_LOC[ft.from]]||ft.from)+' ← 이동',fbId:r.fbId||r.id||'',collection:'transfer'});
      if(ft.from===code) outRows.push({date:r.date||'-',type:r.type||'-',boxes:b,note:r.note||'',source:(STK_LOC_NAME[STK_CODE_LOC[ft.to]]||ft.to)+' → 이동',fbId:r.fbId||r.id||'',collection:'transfer'});
    });
    var sortFn=function(a,b){return String(b.date).localeCompare(String(a.date));};
    inRows=_filterByDate(inRows, selD).sort(sortFn);
    outRows=_filterByDate(outRows, selD).sort(sortFn);
    return {
      inHtml: inRows.map(function(x){return _row(x.date,x.type,x.boxes,x.note,x.source,x.fbId,x.collection);}).join(''),
      outHtml: outRows.map(function(x){return _row(x.date,x.type,x.boxes,x.note,x.source,x.fbId,x.collection);}).join('')
    };
  }
  var f2H=_locHist('f2'), f1H=_locHist('f1'), caH=_locHist('ca');
  var f2InHtml=f2H.inHtml, f2OutHtml=f2H.outHtml, f1InHtml=f1H.inHtml, f1OutHtml=f1H.outHtml;

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
  function _tabBtn(key, label, col){
    var on=(_stockSubTab===key);
    return '<button onclick="_switchStockSubTab(\''+key+'\')" style="padding:10px 18px;background:none;border:none;border-bottom:2px solid '+(on?col:'transparent')+';color:'+(on?col:'#64748b')+';font-size:14px;font-weight:'+(on?'600':'500')+';cursor:pointer;margin-bottom:-2px">'+label+'</button>';
  }
  var subTabHtml = '<div style="display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:14px">'
    + _tabBtn('f2','🏭 2공장','#2563eb')
    + _tabBtn('f1','📦 1공장','#7c3aed')
    + _tabBtn('ca','🚚 천안물류','#059669')
    + _tabBtn('sum','📊 종합','#0f172a')
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

  // 입력 폼 — 천안물류 입고
  var caInputForm = '<div style="background:#fafafa;border:1px dashed #e5e7eb;border-radius:8px;padding:14px;margin-bottom:14px">'
    + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">입고일</label><input type="date" id="caIn_date" value="'+_stockToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">부위</label>'
        + '<div style="display:flex;gap:4px">'
        + '<button type="button" onclick="document.getElementById(\'caIn_type\').value=\'우둔\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">우둔</button>'
        + '<button type="button" onclick="document.getElementById(\'caIn_type\').value=\'홍두깨\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">홍두깨</button>'
        + '<button type="button" onclick="document.getElementById(\'caIn_type\').value=\'설도\'" style="padding:7px 10px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">설도</button>'
        + '<input type="text" id="caIn_type" placeholder="직접입력" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100px"></div></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">박스 수</label><input type="number" id="caIn_boxes" min="1" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:90px;text-align:right"></div>'
      + '<div style="flex:1;min-width:160px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="caIn_note" placeholder="원산지/로트 등" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
      + '<button onclick="stockCaAdd()" style="padding:8px 16px;background:#059669;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">저장</button>'
    + '</div></div>';

  // 이동 폼 — 출발지는 현재 탭으로 고정, 도착지만 선택
  function _transferForm(fromCode){
    var fromLoc = STK_CODE_LOC[fromCode];
    var toOpts = STK_LOCS.filter(function(l){ return l!==fromLoc; })
      .map(function(l){ return '<option value="'+STK_LOC_CODE[l]+'">'+STK_LOC_NAME[l]+'</option>'; }).join('');
    return '<div style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:8px;padding:14px;margin-bottom:14px">'
      + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
        + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">이동일</label><input type="date" id="trf_date" value="'+_stockToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
        + '<input type="hidden" id="trf_from" value="'+fromCode+'">'
        + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">출발지</label><div style="padding:7px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:5px;font-size:13px;font-weight:700;color:#0f172a">'+STK_LOC_NAME[fromLoc]+'</div></div>'
        + '<div style="align-self:center;padding:0 2px 8px;color:#9ca3af;font-size:16px">→</div>'
        + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">도착지</label><select id="trf_to" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px">'+toOpts+'</select></div>'
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
      + '<div style="flex:1;min-width:340px">' + _section('📥 입고 이력 (외부 + 이동)', _table(f2InHtml, '이 날 입고 이력 없음')) + '</div>'
      + '<div style="flex:1;min-width:340px">' + _section('📤 출고 이력 (다른 곳으로 이동)', _table(f2OutHtml, '이 날 출고 이력 없음')) + '</div>'
    + '</div>'
    + _section('🚚 다른 곳으로 이동', _transferForm('F2'));

  // === 1공장 화면 ===
  var f1Html = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">'+allTypes.map(_f1Card).join('')+'</div>'
    + _section('➕ 1공장 입고 추가', f1InputForm)
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">'
      + '<div style="flex:1;min-width:340px">' + _section('📥 입고 이력 (외부 + 이동)', _table(f1InHtml, '이 날 입고 이력 없음')) + '</div>'
      + '<div style="flex:1;min-width:340px">' + _section('📤 출고 이력 (다른 곳으로 이동)', _table(f1OutHtml, '이 날 출고 이력 없음')) + '</div>'
    + '</div>'
    + _section('🚚 다른 곳으로 이동', _transferForm('F1'));

  // === 천안물류 화면 (보관·경유 창고 — 사용 없음) ===
  var caHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">'+allTypes.map(_caCard).join('')+'</div>'
    + _section('➕ 천안물류 입고 추가', caInputForm)
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">'
      + '<div style="flex:1;min-width:340px">' + _section('📥 입고 이력 (외부 + 이동)', _table(caH.inHtml, '이 날 입고 이력 없음')) + '</div>'
      + '<div style="flex:1;min-width:340px">' + _section('📤 출고 이력 (다른 곳으로 이동)', _table(caH.outHtml, '이 날 출고 이력 없음')) + '</div>'
    + '</div>'
    + _section('🚚 다른 곳으로 이동', _transferForm('CA'));

  // === 종합 화면 (전체 원육 재고 = 2공장 + 1공장 + 천안물류) ===
  function _locStock(loc, t){
    var init=INITIAL[loc][t]||0, ins=ext[loc][t]||0, mi=mvIn[loc][t]||0, mo=mvOut[loc][t]||0;
    var use = (loc==='f2') ? (f2Out[t]||0) : 0;   // 사용(해동)은 2공장만
    return Math.round(init + ins + mi - mo - use);
  }
  var _totalCards = allTypes.map(function(t){
    var a=_locStock('f2',t), b=_locStock('f1',t), c=_locStock('ca',t), tot=a+b+c;
    var kg=Math.round(tot*KG_PER_BOX);
    var color = tot<50?'#dc2626':tot<200?'#f59e0b':'#16a34a';
    return '<div style="flex:1;min-width:210px;padding:16px 18px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">'
      + '<div style="font-size:14px;color:#6b7280;font-weight:700;margin-bottom:8px">'+t+'</div>'
      + '<div style="font-size:28px;font-weight:800;color:'+color+';line-height:1.1">'+tot.toLocaleString()+' <span style="font-size:14px;color:#9ca3af;font-weight:500">박스</span></div>'
      + '<div style="font-size:13px;color:#6b7280;margin-top:4px">약 '+kg.toLocaleString()+' kg</div>'
      + '<div style="font-size:11px;color:#9ca3af;margin-top:9px;line-height:1.6;border-top:1px solid #f1f5f9;padding-top:7px">🏭 2공장 <b style="color:#475569">'+a.toLocaleString()+'</b> · 📦 1공장 <b style="color:#475569">'+b.toLocaleString()+'</b> · 🚚 천안 <b style="color:#475569">'+c.toLocaleString()+'</b></div>'
      + '</div>';
  }).join('');
  var _grand={f2:0,f1:0,ca:0,tot:0};
  var _cellR=function(v,st){ return '<td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;text-align:right;'+(st||'')+'">'+v.toLocaleString()+'</td>'; };
  var _sumBody = allTypes.map(function(t){
    var a=_locStock('f2',t), b=_locStock('f1',t), c=_locStock('ca',t), tot=a+b+c;
    _grand.f2+=a; _grand.f1+=b; _grand.ca+=c; _grand.tot+=tot;
    return '<tr>'
      + '<td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;font-weight:700">'+t+'</td>'
      + _cellR(a,'font-weight:600')+_cellR(b,'font-weight:600')+_cellR(c,'font-weight:600')
      + _cellR(tot,'font-weight:800;color:#0f172a;background:#f8fafc')
      + '<td style="padding:9px 14px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280">'+Math.round(tot*KG_PER_BOX).toLocaleString()+' kg</td>'
      + '</tr>';
  }).join('');
  var _sumTotal = '<tr style="background:#f1f5f9">'
    + '<td style="padding:11px 14px;font-weight:800">전체 합계</td>'
    + _cellR(_grand.f2,'font-weight:800')+_cellR(_grand.f1,'font-weight:800')+_cellR(_grand.ca,'font-weight:800')
    + _cellR(_grand.tot,'font-weight:800;color:#1d4ed8')
    + '<td style="padding:11px 14px;text-align:right;font-weight:800;color:#1d4ed8">'+Math.round(_grand.tot*KG_PER_BOX).toLocaleString()+' kg</td>'
    + '</tr>';
  var _sumTable = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">'
    + '<thead><tr style="background:#f9fafb">'
    + '<th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;text-align:left;color:#475569">부위</th>'
    + '<th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;text-align:right;color:#475569">🏭 2공장</th>'
    + '<th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;text-align:right;color:#475569">📦 1공장</th>'
    + '<th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;text-align:right;color:#475569">🚚 천안물류</th>'
    + '<th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;text-align:right;color:#0f172a">합계(박스)</th>'
    + '<th style="padding:10px 14px;border-bottom:2px solid #e5e7eb;text-align:right;color:#475569">합계(kg)</th>'
    + '</tr></thead><tbody>'+_sumBody+_sumTotal+'</tbody></table></div>';
  var sumHtml = '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px">'+_totalCards+'</div>'
    + _section('📊 위치별 원육 재고 (박스 기준)', _sumTable)
    + '<div style="font-size:12px;color:#9ca3af;padding:2px 4px">※ '+_dateLabel(selDate)+' 기준 · 1박스 = '+KG_PER_BOX+'kg · 2공장은 해동(사용)분 차감 · 천안물류는 보관·경유만</div>';

  // 일자 선택기 — 최상단 (서브탭 아래)
  var datePickerTop = (_stockSubTab==='f1') ? _datePicker(_stockDateF1, 'f1')
    : (_stockSubTab==='ca') ? _datePicker(_stockDateCa, 'ca')
    : (_stockSubTab==='sum') ? _datePicker(_stockDateSum, 'sum')
    : _datePicker(_stockDateF2, 'f2');

  pg.innerHTML = '<div style="padding:16px 20px;max-width:1300px;margin:0 auto">'
    + subTabHtml
    + datePickerTop
    + (_stockSubTab==='f1' ? f1Html : _stockSubTab==='ca' ? caHtml : _stockSubTab==='sum' ? sumHtml : f2Html)
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
  var from = (document.getElementById('trf_from')||{}).value;
  var to   = (document.getElementById('trf_to')||{}).value;
  var type = String(document.getElementById('trf_type').value||'').trim();
  var boxes = parseInt(document.getElementById('trf_boxes').value, 10);
  var note = String(document.getElementById('trf_note').value||'').trim();
  if(!date){ toast && toast('이동일','d'); return; }
  if(!from || !to){ toast && toast('출발지/도착지','d'); return; }
  if(from === to){ toast && toast('출발지와 도착지가 같습니다','d'); return; }
  if(!type){ toast && toast('부위','d'); return; }
  if(!boxes || boxes<=0){ toast && toast('박스 수','d'); return; }
  var rec = { id: (typeof gid==='function')?gid():('trf_'+Date.now()), date:date, type:type, boxes:boxes, from:from, to:to, note:note };
  toast && toast('저장 중...','i');
  try {
    var fbId = await fbSave('transfer', rec);
    if(fbId){
      rec.fbId = fbId; _stockData.transfer.push(rec);
      var lbl = (STK_LOC_NAME[STK_CODE_LOC[from]]||from)+'→'+(STK_LOC_NAME[STK_CODE_LOC[to]]||to);
      toast && toast('✓ '+lbl+' '+type+' '+boxes+'박스','s');
      _renderStockShell();
    } else { toast && toast('저장 실패','d'); }
  } catch(e){ console.error(e); toast && toast('오류: '+(e.message||e),'d'); }
}

async function stockCaAdd(){
  var date = document.getElementById('caIn_date').value;
  var type = String(document.getElementById('caIn_type').value||'').trim();
  var boxes = parseInt(document.getElementById('caIn_boxes').value, 10);
  var note = String(document.getElementById('caIn_note').value||'').trim();
  if(!date){ toast && toast('입고일','d'); return; }
  if(!type){ toast && toast('부위','d'); return; }
  if(!boxes || boxes<=0){ toast && toast('박스 수','d'); return; }
  var rec = { id: (typeof gid==='function')?gid():('stkca_'+Date.now()), date:date, type:type, boxes:boxes, note:note };
  toast && toast('저장 중...','i');
  try {
    var fbId = await fbSave('stockIn_ca', rec);
    if(fbId){ rec.fbId = fbId; _stockData.stockIn_ca.push(rec); toast && toast('✓ 천안 '+type+' '+boxes+'박스 저장','s'); _renderStockShell(); }
    else { toast && toast('저장 실패','d'); }
  } catch(e){ console.error(e); toast && toast('오류: '+(e.message||e),'d'); }
}

async function stockGenericDelete(collection, fbId){
  if(!fbId) return;
  if(!confirm('이 레코드를 삭제하시겠습니까?')) return;
  try {
    await fbDelete(collection, fbId);
    if(collection === 'stockIn') _stockData.stockIn = _stockData.stockIn.filter(function(r){return (r.fbId||r.id)!==fbId;});
    else if(collection === 'stockIn_f1') _stockData.stockIn_f1 = _stockData.stockIn_f1.filter(function(r){return (r.fbId||r.id)!==fbId;});
    else if(collection === 'stockIn_ca') _stockData.stockIn_ca = _stockData.stockIn_ca.filter(function(r){return (r.fbId||r.id)!==fbId;});
    else if(collection === 'transfer') _stockData.transfer = _stockData.transfer.filter(function(r){return (r.fbId||r.id)!==fbId;});
    toast && toast('✓ 삭제됨','s');
    _renderStockShell();
  } catch(e){ console.error(e); toast && toast('삭제 오류: '+(e.message||e),'d'); }
}

// ============================================================
// 일자별 필터 핸들러
// ============================================================
async function _stockDateShift(tab, delta){
  var cur = (tab==='f1') ? _stockDateF1 : (tab==='ca') ? _stockDateCa : (tab==='sum') ? _stockDateSum : _stockDateF2;
  if(!cur) cur = _stockToday();
  await _stockDateSet(tab, _dateShift(cur, delta));
}

async function _stockDateSet(tab, ds){
  if(!ds || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return;
  if(ds > _stockToday()) ds = _stockToday();  // 오늘 이후는 차단
  if(tab==='f1') _stockDateF1 = ds;
  else if(tab==='ca') _stockDateCa = ds;
  else if(tab==='sum') _stockDateSum = ds;
  else _stockDateF2 = ds;

  // 캐시 시작일보다 과거 날짜를 선택했으면 fetch 확장
  if(_stockFetchedFrom && ds < _stockFetchedFrom){
    await _stockFetchOlder(ds.slice(0,7) + '-01');
  }
  _renderStockShell();
}

// 과거 데이터 fetch 확장 (필요시)
async function _stockFetchOlder(newFrom){
  if(!_stockFetchedFrom) return;
  if(newFrom >= _stockFetchedFrom) return;
  var pg = document.getElementById('p-stock');
  // 가벼운 로딩 표시
  try {
    var oldTo = _stockFetchedFrom;
    // newFrom ~ (_stockFetchedFrom 하루 전) 까지만 추가 fetch
    var prevDay = new Date(_stockFetchedFrom);
    prevDay.setDate(prevDay.getDate() - 1);
    var toStr = prevDay.getFullYear()+'-'+String(prevDay.getMonth()+1).padStart(2,'0')+'-'+String(prevDay.getDate()).padStart(2,'0');

    var R = await Promise.all([
      fbGetRange('stockIn', newFrom, toStr).catch(function(){return [];}),
      fbGetRange('stockIn_f1', newFrom, toStr).catch(function(){return [];}),
      fbGetRange('transfer', newFrom, toStr).catch(function(){return [];}),
      fbGetRange('stockIn_ca', newFrom, toStr).catch(function(){return [];})
    ]);
    if(R[0] && R[0].length) _stockData.stockIn = _stockData.stockIn.concat(R[0]);
    if(R[1] && R[1].length) _stockData.stockIn_f1 = _stockData.stockIn_f1.concat(R[1]);
    if(R[2] && R[2].length) _stockData.transfer = _stockData.transfer.concat(R[2]);
    if(R[3] && R[3].length) _stockData.stockIn_ca = _stockData.stockIn_ca.concat(R[3]);
    _stockFetchedFrom = newFrom;
  } catch(e){
    console.error('과거 데이터 로드 오류', e);
  }
}

window._stockDateShift = _stockDateShift;
window._stockDateSet = _stockDateSet;

// ============================================================
// 미등록 GTIN 자동 검사 + 등록 모달 + 부적합 재판정
// ============================================================
async function _checkUnknownGtinsBanner(){
  var pg = document.getElementById('p-stock');
  if(!pg) return;
  // 기존 배너 제거
  var oldBanner = document.getElementById('gtinBanner');
  if(oldBanner) oldBanner.remove();
  if(typeof findUnknownGtins !== 'function') return;
  try {
    var unknown = await findUnknownGtins();
    if(!unknown || !unknown.length) return;
    // 배너 생성
    var banner = document.createElement('div');
    banner.id = 'gtinBanner';
    var totalCnt = unknown.reduce(function(s,u){return s + u.count;}, 0);
    banner.innerHTML = ''
      + '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:14px 18px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px">'
      + '  <div>'
      + '    <div style="font-size:14px;font-weight:700;color:#92400e">⚠️ 미등록 GTIN ' + unknown.length + '개 발견 (총 ' + totalCnt + '건 부적합)</div>'
      + '    <div style="font-size:12px;color:#78350f;margin-top:3px">새로 들어온 원육 박스 GTIN이 시스템에 등록되지 않아 부적합으로 표시되고 있습니다.</div>'
      + '  </div>'
      + '  <button onclick="_openGtinRegisterModal()" style="background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">등록하고 정리하기</button>'
      + '</div>';
    pg.insertBefore(banner, pg.firstChild);
  } catch(e){
    console.warn('[gtinBanner] 검사 실패:', e);
  }
}

async function _openGtinRegisterModal(){
  if(typeof findUnknownGtins !== 'function'){
    alert('GTIN 관리 기능 미로드'); return;
  }
  // 1) 이미 등록된 GTIN인데 부적합으로 남은 건 먼저 재판정해서 정상화
  //    (스캔 당시 gtinMap 미로드로 부적합 저장된 케이스 — 등록 불필요, 정정만 하면 됨)
  if(typeof rejudgeBarcodes === 'function'){
    try{
      var rj = await rejudgeBarcodes();
      if(rj && rj.fixed){
        if(typeof renderStock === 'function' && document.getElementById('p-stock')) renderStock();
        if(typeof renderBC === 'function' && document.getElementById('bcList')) renderBC();
      }
    }catch(e){ console.warn('[정리] 재판정 실패', e); }
  }
  // 2) 그래도 남은 진짜 미등록 GTIN만 등록 모달로
  var unknown = await findUnknownGtins();
  if(!unknown.length){
    alert('정리 완료 — 등록이 필요한 새 GTIN은 없습니다.'); return;
  }
  // 모달 생성
  var modal = document.createElement('div');
  modal.id = 'gtinModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  var rowsHtml = unknown.map(function(u, i){
    return ''
      + '<tr>'
      + '  <td style="padding:8px;font-family:monospace;font-size:13px;border-bottom:1px solid #e5e7eb">' + u.gtin + '</td>'
      + '  <td style="padding:8px;text-align:center;color:#dc2626;font-weight:600;border-bottom:1px solid #e5e7eb">' + u.count + '건</td>'
      + '  <td style="padding:8px;text-align:center;border-bottom:1px solid #e5e7eb">'
      + '    <select id="gtinPart_' + i + '" data-gtin="' + u.gtin + '" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:5px;font-size:13px">'
      + '      <option value="">선택...</option>'
      + '      <option value="설도">설도</option>'
      + '      <option value="우둔">우둔</option>'
      + '      <option value="홍두깨">홍두깨</option>'
      + '    </select>'
      + '  </td>'
      + '</tr>';
  }).join('');
  modal.innerHTML = ''
    + '<div style="background:#fff;border-radius:12px;max-width:700px;width:100%;max-height:90vh;overflow:auto;padding:24px">'
    + '  <h2 style="margin:0 0 6px;font-size:18px;color:#1e293b">미등록 GTIN 등록</h2>'
    + '  <p style="margin:0 0 16px;font-size:13px;color:#64748b">아래 GTIN의 부위를 선택하고 [등록]을 누르세요. 같은 GTIN의 부적합 record는 모두 자동으로 정상화됩니다.</p>'
    + '  <table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '    <thead><tr style="background:#f8fafc">'
    + '      <th style="padding:10px;text-align:left;border-bottom:2px solid #cbd5e1">GTIN</th>'
    + '      <th style="padding:10px;text-align:center;border-bottom:2px solid #cbd5e1">부적합 건수</th>'
    + '      <th style="padding:10px;text-align:center;border-bottom:2px solid #cbd5e1">부위 선택</th>'
    + '    </tr></thead>'
    + '    <tbody>' + rowsHtml + '</tbody>'
    + '  </table>'
    + '  <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">'
    + '    <button onclick="_closeGtinModal()" style="padding:9px 18px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;cursor:pointer">취소</button>'
    + '    <button onclick="_submitGtinRegister(' + unknown.length + ')" style="padding:9px 22px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">등록 + 자동 정정</button>'
    + '  </div>'
    + '</div>';
  document.body.appendChild(modal);
}

function _closeGtinModal(){
  var modal = document.getElementById('gtinModal');
  if(modal) modal.remove();
}

async function _submitGtinRegister(cnt){
  // 선택된 부위 수집
  var toRegister = [];
  for(var i = 0; i < cnt; i++){
    var el = document.getElementById('gtinPart_' + i);
    if(!el) continue;
    var gtin = el.dataset.gtin;
    var part = el.value;
    if(!part){ continue; }  // 미선택은 스킵
    toRegister.push({ gtin: gtin, part: part });
  }
  if(!toRegister.length){
    alert('부위를 1개 이상 선택하세요.'); return;
  }
  try {
    // 1) GTIN 등록 (Firestore + 로컬)
    for(var k = 0; k < toRegister.length; k++){
      await registerGtin(toRegister[k].gtin, toRegister[k].part);
    }
    // 2) 부적합 재판정
    var result = await rejudgeBarcodes();
    var msg = 'GTIN ' + toRegister.length + '개 등록 완료\n'
      + '✓ 자동 정정: ' + result.fixed + '건\n';
    if(result.stillUnknown && Object.keys(result.stillUnknown).length){
      msg += '⚠ 미해결: ' + Object.values(result.stillUnknown).reduce(function(s,n){return s+n;},0) + '건 (다른 미등록 GTIN)\n';
    }
    alert(msg);
    _closeGtinModal();
    // 페이지 갱신 - 현재 어느 화면이든 갱신
    if(typeof renderStock === 'function' && document.getElementById('p-stock')) renderStock();
    if(typeof renderBC === 'function' && document.getElementById('bcList')) renderBC();
  } catch(e){
    alert('등록 실패: ' + (e.message || e));
  }
}

window._openGtinRegisterModal = _openGtinRegisterModal;
window._closeGtinModal = _closeGtinModal;
window._submitGtinRegister = _submitGtinRegister;
window._checkUnknownGtinsBanner = _checkUnknownGtinsBanner;

window.renderStock = renderStock;
window.stockAdd = stockAdd;
window.stockF1Add = stockF1Add;
window.stockCaAdd = stockCaAdd;
window.transferAdd = transferAdd;
window.stockGenericDelete = stockGenericDelete;
