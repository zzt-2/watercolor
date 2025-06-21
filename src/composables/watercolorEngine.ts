import p5 from "p5";
import { BrushData, PigmentData, Region } from "./types/watercolorTypes";
import {
  UpdateRadius,
  edgeDetectionRadiusFactor,
} from "./constants/watercolorConstants";
import {
  initComplexArrays,
  initArrays,
  initP5,
} from "./utils/watercolorInitialization";
import {
  calculateWetAreaEdges,
  render,
  processThirdLayerDrag,
} from "./utils/watercolorEdgeHandling";
import { mergeEdgesToPigment } from "./utils/watercolorDiffusion";
import { processNewPigmentAddition } from "./utils/watercolorProcessing";

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
  public existingPigmentPoints: Array<{ x: number; y: number }> = [];
  public pigmentCenters: Array<{ x: number; y: number; radius: number }> = [];
  public overlapMask: Float32Array;
  public brushCenterX: number = 0;
  public brushCenterY: number = 0;
  public brushRadius: number = 0;
  public edgeIntensityField: Float32Array;
  public wetField: Float32Array;

  public strokeCount: number = 0;
  public maxStrokeCount: number = 50;
  public UpdateRadius = UpdateRadius;
  public edgeDetectionRadiusFactor = edgeDetectionRadiusFactor;

  // 新增三层边缘效果相关字段
  public firstLayerEdgeField: Float32Array; // 第一层，全画布持久边缘
  public secondLayerEdgeField: Float32Array; // 第二层，笔刷局部边缘
  public thirdLayerEdgeField: Float32Array; // 第三层，拖动扩散边缘
  public edgeMask: Float32Array; // 拖动深色蒙版

  // 新增拖拽轨迹记录
  public brushMoveDirectionX: number = 0; // 笔刷移动方向X
  public brushMoveDirectionY: number = 0; // 笔刷移动方向Y
  public prevBrushCenterX: number = 0; // 上一次笔刷中心X
  public prevBrushCenterY: number = 0; // 上一次笔刷中心Y

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
    this.edgeIntensityField = new Float32Array(size);
    this.wetField = new Float32Array(size);
    this.overlapMask = new Float32Array(size);

    // 添加新的边缘场初始化
    this.firstLayerEdgeField = new Float32Array(size);
    this.secondLayerEdgeField = new Float32Array(size);
    this.thirdLayerEdgeField = new Float32Array(size);
    this.edgeMask = new Float32Array(size);

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
    const { left, right, top, bottom } = this.getRegion(
      this.brushCenterX,
      this.brushCenterY,
      this.brush.size
    );
    this.lastBrushPigment = Array((right - left + 1) * (bottom - top + 1))
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
   * 增加笔画计数
   */
  public incrementStrokeCount(): void {
    this.strokeCount++;
  }

  // 将外部功能暴露为类方法
  public initArrays = () => initArrays(this);
  public calculateWetAreaEdges = () => calculateWetAreaEdges(this);
  public render = () => render(this);

  public processNewPigmentAddition = (
    centerX: number,
    centerY: number,
    radius: number
  ) => processNewPigmentAddition(this, centerX, centerY, radius);

  // 添加新的方法暴露
  public mergeEdgesToPigment = () => mergeEdgesToPigment(this);
  public processThirdLayerDrag = () => processThirdLayerDrag(this);
}

export { WatercolorEngine };
