/* 일별실적.
   숫자의 정의는 기존 웹의 규칙을 따른다.
   - 원육 투입 = 그날 완료(finish_date)된 방혈 대차의 total_kg 합
   - 공정수율 = 직전 단계 대비
   - 원육수율 = 원육 대비 누적 (단계별 수율의 곱이 아니다)
   - 불량률 = 불량 / (생산 + 불량)
   - 외포장이 끝나지 않은 제품은 색칠해서 표시 */
(function(){
  window.SSBON = window.SSBON || {};
  var api = null, cfg = null;

  function el(t,c,x){ var n=document.createElement(t); if(c)n.className=c; if(x!=null)n.textContent=x; return n; }
  function fmt(n,d){
    if(n==null||isNaN(n)) return '—';
    return Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d||0,maximumFractionDigits:d||0});
  }
  function pct(a,b){
    if(!b) return null;
    return a/b*100;
  }
  function pctTxt(v){ return v==null?'—':v.toFixed(1)+'%'; }

  var PARTN={1:'홍두깨',2:'설도',3:'우둔'};
  var state={ date:null, data:null, items:null };

  function q(path){
    return fetch(cfg.restUrl+'/'+path,{headers:{
      apikey:cfg.anonKey, Authorization:'Bearer '+cfg.anonKey
    }}).then(function(r){
      if(!r.ok) return r.text().then(function(t){ throw new Error(path.split('?')[0]+' '+r.status+' '+t); });
      return r.json();
    });
  }

  function load(d){
    var P=[
      q('thaw_cart?select=total_kg,part_id&finish_date=eq.'+d),
      q('preprocess_run?select=input_kg,output_kg,waste_kg,part_id&work_date=eq.'+d),
      q('cooking_run?select=input_kg,output_kg,part_id&work_date=eq.'+d),
      q('shredding_run?select=input_kg,washed_kg,output_kg,waste_kg,part_id&work_date=eq.'+d),
      q('packing_run?select=pk_id,ea,defect,sauce_kg&work_date=eq.'+d),
      q('packing_part?select=ea,input_kg,part_id,item_id,packing_run!inner(work_date)&packing_run.work_date=eq.'+d),
      q('retort_part?select=ea,part_id,item_id,retort_run!inner(work_date)&retort_run.work_date=eq.'+d),
      q('outerpacking_part?select=ea,part_id,item_id,outerpacking_run!inner(work_date)&outerpacking_run.work_date=eq.'+d)
    ];
    if(!state.items) P.push(q('item_master?select=item_id,erp_code,product_group,name,part&category=eq.완제품'));
    return Promise.all(P).then(function(r){
      if(r[8]){ state.items={}; r[8].forEach(function(i){ state.items[i.item_id]=i; }); }
      return { thaw:r[0], pp:r[1], ck:r[2], sh:r[3], pk:r[4], pkp:r[5], rt:r[6], op:r[7] };
    });
  }

  function sum(a,k){ var s=0; a.forEach(function(x){ s+=parseFloat(x[k])||0; }); return s; }

  /* ── 화면 ─────────────────────────────── */
  function view(c){
    var wrap=el('div'); c.appendChild(wrap);
    if(state.date){ draw(wrap); return; }
    wrap.appendChild(el('div','empty','최근 작업일을 찾는 중…'));
    q('packing_run?select=work_date&order=work_date.desc&limit=1').then(function(r){
      state.date = (r[0] && r[0].work_date) || new Date().toISOString().slice(0,10);
      wrap.innerHTML=''; draw(wrap);
    }).catch(function(e){
      wrap.innerHTML=''; err(wrap,e);
    });
  }
  function err(w,e){
    var k=el('div','card');
    k.appendChild(el('h2',null,'불러오지 못했습니다.'));
    k.appendChild(el('p','sub-t',String(e.message||e)));
    w.appendChild(k);
  }

  function draw(w){
    w.innerHTML='';
    w.appendChild(bar(w));
    var body=el('div');
    body.appendChild(el('div','empty','불러오는 중…'));
    w.appendChild(body);
    load(state.date).then(function(d){
      state.data=d; body.innerHTML='';
      body.appendChild(summary(d));
      body.appendChild(products(d));
      body.appendChild(steps(d));
    }).catch(function(e){ body.innerHTML=''; err(body,e); });
  }

  function shift(days){
    var t=new Date(state.date+'T00:00:00');
    t.setDate(t.getDate()+days);
    state.date=t.toISOString().slice(0,10);
  }

  function bar(w){
    var b=el('div','chips');
    var prev=el('button','fchip','‹ 전날');
    prev.addEventListener('click',function(){ shift(-1); draw(w); });
    var inp=el('input','search'); inp.type='date'; inp.value=state.date;
    inp.addEventListener('change',function(){ if(inp.value){ state.date=inp.value; draw(w); } });
    var next=el('button','fchip','다음날 ›');
    next.addEventListener('click',function(){ shift(1); draw(w); });
    b.appendChild(prev); b.appendChild(inp); b.appendChild(next);
    var dow=['일','월','화','수','목','금','토'][new Date(state.date+'T00:00:00').getDay()];
    b.appendChild(el('span','erp',' '+dow+'요일'));
    return b;
  }

  /* 공정 요약 */
  function summary(d){
    var meat=sum(d.thaw,'total_kg');
    var pp=sum(d.pp,'output_kg'), ppw=sum(d.pp,'waste_kg');
    var ck=sum(d.ck,'output_kg');
    var sh=sum(d.sh,'output_kg'), shw=sum(d.sh,'waste_kg');
    var pkEa=sum(d.pk,'ea'), df=sum(d.pk,'defect');

    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null,'공정 요약'));
    k.appendChild(el('p','sub-t','원육 투입은 그날 완료된 방혈 대차 기준입니다. 공정수율은 직전 단계 대비입니다.'));

    var rows=[
      ['원육 (방혈 완료)', meat, null, null],
      ['전처리',           pp,   pct(pp,meat), pct(pp,meat)],
      ['자숙',             ck,   pct(ck,pp),   pct(ck,meat)],
      ['파쇄',             sh,   pct(sh,ck),   pct(sh,meat)]
    ];
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th>공정</th><th class="num" style="width:110px">산출</th>'+
      '<th class="num" style="width:100px">공정수율</th><th class="num" style="width:100px">원육수율</th></tr></thead>';
    var tb=el('tbody');
    rows.forEach(function(r){
      var tr=el('tr');
      tr.appendChild(el('td','nm',r[0]));
      tr.appendChild(el('td','num',r[1]?fmt(r[1],1)+' kg':'—'));
      tr.appendChild(el('td','num',pctTxt(r[2])));
      tr.appendChild(el('td','num',pctTxt(r[3])));
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);

    var g=el('div','stat-grid'); g.style.marginTop='12px';
    [['내포장 생산',fmt(pkEa)+' EA'],
     ['불량률', pkEa+df ? (df/(pkEa+df)*100).toFixed(2)+'%' : '—'],
     ['전처리 폐기', ppw?fmt(ppw,1)+' kg':'—'],
     ['파쇄 폐기', shw?fmt(shw,1)+' kg':'—'],
     ['소스 투입', sum(d.pk,'sauce_kg')?fmt(sum(d.pk,'sauce_kg'),1)+' kg':'—']
    ].forEach(function(x){
      var s=el('div','stat');
      s.appendChild(el('div','k',x[0]));
      s.appendChild(el('div','v',x[1]));
      g.appendChild(s);
    });
    k.appendChild(g);
    return k;
  }

  /* 제품별 실적 */
  function products(d){
    var map={};
    function put(list,key){
      list.forEach(function(r){
        var id=r.item_id, pid=r.part_id;
        var k=id+'|'+pid;
        if(!map[k]) map[k]={item_id:id, part_id:pid, pk:0, rt:0, op:0};
        map[k][key]+=parseInt(r.ea,10)||0;
      });
    }
    put(d.pkp,'pk'); put(d.rt,'rt'); put(d.op,'op');
    var list=Object.keys(map).map(function(k){ return map[k]; });
    list.sort(function(a,b){ return b.pk-a.pk; });

    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null,'제품별 실적'));
    k.appendChild(el('p','sub-t','외포장이 남은 제품은 색으로 표시됩니다.'));
    if(!list.length){ k.appendChild(el('div','tb','이 날짜에는 생산 기록이 없습니다.')); return k; }

    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th style="width:80px">코드</th><th>제품</th>'+
      '<th class="num" style="width:92px">내포장</th><th class="num" style="width:92px">레토르트</th>'+
      '<th class="num" style="width:92px">외포장</th><th class="num" style="width:88px">남은 수량</th></tr></thead>';
    var tb=el('tbody');
    list.forEach(function(r){
      var it=state.items[r.item_id]||{};
      var left=r.pk-r.op;
      var tr=el('tr');
      if(left>0) tr.style.background='#EAF4FA';
      tr.appendChild(el('td','code',it.erp_code||'—'));
      var c2=el('td'); var line=el('div');
      line.appendChild(el('span','nm',it.product_group||it.name||'(제품 미정)'));
      if(r.part_id) line.appendChild(el('span','badge g-'+PARTN[r.part_id],PARTN[r.part_id]));
      c2.appendChild(line);
      tr.appendChild(c2);
      tr.appendChild(el('td','num',r.pk?fmt(r.pk):'—'));
      tr.appendChild(el('td','num',r.rt?fmt(r.rt):'—'));
      tr.appendChild(el('td','num',r.op?fmt(r.op):'—'));
      var c6=el('td','num', left>0?fmt(left):'완료');
      if(left>0) c6.style.color='#0B5570'; else c6.style.color='#1F8A4C';
      tr.appendChild(c6);
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);
    return k;
  }

  /* 공정별 건수 */
  function steps(d){
    var k=el('div','card');
    k.appendChild(el('h2',null,'공정별 기록'));
    var g=el('div','stat-grid');
    [['방혈 완료',d.thaw.length+' 대차'],
     ['전처리',d.pp.length+' 건'],
     ['자숙',d.ck.length+' 건'],
     ['파쇄',d.sh.length+' 건'],
     ['내포장',d.pk.length+' 건']
    ].forEach(function(x){
      var s=el('div','stat');
      s.appendChild(el('div','k',x[0]));
      s.appendChild(el('div','v',x[1]));
      g.appendChild(s);
    });
    k.appendChild(g);
    return k;
  }

  window.SSBON.views = window.SSBON.views || {};
  window.SSBON.views.daily_perf = function(c){
    api=window.SSBON.api; cfg=window.SSBON.config;
    view(c);
  };
})();
