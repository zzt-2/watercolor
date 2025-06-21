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
 * 计算到最近颜料边缘的距离
 */
function calculateDistanceToNearestPigmentEdge(
  x: number,
  y: number,
  engine: WatercolorEngine
): number {
  const searchRadius = engine.brushRadius * 2;
  let minDistance = Infinity;

  for (let dy = -searchRadius; dy <= searchRadius; dy++) {
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      // 只在圆形范围内搜索，避免方形区域影响
      const searchDist = Math.sqrt(dx * dx + dy * dy);
      if (searchDist > searchRadius) continue;

      const checkX = x + dx;
      const checkY = y + dy;

      if (
        checkX >= 0 &&
        checkX < engine.canvasWidth &&
        checkY >= 0 &&
        checkY < engine.canvasHeight
      ) {
        const index = checkY * engine.canvasWidth + checkX;

        // 如果这个点有颜料，检查是否是边缘
        if (
          engine.pigmentField[index].isOld ||
          engine.newPigmentField[index].isNew
        ) {
          minDistance = Math.min(minDistance, searchDist);
        }
      }
    }
  }

  return minDistance === Infinity ? searchRadius : minDistance;
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

  // 更新笔刷移动方向
  if (engine.isDrawing) {
    const dx = engine.brushCenterX - engine.prevBrushCenterX;
    const dy = engine.brushCenterY - engine.prevBrushCenterY;
    const moveDistance = Math.sqrt(dx * dx + dy * dy);

    if (moveDistance > 1) {
      // 只有移动距离足够大时才更新方向
      engine.brushMoveDirectionX = dx / moveDistance;
      engine.brushMoveDirectionY = dy / moveDistance;
    }
  }

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
        engine.thirdLayerEdgeField[index] *= 1 - clearStrength * 0.8; // 增强清除第三层
        // 同时清除蒙版，避免旧的深色累积
        engine.edgeMask[index] *= 1 - clearStrength * 0.6;
      }
    }
  }

  // 第二层：清空笔刷1.2倍半径范围，在1倍半径内重新计算
  const clearRadius = engine.brushRadius * 1.2;
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

  // 处理第三层拖动效果
  processThirdLayerDrag(engine);

  // 更新前一次位置
  engine.prevBrushCenterX = engine.brushCenterX;
  engine.prevBrushCenterY = engine.brushCenterY;
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

      // 计算综合边缘效果 - 调整权重配合产生ArtRage黑边效果
      const combinedEdgeEffect =
        engine.firstLayerEdgeField[index] * 0.3 + // 全画布持久边缘
        engine.secondLayerEdgeField[index] * 0.4 + // 降低笔刷局部权重
        engine.thirdLayerEdgeField[index] * 0.5; // 增加拖动扩散权重

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
          combinedEdgeEffect * (0.35 - 0.25 * lightnessFactor);
        const newL = Math.max(0.15, l - lightnessReduction);

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

/**
 * 处理第三层蒙版拖动效果 - 从第二层继承并实现渐进扩散
 */
export function processThirdLayerDrag(engine: WatercolorEngine): void {
  const brushRadius = engine.brushRadius;
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    brushRadius * 3
  );

  // 第一步：从第二层继承强边缘到蒙版
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;

      // 从第二层的强边缘继承到蒙版
      if (engine.secondLayerEdgeField[index] > 0.25) {
        const dx = x - engine.brushCenterX;
        const dy = y - engine.brushCenterY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= brushRadius * 1.5) {
          // 将第二层的强边缘转移到蒙版
          const inheritStrength = engine.secondLayerEdgeField[index] * 0.8;
          engine.edgeMask[index] = Math.min(
            0.9,
            Math.max(engine.edgeMask[index], inheritStrength)
          );
        }
      }
    }
  }

  // 第二步：渐进扩散机制 - 让深色持续向外流动
  const tempMask = new Float32Array(engine.edgeMask.length);
  tempMask.set(engine.edgeMask);

  // 多轮小距离扩散，模拟流动效果
  const diffusionRounds = 3; // 多轮小扩散
  const roundStrength = 0.38; // 每轮扩散强度

  for (let round = 0; round < diffusionRounds; round++) {
    const roundMask = new Float32Array(tempMask.length);
    roundMask.set(tempMask);

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const index = y * engine.canvasWidth + x;

        // 圆形约束检查
        const dx = x - engine.brushCenterX;
        const dy = y - engine.brushCenterY;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);
        
        // 只在圆形范围内处理，超出范围跳过
        if (distToCenter > brushRadius * 1.2) continue;

        if (tempMask[index] > 0.08) {
          const currentDarkness = tempMask[index];

          // 计算扩散方向：基础4方向 + 方向性强度控制
          const baseDirections = [
            [-1, 0], // 左
            [1, 0], // 右
            [0, -1], // 上
            [0, 1], // 下
          ];

          let totalDiffused = 0;

          for (const [dx, dy] of baseDirections) {
            const targetX = x + dx;
            const targetY = y + dy;

            if (
              targetX >= 0 &&
              targetX < engine.canvasWidth &&
              targetY >= 0 &&
              targetY < engine.canvasHeight
            ) {
              // 检查目标位置是否也在圆形范围内
              const targetDx = targetX - engine.brushCenterX;
              const targetDy = targetY - engine.brushCenterY;
              const targetDistToCenter = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
              
              // 目标位置也必须在圆形范围内
              if (targetDistToCenter > brushRadius * 1.2) continue;
              
              const targetIndex = targetY * engine.canvasWidth + targetX;

              // 计算当前扩散方向与笔刷移动方向的相符程度
              const brushMoveLength = Math.sqrt(
                engine.brushMoveDirectionX * engine.brushMoveDirectionX +
                  engine.brushMoveDirectionY * engine.brushMoveDirectionY
              );

              let directionAlignment = 1.0; // 默认无方向性影响

              if (brushMoveLength > 0.1) {
                // 只有在有明显移动时才应用方向性
                // 计算点积来判断方向相符程度
                const dotProduct =
                  (dx * engine.brushMoveDirectionX +
                    dy * engine.brushMoveDirectionY) /
                  brushMoveLength;

                // 将点积范围从[-1,1]映射到[0.1,1.0]
                // 完全相符（点积=1）: directionAlignment = 1.0
                // 完全相反（点积=-1）: directionAlignment = 0.1
                directionAlignment =
                  0.1 + 0.9 * Math.max(0, (dotProduct + 1) / 2);
              }

              // 计算到颜料边缘的距离，距离边缘越远扩散越弱
              const distanceToEdge = calculateDistanceToNearestPigmentEdge(
                targetX,
                targetY,
                engine
              );
              const edgeDistanceFactor = Math.max(
                0.05,
                1.0 - distanceToEdge / (brushRadius * 3)
              );

              // 应用方向性强度控制
              const diffusedAmount =
                currentDarkness *
                roundStrength *
                edgeDistanceFactor *
                directionAlignment *
                0.9;

              roundMask[targetIndex] = Math.min(
                1.0,
                roundMask[targetIndex] + diffusedAmount
              );
              totalDiffused += diffusedAmount;
            }
          }

          // 源头轻微减少，但保持大部分
          roundMask[index] = Math.max(
            0,
            currentDarkness - totalDiffused * 0.15
          );
        }
      }
    }

    tempMask.set(roundMask);
  }

  // 第三步：全局衰减
  for (let i = 0; i < tempMask.length; i++) {
    if (tempMask[i] > 0.05) {
      tempMask[i] *= 0.994; // 非常缓慢的衰减
    } else if (tempMask[i] > 0.01) {
      tempMask[i] *= 0.98;
    }
  }

  // 更新蒙版
  engine.edgeMask.set(tempMask);

  // 第四步：基于蒙版生成第三层效果
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;

      if (engine.edgeMask[index] > 0.02) {
        // 距离越远效果越强
        const dx = x - engine.brushCenterX;
        const dy = y - engine.brushCenterY;
        const distToBrush = Math.sqrt(dx * dx + dy * dy);

        const distanceFactor = Math.min(1.2, distToBrush / (brushRadius * 0.8));
        const thirdLayerIntensity =
          engine.edgeMask[index] * distanceFactor * 0.5;

        // 应用累积阻力机制到第三层
        const maxThirdLayer = 1.0;
        const thirdResistance = calculateAccumulationResistance(
          engine.thirdLayerEdgeField[index],
          maxThirdLayer
        );
        const newThirdIntensity =
          engine.thirdLayerEdgeField[index] +
          thirdLayerIntensity * thirdResistance;

        engine.thirdLayerEdgeField[index] = Math.min(
          maxThirdLayer,
          Math.max(engine.thirdLayerEdgeField[index] * 0.99, newThirdIntensity)
        );
      } else {
        engine.thirdLayerEdgeField[index] *= 0.98;
      }
    }
  }
}
