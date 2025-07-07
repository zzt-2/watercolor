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
      if (distance <= engine.brushRadius * 1.2) {
        const index = y * engine.canvasWidth + x;
        
        // 检查是否同时存在颜料边缘 - 降低阈值，增加触发条件
        const hasEdge = 
                       engine.secondLayerEdgeField[index] > 0.1;
        const hasPigment = engine.pigmentField[index].isOld || 
                          engine.newPigmentField[index].isNew;
        // 额外触发条件：即使边缘较弱，但如果有新颜料也可以触发
        const hasStrongPigment = engine.newPigmentField[index].isNew && 
                                engine.newPigmentField[index].pigmentData.opacity > 0.1;
        
        if ((hasEdge && hasPigment)) {
          const intensity = Math.max(
            engine.firstLayerEdgeField[index],
            engine.secondLayerEdgeField[index]
          );
          
          triggers.push({ x, y, intensity });
          
  // 添加测试标记：注入点标记为1.0
  const globalIndex = y * engine.canvasWidth + x;
  if (globalIndex >= 0 && globalIndex < engine.debugTestLayer.length) {
    engine.debugTestLayer[globalIndex] = 1.0; // 注入点
  }
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
  const tempRadius = Math.ceil(engine.brushRadius * 1.2);
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
  const tempRadius = Math.ceil(engine.brushRadius * 1.2);
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
  
  // 增强注入强度，让内圈有足够的扩散动力
  const injectionStrength = baseIntensity * 0.1;
  
  // 累积到临时层，限制最大值
  const currentValue = engine.thirdLayerTempField[tempIndex];
  const maxAccumulation = 0.7; // 降低最大累积值
  engine.thirdLayerTempField[tempIndex] = Math.min(maxAccumulation, currentValue + injectionStrength);
}

/**
 * 应用动态平衡衰减到临时层
 */
function applyDynamicDecay(engine: WatercolorEngine): void {
  const tempRadius = Math.ceil(engine.brushRadius * 1.2);
  const originalRadius = engine.brushRadius; // 保持原始半径用于衰减计算
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
        
        // 只在扩展范围内应用衰减
        if (distanceFromCenter <= tempRadius) {
          // 使用原始半径计算归一化距离，保持衰减强度逻辑不变
          const normalizedDistance = distanceFromCenter / originalRadius;
        
          // 大幅减弱衰减曲线：让扩散效果更持久
          let decayFactor;
          if (normalizedDistance < 0.3) {
            // 内圈：极微衰减，促进向外扩散
            decayFactor = 0.999 - 0.001 * (normalizedDistance / 0.3); // 从0.98-0.02改为0.995-0.005
          } else if (normalizedDistance < 0.7) {
            // 中圈：轻微衰减，减少粘滞
            const midRatio = (normalizedDistance - 0.3) / 0.4;
            decayFactor = 0.995 - 0.005 * midRatio; // 从0.95-0.05改为0.99-0.01
          } else {
            // 外圈：极轻微衰减，保持扩散范围
            const outerRatio = (normalizedDistance - 0.7) / 0.3;
            decayFactor = 0.985 - 0.015 * outerRatio; // 从0.9-0.1改为0.985-0.005
          }
          
          engine.thirdLayerTempField[tempIndex] *= decayFactor;
          
          // 降低清除阈值，但保留更多弱值
          if (engine.thirdLayerTempField[tempIndex] < 0.00005) { // 从0.0001降到0.00005
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
  const tempRadius = Math.ceil(engine.brushRadius * 1.2);
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
 * 标记注入点周围的可扩散区域
 */
function markDiffusionArea(
  engine: WatercolorEngine, 
  centerX: number, 
  centerY: number, 
  diffusionMask: Float32Array
): void {
  const markRadius = engine.brushRadius * 1.0; // 标记半径扩大到1.0倍，确保从注入点到圆心的路径都有强扩散
  const tempRadius = Math.ceil(engine.brushRadius * 1.2);
  const tempSize = tempRadius * 2 + 1;
  
  // 转换注入点到临时层坐标
  const { tempX: centerTempX, tempY: centerTempY } = globalToTempCoords(centerX, centerY, engine);
  
  if (!isInTempBounds(centerTempX, centerTempY, engine)) {
    return;
  }
  
  // 标记周围0.3倍半径范围内的点为可扩散区域
  for (let tempY = 0; tempY < tempSize; tempY++) {
    for (let tempX = 0; tempX < tempSize; tempX++) {
      const dx = tempX - centerTempX;
      const dy = tempY - centerTempY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= markRadius) {
        const tempIndex = tempY * tempSize + tempX;
        
        // 计算标记强度，距离注入点越近标记越强
        const normalizedDistance = distance / markRadius;
        const markStrength = Math.max(0.3, 1.0 - normalizedDistance * 0.7); // 0.3到1.0之间
        
        // 累积标记强度（多个注入点可能重叠）
        diffusionMask[tempIndex] = Math.max(diffusionMask[tempIndex], markStrength);
      }
    }
  }
}

/**
 * 对临时层中所有非零值进行简化的邻域扩散
 */
function applyFieldDiffusion(engine: WatercolorEngine, diffusionMask: Float32Array): void {
  const tempRadius = Math.ceil(engine.brushRadius * 1.2);
  const tempSize = tempRadius * 2 + 1;
  
  // 创建临时缓冲区以避免自我影响
  const diffusionBuffer = new Float32Array(engine.thirdLayerTempField.length);
  
  // 预计算方向权重
  const hasDirection = engine.hasDragDirection;
  const dragDirX = hasDirection ? engine.dragDirectionX : 0;
  const dragDirY = hasDirection ? engine.dragDirectionY : 0;
  
  // 8邻域偏移
  const neighbors = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1], 
    [1, -1],  [1, 0],  [1, 1]
  ];
  
  // 遍历所有临时层点进行扩散
  for (let tempY = 0; tempY < tempSize; tempY++) {
    for (let tempX = 0; tempX < tempSize; tempX++) {
      const tempIndex = tempY * tempSize + tempX;
      const currentValue = engine.thirdLayerTempField[tempIndex];
      
      // 降低扩散阈值，让更多弱值参与扩散
      if (currentValue < 0.0002) continue;
      
      // 计算到中心的距离
      const dx = tempX - tempRadius;
      const dy = tempY - tempRadius;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      
      // 只在圆形范围内扩散
      if (distanceFromCenter > tempRadius) continue;
      
      // 根据扩散标记调整扩散强度
      const maskStrength = diffusionMask[tempIndex];
      let diffusionMultiplier;
      if (maskStrength > 0.5) {
        // 标记区域内：正常扩散
        diffusionMultiplier = 1.0;
      } else if (maskStrength > 0.1) {
        // 弱标记区域：中等扩散
        diffusionMultiplier = 0.2;
      } else {
        // 无标记区域：微弱扩散
        diffusionMultiplier = 0.01;
      }
      
      // 简化的扩散强度计算 - 加入标记调制
      const normalizedDistance = distanceFromCenter / tempRadius;
      const baseIntensity = currentValue * 0.5 * diffusionMultiplier; // 应用标记调制
      
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
        
        // 简化的方向性权重
        let directionalWeight = 0.4; // 提高基础权重
        if (hasDirection) {
          const dotProduct = offsetX * dragDirX + offsetY * dragDirY;
          // 简单的线性权重：拖动方向权重高，反方向权重低
          if (dotProduct > 0.5) {
            directionalWeight = 0.2; // 拖动方向，提高到1.0
          } else if (dotProduct < -0.5) {
            directionalWeight = 0.04; // 反方向
          } else {
            directionalWeight = 0.8; // 侧向，提高权重
          }
        }
        
        // 简化的距离权重：直接邻居权重1.0，对角邻居权重0.8
        const distanceWeight = (Math.abs(offsetX) + Math.abs(offsetY)) === 1 ? 1.0 : 0.8;
        
        // 计算扩散量 - 不再平均分配，让每个邻居获得更多
        const diffusionAmount = baseIntensity * directionalWeight * distanceWeight * 0.2; // 乘以0.2而不是除以8
        diffusionBuffer[neighborIndex] += diffusionAmount;
      }
    }
  }
  
  // 应用扩散结果：增加邻域强度，同时适度减少源点强度
  const tempLeft = engine.thirdLayerTempCenterX - tempRadius;
  const tempTop = engine.thirdLayerTempCenterY - tempRadius;
  
  for (let i = 0; i < engine.thirdLayerTempField.length; i++) {
    if (diffusionBuffer[i] > 0) {
      // 增加扩散而来的强度
      engine.thirdLayerTempField[i] = Math.min(1.0, engine.thirdLayerTempField[i] + diffusionBuffer[i]);
      
      // // 在测试层中标记扩散到的点
      // const tempY = Math.floor(i / tempSize);
      // const tempX = i % tempSize;
      // const globalX = tempLeft + tempX;
      // const globalY = tempTop + tempY;
      
      // if (globalX >= 0 && globalX < engine.canvasWidth && 
      //     globalY >= 0 && globalY < engine.canvasHeight) {
      //   const globalIndex = globalY * engine.canvasWidth + globalX;
      //   // 标记为扩散点（如果不是注入点）
      //   if (engine.debugTestLayer[globalIndex] < 0.9) {
      //     engine.debugTestLayer[globalIndex] = 0.5; // 扩散到的点
      //   }
      // }
    }
  }
  
  // 第二遍：适度减少已经扩散的源点强度，实现简化的守恒
  for (let tempY = 0; tempY < tempSize; tempY++) {
    for (let tempX = 0; tempX < tempSize; tempX++) {
      const tempIndex = tempY * tempSize + tempX;
      const currentValue = engine.thirdLayerTempField[tempIndex];
      
      if (currentValue > 0.001) {
        const dx = tempX - tempRadius;
        const dy = tempY - tempRadius;
        const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
        
        if (distanceFromCenter <= tempRadius) {
          // 根据距离调整损失比例 - 中心损失更多，边缘损失更少
          const normalizedDistance = distanceFromCenter / tempRadius;
          const baseLossRatio = 0.25; // 提高基础损失比例
          const lossRatio = baseLossRatio * (1 - normalizedDistance * 0.5); // 边缘地区损失减半
          engine.thirdLayerTempField[tempIndex] *= (1 - lossRatio);
        }
      }
    }
  }
}

/**
 * 处理第三层边缘扩散
 */
function processThirdLayerEdgeDiffusion(engine: WatercolorEngine, triggers: TriggerPoint[]): void {
  // 清空测试层
  
  
  // 确保临时层大小正确
  engine.ensureThirdLayerTempSize(engine.brushCenterX, engine.brushCenterY, engine.brushRadius * 1.2);
  
  // 应用动态平衡衰减
  applyDynamicDecay(engine);
  
  // 对每个触发点应用强度注入（而非扩散）
  for (const trigger of triggers) {
    injectTriggerIntensity(engine, trigger.x, trigger.y, trigger.intensity);
  }
  
  // 【新增】对临时层中所有非零值进行扩散
  const diffusionMask = new Float32Array(engine.thirdLayerTempField.length);
  for (const trigger of triggers) {
    markDiffusionArea(engine, trigger.x, trigger.y, diffusionMask);
  }
  applyFieldDiffusion(engine, diffusionMask);
  
  // 将临时层数据转移到持久层（使用扩展范围）
  const tempRadius = Math.ceil(engine.brushRadius * 1.2);
  const tempSize = tempRadius * 2 + 1;
  const tempLeft = engine.thirdLayerTempCenterX - tempRadius;
  const tempTop = engine.thirdLayerTempCenterY - tempRadius;
  
  for (let tempY = 0; tempY < tempSize; tempY++) {
    for (let tempX = 0; tempX < tempSize; tempX++) {
      const tempIndex = tempY * tempSize + tempX;
      const tempValue = engine.thirdLayerTempField[tempIndex];
      
      if (tempValue > 0.0001) { // 保持阈值
        // 计算在temp数组中距离中心的距离
        const dx = tempX - tempRadius;
        const dy = tempY - tempRadius;
        const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
        
        // 只在圆形范围内转移到持久层
        if (distanceFromCenter <= engine.brushRadius) {
          // 转换回全局坐标
          const globalX = tempLeft + tempX;
          const globalY = tempTop + tempY;
          
          // 检查边界
          if (globalX >= 0 && globalX < engine.canvasWidth && 
              globalY >= 0 && globalY < engine.canvasHeight) {
            const globalIndex = globalY * engine.canvasWidth + globalX;
            
            // 使用更平滑的混合机制，减少新值的影响
            const oldValue = engine.thirdLayerPersistentField[globalIndex];
            // const normalizedDistance = distanceFromCenter / tempRadius;
            
            // 使用距离调制的混合比例，中心区域混合更多
            // const mixRatio = 0.4 * Math.exp(-1.5 * normalizedDistance * normalizedDistance); // 从1降到0.4，并加入距离衰减
            const mixRatio = 0.99;
            engine.thirdLayerPersistentField[globalIndex] = oldValue * (1 - mixRatio) + tempValue * mixRatio;
          }
        }
      }
    }
  }
  // 从持久层复制初始值到临时层（类似lastBrushPigment的机制）
  copyPersistentToTemp(engine);
  
  // 对持久层进行平滑处理（修改原始数据方案）
  smoothThirdLayerPersistentField(engine);
}

/**
 * 对第三层持久层进行平滑处理（修改原始数据）
 */
function smoothThirdLayerPersistentField(engine: WatercolorEngine): void {
  const smoothRadius = engine.brushRadius * 1.4;
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    smoothRadius
  );

  // 创建临时缓冲区存储平滑结果
  const tempBuffer = new Float32Array(engine.canvasWidth * engine.canvasHeight);
  
  // 复制原始数据到缓冲区
  for (let i = 0; i < tempBuffer.length; i++) {
    tempBuffer[i] = engine.thirdLayerPersistentField[i];
  }

  // 对圆形区域内的数据进行3x3平滑
  for (let y = top + 1; y < bottom - 1; y++) {
    for (let x = left + 1; x < right - 1; x++) {
      const index = y * engine.canvasWidth + x;
      
      // 计算到笔刷中心的距离
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      
      // 只在圆形范围内进行平滑
      if (distanceFromCenter > smoothRadius) {
        continue;
      }
      
      // 如果原始值很小，跳过平滑
      if (engine.thirdLayerPersistentField[index] < 0.001) {
        continue;
      }

      let sum = 0;
      let count = 0;

      // 遍历3x3邻域
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = x + kx;
          const ny = y + ky;
          
          if (nx >= 0 && nx < engine.canvasWidth && 
              ny >= 0 && ny < engine.canvasHeight) {
            const nIndex = ny * engine.canvasWidth + nx;
            const value = engine.thirdLayerPersistentField[nIndex];
            
            // 使用中心权重更高的平滑
            const weight = (kx === 0 && ky === 0) ? 2.0 : 0.8;
            
            sum += value * weight;
            count += weight;
          }
        }
      }

      // 更新缓冲区
      if (count > 0) {
        tempBuffer[index] = sum / count;
      }
    }
  }

  // 将平滑结果写回持久层
  for (let y = top + 1; y < bottom - 1; y++) {
    for (let x = left + 1; x < right - 1; x++) {
      const index = y * engine.canvasWidth + x;
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      
      // 只在圆形范围内更新原始数据
      if (distanceFromCenter <= smoothRadius && 
          engine.thirdLayerPersistentField[index] > 0.001) {
        engine.thirdLayerPersistentField[index] = tempBuffer[index];
      }
    }
  }
}

/**
 * 计算第三层的局部平滑值（不修改原始数据，用于渲染时显示）
 */
function calculateSmoothedThirdLayerValue(engine: WatercolorEngine, x: number, y: number): number {
  const index = y * engine.canvasWidth + x;
  
  // 如果原始值很小，直接返回
  if (engine.thirdLayerPersistentField[index] < 0.001) {
    return engine.thirdLayerPersistentField[index];
  }

  // 简化版本：只对3x3邻域进行单次平滑，模拟3次迭代的效果
  let sum = 0;
  let count = 0;

  // 遍历3x3邻域
  for (let ky = -1; ky <= 1; ky++) {
    for (let kx = -1; kx <= 1; kx++) {
      const nx = x + kx;
      const ny = y + ky;
      
      if (nx >= 0 && nx < engine.canvasWidth && 
          ny >= 0 && ny < engine.canvasHeight) {
        const nIndex = ny * engine.canvasWidth + nx;
        const value = engine.thirdLayerPersistentField[nIndex];
        
        // 模拟3次迭代的平滑效果：增强中心权重，减少边缘权重
        const weight = (kx === 0 && ky === 0) ? 2.0 : 0.8; // 更强的中心权重
        
        sum += value * weight;
        count += weight;
      }
    }
  }

  // 计算平滑后的值
  if (count > 0) {
    return sum / count;
  } else {
    return engine.thirdLayerPersistentField[index];
  }
}

/**
 * 清空指定区域的第三层持久层
 */
function clearThirdLayerPersistentField(engine: WatercolorEngine, centerX: number, centerY: number, radius: number): void {
  const { left, right, top, bottom } = engine.getRegion(
    centerX,
    centerY,
    radius * 1.2 // 稍微扩大清空范围
  );

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      
      // 只在圆形范围内清空
      if (distanceFromCenter <= radius * 1.2) {
        const index = y * engine.canvasWidth + x;
        engine.thirdLayerPersistentField[index] = 0;
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
  const brushCoverRadius = engine.brushRadius * 1.2; // 从0.8增加到1.5
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
    const clearRadius = engine.brushRadius* 1.15;
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
            Math.pow(normalizedGradient, 0.5) * 1.2; // 降低强度从0.5到0.35
            // 限制最大值
            const maxSecondLayer = 1;
            engine.secondLayerEdgeField[index] = Math.min(
              maxSecondLayer,
              secondLayerIntensity
            );
          }
        }
      }
    }


  }

  // 处理第三层边缘扩散
  if (engine.hasDragDirection) {
    engine.debugTestLayer.fill(0);
    const triggers = detectEdgeDiffusionTriggers(engine);
    // if (triggers.length > 0) {
      processThirdLayerEdgeDiffusion(engine, triggers);
    // }
  }
}

/**
 * 对最终颜料场进行圆形渐变平滑处理，消除扩散产生的锯齿
 */
function applyFinalPigmentSmoothing(engine: WatercolorEngine): void {
  // 合理的平滑半径：覆盖扩散区域但不过度
  const smoothRadius = engine.brushRadius * 1.4; // 基于实际扩散距离(0.6)的约2倍，更精确
  const { left, right, top, bottom } = engine.getRegion(
    engine.brushCenterX,
    engine.brushCenterY,
    smoothRadius
  );

  // 创建临时缓冲区
  const tempColorBuffer: Array<[number, number, number]> = [];
  const tempOpacityBuffer: number[] = [];
  
  // 初始化缓冲区
  for (let i = 0; i < engine.canvasWidth * engine.canvasHeight; i++) {
    tempColorBuffer[i] = [255, 255, 255];
    tempOpacityBuffer[i] = 0;
  }

  // 应用圆形区域内的3x3平滑
  for (let y = top + 1; y < bottom - 1; y++) {
    for (let x = left + 1; x < right - 1; x++) {
      const index = y * engine.canvasWidth + x;
      
      // 计算到笔刷中心的距离
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      
      // 只在圆形范围内进行平滑
      if (distanceFromCenter > smoothRadius) {
        continue;
      }
      
      // 只平滑有颜料的区域
      if (!engine.pigmentField[index].isOld) {
        continue;
      }

      // 计算平滑强度：距离中心越远，平滑越强
      const normalizedDistance = distanceFromCenter / smoothRadius;
      const smoothingStrength = 0.3 + 0.7 * normalizedDistance; // 从30%到100%

      let sumR = 0, sumG = 0, sumB = 0, sumOpacity = 0;
      let count = 0;

      // 遍历3x3邻域
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = x + kx;
          const ny = y + ky;
          
          if (nx >= 0 && nx < engine.canvasWidth && 
              ny >= 0 && ny < engine.canvasHeight) {
            const nIndex = ny * engine.canvasWidth + nx;
            
            let color: [number, number, number];
            let opacity: number;
            
            if (engine.pigmentField[nIndex].isOld) {
              color = engine.pigmentField[nIndex].pigmentData.color;
              opacity = engine.pigmentField[nIndex].pigmentData.opacity;
            } else {
              // 空白区域使用背景色
              color = [255, 255, 255];
              opacity = 0;
            }
            
            // 使用与边缘平滑相同的权重
            const weight = (kx === 0 && ky === 0) ? 1.5 : 1.0;
            
            sumR += color[0] * weight;
            sumG += color[1] * weight;
            sumB += color[2] * weight;
            sumOpacity += opacity * weight;
            count += weight;
          }
        }
      }

      // 更新平滑结果，使用混合而非完全替换
      if (count > 0) {
        const originalColor = engine.pigmentField[index].pigmentData.color;
        const originalOpacity = engine.pigmentField[index].pigmentData.opacity;
        
        const smoothedColor: [number, number, number] = [
          Math.round(sumR / count),
          Math.round(sumG / count),
          Math.round(sumB / count)
        ];
        const smoothedOpacity = sumOpacity / count;
        
        // 根据平滑强度混合原始值和平滑值
        tempColorBuffer[index] = [
          Math.round(originalColor[0] * (1 - smoothingStrength) + smoothedColor[0] * smoothingStrength),
          Math.round(originalColor[1] * (1 - smoothingStrength) + smoothedColor[1] * smoothingStrength),
          Math.round(originalColor[2] * (1 - smoothingStrength) + smoothedColor[2] * smoothingStrength)
        ];
        tempOpacityBuffer[index] = originalOpacity * (1 - smoothingStrength) + smoothedOpacity * smoothingStrength;
      }
    }
  }

  // 将平滑结果更新回原始数组
  for (let y = top + 1; y < bottom - 1; y++) {
    for (let x = left + 1; x < right - 1; x++) {
      const index = y * engine.canvasWidth + x;
      const dx = x - engine.brushCenterX;
      const dy = y - engine.brushCenterY;
      const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
      
      // 只在圆形范围内更新
      if (distanceFromCenter <= smoothRadius && 
          engine.pigmentField[index].isOld && 
          tempOpacityBuffer[index] > 0.001) {
        engine.pigmentField[index].pigmentData.color = tempColorBuffer[index];
        engine.pigmentField[index].pigmentData.opacity = tempOpacityBuffer[index];
      }
    }
  }
}

/**
 * 渲染到画布 - 应用边缘增强效果
 */
export function render(engine: WatercolorEngine): void {
  // 在渲染前对最终颜料场进行平滑
  applyFinalPigmentSmoothing(engine);
  
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

      // // 测试模式：如果测试层有值，直接显示白色
      // if (engine.debugTestLayer[index] > 0.1) {
      //   engine.p5Instance.pixels[pix] = 255;     // R
      //   engine.p5Instance.pixels[pix + 1] = 255; // G  
      //   engine.p5Instance.pixels[pix + 2] = 255; // B
      //   engine.p5Instance.pixels[pix + 3] = 255; // A
      //   continue; // 跳过正常渲染
      // }

      // 获取基础颜色
      const finalColor = engine.pigmentField[index].pigmentData.color;

      // 检查原色层并混合
      let renderColor = finalColor;
      if (engine.primitiveColorField[index].hasPrimitive) {
        const primitiveColor = engine.primitiveColorField[index].pigmentData.color;
        // 使用mixbox.lerp混合：finalColor * 0.7 + primitiveColor * 0.3
        renderColor = mixbox.lerp(
          `rgb(${finalColor.join(",")})`,
          `rgb(${primitiveColor.join(",")})`,
          0.1
        );
      }

      // 直接使用原始数据（已经过平滑处理）
      const thirdLayerValue = engine.thirdLayerPersistentField[index];

      // 计算综合边缘效果 - 三层权重配合产生边缘效果
      const combinedEdgeEffect =
        engine.firstLayerEdgeField[index] * 0.55 + // 全画布持久边缘
        engine.secondLayerEdgeField[index] * 0.85 + // 笔刷局部边缘
        thirdLayerValue * 1.20; // 直接使用已平滑的原始数据

      // 处理边缘效果 - 保持现有的 HSL 处理方式
      if (combinedEdgeEffect > 0.01) {
        const { h, s, l } = RGB2HSL(
          renderColor[0],
          renderColor[1],
          renderColor[2]
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
        engine.p5Instance.pixels[pix] = renderColor[0];
        engine.p5Instance.pixels[pix + 1] = renderColor[1];
        engine.p5Instance.pixels[pix + 2] = renderColor[2];
      }
    }
  }

  engine.p5Instance.updatePixels();
}

/**
 * 清空指定区域的第三层持久层 - 导出版本
 */
export function clearThirdLayerAtPosition(engine: WatercolorEngine, centerX: number, centerY: number, radius: number): void {
  clearThirdLayerPersistentField(engine, centerX, centerY, radius);
}


