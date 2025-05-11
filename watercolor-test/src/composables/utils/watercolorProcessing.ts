import { WatercolorEngine } from "../watercolorEngine";
import {
  setUniformPigmentDistribution,
  setInitialPigmentPositions,
  computeDistanceField,
  computeGradientField,
  getNewPigmentDiffusionDirections,
} from "./watercolorFieldComputation";
import {
  applyDirectionalDiffusion,
  applyConvolution,
  updatePigmentField,
} from "./watercolorDiffusion";

/**
 * 综合处理新添加的颜料点
 * @param engine 水彩引擎实例
 * @param centerX 中心X坐标
 * @param centerY 中心Y坐标
 * @param radius 半径
 */
export function processNewPigmentAddition(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  radius: number
): void {
  // 增加笔画计数
  engine.incrementStrokeCount();

  // 1. 设置初始颜料分布和边缘强度
  setUniformPigmentDistribution(engine, centerX, centerY, radius);

  // 2. 设置初始颜料位置（已有颜料）
  setInitialPigmentPositions(engine);

  // 3. 计算距离场
  computeDistanceField(engine);

  // 4. 计算梯度场
  computeGradientField(engine);

  // 5. 获取扩散方向
  const diffusionDirections = getNewPigmentDiffusionDirections(engine);

  // 6. 应用方向性扩散（不包含边缘强度扩散）
  applyDirectionalDiffusion(engine, diffusionDirections);

  // 7. 应用3x3均匀卷积
  applyConvolution(engine);

  // 8. 更新颜料场和边缘强度场
  updatePigmentField(engine);

  engine.reset();
}
