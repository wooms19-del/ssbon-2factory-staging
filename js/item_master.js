// ============================================================
// 품목 마스터 조회 (TFT 통합 DB 구조 — ERP 코드 기준)
// item_master / item_recipe / external_key_map 을 읽어 표시.
// 조회 전용. 기존 현장 화면(제품명 기반)에 영향 없음.
// ============================================================
var _imData = { master: [], recipe: {}, map: [] };

async function loadItemMasterView(){
  var btn = document.getElementById('im_load_btn');
  if(btn) btn.textContent = '불러오는 중...';
  try {
    var results = await Promise.all([
      db.collection('item_master').get(),
      db.collection('item_recipe').get(),
      db.collection('external_key_map').get()
    ]);
    _imData.master = results[0].docs.map(function(d){ return d.data(); });
    _imData.recipe = {};
    results[1].docs.forEach(function(d){ _imData.recipe[d.id] = d.data(); });
    _imData.map = results[2].docs.map(function(d){ return d.data(); });
    renderItemMaster();
    if(typeof toast==='function') toast('품목 마스터 '+_imData.master.length+'종 불러옴 ✓','s');
  } catch(e){
    console.error('마스터 로드 오류', e);
    if(typeof toast==='function') toast('마스터 로드 실패','d');
  }
  if(btn) btn.textContent = '🔄 다시 불러오기';
}

function renderItemMaster(){
  var el = document.getElementById('im_view');
  if(!el) return;
  var CATS = ['완제품','반제품','소스','파우치','포장재','원료부자재','공정중간','원육'];
  var byCat = {};
  _imData.master.forEach(function(m){ (byCat[m.category] = byCat[m.category] || []).push(m); });

  var html = '';
  // 웹↔ERP 매핑 요약
  if(_imData.map.length){
    html += '<details style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600;font-size:13px;padding:6px 0">🔗 웹 제품 ↔ ERP 코드 매핑 <span style="color:#9ca3af;font-weight:400">'+_imData.map.length+'종</span></summary>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px">';
    _imData.map.sort(function(a,b){ return (a.webName||'')<(b.webName||'')?-1:1; }).forEach(function(m){
      html += '<tr style="border-top:0.5px solid #eee"><td style="padding:5px 8px;font-weight:600">'+(m.webName||'')+'</td>';
      html += '<td style="padding:5px 8px;font-family:monospace;color:#1d4ed8">'+((m.erpCodes||[]).join(', '))+'</td></tr>';
    });
    html += '</table></details><div style="height:1px;background:#eee;margin:10px 0"></div>';
  }

  CATS.forEach(function(cat){
    var items = (byCat[cat] || []).sort(function(a,b){ return a.code<b.code?-1:1; });
    if(!items.length) return;
    html += '<details style="margin-bottom:8px"><summary style="cursor:pointer;font-weight:600;font-size:13px;padding:6px 0">'+cat+' <span style="color:#9ca3af;font-weight:400">'+items.length+'종</span></summary>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px">';
    html += '<tr style="background:#f8fafc"><th style="text-align:left;padding:5px 8px">코드</th><th style="text-align:left;padding:5px 8px">품목명</th><th style="padding:5px 8px">단위</th><th style="padding:5px 8px">부위</th></tr>';
    items.forEach(function(m){
      var hasR = _imData.recipe[m.code];
      html += '<tr style="border-top:0.5px solid #eee'+(hasR?';cursor:pointer':'')+'"'+(hasR?' onclick="showRecipeDetail(\''+m.code+'\')"':'')+'>';
      html += '<td style="padding:5px 8px;font-family:monospace">'+m.code+(hasR?' <span title="레시피 있음">📋</span>':'')+'</td>';
      html += '<td style="padding:5px 8px">'+m.name+'</td>';
      html += '<td style="padding:5px 8px;text-align:center">'+m.unit+'</td>';
      html += '<td style="padding:5px 8px;text-align:center">'+(m.part||'-')+'</td></tr>';
    });
    html += '</table></details>';
  });
  el.innerHTML = html || '<div style="color:#9ca3af;font-size:13px">데이터 없음</div>';
}

function showRecipeDetail(code){
  var r = _imData.recipe[code];
  if(!r) return;
  var msg = '[' + code + '] ' + r.name + '  (' + r.kind + ')\n\n';
  if(r.kind === '완제품'){
    msg += '◆ 반제품 (내포장 산출물)\n';
    (r.components||[]).forEach(function(x){ msg += '   ' + x.code + '  ' + x.name + '  × ' + x.qty + ' ' + x.unit + '\n'; });
    msg += '\n◆ 외포장재\n';
    (r.outer||[]).forEach(function(x){ msg += '   ' + x.code + '  ' + x.name + '  × ' + x.qty + ' ' + x.unit + '\n'; });
  } else {
    msg += '◆ 내포장 재료\n';
    (r.inner||[]).forEach(function(x){ msg += '   ' + x.code + '  ' + x.name + '  × ' + x.qty + ' ' + x.unit + '\n'; });
  }
  alert(msg);
}

window.loadItemMasterView = loadItemMasterView;
window.showRecipeDetail = showRecipeDetail;
