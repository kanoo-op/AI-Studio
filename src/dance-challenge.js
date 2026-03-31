/**
 * dance-challenge.js
 * 댄스 챌린지 모드 메인 로직
 *
 * 두 가지 모드:
 * 1. 프리셋/커스텀 댄스: 스켈레톤 레퍼런스 vs 유저 VRM (점수 매김)
 * 2. 영상 업로드: 영상 재생 → MediaPipe 실시간 분석 → VRM이 따라춤
 */

import { getAllDances, saveCustomDance, deleteCustomDance, PRESET_DANCES } from './dance-data.js';
import { calculateFrameScore, ComboTracker, getGrade, getScoreColor } from './dance-scorer.js';
import { SkeletonRenderer } from './dance-renderer.js';
import { DanceRecorder } from './dance-recorder.js';
import { VideoPlayer } from './dance-video-extractor.js';

// ── 상태 ──
let state = 'idle'; // idle | selecting | countdown | playing | video-playing | recording | recording-countdown | result
let selectedDanceIndex = 0;
let currentDance = null;
let playStartTime = null;
let comboTracker = null;
let skeletonRenderer = null;
let recorder = null;
let currentScore = 0;
let latestUserLandmarks = null;
let animFrameId = null;

// 영상 모드
let videoPlayer = null;
let isVideoMode = false;

// ── DOM refs ──
let els = {};

// ── 콜백 ──
let onRequestAvatarSwitch = null;
let onBackToMain = null;
let onStageVisible = null;
let onVideoAnimateVRM = null; // 영상 포즈로 VRM 애니메이션 콜백

let initialized = false;

export function initDanceChallenge(domRefs, callbacks) {
  els = domRefs;
  onRequestAvatarSwitch = callbacks.onAvatarSwitch;
  onBackToMain = callbacks.onBackToMain;
  onStageVisible = callbacks.onStageVisible;
  onVideoAnimateVRM = callbacks.onVideoAnimateVRM;

  if (!initialized) {
    initialized = true;

    skeletonRenderer = new SkeletonRenderer(els.refCanvas);
    recorder = new DanceRecorder();
    videoPlayer = new VideoPlayer();

    els.btnStart.addEventListener('click', startChallenge);
    els.btnRecord.addEventListener('click', startRecording);
    els.btnStop.addEventListener('click', () => {
      stopAll();
      showSelectionScreen();
    });
    els.btnRetry.addEventListener('click', () => showSelectionScreen());
    els.btnResultMain.addEventListener('click', () => {
      hideDanceUI();
      if (onBackToMain) onBackToMain();
    });

    // 영상 업로드
    els.videoInput.addEventListener('change', handleVideoUpload);

    // 속도 조절
    els.hudSpeed.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value);
      if (videoPlayer && videoPlayer.videoEl) {
        videoPlayer.videoEl.playbackRate = rate;
      }
    });
  }

  buildDanceSelector();
}

export function showDanceChallenge() {
  els.danceScreen.classList.remove('hidden');
  showSelectionScreen();
}

export function hideDanceUI() {
  stopAll();
  els.danceScreen.classList.add('hidden');
  state = 'idle';
}

export function updateUserLandmarks(poseLandmarks) {
  latestUserLandmarks = poseLandmarks;

  if (state === 'recording' && recorder.isRecording) {
    const stillRecording = recorder.addFrame(poseLandmarks);
    if (!stillRecording) finishRecording();
  }
}

// ══════════════════════════════════════
// 영상 업로드 → 실시간 따라하기 모드
// ══════════════════════════════════════
async function handleVideoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const overlay = els.extractOverlay;
  const statusEl = els.extractStatus;
  const barEl = els.extractBar;

  overlay.classList.remove('hidden');
  statusEl.textContent = 'MediaPipe 모델 로딩 중...';
  barEl.style.width = '0%';

  try {
    await videoPlayer.init();

    statusEl.textContent = '영상 로딩 중...';
    barEl.style.width = '50%';

    const refVideo = els.refVideo;
    await videoPlayer.loadVideo(file, refVideo);

    barEl.style.width = '100%';
    statusEl.textContent = '준비 완료!';

    setTimeout(() => {
      overlay.classList.add('hidden');
      startVideoChallenge();
    }, 500);

  } catch (err) {
    console.error('[Video]', err);
    statusEl.textContent = err.message || '영상 로드 실패';
    setTimeout(() => overlay.classList.add('hidden'), 3000);
  }
}

async function startVideoChallenge() {
  isVideoMode = true;

  els.selectionPanel.classList.add('hidden');
  els.playPanel.classList.remove('hidden');
  els.resultPanel.classList.add('hidden');

  resizeRefCanvas();
  if (onStageVisible) onStageVisible();

  // 레퍼런스 영상 표시
  els.refVideo.classList.remove('hidden');
  els.refCanvas.style.display = 'none';

  // 영상의 포즈 → VRM에 적용하는 콜백 연결
  videoPlayer.onPoseDetected = (results) => {
    if (onVideoAnimateVRM) onVideoAnimateVRM(results);
  };

  state = 'countdown';

  // 카운트다운 (영상 모드에서는 스켈레톤 카운트다운 스킵)
  els.hudScore.textContent = '';
  els.hudCombo.textContent = '';
  els.hudTimer.textContent = '';
  els.scoreBar.style.width = '0%';

  // 3... 2... 1... 카운트다운
  for (let i = 3; i > 0; i--) {
    els.hudTimer.textContent = `${i}...`;
    await new Promise(r => setTimeout(r, 1000));
  }
  els.hudTimer.textContent = 'START!';
  await new Promise(r => setTimeout(r, 500));

  // 영상 재생 시작
  state = 'video-playing';
  els.hudSpeed.classList.remove('hidden');
  els.hudSpeed.value = '1';
  els.hudStartLabel.classList.remove('hidden');

  const startSec = parseFloat(els.hudStartTime.value) || 0;
  await videoPlayer.init();
  await videoPlayer.play(startSec);
  videoPlayLoop();
}

function videoPlayLoop() {
  if (state !== 'video-playing') return;

  const currentMs = videoPlayer.getCurrentTime();
  const durationMs = videoPlayer.getDuration();
  const remaining = Math.max(0, Math.ceil((durationMs - currentMs) / 1000));

  els.hudScore.textContent = '♪';
  els.hudScore.style.color = '#00e5ff';
  els.hudCombo.textContent = '';
  els.hudTimer.textContent = `${remaining}초`;

  // 진행 바
  const progress = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;
  els.scoreBar.style.width = `${progress}%`;
  els.scoreBar.style.background = '#00bfff';

  animFrameId = requestAnimationFrame(videoPlayLoop);
}

// ══════════════════════════════════════
// 기존 프리셋 댄스 챌린지
// ══════════════════════════════════════
function buildDanceSelector() {
  const list = els.danceList;
  list.innerHTML = '';
  const dances = getAllDances();
  const presetCount = PRESET_DANCES.length;

  if (selectedDanceIndex >= dances.length) {
    selectedDanceIndex = Math.max(0, dances.length - 1);
  }

  dances.forEach((dance, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'dance-select-item';

    const btn = document.createElement('button');
    btn.className = 'dance-select-btn' + (idx === selectedDanceIndex ? ' active' : '');
    btn.textContent = dance.name;
    btn.addEventListener('click', () => {
      selectedDanceIndex = idx;
      list.querySelectorAll('.dance-select-btn').forEach((b) => {
        b.classList.remove('active');
      });
      btn.classList.add('active');
    });
    wrapper.appendChild(btn);

    // 커스텀 댄스만 삭제 버튼 표시
    if (idx >= presetCount) {
      const delBtn = document.createElement('button');
      delBtn.className = 'dance-delete-btn';
      delBtn.textContent = '\u00D7';
      delBtn.title = '삭제';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const customIdx = idx - presetCount;
        deleteCustomDance(customIdx);
        if (selectedDanceIndex >= dances.length - 1) {
          selectedDanceIndex = Math.max(0, selectedDanceIndex - 1);
        }
        buildDanceSelector();
      });
      wrapper.appendChild(delBtn);
    }

    list.appendChild(wrapper);
  });
}

function showSelectionScreen() {
  stopAll();
  buildDanceSelector();
  els.selectionPanel.classList.remove('hidden');
  els.playPanel.classList.add('hidden');
  els.resultPanel.classList.add('hidden');
  state = 'selecting';

  resizeRefCanvas();
  skeletonRenderer.drawIdle('댄스를 선택하고 시작하세요');
}

async function startChallenge() {
  const dances = getAllDances();
  if (selectedDanceIndex >= dances.length) return;

  isVideoMode = false;
  currentDance = dances[selectedDanceIndex];
  comboTracker = new ComboTracker(80);

  els.selectionPanel.classList.add('hidden');
  els.playPanel.classList.remove('hidden');
  els.resultPanel.classList.add('hidden');

  hideRefVideo();
  resizeRefCanvas();
  if (onStageVisible) onStageVisible();

  state = 'countdown';
  await doCountdown();

  state = 'playing';
  playStartTime = performance.now();
  currentScore = 0;
  playLoop();
}

// ── 커스텀 녹화 ──
async function startRecording() {
  isVideoMode = false;

  els.selectionPanel.classList.add('hidden');
  els.playPanel.classList.remove('hidden');
  els.resultPanel.classList.add('hidden');

  hideRefVideo();
  resizeRefCanvas();
  if (onStageVisible) onStageVisible();
  state = 'recording-countdown';

  await doCountdown();

  state = 'recording';
  recorder.start(15000);
  recordLoop();
}

function recordLoop() {
  if (state !== 'recording') return;

  const progress = recorder.getProgress();
  const remaining = Math.ceil((1 - progress) * 15);

  els.hudScore.textContent = 'REC';
  els.hudScore.style.color = '#ff4444';
  els.hudCombo.textContent = '';
  els.hudTimer.textContent = `${remaining}초`;
  els.scoreBar.style.width = `${progress * 100}%`;
  els.scoreBar.style.background = '#ff4444';

  if (latestUserLandmarks) {
    skeletonRenderer.lineColor = '#ff4444';
    skeletonRenderer.jointColor = '#ff6666';
    skeletonRenderer.drawSkeleton(latestUserLandmarks);
    skeletonRenderer.lineColor = '#00bfff';
    skeletonRenderer.jointColor = '#00e5ff';
  } else {
    skeletonRenderer.drawIdle('카메라를 시작해주세요');
  }

  if (recorder.isRecording) {
    animFrameId = requestAnimationFrame(recordLoop);
  } else {
    finishRecording();
  }
}

function finishRecording() {
  recorder.stop();
  const data = recorder.getData();

  if (data.frames.length > 10) {
    saveCustomDance(data);
    alert(`녹화 완료! "${data.name}" 저장됨 (${data.frames.length}프레임)`);
  } else {
    alert('녹화된 프레임이 너무 적습니다. 카메라가 켜져 있는지 확인해주세요.');
  }

  showSelectionScreen();
}

// ── 카운트다운 ──
function doCountdown() {
  return new Promise((resolve) => {
    let count = 3;
    els.hudScore.textContent = '';
    els.hudCombo.textContent = '';
    els.hudTimer.textContent = '';
    els.scoreBar.style.width = '0%';

    function tick() {
      if (count > 0) {
        skeletonRenderer.drawCountdown(count.toString());
        count--;
        setTimeout(tick, 1000);
      } else {
        skeletonRenderer.drawCountdown('START!');
        setTimeout(resolve, 500);
      }
    }
    tick();
  });
}

// ── 프리셋 재생 루프 ──
function playLoop() {
  if (state !== 'playing') return;

  const elapsed = performance.now() - playStartTime;
  const durationMs = currentDance.duration_ms;

  if (elapsed >= durationMs) {
    finishChallenge();
    return;
  }

  const refFrame = getRefFrame(elapsed);
  if (refFrame) {
    skeletonRenderer.drawSkeleton(refFrame.poseLandmarks);
  }

  if (refFrame && latestUserLandmarks) {
    currentScore = calculateFrameScore(refFrame.poseLandmarks, latestUserLandmarks);
    comboTracker.update(currentScore, elapsed);
  }

  const remaining = Math.ceil((durationMs - elapsed) / 1000);
  els.hudScore.textContent = `${Math.round(currentScore)}`;
  els.hudScore.style.color = getScoreColor(currentScore);

  if (comboTracker.currentCombo > 0) {
    els.hudCombo.textContent = `x${comboTracker.currentCombo + 1}!`;
    els.hudCombo.classList.add('combo-active');
  } else {
    els.hudCombo.textContent = '';
    els.hudCombo.classList.remove('combo-active');
  }

  els.hudTimer.textContent = `${remaining}초`;
  els.scoreBar.style.width = `${currentScore}%`;
  els.scoreBar.style.background = getScoreColor(currentScore);

  animFrameId = requestAnimationFrame(playLoop);
}

function getRefFrame(elapsedMs) {
  if (!currentDance || !currentDance.frames.length) return null;

  const frames = currentDance.frames;
  let lo = 0, hi = frames.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestamp_ms < elapsedMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return frames[lo];
}

// ── 챌린지 결과 ──
function finishChallenge() {
  state = 'result';

  const result = comboTracker.finalize();
  const grade = getGrade(result.averageScore);

  els.playPanel.classList.add('hidden');
  els.resultPanel.classList.remove('hidden');

  els.resultScore.textContent = result.averageScore.toFixed(1);
  els.resultGrade.textContent = `${grade.grade}등급 - ${grade.label}`;
  els.resultGrade.style.color = grade.color;
  els.resultCombo.textContent = `x${result.maxCombo}`;
  els.resultAvg.textContent = result.averageScore.toFixed(1);

  drawSectionGraph(result.sectionScores);
}

function drawSectionGraph(sections) {
  const container = els.resultGraph;
  container.innerHTML = '';

  if (sections.length === 0) return;

  sections.forEach((score, i) => {
    const bar = document.createElement('div');
    bar.className = 'section-bar';
    bar.style.height = `${score}%`;
    bar.style.background = getScoreColor(score);
    bar.title = `구간 ${i + 1}: ${score}점`;
    container.appendChild(bar);
  });
}

// ── 레퍼런스 비디오 ──
function hideRefVideo() {
  const video = els.refVideo;
  if (!video) return;
  video.pause();
  video.classList.add('hidden');
  els.refCanvas.style.display = '';
}

// ── 공통 ──
function resizeRefCanvas() {
  const container = els.refCanvasContainer;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  skeletonRenderer.resize(rect.width, rect.height);
}

function stopAll() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (recorder && recorder.isRecording) recorder.stop();
  if (videoPlayer) {
    videoPlayer.stop();
    videoPlayer.onPoseDetected = null;
  }
  if (els.hudSpeed) els.hudSpeed.classList.add('hidden');
  if (els.hudStartLabel) els.hudStartLabel.classList.add('hidden');
  hideRefVideo();
  isVideoMode = false;
  state = 'idle';
}

window.addEventListener('resize', () => {
  if (state === 'playing' || state === 'recording' || state === 'countdown' || state === 'video-playing') {
    resizeRefCanvas();
  }
});
