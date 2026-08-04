/* 월단위생산량 — 기존 운영 화면(monthly_production.js)의 규칙을 따른다.
   행       : 날짜 × 제품. 같은 날 여러 제품이면 첫 행에만 공정 수치를 놓는다.
   그룹     : 날짜|부위. 단 가안 대상 제품(코스트코)은 별도 그룹으로 분리한다.
   EA       : 외포장이 있으면 외포장(외), 없으면 내포장(내).
   가안     : 방혈 기록이 없는 날 또는 지정 예외일이면 6월 코스트코 수율로 원육을 역산한다.
              역산한 칸은 노란 배경으로 표시한다. 추측이 아니라 표시된 추정치다.
   고기중량 : EA × 개당 원육g   /  완제품 중량 : EA × 제품 중량g            */
(function(){
  window.SSBON = window.SSBON || {};
  var cfg=null;
  var PARTN={1:'홍두깨',2:'설도',3:'우둔'};

  /* 가안 설정 — 운영과 동일 */
  var EST_YIELD={'코스트코 장조림 170g':{pp:0.9525,ck:0.625,sh:0.5593,final:0.574931}};
  var EST_FORCE={'2026-07-02':1,'2026-07-10':1};
  var EST_FROM='2026-06';

  var st={ym:null, items:null, group:'없음'};

  function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n;}
  function f(n,d){
    if(n==null||isNaN(n)||n===0) return d==null?'-':'-';
    return Number(n).toLocaleString('ko-KR',{minimumFractionDigits:0,maximumFractionDigits:d==null?2:d});
  }
  function pt(v,d){return (v==null||isNaN(v))?'—':v.toFixed(d==null?1:d)+'%';}
  function r2(n){return Math.round(n*100)/100;}
  function q(p){
    return fetch(cfg.restUrl+'/'+p,{headers:{apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey}})
      .then(function(r){ if(!r.ok) return r.text().then(function(t){throw new Error(p.split('?')[0]+' '+r.status+' '+t);}); return r.json(); });
  }
  function lastDay(ym){return new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate();}
  function prevYm(ym){var y=+ym.slice(0,4),m=+ym.slice(5,7)-1;if(m===0){y--;m=12;}return y+'-'+String(m).padStart(2,'0');}
  function sum(a,k){var s=0;a.forEach(function(x){s+=parseFloat(x[k])||0;});return s;}
  function mins(s){if(!s)return null;var t=String(s).replace('T',' ').slice(11,16).split(':');return t.length<2?null:(+t[0])*60+(+t[1]);}

  /* ── 조회 ── */
  function loadMonth(ym){
    var a=ym+'-01', b=ym+'-'+String(lastDay(ym)).padStart(2,'0');
    var w='work_date=gte.'+a+'&work_date=lte.'+b;
    return Promise.all([
      q('thaw_cart?select=finish_date,part_id,total_kg&finish_date=gte.'+a+'&finish_date=lte.'+b),
      q('preprocess_run?select=work_date,part_id,input_kg,output_kg,workers,start_time,end_time&'+w),
      q('cooking_run?select=work_date,part_id,output_kg,workers,start_time,end_time&'+w),
      q('shredding_run?select=work_date,part_id,output_kg,workers,start_time,end_time&'+w),
      q('packing_part?select=ea,part_id,item_id,packing_run!inner(work_date)&packing_run.work_date=gte.'+a+'&packing_run.work_date=lte.'+b),
      q('outerpacking_part?select=ea,part_id,item_id,outerpacking_run!inner(work_date)&outerpacking_run.work_date=gte.'+a+'&outerpacking_run.work_date=lte.'+b)
    ]).then(function(r){return {th:r[0],pp:r[1],ck:r[2],sh:r[3],pk:r[4],op:r[5]};});
  }

  /* ── 계산: 운영 규칙 그대로 ── */
  function build(d, upto){
    function keep(wd){ return !upto || (wd && +wd.slice(8,10)<=upto); }
    var th=d.th.filter(function(r){return keep(r.finish_date);});
    var pp=d.pp.filter(function(r){return keep(r.work_date);});
    var ck=d.ck.filter(function(r){return keep(r.work_date);});
    var sh=d.sh.filter(function(r){return keep(r.work_date);});
    var pk=d.pk.filter(function(r){return keep(r.packing_run&&r.packing_run.work_date);});
    var op=d.op.filter(function(r){return keep(r.outerpacking_run&&r.outerpacking_run.work_date);});

    /* 날짜|부위 단위 공정 집계 */
    function byDT(list,dk,vk){
      var m={};
      list.forEach(function(r){
        if(!r.part_id) return;
        var k=r[dk]+'|'+PARTN[r.part_id];
        var x=m[k]=m[k]||{kg:0,manh:0,workers:0,from:null,to:null};
        x.kg+=parseFloat(r[vk])||0;
        var a=mins(r.start_time),b=mins(r.end_time);
        if(a!=null&&b!=null&&b>a){ x.manh+=(b-a)/60*(parseInt(r.workers,10)||0);
          if(x.from==null||a<x.from)x.from=a; if(x.to==null||b>x.to)x.to=b; }
        x.workers=Math.max(x.workers,parseInt(r.workers,10)||0);
      });
      return m;
    }
    var thDT={}; th.forEach(function(r){
      if(!r.part_id) return;
      var k=r.finish_date+'|'+PARTN[r.part_id];
      thDT[k]=(thDT[k]||0)+(parseFloat(r.total_kg)||0);
    });
    var ppDT=byDT(pp,'work_date','output_kg'), ppIn={};
    pp.forEach(function(r){ if(r.part_id){var k=r.work_date+'|'+PARTN[r.part_id]; ppIn[k]=(ppIn[k]||0)+(parseFloat(r.input_kg)||0);} });
    var ckDT=byDT(ck,'work_date','output_kg');
    var shDT=byDT(sh,'work_date','output_kg');

    /* 날짜|품목 단위 EA (외포장 우선) */
    var g={};
    function touch(date,item,part){
      var k=date+'|'+item;
      if(!g[k]) g[k]={date:date,item_id:item,part_id:part,inner:0,outer:0};
      return g[k];
    }
    pk.forEach(function(r){ touch(r.packing_run.work_date,r.item_id,r.part_id).inner+=parseInt(r.ea,10)||0; });
    op.forEach(function(r){ touch(r.outerpacking_run.work_date,r.item_id,r.part_id).outer+=parseInt(r.ea,10)||0; });

    /* 행 만들기 */
    var rows=[];
    Object.keys(g).forEach(function(k){
      var x=g[k], it=st.items[x.item_id]||{};
      var ea = x.outer>0?x.outer:x.inner;
      rows.push({
        date:x.date, product:it.product_group||'(미정)', part:x.part_id?PARTN[x.part_id]:'',
        noMeat:!!it.no_meat, ea:ea, eaSrc:x.outer>0?'외':'내',
        innerEa:x.inner, outerEa:x.outer,
        meatKg: it.unit_weight_g? ea*it.unit_weight_g/1000 : 0,
        prodKg: it.product_weight_g? ea*it.product_weight_g/1000 : 0
      });
    });
    rows.sort(function(a,b){ return a.date<b.date?-1:a.date>b.date?1:(b.ea-a.ea); });

    /* 그룹: 날짜|부위, 가안 제품은 분리 */
    var grp={};
    rows.forEach(function(r){
      if(r.noMeat){ r._g=null; return; }
      var isEst = EST_YIELD[r.product] && r.date>=EST_FROM;
      var key = r.date+'|'+r.part + (isEst?'|EST|'+r.product:'');
      r._g=key; r._isEst=isEst;
      (grp[key]=grp[key]||[]).push(r);
    });
    var nonEst={};
    rows.forEach(function(r){ if(r._g&&!r._isEst) nonEst[r.date+'|'+r.part]=true; });

    Object.keys(grp).forEach(function(key){
      var arr=grp[key], p=key.split('|'), dt=p[0], pn=p[1], isEst=p[2]==='EST';
      var dk=dt+'|'+pn;
      var rm, ppKg, ckKg, shKg, est=false;
      if(isEst){
        var thaw=thDT[dk]||0;
        if(!(thaw>0) || EST_FORCE[dt]){
          var cfgE=EST_YIELD[arr[0].product];
          var meat=arr.reduce(function(s,r){return s+r.meatKg;},0);
          rm=cfgE.final? r2(meat/cfgE.final):0;
          ppKg=r2(rm*cfgE.pp); ckKg=r2(rm*cfgE.ck); shKg=r2(rm*cfgE.sh); est=true;
        } else if(nonEst[dk]){
          rm=0; ppKg=0; ckKg=0; shKg=0;
        } else {
          rm=thaw; ppKg=(ppDT[dk]||{}).kg||0; ckKg=(ckDT[dk]||{}).kg||0; shKg=(shDT[dk]||{}).kg||0;
        }
      } else {
        rm=thDT[dk]||0;
        ppKg=(ppDT[dk]||{}).kg||0; ckKg=(ckDT[dk]||{}).kg||0; shKg=(shDT[dk]||{}).kg||0;
      }
      arr.forEach(function(r,i){
        r._first=(i===0);
        if(i===0){ r.rmKg=rm; r.ppKg=ppKg; r.ckKg=ckKg; r.shKg=shKg; r.est=est;
          var a=ppDT[dk]||{}, b=ckDT[dk]||{}, c=shDT[dk]||{};
          r.manh=(a.manh||0)+(b.manh||0)+(c.manh||0);
          r.workers=Math.max(a.workers||0,b.workers||0,c.workers||0);
        } else { r.rmKg=0; r.ppKg=0; r.ckKg=0; r.shKg=0; r.est=false; r.manh=0; r.workers=0; }
      });
    });

    var days={}; rows.forEach(function(r){ days[r.date]=1; });
    return {
      rows:rows,
      rmKg:rows.reduce(function(s,r){return s+(r.rmKg||0);},0),
      ppKg:rows.reduce(function(s,r){return s+(r.ppKg||0);},0),
      ckKg:rows.reduce(function(s,r){return s+(r.ckKg||0);},0),
      shKg:rows.reduce(function(s,r){return s+(r.shKg||0);},0),
      ea:rows.reduce(function(s,r){return s+r.ea;},0),
      innerEa:rows.reduce(function(s,r){return s+r.ea;},0),
      outerEa:rows.reduce(function(s,r){return s+r.outerEa;},0),
      meatKg:rows.reduce(function(s,r){return s+r.meatKg;},0),
      prodKg:rows.reduce(function(s,r){return s+r.prodKg;},0),
      manh:rows.reduce(function(s,r){return s+(r.manh||0);},0),
      dayCount:Object.keys(days).length
    };
  }

  /* ── 본표 ── */
  function mainTable(s, prev){
    var k=el('div','card'); k.style.marginBottom='14px';
    var head=el('div','chips');
    ['없음','제품별','원육별'].forEach(function(gp){
      var b=el('button','fchip'+(st.group===gp?' on':''),gp==='없음'?'그룹 없음':gp);
      b.addEventListener('click',function(){ st.group=gp; redraw(); });
      head.appendChild(b);
    });
    k.appendChild(el('h2',null,'월단위생산량'));
    k.appendChild(head);

    var wrap=el('div','tscroll');
    var t=el('table','tbl mono-t');
    t.innerHTML='<thead><tr>'+
      '<th style="width:52px">생산<br>일수</th><th style="width:64px">생산일자</th><th style="min-width:190px">제품명</th>'+
      '<th class="num" style="width:104px">원육 사용량<br>(KG)</th><th class="num" style="width:92px">전처리<br>(KG)</th>'+
      '<th class="num" style="width:88px">자숙<br>(KG)</th><th class="num" style="width:88px">파쇄<br>(KG)</th>'+
      '<th class="num" style="width:96px">내포장<br>(EA)</th><th class="num" style="width:92px">외포장<br>(EA)</th>'+
      '<th class="num" style="width:106px">완제품 고기<br>중량(KG)</th><th class="num" style="width:100px">완제품 중량<br>(KG)</th></tr></thead>';
    var tb=el('tbody');

    if(st.group==='없음'){
      var dayNo=0, lastDate=null;
      s.rows.forEach(function(r){
        var tr=el('tr');
        var newDay = r.date!==lastDate;
        if(newDay){ dayNo++; lastDate=r.date; }
        tr.appendChild(el('td','cnum', newDay?String(dayNo):''));
        tr.appendChild(el('td','cnum', newDay?r.date.slice(5):''));
        var c=el('td');
        c.appendChild(el('span','nm',r.product));
        if(r.part) c.appendChild(el('span','badge g-'+r.part,r.part));
        tr.appendChild(c);
        [['rmKg',2],['ppKg',2],['ckKg',2],['shKg',2]].forEach(function(x){
          var td=el('td','num', r._first? f(r[x[0]],x[1]) : '');
          if(r.est && r._first){ td.classList.add('est'); td.title='가안 — 6월 코스트코 평균수율로 역산(방혈·공정 미기록분)'; }
          tr.appendChild(td);
        });
        var ci=el('td','num');
        ci.appendChild(document.createTextNode(f(r.ea,0)));
        ci.appendChild(el('span','src','('+r.eaSrc+')'));
        if(r.eaSrc==='외') ci.title='외포장 완료 — 확정 수량입니다.';
        tr.appendChild(ci);
        tr.appendChild(el('td','num', f(r.outerEa,0)));
        tr.appendChild(el('td','num', f(r.meatKg,2)));
        tr.appendChild(el('td','num', f(r.prodKg,2)));
        tb.appendChild(tr);
      });
    } else {
      var m={};
      s.rows.forEach(function(r){
        var key = st.group==='제품별' ? r.product : (r.part||'(미정)');
        var x=m[key]=m[key]||{key:key,rm:0,pp:0,ck:0,sh:0,inner:0,outer:0,meat:0,prod:0,days:{}};
        x.rm+=r.rmKg||0; x.pp+=r.ppKg||0; x.ck+=r.ckKg||0; x.sh+=r.shKg||0;
        x.inner+=r.ea; x.outer+=r.outerEa; x.meat+=r.meatKg; x.prod+=r.prodKg;
        x.days[r.date]=1;
      });
      Object.keys(m).sort(function(a,b){return m[b].meat-m[a].meat;}).forEach(function(key){
        var x=m[key], tr=el('tr');
        tr.appendChild(el('td','cnum',String(Object.keys(x.days).length)));
        tr.appendChild(el('td','cnum','일'));
        var c=el('td'); c.appendChild(el('span','nm',x.key)); tr.appendChild(c);
        [x.rm,x.pp,x.ck,x.sh].forEach(function(v){ tr.appendChild(el('td','num',f(v,2))); });
        tr.appendChild(el('td','num',f(x.inner,0)));
        tr.appendChild(el('td','num',f(x.outer,0)));
        tr.appendChild(el('td','num',f(x.meat,2)));
        tr.appendChild(el('td','num',f(x.prod,2)));
        tb.appendChild(tr);
      });
    }

    /* 합계 · 일평균 · 전월 */
    function foot(lab, v, cls){
      var tr=el('tr',cls);
      var c0=el('td','cnum',lab); c0.colSpan=3; c0.style.textAlign='center'; c0.style.fontWeight='700';
      tr.appendChild(c0);
      v.forEach(function(x){ tr.appendChild(el('td','num',x)); });
      return tr;
    }
    var n=s.dayCount||1;
    tb.appendChild(foot('합 계',[f(s.rmKg,2),f(s.ppKg,2),f(s.ckKg,2),f(s.shKg,2),
      f(s.innerEa,0),f(s.outerEa,0),f(s.meatKg,2),f(s.prodKg,2)],'sum'));
    tb.appendChild(foot('일 평 균',[f(s.rmKg/n,2),f(s.ppKg/n,2),f(s.ckKg/n,2),f(s.shKg/n,2),
      f(s.innerEa/n,0),f(s.outerEa/n,0),f(s.meatKg/n,2),f(s.prodKg/n,2)],'sum'));
    if(prev){
      var pn=prev.dayCount||1;
      tb.appendChild(foot('전월 평균',[f(prev.rmKg/pn,2),f(prev.ppKg/pn,2),f(prev.ckKg/pn,2),f(prev.shKg/pn,2),
        f(prev.innerEa/pn,0),f(prev.outerEa/pn,0),f(prev.meatKg/pn,2),f(prev.prodKg/pn,2)],'sum2'));
      var d=[['rmKg'],['ppKg'],['ckKg'],['shKg'],['innerEa'],['outerEa'],['meatKg'],['prodKg']].map(function(x){
        var a=s[x[0]]/n, b=prev[x[0]]/pn;
        if(!b) return '—';
        var p=(a-b)/b*100;
        return (p>=0?'▲ ':'▼ ')+Math.abs(p).toFixed(1)+'%';
      });
      var tr=foot('전월 대비 증감',d,'sum2');
      Array.prototype.forEach.call(tr.querySelectorAll('td.num'),function(td){
        if(td.textContent.indexOf('▲')===0) td.style.color='#1F8A4C';
        else if(td.textContent.indexOf('▼')===0) td.style.color='#B4342C';
      });
      tb.appendChild(tr);
    }
    t.appendChild(tb); wrap.appendChild(t); k.appendChild(wrap);
    if(s.rows.some(function(r){return r.est;}))
      k.appendChild(el('div','est-note','■ 노란 칸은 가안입니다. 방혈·공정 기록이 없어 6월 코스트코 평균수율로 역산한 값입니다.'));
    return k;
  }

  /* ── 전월 대비 ── */
  function compare(ym,cur,pSame,pAll,upto){
    var k=el('div','card');
    k.appendChild(el('h2',null,'전월 대비 비교'));
    k.appendChild(el('p','sub-t','동기간은 전월 같은 일차('+upto+'일차)까지만 잘라 비교한 값입니다.'));
    var pm=prevYm(ym);
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th>구분</th>'+
      '<th class="num" style="width:118px">'+ym.replace('-','년 ')+'월</th>'+
      '<th class="num" style="width:158px">'+pm.replace('-','년 ')+'월 동기간 ('+upto+'일차)</th>'+
      '<th class="num" style="width:130px">'+pm.replace('-','년 ')+'월 (전체)</th>'+
      '<th class="num" style="width:126px">차이 (vs 동기간)</th>'+
      '<th class="num" style="width:96px">증감율</th></tr></thead>';
    var tb=el('tbody');
    function row(lab,a,b,c,unit,dec,isPct){
      var tr=el('tr');
      tr.appendChild(el('td','nm',lab));
      function cell(v){ return el('td','num', v==null?'—':(isPct?pt(v,1):Number(v).toLocaleString('ko-KR',{minimumFractionDigits:dec,maximumFractionDigits:dec})+(unit?' '+unit:''))); }
      tr.appendChild(cell(a)); tr.appendChild(cell(b)); tr.appendChild(cell(c));
      var df=(a==null||b==null)?null:a-b;
      var dc=el('td','num', df==null?'—':(df>=0?'▲ ':'▼ ')+(isPct?Math.abs(df).toFixed(1)+'%p'
        :Math.abs(df).toLocaleString('ko-KR',{minimumFractionDigits:dec,maximumFractionDigits:dec})+(unit?' '+unit:'')));
      if(df) dc.style.color=df>0?'#1F8A4C':'#B4342C';
      tr.appendChild(dc);
      var p=(b?df/b*100:null);
      var pc=el('td','num', p==null?'—':(p>=0?'▲ ':'▼ ')+Math.abs(p).toFixed(1)+'%');
      if(p) pc.style.color=p>0?'#1F8A4C':'#B4342C';
      tr.appendChild(pc);
      tb.appendChild(tr);
    }
    function avg(x){return x.dayCount?x.rmKg/x.dayCount:null;}
    function y(x,key){return x.rmKg?x[key]/x.rmKg*100:null;}
    row('일평균 원육사용량',avg(cur),avg(pSame),avg(pAll),'kg',2);
    row('생산일수',cur.dayCount,pSame.dayCount,pAll.dayCount,'일',0);
    row('월 누적 원육사용량',cur.rmKg,pSame.rmKg,pAll.rmKg,'kg',2);
    row('월 누적 EA (외포장)',cur.ea,pSame.ea,pAll.ea,'EA',0);
    row('완제품 고기중량',cur.meatKg,pSame.meatKg,pAll.meatKg,'kg',2);
    row('전처리 수율',y(cur,'ppKg'),y(pSame,'ppKg'),y(pAll,'ppKg'),'',1,true);
    row('자숙 수율',y(cur,'ckKg'),y(pSame,'ckKg'),y(pAll,'ckKg'),'',1,true);
    row('파쇄 수율',y(cur,'shKg'),y(pSame,'shKg'),y(pAll,'shKg'),'',1,true);
    row('최종 수율',y(cur,'meatKg'),y(pSame,'meatKg'),y(pAll,'meatKg'),'',1,true);
    t.appendChild(tb); k.appendChild(t);
    return k;
  }

  /* ── 조립 ── */
  var WRAP=null;
  function shift(n){
    var y=+st.ym.slice(0,4),m=+st.ym.slice(5,7)+n;
    while(m<1){m+=12;y--;} while(m>12){m-=12;y++;}
    st.ym=y+'-'+String(m).padStart(2,'0');
  }
  function bar(){
    var b=el('div','daybar');
    var p=el('button','fchip','◀'); p.addEventListener('click',function(){shift(-1);reload();});
    var i=el('input','search'); i.type='month'; i.value=st.ym;
    i.addEventListener('change',function(){ if(i.value){st.ym=i.value;reload();} });
    var n=el('button','fchip','▶'); n.addEventListener('click',function(){shift(1);reload();});
    var now=el('button','fchip','이번달');
    now.addEventListener('click',function(){ st.ym=new Date().toISOString().slice(0,7); reload(); });
    b.appendChild(p); b.appendChild(i); b.appendChild(n); b.appendChild(now);
    return b;
  }
  var CACHE=null;
  function redraw(){
    WRAP.innerHTML=''; WRAP.appendChild(bar());
    if(!CACHE){ WRAP.appendChild(el('div','empty','불러오는 중…')); return; }
    WRAP.appendChild(mainTable(CACHE.cur,CACHE.pSame));
    WRAP.appendChild(compare(st.ym,CACHE.cur,CACHE.pSame,CACHE.pAll,CACHE.upto));
  }
  function reload(){
    CACHE=null; WRAP.innerHTML=''; WRAP.appendChild(bar());
    var body=el('div'); body.appendChild(el('div','empty','불러오는 중…')); WRAP.appendChild(body);
    Promise.all([loadMonth(st.ym),loadMonth(prevYm(st.ym))]).then(function(a){
      var cur=build(a[0]);
      var upto=0; cur.rows.forEach(function(r){ upto=Math.max(upto,+r.date.slice(8,10)); });
      if(!upto) upto=lastDay(st.ym);
      var days={}; cur.rows.forEach(function(r){days[r.date]=1;});
      var dayIdx=Object.keys(days).length||1;
      CACHE={cur:cur, pSame:build(a[1],uptoNth(a[1],dayIdx)), pAll:build(a[1]), upto:dayIdx};
      redraw();
    }).catch(function(e){
      WRAP.innerHTML=''; WRAP.appendChild(bar());
      var k=el('div','card'); k.appendChild(el('h2',null,'불러오지 못했습니다.'));
      k.appendChild(el('p','sub-t',String(e.message||e))); WRAP.appendChild(k);
    });
  }
  /* 전월의 n번째 생산일이 며칠인지 */
  function uptoNth(d, n){
    var days={};
    d.pp.forEach(function(r){days[r.work_date]=1;});
    d.pk.forEach(function(r){days[r.packing_run.work_date]=1;});
    var ks=Object.keys(days).sort();
    if(!ks.length) return null;
    return +(ks[Math.min(n,ks.length)-1]).slice(8,10);
  }

  window.SSBON.views=window.SSBON.views||{};
  window.SSBON.views.monthly_prod=function(c){
    cfg=window.SSBON.config;
    WRAP=el('div'); c.appendChild(WRAP);
    if(!st.ym) st.ym=new Date().toISOString().slice(0,7);
    if(st.items){ reload(); return; }
    WRAP.appendChild(el('div','empty','불러오는 중…'));
    q('item_master?select=item_id,product_group,unit_weight_g,product_weight_g,no_meat,part&category=eq.완제품')
      .then(function(r){
        st.items={}; r.forEach(function(i){ st.items[i.item_id]=i; });
        reload();
      });
  };
})();
