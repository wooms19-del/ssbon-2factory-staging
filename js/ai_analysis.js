// ============================================================
// AI 분석 v3 — Firestore 기반 API 키 (회사 전체 1곳 관리)
// ============================================================

const _AI_GEMINI_MODEL = 'gemini-flash-latest';
let _aiKeyCache = null;  // 메모리 캐시 (한 세션 내 재사용)

// Firestore에서 API 키 조회
async function _aiGetKey() {
  if(_aiKeyCache !== null) return _aiKeyCache;
  try {
    const doc = await firebase.firestore().collection('_config').doc('ai_settings').get();
    if(doc.exists) {
      const k = doc.data().geminiKey || '';
      _aiKeyCache = k;
      return k;
    }
  } catch(e) {
    console.error('[AI] key fetch 실패:', e);
  }
  return '';
}

// Firestore에 API 키 저장
async function _aiSetKey(k) {
  try {
    await firebase.firestore().collection('_config').doc('ai_settings').set({
      geminiKey: k || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    _aiKeyCache = k || '';
    return true;
  } catch(e) {
    console.error('[AI] key 저장 실패:', e);
    return false;
  }
}

// API 키 변경 (설정 화면 버튼)
async function aiKeyChange() {
  const cur = await _aiGetKey();
  const k = prompt(
    'Gemini API 키를 입력하세요\n(https://aistudio.google.com/apikey)\n\n⚠️ Firestore에 저장됩니다. 회사 모든 디바이스가 이 키를 사용합니다.',
    cur
  );
  if(k === null) return;
  const trimmed = String(k).trim();
  if(!trimmed) {
    if(typeof toast === 'function') toast('빈 키는 저장 안 됨','d');
    return;
  }
  if(!trimmed.startsWith('AIza')) {
    if(typeof toast === 'function') toast('Gemini API 키 형식이 아닙니다 (AIza... 시작)','d');
    return;
  }
  const ok = await _aiSetKey(trimmed);
  if(ok) {
    if(typeof toast === 'function') toast('API 키 저장 완료','s');
    aiKeyRefresh();
  } else {
    if(typeof toast === 'function') toast('저장 실패','d');
  }
}

// API 키 삭제
async function aiKeyClear() {
  if(!confirm('API 키를 삭제하시겠습니까?\n삭제 후엔 AI 분석 사용 불가합니다.')) return;
  const ok = await _aiSetKey('');
  if(ok) {
    if(typeof toast === 'function') toast('API 키 삭제 완료','s');
    aiKeyRefresh();
  }
}

// API 키 상태 새로고침
async function aiKeyRefresh() {
  const el = document.getElementById('ai_key_status');
  if(!el) return;
  _aiKeyCache = null;  // 캐시 무효화 후 fresh fetch
  el.textContent = '확인 중...';
  const k = await _aiGetKey();
  if(k) {
    const masked = k.slice(0, 8) + '...' + k.slice(-4);
    el.innerHTML = `<span style="color:#059669;font-weight:600">✓ 설정됨</span> <span style="color:#94a3b8;margin-left:8px">${masked}</span>`;
  } else {
    el.innerHTML = `<span style="color:#dc2626;font-weight:600">✗ 미설정</span> <span style="color:#94a3b8;margin-left:8px">"API 키 변경" 버튼으로 설정</span>`;
  }
}

// 설정 탭 진입 시 자동 호출 (acc-ai 펼칠 때)
function _aiAutoRefreshOnTab() {
  if(document.getElementById('ai_key_status')) aiKeyRefresh();
}

const _AI_PROMPT_TEMPLATE = `
당신은 순수본 2공장 스마트팩토리의 데이터 분석 AI입니다. 임원(대표) 보고용 분석 결과를 JSON 형식으로만 응답하세요.

[공정 흐름]
해동기(barcode) → 방혈(thawing) → 전처리(preprocess) → 자숙(cooking) → 파쇄(shredding) → 포장(packing) → 외포장(outerpacking)

[부위] 설도, 홍두깨, 우둔 / noMeat 제품: 메추리알 등

[정상 범위]
- 원육수율: 50~58%
- 자숙 손실률: 15~22%
- 부적합률: 1% 이하

[중요 룰]
- thawing.cart = 해동대차 번호 (wagon 필드는 폐기됨)
- 수율 = (packing kg 합계) / (thawing totalKg 합계) × 100

[분석 시점]
이미 시스템이 계산한 KPI는 정확합니다. 당신의 역할:
1. 데이터 패턴 발견
2. 이상치 식별
3. 원인 추정
4. 실행 가능한 액션 제안

[응답 형식 — JSON만, 다른 텍스트 절대 X]
{
  "headline": "한 줄 결론 (15자 이내)",
  "subhead": "헤드라인 부연 설명 (60자 이내)",
  "kpis": [
    {"label": "평균 수율", "value": "50.9%", "changeType": "down|up|flat", "change": "▼ 2.3%p (전월비)"}
  ],
  "diagnosis": "AI 진단 본문. '~한 것으로 보입니다' 톤. 데이터 근거 명시. 80~150자.",
  "dailyYields": [
    {"date": "4/1", "value": 54.2, "isAnomaly": false}
  ],
  "partYields": [
    {"part": "설도", "value": 53.4}
  ],
  "defectReasons": [
    {"label": "소비기한 판독실패", "count": 8}
  ],
  "actions": [
    {"priority": "최우선", "text": "구체적 액션"}
  ]
}

priority: "최우선" / "중요" / "참고" 중 하나.
changeType: "up" / "down" / "flat" 중 하나.
부적합률 올라감 = changeType "down" (나쁜 방향).
JSON만 반환. 마크다운 블록 X. 설명 텍스트 X.
`.trim();

async function runAIAnalysis() {
  const fromEl = document.getElementById('ai_from');
  const toEl = document.getElementById('ai_to');
  const resultEl = document.getElementById('ai_result');
  const btnEl = document.getElementById('ai_run_btn');
  
  if(!fromEl || !toEl || !resultEl) {
    if(typeof toast === 'function') toast('AI 분석 화면 오류','d');
    return;
  }
  
  // Firestore에서 API key 조회
  const apiKey = await _aiGetKey();
  if(!apiKey) {
    resultEl.innerHTML = `<div style="padding:20px;background:#fef3c7;border-radius:8px;color:#92400e">
      ⚠️ API 키가 설정되지 않았습니다.<br><br>
      <b>분석 → 설정 탭 → 🤖 AI 설정</b> 아코디언에서 API 키를 입력해주세요.<br>
      <span style="font-size:12px;color:#a16207">발급: https://aistudio.google.com/apikey</span>
    </div>`;
    return;
  }
  
  const from = fromEl.value;
  const to = toEl.value;
  
  if(!from || !to) {
    if(typeof toast === 'function') toast('기간을 선택하세요','d');
    return;
  }
  if(from > to) {
    if(typeof toast === 'function') toast('시작일이 종료일보다 늦습니다','d');
    return;
  }
  
  const days = Math.round((new Date(to+'T00:00:00') - new Date(from+'T00:00:00'))/86400000) + 1;
  if(days > 35) {
    if(typeof toast === 'function') toast('기간이 너무 깁니다 (최대 35일)','d');
    return;
  }
  
  btnEl.disabled = true;
  btnEl.textContent = '데이터 수집 중...';
  resultEl.innerHTML = '<div style="padding:30px;color:#666;text-align:center;font-size:14px">📊 데이터 수집 중...</div>';
  
  try {
    const collections = ['thawing','preprocess','cooking','shredding','packing','sauce','outerpacking','barcode'];
    const allData = {};
    for(const col of collections) {
      allData[col] = [];
      let cur = from;
      while(cur <= to) {
        try {
          const recs = await fbGetByDate(col, cur);
          allData[col].push(...recs);
        } catch(e) { /* skip */ }
        cur = addDays(cur, 1);
      }
    }
    
    const computedKpis = _aiComputeKpis(allData);
    
    btnEl.textContent = 'AI 분석 중...';
    resultEl.innerHTML = '<div style="padding:30px;color:#666;text-align:center;font-size:14px">🤖 AI 분석 중... (10~30초)</div>';
    
    const aiInput = {
      기간: { from, to, days },
      검증된_KPI: computedKpis,
      // 부위별 그날 작업량만 (raw 큰 array 제거)
      방혈_일별_부위별: _aiGroupByDateAndType(allData.thawing),
      포장_일별_제품별: _aiGroupByDateAndProduct(allData.packing),
      // 부적합만 raw (보통 적은 건수)
      부적합_바코드: allData.barcode
        .filter(r => r.status === '부적합')
        .map(r => ({ date: r.date, part: r.part, reason: r.reason, packDate: r.packDate }))
        .slice(0, 50)  // 최대 50건
    };
    
    const prompt = _AI_PROMPT_TEMPLATE + '\n\n[데이터]\n' + JSON.stringify(aiInput, null, 2);
    
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + _AI_GEMINI_MODEL + ':generateContent?key=' + apiKey;
    const apiRes = await _aiFetchWithRetry(apiUrl, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        contents: [{parts: [{text: prompt}]}],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4000,
          responseMimeType: 'application/json'
        }
      })
    }, 3);
    
    if(!apiRes.ok) {
      const err = await apiRes.text();
      throw new Error('API 호출 실패: ' + apiRes.status + ' ' + err.slice(0,200));
    }
    
    const apiData = await apiRes.json();
    const aiText = apiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if(!aiText) throw new Error('AI 응답 없음');
    
    let report;
    try {
      // aiText가 이미 객체일 수도, 문자열일 수도 있음
      if(typeof aiText === 'object' && aiText !== null) {
        report = aiText;
      } else {
        // 문자열 — 코드블록/공백 정리 후 파싱
        let cleaned = String(aiText).trim();
        // ```json ... ``` 또는 ``` ... ``` 제거
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        // 첫 { 부터 마지막 } 까지만 추출 (앞뒤 잡문 제거)
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if(firstBrace >= 0 && lastBrace > firstBrace) {
          cleaned = cleaned.slice(firstBrace, lastBrace + 1);
        }
        report = JSON.parse(cleaned);
      }
    } catch(e) {
      console.error('[AI] JSON 파싱 실패:', e.message, '\n원본:', aiText);
      throw new Error('AI 응답이 JSON 형식이 아닙니다 (' + e.message + ')');
    }
    
    if(!report || typeof report !== 'object') {
      throw new Error('AI 응답이 객체가 아닙니다');
    }
    
    _renderAIReport(resultEl, report, from, to, days, _aiCountRecords(allData));
    
    if(typeof toast === 'function') toast('AI 분석 완료','s');
    
  } catch(e) {
    console.error('[AI 분석 오류]', e);
    resultEl.innerHTML = `<div style="padding:20px;background:#fef2f2;color:#991b1b;border-radius:8px">
      ❌ 분석 실패<br><br>${e.message || e}<br><br>
      <span style="font-size:12px;color:#666">잠시 후 다시 시도하거나, 기간을 줄여보세요.</span>
    </div>`;
    if(typeof toast === 'function') toast('AI 분석 실패','d');
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = '🤖 AI 분석 시작';
  }
}

function _aiComputeKpis(allData) {
  const r2 = v => Math.round(v*100)/100;
  
  const totalRmKg = r2(allData.thawing.reduce((s,r) => s + (parseFloat(r.totalKg)||0), 0));
  const totalPkKg = r2(allData.packing.reduce((s,r) => s + (parseFloat(r.kg)||0), 0));
  const totalEa = allData.packing.reduce((s,r) => s + (parseInt(r.ea)||0), 0);
  const avgYield = totalRmKg > 0 ? r2(totalPkKg / totalRmKg * 100) : 0;
  
  const totalBc = allData.barcode.length;
  const ngBc = allData.barcode.filter(r => r.status === '부적합').length;
  const defectRate = totalBc > 0 ? r2(ngBc / totalBc * 100) : 0;
  
  const dailyMap = {};
  allData.thawing.forEach(r => {
    const d = String(r.date||'').slice(0,10);
    if(!dailyMap[d]) dailyMap[d] = {rmKg:0, pkKg:0};
    dailyMap[d].rmKg += parseFloat(r.totalKg)||0;
  });
  allData.packing.forEach(r => {
    const d = String(r.date||'').slice(0,10);
    if(!dailyMap[d]) dailyMap[d] = {rmKg:0, pkKg:0};
    dailyMap[d].pkKg += parseFloat(r.kg)||0;
  });
  const dailyYields = Object.keys(dailyMap).sort().map(d => ({
    date: d.slice(5).replace('-','/'),
    value: dailyMap[d].rmKg > 0 ? r2(dailyMap[d].pkKg / dailyMap[d].rmKg * 100) : 0,
    rmKg: r2(dailyMap[d].rmKg),
    pkKg: r2(dailyMap[d].pkKg)
  }));
  
  const totalMh = allData.packing.reduce((s,r) => {
    const w = parseFloat(r.workers)||0;
    const dur = _aiDurH(r.start, r.end);
    return s + w * dur;
  }, 0);
  const eaPerMh = totalMh > 0 ? r2(totalEa / totalMh) : 0;
  
  return {
    총_원육_kg: totalRmKg,
    총_포장_원육_kg: totalPkKg,
    총_생산_EA: totalEa,
    평균_수율_pct: avgYield,
    부적합률_pct: defectRate,
    부적합_건수: ngBc,
    바코드_총_건수: totalBc,
    인시당_EA: eaPerMh,
    일별_수율: dailyYields
  };
}

function _aiDurH(s, e) {
  if(!s || !e) return 0;
  const _hm = t => String(t).length>5 ? String(t).slice(-5) : String(t).slice(0,5);
  const tm = t => { const p = _hm(t).split(':'); return +p[0]*60 + (+p[1]||0); };
  let d = tm(e) - tm(s); if(d<0) d += 1440;
  return d/60;
}

function _aiCountRecords(allData) {
  let total = 0;
  for(const k in allData) total += allData[k].length;
  return total;
}

// 일별×부위별 집계 (방혈)
function _aiGroupByDateAndType(thawingArr) {
  const r2 = v => Math.round(v*100)/100;
  const m = {};
  thawingArr.forEach(r => {
    const d = String(r.date||'').slice(0,10);
    const types = (r.type||'').split(',').map(t=>t.trim()).filter(Boolean);
    const perType = (parseFloat(r.totalKg)||0) / (types.length || 1);
    types.forEach(t => {
      const k = d + '|' + t;
      if(!m[k]) m[k] = {date: d.slice(5).replace('-','/'), type: t, kg: 0, count: 0};
      m[k].kg += perType;
      m[k].count++;
    });
  });
  return Object.values(m).map(v => ({...v, kg: r2(v.kg)})).sort((a,b)=>a.date.localeCompare(b.date));
}

// 일별×제품별 집계 (포장)
function _aiGroupByDateAndProduct(packingArr) {
  const r2 = v => Math.round(v*100)/100;
  const m = {};
  packingArr.forEach(r => {
    const d = String(r.date||'').slice(0,10);
    const k = d + '|' + (r.product||'?');
    if(!m[k]) m[k] = {date: d.slice(5).replace('-','/'), product: r.product||'?', ea: 0, kg: 0, defect: 0};
    m[k].ea += parseInt(r.ea)||0;
    m[k].kg += parseFloat(r.kg)||0;
    m[k].defect += parseInt(r.defect)||0;
  });
  return Object.values(m).map(v => ({...v, kg: r2(v.kg)})).sort((a,b)=>a.date.localeCompare(b.date));
}

// 503 자동 재시도 (3회, 점진 backoff)
async function _aiFetchWithRetry(url, options, maxRetry) {
  for(let i = 0; i < maxRetry; i++) {
    const res = await fetch(url, options);
    if(res.ok) return res;
    if(res.status !== 503 && res.status !== 429) return res;  // 다른 오류는 재시도 X
    if(i < maxRetry - 1) {
      const wait = (i+1) * 2000;  // 2초, 4초, 6초
      console.log(`[AI] ${res.status} 재시도 ${i+2}/${maxRetry} (${wait}ms 대기)`);
      await new Promise(r => setTimeout(r, wait));
    } else {
      return res;  // 마지막 시도는 결과 그대로 반환
    }
  }
}

function _renderAIReport(el, r, from, to, days, recCount) {
  const headline = r.headline || '분석 완료';
  const subhead = r.subhead || '';
  const kpis = Array.isArray(r.kpis) ? r.kpis : [];
  const diagnosis = r.diagnosis || '';
  const dailyYields = Array.isArray(r.dailyYields) ? r.dailyYields : [];
  const partYields = Array.isArray(r.partYields) ? r.partYields : [];
  const defectReasons = Array.isArray(r.defectReasons) ? r.defectReasons : [];
  const actions = Array.isArray(r.actions) ? r.actions : [];
  
  const colorByChange = ct => {
    if(ct === 'up') return '#3B6D11';
    if(ct === 'down') return '#A32D2D';
    return '#888780';
  };
  const colorByPriority = p => {
    if(p === '최우선') return {bg:'#FCEBEB', tx:'#791F1F'};
    if(p === '중요') return {bg:'#FAEEDA', tx:'#633806'};
    return {bg:'#E1F5EE', tx:'#04342C'};
  };
  
  const partColors = ['#7F77DD','#1D9E75','#F09595','#378ADD','#FAC775','#B4B2A9'];
  
  el.innerHTML = `
    <div style="padding:8px 0;max-width:880px;margin:0 auto">
      
      <div style="border-bottom:0.5px solid #e5e7eb;padding-bottom:16px;margin-bottom:24px">
        <p style="font-size:12px;color:#9ca3af;margin:0 0 4px">${from} ~ ${to} (${days}일) 생산 보고 · AI 자동 분석</p>
        <h1 style="font-size:22px;font-weight:500;margin:0;color:#0f172a;line-height:1.4">${headline}</h1>
        ${subhead ? `<p style="font-size:13px;color:#64748b;margin:8px 0 0;line-height:1.6">${subhead}</p>` : ''}
      </div>
      
      ${kpis.length > 0 ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
        ${kpis.map(k => `
          <div style="background:#f8fafc;border-radius:8px;padding:14px">
            <p style="font-size:12px;color:#64748b;margin:0 0 6px">${k.label||''}</p>
            <p style="font-size:24px;font-weight:500;margin:0;color:#0f172a">${k.value||'—'}</p>
            <p style="font-size:11px;color:${colorByChange(k.changeType)};margin:2px 0 0">${k.change||''}</p>
          </div>
        `).join('')}
      </div>
      ` : ''}
      
      ${diagnosis ? `
      <div style="background:#eff6ff;border-radius:12px;padding:16px 18px;margin-bottom:24px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:22px;height:22px;border-radius:50%;background:#185FA5;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;flex-shrink:0;margin-top:2px">!</div>
          <div>
            <p style="font-size:14px;font-weight:500;color:#0C447C;margin:0 0 8px">제가 보기엔 이런 문제가 있는 것 같습니다</p>
            <p style="font-size:13px;color:#0C447C;line-height:1.7;margin:0">${diagnosis}</p>
          </div>
        </div>
      </div>
      ` : ''}
      
      ${dailyYields.length > 0 ? `
      <div style="margin-bottom:24px">
        <h2 style="font-size:16px;font-weight:500;margin:0 0 12px;color:#0f172a">일별 수율 추이</h2>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:8px;font-size:12px;color:#64748b">
          <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#378ADD"></span>일별 수율(%)</span>
          <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:#F09595"></span>이상치</span>
        </div>
        <div style="position:relative;width:100%;height:240px">
          <canvas id="aiYieldChart"></canvas>
        </div>
      </div>
      ` : ''}
      
      <div style="display:grid;grid-template-columns:${partYields.length>0 && defectReasons.length>0 ? '1fr 1fr' : '1fr'};gap:16px;margin-bottom:24px">
        ${partYields.length > 0 ? `
        <div>
          <h3 style="font-size:14px;font-weight:500;margin:0 0 10px;color:#0f172a">부위별 수율</h3>
          <div style="position:relative;width:100%;height:200px">
            <canvas id="aiPartChart"></canvas>
          </div>
        </div>
        ` : ''}
        ${defectReasons.length > 0 ? `
        <div>
          <h3 style="font-size:14px;font-weight:500;margin:0 0 10px;color:#0f172a">부적합 사유</h3>
          <div style="position:relative;width:100%;height:200px">
            <canvas id="aiDefChart"></canvas>
          </div>
        </div>
        ` : ''}
      </div>
      
      ${actions.length > 0 ? `
      <div style="background:#fff;border:0.5px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:24px">
        <h2 style="font-size:16px;font-weight:500;margin:0 0 12px;color:#0f172a">권장 액션</h2>
        ${actions.map((a,i) => {
          const c = colorByPriority(a.priority);
          const isLast = i === actions.length - 1;
          return `<div style="display:flex;gap:12px;padding:10px 0;${!isLast ? 'border-bottom:0.5px solid #e5e7eb;' : ''}">
            <span style="background:${c.bg};color:${c.tx};font-size:11px;padding:3px 10px;border-radius:8px;font-weight:500;height:fit-content;flex-shrink:0;white-space:nowrap">${a.priority||'참고'}</span>
            <p style="font-size:13px;color:#0f172a;margin:0;line-height:1.6">${a.text||''}</p>
          </div>`;
        }).join('')}
      </div>
      ` : ''}
      
      <p style="font-size:11px;color:#9ca3af;margin:16px 0 0;text-align:center">생성: ${new Date().toLocaleString('ko-KR')} · 분석 데이터 ${recCount}건 · AI 모델: Gemini Flash</p>
      
      <div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e">
        ⚠️ AI 분석 결과는 참고용입니다. 중요 결정은 반드시 검증해주세요.
      </div>
      
    </div>
  `;
  
  _ensureChartJs(() => {
    if(dailyYields.length > 0) _drawYieldChart(dailyYields);
    if(partYields.length > 0) _drawPartChart(partYields, partColors);
    if(defectReasons.length > 0) _drawDefChart(defectReasons);
  });
}

function _ensureChartJs(cb) {
  if(window.Chart) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
  s.onload = cb;
  s.onerror = () => console.error('[AI] Chart.js 로드 실패');
  document.head.appendChild(s);
}

function _drawYieldChart(data) {
  const ctx = document.getElementById('aiYieldChart');
  if(!ctx) return;
  const colors = data.map(d => d.isAnomaly ? '#F09595' : '#378ADD');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.date),
      datasets: [{ data: data.map(d => d.value), backgroundColor: colors, borderRadius: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: v => v + '%', font: {size:11} }, grid: { color: 'rgba(0,0,0,0.05)' } },
        x: { ticks: { autoSkip: false, maxRotation: 45, font: {size:10} }, grid: { display: false } }
      }
    }
  });
}

function _drawPartChart(data, colors) {
  const ctx = document.getElementById('aiPartChart');
  if(!ctx) return;
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.part),
      datasets: [{ data: data.map(d => d.value), backgroundColor: colors.slice(0, data.length), borderRadius: 2 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { callback: v => v + '%', font: {size:11} } },
        y: { ticks: { font: {size:12} }, grid: { display: false } }
      }
    }
  });
}

function _drawDefChart(data) {
  const ctx = document.getElementById('aiDefChart');
  if(!ctx) return;
  const colors = ['#F09595','#FAC775','#B4B2A9','#7F77DD','#1D9E75'];
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.label),
      datasets: [{ data: data.map(d => d.count), backgroundColor: colors.slice(0, data.length), borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: {size:11}, boxWidth: 10, padding: 8 } }
      },
      cutout: '60%'
    }
  });
}
