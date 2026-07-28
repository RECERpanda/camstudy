/* ☀️ 캠스터디 (Camstudy) — Client Application Logic with PeerJS WebRTC & Firestore */

// Application State
const state = {
  screen: 'permission', // 'permission' | 'nickname' | 'main' | 'detail'
  camStream: null,
  screenStream: null,
  myCombinedStream: null,
  nickname: '',
  recordId: null,
  totalSeconds: 0,
  studyDay: '',
  avatar: '🌱',
  participants: [],
  timerInterval: null,
  heartbeatInterval: null,
  pollInterval: null,
  unsubscribeFirestore: null,
  resetTimeout: null,
  detailUser: null,
  peer: null,
  peerId: null,
  calls: {},
  remoteStreams: {},
  webcamVideo: null,
  screenVideo: null,
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
  canvas.width = 400;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  let angle = 0;

  function draw() {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = color;
    ctx.font = 'bold 20px "Jua", sans-serif';
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

// Secret Room ID & Peer List for Password-less Multi-user Connection
const SECRET_ROOM_ID = "korean-student-study-room-777";
let connectedPeers = new Set();

// Create Combined Canvas Stream (Webcam + Screen) with Mirror Effect & 16:9 Aspect Ratios
function drawCanvasCombinedStream() {
  if (!state.webcamVideo) {
    state.webcamVideo = document.createElement('video');
    if (state.camStream) state.webcamVideo.srcObject = state.camStream;
    state.webcamVideo.autoplay = true;
    state.webcamVideo.playsInline = true;
    state.webcamVideo.muted = true;
  }

  if (!state.screenVideo) {
    state.screenVideo = document.createElement('video');
    if (state.screenStream) state.screenVideo.srcObject = state.screenStream;
    state.screenVideo.autoplay = true;
    state.screenVideo.playsInline = true;
    state.screenVideo.muted = true;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');
  const halfH = canvas.height / 2;

  function drawCombined() {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1. Draw Webcam (Top half: 0, 0, 480, 320) - HORIZONTALLY FLIPPED (웹캠 좌우 반전 거울 효과)
    if (state.webcamVideo && state.webcamVideo.readyState >= 2) {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(state.webcamVideo, 0, 0, canvas.width, halfH);
      ctx.restore();
    }

    // 2. Draw Screen Share (Bottom half: 0, 320, 480, 320) - NORMAL (모니터 화면 정방향)
    if (state.screenVideo && state.screenVideo.readyState >= 2) {
      ctx.drawImage(state.screenVideo, 0, halfH, canvas.width, halfH);
    }

    // 3. Text overlays
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(12, 12, 220, 30);
    ctx.fillRect(12, halfH + 12, 140, 30);

    ctx.fillStyle = "white";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText((state.nickname || '나') + " 님의 웹캠", 22, 32);
    ctx.fillText("모니터 화면", 22, halfH + 32);

    requestAnimationFrame(drawCombined);
  }
  drawCombined();

  state.myCombinedStream = canvas.captureStream(30);
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
function initApp() {
  state.studyDay = getStudyDayKey();
  setupEventListeners();
  scheduleNext4AMReset();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

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

  // Connect to Friend Button
  const connectBtn = document.getElementById('connect-friend-btn');
  const friendInput = document.getElementById('friend-id-input');
  if (connectBtn) connectBtn.addEventListener('click', () => connectToFriend());
  if (friendInput) {
    friendInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') connectToFriend();
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

// Step 1: Request Webcam Permission
async function handleRequestPermissions() {
  const permCamStatus = document.querySelector('#perm-cam .perm-status');
  const permErr = document.getElementById('permission-error');
  if (permErr) permErr.classList.add('hidden');

  try {
    if (navigator?.mediaDevices?.getUserMedia) {
      state.camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (permCamStatus) {
        permCamStatus.textContent = '승인됨';
        permCamStatus.className = 'perm-status approved';
      }
    } else {
      throw new Error('getUserMedia not supported');
    }
  } catch (err) {
    console.warn('Webcam permission denied or error:', err);
    state.camStream = createMockStream('내 웹캠', '#3b82f6');
    if (permCamStatus) {
      permCamStatus.textContent = '시뮬레이션 사용';
      permCamStatus.className = 'perm-status approved';
    }
  }

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

  try {
    if (navigator?.mediaDevices?.getDisplayMedia) {
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
          if (state.screenVideo) state.screenVideo.srcObject = state.screenStream;
        };
      }
    } else {
      throw new Error('getDisplayMedia not supported');
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

// Global functions exposure
window.handleRequestPermissions = handleRequestPermissions;
window.handleRequestScreenShare = handleRequestScreenShare;
window.handleStartStudy = handleStartStudy;
window.handleLeaveStudy = handleLeaveStudy;
window.openRankingModal = openRankingModal;
window.closeRankingModal = closeRankingModal;
window.connectToFriend = connectToFriend;
window.showScreen = showScreen;

// PeerJS Automatic Room Connection (Secret ID + Peer Fallback)
function initPeerJS() {
  if (typeof Peer === 'undefined') {
    console.warn('PeerJS library is not available in browser.');
    return;
  }

  const idDisplay = document.getElementById('my-id-display');
  const statusEl = document.getElementById('connection-status');
  if (statusEl) statusEl.innerText = "비밀 아지트 연결 시도 중...";

  try {
    if (state.peer) {
      try { state.peer.destroy(); } catch (e) {}
    }

    // 1. 비밀 고정 ID로 방장 접속 시도
    state.peer = new Peer(SECRET_ROOM_ID);

    state.peer.on('open', (id) => {
      console.log('⭐ 내가 1호 접속자(방장)입니다! ID:', id);
      state.peerId = id;
      if (idDisplay) idDisplay.innerText = id;
      if (statusEl) {
        statusEl.innerText = "⭐ 스터디 방장(1호) 접속 완료!";
        statusEl.style.background = "#dbeafe";
        statusEl.style.color = "#1d4ed8";
      }
      sendHeartbeat();

      // 전화를 거는 스터디원들에게 화면 전달
      state.peer.on('call', (call) => {
        console.log('📞 Participant joined:', call.peer);
        call.answer(state.myCombinedStream);
        call.on('stream', (remoteStream) => {
          addRemoteVideo(remoteStream, call.peer);
        });
      });

      // 새로운 스터디원 접속 시 기존 멤버 목록 전송
      state.peer.on('connection', (conn) => {
        conn.on('open', () => {
          conn.send(Array.from(connectedPeers));
          connectedPeers.add(conn.peer);
        });
      });
    });

    state.peer.on('error', (err) => {
      // 2. 이미 방장이 있다면 (unavailable-id 에러 발생)
      if (err.type === 'unavailable-id') {
        console.log('🌱 이미 방이 존재합니다. 일반 스터디원으로 자동 접속합니다.');

        const randomStr = Math.random().toString(36).substring(2, 7);
        const myRandomId = 'study-user-' + randomStr;

        state.peer = new Peer(myRandomId);

        state.peer.on('open', (assignedId) => {
          console.log('🌱 스터디원 접속 완료! ID:', assignedId);
          state.peerId = assignedId;
          if (idDisplay) idDisplay.innerText = assignedId;
          if (statusEl) {
            statusEl.innerText = "🌱 스터디원으로 자동 접속 완료!";
            statusEl.style.background = "#dcfce7";
            statusEl.style.color = "#15803d";
          }
          sendHeartbeat();

          // 1호 접속자(방장)에게 전화걸기
          const callToHost = state.peer.call(SECRET_ROOM_ID, state.myCombinedStream);
          if (callToHost) {
            callToHost.on('stream', (remoteStream) => {
              addRemoteVideo(remoteStream, SECRET_ROOM_ID);
            });
          }

          // 1호 접속자에게 다른 멤버들의 목록을 받아서 각각 전화걸기
          const conn = state.peer.connect(SECRET_ROOM_ID);
          if (conn) {
            conn.on('open', () => {
              conn.on('data', (otherPeers) => {
                if (Array.isArray(otherPeers)) {
                  otherPeers.forEach(otherId => {
                    if (otherId !== assignedId) {
                      const call = state.peer.call(otherId, state.myCombinedStream);
                      if (call) {
                        call.on('stream', (remoteStream) => addRemoteVideo(remoteStream, otherId));
                      }
                    }
                  });
                }
              });
            });
          }
        });

        // 다른 멤버들이 나에게 전화걸 때 수락
        state.peer.on('call', (call) => {
          call.answer(state.myCombinedStream);
          call.on('stream', (remoteStream) => addRemoteVideo(remoteStream, call.peer));
        });
      } else {
        console.warn('PeerJS Error:', err);
        if (statusEl) statusEl.innerText = "접속 상태: " + err.type;
      }
    });
  } catch (err) {
    console.warn('PeerJS setup failed:', err);
  }
}

// Connect to Friend function (Directly based on user txt source)
function connectToFriend(friendId) {
  if (!friendId) {
    const friendInput = document.getElementById('friend-id-input');
    if (friendInput) friendId = friendInput.value.trim();
  }

  if (!friendId) return alert("친구 ID를 입력해 줘!");
  if (!state.peer || friendId === state.peerId) return;
  if (state.calls[friendId]) return;

  const statusEl = document.getElementById('connection-status');
  if (statusEl) statusEl.innerText = "친구에게 연결 중...";

  try {
    const call = state.peer.call(friendId, state.myCombinedStream);
    if (call) {
      state.calls[friendId] = call;
      call.on('stream', (remoteStream) => {
        console.log('📹 Connected to friend stream:', friendId);
        if (statusEl) statusEl.innerText = "친구와 연결 성공!";
        addRemoteVideo(remoteStream, friendId);
      });

      call.on('close', () => {
        delete state.calls[friendId];
        delete state.remoteStreams[friendId];
        renderCardStrip(state.participants);
      });

      call.on('error', (err) => {
        console.warn('Outgoing call error:', err);
        delete state.calls[friendId];
      });
    }
  } catch (err) {
    console.warn('Error calling friend:', friendId, err);
  }
}

// Add Remote Video Stream to State and Re-render Cards
function addRemoteVideo(stream, peerId) {
  state.remoteStreams[peerId] = stream;
  renderCardStrip(state.participants);
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

  // Cleanup existing session if re-logging in
  if (state.unsubscribeFirestore) {
    try { state.unsubscribeFirestore(); } catch(e) {}
    state.unsubscribeFirestore = null;
  }
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  if (state.pollInterval) clearInterval(state.pollInterval);
  state.calls = {};
  state.remoteStreams = {};

  state.nickname = rawNickname;
  state.avatar = getAvatarForNickname(rawNickname);
  state.studyDay = getStudyDayKey();

  // Create combined canvas stream (Webcam top, Screen bottom with text overlays)
  drawCanvasCombinedStream();

  // Initialize PeerJS WebRTC
  initPeerJS();

  // Sync / Create user record via Firestore
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

  // Realtime Firestore Listener
  if (window.db) {
    try {
      if (state.unsubscribeFirestore) {
        try { state.unsubscribeFirestore(); } catch(e) {}
        state.unsubscribeFirestore = null;
      }

      state.unsubscribeFirestore = window.db.collection('study_records').onSnapshot((querySnapshot) => {
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

        // Auto-connect to online peers in room
        records.forEach(p => {
          if (p.is_online && p.nickname !== state.nickname && p.peer_id) {
            connectToFriend(p.peer_id);
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

  // Auto-connect to peers in polling fallback
  records.forEach(p => {
    if (p.is_online && p.nickname !== state.nickname && p.peer_id) {
      connectToFriend(p.peer_id);
    }
  });
}

// Render User Cards Horizontal Strip (Using Combined Stream Video Element)
function renderCardStrip(records) {
  const cardStrip = document.getElementById('card-strip');
  if (!cardStrip) return;

  // Filter only active online users or current user
  const onlineRecords = records.filter(user => {
    const isMe = user.nickname === state.nickname;
    return isMe || Boolean(user.is_online);
  });

  // Make sure my record is present
  const myRecordInList = onlineRecords.some(r => r.nickname === state.nickname);
  if (!myRecordInList && state.nickname) {
    onlineRecords.unshift({
      id: state.recordId || 'me',
      nickname: state.nickname,
      total_seconds: state.totalSeconds,
      avatar: state.avatar,
      is_online: true,
      peer_id: state.peerId || ''
    });
  }

  cardStrip.innerHTML = '';

  onlineRecords.forEach(user => {
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
        <video class="combined-video" autoplay muted playsinline style="width:100%; height:100%; object-fit:cover; background:#000;"></video>
      </div>
    `;

    const videoEl = card.querySelector('.combined-video');

    if (isMe) {
      if (videoEl && state.myCombinedStream) {
        videoEl.srcObject = state.myCombinedStream;
      }
    } else {
      const remoteStream = state.remoteStreams[user.peer_id] || state.remoteStreams[user.nickname] || state.remoteStreams[user.id];
      if (remoteStream && videoEl) {
        videoEl.srcObject = remoteStream;
      } else if (videoEl) {
        videoEl.srcObject = createMockStream(`${user.nickname} 화면`, '#3b82f6');
      }
    }

    card.addEventListener('click', () => {
      openUserDetail(user);
    });
    card.addEventListener('dblclick', () => {
      openUserDetail(user);
    });

    cardStrip.appendChild(card);
  });
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
    const remoteStream = state.remoteStreams[user.peer_id] || state.remoteStreams[user.nickname] || state.remoteStreams[user.id];
    if (remoteStream) {
      if (detailCam) detailCam.srcObject = remoteStream;
      if (detailScreenVideo) detailScreenVideo.srcObject = remoteStream;
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

    if (state.unsubscribeFirestore) {
      try { state.unsubscribeFirestore(); } catch(e) {}
      state.unsubscribeFirestore = null;
    }

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
      state.peer = null;
      state.peerId = null;
    }

    if (state.camStream) {
      state.camStream.getTracks().forEach(t => t.stop());
      state.camStream = null;
    }
    if (state.screenStream) {
      state.screenStream.getTracks().forEach(t => t.stop());
      state.screenStream = null;
    }
    state.myCombinedStream = null;

    // Reset session states
    state.recordId = null;
    state.nickname = '';
    state.totalSeconds = 0;
    state.participants = [];
    state.calls = {};
    state.remoteStreams = {};
    state.webcamVideo = null;
    state.screenVideo = null;

    const cardStrip = document.getElementById('card-strip');
    if (cardStrip) cardStrip.innerHTML = '';

    showScreen('permission');
  }
}
