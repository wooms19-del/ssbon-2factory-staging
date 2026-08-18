/* 조회 화면 묶음: 이력추적 · 비가식부·생산성 · 출퇴근 · 일정표 */
(function(){
  window.SSBON = window.SSBON || {};
  var cfg=null;
  var PARTN={1:'홍두깨',2:'설도',3:'우둔',4:'설깃'};

  function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n;}
  function f(n,d){return (n==null||isNaN(n))?'—':Number(n).toLocaleString('ko-KR',
    {minimumFractionDigits:d||0,maximumFractionDigits:d||0});}
  function pt(v,d){return (v==null||isNaN(v))?'—':v.toFixed(d==null?1:d)+'%';}
  function q(p){
    return fetch(cfg.restUrl+'/'+p,{headers:{apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey}})
      .then(function(r){ if(!r.ok) return r.text().then(function(t){throw new Error(p.split('?')[0]+' '+r.status+' '+t);}); return r.json(); });
  }
  function fail(w,e){
    w.innerHTML='';
    var k=el('div','card'); k.appendChild(el('h2',null,'불러오지 못했습니다.'));
    k.appendChild(el('p','sub-t',String(e.message||e))); w.appendChild(k);
  }
  function mins(s){
    if(!s) return null;
    var v=String(s).replace('T',' ');
    var m=v.match(/(\d{1,2}):(\d{2})/);   /* 'HH:MM:SS' 와 날짜+시각 모두 처리 */
    return m? (+m[1])*60+(+m[2]) : null;
  }
  function hhmm(m){ return m==null?'—':String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }
  function lastDay(ym){return new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate();}
  function prevYm(ym){var y=+ym.slice(0,4),m=+ym.slice(5,7)-1;if(m===0){y--;m=12;}return y+'-'+String(m).padStart(2,'0');}
  function monthRange(ym){ return [ym+'-01', ym+'-'+String(lastDay(ym)).padStart(2,'0')]; }

  function monthBar(get,set,go){
    var b=el('div','daybar');
    function shift(n){
      var y=+get().slice(0,4),m=+get().slice(5,7)+n;
      while(m<1){m+=12;y--;} while(m>12){m-=12;y++;}
      set(y+'-'+String(m).padStart(2,'0'));
    }
    var p=el('button','fchip','◀'); p.addEventListener('click',function(){shift(-1);go();});
    var i=el('input','search'); i.type='month'; i.value=get();
    i.addEventListener('change',function(){ if(i.value){set(i.value);go();} });
    var n=el('button','fchip','▶'); n.addEventListener('click',function(){shift(1);go();});
    b.appendChild(p); b.appendChild(i); b.appendChild(n);
    return b;
  }

  /* ══════════ 이력추적 ══════════ */
  var TR={code:'', result:null};
  function viewTrace(c){
    var w=el('div'); c.appendChild(w);
    drawTrace(w);
  }
  function drawTrace(w){
    w.innerHTML='';
    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null,'이력추적'));
    k.appendChild(el('p','sub-t','원육 바코드나 수입코드를 넣으면 그 박스가 어느 대차·공정을 거쳐 어떤 제품이 됐는지 따라갑니다.'));
    var row=el('div','frow');
    var inp=el('input','search'); inp.type='search';
    inp.placeholder='수입코드 또는 이력번호 (일부만 넣어도 됩니다)';
    inp.value=TR.code; inp.style.minWidth='340px';
    var btn=el('button','fchip on','추적');
    function run(){
      TR.code=inp.value.trim();
      if(!TR.code) return;
      trace(w);
    }
    btn.addEventListener('click',run);
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter') run(); });
    row.appendChild(inp); row.appendChild(btn);
    k.appendChild(row);
    w.appendChild(k);
    if(TR.result) w.appendChild(TR.result);
  }
  function trace(w){
    var body=el('div'); body.appendChild(el('div','empty','추적 중…'));
    TR.result=body; drawTrace(w);
    var code=encodeURIComponent(TR.code);
    q('meat_box?select=box_id,scan_date,import_code,trace_code,weight_kg,status,pack_date,expiry_date,part_id,origin_id'
      +'&or=(import_code.ilike.*'+code+'*,trace_code.ilike.*'+code+'*)&limit=50')
      .then(function(boxes){
        if(!boxes.length){
          body.innerHTML='';
          var k=el('div','card pending');
          k.appendChild(el('h2',null,'찾지 못했습니다.'));
          k.appendChild(el('p','sub-t','수입코드나 이력번호를 다시 확인해 주십시오.'));
          body.appendChild(k); return;
        }
        var ids=boxes.map(function(b){return b.box_id;});
        return q('thaw_cart_box?select=box_id,cart_id,thaw_cart!inner(cart_no,start_date,finish_date,part_id,total_kg)'
          +'&box_id=in.('+ids.join(',')+')')
          .then(function(links){
            var carts=links.map(function(l){return l.cart_id;});
            if(!carts.length) return {boxes:boxes,links:links,src:[]};
            return q('preprocess_source?select=cart_id,used_kg,pp_id,preprocess_run!inner(work_date,cage_no,output_kg,waste_kg)'
              +'&cart_id=in.('+carts.join(',')+')')
              .then(function(src){ return {boxes:boxes,links:links,src:src}; });
          });
      })
      .then(function(d){
        if(!d) return;
        body.innerHTML='';
        body.appendChild(traceResult(d));
      })
      .catch(function(e){ fail(body,e); });
  }
  function traceResult(d){
    var k=el('div','card');
    k.appendChild(el('h2',null,'원육 박스 '+d.boxes.length+'건'));
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th style="width:88px">입고일</th><th>수입코드</th>'
      +'<th style="width:76px">부위</th><th class="num" style="width:84px">중량</th>'
      +'<th style="width:96px">소비기한</th><th style="width:70px">판정</th></tr></thead>';
    var tb=el('tbody');
    d.boxes.forEach(function(b){
      var tr=el('tr');
      tr.appendChild(el('td','code',b.scan_date));
      var c2=el('td','code',b.import_code||b.trace_code||'—'); c2.style.fontSize='11px';
      tr.appendChild(c2);
      var c3=el('td');
      if(b.part_id) c3.appendChild(el('span','badge g-'+PARTN[b.part_id],PARTN[b.part_id]));
      tr.appendChild(c3);
      tr.appendChild(el('td','num',f(b.weight_kg,2)+' kg'));
      tr.appendChild(el('td','code',b.expiry_date||'—'));
      var c6=el('td',null,b.status||'—');
      if(b.status && b.status.indexOf('부적합')>=0) c6.style.color='#B4342C';
      tr.appendChild(c6);
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);

    if(d.links.length){
      var h2=el('h2',null,'투입된 방혈 대차 '+d.links.length+'건'); h2.style.marginTop='16px';
      k.appendChild(h2);
      var t2=el('table','tbl');
      t2.innerHTML='<thead><tr><th style="width:70px">대차</th><th style="width:92px">시작</th>'
        +'<th style="width:92px">완료</th><th style="width:76px">부위</th>'
        +'<th class="num" style="width:100px">대차 총중량</th></tr></thead>';
      var tb2=el('tbody'), seen={};
      d.links.forEach(function(l){
        if(seen[l.cart_id]) return; seen[l.cart_id]=1;
        var c=l.thaw_cart||{}, tr=el('tr');
        tr.appendChild(el('td','nm',c.cart_no+'번'));
        tr.appendChild(el('td','code',c.start_date||'—'));
        tr.appendChild(el('td','code',c.finish_date||'—'));
        var c4=el('td');
        if(c.part_id) c4.appendChild(el('span','badge g-'+PARTN[c.part_id],PARTN[c.part_id]));
        tr.appendChild(c4);
        tr.appendChild(el('td','num',f(c.total_kg,2)+' kg'));
        tb2.appendChild(tr);
      });
      t2.appendChild(tb2); k.appendChild(t2);
    }

    if(d.src && d.src.length){
      var h4=el('h2',null,'전처리 투입 '+d.src.length+'건'); h4.style.marginTop='16px';
      k.appendChild(h4);
      var t3=el('table','tbl');
      t3.innerHTML='<thead><tr><th style="width:92px">작업일</th><th>케이지</th>'
        +'<th class="num" style="width:100px">차감 kg</th>'
        +'<th class="num" style="width:100px">전처리 산출</th>'
        +'<th class="num" style="width:96px">폐기</th></tr></thead>';
      var tb3=el('tbody');
      d.src.sort(function(a,b){ return (a.preprocess_run.work_date<b.preprocess_run.work_date)?-1:1; })
        .forEach(function(x){
          var r=x.preprocess_run||{}, tr=el('tr');
          tr.appendChild(el('td','code',r.work_date));
          tr.appendChild(el('td','nm',r.cage_no||'—'));
          tr.appendChild(el('td','num',f(x.used_kg,2)+' kg'));
          tr.appendChild(el('td','num',f(r.output_kg,2)+' kg'));
          tr.appendChild(el('td','num',r.waste_kg?f(r.waste_kg,2)+' kg':'—'));
          tb3.appendChild(tr);
        });
      t3.appendChild(tb3); k.appendChild(t3);
      k.appendChild(el('div','erp','전처리 이후 공정은 와곤 단위로 섞이므로 박스 하나를 끝까지 따라가지 않습니다. 그날 공정 실적은 일별실적에서 확인하십시오.'));
    } else if(d.links.length){
      k.appendChild(el('div','tb','아직 전처리에 투입되지 않았습니다.'));
    } else {
      k.appendChild(el('div','tb','아직 대차에 실리지 않았습니다.'));
    }
    return k;
  }

  /* ══════════ 비가식부 · 생산성 ══════════ */
  var IN={ym:null};
  function viewInedible(c){
    var w=el('div'); c.appendChild(w);
    if(!IN.ym) IN.ym=new Date().toISOString().slice(0,7);
    drawInedible(w);
  }
  function drawInedible(w){
    w.innerHTML='';
    w.appendChild(monthBar(function(){return IN.ym;},function(v){IN.ym=v;},function(){drawInedible(w);}));
    var body=el('div'); body.appendChild(el('div','empty','불러오는 중…')); w.appendChild(body);
    var r=monthRange(IN.ym);
    var wf='work_date=gte.'+r[0]+'&work_date=lte.'+r[1];
    Promise.all([
      q('preprocess_run?select=work_date,part_id,input_kg,output_kg,waste_kg,workers,start_time,end_time&'+wf),
      q('shredding_run?select=work_date,part_id,input_kg,output_kg,waste_kg,workers,start_time,end_time&'+wf),
      q('cooking_run?select=work_date,part_id,output_kg,workers,start_time,end_time&'+wf)
    ]).then(function(a){
      body.innerHTML='';
      body.appendChild(inedibleCard(a[0],a[1]));
      body.appendChild(prodCard(a[0],a[2],a[1]));
    }).catch(function(e){ fail(body,e); });
  }
  function manh(list){
    var h=0;
    list.forEach(function(r){
      var a=mins(r.start_time), b=mins(r.end_time);
      if(a!=null&&b!=null&&b>a) h+=(b-a)/60*(parseInt(r.workers,10)||0);
    });
    return h;
  }
  function sum(a,k){var s=0;a.forEach(function(x){s+=parseFloat(x[k])||0;});return s;}

  function inedibleCard(pp,sh){
    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null,'비가식부'));
    k.appendChild(el('p','sub-t','전처리와 파쇄에서 버려지는 양입니다. 투입 대비 비율로 봅니다.'));
    var g=el('div','stat-grid');
    var pi=sum(pp,'input_kg'), pw=sum(pp,'waste_kg');
    var si=sum(sh,'input_kg'), sw=sum(sh,'waste_kg');
    [['전처리 폐기',f(pw,1)+' kg'],['전처리 비율',pi?pt(pw/pi*100,2):'—'],
     ['파쇄 폐기',f(sw,1)+' kg'],['파쇄 비율',si?pt(sw/si*100,2):'—'],
     ['합계 폐기',f(pw+sw,1)+' kg']
    ].forEach(function(x){
      var s2=el('div','stat'); s2.appendChild(el('div','k',x[0])); s2.appendChild(el('div','v',x[1])); g.appendChild(s2);
    });
    k.appendChild(g);

    /* 부위별 */
    var m={};
    function add(list,key){
      list.forEach(function(r){
        var p=PARTN[r.part_id]||'(미정)';
        var x=m[p]=m[p]||{key:p,pi:0,pw:0,si:0,sw:0};
        if(key==='pp'){ x.pi+=+r.input_kg||0; x.pw+=+r.waste_kg||0; }
        else { x.si+=+r.input_kg||0; x.sw+=+r.waste_kg||0; }
      });
    }
    add(pp,'pp'); add(sh,'sh');
    var names=Object.keys(m).sort(function(a,b){return (m[b].pw+m[b].sw)-(m[a].pw+m[a].sw);});
    if(names.length){
      var t=el('table','tbl'); t.style.marginTop='12px';
      t.innerHTML='<thead><tr><th>부위</th><th class="num" style="width:110px">전처리 투입</th>'
        +'<th class="num" style="width:100px">폐기</th><th class="num" style="width:80px">비율</th>'
        +'<th class="num" style="width:110px">파쇄 투입</th><th class="num" style="width:100px">폐기</th>'
        +'<th class="num" style="width:80px">비율</th></tr></thead>';
      var tb=el('tbody');
      names.forEach(function(n){
        var x=m[n], tr=el('tr');
        var c=el('td'); c.appendChild(el('span','badge g-'+x.key,x.key)); tr.appendChild(c);
        tr.appendChild(el('td','num',f(x.pi,1)));
        tr.appendChild(el('td','num',f(x.pw,1)));
        tr.appendChild(el('td','num',x.pi?pt(x.pw/x.pi*100,2):'—'));
        tr.appendChild(el('td','num',f(x.si,1)));
        tr.appendChild(el('td','num',f(x.sw,1)));
        tr.appendChild(el('td','num',x.si?pt(x.sw/x.si*100,2):'—'));
        tb.appendChild(tr);
      });
      t.appendChild(tb); k.appendChild(t);
    }
    return k;
  }

  function prodCard(pp,ck,sh){
    var k=el('div','card');
    k.appendChild(el('h2',null,'생산성'));
    k.appendChild(el('p','sub-t','인시 = Σ(작업시간 × 인원). 생산성은 산출 kg ÷ 인시입니다.'));
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th>공정</th><th class="num" style="width:100px">산출 kg</th>'
      +'<th class="num" style="width:90px">인시</th><th class="num" style="width:120px">생산성</th>'
      +'<th class="num" style="width:80px">건수</th></tr></thead>';
    var tb=el('tbody');
    [['전처리',pp],['자숙',ck],['파쇄',sh]].forEach(function(x){
      var kg=sum(x[1],'output_kg'), mh=manh(x[1]);
      var tr=el('tr');
      tr.appendChild(el('td','nm',x[0]));
      tr.appendChild(el('td','num',f(kg,1)));
      tr.appendChild(el('td','num',f(mh,1)));
      tr.appendChild(el('td','num',mh?f(kg/mh,1)+' kg/인시':'—'));
      tr.appendChild(el('td','num',x[1].length+'건'));
      tb.appendChild(tr);
    });
    var tkg=sum(pp,'output_kg')+sum(ck,'output_kg')+sum(sh,'output_kg');
    var tmh=manh(pp)+manh(ck)+manh(sh);
    var tr2=el('tr','sum');
    tr2.appendChild(el('td','nm','합계'));
    tr2.appendChild(el('td','num',f(tkg,1)));
    tr2.appendChild(el('td','num',f(tmh,1)));
    tr2.appendChild(el('td','num',tmh?f(tkg/tmh,1)+' kg/인시':'—'));
    tr2.appendChild(el('td','num',(pp.length+ck.length+sh.length)+'건'));
    tb.appendChild(tr2);
    t.appendChild(tb); k.appendChild(t);
    return k;
  }

  /* ══════════ 출퇴근 ══════════ */
  var AT={ym:null};
  function viewAttendance(c){
    var w=el('div'); c.appendChild(w);
    if(!AT.ym) AT.ym=new Date().toISOString().slice(0,7);
    drawAtt(w);
  }
  function drawAtt(w){
    w.innerHTML='';
    w.appendChild(monthBar(function(){return AT.ym;},function(v){AT.ym=v;},function(){drawAtt(w);}));
    var body=el('div'); body.appendChild(el('div','empty','불러오는 중…')); w.appendChild(body);
    var r=monthRange(AT.ym);
    Promise.all([
      q('attendance?select=work_date,time_in,time_out,worker_id,worker!inner(name,role)'
        +'&work_date=gte.'+r[0]+'&work_date=lte.'+r[1]+'&order=work_date'),
      q('worker?select=worker_id,name,role,active&order=name')
    ]).then(function(a){
      body.innerHTML='';
      body.appendChild(attCard(a[0],a[1],r));
    }).catch(function(e){ fail(body,e); });
  }
  function attCard(rows,workers,rng){
    var k=el('div','card');
    var days={}, byW={};
    rows.forEach(function(r){
      days[r.work_date]=1;
      var w=byW[r.worker_id]=byW[r.worker_id]||{name:(r.worker||{}).name||'?',days:0,mins:0,late:0};
      w.days++;
      var a=mins(r.time_in), b=mins(r.time_out);
      if(a!=null&&b!=null&&b>a) w.mins+=(b-a);
      if(a!=null&&a>8*60+30) w.late++;
    });
    var dcount=Object.keys(days).length;
    k.appendChild(el('h2',null,'출퇴근'));
    k.appendChild(el('p','sub-t',AT.ym.replace('-','년 ')+'월 · 근무일 '+dcount+'일 · 기록 '+rows.length+'건'));
    var g=el('div','stat-grid');
    var tot=Object.keys(byW).reduce(function(s,k2){return s+byW[k2].mins;},0);
    [['근무일',dcount+'일'],['출근 인원',Object.keys(byW).length+'명'],
     ['총 근무시간',f(tot/60,1)+' h'],
     ['1인 평균',Object.keys(byW).length?f(tot/60/Object.keys(byW).length,1)+' h':'—'],
     ['등록 직원',workers.length+'명']
    ].forEach(function(x){
      var s2=el('div','stat'); s2.appendChild(el('div','k',x[0])); s2.appendChild(el('div','v',x[1])); g.appendChild(s2);
    });
    k.appendChild(g);
    if(!rows.length){ k.appendChild(el('div','tb','이 달에는 출퇴근 기록이 없습니다.')); return k; }
    var t=el('table','tbl'); t.style.marginTop='12px';
    t.innerHTML='<thead><tr><th>직원</th><th class="num" style="width:80px">출근일</th>'
      +'<th class="num" style="width:100px">총 근무</th><th class="num" style="width:100px">일평균</th>'
      +'<th class="num" style="width:80px">지각</th></tr></thead>';
    var tb=el('tbody');
    Object.keys(byW).sort(function(a,b){return byW[b].mins-byW[a].mins;}).forEach(function(id){
      var x=byW[id], tr=el('tr');
      tr.appendChild(el('td','nm',x.name));
      tr.appendChild(el('td','num',x.days+'일'));
      tr.appendChild(el('td','num',f(x.mins/60,1)+' h'));
      tr.appendChild(el('td','num',x.days?f(x.mins/60/x.days,1)+' h':'—'));
      var c=el('td','num',x.late?x.late+'회':'—');
      if(x.late) c.style.color='#B4342C';
      tr.appendChild(c);
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);
    k.appendChild(el('div','erp','지각은 08:30 이후 출근 기준으로 세었습니다. 기준이 다르면 알려 주십시오.'));
    return k;
  }

  /* ══════════ 일정표 ══════════ */
  var SC={ym:null};
  function viewSchedule(c){
    var w=el('div'); c.appendChild(w);
    if(!SC.ym) SC.ym=new Date().toISOString().slice(0,7);
    drawSched(w);
  }
  function drawSched(w){
    w.innerHTML='';
    w.appendChild(monthBar(function(){return SC.ym;},function(v){SC.ym=v;},function(){drawSched(w);}));
    var body=el('div'); body.appendChild(el('div','empty','불러오는 중…')); w.appendChild(body);
    var r=monthRange(SC.ym);
    Promise.all([
      q('production_plan?select=*&plan_date=gte.'+r[0]+'&plan_date=lte.'+r[1]+'&order=plan_date'),
      q('packing_part?select=ea,item_id,packing_run!inner(work_date)'
        +'&packing_run.work_date=gte.'+r[0]+'&packing_run.work_date=lte.'+r[1]),
      q('item_master?select=item_id,product_group&category=eq.완제품')
    ]).then(function(a){
      body.innerHTML='';
      body.appendChild(schedCard(a[0],a[1],a[2]));
    }).catch(function(e){ fail(body,e); });
  }
  function schedCard(plans, acts, items){
    var im={}; items.forEach(function(i){ im[i.item_id]=i.product_group; });
    var actual={};
    acts.forEach(function(a){
      var d=a.packing_run.work_date, g=im[a.item_id]||'(미정)';
      var key=d+'|'+g;
      actual[key]=(actual[key]||0)+(parseInt(a.ea,10)||0);
    });
    /* 같은 날·같은 제품에 계획이 여러 건이면 계획을 합쳐 한 줄로 본다.
       실적은 제품 단위 총량이므로 나눠 붙이면 중복이 된다. */
    var merged={};
    plans.forEach(function(p){
      var key=p.plan_date+'|'+p.product_group;
      var x=merged[key]=merged[key]||{date:p.plan_date, product_group:p.product_group,
        plan_ea:0, parts:[], n:0};
      x.plan_ea+=p.plan_ea||0; x.n++;
      if(p.part_id) x.parts.push(PARTN[p.part_id]);
    });
    Object.keys(actual).forEach(function(key){
      if(merged[key]) return;
      var p2=key.split('|');
      merged[key]={date:p2[0], product_group:p2[1], plan_ea:null, parts:[], n:0, _actOnly:true};
    });
    var byDate={};
    Object.keys(merged).forEach(function(key){
      var x=merged[key];
      (byDate[x.date]=byDate[x.date]||[]).push(x);
    });

    var k=el('div','card');
    k.appendChild(el('h2',null,'월간 생산 일정'));
    k.appendChild(el('p','sub-t','계획과 실제 생산을 나란히 봅니다. 계획은 계획 화면에서 넣습니다.'));

    var last=lastDay(SC.ym);
    var first=new Date(+SC.ym.slice(0,4),+SC.ym.slice(5,7)-1,1).getDay();
    var t=el('table','cal');
    var th=el('thead'), tr=el('tr');
    ['일','월','화','수','목','금','토'].forEach(function(d,i){
      var c=el('th',null,d+'요일');
      if(i===0) c.className='sun'; if(i===6) c.className='sat';
      tr.appendChild(c);
    });
    th.appendChild(tr); t.appendChild(th);
    var tb=el('tbody'), row=el('tr'), col=0;
    for(var i=0;i<first;i++){ row.appendChild(el('td','off')); col++; }
    for(var d2=1;d2<=last;d2++){
      if(col===7){ tb.appendChild(row); row=el('tr'); col=0; }
      var date=SC.ym+'-'+String(d2).padStart(2,'0');
      var td=el('td','day');
      var head=el('div','day-n',String(d2));
      if(col===0) head.className+=' sun'; if(col===6) head.className+=' sat';
      td.appendChild(head);
      (byDate[date]||[]).forEach(function(p){
        var act=actual[date+'|'+p.product_group]||0;
        var b=el('div','plan'+(p._actOnly?' actonly':''));
        b.appendChild(el('div','plan-p',p.product_group));
        if(p.plan_ea){
          var pl=el('div','plan-ea','계획 '+f(p.plan_ea)+'ea');
          if(p.n>1) pl.appendChild(el('span','erp',' ('+p.n+'건'+(p.parts.length?' '+p.parts.join('·'):'')+')'));
          b.appendChild(pl);
        }
        if(act){
          var a2=el('div','plan-act','실적 '+f(act)+'ea');
          if(p.plan_ea){
            var rate=act/p.plan_ea*100;
            a2.appendChild(el('span','plan-rate'+(rate>=95?' ok':(rate<80?' bad':'')),' '+rate.toFixed(0)+'%'));
          }
          b.appendChild(a2);
        }
        td.appendChild(b);
      });
      row.appendChild(td); col++;
    }
    while(col<7){ row.appendChild(el('td','off')); col++; }
    tb.appendChild(row); t.appendChild(tb);
    k.appendChild(t);

    /* 합계: 계획이 있는 날·제품만 달성률 대상 */
    var pe=0, ae=0, cnt=0;
    Object.keys(merged).forEach(function(key){
      var x=merged[key];
      if(x.plan_ea){ pe+=x.plan_ea; ae+=actual[key]||0; cnt+=x.n; }
    });
    var allAct=Object.keys(actual).reduce(function(s2,x){return s2+actual[x];},0);
    var g=el('div','stat-grid');
    [['계획 EA',f(pe)+' EA'],['계획분 실적',f(ae)+' EA'],
     ['달성률',pe?pt(ae/pe*100):'—'],
     ['전체 생산',f(allAct)+' EA'],['계획 건수',cnt+'건']
    ].forEach(function(x){
      var s2=el('div','stat'); s2.appendChild(el('div','k',x[0])); s2.appendChild(el('div','v',x[1])); g.appendChild(s2);
    });
    k.appendChild(g);
    if(pe && allAct>ae)
      k.appendChild(el('div','erp','달성률은 계획이 입력된 날·제품만 대상으로 합니다. 계획 없이 생산한 분량은 전체 생산에만 잡힙니다.'));
    return k;
  }

  window.SSBON.views = window.SSBON.views || {};
  function reg(name,fn){
    window.SSBON.views[name]=function(c){ cfg=window.SSBON.config; fn(c); };
  }
  reg('trace', viewTrace);
  reg('inedible', viewInedible);
  reg('attendance', viewAttendance);
  reg('sched', viewSchedule);
})();
