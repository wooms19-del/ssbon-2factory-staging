// ============================================================
// AI 분석 v3 — Firestore 기반 API 키 (회사 전체 1곳 관리)
// ============================================================

const _AI_GEMINI_MODEL = 'gemini-flash-latest';
let _aiKeyCache = null;  // 메모리 캐시 (한 세션 내 재사용)
let _aiKnowledgeCache = null;  // 도메인 지식 캐시 (탭 유지 동안)

// 도메인 지식 MD 파일들 — GitHub raw URL에서 fetch
const _AI_KNOWLEDGE_FILES = [
  'https://raw.githubusercontent.com/wooms19-del/ssbon-2factory/main/docs/ai_knowledge/01_%EA%B3%B5%EC%A0%95%EC%9B%90%EB%A6%AC.md',
  'https://raw.githubusercontent.com/wooms19-del/ssbon-2factory/main/docs/ai_knowledge/02_%EC%A7%84%EB%8B%A8%EB%A3%B0%EB%B6%81.md',
  'https://raw.githubusercontent.com/wooms19-del/ssbon-2factory/main/docs/ai_knowledge/03_%EA%B3%B5%EC%9E%A5%ED%8A%B9%EC%88%98%EC%A0%95%EB%B3%B4.md',
  'https://raw.githubusercontent.com/wooms19-del/ssbon-2factory/main/docs/ai_knowledge/04_%EC%82%AC%EA%B3%A0%EC%BC%80%EC%9D%B4%EC%8A%A4.md',
  'https://raw.githubusercontent.com/wooms19-del/ssbon-2factory/main/docs/ai_knowledge/05_%EC%BD%94%EB%93%9C%EB%A7%B5.md'
];

async function _aiGetKnowledgeBase() {
  if(_aiKnowledgeCache !== null) return _aiKnowledgeCache;
  try {
    const texts = await Promise.all(_AI_KNOWLEDGE_FILES.map(async url => {
      try {
        const r = await fetch(url);
        if(!r.ok) return '';
        return await r.text();
      } catch(e) {
        console.warn('[AI] knowledge fetch fail:', url, e);
        return '';
      }
    }));
    _aiKnowledgeCache = texts.filter(Boolean).join('\n\n---\n\n');
    console.log('[AI] 도메인 지식 로드 완료:', _aiKnowledgeCache.length, '자');
    return _aiKnowledgeCache;
  } catch(e) {
    console.error('[AI] knowledge fetch error:', e);
    return '';
  }
}

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
- thawing.totalKg = 그날 그 cart에 배정된 박스 총 중량
- packing.ea = 완제품 개수
- packing.kg 필드는 존재하지 않음. 포장된 원육 kg는 시스템이 (ea × 제품별 kg/EA)로 계산함.
- 시스템이 계산한 "검증된_KPI" 안의 평균_수율_pct 값을 그대로 사용하세요.
- 일별_수율 배열 = 작업이 있던 날만 포함됨 (생산 없는 날=주말/공휴일은 자동 제외).
- 작업일수 = 실제 생산이 있던 날의 수. "기간 N일" 대신 "작업일수 X일"로 보고하세요.
- 수율 0%면 "데이터 누락"이 아니라 "그 기간 포장 작업이 없거나 제품 레시피 매칭 실패"일 수 있음.

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
    // ★ fbGetRange로 일괄 fetch (60배 절감)
    await Promise.all(collections.map(async col => {
      try {
        allData[col] = await fbGetRange(col, from, to) || [];
      } catch(e) {
        allData[col] = [];
      }
    }));
    
    // ★ 진행중 설비 있는 날짜는 분석에서 제외 (수율 왜곡 방지)
    let pendingPk = [];
    try {
      pendingPk = await fbGetRange('packing_pending', from, to) || [];
    } catch(e) {}
    const pendingDates = new Set();
    pendingPk.forEach(r => {
      const d = String(r.date||'').slice(0,10);
      if(d) pendingDates.add(d);
    });
    if(pendingDates.size > 0){
      collections.forEach(col => {
        allData[col] = allData[col].filter(r => {
          const d = String(r.date||'').slice(0,10);
          return !pendingDates.has(d);
        });
      });
      console.log('[AI] 진행중 날짜 제외:', [...pendingDates]);
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
    
    const knowledgeBase = await _aiGetKnowledgeBase();
    const causalInstruction = `
[중요 — 분석 사고 순서 (반드시 이 순서로 사고)]
1. 증상 식별: 어떤 수치가 비정상인가? (정상 범위와 비교)
2. 영향 받는 공정 특정: 어느 단계 데이터인가?
3. 상류 공정 역추적: 그 위 공정에서 시작된 문제인가?
   - 예: 수율 저하 + 전처리 비가식부 多 → 원물 품질 의심
   - 예: 자숙 손실 多 → 해동/자숙 시간 또는 온도
4. 패턴 검증: 특정 부위/날짜/공급처에 집중되는가?
5. 근본 원인 추정 + 구체적 액션 3가지

[절대 금지 패턴]
- "모니터링 하세요" 같은 추상적 액션 금지
- 증상만 보고 표면적 조언 금지
- 정확한 수치 + 정상 범위 비교 없이 결론 금지

[필수 출력 항목]
- 정확한 수치 + 정상 범위
- 상류 공정의 영향 가능성
- 3가지 구체적 액션 (점검할 것, 확인할 것, 수정할 것)
`;
    const prompt = (knowledgeBase ? '[도메인 지식]\n' + knowledgeBase + '\n\n' : '') 
                 + _AI_PROMPT_TEMPLATE + '\n\n' 
                 + causalInstruction + '\n\n'
                 + '[데이터]\n' + JSON.stringify(aiInput, null, 2);
    
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + _AI_GEMINI_MODEL + ':generateContent?key=' + apiKey;
    const apiRes = await _aiFetchWithRetry(apiUrl, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        contents: [{parts: [{text: prompt}]}],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8000,  // v11: 4000 → 8000 (응답 잘림 방지)
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
    const finishReason = apiData.candidates?.[0]?.finishReason;
    
    if(!aiText) throw new Error('AI 응답 없음');
    if(finishReason === 'MAX_TOKENS') {
      console.warn('[AI] 응답 토큰 한도 도달 (MAX_TOKENS) — 일부 잘릴 수 있음');
    }
    
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
    
    _renderAIReport(resultEl, report, from, to, days, _aiCountRecords(allData), computedKpis.작업일수 || 0);
    
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
  
  // 총 원육 (방혈)
  const totalRmKg = r2(allData.thawing.reduce((s,r) => s + (parseFloat(r.totalKg)||0), 0));
  
  // ★ 진짜 수율 계산: packing.ea × 제품별 kg/EA = 포장된 원육 kg
  const products = (typeof L !== 'undefined' && L && Array.isArray(L.products)) ? L.products : [];
  const _kgEaOf = pname => {
    const p = products.find(x => x.name === pname);
    return p ? (parseFloat(p.kgea)||0) : 0;
  };
  
  const totalPkRawKg = r2(allData.packing.reduce((s,r) => {
    const ea = parseFloat(r.ea)||0;
    return s + ea * _kgEaOf(r.product);
  }, 0));
  
  const totalEa = allData.packing.reduce((s,r) => s + (parseInt(r.ea)||0), 0);
  const totalDefect = allData.packing.reduce((s,r) => s + (parseInt(r.defect)||0), 0);
  
  // 원육수율
  const avgYield = totalRmKg > 0 ? r2(totalPkRawKg / totalRmKg * 100) : 0;
  
  // 포장 불량률
  const pkDefectRate = totalEa > 0 ? r2(totalDefect / totalEa * 100) : 0;
  
  // 바코드 부적합률
  const totalBc = allData.barcode.length;
  const ngBc = allData.barcode.filter(r => r.status === '부적합').length;
  const bcDefectRate = totalBc > 0 ? r2(ngBc / totalBc * 100) : 0;
  
  // 일별 수율 (날짜별 rmKg와 packEA×kgEA 매칭)
  // ★ 생산 없는 날 (thawing 0건 AND packing 0건) 자동 제외
  const dailyMap = {};
  const dailyCount = {};  // 날짜별 record 건수 추적
  allData.thawing.forEach(r => {
    const d = String(r.date||'').slice(0,10);
    if(!dailyMap[d]) dailyMap[d] = {rmKg:0, pkRawKg:0, ea:0};
    if(!dailyCount[d]) dailyCount[d] = {th:0, pk:0};
    dailyMap[d].rmKg += parseFloat(r.totalKg)||0;
    dailyCount[d].th++;
  });
  allData.packing.forEach(r => {
    const d = String(r.date||'').slice(0,10);
    if(!dailyMap[d]) dailyMap[d] = {rmKg:0, pkRawKg:0, ea:0};
    if(!dailyCount[d]) dailyCount[d] = {th:0, pk:0};
    const ea = parseFloat(r.ea)||0;
    dailyMap[d].pkRawKg += ea * _kgEaOf(r.product);
    dailyMap[d].ea += ea;
    dailyCount[d].pk++;
  });
  
  // 작업 있는 날만 (thawing 또는 packing 둘 중 하나라도 있으면 포함)
  const dailyYields = Object.keys(dailyMap)
    .filter(d => (dailyCount[d].th + dailyCount[d].pk) > 0)
    .sort()
    .map(d => ({
      date: d.slice(5).replace('-','/'),
      value: dailyMap[d].rmKg > 0 ? r2(dailyMap[d].pkRawKg / dailyMap[d].rmKg * 100) : 0,
      rmKg: r2(dailyMap[d].rmKg),
      pkRawKg: r2(dailyMap[d].pkRawKg),
      ea: dailyMap[d].ea
    }));
  
  // 작업일수 (생산 있던 날)
  const workDays = Object.keys(dailyCount).filter(d => 
    (dailyCount[d].th + dailyCount[d].pk) > 0
  ).length;
  
  // 인시당 EA
  const totalMh = allData.packing.reduce((s,r) => {
    const w = parseFloat(r.workers)||0;
    const dur = _aiDurH(r.start, r.end);
    return s + w * dur;
  }, 0);
  const eaPerMh = totalMh > 0 ? r2(totalEa / totalMh) : 0;
  
  return {
    총_원육_kg: totalRmKg,
    총_포장_원육_kg: totalPkRawKg,
    총_생산_EA: totalEa,
    평균_수율_pct: avgYield,
    포장_불량률_pct: pkDefectRate,
    포장_불량_건수: totalDefect,
    바코드_부적합률_pct: bcDefectRate,
    바코드_부적합_건수: ngBc,
    바코드_총_건수: totalBc,
    인시당_EA: eaPerMh,
    작업일수: workDays,
    일별_수율: dailyYields,
    제품_레시피_등록수: products.length
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
  const m = {};
  packingArr.forEach(r => {
    const d = String(r.date||'').slice(0,10);
    const k = d + '|' + (r.product||'?');
    if(!m[k]) m[k] = {date: d.slice(5).replace('-','/'), product: r.product||'?', ea: 0, defect: 0};
    m[k].ea += parseInt(r.ea)||0;
    m[k].defect += parseInt(r.defect)||0;
  });
  return Object.values(m).sort((a,b)=>a.date.localeCompare(b.date));
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

function _renderAIReport(el, r, from, to, days, recCount, workDays) {
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
        <p style="font-size:12px;color:#9ca3af;margin:0 0 4px">${from} ~ ${to} (${days}일 중 작업 ${workDays}일) · AI 자동 분석</p>
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

// ============================================================
// 💬 챗봇 기능 (Firestore 대화 이력 저장)
// ============================================================

const _CHAT_COL = '_ai_chat';  // Firestore 컬렉션
const _CHAT_DEVICE_ID = (function(){
  // 디바이스별 대화는 분리되지 않음 — 회사 통합 대화방
  return 'shared';
})();

let _aiChatHistory = [];  // 메모리 캐시

async function _loadChatHistory() {
  const logEl = document.getElementById('aiChatLog');
  if(!logEl) return;
  logEl.innerHTML = '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">대화 이력 불러오는 중...</div>';
  try {
    const snap = await firebase.firestore()
      .collection(_CHAT_COL)
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get();
    _aiChatHistory = [];
    snap.forEach(doc => {
      const d = doc.data();
      _aiChatHistory.push({role: d.role, text: d.text, createdAt: d.createdAt});
    });
    _renderChatLog();
  } catch(e) {
    console.warn('[chat] history load fail:', e);
    logEl.innerHTML = '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">대화를 시작하세요. 도메인 지식 + 회사 데이터 기반으로 답변합니다.</div>';
  }
}
window._loadChatHistory = _loadChatHistory;

function _renderChatLog() {
  const logEl = document.getElementById('aiChatLog');
  if(!logEl) return;
  if(_aiChatHistory.length === 0) {
    logEl.innerHTML = '<div style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">대화를 시작하세요. 도메인 지식 + 회사 데이터 기반으로 답변합니다.</div>';
    return;
  }
  logEl.innerHTML = _aiChatHistory.map(m => {
    const isUser = m.role === 'user';
    const bgColor = isUser ? '#6366f1' : '#fff';
    const textColor = isUser ? '#fff' : '#0f172a';
    const align = isUser ? 'flex-end' : 'flex-start';
    const icon = isUser ? '👤' : '🤖';
    const escText = (m.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');

    // 첨부 표시 (사용자 메시지만)
    let attachHtml = '';
    if(isUser && Array.isArray(m.attachments) && m.attachments.length){
      const items = m.attachments.map(a => {
        const icon = a.kind==='image' ? '🖼️' : a.kind==='spreadsheet' ? '📊' : '📄';
        return `<span style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:4px;padding:2px 6px;font-size:11px;margin:2px 2px 0 0">${icon} ${a.name}</span>`;
      }).join('');
      attachHtml = `<div style="margin-bottom:4px">${items}</div>`;
    }

    return `
      <div style="display:flex;justify-content:${align};margin-bottom:10px">
        <div style="max-width:80%;padding:10px 14px;background:${bgColor};color:${textColor};border-radius:10px;border:${isUser?'none':'1px solid #e5e7eb'};box-shadow:0 1px 2px rgba(0,0,0,0.03)">
          <div style="font-size:11px;opacity:0.7;margin-bottom:4px">${icon} ${isUser?'사용자':'AI'}</div>
          ${attachHtml}
          <div>${escText}</div>
        </div>
      </div>
    `;
  }).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

// ============================================================
// 챗봇 파일 첨부 기능 (이미지/엑셀/CSV/PDF/텍스트)
// ============================================================
let _aiChatAttachments = [];  // [{name, type, content/dataURL, size, kind: 'image'|'text'|'spreadsheet'}]

async function _aiChatHandleFiles(event){
  const files = Array.from(event.target.files || []);
  if(!files.length) return;

  for(const file of files){
    // 5MB 제한 (Gemini Flash 입력 제한 + 사용자 경험)
    if(file.size > 5 * 1024 * 1024){
      alert(`파일 너무 큼: ${file.name} (${(file.size/1024/1024).toFixed(1)}MB > 5MB)`);
      continue;
    }
    try {
      const att = await _aiProcessFile(file);
      if(att) _aiChatAttachments.push(att);
    } catch(e){
      console.error('파일 처리 오류', e);
      alert(`파일 처리 실패: ${file.name} — ${e.message}`);
    }
  }
  _aiRenderAttachPreview();
  // input 리셋 (같은 파일 다시 첨부 가능하도록)
  event.target.value = '';
}
window._aiChatHandleFiles = _aiChatHandleFiles;

async function _aiProcessFile(file){
  const name = file.name;
  const type = (file.type || '').toLowerCase();
  const ext = name.split('.').pop().toLowerCase();

  // 1) 이미지 → base64 (Gemini multimodal)
  if(type.startsWith('image/')){
    const dataURL = await _aiReadAsDataURL(file);
    const base64 = dataURL.split(',')[1];
    return {
      name, kind:'image', mimeType: type, size: file.size,
      base64: base64, previewURL: dataURL
    };
  }

  // 2) 엑셀 / CSV → 텍스트 (시트별 표)
  if(['xlsx','xls','csv','tsv'].includes(ext)){
    const text = await _aiReadSpreadsheet(file);
    return {
      name, kind:'spreadsheet', size: file.size, text: text
    };
  }

  // 3) 텍스트 파일 (txt, md, json, log 등)
  if(type.startsWith('text/') || ['txt','md','json','log','csv'].includes(ext)){
    const text = await _aiReadAsText(file);
    return {
      name, kind:'text', size: file.size, text: text.slice(0, 100000)
    };
  }

  // 4) PDF → 텍스트 추출 시도 (간단히 base64로 보내고 AI에게 OCR 시도하게)
  if(ext === 'pdf' || type === 'application/pdf'){
    const dataURL = await _aiReadAsDataURL(file);
    const base64 = dataURL.split(',')[1];
    return {
      name, kind:'image', mimeType: 'application/pdf', size: file.size,
      base64: base64, previewURL: null
    };
  }

  // 기타 — 텍스트로 시도
  try {
    const text = await _aiReadAsText(file);
    return { name, kind:'text', size: file.size, text: text.slice(0, 100000) };
  } catch(e){
    throw new Error('지원하지 않는 파일 형식: ' + ext);
  }
}

function _aiReadAsDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일 읽기 실패'));
    r.readAsDataURL(file);
  });
}

function _aiReadAsText(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일 읽기 실패'));
    r.readAsText(file, 'UTF-8');
  });
}

async function _aiReadSpreadsheet(file){
  const ext = file.name.split('.').pop().toLowerCase();
  if(ext === 'csv' || ext === 'tsv'){
    return await _aiReadAsText(file);
  }
  // XLSX → 시트별로 텍스트 변환
  if(typeof XLSX === 'undefined'){
    throw new Error('XLSX 라이브러리 미로드');
  }
  const arrayBuffer = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일 읽기 실패'));
    r.readAsArrayBuffer(file);
  });
  const wb = XLSX.read(new Uint8Array(arrayBuffer), {type:'array'});
  const parts = [];
  for(const sheetName of wb.SheetNames){
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if(csv && csv.trim()){
      parts.push(`=== 시트: ${sheetName} ===\n${csv.slice(0, 30000)}`);
    }
  }
  return parts.join('\n\n');
}

function _aiRenderAttachPreview(){
  const el = document.getElementById('aiChatAttachPreview');
  if(!el) return;
  if(!_aiChatAttachments.length){
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'block';
  const items = _aiChatAttachments.map((a, idx) => {
    const icon = a.kind==='image' ? (a.mimeType==='application/pdf' ? '📕' : '🖼️')
                : a.kind==='spreadsheet' ? '📊' : '📄';
    const sizeKB = (a.size/1024).toFixed(1);
    const preview = (a.kind==='image' && a.previewURL)
      ? `<img src="${a.previewURL}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:6px">`
      : '';
    return `
      <span style="display:inline-flex;align-items:center;gap:4px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:4px 8px;margin:2px;font-size:12px">
        ${preview}${icon} ${a.name} <span style="color:#94a3b8">(${sizeKB}KB)</span>
        <button onclick="_aiRemoveAttachment(${idx})" style="background:none;border:none;color:#dc2626;font-weight:700;cursor:pointer;padding:0 4px;font-size:14px">×</button>
      </span>
    `;
  });
  el.innerHTML = `<div style="margin-bottom:4px;color:#475569;font-weight:600">첨부 (${_aiChatAttachments.length}개):</div>${items.join('')}`;
}
window._aiRemoveAttachment = function(idx){
  _aiChatAttachments.splice(idx, 1);
  _aiRenderAttachPreview();
};

// ============================================================
// Agent 도구 정의 (Gemini function calling)
// ============================================================
const _AGENT_TOOLS = [{
  functionDeclarations: [
    {
      name: 'get_data_by_date',
      description: '특정 날짜 또는 날짜 범위의 공정 데이터를 Firestore에서 조회합니다. 오늘/어제/특정날짜/기간 질문에 사용.',
      parameters: {
        type: 'OBJECT',
        properties: {
          collections: {
            type: 'ARRAY',
            items: { type: 'STRING', enum: ['thawing','preprocess','cooking','shredding','packing','outerpacking','sauce'] },
            description: '조회할 컬렉션 목록. 질문에 맞게 필요한 것만 선택.'
          },
          start_date: { type: 'STRING', description: 'YYYY-MM-DD 형식 시작일' },
          end_date:   { type: 'STRING', description: 'YYYY-MM-DD 형식 종료일. 단일 날짜면 start_date와 동일하게.' }
        },
        required: ['collections','start_date','end_date']
      }
    },
    {
      name: 'get_open_processes',
      description: '현재 진행 중(미종료) 공정 조회. 자숙/포장 진행 중인 거 있는지 확인할 때 사용.',
      parameters: {
        type: 'OBJECT',
        properties: {
          targets: {
            type: 'ARRAY',
            items: { type: 'STRING', enum: ['cooking','packing','thawing'] },
            description: '조회할 미종료 공정'
          }
        },
        required: ['targets']
      }
    },
    {
      name: 'get_monthly_summary',
      description: '월별 집계 데이터 조회. 이번달/저번달/특정월 생산 총합 질문에 사용.',
      parameters: {
        type: 'OBJECT',
        properties: {
          year_month: { type: 'STRING', description: 'YYYY-MM 형식. 예: 2026-05' }
        },
        required: ['year_month']
      }
    }
  ]
}];

// Agent 도구 실행기 — AI가 선택한 함수를 실제로 Firestore에서 실행
async function _agentRunTool(name, args) {
  try {
    if(name === 'get_data_by_date') {
      const cols = args.collections || [];
      const results = {};
      await Promise.all(cols.map(async col => {
        if(args.start_date === args.end_date) {
          results[col] = await fbGetByDate(col, args.start_date) || [];
        } else {
          results[col] = await fbGetRange(col, args.start_date, args.end_date) || [];
        }
      }));
      return _agentFormatData(results, args.start_date, args.end_date);
    }
    if(name === 'get_open_processes') {
      const results = {};
      const targets = args.targets || [];
      if(targets.indexOf('cooking')>=0)  results.cooking  = await fbGetOpenCooking()  || [];
      if(targets.indexOf('packing')>=0)  results.packing  = await fbGetOpenPacking()  || [];
      if(targets.indexOf('thawing')>=0)  results.thawing  = await fbGetOpenThawing()  || [];
      return _agentFormatOpen(results);
    }
    if(name === 'get_monthly_summary') {
      const ym = args.year_month;
      const start = ym + '-01';
      const end   = ym + '-31';
      const cols = ['thawing','preprocess','cooking','shredding','packing','outerpacking'];
      const results = {};
      await Promise.all(cols.map(async col => {
        results[col] = await fbGetRange(col, start, end) || [];
      }));
      return _agentFormatMonthly(results, ym);
    }
    return '(알 수 없는 도구: ' + name + ')';
  } catch(e) {
    return '(도구 실행 오류: ' + e.message + ')';
  }
}

// 조회 결과 → 텍스트 포맷
function _agentFormatData(data, start, end) {
  const label = start === end ? start : start + ' ~ ' + end;
  const lines = ['[조회결과: ' + label + ']'];
  var cols = Object.keys(data);
  if(cols.length === 0 || cols.every(c => data[c].length === 0)) {
    return '[조회결과: ' + label + '] 해당 기간 데이터 없음';
  }
  cols.forEach(col => {
    var recs = data[col];
    if(!recs.length) return;
    var colLabel = {thawing:'방혈',preprocess:'전처리',cooking:'자숙',shredding:'파쇄',packing:'내포장',outerpacking:'외포장',sauce:'소스'}[col]||col;
    lines.push('\n▶ ' + colLabel + ' (' + recs.length + '건)');
    recs.forEach(r => {
      var parts = [];
      if(r.date)    parts.push('날짜:'+r.date);
      if(r.inKg)    parts.push('투입:'+r.inKg+'kg');
      if(r.outKg)   parts.push('산출:'+r.outKg+'kg');
      if(r.totalKg) parts.push('총중량:'+r.totalKg+'kg');
      if(r.boxes)   parts.push('박스:'+r.boxes);
      if(r.ea)      parts.push('EA:'+r.ea);
      if(r.product) parts.push('제품:'+r.product);
      if(r.inedible)parts.push('비가식:'+r.inedible+'kg');
      if(r.defPouch)parts.push('불량:'+r.defPouch);
      if(r.type)    parts.push('종류:'+r.type);
      if(r.start)   parts.push('시작:'+r.start);
      if(r.end)     parts.push('종료:'+(r.end||'진행중'));
      lines.push('  - ' + parts.join(', '));
    });
    // 수율 자동 계산
    if(col==='preprocess'||col==='cooking'||col==='shredding') {
      var inSum = recs.reduce((a,r)=>a+(parseFloat(r.inKg)||0),0);
      var outSum = recs.reduce((a,r)=>a+(parseFloat(r.outKg)||0),0);
      if(inSum>0) lines.push('  ※ 합계: 투입'+inSum.toFixed(1)+'kg → 산출'+outSum.toFixed(1)+'kg (수율'+(outSum/inSum*100).toFixed(1)+'%)');
    }
  });
  return lines.join('\n');
}

function _agentFormatOpen(data) {
  var lines = ['[현재 진행중 공정]'];
  var any = false;
  if(data.cooking && data.cooking.length) {
    any = true;
    lines.push('▶ 자숙 진행중 ' + data.cooking.length + '건:');
    data.cooking.forEach(r => lines.push('  - 시작:' + r.start + ' 투입:' + (r.inKg||'?') + 'kg'));
  }
  if(data.packing && data.packing.length) {
    any = true;
    lines.push('▶ 포장 진행중 ' + data.packing.length + '건:');
    data.packing.forEach(r => lines.push('  - ' + (r.product||'?') + ' 시작:' + r.start));
  }
  if(data.thawing && data.thawing.length) {
    any = true;
    lines.push('▶ 방혈 미종료 ' + data.thawing.length + '건:');
    data.thawing.forEach(r => lines.push('  - ' + r.date + ' ' + (r.type||'') + ' ' + (r.totalKg||'?') + 'kg'));
  }
  if(!any) lines.push('현재 진행 중인 공정 없음');
  return lines.join('\n');
}

function _agentFormatMonthly(data, ym) {
  var lines = ['[' + ym + ' 월간 집계]'];
  var thawKg=0, thawBox=0, preIn=0, preOut=0, ckIn=0, ckOut=0, shrIn=0, shrOut=0, pkEa=0, pkDef=0, outBox=0;
  (data.thawing||[]).forEach(r=>{thawKg+=(parseFloat(r.totalKg)||0);thawBox+=(parseInt(r.boxes)||0);});
  (data.preprocess||[]).forEach(r=>{preIn+=(parseFloat(r.inKg)||0);preOut+=(parseFloat(r.outKg)||0);});
  (data.cooking||[]).forEach(r=>{ckIn+=(parseFloat(r.inKg)||0);ckOut+=(parseFloat(r.outKg)||0);});
  (data.shredding||[]).forEach(r=>{shrIn+=(parseFloat(r.inKg)||0);shrOut+=(parseFloat(r.outKg)||0);});
  (data.packing||[]).forEach(r=>{pkEa+=(parseInt(r.ea)||0);pkDef+=(parseInt(r.defPouch)||0);});
  (data.outerpacking||[]).forEach(r=>{outBox+=(parseFloat(r.outBoxes)||0);});
  if(thawKg>0)  lines.push('방혈: ' + thawBox + '박스 / ' + thawKg.toFixed(0) + 'kg');
  if(preIn>0)   lines.push('전처리: ' + preIn.toFixed(0) + ' → ' + preOut.toFixed(0) + 'kg (수율'+(preOut/preIn*100).toFixed(1)+'%)');
  if(ckIn>0)    lines.push('자숙: '  + ckIn.toFixed(0)  + ' → ' + ckOut.toFixed(0)  + 'kg (수율'+(ckOut/ckIn*100).toFixed(1)+'%)');
  if(shrIn>0)   lines.push('파쇄: '  + shrIn.toFixed(0)  + ' → ' + shrOut.toFixed(0)  + 'kg (수율'+(shrOut/shrIn*100).toFixed(1)+'%)');
  if(pkEa>0)    lines.push('포장: '  + pkEa.toLocaleString() + 'EA (불량'+pkDef+'개/'+(pkEa>0?(pkDef/pkEa*100).toFixed(2):'0')+'%)');
  if(outBox>0)  lines.push('외포장: ' + outBox.toFixed(0) + '박스');
  if(lines.length===1) lines.push('데이터 없음');
  return lines.join('\n');
}

// ============================================================
// 챗봇 전송 — function calling Agent
// ============================================================
async function _sendChatMsg() {
  const input = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiChatSend');
  if(!input) return;
  const text = input.value.trim();
  if(!text && !_aiChatAttachments.length) return;

  const attachInfo = _aiChatAttachments.map(a => ({name:a.name,kind:a.kind,size:a.size}));
  const userText = text || '(파일 첨부)';
  _aiChatHistory.push({role:'user', text:userText, createdAt:new Date(), attachments:attachInfo});
  _renderChatLog();
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;
  sendBtn.textContent = '답변 중...';

  const attachmentsForSend = _aiChatAttachments.slice();
  _aiChatAttachments = [];
  _aiRenderAttachPreview();

  _aiChatHistory.push({role:'assistant', text:'⏳ 분석 중...', createdAt:new Date(), _pending:true});
  _renderChatLog();

  try {
    firebase.firestore().collection(_CHAT_COL).add({
      role:'user', text:text, createdAt:firebase.firestore.FieldValue.serverTimestamp()
    }).catch(e=>console.warn('[chat] save user fail:',e));

    const apiKey = await _aiGetKey();
    if(!apiKey) {
      _aiChatHistory.pop();
      _aiChatHistory.push({role:'assistant', text:'⚠️ Gemini API 키가 설정되지 않았습니다. 분석 → 설정 → 🤖 AI 설정에서 키를 입력하세요.', createdAt:new Date()});
      _renderChatLog();
      return;
    }

    const knowledgeBase = await _aiGetKnowledgeBase();
    const today = (typeof tod==='function') ? tod() : new Date().toISOString().slice(0,10);

    const systemPrompt = `당신은 순수본 2공장 스마트팩토리 AI 어시스턴트입니다. 오늘 날짜: ${today}.

절대 규칙:
1. 반드시 한국어로만 답변. 영어 사용 절대 금지.
2. 날짜/기간/현황/예상/분석 질문 → 반드시 도구 호출해서 실제 데이터 확인 후 답변. 데이터 없이 추측/예상 금지.
3. 데이터 없으면 "해당 날짜 데이터 없음"으로 명시. "probably", "아마도", "예상컨대" 등 추측성 표현 금지.
4. 마크다운 사용 금지. 일반 텍스트만.
5. 수율은 원물 대비 누적 수율로 계산.
6. "오늘", "어제", "이번달" = 오늘(${today}) 기준으로 날짜 계산.
${knowledgeBase ? '\n[도메인 지식]\n' + knowledgeBase : ''}`;

    // Gemini system instruction으로 분리 (user role 대신)
    const apiUrlBase = 'https://generativelanguage.googleapis.com/v1beta/models/' + _AI_GEMINI_MODEL + ':generateContent?key=' + apiKey;
    let attachmentsText = '';
    const inlineParts = [];
    for(const a of attachmentsForSend) {
      if(a.kind==='image') inlineParts.push({inlineData:{mimeType:a.mimeType,data:a.base64}});
      else if(a.kind==='spreadsheet') attachmentsText += '\n\n[첨부 엑셀/CSV: '+a.name+']\n'+a.text;
      else if(a.kind==='text') attachmentsText += '\n\n[첨부 텍스트: '+a.name+']\n'+a.text;
    }

    // 대화 컨텍스트 최근 10턴
    const recent = _aiChatHistory.filter(m=>!m._pending).slice(-11,-1);
    const conversationContext = recent.map(m=>(m.role==='user'?'사용자: ':'AI: ')+m.text).join('\n\n');

    const userMsg = (attachmentsText?'[첨부]\n'+attachmentsText+'\n\n':'')
      + (conversationContext?'[이전 대화]\n'+conversationContext+'\n\n':'')
      + '[질문]\n' + (text||(attachmentsForSend.length?'첨부 파일을 분석해주세요.':''));

    const userParts = [{text: userMsg}, ...inlineParts];

    // ── 1차 호출: AI가 도구 선택
    var contents = [
      {role:'user', parts: userParts}
    ];

    const res1 = await fetch(apiUrlBase, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        system_instruction: {parts:[{text:systemPrompt}]},
        contents,
        tools:_AGENT_TOOLS,
        generationConfig:{temperature:0.3, maxOutputTokens:8000}
      })
    });
    if(!res1.ok) throw new Error('API ' + res1.status + ': ' + (await res1.text()).slice(0,200));
    const d1 = await res1.json();
    console.log('[Agent] 1차 응답:', JSON.stringify(d1).slice(0,500));
    const cand1 = d1.candidates?.[0];
    const parts1 = cand1?.content?.parts || [];
    const finishReason1 = cand1?.finishReason || '';

    // finishReason이 SAFETY/OTHER 등이면 fallback
    if(!parts1.length && finishReason1 && finishReason1 !== 'STOP' && finishReason1 !== 'MAX_TOKENS') {
      throw new Error('Gemini 응답 차단: ' + finishReason1 + (d1.promptFeedback ? ' / ' + JSON.stringify(d1.promptFeedback) : ''));
    }

    // 도구 호출이 있으면 실행 후 2차 호출
    const toolCalls = parts1.filter(p => p.functionCall);
    var aiText;

    if(toolCalls.length > 0) {
      // 로딩 메시지 갱신
      var toolNames = toolCalls.map(p=>({
        get_data_by_date:'데이터 조회',
        get_open_processes:'진행중 공정 조회',
        get_monthly_summary:'월간 집계 조회'
      }[p.functionCall.name]||p.functionCall.name)).join(', ');
      _aiChatHistory[_aiChatHistory.length-1].text = '⏳ ' + toolNames + ' 중...';
      _renderChatLog();

      // 도구 실행
      const toolResults = await Promise.all(toolCalls.map(async p => {
        const result = await _agentRunTool(p.functionCall.name, p.functionCall.args||{});
        return {functionResponse:{name:p.functionCall.name, response:{result}}};
      }));

      // 2차 호출: 도구 결과 + 최종 답변
      // Gemini function calling 포맷: model turn(functionCall) → user turn(functionResponse)
      contents.push({role:'model', parts: parts1});
      contents.push({role:'user', parts: toolResults.map(r => ({functionResponse: r.functionResponse}))});

      console.log('[Agent] 2차 호출 contents 마지막:', JSON.stringify(contents.slice(-2)).slice(0,300));

      const res2 = await fetch(apiUrlBase, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          system_instruction: {parts:[{text:systemPrompt}]},
          contents,
          tools:_AGENT_TOOLS,
          generationConfig:{temperature:0.3, maxOutputTokens:8000}
        })
      });
      if(!res2.ok) throw new Error('API2 ' + res2.status + ': ' + (await res2.text()).slice(0,400));
      const d2 = await res2.json();
      console.log('[Agent] 2차 응답:', JSON.stringify(d2).slice(0,300));
      const cand2 = d2.candidates?.[0];
      aiText = cand2?.content?.parts?.map(p=>p.text||'').join('') || ('(2차 응답 없음: finishReason=' + (cand2?.finishReason||'?') + ')');
    } else {
      // 도구 호출 없이 바로 답변 (코딩 질문, 도메인 지식 기반 등)
      aiText = parts1.map(p=>p.text||'').join('') || '(응답 없음)';
    }

    _aiChatHistory.pop();
    _aiChatHistory.push({role:'assistant', text:aiText.trim(), createdAt:new Date()});
    _renderChatLog();

    firebase.firestore().collection(_CHAT_COL).add({
      role:'assistant', text:aiText.trim(), createdAt:firebase.firestore.FieldValue.serverTimestamp()
    }).catch(e=>console.warn('[chat] save assistant fail:',e));

  } catch(e) {
    console.error('[chat] error:', e);
    _aiChatHistory.pop();
    _aiChatHistory.push({role:'assistant', text:'⚠️ 오류: '+(e.message||'AI 호출 실패'), createdAt:new Date()});
    _renderChatLog();
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.textContent = '전송';
    input.focus();
  }
}
window._sendChatMsg = _sendChatMsg;

// 최근 N일 회사 공정 데이터 fetch + 요약 (한 번에 60일 가져오기는 무거우므로 캐싱)
let _aiDataSummaryCache = null;
let _aiDataSummaryCacheAt = 0;
const _AI_DATA_CACHE_MS = 5 * 60 * 1000;  // 5분 캐시

async function _aiFetchRecentDataSummary(daysBack) {
  // 캐시 유효 시 재사용
  if(_aiDataSummaryCache && (Date.now() - _aiDataSummaryCacheAt) < _AI_DATA_CACHE_MS) {
    return _aiDataSummaryCache;
  }
  try {
    const today = (typeof tod === 'function') ? tod() : new Date().toISOString().slice(0,10);
    const from = (typeof addDays === 'function') ? addDays(today, -daysBack) : today;
    const collections = ['thawing','preprocess','cooking','shredding','packing','outerpacking'];
    const allData = {};
    // ★ fbGetRange 일괄 fetch (각 컬렉션당 1회 호출, 60일×6 = 360회 → 6회)
    await Promise.all(collections.map(async col => {
      try {
        allData[col] = await fbGetRange(col, from, today) || [];
      } catch(e) {
        allData[col] = [];
      }
    }));
    // 일별 요약 생성 (raw 데이터 통째로 보내면 너무 큼)
    const summary = _aiSummarizeForChat(allData, from, today);
    _aiDataSummaryCache = summary;
    _aiDataSummaryCacheAt = Date.now();
    return summary;
  } catch(e) {
    console.warn('[chat] data fetch fail:', e);
    return '(데이터 조회 실패)';
  }
}

// 데이터 → 텍스트 요약 (날짜별 핵심 수치만)
function _aiSummarizeForChat(d, from, to) {
  const lines = [];
  lines.push(`조회 기간: ${from} ~ ${to}`);
  lines.push('');
  
  // 일별 핵심 지표
  const byDate = {};  // {date: {thawing:{boxes,kg,carts:[]}, preprocess:{inKg,outKg}, packing:[{product,ea,def}]}}
  
  d.thawing.forEach(r => {
    const k = (r.date||'').slice(0,10);
    if(!byDate[k]) byDate[k] = {};
    if(!byDate[k].thawing) byDate[k].thawing = {boxes:0, kg:0, types:{}};
    byDate[k].thawing.boxes += parseInt(r.boxes,10)||0;
    byDate[k].thawing.kg += parseFloat(r.totalKg)||0;
    const t = (r.type||'').trim();
    if(t) byDate[k].thawing.types[t] = (byDate[k].thawing.types[t]||0) + (parseInt(r.boxes,10)||0);
  });
  d.preprocess.forEach(r => {
    const k = (r.date||'').slice(0,10);
    if(!byDate[k]) byDate[k] = {};
    if(!byDate[k].preprocess) byDate[k].preprocess = {inKg:0, outKg:0, inedible:0};
    byDate[k].preprocess.inKg += parseFloat(r.inKg)||0;
    byDate[k].preprocess.outKg += parseFloat(r.outKg)||0;
    byDate[k].preprocess.inedible += parseFloat(r.inedible)||0;
  });
  d.cooking.forEach(r => {
    const k = (r.date||'').slice(0,10);
    if(!byDate[k]) byDate[k] = {};
    if(!byDate[k].cooking) byDate[k].cooking = {inKg:0, outKg:0};
    byDate[k].cooking.inKg += parseFloat(r.inKg)||0;
    byDate[k].cooking.outKg += parseFloat(r.outKg)||0;
  });
  d.shredding.forEach(r => {
    const k = (r.date||'').slice(0,10);
    if(!byDate[k]) byDate[k] = {};
    if(!byDate[k].shredding) byDate[k].shredding = {inKg:0, outKg:0, inedible:0};
    byDate[k].shredding.inKg += parseFloat(r.inKg)||0;
    byDate[k].shredding.outKg += parseFloat(r.outKg)||0;
    byDate[k].shredding.inedible += parseFloat(r.inedible)||0;
  });
  d.packing.forEach(r => {
    const k = (r.date||'').slice(0,10);
    if(!byDate[k]) byDate[k] = {};
    if(!byDate[k].packing) byDate[k].packing = [];
    byDate[k].packing.push({
      product: r.product||'',
      ea: parseInt(r.ea,10)||0,
      defPouch: parseInt(r.defPouch,10)||0
    });
  });
  d.outerpacking.forEach(r => {
    const k = (r.date||'').slice(0,10);
    if(!byDate[k]) byDate[k] = {};
    if(!byDate[k].outerpacking) byDate[k].outerpacking = {boxes:0};
    byDate[k].outerpacking.boxes += parseFloat(r.outBoxes)||0;
  });
  
  const dates = Object.keys(byDate).filter(k => k>=from && k<=to).sort();
  lines.push(`총 작업일수: ${dates.length}일`);
  lines.push('');
  lines.push('[일자별 요약]');
  
  dates.forEach(date => {
    const x = byDate[date];
    let line = `${date}: `;
    const parts = [];
    if(x.thawing) {
      const types = Object.entries(x.thawing.types).map(([t,b])=>`${t}${b}박스`).join('/');
      parts.push(`방혈(${x.thawing.boxes}박스/${x.thawing.kg.toFixed(0)}kg${types?', '+types:''})`);
    }
    if(x.preprocess) {
      const yieldPct = x.preprocess.inKg>0 ? ((x.preprocess.outKg/x.preprocess.inKg)*100).toFixed(1) : '-';
      parts.push(`전처리(${x.preprocess.inKg.toFixed(0)}→${x.preprocess.outKg.toFixed(0)}kg수율${yieldPct}%${x.preprocess.inedible?',비가식'+x.preprocess.inedible.toFixed(1)+'kg':''})`);
    }
    if(x.cooking) {
      parts.push(`자숙(${x.cooking.inKg.toFixed(0)}→${x.cooking.outKg.toFixed(0)}kg)`);
    }
    if(x.shredding) {
      parts.push(`파쇄(${x.shredding.inKg.toFixed(0)}→${x.shredding.outKg.toFixed(0)}kg${x.shredding.inedible?',비가식'+x.shredding.inedible.toFixed(1)+'kg':''})`);
    }
    if(x.packing && x.packing.length){
      const ps = x.packing.map(p=>`${p.product}${p.ea}EA${p.defPouch?'/불량'+p.defPouch:''}`).join(',');
      parts.push(`포장(${ps})`);
    }
    if(x.outerpacking) parts.push(`외포장(${x.outerpacking.boxes.toFixed(0)}박스)`);
    lines.push(line + parts.join(' / '));
  });
  
  // 월별 집계
  const monthly = {};
  dates.forEach(date => {
    const ym = date.slice(0,7);
    if(!monthly[ym]) monthly[ym] = {days:0, thawingBoxes:0, thawingKg:0, packingEa:0, defPouch:0};
    monthly[ym].days += 1;
    const x = byDate[date];
    if(x.thawing){ monthly[ym].thawingBoxes += x.thawing.boxes; monthly[ym].thawingKg += x.thawing.kg; }
    if(x.packing) x.packing.forEach(p => { monthly[ym].packingEa += p.ea; monthly[ym].defPouch += p.defPouch; });
  });
  lines.push('');
  lines.push('[월별 집계]');
  Object.keys(monthly).sort().forEach(ym => {
    const m = monthly[ym];
    const defRate = m.packingEa>0 ? ((m.defPouch/m.packingEa)*100).toFixed(2) : '0';
    lines.push(`${ym}: 작업${m.days}일, 방혈${m.thawingBoxes}박스/${m.thawingKg.toFixed(0)}kg, 포장${m.packingEa.toLocaleString()}EA(불량${m.defPouch}/${defRate}%)`);
  });
  
  return lines.join('\n');
}

async function _clearChat() {
  if(!confirm('대화 이력을 모두 삭제하시겠습니까? (Firestore에서도 삭제)')) return;
  try {
    const snap = await firebase.firestore().collection(_CHAT_COL).get();
    const batch = firebase.firestore().batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    _aiChatHistory = [];
    _renderChatLog();
    if(typeof toast === 'function') toast('대화 이력 삭제 완료','i');
  } catch(e) {
    console.error('[chat] clear fail:', e);
    if(typeof toast === 'function') toast('삭제 실패: '+e.message,'d');
  }
}
window._clearChat = _clearChat;
