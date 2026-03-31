/**
 * dance-renderer.js
 * Canvas 2D에 MediaPipe 33점 스켈레톤 렌더링
 */

// MediaPipe Pose 연결선 정의
const POSE_CONNECTIONS = [
  // 얼굴 (간략)
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  // 상체
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  // 손
  [15, 17], [15, 19], [15, 21], [17, 19],
  [16, 18], [16, 20], [16, 22], [18, 20],
  // 몸통
  [11, 23], [12, 24], [23, 24],
  // 하체
  [23, 25], [25, 27], [24, 26], [26, 28],
  // 발
  [27, 29], [27, 31], [29, 31],
  [28, 30], [28, 32], [30, 32],
];

export class SkeletonRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lineColor = '#00bfff';
    this.jointColor = '#00e5ff';
    this.lineWidth = 3;
    this.jointRadius = 5;
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawSkeleton(landmarks) {
    if (!landmarks || landmarks.length < 33) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 배경
    ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
    ctx.fillRect(0, 0, w, h);

    // 연결선
    ctx.strokeStyle = this.lineColor;
    ctx.lineWidth = this.lineWidth;
    ctx.lineCap = 'round';

    for (const [i, j] of POSE_CONNECTIONS) {
      const a = landmarks[i];
      const b = landmarks[j];
      if (!a || !b) continue;
      if ((a.visibility ?? 1) < 0.3 || (b.visibility ?? 1) < 0.3) continue;

      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }

    // 관절점
    ctx.fillStyle = this.jointColor;
    for (let i = 0; i < landmarks.length; i++) {
      const l = landmarks[i];
      if (!l || (l.visibility ?? 1) < 0.3) continue;

      ctx.beginPath();
      ctx.arc(l.x * w, l.y * h, this.jointRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCountdown(text) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.min(w, h) * 0.3}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }

  drawIdle(text = '준비 대기중...') {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = `${Math.min(w, h) * 0.06}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }
}
