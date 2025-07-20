import { WatercolorEngine } from "../watercolorEngine";
import { UpdateRadius } from "../constants/watercolorConstants";
import { RGB2HSL, HSL2RGB } from "../../Utils/colorConvert";
import mixbox from "mixbox";
// PERF_TIMER - 导入性能计时工具
import { startTimer, endTimer } from "./performanceTimer";
import {
  stepDiffusionHistoryDepthFactor,
  stepWetAreaRadiusFactor,
  stepFieldSpecialValue,
  stepDiffusionThresholdFactor,
} from "../constants/watercolorConstants";

/**
 * 更新颜料场
 */
export function updatePigmentField(engine: WatercolorEngine): void {
  // PERF_TIMER_START - 颜料场更新计时
  const timer = startTimer('updatePigmentField');
  
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    engine.brushRadius * UpdateRadius
  );

  // 遍历所有像素
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;

      // 跳过不需要处理的像素
      if (
        !engine.newPigmentField[index].isNew ||
        engine.newPigmentField[index].pigmentData.opacity < 0.01
      ) {
        continue;
      }

      const newPigment = engine.newPigmentField[index].pigmentData;
      const newOpacity = newPigment.opacity * engine.pigmentConcentration;

      // 检查是否有已有颜料并混合
      if (engine.pigmentField[index].isOld) {
        const oldPigment = engine.pigmentField[index].pigmentData;
        const oldOpacity = oldPigment.opacity;

        // 如果已有颜料的不透明度太低，直接用新颜料替换
        if (oldOpacity < 0.01) {
          engine.pigmentField[index].pigmentData = {
            color: [...newPigment.color],
            opacity: newOpacity,
          };
        } else {
          // 计算混合比例并混合颜色
          const mixRatio = Math.min(1, 2*newOpacity / (2*newOpacity + oldOpacity));
          engine.pigmentField[index].pigmentData = {
            color: mixbox.lerp(
              `rgb(${oldPigment.color.join(",")})`,
              `rgb(${newPigment.color.join(",")})`,
              mixRatio
            ),
            opacity: Math.min(1, oldOpacity + newOpacity * 0.8),
          };
        }
      } else {
        // 如果没有已有颜料，直接设置为新颜料
        engine.pigmentField[index].isOld = true;
        engine.pigmentField[index].pigmentData = {
          color: [...newPigment.color],
          opacity: newOpacity,
        };
      }
    }
  }

  // 更新lastBrushPigment - 使用保留一定比例的方案
  const {
    left: brushLeft,
    right: brushRight,
    top: brushTop,
    bottom: brushBottom,
  } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    engine.brushRadius
  );

  // 保留原有颜色的比例
  const retentionRatio = Math.pow(engine.blendRatio, 3); // averageColor占小比例
  const innerCircleRadiusFactor = 0.5; // 内圈半径因子

  // 1. 在内圈区域计算平均颜色
  let totalR = 0,
    totalG = 0,
    totalB = 0;
  let pixelCount = 0;

  // 在内圈收集颜色
  for (let y = brushTop; y <= brushBottom; y++) {
    for (let x = brushLeft; x <= brushRight; x++) {
      const index = y * engine.canvasWidth + x;
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (
        distance < engine.brushRadius * innerCircleRadiusFactor &&
        engine.pigmentField[index].isOld
      ) {
        const color = engine.pigmentField[index].pigmentData.color;
        totalR += color[0];
        totalG += color[1];
        totalB += color[2];
        pixelCount++;
      }
    }
  }

  // 计算平均颜色
  const averageColor: [number, number, number] =
    pixelCount > 0
      ? [
          Math.round(totalR / pixelCount),
          Math.round(totalG / pixelCount),
          Math.round(totalB / pixelCount),
        ]
      : [255, 255, 255];

  // 2. 将计算出的平均颜色混合到整个范围的pigmentField，然后更新lastBrushPigment
  for (let y = brushTop; y <= brushBottom; y++) {
    for (let x = brushLeft; x <= brushRight; x++) {
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const index = y * engine.canvasWidth + x;
      const brushX = x - brushLeft;
      const brushY = y - brushTop;
      const brushIndex = brushY * (engine.brushRadius * 2 + 1) + brushX;

      if (distance >= engine.brushRadius * innerCircleRadiusFactor) {
        // 确保索引在有效范围内
        if (brushIndex >= 0 && brushIndex < engine.lastBrushPigment.length) {
          // 混合pigmentField颜色和averageColor
          const fieldColor = engine.pigmentField[index].isOld
            ? engine.pigmentField[index].pigmentData.color
            : [255, 255, 255];

          // 混合颜色 (fieldColor + 少量averageColor)
          const mixedColor = [
            Math.round(
              fieldColor[0] * (1 - retentionRatio) +
                averageColor[0] * retentionRatio
            ),
            Math.round(
              fieldColor[1] * (1 - retentionRatio) +
                averageColor[1] * retentionRatio
            ),
            Math.round(
              fieldColor[2] * (1 - retentionRatio) +
                averageColor[2] * retentionRatio
            ),
          ] as [number, number, number];

          // 更新lastBrushPigment
          engine.lastBrushPigment[brushIndex] = {
            color: mixedColor,
            opacity: engine.pigmentField[index].isOld
              ? engine.pigmentField[index].pigmentData.opacity
              : 1,
          };
        }
      } else {
        // 内圈使用HSL保护机制，保持混色效果同时防止过度变深
        const fieldColor = engine.pigmentField[index].isOld
          ? engine.pigmentField[index].pigmentData.color
          : engine.brush.color;
        
        // 转换到HSL色彩空间
        const fieldHSL = RGB2HSL(fieldColor[0], fieldColor[1], fieldColor[2]);
        const brushHSL = RGB2HSL(engine.brush.color[0], engine.brush.color[1], engine.brush.color[2]);
        
        // 保持色相和饱和度的混色效果，只保护亮度
        const lightnessProtectionRatio = 0.2; // 30%保持原始亮度
        const protectedL = fieldHSL.l * (1 - lightnessProtectionRatio) + brushHSL.l * lightnessProtectionRatio;
        
        // 确保亮度不会低于原始笔刷亮度的80%
        const minAllowedL = brushHSL.l * 0.7;
        const finalL = Math.max(minAllowedL, protectedL);
        
        // 转换回RGB
        const { r, g, b } = HSL2RGB(fieldHSL.h, fieldHSL.s, finalL);
        const protectedColor: [number, number, number] = [r, g, b];
        
        engine.lastBrushPigment[brushIndex] = {
          color: protectedColor,
          opacity: 1,
        };
      }
    }
  }
  
  // PERF_TIMER_END - 颜料场更新计时结束
  endTimer(timer);
}

/**
 * 环形区域扩散函数 - 测试版本
 * 对笔刷半径的0.8到1.0倍环形区域进行扩散
 * 任何时候都会扩散，用于测试新扩散方法的效果
 */
export function applyRingAreaDiffusion(engine: WatercolorEngine): void {
  // PERF_TIMER_START - 环形扩散计时
  const timer = startTimer('applyRingAreaDiffusion');
  
  const brushRadius = engine.brushRadius;
  const innerRadius = brushRadius * 0.9;  // 内环半径
  const outerRadius = brushRadius * 1.0;  // 外环半径
  
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    outerRadius
  );

  // 创建临时缓冲区存储扩散结果
  const tempBuffer = new Map<number, {
    isNew: boolean;
    pigmentData: {
      color: [number, number, number];
      opacity: number;
    };
    edgeIntensity: number;
  }>();

  // 复制现有数据到临时缓冲区
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;
      if (engine.newPigmentField[index].isNew) {
        tempBuffer.set(index, { ...engine.newPigmentField[index] });
      }
    }
  }

  // 计算步数条件检查参数
  const stepThreshold = Math.ceil(brushRadius * stepDiffusionThresholdFactor);

  // 遍历环形区域，对每个有颜料的像素进行扩散
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;

      // 计算到笔刷中心的距离
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const distanceToCenter = Math.sqrt(dx * dx + dy * dy);

      // 检查是否在环形区域内
      if (distanceToCenter < innerRadius || distanceToCenter > outerRadius) {
        continue;
      }

      // 检查步数条件：步数差大于阈值或值为特定值
      const stepValue = engine.stepField[index];
      const stepDiff = engine.currentStepCount - stepValue;
      // console.log(stepDiff, stepThreshold, stepValue);
      if (!(stepDiff > stepThreshold || stepValue === stepFieldSpecialValue) || stepValue === 0) {
        continue;
      }

      // 检查是否有颜料
      if (!engine.newPigmentField[index].isNew) {
        continue;
      }

      const concentration = engine.newPigmentField[index].pigmentData.opacity;
      if (concentration < 0.01) continue;

      // 计算扩散强度（环形区域中央扩散更强）
      const ringPosition = (distanceToCenter - innerRadius) / (outerRadius - innerRadius);
      const ringCenter = 0.5; // 环形中央位置
      const distanceFromRingCenter = Math.abs(ringPosition - ringCenter);
      const diffusionStrength = (1 - distanceFromRingCenter * 2) * 0.4; // 中央强度0.4，边缘强度0.0

      if (diffusionStrength <= 0) continue;

      // 扩散参数 - 增加扩散距离
      const maxDiffusionDistance = brushRadius * 0.4; // 扩散距离从0.3增加到0.8
      const numDiffusionPoints = 8; // 扩散点数从6增加到8
      const totalDiffusionAmount = concentration * diffusionStrength;
      const perPointAmount = totalDiffusionAmount / numDiffusionPoints;

      // 生成多个扩散点
      for (let i = 0; i < numDiffusionPoints; i++) {
        // 计算扩散角度（均匀分布 + 随机偏移）
        const baseAngle = (i / numDiffusionPoints) * 2 * Math.PI;
        const randomOffset = (Math.random() - 0.5) * (Math.PI / 6); // ±30度随机偏移
        const diffusionAngle = baseAngle + randomOffset;

        // 计算扩散距离（随机变化）
        const distanceVariation = 0.7 + Math.random() * 0.6; // 0.7 到 1.3 倍
        const diffusionDistance = maxDiffusionDistance * distanceVariation;

        // 计算目标位置
        const dirX = Math.cos(diffusionAngle);
        const dirY = Math.sin(diffusionAngle);
        const targetX = Math.round(x + dirX * diffusionDistance);
        const targetY = Math.round(y + dirY * diffusionDistance);

        // 检查目标位置是否有效
        if (
          targetX < 0 ||
          targetX >= engine.canvasWidth ||
          targetY < 0 ||
          targetY >= engine.canvasHeight
        ) {
          continue;
        }

        const targetIndex = targetY * engine.canvasWidth + targetX;
        const diffusionAmount = perPointAmount * (0.8 + Math.random() * 0.4); // 80%-120%变化

        // 更新扩散点
        const existingBuffer = tempBuffer.get(targetIndex);
        if (!existingBuffer || !existingBuffer.isNew) {
          tempBuffer.set(targetIndex, {
            isNew: true,
            pigmentData: {
              color: [...engine.newPigmentField[index].pigmentData.color],
              opacity: diffusionAmount,
            },
            edgeIntensity: 0,
          });
        } else {
          // 混合颜色（简单的透明度加权平均）
          const currentColor = existingBuffer.pigmentData.color;
          const newColor = engine.newPigmentField[index].pigmentData.color;
          const currentOpacity = existingBuffer.pigmentData.opacity;

          existingBuffer.pigmentData.color = currentColor.map((c: number, i: number) =>
            Math.round(
              (c * currentOpacity + newColor[i] * diffusionAmount) /
                (currentOpacity + diffusionAmount)
            )
          ) as [number, number, number];

          existingBuffer.pigmentData.opacity = Math.min(
            1,
            currentOpacity + diffusionAmount
          );
        }
      }

      // 减少源点颜料（模拟颜料扩散出去）
      const sourceBuffer = tempBuffer.get(index);
      if (sourceBuffer) {
        const retentionRatio = 0.7; // 保留70%的颜料
        sourceBuffer.pigmentData.opacity = Math.max(
          0,
          concentration * retentionRatio
        );
      }
    }
  }

  // 将扩散结果应用到引擎
  const expandedRange = Math.ceil(outerRadius + brushRadius * 0.8); // 考虑扩散距离
  for (let y = top - expandedRange; y <= bottom + expandedRange; y++) {
    for (let x = left - expandedRange; x <= right + expandedRange; x++) {
      if (
        x >= 0 &&
        x < engine.canvasWidth &&
        y >= 0 &&
        y < engine.canvasHeight
      ) {
        const index = y * engine.canvasWidth + x;
        const bufferData = tempBuffer.get(index);
        if (bufferData && bufferData.isNew) {
          engine.newPigmentField[index] = {
            isNew: true,
            pigmentData: {
              color: [...bufferData.pigmentData.color] as [number, number, number],
              opacity: bufferData.pigmentData.opacity,
            },
            edgeIntensity: 0,
          };
        }
      }
    }
  }
  
  // PERF_TIMER_END - 环形扩散计时结束
  endTimer(timer);
}

/**
 * 更新基于步数的湿区系统
 */
export function updateStepBasedWetArea(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  radius: number
): void {
  // 添加当前坐标到历史记录
  engine.coordinateHistory.push({ x: centerX, y: centerY });
  engine.currentStepCount++;

  // 维护历史记录的固定长度
  const maxHistoryLength = Math.ceil(radius * stepDiffusionHistoryDepthFactor);
  if (engine.coordinateHistory.length > maxHistoryLength) {
    engine.coordinateHistory.shift(); // 移除最旧的坐标
  }

  // 检查历史数组最后一位（延迟位置）是否存在数据
  const delayIndex = engine.coordinateHistory.length - maxHistoryLength;
  if (delayIndex >= 0 && engine.coordinateHistory[delayIndex]) {
    const delayCoord = engine.coordinateHistory[delayIndex];
    writeStepNumbers(engine, delayCoord.x, delayCoord.y, radius);
  }
}

/**
 * 为指定坐标周围的湿区写入步数
 */
function writeStepNumbers(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  radius: number
): void {
  const wetRadius = radius * stepWetAreaRadiusFactor;
  const { left, right, top, bottom } = engine.getRegion(centerX, centerY, wetRadius);

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distSq = dx * dx + dy * dy;

      if (distSq <= wetRadius * wetRadius) {
        const index = y * engine.canvasWidth + x;
        // 只为值不为特定值的点写入步数
        if (engine.stepField[index] !== stepFieldSpecialValue) {
          engine.stepField[index] = engine.currentStepCount;
        }
      }
    }
  }
}





/**
 * 重置步数字段（松开时调用）
 */
export function resetStepField(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  radius: number
): void {
  // 处理剩余的历史坐标
  for (const coord of engine.coordinateHistory) {
    writeStepNumbers(engine, coord.x, coord.y, radius);
  }

  engine.stepField.forEach((value, index) => {
    if (value !== stepFieldSpecialValue && value !== 0) {
      engine.stepField[index] = stepFieldSpecialValue;
    }
  });

  // 清空历史坐标数组
  engine.coordinateHistory = [];
  engine.currentStepCount = 0;
}