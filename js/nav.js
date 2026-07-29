/* 메뉴 구성.
   레일(상위) 순서 = 일이 흘러가는 순서: 계획 → 재고 → 생산현장 → 생산실적 → 분석.
   그 뒤는 기준정보·일정표·출퇴근.
   worker 는 admin:true 인 그룹이 안 보인다.
   tables 는 그 화면이 붙을 Supabase 테이블. 비어 있으면 아직 테이블이 없다는 뜻. */
window.SSBON = window.SSBON || {};

window.SSBON.icons = {
  plan:   '<path d="M4 5h16v16H4zM4 10h16M9 3v4M15 3v4M8 14h8M8 17h5"/>',
  stock:  '<path d="M3 8l9-4 9 4v8l-9 4-9-4zM3 8l9 4 9-4M12 12v8"/>',
  floor:  '<path d="M4 4v16M20 4v16M8 12h9M13 8l4 4-4 4"/>',
  result: '<path d="M4 3h16v18H4zM8 8h8M8 12h8M8 16h5"/>',
  chart:  '<path d="M4 20V9M10 20V4M16 20v-8M22 20H2"/>',
  master: '<path d="M4 6h16M4 12h16M4 18h10M18 16l2 2 3-3"/>',
  cal:    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock:  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};

window.SSBON.nav = [
  { id:'plan', label:'계획', icon:'plan', admin:true, title:'계획', items:[
    { id:'plan_input', label:'생산계획 입력', tables:[] },
    { id:'plan_need',  label:'소요량 확인',   tables:['item_bom'] }
  ]},

  { id:'stock', label:'재고', icon:'stock', title:'재고', items:[
    { id:'stock_meat', label:'원육 재고',        tables:[] },
    { id:'stock_sub',  label:'원재료·부자재 재고', tables:[] },
    { id:'stock_in',   label:'입고',             tables:[] },
    { id:'stock_move', label:'공장간 이동',       tables:[] }
  ]},

  { id:'floor', label:'생산현장', icon:'floor', title:'생산현장', flow:true, items:[
    { id:'thaw_rf',     label:'해동기',   tables:['meat_box'] },
    { id:'thaw',        label:'방혈',     tables:['thaw_cart','thaw_cart_box'] },
    { id:'preprocess',  label:'전처리',   tables:['preprocess_run','preprocess_source'] },
    { id:'cooking',     label:'자숙',     tables:['cooking_run','cooking_wagon'] },
    { id:'shredding',   label:'파쇄',     tables:['shredding_run','shredding_wagon'] },
    { id:'sauce',       label:'소스',     tables:['sauce_batch'], trib:true, note:'내포장 합류' },
    { id:'packing',     label:'내포장',   tables:['packing_run','packing_wagon','packing_sauce'] },
    { id:'retort',      label:'레토르트', tables:['retort_run'] },
    { id:'outerpacking',label:'외포장',   tables:['outerpacking_run','outerpacking_material','outerpacking_worklog'] }
  ]},

  { id:'result', label:'생산실적', icon:'result', title:'생산실적', items:[
    { id:'daily_perf',   label:'일별실적',    tables:[] },
    { id:'monthly_prod', label:'월단위생산량', tables:[] }
  ]},

  { id:'analysis', label:'분석', icon:'chart', admin:true, title:'분석', items:[
    { id:'daily_sum',  label:'일별요약',       tables:[] },
    { id:'monthly_sum',label:'월별현황',       tables:[] },
    { id:'trace',      label:'이력추적',       tables:[] },
    { id:'inedible',   label:'비가식부·생산성', tables:[] }
  ]},

  { id:'master', label:'기준정보', icon:'master', admin:true, title:'기준정보', items:[
    { id:'item_master', label:'품목 마스터', tables:['item_master'] },
    { id:'item_bom',    label:'자재명세',    tables:['item_bom'] },
    { id:'meat',        label:'원육 부위·원산지', tables:['meat_part','origin'] },
    { id:'worker',      label:'작업자',      tables:['worker'] }
  ]},

  { id:'schedule', label:'일정표', icon:'cal', title:'일정표', items:[
    { id:'sched', label:'월간 생산 일정', tables:[] }
  ]},

  { id:'attend', label:'출퇴근', icon:'clock', title:'출퇴근', items:[
    { id:'attendance', label:'출퇴근 입력', tables:['attendance'] }
  ]}
];
