import { WatercolorEngine } from "../watercolorEngine";
import { DiffusionDirectionsData } from "../types/watercolorTypes";
import {
  wetAreaRadiusFactor,
  wetAreaInnerRadiusFactor,
  wetAreaCenterValue,
  UpdateRadius,
  maxWetValue,
} from "../constants/watercolorConstants";
// PERF_TIMER - 导入性能计时工具
import { startTimer, endTimer } from "./performanceTimer";

/**
 * 设置均匀分布的颜料和湿区
 */
export function setUniformPigmentDistribution(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  radius: number
): void {
  // PERF_TIMER_START - 初始颜料分布设置计时
  const timer = startTimer('setUniformPigmentDistribution');
  
  const { left, right, top, bottom } = engine.getRegion(
    centerX,
    centerY,
    radius * wetAreaRadiusFactor
  );

  const {
    left: left0,
    right: right0,
    top: top0,
    bottom: bottom0,
  } = engine.getRegion(centerX, centerY, radius);
  const radiusSq = radius * radius;
  const wetRadiusSq = (radius * wetAreaRadiusFactor) ** 2;
  const innerWetRadiusSq = (radius * wetAreaInnerRadiusFactor) ** 2;

  // 设置当前笔刷信息
  engine.brushCenterX = centerX;
  engine.brushCenterY = centerY;
  engine.brushRadius = radius;
  engine.pigmentCenters.push({ x: centerX, y: centerY, radius });

  // 计算基于笔画计数的不透明度系数
  const opacityFactor =
    // 0.5 + 0.5 * Math.min(1, engine.strokeCount / engine.maxStrokeCount);
    engine.pigmentConcentration;

  // 确保lastBrushPigment数组尺寸足够
  const brushSize = (2 * radius + 1) * (2 * radius + 1);
  if (engine.lastBrushPigment.length < brushSize) {
    // 初始化为当前笔刷颜色，而不是固定的蓝色
    engine.lastBrushPigment = Array(brushSize)
      .fill(null)
      .map(() => ({
        color: [...engine.brush.color],
        opacity: engine.brush.opacity,
      }));
  }

  // 通用循环处理笔刷范围内的点
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distSq = dx * dx + dy * dy;
      const index = y * engine.canvasWidth + x;

      // 设置湿区场
      if (distSq <= wetRadiusSq) {
        // 计算湿度值 - 内部区域保持最大值，外部区域递减
        let wetValue = wetAreaCenterValue;
        if (distSq > innerWetRadiusSq) {
          const t =
            (Math.sqrt(distSq) - radius * wetAreaInnerRadiusFactor) /
            (radius * (wetAreaRadiusFactor - wetAreaInnerRadiusFactor));
          wetValue = wetAreaCenterValue * (1 - t);
        }

        engine.wetField[index] = Math.min(maxWetValue, engine.wetField[index] +wetValue);
      }

      // 跳过圆外的点
      if (distSq > radiusSq) continue;

      const dist = Math.sqrt(distSq);
      const normalizedDist = dist / radius;
      const newOpacity = (0.2 - normalizedDist * 0.18) * opacityFactor;

      // 设置新颜料场
      engine.newPigmentField[index].isNew = true;

      // 安全地获取lastBrushPigment中的颜色或使用笔刷当前颜色
      let pigmentColor: [number, number, number];
      if (engine.isDrawing) {
        const brushX = x - left0;
        const brushY = y - top0;
        const brushIndex = brushY * (engine.brushRadius * 2 + 1) + brushX;

        pigmentColor = [...engine.lastBrushPigment[brushIndex].color];
      } else {
        pigmentColor = [...engine.brush.color];
      }

      engine.newPigmentField[index].pigmentData = {
        color: pigmentColor,
        opacity: engine.brush.opacity * opacityFactor,
      };

      // 设置原色层 - 完全均匀的笔刷颜色，不参与混色
      engine.primitiveColorField[index].hasPrimitive = true;
      engine.primitiveColorField[index].pigmentData = {
        color: [...engine.brush.color],
        opacity: engine.brush.opacity,
      };
    }
  }

  engine.calculateWetAreaEdges();
  
  // PERF_TIMER_END - 初始颜料分布设置计时结束
  endTimer(timer);
}

/**
 * 设置初始颜料位置
 */
export function setInitialPigmentPositions(engine: WatercolorEngine): void {
  // 清空已有颜料点数组
  engine.existingPigmentPoints = [];

  // 定义搜索范围 - 笔刷半径的1.3倍足够查找所需的颜料点
  const searchRadius = engine.brushRadius * UpdateRadius;
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    searchRadius
  );

  // 只遍历搜索范围内的像素
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;

      if (!engine.pigmentField[index].isOld) {
        engine.distanceField[index] = Infinity;
        engine.closestPigmentX[index] = -1;
        engine.closestPigmentY[index] = -1;
        continue;
      }

      engine.distanceField[index] = 0;
      engine.closestPigmentX[index] = x;
      engine.closestPigmentY[index] = y;

      // 添加到已有颜料点列表
      engine.existingPigmentPoints.push({ x, y });

      if (engine.newPigmentField[index].isNew) {
        engine.overlapMask[index] = 1;
      }
    }
  }
}