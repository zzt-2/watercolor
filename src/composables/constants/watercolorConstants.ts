// 更新半径
export const UpdateRadius = 1.6;

// 湿区场参数
export const wetAreaRadiusFactor = 1.0; // 湿区半径为笔刷半径的倍数
export const wetAreaInnerRadiusFactor = 0.8; // 湿区内部均匀区域半径因子
export const maxWetValue = 1.0; // 最大湿度值
export const wetAreaCenterValue = 0.25; // 湿区中心的湿度值
export const wetAreaEdgeValue = 0.01; // 湿区边缘的湿度值
export const edgeDetectionRadiusFactor = 1.3; // 边缘检测范围的半径因子

// 最大扩散距离因子
export const maxDiffusionDistanceFactor = 0.6;

// 步数扩散系统常数
export const stepDiffusionHistoryDepthFactor = 4.0; // 历史深度 = 笔刷半径 × 2
export const stepDiffusionThresholdFactor = 3.0; // 步数差阈值 = 笔刷半径 × 2
export const stepWetAreaRadiusFactor = 1.4; // 湿区半径因子
export const stepDiffusionInnerRadiusFactor = 0.8; // 环形检测内半径
export const stepDiffusionOuterRadiusFactor = 1.0; // 环形检测外半径
export const stepFieldSpecialValue = 999; // 特定值
