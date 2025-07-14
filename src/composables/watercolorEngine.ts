import p5 from "p5";
import { BrushData, PigmentData, Region } from "./types/watercolorTypes";
import {
  UpdateRadius,
  edgeDetectionRadiusFactor,
  stepDiffusionHistoryDepthFactor,
  stepDiffusionThresholdFactor,
  stepWetAreaRadiusFactor,
  stepDiffusionInnerRadiusFactor,
  stepDiffusionOuterRadiusFactor,
  stepFieldSpecialValue,
} from "./constants/watercolorConstants";
import {
  initComplexArrays,
  initArrays,
  initP5,
} from "./utils/watercolorInitialization";
import {
  calculateWetAreaEdges,
  render,
  clearThirdLayerAtPosition,
} from "./utils/watercolorEdgeHandling";
import { 
  processNewPigmentAddition,
  mixPrimitiveLayerToPigmentField,
  clearPrimitiveLayer,
} from "./utils/watercolorProcessing";

/**
 * 水彩引擎类
 */
class WatercolorEngine {
  // 公共API
  public canvas: HTMLCanvasElement | null = null;
  public canvasWidth: number;
  public canvasHeight: number;
  public p5Instance!: p5;
  public isDrawing: boolean = false;
  public prevMouseX: number;
  public prevMouseY: number;
  public brush: BrushData;
  public lastBrushPigment: Array<PigmentData>;
  public distanceField: Float32Array;
  public closestPigmentX: Int32Array;
  public closestPigmentY: Int32Array;
  public gradientFieldX: Float32Array;
  public gradientFieldY: Float32Array;
  public pigmentField: Array<{
    isOld: boolean;
    pigmentData: PigmentData;
  }> = [];
  public newPigmentField: Array<{
    isNew: boolean;
    pigmentData: PigmentData;
    edgeIntensity: number;
  }> = [];
  public primitiveColorField: Array<{
    hasPrimitive: boolean;
    pigmentData: PigmentData;
  }> = [];
  public existingPigmentPoints: Array<{ x: number; y: number }> = [];
  public pigmentCenters: Array<{ x: number; y: number; radius: number }> = [];
  public overlapMask: Float32Array;
  public brushCenterX: number = 0;
  public brushCenterY: number = 0;
  public brushRadius: number = 0;
  public wetField: Float32Array;

  public strokeCount: number = 0;
  public maxStrokeCount: number = 50;
  public UpdateRadius = UpdateRadius;
  public edgeDetectionRadiusFactor = edgeDetectionRadiusFactor;

  // 新增边缘效果相关字段
  public firstLayerEdgeField: Float32Array; // 第一层，全画布持久边缘
  public secondLayerEdgeField: Float32Array; // 第二层，笔刷局部边缘
  
  // 第三层边缘扩散 - 两层内部结构
  public thirdLayerTempField: Float32Array;      // 临时计算层 (1.5倍半径的小数组)
  public thirdLayerPersistentField: Float32Array; // 持久存储层 (全画布)
  public thirdLayerTempSize: number = 0;         // 临时层的尺寸
  public thirdLayerTempCenterX: number = 0;      // 临时层中心X
  public thirdLayerTempCenterY: number = 0;      // 临时层中心Y
  
  // 调试测试层
  public debugTestLayer: Float32Array;          // 测试层，用于诊断扩散问题

  // 拖动方向追踪
  public dragDirectionX: number = 0;
  public dragDirectionY: number = 0;
  public hasDragDirection: boolean = false;
  public dragDirectionHistory: Array<{x: number, y: number}> = [];
  public directionWeights: number[] = [0.4, 0.3, 0.2, 0.1];

  // 未处理点队列系统
  public pendingPoints: Array<{x: number, y: number}> = [];
  public isProcessingPoints: boolean = false;
  public maxQueueSize: number = 200; // 防止队列过大

  // 步数扩散系统
  public stepField: Int32Array; // 步数数组
  public coordinateHistory: Array<{x: number, y: number}> = []; // 历史坐标
  public currentStepCount: number = 0; // 当前步数

  constructor(canvasElement: HTMLCanvasElement, width: number, height: number) {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.isDrawing = false;
    this.prevMouseX = 0;
    this.prevMouseY = 0;
    const size = width * height;
    this.brush = { color: [111, 111, 111], opacity: 1, size: 10 };
    this.strokeCount = 0;

    // 批量初始化数组
    this.distanceField = new Float32Array(size);
    this.closestPigmentX = new Int32Array(size);
    this.closestPigmentY = new Int32Array(size);
    this.gradientFieldX = new Float32Array(size);
    this.gradientFieldY = new Float32Array(size);
    this.wetField = new Float32Array(size);
    this.overlapMask = new Float32Array(size);

    // 添加新的边缘场初始化
    this.firstLayerEdgeField = new Float32Array(size);
    this.secondLayerEdgeField = new Float32Array(size);
    
    // 初始化第三层边缘扩散字段
    this.thirdLayerPersistentField = new Float32Array(size);
    // thirdLayerTempField初始化为空数组，将在第一次使用时动态创建
    this.thirdLayerTempField = new Float32Array(0);
    
    // 初始化调试测试层
    this.debugTestLayer = new Float32Array(size);

    // 初始化步数扩散系统
    this.stepField = new Int32Array(size);
    this.stepField.fill(stepFieldSpecialValue); // 初始化为特定值

    const { left, right, top, bottom } = this.getRegion(
      this.brushCenterX,
      this.brushCenterY,
      this.brushRadius
    );
    this.lastBrushPigment = Array((right - left) * (bottom - top))
      .fill(null)
      .map(() => ({
        color: [255, 255, 255] as [number, number, number],
        opacity: 1,
      }));

    // 批量初始化复杂数组
    initComplexArrays(this, size);
    this.canvas = canvasElement;
    initP5(this);
  }

  /**
   * 重置引擎状态
   */
  public reset(): void {
    const size = this.canvasWidth * this.canvasHeight;

    this.distanceField.fill(Infinity);
    this.closestPigmentX.fill(-1);
    this.closestPigmentY.fill(-1);
    this.gradientFieldX.fill(0);
    this.gradientFieldY.fill(0);
    this.overlapMask.fill(0);
    for (let i = 0; i < size; i++) {
      this.newPigmentField[i] = {
        isNew: false,
        pigmentData: {
          color: [255, 255, 255] as [number, number, number],
          opacity: 1,
        },
        edgeIntensity: 0,
      };
      this.primitiveColorField[i] = {
        hasPrimitive: false,
        pigmentData: {
          color: [255, 255, 255] as [number, number, number],
          opacity: 1,
        },
      };
    }
    this.existingPigmentPoints = [];
  }

  /**
   * 判断鼠标是否在画布上
   */
  public isMouseOnCanvas(): boolean {
    const p = this.p5Instance;
    return (
      p.mouseX >= 0 &&
      p.mouseX < this.canvasWidth &&
      p.mouseY >= 0 &&
      p.mouseY < this.canvasHeight
    );
  }

  /**
   * 保存图片
   */
  public saveImage(filename: string = "watercolor"): void {
    this.p5Instance.save(`${filename}.jpg`);
  }

  /**
   * 清除画布
   */
  public clearCanvas(): void {
    this.p5Instance.background(255);
    initArrays(this);
  }

  /**
   * 设置笔刷颜色
   */
  public setBrushColor(color: [number, number, number]): void {
    this.brush.color = [...color]; // 确保使用复制值而不是引用
    console.log("setBrushColor", this.brush.color);

    // 如果不是在绘制中，可以考虑重新初始化lastBrushPigment
    if (!this.isDrawing) {
      const brushSize = (2 * this.brush.size + 1) * (2 * this.brush.size + 1);
      this.lastBrushPigment = Array(brushSize)
        .fill(null)
        .map(() => ({
          color: [...this.brush.color],
          opacity: this.brush.opacity,
        }));
    }
  }

  /**
   * 设置笔刷不透明度
   */
  public setBrushOpacity(opacity: number): void {
    this.brush.opacity = opacity;
  }

  /**
   * 设置笔刷大小
   */
  public setBrushSize(size: number): void {
    this.brush.size = size;
    // 与lastBrushPigment使用相同的大小计算公式
    const brushSize = (this.brush.size * 2 + 1) * (this.brush.size * 2 + 1);
    this.lastBrushPigment = Array(brushSize)
      .fill(null)
      .map(() => ({
        color: [...this.brush.color],
        opacity: this.brush.opacity,
      }));
    console.log("setBrushSize", this.brush.size);
  }

  /**
   * 当容器大小改变时调整
   */
  public resizeCanvas(): void {
    if (this.canvas) {
      this.canvasWidth = this.canvas.clientWidth;
      this.canvasHeight = this.canvas.clientHeight;
      this.p5Instance.resizeCanvas(this.canvasWidth, this.canvasHeight);
      initArrays(this);
    }
  }

  /**
   * 更新画布大小
   */
  public updateCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  /**
   * 获取指定圆形区域的边界
   */
  public getRegion(centerX: number, centerY: number, radius: number): Region {
    return {
      left: Math.max(0, Math.floor(centerX - radius)),
      right: Math.min(this.canvasWidth - 1, Math.ceil(centerX + radius)),
      top: Math.max(0, Math.floor(centerY - radius)),
      bottom: Math.min(this.canvasHeight - 1, Math.ceil(centerY + radius)),
    };
  }

  /**
   * 更新拖动方向历史记录
   */
  private updateDirectionHistory(dx: number, dy: number): void {
    const magnitude = Math.sqrt(dx * dx + dy * dy);
    if (magnitude > 0) {
      // 标准化方向向量
      const normalizedDirection = {
        x: dx / magnitude,
        y: dy / magnitude
      };
      
      // 添加到历史记录
      this.dragDirectionHistory.push(normalizedDirection);
      
      // 保持数组长度为4
      if (this.dragDirectionHistory.length > 4) {
        this.dragDirectionHistory.shift();
      }
    }
  }

  /**
   * 计算加权平均方向
   */
  private calculateWeightedDirection(): {x: number, y: number} {
    if (this.dragDirectionHistory.length === 0) {
      return {x: 0, y: 0};
    }
    
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;
    
    // 使用最近的方向获得更高权重
    for (let i = 0; i < this.dragDirectionHistory.length; i++) {
      const weight = this.directionWeights[i] || 0.1; // 如果权重不够，使用默认值
      const direction = this.dragDirectionHistory[this.dragDirectionHistory.length - 1 - i]; // 从最近的开始
      
      weightedX += direction.x * weight;
      weightedY += direction.y * weight;
      totalWeight += weight;
    }
    
    // 标准化
    if (totalWeight > 0) {
      return {
        x: weightedX / totalWeight,
        y: weightedY / totalWeight
      };
    }
    
    return {x: 0, y: 0};
  }

  /**
   * 更新拖动方向
   */
  public updateDragDirection(currentX: number, currentY: number): void {
    if (this.isDrawing && this.prevMouseX !== undefined && this.prevMouseY !== undefined) {
      const dx = currentX - this.prevMouseX;
      const dy = currentY - this.prevMouseY;
      const magnitude = Math.sqrt(dx * dx + dy * dy);
      
      if (magnitude > 0) {
        // 更新方向历史
        this.updateDirectionHistory(dx, dy);
        
        // 计算加权平均方向
        const avgDirection = this.calculateWeightedDirection();
        
        // 只有当累计方向足够强时才更新主方向
        const avgMagnitude = Math.sqrt(avgDirection.x * avgDirection.x + avgDirection.y * avgDirection.y);
        if (avgMagnitude > 0.1) { // 阈值避免微小抖动
          this.dragDirectionX = avgDirection.x;
          this.dragDirectionY = avgDirection.y;
          this.hasDragDirection = true;
        }
      }
    }
  }

  /**
   * 重置拖动方向
   */
  public resetDragDirection(): void {
    this.dragDirectionX = 0;
    this.dragDirectionY = 0;
    this.hasDragDirection = false;
    this.dragDirectionHistory = []; // 清空方向历史
    // 清空第三层临时场，为下次拖动做准备
    this.thirdLayerTempField.fill(0);
  }

  /**
   * 添加未处理点到队列
   */
  public addPendingPoint(x: number, y: number): void {
    // 防止队列过大
    if (this.pendingPoints.length >= this.maxQueueSize) {
      console.warn('Pending points queue is full, dropping oldest points');
      this.pendingPoints.splice(0, this.pendingPoints.length - this.maxQueueSize + 1);
    }
    
    this.pendingPoints.push({ x, y });
  }

  /**
   * 使用Bresenham算法计算两点间的所有像素点
   */
  public getLinePoints(x0: number, y0: number, x1: number, y1: number): Array<{x: number, y: number}> {
    const points: Array<{x: number, y: number}> = [];
    
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    
    while (true) {
      points.push({ x, y });
      
      if (x === x1 && y === y1) break;
      
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    
    return points;
  }

  /**
   * 添加两点间的所有中间点到待处理队列
   */
  public addLineToQueue(fromX: number, fromY: number, toX: number, toY: number): void {
    const linePoints = this.getLinePoints(fromX, fromY, toX, toY);
    
    // 跳过起点（通常已经处理过）
    for (let i = 1; i < linePoints.length; i++) {
      this.addPendingPoint(linePoints[i].x, linePoints[i].y);
    }
  }

  /**
   * 处理一个未处理点
   */
  public processSinglePendingPoint(): boolean {
    if (this.pendingPoints.length === 0) {
      return false;
    }
    
    const point = this.pendingPoints.shift();
    if (!point) return false;
    
    // 处理这个点
    // console.log("processSinglePendingPoint", point.x, point.y);
    this.processNewPigmentAddition(point.x, point.y, this.brush.size);
    this.updateDragDirection(point.x, point.y);
    
    // 处理完每个点后立即渲染，提供流畅的视觉反馈
    this.render();
    
    return true;
  }

  /**
   * 处理所有未处理点
   */
  public processAllPendingPoints(): void {
    if (this.isProcessingPoints) {
      return; // 防止重入
    }
    
    this.isProcessingPoints = true;
    
    try {
      let processedCount = 0;
      const maxProcessPerFrame = 20; // 减少每帧处理点数，因为每个点都会渲染
      
      while (this.pendingPoints.length > 0 && processedCount < maxProcessPerFrame) {
        if (!this.processSinglePendingPoint()) {
          break;
        }
        processedCount++;
      }
      
      // 如果还有未处理点，安排下一帧继续处理
      if (this.pendingPoints.length > 0) {
        requestAnimationFrame(() => {
          this.isProcessingPoints = false;
          this.processAllPendingPoints();
        });
      } else {
        this.isProcessingPoints = false;
        // 不需要在这里渲染，因为每个点处理时都已经渲染过了
      }
    } catch (error) {
      console.error('Error processing pending points:', error);
      this.isProcessingPoints = false;
    }
  }

  /**
   * 清空未处理点队列
   */
  public clearPendingPoints(): void {
    this.pendingPoints = [];
    this.isProcessingPoints = false;
  }

  /**
   * 调度渲染，确保在异步处理时正确渲染
   */
  public scheduleRender(): void {
    if (!this.isProcessingPoints) {
      this.render();
    } else {
      // 如果正在处理点，延迟渲染
      requestAnimationFrame(() => {
        if (!this.isProcessingPoints) {
          this.render();
        } else {
          this.scheduleRender(); // 递归调度直到处理完成
        }
      });
    }
  }

  /**
   * 等待队列处理完成，然后执行回调
   */
  public waitForProcessingComplete(callback: () => void, maxWaitTime: number = 5000): void {
    const startTime = Date.now();
    
    const checkComplete = () => {
      // 检查是否处理完成
      if (!this.isProcessingPoints && this.pendingPoints.length === 0) {
        callback();
        return;
      }
      
      // 检查是否超时
      if (Date.now() - startTime > maxWaitTime) {
        console.warn('等待队列处理完成超时，强制执行回调');
        callback();
        return;
      }
      
      // 继续等待
      requestAnimationFrame(checkComplete);
    };
    
    checkComplete();
  }

  /**
   * 确保第三层临时场的大小正确
   */
  public   ensureThirdLayerTempSize(centerX: number, centerY: number, radius: number): void {
    const tempRadius = Math.ceil(radius * 1.2);
    const tempSize = (tempRadius * 2 + 1) * (tempRadius * 2 + 1);
    
    // 只在尺寸变化时重新创建数组
    if (this.thirdLayerTempSize !== tempSize) {
      console.log("ensureThirdLayerTempSize", tempSize);
      this.thirdLayerTempField = new Float32Array(tempSize);
      this.thirdLayerTempSize = tempSize;
    }
    
    // 更新中心位置
    this.thirdLayerTempCenterX = centerX;
    this.thirdLayerTempCenterY = centerY;
  }

  /**
   * 增加笔画计数
   */
  public incrementStrokeCount(): void {
    this.strokeCount++;
  }

  // 将外部功能暴露为类方法
  public initArrays = () => initArrays(this);
  public calculateWetAreaEdges = () => calculateWetAreaEdges(this);
  public render = () => render(this);
  public clearThirdLayerAtPosition = (centerX: number, centerY: number, radius: number) => 
    clearThirdLayerAtPosition(this, centerX, centerY, radius);

  public processNewPigmentAddition = (
    centerX: number,
    centerY: number,
    radius: number
  ) => processNewPigmentAddition(this, centerX, centerY, radius);
  
  public mixPrimitiveLayerToPigmentField = (
    centerX: number,
    centerY: number,
    radius: number
  ) => mixPrimitiveLayerToPigmentField(this, centerX, centerY, radius);
  
  public clearPrimitiveLayer = (
    centerX: number,
    centerY: number,
    radius: number
  ) => clearPrimitiveLayer(this, centerX, centerY, radius);
}

export { WatercolorEngine };
