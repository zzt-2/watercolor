import p5 from "p5";
import { WatercolorEngine } from "../watercolorEngine";
import { BrushData, PigmentData } from "../types/watercolorTypes";
import { resetStepField } from "./watercolorDiffusion";
import { stepFieldSpecialValue } from "../constants/watercolorConstants";

/**
 * 初始化P5实例及与画布相关的设置
 */
export function initP5(engine: WatercolorEngine): void {
  const sketch = (p: p5) => {
    engine.p5Instance = p;

    p.setup = () => {
      p.createCanvas(engine.canvasWidth, engine.canvasHeight).parent(
        engine.canvas!
      );
      p.pixelDensity(1);
      p.background(255);
      p.loadPixels();
      engine.initArrays();
    };

    p.draw = () => {};

    p.mousePressed = () => {
      if (engine.isMouseOnCanvas()) {
        // 确保使用整数坐标
        const mouseX = Math.round(p.mouseX);
        const mouseY = Math.round(p.mouseY);
        
        // 清空任何剩余的未处理点
        engine.clearPendingPoints();
        
        // 在开始新笔触前清空对应区域的第三层持久层
        engine.clearThirdLayerAtPosition(mouseX, mouseY, engine.brush.size);
        
        engine.processNewPigmentAddition(mouseX, mouseY, engine.brush.size);
        engine.render();
        engine.isDrawing = true;
        
        // 设置初始位置，为拖拽提供正确的起点
        engine.prevMouseX = mouseX;
        engine.prevMouseY = mouseY;
      }
    };

    p.mouseDragged = () => {
      if (
        engine.isDrawing &&
        engine.isMouseOnCanvas() &&
        (engine.prevMouseX != p.mouseX || engine.prevMouseY != p.mouseY)
      ) {
        // 确保使用整数坐标
        const mouseX = Math.round(p.mouseX);
        const mouseY = Math.round(p.mouseY);
        
        // 获取上一个位置（如果是第一次拖拽，使用当前位置）
        const prevX = engine.prevMouseX !== 0 ? engine.prevMouseX : mouseX;
        const prevY = engine.prevMouseY !== 0 ? engine.prevMouseY : mouseY;

        engine.prevMouseX = mouseX;
        engine.prevMouseY = mouseY;

        // 如果两点间距离超过1像素，需要插值处理
        const dx = mouseX - prevX;
        const dy = mouseY - prevY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 1) {
          // 添加两点间的所有中间点到队列
          engine.addLineToQueue(prevX, prevY, mouseX, mouseY);
        } else {
          // 距离小于等于1像素，直接处理当前点
          engine.addPendingPoint(mouseX, mouseY);
        }
        
        // 如果当前没有在处理队列，才开始处理
        if (!engine.isProcessingPoints) {
          engine.processAllPendingPoints();
        }
      }
    };

    p.mouseReleased = () => {
      if (engine.isDrawing) {
        // 确保使用整数坐标
        const mouseX = Math.round(p.mouseX);
        const mouseY = Math.round(p.mouseY);
        
        // 等待队列处理完成后再执行清理逻辑
        engine.waitForProcessingComplete(() => {
          // 将原色层混入主颜料场
          engine.mixPrimitiveLayerToPigmentField(mouseX, mouseY, engine.brush.size);
          
          // 清空原色层
          engine.clearPrimitiveLayer(mouseX, mouseY, engine.brush.size);
          
          // 重置步数字段
          resetStepField(engine, mouseX, mouseY, engine.brush.size);
          
          // 清空队列
          engine.clearPendingPoints();
          
          // 重置拖动方向
          engine.resetDragDirection();
          
          // 完成绘制
          engine.isDrawing = false;
          engine.strokeCount = 0;
        });
        
        // 立即重置鼠标位置，为下次绘制做准备
        engine.prevMouseX = 0;
        engine.prevMouseY = 0;
      }
    };
  };

  new p5(sketch);
}

/**
 * 初始化各种数组和场
 */
export function initArrays(engine: WatercolorEngine): void {
  engine.reset();
  const size = engine.canvasWidth * engine.canvasHeight;

  // 简化初始化
  engine.pigmentField = Array(size)
    .fill(null)
    .map(() => ({
      isOld: false,
      pigmentData: {
        color: [255, 255, 255] as [number, number, number],
        opacity: 1,
      },
    }));

  engine.pigmentCenters = [];
  engine.wetField.fill(0);

  // 初始化新的边缘场
  engine.firstLayerEdgeField.fill(0);
  engine.secondLayerEdgeField.fill(0);
  
  // 初始化第三层边缘扩散场
  engine.thirdLayerTempField.fill(0);
  engine.thirdLayerPersistentField.fill(0);
  
  // 初始化调试测试层
  engine.debugTestLayer.fill(0);

  // 初始化步数字段
  engine.stepField.fill(0);
  engine.coordinateHistory = [];
  engine.currentStepCount = 0;
}

/**
 * 初始化复杂类型的数组
 */
export function initComplexArrays(
  engine: WatercolorEngine,
  size: number
): void {
  engine.pigmentField = Array(size);
  engine.newPigmentField = Array(size);
  engine.primitiveColorField = Array(size);
  for (let i = 0; i < size; i++) {
    const defaultColor = [255, 255, 255] as [number, number, number];
    engine.pigmentField[i] = {
      isOld: false,
      pigmentData: { color: [...defaultColor], opacity: 1 },
    };

    engine.newPigmentField[i] = {
      isNew: false,
      pigmentData: { color: [...defaultColor], opacity: 1 },
      edgeIntensity: 0,
    };

    engine.primitiveColorField[i] = {
      hasPrimitive: false,
      pigmentData: { color: [...defaultColor], opacity: 1 },
    };

    // 初始化lastBrushPigment数组元素
    if (i < engine.lastBrushPigment.length) {
      engine.lastBrushPigment[i] = {
        color: [...defaultColor],
        opacity: 1,
      };
    }
  }

  engine.pigmentCenters = [];
  engine.existingPigmentPoints = [];
}
