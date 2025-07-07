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
  updatePigmentField,
} from "./watercolorDiffusion";
import mixbox from "mixbox";

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
  // 初始化颜料分布 - 会同时设置原色层
  setUniformPigmentDistribution(engine, centerX, centerY, radius);

  // 计算基础距离场，避免不必要的计算循环
  setInitialPigmentPositions(engine);
  computeDistanceField(engine);
  computeGradientField(engine);

  // 获取扩散方向数据
  const diffusionDirections = getNewPigmentDiffusionDirections(engine);

  // 应用方向性扩散
  applyDirectionalDiffusion(engine, diffusionDirections);

  // 更新颜料场
  updatePigmentField(engine);

  // 增加笔画计数
  engine.incrementStrokeCount();
}

/**
 * 将原色层混入主颜料场
 */
export function mixPrimitiveLayerToPigmentField(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  radius: number
): void {
  const { left, right, top, bottom } = engine.getRegion(centerX, centerY, radius);

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distSq = dx * dx + dy * dy;
      
      // 只处理半径内的像素
      if (distSq > radius * radius) continue;
      
      const index = y * engine.canvasWidth + x;
      
      // 检查是否有原色层数据
      if (!engine.primitiveColorField[index].hasPrimitive) continue;
      
      const primitiveColor = engine.primitiveColorField[index].pigmentData;
      
             // 混入主颜料场，与render函数保持完全一致的混色逻辑
       if (engine.pigmentField[index].isOld) {
         const oldPigment = engine.pigmentField[index].pigmentData;
         const oldOpacity = oldPigment.opacity;
         const newOpacity = primitiveColor.opacity;
         
         if (oldOpacity < 0.01) {
           engine.pigmentField[index].pigmentData = {
             color: [...primitiveColor.color],
             opacity: newOpacity,
           };
         } else {
           // 使用与render函数相同的固定比例0.1
           engine.pigmentField[index].pigmentData = {
             color: mixbox.lerp(
               `rgb(${oldPigment.color.join(",")})`,
               `rgb(${primitiveColor.color.join(",")})`,
               0.1
             ),
             opacity: Math.min(1, oldOpacity + newOpacity * 0.8),
           };
         }
       } else {
         engine.pigmentField[index].isOld = true;
         engine.pigmentField[index].pigmentData = {
           color: [...primitiveColor.color],
           opacity: primitiveColor.opacity,
         };
       }
    }
  }
}

/**
 * 清空指定区域的原色层
 */
export function clearPrimitiveLayer(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  radius: number
): void {
  const { left, right, top, bottom } = engine.getRegion(centerX, centerY, radius);

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distSq = dx * dx + dy * dy;
      
      // 只处理半径内的像素
      if (distSq > radius * radius) continue;
      
      const index = y * engine.canvasWidth + x;
      engine.primitiveColorField[index].hasPrimitive = false;
    }
  }
}
