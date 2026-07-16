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
    await _imLoadCapa();
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

// ============================================================
// 마스터 → 제품 목록 생성 (품목 마스터를 원본으로)
// 기존 L.products 형식(name/kgea/sauce/noMeat/capa)을 마스터에서 생성.
// 화면 14개는 형식 그대로 사용 → 코드 안 바꿔도 마스터 기반이 됨.
// ============================================================
var _imCapa = {};  // 제품별 생산능력 (마스터에 없는 현장값)

async function _imLoadCapa(){
  try {
    var doc = await db.collection('item_config').doc('product_capa').get();
    if(doc.exists){ _imCapa = doc.data().capaMap || {}; }
  } catch(e){ console.error('capa 로드 오류', e); }
}

// 마스터 데이터로 L.products 형식 배열 생성
function buildProductsFromMaster(){
  if(!_imData.map || !_imData.map.length) return [];
  var out = [];
  _imData.map.forEach(function(mp){
    var web = mp.webName, codes = mp.erpCodes || [];
    if(!codes.length) return;
    var fin = _imData.recipe[codes[0]];
    var kgea = 0, sauce = null, hasMeat = false;
    if(fin && fin.components && fin.components.length){
      var ban = _imData.recipe[fin.components[0].code];
      if(ban && ban.inner){
        ban.inner.forEach(function(x){
          if(x.code === '200006' || x.code === '200007' || x.code === '200008'){ kgea = x.qty; hasMeat = true; }
          if(x.code === '200011') sauce = 'FP 장조림 소스';
          if(x.code === '200009') sauce = 'FC 장조림 소스';
        });
      }
    }
    var prod = { name: web, kgea: kgea, sauce: sauce };
    if(!hasMeat) prod.noMeat = true;
    var cp = _imCapa[web];
    if(cp != null && cp !== '') prod.capa = parseFloat(cp) || 0;
    out.push(prod);
  });
  return out;
}

// 검증: 마스터 생성본 vs 기존 L.products (대조표 반환)
function verifyProductsAgainstMaster(){
  var built = buildProductsFromMaster();
  var rows = [];
  built.forEach(function(b){
    var old = (typeof L !== 'undefined' && L.products) ? L.products.find(function(p){ return p.name === b.name; }) : null;
    var kgOk = old ? Math.abs((parseFloat(old.kgea)||0) - (b.kgea||0)) < 0.003 : false;
    rows.push({ name:b.name, exists:!!old,
                kgeaOld: old?old.kgea:null, kgeaNew:b.kgea, kgeaOk:kgOk,
                capaOld: old?old.capa:null, capaNew:b.capa,
                sauceNew:b.sauce, noMeat:!!b.noMeat });
  });
  return rows;
}

window.buildProductsFromMaster = buildProductsFromMaster;
window.verifyProductsAgainstMaster = verifyProductsAgainstMaster;
window._imLoadCapa = _imLoadCapa;

// 레시피 관리에서 웹 제품 선택 시 → 매핑된 ERP 마스터 레시피를 참고로 표시
async function renderMasterRecipeFor(prodName){
  var el = document.getElementById('rc_master_view');
  if(!el) return;
  if(!prodName){ el.innerHTML=''; return; }
  // 마스터 데이터 아직이면 조용히 로드
  if(!_imData.master.length){
    try {
      var results = await Promise.all([
        db.collection('item_master').get(),
        db.collection('item_recipe').get(),
        db.collection('external_key_map').get()
      ]);
      _imData.master = results[0].docs.map(function(d){ return d.data(); });
      _imData.recipe = {}; results[1].docs.forEach(function(d){ _imData.recipe[d.id]=d.data(); });
      _imData.map = results[2].docs.map(function(d){ return d.data(); });
    } catch(e){ console.error(e); el.innerHTML=''; return; }
  }
  var mp = _imData.map.filter(function(m){ return m.webName===prodName; })[0];
  if(!mp || !mp.erpCodes || !mp.erpCodes.length){
    el.innerHTML = '<div style="margin-top:14px;font-size:12px;color:#9ca3af">이 제품은 아직 ERP 마스터에 매핑되지 않았습니다.</div>';
    return;
  }
  var findM = function(code){ return _imData.master.filter(function(x){return x.code===code;})[0]; };
  var html = '<div style="margin-top:14px;padding:12px;background:#f8fafc;border-radius:8px;border:0.5px solid #e5e7eb">';
  html += '<div style="font-weight:600;font-size:13px;margin-bottom:2px">🗂️ ERP 마스터 레시피 <span style="color:#9ca3af;font-weight:400">(부위별 · 참고용)</span></div>';
  html += '<div style="font-size:11px;color:#9ca3af;margin-bottom:10px">이 웹 제품에 연결된 ERP 완제품 '+mp.erpCodes.length+'종. 위 레시피 편집과 별개로, 마스터 원본을 보여줍니다.</div>';
  mp.erpCodes.forEach(function(code){
    var r = _imData.recipe[code], m = findM(code);
    html += '<div style="margin-bottom:10px;padding-bottom:8px;border-bottom:0.5px dashed #ddd">';
    html += '<div style="font-size:12px;font-weight:600;color:#1d4ed8;font-family:monospace">'+code+' <span style="font-family:inherit;color:#374151">'+(m?m.name:'')+'</span></div>';
    if(r){
      if(r.kind==='완제품'){
        (r.components||[]).forEach(function(x){
          html += '<div style="font-size:11px;color:#374151;padding-left:12px;margin-top:2px">└ 반제품 <span style="font-family:monospace">'+x.code+'</span> '+x.name+' × '+x.qty+'</div>';
          // 반제품 내포장 펼침
          var sub = _imData.recipe[x.code];
          if(sub && sub.inner){ sub.inner.forEach(function(y){
            html += '<div style="font-size:11px;color:#6b7280;padding-left:26px">· '+y.code+' '+y.name+' × '+y.qty+' '+y.unit+'</div>';
          }); }
        });
        (r.outer||[]).forEach(function(x){
          html += '<div style="font-size:11px;color:#b45309;padding-left:12px">└ 외포장 <span style="font-family:monospace">'+x.code+'</span> '+x.name+' × '+x.qty+'</div>';
        });
      } else {
        (r.inner||[]).forEach(function(x){
          html += '<div style="font-size:11px;color:#374151;padding-left:12px">└ '+x.code+' '+x.name+' × '+x.qty+' '+x.unit+'</div>';
        });
      }
    } else {
      html += '<div style="font-size:11px;color:#9ca3af;padding-left:12px">레시피 없음</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}
window.renderMasterRecipeFor = renderMasterRecipeFor;
