/**
 * dance-scorer.js
 * 포즈 유사도 스코어링 엔진
 */

// 비교할 주요 관절 인덱스
const KEY_JOINTS = {
  leftArm: [11, 13, 15],    // left_shoulder, left_elbow, left_wrist
  rightArm: [12, 14, 16],   // right_shoulder, right_elbow, right_wrist
  leftLeg: [23, 25, 27],    // left_hip, left_knee, left_ankle
  rightLeg: [24, 26, 28],   // right_hip, right_knee, right_ankle
  torso: [11, 12, 23, 24],  // shoulders + hips
};

const WEIGHTS = {
  leftArm: 0.25,
  rightArm: 0.25,
  leftLeg: 0.20,
  rightLeg: 0.20,
  torso: 0.10,
};

// 정규화: 어깨 중심을 원점, 어깨 너비로 스케일링
function normalizeLandmarks(landmarks) {
  if (!landmarks || landmarks.length < 29) return null;

  const ls = landmarks[11]; // left_shoulder
  const rs = landmarks[12]; // right_shoulder

  if (!ls || !rs) return null;

  const cx = (ls.x + rs.x) / 2;
  const cy = (ls.y + rs.y) / 2;
  const shoulderWidth = Math.sqrt((ls.x - rs.x) ** 2 + (ls.y - rs.y) ** 2);

  if (shoulderWidth < 0.001) return null;

  return landmarks.map(l => ({
    x: (l.x - cx) / shoulderWidth,
    y: (l.y - cy) / shoulderWidth,
    z: (l.z || 0) / shoulderWidth,
  }));
}

// 부위별 코사인 유사도
function cosineSimilarity(vecA, vecB) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA < 0.0001 || magB < 0.0001) return 1; // 둘 다 거의 0이면 같은 것으로
  return dot / (magA * magB);
}

function getPartVector(normalized, indices) {
  const vec = [];
  for (const idx of indices) {
    vec.push(normalized[idx].x, normalized[idx].y);
  }
  return vec;
}

// 프레임별 점수 계산 (0~100)
export function calculateFrameScore(refLandmarks, userLandmarks) {
  const normRef = normalizeLandmarks(refLandmarks);
  const normUser = normalizeLandmarks(userLandmarks);

  if (!normRef || !normUser) return 0;

  let totalScore = 0;

  for (const [part, indices] of Object.entries(KEY_JOINTS)) {
    const refVec = getPartVector(normRef, indices);
    const userVec = getPartVector(normUser, indices);
    const sim = cosineSimilarity(refVec, userVec);
    // 코사인 유사도 [-1, 1] → [0, 100]
    const score = Math.max(0, Math.min(100, (sim + 1) / 2 * 100));
    totalScore += score * WEIGHTS[part];
  }

  return Math.round(totalScore * 10) / 10;
}

// ── 콤보 시스템 ──
export class ComboTracker {
  constructor(threshold = 80) {
    this.threshold = threshold;
    this.comboStartTime = null;
    this.currentCombo = 0;
    this.maxCombo = 0;
    this.scores = [];         // 모든 프레임 점수 기록
    this.sectionScores = [];  // 구간별 점수 (3초 단위)
    this._sectionBuffer = [];
    this._lastSectionTime = 0;
  }

  update(score, timestamp) {
    this.scores.push(score);

    // 콤보 계산
    if (score >= this.threshold) {
      if (this.comboStartTime === null) {
        this.comboStartTime = timestamp;
      }
      const elapsed = (timestamp - this.comboStartTime) / 1000;
      if (elapsed >= 3) {
        this.currentCombo = Math.floor(elapsed / 3);
        this.maxCombo = Math.max(this.maxCombo, this.currentCombo);
      }
    } else {
      this.comboStartTime = timestamp;
      this.currentCombo = 0;
    }

    // 구간별 점수 (3초 단위)
    this._sectionBuffer.push(score);
    if (timestamp - this._lastSectionTime >= 3000) {
      const avg = this._sectionBuffer.reduce((a, b) => a + b, 0) / this._sectionBuffer.length;
      this.sectionScores.push(Math.round(avg * 10) / 10);
      this._sectionBuffer = [];
      this._lastSectionTime = timestamp;
    }
  }

  getAverageScore() {
    if (this.scores.length === 0) return 0;
    return Math.round(this.scores.reduce((a, b) => a + b, 0) / this.scores.length * 10) / 10;
  }

  finalize() {
    // 남은 버퍼 처리
    if (this._sectionBuffer.length > 0) {
      const avg = this._sectionBuffer.reduce((a, b) => a + b, 0) / this._sectionBuffer.length;
      this.sectionScores.push(Math.round(avg * 10) / 10);
    }
    return {
      averageScore: this.getAverageScore(),
      maxCombo: this.maxCombo,
      sectionScores: this.sectionScores,
    };
  }

  reset() {
    this.comboStartTime = null;
    this.currentCombo = 0;
    this.maxCombo = 0;
    this.scores = [];
    this.sectionScores = [];
    this._sectionBuffer = [];
    this._lastSectionTime = 0;
  }
}

// ── 등급 계산 ──
export function getGrade(score) {
  if (score >= 95) return { grade: 'S', label: '완벽!', color: '#ff44ff' };
  if (score >= 85) return { grade: 'A', label: '훌륭해요!', color: '#ffd700' };
  if (score >= 70) return { grade: 'B', label: '잘했어요!', color: '#4caf50' };
  if (score >= 50) return { grade: 'C', label: '괜찮아요!', color: '#ff9800' };
  return { grade: 'D', label: '다시 도전!', color: '#f44336' };
}

// 점수 → 색상
export function getScoreColor(score) {
  if (score >= 90) return '#ffd700';
  if (score >= 70) return '#4caf50';
  if (score >= 50) return '#ff9800';
  return '#f44336';
}
