// ============================================================
// AI 분석 (Gemini API) — 사용자 기간 선택 → 모든 데이터 분석
// ============================================================
// v1.0 — 2026-05-05
// 의존: fbGetByDate, addDays, tod, toast

const _AI_GEMINI_KEY = 'AIzaSyCA1KDDSrRddu_jqIEBsURRUVs8z_TC8eo';
const _AI_GEMINI_MODEL = 'gemini-2.5-flash'; // 무료 티어 안정 (1.5는 deprecated)

// 도메인 룰 — AI에 컨텍스트로 보냄 (사용자분 명시 룰 + 도메인 지식)
const _AI_DOMAIN_CONTEXT = `
당신은 순수본 2공장 스마트팩토리 시스템의 데이터 분석 AI입니다.

[공정 흐름]
해동기(barcode) → 방혈(thawing) → 전처리(preprocess) → 자숙(cooking) → 파쇄(shredding) → 포장(packing) → 외포장(outerpacking)

[부위]
설도, 홍두깨(=홍두께), 우둔
※ 메추리알 장조림 등은 noMeat 제품 (원육 흐름 외)

[정상 범위 기준]
- 원육수율(완제품 원육 / 원육 투입): 50~58% 정상, 50% 미만 = 주의
- 자숙 손실률: 15~22% 정상
- 파쇄 손실률: 0~5% 정상
- 부적합 바코드 비율: 1% 이하 정상

[중요 도메인 룰]
- thawing.cart = 해동대차 번호 (wagon 필드는 폐기됨)
- thawing 시작 시간 = 'YYYY-MM-DD HH:MM' 형식
- 같은 날 여러 record = 다중 cart/탱크 동시 작업 (정상)

[분석 시 중점]
1. 수율 trend (전월/전주 대비)
2. 이상치 탐지 (평균 대비 벗어나는 날)
3. 시간대/요일 패턴
4. 부위별 효율 차이
5. 부적합 패턴
6. 공정 간 KG 흐름 손실률
7. 인적 생산성 (인시당 EA)

[보고서 형식]
- 핵심 지표 (수치)
- 발견한 문제 (구체적, 데이터 근거 명시)
- 권장 액션 (실행 가능한)
- 한국어로 작성
- 마크다운 형식 (제목, 표, 글머리 기호 활용)
`.trim();

// AI 분석 버튼 클릭 → 데이터 수집 + Gemini 호출
async function runAIAnalysis() {
  const fromEl = document.getElementById('ai_from');
  const toEl = document.getElementById('ai_to');
  const resultEl = document.getElementById('ai_result');
  const btnEl = document.getElementById('ai_run_btn');
  
  if(!fromEl || !toEl || !resultEl) {
    if(typeof toast === 'function') toast('AI 분석 화면 오류','d');
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
  
  // 기간 너무 길면 차단 (토큰 폭발 방지)
  const days = Math.round((new Date(to+'T00:00:00') - new Date(from+'T00:00:00'))/86400000) + 1;
  if(days > 35) {
    if(typeof toast === 'function') toast('기간이 너무 깁니다 (최대 35일)','d');
    return;
  }
  
  btnEl.disabled = true;
  btnEl.textContent = '데이터 수집 중...';
  resultEl.innerHTML = '<div style="padding:20px;color:#666;text-align:center">📊 데이터 수집 중...</div>';
  
  try {
    // 1) 모든 컬렉션 데이터 수집
    const collections = ['thawing','preprocess','cooking','shredding','packing','sauce','outerpacking','barcode'];
    const allData = {};
    
    for(const col of collections) {
      allData[col] = [];
      let cur = from;
      while(cur <= to) {
        try {
          const recs = await fbGetByDate(col, cur);
          allData[col].push(...recs);
        } catch(e) { /* 해당 날짜 데이터 없음 — 무시 */ }
        cur = addDays(cur, 1);
      }
    }
    
    // 2) 데이터 요약 (토큰 절약)
    const summary = _aiSummarizeData(allData, from, to);
    
    btnEl.textContent = 'AI 분석 중...';
    resultEl.innerHTML = '<div style="padding:20px;color:#666;text-align:center">🤖 AI 분석 중... (10~30초)</div>';
    
    // 3) Gemini API 호출
    const prompt = _AI_DOMAIN_CONTEXT + '\n\n[분석 대상 기간]\n' + from + ' ~ ' + to + ' (' + days + '일)\n\n[데이터]\n' + JSON.stringify(summary, null, 2) + '\n\n위 데이터를 분석하여 보고서를 작성해주세요.';
    
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + _AI_GEMINI_MODEL + ':generateContent?key=' + _AI_GEMINI_KEY;
    const apiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        contents: [{parts: [{text: prompt}]}],
        generationConfig: {
          temperature: 0.3,  // 일관성 높음
          maxOutputTokens: 4000
        }
      })
    });
    
    if(!apiRes.ok) {
      const err = await apiRes.text();
      throw new Error('API 호출 실패: ' + apiRes.status + ' ' + err.slice(0,200));
    }
    
    const apiData = await apiRes.json();
    const aiText = apiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if(!aiText) {
      throw new Error('AI 응답 없음 (안전 필터 또는 토큰 한도)');
    }
    
    // 4) 결과 표시 (마크다운 → HTML 간단 변환)
    const html = _aiMarkdownToHtml(aiText);
    resultEl.innerHTML = `
      <div style="padding:16px;background:#f8fafc;border-radius:8px;margin-bottom:12px">
        <div style="font-size:12px;color:#64748b;margin-bottom:6px">분석 기간: ${from} ~ ${to} (${days}일) · 데이터 건수: ${_aiCountRecords(allData)}건</div>
        <div style="font-size:12px;color:#64748b">생성: ${new Date().toLocaleString('ko-KR')}</div>
      </div>
      <div class="ai-report" style="line-height:1.7;font-size:14px">${html}</div>
      <div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e">
        ⚠️ AI 분석 결과는 참고용입니다. 중요 결정은 반드시 사용자분이 검증해주세요.
      </div>
    `;
    
    if(typeof toast === 'function') toast('AI 분석 완료','s');
    
  } catch(e) {
    console.error('[AI 분석 오류]', e);
    resultEl.innerHTML = `<div style="padding:20px;background:#fef2f2;color:#991b1b;border-radius:8px">
      ❌ 분석 실패<br><br>오류: ${e.message || e}<br><br>
      <span style="font-size:12px;color:#666">잠시 후 다시 시도하거나, 기간을 줄여보세요.</span>
    </div>`;
    if(typeof toast === 'function') toast('AI 분석 실패','d');
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = '🤖 AI 분석 시작';
  }
}

// 데이터 요약 — 토큰 절약. 주요 필드만 추출.
function _aiSummarizeData(allData, from, to) {
  const s = {기간: {from, to}, 컬렉션별_건수: {}, 데이터: {}};
  
  // thawing: 핵심 필드만
  s.컬렉션별_건수.thawing = allData.thawing.length;
  s.데이터.thawing = allData.thawing.map(r => ({
    date: r.date, type: r.type, cart: r.cart || r.wagon || '',
    totalKg: r.totalKg, remainKg: r.remainKg,
    start: r.start, end: r.end
  }));
  
  // preprocess
  s.컬렉션별_건수.preprocess = allData.preprocess.length;
  s.데이터.preprocess = allData.preprocess.map(r => ({
    date: r.date, type: r.type, kg: r.kg, cage: r.cage,
    workers: r.workers, start: r.start, end: r.end, waste: r.waste
  }));
  
  // cooking
  s.컬렉션별_건수.cooking = allData.cooking.length;
  s.데이터.cooking = allData.cooking.map(r => ({
    date: r.date, type: r.type, kg: r.kg, tank: r.tank,
    workers: r.workers, start: r.start, end: r.end
  }));
  
  // shredding
  s.컬렉션별_건수.shredding = allData.shredding.length;
  s.데이터.shredding = allData.shredding.map(r => ({
    date: r.date, type: r.type, kg: r.kg,
    wagonIn: r.wagonIn, wagonOut: r.wagonOut, cartOut: r.cartOut,
    workers: r.workers, start: r.start, end: r.end, waste: r.waste
  }));
  
  // packing
  s.컬렉션별_건수.packing = allData.packing.length;
  s.데이터.packing = allData.packing.map(r => ({
    date: r.date, product: r.product, ea: r.ea, kg: r.kg,
    defect: r.defect, pouch: r.pouch, workers: r.workers,
    start: r.start, end: r.end
  }));
  
  // sauce
  s.컬렉션별_건수.sauce = allData.sauce.length;
  s.데이터.sauce = allData.sauce.map(r => ({
    date: r.date, kg: r.kg, type: r.type
  }));
  
  // outerpacking
  s.컬렉션별_건수.outerpacking = allData.outerpacking.length;
  s.데이터.outerpacking = allData.outerpacking.map(r => ({
    date: r.date, product: r.product, boxes: r.boxes, ea: r.ea
  }));
  
  // barcode: 부적합만 + 적합은 합계
  const bcOk = allData.barcode.filter(r => r.status === '적합');
  const bcNg = allData.barcode.filter(r => r.status === '부적합');
  s.컬렉션별_건수.barcode_적합 = bcOk.length;
  s.컬렉션별_건수.barcode_부적합 = bcNg.length;
  s.데이터.barcode_부적합 = bcNg.map(r => ({
    date: r.date, part: r.part, weightKg: r.weightKg,
    reason: r.reason, packDate: r.packDate
  }));
  
  return s;
}

function _aiCountRecords(allData) {
  let total = 0;
  for(const k in allData) total += allData[k].length;
  return total;
}

// 간단 마크다운 → HTML
function _aiMarkdownToHtml(md) {
  let h = md;
  // 헤더
  h = h.replace(/^### (.+)$/gm, '<h3 style="margin-top:18px;color:#1e293b">$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2 style="margin-top:24px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px">$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1 style="margin-top:24px">$1</h1>');
  // 굵게
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // 글머리
  h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.+<\/li>\n?)+/g, m => '<ul style="margin:8px 0;padding-left:24px">' + m + '</ul>');
  // 줄바꿈
  h = h.replace(/\n\n/g, '</p><p style="margin:8px 0">');
  h = '<p style="margin:8px 0">' + h + '</p>';
  return h;
}
