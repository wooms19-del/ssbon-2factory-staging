/* 생산계획.
   기존 엑셀 캘린더를 그대로 옮긴다.
   ea / kg / pk 중 아무 칸에나 넣으면 나머지가 자동으로 채워진다.
     kg = ea × 개당원육g ÷ 1000 ÷ 수율
     pk = ea ÷ 팩입수
   수율은 설정에서 바꿀 수 있다. 기본 50%.
   부위는 예정값이며 비워둘 수 있다. 실제 부위는 생산 때 공정 기록으로 정해진다. */
(function(){
  window.SSBON = window.SSBON || {};
  var cfg=null;
  var PARTN={1:'홍두깨',2:'설도',3:'우둔'};
  var st={ym:null, items:null, plans:null, yield:0.5, edit:null};

  function el(t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;return n;}
  function f(n,d){return (n==null||isNaN(n))?'':Number(n).toLocaleString('ko-KR',{minimumFractionDigits:d||0,maximumFractionDigits:d||0});}
  function api(path,opt){
    opt=opt||{};
    var h={apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey,'Content-Type':'application/json'};
    if(opt.prefer) h.Prefer=opt.prefer;
    return fetch(cfg.restUrl+'/'+path,{method:opt.method||'GET',headers:h,body:opt.body?JSON.stringify(opt.body):undefined})
      .then(function(r){
        if(!r.ok) return r.text().then(function(t){throw new Error(r.status+' '+t);});
        return r.status===204?null:r.json().catch(function(){return null;});
      });
  }
  function lastDay(ym){return new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate();}
  function ymd(ym,d){return ym+'-'+String(d).padStart(2,'0');}

  /* ── 환산 ── */
  function conv(g, src, val){
    var out={ea:null,kg:null,pk:null};
    var gw=g.unit_weight_g, pk=g.ea_per_pack;
    val=parseFloat(val);
    if(!val||val<=0) return out;
    if(src==='ea') out.ea=Math.round(val);
    else if(src==='kg') out.ea = gw? Math.round(val*st.yield*1000/gw) : null;
    else if(src==='pk') out.ea = pk? Math.round(val*pk) : null;
    if(out.ea!=null){
      out.kg = gw? Math.round(out.ea*gw/1000/st.yield*100)/100 : null;
      out.pk = pk? Math.round(out.ea/pk) : null;
    }
    if(src==='kg') out.kg=Math.round(val*100)/100;
    if(src==='pk') out.pk=Math.round(val);
    return out;
  }

  function load(){
    var a=st.ym+'-01', b=ymd(st.ym,lastDay(st.ym));
    var P=[api('production_plan?select=*&plan_date=gte.'+a+'&plan_date=lte.'+b+'&order=plan_date')];
    if(!st.items) P.push(api('item_master?select=product_group,unit_weight_g,ea_per_pack,ea_per_box,no_meat&category=eq.완제품'));
    return Promise.all(P).then(function(r){
      st.plans=r[0];
      if(r[1]){
        var m={};
        r[1].forEach(function(i){ if(!m[i.product_group]) m[i.product_group]=i; });
        st.items=m;
      }
    });
  }

  /* ── 캘린더 ── */
  function calendar(){
    var k=el('div','card');
    var last=lastDay(st.ym);
    var first=new Date(+st.ym.slice(0,4),+st.ym.slice(5,7)-1,1).getDay();
    var byDate={};
    st.plans.forEach(function(p){ (byDate[p.plan_date]=byDate[p.plan_date]||[]).push(p); });

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
    for(var d=1;d<=last;d++){
      if(col===7){ tb.appendChild(row); row=el('tr'); col=0; }
      var date=ymd(st.ym,d);
      var td=el('td','day');
      var head=el('div','day-n',String(d));
      if(col===0) head.className+=' sun'; if(col===6) head.className+=' sat';
      td.appendChild(head);
      (byDate[date]||[]).forEach(function(p){
        var b=el('div','plan');
        b.appendChild(el('div','plan-p',p.product_group));
        if(p.plan_kg!=null) b.appendChild(el('div','plan-kg',f(p.plan_kg,0)+'kg'));
        if(p.plan_ea!=null) b.appendChild(el('div','plan-ea',f(p.plan_ea)+'ea'));
        if(p.plan_pk!=null) b.appendChild(el('div','plan-pk',f(p.plan_pk)+'pk'));
        if(p.part_id) b.appendChild(el('span','badge g-'+PARTN[p.part_id],PARTN[p.part_id]));
        b.addEventListener('click',function(e){ e.stopPropagation(); open(date,p); });
        td.appendChild(b);
      });
      var add=el('button','day-add','+');
      add.title='계획 추가';
      (function(dd){ add.addEventListener('click',function(e){ e.stopPropagation(); open(dd,null); }); })(date);
      td.appendChild(add);
      row.appendChild(td); col++;
    }
    while(col<7){ row.appendChild(el('td','off')); col++; }
    tb.appendChild(row); t.appendChild(tb);
    k.appendChild(t);
    return k;
  }

  /* ── 입력 폼 ── */
  function open(date, plan){
    st.edit={date:date, plan:plan};
    redraw();
  }
  function form(){
    var e=st.edit;
    if(!e) return null;
    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null, e.plan?'계획 수정':'계획 추가'));
    k.appendChild(el('p','sub-t', e.date+' · ea·kg·pk 중 아무 칸에나 넣으면 나머지가 채워집니다. 수율 '+(st.yield*100).toFixed(0)+'% 기준입니다.'));

    var r1=el('div','frow');
    var sel=el('select','search');
    Object.keys(st.items).sort().forEach(function(g){
      var o=el('option',null,g); o.value=g;
      if(e.plan&&e.plan.product_group===g) o.selected=true;
      sel.appendChild(o);
    });
    var psel=el('select','search');
    psel.appendChild(el('option','','부위 미정'));
    [1,2,3].forEach(function(i){
      var o=el('option',null,PARTN[i]); o.value=i;
      if(e.plan&&e.plan.part_id===i) o.selected=true;
      psel.appendChild(o);
    });
    r1.appendChild(sel); r1.appendChild(psel); k.appendChild(r1);

    var r2=el('div','frow');
    function num(ph,val){
      var i=el('input','search'); i.type='number'; i.min='0'; i.placeholder=ph;
      if(val!=null) i.value=val;
      i.style.minWidth='120px';
      return i;
    }
    var iea=num('EA', e.plan&&e.plan.plan_ea);
    var ikg=num('KG', e.plan&&e.plan.plan_kg);
    var ipk=num('PK', e.plan&&e.plan.plan_pk);
    var hint=el('span','erp');
    function sync(src,inp){
      var g=st.items[sel.value]||{};
      var o=conv(g,src,inp.value);
      if(src!=='ea') iea.value=o.ea==null?'':o.ea;
      if(src!=='kg') ikg.value=o.kg==null?'':o.kg;
      if(src!=='pk') ipk.value=o.pk==null?'':o.pk;
      hint.textContent = g.unit_weight_g
        ? '개당 원육 '+g.unit_weight_g+'g'+(g.ea_per_pack?' · '+g.ea_per_pack+'입/팩':' · 팩 기준 없음')
        : '개당 원육 기준이 없어 kg 환산이 안 됩니다.';
    }
    iea.addEventListener('input',function(){sync('ea',iea);});
    ikg.addEventListener('input',function(){sync('kg',ikg);});
    ipk.addEventListener('input',function(){sync('pk',ipk);});
    sel.addEventListener('change',function(){ if(iea.value) sync('ea',iea); else sync('ea',{value:''}); });
    r2.appendChild(iea); r2.appendChild(ikg); r2.appendChild(ipk); r2.appendChild(hint);
    k.appendChild(r2);
    sync('ea',iea);

    var r3=el('div','frow');
    var save=el('button','fchip on', e.plan?'수정':'추가');
    save.addEventListener('click',function(){
      var body={plan_date:e.date, product_group:sel.value,
        part_id: psel.value?parseInt(psel.value,10):null,
        plan_ea: iea.value?parseInt(iea.value,10):null,
        plan_kg: ikg.value?parseFloat(ikg.value):null,
        plan_pk: ipk.value?parseInt(ipk.value,10):null,
        updated_at: new Date().toISOString()};
      save.disabled=true; save.textContent='저장 중…';
      api('production_plan?on_conflict=plan_date,product_group',
          {method:'POST',body:[body],prefer:'resolution=merge-duplicates,return=minimal'})
        .then(function(){ st.edit=null; return load(); })
        .then(redraw)
        .catch(function(err){ save.disabled=false; save.textContent='저장 실패'; alert('저장하지 못했습니다.\n'+err.message); });
    });
    var cancel=el('button','fchip','닫기');
    cancel.addEventListener('click',function(){ st.edit=null; redraw(); });
    r3.appendChild(save); r3.appendChild(cancel);
    if(e.plan){
      var del=el('button','fchip','삭제');
      del.style.color='#B4342C';
      del.addEventListener('click',function(){
        if(!confirm(e.date+' '+e.plan.product_group+' 계획을 지울까요?')) return;
        api('production_plan?plan_id=eq.'+e.plan.plan_id,{method:'DELETE',prefer:'return=minimal'})
          .then(function(){ st.edit=null; return load(); }).then(redraw)
          .catch(function(err){ alert('삭제하지 못했습니다.\n'+err.message); });
      });
      r3.appendChild(del);
    }
    k.appendChild(r3);
    return k;
  }

  /* ── 월 합계 ── */
  function total(){
    var k=el('div','card');
    k.appendChild(el('h2',null,'월 계획 합계'));
    var byP={}, ea=0, kg=0;
    st.plans.forEach(function(p){
      var g=byP[p.product_group]=byP[p.product_group]||{ea:0,kg:0,days:0};
      g.ea+=p.plan_ea||0; g.kg+=parseFloat(p.plan_kg)||0; g.days++;
      ea+=p.plan_ea||0; kg+=parseFloat(p.plan_kg)||0;
    });
    var names=Object.keys(byP).sort(function(a,b){return byP[b].ea-byP[a].ea;});
    if(!names.length){ k.appendChild(el('div','tb','이 달에는 계획이 없습니다. 날짜의 + 를 눌러 추가하십시오.')); return k; }
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th>제품</th><th class="num" style="width:76px">일수</th>'+
      '<th class="num" style="width:104px">EA</th><th class="num" style="width:116px">원육 KG</th></tr></thead>';
    var tb=el('tbody');
    names.forEach(function(n){
      var g=byP[n], tr=el('tr');
      tr.appendChild(el('td','nm',n));
      tr.appendChild(el('td','num',g.days+'일'));
      tr.appendChild(el('td','num',f(g.ea)));
      tr.appendChild(el('td','num',f(g.kg,1)));
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);
    var st2=el('div','stat-grid');
    [['총 EA',f(ea)+' EA'],['총 원육',f(kg,1)+' kg'],
     ['계획일수',Object.keys(st.plans.reduce(function(a,p){a[p.plan_date]=1;return a;},{})).length+'일'],
     ['적용 수율',(st.yield*100).toFixed(0)+'%']
    ].forEach(function(x){
      var s=el('div','stat'); s.appendChild(el('div','k',x[0])); s.appendChild(el('div','v',x[1])); st2.appendChild(s);
    });
    k.appendChild(st2);
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
    var p=el('button','fchip','◀'); p.addEventListener('click',function(){shift(-1);reload();});
    var i=el('input','search'); i.type='month'; i.value=st.ym;
    i.addEventListener('change',function(){ if(i.value){st.ym=i.value;reload();} });
    var n=el('button','fchip','▶'); n.addEventListener('click',function(){shift(1);reload();});
    b.appendChild(p); b.appendChild(i); b.appendChild(n);
    var y=el('select','search');
    [40,45,50,55,60].forEach(function(v){
      var o=el('option',null,'수율 '+v+'%'); o.value=v/100;
      if(Math.abs(st.yield-v/100)<0.001) o.selected=true;
      y.appendChild(o);
    });
    y.addEventListener('change',function(){ st.yield=parseFloat(y.value); redraw(); });
    b.appendChild(y);
    return b;
  }
  function redraw(){
    WRAP.innerHTML='';
    WRAP.appendChild(bar());
    var fm=form(); if(fm) WRAP.appendChild(fm);
    WRAP.appendChild(calendar());
    WRAP.appendChild(total());
  }
  function reload(){
    WRAP.innerHTML=''; WRAP.appendChild(el('div','empty','불러오는 중…'));
    load().then(redraw).catch(function(e){
      WRAP.innerHTML='';
      var k=el('div','card'); k.appendChild(el('h2',null,'불러오지 못했습니다.'));
      k.appendChild(el('p','sub-t',String(e.message||e))); WRAP.appendChild(k);
    });
  }

  window.SSBON.views=window.SSBON.views||{};
  window.SSBON.views.plan_input=function(c){
    cfg=window.SSBON.config;
    WRAP=el('div'); c.appendChild(WRAP);
    if(!st.ym) st.ym=new Date().toISOString().slice(0,7);
    st.edit=null;
    reload();
  };
})();
