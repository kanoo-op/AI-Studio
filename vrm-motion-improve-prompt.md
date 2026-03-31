# VRM 모션캡처 개선 요청

## 현재 문제
MediaPipe Holistic으로 포즈를 감지하고 KalidoKit으로 VRM 아바타에 적용하고 있는데, 다음 문제들이 있음:

1. **무릎을 굽혀도 엉덩이(Hips)가 내려가지 않음** — 스쿼트, 앉기 동작이 안 됨
2. **팔 동작이 부자연스러움** — 허리에 손 올리기 같은 동작이 제대로 안 됨
3. **다리/스텝이 부정확함** — 걷기, 사이드스텝 등이 이상함
4. **몸통 회전이 어색함** — 좌우 비틀기가 안 됨
5. **전체적으로 뻣뻣함** — 자연스러운 움직임이 안 나옴

## 수정해야 할 파일
`src/avatar-animator.js`

기존 코드의 animateVRM 함수와 rigRotation, rigPosition, rigFace 함수들을 개선해줘.
다른 파일(main.js, motion-capture.js, vrm-loader.js, scene.js)은 수정하지 마.

## 핵심 개선사항

### 1. Hips 위치(Position) 계산 개선
현재 Hips Y 위치가 고정값(+1)으로 되어있어서 무릎을 굽혀도 엉덩이가 안 내려감.
MediaPipe의 hip(23,24번)과 ankle(27,28번) 좌표를 이용해서 실제 높이를 반영해야 함.

```
방법:
- 캘리브레이션: 첫 프레임(서있는 자세)에서 hip-ankle 거리를 기준값으로 저장
- 매 프레임: 현재 hip-ankle 거리 / 기준 거리 = 높이 비율
- VRM Hips.position.y = 기본높이 × 높이비율
- lerp smoothing 적용 (factor 0.1~0.15, 부드럽게 하되 반응성 유지)
```

### 2. IK 기반 팔 계산
KalidoKit의 팔 회전값이 부정확한 경우가 많음.
MediaPipe 좌표(어깨→팔꿈치→손목)에서 직접 Two-Bone IK로 계산하면 더 정확함.

```
방법:
- 어깨(11,12), 팔꿈치(13,14), 손목(15,16) 3점 좌표 사용
- 어깨→손목 방향벡터 + 팔꿈치 위치로 IK 풀기
- KalidoKit 결과와 블렌딩하거나, 직접 계산값으로 대체
- 관절 범위 제한(clamp):
  - upperArm: x[-180, 80], y[-90, 90], z[-90, 160]
  - lowerArm: x[-5, 150], y[-90, 90], z:[-90, 90]
  (허리에 손 올리기가 가능할 정도로 넓게)
```

### 3. 다리 IK + 발 접지(Grounding)
다리도 Two-Bone IK로 계산하고, 발이 바닥을 뚫지 않게 처리.

```
방법:
- hip(23,24), knee(25,26), ankle(27,28) 3점으로 IK
- 발목 Y좌표가 바닥(0) 아래로 내려가지 않게 clamp
- 한쪽 발이 바닥에 있으면 그쪽은 고정하고 반대쪽만 이동 (foot grounding)
```

### 4. 몸통(Spine/Chest) 회전 개선
양쪽 어깨(11,12)와 양쪽 hip(23,24) 좌표로 몸통 회전을 직접 계산.

```
방법:
- 어깨 벡터(12→11)의 방향 = 상체 좌우 회전(Y축)
- hip 벡터(24→23)의 방향 = 하체 좌우 회전
- 상체-하체 차이 = Spine 비틀기(twist)
- 어깨 중심과 hip 중심의 기울기 = 앞뒤/좌우 기울기
```

### 5. 스무딩 개선 (떨림 제거 + 반응성 유지)
현재 단순 lerp인데, One Euro Filter로 교체하면 떨림은 줄이면서 빠른 동작은 잘 따라감.

```javascript
// One Euro Filter 구현
class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x, t) {
    if (this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = t - this.tPrev;
    if (dt <= 0) return this.xPrev;

    const dx = (x - this.xPrev) / dt;
    const edx = this.exponentialSmoothing(dx, this.dxPrev, this.alpha(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this.exponentialSmoothing(x, this.xPrev, this.alpha(dt, cutoff));

    this.xPrev = result;
    this.dxPrev = edx;
    this.tPrev = t;
    return result;
  }

  alpha(dt, cutoff) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  exponentialSmoothing(x, xPrev, alpha) {
    return alpha * x + (1 - alpha) * xPrev;
  }
}
```

각 본의 x, y, z 회전에 대해 개별 OneEuroFilter 인스턴스를 생성해서 적용.

### 6. Visibility 체크 강화
MediaPipe가 관절을 못 찾으면(visibility < 0.5) 이전 프레임 값을 유지.
갑자기 튀는 현상 방지.

```javascript
function isVisible(landmark) {
  return landmark && landmark.visibility > 0.5;
}

// 적용 시
if (isVisible(poseLandmarks[13])) {
  // 새 값 적용
} else {
  // 이전 프레임 값 유지 (아무것도 안 함)
}
```

### 7. 캘리브레이션 시스템
시작 시 "T-포즈로 서주세요" → 3초 카운트다운 → 기준값 저장

```
저장할 기준값:
- 어깨 너비 (정규화용)
- hip-ankle 거리 (높이 계산용)
- 각 관절의 기본 위치 (상대 움직임 계산용)
- 팔 길이 (IK 계산용)
```

UI에 캘리브레이션 버튼 추가하고, 카메라 시작 후 첫 번째로 실행하게 해줘.

## 구현 우선순위
1번(Hips 높이)이 가장 체감이 클 거야 — 이것만 해도 스쿼트/앉기가 됨
2번(팔 IK) — 허리에 손 올리기 등 자연스러운 팔 동작
5번(One Euro Filter) — 전체적인 떨림 제거
6번(Visibility) — 갑자기 튀는 현상 방지
3번(다리 IK) — 걷기/스텝 개선
4번(몸통 회전) — 비틀기 동작
7번(캘리브레이션) — 정확도 향상

## 주의사항
- animateVRM 함수의 시그니처(vrm, results, videoElement)는 변경하지 마
- export도 기존과 동일하게 유지
- VRM 0.x / 1.0 호환 로직(resolveExpressionKey, toBoneName 등)은 그대로 유지
- rigFace 함수(얼굴 표정)는 건드리지 마 — 얼굴은 잘 되고 있음
- 새로운 npm 패키지 설치 없이 순수 JS로 구현
