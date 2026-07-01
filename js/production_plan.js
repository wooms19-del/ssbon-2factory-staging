// 생산 계획 시뮬레이션 — 2공장 제품별 Capa 기반. 레토르트·내포장 호기·자숙 제약을 모두 지켜
// 1단계(품목별 단독 소요일수)와 2단계(혼합 블록)를 계산해 22일 안에 물량이 되는지 보여준다.

var PP_ORDER = ['미니','시그니처','코스트코','트레이더스','FC','메추리알'];
var PP_LABEL = {'미니':'미니 70g','시그니처':'시그니처 130g','코스트코':'코스트코 170g','트레이더스':'트레이더스 460g','FC':'FC 3kg','메추리알':'메추리알 180g'};

// 레토르트 EA/일 (3대·4대차·회전) — DB실측
var PP_RETORT = {'미니':46080,'시그니처':36864,'코스트코':36864,'트레이더스':13680,'FC':2304,'메추리알':36864};
// 내포장 3대병행 EA/일 (7.5h)
var PP_INNER3 = {'미니':51750,'시그니처':40500,'코스트코':40500,'트레이더스':35100,'FC':6750,'메추리알':40500};
// FC가 2호기 점유 시 내포장 한도: 미니(1·3·4호기)는 무관, 나머지는 3·4호기 2대(=3대의 2/3)
var PP_INNER2 = {'미니':51750,'시그니처':27000,'코스트코':27000,'트레이더스':23400,'FC':6750,'메추리알':27000};
// 자숙: 6,400kg 원육/일(탱크6대). 원육 kg/EA (원육사용량 ÷ 레토Capa)
var PP_MEATKG = {'미니':0.048,'시그니처':0.050,'코스트코':0.108,'트레이더스':0.314,'FC':2.70,'메추리알':0};
var PP_JASUK_KG = 6400;
var PP_HBASE = 7.5; // 기준 가동시간

// 편집 상태 (기본 물량 = 이달 계획)
var PP_STATE = {
  demand: {'미니':165029,'시그니처':100000,'코스트코':90000,'트레이더스':8000,'FC':32141,'메추리알':8000},
  days: 22,
  ot: 0.5  // 하루 연장(시간)
};

function setModeProdPlan(){
  document.querySelectorAll('.mb').forEach(function(b){b.classList.remove('on');});
  var hb=document.getElementById('ppHdBtn'); if(hb) hb.classList.add('on');
  var inav=document.getElementById('inav'); if(inav) inav.classList.add('hid');
  var dnav=document.getElementById('dnav'); if(dnav) dnav.classList.add('hid');
  document.querySelectorAll('.pg').forEach(function(p){p.classList.remove('on');});
  var pg=document.getElementById('p-prodplan'); if(pg) pg.classList.add('on');
  var ms=document.getElementById('mscroll'); if(ms) ms.scrollTop=0;
  renderProdPlan();
}

function ppSetDemand(k,v){ PP_STATE.demand[k]=Math.max(0,parseInt(String(v).replace(/[^0-9]/g,''),10)||0); renderProdPlan(); }
function ppSetDays(v){ PP_STATE.days=Math.max(1,parseInt(v,10)||22); renderProdPlan(); }
function ppSetOt(v){ PP_STATE.ot=Math.max(0,parseFloat(v)||0); renderProdPlan(); }

// 단독 하루최대 = min(레토, 내포장3대, 자숙EA)
function _ppDailyMax(k){
  var jasuk = PP_MEATKG[k]>0 ? PP_JASUK_KG/PP_MEATKG[k] : Infinity;
  var cands = [['레토르트',PP_RETORT[k]],['내포장',PP_INNER3[k]],['자숙',jasuk]];
  var min=Infinity, who='';
  cands.forEach(function(c){ if(c[1]<min){min=c[1];who=c[0];} });
  return {cap:min, bottleneck:who};
}

// 2단계 혼합: 빠른품목에 물량 비례로 일수를 배분(물량 큰 품목일수록 여러 날에 얇게 깔아 FC 여유 확보).
// 각 블록: 주품목은 그 일수에 나눠 생산, FC는 남는 레토르트를 매일 채움. 남는 날은 FC 집중.
function _ppSimulate(){
  var d=PP_STATE;
  var budget = 1 + d.ot/PP_HBASE;                 // 하루 레토르트 예산(3대=1.0, 연장 포함)
  var jasukKg = PP_JASUK_KG * (1 + d.ot/PP_HBASE);
  var fast=['미니','시그니처','코스트코','트레이더스','메추리알'];
  var active=fast.filter(function(k){return d.demand[k]>0;});
  var totalFast=0; active.forEach(function(k){totalFast+=d.demand[k];});
  // 물량 비례로 일수 배분(각 최소 1일), 합이 가동일수 넘으면 물량 큰 것부터 감소
  var daysP={}, sumP=0;
  active.forEach(function(k){ daysP[k]=Math.max(1,Math.round(d.demand[k]/totalFast*d.days)); sumP+=daysP[k]; });
  var order=active.slice().sort(function(a,b){return d.demand[b]-d.demand[a];});
  var gi=0;
  while(sumP>d.days && gi<5000){ var kk=order[gi%order.length]; if(daysP[kk]>1){daysP[kk]--;sumP--;} gi++; }
  var fcOnlyDays=Math.max(0,d.days-sumP);

  var blocks=[], made={}; PP_ORDER.forEach(function(k){made[k]=0;});
  order.forEach(function(k){
    var dd=daysP[k];
    var rate=Math.min(d.demand[k]/dd, PP_INNER2[k]);        // 내포장(FC 도는 날 2호기 뺏김) 제약
    var fcDaily=(budget - rate/PP_RETORT[k])*PP_RETORT['FC']; // 남는 레토르트를 FC로
    var jroom=(jasukKg - rate*PP_MEATKG[k])/PP_MEATKG['FC']; // 자숙 원육 제약
    fcDaily=Math.max(0,Math.min(fcDaily,jroom));
    rate=Math.round(rate); fcDaily=Math.round(fcDaily);
    made[k]+=rate*dd; made['FC']+=fcDaily*dd;
    blocks.push({main:k,days:dd,mainDaily:rate,fcDaily:fcDaily});
  });
  if(fcOnlyDays>0){
    var fcRate=Math.min(PP_RETORT['FC']*budget, jasukKg/PP_MEATKG['FC']);
    fcRate=Math.round(fcRate);
    made['FC']+=fcRate*fcOnlyDays;
    blocks.push({main:'FC',days:fcOnlyDays,mainDaily:0,fcDaily:fcRate});
  }
  var rem={},anyShort=false;
  PP_ORDER.forEach(function(k){ var s=d.demand[k]-made[k]; var tol=Math.max(2,d.demand[k]*0.005); if(s>tol){rem[k]=Math.round(s);anyShort=true;} });
  return {blocks:blocks,made:made,rem:rem,anyShort:anyShort,usedDays:sumP+fcOnlyDays};
}

function renderProdPlan(){
  var el=document.getElementById('p-prodplan'); if(!el) return;
  var d=PP_STATE;
  // 1단계
  var s1='', sumDaysF=0, sumDaysC=0;
  PP_ORDER.forEach(function(k){
    var dm=_ppDailyMax(k), days=d.demand[k]/dm.cap;
    sumDaysF+=days; sumDaysC+=Math.ceil(days);
    var hot = k==='FC';
    s1+='<tr style="border-top:0.5px solid #eef1f5;'+(hot?'background:#fff7ed':'')+'">'
      +'<td style="padding:7px 10px;font-weight:'+(hot?600:400)+'">'+PP_LABEL[k]+'</td>'
      +'<td style="text-align:right;padding:7px 10px"><input value="'+d.demand[k].toLocaleString()+'" onchange="ppSetDemand(\''+k+'\',this.value)" style="width:82px;text-align:right;border:1px solid #dde3ea;border-radius:5px;padding:3px 6px;font-size:12px"></td>'
      +'<td style="text-align:right;padding:7px 10px">'+Math.round(dm.cap).toLocaleString()+'</td>'
      +'<td style="text-align:center;padding:7px 10px"><span style="font-size:11px;background:#eef2f7;color:#475569;padding:2px 7px;border-radius:9px">'+dm.bottleneck+'</span></td>'
      +'<td style="text-align:right;padding:7px 10px;font-weight:600'+(hot?';color:#c2410c':'')+'">'+Math.ceil(days)+'일</td></tr>';
  });
  var over = sumDaysC - d.days;
  var s1warn = over>0
    ? '<div style="background:#fef2f2;border-radius:10px;padding:10px 14px;margin-top:10px;font-size:13px;color:#7f1d1d">⚠ 단독 생산으론 불가 — 합계 '+sumDaysC+'일로 '+d.days+'일을 '+over+'일 초과. 혼합 생산으로 압축 필요.</div>'
    : '<div style="background:#ecfdf5;border-radius:10px;padding:10px 14px;margin-top:10px;font-size:13px;color:#065f46">✅ 단독 합계 '+sumDaysC+'일 / '+d.days+'일 이내 — 혼합 없이도 가능.</div>';

  // 2단계
  var sim=_ppSimulate();
  var b2='';
  sim.blocks.forEach(function(bk){
    var main = bk.main==='FC' ? 'FC 3kg 집중' : ('FC 3kg + '+PP_LABEL[bk.main]);
    var prod = bk.main==='FC'
      ? ('FC '+bk.fcDaily.toLocaleString())
      : ('FC '+bk.fcDaily.toLocaleString()+' / '+PP_LABEL[bk.main].split(' ')[0]+' '+bk.mainDaily.toLocaleString());
    b2+='<tr style="border-top:0.5px solid #eef1f5"><td style="padding:7px 10px;font-weight:500">'+main+'</td>'
      +'<td style="text-align:center;padding:7px 10px">'+bk.days+'</td>'
      +'<td style="text-align:right;padding:7px 10px;color:#64748b">'+prod+'</td></tr>';
  });
  // 충족
  var made=sim.made;
  var chk='';
  PP_ORDER.forEach(function(k){
    var g=Math.round(made[k]), need=d.demand[k], diff=g-need, ok=g>=need-Math.max(2,need*0.005);
    chk+='<tr style="border-top:0.5px solid #eef1f5"><td style="padding:7px 10px">'+PP_LABEL[k]+'</td>'
      +'<td style="text-align:right;padding:7px 10px">'+need.toLocaleString()+'</td>'
      +'<td style="text-align:right;padding:7px 10px">'+g.toLocaleString()+'</td>'
      +'<td style="text-align:right;padding:7px 10px;color:'+(diff>=0?'#059669':'#dc2626')+'">'+(diff>=0?'+':'')+diff.toLocaleString()+'</td>'
      +'<td style="text-align:center;padding:7px 10px">'+(ok?'✅':'❌')+'</td></tr>';
  });
  var usedDays = sim.usedDays;
  var b2foot = !sim.anyShort
    ? '<div style="background:#ecfdf5;border-radius:10px;padding:10px 14px;margin-top:10px;font-size:13px;color:#065f46">✅ 블록 합계 '+usedDays+'일 / '+d.days+'일 · 하루 '+(d.ot*60)+'분 연장 · 전 품목 충족. 레토르트·내포장 호기·자숙 모두 안 넘김.</div>'
    : '<div style="background:#fef2f2;border-radius:10px;padding:10px 14px;margin-top:10px;font-size:13px;color:#7f1d1d">⚠ '+d.days+'일·연장 '+(d.ot*60)+'분으로는 부족: '+Object.keys(sim.rem).map(function(k){return PP_LABEL[k]+' '+sim.rem[k].toLocaleString()+'개';}).join(', ')+' 남음. 연장 시간이나 가동일수를 늘리세요.</div>';

  var th='text-align:left;padding:7px 10px;font-weight:600;font-size:11px;color:#334155';
  el.innerHTML=''
   +'<div style="max-width:760px;margin:0 auto;padding:14px 12px 40px">'
   +'<div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:2px">📊 월 생산 시뮬레이션</div>'
   +'<div style="font-size:12px;color:#94a3b8;margin-bottom:14px">레토르트 3대 · 내포장 FC외 3대병행(미니 1·3·4 / 나머지 2·3·4, FC 2호기) · 자숙 6,400kg · 7.5h/일 기준</div>'
   +'<div style="display:flex;gap:16px;align-items:center;margin-bottom:16px;font-size:13px;flex-wrap:wrap">'
     +'<span>월 생산가능일수 <input value="'+d.days+'" onchange="ppSetDays(this.value)" style="width:44px;text-align:center;border:1px solid #dde3ea;border-radius:5px;padding:3px;font-size:13px"> 일</span>'
     +'<span>하루 연장 <input value="'+d.ot+'" onchange="ppSetOt(this.value)" style="width:44px;text-align:center;border:1px solid #dde3ea;border-radius:5px;padding:3px;font-size:13px"> 시간</span>'
   +'</div>'
   +'<div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:8px">1단계 · 품목별 단독 소요일수</div>'
   +'<div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:12px">'
     +'<thead><tr style="background:#f8fafc"><th style="'+th+'">품목</th><th style="'+th+';text-align:right">월 물량</th><th style="'+th+';text-align:right">하루 최대</th><th style="'+th+';text-align:center">병목</th><th style="'+th+';text-align:right">단독 일수</th></tr></thead>'
     +'<tbody>'+s1+'</tbody>'
     +'<tfoot><tr style="border-top:2px solid #cbd5e1"><td colspan="4" style="padding:7px 10px;font-weight:600">단독 소요일수 합계</td><td style="text-align:right;padding:7px 10px;font-weight:700;color:'+(over>0?'#dc2626':'#059669')+'">'+sumDaysC+'일</td></tr></tfoot>'
   +'</table></div>'+s1warn
   +'<div style="font-size:14px;font-weight:700;color:#1e293b;margin:20px 0 8px">2단계 · 혼합 블록 구성 (하루 '+(d.ot*60)+'분 연장)</div>'
   +'<div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:14px"><table style="width:100%;border-collapse:collapse;font-size:12px">'
     +'<thead><tr style="background:#f8fafc"><th style="'+th+'">블록 구성</th><th style="'+th+';text-align:center">일수</th><th style="'+th+';text-align:right">하루 생산 (제품별 ea)</th></tr></thead>'
     +'<tbody>'+b2+'</tbody></table></div>'
   +'<div style="font-size:13px;font-weight:600;color:#334155;margin-bottom:6px">품목별 충족</div>'
   +'<div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:12px">'
     +'<thead><tr style="background:#f8fafc"><th style="'+th+'">품목</th><th style="'+th+';text-align:right">월 물량</th><th style="'+th+';text-align:right">혼합 생산량</th><th style="'+th+';text-align:right">과부족</th><th style="'+th+';text-align:center">충족</th></tr></thead>'
     +'<tbody>'+chk+'</tbody></table></div>'+b2foot
   +'</div>';
}
