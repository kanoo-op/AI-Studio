/**
 * music-video.js
 * 숏폼 뮤직비디오 모드
 * - 음악 재생 + VRM 모션캡처 녹화 → WebM 다운로드
 */

let els = {};
let onBackToMain = null;
let onAvatarSwitch = null;

// 상태
let musicFile = null;
let audioEl = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordStartTime = 0;
let timerInterval = null;
let selectedBg = 'dark';

// Three.js 렌더러 (외부에서 주입)
let getRenderer = null;
let getScene = null;
let getCamera = null;

let initialized = false;

export function initMusicVideo(domRefs, callbacks) {
  els = domRefs;
  onBackToMain = callbacks.onBackToMain;
  onAvatarSwitch = callbacks.onAvatarSwitch;
  getRenderer = callbacks.getRenderer;
  getScene = callbacks.getScene;
  getCamera = callbacks.getCamera;

  if (initialized) return;
  initialized = true;

  // 음악 업로드
  els.musicInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    musicFile = file;
    els.musicName.textContent = file.name;
    els.btnStart.disabled = false;

    // 오디오 엘리먼트 준비
    if (audioEl) { audioEl.pause(); audioEl = null; }
    audioEl = new Audio(URL.createObjectURL(file));
    audioEl.loop = false;
  });

  // 배경 선택
  els.bgList.addEventListener('click', (e) => {
    const btn = e.target.closest('.mv-bg-btn');
    if (!btn) return;
    selectedBg = btn.dataset.bg;
    els.bgList.querySelectorAll('.mv-bg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // 녹화 시작
  els.btnStart.addEventListener('click', startRecording);
  els.btnStop.addEventListener('click', stopRecording);
  els.btnRetry.addEventListener('click', showSetup);
  els.btnDoneMain.addEventListener('click', () => {
    cleanup();
    if (onBackToMain) onBackToMain();
  });
}

export function showMusicVideo() {
  els.mvScreen.classList.remove('hidden');
  showSetup();
}

export function hideMusicVideo() {
  cleanup();
  els.mvScreen.classList.add('hidden');
}

function showSetup() {
  cleanup();
  els.setupPanel.classList.remove('hidden');
  els.recordPanel.classList.add('hidden');
  els.donePanel.classList.add('hidden');
}

// ── 배경 색상 ──
const BG_COLORS = {
  dark: 0x1a1a2e,
  gradient: 0x0f3460,
  neon: 0x1a0033,
  stage: 0x0a0a1a,
};

function applyBackground(scene) {
  if (!scene) return;
  scene.background = new THREE.Color(BG_COLORS[selectedBg] || 0x1a1a2e);
}

import * as THREE from 'three';

// ── 녹화 시작 ──
async function startRecording() {
  if (!musicFile || !audioEl) return;

  els.setupPanel.classList.add('hidden');
  els.recordPanel.classList.remove('hidden');
  els.donePanel.classList.add('hidden');

  // 배경 적용
  const scene = getScene?.();
  applyBackground(scene);

  // 캔버스에 렌더러 연결
  const mvCanvas = els.mvCanvas;
  const container = els.recordPanel;
  const rect = container.getBoundingClientRect();

  const renderer = new THREE.WebGLRenderer({
    canvas: mvCanvas,
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true, // 녹화를 위해 필수
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(rect.width, rect.height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = getCamera?.();
  if (camera) {
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }

  // 렌더 루프 시작
  let animId = null;
  function renderLoop() {
    if (!isRecording) return;
    if (scene && camera) {
      renderer.render(scene, camera);
    }
    animId = requestAnimationFrame(renderLoop);
  }

  // MediaRecorder로 캔버스 스트림 녹화
  const canvasStream = mvCanvas.captureStream(30); // 30fps

  // 음악 오디오를 스트림에 합성
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(audioEl);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);
  source.connect(audioCtx.destination); // 스피커로도 재생

  // 캔버스 비디오 + 오디오 합성
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType: 'video/webm;codecs=vp9,opus',
    videoBitsPerSecond: 5000000, // 5Mbps
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    if (animId) cancelAnimationFrame(animId);
    renderer.dispose();
    audioCtx.close().catch(() => {});
    finishRecording();
  };

  // 음악 끝나면 자동 종료
  audioEl.onended = () => {
    if (isRecording) stopRecording();
  };

  // 시작!
  isRecording = true;
  recordStartTime = Date.now();
  mediaRecorder.start(100); // 100ms 단위로 데이터 수집
  audioEl.currentTime = 0;
  audioEl.play();
  renderLoop();
  startTimer();
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  if (audioEl) audioEl.pause();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  stopTimer();
}

function finishRecording() {
  // WebM blob 생성
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);

  // 프리뷰
  els.preview.src = url;
  els.btnDownload.href = url;

  els.recordPanel.classList.add('hidden');
  els.donePanel.classList.remove('hidden');

  // 원래 배경 복원
  const scene = getScene?.();
  if (scene) scene.background = new THREE.Color(0x1a1a2e);
}

function cleanup() {
  stopRecording();
  if (audioEl) { audioEl.pause(); }
  stopTimer();
  isRecording = false;
}

// ── 타이머 ──
function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    els.recTimer.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
  }, 500);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
