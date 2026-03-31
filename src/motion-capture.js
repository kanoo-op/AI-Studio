import { Holistic } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';

let holisticInstance = null;
let cameraInstance = null;

/**
 * MediaPipe Holistic 초기화
 * @param {function} onResults - 랜드마크 결과 콜백
 * @returns {Holistic}
 */
export function initHolistic(onResults) {
  const holistic = new Holistic({
    locateFile: (file) => `/mediapipe/holistic/${file}`,
  });

  holistic.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    smoothSegmentation: false,
    refineFaceLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  holistic.onResults(onResults);

  holisticInstance = holistic;
  return holistic;
}

/**
 * 웹캠 → MediaPipe 연결 시작
 * @param {HTMLVideoElement} videoElement
 * @param {Holistic} holistic
 * @returns {Promise}
 */
export async function startCamera(videoElement, holistic) {
  const camera = new Camera(videoElement, {
    onFrame: async () => {
      try {
        await holistic.send({ image: videoElement });
      } catch (err) {
        console.error('[MediaPipe] send 에러:', err);
      }
    },
    width: 640,
    height: 480,
  });

  await camera.start();
  cameraInstance = camera;
  console.log('[Camera] 웹캠 시작됨');
}

/**
 * 카메라 중지
 */
export function stopCamera() {
  if (cameraInstance) {
    cameraInstance.stop();
    cameraInstance = null;
  }
}
