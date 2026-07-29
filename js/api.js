/* Supabase REST 래퍼. PostgREST 규약만 쓰므로 온프레미스로 옮겨도 그대로 돈다. */
(function(){
  var cfg=window.SSBON.config;
  function headers(extra){
    var h={ apikey:cfg.anonKey, Authorization:'Bearer '+cfg.anonKey, 'Content-Type':'application/json' };
    for(var k in (extra||{})) h[k]=extra[k];
    return h;
  }
  function select(table,opts){
    opts=opts||{};
    var q=['select='+encodeURIComponent(opts.select||'*')];
    if(opts.order) q.push('order='+encodeURIComponent(opts.order));
    if(opts.limit) q.push('limit='+opts.limit);
    if(opts.filter) q.push(opts.filter);
    return fetch(cfg.restUrl+'/'+table+'?'+q.join('&'),{headers:headers()}).then(function(r){
      if(!r.ok) return r.text().then(function(t){ throw new Error(table+' '+r.status+' '+t); });
      return r.json();
    });
  }
  function count(table){
    return fetch(cfg.restUrl+'/'+table+'?select=*',{headers:headers({Range:'0-0',Prefer:'count=exact'})})
      .then(function(r){
        var cr=r.headers.get('content-range');
        if(!r.ok||!cr) throw new Error(table+' '+r.status);
        var n=parseInt(cr.split('/')[1],10); return isNaN(n)?0:n;
      });
  }
  window.SSBON.api={ select:select, count:count };
})();
