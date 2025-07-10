import { WatercolorEngine } from "../watercolorEngine";
import { DiffusionDirectionsData } from "../types/watercolorTypes";
import {
  wetAreaRadiusFactor,
  wetAreaInnerRadiusFactor,
  wetAreaCenterValue,
  UpdateRadius,
  maxWetValue,
} from "../constants/watercolorConstants";

/**
 * 设置均匀分布的颜料和湿区
 */
export function setUniformPigmentDistribution(
  engine: WatercolorEngine,
  centerX: number,
  centerY: number,
  radius: number
): void {
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
    0.5;

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

/**
 * 计算距离场
 */
export function computeDistanceField(engine: WatercolorEngine): void {
  // 如果没有已有颜料点，则无需计算
  if (engine.existingPigmentPoints.length === 0) {
    return;
  }

  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    engine.brushRadius
  );

  // 预先计算和存储已有颜料点到笔刷中心的距离，避免重复计算
  const pigmentDistances = engine.existingPigmentPoints.map((point) => {
    const dx = point.x - engine.brushCenterX;
    const dy = point.y - engine.brushCenterY;
    const distToCenter = Math.sqrt(dx * dx + dy * dy);
    return {
      x: point.x,
      y: point.y,
      distToCenter: distToCenter,
    };
  });

  // 遍历所有新添加的颜料区域像素
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;

      // 只处理新添加的颜料区域
      if (!engine.newPigmentField[index].isNew) {
        continue;
      }

      // 计算该点到笔刷中心的距离
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const pixelDistToCenter = Math.sqrt(dx * dx + dy * dy);

      // 筛选符合条件的旧颜料点
      const eligiblePigments = pigmentDistances.filter((pigment) => {
        // 确保旧颜料点离圆心的距离大于当前像素
        if (pigment.distToCenter <= pixelDistToCenter) {
          return false;
        }

        // 快速排除：使用曼哈顿距离进行初步筛选
        const absDx = Math.abs(x - pigment.x);
        const absDy = Math.abs(y - pigment.y);
        if (absDx + absDy > engine.brushRadius * (UpdateRadius - 1)) {
          return false;
        }

        // 计算实际欧几里得距离
        const dist = computeDistance(x, y, pigment.x, pigment.y);
        return dist <= engine.brushRadius * (UpdateRadius - 1);
      });

      // 如果找到了符合条件的旧颜料点
      if (eligiblePigments.length > 0) {
        // 随机选择一个作为扩散目标
        const randomIndex = Math.floor(Math.random() * eligiblePigments.length);
        const targetPigment = eligiblePigments[randomIndex];

        // 计算到目标点的距离
        const dist = computeDistance(x, y, targetPigment.x, targetPigment.y);

        // 更新距离场和最近点信息
        engine.distanceField[index] = dist;
        engine.closestPigmentX[index] = targetPigment.x;
        engine.closestPigmentY[index] = targetPigment.y;
      } else {
        // 如果没有找到合适的点，设置一个默认值
        engine.distanceField[index] = Infinity;
        engine.closestPigmentX[index] = -1;
        engine.closestPigmentY[index] = -1;
      }
    }
  }
}

/**
 * 计算两点之间的欧几里得距离
 */
export function computeDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算梯度场
 */
export function computeGradientField(engine: WatercolorEngine): void {
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    engine.brushRadius
  );

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const index = y * engine.canvasWidth + x;

      // 只计算新添加颜料区域的梯度
      if (engine.newPigmentField[index].isNew) {
        const nearestX = engine.closestPigmentX[index];
        const nearestY = engine.closestPigmentY[index];

        // 如果存在最近颜料点
        if (nearestX !== -1) {
          // 计算方向向量
          const dx = nearestX - x;
          const dy = nearestY - y;
          const dist = engine.distanceField[index];
          // 标准化方向向量
          if (dist > 0) {
            // 基础梯度方向
            const normalizedDx = dx / dist;
            const normalizedDy = dy / dist;

            // 应用旋转 (使用二维旋转矩阵)
            engine.gradientFieldX[index] = normalizedDx;
            engine.gradientFieldY[index] = normalizedDy;
          } else {
            // 如果距离为0，设置为随机方向
            const angle = Math.random() * 2 * Math.PI;
            engine.gradientFieldX[index] = Math.cos(angle);
            engine.gradientFieldY[index] = Math.sin(angle);
          }
        } else {
          // 没有找到最近颜料，设置为0
          engine.gradientFieldX[index] = 0;
          engine.gradientFieldY[index] = 0;
        }
      }
    }
  }
}

/**
 * 获取新添加颜料区域的扩散方向
 */
export function getNewPigmentDiffusionDirections(
  engine: WatercolorEngine
): DiffusionDirectionsData {
  // 计算区域边界
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    engine.brushRadius
  );

  // 计算局部区域尺寸
  const localWidth = right - left + 1;
  const localHeight = bottom - top + 1;
  
  // 创建局部方向数组，只为笔刷区域分配内存
  const distanceToCenter = new Float32Array(localWidth * localHeight);
  const shouldDiffuse = new Uint8Array(localWidth * localHeight);

  // 使用已计算的梯度场作为方向数据
  const directionX = engine.gradientFieldX;
  const directionY = engine.gradientFieldY;

  // 填充局部数据
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const globalIndex = y * engine.canvasWidth + x;
      const localX = x - left;
      const localY = y - top;
      const localIndex = localY * localWidth + localX;
      
      // 检查是否在圆内
      if (engine.newPigmentField[globalIndex].isNew) {
        // 计算到中心的距离
        const dx = x - engine.brushCenterX;
        const dy = y - engine.brushCenterY;
        const distSq = dx * dx + dy * dy;

        // 计算到中心的距离
        const dist = Math.sqrt(distSq);
        distanceToCenter[localIndex] = dist;

        // 检查是否有有效的梯度方向
        const hasValidGradient =
          directionX[globalIndex] !== 0 || directionY[globalIndex] !== 0;

        // 检查距离场，确保有找到最近的颜料点
        const hasValidDistance = engine.distanceField[globalIndex] < Infinity;

        // 只有当有有效梯度和有效距离时才应该扩散
        if (hasValidGradient && hasValidDistance) {
          shouldDiffuse[localIndex] = 1;
        }
      }
    }
  }

  return {
    directionX,
    directionY,
    distanceToCenter,
    shouldDiffuse,
    // 添加区域信息以便调用者进行正确的索引转换
    regionLeft: left,
    regionTop: top,
    regionWidth: localWidth,
    regionHeight: localHeight,
  };
}
