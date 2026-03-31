/**
 * dance-data.js
 * 더미 레퍼런스 댄스 데이터 생성 + localStorage 커스텀 댄스 관리
 */

// MediaPipe 33점 기본 T-포즈
function getDefaultPose() {
  // 주요 랜드마크 인덱스:
  // 0: nose, 11: left_shoulder, 12: right_shoulder
  // 13: left_elbow, 14: right_elbow, 15: left_wrist, 16: right_wrist
  // 23: left_hip, 24: right_hip, 25: left_knee, 26: right_knee
  // 27: left_ankle, 28: right_ankle
  const landmarks = [];
  for (let i = 0; i < 33; i++) {
    landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 });
  }

  // 기본 T-포즈 설정
  // 머리
  landmarks[0] = { x: 0.5, y: 0.15, z: 0, visibility: 0.99 }; // nose
  landmarks[1] = { x: 0.49, y: 0.13, z: 0, visibility: 0.99 };
  landmarks[2] = { x: 0.48, y: 0.13, z: 0, visibility: 0.99 };
  landmarks[3] = { x: 0.47, y: 0.13, z: 0, visibility: 0.99 };
  landmarks[4] = { x: 0.51, y: 0.13, z: 0, visibility: 0.99 };
  landmarks[5] = { x: 0.52, y: 0.13, z: 0, visibility: 0.99 };
  landmarks[6] = { x: 0.53, y: 0.13, z: 0, visibility: 0.99 };
  landmarks[7] = { x: 0.46, y: 0.12, z: 0, visibility: 0.99 };
  landmarks[8] = { x: 0.54, y: 0.12, z: 0, visibility: 0.99 };
  landmarks[9] = { x: 0.48, y: 0.16, z: 0, visibility: 0.99 };
  landmarks[10] = { x: 0.52, y: 0.16, z: 0, visibility: 0.99 };

  // 어깨
  landmarks[11] = { x: 0.38, y: 0.28, z: 0, visibility: 0.99 }; // left_shoulder
  landmarks[12] = { x: 0.62, y: 0.28, z: 0, visibility: 0.99 }; // right_shoulder

  // 팔
  landmarks[13] = { x: 0.28, y: 0.28, z: 0, visibility: 0.99 }; // left_elbow
  landmarks[14] = { x: 0.72, y: 0.28, z: 0, visibility: 0.99 }; // right_elbow
  landmarks[15] = { x: 0.18, y: 0.28, z: 0, visibility: 0.99 }; // left_wrist
  landmarks[16] = { x: 0.82, y: 0.28, z: 0, visibility: 0.99 }; // right_wrist

  // 손 (간략)
  landmarks[17] = { x: 0.16, y: 0.28, z: 0, visibility: 0.99 };
  landmarks[18] = { x: 0.84, y: 0.28, z: 0, visibility: 0.99 };
  landmarks[19] = { x: 0.15, y: 0.28, z: 0, visibility: 0.99 };
  landmarks[20] = { x: 0.85, y: 0.28, z: 0, visibility: 0.99 };
  landmarks[21] = { x: 0.14, y: 0.28, z: 0, visibility: 0.99 };
  landmarks[22] = { x: 0.86, y: 0.28, z: 0, visibility: 0.99 };

  // 엉덩이
  landmarks[23] = { x: 0.43, y: 0.52, z: 0, visibility: 0.99 }; // left_hip
  landmarks[24] = { x: 0.57, y: 0.52, z: 0, visibility: 0.99 }; // right_hip

  // 무릎
  landmarks[25] = { x: 0.43, y: 0.70, z: 0, visibility: 0.99 }; // left_knee
  landmarks[26] = { x: 0.57, y: 0.70, z: 0, visibility: 0.99 }; // right_knee

  // 발목
  landmarks[27] = { x: 0.43, y: 0.88, z: 0, visibility: 0.99 }; // left_ankle
  landmarks[28] = { x: 0.57, y: 0.88, z: 0, visibility: 0.99 }; // right_ankle

  // 발
  landmarks[29] = { x: 0.42, y: 0.91, z: 0, visibility: 0.99 };
  landmarks[30] = { x: 0.58, y: 0.91, z: 0, visibility: 0.99 };
  landmarks[31] = { x: 0.41, y: 0.92, z: 0, visibility: 0.99 };
  landmarks[32] = { x: 0.59, y: 0.92, z: 0, visibility: 0.99 };

  return landmarks;
}

function cloneLandmarks(landmarks) {
  return landmarks.map(l => ({ ...l }));
}

// ── 더미 댄스 1: 양팔 번갈아 올리기 ──
function generateArmWaveDance(durationMs = 15000, fps = 30) {
  const frames = [];
  const totalFrames = Math.floor(durationMs / 1000 * fps);

  for (let i = 0; i < totalFrames; i++) {
    const t = i / totalFrames;
    const landmarks = cloneLandmarks(getDefaultPose());

    // 왼팔: sin 파형으로 위아래
    landmarks[13].y = 0.28 + Math.sin(t * Math.PI * 4) * -0.15; // left_elbow
    landmarks[13].x = 0.28 + Math.sin(t * Math.PI * 4) * 0.05;
    landmarks[15].y = 0.28 + Math.sin(t * Math.PI * 4) * -0.22; // left_wrist
    landmarks[15].x = 0.18 + Math.sin(t * Math.PI * 4) * 0.05;

    // 오른팔: cos 파형으로 (반대 타이밍)
    landmarks[14].y = 0.28 + Math.cos(t * Math.PI * 4) * -0.15; // right_elbow
    landmarks[14].x = 0.72 - Math.cos(t * Math.PI * 4) * 0.05;
    landmarks[16].y = 0.28 + Math.cos(t * Math.PI * 4) * -0.22; // right_wrist
    landmarks[16].x = 0.82 - Math.cos(t * Math.PI * 4) * 0.05;

    frames.push({
      timestamp_ms: Math.round(i / fps * 1000),
      poseLandmarks: landmarks,
    });
  }

  return { name: '팔 흔들기', duration_ms: durationMs, fps, frames };
}

// ── 더미 댄스 2: 좌우 스텝 + 팔 동작 ──
function generateSideStepDance(durationMs = 15000, fps = 30) {
  const frames = [];
  const totalFrames = Math.floor(durationMs / 1000 * fps);

  for (let i = 0; i < totalFrames; i++) {
    const t = i / totalFrames;
    const landmarks = cloneLandmarks(getDefaultPose());
    const sway = Math.sin(t * Math.PI * 6) * 0.06;

    // 몸 전체 좌우 이동
    for (let j = 0; j < 33; j++) {
      landmarks[j].x += sway;
    }

    // 팔: 위로 올렸다 내렸다
    const armUp = Math.sin(t * Math.PI * 3) * 0.12;
    landmarks[13].y = 0.28 - Math.abs(armUp);
    landmarks[14].y = 0.28 - Math.abs(armUp);
    landmarks[15].y = 0.28 - Math.abs(armUp) - 0.05;
    landmarks[16].y = 0.28 - Math.abs(armUp) - 0.05;

    // 다리: 좌우 벌렸다 모았다
    const legSpread = Math.sin(t * Math.PI * 6) * 0.04;
    landmarks[27].x = 0.43 - legSpread;
    landmarks[28].x = 0.57 + legSpread;
    landmarks[25].x = 0.43 - legSpread * 0.5;
    landmarks[26].x = 0.57 + legSpread * 0.5;

    frames.push({
      timestamp_ms: Math.round(i / fps * 1000),
      poseLandmarks: landmarks,
    });
  }

  return { name: '사이드 스텝', duration_ms: durationMs, fps, frames };
}

// ── 더미 댄스 3: 전신 웨이브 ──
function generateBodyWaveDance(durationMs = 15000, fps = 30) {
  const frames = [];
  const totalFrames = Math.floor(durationMs / 1000 * fps);

  for (let i = 0; i < totalFrames; i++) {
    const t = i / totalFrames;
    const landmarks = cloneLandmarks(getDefaultPose());

    // 양팔 원 그리기
    const angle = t * Math.PI * 4;
    landmarks[13].x = 0.28 + Math.cos(angle) * 0.08;
    landmarks[13].y = 0.28 + Math.sin(angle) * 0.10;
    landmarks[15].x = 0.18 + Math.cos(angle) * 0.12;
    landmarks[15].y = 0.28 + Math.sin(angle) * 0.15;

    landmarks[14].x = 0.72 - Math.cos(angle + Math.PI) * 0.08;
    landmarks[14].y = 0.28 + Math.sin(angle + Math.PI) * 0.10;
    landmarks[16].x = 0.82 - Math.cos(angle + Math.PI) * 0.12;
    landmarks[16].y = 0.28 + Math.sin(angle + Math.PI) * 0.15;

    // 무릎 굽혔다 펴기
    const squat = Math.sin(t * Math.PI * 6) * 0.04;
    landmarks[25].y = 0.70 + squat;
    landmarks[26].y = 0.70 + squat;
    landmarks[23].y = 0.52 + squat * 0.5;
    landmarks[24].y = 0.52 + squat * 0.5;

    frames.push({
      timestamp_ms: Math.round(i / fps * 1000),
      poseLandmarks: landmarks,
    });
  }

  return { name: '바디 웨이브', duration_ms: durationMs, fps, frames };
}

// ── 프리셋 댄스 목록 ──
export const PRESET_DANCES = [];

// ── localStorage 커스텀 댄스 관리 ──
const STORAGE_KEY = 'dance-challenge-custom';

export function getCustomDances() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveCustomDance(dance) {
  const dances = getCustomDances();
  dance.name = dance.name || `커스텀 ${dances.length + 1}`;
  dances.push(dance);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dances));
  return dances;
}

export function deleteCustomDance(index) {
  const dances = getCustomDances();
  if (index < 0 || index >= dances.length) return;
  dances.splice(index, 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dances));
}

export function clearAllCustomDances() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getAllDances() {
  return [...PRESET_DANCES, ...getCustomDances()];
}
