// ============================================================
// 외포장 서브탭 — 출고 대기 현황(재고) + 출고 이력
//   goodsLot  : 재고 입고 로트 {product, dateType:'제조'|'소비', date, ea, note}
//   goodsShip : 출고 기록      {product, lotDate, dateType, date(출고일), ea, note}
//   FC 3KG = 제조일자 입력(소비기한=제조일+60일), 나머지 = 소비기한 입력
//   재고 = Σ goodsLot.ea − Σ goodsShip.ea  (제품+로트일자 기준)
// ============================================================

var _shipData = { lots: [], ships: [] };
var _opSubTab = 'work';
var _shipLoaded = false;
var FC3KG = 'FC 장조림 3KG';

function _shipProducts(){
  var ps = ((typeof L!=='undefined' && L.products) || []).map(function(p){ return p.name; });
  return ps.filter(Boolean);
}
function _shipToday(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
var FC_SHELF_DAYS=60;
function _plusDays(ds, n){ var p=String(ds||'').split('-'); if(p.length<3) return ds; var d=new Date(+p[0],+p[1]-1,+p[2]); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function _shipExpiry(lot){ return lot.dateType==='제조' ? _plusDays(lot.date, FC_SHELF_DAYS) : lot.date; }
function _dday(ds){ var p=String(ds||'').split('-'); if(p.length<3) return null; var d=new Date(+p[0],+p[1]-1,+p[2]); var t=new Date(); t.setHours(0,0,0,0); return Math.floor((d-t)/86400000); }
function _ddayBadge(exp){
  var dd=_dday(exp); if(dd===null) return '';
  var bg,fg; if(dd<0){bg='#fecaca';fg='#991b1b';} else if(dd<=10){bg='#fee2e2';fg='#dc2626';} else if(dd<=30){bg='#fef3c7';fg='#92400e';} else {bg='#dcfce7';fg='#166534';}
  var lbl = dd<0 ? '만료 '+(-dd)+'일' : 'D-'+dd;
  return '<span style="background:'+bg+';color:'+fg+';font-size:11px;padding:1px 7px;border-radius:20px;font-weight:600;margin-left:6px">'+lbl+'</span>';
}
function _perBoxOf(prod){ try{ return (typeof getPerBox==='function') ? (getPerBox(prod)||0) : 0; }catch(e){ return 0; } }

function opSwitchTab(tab){
  _opSubTab = tab;
  ['work','stock','ship'].forEach(function(t){
    var v=document.getElementById('op_view_'+t); if(v) v.style.display = (t===tab)?'':'none';
    var b=document.getElementById('opTab_'+t);
    if(b){ var on=(t===tab); b.style.borderBottomColor=on?'#2563eb':'transparent'; b.style.color=on?'#2563eb':'#64748b'; b.style.fontWeight=on?'600':'500'; }
  });
  if((tab==='stock'||tab==='ship')){ if(!_shipLoaded) loadShipment(); else _renderShipViews(); }
}
window.opSwitchTab = opSwitchTab;

async function loadShipment(){
  var from='2026-01-01', to=_shipToday();
  try {
    var R = await Promise.all([
      fbGetRange('goodsLot', from, to).catch(function(){return [];}),
      fbGetRange('goodsShip', from, to).catch(function(){return [];})
    ]);
    _shipData.lots = R[0]||[];
    _shipData.ships = R[1]||[];
    _shipLoaded = true;
    _renderShipViews();
  } catch(e){ console.error('출고/재고 로드 오류', e); }
}
window.loadShipment = loadShipment;

function _shippedFor(prod, lotDate){
  return _shipData.ships.filter(function(s){ return s.product===prod && String(s.lotDate)===String(lotDate); })
    .reduce(function(a,s){ return a + (parseInt(s.ea,10)||0); }, 0);
}

function _renderShipViews(){ _renderStockView(); _renderShipView(); }

// ── 재고 입고 등록 폼 (제품에 따라 날짜 라벨 전환) ──
function _stockAddForm(){
  var opts = _shipProducts().map(function(p){ return '<option value="'+p.replace(/"/g,'&quot;')+'">'+p+'</option>'; }).join('');
  return '<div style="background:#fafafa;border:1px dashed #e5e7eb;border-radius:8px;padding:14px;margin-bottom:16px">'
    + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
      + '<div style="min-width:200px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">제품</label>'
        + '<select id="gl_prod" onchange="_glOnProd()" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%">'+opts+'</select></div>'
      + '<div><label id="gl_datelbl" style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">소비기한</label><input type="date" id="gl_date" value="'+_shipToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
      + '<div id="gl_exphint" style="align-self:center;padding-bottom:8px;font-size:11px;color:#9ca3af"></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">수량(EA)</label><input type="number" id="gl_ea" min="1" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:110px;text-align:right"></div>'
      + '<div style="flex:1;min-width:140px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="gl_note" placeholder="로트/비고" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
      + '<button onclick="goodsLotAdd()" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">재고 등록</button>'
    + '</div></div>';
}
function _glOnProd(){
  var prod=(document.getElementById('gl_prod')||{}).value;
  var isFC=(prod===FC3KG);
  var lbl=document.getElementById('gl_datelbl'); if(lbl) lbl.textContent = isFC?'제조일자':'소비기한';
  _glExpHint();
}
function _glExpHint(){
  var prod=(document.getElementById('gl_prod')||{}).value;
  var d=(document.getElementById('gl_date')||{}).value;
  var el=document.getElementById('gl_exphint'); if(!el) return;
  el.textContent = (prod===FC3KG && d) ? ('→ 소비기한 '+_plusDays(d, FC_SHELF_DAYS)+' (제조+'+FC_SHELF_DAYS+'일)') : '';
}
window._glOnProd=_glOnProd;

// ── 재고 현황 뷰 ──
function _renderStockView(){
  var host=document.getElementById('op_view_stock'); if(!host) return;
  // 로트 집계: 제품+로트일자 단위
  var lotMap={};  // key: prod|date → {prod, dateType, date, inEa}
  _shipData.lots.forEach(function(l){
    var prod=l.product, date=String(l.date||'').slice(0,10); if(!prod||!date) return;
    var k=prod+'|'+date;
    if(!lotMap[k]) lotMap[k]={prod:prod, dateType:l.dateType||'소비', date:date, inEa:0};
    lotMap[k].inEa += parseInt(l.ea,10)||0;
  });
  var lots=Object.keys(lotMap).map(function(k){ return lotMap[k]; });
  // 제품별 총재고 요약
  var byProd={};
  lots.forEach(function(lt){
    var out=_shippedFor(lt.prod, lt.date), rem=lt.inEa-out;
    byProd[lt.prod]=(byProd[lt.prod]||0)+rem;
  });
  var prodOrder=_shipProducts().filter(function(p){ return byProd[p]!==undefined; });
  var cards=prodOrder.map(function(p){
    var rem=byProd[p], pb=_perBoxOf(p), boxes=pb>0?Math.floor(rem/pb):0;
    return '<div style="background:#f8fafc;border-radius:8px;padding:12px 14px;min-width:150px;flex:1">'
      + '<div style="font-size:13px;color:#6b7280">'+p+'</div>'
      + '<div style="font-size:22px;font-weight:800;margin-top:2px;color:'+(rem<=0?'#dc2626':'#0f172a')+'">'+rem.toLocaleString()+' <span style="font-size:12px;color:#9ca3af;font-weight:500">EA</span></div>'
      + (pb>0?'<div style="font-size:11px;color:#9ca3af;margin-top:2px">약 '+boxes.toLocaleString()+'박스</div>':'')
      + '</div>';
  }).join('');
  // 로트 표 (제품별 그룹, 소비기한 임박순)
  lots.sort(function(a,b){ if(a.prod!==b.prod) return a.prod<b.prod?-1:1; return _shipExpiry(a)<_shipExpiry(b)?-1:1; });
  var rows='', curProd=null;
  lots.forEach(function(lt){
    if(lt.prod!==curProd){ curProd=lt.prod;
      rows += '<tr style="background:#eff6ff"><td colspan="6" style="padding:7px 14px;font-weight:600;color:#1d4ed8;font-size:12px">'+lt.prod+'</td></tr>';
    }
    var out=_shippedFor(lt.prod, lt.date), rem=lt.inEa-out, exp=_shipExpiry(lt);
    var dateCell = (lt.dateType==='제조')
      ? '<span style="font-family:monospace;color:#374151">'+lt.date+'</span> <span style="font-size:11px;color:#9ca3af">제조</span>'
      : '<span style="font-family:monospace;color:#374151">'+lt.date+'</span> <span style="font-size:11px;color:#9ca3af">소비</span>';
    rows += '<tr style="border-top:0.5px solid #f3f4f6">'
      + '<td style="padding:10px 14px">'+dateCell+'</td>'
      + '<td style="padding:10px 8px;text-align:center;font-size:12px">'+exp+_ddayBadge(exp)+'</td>'
      + '<td style="padding:10px 8px;text-align:right;color:#6b7280">'+lt.inEa.toLocaleString()+'</td>'
      + '<td style="padding:10px 8px;text-align:right;color:'+(out>0?'#dc2626':'#9ca3af')+'">'+out.toLocaleString()+'</td>'
      + '<td style="padding:10px 8px;text-align:right;font-weight:700;color:'+(rem<=0?'#dc2626':'#0f172a')+'">'+rem.toLocaleString()+'</td>'
      + '<td style="padding:8px 14px;text-align:center"><button onclick="_shipQuick(\''+lt.prod.replace(/'/g,"\\'")+'\',\''+lt.date+'\')" style="padding:5px 12px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">🚚 출고</button></td>'
      + '</tr>';
  });
  if(!rows) rows='<tr><td colspan="6" style="padding:16px;text-align:center;color:#9ca3af;font-size:13px">등록된 재고 없음 — 아래에서 재고를 등록하세요</td></tr>';
  var table='<div style="background:#fff;border:0.5px solid #e5e7eb;border-radius:12px;overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<thead><tr style="background:#f9fafb">'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">로트(제조/소비일)</th>'
    + '<th style="padding:9px 8px;text-align:center;color:#475569;font-weight:600">소비기한</th>'
    + '<th style="padding:9px 8px;text-align:right;color:#475569;font-weight:600">입고</th>'
    + '<th style="padding:9px 8px;text-align:right;color:#475569;font-weight:600">출고</th>'
    + '<th style="padding:9px 8px;text-align:right;color:#0f172a;font-weight:600">남은 재고</th>'
    + '<th style="padding:9px 14px;text-align:center;color:#475569;font-weight:600"></th>'
    + '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';

  host.innerHTML = (cards?'<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">'+cards+'</div>':'')
    + '<div style="font-size:15px;font-weight:700;color:#0f172a;margin:4px 2px 10px">➕ 재고 등록 (외포장 완료분 입고)</div>'
    + _stockAddForm()
    + '<div style="font-size:15px;font-weight:700;color:#0f172a;margin:4px 2px 10px">📦 로트별 재고</div>'
    + table
    + '<div style="font-size:12px;color:#9ca3af;margin-top:10px;padding:0 2px">남은 재고 = 입고 − 출고 · FC 3KG는 제조일자(소비기한=제조일+60일), 나머지는 소비기한 기준 · 임박 로트 색 표시</div>';
  setTimeout(function(){ _glOnProd(); var de=document.getElementById('gl_date'); if(de) de.addEventListener('change', _glExpHint); }, 0);
}

// ── 출고 이력 뷰 ──
function _renderShipView(){
  var host=document.getElementById('op_view_ship'); if(!host) return;
  // 출고 폼: 제품 → 로트 선택
  var prods=_shipProducts();
  var prodOpts=prods.map(function(p){ return '<option value="'+p.replace(/"/g,'&quot;')+'">'+p+'</option>'; }).join('');
  var form='<div style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:8px;padding:14px;margin-bottom:16px">'
    + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">출고일</label><input type="date" id="gs_date" value="'+_shipToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
      + '<div style="min-width:190px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">제품</label><select id="gs_prod" onchange="_gsFillLots()" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%">'+prodOpts+'</select></div>'
      + '<div style="min-width:170px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">로트(제조/소비일)</label><select id="gs_lot" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></select></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">출고 수량(EA)</label><input type="number" id="gs_ea" min="1" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:120px;text-align:right"></div>'
      + '<div style="flex:1;min-width:130px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="gs_note" placeholder="거래처 등" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
      + '<button onclick="goodsShipAdd()" style="padding:8px 16px;background:#d97706;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">출고 저장</button>'
    + '</div></div>';
  // 출고 목록
  var ships=_shipData.ships.slice().sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  var rows=ships.map(function(s){
    var fb=s.fbId||s.id||'';
    return '<tr style="border-top:0.5px solid #f3f4f6">'
      + '<td style="padding:9px 14px;font-weight:600;font-family:monospace">'+(s.date||'-')+'</td>'
      + '<td style="padding:9px 14px">'+(s.product||'-')+'</td>'
      + '<td style="padding:9px 14px;font-family:monospace;color:#6b7280">'+(s.lotDate||'-')+'<span style="font-size:11px;color:#9ca3af"> '+(s.dateType==='제조'?'제조':'소비')+'</span></td>'
      + '<td style="padding:9px 14px;text-align:right;font-weight:600">'+(parseInt(s.ea,10)||0).toLocaleString()+'</td>'
      + '<td style="padding:9px 14px;color:#6b7280">'+(s.note||'-')+'</td>'
      + '<td style="padding:9px 14px;text-align:center">'+(fb?'<button onclick="goodsShipDelete(\''+fb+'\')" style="padding:4px 10px;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer">삭제</button>':'-')+'</td>'
      + '</tr>';
  }).join('');
  if(!rows) rows='<tr><td colspan="6" style="padding:16px;text-align:center;color:#9ca3af;font-size:13px">출고 기록 없음</td></tr>';
  var table='<div style="background:#fff;border:0.5px solid #e5e7eb;border-radius:12px;overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<thead><tr style="background:#f9fafb">'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">출고일</th>'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">제품</th>'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">로트</th>'
    + '<th style="padding:9px 14px;text-align:right;color:#475569;font-weight:600">출고 EA</th>'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">메모</th>'
    + '<th style="padding:9px 14px;text-align:center;color:#475569;font-weight:600">관리</th>'
    + '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  host.innerHTML = '<div style="font-size:15px;font-weight:700;color:#0f172a;margin:4px 2px 10px">🚚 출고 등록</div>'
    + form
    + '<div style="font-size:15px;font-weight:700;color:#0f172a;margin:4px 2px 10px">📋 출고 목록</div>'
    + table;
  setTimeout(_gsFillLots, 0);
}

// 선택 제품의 남은 재고 있는 로트만 드롭다운
function _gsFillLots(){
  var prod=(document.getElementById('gs_prod')||{}).value;
  var sel=document.getElementById('gs_lot'); if(!sel) return;
  var lotMap={};
  _shipData.lots.forEach(function(l){
    if(l.product!==prod) return; var date=String(l.date||'').slice(0,10); if(!date) return;
    var k=date; if(!lotMap[k]) lotMap[k]={dateType:l.dateType||'소비', date:date, inEa:0}; lotMap[k].inEa+=parseInt(l.ea,10)||0;
  });
  var arr=Object.keys(lotMap).map(function(k){ var lt=lotMap[k]; lt.rem=lt.inEa-_shippedFor(prod,lt.date); return lt; })
    .filter(function(lt){ return lt.rem>0; }).sort(function(a,b){ return a.date<b.date?-1:1; });
  sel.innerHTML = arr.length ? arr.map(function(lt){
    return '<option value="'+lt.date+'|'+lt.dateType+'">'+lt.date+' ('+(lt.dateType==='제조'?'제조':'소비')+') · 남은 '+lt.rem.toLocaleString()+'</option>';
  }).join('') : '<option value="">재고 있는 로트 없음</option>';
}
window._gsFillLots=_gsFillLots;

// 재고 표에서 [출고] 클릭 → 출고 탭으로 이동 + 그 로트 선택
function _shipQuick(prod, date){
  opSwitchTab('ship');
  setTimeout(function(){
    var ps=document.getElementById('gs_prod'); if(ps){ ps.value=prod; _gsFillLots(); }
    var ls=document.getElementById('gs_lot');
    if(ls){ for(var i=0;i<ls.options.length;i++){ if(ls.options[i].value.indexOf(date+'|')===0){ ls.selectedIndex=i; break; } } }
    var ea=document.getElementById('gs_ea'); if(ea) ea.focus();
  }, 60);
}
window._shipQuick=_shipQuick;

// ── 저장/삭제 ──
async function goodsLotAdd(){
  var prod=(document.getElementById('gl_prod')||{}).value;
  var date=(document.getElementById('gl_date')||{}).value;
  var ea=parseInt((document.getElementById('gl_ea')||{}).value,10);
  var note=String((document.getElementById('gl_note')||{}).value||'').trim();
  if(!prod){ toast&&toast('제품','d'); return; }
  if(!date){ toast&&toast('날짜','d'); return; }
  if(!ea||ea<=0){ toast&&toast('수량','d'); return; }
  var dateType = (prod===FC3KG) ? '제조' : '소비';
  var rec={ id:(typeof gid==='function')?gid():('gl_'+Date.now()), product:prod, dateType:dateType, date:date, ea:ea, note:note };
  toast&&toast('저장 중...','i');
  try{ var fbId=await fbSave('goodsLot', rec);
    if(fbId){ rec.fbId=fbId; _shipData.lots.push(rec); toast&&toast('✓ '+prod+' '+ea.toLocaleString()+'EA 재고 등록','s');
      var e=document.getElementById('gl_ea'); if(e)e.value=''; var n=document.getElementById('gl_note'); if(n)n.value='';
      _renderShipViews();
    } else toast&&toast('저장 실패','d');
  }catch(e){ console.error(e); toast&&toast('오류: '+(e.message||e),'d'); }
}
window.goodsLotAdd=goodsLotAdd;

async function goodsShipAdd(){
  var date=(document.getElementById('gs_date')||{}).value;
  var prod=(document.getElementById('gs_prod')||{}).value;
  var lotv=(document.getElementById('gs_lot')||{}).value;
  var ea=parseInt((document.getElementById('gs_ea')||{}).value,10);
  var note=String((document.getElementById('gs_note')||{}).value||'').trim();
  if(!date){ toast&&toast('출고일','d'); return; }
  if(!prod){ toast&&toast('제품','d'); return; }
  if(!lotv){ toast&&toast('출고할 로트 선택','d'); return; }
  if(!ea||ea<=0){ toast&&toast('수량','d'); return; }
  var parts=lotv.split('|'); var lotDate=parts[0], dateType=parts[1]||'소비';
  // 남은 재고 초과 방지
  var inEa=_shipData.lots.filter(function(l){return l.product===prod && String(l.date).slice(0,10)===lotDate;}).reduce(function(a,l){return a+(parseInt(l.ea,10)||0);},0);
  var rem=inEa-_shippedFor(prod,lotDate);
  if(ea>rem){ toast&&toast('남은 재고('+rem.toLocaleString()+') 초과','d'); return; }
  var rec={ id:(typeof gid==='function')?gid():('gs_'+Date.now()), product:prod, lotDate:lotDate, dateType:dateType, date:date, ea:ea, note:note };
  toast&&toast('저장 중...','i');
  try{ var fbId=await fbSave('goodsShip', rec);
    if(fbId){ rec.fbId=fbId; _shipData.ships.push(rec); toast&&toast('✓ '+prod+' '+ea.toLocaleString()+'EA 출고','s');
      var e=document.getElementById('gs_ea'); if(e)e.value=''; var n=document.getElementById('gs_note'); if(n)n.value='';
      _renderShipViews();
    } else toast&&toast('저장 실패','d');
  }catch(e){ console.error(e); toast&&toast('오류: '+(e.message||e),'d'); }
}
window.goodsShipAdd=goodsShipAdd;

async function goodsShipDelete(fbId){
  if(!fbId) return; if(!confirm('이 출고 기록을 삭제하시겠습니까?')) return;
  try{ await fbDelete('goodsShip', fbId);
    _shipData.ships=_shipData.ships.filter(function(s){ return (s.fbId||s.id)!==fbId; });
    toast&&toast('✓ 삭제됨','s'); _renderShipViews();
  }catch(e){ console.error(e); toast&&toast('삭제 오류: '+(e.message||e),'d'); }
}
window.goodsShipDelete=goodsShipDelete;
