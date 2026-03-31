/**
 * dance-recorder.js
 * 커스텀 댄스 녹화 (유저의 poseLandmarks 를 프레임별 저장)
 */

export class DanceRecorder {
  constructor(fps = 30) {
    this.fps = fps;
    this.frames = [];
    this.isRecording = false;
    this.startTime = null;
    this.durationMs = 15000;
  }

  start(durationMs = 15000) {
    this.frames = [];
    this.durationMs = durationMs;
    this.startTime = performance.now();
    this.isRecording = true;
  }

  addFrame(poseLandmarks) {
    if (!this.isRecording || !poseLandmarks) return false;

    const elapsed = performance.now() - this.startTime;
    if (elapsed >= this.durationMs) {
      this.isRecording = false;
      return false; // 녹화 종료
    }

    this.frames.push({
      timestamp_ms: Math.round(elapsed),
      poseLandmarks: poseLandmarks.map(l => ({
        x: l.x,
        y: l.y,
        z: l.z || 0,
        visibility: l.visibility ?? 0.99,
      })),
    });

    return true; // 아직 녹화 중
  }

  stop() {
    this.isRecording = false;
  }

  getElapsed() {
    if (!this.startTime) return 0;
    return performance.now() - this.startTime;
  }

  getProgress() {
    return Math.min(1, this.getElapsed() / this.durationMs);
  }

  getData() {
    return {
      name: `커스텀 녹화`,
      duration_ms: this.durationMs,
      fps: this.fps,
      frames: this.frames,
    };
  }
}
