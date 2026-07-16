// ============================================================
// 외포장 서브탭 — 출고 대기 현황(재고) + 출고 이력
//   goodsLot  : 재고 입고 로트 {product, dateType:'제조'|'소비', date, ea, note}
//   goodsShip : 출고 기록      {product, lotDate, dateType, date(출고일), ea, note}
//   FC 3KG = 제조일자 입력(소비기한=제조일+60일), 나머지 = 소비기한 입력
//   재고 = Σ goodsLot.ea − Σ goodsShip.ea  (제품+로트일자 기준)
// ============================================================

var _shipData = { lots: [], ships: [], outerpacking: [] };
var _opSubTab = 'work';
var _shipLoaded = false;
var _shipHistYm = null;   // 출고 이력에서 보고 있는 월 (YYYY-MM), null이면 이번 달
var FC3KG = 'FC 장조림 3KG';
var FC_SHELF_DAYS = 60;       // FC 3KG 소비기한
var DEFAULT_SHELF_DAYS = 365; // 나머지 전 제품 소비기한 (생산일 + 1년)
var SHELF_DAYS = {};          // 제품별 override (필요시 {제품명:일수})
function _shelfDays(prod){ if(SHELF_DAYS[prod]!=null) return SHELF_DAYS[prod]; return prod===FC3KG ? FC_SHELF_DAYS : DEFAULT_SHELF_DAYS; }
// 소비기한 = 생산일 포함 만 N일 → 생산일 + (N-1)  (예: 07-03 생산, 365일 → 07-02)
function _expiryOf(prodDate, prod){ return _plusDays(prodDate, _shelfDays(prod) - 1); }

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
  var from='2026-01-01', to=_plusDays(_shipToday(), 365); // 미래 출고일(예약 출고)까지 로드 — to=오늘이면 미래 출고가 안 잡혀 이력·재고 반영 누락
  try {
    var R = await Promise.all([
      fbGetRange('goodsLot', from, to).catch(function(){return [];}),
      fbGetRange('goodsShip', from, to).catch(function(){return [];}),
      fbGetRange('outerpacking', from, to).catch(function(){return [];})
    ]);
    _shipData.lots = R[0]||[];
    _shipData.ships = R[1]||[];
    _shipData.outerpacking = R[2]||[];
    _shipLoaded = true;
    _renderShipViews();
  } catch(e){ console.error('출고/재고 로드 오류', e); }
}
window.loadShipment = loadShipment;

// 외포장 완료 EA (박스×입수 + 잔량)
function _opEaOf(op){ if(typeof opEa==='function') return opEa(op); return (parseInt(op.outerEa,10)||0)+(parseInt(op.remainEa,10)||0); }

// 통합 로트: 자동(외포장 완료) + 수동(goodsLot) → 제품+소비기한 단위로 합산
//   반환: [{product, expiry, prodDate, inEa, autoEa, manualEa}]  (소비기한 임박순 아님)
function _aggregateLots(){
  var map={}; // key: product|expiry
  function _add(prod, expiry, prodDate, ea, isAuto){
    var k=prod+'|'+expiry;
    if(!map[k]) map[k]={product:prod, expiry:expiry, prodDate:prodDate||'', inEa:0, autoEa:0, manualEa:0};
    map[k].inEa+=ea; if(isAuto) map[k].autoEa+=ea; else map[k].manualEa+=ea;
    if(prodDate && (!map[k].prodDate || prodDate<map[k].prodDate)) map[k].prodDate=prodDate;
    return map[k];
  }
  // 자동 — 외포장 완료분 중 stockReg 플래그 있는 것만 (과거 완료분 제외, 완료 시점부터 등록)
  (_shipData.outerpacking||[]).forEach(function(op){
    if(!op || op._timeOnly || !op.product || !op.stockReg) return;
    var d=String(op.date||'').slice(0,10); if(!d) return;
    var ea=_opEaOf(op); if(ea<=0) return;
    _add(op.product, _expiryOf(d, op.product), d, ea, true);
  });
  // 수동 — goodsLot
  (_shipData.lots||[]).forEach(function(l){
    if(!l.product) return; var d=String(l.date||'').slice(0,10); if(!d) return;
    var ea=parseInt(l.ea,10)||0; if(ea<=0) return;
    var expiry = (l.dateType==='제조') ? _expiryOf(d, l.product) : d; // 수동 non-FC는 date가 곧 소비기한
    var prodDate = (l.dateType==='제조') ? d : '';
    _add(l.product, expiry, prodDate, ea, false);
  });
  return Object.keys(map).map(function(k){ return map[k]; });
}

async function loadShipment_removed(){}

function _shippedFor(prod, lotDate){
  return _shipData.ships.filter(function(s){ return s.product===prod && String(s.lotDate)===String(lotDate); })
    .reduce(function(a,s){ return a + (parseInt(s.ea,10)||0); }, 0);
}

// 로트별 출고를 오늘까지(done=재고 차감분)와 미래 출고 예약(pending=출고 대기)으로 분리
function _shippedSplit(prod, lotDate){
  var today=_shipToday(), done=0, pending=0;
  _shipData.ships.forEach(function(s){
    if(s.product!==prod || String(s.lotDate)!==String(lotDate)) return;
    var ea=parseInt(s.ea,10)||0;
    if(String(s.date).slice(0,10) > today) pending+=ea; else done+=ea;
  });
  return {done:done, pending:pending};
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
  el.textContent = (prod===FC3KG && d) ? ('→ 소비기한 '+_expiryOf(d, prod)+' (제조일 포함 '+FC_SHELF_DAYS+'일)') : '';
}
window._glOnProd=_glOnProd;

// ── 재고 현황 뷰 ──
function _renderStockView(){
  var host=document.getElementById('op_view_stock'); if(!host) return;
  var lots=_aggregateLots();
  // 제품별 총재고 (남은 = 입고 − 오늘까지 출고 · 미래 출고는 출고 예정으로 별도)
  var byProd={}, byPend={}, byExp={};
  lots.forEach(function(lt){
    var sp=_shippedSplit(lt.product, lt.expiry);
    var r=lt.inEa-sp.done;
    byProd[lt.product]=(byProd[lt.product]||0)+r;
    byPend[lt.product]=(byPend[lt.product]||0)+sp.pending;
    if(r>0 || sp.pending>0){ if(!byExp[lt.product] || lt.expiry<byExp[lt.product]) byExp[lt.product]=lt.expiry; }
  });
  var prodOrder=_shipProducts().filter(function(p){ return byProd[p]!==undefined; });
  Object.keys(byProd).forEach(function(p){ if(prodOrder.indexOf(p)<0) prodOrder.push(p); });
  // 재고 있거나 출고 예정 있는 품목만 카드로 · 소진 품목은 하단에 접기
  var liveProds=[], soldOut=[], pendCnt=0, urgentCnt=0;
  prodOrder.forEach(function(p){
    if((byProd[p]||0)>0 || (byPend[p]||0)>0){ liveProds.push(p); if((byPend[p]||0)>0) pendCnt++; var dd=_dday(byExp[p]); if(dd!=null && dd<=30) urgentCnt++; }
    else soldOut.push(p);
  });
  var cardGrid=liveProds.map(function(p){
    var rem=byProd[p], pend=byPend[p]||0, pb=_perBoxOf(p), boxes=pb>0?Math.floor(rem/pb):0;
    var dd=_dday(byExp[p]), urgent=(dd!=null && dd<=30);
    var bar = urgent ? '#E24B4A' : (pend>0 ? '#EF9F27' : '#1D9E75');
    var badges='';
    if(urgent) badges+='<span style="font-size:10px;color:#A32D2D;background:#FCEBEB;padding:2px 7px;border-radius:20px">D-'+dd+'</span>';
    if(pend>0) badges+='<span style="font-size:10px;color:#BA7517;background:#FAEEDA;padding:2px 7px;border-radius:20px">🚚 출고 예정 '+pend.toLocaleString()+' EA</span>';
    if(!urgent && !pend && pb>0) badges+='<span style="font-size:10px;color:#9ca3af;background:#f8fafc;padding:2px 7px;border-radius:20px">약 '+boxes.toLocaleString()+'박스</span>';
    return '<div style="background:#fff;border:0.5px solid #e5e7eb;border-left:3px solid '+bar+';border-radius:0 10px 10px 0;padding:12px 14px">'
      + '<div style="font-size:12px;color:#6b7280;height:32px;line-height:1.35;overflow:hidden">'+p+'</div>'
      + '<div style="display:flex;align-items:baseline;gap:5px;margin-top:4px"><span style="font-size:22px;font-weight:600;color:'+(rem<=0?'#dc2626':'#0f172a')+'">'+rem.toLocaleString()+'</span><span style="font-size:11px;color:#9ca3af">EA</span></div>'
      + (badges?'<div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap">'+badges+'</div>':'')
      + '</div>';
  }).join('');
  var summaryBar='<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:0 2px">'
    + '<div style="font-size:13px;color:#6b7280">재고 있는 품목 <b style="color:#0f172a">'+liveProds.length+'</b></div>'
    + '<div style="display:flex;gap:8px;font-size:12px">'
    + (pendCnt>0?'<span style="color:#BA7517;background:#FAEEDA;padding:3px 10px;border-radius:20px">🚚 출고 예정 '+pendCnt+'건</span>':'')
    + (urgentCnt>0?'<span style="color:#A32D2D;background:#FCEBEB;padding:3px 10px;border-radius:20px">⚠ 임박 '+urgentCnt+'건</span>':'')
    + '</div></div>';
  var cards = liveProds.length
    ? summaryBar + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:14px">'+cardGrid+'</div>'
      + (soldOut.length?'<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#f8fafc;border-radius:10px;margin-bottom:14px"><span style="font-size:14px">✅</span><span style="font-size:12px;color:#6b7280"><span style="color:#9ca3af">재고 소진 '+soldOut.length+'종 —</span> '+soldOut.join(' · ')+'</span></div>':'')
    : '';
  // 로트 표 (제품별 그룹, 소비기한 임박순). 다 나간 로트(재고0·대기0)는 기본 숨김.
  lots.sort(function(a,b){ if(a.product!==b.product) return a.product<b.product?-1:1; return a.expiry<b.expiry?-1:1; });
  function _lotRow(lt){
    var sp=_shippedSplit(lt.product, lt.expiry), out=sp.done, rem=lt.inEa-out, pend=sp.pending;
    var src = lt.autoEa>0 && lt.manualEa>0 ? '외포장+수동' : (lt.autoEa>0 ? '외포장' : '수동');
    var srcColor = lt.manualEa>0 && lt.autoEa===0 ? '#7c3aed' : '#0e7490';
    var lotCell = '<span style="font-family:monospace;color:#374151">'+(lt.prodDate||'-')+'</span> <span style="font-size:11px;color:#9ca3af">생산</span>'
      + ' <span style="font-size:10px;color:'+srcColor+';background:#f1f5f9;padding:1px 5px;border-radius:4px;margin-left:4px">'+src+'</span>';
    return '<tr style="border-top:0.5px solid #f3f4f6">'
      + '<td style="padding:10px 14px">'+lotCell+'</td>'
      + '<td style="padding:10px 8px;text-align:center;font-size:12px"><span style="font-family:monospace">'+lt.expiry+'</span>'+_ddayBadge(lt.expiry)+'</td>'
      + '<td style="padding:10px 8px;text-align:right;color:#6b7280">'+lt.inEa.toLocaleString()+'</td>'
      + '<td style="padding:10px 8px;text-align:right;color:'+(out>0?'#dc2626':'#9ca3af')+'">'+out.toLocaleString()+'</td>'
      + '<td style="padding:10px 8px;text-align:right;font-weight:700;color:'+(rem<=0?'#dc2626':'#0f172a')+'">'+rem.toLocaleString()
        + (pend>0?'<div style="font-size:11px;color:#d97706;font-weight:600;margin-top:2px">🚚 출고 예정 '+pend.toLocaleString()+' EA</div>':'')+'</td>'
      + '<td style="padding:8px 14px;text-align:center"><button onclick="_shipQuick(\''+lt.product.replace(/'/g,"\\'")+'\',\''+lt.expiry+'\')" style="padding:5px 12px;background:#fff;border:1px solid #d1d5db;border-radius:5px;font-size:12px;cursor:pointer">🚚 출고</button></td>'
      + '</tr>';
  }
  function _lotRowsGrouped(arr){
    var r='', cur=null;
    arr.forEach(function(lt){
      if(lt.product!==cur){ cur=lt.product;
        r += '<tr style="background:#eff6ff"><td colspan="6" style="padding:7px 14px;font-weight:600;color:#1d4ed8;font-size:12px">'+lt.product+'</td></tr>';
      }
      r += _lotRow(lt);
    });
    return r;
  }
  // 재고 남았거나 출고 대기 있으면 active, 둘 다 없으면 완료(숨김)
  var activeLots=[], doneLots=[];
  lots.forEach(function(lt){
    var sp=_shippedSplit(lt.product, lt.expiry);
    if((lt.inEa-sp.done)>0 || sp.pending>0) activeLots.push(lt); else doneLots.push(lt);
  });
  var rows = _lotRowsGrouped(activeLots);
  if(!rows) rows='<tr><td colspan="6" style="padding:16px;text-align:center;color:#9ca3af;font-size:13px">재고 없음 — 외포장을 완료하거나 아래에서 수동 등록하세요</td></tr>';
  var doneSection='';
  if(doneLots.length){
    doneSection = '<tbody><tr style="background:#fafafa;cursor:pointer;border-top:0.5px solid #e5e7eb" onclick="_toggleDoneLots()"><td colspan="6" style="padding:9px 14px;text-align:center;color:#6b7280;font-size:12px"><span id="op_donelot_label">✅ 출고 완료 로트 '+doneLots.length+'개 보기 ▾</span></td></tr></tbody>'
      + '<tbody id="op_donelot_body" style="display:none">'+_lotRowsGrouped(doneLots)+'</tbody>';
  }
  var table='<div style="background:#fff;border:0.5px solid #e5e7eb;border-radius:12px;overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<thead><tr style="background:#f9fafb">'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">로트(생산일)</th>'
    + '<th style="padding:9px 8px;text-align:center;color:#475569;font-weight:600">소비기한</th>'
    + '<th style="padding:9px 8px;text-align:right;color:#475569;font-weight:600">입고 (EA)</th>'
    + '<th style="padding:9px 8px;text-align:right;color:#475569;font-weight:600">출고 (EA)</th>'
    + '<th style="padding:9px 8px;text-align:right;color:#0f172a;font-weight:600">남은 재고 (EA)</th>'
    + '<th style="padding:9px 14px;text-align:center;color:#475569;font-weight:600"></th>'
    + '</tr></thead><tbody>'+rows+'</tbody>'+doneSection+'</table></div></div>';
  host.innerHTML = cards
    + '<div style="font-size:12px;color:#9ca3af;margin:0 2px 14px">외포장 완료분은 <b style="color:#0e7490">외포장</b> 태그로 자동 표시 · 소비기한 = 생산일 + (FC 3KG 60일 / 나머지 365일)</div>'
    + '<div style="font-size:15px;font-weight:700;color:#0f172a;margin:4px 2px 10px">📦 로트별 재고</div>'
    + table
    + '<div style="font-size:15px;font-weight:700;color:#0f172a;margin:18px 2px 10px">➕ 재고 수동 등록 (보정·특이사항용)</div>'
    + _stockAddForm()
    + '<div style="font-size:12px;color:#9ca3af;margin-top:4px;padding:0 2px">남은 재고 = 입고 − 오늘까지 출고 · <span style="color:#d97706">🚚 출고 예정</span> = 미래 출고일 예약분(아직 재고에서 안 뺌) · 임박 로트 색 표시</div>';
  setTimeout(function(){ _glOnProd(); var de=document.getElementById('gl_date'); if(de) de.addEventListener('change', _glExpHint); }, 0);
}

// 출고 완료 로트(재고0·대기0) 펼치기/접기
function _toggleDoneLots(){
  var b=document.getElementById('op_donelot_body'); if(!b) return;
  var lbl=document.getElementById('op_donelot_label');
  var open=b.style.display!=='none';
  b.style.display=open?'none':'';
  if(lbl) lbl.textContent = open ? lbl.textContent.replace('숨기기 ▴','보기 ▾') : lbl.textContent.replace('보기 ▾','숨기기 ▴');
}
window._toggleDoneLots=_toggleDoneLots;

// ── 출고 이력 뷰 ──
function _renderShipView(){
  var host=document.getElementById('op_view_ship'); if(!host) return;
  var prods=_shipProducts();
  var prodOpts=prods.map(function(p){ return '<option value="'+p.replace(/"/g,'&quot;')+'">'+p+'</option>'; }).join('');
  var form='<div style="background:#fef3c7;border:1px dashed #f59e0b;border-radius:8px;padding:14px;margin-bottom:16px">'
    + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">출고일</label><input type="date" id="gs_date" value="'+_shipToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
      + '<div style="min-width:180px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">제품</label><select id="gs_prod" onchange="_gsFillLots();_gsCalcEa()" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%">'+prodOpts+'</select></div>'
      + '<div style="min-width:200px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">로트(소비기한)</label><select id="gs_lot" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></select></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">박스</label><input type="number" id="gs_box" min="0" oninput="_gsCalcEa()" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:80px;text-align:right"></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">수량(EA)</label><input type="number" id="gs_ea" min="1" oninput="_gsCalcBox()" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100px;text-align:right"></div>'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">파레트</label><input type="number" id="gs_pallet" min="0" step="0.5" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:75px;text-align:right"></div>'
      + '<div style="flex:1;min-width:110px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="gs_note" placeholder="거래처 등" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
      + '<button onclick="goodsShipAdd()" style="padding:8px 16px;background:#d97706;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">출고 추가</button>'
      + '<button onclick="_gsAddRemnRow()" style="padding:8px 14px;background:#fff;border:1px solid #d97706;color:#d97706;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">➕ 잔량</button>'
      + '<button onclick="_gsAddSmplRow()" style="padding:8px 14px;background:#fff;border:1px solid #6d28d9;color:#6d28d9;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">➕ 샘플</button>'
    + '</div>'
    + '<div id="gs2_wrap" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed #f59e0b">'
      + '<div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:8px">잔량 출고 — 완박스 아닌 낱개 박스 (수량에 포함 · 출고서에 잔량으로 표시) · [➕ 잔량]으로 여러 개 추가</div>'
      + '<div id="gs2_rows"></div>'
    + '</div>'
    + '<div id="gs3_wrap" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed #a78bfa">'
      + '<div style="font-size:12px;font-weight:700;color:#5b21b6;margin-bottom:8px">샘플 출고 — 샘플로 나가는 물량 (수량에 포함 · 출고서에 샘플로 표시) · [➕ 샘플]로 여러 개 추가</div>'
      + '<div id="gs3_rows"></div>'
    + '</div>'
    + '<div style="font-size:11px;color:#9ca3af;margin-top:8px">박스 ↔ EA 자동 계산(입수 기준) · 둘 중 하나만 입력하면 나머지 자동 · 파레트는 직접 입력</div></div>';
  // 출고서 복사
  var copyBox='<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;margin-bottom:16px">'
    + '<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:10px">'
      + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">출고서 날짜</label><input type="date" id="gs_copy_date" value="'+_shipToday()+'" onchange="_shipCopy()" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
      + '<button onclick="_shipCopy()" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">📋 출고서 생성</button>'
      + '<button onclick="_shipCopyClip()" style="padding:8px 16px;background:#fff;border:1px solid #2563eb;color:#2563eb;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">복사하기</button>'
    + '</div>'
    + '<textarea id="gs_copy_out" readonly style="width:100%;min-height:130px;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:monospace;line-height:1.6;background:#fff;resize:vertical" placeholder="날짜 선택 후 [출고서 생성] → 메신저에 붙여넣기"></textarea>'
    + '</div>';
  host.innerHTML = '<div style="font-size:15px;font-weight:700;color:#0f172a;margin:4px 2px 10px">🚚 출고 등록 (오늘 나갈 것 여러 개 추가)</div>'
    + form
    + '<div style="font-size:15px;font-weight:700;color:#0f172a;margin:4px 2px 10px">📋 출고서 복사 (메신저용)</div>'
    + copyBox
    + '<div id="op_shiphist_wrap">'+_shipHistTable()+'</div>';
  setTimeout(function(){ _gsFillLots(); _gsCalcEa(); }, 0);
}

// 출고 목록 — 선택한 월(_shipHistYm)만 표시. 월 선택 드롭다운 + 월 합계 포함.
function _shipHistTable(){
  var curYm=_shipToday().slice(0,7);
  var ymSet={}; ymSet[curYm]=true;   // 이번 달은 데이터 없어도 선택지에 포함
  _shipData.ships.forEach(function(s){ var ym=String(s.date||'').slice(0,7); if(ym) ymSet[ym]=true; });
  var ymList=Object.keys(ymSet).sort().reverse();
  if(!_shipHistYm || !ymSet[_shipHistYm]) _shipHistYm=ymList[0];
  var _ymLabel=function(ym){ var p=ym.split('-'); return p[0]+'년 '+parseInt(p[1],10)+'월'; };
  var ymOpts=ymList.map(function(ym){ return '<option value="'+ym+'"'+(ym===_shipHistYm?' selected':'')+'>'+_ymLabel(ym)+'</option>'; }).join('');
  var monthShips=_shipData.ships.filter(function(s){ return String(s.date||'').slice(0,7)===_shipHistYm; })
    .sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
  var sumBox=0,sumEa=0,sumPal=0;
  monthShips.forEach(function(s){ sumBox+=parseInt(s.boxes,10)||0; sumEa+=parseInt(s.ea,10)||0; sumPal+=parseFloat(s.pallets)||0; });
  var rows=monthShips.map(function(s){
    var fb=s.fbId||s.id||''; var box=parseInt(s.boxes,10)||0; var pal=parseFloat(s.pallets)||0;
    var isFuture = String(s.date||'').slice(0,10) > _shipToday();
    var dateCell = (s.date||'-') + (isFuture ? ' <span style="font-size:10px;color:#d97706;background:#fff7ed;border:0.5px solid #fdba74;padding:1px 6px;border-radius:20px;font-weight:600;font-family:sans-serif">예정</span>' : '');
    return '<tr style="border-top:0.5px solid #f3f4f6'+(isFuture?';background:#fffbf5':'')+'">'
      + '<td style="padding:9px 14px;font-weight:600;font-family:monospace">'+dateCell+'</td>'
      + '<td style="padding:9px 14px">'+(s.product||'-')+(s.remn?' <span style="font-size:10px;color:#92400e;background:#fef3c7;border:0.5px solid #fcd34d;padding:1px 6px;border-radius:20px;font-weight:600">잔량</span>':'')+(s.smpl?' <span style="font-size:10px;color:#5b21b6;background:#ede9fe;border:0.5px solid #c4b5fd;padding:1px 6px;border-radius:20px;font-weight:600">샘플</span>':'')+'</td>'
      + '<td style="padding:9px 14px;font-family:monospace;color:#6b7280">'+(s.lotDate||'-')+'</td>'
      + '<td style="padding:9px 10px;text-align:right">'+(box?box.toLocaleString():'-')+'</td>'
      + '<td style="padding:9px 10px;text-align:right;font-weight:600">'+(parseInt(s.ea,10)||0).toLocaleString()+'</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#6b7280">'+(pal||'-')+'</td>'
      + '<td style="padding:9px 14px;color:#6b7280'+(fb?';cursor:pointer':'')+'"'+(fb?' onclick="goodsShipEditNote(\''+fb+'\')" title="클릭해서 메모 수정"':'')+'>'+(s.note||'-')+'</td>'
      + '<td style="padding:9px 14px;text-align:center;white-space:nowrap">'+(fb?'<button onclick="goodsShipDelete(\''+fb+'\')" style="padding:4px 10px;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer">삭제</button>':'-')+'</td>'
      + '</tr>';
  }).join('');
  if(!rows) rows='<tr><td colspan="8" style="padding:16px;text-align:center;color:#9ca3af;font-size:13px">'+_ymLabel(_shipHistYm)+' 출고 기록 없음</td></tr>';
  var foot = monthShips.length ? '<tfoot><tr style="background:#f9fafb;border-top:1.5px solid #e5e7eb;font-weight:700">'
      + '<td colspan="3" style="padding:9px 14px;color:#0f172a">'+_ymLabel(_shipHistYm)+' 합계</td>'
      + '<td style="padding:9px 10px;text-align:right">'+sumBox.toLocaleString()+'</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#d97706">'+sumEa.toLocaleString()+'</td>'
      + '<td style="padding:9px 10px;text-align:right;color:#6b7280">'+(sumPal?(Math.round(sumPal*10)/10):'-')+'</td>'
      + '<td colspan="2"></td></tr></tfoot>' : '';
  var header='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 2px 10px">'
    + '<span style="font-size:15px;font-weight:700;color:#0f172a">📄 출고 목록</span>'
    + '<select onchange="_shipHistSel(this.value)" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;font-weight:600;color:#0f172a;cursor:pointer">'+ymOpts+'</select>'
    + '<span style="margin-left:auto;font-size:12px;color:#6b7280">'+monthShips.length+'건</span>'
    + '</div>';
  var table='<div style="background:#fff;border:0.5px solid #e5e7eb;border-radius:12px;overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<thead><tr style="background:#f9fafb">'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">출고일</th>'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">제품</th>'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">소비기한</th>'
    + '<th style="padding:9px 10px;text-align:right;color:#475569;font-weight:600">박스</th>'
    + '<th style="padding:9px 10px;text-align:right;color:#475569;font-weight:600">EA</th>'
    + '<th style="padding:9px 10px;text-align:right;color:#475569;font-weight:600">파레트</th>'
    + '<th style="padding:9px 14px;text-align:left;color:#475569;font-weight:600">메모</th>'
    + '<th style="padding:9px 14px;text-align:center;color:#475569;font-weight:600">관리</th>'
    + '</tr></thead><tbody>'+rows+'</tbody>'+foot+'</table></div></div>';
  return header+table;
}

// 월 선택 → 목록만 다시 그림 (출고 입력 폼은 건드리지 않음)
function _shipHistSel(ym){
  _shipHistYm=ym;
  var w=document.getElementById('op_shiphist_wrap');
  if(w) w.innerHTML=_shipHistTable();
}
window._shipHistSel=_shipHistSel;

// 박스 → EA 자동환산 (입수 기준)
function _gsCalcEaX(pfx){
  var prod=(document.getElementById(pfx+'_prod')||{}).value;
  var pb=_perBoxOf(prod);
  var box=parseInt((document.getElementById(pfx+'_box')||{}).value,10)||0;
  var eaEl=document.getElementById(pfx+'_ea');
  if(eaEl && pb>0 && box>0) eaEl.value = box*pb;
}
function _gsCalcEa(){ _gsCalcEaX('gs'); }
function _gsCalcEa2(){ _gsCalcEaX('gs2'); }
window._gsCalcEaX=_gsCalcEaX;
window._gsCalcEa=_gsCalcEa;
window._gsCalcEa2=_gsCalcEa2;

// EA 입력 → 박스 자동 계산 (올림 = 낱개 있으면 박스 하나 더, 입수 기준)
function _gsCalcBoxX(pfx){
  var prod=(document.getElementById(pfx+'_prod')||{}).value;
  var pb=_perBoxOf(prod);
  var ea=parseInt((document.getElementById(pfx+'_ea')||{}).value,10)||0;
  var boxEl=document.getElementById(pfx+'_box');
  if(boxEl && pb>0 && ea>0) boxEl.value = Math.ceil(ea/pb);
}
function _gsCalcBox(){ _gsCalcBoxX('gs'); }
function _gsCalcBox2(){ _gsCalcBoxX('gs2'); }
window._gsCalcBoxX=_gsCalcBoxX;
window._gsCalcBox=_gsCalcBox;
window._gsCalcBox2=_gsCalcBox2;

function _fmtYY(ds){ var p=String(ds||'').split('-'); if(p.length<3) return ds; return p[0].slice(2)+'.'+p[1]+'.'+p[2]; }

// 출고서 텍스트 생성 (제품 → 소비기한별 묶음)
function _shipCopyText(dateStr){
  var ships=_shipData.ships.filter(function(s){ return String(s.date).slice(0,10)===dateStr; });
  if(!ships.length) return '('+dateStr+' 출고 항목 없음)';
  var byProd={};
  ships.forEach(function(s){
    var p=s.product||'(제품없음)';
    if(!byProd[p]) byProd[p]={lots:{}, box:0, ea:0, pallet:0};
    var ld=s.lotDate||'-';
    if(!byProd[p].lots[ld]) byProd[p].lots[ld]={box:0,ea:0,rbox:0,rea:0,sbox:0,sea:0};
    var box=parseInt(s.boxes,10)||0, ea=parseInt(s.ea,10)||0, pal=parseFloat(s.pallets)||0;
    if(s.remn){ byProd[p].lots[ld].rbox+=box; byProd[p].lots[ld].rea+=ea; }
    else if(s.smpl){ byProd[p].lots[ld].sbox+=box; byProd[p].lots[ld].sea+=ea; }
    else { byProd[p].lots[ld].box+=box; byProd[p].lots[ld].ea+=ea; }
    // 소계·총합은 실제 출고분(완박스+잔량)만 — 샘플은 무상이라 합계 제외 (재고에선 별도로 차감됨)
    if(!s.smpl){ byProd[p].box+=box; byProd[p].ea+=ea; byProd[p].pallet+=pal; }
  });
  var lines=['📦 출고서 '+dateStr, ''];
  var tBox=0,tEa=0,tPal=0;
  Object.keys(byProd).forEach(function(p){
    var g=byProd[p]; lines.push('■ '+p);
    Object.keys(g.lots).sort().forEach(function(ld){
      var l=g.lots[ld];
      // FC 3KG는 소비기한이 짧아 제조일 병기 (제조일 = 소비기한 - (60-1)일)
      var mfg = (p===FC3KG) ? ' (제조 '+_fmtYY(_plusDays(ld, -(FC_SHELF_DAYS-1)))+')' : '';
      if(l.box||l.ea) lines.push('  · 소비기한 '+_fmtYY(ld)+mfg+' — '+l.box.toLocaleString()+'박스 · '+l.ea.toLocaleString()+'ea');
      if(l.rbox||l.rea) lines.push('  · 소비기한 '+_fmtYY(ld)+mfg+' 잔량 — '+l.rbox.toLocaleString()+'박스 · '+l.rea.toLocaleString()+'ea');
      if(l.sbox||l.sea) lines.push('  · 소비기한 '+_fmtYY(ld)+mfg+' 샘플 — '+l.sbox.toLocaleString()+'박스 · '+l.sea.toLocaleString()+'ea (합계 미포함)');
    });
    lines.push('  ▶ 소계 '+g.box.toLocaleString()+'박스 · '+g.ea.toLocaleString()+'ea'+(g.pallet?' · '+(Math.round(g.pallet*10)/10)+'파레트':''));
    lines.push('');
    tBox+=g.box; tEa+=g.ea; tPal+=g.pallet;
  });
  lines.push('━━━━━━━━━━━━');
  lines.push('총 '+tBox.toLocaleString()+'박스 · '+tEa.toLocaleString()+'ea'+(tPal?' · '+(Math.round(tPal*10)/10)+'파레트':''));
  return lines.join('\n');
}
function _shipCopy(){
  var d=(document.getElementById('gs_copy_date')||{}).value||_shipToday();
  var out=document.getElementById('gs_copy_out'); if(out) out.value=_shipCopyText(d);
}
window._shipCopy=_shipCopy;
function _shipCopyClip(){
  var out=document.getElementById('gs_copy_out'); if(!out||!out.value){ _shipCopy(); }
  if(!out||!out.value) return;
  out.select();
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(out.value).then(function(){ toast&&toast('✓ 복사됨','s'); }).catch(function(){ document.execCommand('copy'); toast&&toast('✓ 복사됨','s'); }); }
    else { document.execCommand('copy'); toast&&toast('✓ 복사됨','s'); }
  }catch(e){ toast&&toast('복사 실패 — 길게 눌러 복사하세요','d'); }
}
window._shipCopyClip=_shipCopyClip;

// 선택 제품의 남은 재고 있는 로트만 드롭다운
function _gsFillLotsX(pfx){
  var prod=(document.getElementById(pfx+'_prod')||{}).value;
  var sel=document.getElementById(pfx+'_lot'); if(!sel) return;
  var lots=_aggregateLots().filter(function(lt){ return lt.product===prod; })
    .map(function(lt){ lt.rem=lt.inEa-_shippedFor(prod, lt.expiry); return lt; })
    .filter(function(lt){ return lt.rem>0; })
    .sort(function(a,b){ return a.expiry<b.expiry?-1:1; });
  sel.innerHTML = lots.length ? lots.map(function(lt){
    return '<option value="'+lt.expiry+'">소비기한 '+lt.expiry+(lt.prodDate?' (생산 '+lt.prodDate+')':'')+' · 남은 '+lt.rem.toLocaleString()+'</option>';
  }).join('') : '<option value="">재고 있는 로트 없음</option>';
}
function _gsFillLots(){ _gsFillLotsX('gs'); }
function _gsFillLots2(){ _gsFillLotsX('gs2'); }
window._gsFillLotsX=_gsFillLotsX;
window._gsFillLots=_gsFillLots;
window._gsFillLots2=_gsFillLots2;

// 재고 표에서 [출고] 클릭 → 출고 탭으로 이동 + 그 로트 선택
function _shipQuick(prod, date){ /* date=소비기한(expiry) */
  opSwitchTab('ship');
  setTimeout(function(){
    var ps=document.getElementById('gs_prod'); if(ps){ ps.value=prod; _gsFillLots(); }
    var ls=document.getElementById('gs_lot');
    if(ls){ for(var i=0;i<ls.options.length;i++){ if(ls.options[i].value===date){ ls.selectedIndex=i; break; } } }
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

async function _goodsShipAddX(pfx, isRemn, isSmpl){
  var date=(document.getElementById(pfx+'_date')||{}).value;
  var prod=(document.getElementById(pfx+'_prod')||{}).value;
  var lotv=(document.getElementById(pfx+'_lot')||{}).value;
  var box=parseInt((document.getElementById(pfx+'_box')||{}).value,10)||0;
  var ea=parseInt((document.getElementById(pfx+'_ea')||{}).value,10);
  var pallet=parseFloat((document.getElementById(pfx+'_pallet')||{}).value)||0;
  var note=String((document.getElementById(pfx+'_note')||{}).value||'').trim();
  if(!date){ toast&&toast('출고일','d'); return; }
  if(!prod){ toast&&toast('제품','d'); return; }
  if(!lotv){ toast&&toast('출고할 로트 선택','d'); return; }
  if(!ea||ea<=0){ toast&&toast('수량','d'); return; }
  var lotDate=lotv; // = 소비기한(expiry)
  var agg=_aggregateLots().filter(function(lt){return lt.product===prod && lt.expiry===lotDate;})[0];
  var inEa=agg?agg.inEa:0;
  var rem=inEa-_shippedFor(prod,lotDate);
  if(ea>rem){ toast&&toast('남은 재고('+rem.toLocaleString()+') 초과','d'); return; }
  var rec={ id:(typeof gid==='function')?gid():('gs_'+Date.now()), product:prod, lotDate:lotDate, date:date, boxes:box, ea:ea, pallets:pallet, note:note };
  if(isRemn) rec.remn=true;
  if(isSmpl){ rec.smpl=true; rec.note = '샘플 '+ea.toLocaleString()+'ea' + (note?' / '+note:''); }
  var kindLbl = isRemn?' 잔량':(isSmpl?' 샘플':'');
  toast&&toast('저장 중...','i');
  try{ var fbId=await fbSave('goodsShip', rec);
    if(fbId){ rec.fbId=fbId; _shipData.ships.push(rec); toast&&toast('✓ '+prod+kindLbl+' '+ea.toLocaleString()+'EA 출고','s');
      if(isRemn && pfx.indexOf('gs2_')===0){ _gsRemoveRemnRow(pfx); }        // 등록한 잔량 줄만 제거
      else if(isSmpl && pfx.indexOf('gs3_')===0){ _gsRemoveSmplRow(pfx); }   // 등록한 샘플 줄만 제거
      else { [pfx+'_box',pfx+'_ea',pfx+'_pallet',pfx+'_note'].forEach(function(id){var el=document.getElementById(id); if(el)el.value='';}); }
      // 폼(입력 중인 잔량 줄 포함)은 유지하고 재고·목록만 갱신
      _renderStockView();
      var _hw=document.getElementById('op_shiphist_wrap'); if(_hw) _hw.innerHTML=_shipHistTable();
    } else toast&&toast('저장 실패','d');
  }catch(e){ console.error(e); toast&&toast('오류: '+(e.message||e),'d'); }
}
async function goodsShipAdd(){ return _goodsShipAddX('gs', false, false); }
window._goodsShipAddX=_goodsShipAddX;

// 샘플 줄 동적 추가 — [➕ 샘플] 누를 때마다 새 입력줄 생성
var _gs3Seq=0;
function _gsAddSmplRow(){
  var wrap=document.getElementById('gs3_wrap'), rows=document.getElementById('gs3_rows');
  if(!wrap||!rows) return;
  wrap.style.display='';
  var pfx='gs3_'+(_gs3Seq++);
  var prodOpts=_shipProducts().map(function(p){ return '<option value="'+p.replace(/"/g,'&quot;')+'">'+p+'</option>'; }).join('');
  var div=document.createElement('div');
  div.id=pfx+'_line';
  div.style.cssText='display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:8px';
  div.innerHTML=''
    + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">출고일</label><input type="date" id="'+pfx+'_date" value="'+_shipToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
    + '<div style="min-width:180px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">제품</label><select id="'+pfx+'_prod" onchange="_gsFillLotsX(\''+pfx+'\');_gsCalcEaX(\''+pfx+'\')" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%">'+prodOpts+'</select></div>'
    + '<div style="min-width:200px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">로트(소비기한)</label><select id="'+pfx+'_lot" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></select></div>'
    + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">박스</label><input type="number" id="'+pfx+'_box" min="0" oninput="_gsCalcEaX(\''+pfx+'\')" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:80px;text-align:right"></div>'
    + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">수량(EA)</label><input type="number" id="'+pfx+'_ea" min="1" oninput="_gsCalcBoxX(\''+pfx+'\')" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100px;text-align:right"></div>'
    + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">파레트</label><input type="number" id="'+pfx+'_pallet" min="0" step="0.5" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:75px;text-align:right"></div>'
    + '<div style="flex:1;min-width:110px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="'+pfx+'_note" placeholder="거래처 등" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
    + '<button onclick="_goodsShipAddX(\''+pfx+'\',false,true)" style="padding:8px 16px;background:#6d28d9;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">샘플 추가</button>'
    + '<button onclick="_gsRemoveSmplRow(\''+pfx+'\')" title="이 줄 삭제" style="padding:8px 11px;background:#fff;border:1px solid #d1d5db;color:#dc2626;border-radius:5px;font-size:13px;cursor:pointer">✕</button>';
  rows.appendChild(div);
  _gsFillLotsX(pfx);
}
window._gsAddSmplRow=_gsAddSmplRow;
function _gsRemoveSmplRow(pfx){
  var line=document.getElementById(pfx+'_line'); if(line) line.remove();
  var rows=document.getElementById('gs3_rows'), wrap=document.getElementById('gs3_wrap');
  if(rows && wrap && !rows.children.length) wrap.style.display='none';
}
window._gsRemoveSmplRow=_gsRemoveSmplRow;

// 잔량 줄 동적 추가 — [➕ 잔량] 누를 때마다 새 입력줄 생성 (여러 개 등록 가능)
var _gs2Seq=0;
function _gsAddRemnRow(){
  var wrap=document.getElementById('gs2_wrap'), rows=document.getElementById('gs2_rows');
  if(!wrap||!rows) return;
  wrap.style.display='';
  var pfx='gs2_'+(_gs2Seq++);
  var prodOpts=_shipProducts().map(function(p){ return '<option value="'+p.replace(/"/g,'&quot;')+'">'+p+'</option>'; }).join('');
  var div=document.createElement('div');
  div.id=pfx+'_line';
  div.style.cssText='display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:8px';
  div.innerHTML=''
    + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">출고일</label><input type="date" id="'+pfx+'_date" value="'+_shipToday()+'" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px"></div>'
    + '<div style="min-width:180px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">제품</label><select id="'+pfx+'_prod" onchange="_gsFillLotsX(\''+pfx+'\');_gsCalcEaX(\''+pfx+'\')" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%">'+prodOpts+'</select></div>'
    + '<div style="min-width:200px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">로트(소비기한)</label><select id="'+pfx+'_lot" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></select></div>'
    + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">박스</label><input type="number" id="'+pfx+'_box" min="0" oninput="_gsCalcEaX(\''+pfx+'\')" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:80px;text-align:right"></div>'
    + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">수량(EA)</label><input type="number" id="'+pfx+'_ea" min="1" oninput="_gsCalcBoxX(\''+pfx+'\')" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100px;text-align:right"></div>'
    + '<div><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">파레트</label><input type="number" id="'+pfx+'_pallet" min="0" step="0.5" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:75px;text-align:right"></div>'
    + '<div style="flex:1;min-width:110px"><label style="display:block;font-size:11px;color:#6b7280;margin-bottom:4px">메모</label><input type="text" id="'+pfx+'_note" placeholder="거래처 등" style="padding:7px 9px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;width:100%"></div>'
    + '<button onclick="_goodsShipAddX(\''+pfx+'\',true)" style="padding:8px 16px;background:#92400e;color:#fff;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer">잔량 추가</button>'
    + '<button onclick="_gsRemoveRemnRow(\''+pfx+'\')" title="이 줄 삭제" style="padding:8px 11px;background:#fff;border:1px solid #d1d5db;color:#dc2626;border-radius:5px;font-size:13px;cursor:pointer">✕</button>';
  rows.appendChild(div);
  _gsFillLotsX(pfx);
}
window._gsAddRemnRow=_gsAddRemnRow;
function _gsRemoveRemnRow(pfx){
  var line=document.getElementById(pfx+'_line'); if(line) line.remove();
  var rows=document.getElementById('gs2_rows'), wrap=document.getElementById('gs2_wrap');
  if(rows && wrap && !rows.children.length) wrap.style.display='none';
}
window._gsRemoveRemnRow=_gsRemoveRemnRow;
window.goodsShipAdd=goodsShipAdd;

async function goodsShipDelete(fbId){
  if(!fbId) return; if(!confirm('이 출고 기록을 삭제하시겠습니까?')) return;
  try{ await fbDelete('goodsShip', fbId);
    _shipData.ships=_shipData.ships.filter(function(s){ return (s.fbId||s.id)!==fbId; });
    toast&&toast('✓ 삭제됨','s'); _renderShipViews();
  }catch(e){ console.error(e); toast&&toast('삭제 오류: '+(e.message||e),'d'); }
}
window.goodsShipDelete=goodsShipDelete;

// 출고 기록 메모 수정
async function goodsShipEditNote(fbId){
  if(!fbId) return;
  var s=_shipData.ships.filter(function(x){ return (x.fbId||x.id)===fbId; })[0];
  if(!s){ toast&&toast('항목을 찾을 수 없음 — 새로고침','d'); return; }
  var nv=prompt(s.product+' ('+(s.date||'')+') 메모 수정', s.note||'');
  if(nv===null) return;              // 취소
  nv=String(nv).trim();
  if(nv===(s.note||'')) return;       // 변경 없음
  toast&&toast('저장 중...','i');
  try{ var ok=await fbUpdate('goodsShip', fbId, { note:nv });
    if(ok){ s.note=nv; _renderShipViews(); toast&&toast('✓ 메모 수정됨','s'); }
    else toast&&toast('수정 실패','d');
  }catch(e){ console.error(e); toast&&toast('오류: '+(e.message||e),'d'); }
}
window.goodsShipEditNote=goodsShipEditNote;
