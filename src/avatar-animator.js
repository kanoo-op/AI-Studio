/**
 * avatar-animator.js
 * KalidoKit 공식 VRM 예제 기반, three-vrm v2 (VRM 0.x / 1.0 호환)
 *
 * 개선사항:
 * 1. T-포즈 캘리브레이션 (기준점 저장 → 상대 회전 계산)
 * 2. visibility < 0.5 관절 이전 프레임 유지
 * 3. 2단 적응형 스무딩 (빠른 동작 추적 + 떨림 제거)
 */
import * as THREE from 'three';
import * as Kalidokit from 'kalidokit';

const clamp = Kalidokit.Utils.clamp;
const lerp = Kalidokit.Vector.lerp;

// ── VRM 버전 캐시 ──
const vrmVersionCache = new WeakMap();
function isVRM1(vrm) {
  if (vrmVersionCache.has(vrm)) return vrmVersionCache.get(vrm);
  const v = vrm.meta?.metaVersion === '1';
  vrmVersionCache.set(vrm, v);
  return v;
}

// ── KalidoKit PascalCase → three-vrm v2 camelCase ──
function toBoneName(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

// ── expression 이름 런타임 탐색 ──
const EXPRESSION_CANDIDATES = {
  blink:     ['blink', 'Blink', 'blinkLeft'],
  blinkLeft: ['blinkLeft', 'blink_l', 'Blink_L'],
  blinkRight:['blinkRight', 'blink_r', 'Blink_R'],
  aa:        ['aa', 'a', 'A'],
  ih:        ['ih', 'i', 'I'],
  ou:        ['ou', 'u', 'U'],
  ee:        ['ee', 'e', 'E'],
  oh:        ['oh', 'o', 'O'],
};

const expressionKeyCache = new WeakMap();

function resolveExpressionKey(vrm, type) {
  if (!vrm.expressionManager) return null;
  let cache = expressionKeyCache.get(vrm);
  if (!cache) { cache = {}; expressionKeyCache.set(vrm, cache); }
  if (type in cache) return cache[type];

  const candidates = EXPRESSION_CANDIDATES[type];
  if (!candidates) { cache[type] = type; return type; }

  const available = Object.keys(vrm.expressionManager.expressionMap);
  for (const c of candidates) {
    if (available.includes(c)) { cache[type] = c; return c; }
    const found = available.find(k => k.toLowerCase() === c.toLowerCase());
    if (found) { cache[type] = found; return found; }
  }
  cache[type] = null;
  return null;
}

// ══════════════════════════════════════
// 1. T-포즈 캘리브레이션
// ══════════════════════════════════════
let calibrationData = null;

export function startCalibration() {
  return new Promise((resolve) => {
    _calibrationResolve = resolve;
    _calibrationFrames = [];
    _calibrationState = 'collecting';
    console.log('[Calibration] 수집 시작...');
  });
}

export function isCalibrated() {
  return calibrationData !== null;
}

export function resetCalibration() {
  calibrationData = null;
  _calibrationState = 'idle';
  _calibrationFrames = [];
  console.log('[Calibration] 리셋');
}

let _calibrationState = 'idle';
let _calibrationFrames = [];
let _calibrationResolve = null;
const CALIBRATION_FRAME_COUNT = 30;

function collectCalibrationFrame(riggedPose) {
  if (_calibrationState !== 'collecting' || !riggedPose) return;

  _calibrationFrames.push(JSON.parse(JSON.stringify(riggedPose)));

  if (_calibrationFrames.length >= CALIBRATION_FRAME_COUNT) {
    calibrationData = averagePoseFrames(_calibrationFrames);
    _calibrationState = 'idle';
    _calibrationFrames = [];
    console.log('[Calibration] 완료:', calibrationData);
    if (_calibrationResolve) {
      _calibrationResolve();
      _calibrationResolve = null;
    }
  }
}

function averagePoseFrames(frames) {
  const keys = [
    'Spine', 'RightUpperArm', 'RightLowerArm',
    'LeftUpperArm', 'LeftLowerArm',
    'LeftUpperLeg', 'LeftLowerLeg',
    'RightUpperLeg', 'RightLowerLeg',
  ];
  const result = {};
  for (const key of keys) {
    let sx = 0, sy = 0, sz = 0, count = 0;
    for (const frame of frames) {
      if (frame[key]) {
        sx += frame[key].x || 0;
        sy += frame[key].y || 0;
        sz += frame[key].z || 0;
        count++;
      }
    }
    if (count > 0) {
      result[key] = { x: sx / count, y: sy / count, z: sz / count };
    }
  }
  let hx = 0, hy = 0, hz = 0, hc = 0;
  for (const frame of frames) {
    if (frame.Hips?.rotation) {
      hx += frame.Hips.rotation.x || 0;
      hy += frame.Hips.rotation.y || 0;
      hz += frame.Hips.rotation.z || 0;
      hc++;
    }
  }
  if (hc > 0) {
    result.HipsRotation = { x: hx / hc, y: hy / hc, z: hz / hc };
  }
  return result;
}

function applyCalibratedRotation(key, rotation) {
  if (!calibrationData || !calibrationData[key]) return rotation;
  const base = calibrationData[key];
  return {
    x: (rotation.x || 0) - (base.x || 0),
    y: (rotation.y || 0) - (base.y || 0),
    z: (rotation.z || 0) - (base.z || 0),
    rotationOrder: rotation.rotationOrder,
  };
}

// ══════════════════════════════════════
// 2. visibility 기반 이전 프레임 유지
// ══════════════════════════════════════
let prevPose3D = null;
let prevPose2D = null;

const VISIBILITY_THRESHOLD = 0.5;

function filterByVisibility(current, previous) {
  if (!current) return previous;
  if (!previous) return current;

  return current.map((lm, i) => {
    if ((lm.visibility ?? 1) < VISIBILITY_THRESHOLD && previous[i]) {
      return previous[i];
    }
    return lm;
  });
}

// ══════════════════════════════════════
// 3. 2단 적응형 스무딩
// ══════════════════════════════════════
const prevBoneRotations = {};

function adaptiveLerp(boneName, targetRotation, baseLerp = 0.3) {
  const prev = prevBoneRotations[boneName];
  if (!prev) {
    prevBoneRotations[boneName] = { x: targetRotation.x, y: targetRotation.y, z: targetRotation.z };
    return baseLerp;
  }

  const dx = Math.abs((targetRotation.x || 0) - prev.x);
  const dy = Math.abs((targetRotation.y || 0) - prev.y);
  const dz = Math.abs((targetRotation.z || 0) - prev.z);
  const velocity = dx + dy + dz;

  prevBoneRotations[boneName] = { x: targetRotation.x || 0, y: targetRotation.y || 0, z: targetRotation.z || 0 };

  if (velocity > 0.5) {
    return Math.min(0.7, baseLerp + velocity * 0.4);
  } else if (velocity < 0.1) {
    return Math.max(0.08, baseLerp * 0.4);
  }
  const t = (velocity - 0.1) / 0.4;
  return 0.15 + t * 0.35;
}

// ══════════════════════════════════════
// rigRotation / rigPosition
// ══════════════════════════════════════
function rigRotation(vrm, name, rotation = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = 0.3) {
  if (!vrm?.humanoid) return;

  const boneName = toBoneName(name);
  const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!bone) return;

  rotation = applyCalibratedRotation(name, rotation);

  let rx = rotation.x * dampener;
  let ry = rotation.y * dampener;
  let rz = rotation.z * dampener;

  if (isVRM1(vrm)) {
    rx = -rx;
    rz = -rz;
  }

  const adaptedLerp = adaptiveLerp(name, { x: rx, y: ry, z: rz }, lerpAmount);

  const euler = new THREE.Euler(rx, ry, rz, rotation.rotationOrder || 'XYZ');
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  bone.quaternion.slerp(quaternion, adaptedLerp);
}

function rigPosition(vrm, name, position = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = 0.3) {
  if (!vrm?.humanoid) return;

  const boneName = toBoneName(name);
  const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!bone) return;

  let px = position.x * dampener;
  let py = position.y * dampener;
  let pz = position.z * dampener;

  if (isVRM1(vrm)) {
    px = -px;
    pz = -pz;
  }

  const vector = new THREE.Vector3(px, py, pz);
  bone.position.lerp(vector, lerpAmount);
}

// ── rigFace: 표정 + 눈동자 ──
let oldLookTarget = new THREE.Euler();

function rigFace(vrm, riggedFace) {
  if (!vrm?.expressionManager) return;

  rigRotation(vrm, 'Neck', riggedFace.head, 0.7);

  const blinkKey = resolveExpressionKey(vrm, 'blink');
  const blinkLKey = resolveExpressionKey(vrm, 'blinkLeft');
  const blinkRKey = resolveExpressionKey(vrm, 'blinkRight');

  const curBlinkL = blinkLKey
    ? vrm.expressionManager.getValue(blinkLKey) ?? 0
    : (blinkKey ? vrm.expressionManager.getValue(blinkKey) ?? 0 : 0);
  const curBlinkR = blinkRKey
    ? vrm.expressionManager.getValue(blinkRKey) ?? 0
    : curBlinkL;

  let eyeL = lerp(clamp(1 - riggedFace.eye.l, 0, 1), curBlinkL, 0.5);
  let eyeR = lerp(clamp(1 - riggedFace.eye.r, 0, 1), curBlinkR, 0.5);
  const stabilized = Kalidokit.Face.stabilizeBlink({ l: eyeL, r: eyeR }, riggedFace.head.y);
  eyeL = stabilized.l;
  eyeR = stabilized.r;

  if (blinkLKey && blinkRKey) {
    vrm.expressionManager.setValue(blinkLKey, eyeL);
    vrm.expressionManager.setValue(blinkRKey, eyeR);
  } else if (blinkKey) {
    vrm.expressionManager.setValue(blinkKey, eyeL);
  }

  const mouthMap = { I: 'ih', A: 'aa', E: 'ee', O: 'oh', U: 'ou' };
  for (const [kk, exprType] of Object.entries(mouthMap)) {
    const key = resolveExpressionKey(vrm, exprType);
    if (!key) continue;
    const curVal = vrm.expressionManager.getValue(key) ?? 0;
    const newVal = lerp(riggedFace.mouth.shape[kk], curVal, 0.5);
    vrm.expressionManager.setValue(key, newVal);
  }

  if (vrm.lookAt) {
    const lookTarget = new THREE.Euler(
      lerp(oldLookTarget.x, riggedFace.pupil.y, 0.4),
      lerp(oldLookTarget.y, riggedFace.pupil.x, 0.4),
      0,
      'XYZ'
    );
    oldLookTarget.copy(lookTarget);

    vrm.lookAt.autoUpdate = false;
    vrm.lookAt.yaw = THREE.MathUtils.radToDeg(lookTarget.y);
    vrm.lookAt.pitch = THREE.MathUtils.radToDeg(lookTarget.x);
    vrm.lookAt.update(0);
  }
}

// ── animateVRM: 메인 함수 ──
export function animateVRM(vrm, results, videoElement) {
  if (!vrm) return;

  let riggedPose, riggedFace;

  const faceLandmarks = results.faceLandmarks;
  let pose3DLandmarks = results.za ?? results.poseWorldLandmarks ?? results.ea;
  let pose2DLandmarks = results.poseLandmarks;
  const leftHandLandmarks = results.rightHandLandmarks;
  const rightHandLandmarks = results.leftHandLandmarks;

  // visibility 필터
  if (pose3DLandmarks) {
    pose3DLandmarks = filterByVisibility(pose3DLandmarks, prevPose3D);
    prevPose3D = pose3DLandmarks;
  }
  if (pose2DLandmarks) {
    pose2DLandmarks = filterByVisibility(pose2DLandmarks, prevPose2D);
    prevPose2D = pose2DLandmarks;
  }

  // 얼굴 표정
  if (faceLandmarks) {
    riggedFace = Kalidokit.Face.solve(faceLandmarks, {
      runtime: 'mediapipe',
      video: videoElement,
    });
    if (riggedFace) {
      rigFace(vrm, riggedFace);
    }
  }

  // 포즈
  if (pose2DLandmarks && pose3DLandmarks) {
    riggedPose = Kalidokit.Pose.solve(pose3DLandmarks, pose2DLandmarks, {
      runtime: 'mediapipe',
      video: videoElement,
    });
    if (riggedPose) {
      if (_calibrationState === 'collecting') {
        collectCalibrationFrame(riggedPose);
      }

      rigRotation(vrm, 'Hips', riggedPose.Hips.rotation, 0.7);
      rigPosition(vrm, 'Hips', {
        x: riggedPose.Hips.position.x,
        y: riggedPose.Hips.position.y + 1,
        z: -riggedPose.Hips.position.z,
      }, 1, 0.07);

      rigRotation(vrm, 'Chest', riggedPose.Spine, 0.25, 0.3);
      rigRotation(vrm, 'Spine', riggedPose.Spine, 0.45, 0.3);

      rigRotation(vrm, 'RightUpperArm', riggedPose.RightUpperArm, 1, 0.3);
      rigRotation(vrm, 'RightLowerArm', riggedPose.RightLowerArm, 1, 0.3);
      rigRotation(vrm, 'LeftUpperArm', riggedPose.LeftUpperArm, 1, 0.3);
      rigRotation(vrm, 'LeftLowerArm', riggedPose.LeftLowerArm, 1, 0.3);

      rigRotation(vrm, 'LeftUpperLeg', riggedPose.LeftUpperLeg, 1, 0.3);
      rigRotation(vrm, 'LeftLowerLeg', riggedPose.LeftLowerLeg, 1, 0.3);
      rigRotation(vrm, 'RightUpperLeg', riggedPose.RightUpperLeg, 1, 0.3);
      rigRotation(vrm, 'RightLowerLeg', riggedPose.RightLowerLeg, 1, 0.3);

      // 손가락 (왼손)
      if (leftHandLandmarks) {
        const riggedLeftHand = Kalidokit.Hand.solve(leftHandLandmarks, 'Left');
        if (riggedLeftHand) {
          rigRotation(vrm, 'LeftHand', {
            z: riggedPose.LeftHand.z,
            y: riggedLeftHand.LeftWrist.y,
            x: riggedLeftHand.LeftWrist.x,
          });
          for (const finger of ['Ring', 'Index', 'Middle', 'Thumb', 'Little']) {
            for (const seg of ['Proximal', 'Intermediate', 'Distal']) {
              const key = `Left${finger}${seg}`;
              if (riggedLeftHand[key]) rigRotation(vrm, key, riggedLeftHand[key]);
            }
          }
        }
      }

      // 손가락 (오른손)
      if (rightHandLandmarks) {
        const riggedRightHand = Kalidokit.Hand.solve(rightHandLandmarks, 'Right');
        if (riggedRightHand) {
          rigRotation(vrm, 'RightHand', {
            z: riggedPose.RightHand.z,
            y: riggedRightHand.RightWrist.y,
            x: riggedRightHand.RightWrist.x,
          });
          for (const finger of ['Ring', 'Index', 'Middle', 'Thumb', 'Little']) {
            for (const seg of ['Proximal', 'Intermediate', 'Distal']) {
              const key = `Right${finger}${seg}`;
              if (riggedRightHand[key]) rigRotation(vrm, key, riggedRightHand[key]);
            }
          }
        }
      }
    }
  }
}
