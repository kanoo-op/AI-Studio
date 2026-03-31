import * as THREE from 'three';
import { createScene } from './scene.js';
import { loadVRM, disposeVRM } from './vrm-loader.js';
import { initHolistic, startCamera, stopCamera } from './motion-capture.js';
import { animateVRM, startCalibration, resetCalibration, isCalibrated } from './avatar-animator.js';
import { initDanceChallenge, showDanceChallenge, hideDanceUI, updateUserLandmarks } from './dance-challenge.js';
import { initMusicVideo, showMusicVideo, hideMusicVideo } from './music-video.js';

// ── 아바타 목록 ──
// rotationY: vrm-loader가 Math.PI를 적용한 뒤 추가 보정값 (2,3,4번은 정면 반전)
const AVATARS = [
  { id: '7643054104406740418', name: 'Avatar 1 (0.x)', file: '/models/7643054104406740418.vrm', rotationY: 0 },
  { id: '1087600300176247011', name: 'Avatar 2', file: '/models/1087600300176247011.vrm', rotationY: Math.PI },
  { id: '3757658729595240240', name: 'Avatar 3', file: '/models/3757658729595240240.vrm', rotationY: Math.PI },
  { id: '5447297406763866907', name: 'Avatar 4', file: '/models/5447297406763866907.vrm', rotationY: Math.PI },
];

// ── DOM 요소 ──
const modeSelectScreen = document.getElementById('mode-select-screen');
const studioScreen = document.getElementById('studio-screen');
const danceScreen = document.getElementById('dance-screen');

const canvas = document.getElementById('avatar-canvas');
const videoEl = document.getElementById('webcam');
const statusOverlay = document.getElementById('status-overlay');
const statusText = document.getElementById('status-text');
const trackingBadge = document.getElementById('tracking-status');
const fpsCounter = document.getElementById('fps-counter');
const btnToggleCam = document.getElementById('btn-toggle-cam');
const btnCalibrate = document.getElementById('btn-calibrate');
const btnCalibrateReset = document.getElementById('btn-calibrate-reset');
const avatarList = document.getElementById('avatar-list');
const btnBackMain = document.getElementById('btn-back-main');

const mvScreen = document.getElementById('mv-screen');
const btnModeStudio = document.getElementById('btn-mode-studio');
const btnModedance = document.getElementById('btn-mode-dance');
const btnModeMV = document.getElementById('btn-mode-mv');
const btnDanceBack = document.getElementById('btn-dance-back');

// ── 상태 ──
let currentVrm = null;
let currentScene = null;
let sceneObjects = null; // { renderer, scene, camera, controls }
let isCameraRunning = false;
let holistic = null;
let currentMode = 'select'; // select | studio | dance
let isInitialized = false;

// 댄스 챌린지용 Three.js (VRM 우측 표시)
let danceRenderer = null;
let danceAnimFrameId = null;

// ── FPS 카운터 ──
let frameCount = 0;
let lastFpsTime = performance.now();

function updateFps() {
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsCounter.textContent = `${frameCount} FPS`;
    frameCount = 0;
    lastFpsTime = now;
  }
}

// ── 상태 표시 헬퍼 ──
function setStatus(text) {
  statusText.textContent = text;
}

function hideOverlay() {
  statusOverlay.classList.add('hidden');
}

function showOverlay() {
  statusOverlay.classList.remove('hidden');
}

// ── 아바타 선택 UI 생성 ──
function buildAvatarSelector(container) {
  container.innerHTML = '';
  AVATARS.forEach((avatar, idx) => {
    const btn = document.createElement('button');
    btn.className = 'avatar-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = avatar.name;
    btn.dataset.index = idx;
    btn.addEventListener('click', () => switchAvatar(idx));
    container.appendChild(btn);
  });
}

// ── 아바타 전환 ──
async function switchAvatar(index) {
  if (!currentScene) return;

  const avatar = AVATARS[index];
  if (currentMode === 'studio') {
    showOverlay();
    setStatus(`아바타 로딩 중... ${avatar.name}`);
  }

  disposeVRM(currentVrm, currentScene);
  currentVrm = null;

  try {
    currentVrm = await loadVRM(avatar.file, currentScene, (event) => {
      if (event.total > 0) {
        const pct = Math.round((event.loaded / event.total) * 100);
        if (currentMode === 'studio') setStatus(`아바타 로딩 중... ${pct}%`);
      }
    });

    // 아바타별 추가 Y 회전 보정 (vrm-loader의 Math.PI 위에 추가)
    if (avatar.rotationY) {
      currentVrm.scene.rotation.y += avatar.rotationY;
    }

    // 모든 아바타 선택 버튼 업데이트
    document.querySelectorAll('.avatar-btn').forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.index) === index);
    });
  } catch (err) {
    console.error('[VRM] 로딩 실패:', err);
    if (currentMode === 'studio') {
      setStatus(`로딩 실패: ${avatar.name}`);
      setTimeout(hideOverlay, 2000);
    }
    return;
  }

  if (currentMode === 'studio') hideOverlay();
}

// ── 초기화 (최초 1회) ──
async function initCore() {
  if (isInitialized) return;
  isInitialized = true;

  // 1) Three.js 씬 세팅 (스튜디오 캔버스 사용)
  const { renderer, scene, camera, controls } = createScene(canvas);
  currentScene = scene;
  sceneObjects = { renderer, scene, camera, controls };

  // 2) 첫 번째 VRM 로딩
  try {
    currentVrm = await loadVRM(AVATARS[0].file, scene, (event) => {
      if (event.total > 0) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setStatus(`VRM 로딩 중... ${pct}%`);
      }
    });
  } catch (err) {
    console.error('[VRM] 로딩 실패:', err);
    setStatus('VRM 파일을 로딩할 수 없습니다.');
    return;
  }

  // 3) MediaPipe Holistic 초기화
  setStatus('MediaPipe 모델 로딩 중...');
  holistic = initHolistic((results) => {
    // VRM 아바타 애니메이션
    animateVRM(currentVrm, results, videoEl);
    // 댄스 챌린지에 유저 랜드마크 전달
    if (results.poseLandmarks) {
      updateUserLandmarks(results.poseLandmarks);
    }
  });

  // 4) 렌더 루프
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (currentVrm) {
      currentVrm.update(delta);
    }

    if (currentMode === 'studio' && sceneObjects) {
      sceneObjects.controls.update();
      sceneObjects.renderer.render(sceneObjects.scene, sceneObjects.camera);
      updateFps();
    }

    // 댄스 모드에서도 VRM 렌더링 (우측 캔버스)
    if (currentMode === 'dance' && danceRenderer) {
      sceneObjects.controls.update();
      danceRenderer.render(sceneObjects.scene, sceneObjects.camera);
    }
  }

  animate();
  hideOverlay();
  console.log('[App] 코어 초기화 완료');
}

// ── 모드 전환 ──
function showModeSelect() {
  currentMode = 'select';
  modeSelectScreen.classList.remove('hidden');
  studioScreen.classList.add('hidden');
  danceScreen.classList.add('hidden');
  mvScreen.classList.add('hidden');
  hideDanceUI();
  hideMusicVideo();
  stopDanceRenderer();
}

async function enterStudioMode() {
  currentMode = 'studio';
  modeSelectScreen.classList.add('hidden');
  studioScreen.classList.remove('hidden');
  danceScreen.classList.add('hidden');
  mvScreen.classList.add('hidden');

  stopDanceRenderer();

  if (!isInitialized) {
    showOverlay();
    setStatus('Three.js 씬 초기화 중...');
    await initCore();
    buildAvatarSelector(avatarList);
  } else {
    // 스튜디오: 상반신 카메라 복원
    sceneObjects.camera.position.set(0, 1.4, 1.5);
    sceneObjects.controls.target.set(0, 1.0, 0);
    sceneObjects.controls.update();
    sceneObjects.renderer.setSize(window.innerWidth, window.innerHeight);
    sceneObjects.camera.aspect = window.innerWidth / window.innerHeight;
    sceneObjects.camera.updateProjectionMatrix();
  }
}

async function enterDanceMode() {
  currentMode = 'dance';
  modeSelectScreen.classList.add('hidden');
  studioScreen.classList.add('hidden');
  danceScreen.classList.remove('hidden');

  if (!isInitialized) {
    showOverlay();
    setStatus('초기화 중...');
    await initCore();
    buildAvatarSelector(avatarList);
    hideOverlay();
  }

  // 댄스 모드: 전신이 보이도록 카메라 뒤로
  sceneObjects.camera.position.set(0, 1.0, 3.0);
  sceneObjects.controls.target.set(0, 0.85, 0);
  sceneObjects.controls.update();

  // 댄스용 아바타 선택 UI
  const danceAvatarList = document.getElementById('dance-avatar-list');
  buildAvatarSelector(danceAvatarList);

  // 댄스 챌린지 모듈 초기화
  initDanceChallenge({
    danceScreen,
    selectionPanel: document.getElementById('dance-selection-panel'),
    playPanel: document.getElementById('dance-play-panel'),
    resultPanel: document.getElementById('dance-result-panel'),
    refCanvas: document.getElementById('ref-canvas'),
    refCanvasContainer: document.getElementById('ref-canvas-container'),
    danceList: document.getElementById('dance-list'),
    danceAvatarList,
    btnStart: document.getElementById('btn-dance-start'),
    btnRecord: document.getElementById('btn-dance-record'),
    btnStop: document.getElementById('btn-dance-stop'),
    btnRetry: document.getElementById('btn-retry'),
    btnResultMain: document.getElementById('btn-result-main'),
    videoInput: document.getElementById('video-upload-input'),
    extractOverlay: document.getElementById('video-extract-overlay'),
    extractStatus: document.getElementById('video-extract-status'),
    extractBar: document.getElementById('video-extract-bar'),
    refVideo: document.getElementById('ref-video'),
    hudSpeed: document.getElementById('hud-speed'),
    hudStartLabel: document.getElementById('hud-start-label'),
    hudStartTime: document.getElementById('hud-start-time'),
    hudScore: document.getElementById('hud-score'),
    hudCombo: document.getElementById('hud-combo'),
    hudTimer: document.getElementById('hud-timer'),
    scoreBar: document.getElementById('score-bar'),
    resultScore: document.getElementById('result-score'),
    resultGrade: document.getElementById('result-grade'),
    resultCombo: document.getElementById('result-combo'),
    resultAvg: document.getElementById('result-avg'),
    resultGraph: document.getElementById('result-graph'),
  }, {
    onAvatarSwitch: switchAvatar,
    onBackToMain: showModeSelect,
    onStageVisible: () => {
      if (!danceRenderer) {
        setupDanceRenderer();
      } else {
        resizeDanceRenderer();
      }
    },
    onVideoAnimateVRM: (results) => {
      // 영상의 포즈를 VRM에 바로 적용
      const refVid = document.getElementById('ref-video');
      animateVRM(currentVrm, results, refVid || videoEl);
    },
  });

  showDanceChallenge();

  // 카메라가 꺼져 있으면 자동 시작
  if (!isCameraRunning && holistic) {
    await startCameraSession();
  }
}

// ── 댄스 모드: VRM을 우측 캔버스에 렌더링 ──
function setupDanceRenderer() {
  const danceCanvas = document.getElementById('dance-avatar-canvas');
  if (!danceCanvas || !sceneObjects) return;

  danceRenderer = new THREE.WebGLRenderer({
    canvas: danceCanvas,
    alpha: true,
    antialias: true,
  });
  danceRenderer.setPixelRatio(window.devicePixelRatio);
  danceRenderer.outputColorSpace = THREE.SRGBColorSpace;

  resizeDanceRenderer();
  window.addEventListener('resize', resizeDanceRenderer);
}

function resizeDanceRenderer() {
  if (!danceRenderer) return;
  const container = document.getElementById('vrm-canvas-container');
  if (!container) return;
  const rect = container.getBoundingClientRect();
  danceRenderer.setSize(rect.width, rect.height);
  if (sceneObjects) {
    sceneObjects.camera.aspect = rect.width / rect.height;
    sceneObjects.camera.updateProjectionMatrix();
  }
}

function stopDanceRenderer() {
  if (danceRenderer) {
    danceRenderer.dispose();
    danceRenderer = null;
  }
}

// ── 카메라 세션 ──
async function startCameraSession() {
  if (!holistic) return;

  btnToggleCam.disabled = true;
  btnToggleCam.textContent = '카메라 시작 중...';

  try {
    await startCamera(videoEl, holistic);
    isCameraRunning = true;
    btnToggleCam.textContent = '카메라 중지';
    btnCalibrate.disabled = false;
    trackingBadge.textContent = '추적 중';
    trackingBadge.classList.remove('badge-off');
  } catch (err) {
    console.error('[Camera] 시작 실패:', err);
    btnToggleCam.textContent = '카메라 시작';
  }

  btnToggleCam.disabled = false;
}

// ── 캘리브레이션 ──
async function doCalibration() {
  btnCalibrate.disabled = true;
  btnCalibrate.textContent = 'T-포즈로 서세요...';

  // 3초 카운트다운
  for (let i = 3; i > 0; i--) {
    btnCalibrate.textContent = `${i}초 후 캘리브레이션...`;
    await new Promise(r => setTimeout(r, 1000));
  }

  btnCalibrate.textContent = '측정 중...';
  resetCalibration();
  await startCalibration();

  btnCalibrate.textContent = '캘리브레이션 완료!';
  btnCalibrate.classList.add('calibrated');
  btnCalibrateReset.style.display = '';

  setTimeout(() => {
    btnCalibrate.textContent = '재캘리브레이션';
    btnCalibrate.disabled = false;
  }, 1500);
}

function doCalibrateReset() {
  resetCalibration();
  btnCalibrate.textContent = '캘리브레이션';
  btnCalibrate.classList.remove('calibrated');
  btnCalibrateReset.style.display = 'none';
}

// ── 뮤직비디오 모드 ──
async function enterMVMode() {
  currentMode = 'mv';
  modeSelectScreen.classList.add('hidden');
  studioScreen.classList.add('hidden');
  danceScreen.classList.add('hidden');
  mvScreen.classList.remove('hidden');

  if (!isInitialized) {
    showOverlay();
    setStatus('초기화 중...');
    await initCore();
    buildAvatarSelector(avatarList);
    hideOverlay();
  }

  // MV용 아바타 선택
  const mvAvatarList = document.getElementById('mv-avatar-list');
  buildAvatarSelector(mvAvatarList);

  // 뮤직비디오 모듈 초기화
  initMusicVideo({
    mvScreen,
    setupPanel: document.getElementById('mv-setup-panel'),
    recordPanel: document.getElementById('mv-record-panel'),
    donePanel: document.getElementById('mv-done-panel'),
    musicInput: document.getElementById('mv-music-input'),
    musicName: document.getElementById('mv-music-name'),
    bgList: document.getElementById('mv-bg-list'),
    mvCanvas: document.getElementById('mv-canvas'),
    btnStart: document.getElementById('btn-mv-start'),
    btnStop: document.getElementById('btn-mv-stop'),
    btnRetry: document.getElementById('btn-mv-retry'),
    btnDownload: document.getElementById('btn-mv-download'),
    btnDoneMain: document.getElementById('btn-mv-done-main'),
    preview: document.getElementById('mv-preview'),
    recTimer: document.getElementById('mv-rec-timer'),
  }, {
    onBackToMain: showModeSelect,
    onAvatarSwitch: switchAvatar,
    getRenderer: () => sceneObjects?.renderer,
    getScene: () => sceneObjects?.scene,
    getCamera: () => sceneObjects?.camera,
  });

  showMusicVideo();

  // 카메라 자동 시작
  if (!isCameraRunning && holistic) {
    await startCameraSession();
  }
}

// ── 이벤트 리스너 ──
btnModeStudio.addEventListener('click', enterStudioMode);
btnModedance.addEventListener('click', enterDanceMode);
btnModeMV.addEventListener('click', enterMVMode);
btnBackMain.addEventListener('click', showModeSelect);
btnDanceBack.addEventListener('click', showModeSelect);
document.getElementById('btn-mv-back').addEventListener('click', showModeSelect);
btnCalibrate.addEventListener('click', doCalibration);
btnCalibrateReset.addEventListener('click', doCalibrateReset);

btnToggleCam.addEventListener('click', async () => {
  if (!holistic) return;

  if (!isCameraRunning) {
    await startCameraSession();
  } else {
    stopCamera();
    isCameraRunning = false;
    btnToggleCam.textContent = '카메라 시작';
    btnCalibrate.disabled = true;
    trackingBadge.textContent = '대기';
    trackingBadge.classList.add('badge-off');
  }
});

// 시작: 모드 선택 화면 표시
console.log('[App] AI Interactive Zone 시작');
