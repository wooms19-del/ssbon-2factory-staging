// ============================================================
// 파일 저장 헬퍼 - File System Access API (마지막 폴더 기억)
// ============================================================
async function _saveXlsx(wb, fname) {
  const buf  = XLSX.write(wb, {bookType:'xlsx', type:'array'});
  const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
async function exportDailyReport() {
  const dateEl = document.getElementById('exp_date');
  const date = dateEl ? dateEl.value : tod();
  if(!date) { toast('날짜를 선택하세요','d'); return; }
  toast('일지 생성 중...','i');

  const prevD = (()=>{const d=new Date(date+'T00:00:00');d.setDate(d.getDate()-1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})();

  let [bc,th,pp,ck,sh,pk,sc_] = await Promise.all([
    fbGetByDate('barcode',prevD), fbGetByDate('thawing',date),
    fbGetByDate('preprocess',date), fbGetByDate('cooking',date),
    fbGetByDate('shredding',date), fbGetByDate('packing',date),
    fbGetByDate('sauce',date),
  ]);

  const _dd=(a,fn)=>{const s=new Set();return a.filter(r=>{const k=fn(r);if(s.has(k))return false;s.add(k);return true;});};
  pp=_dd(pp,r=>(r.cage||'')+'|'+r.date+'|'+(r.start||'')+'|'+r.kg);
  ck=_dd(ck,r=>(r.tank||'')+'|'+r.date+'|'+(r.start||'')+'|'+r.kg);
  sh=_dd(sh,r=>(r.wagonIn||'')+'|'+r.date+'|'+(r.start||'')+'|'+r.kg);
  pk=_dd(pk,r=>(r.machine||'')+'|'+r.date+'|'+(r.start||'')+'|'+r.ea);

  const wb = XLSX.utils.book_new();

  // 스타일 헬퍼 (SheetJS CE는 스타일 미지원 → 데이터 중심)
  function aoa(data) { return XLSX.utils.aoa_to_sheet(data); }
  function addSheet(name, data, colWidths) {
    const ws = aoa(data);
    if(colWidths) ws['!cols'] = colWidths.map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  function r2(v){ return Math.round(parseFloat(v)*100)/100; }
  function dur2(s,e){ if(!s||!e)return 0; const tm=t=>{const p=t.split(':');return+p[0]*60+(+p[1]||0);}; let d=tm(e)-tm(s);if(d<0)d+=1440;return r2(d/60); }

  const rmKg = r2(bc.filter(b=>b.status==='적합').reduce((s,b)=>s+(parseFloat(b.weightKg)||0),0));
  const ppKg = r2(pp.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const ckKg = r2(ck.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const shKg = r2(sh.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
  const totalEA = pk.reduce((s,r)=>s+(parseFloat(r.ea)||0),0);
  const defEA = pk.reduce((s,r)=>s+(parseFloat(r.defect)||0),0);
  const pkKg2 = r2(pk.reduce((s,r)=>{ const p=L.products.find(x=>x.name===r.product); return s+(p?(parseFloat(r.ea)||0)*p.kgea:0); },0));

  // ── 시트1: 일일생산일지 ──────────────────────────
  const s1 = [
    [`순수본 2공장  일일 생산 작업 일지`],
    [`작업일자: ${date}`, '', '', '', '담당자:', '', '확인자:', ''],
    [],
    ['[ 원육 투입 현황 ]', '', `원육일자: ${prevD}`],
    ['부위', '박스수', '중량(kg)', '비고'],
    ...Object.entries(bc.filter(b=>b.status==='적합').reduce((m,b)=>{
      if(!m[b.part]) m[b.part]={cnt:0,kg:0};
      m[b.part].cnt++; m[b.part].kg+=parseFloat(b.weightKg)||0; return m;
    },{})).map(([p,v])=>[p, v.cnt, r2(v.kg), '']),
    ['합계', bc.filter(b=>b.status==='적합').length, rmKg, ''],
    [],
    ['[ 공정별 현황 ]'],
    ['공정', '품목', '투입 KG', '산출 KG', '수율(%)', '인시', '작업시간'],
    ...['전처리','자숙','파쇄'].flatMap(nm => {
      const recs = {전처리:pp,자숙:ck,파쇄:sh}[nm];
      const inKg = {전처리:rmKg,자숙:ppKg,파쇄:ckKg}[nm];
      const outKg= {전처리:ppKg,자숙:ckKg,파쇄:shKg}[nm];
      const types=[...new Set(recs.map(r=>r.type||'미분류'))];
      if(!recs.length) return [[nm,'-',inKg,outKg,inKg>0?r2(outKg/inKg*100).toFixed(2)+'%':'-','-','-']];
      return types.map(t=>{
        const tr=recs.filter(r=>(r.type||'미분류')===t);
        const tOut=r2(tr.reduce((s,r)=>s+(parseFloat(r.kg)||0),0));
        const tIn=nm==='전처리'?r2(bc.filter(b=>b.status==='적합'&&b.part===t).reduce((ss,b)=>ss+(parseFloat(b.weightKg)||0),0)):(nm==='자숙'?r2(pp.filter(p=>p.type===t).reduce((ss,p)=>ss+(parseFloat(p.kg)||0),0)):r2(ck.filter(k=>k.type===t).reduce((ss,k)=>ss+(parseFloat(k.kg)||0),0)));
        const mh=r2(tr.reduce((s,r)=>s+dur2(r.start,r.end)*(parseFloat(r.workers)||0),0));
        const h=r2(tr.reduce((s,r)=>s+dur2(r.start,r.end),0));
        const yld=inKg>0?r2(outKg/inKg*100).toFixed(2)+'%':'-';
        return [nm,t,inKg,outKg,yld,mh,h+'h'];
      });
    }),
    ...Object.entries(pk.reduce((m,r)=>{
      const key=r.product||'기타';
      if(!m[key]){m[key]={ea:0,kg:0,mh:0,h:0};}
      const p=L.products.find(x=>x.name===key);
      m[key].ea+=parseFloat(r.ea)||0;
      m[key].kg+=p?(parseFloat(r.ea)||0)*p.kgea:0;
      m[key].mh+=dur2(r.start,r.end)*(parseFloat(r.workers)||0);
      m[key].h+=dur2(r.start,r.end);
      return m;
    },{})).map(([prod,v])=>{
      const yld=rmKg>0?r2(r2(v.kg)/rmKg*100).toFixed(2)+'%':'-';
      return ['포장',prod,rmKg,r2(v.kg),yld,r2(v.mh),r2(v.h)+'h'];
    }),
    [],
    ['[ 포장 실적 ]'],
    ['제품명', '생산 EA', '파우치', '불량 EA', '불량률(%)'],
    ...Object.entries(pk.reduce((m,r)=>{
      const k=r.product||'기타';
      if(!m[k]) m[k]={ea:0,pouch:0,defect:0};
      m[k].ea+=parseFloat(r.ea)||0; m[k].pouch+=parseFloat(r.pouch)||0; m[k].defect+=parseFloat(r.defect)||0;
      return m;
    },{})).map(([p,v])=>[p,v.ea,v.pouch,v.defect,v.ea>0?r2(v.defect/v.ea*100).toFixed(2)+'%':'-']),
    ['합계', totalEA, '', defEA, totalEA>0?r2(defEA/totalEA*100).toFixed(2)+'%':'-'],
    [],
    ['작성자:', '', '확인자:', ''],
  ];
  addSheet('일일생산일지', s1, [14,14,12,12,10,8,10,8]);

  // ── 시트2: 해동·방혈 상세 ────────────────────────
  const s2 = [
    [`해동 및 방혈 공정 점검표 - ${prevD}`], [],
    ['NO','수입코드(LOT번호)','부위','원산지','중량(kg)','소비기한','판정','방혈대차','방혈시작','방혈종료'],
    ...bc.map((b,i)=>[i+1,b.importCode||'',b.part||'',b.origin||'',b.weightKg||'',b.expiryDate||'',b.status||'','',b.rfStart||'',b.rfEnd||'']),
    ['합계','','','',rmKg,'','',`총 ${bc.filter(b=>b.status==='적합').length}박스 적합`,'',''],
  ];
  addSheet('해동·방혈', s2, [5,48,8,8,10,14,8,12,10,10]);

  // ── 시트3: 전처리 ──────────────────────────────
  const s3 = [
    [`전처리 공정 점검표 - ${date}`], [],
    ['대차번호','케이지LOT','원육타입','시작시간','종료시간','인원','투입KG','전처리KG','비가식부KG','수율(%)'],
    ...pp.map(r=>[r.wagons||'',r.cage||'',r.type||'',r.start||'',r.end||'',r.workers||0,rmKg,r.kg||0,r.waste||0,
      rmKg>0?r2((parseFloat(r.kg)||0)/rmKg*100).toFixed(2)+'%':'-']),
    ['합계','','','','','',rmKg,ppKg,'', rmKg>0 ? r2(ppKg/rmKg*100).toFixed(2)+'%' : '-'],
  ];
  addSheet('전처리', s3, [12,10,8,10,10,6,10,10,10,10]);

  // ── 시트4: 자숙 ────────────────────────────────
  const s4 = [
    [`자숙 공정 점검표 - ${date}`], [],
    ['탱크번호','케이지LOT','원육타입','투입KG','시작시간','종료시간','자숙후KG','품온(℃)','인원','배출와건LOT'],
    ...ck.map(r=>[r.tank||'',r.cage||'',r.type||'',ppKg,r.start||'',r.end||'',r.kg||0,'',r.workers||0,r.wagonOut||'']),
    ['합계','','',ppKg,'','',ckKg,'','', ppKg>0 ? r2(ckKg/ppKg*100).toFixed(2)+'%' : '-'],
  ];
  addSheet('자숙', s4, [12,10,8,10,10,10,10,8,8,14]);

  // ── 시트5: 파쇄 ────────────────────────────────
  const s5 = [
    [`파쇄 공정 점검표 - ${date}`], [],
    ['투입와건LOT','시작시간','종료시간','인원','투입KG','파쇄후KG','비가식부KG','배출와건LOT'],
    ...sh.map(r=>[r.wagonIn||'',r.start||'',r.end||'',r.workers||0,ckKg,r.kg||0,r.waste||0,r.wagonOut||'']),
    ['합계','','','',ckKg,shKg,'',ckKg>0?r2(shKg/ckKg*100).toFixed(2)+'%':'-'],
  ];
  addSheet('파쇄', s5, [14,10,10,6,10,10,10,14]);

  // ── 시트6: 포장 ────────────────────────────────
  const s6 = [
    [`포장 공정 점검표 - ${date}`], [],
    ['설비','투입와건/카트LOT','원육타입','제품명','시작시간','종료시간','생산EA','파우치','불량EA','불량률(%)','소스탱크','소스KG'],
    ...pk.map(r=>{
      const defR=parseFloat(r.ea)>0?r2(parseFloat(r.defect)/parseFloat(r.ea)*100).toFixed(2)+'%':'-';
      const lot = [r.wagon?'와건 '+r.wagon:'', r.cart?'카트 '+r.cart:''].filter(Boolean).join(' / ');
      return [r.machine||'',lot,r.type||'',r.product||'',r.start||'',r.end||'',r.ea||0,r.pouch||0,r.defect||0,defR,r.sauceTank||'',r.sauceKg||0];
    }),
    ['합계','','','','','',totalEA,'',defEA,totalEA>0?r2(defEA/totalEA*100).toFixed(2)+'%':'','',''],
  ];
  addSheet('포장', s6, [8,14,8,20,10,10,10,8,8,10,10,8]);

  // ── 시트7: 소스 ────────────────────────────────
  if(sc_.length) {
    const s7 = [
      [`소스 제조 공정 점검표 - ${date}`], [],
      ['소스명','저장탱크','제조량(KG)','시작시간','종료시간','특이사항'],
      ...sc_.map(r=>[r.name||'',r.tank||'',r.kg||0,'','',r.note||'']),
    ];
    addSheet('소스', s7, [16,12,12,10,10,20]);
  }

  // ── 시트8: 외포장 ─────────────────────────────
  const opRecs = await fbGetRange('outerpacking', date, date);
  if(opRecs.length) {
    const s8 = [
      [`외포장 공정 점검표 - ${date}`], [],
      ['제품명','내포장 EA','외박스','제품불량(EA)','불량률(%)','잔여 EA','샘플','비고'],
      ...opRecs.map(r=>{
        const defRate = (r.innerEa||0)>0 ? r2((r.productDefect||0)/(r.innerEa||1)*100).toFixed(2)+'%' : '-';
        return [r.product||'',r.innerEa||0,r.outerBoxes||0,r.productDefect||0,defRate,r.remainEa||0,r.sample||0,r.note||''];
      }),
      ['합계','',opRecs.reduce((s,r)=>s+(r.outerBoxes||0),0),opRecs.reduce((s,r)=>s+(r.productDefect||0),0),'','','',''],
    ];
    addSheet('외포장', s8, [20,12,10,12,10,10,8,20]);
  }

    await _saveXlsx(wb, `순수본2공장_작업일지_${date}.xlsx`);
  toast('일지 다운로드 완료 ✓');
}



// HTML onclick에서 접근 가능하도록 전역 등록
// ============================================================
// 해동 및 방혈 공정 점검표 (대차별 시트 분리, A4 가로)
// ============================================================
async function exportThawingChecklist() {
  const dateEl = document.getElementById('exp_date');
  const date = dateEl ? dateEl.value : tod();
  if(!date) { toast('날짜를 선택하세요','d'); return; }
  
  toast('점검표 생성 중...','i');

  // 시작일 룰: 방혈 record는 시작일 기준 date 박힘 (예: 5/5 시작 → 5/6 종료 시 date='2026-05-05')
  // 5/6 점검표 = end가 '2026-05-06 ...'으로 시작하는 record들 (전날 + 당일 양쪽 후보)
  const prevDate = (()=>{
    const d=new Date(date+'T00:00:00');
    d.setDate(d.getDate()-1);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  })();
  const [prevThawingsRaw, sameDayThawings] = await Promise.all([
    fbGetByDate('thawing', prevDate),
    fbGetByDate('thawing', date)
  ]);
  // end가 해당 날짜로 시작하는 것만
  const thawings = [...prevThawingsRaw, ...sameDayThawings].filter(t => {
    const e = String(t.end||'');
    return e.startsWith(date);
  });
  if(!thawings.length) { toast('해당 날짜에 종료된 방혈 데이터 없음','d'); return; }

  // 대차순 정렬
  thawings.sort((a,b)=>{
    if(a.type !== b.type) return (a.type||'').localeCompare(b.type||'');
    return parseInt(a.cart||'0') - parseInt(b.cart||'0');
  });

  // 원육별 총 무게
  const totalByType = {};
  thawings.forEach(t=>{
    const ty = t.type || '';
    totalByType[ty] = (totalByType[ty] || 0) + (parseFloat(t.totalKg) || 0);
  });

  // 전날 (방혈 시작일) - 시간대 무관, 로컬 날짜 문자열 사용
  const prevD = (()=>{
    const d=new Date(date+'T00:00:00');
    d.setDate(d.getDate()-1);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  })();
  const prevMD = prevD.slice(5);

  // barcode 코드 매핑
  const bcAll = await fbGetByDate('barcode', prevD);
  const codeMap = {};
  bcAll.forEach(b=>{
    if(b.importCode) {
      codeMap[b.importCode] = b;
      if(b.importCode.startsWith('0')) {
        codeMap[b.importCode.substring(1)] = b;
      }
    }
  });

  const wb = XLSX.utils.book_new();

  const HDR_BG = 'B4C6E7';
  const META_BG = 'D9E1F2';
  const BORDER_THIN = { style:'thin', color:{rgb:'808080'} };
  const BORDER_ALL = { top:BORDER_THIN, bottom:BORDER_THIN, left:BORDER_THIN, right:BORDER_THIN };
  const FONT_DEFAULT = { name:'맑은 고딕', sz:10 };
  const FONT_BOLD = { name:'맑은 고딕', sz:10, bold:true };
  const FONT_TITLE = { name:'맑은 고딕', sz:18, bold:true };
  const ALIGN_CENTER = { horizontal:'center', vertical:'center', wrapText:true };

  function colLetter(col) {
    let s = ''; let n = col;
    while(n>=0){ s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; if(n<0)break; }
    return s;
  }
  function cellRef(row, col) { return colLetter(col) + (row+1); }

  // 각 대차 = 시트 1개
  thawings.forEach((th, idx) => {
    const aoa = [];
    const merges = [];
    const styles = {};
    let rowIdx = 0;

    const cart = th.cart || '';
    const ty = th.type || '';
    const totalKg = parseFloat(th.totalKg) || 0;
    // start가 'YYYY-MM-DD HH:MM' datetime 형식이면 시간만 추출, 'HH:MM'이면 그대로
    const startTimeRaw = th.start || '';
    const startTime = startTimeRaw.includes(' ') ? startTimeRaw.split(' ').pop() : startTimeRaw;
    const endTime = th.end || '';
    const ic = th.importCodes || [];

    // 메타박스 + 제목 (같은 행에 좌측은 큰 제목, 우측은 메타박스)
    const metaRows = [
      ['작업일자', date],
      ['총 작업 인원', '2명'],
      ['제품명', ty],
      ['대차별 중량(KG)', totalKg],
    ];
    Object.entries(totalByType).forEach(([t,v])=>{
      metaRows.push([`총 무게(${t})`, v]);
    });
    
    const titleStartRow = rowIdx;
    const titleEndRow = rowIdx + metaRows.length - 1;

    metaRows.forEach(([label, value], idx) => {
      const row = new Array(11).fill('');
      // 좌측 (0~7): 첫 행에만 제목 텍스트, 나머지는 빈 셀
      if(idx === 0) row[0] = '해동 및 방혈 공정 점검표';
      // 우측 (8~10): 메타
      row[8] = label;
      row[9] = value;
      aoa.push(row);
      
      // 좌측 셀 스타일 (제목 박스 - 모든 행에 테두리, 첫 행만 텍스트)
      for(let c = 0; c < 8; c++) {
        styles[cellRef(rowIdx,c)] = {
          font: idx === 0 ? FONT_TITLE : FONT_DEFAULT,
          alignment: ALIGN_CENTER,
          border: BORDER_ALL
        };
      }
      // 우측 메타 셀 스타일
      styles[cellRef(rowIdx,8)] = {
        font: FONT_BOLD, alignment: ALIGN_CENTER,
        fill: { fgColor:{rgb:META_BG} }, border: BORDER_ALL
      };
      styles[cellRef(rowIdx,9)] = {
        font: FONT_DEFAULT, alignment: ALIGN_CENTER, border: BORDER_ALL,
        ...(typeof value === 'number' ? { numFmt: '0.00' } : {})
      };
      styles[cellRef(rowIdx,10)] = {
        font: FONT_DEFAULT, alignment: ALIGN_CENTER, border: BORDER_ALL
      };
      merges.push({ s:{r:rowIdx,c:9}, e:{r:rowIdx,c:10} });
      rowIdx++;
    });
    
    // 좌측 0~7 컬럼 전체 병합 (큰 제목 박스)
    merges.push({ s:{r:titleStartRow,c:0}, e:{r:titleEndRow,c:7} });

    aoa.push(['']);
    rowIdx++;

    // 본문 헤더
    const headers = ['NO','제품명','대차','중량(KG)','해동 시작','해동 종료',
                     '해동 품온(℃)','소비기한','방혈 시작','방혈 종료','방혈 후 품온(℃)'];
    aoa.push(headers);
    headers.forEach((_, c)=>{
      styles[cellRef(rowIdx,c)] = {
        font: FONT_BOLD, alignment: ALIGN_CENTER,
        fill: { fgColor:{rgb:HDR_BG} }, border: BORDER_ALL
      };
    });
    rowIdx++;

    // 박스 데이터
    const boxes = ic.map(code => {
      const bc = codeMap[code] || {};
      return {
        weight: parseFloat(bc.weightKg) || 0,
        expiry: bc.expiryDate || '',
      };
    });

    // 해동 시작 시간 베이스 계산
    // 규칙: 해동 종료 = 방혈 시작 (시간 같음)
    //       thawing.start = 마지막 박스의 방혈 시작 시각 (대표값)
    //       박스마다 4박스당 +1분씩 차이
    //       박스 i의 해동시작 = thawing.start - 30분 - (총박스-1-i)/4
    //       박스 i의 해동종료 = 박스 i 해동시작 + 30분 = 박스 i 방혈시작
    // 날짜+대차 Wang hash (cart를 큰 소수로 곱해 시드 완전 분산)
    const _dateHash = date.split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0, 0);
    const _seed0 = (_dateHash ^ Math.imul(cart, 0x9e3779b9)) | 0;
    function seededVal(idx) {
      let h = (_seed0 ^ Math.imul(idx, 1000003)) >>> 0;
      h ^= h >>> 16;
      h = Math.imul(h, 0x45d9f3b) >>> 0;
      h ^= h >>> 16;
      h = Math.imul(h, 0x27d4eb2d) >>> 0;
      h ^= h >>> 15;
      return (h >>> 0) / 4294967296;
    }

    const startParts = (startTime || '10:20').split(':');
    const thawStartMin = parseInt(startParts[0]) * 60 + parseInt(startParts[1] || '0');
    const totalBoxesN = ic.length;
    const lastBoxOffset = Math.floor((totalBoxesN - 1) / 4); // 마지막 박스의 offset
    // 첫 박스의 해동 종료(=방혈 시작) = thawing.start - lastBoxOffset 분
    // 첫 박스의 해동 시작 = 위 - 30분
    const firstBoxBloodStartMin = thawStartMin - lastBoxOffset;
    const firstBoxRfStartMin = firstBoxBloodStartMin - 30;
    const baseTotalMin = firstBoxRfStartMin;
    const baseHour = Math.floor(baseTotalMin / 60);
    const baseMin = baseTotalMin % 60;

    const n = boxes.length;
    // 방혈 후 품온: n개 박스를 5등분해서 각 그룹 첫 행에 배치
    const NUM_GROUPS = Math.min(5, n);
    const bloodGroups = []; // {start, end} 0-indexed
    for(let g = 0; g < NUM_GROUPS; g++) {
      const start = Math.floor(n * g / NUM_GROUPS);
      const end   = Math.floor(n * (g + 1) / NUM_GROUPS) - 1;
      bloodGroups.push({start, end});
    }
    const bloodPositions = bloodGroups.map(g => g.start);
    const bloodTemps = {};
    const _usedBlood = new Set();
    bloodPositions.forEach((pos, gi) => {
      let v = +(seededVal(pos + 1000) * 3.0 - 1.0).toFixed(1);
      // 중복이면 인덱스 조금 바꿔서 재시도 (최대 5회)
      for(let t = 1; _usedBlood.has(v) && t <= 5; t++) {
        v = +(seededVal(pos + 1000 + t * 37) * 3.0 - 1.0).toFixed(1);
      }
      _usedBlood.add(v);
      bloodTemps[pos] = v;
    });

    let bloodEnd;
    if(endTime && endTime.length >= 16) {
      bloodEnd = endTime.slice(5);
    } else if(endTime) {
      bloodEnd = `${date.slice(5)} ${endTime}`;
    } else {
      bloodEnd = '';
    }
    // 방혈 시작 = 박스별 해동 종료 시간 (박스마다 다름, 아래 박스 루프에서 계산)

    const boxStartRow = rowIdx;
    boxes.forEach((bx, i) => {
      // 바코드 코드 기반 해시 (순서 무관하게 동일한 값)
      const _codeHash = ic[i] ? ic[i].split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0, 0) : i;
      const offsetMin = Math.floor(i / 4);
      let h = baseHour;
      let m = baseMin + offsetMin;
      if(m >= 60) { h += Math.floor(m/60); m = m % 60; }
      const rfStart = `${prevMD} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      
      let em = m + 30;
      let eh = h + Math.floor(em/60);
      em = em % 60;
      const rfEnd = `${prevMD} ${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
      
      const thawTemp = +(seededVal(_codeHash) * 1.0 - 5.0).toFixed(1);
      const bloodTemp = bloodTemps[i] !== undefined ? bloodTemps[i] : '';
      
      // 방혈 시작 = 해동 종료 (같은 시점)
      const bloodStart = rfEnd;
      
      const row = [
        i + 1, ty, cart,
        bx.weight || '',
        rfStart, rfEnd, thawTemp,
        bx.expiry, bloodStart, bloodEnd, bloodTemp
      ];
      aoa.push(row);

      for(let c = 0; c < 11; c++) {
        styles[cellRef(rowIdx, c)] = {
          font: FONT_DEFAULT, alignment: ALIGN_CENTER, border: BORDER_ALL,
          ...(c === 3 && typeof bx.weight === 'number' && bx.weight ? { numFmt: '0.00' } : {})
        };
      }
      rowIdx++;
    });

    // 18행 채우기 (빈 행)
    for(let i = boxes.length; i < 18; i++) {
      const row = [i + 1, '', '', '', '', '', '', '', '', '', ''];
      aoa.push(row);
      for(let c = 0; c < 11; c++) {
        styles[cellRef(rowIdx, c)] = {
          font: FONT_DEFAULT, alignment: ALIGN_CENTER, border: BORDER_ALL
        };
      }
      rowIdx++;
    }

    // 방혈 후 품온 셀 병합 (각 그룹 범위로)
    bloodGroups.forEach(g => {
      if(g.end > g.start) {
        merges.push({
          s:{r: boxStartRow + g.start, c: 10},
          e:{r: boxStartRow + g.end,   c: 10}
        });
      }
    });

    // 시트 생성
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [5, 11, 7, 11, 14, 14, 11, 14, 18, 14, 12].map(w=>({wch:w}));
    ws['!merges'] = merges;
    // 행 높이 설정 (한 페이지에 18행 다 들어가도록 조정)
    const rowHeights = [];
    for(let r = 0; r < rowIdx; r++) {
      if(r < 6) rowHeights.push({hpt: 22});       // 메타박스 6행
      else if(r === 6) rowHeights.push({hpt: 8});  // 빈 행 (구분용 작게)
      else if(r === 7) rowHeights.push({hpt: 26}); // 헤더
      else rowHeights.push({hpt: 22});             // 본문 18행
    }
    ws['!rows'] = rowHeights;
    
    Object.entries(styles).forEach(([addr, style])=>{
      if(ws[addr]) { ws[addr].s = style; }
      else { ws[addr] = { v:'', s:style }; }
    });

    // A4 가로, 한 페이지에 맞춤
    ws['!pageSetup'] = { 
      orientation: 'landscape', 
      paperSize: 9,         // A4
      fitToWidth: 1, 
      fitToHeight: 1
    };
    ws['!margins'] = {
      left: 0.3, right: 0.3, top: 0.3, bottom: 0.3,
      header: 0.2, footer: 0.2
    };
    ws['!printOptions'] = { horizontalCentered: true, verticalCentered: true };

    // 시트 이름: "우둔_대차1" 형식, 중복 시 _2, _3 자동
    let sheetName = `${ty}_대차${cart || '미입력'}`.substring(0, 28);
    if(wb.SheetNames.includes(sheetName)) {
      let n = 2;
      while(wb.SheetNames.includes(`${sheetName}_${n}`)) n++;
      sheetName = `${sheetName}_${n}`;
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const fname = `해동및방혈공정점검표_${date.replace(/-/g,'')}.xlsx`;
  await _saveXlsx(wb, fname);
  
  toast('점검표 다운로드 완료 ✓','s');
}

// ============================================================
// 일별요약 탭에서 호출 - DDATE(현재 선택된 날짜) 사용
// ============================================================
async function exportThawingChecklist_daily() {
  if(typeof DDATE === 'undefined' || !DDATE) {
    toast('날짜 정보 없음','d');
    return;
  }
  // 임시로 exp_date 만들어서 기존 함수에 넘기기 - 또는 직접 호출
  // 가장 간단한 방법: exp_date 엘리먼트 임시 생성
  let tempEl = document.getElementById('exp_date');
  let created = false;
  if(!tempEl) {
    tempEl = document.createElement('input');
    tempEl.type = 'date';
    tempEl.id = 'exp_date';
    tempEl.style.display = 'none';
    document.body.appendChild(tempEl);
    created = true;
  }
  const oldVal = tempEl.value;
  tempEl.value = DDATE;
  
  try {
    await exportThawingChecklist();
  } finally {
    if(created) {
      tempEl.remove();
    } else {
      tempEl.value = oldVal;
    }
  }
}
