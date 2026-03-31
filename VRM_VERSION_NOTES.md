# VRM 0.x vs 1.0 버전 차이 정리

## 프로젝트에서 사용 중인 모델

| 파일명 | VRM 버전 | 비고 |
|--------|---------|------|
| `7643054104406740418.vrm` | **0.x** | Avatar 1 |
| `1087600300176247011.vrm` | **1.0** | Avatar 2 |
| `3757658729595240240.vrm` | **1.0** | Avatar 3 (커스텀 표정: ZeroFacial) |
| `5447297406763866907.vrm` | **1.0** | Avatar 4 |

---

## 1. 정면 방향 (Forward Direction)

| | VRM 0.x | VRM 1.0 |
|---|---------|---------|
| 정면 방향 | **-Z** (Three.js 기준) | **+Z** (glTF 2.0 표준) |
| 씬 회전 | `Math.PI` 필요 (카메라 향하게) | 회전 불필요 (이미 카메라 향함) |
| 프로젝트 처리 | `vrm.scene.rotation.y = Math.PI` 전체 적용 | 동일하게 적용 (좌표 통일 목적) |

> **결론**: 프로젝트에서는 전 모델에 `Math.PI`를 적용.
> VRM 0.x는 정면이 카메라를 향하고, VRM 1.0은 뒤통수가 보임.
> OrbitControls로 사용자가 직접 회전하여 확인 가능.

---

## 2. Normalized Bone 좌표계

three-vrm v2는 `getNormalizedBoneNode()`로 통일된 본 접근을 제공하지만,
**내부 좌표 원점 방향이 VRM 버전에 따라 다름**.

| | VRM 0.x normalized | VRM 1.0 normalized |
|---|--------------------|--------------------|
| 정면 축 | +Z | -Z |
| Y축 차이 | 기준 | 180° 회전 차이 |

### KalidoKit 회전값 보정

KalidoKit은 **VRM 0.x 좌표계 기준**으로 회전값을 출력함.
VRM 1.0에 적용할 때는 Y축 180° 회전 차이를 보정해야 함:

```
VRM 0.x: (x,  y,  z) → 그대로 적용
VRM 1.0: (x,  y,  z) → (-x, y, -z) 로 변환
```

| 축 | VRM 0.x | VRM 1.0 | 보정 이유 |
|----|---------|---------|----------|
| X (pitch) | 그대로 | **반전 (-x)** | 팔 올림/내림 방향 |
| Y (yaw) | 그대로 | 그대로 | Y축 회전은 동일 |
| Z (roll) | 그대로 | **반전 (-z)** | 팔 안쪽/바깥쪽 방향 |

### Position 보정 (Hips 등)

```
VRM 0.x: (x,  y,  z) → 그대로
VRM 1.0: (x,  y,  z) → (-x, y, -z)
```

---

## 3. 본 접근 API (three-vrm v2)

| | VRM 0.x (three-vrm v1) | VRM 1.0 (three-vrm v2) |
|---|------------------------|------------------------|
| 본 접근 | `getBoneNode()` | `getRawBoneNode()` / `getNormalizedBoneNode()` |
| 표정 | `blendShapeProxy.setValue()` | `expressionManager.setValue()` |
| 시선 | `VRMLookAtHead` | `vrm.lookAt.yaw` / `vrm.lookAt.pitch` |

> **주의**: `getRawBoneNode()`에 직접 회전값을 쓰면 `vrm.update(delta)`가 매 프레임 덮어씀.
> 반드시 `getNormalizedBoneNode()`를 사용해야 회전이 유지됨.

---

## 4. Expression (표정) 이름

| 표정 | VRM 0.x | VRM 1.0 |
|------|---------|---------|
| 왼눈 깜빡임 | `Blink_L` | `blinkLeft` |
| 오른눈 깜빡임 | `Blink_R` | `blinkRight` |
| 입 아 | `A` | `aa` |
| 입 이 | `I` | `ih` |
| 입 우 | `U` | `ou` |
| 입 에 | `E` | `ee` |
| 입 오 | `O` | `oh` |

> 프로젝트에서는 런타임에 `expressionMap` 키를 탐색하여 자동 매칭 처리.

---

## 5. 버전 감지 방법

```javascript
// three-vrm v2에서 VRM 버전 확인
const isVRM1 = vrm.meta?.metaVersion === '1';
// '1' → VRM 1.0
// undefined 또는 '0' → VRM 0.x
```

---

## 6. 디버깅 팁

브라우저 콘솔에서 확인 가능한 명령:

```javascript
// VRM 버전 확인
console.log(currentVrm.meta?.metaVersion);

// 사용 가능한 본 목록
console.log(Object.keys(currentVrm.humanoid.humanBones));

// 특정 본 존재 확인
console.log(currentVrm.humanoid.getNormalizedBoneNode('leftUpperArm'));

// 사용 가능한 표정 목록
console.log(Object.keys(currentVrm.expressionManager.expressionMap));
```
