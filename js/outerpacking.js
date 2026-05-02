// ============================================================
// 외포장 탭
// ============================================================

function getPerBox(prodName) {
  const rc = (L.recipes||{})[prodName];
  if(!rc || !rc.outer || !rc.outer.length) return 0;
  const qty = rc.outer[0].qty;
  return qty > 0 ? Math.round(1/qty) : 0;
}

async function loadOuterPacking() {
  const btn = document.getElementById('op_refresh_btn');
  if(btn) btn.textContent = '로딩 중...';

  const today = tod();
  const from = new Date(); from.setDate(from.getDate()-30);
  const fromStr = from.toISOString().slice(0,10);

  const [pkAll, opAll] = await Promise.all([
    fbGetRange('packing', fromStr, today),
    fbGetRange('outerpacking', fromStr, today)
  ]);

  const pkMap = {};
  pkAll.forEach(r => {
    const key = (r.date||'').slice(0,10) + '__' + (r.product||'');
    if(!pkMap[key]) pkMap[key] = { date: (r.date||'').slice(0,10), product: r.product||'', ea: 0 };
    pkMap[key].ea += parseFloat(r.ea)||0;
  });

  const opDoneMap = {};
  opAll.forEach(r => {
    const key = (r.date||'').slice(0,10) + '__' + (r.product||'');
    opDoneMap[key] = r;
  });

  const pending = [], done = [];
  Object.keys(pkMap).sort((a,b)=>b.localeCompare(a)).forEach(key => {
    if(opDoneMap[key]) done.push({...pkMap[key], ...opDoneMap[key]});
    else pending.push(pkMap[key]);
  });

  renderOpPending(pending);
  renderOpDone(done);
  if(btn) btn.textContent = '↻ 새로고침';
}

function renderOpPending(list) {
  const el = document.getElementById('op_pending_list');
  const cnt = document.getElementById('op_pending_cnt');
  if(cnt) cnt.textContent = list.length+'건';
  if(!el) return;
  if(!list.length){ el.innerHTML='<div class="emp">미완료 항목 없음 ✓</div>'; return; }

  el.innerHTML = list.map((item, i) => {
    const perBox = getPerBox(item.product);
    const rc = (L.recipes||{})[item.product] || {};
    const outerMats = rc.outer || [];
    const d = item.date ? item.date.slice(5).replace('-','/') : '';

    // 포장재 행 HTML (제품 행 + outer 항목들)
    const matRows = `
      <tr style="border-bottom:0.5px solid var(--g2)">
        <td style="padding:5px 6px;font-size:12px">${item.product}</td>
        <td style="padding:5px 6px;text-align:right;font-size:12px;color:var(--g5)" id="op_t0_${i}">-</td>
        <td style="padding:5px 6px;text-align:center">
          <input class="fc" type="number" id="op_d0_${i}" placeholder="0"
            style="width:60px;text-align:right;padding:3px 6px;font-size:12px"
            oninput="opCalc(${i},${item.ea})">
        </td>
        <td style="padding:5px 6px;text-align:right;font-size:12px;color:var(--g5)" id="op_a0_${i}">—</td>
        <td style="padding:5px 4px;font-size:10px;color:var(--g4)"></td>
      </tr>
      ${outerMats.map((m,j)=>`
      <tr style="border-bottom:0.5px solid var(--g2)">
        <td style="padding:5px 6px;font-size:12px">${m.name}</td>
        <td style="padding:5px 6px;text-align:right;font-size:12px;color:var(--g5)" id="op_t${j+1}_${i}">-</td>
        <td style="padding:5px 6px;text-align:center">
          <input class="fc" type="number" id="op_d${j+1}_${i}" placeholder="0"
            style="width:60px;text-align:right;padding:3px 6px;font-size:12px"
            oninput="opCalc(${i},${item.ea})">
        </td>
        <td style="padding:5px 6px;text-align:right">
          <input class="fc" type="number" step="0.01" id="op_a${j+1}_${i}"
            style="width:80px;text-align:right;padding:3px 6px;font-size:12px" placeholder="0">
        </td>
        <td style="padding:5px 4px;font-size:10px;color:var(--w)">불량 시 +</td>
      </tr>`).join('')}
    `;

    return `
    <div>
      <div class="si" id="op_row_${i}" style="cursor:pointer" onclick="toggleOpRow(${i})">
        <div style="min-width:36px;font-size:12px;font-weight:500;color:var(--g5)">${d}</div>
        <div style="flex:1;min-width:0">
          <div class="sn" style="font-size:13px">${item.product}</div>
          <div class="ss">${item.ea.toLocaleString()} EA${perBox>0?' · '+perBox+'개입':''}</div>
        </div>
        <span style="font-size:11px;padding:2px 8px;border-radius:var(--rl);background:var(--wl);color:var(--w);font-weight:500">미완료</span>
        <span id="op_chev_${i}" style="font-size:11px;color:var(--g4);display:inline-block;transition:transform .2s">▶</span>
      </div>
      <div id="op_panel_${i}" style="display:none;background:var(--g1);border-radius:8px;padding:14px;margin-top:4px">

        <!-- 요약 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div style="background:var(--bg);border-radius:6px;padding:8px 10px;border:0.5px solid var(--g2)">
            <div style="font-size:11px;color:var(--g5);margin-bottom:2px">내포장 EA</div>
            <div style="font-size:15px;font-weight:500">${item.ea.toLocaleString()}</div>
          </div>
          <div style="background:var(--bg);border-radius:6px;padding:8px 10px;border:0.5px solid var(--g2)">
            <div style="font-size:11px;color:var(--g5);margin-bottom:2px">파우치 불량</div>
            <div style="font-size:15px;font-weight:500" id="op_sdefp_${i}">0 EA</div>
          </div>
        </div>
        <div style="background:#e6f7f0;border:0.5px solid #1a7f5a33;border-radius:6px;padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;color:#1a7f5a;font-weight:500">외포장 완료 EA</span>
          <span style="font-size:18px;font-weight:700;color:#1a7f5a" id="op_souter_${i}">${item.ea.toLocaleString()}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          <div style="background:var(--bg);border-radius:6px;padding:8px 10px;border:0.5px solid var(--g2)">
            <div style="font-size:11px;color:var(--g5);margin-bottom:2px">외포장 박스</div>
            <div style="font-size:15px;font-weight:500" id="op_sbox_${i}">0</div>
          </div>
          <div style="background:var(--bg);border-radius:6px;padding:8px 10px;border:0.5px solid var(--g2)">
            <div style="font-size:11px;color:var(--g5);margin-bottom:2px">잔여 EA</div>
            <div style="font-size:15px;font-weight:500" id="op_srem_${i}">${item.ea.toLocaleString()}</div>
          </div>
        </div>

        <!-- 완제품 입력 -->
        <div style="font-size:11px;font-weight:500;color:var(--g5);margin-bottom:8px">완제품</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;color:var(--g5);min-width:72px">외포장 박스</span>
          <input class="fc" type="number" id="op_boxes_${i}" placeholder="0"
            style="width:88px;text-align:right;padding:5px 8px"
            oninput="opCalc(${i},${item.ea})">
          <span style="font-size:12px;color:var(--g5)">박스${perBox>0?' ('+perBox+'EA/박스)':''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;color:var(--g5);min-width:72px">잔량 박스</span>
          <input class="fc" type="number" id="op_partial_${i}" placeholder="0"
            style="width:88px;text-align:right;padding:5px 8px"
            oninput="opCalc(${i},${item.ea})">
          <span style="font-size:12px;color:var(--g4)">EA${perBox>0?" ("+perBox+"개 미만 박스)":""}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;color:var(--g5);min-width:72px">샘플</span>
          <input class="fc" type="number" id="op_sample_${i}" placeholder="0"
            style="width:88px;text-align:right;padding:5px 8px"
            oninput="opCalc(${i},${item.ea})">
          <span style="font-size:12px;color:var(--g5)">EA</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;color:#1a7f5a;min-width:72px;font-weight:500">외포장 완료</span>
          <input class="fc" type="number" id="op_outer_${i}" value="${item.ea}"
            style="width:100px;text-align:right;padding:5px 8px;border-color:#1a7f5a55"
            oninput="opSyncOuter(${i})">
          <span style="font-size:12px;color:#1a7f5a">EA (자동계산)</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:12px;color:var(--g5);min-width:72px">잔여 EA</span>
          <input class="fc" type="number" id="op_rem_${i}" value="${item.ea}"
            style="width:100px;text-align:right;padding:5px 8px"
            oninput="opSyncRem(${i})">
          <span style="font-size:11px;color:var(--g4)">자동계산</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:12px;color:var(--g5);min-width:72px">트레이</span>
          <input class="fc" type="number" id="op_tray_${i}" placeholder="0"
            style="width:88px;text-align:right;padding:5px 8px">
          <span style="font-size:12px;color:var(--g5)">개</span>
        </div>

        <!-- 포장재 테이블 -->
        <div style="font-size:11px;font-weight:500;color:var(--g5);margin-bottom:6px">포장재 사용량</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">
          <thead>
            <tr style="border-bottom:0.5px solid var(--g3)">
              <th style="text-align:left;padding:4px 6px;font-size:11px;color:var(--g5);font-weight:500">품목</th>
              <th style="text-align:right;padding:4px 6px;font-size:11px;color:var(--g5);font-weight:500">이론 사용량</th>
              <th style="text-align:center;padding:4px 6px;font-size:11px;color:var(--g5);font-weight:500">불량</th>
              <th style="text-align:right;padding:4px 6px;font-size:11px;color:var(--g5);font-weight:500">실제 사용량</th>
              <th style="width:52px"></th>
            </tr>
          </thead>
          <tbody>${matRows}</tbody>
        </table>

        <!-- 불량률 -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;padding:8px 10px;background:var(--bg);border-radius:6px;border:0.5px solid var(--g2)">
          <span style="font-size:12px;color:var(--g5)">불량률</span>
          <span style="font-size:14px;font-weight:500" id="op_rate_${i}">0.00%</span>
          <span style="font-size:11px;color:var(--g4)">(제품 불량 ÷ 내포장 EA)</span>
        </div>

        <!-- 제품 테스트 체크 -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;background:#fff8e1;border-radius:6px;border:0.5px solid #f59e0b44">
          <input type="checkbox" id="op_test_${i}" style="width:16px;height:16px;cursor:pointer" onchange="opToggleTest(${i},${item.ea})">
          <label for="op_test_${i}" style="font-size:12px;font-weight:500;color:#92400e;cursor:pointer">🔬 제품 테스트용 (박스 없이 저장)</label>
        </div>
        <!-- 비고 -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="font-size:12px;color:var(--g5);min-width:72px">비고</span>
          <input class="fc" id="op_note_${i}" placeholder="특이사항" style="flex:1;padding:5px 8px">
        </div>

        <button class="btn bs bblk" onclick="completeOuterPacking(${i},'${item.date}','${item.product}',${item.ea})">
          외포장 완료
        </button>
      </div>
    </div>`;
  }).join('');
}

function toggleOpRow(i) {
  const panel = document.getElementById('op_panel_'+i);
  const chev  = document.getElementById('op_chev_'+i);
  if(!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : '';
  if(chev) chev.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function opSyncRem(i) {
  const v = parseInt(document.getElementById('op_rem_'+i).value)||0;
  const el = document.getElementById('op_srem_'+i);
  if(el){ el.textContent = v.toLocaleString(); el.style.color = v<0?'var(--d)':v===0?'var(--s)':''; }
}

function opSyncOuter(i) {
  const v = parseInt(document.getElementById('op_outer_'+i).value)||0;
  const el = document.getElementById('op_souter_'+i);
  if(el) el.textContent = v.toLocaleString();
}

function opToggleTest(i, innerEa) {
  const isTest = (document.getElementById('op_test_'+i)||{}).checked;
  const boxEl  = document.getElementById('op_boxes_'+i);
  const outerEl= document.getElementById('op_outer_'+i);
  const noteEl = document.getElementById('op_note_'+i);
  if(isTest){
    if(boxEl) boxEl.value = 0;
    if(outerEl) outerEl.value = innerEa;
    const souter = document.getElementById('op_souter_'+i);
    if(souter) souter.textContent = innerEa.toLocaleString();
    if(noteEl && !noteEl.value) noteEl.value = '제품 테스트용';
    opCalc(i, innerEa);
  }
}

function opCalc(i, innerEa) {
  const boxes   = parseInt(document.getElementById('op_boxes_'+i).value)||0;
  const partial = parseInt(document.getElementById('op_partial_'+i) ? document.getElementById('op_partial_'+i).value : 0)||0;
  const defp    = parseInt(document.getElementById('op_d0_'+i).value)||0;
  const sample  = parseInt(document.getElementById('op_sample_'+i).value)||0;

  // 제품명 → 레시피에서 입수(perBox) 계산
  const snEl = document.querySelector('#op_row_'+i+' .sn');
  const prodName = snEl ? snEl.textContent.trim() : '';
  const perBox = getPerBox(prodName) || 0;

  // 잔여 = 내포장 - (박스×입수) - 잔량박스EA - 제품불량 - 샘플
  const rem = innerEa - boxes * perBox - partial - defp - sample;

  // 상단 요약
  const sbox = document.getElementById('op_sbox_'+i);
  const sdefp = document.getElementById('op_sdefp_'+i);
  const srem = document.getElementById('op_srem_'+i);
  const rateEl = document.getElementById('op_rate_'+i);

  if(sbox) sbox.textContent = (boxes + (partial>0?1:0)).toLocaleString();
  if(sdefp){ sdefp.textContent = defp.toLocaleString()+' EA'; sdefp.style.color = defp>0?'var(--d)':''; }

  // 외포장 완료 EA = (박스 × 입수) + 잔량박스EA (입수 모르면 내포장 - 불량 - 샘플)
  const outerCalc = (boxes > 0 && perBox > 0)
    ? boxes * perBox + partial
    : Math.max(0, innerEa - defp - sample);
  const sOuter = document.getElementById('op_souter_'+i);
  const outerInput = document.getElementById('op_outer_'+i);
  if(sOuter){ sOuter.textContent = outerCalc.toLocaleString(); }
  if(outerInput){ outerInput.value = outerCalc; }

  // 잔여 EA
  const remInput = document.getElementById('op_rem_'+i);
  if(remInput){ remInput.value = rem >= 0 ? rem : 0; }
  if(srem){ srem.textContent = (rem >= 0 ? rem : 0).toLocaleString(); srem.style.color = rem<0?'var(--d)':rem===0?'var(--s)':''; }

  // 불량률
  if(rateEl){
    const rate = innerEa > 0 ? (defp/innerEa*100).toFixed(2) : '0.00';
    rateEl.textContent = rate+'%';
    rateEl.style.color = parseFloat(rate)>0 ? 'var(--d)' : '';
  }

  // 포장재 이론 사용량
  const rc = (L.recipes||{})[prodName] || {};
  const outerMats = rc.outer || [];
  const t0El = document.getElementById('op_t0_'+i);
  if(t0El) t0El.textContent = (boxes*perBox).toLocaleString();

  const totalBoxes = boxes + (partial > 0 ? 1 : 0);
  const packedEa = boxes * perBox + partial;
  outerMats.forEach((m,j) => {
    // 박스 단위 포장재(qty≈1/perBox)는 총 박스 수로, EA 단위는 packedEa 기준
    const isBoxUnit = m.qty > 0 && Math.abs(m.qty - 1/perBox) < 0.01;
    const theory = isBoxUnit
      ? totalBoxes
      : parseFloat((packedEa * m.qty).toFixed(2));
    const dEl = document.getElementById('op_d'+(j+1)+'_'+i);
    const def  = dEl ? parseInt(dEl.value)||0 : 0;
    const tEl = document.getElementById('op_t'+(j+1)+'_'+i);
    const aEl = document.getElementById('op_a'+(j+1)+'_'+i);
    if(tEl) tEl.textContent = theory.toLocaleString();
    if(aEl){
      aEl.value = (theory+def);
      aEl.style.color = def>0?'var(--w)':'var(--s)';
    }
  });
}

async function completeOuterPacking(i, date, product, innerEa) {
  const boxes   = parseInt(document.getElementById('op_boxes_'+i).value)||0;
  const partial = parseInt(document.getElementById('op_partial_'+i) ? document.getElementById('op_partial_'+i).value : 0)||0;
  const isTest  = (document.getElementById('op_test_'+i)||{}).checked;
  if(!boxes && !partial && !isTest){ toast('박스 수를 입력하거나 제품 테스트용을 체크하세요','d'); return; }

  const defp   = parseInt(document.getElementById('op_d0_'+i).value)||0;
  const sample = parseInt(document.getElementById('op_sample_'+i).value)||0;
  const note  = (document.getElementById('op_note_'+i)||{}).value||'';
  const rem   = parseInt(document.getElementById('op_rem_'+i).value)||0;
  const trayUsed = parseInt((document.getElementById('op_tray_'+i)||{}).value)||0;
  const rate  = parseFloat(document.getElementById('op_rate_'+i).textContent)||0;

  // 포장재별 실적 수집
  const rc = (L.recipes||{})[product] || {};
  const outerMats = rc.outer || [];
  const perBox = outerMats.length && outerMats[0].qty > 0 ? Math.round(1/outerMats[0].qty) : 0;
  const materials = [{
    name: product,
    theory: boxes * perBox + partial,
    defect: defp,
    actual: null
  }, ...outerMats.map((m,j) => {
    const def = parseInt((document.getElementById('op_d'+(j+1)+'_'+i)||{}).value)||0;
    const actualInput = document.getElementById('op_a'+(j+1)+'_'+i);
    const totalBoxes2 = boxes + (partial > 0 ? 1 : 0);
    const packedEa = boxes * perBox + partial;
    const isBoxUnit2 = m.qty > 0 && perBox > 0 && Math.abs(m.qty - 1/perBox) < 0.01;
    const theory = isBoxUnit2
      ? totalBoxes2
      : parseFloat((packedEa * m.qty).toFixed(2));
    const actual = actualInput ? parseFloat(actualInput.value)||0 : theory+def;
    return { name: m.name, theory, defect: def, actual, pkgType: m.pkgType||'기타' };
  })];

  const outerEa = parseInt((document.getElementById('op_outer_'+i)||{}).value)||0;
  const rec = {
    date, product, innerEa, outerEa, outerBoxes: boxes + (partial > 0 ? 1 : 0),
    partialBoxEa: partial,
    productDefect: defp, sample, remainEa: rem,
    trayUsed, trayDefect: 0,
    defectRate: rate, materials, note,
    testRun: isTest ? true : false,
    savedAt: new Date().toISOString()
  };

  const docId = 'op_'+date+'_'+product.replace(/[\s\W]/g,'_').slice(0,20);
  const ok = await fbSave('outerpacking', rec, docId);
  if(ok){
    // ─ testRun 자동 전파: 외포장 testRun=true → 같은 날짜+제품의 packing record도 testRun=true ─
    // 입력자가 외포장에만 마킹하고 packing은 누락한 케이스 자동 보호
    // (ex. 04-02/04-15/04-24처럼 분석 화면이 testRun을 인식 못 하는 문제 차단)
    if(isTest){
      try{
        const pkSnap = await db.collection('packing')
          .where('date','==',date)
          .where('product','==',product)
          .get();
        let propagated = 0;
        for(const doc of pkSnap.docs){
          const d = doc.data();
          if(!(d.testRun || d.isTest)){
            await doc.ref.update({ testRun: true, _testRunReason: 'op_auto_propagation', _testRunPropagatedAt: new Date().toISOString() });
            propagated++;
          }
        }
        fbClearCache('packing');
        if(propagated > 0){
          toast(`내포장 ${propagated}건도 자동 테스트 처리됨`, 'd');
          console.log(`[testRun 자동 전파] ${date} ${product} packing ${propagated}건 → testRun=true`);
        }
      }catch(err){
        console.error('[testRun 전파 실패]', err);
        toast('내포장 testRun 자동 전파 실패 — 콘솔 확인 필요', 'w');
      }
    }
    toast(product+' 외포장 완료 ✓');
    loadOuterPacking();
  }
}

function renderOpDone(list) {
  const el = document.getElementById('op_done_list');
  const cnt = document.getElementById('op_done_cnt');
  if(cnt) cnt.textContent = list.length+'건';
  if(!el) return;
  if(!list.length){ el.innerHTML='<div class="emp">데이터 없음</div>'; return; }
  el.innerHTML = list.map((item, i) => {
    const d = item.date ? item.date.slice(5).replace('-','/') : '';
    const rate = item.defectRate ? item.defectRate.toFixed(2)+'%' : '-';
    // 내포장 EA: packing 실적(item.ea) 우선, 없으면 저장된 innerEa
    const inner = (item.ea||item.innerEa||0).toLocaleString();
    const boxes = (item.outerBoxes||0).toLocaleString();
    const rem   = (item.remainEa||0).toLocaleString();
    const note  = item.note || '-';
    const defEa = (item.productDefect||0).toLocaleString();
    return `
    <div style="border:0.5px solid var(--g2);border-radius:var(--rc);overflow:hidden;background:var(--card)">
      <div class="si" style="cursor:pointer;padding:10px 12px" onclick="toggleOpDone(${i})">
        <div style="min-width:36px;font-size:12px;font-weight:500;color:var(--g5)">${d}</div>
        <div style="flex:1;min-width:0">
          <div class="sn" style="font-size:13px">${item.product}</div>
          <div class="ss">${inner} EA · ${boxes}박스 · 불량률 ${rate}</div>
        </div>
        <span style="font-size:11px;padding:2px 8px;border-radius:var(--rl);background:${item.testRun?'#fff8e1':'#e6f7f0'};color:${item.testRun?'#92400e':'#1a7f5a'};font-weight:500;margin-right:6px">${item.testRun?'🔬테스트':'완료'}</span>
        <span id="op_done_chev_${i}" style="color:var(--g4);font-size:13px;transition:transform .2s">▶</span>
      </div>
      <div id="op_done_panel_${i}" style="display:none;padding:10px 14px 14px;border-top:0.5px solid var(--g2);font-size:13px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">
          <div><span style="color:var(--g5);font-size:12px">내포장 생산</span><br><b>${inner} EA</b></div>
          <div><span style="color:var(--g5);font-size:12px">파우치 불량</span><br><b>${defEa} EA</b></div>
          <div><span style="color:var(--g5);font-size:12px">외포장 완료</span><br><b>${(item.outerEa||(item.ea||item.innerEa||0)-(item.productDefect||0)).toLocaleString()} EA</b></div>
          <div><span style="color:var(--g5);font-size:12px">외박스 사용</span><br><b>${boxes} 박스</b></div>
          <div><span style="color:var(--g5);font-size:12px">불량률</span><br><b>${rate}</b></div>
          ${item.sample ? `<div><span style="color:var(--g5);font-size:12px">샘플</span><br><b>${item.sample} EA</b></div>` : ''}
          <div><span style="color:var(--g5);font-size:12px">잔여 EA</span><br><b>${rem} EA</b></div>
          ${(item.remainBoxes||0)>0 ? `<div><span style="color:var(--g5);font-size:12px">잔여 박스</span><br><b>${item.remainBoxes}박스</b></div>` : ''}
          ${(item.trayUsed||0)>0 ? `<div><span style="color:var(--g5);font-size:12px">트레이 사용</span><br><b>${item.trayUsed}개</b></div>` : ''}
          ${(()=>{
            // materials 배열(신규) 또는 직접 필드(구형) 모두 지원
            const matDefects = {};
            (item.materials||[]).filter(m=>m.pkgType&&m.pkgType!=='기타'&&m.defect>0).forEach(m=>{matDefects[m.pkgType]=(matDefects[m.pkgType]||0)+m.defect;});
            if((item.boxDefect||0)>0 && !matDefects['외박스']) matDefects['외박스']=item.boxDefect;
            if((item.trayDefect||0)>0 && !matDefects['트레이']) matDefects['트레이']=item.trayDefect;
            return Object.entries(matDefects).map(([t,v])=>`<div><span style="color:var(--g5);font-size:12px">${t} 불량</span><br><b style="color:var(--w)">${v.toLocaleString()}</b></div>`).join('');
          })()}
        </div>
        ${note !== '-' ? `<div style="margin-top:8px;padding:6px 8px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--g5)">📝 ${note}</div>` : ''}
        <div style="margin-top:10px;text-align:right">
          <button class="btn bo bsm" onclick="toggleOpEdit(${i})" style="font-size:12px;padding:4px 12px">✏️ 수정</button>
        </div>
        <div id="op_edit_${i}" style="display:none;margin-top:10px;padding:12px;background:var(--g1);border-radius:8px">
          <div style="font-size:12px;font-weight:600;color:var(--g6);margin-bottom:10px">기록 수정</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div><label style="font-size:11px;color:var(--g5)">내포장 생산 EA</label><br><input class="fc" type="number" id="oe_inner_${i}" value="${item.innerEa||0}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
            <div><label style="font-size:11px;color:var(--g5)">외포장 완료 EA</label><br><input class="fc" type="number" id="oe_outer_${i}" value="${item.outerEa||0}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
            <div><label style="font-size:11px;color:var(--g5)">외박스 사용</label><br><input class="fc" type="number" id="oe_boxes_${i}" value="${item.outerBoxes||0}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
            <div><label style="font-size:11px;color:var(--g5)">파우치 불량 EA</label><br><input class="fc" type="number" id="oe_defp_${i}" value="${item.productDefect||0}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
            <div><label style="font-size:11px;color:var(--g5)">외박스 불량</label><br><input class="fc" type="number" id="oe_boxd_${i}" value="${item.boxDefect||0}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
            <div><label style="font-size:11px;color:var(--g5)">트레이 사용</label><br><input class="fc" type="number" id="oe_tray_${i}" value="${item.trayUsed||0}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
            <div><label style="font-size:11px;color:var(--g5)">잔여 EA</label><br><input class="fc" type="number" id="oe_rem_${i}" value="${item.remainEa||0}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
            <div><label style="font-size:11px;color:var(--g5)">잔여 박스</label><br><input class="fc" type="number" id="oe_remb_${i}" value="${item.remainBoxes||0}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
          </div>
          <div style="margin-bottom:8px"><label style="font-size:11px;color:var(--g5)">비고</label><br><input class="fc" type="text" id="oe_note_${i}" value="${(item.note||'').replace(/"/g,'&quot;')}" style="width:100%;padding:5px 8px;margin-top:2px"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn" onclick="toggleOpEdit(${i})" style="font-size:12px;padding:4px 12px">취소</button>
            <button class="btn bp bsm" onclick="saveOpEdit('${item.fbId}',${i})" style="font-size:12px;padding:4px 12px">💾 저장</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleOpDone(i) {
  const panel = document.getElementById('op_done_panel_'+i);
  const chev  = document.getElementById('op_done_chev_'+i);
  if(!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if(chev) chev.style.transform = open ? '' : 'rotate(90deg)';
}

function toggleOpEdit(i) {
  const el = document.getElementById('op_edit_'+i);
  if(el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function saveOpEdit(fbId, i) {
  if(!fbId){ toast('Firebase ID 없음','d'); return; }
  const g = id => document.getElementById(id);
  const fields = {
    innerEa:       parseInt(g('oe_inner_'+i).value)||0,
    outerEa:       parseInt(g('oe_outer_'+i).value)||0,
    outerBoxes:    parseInt(g('oe_boxes_'+i).value)||0,
    productDefect: parseInt(g('oe_defp_'+i).value)||0,
    boxDefect:     parseInt(g('oe_boxd_'+i).value)||0,
    trayUsed:      parseInt(g('oe_tray_'+i).value)||0,
    remainEa:      parseInt(g('oe_rem_'+i).value)||0,
    remainBoxes:   parseInt(g('oe_remb_'+i).value)||0,
    note:          g('oe_note_'+i).value||'',
  };
  // defectRate 재계산
  fields.defectRate = fields.innerEa > 0 ? parseFloat((fields.productDefect/fields.innerEa*100).toFixed(2)) : 0;
  try {
    const fsFields = {};
    Object.entries(fields).forEach(([k,v]) => {
      fsFields[k] = typeof v === 'string' ? {stringValue:v} : {doubleValue:v};
    });
    await db.collection('outerpacking').doc(fbId).update(fields);
    fbClearCache('outerpacking');
    toast('수정 저장 완료 ✓','s');
    toggleOpEdit(i);
    loadOuterPacking();
  } catch(e) {
    console.error(e);
    toast('저장 실패: '+e.message,'d');
  }
}
