// ============================================================
// 설정 Firebase 동기화
// ============================================================

// Firebase에 설정 저장
async function saveSettings() {
  try {
    const cfg = {
      products: L.products || [],
      sauces: L.sauces || [],
      submats: L.submats || [],
      gtinMap: L.gtinMap || {},
      recipes: L.recipes || [],
      _updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('settings').doc('config').set(cfg);
  } catch(e) {
    console.error('설정 Firebase 저장 오류:', e);
  }
}

// Firebase에서 설정 로드 (앱 시작 시 + 설정탭 진입 시)
async function loadSettings_(){
  try {
    const doc = await db.collection('settings').doc('config').get();
    if(doc.exists){
      const data = doc.data();
      if(data.products && data.products.length) L.products = data.products;
      if(data.sauces && data.sauces.length) L.sauces = data.sauces;
      if(data.submats && data.submats.length) L.submats = data.submats;
      if(data.gtinMap && Object.keys(data.gtinMap).length) L.gtinMap = data.gtinMap;
      if(data.recipes) L.recipes = data.recipes;
      saveL();
      updDD();
      renderSettings();
      toast('설정 로드됨 ✓', 'i');
    }
  } catch(e) {
    console.error('설정 로드 오류:', e);
  }
  // 마스터에서 제품 목록 생성·적용 (마스터가 원본, 메모리 교체·원본 보존)
  if(typeof applyMasterProducts === 'function'){
    await applyMasterProducts();
    if(typeof updDD === 'function') updDD();
    if(typeof renderSettings === 'function') renderSettings();
  }
}

// ============================================================
// 설정 탭 - 제품/소스/부재료/GTIN 관리
// ============================================================

// 레시피 행 추가 (제품 관리 폼용)
function addProdRecipeRow(type, item='', qty='', unit='개'){
  const container = document.getElementById('np_recipe_'+type);
  if(!container) return;
  const row = document.createElement('div');
  row.style.cssText='display:flex;gap:4px;align-items:center';
  row.innerHTML=`
    <input class="fc rcp-item" style="flex:2;font-size:12px" placeholder="항목명 (예: 코스트코 170g 파우치)" value="${item}">
    <input class="fc rcp-qty" type="number" step="0.001" style="flex:1;font-size:12px" placeholder="수량" value="${qty}">
    <select class="fc rcp-unit" style="flex:1;font-size:12px">
      <option value="개" ${unit==='개'?'selected':''}>개</option>
      <option value="kg" ${unit==='kg'?'selected':''}>kg</option>
      <option value="g" ${unit==='g'?'selected':''}>g</option>
    </select>
    <button class="btn bd bsm" style="flex-shrink:0;font-size:11px" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(row);
}

// 레시피 폼 읽기
function getRecipeFromForm(){
  const readRows = id => [...document.querySelectorAll(`#${id} .rcp-item`)].map((el,i)=>{
    const row=el.parentElement;
    return {
      item: el.value.trim(),
      qty: parseFloat(row.querySelector('.rcp-qty').value)||0,
      unit: row.querySelector('.rcp-unit').value
    };
  }).filter(r=>r.item);
  return {
    inner: readRows('np_recipe_inner'),
    outer: readRows('np_recipe_outer'),
  };
}

// 레시피 폼 초기화
function clearRecipeForm(){
  const ci=document.getElementById('np_recipe_inner');
  const co=document.getElementById('np_recipe_outer');
  if(ci) ci.innerHTML='';
  if(co) co.innerHTML='';
}

// 레시피 폼 채우기
function fillRecipeForm(recipe){
  clearRecipeForm();
  if(!recipe) return;
  (recipe.inner||[]).forEach(r=>addProdRecipeRow('inner',r.item,r.qty,r.unit));
  (recipe.outer||[]).forEach(r=>addProdRecipeRow('outer',r.item,r.qty,r.unit));
}

function onNpNoMeatToggle(){
  const cb = document.getElementById('np_nomeat');
  const ke = document.getElementById('np_ke');
  if(!cb || !ke) return;
  if(cb.checked){
    ke.value = '0';
    ke.disabled = true;
    ke.style.background = '#f0f0f0';
  } else {
    ke.disabled = false;
    ke.style.background = '';
  }
}

function addProd(){
  try {
  const n=document.getElementById('np_nm').value.trim();
  const noMeat = !!document.getElementById('np_nomeat')?.checked;
  const k = noMeat ? 0 : (parseFloat(document.getElementById('np_ke').value)||0);
  const c=parseInt(document.getElementById('np_cp').value)||0;
  const s=document.getElementById('np_sc').value;
  const sub=document.getElementById('np_sub')?.value||'';
  const subKe=parseFloat(document.getElementById('np_subke')?.value)||0;
  if(!n){toast('제품명 입력','d');return;}
  const recipe={inner:[],outer:[]};
  const prodObj = {name:n, kgea:k, capa:c, sauce:s, recipe};
  if(noMeat) prodObj.noMeat = true;
  if(sub) prodObj.subName = sub;
  if(subKe>0) prodObj.subKgea = subKe;

  if(_editProdIdx >= 0){
    L.products[_editProdIdx] = prodObj;
    toast('제품 수정됨 ✓');
    cancelEditProd();
  } else {
    L.products.push(prodObj);
    toast('제품 추가됨 ✓');
    document.getElementById('np_nm').value='';
    document.getElementById('np_ke').value='';
    document.getElementById('np_cp').value='';
    const npSc=document.getElementById('np_sc'); if(npSc) npSc.value='';
    const npSub=document.getElementById('np_sub'); if(npSub) npSub.value='';
    const npSubKe=document.getElementById('np_subke'); if(npSubKe) npSubKe.value='';
    const npNm=document.getElementById('np_nomeat'); if(npNm){ npNm.checked=false; onNpNoMeatToggle(); }
    clearRecipeForm();
  }
  saveL(); updDD(); renderSettings(); saveSettings();
  } catch(e){ toast('오류: '+e.message,'d'); console.error(e); }
}

function cancelEditProd(){
  _editProdIdx = -1;
  document.getElementById('np_nm').value='';
  document.getElementById('np_ke').value='';
  document.getElementById('np_cp').value='';
  const npSc=document.getElementById('np_sc'); if(npSc) npSc.value='';
  const npSub=document.getElementById('np_sub'); if(npSub) npSub.value='';
  const npSubKe=document.getElementById('np_subke'); if(npSubKe) npSubKe.value='';
  const npNm=document.getElementById('np_nomeat'); if(npNm){ npNm.checked=false; onNpNoMeatToggle(); }
  clearRecipeForm();
  const addBtn = document.querySelector('#p-settings .btn.bs[onclick="addProd()"]');
  if(addBtn){ addBtn.textContent='+ 제품 추가'; addBtn.style.background=''; }
  const cancelBtn = document.getElementById('prodEditCancel');
  if(cancelBtn) cancelBtn.style.display='none';
  document.querySelectorAll('[id^="pdItem_"]').forEach(el=>el.style.background='');
}

function delProd(i){ if(!confirm('삭제?'))return; L.products.splice(i,1); saveL(); updDD(); renderSettings(); saveSettings(); }

function addSc(){
  const n=document.getElementById('ns_nm').value.trim();
  const m=document.getElementById('ns_mo').value.trim();
  if(!n){toast('소스명 입력','d');return;}
  L.sauces.push({name:n,memo:m}); saveL(); renderSettings(); saveSettings(); toast('소스 추가됨');
  document.getElementById('ns_nm').value=''; document.getElementById('ns_mo').value='';
}
function delSc(i){ if(!confirm('삭제?'))return; L.sauces.splice(i,1); saveL(); renderSettings(); saveSettings(); }

function addSub(){
  const n=document.getElementById('nsub_nm').value.trim();
  if(!n){toast('부재료명 입력','d');return;}
  if(!L.submats) L.submats=[];
  L.submats.push(n); saveL(); renderSettings(); saveSettings(); toast('부재료 추가됨');
  document.getElementById('nsub_nm').value='';
}
function delSub(i){ L.submats.splice(i,1); saveL(); renderSettings(); saveSettings(); }

function addGt(){
  const g=document.getElementById('ng_gt').value.trim();
  const p=document.getElementById('ng_pt').value;
  if(!g){toast('GTIN 입력','d');return;}
  L.gtinMap[g]=p; saveL(); renderSettings(); saveSettings(); toast('GTIN 추가됨');
  document.getElementById('ng_gt').value='';
}
function delGt(g){ delete L.gtinMap[g]; saveL(); renderSettings(); saveSettings(); }

// ============================================================
// 레시피 관리
// ============================================================
var _rcType = 'inner'; // 현재 편집 섹션

function renderRecipeSelect() {
  const sel = document.getElementById('rc_prod');
  if(!sel) return;
  sel.innerHTML = '<option value="">제품을 선택하세요</option>' +
    L.products.map(p=>`<option>${p.name}</option>`).join('');
}

function loadRecipe() {
  const sel = document.getElementById('rc_prod');
  const prod = sel ? sel.value : '';
  const rc = (L.recipes||{})[prod] || {inner:[], outer:[]};
  _rcData = {inner:[...(rc.inner||[])], outer:[...(rc.outer||[])]};
  renderRecipeRows('inner', _rcData.inner);
  renderRecipeRows('outer', _rcData.outer);
  // 소스 선택 시 외포장 섹션 숨기기
  const isSauce = L.sauces.some(s=>s.name===prod);
  const outerSec = document.getElementById('rc_outer_section');
  if(outerSec) outerSec.style.display = isSauce ? 'none' : '';
  renderRcList();
  if(typeof renderMasterRecipeFor==='function') renderMasterRecipeFor(prod);
}

const PKG_TYPES = ['외박스','RRP','트레이','기타'];
function renderRecipeRows(type, rows) {
  const tbody = document.getElementById('rc_'+type+'_rows');
  if(!tbody) return;
  const isOuter = type === 'outer';
  tbody.innerHTML = rows.map((r,i)=>`
    <tr>
      <td style="padding:4px"><input class="fc" style="padding:4px 6px" value="${r.name||''}" oninput="rcRowChange('${type}',${i},'name',this.value)" placeholder="품목명"></td>
      <td style="padding:4px"><input class="fc" style="padding:4px 6px;text-align:right" type="number" step="0.001" value="${r.qty||''}" oninput="rcRowChange('${type}',${i},'qty',this.value)" placeholder="0"></td>
      <td style="padding:4px"><select class="fc" style="padding:4px 6px" onchange="rcRowChange('${type}',${i},'unit',this.value)">${['kg','g','개','EA','장','Box'].map(u=>`<option${r.unit===u?' selected':''}>${u}</option>`).join('')}</select></td>
      ${isOuter ? `<td style="padding:4px"><select class="fc" style="padding:3px 5px;font-size:11px" onchange="rcRowChange('outer',${i},'pkgType',this.value)">${PKG_TYPES.map(t=>`<option${(r.pkgType||'외박스')===t?' selected':''}>${t}</option>`).join('')}</select></td>` : ''}
      <td style="padding:4px;text-align:center"><button class="btn bd bsm" onclick="delRecipeRow('${type}',${i})" style="padding:2px 8px">✕</button></td>
    </tr>`).join('') || `<tr><td colspan="${isOuter?5:4}" style="text-align:center;padding:8px;color:var(--g4);font-size:12px">재료 없음</td></tr>`;
}

// 임시 편집 상태
var _rcData = {inner:[], outer:[]};

function addRecipeRow(type) {
  const prod = document.getElementById('rc_prod').value;
  if(!prod){ toast('제품을 먼저 선택하세요','d'); return; }
  if(!_rcData[type]) _rcData[type] = [];
  _rcData[type].push({name:'', qty:'', unit:'개'});
  renderRecipeRows(type, _rcData[type]);
}

function delRecipeRow(type, i) {
  _rcData[type].splice(i,1);
  renderRecipeRows(type, _rcData[type]);
}

function rcRowChange(type, i, field, val) {
  if(!_rcData[type]) _rcData[type] = [];
  if(!_rcData[type][i]) _rcData[type][i] = {};
  _rcData[type][i][field] = field==='qty' ? parseFloat(val)||0 : val;
}

function saveRecipe() {
  const prod = document.getElementById('rc_prod').value;
  if(!prod){ toast('제품을 선택하세요','d'); return; }
  // 현재 입력값 수집
  const collectRows = (type) => {
    const rows = [];
    const tbody = document.getElementById('rc_'+type+'_rows');
    if(!tbody) return rows;
    tbody.querySelectorAll('tr').forEach(tr=>{
      const inputs = tr.querySelectorAll('input,select');
      if(inputs.length >= 3) {
        const name = inputs[0].value.trim();
        const qty = parseFloat(inputs[1].value)||0;
        const unit = inputs[2].value;
        const pkgType = (type==='outer' && inputs[3]) ? inputs[3].value : undefined;
        if(name) rows.push({name, qty, unit, ...(pkgType?{pkgType}:{})});
      }
    });
    return rows;
  };
  if(!L.recipes) L.recipes = {};
  L.recipes[prod] = {
    inner: collectRows('inner'),
    outer: collectRows('outer'),
    updatedAt: new Date().toISOString().slice(0,10)
  };
  _rcData = {inner:[...L.recipes[prod].inner], outer:[...L.recipes[prod].outer]};
  saveL(); saveSettings();
  renderRcList();
  toast(prod+' 레시피 저장됨','s');
}

function delRecipe() {
  const prod = document.getElementById('rc_prod').value;
  if(!prod || !confirm(prod+' 레시피를 삭제하시겠습니까?')) return;
  if(L.recipes) delete L.recipes[prod];
  _rcData = {inner:[], outer:[]};
  renderRecipeRows('inner',[]);
  renderRecipeRows('outer',[]);
  saveL(); saveSettings();
  renderRcList();
  toast('레시피 삭제됨');
}

function renderRcList() {
  const el = document.getElementById('rcList');
  if(!el) return;
  const entries = Object.entries(L.recipes||{});
  if(!entries.length){ el.innerHTML=''; return; }
  el.innerHTML = '<div class="dvd" style="margin-bottom:10px"></div>'+
    '<div style="font-size:12px;color:var(--g5);margin-bottom:6px">등록된 레시피 ('+entries.length+'개)</div>'+
    entries.map(([prod,rc])=>`
      <div class="si" style="cursor:pointer" onclick="selectRecipe('${prod.replace(/'/g,"\\'")}')">
        <div style="flex:1;min-width:0">
          <div class="sn">${prod}</div>
          <div class="ss">내포장 ${(rc.inner||[]).length}종 · 외포장 ${(rc.outer||[]).length}종${rc.updatedAt?' · '+rc.updatedAt:''}</div>
        </div>
        <span style="font-size:11px;color:var(--p)">선택</span>
      </div>`).join('');
}

function selectRecipe(prod) {
  const sel = document.getElementById('rc_prod');
  if(sel) sel.value = prod;
  const rc = (L.recipes||{})[prod] || {inner:[], outer:[]};
  _rcData = {inner:[...(rc.inner||[])], outer:[...(rc.outer||[])]};
  renderRecipeRows('inner', _rcData.inner);
  renderRecipeRows('outer', _rcData.outer);
}

function expAll(){
  const all=[];
  ['barcodes','thawing','preprocess','cooking','shredding','packing','sauce'].forEach(t=>
    L[t].forEach(r=>all.push({공정:t,...r})));
  if(!all.length){toast('데이터 없음','d');return;}
  const ks=[...new Set(all.flatMap(r=>Object.keys(r)))];
  dlCSV('생산데이터_전체.csv',[ks,...all.map(r=>ks.map(k=>r[k]??''))]);
}
function startEditProd(i){
  _editProdIdx = i;
  const p = L.products[i];
  if(!p) return;
  document.getElementById('np_nm').value = p.name;
  document.getElementById('np_ke').value = p.kgea||'';
  document.getElementById('np_cp').value = p.capa||'';
  const npSc = document.getElementById('np_sc');
  if(npSc) npSc.value = p.sauce||'';
  fillRecipeForm(p.recipe||null);
  const addBtn = document.querySelector('#p-settings .btn.bs[onclick="addProd()"]');
  if(addBtn){ addBtn.textContent='✔ 수정 저장'; addBtn.style.background='var(--w)'; }
  const cancelBtn = document.getElementById('prodEditCancel');
  if(cancelBtn) cancelBtn.style.display='';
  document.querySelectorAll('[id^="pdItem_"]').forEach(el=>el.style.background='');
  const item = document.getElementById('pdItem_'+i);
  if(item) item.style.background='var(--wl)';
  toast('수정 모드: '+p.name,'i');
  document.getElementById('np_nm').scrollIntoView({behavior:'smooth', block:'center'});
  document.getElementById('np_nm').focus();
}
