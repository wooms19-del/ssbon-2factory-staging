// ============================================================
// 출퇴근 관리  js/attendance.js  v6.1  (시간미입력경고)
// 출근버튼 추가 + 복합상태 지원
// ============================================================

const ATT_EMP_KEY = 'att_employees_v1';  // 로컬 캐시 (Firestore 폴백용)
const ATT_EMP_DOC = '_config/attendance_employees';  // Firestore 공유 마스터
const DEFAULT_EMPS = ['김구식','김수영','임혜경','한채현','김정희','안남정','심현주','홍안순',
  '박수경','하대성','홍유순','정현석','김성희','김영선','배현자','김미애','이용범','게이코',
  '유혜선','레티장','김진화','드엉반담','르탄프엉','응우옌반동','응우옌민호앙',
  '응우옌반키','르판하이퐁','판투안안'];

const ATT_SL    = {normal:'정상',checkin:'출근',checkout:'퇴근',early:'조출',overtime:'연장','half-am':'반차(오전)','half-pm':'반차(오후)',quarter:'반반차',annual:'연차',absent:'결근',holiday:'휴무'};
const ATT_ICON  = {normal:'✅',checkin:'🕘',checkout:'🏃',early:'🌅',overtime:'⏰','half-am':'🌓','half-pm':'🌓',quarter:'🌗',annual:'📅',absent:'❌',holiday:'🏖️'};
const ATT_COLOR = {normal:'#2e7d32',checkin:'#1a56db',checkout:'#0277bd',early:'#1565c0',overtime:'#e65100','half-am':'#6a1b9a','half-pm':'#6a1b9a',quarter:'#4a148c',annual:'#ad1457',absent:'#b71c1c',holiday:'#0891b2'};
// 시간 입력 필요 여부
const ATT_NEEDS_IN  = {checkin:true,early:true};
const ATT_NEEDS_OUT = {overtime:true};

let _attDate='', _attRecs={}, _attEmps=[], _attSubTab='input', _attSelStatus='';

// ── 공휴일(휴무) 자동 처리 ───────────────────────────────────────
// _attHolidays: { 'YYYY-MM-DD': '공휴일명' }  Firestore _config/holidays 에 캐싱
let _attHolidays = null;

async function _loadHolidays(){
  if(_attHolidays) return _attHolidays;
  try{
    if(typeof db==='undefined'||!db){ _attHolidays={}; return _attHolidays; }
    var doc = await db.collection('_config').doc('holidays').get();
    var map = (doc.exists && doc.data() && doc.data().map) ? doc.data().map : null;
    var thisYear = new Date().getFullYear();
    var hasThisYear = map && Object.keys(map).some(function(d){ return d.indexOf(thisYear+'-')===0; });
    if(!hasThisYear){
      map = map || {};
      var fetched = await _fetchHolidaysFromApi(thisYear);
      Object.assign(map, fetched);
      try{ await db.collection('_config').doc('holidays').set({ map: map, updatedAt: new Date().toISOString() }); }
      catch(e){ console.warn('[holidays] 저장 실패', e); }
    }
    _attHolidays = map || {};
  }catch(e){ console.warn('[holidays] 로드 실패', e); _attHolidays={}; }
  return _attHolidays;
}

// 외부 무료 API(date.nager.at, 키 불필요)에서 해당 연도 한국 공휴일 가져옴
async function _fetchHolidaysFromApi(year){
  var out = {};
  try{
    var res = await fetch('https://date.nager.at/api/v3/PublicHolidays/'+year+'/KR');
    if(!res.ok) return out;
    var arr = await res.json();
    arr.forEach(function(h){ if(h && h.date) out[h.date] = h.localName || h.name || '공휴일'; });
  }catch(e){ console.warn('[holidays] API 실패', e); }
  return out;
}

function _isHoliday(date){ return !!(_attHolidays && _attHolidays[date]); }
function _holidayName(date){ return (_attHolidays && _attHolidays[date]) || ''; }

// 공휴일이면, 실제 출근한 사람(출퇴근 시간 또는 checkin/early 태그)만 남기고
// 나머지(결근/연차/무기록)는 전부 '휴무'로 처리.
function _applyAutoHoliday(date){
  if(!_isHoliday(date)) return;
  (_attEmps||[]).forEach(function(e){
    var r = _attRecs[e.name];
    var tags = (r && r.tags) || [];
    var worked = (r && (r.inTime || r.outTime)) || tags.indexOf('checkin')>=0 || tags.indexOf('early')>=0;
    if(!worked){
      _attRecs[e.name] = { tags:['holiday'], inTime:'', outTime:'' };
    }
  });
}

async function initAttendance(){
  _attDate=tod();
  // 1) Firestore 마스터 우선 — 디바이스 간 공유
  var loaded = false;
  try{
    var doc = await firebase.firestore().doc(ATT_EMP_DOC).get();
    if(doc.exists){
      var data = doc.data();
      if(data && Array.isArray(data.employees) && data.employees.length){
        _attEmps = data.employees;
        // 로컬 캐시 동기화
        try{ localStorage.setItem(ATT_EMP_KEY, JSON.stringify(_attEmps)); }catch(e){}
        loaded = true;
      }
    }
  }catch(e){ console.error('직원 마스터 로드 오류', e); }

  // 2) Firestore 없으면 localStorage 폴백
  if(!loaded){
    var raw=localStorage.getItem(ATT_EMP_KEY);
    if(raw){
      try{ _attEmps = JSON.parse(raw); loaded = true; }catch(e){}
    }
  }

  // 3) 둘 다 없으면 DEFAULT_EMPS로 초기화 + Firestore에 저장
  if(!loaded || !_attEmps.length){
    _attEmps = DEFAULT_EMPS.map(function(n){return {name:n,annualDays:15,usedDays:0};});
    await _saveAttEmps();
  }

  await _loadAttDate(_attDate);
}

// Firestore + localStorage 동시 저장 (디바이스 간 공유 보장)
async function _saveAttEmps(){
  // 로컬 캐시
  try{ localStorage.setItem(ATT_EMP_KEY, JSON.stringify(_attEmps)); }catch(e){}
  // Firestore 마스터
  try{
    await firebase.firestore().doc(ATT_EMP_DOC).set({
      employees: _attEmps,
      updatedAt: new Date().toISOString()
    });
  }catch(e){ console.error('직원 마스터 저장 오류', e); }
}
function _attDateKey(d){return 'att_day_'+d;}

async function _loadAttDate(date){
  _attDate=date; _attSelStatus='';
  var lbl=document.getElementById('attDateLabel');
  if(lbl)lbl.textContent=_attFmtLabel(date);

  await _loadHolidays();

  // Firebase 우선 - 다른 PC/브라우저에서도 데이터 보존
  try{
    var doc = await firebase.firestore().collection('attendance').doc(date).get();
    if(doc.exists){
      _attRecs = doc.data().records || {};
      _applyAutoHoliday(date);
      localStorage.setItem(_attDateKey(date), JSON.stringify(_attRecs));
      _renderAttAll();
      return;
    }
  }catch(e){console.error('attendance load error', e);}

  // Firebase에 없으면 localStorage 폴백
  var raw=localStorage.getItem(_attDateKey(date));
  _attRecs=raw?JSON.parse(raw):{};
  _applyAutoHoliday(date);
  _renderAttAll();
}
function _attFmtLabel(d){
  var days=['일','월','화','수','목','금','토'];
  var dt=new Date(d);
  return d.slice(5).replace('-','/')+'('+days[dt.getDay()]+')';
}
function attChangeDay(delta){var d=new Date(_attDate);d.setDate(d.getDate()+delta);_loadAttDate(d.toISOString().slice(0,10));}
function attGoToday(){_loadAttDate(tod());}

function attSave(){
  localStorage.setItem(_attDateKey(_attDate),JSON.stringify(_attRecs));
  try{
    var full={};
    var totalWorkers=0,totalAbsent=0,totalAnnual=0,totalEarly=0,totalOvertime=0,totalHoliday=0;
    _attEmps.forEach(function(e){
      var r=_attRecs[e.name]||{tags:[],inTime:'09:00',outTime:'18:00'};
      full[e.name]=r;
      var tags=r.tags||[];
      if(tags.indexOf('absent')>=0)totalAbsent++;
      else if(tags.indexOf('annual')>=0)totalAnnual++;
      else if(tags.indexOf('holiday')>=0)totalHoliday++;
      else totalWorkers++;
      if(tags.indexOf('early')>=0)totalEarly++;
      if(tags.indexOf('overtime')>=0)totalOvertime++;
    });
    firebase.firestore().collection('attendance').doc(_attDate).set({
      date:_attDate,
      records:full,
      summary:{
        totalWorkers:totalWorkers,   // 출근자 수 (결근/연차 제외)
        totalAbsent:totalAbsent,     // 결근자 수
        totalAnnual:totalAnnual,     // 연차자 수
        totalHoliday:totalHoliday,   // 휴무자 수
        totalEarly:totalEarly,       // 조출자 수
        totalOvertime:totalOvertime, // 연장자 수
        totalHeadcount:_attEmps.length // 전체 인원
      },
      updatedAt:new Date().toISOString()
    });
  }catch(e){}
  toast('출퇴근 저장됨 ✓','s');
  _renderAttSummary();
}

function _renderAttAll(){
  _renderAttSummary();
  ['attInputWrap','attMonthlyWrap','attStaffWrap','attReportWrap'].forEach(function(id){var w=document.getElementById(id);if(w)w.style.display='none';});
  var wrapId={input:'attInputWrap',monthly:'attMonthlyWrap',staff:'attStaffWrap',report:'attReportWrap'}[_attSubTab];
  var w=document.getElementById(wrapId);if(w)w.style.display='';
  if(_attSubTab==='input')_renderAttInput();
  if(_attSubTab==='monthly')_attShowMonthly();  // ★ Firebase prefetch + render
  if(_attSubTab==='staff')_renderAttStaff();
  if(_attSubTab==='report')_renderAttReport();
}
function attShowSubTab(tab,el){
  _attSubTab=tab; _attSelStatus='';
  document.querySelectorAll('.att-sub-tab').forEach(function(t){t.classList.remove('on');});
  if(el)el.classList.add('on');
  var sc=document.getElementById('attStaffCount');if(sc)sc.textContent=_attEmps.length;
  _renderAttAll();
}

// ============================================================
// 현황·조출 (파트별 근태현황 + 조출 메시지) — 이미지 양식
// ============================================================
var ATT_PART_ORDER=['실장·파트장','해동/방혈','자숙/배합','파쇄','내포장','외포장','물류','OP','공정QC','기술직선임','AR/도급'];
var _attReportCfg=null;

async function _attLoadReportCfg(){
  if(_attReportCfg)return _attReportCfg;
  _attReportCfg={requiredHeadcount:0, note:''};
  try{
    var doc=await firebase.firestore().doc('_config/att_report_config').get();
    if(doc.exists&&doc.data())_attReportCfg=Object.assign(_attReportCfg,doc.data());
  }catch(e){}
  return _attReportCfg;
}
async function _attSaveReportCfg(){
  try{ await firebase.firestore().doc('_config/att_report_config').set(_attReportCfg); toast('저장됨 ✓','s'); }
  catch(e){ console.error(e); }
}
function _attCfgSetRequired(v){ if(!_attReportCfg)return; _attReportCfg.requiredHeadcount=parseInt(v)||0; _attSaveReportCfg(); _renderAttReport(); }
function _attCfgSetNote(v){ if(!_attReportCfg)return; _attReportCfg.note=v; _attSaveReportCfg(); }

async function _renderAttReport(){
  var host=document.getElementById('attReportContent'); if(!host)return;
  await _attLoadReportCfg();
  // 파트별 그룹
  var groups={};
  (_attEmps||[]).forEach(function(e){ var p=e.part||'미배치'; (groups[p]=groups[p]||[]).push(e); });
  var parts=ATT_PART_ORDER.filter(function(p){return (groups[p]&&groups[p].length)||p==='AR/도급';});
  Object.keys(groups).forEach(function(p){ if(parts.indexOf(p)<0&&groups[p].length)parts.push(p); });

  function tagOf(name){return _getRec(name).tags||[];}
  var tot={total:0,annual:0,half:0,quarter:0,holiday:0,work:0}, bodyRows='';
  parts.forEach(function(p,idx){
    var mem=groups[p]||[], c={total:mem.length,annual:0,half:0,quarter:0,holiday:0,absent:0}, off=[];
    mem.forEach(function(e){
      var t=tagOf(e.name);
      if(t.indexOf('annual')>=0){c.annual++; off.push((e.nickname||e.name)+'(연차)');}
      else if(t.indexOf('absent')>=0){c.absent++; off.push((e.nickname||e.name)+'(결근)');}
      else if(t.indexOf('holiday')>=0){c.holiday++; off.push((e.nickname||e.name)+'(휴무)');}
      if(t.indexOf('half-am')>=0||t.indexOf('half-pm')>=0)c.half++;
      if(t.indexOf('quarter')>=0)c.quarter++;
    });
    var work=c.total-c.annual-c.absent-c.holiday;
    tot.total+=c.total;tot.annual+=c.annual;tot.half+=c.half;tot.quarter+=c.quarter;tot.holiday+=c.holiday;tot.work+=work;
    function cel(v,strong){return '<td style="text-align:center;padding:6px 4px;border:1px solid var(--g2)'+(strong?';font-weight:700;color:#1d4ed8':'')+'">'+(v||(v===0?'-':'-'))+'</td>';}
    var gubun = idx===0 ? '<td rowspan="'+(parts.length+1)+'" style="text-align:center;padding:6px;border:1px solid var(--g2);font-weight:700;background:#f3f6fb;vertical-align:middle;width:56px">생산</td>' : '';
    bodyRows+='<tr>'+gubun
      +'<td style="text-align:center;padding:6px 8px;border:1px solid var(--g2);font-weight:600;width:130px">'+p+'</td>'
      +cel(c.total)+cel(c.annual)+cel(c.half)+cel(c.quarter)+cel(c.holiday)+cel(work,true)
      +'<td style="padding:6px 8px;border:1px solid var(--g2);font-size:11px;color:var(--g5)">'+(off.join(', ')||'-')+'</td></tr>';
  });
  var head='<tr style="background:#2A3F5F;color:#fff">'
    +'<th style="padding:7px 6px;border:1px solid #2A3F5F;width:56px">구분</th>'
    +'<th style="padding:7px 8px;border:1px solid #2A3F5F;width:130px">파트</th>'
    +['총원','연차','반차','반반차','휴무','출근'].map(function(h){return '<th style="padding:7px 4px;border:1px solid #2A3F5F;width:64px">'+h+'</th>';}).join('')
    +'<th style="padding:7px 8px;border:1px solid #2A3F5F">휴무자</th></tr>';
  function tcel(v){return '<td style="text-align:center;padding:6px 4px;border:1px solid var(--g2);font-weight:700">'+(v||'-')+'</td>';}
  var totRow='<tr style="background:#eef4fb">'
    +'<td style="text-align:center;padding:6px 8px;border:1px solid var(--g2);font-weight:700">합계</td>'
    +tcel(tot.total)+tcel(tot.annual)+tcel(tot.half)+tcel(tot.quarter)+tcel(tot.holiday)
    +'<td style="text-align:center;padding:6px 4px;border:1px solid var(--g2);font-weight:700;color:#1d4ed8">'+tot.work+'</td>'
    +'<td style="border:1px solid var(--g2)"></td></tr>';

  // 생산동 인원 현황
  var totalHead=(_attEmps||[]).length;
  var required=_attReportCfg.requiredHeadcount||totalHead;
  var rate=required>0?Math.round(totalHead/required*100):100;
  var statBox=
    '<div style="border:1px solid var(--g2);border-radius:8px;overflow:hidden;min-width:200px">'
    +'<div style="background:#fdf3e0;padding:6px 10px;font-weight:700;font-size:13px;border-bottom:1px solid var(--g2)">생산동 인원 현황</div>'
    +'<div style="display:flex;justify-content:space-between;padding:6px 10px;font-size:13px"><span>총 인원</span><b>'+totalHead+'</b></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;font-size:13px;border-top:1px solid var(--g1)"><span>필요 인원</span>'
       +'<input type="number" value="'+required+'" onchange="_attCfgSetRequired(this.value)" style="width:60px;text-align:right;border:1px solid var(--g2);border-radius:4px;padding:2px 4px"></div>'
    +'<div style="display:flex;justify-content:space-between;padding:6px 10px;font-size:13px;border-top:1px solid var(--g1);color:'+(rate>=100?'#1d4ed8':'#dc2626')+'"><span>채용율</span><b>'+rate+'%</b></div>'
    +'</div>';
  var noteBox=
    '<div style="border:1px solid var(--g2);border-radius:8px;overflow:hidden;flex:1;min-width:240px">'
    +'<div style="background:#fdf3e0;padding:6px 10px;font-weight:700;font-size:13px;border-bottom:1px solid var(--g2)">총원 특이사항</div>'
    +'<textarea onchange="_attCfgSetNote(this.value)" placeholder="예: 6/30 김미나 회사" style="width:100%;height:70px;border:none;padding:8px 10px;font-size:13px;resize:vertical;background:transparent">'+(_attReportCfg.note||'')+'</textarea>'
    +'</div>';

  var msg=_buildEarlyMsg();
  host.innerHTML=
    '<div style="font-size:14px;font-weight:700;margin:10px 0 6px">'+_attFmtLabel(_attDate)+' 근태현황</div>'
    +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
    +'<thead>'+head+'</thead><tbody>'+bodyRows+totRow+'</tbody></table></div>'
    +'<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">'+statBox+noteBox+'</div>'
    +'<div style="font-size:14px;font-weight:700;margin:16px 0 6px">조출 보고 메시지 <span style="font-size:11px;color:var(--g5);font-weight:400">(직접 수정 가능)</span></div>'
    +'<textarea id="attEarlyMsg" style="width:100%;height:130px;padding:10px;border:1px solid var(--g2);border-radius:8px;font-size:13px;line-height:1.6;resize:vertical">'+msg+'</textarea>'
    +'<button class="btn bp bblk" style="width:100%;margin-top:8px" onclick="_attCopyEarly()">📋 조출 메시지 복사</button>';
}

function _shortDate(d){ // 2026-07-02 → 7/2
  var p=d.split('-'); return parseInt(p[1])+'/'+parseInt(p[2]);
}
function _buildEarlyMsg(){
  var byTime={};
  (_attEmps||[]).forEach(function(e){
    var r=_getRec(e.name), t=r.tags||[];
    if(t.indexOf('early')>=0){ var tm=r.inTime||'05:00'; (byTime[tm]=byTime[tm]||[]).push(_attDispName(e)); }
  });
  var times=Object.keys(byTime).sort();
  var lines=[_shortDate(_attDate)+' 운영팀 조출',''];
  if(times.length) times.forEach(function(tm){ lines.push(tm+' '+byTime[tm].join(' ')); });
  else lines.push('조출자 없음');
  var off=[];
  (_attEmps||[]).forEach(function(e){
    var t=_getRec(e.name).tags||[];
    if(t.indexOf('holiday')>=0)off.push(_attDispName(e));
    else if(t.indexOf('annual')>=0)off.push(_attDispName(e)+'(연차)');
    else if(t.indexOf('absent')>=0)off.push(_attDispName(e)+'(결근)');
  });
  lines.push('휴무자 '+(off.length?off.join(' '):'없습니다.'));
  return lines.join('\n');
}
function _attDispName(e){ if(e.nickname)return e.nickname; if(e.position)return e.name+e.position; return e.name; }
function _attCopyEarly(){
  var ta=document.getElementById('attEarlyMsg'); if(!ta)return; ta.select();
  try{ document.execCommand('copy'); toast('조출 메시지 복사됨 ✓','s'); }
  catch(e){ if(navigator.clipboard){navigator.clipboard.writeText(ta.value);toast('복사됨 ✓','s');} }
}

// ─── 현재 직원 레코드 정규화 (tags 배열 방식) ───
function _getRec(name){
  var r=_attRecs[name];
  if(!r)return {tags:[],inTime:'09:00',outTime:'18:00'};
  // 구버전 호환: status 필드 → tags 배열로 변환
  if(r.status&&!r.tags){
    var t=r.status==='normal'?[]:r.status==='checkin'?[]:[r.status];
    return {tags:t,inTime:r.inTime||'09:00',outTime:r.outTime||'18:00'};
  }
  if(!r.tags)r.tags=[];
  return r;
}
function _hasTag(name,tag){return _getRec(name).tags.indexOf(tag)>=0;}
function _isAbsent(name){return _hasTag(name,'absent');}
function _isAnnual(name){return _hasTag(name,'annual');}
function _noTime(name){return _isAbsent(name)||_isAnnual(name);}
// 태그들에서 주 상태 색 계산
function _mainColor(tags){
  var pri=['absent','holiday','annual','early','overtime','half-am','half-pm','quarter','checkin'];
  for(var i=0;i<pri.length;i++){if(tags.indexOf(pri[i])>=0)return ATT_COLOR[pri[i]];}
  return ATT_COLOR.normal;
}
function _mainIcon(tags){
  if(!tags||!tags.length)return ATT_ICON.normal;
  var pri=['absent','holiday','annual','early','half-am','half-pm','quarter','overtime','checkin'];
  for(var i=0;i<pri.length;i++){if(tags.indexOf(pri[i])>=0)return ATT_ICON[pri[i]];}
  return ATT_ICON.normal;
}
// 태그 배열 → 요약 레이블
function _tagsLabel(tags){
  if(!tags||!tags.length)return '정상';
  return tags.map(function(t){return ATT_SL[t]||t;}).join('+');
}
// 시간 계산: tags + in/out 기반 연장시간
function _calcExt(inTime,outTime){
  if(!inTime||!outTime||inTime.indexOf(':')<0||outTime.indexOf(':')<0)return 0;
  var toM=function(t){var p=t.split(':');return parseInt(p[0])*60+parseInt(p[1]);};
  var base=toM(inTime)+9*60;
  return Math.max(0,toM(outTime)-base);
}

// ─── 오늘 요약 ───
function _renderAttSummary(){
  var el=document.getElementById('attSummary');if(!el)return;
  var raw=localStorage.getItem(_attDateKey(tod()));if(!raw){el.innerHTML='';return;}
  var recs=JSON.parse(raw);
  var groups={early:[],annual:[],'half-am':[],'half-pm':[],quarter:[],overtime:[],absent:[],holiday:[]};
  var totalIn=0,totalAbsent=0,totalHoliday=0;
  _attEmps.forEach(function(e){
    var r=recs[e.name];if(!r)return;
    var tags=r.tags||(r.status&&r.status!=='normal'?[r.status]:[]);
    if(tags.indexOf('absent')>=0){totalAbsent++;groups.absent.push(e.name);}
    else if(tags.indexOf('holiday')>=0){totalHoliday++;groups.holiday.push(e.name);}
    else{
      totalIn++;
      ['early','half-am','half-pm','quarter','overtime','annual'].forEach(function(k){
        if(tags.indexOf(k)>=0&&groups[k])groups[k].push({name:e.name,inTime:r.inTime,outTime:r.outTime});
      });
    }
  });
  var html='<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:9px 14px 7px;background:var(--g1);border-radius:10px;margin-bottom:4px">'
    +'<span style="font-size:14px;font-weight:700;color:var(--p)">총 출근 '+totalIn+'명</span>'
    +(totalAbsent?'<span style="font-size:13px;color:#e53935;font-weight:600">결근 '+totalAbsent+'명</span>':'')
    +(totalHoliday?'<span style="font-size:13px;color:#0891b2;font-weight:600">휴무 '+totalHoliday+'명</span>':'')
    +'</div>';
  [{key:'early',icon:'🌅',label:'조출',t:true},{key:'annual',icon:'📅',label:'연차',t:false},
   {key:'half-am',icon:'🌓',label:'반차(오전)',t:false},{key:'half-pm',icon:'🌓',label:'반차(오후)',t:false},
   {key:'quarter',icon:'🌗',label:'반반차',t:false},{key:'overtime',icon:'⏰',label:'연장',t:true}
  ].forEach(function(row){
    var arr=groups[row.key];if(!arr||!arr.length)return;
    var names=row.t?arr.map(function(x){return x.name+' '+x.inTime;}).join('  '):arr.map(function(x){return typeof x==='string'?x:x.name;}).join('  ');
    html+='<div style="padding:5px 14px;font-size:12px;color:var(--g6);border-bottom:1px solid var(--g2)"><b>'+row.icon+' '+row.label+' '+arr.length+'명</b> — '+names+'</div>';
  });
  el.innerHTML=html;
}

// ─── 출퇴근 입력 메인 ───
function _renderAttInput(){
  var el=document.getElementById('attInputContent');if(!el)return;

  // 상태 버튼 목록 (출근 버튼 추가)
  var STATUS_BTNS=[
    {s:'checkin',icon:'🕘',label:'출근',color:'#1a56db'},
    {s:'checkout',icon:'🏃',label:'퇴근',color:'#0277bd'},
    {s:'early',icon:'🌅',label:'조출',color:'#1565c0'},
    {s:'half-am',icon:'🌓',label:'반차(오전)',color:'#6a1b9a'},
    {s:'half-pm',icon:'🌓',label:'반차(오후)',color:'#6a1b9a'},
    {s:'quarter',icon:'🌗',label:'반반차',color:'#4a148c'},
    {s:'overtime',icon:'⏰',label:'연장',color:'#e65100'},
    {s:'annual',icon:'📅',label:'연차',color:'#ad1457'},
    {s:'absent',icon:'❌',label:'결근',color:'#b71c1c'},
    {s:'holiday',icon:'🏖️',label:'휴무',color:'#0891b2'},
  ];
  var btnHtml=STATUS_BTNS.map(function(b){
    var active=_attSelStatus===b.s;
    var cnt=_attEmps.filter(function(e){return _hasTag(e.name,b.s);}).length;
    var style=active?'background:'+b.color+';color:#fff;border:2px solid '+b.color+';'
      :'background:var(--g1);color:'+b.color+';border:2px solid '+b.color+';';
    return '<button onclick="attSelectStatus(\''+b.s+'\')" style="'+style+'padding:8px 10px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:66px">'
      +'<span style="font-size:17px">'+b.icon+'</span>'
      +'<span>'+b.label+'</span>'
      +(cnt>0?'<span style="font-size:10px;padding:1px 5px;border-radius:8px;background:rgba(255,255,255,0.3)">'+cnt+'명</span>':'')
      +'</button>';
  }).join('');

  // 체크박스 패널
  var checkPanel='';
  if(_attSelStatus){
    var sc=ATT_COLOR[_attSelStatus],si=ATT_ICON[_attSelStatus],sl=ATT_SL[_attSelStatus];
    var needIn=(_attSelStatus==='checkin'||_attSelStatus==='early');
    var needOut=(_attSelStatus==='checkout'||_attSelStatus==='overtime');

    var checkHtml=_attEmps.map(function(e,i){
      var isChecked=_hasTag(e.name,_attSelStatus);
      var rec=_getRec(e.name);
      // 현재 태그들 표시
      var tagBadges=rec.tags.length?rec.tags.map(function(t){
        return '<span style="font-size:9px;padding:1px 5px;border-radius:8px;background:'+ATT_COLOR[t]+'20;color:'+ATT_COLOR[t]+';margin-left:3px">'+ATT_SL[t]+'</span>';
      }).join(''):'';
      return '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;cursor:pointer;'+(isChecked?'background:'+sc+'18':'')+'" onclick="event.stopPropagation()">'
        +'<input type="checkbox" id="attChk_'+i+'" '+(isChecked?'checked':'')+' style="width:17px;height:17px;accent-color:'+sc+';cursor:pointer;flex-shrink:0">'
        +'<span style="font-size:13px;'+(isChecked?'font-weight:700;color:'+sc:'')+'">'+e.name+'</span>'
        +tagBadges
        +'</label>';
    }).join('');

    var hint='';
    if(_attSelStatus==='checkout')hint='퇴근시간 입력 → 연장시간 자동 계산';
    else if(_attSelStatus==='checkin')hint='출근시간 입력 → 퇴근 자동 계산 (기본 9시간)';
    else if(_attSelStatus==='early')hint='조출 출근시간 입력 → 퇴근 자동 계산';
    else if(_attSelStatus==='overtime')hint='실제 퇴근시간 입력 → 연장시간 자동 계산';
    else if(_attSelStatus==='half-am')hint='오전 반차: 출근 09:00 → 퇴근 13:00 자동';
    else if(_attSelStatus==='half-pm')hint='오후 반차: 출근 13:00 → 퇴근 18:00 자동';
    else if(_attSelStatus==='quarter')hint='반반차: 출근 09:00 → 퇴근 11:00 자동';
    else if(_attSelStatus==='annual')hint='연차: 시간 불필요';
    else if(_attSelStatus==='absent')hint='결근: 시간 불필요';
    else if(_attSelStatus==='holiday')hint='휴무(공휴일 등): 시간 불필요';

    var timeInput='';
    if(_attSelStatus==='checkout'){
      timeInput='<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--g1);border-radius:8px;margin-bottom:8px;flex-wrap:wrap">'
        +'<span style="font-size:13px;color:var(--g5)">퇴근시간:</span>'
        +'<input id="attBulkTime" class="fc" type="text" inputmode="numeric" maxlength="5" placeholder="1800" style="width:76px;font-size:17px;font-weight:700;text-align:center;padding:6px" oninput="attBulkTimeInput(this.value)">'
        +'<span id="attBulkCalcLabel" style="font-size:13px;color:var(--p)"></span>'
        +'</div>';
    }else if(needIn){
      timeInput='<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--g1);border-radius:8px;margin-bottom:8px;flex-wrap:wrap">'
        +'<span style="font-size:13px;color:var(--g5)">'+(_attSelStatus==='early'?'조출 출근시간':'출근시간')+':</span>'
        +'<input id="attBulkTime" class="fc" type="text" inputmode="numeric" maxlength="5"'
        +' placeholder="'+(_attSelStatus==='early'?'0700':'0900')+'"'
        +' style="width:76px;font-size:17px;font-weight:700;text-align:center;padding:6px"'
        +' oninput="attBulkTimeInput(this.value)">'
        +'<span id="attBulkCalcLabel" style="font-size:13px;color:var(--p)"></span>'
        +'</div>';
    }else if(needOut){
      timeInput='<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--g1);border-radius:8px;margin-bottom:8px;flex-wrap:wrap">'
        +'<span style="font-size:13px;color:var(--g5)">실제 퇴근시간:</span>'
        +'<input id="attBulkTime" class="fc" type="text" inputmode="numeric" maxlength="5"'
        +' placeholder="2000"'
        +' style="width:76px;font-size:17px;font-weight:700;text-align:center;padding:6px"'
        +' oninput="attBulkTimeInput(this.value)">'
        +'<span id="attBulkCalcLabel" style="font-size:13px;color:var(--p)"></span>'
        +'</div>';
    }

    checkPanel='<div style="background:var(--bg);border:2px solid '+sc+';border-radius:12px;padding:14px;margin-top:8px">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +'<span style="font-size:14px;font-weight:700;color:'+sc+'">'+si+' '+sl+' 적용할 직원 체크</span>'
        +'<div style="display:flex;gap:5px">'
          +'<button onclick="attCheckAll(true)" style="font-size:11px;padding:3px 9px;border-radius:6px;border:1px solid var(--g3);background:var(--g1);cursor:pointer">전체</button>'
          +'<button onclick="attCheckAll(false)" style="font-size:11px;padding:3px 9px;border-radius:6px;border:1px solid var(--g3);background:var(--g1);cursor:pointer">해제</button>'
        +'</div>'
      +'</div>'
      +(hint?'<div style="font-size:11px;color:var(--g5);margin-bottom:8px;padding:4px 8px;background:'+sc+'10;border-radius:6px">'+hint+'</div>':'')
      +timeInput
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:2px;max-height:220px;overflow-y:auto;margin-bottom:10px">'+checkHtml+'</div>'
      +'<div style="display:flex;gap:8px">'
        +'<button onclick="attApplyChecked(false)" style="flex:1;padding:9px;background:var(--g1);color:'+sc+';border:2px solid '+sc+';border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">태그 제거</button>'
        +'<button onclick="attApplyChecked(true)" style="flex:2;padding:9px;background:'+sc+';color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">✓ 적용 (태그 추가)</button>'
      +'</div>'
      +'</div>';
  }

  // 전체 인원 명단
  var listHtml=_attEmps.map(function(e,i){
    var rec=_getRec(e.name);
    var tags=rec.tags;
    var noTime=tags.indexOf('absent')>=0||tags.indexOf('annual')>=0||tags.indexOf('holiday')>=0;
    var mc=_mainColor(tags);
    var mi=_mainIcon(tags);
    var tl=_tagsLabel(tags);
    var ext=!noTime?_calcExt(rec.inTime,rec.outTime):0;
    var isEx=tags.length>0;

    // 태그 배지들
    var tagChips=tags.map(function(t){
      return '<span onclick="attRemoveTag(\''+e.name+'\',\''+t+'\')" title="클릭하여 제거" style="font-size:10px;padding:2px 7px;border-radius:10px;background:'+ATT_COLOR[t]+'20;color:'+ATT_COLOR[t]+';border:1px solid '+ATT_COLOR[t]+'40;cursor:pointer">'+ATT_ICON[t]+' '+ATT_SL[t]+' ✕</span>';
    }).join('');

    return '<div style="padding:8px 0;border-bottom:0.5px solid var(--g2)">'
      // 첫 줄: 번호 + 이름 + 태그칩들
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:'+(isEx||!noTime?'4px':'0')+'">'
        +'<span style="font-size:11px;color:var(--g4);width:20px;text-align:right;flex-shrink:0">'+(i+1)+'</span>'
        +'<span style="font-size:14px;font-weight:600;min-width:70px;flex-shrink:0;'+(isEx?'color:'+mc:'')+'">'+e.name+'</span>'
        +(isEx?tagChips:'<span style="font-size:11px;color:var(--g4)">정상</span>')
      +'</div>'
      // 둘째 줄: 시간 입력 (noTime이 아닌 경우)
      +(!noTime
        ?'<div style="display:flex;align-items:center;gap:6px;padding-left:26px;flex-wrap:wrap">'
          +'<input class="fc" type="text" inputmode="numeric" maxlength="5" placeholder="09:00"'
          +' value="'+(rec.inTime||'09:00')+'"'
          +' style="width:56px;font-size:12px;text-align:center;padding:4px"'
          +' onchange="attListSetIn('+i+',this.value)">'
          +'<span style="font-size:11px;color:var(--g4)">→</span>'
          +'<input class="fc" type="text" inputmode="numeric" maxlength="5" placeholder="18:00"'
          +' value="'+(rec.outTime||'18:00')+'"'
          +' style="width:56px;font-size:12px;text-align:center;padding:4px"'
          +' onchange="attListSetOut('+i+',this.value)">'
          +(ext>0?'<span style="font-size:11px;color:#e65100;font-weight:700">+'+ext+'분 연장</span>':'')
          +'</div>'
        :'<div style="padding-left:26px;font-size:12px;color:var(--g4)">시간 없음</div>')
      +'</div>';
  }).join('');

  var exCnt=_attEmps.filter(function(e){return _getRec(e.name).tags.length>0;}).length;
  var normalCnt=_attEmps.length-exCnt;

  el.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 8px">'+btnHtml+'</div>'
    +checkPanel
    +(exCnt>0?'<div style="padding:6px 10px;background:var(--g1);border-radius:8px;font-size:11px;color:var(--g5);margin-top:8px">예외 <b style="color:var(--g7)">'+exCnt+'명</b> | 나머지 <b style="color:var(--g7)">'+normalCnt+'명</b> 자동 정상 | 태그 배지 클릭하면 제거</div>':'')
    +'<div style="margin-top:10px">'
      +'<div style="font-size:12px;font-weight:700;color:var(--g5);margin-bottom:6px;padding-left:4px">전체 인원 ('+_attEmps.length+'명)</div>'
      +listHtml
    +'</div>';
}

// ─── 이벤트 핸들러 ───
function attSelectStatus(s){_attSelStatus=(_attSelStatus===s)?'':s;_renderAttInput();}
function attCheckAll(checked){_attEmps.forEach(function(_,i){var cb=document.getElementById('attChk_'+i);if(cb)cb.checked=checked;});}

function attBulkTimeInput(v){
  v=v.replace(/[^0-9]/g,'');if(v.length>4)v=v.slice(0,4);
  var el=document.getElementById('attBulkTime'),lb=document.getElementById('attBulkCalcLabel');
  if(v.length===4){
    var fmt=v.slice(0,2)+':'+v.slice(2);if(el)el.value=fmt;
    if(lb){
      if(ATT_NEEDS_IN[_attSelStatus])lb.textContent='→ 퇴근 '+_attCalcOut(fmt)+' 자동';
      else if(ATT_NEEDS_OUT[_attSelStatus])lb.textContent='';
    }
  }else{if(lb)lb.textContent='';}
}

// apply=true: 태그 추가, apply=false: 태그 제거
function attApplyChecked(apply){
  // 불가능한 조합 검사
  if(apply){
    var conflicts={
      'early':   ['half-am'],       // 조출 + 반차(오전) 불가
      'half-am': ['early','half-pm','annual','absent','holiday'],  // 반차(오전) + 조출/반차(오후)/연차/결근 불가
      'half-pm': ['half-am','annual','absent','holiday'],
      'quarter': ['annual','absent','holiday'],
      'annual':  ['half-am','half-pm','quarter','absent','early','overtime','holiday'],
      'absent':  ['half-am','half-pm','quarter','annual','early','overtime','holiday'],
      'holiday': ['half-am','half-pm','quarter','annual','absent','early','overtime','checkin'],
    };
    var conflictNames=[];
    _attEmps.forEach(function(e,i){
      var cb=document.getElementById('attChk_'+i);if(!cb||!cb.checked)return;
      var rec=_getRec(e.name);
      var blocked=conflicts[_attSelStatus]||[];
      var hasConflict=blocked.some(function(t){return rec.tags.indexOf(t)>=0;});
      if(hasConflict)conflictNames.push(e.name);
    });
    if(conflictNames.length>0){
      var msg='불가능한 조합입니다:\n\n';
      if(_attSelStatus==='early'&&conflictNames.length)msg+='조출 + 반차(오전)은 함께 쓸 수 없습니다.\n(일찍 왔는데 오전에 쉰다는 건 말이 안 됩니다)';
      else if(_attSelStatus==='annual')msg+='연차는 다른 반차/조출과 함께 쓸 수 없습니다.\n(연차면 하루 전체 휴가입니다)';
      else if(_attSelStatus==='absent')msg+='결근은 다른 상태와 함께 쓸 수 없습니다.';
      else if(_attSelStatus==='holiday')msg+='휴무는 다른 상태와 함께 쓸 수 없습니다.';
      else if(_attSelStatus==='half-am')msg+='반차(오전)은 조출/반차(오후)/연차와 함께 쓸 수 없습니다.';
      else msg+='해당 조합은 사용할 수 없습니다.';
      msg+='\n\n해당 직원: '+conflictNames.join(', ');
      alert(msg);
      return;
    }
  }
  var needIn=(_attSelStatus==='checkin'||_attSelStatus==='early');
  var needOut=(_attSelStatus==='checkout'||_attSelStatus==='overtime');
  var timeVal='';
  if(needIn||needOut){var tEl=document.getElementById('attBulkTime');timeVal=tEl?_attFmt(tEl.value):'';}
  // 시간 필수인데 미입력 경고
  if(apply&&(needIn||needOut)&&!timeVal){
    var tLabel=_attSelStatus==='checkout'?'퇴근시간':needIn?(_attSelStatus==='early'?'조출 출근시간':'출근시간'):'퇴근시간';
    alert(tLabel+'을 먼저 입력하세요!\n예) 0700 → 07:00 으로 자동 변환됩니다.');
    var tEl2=document.getElementById('attBulkTime');
    if(tEl2)tEl2.focus();
    return;
  }
  var cnt=0,appliedStatus=_attSelStatus;
  _attEmps.forEach(function(e,i){
    var cb=document.getElementById('attChk_'+i);if(!cb||!cb.checked)return;
    var rec=_getRec(e.name);
    var tags=rec.tags.slice();
    if(apply){
      // 태그 추가 (중복 방지)
      if(tags.indexOf(appliedStatus)<0)tags.push(appliedStatus);
      // 시간 계산
      var inT=rec.inTime||'09:00', outT=rec.outTime||'18:00';
      if(appliedStatus==='checkout'){
        outT=timeVal||'18:00'; // 퇴근시간 직접 지정
      }else if(appliedStatus==='checkin'||appliedStatus==='early'){
        inT=timeVal||'09:00';
        // 기존 반차 태그 있으면 근무시간 조합 계산
        var wh=_calcWorkHours(tags.concat([]));
        if(tags.indexOf('half-am')>=0){inT='13:00';outT=_attAddH(inT,wh);}
        else if(wh>0) outT=_attAddH(inT,wh);
        else outT=_attCalcOut(inT);
      }else if(appliedStatus==='overtime'){
        outT=timeVal||'19:00';
      }else if(appliedStatus==='half-am'){
        // 반차(오전) = 오전에 쉬고 오후 출근 → 13:00부터 근무
        inT='13:00';
        var wh2=_calcWorkHours(tags.concat(['half-am']));
        outT=_attAddH(inT,wh2);
      }else if(appliedStatus==='half-pm'){
        // 반차(오후) = 오전만 근무 → inTime부터 근무
        if(tags.indexOf('early')<0) inT='09:00';
        var wh3=_calcWorkHours(tags.concat(['half-pm']));
        outT=_attAddH(inT,wh3);
      }else if(appliedStatus==='quarter'){
        // 반반차 = 2시간 추가 휴가
        if(tags.indexOf('half-am')>=0){inT='13:00';}
        else if(tags.indexOf('early')<0) inT='09:00';
        var wh4=_calcWorkHours(tags.concat(['quarter']));
        outT=_attAddH(inT,wh4);
      }else if(appliedStatus==='annual'||appliedStatus==='absent'||appliedStatus==='holiday'){
        inT=''; outT='';
        // 다른 시간 관련 태그 제거
        tags=tags.filter(function(t){return t==='absent'||t==='annual'||t==='holiday';});
        tags=[appliedStatus];
      }
      _attRecs[e.name]={tags:tags,inTime:inT,outTime:outT};
    }else{
      // 태그 제거
      tags=tags.filter(function(t){return t!==appliedStatus;});
      if(!tags.length)delete _attRecs[e.name];
      else _attRecs[e.name]=Object.assign({},rec,{tags:tags});
    }
    cnt++;
  });
  _attSelStatus='';
  toast(cnt+'명 '+(ATT_SL[appliedStatus]||'')+' '+(apply?'적용':'제거')+'됨 ✓','s');
  _renderAttInput();
}

// 태그 배지 클릭 → 태그 제거
function attRemoveTag(name,tag){
  var rec=_getRec(name);
  var tags=rec.tags.filter(function(t){return t!==tag;});
  if(!tags.length){
    delete _attRecs[name]; // 태그 없으면 정상(09:00~18:00)으로 복귀
  }else{
    // 남은 태그 기반으로 시간 재계산
    var inT=rec.inTime||'09:00';
    var outT=rec.outTime||'18:00';
    var wh=_calcWorkHours(tags);
    if(tags.indexOf('half-am')>=0){
      inT='13:00'; outT=_attAddH(inT,wh);
    }else if(tags.indexOf('early')>=0||tags.indexOf('checkin')>=0){
      outT=_attAddH(inT,wh>0?wh:9); // 조출 유지, outTime 재계산
    }else if(wh>0){
      inT='09:00'; outT=_attAddH(inT,wh);
    }else{
      inT='09:00'; outT='18:00';
    }
    _attRecs[name]={tags:tags,inTime:inT,outTime:outT};
  }
  _renderAttInput();
}

function attListSetIn(idx,val){
  val=_attFmt(val);
  var e=_attEmps[idx];if(!e)return;
  var rec=_getRec(e.name);
  var newOut=_attCalcOut(val);
  _attRecs[e.name]={tags:rec.tags,inTime:val,outTime:newOut};
  _renderAttInput();
}
function attListSetOut(idx,val){
  val=_attFmt(val);
  var e=_attEmps[idx];if(!e)return;
  var rec=_getRec(e.name);
  _attRecs[e.name]={tags:rec.tags,inTime:rec.inTime,outTime:val};
  _renderAttInput();
}


// ─── 주별 시간표 뷰 변수 ───
var _attWeekStart = null;

function _attGetWeekMon(baseDate){
  var d=new Date(baseDate+'T00:00:00');
  var day=d.getDay(); var diff=day===0?-6:1-day;
  d.setDate(d.getDate()+diff); return d;
}
function _attFmtDate2(dt){
  return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
}

// ★ Firebase에서 1주일치 → localStorage로 동기화 (월별 조회용)
//   실패해도 기존 localStorage는 유지 (안전 폴백)
async function _attPrefetchWeek(weekStart){
  if(!weekStart) return;
  var promises = [];
  for(var i=0; i<7; i++){
    (function(idx){
      var d = new Date(weekStart); d.setDate(weekStart.getDate()+idx);
      var ds = _attFmtDate2(d);
      promises.push(
        firebase.firestore().collection('attendance').doc(ds).get()
          .then(function(doc){
            if(doc && doc.exists){
              var rec = doc.data().records || {};
              localStorage.setItem(_attDateKey(ds), JSON.stringify(rec));
            }
          })
          .catch(function(err){
            console.warn('[attPrefetch] '+ds+' 실패:', err && err.message);
          })
      );
    })(i);
  }
  await Promise.all(promises);
}

// prefetch + render 묶음 (호출자가 이 함수를 await로 부름)
async function _attShowMonthly(){
  if(!_attWeekStart) _attWeekStart=_attGetWeekMon(_attDate||tod());
  await _loadHolidays();
  await _attPrefetchWeek(_attWeekStart);
  _renderAttMonthly();
}

function attWeekPrev(){ _attWeekStart.setDate(_attWeekStart.getDate()-7); _attShowMonthly(); }
function attWeekNext(){ _attWeekStart.setDate(_attWeekStart.getDate()+7); _attShowMonthly(); }
function attWeekToday(){ _attWeekStart=_attGetWeekMon(tod()); _attShowMonthly(); }

function _renderAttMonthly(){
  var tbl=document.getElementById('attWeekTable'); if(!tbl) return;
  if(!_attWeekStart) _attWeekStart=_attGetWeekMon(_attDate||tod());
  var dates=[];
  var dow=['일','월','화','수','목','금','토'];
  for(var i=0;i<7;i++){
    var d=new Date(_attWeekStart); d.setDate(_attWeekStart.getDate()+i); dates.push(d);
  }
  var lbl=document.getElementById('attWeekLabel');
  if(lbl){
    var s=dates[0],e=dates[6];
    lbl.textContent=(s.getMonth()+1)+'/'+s.getDate()+'('+dow[s.getDay()]+') ~ '+(e.getMonth()+1)+'/'+e.getDate()+'('+dow[e.getDay()]+')';
  }
  var todayStr=tod();
  var html='<thead><tr style="background:var(--g1)">'
    +'<th style="padding:8px 10px;font-size:12px;font-weight:700;text-align:left;border:0.5px solid var(--g2);position:sticky;left:0;background:var(--g1);min-width:70px">이름</th>';
  dates.forEach(function(dt){
    var ds=_attFmtDate2(dt);
    var isToday=ds===todayStr;
    var isSun=dt.getDay()===0,isSat=dt.getDay()===6;
    var c=isToday?'#1a56db':isSun?'#e53935':isSat?'#1565c0':'var(--g7)';
    html+='<th colspan="2" style="padding:6px 4px;font-size:11px;font-weight:600;text-align:center;border:0.5px solid var(--g2);color:'+c+';background:'+(isToday?'#e3f2fd':'var(--g1)')+'">'+
      (dt.getMonth()+1)+'/'+dt.getDate()+'('+dow[dt.getDay()]+')</th>';
  });
  html+='<th rowspan="2" style="padding:6px 8px;font-size:11px;font-weight:700;text-align:center;border:0.5px solid var(--g2);background:var(--g1);min-width:60px">주 합계</th>';
  html+='</tr><tr style="background:var(--g1)">';
  html+='<th style="border:0.5px solid var(--g2);position:sticky;left:0;background:var(--g1)"></th>';
  dates.forEach(function(){
    html+='<th style="padding:3px 4px;font-size:10px;color:var(--g5);font-weight:500;text-align:center;border:0.5px solid var(--g2)">출근</th>';
    html+='<th style="padding:3px 4px;font-size:10px;color:var(--g5);font-weight:500;text-align:center;border:0.5px solid var(--g2)">퇴근</th>';
  });
  html+='</tr></thead><tbody>';
  _attEmps.forEach(function(emp){
    html+='<tr><td style="padding:6px 10px;font-size:12px;font-weight:500;border:0.5px solid var(--g2);white-space:nowrap;position:sticky;left:0;background:var(--bg)">'+emp.name+'</td>';
    var weekHours=0;
    dates.forEach(function(dt){
      var ds=_attFmtDate2(dt);
      var raw=localStorage.getItem(_attDateKey(ds));
      var r=raw?JSON.parse(raw)[emp.name]:null;
      var tags=r?(r.tags||[]):[];
      var inT=r?(r.inTime||'09:00'):'';
      var outT=r?(r.outTime||'18:00'):'';
      var isAbsent=tags.indexOf('absent')>=0;
      var isAnnual=tags.indexOf('annual')>=0;
      var isHoliday=tags.indexOf('holiday')>=0;
      // 공휴일이면서 실제 출근(시간 또는 checkin/early)을 안 했으면 → 휴무로 간주
      var workedThisDay = (r && (r.inTime || r.outTime)) || tags.indexOf('checkin')>=0 || tags.indexOf('early')>=0;
      if(_isHoliday(ds) && !workedThisDay){ isHoliday=true; isAbsent=false; isAnnual=false; }
      var isToday=ds===todayStr;
      var isWknd=dt.getDay()===0||dt.getDay()===6;
      var bg=isToday?'#f0f7ff':isWknd?'var(--g1)':'var(--bg)';
      var escapedDs=ds.replace(/'/g,"\\'");
      var escapedName=emp.name.replace(/'/g,"\\'");
      if(isAbsent||isAnnual||isHoliday){
        var label=isAbsent?'결근':isHoliday?'휴무':'연차';
        var color=isAbsent?'#e53935':isHoliday?'#0891b2':'#ad1457';
        html+='<td colspan="2" style="padding:4px;text-align:center;font-size:11px;font-weight:600;color:'+color+';background:'+bg+';border:0.5px solid var(--g2);cursor:pointer" onclick="attWeekCellEdit(\''+escapedDs+'\',\''+escapedName+'\')">'+label+'</td>';
      } else if(!r||isWknd){
        html+='<td style="padding:4px;text-align:center;font-size:11px;color:var(--g3);background:'+bg+';border:0.5px solid var(--g2);cursor:pointer" onclick="attWeekCellEdit(\''+escapedDs+'\',\''+escapedName+'\')">'+(isWknd&&!r?'-':'')+'</td>';
        html+='<td style="padding:4px;text-align:center;font-size:11px;color:var(--g3);background:'+bg+';border:0.5px solid var(--g2);cursor:pointer" onclick="attWeekCellEdit(\''+escapedDs+'\',\''+escapedName+'\')">'+(isWknd&&!r?'-':'')+'</td>';
      } else {
        var tagLabel=tags.length?tags.map(function(t){return ATT_SL[t]||t;}).join('+'):'';
        var badge=tagLabel?'<div style="font-size:9px;color:#1a56db">'+tagLabel+'</div>':'';
        var hrs=_calcWorkHoursByTime(inT,outT,tags);
        weekHours+=hrs;
        var hrsTxt=hrs>0?'<div style="font-size:9px;color:#1565c0;font-weight:600">'+hrs.toFixed(1)+'h</div>':'';
        html+='<td style="padding:3px 2px;text-align:center;font-size:11px;background:'+bg+';border:0.5px solid var(--g2);cursor:pointer;min-width:48px" onclick="attWeekCellEdit(\''+escapedDs+'\',\''+escapedName+'\')">'+badge+'<b>'+inT+'</b></td>';
        html+='<td style="padding:3px 2px;text-align:center;font-size:11px;background:'+bg+';border:0.5px solid var(--g2);cursor:pointer;min-width:48px" onclick="attWeekCellEdit(\''+escapedDs+'\',\''+escapedName+'\')"><b>'+outT+'</b>'+hrsTxt+'</td>';
      }
    });
    var whTxt=weekHours>0?weekHours.toFixed(1)+'h':'-';
    html+='<td style="padding:4px 8px;text-align:center;font-size:12px;font-weight:700;color:#1565c0;border:0.5px solid var(--g2);background:var(--g1)">'+whTxt+'</td>';
    html+='</tr>';
  });
  html+='</tbody>';
  tbl.innerHTML=html;
}

function attWeekCellEdit(ds, empName){
  var raw=localStorage.getItem(_attDateKey(ds));
  var dayRec=raw?JSON.parse(raw):{};
  var r=dayRec[empName]||{tags:[],inTime:'09:00',outTime:'18:00'};
  var tags=r.tags||[];
  var parts=ds.split('-');
  var title=parseInt(parts[1])+'월 '+parseInt(parts[2])+'일 \u00b7 '+empName;
  var tagInfo=tags.length?'<div style="font-size:12px;color:var(--g5);padding:6px 10px;background:var(--g1);border-radius:6px">현재: <b>'+tags.map(function(t){return ATT_SL[t]||t;}).join(', ')+'</b></div>':'';
  var body='<div style="display:flex;flex-direction:column;gap:10px">'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
    +'<div><div style="font-size:12px;color:var(--g5);margin-bottom:4px">출근시간</div>'
    +'<input class="fc" id="awe_in" value="'+(r.inTime||'09:00')+'" style="width:100%;padding:8px;font-size:16px;text-align:center;box-sizing:border-box"></div>'
    +'<div><div style="font-size:12px;color:var(--g5);margin-bottom:4px">퇴근시간</div>'
    +'<input class="fc" id="awe_out" value="'+(r.outTime||'18:00')+'" style="width:100%;padding:8px;font-size:16px;text-align:center;box-sizing:border-box"></div>'
    +'</div>'+tagInfo+'</div>'
    +'<div style="display:flex;gap:8px;margin-top:12px">'
    +'<button class="btn" style="flex:1;padding:8px;font-size:13px;color:var(--d)" onclick="attWeekCellDelete(\''+ds+'\',\''+empName+'\')">초기화</button>'
    +'<button class="btn bp bblk" style="flex:2;padding:8px;font-size:13px" onclick="attWeekCellSave(\''+ds+'\',\''+empName+'\')">저장</button>'
    +'</div>';
  _attShowModal(title, body);
}
function attWeekCellSave(ds, empName){
  var inT=_attFmt((document.getElementById('awe_in')||{}).value||'09:00');
  var outT=_attFmt((document.getElementById('awe_out')||{}).value||'18:00');
  var raw=localStorage.getItem(_attDateKey(ds));
  var dayRec=raw?JSON.parse(raw):{};
  var existing=dayRec[empName]||{tags:[]};
  dayRec[empName]=Object.assign({},existing,{inTime:inT,outTime:outT});
  localStorage.setItem(_attDateKey(ds),JSON.stringify(dayRec));
  try{
    var ref=firebase.firestore().collection('attendance').doc(ds);
    ref.get().then(function(doc){
      var data=doc.exists?doc.data():{date:ds,records:{}};
      if(!data.records) data.records={};
      data.records[empName]=dayRec[empName];
      data.updatedAt=new Date().toISOString();
      return ref.set(data);
    });
  }catch(e){}
  toast(empName+' 저장 \u2713','s');
  _attCloseModal();
  _renderAttMonthly();
}
function attWeekCellDelete(ds, empName){
  var raw=localStorage.getItem(_attDateKey(ds));
  var dayRec=raw?JSON.parse(raw):{};
  delete dayRec[empName];
  if(Object.keys(dayRec).length) localStorage.setItem(_attDateKey(ds),JSON.stringify(dayRec));
  else localStorage.removeItem(_attDateKey(ds));
  toast(empName+' \ucd08\uae30\ud654 \u2713','s');
  _attCloseModal();
  _renderAttMonthly();
}
function attMonthClick(date){
  _attSubTab='input';
  document.querySelectorAll('.att-sub-tab').forEach(function(t){t.classList.remove('on');});
  var inp=document.querySelector('.att-sub-tab[data-tab="input"]');if(inp)inp.classList.add('on');
  _loadAttDate(date);
}

// ─── 직원 관리 ───
function _renderAttStaff(){
  var el=document.getElementById('attStaffList');if(!el)return;
  var sc=document.getElementById('attStaffCount');if(sc)sc.textContent=_attEmps.length;
  el.innerHTML=_attEmps.map(function(e,i){
    return '<div style="display:flex;align-items:center;padding:10px 0;border-bottom:0.5px solid var(--g2);gap:10px">'
      +'<span style="font-size:12px;color:var(--g4);width:20px;text-align:right">'+(i+1)+'</span>'
      +'<span style="flex:1;font-size:14px">'+e.name+'</span>'
      +'<span style="font-size:12px;color:var(--g5)">연차 '+e.annualDays+'일 / 잔여 <b style="color:var(--p)">'+(e.annualDays-(e.usedDays||0))+'일</b></span>'
      +'<button class="btn bo bsm" onclick="attEditStaff('+i+')">수정</button>'
      +'<button class="btn bo bsm" style="color:#e53935" onclick="attDeleteStaff('+i+')">삭제</button>'
      +'</div>';
  }).join('');
}
function attAddStaff(){var n=prompt('직원 이름:');if(!n||!n.trim())return;var d=parseInt(prompt('연차 일수:','15'))||15;_attEmps.push({name:n.trim(),annualDays:d,usedDays:0});_saveAttEmps();_renderAttStaff();}
function attEditStaff(i){var e=_attEmps[i],n=prompt('이름:',e.name);if(!n)return;var d=parseInt(prompt('연차 일수:',e.annualDays))||e.annualDays;_attEmps[i]=Object.assign({},e,{name:n.trim(),annualDays:d});_saveAttEmps();_renderAttStaff();}
function attDeleteStaff(i){if(!confirm(_attEmps[i].name+' 삭제?'))return;_attEmps.splice(i,1);_saveAttEmps();_renderAttStaff();}

// ─── 유틸 ───
function _attFmt(v){v=(v||'').replace(/[^0-9]/g,'');if(v.length>4)v=v.slice(0,4);if(v.length===3)v='0'+v;if(v.length===4)return v.slice(0,2)+':'+v.slice(2);return v;}
function _attCalcOut(t){if(!t||t.indexOf(':')<0)return '18:00';var p=t.split(':'),h=parseInt(p[0]),m=parseInt(p[1]),tot=h*60+m+9*60;return String(Math.floor(tot/60)).padStart(2,'0')+':'+String(tot%60).padStart(2,'0');}
function _attAddH(t,h){if(!t||t.indexOf(':')<0)return '';var p=t.split(':'),hr=parseInt(p[0]),mn=parseInt(p[1]),tot=hr*60+mn+h*60;return String(Math.floor(tot/60)).padStart(2,'0')+':'+String(tot%60).padStart(2,'0');}

// 태그 조합으로 실근무시간 계산
function _calcWorkHours(tags){
  if(tags.indexOf('annual')>=0||tags.indexOf('absent')>=0||tags.indexOf('holiday')>=0)return 0;
  var hasHalf=tags.indexOf('half-am')>=0||tags.indexOf('half-pm')>=0;
  var hasQtr=tags.indexOf('quarter')>=0;
  // 반차 있으면 기본 4시간, 없으면 9시간 (점심포함)
  var base=hasHalf?4:9;
  if(hasQtr)base-=2; // 반반차 = 2시간 추가 휴가
  return Math.max(0,base);
}

// 시각 기반 실근무시간 계산 (월별 조회 표시용)
// - 결근/연차: 0h
// - 정상: (퇴근-출근) - 1시간(점심)
// - 반차: 위에서 -4시간
// - 반반차: 위에서 -2시간
function _calcWorkHoursByTime(inTime, outTime, tags){
  if(!tags) tags=[];
  if(tags.indexOf('annual')>=0||tags.indexOf('absent')>=0||tags.indexOf('holiday')>=0) return 0;
  function _toMin(t){
    if(!t||t.indexOf(':')<0) return null;
    var p=t.split(':'); var h=parseInt(p[0]); var m=parseInt(p[1]);
    if(isNaN(h)||isNaN(m)) return null;
    return h*60+m;
  }
  var inM=_toMin(inTime), outM=_toMin(outTime);
  if(inM===null||outM===null||outM<=inM) return 0;
  // 점심(12:00~13:00)과 실제 근무시간이 겹치는 만큼만 차감.
  // (점심 전에 퇴근하면 점심을 빼지 않음 — 예: 09:00~11:00 = 2시간)
  var lunchStart=12*60, lunchEnd=13*60;
  var overlap=Math.max(0, Math.min(outM,lunchEnd)-Math.max(inM,lunchStart))/60;
  var hours=(outM-inM)/60 - overlap;
  if(tags.indexOf('half-am')>=0||tags.indexOf('half-pm')>=0) hours-=4;
  if(tags.indexOf('quarter')>=0) hours-=2;
  return Math.max(0, hours);
}

// ─────────────────────────────────────────────────────────
// 주간 출퇴근 서명표 엑셀 다운로드 (A4 가로 맞춤)
// ─────────────────────────────────────────────────────────
function attDownloadWeekly(){
  var today=new Date(_attDate);
  var day=today.getDay();
  var diff=day===0?-6:1-day;
  var mon=new Date(today); mon.setDate(today.getDate()+diff);

  var allDates=[], dlabels=['월','화','수','목','금','토','일'];
  for(var i=0;i<7;i++){var d=new Date(mon);d.setDate(mon.getDate()+i);allDates.push(d);}

  // 기록 있는 날만 필터
  var dates=allDates.filter(function(dt){
    var ds=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
    var raw=localStorage.getItem(_attDateKey(ds));
    if(!raw) return false;
    var dayRec=JSON.parse(raw);
    return _attEmps.some(function(e){
      var r=dayRec[e.name];
      return r&&(r.tags&&r.tags.length>0||r.inTime||r.outTime);
    });
  });
  if(dates.length===0){alert('이번 주 출퇴근 기록이 없습니다.');return;}

  var DS=8;
  var numDays=dates.length;
  var dlabelsByDate=dates.map(function(dt){return dlabels[(dt.getDay()===0?6:dt.getDay()-1)];});

  try{
    var yr=dates[0].getFullYear(), mo=dates[0].getMonth()+1;

    function addr(r,c){
      var col='';var cc=c;
      while(cc>0){col=String.fromCharCode(64+(cc%26||26))+col;cc=Math.floor((cc-1)/26);}
      return col+r;
    }
    function thin(){return {style:'thin'};}
    function med(){return {style:'medium'};}

    // 직원 배열 + 번호시작값 → 시트 1개 생성 (한 장 가득 채움)
    function buildSheet(emps, startNo){
      var ws={'!type':'sheet'};
      var SS=DS+numDays*8;
      var LASTCOL=SS+2;
      var LASTROW=3+emps.length;

      function setRange(r1,c1,r2,c2,val,style){
        if(r1!=r2||c1!=c2){
          ws['!merges']=ws['!merges']||[];
          ws['!merges'].push({s:{r:r1-1,c:c1-1},e:{r:r2-1,c:c2-1}});
        }
        var lw=style.bl||thin(), rw=style.br||thin(), tw=style.bt||thin(), bw=style.bb||thin();
        for(var r=r1;r<=r2;r++){
          for(var c=c1;c<=c2;c++){
            var a=addr(r,c);
            var border={left:c==c1?lw:null,right:c==c2?rw:null,top:r==r1?tw:null,bottom:r==r2?bw:null};
            ws[a]={
              v:(r==r1&&c==c1)?val:'',
              t:typeof val==='number'?'n':'s',
              s:{
                font:{name:'맑은 고딕',sz:style.sz||12,bold:style.bold!==false,color:style.fc?{rgb:style.fc}:undefined},
                alignment:{horizontal:style.ha||'center',vertical:'center'},
                fill:style.fill?{fgColor:{rgb:style.fill},patternType:'solid'}:{patternType:'none'},
                border:border
              }
            };
          }
        }
      }

      // 행1 제목 (전체폭 가로병합)
      setRange(1,1,1,LASTCOL, yr+'년 '+mo+'월 출퇴근 기록부',{sz:16,bold:true,bl:med(),br:med(),bt:med(),bb:thin()});
      // 서명 (2~3행, 날짜칸과 높이 맞춤)
      setRange(2,SS,3,LASTCOL,'서  명',{sz:13,bold:true,fill:'DBE5F1',bl:med(),br:med(),bt:thin(),bb:med()});

      // 행2 성명(2~3행 세로병합)/날짜
      setRange(2,1,3,7,'성  명',{sz:13,bold:true,fill:'DBE5F1',bl:med(),br:med(),bt:med(),bb:med()});
      for(var d=0;d<numDays;d++){
        var base=DS+d*8;
        var dt=dates[d];
        var lb=(dt.getMonth()+1)+'/'+dt.getDate()+'('+dlabelsByDate[d]+')';
        setRange(2,base,2,base+7,lb,{sz:12,bold:true,fill:'DBE5F1',bl:d==0?med():thin(),br:d==numDays-1?med():thin(),bt:med(),bb:thin()});
      }

      // 행3 출근/퇴근 (성명칸은 위에서 2~3행 병합 처리됨)
      for(var d=0;d<numDays;d++){
        var base=DS+d*8;
        setRange(3,base,3,base+3,'출 근',{sz:11,bold:true,fill:'DBE5F1',bl:d==0?med():thin(),br:thin(),bt:thin(),bb:med()});
        setRange(3,base+4,3,base+7,'퇴 근',{sz:11,bold:true,fill:'DBE5F1',bl:thin(),br:d==numDays-1?med():thin(),bt:thin(),bb:med()});
      }

      // 직원 행
      for(var idx=0;idx<emps.length;idx++){
        var row=4+idx;
        var name=emps[idx].name;
        var isLast=idx==emps.length-1;
        var bb=isLast?med():thin();
        var zebra=(idx%2===1)?'EEF2F7':'';   // 짝수행 옅은 회색 음영

        setRange(row,1,row,1,startNo+idx+1,{sz:13,bold:true,bl:med(),br:thin(),bt:thin(),bb:bb,fill:zebra});
        setRange(row,2,row,7,name,{sz:13,bold:true,bl:thin(),br:med(),bt:thin(),bb:bb,fill:zebra});

        for(var d=0;d<numDays;d++){
          var base=DS+d*8;
          var dt=dates[d];
          var ds=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
          var raw=localStorage.getItem(_attDateKey(ds));
          var r=raw?JSON.parse(raw)[name]:null;
          var inT='', outT='', mark='';
          if(r){
            var tags=r.tags||[];
            if(tags.indexOf('absent')>=0){mark='absent';}
            else if(tags.indexOf('annual')>=0){mark='annual';}
            else if(tags.indexOf('holiday')>=0){mark='holiday';}
            else{inT=r.inTime||'';outT=r.outTime||'';}
          }
          if(mark){
            var lbl=mark==='absent'?'결근':mark==='holiday'?'휴무':'연차';
            var bgc=mark==='absent'?'FBE0E0':mark==='holiday'?'CFFAFE':'EFEFEF';
            setRange(row,base,row,base+7,lbl,{sz:12,bold:true,fill:bgc,bl:d==0?med():thin(),br:d==numDays-1?med():thin(),bt:thin(),bb:bb});
          }else{
            setRange(row,base,row,base+3,inT,{sz:12,bold:true,fill:zebra,bl:d==0?med():thin(),br:thin(),bt:thin(),bb:bb});
            setRange(row,base+4,row,base+7,outT,{sz:12,bold:true,fill:zebra,bl:thin(),br:d==numDays-1?med():thin(),bt:thin(),bb:bb});
          }
        }
        setRange(row,SS,row,LASTCOL,'',{bl:med(),br:med(),bt:thin(),bb:bb,fill:zebra});
      }

      // 열 너비
      var perSignCell=(3.5*6)/3;
      var cols=[{wch:4}];
      for(var i=0;i<6;i++) cols.push({wch:3.5});
      for(var i=0;i<numDays*8;i++) cols.push({wch:2.75});
      for(var i=0;i<3;i++) cols.push({wch:perSignCell});
      ws['!cols']=cols;

      // 행 높이 — 한 페이지에 들어갈 인원(절반) 기준으로 잡아 각 페이지가 세로 꽉 차게
      var _perPage = Math.ceil(emps.length/2);
      var _hdr=[24,20,16];
      var _hdrSum=_hdr[0]+_hdr[1]+_hdr[2];
      var _totalWch=4+6*3.5+numDays*8*2.75+3*perSignCell;
      var _natW=_totalWch*7.2;
      var _targetH=_natW*(552/813);
      var _dataH=Math.max(20, Math.min(120, (_targetH-_hdrSum)/_perPage));
      var rows=[{hpt:_hdr[0]},{hpt:_hdr[1]},{hpt:_hdr[2]}];
      for(var i=0;i<emps.length;i++) rows.push({hpt:_dataH});
      ws['!rows']=rows;

      // 페이지 나누기는 아래 인쇄설정 단계(fflate)에서 XML로 직접 주입

      ws['!ref']=addr(1,1)+':'+addr(LASTROW,LASTCOL);
      return ws;
    }

    // 한 탭에 전원 — 인쇄 시 페이지 나누기로 2장 분할 (rowBreaks)
    var wb={SheetNames:[],Sheets:{}};
    wb.SheetNames.push('출퇴근기록부');
    wb.Sheets['출퇴근기록부']=buildSheet(_attEmps, 0);

    var fname='출퇴근_'+yr+String(mo).padStart(2,'0')+'.xlsx';
    // 인쇄설정: 시트마다 landscape + fitToWidth1 + fitToHeight1
    var _arr=XLSX.write(wb,{type:'array',bookType:'xlsx',cellStyles:true});
    var _z=fflate.unzipSync(new Uint8Array(_arr));
    var _dec=new TextDecoder(), _enc=new TextEncoder();
    // fitToWidth만 1 (가로 한 장), fitToHeight 미지정 → 세로는 페이지 나누기(rowBreaks)대로 분할
    var _ps='<pageMargins left="0.2" right="0.2" top="0.3" bottom="0.3" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
    // 절반 지점 행 뒤에서 페이지 나누기 (헤더3행 + 절반인원)
    var _perPage=Math.ceil(_attEmps.length/2);
    var _brkRow=3+_perPage;
    var _lastColIdx=(DS+numDays*8+2)-1;
    var _rb = _attEmps.length>_perPage
      ? '<rowBreaks count="1" manualBreakCount="1"><brk id="'+_brkRow+'" max="'+_lastColIdx+'" man="1"/></rowBreaks>'
      : '';
    Object.keys(_z).forEach(function(k){
      if(/^xl\/worksheets\/sheet\d+\.xml$/.test(k)){
        var xml=_dec.decode(_z[k]);
        if(xml.indexOf('<sheetPr')<0) xml=xml.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
        // 1) pageMargins/pageSetup 주입 (ignoredErrors 앞 또는 worksheet 끝)
        xml = xml.indexOf('<ignoredErrors')>=0 ? xml.replace('<ignoredErrors', _ps+'<ignoredErrors') : xml.replace('</worksheet>', _ps+'</worksheet>');
        // 2) rowBreaks 주입 — CT_Worksheet 순서상 pageSetup 뒤, ignoredErrors 앞
        if(_rb){
          if(xml.indexOf('<ignoredErrors')>=0) xml=xml.replace('<ignoredErrors', _rb+'<ignoredErrors');
          else xml=xml.replace('</worksheet>', _rb+'</worksheet>');
        }
        _z[k]=_enc.encode(xml);
      }
      // workbook.xml: Print_Titles 정의 → 매 페이지 헤더(1~3행) 반복
      if(k==='xl/workbook.xml'){
        var wxml=_dec.decode(_z[k]);
        if(wxml.indexOf('_xlnm.Print_Titles')<0){
          var dn='<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">출퇴근기록부!$1:$3</definedName></definedNames>';
          wxml=wxml.replace('</sheets>', '</sheets>'+dn);
          _z[k]=_enc.encode(wxml);
        }
      }
    });
    var _blob=new Blob([fflate.zipSync(_z)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    var _a=document.createElement('a');_a.href=URL.createObjectURL(_blob);_a.download=fname;document.body.appendChild(_a);_a.click();document.body.removeChild(_a);URL.revokeObjectURL(_a.href);
    toast('엑셀 다운로드 완료 ✓','s');
  }catch(e){
    alert('다운로드 실패: '+e.message);
  }
}

function _attShowModal(title, body){
  var ex=document.getElementById('att_modal_wrap'); if(ex) ex.remove();
  var wrap=document.createElement('div');
  wrap.id='att_modal_wrap';
  wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  var closeBtn='<button onclick="_attCloseModal()" style="font-size:18px;color:#9ca3af;background:none;border:none;cursor:pointer">✕</button>';
  wrap.innerHTML='<div style="background:#fff;border-radius:12px;width:100%;max-width:400px;padding:20px">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
    +'<span style="font-size:15px;font-weight:700">'+title+'</span>'
    +closeBtn
    +'</div>'+body+'</div>';
  document.body.appendChild(wrap);
}
function _attCloseModal(){var w=document.getElementById('att_modal_wrap');if(w)w.remove();}
window._attCloseModal = _attCloseModal;
