/* 월단위생산량.
   기존 웹의 지표 정의를 따른다.
   - 원육사용량 = 전처리 투입 kg
   - 완제품 고기중량 = 외포장 EA × 개당 원육g
   - 전처리/자숙/파쇄 수율 = 각 공정 산출 ÷ 원육사용량 (누적 기준)
   - 최종 수율 = 완제품 고기중량 ÷ 원육사용량
   - 전월 비교는 '동기간'(같은 일차까지)과 '전체' 둘 다 본다. */
(function(){
  window.SSBON = window.SSBON || {};
  var cfg=null;
  var PARTN={1:'홍두깨',2:'설도',3:'우둔'};
  var st={ym:null, items:null, group:'일자'};

  function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n;}
  function f(n,d){return (n==null||isNaN(n))?'—':Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d||0,maximumFractionDigits:d||0});}
  function pt(v,d){return (v==null||isNaN(v))?'—':v.toFixed(d==null?1:d)+'%';}
  function q(p){
    return fetch(cfg.restUrl+'/'+p,{headers:{apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey}})
      .then(function(r){ if(!r.ok) return r.text().then(function(t){throw new Error(p.split('?')[0]+' '+r.status+' '+t);}); return r.json(); });
  }
  function lastDay(ym){ var y=+ym.slice(0,4), m=+ym.slice(5,7); return new Date(y,m,0).getDate(); }
  function prevYm(ym){
    var y=+ym.slice(0,4), m=+ym.slice(5,7)-1;
    if(m===0){ y--; m=12; }
    return y+'-'+String(m).padStart(2,'0');
  }
  function rng(ym){ return ['gte.'+ym+'-01','lte.'+ym+'-'+String(lastDay(ym)).padStart(2,'0')]; }

  function loadMonth(ym){
    var a=ym+'-01', b=ym+'-'+String(lastDay(ym)).padStart(2,'0');
    var w='work_date=gte.'+a+'&work_date=lte.'+b;
    var wo='outerpacking_run.work_date=gte.'+a+'&outerpacking_run.work_date=lte.'+b;
    var wp='packing_run.work_date=gte.'+a+'&packing_run.work_date=lte.'+b;
    return Promise.all([
      q('preprocess_run?select=work_date,input_kg,output_kg,waste_kg,workers,start_time,end_time,part_id&'+w),
      q('cooking_run?select=work_date,output_kg,workers,start_time,end_time,part_id&'+w),
      q('shredding_run?select=work_date,output_kg,waste_kg,workers,start_time,end_time,part_id&'+w),
      q('packing_run?select=work_date,ea,defect&'+w),
      q('packing_part?select=ea,part_id,item_id,packing_run!inner(work_date)&'+wp),
      q('outerpacking_part?select=ea,part_id,item_id,outerpacking_run!inner(work_date)&'+wo)
    ]).then(function(a){
      return {pp:a[0],ck:a[1],sh:a[2],pk:a[3],pkp:a[4],op:a[5]};
    });
  }
  function sum(a,k){var s=0;a.forEach(function(x){s+=parseFloat(x[k])||0;});return s;}
  function mins(s){ if(!s) return null; var t=String(s).replace('T',' ').slice(11,16).split(':'); return t.length<2?null:(+t[0])*60+(+t[1]); }
  function manh(list){
    var h=0;
    list.forEach(function(r){
      var a=mins(r.start_time), b=mins(r.end_time);
      if(a!=null&&b!=null&&b>a) h+=(b-a)/60*(parseInt(r.workers,10)||0);
    });
    return h;
  }

  /* 집계 — 일자 상한(day)까지만
     EA와 고기중량은 기존 웹 규칙(eaDisp)을 따른다.
     (날짜+제품) 단위로 묶어, 외포장이 있으면 외포장 EA, 없으면 내포장 EA를 쓴다.
     외포장이 다음 날로 넘어가도 물량이 한쪽으로 몰리지 않게 하기 위함이다. */
  function agg(d, upto){
    function keep(wd){ return !upto || (wd && +wd.slice(8,10)<=upto); }
    var pp=d.pp.filter(function(r){return keep(r.work_date);});
    var ck=d.ck.filter(function(r){return keep(r.work_date);});
    var sh=d.sh.filter(function(r){return keep(r.work_date);});
    var pk=d.pk.filter(function(r){return keep(r.work_date);});
    var pkp=d.pkp.filter(function(r){return keep(r.packing_run&&r.packing_run.work_date);});
    var op =d.op.filter(function(r){return keep(r.outerpacking_run&&r.outerpacking_run.work_date);});

    // (날짜|품목) 그룹
    var g={};
    function touch(date,item,part){
      var k=date+'|'+item;
      if(!g[k]) g[k]={date:date,item_id:item,part_id:part,inner:0,outer:0};
      return g[k];
    }
    pkp.forEach(function(r){ touch(r.packing_run.work_date, r.item_id, r.part_id).inner += parseInt(r.ea,10)||0; });
    op .forEach(function(r){ touch(r.outerpacking_run.work_date, r.item_id, r.part_id).outer += parseInt(r.ea,10)||0; });

    var disp=[], eaTot=0, meat=0;
    Object.keys(g).forEach(function(k){
      var x=g[k];
      var ea = x.outer>0 ? x.outer : x.inner;
      var it = st.items[x.item_id];
      var mk = (it&&it.unit_weight_g) ? ea*it.unit_weight_g/1000 : 0;
      disp.push({date:x.date, item_id:x.item_id, part_id:x.part_id, ea:ea, meat:mk,
                 src:(x.outer>0?'외포장':'내포장')});
      eaTot+=ea; meat+=mk;
    });

    var days={}; pp.forEach(function(r){days[r.work_date]=1;});
    return {
      rmKg:sum(pp,'input_kg'), ppKg:sum(pp,'output_kg'),
      ckKg:sum(ck,'output_kg'), shKg:sum(sh,'output_kg'),
      pkEa:sum(pk,'ea'), defect:sum(pk,'defect'),
      opEa:eaTot, meatKg:meat,
      dayCount:Object.keys(days).length,
      manh:manh(pp)+manh(ck)+manh(sh),
      _disp:disp, _pp:pp, _ck:ck, _sh:sh, _pk:pk
    };
  }

  /* ── 요약 ── */
  function summary(s){
    var g=el('div','kpi');
    [['월 누적 원육사용량',f(s.rmKg,1),'kg','k-blue'],
     ['월 누적 EA',f(s.opEa),'EA · 외포장 우선','k-green'],
     ['완제품 고기중량',f(s.meatKg,1),'kg','k-amber'],
     ['최종 수율',pt(s.rmKg?s.meatKg/s.rmKg*100:null),'','k-red']
    ].forEach(function(x){
      var c=el('div','kpi-c '+x[3]);
      c.appendChild(el('div','kpi-k',x[0]));
      c.appendChild(el('div','kpi-v',x[1]));
      c.appendChild(el('div','kpi-u',x[2]));
      g.appendChild(c);
    });
    return g;
  }

  /* ── 전월 대비 ── */
  function compare(ym,cur,prevSame,prevAll,upto){
    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null,'전월 대비 비교'));
    k.appendChild(el('p','sub-t','동기간은 전월 같은 일차('+upto+'일)까지만 잘라 비교한 값입니다.'));
    var pm=prevYm(ym);
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th>구분</th>'+
      '<th class="num" style="width:112px">'+ym.replace('-','년 ')+'월</th>'+
      '<th class="num" style="width:132px">'+pm.replace('-','년 ')+'월 동기간</th>'+
      '<th class="num" style="width:112px">'+pm.replace('-','년 ')+'월 전체</th>'+
      '<th class="num" style="width:112px">차이</th>'+
      '<th class="num" style="width:92px">증감율</th></tr></thead>';
    var tb=el('tbody');
    function row(lab, a, b, c, unit, dec, isPct){
      var tr=el('tr');
      tr.appendChild(el('td','nm',lab));
      function cell(v){ return el('td','num', v==null?'—':(isPct?pt(v,1):f(v,dec)+(unit?' '+unit:''))); }
      tr.appendChild(cell(a)); tr.appendChild(cell(b)); tr.appendChild(cell(c));
      var d=(a==null||b==null)?null:a-b;
      var dc=el('td','num', d==null?'—':(d>=0?'▲ ':'▼ ')+(isPct?Math.abs(d).toFixed(1)+'%p':f(Math.abs(d),dec)+(unit?' '+unit:'')));
      if(d!=null&&d!==0) dc.style.color=d>0?'#1F8A4C':'#B4342C';
      tr.appendChild(dc);
      var p=(b?d/b*100:null);
      var pc=el('td','num', p==null?'—':(p>=0?'▲ ':'▼ ')+Math.abs(p).toFixed(1)+'%');
      if(p!=null&&p!==0) pc.style.color=p>0?'#1F8A4C':'#B4342C';
      tr.appendChild(pc);
      tb.appendChild(tr);
    }
    function avg(s){ return s.dayCount? s.rmKg/s.dayCount : null; }
    function y(s,key){ return s.rmKg? s[key]/s.rmKg*100 : null; }
    row('일평균 원육사용량', avg(cur), avg(prevSame), avg(prevAll), 'kg', 1);
    row('생산일수', cur.dayCount, prevSame.dayCount, prevAll.dayCount, '일', 0);
    row('월 누적 원육사용량', cur.rmKg, prevSame.rmKg, prevAll.rmKg, 'kg', 1);
    row('월 누적 EA (외포장 우선)', cur.opEa, prevSame.opEa, prevAll.opEa, 'EA', 0);
    row('완제품 고기중량', cur.meatKg, prevSame.meatKg, prevAll.meatKg, 'kg', 1);
    row('전처리 수율', y(cur,'ppKg'), y(prevSame,'ppKg'), y(prevAll,'ppKg'), '', 1, true);
    row('자숙 수율', y(cur,'ckKg'), y(prevSame,'ckKg'), y(prevAll,'ckKg'), '', 1, true);
    row('파쇄 수율', y(cur,'shKg'), y(prevSame,'shKg'), y(prevAll,'shKg'), '', 1, true);
    row('최종 수율', y(cur,'meatKg'), y(prevSame,'meatKg'), y(prevAll,'meatKg'), '', 1, true);
    t.appendChild(tb); k.appendChild(t);
    return k;
  }

  /* ── 집계 표 (일자 / 제품 / 원육) ── */
  function detail(s){
    var k=el('div','card');
    var head=el('div','chips');
    ['일자','제품','원육'].forEach(function(g){
      var b=el('button','fchip'+(st.group===g?' on':''),g+'별');
      b.addEventListener('click',function(){ st.group=g; redraw(); });
      head.appendChild(b);
    });
    k.appendChild(el('h2',null,'상세 집계'));
    k.appendChild(el('p','sub-t','EA는 날짜·제품 단위로 외포장이 있으면 외포장, 없으면 내포장 수량을 씁니다.'));
    k.appendChild(head);

    var rows=[], cols;
    if(st.group==='일자'){
      var m={};
      function touch(d){ if(!m[d]) m[d]={key:d,rm:0,pp:0,ck:0,sh:0,ea:0,meat:0}; return m[d]; }
      s._pp.forEach(function(r){ var x=touch(r.work_date); x.rm+=+r.input_kg||0; x.pp+=+r.output_kg||0; });
      s._ck.forEach(function(r){ touch(r.work_date).ck+=+r.output_kg||0; });
      s._sh.forEach(function(r){ touch(r.work_date).sh+=+r.output_kg||0; });
      s._disp.forEach(function(r){
        var x=touch(r.date); x.ea+=r.ea; x.meat+=r.meat;
      });
      rows=Object.keys(m).sort().map(function(d){return m[d];});
      cols=['생산일자','원육 kg','전처리 kg','자숙 kg','파쇄 kg','외포장 EA','고기중량 kg','최종수율'];
    } else {
      var m2={};
      s._disp.forEach(function(r){
        var it=st.items[r.item_id]||{};
        var key = st.group==='제품' ? (it.product_group||'(미정)') : (PARTN[r.part_id]||'(미정)');
        if(!m2[key]) m2[key]={key:key,ea:0,meat:0};
        m2[key].ea+=r.ea; m2[key].meat+=r.meat;
      });
      rows=Object.keys(m2).sort(function(a,b){return m2[b].ea-m2[a].ea;}).map(function(x){return m2[x];});
      cols=[st.group==='제품'?'제품':'원육 부위','외포장 EA','고기중량 kg','비중'];
    }

    if(!rows.length){ k.appendChild(el('div','tb','이 달에는 기록이 없습니다.')); return k; }
    var t=el('table','tbl');
    var th='<thead><tr>';
    cols.forEach(function(c,i){ th+= i===0?'<th>'+c+'</th>':'<th class="num">'+c+'</th>'; });
    t.innerHTML=th+'</tr></thead>';
    var tb=el('tbody'), totEa=rows.reduce(function(a,r){return a+r.ea;},0);
    rows.forEach(function(r){
      var tr=el('tr');
      tr.appendChild(el('td','nm',r.key));
      if(st.group==='일자'){
        [r.rm,r.pp,r.ck,r.sh].forEach(function(v){ tr.appendChild(el('td','num',v?f(v,1):'—')); });
        tr.appendChild(el('td','num',r.ea?f(r.ea):'—'));
        tr.appendChild(el('td','num',r.meat?f(r.meat,1):'—'));
        tr.appendChild(el('td','num',r.rm?pt(r.meat/r.rm*100):'—'));
      } else {
        tr.appendChild(el('td','num',f(r.ea)));
        tr.appendChild(el('td','num',r.meat?f(r.meat,1):'—'));
        tr.appendChild(el('td','num',totEa?pt(r.ea/totEa*100):'—'));
      }
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);

    var g=el('div','stat-grid');
    [['월 합계 EA',f(s.opEa)+' EA'],
     ['생산일수',s.dayCount+'일'],
     ['일 평균 EA',s.dayCount?f(s.opEa/s.dayCount):'—'],
     ['일 평균 원육',s.dayCount?f(s.rmKg/s.dayCount,1)+' kg':'—'],
     ['인시당 EA',s.manh?f(s.opEa/s.manh,0):'—']
    ].forEach(function(x){
      var c=el('div','stat'); c.appendChild(el('div','k',x[0])); c.appendChild(el('div','v',x[1])); g.appendChild(c);
    });
    k.appendChild(g);
    return k;
  }

  /* ── 조립 ── */
  var WRAP=null;
  function shift(n){
    var y=+st.ym.slice(0,4), m=+st.ym.slice(5,7)+n;
    while(m<1){m+=12;y--;} while(m>12){m-=12;y++;}
    st.ym=y+'-'+String(m).padStart(2,'0');
  }
  function bar(){
    var b=el('div','daybar');
    var p=el('button','fchip','◀'); p.addEventListener('click',function(){shift(-1);redraw();});
    var i=el('input','search'); i.type='month'; i.value=st.ym;
    i.addEventListener('change',function(){ if(i.value){st.ym=i.value;redraw();} });
    var n=el('button','fchip','▶'); n.addEventListener('click',function(){shift(1);redraw();});
    b.appendChild(p); b.appendChild(i); b.appendChild(n);
    return b;
  }
  function redraw(){
    var w=WRAP; w.innerHTML=''; w.appendChild(bar());
    var body=el('div'); body.appendChild(el('div','empty','불러오는 중…')); w.appendChild(body);
    var pm=prevYm(st.ym);
    Promise.all([loadMonth(st.ym), loadMonth(pm)]).then(function(a){
      var cur=agg(a[0]);
      var upto=0;
      a[0].pp.forEach(function(r){ upto=Math.max(upto,+r.work_date.slice(8,10)); });
      if(!upto) upto=lastDay(st.ym);
      var prevSame=agg(a[1],upto), prevAll=agg(a[1]);
      body.innerHTML='';
      body.appendChild(summary(cur));
      body.appendChild(compare(st.ym,cur,prevSame,prevAll,upto));
      body.appendChild(detail(cur));
    }).catch(function(e){
      body.innerHTML='';
      var k=el('div','card'); k.appendChild(el('h2',null,'불러오지 못했습니다.'));
      k.appendChild(el('p','sub-t',String(e.message||e))); body.appendChild(k);
    });
  }

  window.SSBON.views=window.SSBON.views||{};
  window.SSBON.views.monthly_prod=function(c){
    cfg=window.SSBON.config;
    WRAP=el('div'); c.appendChild(WRAP);
    if(st.items && st.ym){ redraw(); return; }
    WRAP.appendChild(el('div','empty','불러오는 중…'));
    Promise.all([
      q('item_master?select=item_id,erp_code,product_group,name,part,unit_weight_g,no_meat&category=eq.완제품'),
      st.ym?Promise.resolve(null):q('outerpacking_run?select=work_date&order=work_date.desc&limit=1')
    ]).then(function(r){
      st.items={}; r[0].forEach(function(i){ st.items[i.item_id]=i; });
      if(r[1]) st.ym=(r[1][0]&&r[1][0].work_date||new Date().toISOString().slice(0,10)).slice(0,7);
      redraw();
    }).catch(function(e){
      WRAP.innerHTML='';
      var k=el('div','card'); k.appendChild(el('h2',null,'불러오지 못했습니다.'));
      k.appendChild(el('p','sub-t',String(e.message||e))); WRAP.appendChild(k);
    });
  };
})();
