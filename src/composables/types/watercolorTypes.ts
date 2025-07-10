// 颜料数据结构
export interface PigmentData {
  color: [number, number, number]; // RGB颜色
  opacity: number; // 不透明度 (0-1)
}

// 笔刷数据结构
export interface BrushData {
  color: [number, number, number];
  opacity: number;
  size: number;
}

// 区域定义
export interface Region {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// 扩散方向数据
export interface DiffusionDirectionsData {
  directionX: Float32Array;
  directionY: Float32Array;
  distanceToCenter: Float32Array;
  shouldDiffuse: Uint8Array;
  // 添加区域信息以便调用者进行正确的索引转换
  regionLeft: number;
  regionTop: number;
  regionWidth: number;
  regionHeight: number;
}
