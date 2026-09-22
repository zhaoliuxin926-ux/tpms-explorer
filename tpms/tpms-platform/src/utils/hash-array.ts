/** 稳定数值数组 hash（cite key / 网格指纹用） */
export function hashArray(arr: Float32Array): string {
  let h = 0;
  // 全量 hash：此前只取前 3000 分量（约前 1000 顶点），不同网格可能碰撞出相同 cite key
  for (let i = 0; i < arr.length; i++) {
    h = ((h * 31) ^ Math.floor(arr[i] * 1000)) >>> 0;
  }
  return h.toString(36) + '-' + (arr.length / 3 | 0);
}
