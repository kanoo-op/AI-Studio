/**
 * avatar-animator.js
 * KalidoKit 공식 VRM 예제 기반, three-vrm v2 (VRM 0.x / 1.0 호환)
 */
import * as THREE from 'three';
import * as Kalidokit from 'kalidokit';

const clamp = Kalidokit.Utils.clamp;
const lerp = Kalidokit.Vector.lerp;

const vrmVersionCache = new WeakMap();
function isVRM1(vrm) {
  if (vrmVersionCache.has(vrm)) return vrmVersionCache.get(vrm);
  const v = vrm.meta?.metaVersion === '1';
  vrmVersionCache.set(vrm, v);
  return v;
}

function toBoneName(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

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

// ── 캘리브레이션 (export 유지) ──
let calibrationData = null;
let _calibrationState = 'idle';
let _calibrationFrames = [];
let _calibrationResolve = null;
const CALIBRATION_FRAME_COUNT = 30;

export function startCalibration() {
  return new Promise((resolve) => {
    _calibrationResolve = resolve;
    _calibrationFrames = [];
    _calibrationState = 'collecting';
  });
}
export function isCalibrated() { return calibrationData !== null; }
export function resetCalibration() {
  calibrationData = null;
  _calibrationState = 'idle';
  _calibrationFrames = [];
}

function collectCalibrationFrame(riggedPose) {
  if (_calibrationState !== 'collecting' || !riggedPose) return;
  _calibrationFrames.push(JSON.parse(JSON.stringify(riggedPose)));
  if (_calibrationFrames.length >= CALIBRATION_FRAME_COUNT) {
    calibrationData = averagePoseFrames(_calibrationFrames);
    _calibrationState = 'idle';
    _calibrationFrames = [];
    if (_calibrationResolve) { _calibrationResolve(); _calibrationResolve = null; }
  }
}

function averagePoseFrames(frames) {
  const keys = ['Spine','RightUpperArm','RightLowerArm','LeftUpperArm','LeftLowerArm','LeftUpperLeg','LeftLowerLeg','RightUpperLeg','RightLowerLeg'];
  const result = {};
  for (const key of keys) {
    let sx=0,sy=0,sz=0,c=0;
    for (const f of frames) { if(f[key]){sx+=f[key].x||0;sy+=f[key].y||0;sz+=f[key].z||0;c++;} }
    if(c>0) result[key]={x:sx/c,y:sy/c,z:sz/c};
  }
  return result;
}

function applyCalibratedRotation(key, rotation) {
  if (!calibrationData || !calibrationData[key]) return rotation;
  const b = calibrationData[key];
  return { x:(rotation.x||0)-(b.x||0), y:(rotation.y||0)-(b.y||0), z:(rotation.z||0)-(b.z||0), rotationOrder:rotation.rotationOrder };
}

// ── visibility 필터 ──
let prevPose3D = null;
let prevPose2D = null;
function filterByVisibility(current, previous) {
  if (!current) return previous;
  if (!previous) return current;
  return current.map((lm,i) => ((lm.visibility??1)<0.5 && previous[i]) ? previous[i] : lm);
}

// ══════════════════════════════════════
// 다리 Two-Bone IK (분석적 풀이)
// ══════════════════════════════════════
const legIK = {
  ready: false,
  leftUpper: 0, leftLower: 0,
  rightUpper: 0, rightLower: 0,
  groundY: 0,
};

function initLegIK(vrm) {
  if (legIK.ready) return;
  vrm.scene.updateWorldMatrix(true, true);

  const getPos = (name) => {
    const bone = vrm.humanoid.getNormalizedBoneNode(name);
    if (!bone) return null;
    const v = new THREE.Vector3();
    bone.getWorldPosition(v);
    return v;
  };

  const lhp = getPos('leftUpperLeg'), lkp = getPos('leftLowerLeg'), lap = getPos('leftFoot');
  const rhp = getPos('rightUpperLeg'), rkp = getPos('rightLowerLeg'), rap = getPos('rightFoot');
  if (!lhp||!lkp||!lap||!rhp||!rkp||!rap) return;

  legIK.leftUpper = lhp.distanceTo(lkp);
  legIK.leftLower = lkp.distanceTo(lap);
  legIK.rightUpper = rhp.distanceTo(rkp);
  legIK.rightLower = rkp.distanceTo(rap);
  legIK.groundY = Math.min(lap.y, rap.y);

  if (legIK.leftUpper < 0.01 || legIK.leftLower < 0.01) return;
  legIK.ready = true;
  console.log('[LegIK] ready:', JSON.stringify(legIK));
}

// 주어진 hip 위치와 발 목표 위치로 상하퇴 회전 계산
function solveLegIK(hipWorldPos, targetWorldPos, upperLen, lowerLen) {
  const dy = targetWorldPos.y - hipWorldPos.y; // 음수 (발이 hip 아래)
  const dz = targetWorldPos.z - hipWorldPos.z;
  const dx = targetWorldPos.x - hipWorldPos.x;
  const D = Math.sqrt(dx*dx + dy*dy + dz*dz);

  const maxReach = upperLen + lowerLen - 0.001;
  if (D >= maxReach) {
    return { upperX: 0, lowerX: 0, valid: true }; // 다리 쭉 핌
  }
  if (D < 0.01) {
    return { upperX: 0, lowerX: 0, valid: false };
  }

  // 무릎 각도 (law of cosines)
  const cosKnee = (upperLen*upperLen + lowerLen*lowerLen - D*D) / (2*upperLen*lowerLen);
  const kneeAngle = Math.acos(Math.max(-1, Math.min(1, cosKnee)));

  // hip 각도 오프셋
  const cosHip = (upperLen*upperLen + D*D - lowerLen*lowerLen) / (2*upperLen*D);
  const hipOffset = Math.acos(Math.max(-1, Math.min(1, cosHip)));

  // -Y축(아래)에서 hip→target 방향까지의 각도
  const aimAngle = Math.acos(Math.max(-1, Math.min(1, -dy / D)));

  return {
    upperX: aimAngle + hipOffset,    // 상퇴 앞으로 기울기
    lowerX: -(Math.PI - kneeAngle),  // 무릎 굽힘 (항상 음수)
    valid: true,
  };
}

// MediaPipe world landmarks에서 무릎 각도 계산 → 스쿼트 판단
function getSquatAmount(pose3D) {
  if (!pose3D) return 0;
  const lh = pose3D[23], lk = pose3D[25], la = pose3D[27];
  const rh = pose3D[24], rk = pose3D[26], ra = pose3D[28];

  function kneeAngle(hip, knee, ankle) {
    const v1x = hip.x-knee.x, v1y = hip.y-knee.y, v1z = (hip.z||0)-(knee.z||0);
    const v2x = ankle.x-knee.x, v2y = ankle.y-knee.y, v2z = (ankle.z||0)-(knee.z||0);
    const dot = v1x*v2x + v1y*v2y + v1z*v2z;
    const m1 = Math.sqrt(v1x*v1x+v1y*v1y+v1z*v1z);
    const m2 = Math.sqrt(v2x*v2x+v2y*v2y+v2z*v2z);
    if (m1<0.001||m2<0.001) return Math.PI;
    return Math.acos(Math.max(-1, Math.min(1, dot/(m1*m2))));
  }

  const leftAngle = kneeAngle(lh, lk, la);
  const rightAngle = kneeAngle(rh, rk, ra);
  const avgAngle = (leftAngle + rightAngle) / 2;

  // PI = 다리 쭉 핌, < 2.3 = 굽힘 시작, < 1.5 = 깊은 스쿼트
  // (PI - avgAngle)를 0~1 범위로 매핑
  const bend = Math.PI - avgAngle; // 0 = 쭉 핌, ~1.5 = 깊은 스쿼트
  return Math.max(0, Math.min(1, bend / 1.2));
}

// ── rigRotation / rigPosition (원본 KalidoKit 방식) ──
function rigRotation(vrm, name, rotation={x:0,y:0,z:0}, dampener=1, lerpAmount=0.3) {
  if (!vrm?.humanoid) return;
  const bone = vrm.humanoid.getNormalizedBoneNode(toBoneName(name));
  if (!bone) return;
  rotation = applyCalibratedRotation(name, rotation);
  let rx=rotation.x*dampener, ry=rotation.y*dampener, rz=rotation.z*dampener;
  if (isVRM1(vrm)) { rx=-rx; rz=-rz; }
  const euler = new THREE.Euler(rx,ry,rz,rotation.rotationOrder||'XYZ');
  const quat = new THREE.Quaternion().setFromEuler(euler);
  bone.quaternion.slerp(quat, lerpAmount);
}

function rigPosition(vrm, name, position={x:0,y:0,z:0}, dampener=1, lerpAmount=0.3) {
  if (!vrm?.humanoid) return;
  const bone = vrm.humanoid.getNormalizedBoneNode(toBoneName(name));
  if (!bone) return;
  let px=position.x*dampener, py=position.y*dampener, pz=position.z*dampener;
  if (isVRM1(vrm)) { px=-px; pz=-pz; }
  bone.position.lerp(new THREE.Vector3(px,py,pz), lerpAmount);
}

// ── rigFace ──
let oldLookTarget = new THREE.Euler();
function rigFace(vrm, riggedFace) {
  if (!vrm?.expressionManager) return;
  rigRotation(vrm,'Neck',riggedFace.head,0.7);
  const blinkKey=resolveExpressionKey(vrm,'blink');
  const blinkLKey=resolveExpressionKey(vrm,'blinkLeft');
  const blinkRKey=resolveExpressionKey(vrm,'blinkRight');
  const curBlinkL=blinkLKey?vrm.expressionManager.getValue(blinkLKey)??0:(blinkKey?vrm.expressionManager.getValue(blinkKey)??0:0);
  const curBlinkR=blinkRKey?vrm.expressionManager.getValue(blinkRKey)??0:curBlinkL;
  let eyeL=lerp(clamp(1-riggedFace.eye.l,0,1),curBlinkL,0.5);
  let eyeR=lerp(clamp(1-riggedFace.eye.r,0,1),curBlinkR,0.5);
  const stab=Kalidokit.Face.stabilizeBlink({l:eyeL,r:eyeR},riggedFace.head.y);
  eyeL=stab.l; eyeR=stab.r;
  if(blinkLKey&&blinkRKey){vrm.expressionManager.setValue(blinkLKey,eyeL);vrm.expressionManager.setValue(blinkRKey,eyeR);}
  else if(blinkKey){vrm.expressionManager.setValue(blinkKey,eyeL);}
  const mouthMap={I:'ih',A:'aa',E:'ee',O:'oh',U:'ou'};
  for(const[kk,et]of Object.entries(mouthMap)){const k=resolveExpressionKey(vrm,et);if(!k)continue;const cv=vrm.expressionManager.getValue(k)??0;vrm.expressionManager.setValue(k,lerp(riggedFace.mouth.shape[kk],cv,0.5));}
  if(vrm.lookAt){const lt=new THREE.Euler(lerp(oldLookTarget.x,riggedFace.pupil.y,0.4),lerp(oldLookTarget.y,riggedFace.pupil.x,0.4),0,'XYZ');oldLookTarget.copy(lt);vrm.lookAt.autoUpdate=false;vrm.lookAt.yaw=THREE.MathUtils.radToDeg(lt.y);vrm.lookAt.pitch=THREE.MathUtils.radToDeg(lt.x);vrm.lookAt.update(0);}
}

// ── animateVRM (원본 KalidoKit 방식 — 안정 동작) ──
export function animateVRM(vrm, results, videoElement) {
  if (!vrm) return;
  let riggedPose, riggedFace;
  const faceLandmarks = results.faceLandmarks;
  let pose3DLandmarks = results.za ?? results.poseWorldLandmarks ?? results.ea;
  let pose2DLandmarks = results.poseLandmarks;
  const leftHandLandmarks = results.rightHandLandmarks;
  const rightHandLandmarks = results.leftHandLandmarks;

  if(pose3DLandmarks){pose3DLandmarks=filterByVisibility(pose3DLandmarks,prevPose3D);prevPose3D=pose3DLandmarks;}
  if(pose2DLandmarks){pose2DLandmarks=filterByVisibility(pose2DLandmarks,prevPose2D);prevPose2D=pose2DLandmarks;}

  if(faceLandmarks){riggedFace=Kalidokit.Face.solve(faceLandmarks,{runtime:'mediapipe',video:videoElement});if(riggedFace)rigFace(vrm,riggedFace);}

  if(pose2DLandmarks && pose3DLandmarks){
    riggedPose=Kalidokit.Pose.solve(pose3DLandmarks,pose2DLandmarks,{runtime:'mediapipe',video:videoElement});
    if(riggedPose){
      if(_calibrationState==='collecting') collectCalibrationFrame(riggedPose);

      // ── 다리 IK 초기화 (첫 프레임) ──
      initLegIK(vrm);

      // ── 스쿼트 감지 (무릎 각도 기반) ──
      const squat = getSquatAmount(pose3DLandmarks);

      // ── Hips ──
      rigRotation(vrm,'Hips',riggedPose.Hips.rotation,0.7);

      // Hips Y: 스쿼트 시 내려감
      const hipsY = 1.0 - squat * 0.6; // 1.0(서있음) → 0.4(깊은 스쿼트)
      rigPosition(vrm,'Hips',{
        x: riggedPose.Hips.position.x,
        y: riggedPose.Hips.position.y + hipsY,
        z: -riggedPose.Hips.position.z,
      },1,0.07);

      // ── 상체: FK 그대로 ──
      rigRotation(vrm,'Chest',riggedPose.Spine,0.25,0.3);
      rigRotation(vrm,'Spine',riggedPose.Spine,0.45,0.3);
      rigRotation(vrm,'RightUpperArm',riggedPose.RightUpperArm,1,0.3);
      rigRotation(vrm,'RightLowerArm',riggedPose.RightLowerArm,1,0.3);
      rigRotation(vrm,'LeftUpperArm',riggedPose.LeftUpperArm,1,0.3);
      rigRotation(vrm,'LeftLowerArm',riggedPose.LeftLowerArm,1,0.3);

      // ── 다리: FK/IK 블렌딩 ──
      // squat=0: FK 100% (KalidoKit, 서있을 때/댄스)
      // squat=1: IK 100% (발 바닥 고정, 스쿼트)
      if (squat > 0.05 && legIK.ready) {
        // IK: hip 위치에서 발 목표(바닥)까지 역기구학 계산
        vrm.scene.updateWorldMatrix(true, true);
        const lHipBone = vrm.humanoid.getNormalizedBoneNode('leftUpperLeg');
        const rHipBone = vrm.humanoid.getNormalizedBoneNode('rightUpperLeg');

        if (lHipBone && rHipBone) {
          const lHipPos = new THREE.Vector3(); lHipBone.getWorldPosition(lHipPos);
          const rHipPos = new THREE.Vector3(); rHipBone.getWorldPosition(rHipPos);

          // 발 목표: hip 바로 아래 바닥 (groundY)
          const lTarget = new THREE.Vector3(lHipPos.x, legIK.groundY, lHipPos.z);
          const rTarget = new THREE.Vector3(rHipPos.x, legIK.groundY, rHipPos.z);

          const lIK = solveLegIK(lHipPos, lTarget, legIK.leftUpper, legIK.leftLower);
          const rIK = solveLegIK(rHipPos, rTarget, legIK.rightUpper, legIK.rightLower);

          // FK값 (KalidoKit)
          const fkLUL = riggedPose.LeftUpperLeg;
          const fkLLL = riggedPose.LeftLowerLeg;
          const fkRUL = riggedPose.RightUpperLeg;
          const fkRLL = riggedPose.RightLowerLeg;

          // IK값 → rotation (X축 = 앞뒤 굽힘)
          const ikLUL = lIK.valid ? { x: lIK.upperX, y: fkLUL.y||0, z: fkLUL.z||0 } : fkLUL;
          const ikLLL = lIK.valid ? { x: lIK.lowerX, y: 0, z: 0 } : fkLLL;
          const ikRUL = rIK.valid ? { x: rIK.upperX, y: fkRUL.y||0, z: fkRUL.z||0 } : fkRUL;
          const ikRLL = rIK.valid ? { x: rIK.lowerX, y: 0, z: 0 } : fkRLL;

          // 블렌딩: FK*(1-squat) + IK*squat
          const s = squat;
          const blendLUL = { x: fkLUL.x*(1-s) + ikLUL.x*s, y: fkLUL.y*(1-s) + ikLUL.y*s, z: (fkLUL.z||0)*(1-s) + (ikLUL.z||0)*s };
          const blendLLL = { x: (fkLLL.x||0)*(1-s) + ikLLL.x*s, y: (fkLLL.y||0)*(1-s), z: (fkLLL.z||0)*(1-s) };
          const blendRUL = { x: fkRUL.x*(1-s) + ikRUL.x*s, y: fkRUL.y*(1-s) + ikRUL.y*s, z: (fkRUL.z||0)*(1-s) + (ikRUL.z||0)*s };
          const blendRLL = { x: (fkRLL.x||0)*(1-s) + ikRLL.x*s, y: (fkRLL.y||0)*(1-s), z: (fkRLL.z||0)*(1-s) };

          rigRotation(vrm,'LeftUpperLeg', blendLUL, 1, 0.3);
          rigRotation(vrm,'LeftLowerLeg', blendLLL, 1, 0.3);
          rigRotation(vrm,'RightUpperLeg', blendRUL, 1, 0.3);
          rigRotation(vrm,'RightLowerLeg', blendRLL, 1, 0.3);
        } else {
          // bone 못 찾으면 FK 폴백
          rigRotation(vrm,'LeftUpperLeg',riggedPose.LeftUpperLeg,1,0.3);
          rigRotation(vrm,'LeftLowerLeg',riggedPose.LeftLowerLeg,1,0.3);
          rigRotation(vrm,'RightUpperLeg',riggedPose.RightUpperLeg,1,0.3);
          rigRotation(vrm,'RightLowerLeg',riggedPose.RightLowerLeg,1,0.3);
        }
      } else {
        // 서있음: FK 그대로 (KalidoKit)
        rigRotation(vrm,'LeftUpperLeg',riggedPose.LeftUpperLeg,1,0.3);
        rigRotation(vrm,'LeftLowerLeg',riggedPose.LeftLowerLeg,1,0.3);
        rigRotation(vrm,'RightUpperLeg',riggedPose.RightUpperLeg,1,0.3);
        rigRotation(vrm,'RightLowerLeg',riggedPose.RightLowerLeg,1,0.3);
      }

      // ── 손가락 ──
      if(leftHandLandmarks){const r=Kalidokit.Hand.solve(leftHandLandmarks,'Left');if(r){rigRotation(vrm,'LeftHand',{z:riggedPose.LeftHand.z,y:r.LeftWrist.y,x:r.LeftWrist.x});for(const f of['Ring','Index','Middle','Thumb','Little'])for(const s of['Proximal','Intermediate','Distal']){const k=`Left${f}${s}`;if(r[k])rigRotation(vrm,k,r[k]);}}}
      if(rightHandLandmarks){const r=Kalidokit.Hand.solve(rightHandLandmarks,'Right');if(r){rigRotation(vrm,'RightHand',{z:riggedPose.RightHand.z,y:r.RightWrist.y,x:r.RightWrist.x});for(const f of['Ring','Index','Middle','Thumb','Little'])for(const s of['Proximal','Intermediate','Distal']){const k=`Right${f}${s}`;if(r[k])rigRotation(vrm,k,r[k]);}}}
    }
  }
}
