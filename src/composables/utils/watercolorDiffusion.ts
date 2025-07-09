import { WatercolorEngine } from "../watercolorEngine";
import { DiffusionDirectionsData } from "../types/watercolorTypes";
import {
  maxDiffusionDistanceFactor,
  UpdateRadius,
} from "../constants/watercolorConstants";
import { computeDistance } from "./watercolorFieldComputation";
import { RGB2HSL, HSL2RGB } from "../../Utils/colorConvert";
import mixbox from "mixbox";

/**
 * 应用方向性扩散 (多点扩散版本)
 */
export function applyDirectionalDiffusion(
  engine: WatercolorEngine,
  directions: DiffusionDirectionsData
): void {
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    engine.brushRadius
  );

  // 创建临时缓冲区
  const tempBuffer = Array(engine.canvasWidth * engine.canvasHeight)
    .fill(null)
    .map(() => ({
      isNew: false,
      pigmentData: {
        color: [255, 255, 255] as [number, number, number],
        opacity: 0,
      },
      edgeIntensity: 0,
    }));

  // 复制现有数据到临时缓冲区
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;
      if (engine.newPigmentField[index].isNew) {
        tempBuffer[index] = { ...engine.newPigmentField[index] };
      }
    }
  }

  // 对新添加的颜料区域应用扩散
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;

      // 检查是否应该扩散
      if (
        !engine.newPigmentField[index].isNew ||
        directions.shouldDiffuse[index] !== 1 ||
        engine.closestPigmentX[index] === -1
      ) {
        continue;
      }

      // 获取基础扩散方向
      const baseDirectionX = directions.directionX[index];
      const baseDirectionY = directions.directionY[index];
      if (baseDirectionX === 0 && baseDirectionY === 0) continue;

      // 计算扩散参数
      const targetX = engine.closestPigmentX[index];
      const targetY = engine.closestPigmentY[index];
      const distToTarget = engine.distanceField[index];
      if (distToTarget === Infinity) continue;

      // 计算源点到中心的距离及比例
      const distToCenter = directions.distanceToCenter[index];
      const centerRatio = Math.min(1, distToCenter / engine.brushRadius);
      const baseAngle = Math.atan2(targetY - y, targetX - x);

      // 获取颜料浓度
      const concentration = engine.newPigmentField[index].pigmentData.opacity;
      if (concentration < 0.01) continue;

      // 计算扩散距离和强度
      const maxTheoricalDistance = Math.min(
        distToTarget * 0.8,
        engine.brushRadius * maxDiffusionDistanceFactor
      );
      const distanceRatio = Math.min(1, distToTarget / maxTheoricalDistance);
      const inverseDistanceFactor = engine.pigmentField[index].isOld
        ? 1
        : Math.pow(1 - distanceRatio, 1.5);

      const maxAllowedDistance = maxTheoricalDistance * inverseDistanceFactor;
      if (maxAllowedDistance < 1) continue;

      // 确定扩散点数和扩散强度
      const numPoints = Math.max(
        2,
        Math.round(2 + 3 * Math.pow(centerRatio, 1.5))
      );
      const baseDiffusionStrength = 0.3 + 0.5 * inverseDistanceFactor;
      const totalDiffusionAmount =
        concentration * baseDiffusionStrength * (0.7 + 0.3 * centerRatio);
      const perPointAmount = totalDiffusionAmount / numPoints;
      let remainingOpacity = concentration - totalDiffusionAmount;

      // 生成多个扩散点
      for (let i = 0; i < numPoints; i++) {
        // 计算随机角度和距离
        const angleVariation = (3 * Math.PI) / 180;
        const randomAngle =
          baseAngle + (Math.random() * 2 - 1) * angleVariation;
        const distanceVariation = 0.7 + Math.random() * 0.3;
        const diffusionDistance = maxAllowedDistance * distanceVariation;

        // 计算目标位置
        const dirX = Math.cos(randomAngle);
        const dirY = Math.sin(randomAngle);
        const diffusionX = Math.round(x + dirX * diffusionDistance);
        const diffusionY = Math.round(y + dirY * diffusionDistance);

        // 检查位置是否有效
        if (
          diffusionX < 0 ||
          diffusionX >= engine.canvasWidth ||
          diffusionY < 0 ||
          diffusionY >= engine.canvasHeight
        ) {
          continue;
        }

        // 检查是否远离中心
        const diffusionToCenterX = engine.brushCenterX - diffusionX;
        const diffusionToCenterY = engine.brushCenterY - diffusionY;
        const diffDistToCenter = Math.sqrt(
          diffusionToCenterX * diffusionToCenterX +
            diffusionToCenterY * diffusionToCenterY
        );
        if (diffDistToCenter > distToCenter * 1.5 && centerRatio > 0.7) {
          continue;
        }

        // 更新扩散点
        const targetIndex = diffusionY * engine.canvasWidth + diffusionX;
        const diffusionAmount = perPointAmount * (1 - (i / numPoints) * 0.3);

        if (!tempBuffer[targetIndex].isNew) {
          tempBuffer[targetIndex] = {
            isNew: true,
            pigmentData: {
              color: [...engine.newPigmentField[index].pigmentData.color],
              opacity: diffusionAmount,
            },
            edgeIntensity: 0,
          };
        } else {
          // 混合颜色
          const currentColor = tempBuffer[targetIndex].pigmentData.color;
          const newColor = engine.newPigmentField[index].pigmentData.color;
          const currentOpacity = tempBuffer[targetIndex].pigmentData.opacity;

          tempBuffer[targetIndex].pigmentData.color = currentColor.map((c, i) =>
            Math.round(
              (c * currentOpacity + newColor[i] * diffusionAmount) /
                (currentOpacity + diffusionAmount)
            )
          ) as [number, number, number];

          tempBuffer[targetIndex].pigmentData.opacity = Math.min(
            1,
            currentOpacity + diffusionAmount
          );
        }
      }

      // 更新源点的剩余颜料
      tempBuffer[index].pigmentData.opacity = Math.max(0, remainingOpacity);
    }
  }

  // 将临时缓冲区数据复制回原始数组，增加范围以包含所有扩散点
  const expandedRange = engine.brushRadius * 1.5; // 扩散扩展范围
  for (let y = top - expandedRange; y <= bottom + expandedRange; y++) {
    for (let x = left - expandedRange; x <= right + expandedRange; x++) {
      if (
        x >= 0 &&
        x < engine.canvasWidth &&
        y >= 0 &&
        y < engine.canvasHeight
      ) {
        const index = y * engine.canvasWidth + x;
        if (tempBuffer[index] && tempBuffer[index].isNew) {
          engine.newPigmentField[index] = {
            isNew: true,
            pigmentData: {
              color: [...tempBuffer[index].pigmentData.color],
              opacity: tempBuffer[index].pigmentData.opacity,
            },
            edgeIntensity: 0,
          };
        }
      }
    }
  }
}

/**
 * 更新颜料场
 */
export function updatePigmentField(engine: WatercolorEngine): void {
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
      const newOpacity = newPigment.opacity;

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
  const retentionRatio = 0.01; // averageColor占小比例
  const innerCircleRadiusFactor = 1; // 内圈半径因子

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
        const lightnessProtectionRatio = 0.1; // 30%保持原始亮度
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
}
