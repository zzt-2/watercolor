import { WatercolorEngine } from "../watercolorEngine";
import mixbox from "mixbox";
import { RGB2HSL, HSL2RGB } from "../../Utils/colorConvert";

/**
 * 计算累积阻力因子 - 越接近最大值，越难累积
 */
function calculateAccumulationResistance(
  currentValue: number,
  maxValue: number
): number {
  const ratio = currentValue / maxValue;
  // 使用指数曲线：越接近最大值，阻力越大
  return Math.pow(1 - ratio, 2); // 阻力从1降到0
}

/**
 * 触发点接口定义
 */
interface TriggerPoint {
  x: number;
  y: number;
  intensity: number;
}

/**
 * 检测边缘扩散触发点
 */
function detectEdgeDiffusionTriggers(engine: WatercolorEngine): TriggerPoint[] {
  const triggers: TriggerPoint[] = [];
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    engine.brushRadius + 1
  );

  // 在整个笔刷范围内检测，不限制边缘
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // 在整个笔刷范围内都可以触发扩散
      if (distance <= engine.brushRadius) {
        const index = y * engine.canvasWidth + x;
        
        // 检查是否同时存在颜料边缘
        const hasEdge = engine.firstLayerEdgeField[index] > 0.02 || 
                       engine.secondLayerEdgeField[index] > 0.02;
        const hasPigment = engine.pigmentField[index].isOld || 
                          engine.newPigmentField[index].isNew;
        
        if (hasEdge && hasPigment) {
          const intensity = Math.max(
            engine.firstLayerEdgeField[index],
            engine.secondLayerEdgeField[index]
          );
          triggers.push({ x, y, intensity });
        }
      }
    }
  }
  
  return triggers;
}

/**
 * 将全局坐标转换为临时层的局部坐标 - 与lastBrushPigment保持一致
 */
function globalToTempCoords(globalX: number, globalY: number, engine: WatercolorEngine): {tempX: number, tempY: number, tempIndex: number} {
  const tempRadius = Math.ceil(engine.brushRadius);
  // 与lastBrushPigment相同的转换方式
  const tempLeft = engine.thirdLayerTempCenterX - tempRadius;
  const tempTop = engine.thirdLayerTempCenterY - tempRadius;
  const tempX = globalX - tempLeft;
  const tempY = globalY - tempTop;
  const tempSize = tempRadius * 2 + 1; // 与lastBrushPigment一致，使用2*radius+1
  const tempIndex = tempY * tempSize + tempX;
  
  return { tempX, tempY, tempIndex };
}

/**
 * 检查坐标是否在临时层范围内
 */
function isInTempBounds(tempX: number, tempY: number, engine: WatercolorEngine): boolean {
  const tempRadius = Math.ceil(engine.brushRadius);
  const tempSize = tempRadius * 2 + 1;
  return tempX >= 0 && tempX < tempSize && tempY >= 0 && tempY < tempSize;
}

/**
 * 在触发点简单注入强度值
 */
function injectTriggerIntensity(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  baseIntensity: number
): void {
  // 转换到临时层坐标
  const { tempX, tempY, tempIndex } = globalToTempCoords(centerX, centerY, engine);
  
  if (!isInTempBounds(tempX, tempY, engine)) {
    return;
  }
  
  // 简单注入强度，适度降低避免过饱和
  const injectionStrength = baseIntensity * 0.15; // 降低注入强度
  
  // 累积到临时层，限制最大值
  const currentValue = engine.thirdLayerTempField[tempIndex];
  const maxAccumulation = 0.6; // 降低最大累积值
  engine.thirdLayerTempField[tempIndex] = Math.min(maxAccumulation, currentValue + injectionStrength);
}

/**
 * 应用动态平衡衰减到临时层
 */
function applyDynamicDecay(engine: WatercolorEngine): void {
  const tempRadius = Math.ceil(engine.brushRadius);
  const tempSize = tempRadius * 2 + 1;
  const centerX = tempRadius; // 在tempSize数组中的中心X坐标
  const centerY = tempRadius; // 在tempSize数组中的中心Y坐标
  
  for (let tempY = 0; tempY < tempSize; tempY++) {
    for (let tempX = 0; tempX < tempSize; tempX++) {
      const tempIndex = tempY * tempSize + tempX;
      
      if (engine.thirdLayerTempField[tempIndex] > 0.0001) {
        // 计算距离中心的距离
        const dx = tempX - centerX;
        const dy = tempY - centerY;
        const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
        
        // 只在圆形范围内应用衰减
        if (distanceFromCenter <= tempRadius) {
          const normalizedDistance = distanceFromCenter / tempRadius;
        
          // 更平缓的衰减 - 减少各级差距，提高持久性
          let decayFactor: number;
          if (normalizedDistance > 0.8) {
            // 外圈：较温和的衰减
            decayFactor = 0.99;
          } else if (normalizedDistance > 0.6) {
            // 中外圈：轻微衰减
            decayFactor = 0.992;
          } else {
            // 内圈：几乎不衰减
            decayFactor = 0.997;
          }
          engine.thirdLayerTempField[tempIndex] *= decayFactor;
          
          // 降低清除阈值，让更多微弱效果保留
          if (engine.thirdLayerTempField[tempIndex] < 0.00005) {
            engine.thirdLayerTempField[tempIndex] = 0;
          }
        }
      }
    }
  }
}

/**
 * 从持久层复制初始值到临时层（类似lastBrushPigment机制）
 */
function copyPersistentToTemp(engine: WatercolorEngine): void {
  const tempRadius = Math.ceil(engine.brushRadius);
  const tempSize = tempRadius * 2 + 1;
  const tempLeft = engine.thirdLayerTempCenterX - tempRadius;
  const tempTop = engine.thirdLayerTempCenterY - tempRadius;
  
  // 遍历临时层，从持久层复制对应值
  for (let tempY = 0; tempY < tempSize; tempY++) {
    for (let tempX = 0; tempX < tempSize; tempX++) {
      const tempIndex = tempY * tempSize + tempX;
      
      // 转换到全局坐标
      const globalX = tempLeft + tempX;
      const globalY = tempTop + tempY;
      
      // 检查边界
      if (globalX >= 0 && globalX < engine.canvasWidth && 
          globalY >= 0 && globalY < engine.canvasHeight) {
        const globalIndex = globalY * engine.canvasWidth + globalX;
        
        // 从持久层复制值到临时层
        engine.thirdLayerTempField[tempIndex] = engine.thirdLayerPersistentField[globalIndex];
      } else {
        // 边界外设为0
        engine.thirdLayerTempField[tempIndex] = 0;
      }
    }
  }
}

/**
 * 对临时层中所有非零值进行高效的邻域扩散
 */
function applyFieldDiffusion(engine: WatercolorEngine): void {
  const tempRadius = Math.ceil(engine.brushRadius);
  const tempSize = tempRadius * 2 + 1;
  
  // 创建临时缓冲区以避免自我影响
  const diffusionBuffer = new Float32Array(engine.thirdLayerTempField.length);
  
  // 预计算方向权重（性能优化）
  const hasDirection = engine.hasDragDirection;
  const dragDirX = hasDirection ? engine.dragDirectionX : 0;
  const dragDirY = hasDirection ? engine.dragDirectionY : 0;
  
  // 8邻域偏移（优化：预定义避免重复计算）
  const neighbors = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1], 
    [1, -1],  [1, 0],  [1, 1]
  ];
  
  // 遍历所有临时层点
  for (let tempY = 0; tempY < tempSize; tempY++) {
    for (let tempX = 0; tempX < tempSize; tempX++) {
      const tempIndex = tempY * tempSize + tempX;
      const currentValue = engine.thirdLayerTempField[tempIndex];
      
      // 性能优化：早期退出，只处理有意义的值
      if (currentValue < 0.001) continue;
      
      // 计算到中心的距离（用于范围检查）
      const dx = tempX - tempRadius;
      const dy = tempY - tempRadius;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      
      // 只在圆形范围内扩散
      if (distanceFromCenter > tempRadius) continue;
      
      // 计算扩散强度（大幅降低以避免快速饱和）
      const diffusionStrength = currentValue * 0.02; // 从0.12大幅降低到0.025
      
      // 向8邻域扩散
      for (const [offsetX, offsetY] of neighbors) {
        const neighborX = tempX + offsetX;
        const neighborY = tempY + offsetY;
        
        // 边界检查
        if (neighborX < 0 || neighborX >= tempSize || 
            neighborY < 0 || neighborY >= tempSize) continue;
        
        // 检查邻域点是否在圆形范围内
        const neighborDx = neighborX - tempRadius;
        const neighborDy = neighborY - tempRadius;
        const neighborDist = Math.sqrt(neighborDx * neighborDx + neighborDy * neighborDy);
        if (neighborDist > tempRadius) continue;
        
        const neighborIndex = neighborY * tempSize + neighborX;
        
        // 计算方向性权重
        let directionalWeight = 1.0;
        if (hasDirection) {
          // 计算扩散方向（相对于8邻域的偏移）
          const diffusionDirX = offsetX;
          const diffusionDirY = offsetY;
          
          // 计算与拖动方向的点积（不需要归一化，因为偏移量本身就是单位向量的倍数）
          const dotProduct = diffusionDirX * dragDirX + diffusionDirY * dragDirY;
          
          // 更强的方向性差异：严格限制非拖动方向的扩散
          if (dotProduct > 0.5) {
            // 拖动方向：正常扩散
            directionalWeight = 1.0;
          } else if (dotProduct < -0.5) {
            // 反方向：大幅减弱
            directionalWeight = 0.1;
          } else {
            // 侧向：显著减弱
            directionalWeight = 0.3;
          }
        } else {
          // 没有拖动方向时，减少整体扩散强度
          directionalWeight = 0.6;
        }
        
        // 距离衰减（对角邻居距离更远）
        const distanceWeight = (Math.abs(offsetX) + Math.abs(offsetY)) === 1 ? 1.0 : 0.7;
        
        // 累积扩散值到缓冲区
        const finalDiffusion = diffusionStrength * directionalWeight * distanceWeight;
        diffusionBuffer[neighborIndex] += finalDiffusion;
      }
    }
  }
  
  // 将扩散结果累加回原始数组，限制最大值避免过饱和
  for (let i = 0; i < diffusionBuffer.length; i++) {
    if (diffusionBuffer[i] > 0) {
      engine.thirdLayerTempField[i] = Math.min(0.5, engine.thirdLayerTempField[i] + diffusionBuffer[i]); // 从1.0降到0.5
    }
  }
}

/**
 * 处理第三层边缘扩散
 */
function processThirdLayerEdgeDiffusion(engine: WatercolorEngine, triggers: TriggerPoint[]): void {
  // 确保临时层大小正确
  engine.ensureThirdLayerTempSize(engine.brushCenterX, engine.brushCenterY, engine.brushRadius);
  
  // 从持久层复制初始值到临时层（类似lastBrushPigment的机制）
  copyPersistentToTemp(engine);
  
  // 应用动态平衡衰减
  applyDynamicDecay(engine);
  
  // 对每个触发点应用强度注入（而非扩散）
  for (const trigger of triggers) {
    injectTriggerIntensity(engine, trigger.x, trigger.y, trigger.intensity);
  }
  
  // 【新增】对临时层中所有非零值进行扩散
  applyFieldDiffusion(engine);
  
  // 将临时层数据转移到持久层（严格使用圆形范围）
  const tempRadius = Math.ceil(engine.brushRadius);
  const tempSize = tempRadius * 2 + 1;
  const tempLeft = engine.thirdLayerTempCenterX - tempRadius;
  const tempTop = engine.thirdLayerTempCenterY - tempRadius;
  
  for (let tempY = 0; tempY < tempSize; tempY++) {
    for (let tempX = 0; tempX < tempSize; tempX++) {
      const tempIndex = tempY * tempSize + tempX;
      const tempValue = engine.thirdLayerTempField[tempIndex] / 2;
      
      if (tempValue > 0.0001) { // 降低阈值，让更多数据转移到持久层
        // 计算在temp数组中距离中心的距离
        const dx = tempX - tempRadius;
        const dy = tempY - tempRadius;
        const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
        
        // 只在圆形范围内转移到持久层
        if (distanceFromCenter <= tempRadius) {
          // 转换回全局坐标
          const globalX = tempLeft + tempX;
          const globalY = tempTop + tempY;
          
          // 检查边界
          if (globalX >= 0 && globalX < engine.canvasWidth && 
              globalY >= 0 && globalY < engine.canvasHeight) {
            const globalIndex = globalY * engine.canvasWidth + globalX;
            
            // 新旧混合更新到持久层（类似lastBrushPigment的机制）
            const oldValue = engine.thirdLayerPersistentField[globalIndex];
            const mixRatio = 0.7; // 新值权重
            engine.thirdLayerPersistentField[globalIndex] = oldValue * (1 - mixRatio) + tempValue * mixRatio;
          }
        }
      }
    }
  }
}


/**
 * 使用Sobel算子计算湿区的边缘强度 - 三层边缘实现
 */
export function calculateWetAreaEdges(engine: WatercolorEngine): void {
  // 减小边缘检测范围，避免远处旧边缘被激活
  const wetRadius =
    engine.brushRadius * Math.min(engine.edgeDetectionRadiusFactor, 2.0);
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    wetRadius
  );

  // 计算有效的区域范围（内缩一个像素，避免边界问题）
  const validLeft = left + 1;
  const validRight = right - 1;
  const validTop = top + 1;
  const validBottom = bottom - 1;

  // 笔刷移动方向记录已删除，为重写第三层做准备

  // 创建临时湿度梯度场
  const gradientMagnitude = new Float32Array(
    engine.canvasWidth * engine.canvasHeight
  );

  // Sobel算子核
  const sobelX = [
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1],
  ];
  const sobelY = [
    [-1, -2, -1],
    [0, 0, 0],
    [1, 2, 1],
  ];

  // 对湿区应用Sobel算子，只在有颜料的区域计算梯度
  for (let y = validTop; y <= validBottom; y++) {
    for (let x = validLeft; x <= validRight; x++) {
      const index = y * engine.canvasWidth + x;

      // 只在有颜料的区域计算梯度，并限制湿度累加
      const hasOldPigment = engine.pigmentField[index].isOld;
      const hasNewPigment = engine.newPigmentField[index].isNew;

      if (!hasOldPigment && !hasNewPigment) {
        gradientMagnitude[index] = 0;
        continue;
      }

      // 限制湿度累加：如果湿度已经很高，减少梯度强度
      const wetLevel = engine.wetField[index];
      const wetnessPenalty =
        wetLevel > 0.7 ? Math.max(0.3, 1 - (wetLevel - 0.7) / 0.3) : 1.0;

      let gx = 0,
        gy = 0;
      let validSamples = true;

      // 应用3x3 Sobel算子
      for (let ky = -1; ky <= 1 && validSamples; ky++) {
        for (let kx = -1; kx <= 1 && validSamples; kx++) {
          const sampleX = x + kx;
          const sampleY = y + ky;

          // 检查采样点是否在有效范围内
          if (
            sampleX < left ||
            sampleX > right ||
            sampleY < top ||
            sampleY > bottom
          ) {
            validSamples = false;
            break;
          }

          const sampleIndex = sampleY * engine.canvasWidth + sampleX;
          gx += engine.wetField[sampleIndex] * sobelX[ky + 1][kx + 1];
          gy += engine.wetField[sampleIndex] * sobelY[ky + 1][kx + 1];
        }
      }

      // 只有当所有采样点都有效时，才计算梯度幅值，并应用湿度惩罚
      gradientMagnitude[index] = validSamples
        ? Math.sqrt(gx * gx + gy * gy) * wetnessPenalty
        : 0;
    }
  }

  // 扩大笔刷覆盖区域清除机制：清除所有三层的旧边缘效果
  const brushCoverRadius = engine.brushRadius * 1.5; // 从0.8增加到1.5
  const {
    left: coverLeft,
    right: coverRight,
    top: coverTop,
    bottom: coverBottom,
  } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    brushCoverRadius
  );

  // 清除笔刷覆盖区域的所有边缘效果
  for (let y = coverTop; y <= coverBottom; y++) {
    for (let x = coverLeft; x <= coverRight; x++) {
      const index = y * engine.canvasWidth + x;
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= brushCoverRadius) {
        // 更强的清除效果
        const clearStrength = Math.max(0, 1 - dist / brushCoverRadius);
        engine.firstLayerEdgeField[index] *= 1 - clearStrength * 0.9; // 增强清除第一层
        // 第三层清除已删除，准备重写
      }
    }
  }

      // 第二层：清空笔刷1倍半径范围，在1倍半径内重新计算
    const clearRadius = engine.brushRadius;
  const assignRadius = engine.brushRadius * 1.0;
  const {
    left: clearLeft,
    right: clearRight,
    top: clearTop,
    bottom: clearBottom,
  } = engine.getRegion(engine.brushCenterX, engine.brushCenterY, clearRadius);

  // 清空第二层的笔刷范围 - 添加圆形约束
  for (let y = clearTop; y <= clearBottom; y++) {
    for (let x = clearLeft; x <= clearRight; x++) {
      const index = y * engine.canvasWidth + x;
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 只在圆形范围内清空
      if (dist <= clearRadius) {
        engine.secondLayerEdgeField[index] = 0;
      }
    }
  }

  // 找出梯度的最大值进行归一化
  let maxGradient = 0;
  for (let y = validTop; y <= validBottom; y++) {
    for (let x = validLeft; x <= validRight; x++) {
      const index = y * engine.canvasWidth + x;
      maxGradient = Math.max(maxGradient, gradientMagnitude[index]);
    }
  }

  if (maxGradient > 0) {
    const normalizationFactor = 1.0 / maxGradient;

    // 更新有效区域内的边缘强度
    for (let y = validTop; y <= validBottom; y++) {
      for (let x = validLeft; x <= validRight; x++) {
        const index = y * engine.canvasWidth + x;

        // 只在有颜料的区域更新边缘强度
        if (
          engine.pigmentField[index].isOld ||
          engine.newPigmentField[index].isNew
        ) {
          // 计算到中心的距离
          const dx = x - engine.brushCenterX;
          const dy = y - engine.brushCenterY;
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq);

          const normalizedGradient =
            gradientMagnitude[index] * normalizationFactor;

          // 第一层处理 - 在有颜料的区域都可以更新，应用累积阻力机制
          if (normalizedGradient > 0.03) {
            const firstLayerIntensity =
              Math.pow(normalizedGradient, 0.8) * 0.15; // 进一步降低强度从0.25到0.15
            // 应用累积阻力：越接近最大值，越难累积
            const maxFirstLayer = 0.6;
            const resistanceFactor = calculateAccumulationResistance(
              engine.firstLayerEdgeField[index],
              maxFirstLayer
            );
            const newIntensity =
              engine.firstLayerEdgeField[index] +
              firstLayerIntensity * resistanceFactor;
            engine.firstLayerEdgeField[index] = Math.min(
              maxFirstLayer,
              newIntensity
            );
          }

          // 第二层处理 - 笔刷局部边缘，在1倍半径内
          if (dist <= assignRadius && normalizedGradient > 0.05) {
            const secondLayerIntensity =
              Math.pow(normalizedGradient, 0.6) * 0.35; // 降低强度从0.5到0.35
            // 限制最大值
            const maxSecondLayer = 0.7;
            engine.secondLayerEdgeField[index] = Math.min(
              maxSecondLayer,
              secondLayerIntensity
            );
          }

          // 保持兼容性，更新原有边缘强度场
          engine.edgeIntensityField[index] =
            normalizedGradient > 0.05 ? Math.pow(normalizedGradient, 0.65) : 0;
        } else {
          engine.edgeIntensityField[index] = 0;
        }
      }
    }

    // 为边界区域设置合理的边缘强度，避免方块边缘问题
    smoothEdgeIntensityBoundaries(
      engine,
      left,
      right,
      top,
      bottom,
      validLeft,
      validRight,
      validTop,
      validBottom
    );
  } else {
    // 如果没有检测到梯度，将检测区域内的所有边缘强度都设为0
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const index = y * engine.canvasWidth + x;
        engine.edgeIntensityField[index] = 0;
      }
    }
  }

  // 处理第三层边缘扩散
  if (engine.hasDragDirection) {
    const triggers = detectEdgeDiffusionTriggers(engine);
    // if (triggers.length > 0) {
      processThirdLayerEdgeDiffusion(engine, triggers);
    // }
  }
}

/**
 * 平滑边缘强度场的边界
 */
function smoothEdgeIntensityBoundaries(
  engine: WatercolorEngine,
  left: number,
  right: number,
  top: number,
  bottom: number,
  validLeft: number,
  validRight: number,
  validTop: number,
  validBottom: number
): void {
  // 处理四个边界区域
  const boundaries = [
    {
      edge: "top",
      xStart: validLeft,
      xEnd: validRight,
      yStart: top,
      yEnd: validTop - 1,
      getIndices: (x: number, y: number) => [
        y * engine.canvasWidth + x,
        validTop * engine.canvasWidth + x,
      ],
      distFactor: (x: number, y: number) => 1 - (validTop - y) / 2,
    },
    {
      edge: "bottom",
      xStart: validLeft,
      xEnd: validRight,
      yStart: validBottom + 1,
      yEnd: bottom,
      getIndices: (x: number, y: number) => [
        y * engine.canvasWidth + x,
        validBottom * engine.canvasWidth + x,
      ],
      distFactor: (x: number, y: number) => 1 - (y - validBottom) / 2,
    },
    {
      edge: "left",
      xStart: left,
      xEnd: validLeft - 1,
      yStart: validTop,
      yEnd: validBottom,
      getIndices: (x: number, y: number) => [
        y * engine.canvasWidth + x,
        y * engine.canvasWidth + validLeft,
      ],
      distFactor: (x: number, y: number) => 1 - (validLeft - x) / 2,
    },
    {
      edge: "right",
      xStart: validRight + 1,
      xEnd: right,
      yStart: validTop,
      yEnd: validBottom,
      getIndices: (x: number, y: number) => [
        y * engine.canvasWidth + x,
        y * engine.canvasWidth + validRight,
      ],
      distFactor: (x: number, y: number) => 1 - (x - validRight) / 2,
    },
  ];

  // 平滑每个边界
  boundaries.forEach(
    ({ xStart, xEnd, yStart, yEnd, getIndices, distFactor }) => {
      for (let y = yStart; y <= yEnd; y++) {
        for (let x = xStart; x <= xEnd; x++) {
          const [index, validIndex] = getIndices(x, y);
          engine.edgeIntensityField[index] =
            engine.edgeIntensityField[validIndex] * distFactor(x, y);
        }
      }
    }
  );

  // 处理四个角落区域
  smoothCornerArea(engine, left, validLeft - 1, top, validTop - 1);
  smoothCornerArea(engine, validRight + 1, right, top, validTop - 1);
  smoothCornerArea(engine, left, validLeft - 1, validBottom + 1, bottom);
  smoothCornerArea(engine, validRight + 1, right, validBottom + 1, bottom);
}

/**
 * 平滑角落区域的边缘强度
 */
function smoothCornerArea(
  engine: WatercolorEngine,
  xStart: number,
  xEnd: number,
  yStart: number,
  yEnd: number
): void {
  const directions = [
    { dx: 1, dy: 0 }, // 右
    { dx: -1, dy: 0 }, // 左
    { dx: 0, dy: 1 }, // 下
    { dx: 0, dy: -1 }, // 上
  ];

  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      const index = y * engine.canvasWidth + x;
      let nearestValidIndex = -1;
      let minDistance = Infinity;

      // 查找最近的有效点
      for (const { dx, dy } of directions) {
        const nx = x + dx,
          ny = y + dy;
        if (
          nx >= 0 &&
          nx < engine.canvasWidth &&
          ny >= 0 &&
          ny < engine.canvasHeight
        ) {
          const pointIndex = ny * engine.canvasWidth + nx;
          const dist = Math.abs(dx) + Math.abs(dy); // 曼哈顿距离
          if (dist < minDistance) {
            minDistance = dist;
            nearestValidIndex = pointIndex;
          }
        }
      }

      if (nearestValidIndex !== -1) {
        engine.edgeIntensityField[index] =
          engine.edgeIntensityField[nearestValidIndex] / (1 + minDistance);
      }
    }
  }
}

/**
 * 渲染到画布 - 应用边缘增强效果
 */
export function render(engine: WatercolorEngine): void {
  engine.p5Instance.loadPixels();
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    engine.brushRadius * engine.UpdateRadius
  );

  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      const index = x + y * engine.canvasWidth;
      const pix = index * 4;

      // 获取基础颜色
      const finalColor = engine.pigmentField[index].pigmentData.color;

      // 计算综合边缘效果 - 三层权重配合产生边缘效果
      const combinedEdgeEffect =
        engine.firstLayerEdgeField[index] * 0.25 + // 全画布持久边缘
        engine.secondLayerEdgeField[index] * 0.45 + // 笔刷局部边缘
        engine.thirdLayerPersistentField[index] * 0.30; // 拖动扩散边缘

      // 处理边缘效果 - 保持现有的 HSL 处理方式
      if (combinedEdgeEffect > 0.01) {
        const { h, s, l } = RGB2HSL(
          finalColor[0],
          finalColor[1],
          finalColor[2]
        );

        // 根据原亮度计算降低幅度
        const lightnessFactor = Math.pow(l, 0.5);
        const lightnessReduction =
          combinedEdgeEffect * (0.45 - 0.25 * lightnessFactor); // 增强边缘效果
        const newL = Math.max(0.05, l - lightnessReduction); // 降低最小亮度限制

        // 只调整亮度
        const { r, g, b } = HSL2RGB(h, s, newL);
        engine.p5Instance.pixels[pix] = r;
        engine.p5Instance.pixels[pix + 1] = g;
        engine.p5Instance.pixels[pix + 2] = b;
      } else {
        engine.p5Instance.pixels[pix] = finalColor[0];
        engine.p5Instance.pixels[pix + 1] = finalColor[1];
        engine.p5Instance.pixels[pix + 2] = finalColor[2];
      }
    }
  }

  engine.p5Instance.updatePixels();
}


