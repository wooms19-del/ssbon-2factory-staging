// ============================================================
// 일정표  js/schedule.js  v5
// ============================================================
var _schYear=new Date().getFullYear(), _schMonth=new Date().getMonth(), _schTab='view';

function _schDocId(y,m){return y+'-'+String(m+1).padStart(2,'0');}

function initSchedule(){
  _schYear=new Date().getFullYear();_schMonth=new Date().getMonth();_schTab='view';
  renderSchedule();
}
function setModeSchedule(){
  document.querySelectorAll('.mb').forEach(function(b){b.classList.remove('on');});
  var sb=document.getElementById('schHdBtn');if(sb)sb.classList.add('on');
  var inav=document.getElementById('inav');if(inav)inav.classList.add('hid');
  var dnav=document.getElementById('dnav');if(dnav)dnav.classList.add('hid');
  document.querySelectorAll('.pg').forEach(function(p){p.classList.remove('on');});
  var ap=document.getElementById('p-schedule');if(ap)ap.classList.add('on');
  var ms=document.getElementById('mscroll');if(ms)ms.scrollTop=0;
  initSchedule();
}
function schPrevMonth(){_schMonth--;if(_schMonth<0){_schMonth=11;_schYear--;}renderSchedule();}
function schNextMonth(){_schMonth++;if(_schMonth>11){_schMonth=0;_schYear++;}renderSchedule();}
function schGoToday(){_schYear=new Date().getFullYear();_schMonth=new Date().getMonth();renderSchedule();}
function schSwitchTab(t){_schTab=t;renderSchedule();}

// ── 제품 목록 (레시피에서) ─────────────────────────────────────
function _schGetProducts(){
  try{
    var recs=L&&L.recipes?Object.keys(L.recipes):[];
    if(recs.length) return recs.sort();
  }catch(e){}
  // fallback
  return['시그니처 장조림 130g','코코 장조림 170g','트레이더스 장조림 460g','FC 장조림 3KG','미니 장조림 70g'];
}
function _schProdOpts(selected){
  var prods=_schGetProducts();
  var html='<option value="">-- 제품 선택 --</option>';
  prods.forEach(function(p){
    html+='<option value="'+p+'"'+(p===selected?' selected':'')+'>'+p+'</option>';
  });
  return html;
}

// ── 메인 렌더 ─────────────────────────────────────────────────
function renderSchedule(){
  var pg=document.getElementById('p-schedule');if(!pg)return;
  var docId=_schDocId(_schYear,_schMonth);
  pg.innerHTML=
    '<div style="background:var(--bg);border-bottom:var(--br)">'
    +'<div style="padding:10px 14px 0;display:flex;align-items:center;gap:8px;justify-content:space-between">'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +'<button class="btn" style="padding:4px 10px" onclick="schPrevMonth()">◀</button>'
    +'<span style="font-size:16px;font-weight:700">'+_schYear+'년 '+(_schMonth+1)+'월</span>'
    +'<button class="btn" style="padding:4px 10px" onclick="schNextMonth()">▶</button>'
    +'</div><button class="btn" style="padding:4px 12px;font-size:12px" onclick="schGoToday()">오늘</button></div>'
    +'<div style="display:flex;gap:0;padding:0 14px;margin-top:6px">'
    +['view','input'].map(function(t){
      var on=_schTab===t,lb=t==='input'?'일정 저장':'일정 현황';
      return '<button onclick="schSwitchTab(\''+t+'\')" style="padding:8px 20px;font-size:13px;font-weight:'+(on?700:500)+';color:'+(on?'var(--p)':'var(--g5)')+';border-bottom:'+(on?'2px solid var(--p)':'2px solid transparent')+';background:none;border-top:none;border-left:none;border-right:none;cursor:pointer">'+lb+'</button>';
    }).join('')+'</div></div>'
    +'<div id="sch_body" style="padding:14px"></div>';

  firebase.firestore().collection('schedules').doc(docId).get().then(function(doc){
    var data=doc.exists?doc.data():{days:{},summary:{}};
    if(_schTab==='input') _renderInput(data.days||{});
    else _renderView(data.days||{});
  }).catch(function(){
    if(_schTab==='input')_renderInput({});
    else _renderView({});
  });
}

// ── 일정 저장 탭 ──────────────────────────────────────────────
// 호환성 정규화: 단일객체 → {items:[],note:''}
function _schNorm(rec){
  if(!rec) return {items:[],note:''};
  if(Array.isArray(rec.items)) return {items:rec.items.slice(),note:rec.note||''};
  if(rec.product||rec.rawMeat||rec.packQty){
    return {items:[{product:rec.product||'',rawMeat:rec.rawMeat||'',packQty:rec.packQty||''}],note:rec.note||''};
  }
  return {items:[],note:rec.note||''};
}

function _schItemRowHtml(d,idx,it,canDel){
  return '<div class="sch-item-row" data-idx="'+idx+'" style="display:grid;grid-template-columns:1fr 110px 110px 26px;gap:6px;align-items:center">'
    +'<select class="fc sch-prod" style="width:100%;padding:4px 6px;font-size:12px">'+_schProdOpts(it.product||'')+'</select>'
    +'<div style="display:flex;align-items:center;gap:2px"><input class="fc sch-rm" type="number" value="'+(it.rawMeat||'')+'" placeholder="0" style="width:65px;padding:4px 6px;font-size:12px;text-align:right"><span style="font-size:11px;color:var(--g4)">kg</span></div>'
    +'<div style="display:flex;align-items:center;gap:2px"><input class="fc sch-pk" type="number" value="'+(it.packQty||'')+'" placeholder="0" style="width:65px;padding:4px 6px;font-size:12px;text-align:right"><span style="font-size:11px;color:var(--g4)">ea</span></div>'
    +(canDel
      ? '<button onclick="schRemoveItem('+d+',this)" style="width:24px;height:24px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:var(--d);font-size:14px;cursor:pointer">−</button>'
      : '<button onclick="schAddItem('+d+')" style="width:24px;height:24px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:#1a56db;font-size:14px;cursor:pointer">+</button>')
    +'</div>';
}

function _renderInput(days){
  var el=document.getElementById('sch_body');if(!el)return;
  var lastDate=new Date(_schYear,_schMonth+1,0).getDate();
  var today=new Date();
  var dow=['일','월','화','수','목','금','토'];

  var header='<div style="display:grid;grid-template-columns:52px 1fr 130px;gap:6px;padding:6px 10px;background:var(--g2);border-radius:8px 8px 0 0;font-size:11px;font-weight:600;color:var(--g5);margin-bottom:2px">'
    +'<div>날짜</div><div>제품 / 원육 / 포장량</div><div>기타 일정</div></div>';

  var listHtml='<div style="border:0.5px solid var(--g2);border-radius:0 0 10px 10px;overflow:hidden;margin-bottom:14px">';
  for(var d=1;d<=lastDate;d++){
    var ds=_schYear+'-'+String(_schMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var dt=new Date(_schYear,_schMonth,d);
    var dayName=dow[dt.getDay()];
    var isToday=d===today.getDate()&&_schMonth===today.getMonth()&&_schYear===today.getFullYear();
    var isSun=dt.getDay()===0,isSat=dt.getDay()===6;
    var dc=isSun?'var(--d)':isSat?'#1a56db':'var(--g7)';
    var rec=_schNorm(days[ds]);
    var items=rec.items.length?rec.items:[{}];
    var bg=isToday?'#f0f7ff':d%2===0?'var(--g1)':'var(--bg)';

    var itemRowsHtml='';
    items.forEach(function(it,idx){
      itemRowsHtml+=_schItemRowHtml(d,idx,it,idx>0);
    });

    listHtml+='<div data-day="'+d+'" style="display:grid;grid-template-columns:52px 1fr 130px;gap:6px;padding:6px 8px;border-bottom:0.5px solid var(--g2);background:'+bg+';align-items:start">'
      +'<div style="font-size:13px;font-weight:'+(isToday?700:500)+';color:'+dc+';padding-top:5px">'+d+'<span style="font-size:10px;margin-left:2px">('+dayName+')</span></div>'
      +'<div class="sch-items" id="sch_items_'+d+'" style="display:flex;flex-direction:column;gap:4px">'+itemRowsHtml+'</div>'
      +'<input class="fc" id="sch_note_'+d+'" value="'+(rec.note||'').replace(/"/g,'&quot;')+'" placeholder="기타 일정..." style="width:100%;padding:4px 6px;font-size:12px;align-self:start;margin-top:2px">'
      +'</div>';
  }
  listHtml+='</div>';

  var saveBtn='<button class="btn bp bblk" style="width:100%;padding:10px;font-size:14px;font-weight:700" onclick="schSaveAll()">💾 저장</button>';
  el.innerHTML=header+listHtml+saveBtn;
}

function schAddItem(d){
  var c=document.getElementById('sch_items_'+d);if(!c)return;
  // 기존 모든 + 버튼을 - 버튼으로 변환
  Array.from(c.children).forEach(function(row,idx){
    var btn=row.querySelector('button');
    if(btn && btn.textContent==='+'){
      btn.textContent='−';
      btn.style.color='var(--d)';
      btn.setAttribute('onclick','schRemoveItem('+d+',this)');
    }
  });
  // 새 행 추가 (마지막 행이 +버튼)
  var newIdx=c.children.length;
  var wrap=document.createElement('div');
  wrap.innerHTML=_schItemRowHtml(d,newIdx,{},false); // 마지막=+ 유지
  c.appendChild(wrap.firstChild);
  // 마지막 직전 행은 -로 다시 (마지막은 +)
  var rows=c.children;
  if(rows.length>1){
    var prev=rows[rows.length-2].querySelector('button');
    if(prev){
      prev.textContent='−';
      prev.style.color='var(--d)';
      prev.setAttribute('onclick','schRemoveItem('+d+',this)');
    }
  }
}

function schRemoveItem(d,btn){
  var c=document.getElementById('sch_items_'+d);if(!c)return;
  var row=btn.closest('.sch-item-row');
  if(!row)return;
  if(c.children.length<=1)return; // 최소 1개
  row.remove();
  // 마지막 행을 +버튼으로
  var last=c.children[c.children.length-1].querySelector('button');
  if(last){
    last.textContent='+';
    last.style.color='#1a56db';
    last.setAttribute('onclick','schAddItem('+d+')');
  }
}

// ── 저장 ─────────────────────────────────────────────────────
function schSaveAll(){
  var lastDate=new Date(_schYear,_schMonth+1,0).getDate();
  var days={};
  var totals={};

  for(var d=1;d<=lastDate;d++){
    var ds=_schYear+'-'+String(_schMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var note=((document.getElementById('sch_note_'+d)||{}).value||'').trim();
    var c=document.getElementById('sch_items_'+d);
    var items=[];
    if(c){
      Array.from(c.children).forEach(function(row){
        var prod=(row.querySelector('.sch-prod')||{}).value||'';
        var rm=parseFloat((row.querySelector('.sch-rm')||{}).value)||0;
        var pk=parseInt((row.querySelector('.sch-pk')||{}).value)||0;
        if(prod||rm||pk) items.push({product:prod,rawMeat:rm||'',packQty:pk||''});
      });
    }
    if(items.length===0 && !note) continue;
    days[ds]={items:items,note:note};
    items.forEach(function(it){
      if(it.product){
        if(!totals[it.product]) totals[it.product]={product:it.product,rawMeat:0,packQty:0,days:0};
        totals[it.product].rawMeat+=parseFloat(it.rawMeat)||0;
        totals[it.product].packQty+=parseInt(it.packQty)||0;
        totals[it.product].days++;
      }
    });
  }
  var items2=Object.values(totals);
  var docId=_schDocId(_schYear,_schMonth);
  firebase.firestore().collection('schedules').doc(docId).get().then(function(doc){
    var data=doc.exists?doc.data():{days:{},summary:{}};
    data.days=days;
    if(!data.summary) data.summary={};
    data.summary.items=items2;
    data.updatedAt=new Date().toISOString();
    return firebase.firestore().collection('schedules').doc(docId).set(data);
  }).then(function(){
    toast('저장 완료 ✓','s');
    _schTab='view';
    renderSchedule();
  });
}

// ── 일정 현황 탭 ──────────────────────────────────────────────
function _renderView(days){
  var el=document.getElementById('sch_body');if(!el)return;
  // 합산 (items 배열 + 구버전 객체 모두 처리)
  var totals={};
  Object.values(days).forEach(function(rec){
    var n=_schNorm(rec);
    n.items.forEach(function(it){
      var p=it.product;if(!p)return;
      if(!totals[p]) totals[p]={product:p,rawMeat:0,packQty:0,days:0};
      totals[p].rawMeat+=parseFloat(it.rawMeat)||0;
      totals[p].packQty+=parseInt(it.packQty)||0;
      totals[p].days++;
    });
  });
  var totalItems=Object.values(totals);

  el.innerHTML='<div style="display:flex;gap:14px;align-items:flex-start">'
    +'<div style="flex:1;min-width:0" id="sch_cal_wrap"></div>'
    +'<div style="width:210px;min-width:190px" id="sch_sum_wrap"></div>'
    +'</div>';

  _renderCal(days);
  _renderSumPanel(totalItems);
}

function _renderCal(days){
  var el=document.getElementById('sch_cal_wrap');if(!el)return;
  var today=new Date();
  var firstDay=new Date(_schYear,_schMonth,1).getDay();
  var lastDate=new Date(_schYear,_schMonth+1,0).getDate();
  var dow=['일','월','화','수','목','금','토'];
  var html='<table style="width:100%;border-collapse:collapse;table-layout:fixed">';
  html+='<tr>';
  dow.forEach(function(d,i){
    var c=i===0?'var(--d)':i===6?'#1a56db':'var(--g6)';
    html+='<th style="padding:8px 4px;font-size:12px;color:'+c+';font-weight:600;text-align:center;border-bottom:2px solid var(--g2)">'+d+'</th>';
  });
  html+='</tr>';
  var date=1;
  for(var wk=0;wk<6;wk++){
    if(date>lastDate)break;
    html+='<tr>';
    for(var dw=0;dw<7;dw++){
      if((wk===0&&dw<firstDay)||date>lastDate){
        html+='<td style="height:100px;border:0.5px solid var(--g2);background:var(--g1)"></td>';
      } else {
        var ds=_schYear+'-'+String(_schMonth+1).padStart(2,'0')+'-'+String(date).padStart(2,'0');
        var isT=date===today.getDate()&&_schMonth===today.getMonth()&&_schYear===today.getFullYear();
        var isSun=dw===0,isSat=dw===6;
        var dc=isSun?'var(--d)':isSat?'#1a56db':'var(--g7)';
        var rec=_schNorm(days[ds]);
        html+='<td style="height:100px;vertical-align:top;padding:4px;border:0.5px solid var(--g2);cursor:pointer;background:'+(isT?'#eff6ff':'var(--bg)')+'" onclick="schDayEdit(\''+ds+'\')">';
        html+='<div style="font-size:12px;font-weight:'+(isT?700:500)+';color:'+dc+';'+(isT?'width:22px;height:22px;background:#1a56db;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:2px;':'')+'">'+date+'</div>';
        rec.items.forEach(function(it){
          if(it.product) html+='<div style="font-size:10px;padding:1px 4px;background:#eff6ff;color:#1a56db;border-radius:3px;margin-top:1px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+it.product+'</div>';
          if(it.packQty) html+='<div style="font-size:10px;color:var(--g5);margin-top:1px">📦 '+Number(it.packQty).toLocaleString()+'ea</div>';
          if(it.rawMeat) html+='<div style="font-size:10px;color:var(--g5)">🥩 '+it.rawMeat+'kg</div>';
        });
        if(rec.note) html+='<div style="font-size:10px;color:var(--g4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+rec.note+'</div>';
        html+='</td>';
        date++;
      }
    }
    html+='</tr>';
  }
  html+='</table>';
  el.innerHTML=html;
}

function _renderSumPanel(totalItems){
  var el=document.getElementById('sch_sum_wrap');if(!el)return;
  var docId=_schDocId(_schYear,_schMonth);
  firebase.firestore().collection('schedules').doc(docId).get().then(function(doc){
    var s=(doc.exists?doc.data():{}).summary||{};
    var html='<div style="position:sticky;top:14px">'
      +'<div style="background:var(--g1);border-radius:10px;padding:12px;border:0.5px solid var(--g2);margin-bottom:10px">'
      +'<div style="font-size:13px;font-weight:700;color:var(--g6);margin-bottom:10px">📊 '+_schYear+'년 '+(_schMonth+1)+'월 합계</div>';

    if(totalItems.length){
      totalItems.forEach(function(t){
        html+='<div style="margin-bottom:8px;padding:8px 10px;background:#fff;border-radius:8px;border:0.5px solid var(--g2)">'
          +'<div style="font-size:11px;font-weight:700;color:#1a56db;margin-bottom:4px">'+t.product+'</div>'
          +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">'
          +'<span style="font-size:11px;color:var(--g5)">📦 예상 포장</span>'
          +'<span style="font-size:13px;font-weight:700;color:var(--g7)">'+t.packQty.toLocaleString()+'ea</span>'
          +'</div>'
          +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">'
          +'<span style="font-size:11px;color:var(--g5)">🥩 원육 사용</span>'
          +'<span style="font-size:13px;font-weight:700;color:var(--g7)">'+t.rawMeat.toLocaleString()+'kg</span>'
          +'</div>'
          +'<div style="font-size:10px;color:var(--g4)">생산일 '+t.days+'일</div>'
          +'</div>';
      });
    } else {
      html+='<div style="font-size:12px;color:var(--g4);text-align:center;padding:20px 0">생산계획 없음</div>';
    }
    if(s.rawMeat||s.workDays||s.notes){
      html+='<div style="margin-top:8px;padding-top:8px;border-top:0.5px solid var(--g3)">';
      if(s.rawMeat) html+='<div style="font-size:12px;color:var(--g6);margin-bottom:3px">🥩 총 원육 목표: <b>'+s.rawMeat+'</b></div>';
      if(s.workDays) html+='<div style="font-size:12px;color:var(--g6);margin-bottom:3px">📅 생산일: <b>'+s.workDays+'일</b></div>';
      if(s.notes) html+='<div style="font-size:11px;color:var(--g5);white-space:pre-wrap">'+s.notes+'</div>';
      html+='</div>';
    }
    html+='<button class="btn" style="width:100%;margin-top:10px;padding:6px;font-size:12px" onclick="schEditExtra()">⚙️ 월 목표 설정</button>';
    html+='</div></div>';
    el.innerHTML=html;
  });
}

// ── 날짜 클릭 → 수정 모달 ─────────────────────────────────────
function schDayEdit(ds){
  var parts=ds.split('-'),mm=parseInt(parts[1]),dd=parseInt(parts[2]);
  var docId=_schDocId(_schYear,_schMonth);
  firebase.firestore().collection('schedules').doc(docId).get().then(function(doc){
    var data=doc.exists?doc.data():{days:{},summary:{}};
    var rec=_schNorm((data.days||{})[ds]);
    var items=rec.items.length?rec.items:[{}];
    var itemsHtml='';
    items.forEach(function(it,idx){
      itemsHtml+=_schModalRowHtml(idx,it,idx>0);
    });
    var body='<div style="display:flex;flex-direction:column;gap:10px">'
      +'<div id="sch_edit_items" style="display:flex;flex-direction:column;gap:8px">'+itemsHtml+'</div>'
      +'<div><div style="font-size:12px;color:var(--g5);margin-bottom:4px">기타 일정</div>'
      +'<input class="fc" id="sch_edit_note" value="'+(rec.note||'').replace(/"/g,'&quot;')+'" placeholder="기타 일정 메모..." style="width:100%;padding:7px 8px;font-size:13px;box-sizing:border-box"></div>'
      +'</div>'
      +'<div style="display:flex;gap:8px;margin-top:14px">'
      +'<button class="btn" style="flex:1;padding:8px;font-size:13px;color:var(--d)" onclick="schDayDelete(\''+docId+'\',\''+ds+'\')">삭제</button>'
      +'<button class="btn bp bblk" style="flex:2;padding:8px;font-size:13px" onclick="schDaySave(\''+docId+'\',\''+ds+'\')">저장</button>'
      +'</div>';
    _schShowModal(mm+'월 '+dd+'일', body);
  });
}

function _schModalRowHtml(idx,it,canDel){
  return '<div class="sch-edit-row" style="display:grid;grid-template-columns:1fr 80px 80px 26px;gap:6px;align-items:end">'
    +'<div><div style="font-size:11px;color:var(--g5);margin-bottom:3px">제품</div>'
    +'<select class="fc sch-edit-prod" style="width:100%;padding:6px;font-size:12px">'+_schProdOpts(it.product||'')+'</select></div>'
    +'<div><div style="font-size:11px;color:var(--g5);margin-bottom:3px">원육(kg)</div>'
    +'<input class="fc sch-edit-rm" type="number" value="'+(it.rawMeat||'')+'" placeholder="0" style="width:100%;padding:6px;font-size:12px;box-sizing:border-box;text-align:right"></div>'
    +'<div><div style="font-size:11px;color:var(--g5);margin-bottom:3px">포장(ea)</div>'
    +'<input class="fc sch-edit-pk" type="number" value="'+(it.packQty||'')+'" placeholder="0" style="width:100%;padding:6px;font-size:12px;box-sizing:border-box;text-align:right"></div>'
    +(canDel
      ? '<button onclick="schModalRemoveItem(this)" style="width:24px;height:32px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:var(--d);font-size:14px;cursor:pointer">−</button>'
      : '<button onclick="schModalAddItem()" style="width:24px;height:32px;border:1px solid var(--g3);border-radius:4px;background:#fff;color:#1a56db;font-size:14px;cursor:pointer">+</button>')
    +'</div>';
}

function schModalAddItem(){
  var c=document.getElementById('sch_edit_items');if(!c)return;
  Array.from(c.children).forEach(function(row){
    var btn=row.querySelector('button');
    if(btn && btn.textContent==='+'){
      btn.textContent='−';btn.style.color='var(--d)';
      btn.setAttribute('onclick','schModalRemoveItem(this)');
    }
  });
  var newIdx=c.children.length;
  var wrap=document.createElement('div');
  wrap.innerHTML=_schModalRowHtml(newIdx,{},false);
  c.appendChild(wrap.firstChild);
}

function schModalRemoveItem(btn){
  var c=document.getElementById('sch_edit_items');if(!c)return;
  var row=btn.closest('.sch-edit-row');
  if(!row||c.children.length<=1)return;
  row.remove();
  var last=c.children[c.children.length-1].querySelector('button');
  if(last){last.textContent='+';last.style.color='#1a56db';last.setAttribute('onclick','schModalAddItem()');}
}

function schDaySave(docId,ds){
  var c=document.getElementById('sch_edit_items');
  var items=[];
  if(c){
    Array.from(c.children).forEach(function(row){
      var prod=(row.querySelector('.sch-edit-prod')||{}).value||'';
      var rm=parseFloat((row.querySelector('.sch-edit-rm')||{}).value)||0;
      var pk=parseInt((row.querySelector('.sch-edit-pk')||{}).value)||0;
      if(prod||rm||pk) items.push({product:prod,rawMeat:rm||'',packQty:pk||''});
    });
  }
  var note=((document.getElementById('sch_edit_note')||{}).value||'').trim();
  var ref=firebase.firestore().collection('schedules').doc(docId);
  ref.get().then(function(doc){
    var data=doc.exists?doc.data():{days:{},summary:{}};
    if(!data.days) data.days={};
    if(items.length||note) data.days[ds]={items:items,note:note};
    else delete data.days[ds];
    // 합산 재계산
    var totals={};
    Object.values(data.days).forEach(function(r){
      var n=_schNorm(r);
      n.items.forEach(function(it){
        var p=it.product;if(!p)return;
        if(!totals[p]) totals[p]={product:p,rawMeat:0,packQty:0,days:0};
        totals[p].rawMeat+=parseFloat(it.rawMeat)||0;
        totals[p].packQty+=parseInt(it.packQty)||0;
        totals[p].days++;
      });
    });
    if(!data.summary) data.summary={};
    data.summary.items=Object.values(totals);
    data.updatedAt=new Date().toISOString();
    return ref.set(data);
  }).then(function(){
    toast('저장 완료 ✓','s');_schCloseModal();renderSchedule();
  });
}

function schDayDelete(docId,ds){
  if(!confirm('이 날짜 일정을 삭제할까요?'))return;
  var ref=firebase.firestore().collection('schedules').doc(docId);
  ref.get().then(function(doc){
    var data=doc.exists?doc.data():{days:{},summary:{}};
    if(data.days) delete data.days[ds];
    data.updatedAt=new Date().toISOString();
    return ref.set(data);
  }).then(function(){toast('삭제 완료','s');_schCloseModal();renderSchedule();});
}

function schEditExtra(){
  var docId=_schDocId(_schYear,_schMonth);
  firebase.firestore().collection('schedules').doc(docId).get().then(function(doc){
    var s=(doc.exists?doc.data():{}).summary||{};
    var body='<div style="display:flex;flex-direction:column;gap:8px">'
      +'<div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--g5);min-width:70px">원육 목표</span><input class="fc" id="sch_rm2" value="'+(s.rawMeat||'')+'" placeholder="예) 1900ton" style="flex:1;padding:5px 8px;font-size:12px"></div>'
      +'<div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--g5);min-width:70px">생산일 수</span><input class="fc" id="sch_wd2" value="'+(s.workDays||'')+'" placeholder="22" type="number" style="flex:1;padding:5px 8px;font-size:12px"></div>'
      +'<div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--g5);min-width:70px">특이사항</span><textarea class="fc" id="sch_nt2" rows="3" style="flex:1;padding:5px 8px;font-size:12px;resize:vertical">'+(s.notes||'')+'</textarea></div>'
      +'</div>'
      +'<button class="btn bp bblk" style="width:100%;padding:8px;margin-top:12px" onclick="schSaveExtra(\''+docId+'\')">저장</button>';
    _schShowModal('월 목표 설정', body);
  });
}
function schSaveExtra(docId){
  var rm=(document.getElementById('sch_rm2')||{}).value||'';
  var wd=(document.getElementById('sch_wd2')||{}).value||'';
  var nt=(document.getElementById('sch_nt2')||{}).value||'';
  var ref=firebase.firestore().collection('schedules').doc(docId);
  ref.get().then(function(doc){
    var data=doc.exists?doc.data():{days:{},summary:{}};
    if(!data.summary) data.summary={};
    Object.assign(data.summary,{rawMeat:rm,workDays:wd,notes:nt});
    data.updatedAt=new Date().toISOString();
    return ref.set(data);
  }).then(function(){toast('저장 완료 ✓','s');_schCloseModal();renderSchedule();});
}

// ── 모달 ──────────────────────────────────────────────────────
function _schShowModal(title,body){
  var ex=document.getElementById('sch_modal_wrap');if(ex)ex.remove();
  var wrap=document.createElement('div');
  wrap.id='sch_modal_wrap';
  wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  wrap.innerHTML='<div style="background:#fff;border-radius:12px;width:100%;max-width:420px;max-height:85vh;overflow-y:auto;padding:20px">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
    +'<span style="font-size:15px;font-weight:700">'+title+'</span>'
    +'<button onclick="_schCloseModal()" style="font-size:18px;color:var(--g4);background:none;border:none;cursor:pointer">✕</button>'
    +'</div>'+body+'</div>';
  document.body.appendChild(wrap);
}
function _schCloseModal(){var w=document.getElementById('sch_modal_wrap');if(w)w.remove();}

// ── window 바인딩 ─────────────────────────────────────────────
window.setModeSchedule=setModeSchedule; window.initSchedule=initSchedule;
window.renderSchedule=renderSchedule;   window.schPrevMonth=schPrevMonth;
window.schNextMonth=schNextMonth;       window.schGoToday=schGoToday;
window.schSwitchTab=schSwitchTab;       window.schSaveAll=schSaveAll;
window.schDayEdit=schDayEdit;           window.schDaySave=schDaySave;
window.schDayDelete=schDayDelete;       window.schEditExtra=schEditExtra;
window.schSaveExtra=schSaveExtra;       window._schCloseModal=_schCloseModal;
window.schAddItem=schAddItem;           window.schRemoveItem=schRemoveItem;
window.schModalAddItem=schModalAddItem; window.schModalRemoveItem=schModalRemoveItem;
