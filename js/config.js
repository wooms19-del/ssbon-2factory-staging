/* 접속 설정
   온프레미스 이관 시 restUrl / anonKey 두 줄만 교체하면 된다.
   나머지 코드는 절대 URL을 직접 들고 있지 않다. */
window.SSBON = window.SSBON || {};
window.SSBON.config = {
  restUrl: 'https://jazyhsyylqrmvnazsgqt.supabase.co/rest/v1',
  anonKey: 'sb_publishable_d5Ehy03ghIozA7RrjFsa5g_rAaHaPyD',
  version: 'v0.5.0-shell'
};
