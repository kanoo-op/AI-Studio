/**
 * dance-video-extractor.js
 * 영상을 실시간 재생하면서 MediaPipe로 포즈 분석 → VRM이 바로 따라하기
 *
 * 핵심: holistic.send()는 비동기 → 이전 프레임 처리 완료 후 다음 프레임 전송
 */
import { Holistic } from '@mediapipe/holistic';

export class VideoPlayer {
  constructor() {
    this.holistic = null;
    this.videoEl = null;
    this.isPlaying = false;
    this.onPoseDetected = null; // (results) => void
    this._animId = null;
    this._initialized = false;
    this._processing = false; // 현재 프레임 처리 중 플래그
  }

  async init() {
    if (this._initialized) return;

    this.holistic = new Holistic({
      locateFile: (file) => `/mediapipe/holistic/${file}`,
    });

    this.holistic.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      refineFaceLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.holistic.onResults((results) => {
      this._processing = false; // 처리 완료
      if (this.onPoseDetected) {
        this.onPoseDetected(results);
      }
    });

    // 워밍업: 빈 캔버스로 한번 돌려서 WASM 로드 완료 대기
    const warmupCanvas = document.createElement('canvas');
    warmupCanvas.width = 64;
    warmupCanvas.height = 64;
    try {
      await this.holistic.send({ image: warmupCanvas });
    } catch (e) {
      // 워밍업 실패해도 OK
    }

    this._initialized = true;
    console.log('[VideoPlayer] MediaPipe Holistic 초기화 완료');
  }

  /**
   * 영상 파일을 비디오 엘리먼트에 로드
   */
  async loadVideo(file, videoEl) {
    this.videoEl = videoEl;

    // 이전 URL 정리
    if (videoEl.src && videoEl.src.startsWith('blob:')) {
      URL.revokeObjectURL(videoEl.src);
    }

    const url = URL.createObjectURL(file);
    videoEl.src = url;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.loop = true;
    videoEl.crossOrigin = 'anonymous';

    await new Promise((resolve, reject) => {
      videoEl.onloadeddata = resolve; // loadeddata가 loadedmetadata보다 확실
      videoEl.onerror = () => reject(new Error('영상을 로드할 수 없습니다'));
    });

    console.log(`[VideoPlayer] 영상 로드 완료: ${videoEl.duration.toFixed(1)}초`);

    return {
      duration: videoEl.duration,
      url,
    };
  }

  /**
   * 재생 시작 — 이전 프레임 처리 완료 후에만 다음 프레임 전송
   */
  async play(startTimeSec = 0) {
    if (!this.videoEl || !this.holistic) {
      console.error('[VideoPlayer] videoEl 또는 holistic 없음');
      return;
    }

    this.isPlaying = true;
    this._processing = false;
    this.videoEl.currentTime = startTimeSec;

    try {
      await this.videoEl.play();
      console.log('[VideoPlayer] 영상 재생 시작');
    } catch (err) {
      console.error('[VideoPlayer] 재생 실패:', err);
      return;
    }

    this._processLoop();
  }

  _processLoop() {
    if (!this.isPlaying) return;

    // 영상이 끝나지 않았고, 이전 프레임 처리가 완료된 경우에만 전송
    if (!this.videoEl.paused && !this.videoEl.ended && !this._processing) {
      this._processing = true;
      this.holistic.send({ image: this.videoEl }).catch((err) => {
        console.warn('[VideoPlayer] send 에러:', err);
        this._processing = false; // 에러 시 플래그 해제
      });
    }

    this._animId = requestAnimationFrame(() => this._processLoop());
  }

  stop() {
    this.isPlaying = false;
    this._processing = false;
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
    }
  }

  getDuration() {
    return this.videoEl ? this.videoEl.duration * 1000 : 0;
  }

  getCurrentTime() {
    return this.videoEl ? this.videoEl.currentTime * 1000 : 0;
  }

  dispose() {
    this.stop();
    if (this.videoEl?.src && this.videoEl.src.startsWith('blob:')) {
      URL.revokeObjectURL(this.videoEl.src);
      this.videoEl.src = '';
    }
  }
}
