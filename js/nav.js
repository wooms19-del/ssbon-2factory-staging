/* 메뉴 구성.
   tables 는 해당 화면이 연결될 Supabase 테이블. 지금은 안내용으로만 쓴다.
   admin:true 인 그룹은 role==='admin' 에서만 보인다. */
window.SSBON = window.SSBON || {};
window.SSBON.nav = [
  { group:'현황', items:[
    { id:'dashboard', label:'대시보드', tables:[] }
  ]},

  { group:'공정', rail:true, items:[
    { id:'thaw',          label:'해동',       tables:['thaw_cart','thaw_cart_box','meat_box'] },
    { id:'preprocess',    label:'전처리',     tables:['preprocess_run','preprocess_source'] },
    { id:'shredding',     label:'세절',       tables:['shredding_run','shredding_wagon'] },
    { id:'cooking',       label:'취반',       tables:['cooking_run','cooking_wagon','sauce_batch'] },
    { id:'retort',        label:'레토르트',   tables:['retort_run'] },
    { id:'packing',       label:'포장',       tables:['packing_run','packing_wagon','packing_sauce'] },
    { id:'outerpacking',  label:'외포장',     tables:['outerpacking_run','outerpacking_material','outerpacking_worklog'] }
  ]},

  { group:'기준정보', items:[
    { id:'item_master', label:'품목 마스터',        tables:['item_master'] },
    { id:'product',     label:'제품',               tables:['product'] },
    { id:'recipe',      label:'레시피',             tables:['recipe'] },
    { id:'meat',        label:'원육 부위·원산지',   tables:['meat_part','origin'] },
    { id:'worker',      label:'작업자',             tables:['worker'] }
  ]},

  { group:'근태', items:[
    { id:'attendance', label:'출퇴근', tables:['attendance'] }
  ]},

  { group:'분석', admin:true, items:[
    { id:'daily',   label:'일별 실적',  tables:[] },
    { id:'monthly', label:'월별 생산',  tables:[] }
  ]},

  { group:'설정', admin:true, items:[
    { id:'settings', label:'환경설정', tables:[] }
  ]}
];
