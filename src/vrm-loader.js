import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

/**
 * VRM 모델 로딩
 * @param {string} url - VRM 파일 경로
 * @param {THREE.Scene} scene - Three.js 씬
 * @param {function} onProgress - 진행률 콜백
 * @returns {Promise<VRM>}
 */
export async function loadVRM(url, scene, onProgress) {
  const gltf = await loader.loadAsync(url, onProgress);
  const vrm = gltf.userData.vrm;

  // 불필요한 노드 제거 (성능 최적화)
  VRMUtils.removeUnnecessaryJoints(vrm.scene);

  // VRM 0.x: 정면 -Z → Math.PI로 카메라 향하게
  // VRM 1.0: 정면 +Z → Math.PI로 뒤집어서 0.x와 동일한 좌표계로 통일
  vrm.scene.rotation.y = Math.PI;

  scene.add(vrm.scene);

  const ver = vrm.meta?.metaVersion === '1' ? '1.0' : '0.x';
  console.log(`[VRM] 로딩 완료: ${url} (VRM ${ver}), 표정: ${listExpressions(vrm).join(', ')}`);

  return vrm;
}

/**
 * 기존 VRM 제거
 */
export function disposeVRM(vrm, scene) {
  if (!vrm) return;
  scene.remove(vrm.scene);
  VRMUtils.deepDispose(vrm.scene);
}

/**
 * VRM에서 사용 가능한 expression 이름 목록
 */
function listExpressions(vrm) {
  if (!vrm.expressionManager) return [];
  const map = vrm.expressionManager.expressionMap;
  return Object.keys(map);
}
