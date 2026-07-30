/* 일별실적 — 기존 웹 화면 구성을 기준으로 한다.
   원육 기준 = 전처리 투입 KG (기존 화면 숫자로 역산해 확인)
   공정수율 = 직전 단계 산출 대비 / 원육수율 = 전처리 투입 대비
   인시 = Σ(기록별 작업시간 × 인원), 생산성 = 산출kg / 인시 */
(function(){
  window.SSBON = window.SSBON || {};
  var cfg=null;
  var PARTN={1:'홍두깨',2:'설도',3:'우둔'};
  var st={date:null, items:null};

  function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n;}
  function f(n,d){return (n==null||isNaN(n))?'—':Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d||0,maximumFractionDigits:d||0});}
  function pc(a,b){return b?a/b*100:null;}
  function pt(v,d){return v==null?'—':v.toFixed(d==null?1:d)+'%';}
  function q(path){
    return fetch(cfg.restUrl+'/'+path,{headers:{apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey}})
      .then(function(r){ if(!r.ok) return r.text().then(function(t){throw new Error(path.split('?')[0]+' '+r.status+' '+t);}); return r.json(); });
  }
  function sum(a,k){var s=0;a.forEach(function(x){s+=parseFloat(x[k])||0;});return s;}
  function mins(s){ if(!s) return null; var t=String(s).replace('T',' ').slice(11,16).split(':'); return t.length<2?null:(+t[0])*60+(+t[1]); }
  function hm(m){ if(m==null) return '—'; return Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m'; }

  /* 기록 묶음의 시간 범위와 인시 */
  function span(list){
    var a=null,b=null,manh=0;
    list.forEach(function(r){
      var s=mins(r.start_time), e=mins(r.end_time);
      if(s!=null&&(a==null||s<a)) a=s;
      if(e!=null&&(b==null||e>b)) b=e;
      if(s!=null&&e!=null&&e>s) manh += (e-s)/60*(parseInt(r.workers,10)||0);
    });
    return {from:a,to:b,dur:(a!=null&&b!=null&&b>a)?b-a:null,manh:manh};
  }
  function parts(list){
    var s={};
    list.forEach(function(r){ if(r.part_id) s[PARTN[r.part_id]]=1; });
    var k=Object.keys(s);
    return k.length?k.join(', '):'—';
  }

  function load(d){
    var P=[
      q('thaw_cart?select=total_kg,box_count,part_id&finish_date=eq.'+d),
      q('preprocess_run?select=input_kg,output_kg,waste_kg,workers,start_time,end_time,part_id&work_date=eq.'+d),
      q('cooking_run?select=input_kg,output_kg,workers,start_time,end_time,part_id&work_date=eq.'+d),
      q('shredding_run?select=input_kg,washed_kg,output_kg,waste_kg,workers,start_time,end_time,part_id&work_date=eq.'+d),
      q('packing_run?select=pk_id,ea,defect,pouch,sauce_kg,workers,start_time,end_time&work_date=eq.'+d),
      q('packing_part?select=ea,part_id,item_id,packing_run!inner(work_date)&packing_run.work_date=eq.'+d),
      q('retort_part?select=ea,part_id,item_id,retort_run!inner(work_date)&retort_run.work_date=eq.'+d),
      q('outerpacking_part?select=ea,part_id,item_id,outerpacking_run!inner(work_date)&outerpacking_run.work_date=eq.'+d)
    ];
    if(!st.items) P.push(q('item_master?select=item_id,erp_code,product_group,name,part&category=eq.완제품'));
    return Promise.all(P).then(function(r){
      if(r[8]){ st.items={}; r[8].forEach(function(i){st.items[i.item_id]=i;}); }
      return {th:r[0],pp:r[1],ck:r[2],sh:r[3],pk:r[4],pkp:r[5],rt:r[6],op:r[7]};
    });
  }

  /* ── KPI ── */
  function kpi(d,base){
    var ea=sum(d.pk,'ea'), df=sum(d.pk,'defect');
    var shOut=sum(d.sh,'output_kg');
    var manh=span(d.pp).manh+span(d.ck).manh+span(d.sh).manh+span(d.pk).manh;
    var g=el('div','kpi');
    [['총 생산','',f(ea),'EA','k-blue'],
     ['원육수율','',pt(pc(shOut,base)),'','k-green'],
     ['인시당 EA','',manh?f(ea/manh,0):'—','EA/인시','k-amber'],
     ['포장불량','',(ea+df)?pt(df/(ea+df)*100,2):'—','','k-red']
    ].forEach(function(x){
      var c=el('div','kpi-c '+x[4]);
      c.appendChild(el('div','kpi-k',x[0]));
      c.appendChild(el('div','kpi-v',x[2]));
      c.appendChild(el('div','kpi-u',x[3]));
      g.appendChild(c);
    });
    return g;
  }

  /* ── 공정별 현황 ── */
  function procTable(d,base){
    var boxes=sum(d.th,'box_count');
    var rows=[
      {n:'전처리', L:d.pp, in:sum(d.pp,'input_kg')||base, out:sum(d.pp,'output_kg'), w:sum(d.pp,'waste_kg'), prev:base, note:boxes?f(boxes)+'박스':''},
      {n:'자숙',   L:d.ck, in:sum(d.ck,'input_kg'), out:sum(d.ck,'output_kg'), w:0, prev:sum(d.pp,'output_kg')},
      {n:'파쇄',   L:d.sh, in:sum(d.sh,'input_kg'), out:sum(d.sh,'output_kg'), w:sum(d.sh,'waste_kg'), prev:sum(d.ck,'output_kg')}
    ];
    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null,'공정별 현황'));
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th style="width:72px">공정</th><th style="width:74px">부위</th>'+
      '<th class="num" style="width:104px">투입 KG</th><th class="num" style="width:96px">산출 KG</th>'+
      '<th class="num" style="width:104px">비가식부</th><th class="num" style="width:82px">원육수율</th>'+
      '<th class="num" style="width:82px">공정수율</th><th class="num" style="width:82px">작업시간</th>'+
      '<th class="num" style="width:58px">인원</th><th class="num" style="width:104px">생산성</th></tr></thead>';
    var tb=el('tbody');
    rows.forEach(function(r){
      var sp=span(r.L);
      var wk=0; r.L.forEach(function(x){ wk=Math.max(wk,parseInt(x.workers,10)||0); });
      var tr=el('tr');
      tr.appendChild(el('td','nm',r.n));
      tr.appendChild(el('td','cat',parts(r.L)));
      var c3=el('td','num');
      c3.appendChild(el('div',null,r.in?f(r.in,2):'—'));
      if(r.note) c3.appendChild(el('div','erp',r.note));
      tr.appendChild(c3);
      tr.appendChild(el('td','num',r.out?f(r.out,2):'—'));
      var c5=el('td','num');
      if(r.w){ c5.style.color='#B4342C';
        c5.appendChild(el('div',null,f(r.w,2)+'kg'));
        c5.appendChild(el('div','erp','('+pt(pc(r.w,r.in),1)+')'));
      } else c5.textContent='—';
      tr.appendChild(c5);
      tr.appendChild(el('td','num',pt(pc(r.out,base))));
      tr.appendChild(el('td','num',pt(pc(r.out,r.prev))));
      tr.appendChild(el('td','num',sp.dur!=null?(sp.dur/60).toFixed(1)+'h':'—'));
      tr.appendChild(el('td','num',wk?wk+'명':'—'));
      tr.appendChild(el('td','num',sp.manh?f(r.out/sp.manh,1)+' kg/인시':'—'));
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);
    return k;
  }

  /* ── 포장 실적 ── */
  function packTable(d){
    var m={};
    function put(list,key){
      list.forEach(function(r){
        var k=r.item_id+'|'+r.part_id;
        if(!m[k]) m[k]={item_id:r.item_id,part_id:r.part_id,pk:0,rt:0,op:0};
        m[k][key]+=parseInt(r.ea,10)||0;
      });
    }
    put(d.pkp,'pk'); put(d.rt,'rt'); put(d.op,'op');
    var list=Object.keys(m).map(function(k){return m[k];}).sort(function(a,b){return b.pk-a.pk;});
    var ea=sum(d.pk,'ea'), df=sum(d.pk,'defect'), po=sum(d.pk,'pouch');

    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null,'포장 실적'));
    k.appendChild(el('p','sub-t','외포장이 남은 제품은 색으로 표시됩니다.'));
    if(!list.length){ k.appendChild(el('div','tb','이 날짜에는 포장 기록이 없습니다.')); return k; }
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th style="width:76px">코드</th><th>제품</th>'+
      '<th class="num" style="width:88px">생산 EA</th><th class="num" style="width:88px">레토르트</th>'+
      '<th class="num" style="width:88px">외포장</th><th class="num" style="width:84px">남은 수량</th></tr></thead>';
    var tb=el('tbody');
    list.forEach(function(r){
      var it=st.items[r.item_id]||{};
      var left=r.pk-r.op, tr=el('tr');
      if(left>0) tr.classList.add('wip');
      tr.appendChild(el('td','code',it.erp_code||'—'));
      var c2=el('td'), ln=el('div');
      ln.appendChild(el('span','nm',it.product_group||it.name||'(제품 미정)'));
      if(r.part_id) ln.appendChild(el('span','badge g-'+PARTN[r.part_id],PARTN[r.part_id]));
      c2.appendChild(ln); tr.appendChild(c2);
      tr.appendChild(el('td','num',r.pk?f(r.pk):'—'));
      tr.appendChild(el('td','num',r.rt?f(r.rt):'—'));
      tr.appendChild(el('td','num',r.op?f(r.op):'—'));
      var c6=el('td','num',left>0?f(left):'완료');
      c6.style.color=left>0?'#0B5570':'#1F8A4C'; c6.style.fontWeight='600';
      tr.appendChild(c6);
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);
    var g=el('div','stat-grid');
    [['생산 EA',f(ea)+' EA'],['파우치',po?f(po)+' EA':'—'],
     ['불량 EA',df?f(df)+' EA':'—'],['불량률',(ea+df)?pt(df/(ea+df)*100,2):'—'],
     ['소스 투입',sum(d.pk,'sauce_kg')?f(sum(d.pk,'sauce_kg'),1)+' kg':'—']
    ].forEach(function(x){
      var s=el('div','stat'); s.appendChild(el('div','k',x[0])); s.appendChild(el('div','v',x[1])); g.appendChild(s);
    });
    k.appendChild(g);
    return k;
  }

  /* ── 타임라인 ── */
  function timeline(d){
    var rows=[['전처리',d.pp,'t-blue'],['자숙',d.ck,'t-green'],['파쇄',d.sh,'t-amber'],['내포장',d.pk,'t-purple']];
    var lo=null,hi=null;
    rows.forEach(function(r){ var s=span(r[1]); if(s.from!=null&&(lo==null||s.from<lo))lo=s.from; if(s.to!=null&&(hi==null||s.to>hi))hi=s.to; });
    var k=el('div','card');
    k.appendChild(el('h2',null,'공정 타임라인'));
    if(lo==null){ k.appendChild(el('div','tb','시간 정보가 없습니다.')); return k; }
    lo=Math.floor(lo/60)*60; hi=Math.ceil(hi/60)*60;
    var total=hi-lo||60;
    var ax=el('div','tl-axis');
    for(var t=lo;t<=hi;t+=60){
      var m=el('span','tl-tick',String(Math.floor(t/60)).padStart(2,'0')+':00');
      m.style.left=((t-lo)/total*100)+'%'; ax.appendChild(m);
    }
    k.appendChild(ax);
    rows.forEach(function(r){
      var s=span(r[1]);
      var line=el('div','tl-row');
      line.appendChild(el('div','tl-lbl',r[0]));
      var track=el('div','tl-track');
      if(s.from!=null&&s.to!=null){
        var b=el('div','tl-bar '+r[2]);
        b.style.left=((s.from-lo)/total*100)+'%';
        b.style.width=(Math.max(s.to-s.from,6)/total*100)+'%';
        track.appendChild(b);
      }
      line.appendChild(track);
      var info=el('div','tl-info', s.from!=null
        ? String(Math.floor(s.from/60)).padStart(2,'0')+':'+String(s.from%60).padStart(2,'0')+' ~ '
          +String(Math.floor(s.to/60)).padStart(2,'0')+':'+String(s.to%60).padStart(2,'0')
          +' · '+r[1].length+'건 · '+hm(s.dur)
        : '시간 없음');
      line.appendChild(info);
      k.appendChild(line);
    });
    return k;
  }

  /* ── 조립 ── */
  function shift(n){ var t=new Date(st.date+'T00:00:00'); t.setDate(t.getDate()+n); st.date=t.toISOString().slice(0,10); }
  function bar(w){
    var b=el('div','daybar');
    var p=el('button','fchip','◀');
    p.addEventListener('click',function(){shift(-1);draw(w);});
    var i=el('input','search'); i.type='date'; i.value=st.date;
    i.addEventListener('change',function(){ if(i.value){st.date=i.value;draw(w);} });
    var n=el('button','fchip','▶');
    n.addEventListener('click',function(){shift(1);draw(w);});
    var dw=['일','월','화','수','목','금','토'][new Date(st.date+'T00:00:00').getDay()];
    b.appendChild(p); b.appendChild(i); b.appendChild(n);
    b.appendChild(el('span','daydow',dw+'요일'));
    return b;
  }
  function draw(w){
    w.innerHTML=''; w.appendChild(bar(w));
    var body=el('div'); body.appendChild(el('div','empty','불러오는 중…')); w.appendChild(body);
    load(st.date).then(function(d){
      body.innerHTML='';
      var base=sum(d.pp,'input_kg')||sum(d.th,'total_kg');
      body.appendChild(kpi(d,base));
      body.appendChild(procTable(d,base));
      body.appendChild(packTable(d));
      body.appendChild(timeline(d));
    }).catch(function(e){
      body.innerHTML='';
      var k=el('div','card'); k.appendChild(el('h2',null,'불러오지 못했습니다.'));
      k.appendChild(el('p','sub-t',String(e.message||e))); body.appendChild(k);
    });
  }

  window.SSBON.views=window.SSBON.views||{};
  window.SSBON.views.daily_perf=function(c){
    cfg=window.SSBON.config;
    var w=el('div'); c.appendChild(w);
    if(st.date){ draw(w); return; }
    w.appendChild(el('div','empty','최근 작업일을 찾는 중…'));
    q('packing_run?select=work_date&order=work_date.desc&limit=1').then(function(r){
      st.date=(r[0]&&r[0].work_date)||new Date().toISOString().slice(0,10);
      draw(w);
    });
  };
})();
