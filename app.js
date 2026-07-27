/* ☀️ 캠스터디 (Camstudy) — Client Application Logic with PeerJS WebRTC & Firestore */

// Application State
const state = {
  screen: 'permission', // 'permission' | 'nickname' | 'main' | 'detail'
  camStream: null,
  screenStream: null,
  nickname: '',
  recordId: null,
  totalSeconds: 0,
  studyDay: '',
  avatar: '🌱',
  participants: [],
  timerInterval: null,
  heartbeatInterval: null,
  pollInterval: null,
  resetTimeout: null,
  detailUser: null,
  peer: null,
  peerId: null,
  calls: {},
  remoteStreams: {},
};

const EMOJI_AVATARS = ['🌱', '🦊', '🐰', '🐱', '🐧', '🐻', '🐼', '🐯', '🦁', '🦉', '🐣', '🐶', '🦄', '🐝'];

// Helper: Get study day key based on 4 AM boundary
function getStudyDayKey(date = new Date()) {
  const d = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Format seconds to HH:MM:SS
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Helper: Generate Avatar from Nickname hash
function getAvatarForNickname(nick) {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) {
    hash = nick.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % EMOJI_AVATARS.length;
  return EMOJI_AVATARS[index];
}

// Create animated fallback canvas stream when hardware stream is unavailable
function createMockStream(label, color = '#ff8e53') {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  let angle = 0;

  function draw() {
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = color;
    ctx.font = '22px "Jua", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 - 20);

    // Pulse animation circle
    angle += 0.05;
    const radius = 18 + Math.sin(angle) * 6;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2 + 30, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 142, 83, 0.6)';
    ctx.fill();

    requestAnimationFrame(draw);
  }
  draw();

  return canvas.captureStream(30);
}

// Combine webcam and screen share streams for PeerJS transmission
function getMyCombinedStream() {
  const tracks = [];
  if (state.camStream) {
    const camTracks = state.camStream.getVideoTracks();
    if (camTracks.length > 0) tracks.push(camTracks[0]);
  }
  if (state.screenStream) {
    const screenTracks = state.screenStream.getVideoTracks();
    if (screenTracks.length > 0) tracks.push(screenTracks[0]);
  }
  return new MediaStream(tracks);
}

// Switch Active Screen
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`${screenId}-screen`);
  if (target) {
    target.classList.add('active');
    state.screen = screenId;
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  state.studyDay = getStudyDayKey();
  setupEventListeners();
  scheduleNext4AMReset();
});

// Setup DOM Event Listeners
function setupEventListeners() {
  // Screen 1: Request Permission Button
  const reqPermBtn = document.getElementById('request-permission-btn');
  if (reqPermBtn) reqPermBtn.addEventListener('click', handleRequestPermissions);

  // Screen Share Guide Modal Button
  const grantScreenBtn = document.getElementById('grant-screen-perm-btn');
  if (grantScreenBtn) grantScreenBtn.addEventListener('click', handleRequestScreenShare);

  // Screen 2: Start Study Button
  const startBtn = document.getElementById('start-study-btn');
  const nickInput = document.getElementById('nickname-input');
  if (startBtn) startBtn.addEventListener('click', handleStartStudy);
  if (nickInput) {
    nickInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleStartStudy();
    });
  }

  // Header Leave Button
  const leaveBtn = document.getElementById('leave-btn');
  if (leaveBtn) leaveBtn.addEventListener('click', handleLeaveStudy);

  // FAB & Modal controls
  const fab = document.getElementById('record-fab');
  const modal = document.getElementById('record-modal');
  const modalClose = document.getElementById('modal-close-btn');

  if (fab && modal) fab.addEventListener('click', openRankingModal);
  if (modalClose) modalClose.addEventListener('click', closeRankingModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeRankingModal();
    });
  }

  // Detail Close Button
  const detailCloseBtn = document.getElementById('detail-close-btn');
  if (detailCloseBtn) {
    detailCloseBtn.addEventListener('click', () => {
      showScreen('main');
    });
  }

  // Window unload heartbeat
  window.addEventListener('beforeunload', () => {
    if (state.recordId) {
      if (window.db) {
        window.db.collection('study_records').doc(state.recordId).set({
          is_online: false,
          last_seen: Date.now()
        }, { merge: true }).catch(() => {});
      }
      navigator.sendBeacon('/tables/study_records/' + state.recordId, JSON.stringify({
        is_online: false,
        total_seconds: state.totalSeconds
      }));
    }
  });
}

// Step 1: Request Webcam Permission First
async function handleRequestPermissions() {
  const permCamStatus = document.querySelector('#perm-cam .perm-status');
  const permErr = document.getElementById('permission-error');
  if (permErr) permErr.classList.add('hidden');

  // Request Webcam
  try {
    state.camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (permCamStatus) {
      permCamStatus.textContent = '승인됨';
      permCamStatus.className = 'perm-status approved';
    }
  } catch (err) {
    console.warn('Webcam permission denied or error:', err);
    state.camStream = createMockStream('내 웹캠', '#3b82f6');
    if (permCamStatus) {
      permCamStatus.textContent = '시뮬레이션 사용';
      permCamStatus.className = 'perm-status approved';
    }
  }

  // Show Screen Share Guide Modal
  const screenGuideModal = document.getElementById('screen-guide-modal');
  if (screenGuideModal) {
    screenGuideModal.classList.remove('hidden');
  } else {
    handleRequestScreenShare();
  }
}

// Step 2: Request Screen Share Permission
async function handleRequestScreenShare() {
  const permScreenStatus = document.querySelector('#perm-screen .perm-status');
  const screenGuideModal = document.getElementById('screen-guide-modal');

  if (screenGuideModal) {
    screenGuideModal.classList.add('hidden');
  }

  // Request Screen Share
  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    if (permScreenStatus) {
      permScreenStatus.textContent = '승인됨';
      permScreenStatus.className = 'perm-status approved';
    }

    const videoTrack = state.screenStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        console.log('Screen sharing stopped by user');
        state.screenStream = createMockStream('모니터 화면 중단됨', '#ef4444');
        updateMyCardStreams();
      };
    }
  } catch (err) {
    console.warn('Screen share permission denied or error:', err);
    state.screenStream = createMockStream('모니터 화면', '#10b981');
    if (permScreenStatus) {
      permScreenStatus.textContent = '시뮬레이션 사용';
      permScreenStatus.className = 'perm-status approved';
    }
  }

  // Attach webcam preview
  const camPreview = document.getElementById('cam-preview');
  if (camPreview && state.camStream) {
    camPreview.srcObject = state.camStream;
  }

  showScreen('nickname');
}

// PeerJS Initialization & Connection
function initPeerJS() {
  if (typeof Peer === 'undefined') {
    console.warn('PeerJS library is not available in browser.');
    return;
  }

  const cleanNick = state.nickname.replace(/[^a-zA-Z0-9]/g, '_');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  state.peerId = `camstudy_${cleanNick}_${randomSuffix}`;

  try {
    if (state.peer) {
      try { state.peer.destroy(); } catch (e) {}
    }

    state.peer = new Peer(state.peerId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    state.peer.on('open', (id) => {
      console.log('✅ PeerJS Server Connected! Peer ID:', id);
      state.peerId = id;
      sendHeartbeat();
    });

    // Answer incoming calls
    state.peer.on('call', (call) => {
      console.log('📞 Received WebRTC call from peer:', call.peer);
      const myStream = getMyCombinedStream();
      call.answer(myStream);

      call.on('stream', (remoteStream) => {
        console.log('📹 Received remote stream from peer:', call.peer);
        state.remoteStreams[call.peer] = remoteStream;
        updateUserStreamsInUI(call.peer, remoteStream);
      });

      call.on('error', (err) => {
        console.warn('Call error with peer:', call.peer, err);
      });
    });

    state.peer.on('error', (err) => {
      console.warn('PeerJS Error:', err);
    });
  } catch (err) {
    console.warn('PeerJS setup failed:', err);
  }
}

// Connect to remote peer via PeerJS
function connectToRemotePeer(remotePeerId) {
  if (!state.peer || !remotePeerId || remotePeerId === state.peerId) return;
  if (state.calls[remotePeerId]) return; // Already calling/connected

  console.log('📱 Outgoing WebRTC Call to peer:', remotePeerId);
  const myStream = getMyCombinedStream();
  try {
    const call = state.peer.call(remotePeerId, myStream);
    if (call) {
      state.calls[remotePeerId] = call;
      call.on('stream', (remoteStream) => {
        console.log('📹 Connected to remote peer stream:', remotePeerId);
        state.remoteStreams[remotePeerId] = remoteStream;
        updateUserStreamsInUI(remotePeerId, remoteStream);
      });
      call.on('close', () => {
        delete state.calls[remotePeerId];
        delete state.remoteStreams[remotePeerId];
      });
      call.on('error', (err) => {
        console.warn('Outgoing call error:', err);
        delete state.calls[remotePeerId];
      });
    }
  } catch (err) {
    console.warn('Error calling remote peer:', remotePeerId, err);
  }
}

// Handle Nickname Submission and Start Study
async function handleStartStudy() {
  const nickInput = document.getElementById('nickname-input');
  const nickErr = document.getElementById('nickname-error');
  const rawNickname = nickInput ? nickInput.value.trim() : '';

  if (!rawNickname) {
    if (nickErr) {
      nickErr.textContent = '닉네임을 입력해 주세요!';
      nickErr.classList.remove('hidden');
    }
    return;
  }

  if (rawNickname.length > 12) {
    if (nickErr) {
      nickErr.textContent = '닉네임은 최대 12자까지 입력할 수 있어요.';
      nickErr.classList.remove('hidden');
    }
    return;
  }

  if (nickErr) nickErr.classList.add('hidden');

  state.nickname = rawNickname;
  state.avatar = getAvatarForNickname(rawNickname);
  state.studyDay = getStudyDayKey();

  // Initialize PeerJS WebRTC
  initPeerJS();

  // Sync / Create user record via Firestore (or fallback REST Table API)
  if (window.db) {
    try {
      const docId = `${state.nickname}_${state.studyDay}`.replace(/[^a-zA-Z0-9가-힣_]/g, '_');
      const docRef = window.db.collection('study_records').doc(docId);
      const snapshot = await docRef.get();
      if (snapshot.exists) {
        const data = snapshot.data();
        state.recordId = docId;
        state.totalSeconds = data.total_seconds || 0;
        await docRef.set({
          nickname: state.nickname,
          study_day: state.studyDay,
          avatar: state.avatar,
          is_online: true,
          peer_id: state.peerId || '',
          last_seen: Date.now()
        }, { merge: true });
      } else {
        state.recordId = docId;
        state.totalSeconds = 0;
        await docRef.set({
          nickname: state.nickname,
          study_day: state.studyDay,
          total_seconds: 0,
          avatar: state.avatar,
          is_online: true,
          peer_id: state.peerId || '',
          last_seen: Date.now()
        });
      }
    } catch (fsErr) {
      console.warn('Firestore initialization error:', fsErr);
    }
  }

  if (!state.recordId) {
    try {
      const res = await fetch('/tables/study_records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: state.nickname,
          study_day: state.studyDay,
          avatar: state.avatar,
          is_online: true,
          peer_id: state.peerId || ''
        })
      });
      if (res.ok) {
        const data = await res.json();
        const record = data.record || data.data;

        if (record) {
          state.recordId = record.id;
          state.totalSeconds = record.total_seconds || 0;
        }
      }
    } catch (err) {
      console.warn('Backend API not available (static host fallback):', err);
    }
  }

  if (!state.recordId) {
    state.recordId = `local-${Date.now()}`;
  }

  // Move to Main Screen
  showScreen('main');
  startTimerAndSync();
}

// Start Timer, Heartbeat and Polling
function startTimerAndSync() {
  // 1-second Local Timer
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    state.totalSeconds++;
    updateTimerDisplay();
  }, 1000);

  // 10-second Heartbeat
  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  sendHeartbeat();
  state.heartbeatInterval = setInterval(sendHeartbeat, 10000);

  // Realtime Firestore Listener or 5-second Participants Polling
  if (window.db) {
    try {
      window.db.collection('study_records').onSnapshot((querySnapshot) => {
        const now = Date.now();
        const records = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data && data.study_day === state.studyDay && data.nickname) {
            const lastSeen = data.last_seen || 0;
            const isOnline = Boolean(data.is_online) && (now - lastSeen < 60000);
            records.push({
              id: doc.id,
              nickname: data.nickname,
              total_seconds: data.total_seconds || 0,
              avatar: data.avatar || '🌱',
              is_online: isOnline,
              peer_id: data.peer_id || '',
              last_seen: lastSeen
            });
          }
        });
        state.participants = records;
        renderCardStrip(records);
        updateOnlineCount(records);

        // Attempt P2P WebRTC calls to other online peers
        records.forEach(p => {
          if (p.is_online && p.nickname !== state.nickname && p.peer_id) {
            connectToRemotePeer(p.peer_id);
          }
        });
      }, (error) => {
        console.warn('Firestore onSnapshot error, falling back to polling:', error);
        if (state.pollInterval) clearInterval(state.pollInterval);
        fetchAndRenderParticipants();
        state.pollInterval = setInterval(fetchAndRenderParticipants, 5000);
      });
    } catch (e) {
      console.warn('Firestore listener setup failed:', e);
      fetchAndRenderParticipants();
      if (state.pollInterval) clearInterval(state.pollInterval);
      state.pollInterval = setInterval(fetchAndRenderParticipants, 5000);
    }
  } else {
    if (state.pollInterval) clearInterval(state.pollInterval);
    fetchAndRenderParticipants();
    state.pollInterval = setInterval(fetchAndRenderParticipants, 5000);
  }
}

// Send Heartbeat to Server / Firestore
async function sendHeartbeat() {
  if (!state.recordId) return;

  if (window.db) {
    try {
      await window.db.collection('study_records').doc(state.recordId).set({
        nickname: state.nickname,
        study_day: state.studyDay,
        avatar: state.avatar,
        total_seconds: state.totalSeconds,
        is_online: true,
        peer_id: state.peerId || '',
        last_seen: Date.now()
      }, { merge: true });
    } catch (fsErr) {
      console.warn('Firestore heartbeat error:', fsErr);
    }
  }

  try {
    await fetch(`/tables/study_records/${state.recordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_seconds: state.totalSeconds,
        is_online: true,
        peer_id: state.peerId || '',
        last_seen: Date.now()
      })
    });
  } catch (err) {
    // Ignore REST failure on static hosts
  }
}

// Fetch and Render Study Group Participants
async function fetchAndRenderParticipants() {
  let records = [];
  try {
    const res = await fetch(`/tables/study_records?study_day=${state.studyDay}`);
    if (res.ok) {
      const data = await res.json();
      records = data.records || data.data || [];
    }
  } catch (err) {
    console.warn('Error fetching participants (static host fallback):', err);
  }

  state.participants = records;
  renderCardStrip(records);
  updateOnlineCount(records);

  // Connect to peers in polling fallback
  records.forEach(p => {
    if (p.is_online && p.nickname !== state.nickname && p.peer_id) {
      connectToRemotePeer(p.peer_id);
    }
  });
}

// Render User Cards Horizontal Strip
function renderCardStrip(records) {
  const cardStrip = document.getElementById('card-strip');
  if (!cardStrip) return;

  // Make sure my record is present
  const myRecordInList = records.some(r => r.nickname === state.nickname);
  if (!myRecordInList) {
    records.unshift({
      id: state.recordId || 'me',
      nickname: state.nickname,
      total_seconds: state.totalSeconds,
      avatar: state.avatar,
      is_online: true,
      peer_id: state.peerId || ''
    });
  }

  cardStrip.innerHTML = '';

  records.forEach(user => {
    const isMe = user.nickname === state.nickname;
    const card = document.createElement('div');
    card.className = `user-card ${isMe ? 'is-me' : ''}`;
    card.setAttribute('data-peer-id', user.peer_id || '');
    card.setAttribute('data-nickname', user.nickname);

    const displayTime = isMe ? formatTime(state.totalSeconds) : formatTime(user.total_seconds || 0);

    card.innerHTML = `
      <div class="card-user-tag">
        <div class="user-name-box">
          <span class="user-avatar">${user.avatar || '🌱'}</span>
          <span class="user-name" title="${user.nickname}">${user.nickname}</span>
          ${isMe ? '<span class="me-badge">나</span>' : ''}
        </div>
        <span class="user-time">${displayTime}</span>
      </div>
      <div class="card-media">
        <div class="cam-half">
          <video class="cam-video" autoplay muted playsinline></video>
          <span class="half-label"><i class="fa-solid fa-video"></i> 웹캠</span>
        </div>
        <div class="screen-half">
          <video class="screen-video" autoplay muted playsinline></video>
          <span class="half-label"><i class="fa-solid fa-display"></i> 모니터 화면</span>
        </div>
      </div>
    `;

    // Video streams attachment
    const camVideo = card.querySelector('.cam-video');
    const screenVideo = card.querySelector('.screen-video');

    if (isMe) {
      if (camVideo && state.camStream) camVideo.srcObject = state.camStream;
      if (screenVideo && state.screenStream) screenVideo.srcObject = state.screenStream;
    } else {
      const remoteStream = state.remoteStreams[user.peer_id] || state.remoteStreams[user.nickname];
      if (remoteStream) {
        const tracks = remoteStream.getVideoTracks();
        if (tracks.length > 0) {
          camVideo.srcObject = new MediaStream([tracks[0]]);
        }
        if (tracks.length > 1) {
          screenVideo.srcObject = new MediaStream([tracks[1]]);
        } else {
          screenVideo.srcObject = createMockStream(`${user.nickname} 화면`, '#374151');
        }
      } else {
        if (camVideo) camVideo.srcObject = createMockStream(`${user.nickname} 웹캠`, '#4b5563');
        if (screenVideo) screenVideo.srcObject = createMockStream(`${user.nickname} 화면`, '#374151');
      }
    }

    card.addEventListener('click', () => {
      openUserDetail(user);
    });

    cardStrip.appendChild(card);
  });
}

// Dynamically update stream elements when a WebRTC call connects
function updateUserStreamsInUI(peerKey, remoteStream) {
  const cards = document.querySelectorAll('.user-card');
  cards.forEach(card => {
    const peerId = card.getAttribute('data-peer-id');
    const nickname = card.getAttribute('data-nickname');
    if (peerId === peerKey || nickname === peerKey) {
      const camVideo = card.querySelector('.cam-video');
      const screenVideo = card.querySelector('.screen-video');
      const tracks = remoteStream.getVideoTracks();
      if (tracks.length > 0 && camVideo) {
        camVideo.srcObject = new MediaStream([tracks[0]]);
      }
      if (tracks.length > 1 && screenVideo) {
        screenVideo.srcObject = new MediaStream([tracks[1]]);
      }
    }
  });
}

// Update Stream Sources on My Card
function updateMyCardStreams() {
  const myCard = document.querySelector('.user-card.is-me');
  if (myCard) {
    const camVid = myCard.querySelector('.cam-video');
    const screenVid = myCard.querySelector('.screen-video');
    if (camVid && state.camStream) camVid.srcObject = state.camStream;
    if (screenVid && state.screenStream) screenVid.srcObject = state.screenStream;
  }
}

// Update Online Count Pill
function updateOnlineCount(records) {
  const onlineCountEl = document.getElementById('online-count');
  if (onlineCountEl) {
    const onlineNum = records.filter(r => r.is_online).length;
    onlineCountEl.innerHTML = `<i class="fa-solid fa-user-group"></i> ${Math.max(1, onlineNum)}명 공부 중`;
  }
}

// Update Local Timer Display
function updateTimerDisplay() {
  const timerEl = document.getElementById('my-timer');
  if (timerEl) {
    timerEl.textContent = `⏱️ ${formatTime(state.totalSeconds)}`;
  }

  const myTimeEl = document.querySelector('.user-card.is-me .user-time');
  if (myTimeEl) {
    myTimeEl.textContent = formatTime(state.totalSeconds);
  }

  if (state.screen === 'detail' && state.detailUser && state.detailUser.nickname === state.nickname) {
    const detailTimeEl = document.getElementById('detail-time');
    if (detailTimeEl) detailTimeEl.textContent = formatTime(state.totalSeconds);
  }
}

// Open User Detail View
function openUserDetail(user) {
  state.detailUser = user;
  const isMe = user.nickname === state.nickname;

  const detailAvatar = document.getElementById('detail-avatar');
  const detailNick = document.getElementById('detail-nickname');
  const detailTime = document.getElementById('detail-time');
  const detailCam = document.getElementById('detail-cam');
  const detailScreenVideo = document.getElementById('detail-screen-video');

  if (detailAvatar) detailAvatar.textContent = user.avatar || '🌱';
  if (detailNick) detailNick.textContent = user.nickname + (isMe ? ' (나)' : '');
  if (detailTime) detailTime.textContent = formatTime(isMe ? state.totalSeconds : (user.total_seconds || 0));

  if (isMe) {
    if (detailCam && state.camStream) detailCam.srcObject = state.camStream;
    if (detailScreenVideo && state.screenStream) detailScreenVideo.srcObject = state.screenStream;
  } else {
    const remoteStream = state.remoteStreams[user.peer_id] || state.remoteStreams[user.nickname];
    if (remoteStream) {
      const tracks = remoteStream.getVideoTracks();
      if (tracks.length > 0 && detailCam) detailCam.srcObject = new MediaStream([tracks[0]]);
      if (tracks.length > 1 && detailScreenVideo) detailScreenVideo.srcObject = new MediaStream([tracks[1]]);
    } else {
      if (detailCam) detailCam.srcObject = createMockStream(`${user.nickname} 웹캠`, '#3b82f6');
      if (detailScreenVideo) detailScreenVideo.srcObject = createMockStream(`${user.nickname} 모니터`, '#10b981');
    }
  }

  showScreen('detail');
}

// Open Ranking Modal
function openRankingModal() {
  const modal = document.getElementById('record-modal');
  const rankingList = document.getElementById('ranking-list');
  if (!modal || !rankingList) return;

  const sorted = [...state.participants].sort((a, b) => (b.total_seconds || 0) - (a.total_seconds || 0));

  rankingList.innerHTML = '';

  sorted.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'ranking-item';

    let rankBadge = `${index + 1}`;
    if (index === 0) rankBadge = '🥇';
    else if (index === 1) rankBadge = '🥈';
    else if (index === 2) rankBadge = '🥉';

    const isOnline = item.is_online;

    li.innerHTML = `
      <span class="rank-num">${rankBadge}</span>
      <span class="rank-avatar">${item.avatar || '🌱'}</span>
      <span class="rank-nick">${item.nickname}</span>
      <span class="rank-status ${isOnline ? 'online' : 'offline'}" title="${isOnline ? '온라인' : '오프라인'}"></span>
      <span class="rank-time">${formatTime(item.total_seconds || 0)}</span>
    `;

    rankingList.appendChild(li);
  });

  modal.classList.remove('hidden');
}

// Close Ranking Modal
function closeRankingModal() {
  const modal = document.getElementById('record-modal');
  if (modal) modal.classList.add('hidden');
}

// Schedule Reset exactly at 4:00 AM Local Time
function scheduleNext4AMReset() {
  const now = new Date();
  const nextReset = new Date();

  nextReset.setHours(4, 0, 0, 0);
  if (now >= nextReset) {
    nextReset.setDate(nextReset.getDate() + 1);
  }

  const msUntilReset = nextReset.getTime() - now.getTime();

  if (state.resetTimeout) clearTimeout(state.resetTimeout);
  state.resetTimeout = setTimeout(() => {
    console.log('🌙 4 AM boundary reached. Resetting daily study time.');
    state.totalSeconds = 0;
    state.studyDay = getStudyDayKey();
    updateTimerDisplay();
    sendHeartbeat();
    scheduleNext4AMReset();
  }, msUntilReset);
}

// Leave Study Session
function handleLeaveStudy() {
  if (confirm('공부를 종료하고 나가시겠어요?')) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    if (state.pollInterval) clearInterval(state.pollInterval);

    if (state.recordId && window.db) {
      window.db.collection('study_records').doc(state.recordId).set({
        is_online: false,
        total_seconds: state.totalSeconds,
        last_seen: Date.now()
      }, { merge: true }).catch(() => {});
    }

    if (state.recordId) {
      fetch(`/tables/study_records/${state.recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_online: false, total_seconds: state.totalSeconds })
      }).catch(() => {});
    }

    if (state.peer) {
      try { state.peer.destroy(); } catch (e) {}
    }

    if (state.camStream) {
      state.camStream.getTracks().forEach(t => t.stop());
    }
    if (state.screenStream) {
      state.screenStream.getTracks().forEach(t => t.stop());
    }

    showScreen('permission');
  }
}
