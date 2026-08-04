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

  var st={ym:null, items:null, group:'없음', page:1, per:10, target:55, risk:50,
    cols:{'투입/배출':true,'작업인원':false,'작업시간':false,'생산성':false,'수율':false,'사용량':false}};

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
      q('packing_part?select=ea,part_id,item_id,packing_run!inner(work_date,pouch,sauce_kg,sub_kg,workers,start_time,end_time)&packing_run.work_date=gte.'+a+'&packing_run.work_date=lte.'+b),
      q('outerpacking_part?select=ea,part_id,item_id,outerpacking_run!inner(op_id,work_date,outer_boxes)&outerpacking_run.work_date=gte.'+a+'&outerpacking_run.work_date=lte.'+b),
      q('outerpacking_worklog?select=op_id,workers,start_time,end_time')
    ]).then(function(r){return {th:r[0],pp:r[1],ck:r[2],sh:r[3],pk:r[4],op:r[5],wl:r[6]};});
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
      if(!g[k]) g[k]={date:date,item_id:item,part_id:part,inner:0,outer:0,
        pouch:0,sauce:0,sub:0,boxes:0,pkWorkers:0,pkManh:0,pkFrom:null,pkTo:null,
        opManh:0,opFrom:null,opTo:null,opWkSum:0,opWkCnt:0,_pk:{},_op:{}};
      return g[k];
    }
    var wlBy={};
    (d.wl||[]).forEach(function(w){ (wlBy[w.op_id]=wlBy[w.op_id]||[]).push(w); });
    pk.forEach(function(r){
      var x=touch(r.packing_run.work_date,r.item_id,r.part_id);
      var pr=r.packing_run;
      x.inner+=parseInt(r.ea,10)||0;
      if(!x._pk[pr.work_date+'|'+(pr.pouch||0)+'|'+(pr.start_time||'')]){
        x._pk[pr.work_date+'|'+(pr.pouch||0)+'|'+(pr.start_time||'')]=1;
        x.pouch+=parseInt(pr.pouch,10)||0;
        x.sauce+=parseFloat(pr.sauce_kg)||0;
        x.sub  +=parseFloat(pr.sub_kg)||0;
        x.pkWorkers=Math.max(x.pkWorkers,parseInt(pr.workers,10)||0);
        var a=mins(pr.start_time),b2=mins(pr.end_time);
        if(a!=null&&b2!=null&&b2>a){ x.pkManh+=(b2-a)/60*(parseInt(pr.workers,10)||0);
          if(x.pkFrom==null||a<x.pkFrom)x.pkFrom=a; if(x.pkTo==null||b2>x.pkTo)x.pkTo=b2; }
      }
    });
    op.forEach(function(r){
      var x=touch(r.outerpacking_run.work_date,r.item_id,r.part_id);
      var orr=r.outerpacking_run;
      x.outer+=parseInt(r.ea,10)||0;
      if(!x._op[orr.op_id]){
        x._op[orr.op_id]=1;
        x.boxes+=parseInt(orr.outer_boxes,10)||0;
        var ws=wlBy[orr.op_id]||[], tot=0, cnt=0;
        ws.forEach(function(w){
          var a=mins(w.start_time),b2=mins(w.end_time), n=parseInt(w.workers,10)||0;
          if(a!=null&&b2!=null&&b2>a){ x.opManh+=(b2-a)/60*n;
            if(x.opFrom==null||a<x.opFrom)x.opFrom=a; if(x.opTo==null||b2>x.opTo)x.opTo=b2; }
          if(n){ tot+=n; cnt++; }
        });
        if(cnt){ x.opWkSum+=tot; x.opWkCnt+=cnt; }
      }
    });

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
        prodKg: it.product_weight_g? ea*it.product_weight_g/1000 : 0,
        pouch:x.pouch, sauce:x.sauce, sub:x.sub, boxes:x.boxes,
        pkWorkers:x.pkWorkers, pkManh:x.pkManh, pkFrom:x.pkFrom, pkTo:x.pkTo,
        opManh:x.opManh, opFrom:x.opFrom, opTo:x.opTo,
        opWorkers: x.opWkCnt? x.opWkSum/x.opWkCnt : 0
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
          r.pp_=a; r.ck_=b; r.sh_=c;
        } else { r.rmKg=0; r.ppKg=0; r.ckKg=0; r.shKg=0; r.est=false; r.manh=0; r.workers=0; r.pp_={}; r.ck_={}; r.sh_={}; }
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
      ppManh:rows.reduce(function(s,r){return s+((r.pp_||{}).manh||0);},0),
      ckManh:rows.reduce(function(s,r){return s+((r.ck_||{}).manh||0);},0),
      shManh:rows.reduce(function(s,r){return s+((r.sh_||{}).manh||0);},0),
      pouch:rows.reduce(function(s,r){return s+(r.pouch||0);},0),
      sauce:rows.reduce(function(s,r){return s+(r.sauce||0);},0),
      sub:rows.reduce(function(s,r){return s+(r.sub||0);},0),
      boxes:rows.reduce(function(s,r){return s+(r.boxes||0);},0),
      pkManh:rows.reduce(function(s,r){return s+(r.pkManh||0);},0),
      opManh:rows.reduce(function(s,r){return s+(r.opManh||0);},0),
      dayCount:Object.keys(days).length
    };
  }

  /* ── 본표 ── */
  function hm(m){ return m==null?'-':(m/60).toFixed(1)+'h'; }
  function span(a,b){ return (a==null||b==null||b<=a)?null:(b-a); }
  function div(a,b){ return b? a/b : null; }
  function pc(a,b){ return b? a/b*100 : null; }

  /* 컬럼 정의: sec 은 상단 그룹 헤더 */
  function colDefs(){
    var C=[];
    function add(sec,g,label,w,get,key){ C.push({sec:sec,g:g,label:label,w:w,get:get,key:key}); }
    var S1='원육 / 공통공정 (KG)', S2='포장 / 완제품', S3='수율 (%)';
    add(S1,null,'원육<br>사용량',82,function(r){return r._first?f(r.rmKg,2):'';},1);
    add(S1,'투입/배출','전처리',76,function(r){return r._first?f(r.ppKg,2):'';});
    add(S1,'투입/배출','자숙',72,function(r){return r._first?f(r.ckKg,2):'';});
    add(S1,'투입/배출','파쇄',72,function(r){return r._first?f(r.shKg,2):'';});
    add(S1,'작업인원','전처리<br>인원',60,function(r){return r._first?f((r.pp_||{}).workers,1):'';});
    add(S1,'작업인원','자숙<br>인원',56,function(r){return r._first?f((r.ck_||{}).workers,1):'';});
    add(S1,'작업인원','파쇄<br>인원',56,function(r){return r._first?f((r.sh_||{}).workers,1):'';});
    add(S1,'작업시간','전처리<br>시간',62,function(r){return r._first?hm(span((r.pp_||{}).from,(r.pp_||{}).to)):'';});
    add(S1,'작업시간','자숙<br>시간',58,function(r){return r._first?hm(span((r.ck_||{}).from,(r.ck_||{}).to)):'';});
    add(S1,'작업시간','파쇄<br>시간',58,function(r){return r._first?hm(span((r.sh_||{}).from,(r.sh_||{}).to)):'';});
    add(S1,'작업시간','전처리<br>인시',60,function(r){return r._first?f((r.pp_||{}).manh,1):'';});
    add(S1,'작업시간','자숙<br>인시',56,function(r){return r._first?f((r.ck_||{}).manh,1):'';});
    add(S1,'작업시간','파쇄<br>인시',56,function(r){return r._first?f((r.sh_||{}).manh,1):'';});
    add(S1,'생산성','생산성<br>전처리',66,function(r){return r._first?f(div(r.ppKg,(r.pp_||{}).manh),2):'';});
    add(S1,'생산성','생산성<br>자숙',62,function(r){return r._first?f(div(r.ckKg,(r.ck_||{}).manh),2):'';});
    add(S1,'생산성','생산성<br>파쇄',62,function(r){return r._first?f(div(r.shKg,(r.sh_||{}).manh),2):'';});

    add(S2,null,'내포장<br>(EA)',80,'EA',1);
    add(S2,null,'외포장<br>(EA)',76,function(r){return f(r.outerEa,0);});
    add(S2,null,'완제품<br>고기중량(KG)',94,function(r){return f(r.meatKg,2);},1);
    add(S2,null,'완제품<br>중량(KG)',82,function(r){return f(r.prodKg,2);});
    add(S2,'작업인원','내포장<br>인원',60,function(r){return f(r.pkWorkers,1);});
    add(S2,'작업인원','외포장<br>인원(평균)',72,function(r){return f(r.opWorkers,1);});
    add(S2,'작업시간','내포장<br>시간',62,function(r){return hm(span(r.pkFrom,r.pkTo));});
    add(S2,'작업시간','외포장<br>시간',62,function(r){return hm(span(r.opFrom,r.opTo));});
    add(S2,'작업시간','내포장<br>인시',60,function(r){return f(r.pkManh,1);});
    add(S2,'작업시간','외포장<br>인시',60,function(r){return f(r.opManh,1);});
    add(S2,'생산성','생산성<br>포장',62,function(r){return f(div(r.ea,r.pkManh),2);});
    add(S2,'생산성','생산성<br>외포장',66,function(r){return f(div(r.outerEa,r.opManh),2);});
    add(S2,'사용량','파우치<br>(EA)',76,function(r){return f(r.pouch,0);});
    add(S2,'사용량','소스<br>(KG)',70,function(r){return f(r.sauce,0);});
    add(S2,'사용량','부재료<br>(KG)',74,function(r){return f(r.sub,2);});
    add(S2,'사용량','박스<br>(EA)',70,function(r){return f(r.boxes,0);});

    add(S3,null,'전처리<br>수율',62,function(r){return r._first?pt(pc(r.ppKg,r.rmKg)):'';});
    add(S3,null,'자숙<br>수율',58,function(r){return r._first?pt(pc(r.ckKg,r.rmKg)):'';});
    add(S3,null,'파쇄<br>수율',58,function(r){return r._first?pt(pc(r.shKg,r.rmKg)):'';});
    add(S3,null,'포장<br>수율',58,function(r){return r._first?pt(pc(r._grpMeat,r.rmKg)):'';});
    add(S3,null,'최종<br>수율',58,function(r){return r._first?pt(pc(r._grpMeat,r.rmKg)):'';},1);
    add(S3,'수율','공정<br>전처리',62,function(r){return r._first?pt(pc(r.ppKg,r.rmKg)):'';});
    add(S3,'수율','공정<br>자숙',58,function(r){return r._first?pt(pc(r.ckKg,r.ppKg)):'';});
    add(S3,'수율','공정<br>파쇄',58,function(r){return r._first?pt(pc(r.shKg,r.ckKg)):'';});
    add(S3,'수율','공정<br>포장',58,function(r){return r._first?pt(pc(r._grpMeat,r.shKg)):'';});
    return C.filter(function(c){ return c.g==null || st.cols[c.g]; });
  }

  /* 상단 요약 */
  function summary(s){
    var box=el('div','mp-sum');
    box.appendChild(el('div','sum-n','총 '+s.rows.length+'건'));
    [['원육 사용량 합계',f(s.rmKg,2)+' kg'],
     ['완제품 고기중량 합계',f(s.meatKg,2)+' kg'],
     ['완제품 중량 합계',f(s.prodKg,2)+' kg'],
     ['평균 수율(최종)',pt(pc(s.meatKg,s.rmKg))]
    ].forEach(function(x){
      var d=el('div','sum-i');
      d.appendChild(el('div','sum-k',x[0]));
      d.appendChild(el('div','sum-v',x[1]));
      box.appendChild(d);
    });
    var xls=el('button','fchip','엑셀 다운로드');
    xls.addEventListener('click',function(){ download(s); });
    box.appendChild(xls);
    return box;
  }

  function mainTable(s, prev){
    var k=el('div','card'); k.style.marginBottom='14px';
    var hd=el('div','mp-head');
    hd.appendChild(el('h2',null,'월단위 생산실적'));
    hd.appendChild(el('span','sub-t','월별 생산 및 수율을 상세 내역으로 조회하고 비교할 수 있습니다.'));
    k.appendChild(hd);

    /* 조회 조건 */
    var tools=el('div','mp-tools');
    var g1=el('div','tgroup');
    g1.appendChild(el('span','tlab','컬럼 표시'));
    Object.keys(st.cols).forEach(function(key){
      var lb=el('label','tchk');
      var cb=el('input'); cb.type='checkbox'; cb.checked=st.cols[key];
      cb.addEventListener('change',function(){ st.cols[key]=cb.checked; redraw(); });
      lb.appendChild(cb); lb.appendChild(el('span',null,key));
      g1.appendChild(lb);
    });
    tools.appendChild(g1);
    var g2=el('div','tgroup');
    g2.appendChild(el('span','tlab','그룹'));
    ['없음','제품별','원육별'].forEach(function(gp){
      var lb=el('label','tchk');
      var rd=el('input'); rd.type='radio'; rd.name='mpgrp'; rd.checked=(st.group===gp);
      rd.addEventListener('change',function(){ st.group=gp; st.page=1; redraw(); });
      lb.appendChild(rd); lb.appendChild(el('span',null,gp));
      g2.appendChild(lb);
    });
    tools.appendChild(g2);
    k.appendChild(tools);
    k.appendChild(summary(s));

    /* 그룹 고기중량 */
    var gm={};
    s.rows.forEach(function(r){ if(r._g) gm[r._g]=(gm[r._g]||0)+r.meatKg; });
    s.rows.forEach(function(r){ r._grpMeat=gm[r._g]||r.meatKg; });

    var C=colDefs();
    var wrap=el('div','tscroll frozen');
    var t=el('table','tbl mono-t');

    /* 2단 헤더 */
    var thead=el('thead');
    var tr1=el('tr'), tr2=el('tr');
    [['일',34],['생산일',56],['제품명',214]].forEach(function(x){
      var th=el('th',null,x[0]); th.rowSpan=2; th.style.width=x[1]+'px'; tr1.appendChild(th);
    });
    var secs=[];
    C.forEach(function(c){
      if(!secs.length || secs[secs.length-1].name!==c.sec) secs.push({name:c.sec,n:0,w:0});
      secs[secs.length-1].n++; secs[secs.length-1].w+=c.w;
    });
    secs.forEach(function(x){
      var th=el('th','sec',x.name); th.colSpan=x.n; tr1.appendChild(th);
    });
    C.forEach(function(c){
      var th=el('th'); th.innerHTML=c.label; th.style.width=c.w+'px';
      if(c.key) th.classList.add('keyh');
      tr2.appendChild(th);
    });
    thead.appendChild(tr1); thead.appendChild(tr2); t.appendChild(thead);

    /* 본문 */
    var tb=el('tbody');
    var rows=s.rows;
    if(st.group!=='없음'){
      var m={};
      rows.forEach(function(r){
        var key=(st.group==='제품별')?r.product:(r.part||'(미정)');
        var x=m[key]=m[key]||{key:key,rmKg:0,ppKg:0,ckKg:0,shKg:0,ea:0,outerEa:0,meatKg:0,prodKg:0,
          pouch:0,sauce:0,sub:0,boxes:0,pkManh:0,opManh:0,pkWorkers:0,opWorkers:0,days:{},
          pp_:{manh:0,workers:0},ck_:{manh:0,workers:0},sh_:{manh:0,workers:0},_first:true,eaSrc:''};
        ['rmKg','ppKg','ckKg','shKg','ea','outerEa','meatKg','prodKg','pouch','sauce','sub','boxes','pkManh','opManh']
          .forEach(function(f2){ x[f2]+=r[f2]||0; });
        ['pp_','ck_','sh_'].forEach(function(f2){
          x[f2].manh+=((r[f2]||{}).manh)||0;
          x[f2].workers=Math.max(x[f2].workers,((r[f2]||{}).workers)||0);
        });
        x.days[r.date]=1; x._grpMeat=x.meatKg;
      });
      Object.keys(m).sort(function(a,b){return m[b].meatKg-m[a].meatKg;}).forEach(function(key){
        var x=m[key], tr=el('tr','dstart');
        tr.appendChild(el('td','cnum',String(Object.keys(x.days).length)));
        tr.appendChild(el('td','cnum','일'));
        var c=el('td','pcell'); c.appendChild(el('span','nm',x.key)); tr.appendChild(c);
        C.forEach(function(cd){
          var td=el('td','num'+(cd.key?' key':''));
          td.textContent=(cd.get==='EA')?f(x.ea,0):cd.get(x);
          tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
    } else {
      /* 병합 단위 = 그룹키(날짜|부위, 가안 제품은 분리). 본서버 규칙과 동일.
         페이지 단위는 생산일 기준. */
      var byDate=[], lastD=null;
      s.rows.forEach(function(r){
        if(r.date!==lastD){ byDate.push({date:r.date, groups:[], n:0}); lastD=r.date; }
        var day=byDate[byDate.length-1];
        var gk=r._g||('solo|'+r.date+'|'+r.product);
        var grp=null;
        for(var i2=0;i2<day.groups.length;i2++) if(day.groups[i2].key===gk){ grp=day.groups[i2]; break; }
        if(!grp){ grp={key:gk, part:r.part, list:[]}; day.groups.push(grp); }
        grp.list.push(r); day.n++;
      });
      var slice=byDate, no=0;
      slice.forEach(function(d){
        no++;
        var first=true;
        d.groups.forEach(function(grp){
          var span=grp.list.length;
          grp.list.forEach(function(r,i){
            var tr=el('tr');
            if(first&&i===0) tr.classList.add('dstart');
            else if(i===0) tr.classList.add('gstart');
            if(no%2===0) tr.classList.add('dalt');
            if(first&&i===0){
              var c1=el('td','cnum',String(no)); c1.rowSpan=d.n; tr.appendChild(c1);
              var c2=el('td','cnum',d.date.slice(5)); c2.rowSpan=d.n; tr.appendChild(c2);
            }
            var pcell=el('td','pcell');
            pcell.appendChild(el('span','nm',r.product));
            if(r.part) pcell.appendChild(el('span','badge g-'+r.part,r.part));
            tr.appendChild(pcell);
            C.forEach(function(cd){
              /* 그룹 공통값(첫 행만 값 보유)은 rowspan 으로 실제 병합 */
              var shared = (cd.get!=='EA') && (cd.get(grp.list[0])!=='' ) &&
                           grp.list.length>1 && grp.list.some(function(x,xi){ return xi>0 && cd.get(x)===''; });
              if(shared && i>0) return;
              var td=el('td','num'+(cd.key?' key':''));
              if(shared){ td.rowSpan=span; td.classList.add('mgspan'); }
              if(cd.get==='EA'){
                td.appendChild(document.createTextNode(f(r.ea,0)));
                td.appendChild(el('span','src','('+r.eaSrc+')'));
              } else td.textContent=cd.get(r);
              if(r.est && r._first && cd.sec==='원육 / 공통공정 (KG)'){
                td.classList.add('est'); td.title='가안 — 6월 코스트코 평균수율로 역산';
              }
              tr.appendChild(td);
            });
            tb.appendChild(tr);
            first=false;
          });
        });
      });
      k._rows=byDate.length;
    }

    /* 합계 */
    function agg(src,n){
      var o={_first:true,eaSrc:''};
      ['rmKg','ppKg','ckKg','shKg','ea','outerEa','meatKg','prodKg','pouch','sauce','sub','boxes','pkManh','opManh']
        .forEach(function(f2){ o[f2]=(src[f2]||0)/n; });
      o.pp_={manh:(src.ppManh||0)/n}; o.ck_={manh:(src.ckManh||0)/n}; o.sh_={manh:(src.shManh||0)/n};
      o._grpMeat=o.meatKg; return o;
    }
    function footRow(lab,obj,cls){
      var tr=el('tr',cls);
      var c0=el('td','cnum',lab); c0.colSpan=3; c0.style.fontWeight='700'; tr.appendChild(c0);
      C.forEach(function(cd){
        var td=el('td','num'+(cd.key?' key':''));
        td.textContent=(cd.get==='EA')?f(obj.ea,0):cd.get(obj);
        tr.appendChild(td);
      });
      return tr;
    }
    var n=s.dayCount||1;
    tb.appendChild(footRow('합 계',agg(s,1),'sum'));
    tb.appendChild(footRow('일 평 균',agg(s,n),'sum2'));
    t.appendChild(tb); wrap.appendChild(t); k.appendChild(wrap);

    if(k._rows){
      var info=el('div','mp-foot');
      info.appendChild(el('span','erp','생산일 '+k._rows+'일 · 총 '+s.rows.length+'건'));
      info.appendChild(el('span','erp','헤더와 왼쪽 3열은 스크롤해도 고정됩니다.'));
      k.appendChild(info);
    }
    if(s.rows.some(function(r){return r.est;}))
      k.appendChild(el('div','est-note','노란 칸은 가안입니다. 방혈·공정 기록이 없어 6월 코스트코 평균수율로 역산한 값입니다.'));
    return k;
  }

  function download(s){
    var C=colDefs();
    var head=['생산일','원육','제품명'].concat(C.map(function(c){return c.label.replace(/<br>/g,' ');}));
    var lines=[head.join(',')];
    s.rows.forEach(function(r){
      var cells=[r.date, r.part||'', '"'+r.product+'"'];
      C.forEach(function(cd){
        var v=(cd.get==='EA')?f(r.ea,0):cd.get(r);
        cells.push('"'+String(v).replace(/,/g,'')+'"');
      });
      lines.push(cells.join(','));
    });
    var blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8;'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='월단위생산실적_'+st.ym+'.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  /* ── 비교: 수율 추이 + 흐름 ── */
  function compare(ym,cur,pSame,pAll,upto,lastY,lastYm){
    var k=el('div','card');
    var hd=el('div','mp-head');
    hd.appendChild(el('h2',null,'수율 흐름'));
    hd.appendChild(el('span','sub-t','원육이 어디서 얼마나 줄어드는지, 어느 날이 평소와 달랐는지를 봅니다.'));
    k.appendChild(hd);

    /* 1) 단계별 흐름 — 막대 길이가 곧 남은 비율 */
    function yv(x,key){ return x&&x.rmKg? x[key]/x.rmKg*100 : null; }
    var SV='http://www.w3.org/2000/svg';
    function svgEl(t,at){ var e=document.createElementNS(SV,t);
      for(var k2 in (at||{})) e.setAttribute(k2,at[k2]); return e; }

    var steps=[
      {n:'원육',   kg:cur.rmKg,   y:100,               py:100},
      {n:'전처리', kg:cur.ppKg,   y:yv(cur,'ppKg'),    py:yv(pSame,'ppKg')},
      {n:'자숙',   kg:cur.ckKg,   y:yv(cur,'ckKg'),    py:yv(pSame,'ckKg')},
      {n:'파쇄',   kg:cur.shKg,   y:yv(cur,'shKg'),    py:yv(pSame,'shKg')},
      {n:'완제품', kg:cur.meatKg, y:yv(cur,'meatKg'),  py:yv(pSame,'meatKg')}
    ];
    var flow=el('div','chart');
    var fh=el('div','chart-hd');
    fh.appendChild(el('b',null,'단계별 수율'));
    fh.appendChild(el('span','erp','원육 100%에서 시작해 각 공정을 지나며 남는 비율입니다.'));
    flow.appendChild(fh);

    var hasPrev=steps.every(function(x){return x.py!=null;});
    var flg=el('div','lgd');
    [['이번달','b-now'],(hasPrev?['전월 동기간','b-prev']:null)].filter(Boolean).forEach(function(x){
      var i2=el('span','lgd-i');
      i2.appendChild(el('span','lgd-b '+x[1]));
      i2.appendChild(document.createTextNode(x[0]));
      flg.appendChild(i2);
    });
    flow.appendChild(flg);

    var FPL=46, FPR=20, FPT=26, FPB=58;
    var fw=steps.length*118+FPL+FPR, fhh=290;
    var TOP=110;
    function FY(v){ return FPT + (TOP-v)/TOP*(fhh-FPT-FPB); }
    var slot=(fw-FPL-FPR)/steps.length;
    var bw=hasPrev?26:36, gap=6;
    var svgF=svgEl('svg',{viewBox:'0 0 '+fw+' '+fhh,'class':'g2'});
    svgF.setAttribute('width',fw);

    for(var gg=0; gg<=100; gg+=20){
      svgF.appendChild(svgEl('line',{x1:FPL,x2:fw-FPR,y1:FY(gg),y2:FY(gg),'class':'g-grid'}));
      var yl2=svgEl('text',{x:FPL-8,y:FY(gg)+3.5,'class':'g-ylab'});
      yl2.textContent=gg+'%'; svgF.appendChild(yl2);
    }
    var base=FY(0);

    steps.forEach(function(x,i){
      var cx=FPL+slot*i+slot/2;
      var totalW=hasPrev?(bw*2+gap):bw;
      var x0=cx-totalW/2;
      function bar(v,cls,bx,lab){
        var y0=FY(v), hgt=Math.max(base-y0,1.5);
        var r=svgEl('rect',{x:bx,y:y0,width:bw,height:hgt,rx:3,'class':'bar '+cls});
        var t3=svgEl('title'); t3.textContent=lab+' '+v.toFixed(1)+'%';
        r.appendChild(t3); svgF.appendChild(r);
        var tv=svgEl('text',{x:bx+bw/2,y:y0-6,'class':'bar-v '+cls});
        tv.textContent=v.toFixed(1)+'%'; svgF.appendChild(tv);
      }
      if(hasPrev){
        bar(x.y,'b-now',x0,'이번달');
        bar(x.py,'b-prev',x0+bw+gap,'전월');
      } else bar(x.y,'b-now',x0,'이번달');

      var n1=svgEl('text',{x:cx,y:fhh-38,'class':'g-xlab step'}); n1.textContent=x.n;
      svgF.appendChild(n1);
      var n2=svgEl('text',{x:cx,y:fhh-24,'class':'g-xlab2'}); n2.textContent=f(x.kg,0)+' kg';
      svgF.appendChild(n2);
      if(i>0){
        var loss=steps[i-1].kg-x.kg;
        var n3=svgEl('text',{x:cx,y:fhh-11,'class':'g-xloss'+(loss>0?'':' plus')});
        n3.textContent=(loss>0?'−':'+')+f(Math.abs(loss),0)+' kg';
        svgF.appendChild(n3);
      }
      if(hasPrev && i>0){
        var df2=x.y-x.py;
        var dg=svgEl('text',{x:cx,y:FPT-9,'class':'bar-d '+(df2>0?'up':'dn')});
        dg.textContent=(df2>=0?'▲ ':'▼ ')+Math.abs(df2).toFixed(1)+'%p';
        svgF.appendChild(dg);
      }
    });
    svgF.appendChild(svgEl('line',{x1:FPL,x2:fw-FPR,y1:base,y2:base,'class':'g-axis'}));
    var fsc=el('div','gscroll'); fsc.appendChild(svgF);

    /* 오른쪽 해설 — 전월 대비 차이를 문장으로 */
    var side=el('div','fside');
    if(hasPrev){
      var fin=steps[steps.length-1];
      var gapY=fin.y-fin.py;
      var hd2=el('div','fs-hd');
      hd2.appendChild(el('b',null,'전월 대비 최종수율'));
      var big=el('div','fs-big'+(gapY>0?' up':(gapY<0?' dn':'')));
      big.appendChild(el('span','fs-v',(gapY>=0?'▲ ':'▼ ')+Math.abs(gapY).toFixed(1)+'%p'));
      big.appendChild(el('span','fs-s',fin.py.toFixed(1)+'% → '+fin.y.toFixed(1)+'%'));
      hd2.appendChild(big);
      side.appendChild(hd2);

      /* 공정별 기여: 각 단계 수율차 (직전 대비) */
      var conts=[];
      for(var i3=1;i3<steps.length;i3++){
        var a2=steps[i3], b2=steps[i3-1];
        var nowStep=b2.y? a2.y/b2.y*100 : null;
        var pvStep =b2.py? a2.py/b2.py*100 : null;
        if(nowStep==null||pvStep==null) continue;
        conts.push({n:a2.n, now:nowStep, pv:pvStep, d:nowStep-pvStep});
      }
      conts.sort(function(x,y2){ return Math.abs(y2.d)-Math.abs(x.d); });

      var body=el('div','fs-body');
      if(conts.length){
        var top=conts[0];
        var p1=el('p','fs-p');
        p1.appendChild(document.createTextNode('가장 크게 달라진 공정은 '));
        p1.appendChild(el('b',null,top.n));
        p1.appendChild(document.createTextNode('입니다. 직전 단계 대비 수율이 '));
        p1.appendChild(el('b','n'+(top.d>0?' up':' dn'), top.pv.toFixed(1)+'% → '+top.now.toFixed(1)+'%'));
        p1.appendChild(document.createTextNode('로 '+(top.d>0?'올랐':'내렸')+'습니다.'));
        body.appendChild(p1);
      }
      var ul=el('ul','fs-list');
      conts.forEach(function(c2){
        var li=el('li');
        li.appendChild(el('span','fs-n',c2.n));
        li.appendChild(el('span','fs-d'+(Math.abs(c2.d)<0.05?'':(c2.d>0?' up':' dn')),
              (c2.d>=0?'▲ ':'▼ ')+Math.abs(c2.d).toFixed(1)+'%p'));
        li.appendChild(el('span','fs-sub',c2.pv.toFixed(1)+'% → '+c2.now.toFixed(1)+'%'));
        ul.appendChild(li);
      });
      body.appendChild(ul);

      /* 같은 원육을 썼다면 얼마나 더 나왔을까 */
      var extra=cur.rmKg*(gapY/100);
      var p2b=el('p','fs-p muted');
      p2b.appendChild(document.createTextNode('이번 달 원육 '+f(cur.rmKg,0)+'kg 기준으로, 전월 수율이었다면 완제품이 '));
      p2b.appendChild(el('b',null,f(Math.abs(extra),0)+'kg'));
      p2b.appendChild(document.createTextNode(extra>0?' 적게 나왔을 값입니다.':' 더 나왔을 값입니다.'));
      body.appendChild(p2b);
      side.appendChild(body);
    } else {
      side.appendChild(el('div','fs-none','전월 자료가 없어 비교하지 않습니다.'));
    }

    var wrap2=el('div','fwrap');
    wrap2.appendChild(fsc); wrap2.appendChild(side);
    flow.appendChild(wrap2);
    k.appendChild(flow);

    /* 2) 일별 최종수율 추이 */
    var byDay={};
    cur.rows.forEach(function(r){
      if(!r._first||!r.rmKg) return;
      var x=byDay[r.date]=byDay[r.date]||{rm:0,meat:0};
      x.rm+=r.rmKg; x.meat+=r._grpMeat||r.meatKg;
    });
    var days=Object.keys(byDay).sort();
    var pts=days.map(function(d){ return {d:d, v:byDay[d].rm? byDay[d].meat/byDay[d].rm*100 : null}; })
                .filter(function(x){ return x.v!=null; });
    if(pts.length>1){
      var avg=cur.rmKg? cur.meatKg/cur.rmKg*100 : 0;
      var pavg=(pSame&&pSame.rmKg)? pSame.meatKg/pSame.rmKg*100 : null;
      var TARGET=st.target, RISK=st.risk;
      var all=pts.map(function(x){return x.v;}).concat([avg,TARGET,RISK]);
      if(pavg!=null) all.push(pavg);
      var lo=Math.floor((Math.min.apply(null,all)-2)/2)*2;
      var hi=Math.ceil((Math.max.apply(null,all)+2)/2)*2;

      var ch=el('div','chart big');
      var chd=el('div','chart-hd');
      chd.appendChild(el('b',null,'일별 최종수율'));
      chd.appendChild(el('span','erp',pts.length+'일 · 평균 '+avg.toFixed(1)+'%'
        +(pavg!=null?' · 전월 '+pavg.toFixed(1)+'%':'')));
      ch.appendChild(chd);

      var lg=el('div','lgd');
      [['이번달 수율','d-nm'],['이번달 평균','d-avg'],
       (pavg!=null?['전월 일평균','d-pavg']:null),
       ['목표 '+TARGET+'%','d-hi'],['위험 '+RISK+'%','d-lo']]
        .filter(Boolean).forEach(function(x){
          var i2=el('span','lgd-i');
          i2.appendChild(el('span','lgd-m '+x[1]));
          i2.appendChild(document.createTextNode(x[0]));
          lg.appendChild(i2);
        });
      ch.appendChild(lg);

      /* 좌표계: 실좌표 사용(왜곡 없음) */
      var PL=46, PR=62, PT2=18, PB2=44;
      var w=Math.max(pts.length*72+PL+PR, 760), h=300;
      function X(i){ return PL + (pts.length<2?0:(i/(pts.length-1))*(w-PL-PR)); }
      function Y(v){ return PT2 + (hi-v)/(hi-lo)*(h-PT2-PB2); }
      var svg=svgEl('svg',{viewBox:'0 0 '+w+' '+h,'class':'g2'});
      svg.setAttribute('width',w);

      /* y 격자 + 눈금 */
      for(var g2=lo; g2<=hi; g2+=2){
        svg.appendChild(svgEl('line',{x1:PL,x2:w-PR,y1:Y(g2),y2:Y(g2),'class':'g-grid'}));
        var yl=svgEl('text',{x:PL-8,y:Y(g2)+3.5,'class':'g-ylab'});
        yl.textContent=g2+'%'; svg.appendChild(yl);
      }
      /* 기준선 */
      function refLine(v,cls,lab){
        if(v==null) return;
        svg.appendChild(svgEl('line',{x1:PL,x2:w-PR,y1:Y(v),y2:Y(v),'class':'g-ref '+cls}));
        var t2=svgEl('text',{x:w-PR+6,y:Y(v)+3.5,'class':'g-reflab '+cls});
        t2.textContent=lab; svg.appendChild(t2);
      }
      refLine(TARGET,'r-hi',TARGET+'%');
      refLine(RISK,'r-lo',RISK+'%');
      refLine(avg,'r-avg',avg.toFixed(1)+'%');
      refLine(pavg,'r-pavg',pavg==null?'':pavg.toFixed(1)+'%');

      /* 선 */
      var d2=pts.map(function(p2,i){ return (i?'L':'M')+X(i).toFixed(1)+' '+Y(p2.v).toFixed(1); }).join(' ');
      svg.appendChild(svgEl('path',{d:d2,'class':'g-line'}));

      /* 점 + 라벨 */
      pts.forEach(function(p2,i){
        var cls = p2.v>=TARGET?'d-hi' : (p2.v<RISK?'d-lo' : (p2.v<avg?'d-mid':'d-nm'));
        var cx=X(i), cy=Y(p2.v);
        svg.appendChild(svgEl('circle',{cx:cx,cy:cy,r:6,'class':'g-halo '+cls}));
        var c=svgEl('circle',{cx:cx,cy:cy,r:4.2,'class':'g-dot '+cls});
        var ti=svgEl('title'); ti.textContent=p2.d+' · '+p2.v.toFixed(1)+'%';
        c.appendChild(ti); svg.appendChild(c);
        var up=(i>0 && pts[i-1].v>p2.v) || i===0;
        var ly=up? cy+22 : cy-14;
        var g3=svgEl('g',{'class':'g-lab '+cls});
        g3.appendChild(svgEl('rect',{x:cx-22,y:ly-11,width:44,height:16,rx:4,'class':'g-labbg'}));
        var tx=svgEl('text',{x:cx,y:ly+1,'class':'g-labtx'});
        tx.textContent=p2.v.toFixed(1)+'%';
        g3.appendChild(tx); svg.appendChild(g3);
        /* x축 */
        var x1=svgEl('text',{x:cx,y:h-24,'class':'g-xlab'}); x1.textContent=(i+1)+'일차';
        svg.appendChild(x1);
        var x2=svgEl('text',{x:cx,y:h-11,'class':'g-xlab2'}); x2.textContent=p2.d.slice(5);
        svg.appendChild(x2);
      });
      var sc=el('div','gscroll'); sc.appendChild(svg);
      ch.appendChild(sc);
      k.appendChild(ch);
    }

    /* 3) 전월 대비는 수율만 */
    function y(x,key){return x&&x.rmKg?x[key]/x.rmKg*100:null;}
    var cmp=el('div','ycmp');
    var ch2=el('div','ycmp-hd');
    ch2.appendChild(el('b',null,'전월 대비 수율'));
    ch2.appendChild(el('span','erp','전월 같은 일차('+upto+'일차)까지 잘라 비교'
      +(lastY?'':' · 전년 자료 없음')));
    cmp.appendChild(ch2);
    var g=el('div','ycmp-g');
    [['전처리','ppKg'],['자숙','ckKg'],['파쇄','shKg'],['최종','meatKg']].forEach(function(x){
      var a=y(cur,x[1]), b=y(pSame,x[1]), c2=y(lastY,x[1]);
      var d=el('div','ycmp-c');
      d.appendChild(el('div','ycmp-k',x[0]+' 수율'));
      d.appendChild(el('div','ycmp-v',a==null?'—':a.toFixed(1)+'%'));
      function line(lab,base){
        if(base==null||a==null) return;
        var diff=a-base;
        var r=el('div','ycmp-d');
        r.appendChild(el('span','cmp-t',lab));
        r.appendChild(el('span','cmp-n'+(Math.abs(diff)<0.05?'':(diff>0?' up':' dn')),
          (diff>=0?'▲ ':'▼ ')+Math.abs(diff).toFixed(1)+'%p'));
        r.appendChild(el('span','erp',base.toFixed(1)+'%'));
        d.appendChild(r);
      }
      line('전월',b); if(lastY) line('전년',c2);
      g.appendChild(d);
    });
    cmp.appendChild(g);
    k.appendChild(cmp);
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
    var p=el('button','fchip','◀'); p.addEventListener('click',function(){shift(-1);st.page=1;reload();});
    var i=el('input','search'); i.type='month'; i.value=st.ym;
    i.addEventListener('change',function(){ if(i.value){st.ym=i.value;st.page=1;reload();} });
    var n=el('button','fchip','▶'); n.addEventListener('click',function(){shift(1);st.page=1;reload();});
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
    WRAP.appendChild(compare(st.ym,CACHE.cur,CACHE.pSame,CACHE.pAll,CACHE.upto,CACHE.lastY,CACHE.lastYm));
  }
  function reload(){
    CACHE=null; WRAP.innerHTML=''; WRAP.appendChild(bar());
    var body=el('div'); body.appendChild(el('div','empty','불러오는 중…')); WRAP.appendChild(body);
    var lastYm=(+st.ym.slice(0,4)-1)+'-'+st.ym.slice(5,7);
    Promise.all([loadMonth(st.ym),loadMonth(prevYm(st.ym)),loadMonth(lastYm)]).then(function(a){
      var cur=build(a[0]);
      var upto=0; cur.rows.forEach(function(r){ upto=Math.max(upto,+r.date.slice(8,10)); });
      if(!upto) upto=lastDay(st.ym);
      var days={}; cur.rows.forEach(function(r){days[r.date]=1;});
      var dayIdx=Object.keys(days).length||1;
      var lastY=build(a[2]);
      CACHE={cur:cur, pSame:build(a[1],uptoNth(a[1],dayIdx)), pAll:build(a[1]),
             lastY: lastY.rows.length? lastY : null, lastYm:lastYm, upto:dayIdx};
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
