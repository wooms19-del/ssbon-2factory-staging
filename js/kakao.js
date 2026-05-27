// ============================================================
// 카카오톡 알림 - 다중 구독자 시스템
// 누구든 카카오 로그인 → Firebase에 구독자 등록
// 빨간 알람 발생 시 모든 구독자에게 카톡 발송
// ============================================================
const KAKAO_JS_KEY = '3c36e1a3bb9ea2d4445a5cd30dd906c1';
const KAKAO_REDIRECT_URI = 'https://wooms19-del.github.io/ssbon-2factory/';
const KAKAO_LS_MY_USER_ID = 'ssbon_v6_kakao_my_user_id';  // 현재 PC의 로그인 사용자 ID
const KAKAO_AUTO_LS_KEY = 'ssbon_v6_kakao_auto_send';     // PC별 자동 발송 토글
const KAKAO_FB_COL = 'notify_subscribers';                 // Firebase 구독자 컬렉션
const KAKAO_LOG_COL = 'kakao_sent_log';                    // 발송 이력

// ============================================================
// 페이지 로드 시 OAuth callback 처리 (?code= 파라미터)
// ============================================================
async function _kakaoCheckCallback(){
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if(!code) return;

  try{
    const resp = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'},
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KAKAO_JS_KEY,
        redirect_uri: KAKAO_REDIRECT_URI,
        code: code
      })
    });
    const data = await resp.json();
    if(!data.access_token){
      console.error('카카오 토큰 교환 실패:', data);
      if(typeof toast === 'function') toast('카카오 로그인 실패','d');
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    // user info 가져오기
    const userInfo = await _kakaoFetchUserInfo(data.access_token);
    if(!userInfo || !userInfo.id){
      if(typeof toast === 'function') toast('카카오 사용자 정보 조회 실패','d');
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    // Firebase에 구독자 등록
    const subscriber = {
      userId: String(userInfo.id),
      nickname: userInfo.nickname || '카카오사용자',
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in||21600)*1000,
      refresh_token_expires_at: Date.now() + (data.refresh_token_expires_in||5184000)*1000,
      enabled: true,
      subscribed_at: new Date().toISOString(),
      last_active_at: new Date().toISOString()
    };

    await firebase.firestore().collection(KAKAO_FB_COL).doc(String(userInfo.id)).set(subscriber);

    // 현재 PC에 "나는 누구다" 저장 (식별용, 토큰 X)
    localStorage.setItem(KAKAO_LS_MY_USER_ID, String(userInfo.id));

    // URL에서 code 제거
    window.history.replaceState({}, document.title, window.location.pathname);

    if(typeof toast === 'function') toast(`✓ ${subscriber.nickname}님 카톡 알림 등록 완료`,'s');
    else alert(`${subscriber.nickname}님 카톡 알림이 등록되었습니다.`);

    if(typeof _renderKakaoStatus === 'function') _renderKakaoStatus();
  }catch(e){
    console.error('카카오 OAuth 처리 오류:', e);
    if(typeof toast === 'function') toast('카카오 처리 오류: '+e.message,'d');
  }
}
window.addEventListener('load', _kakaoCheckCallback);

// 카카오 사용자 정보 조회
async function _kakaoFetchUserInfo(token){
  try{
    const resp = await fetch('https://kapi.kakao.com/v2/user/me', {
      method: 'GET',
      headers: {'Authorization': 'Bearer ' + token}
    });
    const data = await resp.json();
    return {
      id: data.id,
      nickname: (data.properties && data.properties.nickname) || (data.kakao_account && data.kakao_account.profile && data.kakao_account.profile.nickname) || '카카오사용자'
    };
  }catch(e){ console.error('user info 조회 실패:', e); return null; }
}

// ============================================================
// 카카오 로그인 시작
// ============================================================
function kakaoLogin(){
  if(!window.Kakao){ alert('카카오 SDK 로드 실패. 새로고침 후 다시 시도.'); return; }
  if(!Kakao.isInitialized()){ Kakao.init(KAKAO_JS_KEY); }
  Kakao.Auth.authorize({
    redirectUri: KAKAO_REDIRECT_URI,
    scope: 'talk_message'
  });
}

// ============================================================
// 특정 구독자의 토큰 갱신 (만료 임박 시)
// ============================================================
async function _refreshSubscriberToken(sub){
  if(!sub.refresh_token) return null;
  if(sub.refresh_token_expires_at && Date.now() > sub.refresh_token_expires_at){
    // refresh_token도 만료 → 비활성화
    await firebase.firestore().collection(KAKAO_FB_COL).doc(sub.userId).update({enabled: false, expired_at: new Date().toISOString()});
    return null;
  }
  try{
    const resp = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'},
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: KAKAO_JS_KEY,
        refresh_token: sub.refresh_token
      })
    });
    const data = await resp.json();
    if(!data.access_token) return null;

    const update = {
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in||21600)*1000,
      last_active_at: new Date().toISOString()
    };
    if(data.refresh_token){
      update.refresh_token = data.refresh_token;
      update.refresh_token_expires_at = Date.now() + (data.refresh_token_expires_in||5184000)*1000;
    }
    await firebase.firestore().collection(KAKAO_FB_COL).doc(sub.userId).update(update);
    return data.access_token;
  }catch(e){ console.error('토큰 갱신 실패:', e); return null; }
}

// ============================================================
// 단일 구독자에게 메시지 전송 (silent)
// ============================================================
async function _sendKakaoToSubscriber(sub, label, value, mean, dateStr){
  let token = sub.access_token;
  // 만료 임박 시 갱신
  if(Date.now() > sub.expires_at - 60000){
    token = await _refreshSubscriberToken(sub);
    if(!token) throw new Error('토큰 갱신 실패');
  }

  const dt = new Date();
  const dateDisp = dateStr ? dateStr.replace(/-/g,'.') : `${dt.getMonth()+1}월 ${dt.getDate()}일`;
  const timeDisp = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;

  const template = {
    object_type: 'text',
    text: `🚨 순수본 2공장 이상 알림\n\n[${label}]\n평소 ${mean.toFixed(2)}% → 오늘 ${value.toFixed(2)}%\n\n${dateDisp} ${timeDisp} 자동 발송\n시스템에서 확인하세요.`,
    link: {
      web_url: 'https://wooms19-del.github.io/ssbon-2factory/',
      mobile_web_url: 'https://wooms19-del.github.io/ssbon-2factory/'
    },
    button_title: '시스템 열기'
  };

  const resp = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
    },
    body: 'template_object=' + encodeURIComponent(JSON.stringify(template))
  });
  const data = await resp.json();
  if(data.result_code !== 0) throw new Error(data.msg || '발송 실패');
  return data;
}

// ============================================================
// 자동 발송 - 모든 활성 구독자에게 발송 (중복 방지)
// ============================================================
function isKakaoAutoSendEnabled(){
  try{
    const v = localStorage.getItem(KAKAO_AUTO_LS_KEY);
    return v === null ? true : v === '1';
  }catch(e){ return true; }
}

function setKakaoAutoSend(enabled){
  try{
    localStorage.setItem(KAKAO_AUTO_LS_KEY, enabled ? '1' : '0');
    if(typeof toast === 'function') toast(enabled ? '자동 발송 ON' : '자동 발송 OFF', 'i');
  }catch(e){}
}

async function autoSendKakaoAlerts(redAlerts, dateStr){
  if(!isKakaoAutoSendEnabled()) return;
  if(!redAlerts || redAlerts.length === 0) return;

  const db = firebase.firestore();

  for(const a of redAlerts){
    const docId = `${dateStr}_${a.key}_red`;
    try{
      // 이미 발송된 알람이면 스킵
      const sentDoc = await db.collection(KAKAO_LOG_COL).doc(docId).get();
      if(sentDoc.exists) continue;

      // 활성 구독자 목록
      const snap = await db.collection(KAKAO_FB_COL).where('enabled','==',true).get();
      if(snap.empty){
        console.log('[카톡 자동 발송] 활성 구독자 없음');
        continue;
      }

      const sentTo = [];
      const failedFor = [];

      for(const subDoc of snap.docs){
        const sub = subDoc.data();
        try{
          await _sendKakaoToSubscriber(sub, a.label, a.value, a.mean, dateStr);
          sentTo.push({userId: sub.userId, nickname: sub.nickname});
        }catch(e){
          console.error(`[카톡 자동 발송 실패] ${sub.nickname}:`, e.message);
          failedFor.push({userId: sub.userId, nickname: sub.nickname, error: e.message});
        }
      }

      // 발송 이력 1건 저장 (트리거 단위)
      await db.collection(KAKAO_LOG_COL).doc(docId).set({
        date: dateStr,
        metric: a.key,
        label: a.label,
        value: a.value,
        mean: a.mean,
        level: 'red',
        sentAt: new Date().toISOString(),
        sentTo: sentTo,
        failedFor: failedFor
      });

      console.log(`[카톡 자동 발송 완료] ${a.label}: ${sentTo.length}명 성공, ${failedFor.length}명 실패`);
    }catch(e){
      console.error('[카톡 자동 발송 오류]', a.label, e.message);
    }
  }
}

// ============================================================
// 수동 테스트 발송 (현재 PC 사용자에게)
// ============================================================
async function sendKakaoAlert(label, value, mean){
  const myId = localStorage.getItem(KAKAO_LS_MY_USER_ID);
  if(!myId){
    if(confirm('카카오 로그인이 필요합니다.\n지금 로그인하시겠습니까?')) kakaoLogin();
    return;
  }
  try{
    const subDoc = await firebase.firestore().collection(KAKAO_FB_COL).doc(myId).get();
    if(!subDoc.exists){
      if(typeof toast==='function') toast('구독 정보 없음. 다시 로그인 해주세요.','d');
      return;
    }
    const sub = subDoc.data();
    await _sendKakaoToSubscriber(sub, label, value, mean, new Date().toISOString().slice(0,10));
    if(typeof toast==='function') toast('✓ 카톡 발송 완료','s');
  }catch(e){
    if(typeof toast==='function') toast('발송 실패: '+e.message,'d');
    console.error(e);
  }
}

// ============================================================
// 본인 알림 해제 (구독 취소)
// ============================================================
async function kakaoUnsubscribe(userId){
  if(!userId) userId = localStorage.getItem(KAKAO_LS_MY_USER_ID);
  if(!userId){ if(typeof toast==='function') toast('대상 없음','d'); return; }
  if(!confirm('이 사용자의 카톡 알림을 해제하시겠습니까?')) return;
  try{
    await firebase.firestore().collection(KAKAO_FB_COL).doc(String(userId)).delete();
    // 본인이면 LocalStorage도 정리
    const myId = localStorage.getItem(KAKAO_LS_MY_USER_ID);
    if(myId === String(userId)) localStorage.removeItem(KAKAO_LS_MY_USER_ID);
    if(typeof toast==='function') toast('알림 해제됨','i');
    if(typeof _renderKakaoStatus==='function') _renderKakaoStatus();
  }catch(e){
    if(typeof toast==='function') toast('해제 실패: '+e.message,'d');
  }
}

// ============================================================
// 구독자 목록 조회
// ============================================================
async function _listSubscribers(){
  try{
    const snap = await firebase.firestore().collection(KAKAO_FB_COL).get();
    return snap.docs.map(d => d.data());
  }catch(e){ console.error('구독자 목록 조회 실패:', e); return []; }
}

// ============================================================
// 설정 페이지 - 카카오 알림 박스 + 구독자 명단 렌더
// ============================================================
async function _renderKakaoStatus(){
  const box = document.getElementById('kakao_status_box');
  const stat = document.getElementById('acc-kakao-status');
  if(!box) return;

  const myId = localStorage.getItem(KAKAO_LS_MY_USER_ID);
  const subscribers = await _listSubscribers();
  const activeSubs = subscribers.filter(s => s.enabled);
  const meIsSubscribed = myId && activeSubs.some(s => s.userId === myId);
  const autoOn = isKakaoAutoSendEnabled();

  if(stat) stat.textContent = activeSubs.length > 0 ? `· ${activeSubs.length}명 구독 중` : '· 비활성';

  let html = '';

  // 1. 본인 상태 카드
  if(meIsSubscribed){
    const me = activeSubs.find(s => s.userId === myId);
    html += `<div style="background:#ECFDF5;border:1px solid #10B981;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <span style="color:#10B981;font-size:14px">●</span>
      <div style="flex:1;min-width:200px">
        <div style="font-size:13px;color:#065F46;font-weight:600">${me.nickname}님 알림 받는 중</div>
        <div style="font-size:11px;color:#047857">빨간 알람 발생 시 본인 카톡으로 자동 발송</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn bo bsm" onclick="sendKakaoAlert('테스트',45.0,54.5)">📱 테스트</button>
        <button class="btn bd bsm" onclick="kakaoUnsubscribe('${myId}')">알림 해제</button>
      </div>
    </div>`;
  } else {
    html += `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:12px 14px;margin-bottom:10px">
      <div style="font-size:12px;color:#6B7280;margin-bottom:10px;line-height:1.5">
        본인 카카오 계정으로 로그인하면 빨간 알람 시 본인 카톡으로 자동 발송됩니다.<br>
        한 번 로그인하면 약 2개월 동안 자동 갱신.
      </div>
      <button onclick="kakaoLogin()" style="padding:9px 18px;background:#FEE500;color:#3C1E1E;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:700">
        💬 카카오 로그인하고 알림 받기
      </button>
    </div>`;
  }

  // 2. 자동 발송 토글 (본인이 가입한 경우에만)
  if(meIsSubscribed){
    html += `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1">
        <input type="checkbox" id="kakao_auto_on" ${autoOn?'checked':''} onchange="setKakaoAutoSend(this.checked)" style="width:16px;height:16px;cursor:pointer">
        <div>
          <div style="font-size:12px;font-weight:600;color:#374151">이 PC에서 자동 발송 트리거</div>
          <div style="font-size:11px;color:#6B7280;margin-top:2px">빨간 알람 발견 시 모든 구독자에게 카톡 자동 발송 (하루 1회). OFF여도 다른 PC에서 발송 가능.</div>
        </div>
      </label>
    </div>`;
  }

  // 3. 구독자 명단
  if(activeSubs.length > 0){
    html += `<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:12px 14px">
      <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px">📋 카톡 받는 사람 (${activeSubs.length}명)</div>
      <div style="display:flex;flex-direction:column;gap:5px">`;
    activeSubs.forEach(sub => {
      const isMe = myId === sub.userId;
      const subDate = sub.subscribed_at ? new Date(sub.subscribed_at).toLocaleDateString('ko-KR') : '?';
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:${isMe?'#EFF6FF':'#FAFAFA'};border-radius:4px;font-size:12px">
        <span style="color:#10B981">●</span>
        <span style="font-weight:${isMe?'600':'400'};color:#1F2937">${sub.nickname}</span>
        ${isMe?'<span style="font-size:10px;background:#3B82F6;color:white;padding:1px 6px;border-radius:3px">본인</span>':''}
        <span style="flex:1;font-size:10px;color:#9CA3AF">가입 ${subDate}</span>
        ${!isMe?`<button class="btn bd bsm" onclick="kakaoUnsubscribe('${sub.userId}')" style="padding:2px 8px;font-size:10px">제거</button>`:''}
      </div>`;
    });
    html += `</div></div>`;
  }

  box.innerHTML = html;
}
