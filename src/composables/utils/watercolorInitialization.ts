import p5 from "p5";
import { WatercolorEngine } from "../watercolorEngine";
import { BrushData, PigmentData } from "../types/watercolorTypes";

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
      engine.initArrays();
    };

    p.draw = () => {};

    p.mousePressed = () => {
      if (engine.isMouseOnCanvas()) {
        // 确保使用整数坐标
        const mouseX = Math.round(p.mouseX);
        const mouseY = Math.round(p.mouseY);
        
        // 在开始新笔触前清空对应区域的第三层持久层
        engine.clearThirdLayerAtPosition(mouseX, mouseY, engine.brush.size);
        
        engine.processNewPigmentAddition(mouseX, mouseY, engine.brush.size);
        engine.render();
        engine.isDrawing = true;
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
        
        // 更新拖动方向
        engine.updateDragDirection(mouseX, mouseY);
        
        engine.processNewPigmentAddition(mouseX, mouseY, engine.brush.size);
        engine.render();
        engine.prevMouseX = mouseX;
        engine.prevMouseY = mouseY;
      }
    };

    p.mouseReleased = () => {
      engine.isDrawing = false;
      engine.strokeCount = 0;
      engine.thirdLayerTempField.fill(0);
      // 重置拖动方向
      engine.resetDragDirection();
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
