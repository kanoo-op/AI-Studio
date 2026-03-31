# AI Avatar Studio - 프로젝트 스펙

## 개요
VRM 3D 아바타 + MediaPipe 모션캡처를 실시간 연동하는 웹 기반 아바타 스튜디오
카메라에 비친 사용자의 얼굴 표정, 시선, 머리 방향, 상체 움직임을 3D 아바타에 실시간 반영

## 핵심 체험
"카메라를 보면 3D 아바타가 나를 따라한다!" — VTuber 체험

---

## 기술 스택

### 필수 라이브러리
```json
{
  "dependencies": {
    "three": "^0.160.0",
    "@pixiv/three-vrm": "^2.1.0",
    "@mediapipe/holistic": "^0.5.1675471629",
    "kalidokit": "^1.1.5"
  }
}
```

### 역할 분담
| 라이브러리 | 역할 |
|-----------|------|
| Three.js | 3D 씬 렌더링, 카메라, 조명, VRM 모델 표시 |
| @pixiv/three-vrm | VRM 포맷 로딩, 본(bone) 제어, 표정(BlendShape) 제어 |
| MediaPipe Holistic | 얼굴 468점 + 포즈 33점 + 손 21점×2 = 총 543 랜드마크 감지 |
| KalidoKit | MediaPipe 랜드마크 → 회전값(Euler/Quaternion) 변환 |

### 데이터 플로우
```
[웹캠] → [MediaPipe Holistic] → [468 얼굴 + 33 포즈 랜드마크]
                                        ↓
                                  [KalidoKit]
                                        ↓
                              [회전값 + 표정값 계산]
                                        ↓
                         [VRM 아바타 본/블렌드셰이프 적용]
                                        ↓
                              [Three.js 렌더링]
```

---

## VRM 모델 준비

### 프리셋 아바타 (미리 준비)
부스/데모용으로 3~5개의 VRM 모델을 미리 준비

**무료 VRM 모델 소스:**
1. **VRoid Hub** (hub.vroid.com) — CC 라이선스 모델 다수
2. **VRoid Studio** (무료 앱) — 직접 커스텀 아바타 제작
3. **ニコニ立体** (3d.nicovideo.jp) — 일부 VRM 모델 무료

### VRM 파일 요구사항
- 포맷: VRM 1.0 또는 VRM 0.x (three-vrm이 둘 다 지원)
- 권장 폴리곤: 30,000 이하 (웹 성능)
- 필수 본: Head, Neck, Spine, UpperArm(L/R), LowerArm(L/R)
- 필수 BlendShape: Blink, A, I, U, E, O (표정)
- 파일 크기: 20MB 이하 권장

### 아바타 선택 UI
```
아바타를 선택하세요:
┌───────┬───────┬───────┬───────┐
│       │       │       │       │
│ 아바타1│ 아바타2│ 아바타3│ 커스텀 │
│ (기본) │ (여성) │ (판타지)│ (업로드)│
│       │       │       │  📁   │
└───────┴───────┴───────┴───────┘
[선택 완료]
```
- 프리셋 3~5개: 썸네일 + 이름
- 커스텀 업로드: .vrm 파일 드래그앤드롭 또는 파일 선택

---

## 기능 상세

### 기능 1: 얼굴 표정 캡처

#### 감지 항목 → VRM BlendShape 매핑
| 감지 항목 | KalidoKit 출력 | VRM BlendShape |
|----------|---------------|----------------|
| 눈 깜빡임 (좌) | face.eye.l | blinkLeft |
| 눈 깜빡임 (우) | face.eye.r | blinkRight |
| 입 열림 | face.mouth.shape.A | aa (또는 A) |
| 입 모양 I | face.mouth.shape.I | ih (또는 I) |
| 입 모양 U | face.mouth.shape.U | ou (또는 U) |
| 입 모양 E | face.mouth.shape.E | ee (또는 E) |
| 입 모양 O | face.mouth.shape.O | oh (또는 O) |
| 눈동자 좌우 | face.pupil.x | lookLeft / lookRight |
| 눈동자 상하 | face.pupil.y | lookUp / lookDown |

#### 표정 적용 코드 구조
```javascript
function applyFaceExpression(vrm, faceResults) {
  const face = Kalidokit.Face.solve(faceResults, {
    runtime: 'mediapipe',
    video: videoElement
  });
  
  if (!face) return;
  
  // 눈 깜빡임
  vrm.expressionManager.setValue('blinkLeft', face.eye.l);
  vrm.expressionManager.setValue('blinkRight', face.eye.r);
  
  // 입 모양 (모음)
  vrm.expressionManager.setValue('aa', face.mouth.shape.A);
  vrm.expressionManager.setValue('ih', face.mouth.shape.I);
  vrm.expressionManager.setValue('ou', face.mouth.shape.U);
  vrm.expressionManager.setValue('ee', face.mouth.shape.E);
  vrm.expressionManager.setValue('oh', face.mouth.shape.O);
  
  // 눈동자 (시선)
  if (vrm.lookAt) {
    vrm.lookAt.target = calculateGazeTarget(face.pupil);
  }
}
```

#### 스무딩 (떨림 방지)
```javascript
function lerp(current, target, factor = 0.5) {
  return current + (target - current) * factor;
}

// 적용 시
const smoothedBlinkL = lerp(prevBlinkL, face.eye.l, 0.6);
vrm.expressionManager.setValue('blinkLeft', smoothedBlinkL);
prevBlinkL = smoothedBlinkL;
```
- factor 0.3~0.5: 부드럽지만 약간 지연
- factor 0.6~0.8: 반응 빠르지만 약간 떨림
- 권장: 얼굴 표정 0.5, 몸 움직임 0.3

---

### 기능 2: 머리/상체 모션캡처

#### 감지 항목 → VRM 본 매핑
| 감지 항목 | KalidoKit 출력 | VRM 본 |
|----------|---------------|--------|
| 머리 회전 (좌우) | face.head.y (yaw) | head.rotation.y |
| 머리 회전 (상하) | face.head.x (pitch) | head.rotation.x |
| 머리 기울기 | face.head.z (roll) | head.rotation.z |
| 상체 회전 | pose.Spine | spine.rotation |
| 왼쪽 상완 | pose.LeftUpperArm | leftUpperArm.rotation |
| 오른쪽 상완 | pose.RightUpperArm | rightUpperArm.rotation |
| 왼쪽 전완 | pose.LeftLowerArm | leftLowerArm.rotation |
| 오른쪽 전완 | pose.RightLowerArm | rightLowerArm.rotation |
| 왼손 | pose.LeftHand | leftHand.rotation |
| 오른손 | pose.RightHand | rightHand.rotation |

#### 본 회전 적용 코드 구조
```javascript
function applyPoseRotation(vrm, poseResults, faceLandmarks) {
  // 머리 회전
  const head = Kalidokit.Face.solve(faceLandmarks, {
    runtime: 'mediapipe',
    video: videoElement
  });
  
  if (head) {
    const headBone = vrm.humanoid.getRawBoneNode('head');
    if (headBone) {
      headBone.rotation.x = lerp(headBone.rotation.x, head.head.x, 0.4);
      headBone.rotation.y = lerp(headBone.rotation.y, head.head.y, 0.4);
      headBone.rotation.z = lerp(headBone.rotation.z, head.head.z, 0.4);
    }
  }
  
  // 포즈 (상체 + 팔)
  const pose = Kalidokit.Pose.solve(poseResults, {
    runtime: 'mediapipe',
    video: videoElement
  });
  
  if (pose) {
    applyBoneRotation(vrm, 'spine', pose.Spine);
    applyBoneRotation(vrm, 'leftUpperArm', pose.LeftUpperArm);
    applyBoneRotation(vrm, 'rightUpperArm', pose.RightUpperArm);
    applyBoneRotation(vrm, 'leftLowerArm', pose.LeftLowerArm);
    applyBoneRotation(vrm, 'rightLowerArm', pose.RightLowerArm);
    applyBoneRotation(vrm, 'leftHand', pose.LeftHand);
    applyBoneRotation(vrm, 'rightHand', pose.RightHand);
  }
}

function applyBoneRotation(vrm, boneName, rotation) {
  const bone = vrm.humanoid.getRawBoneNode(boneName);
  if (bone && rotation) {
    bone.rotation.x = lerp(bone.rotation.x, rotation.x, 0.3);
    bone.rotation.y = lerp(bone.rotation.y, rotation.y, 0.3);
    bone.rotation.z = lerp(bone.rotation.z, rotation.z, 0.3);
  }
}
```

---

### 기능 3: 손가락 트래킹 (Phase 2 — 선택사항)

MediaPipe Holistic은 손 랜드마크도 포함 (21점 × 2)

```javascript
function applyHandTracking(vrm, handResults) {
  const leftHand = Kalidokit.Hand.solve(handResults.leftHand, 'Left');
  const rightHand = Kalidokit.Hand.solve(handResults.rightHand, 'Right');
  
  // VRM 손가락 본에 적용
  // leftThumbProximal, leftThumbIntermediate, leftThumbDistal
  // leftIndexProximal, leftIndexIntermediate, leftIndexDistal
  // ... (각 손가락 3마디 × 5개 × 좌우)
}
```
- Phase 1에서는 생략, Phase 2에서 옵션으로 추가

---

### 기능 4: 배경 설정

```javascript
const backgrounds = [
  { id: 'gradient', name: '기본', type: 'gradient', colors: ['#1a1a2e', '#16213e'] },
  { id: 'room', name: '방', type: 'image', url: '/backgrounds/room.jpg' },
  { id: 'stage', name: '무대', type: 'image', url: '/backgrounds/stage.jpg' },
  { id: 'nature', name: '자연', type: 'image', url: '/backgrounds/nature.jpg' },
  { id: 'custom', name: '커스텀', type: 'upload' },
  { id: 'transparent', name: '투명', type: 'transparent' },
];
```
- Three.js scene.background에 텍스처 또는 색상 설정
- 투명: renderer.setClearColor(0x000000, 0)

---

### 기능 5: 스크린샷 & 녹화

#### 스크린샷
```javascript
function takeScreenshot() {
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `avatar-${Date.now()}.png`;
  link.click();
}
```

#### 영상 녹화 (WebM)
```javascript
function startRecording(durationSec = 10) {
  const stream = renderer.domElement.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];
  
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    // 다운로드 또는 미리보기 UI 표시
  };
  
  recorder.start();
  setTimeout(() => recorder.stop(), durationSec * 1000);
}
```

---

### 기능 6: 카메라 앵글 & 간단 커스텀

#### 카메라 앵글 프리셋
```javascript
const cameraPresets = {
  full:  { position: [0, 1.0, 3.0], lookAt: [0, 1.0, 0] },  // 전신
  bust:  { position: [0, 1.4, 1.5], lookAt: [0, 1.4, 0] },  // 상반신
  face:  { position: [0, 1.6, 0.8], lookAt: [0, 1.6, 0] },  // 얼굴
};
```

#### 조명 커스텀
```javascript
const lightPresets = {
  natural:  { color: '#ffffff', intensity: 1.0 },
  warm:     { color: '#ffd4a0', intensity: 1.0 },
  cool:     { color: '#a0d4ff', intensity: 1.0 },
  dramatic: { color: '#ff6b6b', intensity: 1.5 },
  neon:     { color: '#6bffb8', intensity: 1.2 },
};
```

---

## Three.js 씬 설정

```javascript
// 렌더러
const renderer = new THREE.WebGLRenderer({ 
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true  // 스크린샷용
});
renderer.setSize(canvasWidth, canvasHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// 카메라
const camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 100);
camera.position.set(0, 1.4, 1.5);  // 상반신 기본

// 조명
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
```

### VRM 로딩
```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

async function loadVRM(url) {
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  vrm.scene.rotation.y = Math.PI;  // 정면 향하도록
  scene.add(vrm.scene);
  return vrm;
}
```

### 메인 루프
```javascript
let currentVrm = null;

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  
  const delta = clock.getDelta();
  
  if (currentVrm) {
    // VRM 업데이트 (물리, SpringBone 등)
    currentVrm.update(delta);
  }
  
  renderer.render(scene, camera);
}

animate();
```

---

## MediaPipe Holistic 초기화

```javascript
import { Holistic } from '@mediapipe/holistic';
import { Camera } from '@mediapipe/camera_utils';

const holistic = new Holistic({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
});

holistic.setOptions({
  modelComplexity: 1,          // 0: lite, 1: full, 2: heavy
  smoothLandmarks: true,
  enableSegmentation: false,   // 배경 분리 불필요
  smoothSegmentation: false,
  refineFaceLandmarks: true,   // 눈동자 추적용
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

holistic.onResults((results) => {
  if (!currentVrm) return;
  
  // 얼굴 표정 적용
  if (results.faceLandmarks) {
    applyFaceExpression(currentVrm, results.faceLandmarks);
  }
  
  // 머리 + 상체 모션 적용
  if (results.poseLandmarks) {
    applyPoseRotation(currentVrm, results.poseLandmarks, results.faceLandmarks);
  }
  
  // (Phase 2) 손가락 적용
  // if (results.leftHandLandmarks || results.rightHandLandmarks) {
  //   applyHandTracking(currentVrm, results);
  // }
});

// 카메라 시작
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await holistic.send({ image: videoElement });
  },
  width: 640,
  height: 480,
});
camera.start();
```

---

## UI 레이아웃

### 메인 화면
```
┌──────────────────────────────────────────────────────┐
│  AI Avatar Studio                     [📷][🎥][⚙️]   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────┐                                         │
│  │ 웹캠    │     ┌──────────────────────────┐        │
│  │ (PIP)   │     │                          │        │
│  └─────────┘     │    3D 아바타 렌더링       │        │
│                  │    (메인 영역)            │        │
│                  │                          │        │
│                  └──────────────────────────┘        │
│                                                      │
├──────────────────────────────────────────────────────┤
│  아바타: [캐릭1][캐릭2][캐릭3][📁]                     │
│  앵글:  [전신] [상반신] [얼굴]                         │
│  배경:  [기본] [방] [무대] [자연] [투명]                │
│  조명:  [자연] [따뜻] [시원] [드라마틱] [네온]           │
│                                                      │
│           [📸 스크린샷]    [🎬 녹화 시작]               │
└──────────────────────────────────────────────────────┘
```

### 반응형 대응
- 데스크탑: 위 레이아웃 그대로
- 태블릿: 하단 컨트롤을 접이식으로
- 모바일: 아바타 전체화면 + 하단 시트(bottom sheet)로 옵션

---

## 알려진 이슈 & 대응

### MediaPipe Holistic → 최신 버전 이슈
- MediaPipe Holistic은 legacy 패키지로, 최신은 @mediapipe/tasks-vision으로 이동
- 하지만 KalidoKit은 기존 Holistic 결과 포맷에 맞춰져 있음
- **권장: 기존 @mediapipe/holistic 사용** (KalidoKit 호환 보장)
- 만약 최신으로 가려면 KalidoKit 입력 포맷을 수동 변환해야 함

### VRM 0.x vs 1.0 차이
| | VRM 0.x | VRM 1.0 |
|---|---------|---------|
| BlendShape 이름 | Blink_L, A, I, U, E, O | blinkLeft, aa, ih, ou, ee, oh |
| 본 접근 | vrm.humanoid.getBoneNode() | vrm.humanoid.getRawBoneNode() |
| LookAt | VRMLookAtHead | vrm.lookAt |
| three-vrm 지원 | @pixiv/three-vrm v1.x | @pixiv/three-vrm v2.x |

```javascript
// VRM 버전에 따른 BlendShape 이름 분기
function getExpressionName(vrm, type) {
  const isVRM1 = vrm.meta?.metaVersion === '1';
  const map = {
    blinkLeft:  isVRM1 ? 'blinkLeft' : 'Blink_L',
    blinkRight: isVRM1 ? 'blinkRight' : 'Blink_R',
    aa:         isVRM1 ? 'aa' : 'A',
    ih:         isVRM1 ? 'ih' : 'I',
    ou:         isVRM1 ? 'ou' : 'U',
    ee:         isVRM1 ? 'ee' : 'E',
    oh:         isVRM1 ? 'oh' : 'O',
  };
  return map[type] || type;
}
```

### 성능 최적화
```javascript
// MediaPipe 추론 빈도 제한 (필요 시)
let lastDetectionTime = 0;
const DETECTION_INTERVAL = 33; // 30fps 제한

async function onFrame() {
  const now = Date.now();
  if (now - lastDetectionTime < DETECTION_INTERVAL) return;
  lastDetectionTime = now;
  await holistic.send({ image: videoElement });
}
```

### 미러링 주의사항
- 웹캠 피드: 미러링 ON (거울처럼 자연스럽게)
- 아바타: MediaPipe → KalidoKit이 자동으로 좌우 변환 처리
- 별도의 미러링 로직 불필요 (KalidoKit이 알아서 해줌)

---

## 구현 우선순위

### Phase 1: 코어 (MVP)
- [ ] Three.js 씬 + 조명 + 카메라 설정
- [ ] VRM 로딩 (프리셋 1개로 시작)
- [ ] MediaPipe Holistic 초기화 + 웹캠 연동
- [ ] KalidoKit 연동 → 얼굴 표정 매핑 (눈, 입)
- [ ] 머리 회전 매핑
- [ ] 상체 + 팔 모션 매핑
- [ ] lerp 스무딩 적용
- [ ] 기본 UI (웹캠 PIP + 아바타 메인)

### Phase 2: 꾸미기
- [ ] 아바타 선택 UI (프리셋 3~5개)
- [ ] 커스텀 VRM 업로드
- [ ] 카메라 앵글 프리셋 (전신/상반신/얼굴)
- [ ] 배경 선택
- [ ] 조명 프리셋
- [ ] 스크린샷 기능
- [ ] 영상 녹화 기능 (WebM)

### Phase 3: 폴리싱
- [ ] 손가락 트래킹 (옵션)
- [ ] 마우스/터치로 카메라 자유 회전 (OrbitControls)
- [ ] 포스트프로세싱 이펙트 (bloom 등)
- [ ] 반응형 UI (모바일 대응)
- [ ] VRM 0.x / 1.0 자동 감지 + 호환 처리

---

## 사전 준비 체크리스트

### 카누가 직접 해야 할 것
- [ ] VRM 모델 파일 확보 (최소 1개, 권장 3~5개)
  - VRoid Hub에서 다운로드 또는
  - VRoid Studio에서 직접 제작
- [ ] VRM 파일을 프로젝트 /public/models/ 에 배치

### CLI에게 맡길 것
- [ ] 위 스펙 기반으로 전체 프로젝트 구현
- [ ] Phase 1부터 순차적으로

### 참고 레퍼런스
- three-vrm 공식 예제: https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples
- KalidoKit 데모: https://github.com/RidiculousPower/Kalidokit
- MediaPipe Holistic: https://google.github.io/mediapipe/solutions/holistic
