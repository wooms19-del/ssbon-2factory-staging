(function(){
  var A=window.SSBON.auth, NAV=window.SSBON.nav, api=window.SSBON.api,
      cfg=window.SSBON.config, ICON=window.SSBON.icons;
  var $=function(id){ return document.getElementById(id); };
  function el(t,c,x){ var n=document.createElement(t); if(c)n.className=c; if(x!=null)n.textContent=x; return n; }

  var MODE={}, PAGE={};
  NAV.forEach(function(m){ MODE[m.id]=m; m.items.forEach(function(p){ PAGE[p.id]={mode:m,page:p}; }); });
  var cur={mode:null,page:null};

  /* ── 로그인 ──────────────────────────── */
  function bindLogin(){
    $('loginForm').addEventListener('submit',function(e){
      e.preventDefault();
      var id=$('loginId').value.trim(), pw=$('loginPw').value;
      if(!id||!pw){ msg('아이디와 비밀번호를 모두 입력해 주세요.',1); return; }
      A.verify(id,pw).then(function(s){ A.setSession(s,$('loginKeep').checked); enter(); })
       .catch(function(err){
         msg(err&&err.message==='NO_BACKEND'
           ? '계정 저장소가 아직 연결되지 않아 로그인할 수 없습니다. 아래 버튼으로 화면만 둘러볼 수 있습니다.'
           : '로그인하지 못했습니다. '+(err&&err.message||''),1);
       });
    });
    $('reviewBtn').addEventListener('click',function(){ A.setSession(A.reviewSession(),false); enter(); });
  }
  function msg(t,bad){ var b=$('loginMsg'); b.textContent=t; b.className='notice'+(bad?' error':''); b.hidden=false; }

  /* ── 레일 ────────────────────────────── */
  function renderRail(role){
    var r=$('rail');
    NAV.forEach(function(m){
      if(m.admin&&role!=='admin') return;
      var b=el('button','rbtn'); b.type='button'; b.dataset.mode=m.id;
      b.innerHTML='<svg viewBox="0 0 24 24">'+(ICON[m.icon]||'')+'</svg>';
      b.appendChild(el('span',null,m.label));
      b.addEventListener('click',function(){ go(m.items[0].id); });
      r.appendChild(b);
    });
  }

  /* ── 서브패널 ────────────────────────── */
  function renderSub(m){
    $('subTitle').textContent=m.title;
    $('subDesc').textContent=m.flow?'공정 순서':(m.items.length+'개 화면');
    var ul=$('subList');
    ul.className='sub-list'+(m.flow?' flow':'');
    ul.innerHTML='';
    m.items.forEach(function(p){
      var li=el('li',p.trib?'tr':''); li.dataset.page=p.id;
      if(m.flow) li.appendChild(el('span','node'));
      var a=el('a'); a.href='#'+p.id;
      var l1=el('div');
      l1.appendChild(el('span','nm',p.label));
      if(p.note) l1.appendChild(el('span','st',p.note));
      a.appendChild(l1);
      li.appendChild(a); ul.appendChild(li);
    });
  }
  function markActive(){
    Array.prototype.forEach.call($('rail').querySelectorAll('.rbtn'),function(b){
      b.classList.toggle('on', b.dataset.mode===cur.mode.id);
    });
    Array.prototype.forEach.call($('subList').querySelectorAll('li'),function(li){
      li.classList.toggle('on', li.dataset.page===cur.page.id);
    });
  }

  /* ── 라우팅 ──────────────────────────── */
  function go(pageId){
    if(location.hash!=='#'+pageId){ location.hash=pageId; return; }
    render(pageId);
  }
  function allowed(id){
    var e=PAGE[id];
    if(!e) return false;
    return !(e.mode.admin && A.session.role!=='admin');
  }
  function render(id){
    if(!allowed(id)) id = (A.session.role==='admin') ? 'plan_input' : 'thaw_rf';
    var e=PAGE[id];
    if(cur.mode!==e.mode){ cur.mode=e.mode; renderSub(e.mode); }
    cur.page=e.page;
    markActive();
    $('crumb').textContent=e.mode.title;
    $('pageTitle').textContent=e.page.label;
    var c=$('content'); c.innerHTML='';
    (VIEW[id]||pending)(c,e.page);
    document.body.classList.remove('nav-open');
  }

  /* ── 기본: 준비 중 ───────────────────── */
  function pending(c,p){
    var k=el('div','card pending');
    k.appendChild(el('h2',null,p.label+' 화면은 아직 만들지 않았습니다.'));
    k.appendChild(el('p','sub-t','메뉴 자리만 잡아 둔 상태입니다.'));
    if(p.tables.length) k.appendChild(el('div','tb','연결 예정 테이블 · '+p.tables.join(', ')));
    else k.appendChild(el('div','tb','아직 테이블이 없습니다. 설계부터 필요합니다.'));
    c.appendChild(k);
  }

  /* ── 품목 마스터 ─────────────────────── */
  var CACHE={items:null,bom:null}, mwrap=null;
  var CATS=['완제품','반제품','소스','공정중간','원육','원료부자재','파우치','포장재'];
  var ui={cat:'완제품',q:'',sel:null};

  var loading=null;
  function loadMaster(){
    if(CACHE.items) return Promise.resolve();
    if(loading) return loading;
    loading = Promise.all([
      api.select('item_master',{select:'item_id,erp_code,name,category,part,unit,product_group',order:'erp_code'}),
      api.select('item_bom',{select:'parent_id,child_id,qty,unit',limit:1000})
    ]).then(function(r){ CACHE.items=r[0]; CACHE.bom=r[1]; loading=null; })
      .catch(function(e){ loading=null; throw e; });
    return loading;
  }

  function viewItemMaster(c){
    var wrap=el('div');
    wrap.appendChild(el('div','empty','불러오는 중…'));
    c.appendChild(wrap);
    mwrap=wrap;
    loadMaster().then(function(){ wrap.innerHTML=''; drawMaster(wrap); })
      .catch(function(e){
        wrap.innerHTML='';
        var k=el('div','card'); k.appendChild(el('h2',null,'품목을 불러오지 못했습니다.'));
        k.appendChild(el('p','sub-t',String(e.message||e))); wrap.appendChild(k);
      });
  }

  function drawMaster(wrap){
    var byCat={};
    CACHE.items.forEach(function(i){ byCat[i.category]=(byCat[i.category]||0)+1; });

    var bar=el('div','chips');
    var all=el('button','fchip'+(ui.cat==='전체'?' on':''));
    all.appendChild(document.createTextNode('전체'));
    all.appendChild(el('span','n',String(CACHE.items.length)));
    all.addEventListener('click',function(){ ui.cat='전체'; ui.sel=null; redraw(wrap); });
    bar.appendChild(all);
    CATS.forEach(function(k){
      if(!byCat[k]) return;
      var b=el('button','fchip'+(ui.cat===k?' on':''));
      b.appendChild(document.createTextNode(k));
      b.appendChild(el('span','n',String(byCat[k])));
      b.addEventListener('click',function(){ ui.cat=k; ui.sel=null; redraw(wrap); });
      bar.appendChild(b);
    });
    var s=el('input','search'); s.type='search'; s.placeholder='품명 또는 코드 검색'; s.value=ui.q;
    s.addEventListener('input',function(){ ui.q=s.value; redraw(wrap,true); });
    bar.appendChild(s);
    wrap.appendChild(bar);

    var split=el('div','split');
    split.appendChild(buildTable());
    split.appendChild(buildDetail());
    wrap.appendChild(split);
    if(s.value) s.focus();
  }
  function redraw(wrap,keepFocus){
    var pos=null;
    if(keepFocus){ var s=wrap.querySelector('.search'); pos=s?s.selectionStart:null; }
    wrap.innerHTML=''; drawMaster(wrap);
    if(keepFocus){ var n=wrap.querySelector('.search'); if(n){ n.focus(); if(pos!=null) n.setSelectionRange(pos,pos); } }
  }

  function rows(){
    var q=ui.q.trim().toLowerCase();
    return CACHE.items.filter(function(i){
      if(ui.cat!=='전체'&&i.category!==ui.cat) return false;
      if(!q) return true;
      return (i.name||'').toLowerCase().indexOf(q)>=0
          || (i.product_group||'').toLowerCase().indexOf(q)>=0
          || (i.erp_code||'').indexOf(q)>=0;
    });
  }

  function nameCell(i){
    var d=el('div');
    if(i.product_group){
      var t=el('div');
      t.appendChild(el('span','nm',i.product_group));
      if(i.part) t.appendChild(el('span','badge g-'+i.part,i.part));
      d.appendChild(t);
      d.appendChild(el('div','erp',i.name));
    } else {
      var t2=el('div');
      t2.appendChild(el('span','nm',i.name));
      if(i.part) t2.appendChild(el('span','badge g-'+i.part,i.part));
      d.appendChild(t2);
    }
    return d;
  }

  function buildTable(){
    var box=el('div');
    var list=rows();
    if(!list.length){ box.appendChild(el('div','card empty','해당하는 품목이 없습니다.')); return box; }
    var t=el('table','tbl');
    var th=el('thead');
    th.innerHTML='<tr><th style="width:86px">ERP 코드</th><th>품명</th><th style="width:78px">구분</th><th style="width:52px">단위</th><th style="width:64px" class="num">구성</th></tr>';
    t.appendChild(th);
    var tb=el('tbody');
    list.forEach(function(i){
      var n=CACHE.bom.filter(function(b){ return b.parent_id===i.item_id; }).length;
      var tr=el('tr'); if(ui.sel===i.item_id) tr.className='on';
      var c1=el('td','code',i.erp_code);
      var c2=el('td'); c2.appendChild(nameCell(i));
      var c3=el('td','cat',i.category||'');
      var c4=el('td','cat',i.unit||'');
      var c5=el('td','num', n?String(n):'—');
      [c1,c2,c3,c4,c5].forEach(function(x){ tr.appendChild(x); });
      tr.addEventListener('click',function(){
        ui.sel=(ui.sel===i.item_id)?null:i.item_id;
        redraw(mwrap);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb); box.appendChild(t);
    box.appendChild(el('div','erp','표시 '+list.length+'건'));
    return box;
  }

  function buildDetail(){
    var box=el('div');
    var k=el('div','card');
    if(ui.sel==null){
      k.appendChild(el('h2',null,'자재명세'));
      k.appendChild(el('p','sub-t','왼쪽에서 품목을 고르면 무엇이 얼마나 들어가는지 보여줍니다.'));
      box.appendChild(k); return box;
    }
    var it=CACHE.items.filter(function(i){ return i.item_id===ui.sel; })[0];
    var byId={}; CACHE.items.forEach(function(i){ byId[i.item_id]=i; });
    k.appendChild(el('h2',null,it.product_group||it.name));
    k.appendChild(el('p','sub-t',it.erp_code+' · '+(it.category||'')+' · '+(it.unit||'')));

    var kids=CACHE.bom.filter(function(b){ return b.parent_id===it.item_id; });
    if(!kids.length){
      k.appendChild(el('div','tb','구성품이 없습니다. 더 이상 풀리지 않는 품목입니다.'));
    } else {
      var t=el('table','tbl');
      t.innerHTML='<thead><tr><th>구성품</th><th class="num" style="width:96px">소요량</th></tr></thead>';
      var tb=el('tbody');
      kids.sort(function(a,b){ return b.qty-a.qty; }).forEach(function(b){
        var ch=byId[b.child_id]||{name:'?'};
        var tr=el('tr');
        var c1=el('td');
        c1.appendChild(el('div','nm',ch.product_group||ch.name));
        c1.appendChild(el('div','erp',ch.erp_code+' · '+(ch.category||'')));
        var c2=el('td','num',trim(b.qty)+' '+(b.unit||''));
        tr.appendChild(c1); tr.appendChild(c2);
        tr.addEventListener('click',function(){ ui.sel=b.child_id; redraw(mwrap); });
        tb.appendChild(tr);
      });
      t.appendChild(tb); k.appendChild(t);
    }
    var used=CACHE.bom.filter(function(b){ return b.child_id===it.item_id; });
    if(used.length){
      k.appendChild(el('div','erp','이 품목을 쓰는 곳 '+used.length+'건'));
    }
    box.appendChild(k); return box;
  }
  function trim(n){
    var v=parseFloat(n); if(isNaN(v)) return String(n);
    return String(parseFloat(v.toFixed(6)));
  }


  /* ── 다단계 전개 (공통) ─────────────── */
  function explode(rootId, qty){
    var acc={};
    (function walk(id,q,d){
      if(d>6) return;
      CACHE.bom.forEach(function(b){
        if(b.parent_id!==id) return;
        var cq=q*parseFloat(b.qty);
        acc[b.child_id]=(acc[b.child_id]||0)+cq;
        walk(b.child_id,cq,d+1);
      });
    })(rootId,qty,0);
    return acc;
  }
  function byId(){ var m={}; CACHE.items.forEach(function(i){ m[i.item_id]=i; }); return m; }
  function finished(){ return CACHE.items.filter(function(i){ return i.category==='완제품'; }); }
  function label(i){ return (i.product_group||i.name)+(i.part?' ('+i.part+')':''); }

  function withMaster(c, fn){
    var wrap=el('div');
    wrap.appendChild(el('div','empty','불러오는 중…'));
    c.appendChild(wrap); mwrap=wrap;
    loadMaster().then(function(){ wrap.innerHTML=''; fn(wrap); })
      .catch(function(e){
        wrap.innerHTML='';
        var k=el('div','card');
        k.appendChild(el('h2',null,'불러오지 못했습니다.'));
        k.appendChild(el('p','sub-t',String(e.message||e)));
        wrap.appendChild(k);
      });
  }

  function qtyTable(head, list, m){
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th style="width:86px">코드</th><th>'+head+'</th>'+
      '<th style="width:78px">구분</th><th class="num" style="width:120px">소요량</th></tr></thead>';
    var tb=el('tbody');
    list.forEach(function(r){
      var i=m[r.id]; if(!i) return;
      var tr=el('tr');
      var c1=el('td','code',i.erp_code);
      var c2=el('td'); c2.appendChild(el('div','nm',i.product_group||i.name));
      if(i.name!==(i.product_group||i.name)) c2.appendChild(el('div','erp',i.name));
      var c3=el('td','cat',i.category||'');
      var c4=el('td','num',trim(r.q)+' '+(i.unit||''));
      [c1,c2,c3,c4].forEach(function(x){ tr.appendChild(x); });
      tb.appendChild(tr);
    });
    t.appendChild(tb); return t;
  }

  /* ── 자재명세 (다단계 트리) ─────────── */
  var bomSel=null;
  function viewBom(c){ withMaster(c, drawBom); }
  function drawBom(w){
    var fin=finished();
    if(bomSel==null&&fin.length) bomSel=fin[0].item_id;
    var bar=el('div','chips');
    var sel=el('select','search');
    fin.forEach(function(i){
      var o=el('option',null,label(i)); o.value=i.item_id;
      if(i.item_id===bomSel) o.selected=true; sel.appendChild(o);
    });
    sel.addEventListener('change',function(){ bomSel=parseInt(sel.value,10); redrawWith(w,drawBom); });
    bar.appendChild(sel); w.appendChild(bar);

    var m=byId(), root=m[bomSel];
    var k=el('div','card');
    k.appendChild(el('h2',null,label(root)+' 1'+(root.unit||'EA')+' 기준'));
    k.appendChild(el('p','sub-t',root.erp_code+' · '+root.name));
    var t=el('table','tbl');
    t.innerHTML='<thead><tr><th>구성</th><th style="width:78px">구분</th><th class="num" style="width:130px">소요량</th></tr></thead>';
    var tb=el('tbody'), n=0;
    (function walk(id,q,d){
      if(d>5) return;
      CACHE.bom.filter(function(b){ return b.parent_id===id; })
        .sort(function(a,b){ return b.qty-a.qty; })
        .forEach(function(b){
          var ch=m[b.child_id]; if(!ch) return;
          var cq=q*parseFloat(b.qty); n++;
          var tr=el('tr');
          var c1=el('td');
          var line=el('div');
          line.appendChild(el('span','lvl','└'.padStart(d+1,'　')));
          line.appendChild(el('span','nm',ch.product_group||ch.name));
          c1.appendChild(line);
          c1.appendChild(el('div','erp',ch.erp_code+' · '+ch.name));
          var c2=el('td','cat',ch.category||'');
          var c3=el('td','num',trim(cq)+' '+(b.unit||''));
          [c1,c2,c3].forEach(function(x){ tr.appendChild(x); });
          tb.appendChild(tr);
          walk(b.child_id,cq,d+1);
        });
    })(bomSel,1,0);
    t.appendChild(tb); k.appendChild(t);
    k.appendChild(el('div','erp','펼친 줄 '+n+'개'));
    w.appendChild(k);
  }
  function redrawWith(w,fn){ w.innerHTML=''; fn(w); }

  /* ── 소요량 확인 ─────────────────────── */
  var plan=[];
  function viewNeed(c){ withMaster(c, drawNeed); }
  function drawNeed(w){
    var fin=finished(), m=byId();

    var k=el('div','card');
    k.appendChild(el('h2',null,'생산계획을 넣으면 필요한 자재가 나옵니다.'));
    k.appendChild(el('p','sub-t','품목 마스터의 자재명세를 끝까지 펼쳐 합산합니다. 소스는 원재료까지 내려갑니다.'));

    var row=el('div','chips');
    var sel=el('select','search');
    fin.forEach(function(i){ var o=el('option',null,label(i)); o.value=i.item_id; sel.appendChild(o); });
    var qty=el('input','search'); qty.type='number'; qty.min='1'; qty.value='1000';
    qty.style.minWidth='120px';
    var add=el('button','fchip on','계획에 추가');
    add.addEventListener('click',function(){
      var q=parseFloat(qty.value); if(!q||q<=0) return;
      plan.push({id:parseInt(sel.value,10), q:q});
      redrawWith(w,drawNeed);
    });
    row.appendChild(sel); row.appendChild(qty); row.appendChild(add);
    k.appendChild(row);
    w.appendChild(k);

    if(!plan.length){
      var e0=el('div','card pending');
      e0.appendChild(el('div','tb','계획이 비어 있습니다. 위에서 제품과 수량을 넣어 보십시오.'));
      w.appendChild(e0); return;
    }

    var pk=el('div','card');
    pk.appendChild(el('h2',null,'계획'));
    var pt=el('table','tbl');
    pt.innerHTML='<thead><tr><th>제품</th><th class="num" style="width:110px">수량</th><th style="width:56px"></th></tr></thead>';
    var ptb=el('tbody');
    plan.forEach(function(r,idx){
      var i=m[r.id], tr=el('tr');
      var c1=el('td'); c1.appendChild(el('div','nm',label(i)));
      c1.appendChild(el('div','erp',i.erp_code));
      var c2=el('td','num',r.q.toLocaleString('ko-KR')+' '+(i.unit||'EA'));
      var c3=el('td');
      var del=el('button','fchip','삭제');
      del.addEventListener('click',function(){ plan.splice(idx,1); redrawWith(w,drawNeed); });
      c3.appendChild(del);
      [c1,c2,c3].forEach(function(x){ tr.appendChild(x); });
      ptb.appendChild(tr);
    });
    pt.appendChild(ptb); pk.appendChild(pt); w.appendChild(pk);

    var acc={};
    plan.forEach(function(r){
      var e=explode(r.id,r.q);
      for(var id in e) acc[id]=(acc[id]||0)+e[id];
    });
    var buy=[], mid=[];
    for(var id in acc){
      var it=m[id]; if(!it) continue;
      var rec={id:parseInt(id,10), q:acc[id]};
      if(['원육','원료부자재','파우치','포장재'].indexOf(it.category)>=0) buy.push(rec);
      else mid.push(rec);
    }
    var order={'원육':0,'원료부자재':1,'파우치':2,'포장재':3};
    function rank(id){ var c=m[id].category; return (c in order)?order[c]:9; }
    buy.sort(function(a,b){
      var d=rank(a.id)-rank(b.id);
      return d!==0?d:b.q-a.q;
    });
    mid.sort(function(a,b){ return b.q-a.q; });

    var bk=el('div','card');
    bk.appendChild(el('h2',null,'필요한 자재 — 재고와 대조할 대상'));
    bk.appendChild(el('p','sub-t','원육과 소스 원재료, 포장 자재입니다. 재고 테이블이 생기면 여기에 보유량과 부족분이 붙습니다.'));
    bk.appendChild(qtyTable('품목',buy,m));
    w.appendChild(bk);

    var mk=el('div','card');
    mk.appendChild(el('h2',null,'중간 산출'));
    mk.appendChild(el('p','sub-t','공정을 거쳐 만들어지는 것들입니다. 사서 채우는 대상이 아닙니다.'));
    mk.appendChild(qtyTable('품목',mid,m));
    w.appendChild(mk);
  }

  /* ── 원육 부위·원산지 ────────────────── */
  function viewMeat(c){
    var wrap=el('div'); wrap.appendChild(el('div','empty','불러오는 중…')); c.appendChild(wrap);
    Promise.all([
      api.select('meat_part',{order:'part_id'}),
      api.select('origin',{order:'origin_id'})
    ]).then(function(r){
      wrap.innerHTML='';
      wrap.appendChild(simpleTable('원육 부위', r[0], ['part_id','name']));
      wrap.appendChild(simpleTable('원산지', r[1], ['origin_id','name']));
    }).catch(function(e){
      wrap.innerHTML='';
      var k=el('div','card'); k.appendChild(el('h2',null,'불러오지 못했습니다.'));
      k.appendChild(el('p','sub-t',String(e.message||e))); wrap.appendChild(k);
    });
  }
  function simpleTable(title, list, cols){
    var k=el('div','card'); k.style.marginBottom='14px';
    k.appendChild(el('h2',null,title));
    if(!list.length){ k.appendChild(el('div','tb','아직 등록된 자료가 없습니다.')); return k; }
    var keys=cols.filter(function(c){ return c in list[0]; });
    if(!keys.length) keys=Object.keys(list[0]);
    var t=el('table','tbl');
    var th=el('thead'), htr=el('tr');
    keys.forEach(function(c){ htr.appendChild(el('th',null,c)); });
    th.appendChild(htr); t.appendChild(th);
    var tb=el('tbody');
    list.forEach(function(r){
      var tr=el('tr');
      keys.forEach(function(c){ tr.appendChild(el('td', c.indexOf('id')>=0?'code':'', String(r[c]==null?'':r[c]))); });
      tb.appendChild(tr);
    });
    t.appendChild(tb); k.appendChild(t);
    k.appendChild(el('div','erp',list.length+'건'));
    return k;
  }

  /* ── 작업자 ─────────────────────────── */
  function viewWorker(c){
    var wrap=el('div'); wrap.appendChild(el('div','empty','불러오는 중…')); c.appendChild(wrap);
    api.select('worker',{order:'worker_id'}).then(function(list){
      wrap.innerHTML='';
      if(!list.length){
        var k=el('div','card pending');
        k.appendChild(el('h2',null,'등록된 작업자가 없습니다.'));
        k.appendChild(el('p','sub-t','테이블은 있으나 아직 옮기지 않았습니다. 기존 웹의 직원 명부에서 이관합니다.'));
        k.appendChild(el('div','tb','worker'));
        wrap.appendChild(k); return;
      }
      wrap.appendChild(simpleTable('작업자', list, Object.keys(list[0])));
    }).catch(function(e){
      wrap.innerHTML='';
      var k=el('div','card'); k.appendChild(el('h2',null,'불러오지 못했습니다.'));
      k.appendChild(el('p','sub-t',String(e.message||e))); wrap.appendChild(k);
    });
  }

  var VIEW={ item_master: viewItemMaster, item_bom: viewBom, plan_need: viewNeed, meat: viewMeat, worker: viewWorker };

  /* ── 사용자 메뉴 ─────────────────────── */
  function bindTop(){
    var btn=$('userBtn'), menu=$('userMenu');
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      var open=!menu.hidden; menu.hidden=open; btn.setAttribute('aria-expanded',String(!open));
    });
    document.addEventListener('click',function(){ menu.hidden=true; btn.setAttribute('aria-expanded','false'); });
    menu.addEventListener('click',function(e){ e.stopPropagation(); });
    $('menuPw').addEventListener('click',function(){ alert('비밀번호 변경은 계정 저장소를 연결한 뒤에 열립니다.'); });
    $('menuOut').addEventListener('click',function(){ A.clear(); location.hash=''; location.reload(); });
    $('foldBtn').addEventListener('click',function(){ document.body.classList.toggle('folded'); });
    $('menuBtn').addEventListener('click',function(e){ e.stopPropagation(); document.body.classList.toggle('nav-open'); });
  }

  /* ── 진입 ────────────────────────────── */
  function enter(){
    var s=A.session;
    $('login').hidden=true; $('shell').hidden=false;
    $('reviewBanner').hidden=!s.review;
    $('userInitial').textContent=s.id.slice(0,1);
    $('userName').textContent=s.id;
    $('userRole').textContent=s.role==='admin'?'관리자':'작업자';
    $('menuWho').textContent=s.id;
    $('menuRole').textContent=(s.role==='admin'?'관리자':'작업자')+(s.review?' · 검토 모드':'');
    renderRail(s.role);
    var h=location.hash.slice(1);
    render(allowed(h)?h:(s.role==='admin'?'item_master':'thaw_rf'));
  }

  function boot(){
    $('version').textContent=cfg.version;
    bindLogin(); bindTop();
    window.addEventListener('hashchange',function(){
      if(!A.session) return;
      var h=location.hash.slice(1);
      render(allowed(h)?h:(A.session.role==='admin'?'item_master':'thaw_rf'));
    });
    if(A.restore()) enter();
  }
  document.addEventListener('DOMContentLoaded',boot);
})();
