/* Supabase REST 래퍼.
   PostgREST 규약만 사용하므로 온프레미스 PostgREST로 옮겨도 그대로 동작한다. */
(function(){
  var cfg = window.SSBON.config;

  function headers(extra){
    var h = {
      'apikey': cfg.anonKey,
      'Authorization': 'Bearer ' + cfg.anonKey,
      'Content-Type': 'application/json'
    };
    for (var k in (extra||{})) h[k] = extra[k];
    return h;
  }

  /* 테이블 행 조회. opts: {select, limit, order, filter} */
  function select(table, opts){
    opts = opts || {};
    var q = ['select=' + encodeURIComponent(opts.select || '*')];
    if (opts.order) q.push('order=' + encodeURIComponent(opts.order));
    if (opts.limit) q.push('limit=' + opts.limit);
    if (opts.filter) q.push(opts.filter);
    return fetch(cfg.restUrl + '/' + table + '?' + q.join('&'), { headers: headers() })
      .then(function(res){
        if (!res.ok) return res.text().then(function(t){ throw new Error(table + ' ' + res.status + ' ' + t); });
        return res.json();
      });
  }

  /* 행 수만 필요할 때. 본문은 받지 않고 Content-Range 헤더만 읽는다. */
  function count(table){
    return fetch(cfg.restUrl + '/' + table + '?select=*', {
      headers: headers({ 'Range': '0-0', 'Prefer': 'count=exact' })
    }).then(function(res){
      var cr = res.headers.get('content-range');
      if (!res.ok || !cr) throw new Error(table + ' ' + res.status);
      var n = parseInt(cr.split('/')[1], 10);
      return isNaN(n) ? 0 : n;
    });
  }

  window.SSBON.api = { select: select, count: count };
})();
