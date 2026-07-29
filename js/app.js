(function(){
  var A = window.SSBON.auth, NAV = window.SSBON.nav, api = window.SSBON.api;
  var cfg = window.SSBON.config;

  var $ = function(id){ return document.getElementById(id); };
  function el(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var routes = {};
  NAV.forEach(function(g){ g.items.forEach(function(it){ routes[it.id] = it; }); });

  /* ── 로그인 화면 ─────────────────────────────── */
  function bindLogin(){
    $('loginForm').addEventListener('submit', function(e){
      e.preventDefault();
      var id = $('loginId').value.trim();
      var pw = $('loginPw').value;
      if (!id || !pw){ showLoginMsg('아이디와 비밀번호를 모두 입력해 주세요.', true); return; }
      A.verify(id, pw).then(function(s){
        A.setSession(s, $('loginKeep').checked);
        enterApp();
      }).catch(function(err){
        if (err && err.message === 'NO_BACKEND'){
          showLoginMsg('계정 저장소가 아직 연결되지 않아 로그인할 수 없습니다. 아래 버튼으로 화면만 둘러볼 수 있습니다.', true);
        } else {
          showLoginMsg('로그인하지 못했습니다. ' + (err && err.message ? err.message : ''), true);
        }
      });
    });

    $('reviewBtn').addEventListener('click', function(){
      A.setSession(A.reviewSession(), false);
      enterApp();
    });
  }

  function showLoginMsg(text, isError){
    var box = $('loginMsg');
    box.textContent = text;
    box.className = 'notice' + (isError ? ' error' : '');
    box.hidden = false;
  }

  /* ── 메뉴 ────────────────────────────────────── */
  function renderNav(role){
    var wrap = $('sideNav');
    wrap.innerHTML = '';
    NAV.forEach(function(g){
      if (g.admin && role !== 'admin') return;
      var sec = el('div', 'nav-group');
      sec.appendChild(el('h3', null, g.group));
      var ul = el('ul', 'nav-list' + (g.rail ? ' rail' : ''));
      g.items.forEach(function(it, i){
        var li = el('li');
        li.dataset.route = it.id;
        if (g.rail){
          li.appendChild(el('span', 'rail-node'));
        }
        var b = el('button', 'nav-btn');
        b.type = 'button';
        b.appendChild(el('span', null, it.label));
        if (g.rail) b.appendChild(el('span', 'rail-seq', String(i + 1).padStart(2, '0')));
        b.addEventListener('click', function(){
          go(it.id);
          document.body.classList.remove('nav-open');
        });
        li.appendChild(b);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      wrap.appendChild(sec);
    });
  }

  function markActive(id){
    $('sideNav').querySelectorAll('li').forEach(function(li){
      var on = li.dataset.route === id;
      li.classList.toggle('is-active', on);
      var b = li.querySelector('.nav-btn');
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  /* ── 라우팅 ──────────────────────────────────── */
  function go(id){
    var r = routes[id] ? id : 'dashboard';
    if (location.hash !== '#' + r) { location.hash = r; return; }
    render(r);
  }

  function render(id){
    var it = routes[id];
    markActive(id);
    $('pageTitle').textContent = it.label;
    var c = $('content');
    c.innerHTML = '';
    if (id === 'dashboard') renderDashboard(c);
    else renderPending(c, it);
    c.focus({ preventScroll:true });
  }

  function renderPending(c, it){
    var card = el('div', 'card pending');
    card.appendChild(el('h2', null, it.label + ' 화면은 아직 만들지 않았습니다.'));
    card.appendChild(el('p', 'sub', '메뉴 자리만 잡아 둔 상태입니다. 데이터 이관 뒤에 이 화면을 붙입니다.'));
    if (it.tables.length){
      card.appendChild(el('div', 'tables', '연결 예정 테이블 · ' + it.tables.join(', ')));
    }
    c.appendChild(card);
  }

  /* ── 대시보드: 접속 확인 ─────────────────────── */
  var MASTERS = [
    { t:'item_master', label:'품목 마스터' },
    { t:'product',     label:'제품' },
    { t:'recipe',      label:'레시피' },
    { t:'meat_part',   label:'원육 부위' },
    { t:'origin',      label:'원산지' }
  ];

  function renderDashboard(c){
    var card = el('div', 'card');
    var h = el('h2');
    var dot = el('span', 'dot');
    h.appendChild(dot);
    h.appendChild(document.createTextNode('데이터베이스 연결'));
    card.appendChild(h);
    var sub = el('p', 'sub', '기준정보 건수를 실제로 읽어 연결 상태를 확인합니다.');
    card.appendChild(sub);

    var grid = el('div', 'stat-grid');
    MASTERS.forEach(function(m){
      var s = el('div', 'stat');
      s.appendChild(el('div', 'k', m.label));
      var v = el('div', 'v', '…');
      v.id = 'stat-' + m.t;
      s.appendChild(v);
      grid.appendChild(s);
    });
    card.appendChild(grid);
    c.appendChild(card);

    Promise.all(MASTERS.map(function(m){
      return api.count(m.t).then(function(n){ return { t:m.t, n:n }; })
                           .catch(function(){ return { t:m.t, n:null }; });
    })).then(function(res){
      var bad = 0;
      res.forEach(function(r){
        var v = $('stat-' + r.t);
        if (!v) return;
        if (r.n === null){ v.textContent = '실패'; bad++; }
        else v.textContent = r.n.toLocaleString('ko-KR');
      });
      dot.className = 'dot ' + (bad ? 'bad' : 'ok');
      sub.textContent = bad
        ? bad + '개 항목을 읽지 못했습니다. 접속 주소와 키를 확인해 주세요.'
        : '정상으로 읽었습니다. 공정 데이터는 아직 이관 전이라 비어 있습니다.';
    });
  }

  /* ── 상단 사용자 설정 ────────────────────────── */
  function renderUser(s){
    $('userInitial').textContent = s.id.slice(0, 1);
    $('userName').textContent = s.id;
    $('userRole').textContent = s.role === 'admin' ? '관리자' : '작업자';
    $('menuWho').textContent = s.id;
    $('menuRole').textContent = (s.role === 'admin' ? '관리자' : '작업자')
      + (s.review ? ' · 검토 모드' : '');
  }

  function bindUserMenu(){
    var btn = $('userBtn'), menu = $('userMenu');
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var open = !menu.hidden;
      menu.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', function(){
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });
    menu.addEventListener('click', function(e){ e.stopPropagation(); });

    $('menuPw').addEventListener('click', function(){
      alert('비밀번호 변경은 계정 저장소를 연결한 뒤에 열립니다.');
    });
    $('menuOut').addEventListener('click', function(){
      A.clear();
      location.hash = '';
      location.reload();
    });

    $('sideToggle').addEventListener('click', function(e){
      e.stopPropagation();
      document.body.classList.toggle('nav-open');
    });
    $('scrim').addEventListener('click', function(){
      document.body.classList.remove('nav-open');
    });
  }

  /* ── 진입 ────────────────────────────────────── */
  function enterApp(){
    var s = A.session;
    $('login').hidden = true;
    $('shell').hidden = false;
    $('reviewBanner').hidden = !s.review;
    renderNav(s.role);
    renderUser(s);
    render(routes[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard');
  }

  function boot(){
    $('version').textContent = cfg.version;
    bindLogin();
    bindUserMenu();
    window.addEventListener('hashchange', function(){
      if (!A.session) return;
      render(routes[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard');
    });
    if (A.restore()) enterApp();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
