import { WatercolorEngine } from "../watercolorEngine";
import {
  setUniformPigmentDistribution,
  setInitialPigmentPositions,
} from "./watercolorFieldComputation";
import {
  applyRingAreaDiffusion,
  updatePigmentField,
  updateStepBasedWetArea,
} from "./watercolorDiffusion";
import mixbox from "mixbox";
// PERF_TIMER - 导入性能计时工具
import { startTimer, endTimer } from "./performanceTimer";

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
  // PERF_TIMER_START - 整体处理流程计时
  const overallTimer = startTimer('processNewPigmentAddition');
  
  // 初始化颜料分布 - 会同时设置原色层
  setUniformPigmentDistribution(engine, centerX, centerY, radius);

  // 计算基础距离场，避免不必要的计算循环
  setInitialPigmentPositions(engine);

  // 测试新的环形区域扩散方法
  applyRingAreaDiffusion(engine);

  // 更新基于步数的湿区系统
  updateStepBasedWetArea(engine, centerX, centerY, radius);

  // 更新颜料场
  updatePigmentField(engine);

  // 增加笔画计数
  engine.incrementStrokeCount();
  
  // PERF_TIMER_END - 整体处理流程计时结束
  endTimer(overallTimer);
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
