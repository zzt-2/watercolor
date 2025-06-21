# 水彩边缘增强效果改进

根据需求分析，当前的边缘增强实现与期望效果不符，需要进行一系列改进。本文档总结需要进行的修改内容。

## 当前问题

1. 边缘检测半径过大：目前使用 `edgeDetectionRadiusFactor` 倍笔刷半径进行边缘检测，实际应该修改为更精确的控制
2. 边缘强度直接混入颜料场：在`updatePigmentField`中将边缘强度永久地混合到了颜料场中，这种做法缺乏分层控制

## 边缘层实现要求

需要将边缘分为三层不同的实现：

### 第一层（全画布持久边缘保留）

- **目的**：在边缘保留微弱但持久的形状，提供画面整体的边缘连续性
- **范围**：全画布范围，不局限于笔刷区域
- **更新机制**：只在有新颜料的区域重新计算边缘，其他区域保持不变（**不进行自然衰减**）
- **强度**：微弱但可见，主要用于形状轮廓的持久化
- **持久性**：笔刷没有经过的区域保持边缘不变，只有笔刷经过时才更新该区域

### 第二层（笔刷局部高强度边缘）

- **目的**：在笔刷附近产生高强度边缘加深效果，提供即时的边缘对比
- **范围**：仅在笔刷周围范围内进行清空和重新计算
  - **清空范围**：笔刷 1.2 倍半径，以防出现遗漏
  - **赋值范围**：笔刷 1 倍半径内，比较合适
- **更新机制**：每次绘制时清空笔刷范围，重新计算该区域的边缘强度
- **强度**：中等强度，配合第三层形成 ArtRage 的黑边效果
- **局部性**：只会在笔刷周围出现，远离笔刷的区域不受影响

### 第三层（蒙版积累的拖动效果）

- **目的**：模拟 ArtRage 效果，让更深的边缘有拖动感，在边缘来回拖动时积累更深颜色，向其他方向拖动时深色跟随
- **实现机制**：
  - 使用蒙版记录已有强边缘的区域
  - 当笔刷经过强边缘区域时，将深色记录到蒙版中
  - 当笔刷继续移动时，蒙版中的深色效果跟随笔刷方向扩散
  - 实现类似"拖拽深色边缘"的视觉效果
- **强度**：弱到中等，配合第二层形成 ArtRage 的黑边效果
- **蒙版更新**：根据第一、二层的强边缘更新蒙版，保持历史边缘信息

## 当前实现存在的问题

### 已识别的问题

1. **第二层半径设置问题**：

   - 当前使用 1.5 倍半径进行赋值，效果比较怪
   - 应改为：清空 1.2 倍半径，赋值 1 倍半径

2. **第三层混色不一致问题**：

   - mouseReleased 前参与渲染的效果和 mouseReleased 后混入颜料的效果不同
   - 怀疑是混色算法存在差别，需要统一混色逻辑

3. **扩散过于均匀问题**：

   - 当前第三层扩散过于均匀，与 ArtRage 实际效果不符
   - ArtRage 的扩散并不均匀，应该有更多变化和随机性

4. **第二层强度过高问题**：

   - 实际 ArtRage 的黑边应该是二、三层合起来的效果
   - 需要降低第二层独立强度，让二、三层配合产生最终效果

5. **第三层拖动效果失败**：
   - 原有的拖动效果实现完全没有达到目的
   - 当前实现无法模拟 ArtRage 的边缘拖拽感
   - 需要重新设计拖动机制

### 待改进的点

1. **拖动效果重新设计**：

   - 需要更好地理解 ArtRage 的拖动机制
   - 可能需要记录笔刷移动轨迹和方向
   - 深色应该沿着笔刷移动方向产生拖尾效果

2. **扩散算法优化**：

   - 引入更多随机性和不均匀性
   - 考虑基于笔刷移动方向的定向扩散
   - 添加强度变化和渐变效果

3. **混色逻辑统一**：
   - 确保渲染时和混入颜料时使用相同的混色算法
   - 可能需要提取公共混色函数

## 关键优化点

1. **分离渲染和混合时机**：

   - 所有三层在渲染时都参与计算视觉效果
   - 但都只在 mouseReleased 时才混入颜料场
   - 这种分离可以提供更精细的控制和更真实的水彩效果

2. **精确控制边缘作用范围**：

   - 第一层：全画布范围，只在新颜料区域更新，其他区域保持不变
   - 第二层：笔刷 1.2 倍半径范围内清空，1 倍半径内重新计算，确保只有笔刷周围有边缘
   - 第三层：基于蒙版的拖动扩散，范围由历史边缘决定

3. **边界拖动和积累效果**：
   - 第三层关注模拟 ArtRage 的拖动深色效果
   - 蒙版记录强边缘区域，当笔刷经过时积累深色
   - 深色效果跟随笔刷移动方向，实现拖拽感
   - 强度应适中，与第二层配合产生最终黑边效果

## 需要修改的文件

1. `watercolorEngine.ts`

   - 添加新的数据结构，用于存储三层边缘
   - 保持现有的`edgeDetectionRadiusFactor`常量或添加新的边缘检测参数

2. `watercolorEdgeHandling.ts`

   - 修改`calculateWetAreaEdges`函数，实现三层不同的更新逻辑
   - 实现第三层蒙版拖动效果的计算逻辑
   - 在`render`函数中区分处理三层边缘的渲染效果，保持现有的 HSL 色彩空间处理方式

3. `watercolorDiffusion.ts`

   - 修改`updatePigmentField`函数，移除即时边缘混合逻辑（当前在 366-385 行的边缘效果应用部分）
   - 增加新的蒙版拖动函数，实现第三层的拖拽效果
   - 保持现有的`applyGaussianBlurToEdgeField`函数或进行适当修改

4. `watercolorInitialization.ts`
   - 在`initArrays`和`initComplexArrays`中初始化新的边缘层数据结构
   - 在`mouseReleased`事件处理中添加将所有三层边缘混入颜料的逻辑

## 具体实现建议

1. 在 WatercolorEngine 类中添加三个新的边缘强度场数组：

   ```typescript
   public firstLayerEdgeField: Float32Array;  // 第一层，全画布持久边缘
   public secondLayerEdgeField: Float32Array; // 第二层，笔刷局部边缘
   public thirdLayerEdgeField: Float32Array;  // 第三层，拖动扩散边缘
   public edgeMask: Float32Array;            // 拖动深色蒙版
   ```

   **在构造函数中初始化这些数组：**

   ```typescript
   constructor(canvasElement: HTMLCanvasElement, width: number, height: number) {
     // ... 现有代码 ...
     const size = width * height;

     // 添加新的边缘场初始化
     this.firstLayerEdgeField = new Float32Array(size);
     this.secondLayerEdgeField = new Float32Array(size);
     this.thirdLayerEdgeField = new Float32Array(size);
     this.edgeMask = new Float32Array(size);

     // ... 其余现有代码 ...
   }
   ```

   **在类的末尾添加新方法的暴露：**

   ```typescript
   // 将外部功能暴露为类方法
   public initArrays = () => initArrays(this);
   public calculateWetAreaEdges = () => calculateWetAreaEdges(this);
   public render = () => render(this);
   public mergeBrushColorToPigment = () => mergeBrushColorToPigment(this);
   public processNewPigmentAddition = (
     centerX: number,
     centerY: number,
     radius: number
   ) => processNewPigmentAddition(this, centerX, centerY, radius);

   // 添加新的方法暴露
   public processThirdLayerDrag = () => processThirdLayerDrag(this);
   public mergeEdgesToPigment = () => mergeEdgesToPigment(this);
   ```

2. 在边缘检测过程中区分计算三层边缘，修改`calculateWetAreaEdges`函数：

   ```typescript
   export function calculateWetAreaEdges(engine: WatercolorEngine): void {
     const wetRadius = engine.brushRadius * engine.edgeDetectionRadiusFactor;
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

     // 创建临时湿度梯度场
     const gradientMagnitude = new Float32Array(
       engine.canvasWidth * engine.canvasHeight
     );

     // ... 现有的 Sobel 算子计算代码 ...

     // 第二层：只清空笔刷1.5倍半径范围，重新计算
     const localRadius = engine.brushRadius * 1.5;
     const {
       left: localLeft,
       right: localRight,
       top: localTop,
       bottom: localBottom,
     } = engine.getRegion(
       engine.brushCenterX,
       engine.brushCenterY,
       localRadius
     );

     // 清空第二层的笔刷范围
     for (let y = localTop; y <= localBottom; y++) {
       for (let x = localLeft; x <= localRight; x++) {
         const index = y * engine.canvasWidth + x;
         engine.secondLayerEdgeField[index] = 0;
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

             // 第一层处理 - 全画布持久边缘，只在有新颜料区域更新
             if (
               engine.newPigmentField[index].isNew &&
               normalizedGradient > 0.03
             ) {
               const firstLayerIntensity =
                 Math.pow(normalizedGradient, 0.8) * 0.4;
               engine.firstLayerEdgeField[index] = firstLayerIntensity;
             }

             // 第二层处理 - 笔刷局部高强度边缘，在1.5倍半径内
             if (dist <= localRadius && normalizedGradient > 0.05) {
               const secondLayerIntensity =
                 Math.pow(normalizedGradient, 0.6) * 0.8;
               engine.secondLayerEdgeField[index] = secondLayerIntensity;
             }

             // 保持兼容性，更新原有边缘强度场
             engine.edgeIntensityField[index] =
               normalizedGradient > 0.05
                 ? Math.pow(normalizedGradient, 0.65)
                 : 0;
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
   }
   ```

3. 实现第三层的蒙版拖动效果，新增独立函数：

   ```typescript
   export function processThirdLayerDrag(engine: WatercolorEngine): void {
     const brushRadius = engine.brushRadius;
     const { left, right, top, bottom } = engine.getRegion(
       engine.brushCenterX,
       engine.brushCenterY,
       brushRadius * 2
     );

     // 第一步：更新蒙版 - 记录强边缘区域
     for (let y = top; y <= bottom; y++) {
       for (let x = left; x <= right; x++) {
         const index = y * engine.canvasWidth + x;

         // 如果第一层或第二层有较强边缘，记录到蒙版
         const strongEdge =
           engine.firstLayerEdgeField[index] > 0.3 ||
           engine.secondLayerEdgeField[index] > 0.4;

         if (strongEdge) {
           // 积累深色到蒙版，模拟ArtRage的积累效果
           engine.edgeMask[index] = Math.min(1.0, engine.edgeMask[index] + 0.2);
         }
       }
     }

     // 第二步：拖动效果 - 让蒙版中的深色跟随笔刷移动
     const tempBuffer = new Float32Array(engine.thirdLayerEdgeField.length);

     for (let y = top; y <= bottom; y++) {
       for (let x = left; x <= right; x++) {
         const index = y * engine.canvasWidth + x;

         if (engine.edgeMask[index] > 0.1) {
           // 计算笔刷方向的拖动效果
           const dx = x - engine.brushCenterX;
           const dy = y - engine.brushCenterY;
           const dist = Math.sqrt(dx * dx + dy * dy);

           if (dist <= brushRadius * 1.5) {
             // 在笔刷影响范围内，产生拖动效果
             const dragStrength = Math.max(0, 1 - dist / (brushRadius * 1.5));
             tempBuffer[index] = engine.edgeMask[index] * dragStrength * 0.6;
           }
         }
       }
     }

     // 第三步：简单扩散，让拖动效果向笔刷移动方向延伸
     for (let y = top; y <= bottom; y++) {
       for (let x = left; x <= right; x++) {
         const index = y * engine.canvasWidth + x;

         if (tempBuffer[index] > 0) {
           // 计算邻域的拖动效果扩散
           let diffusedValue = tempBuffer[index];
           let neighborCount = 1;

           // 检查相邻像素的拖动效果
           for (let ky = -1; ky <= 1; ky++) {
             for (let kx = -1; kx <= 1; kx++) {
               if (kx === 0 && ky === 0) continue;

               const nx = x + kx;
               const ny = y + ky;

               if (
                 nx >= 0 &&
                 nx < engine.canvasWidth &&
                 ny >= 0 &&
                 ny < engine.canvasHeight
               ) {
                 const neighborIndex = ny * engine.canvasWidth + nx;
                 if (tempBuffer[neighborIndex] > 0) {
                   diffusedValue += tempBuffer[neighborIndex] * 0.1;
                   neighborCount++;
                 }
               }
             }
           }

           engine.thirdLayerEdgeField[index] = diffusedValue / neighborCount;
         }
       }
     }
   }
   ```

4. 修改渲染函数，使用三层权重，保持现有的 HSL 处理方式：

   ```typescript
   // 在render函数中，修改边缘效果处理部分
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

         // 获取数据并混合颜色
         const baseColor = engine.pigmentField[index].pigmentData.color;
         const brushData = engine.brushColorField[index];

         // 混合颜色
         let finalColor =
           brushData.opacity > 0
             ? mixbox.lerp(
                 `rgb(${baseColor.join(",")})`,
                 `rgb(${brushData.color.join(",")})`,
                 brushData.opacity
               )
             : baseColor;

         // 计算综合边缘效果 - 平衡的权重分配
         const combinedEdgeEffect =
           engine.firstLayerEdgeField[index] * 0.3 + // 全画布持久边缘
           engine.secondLayerEdgeField[index] * 0.6 + // 笔刷局部高强度
           engine.thirdLayerEdgeField[index] * 0.4; // 拖动扩散效果

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
   ```

5. 添加函数在绘制结束时混合边缘，新增到`watercolorDiffusion.ts`：

   ```typescript
   // 在mouseReleased事件中调用此函数
   export function mergeEdgesToPigment(engine: WatercolorEngine): void {
     for (let i = 0; i < engine.canvasWidth * engine.canvasHeight; i++) {
       if (!engine.pigmentField[i].isOld) continue;

       // 计算综合边缘效果 - 与渲染权重保持一致
       const totalEdgeEffect =
         engine.firstLayerEdgeField[i] * 0.3 +
         engine.secondLayerEdgeField[i] * 0.6 +
         engine.thirdLayerEdgeField[i] * 0.4;

       if (totalEdgeEffect > 0.01) {
         const color = engine.pigmentField[i].pigmentData.color;
         const { h, s, l } = RGB2HSL(color[0], color[1], color[2]);

         // 根据原亮度计算降低幅度
         const lightnessFactor = Math.pow(l, 0.5);
         const lightnessReduction =
           totalEdgeEffect * (0.25 - 0.15 * lightnessFactor) * 0.2; // 降低混合强度

         // 限制最低亮度
         const minL = 0.2;
         const newL = Math.max(minL, l - lightnessReduction);

         // 只调整亮度
         const { r, g, b } = HSL2RGB(h, s, newL);
         engine.pigmentField[i].pigmentData.color = [r, g, b];
       }
     }

     // 混合完毕后只清空第二层（局部边缘），保留第一层和第三层
     engine.secondLayerEdgeField.fill(0);
     // 第一层保持不变，第三层的蒙版和效果继续保留
   }
   ```

6. 修改 mouseReleased 事件（在`initP5`函数中）：

   ```typescript
   p.mouseReleased = () => {
     engine.isDrawing = false;
     if (engine.strokeCount > 0) {
       engine.mergeBrushColorToPigment();
       engine.mergeEdgesToPigment(); // 混合所有三层边缘
     }
     // 清除临时场...
     for (let i = 0; i < engine.brushColorField.length; i++) {
       engine.brushColorField[i] = {
         color: [255, 255, 255] as [number, number, number],
         opacity: 0,
         isNew: false,
       };
     }
     engine.strokeCount = 0;
   };
   ```

7. 修改`initArrays`函数，确保新数组得到正确初始化：

   ```typescript
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
     engine.edgeIntensityField.fill(0);
     engine.wetField.fill(0);

     // 初始化新的边缘场
     engine.firstLayerEdgeField.fill(0);
     engine.secondLayerEdgeField.fill(0);
     engine.thirdLayerEdgeField.fill(0);
     engine.edgeMask.fill(0);
   }
   ```

## 关键调用时机和流程

**在每次绘制过程中的调用顺序：**

1. `mousePressed` 或 `mouseDragged` 触发
2. `processNewPigmentAddition` 处理新颜料
3. `calculateWetAreaEdges` 计算边缘（包括调用 `processThirdLayerDrag`）
4. `render` 进行渲染显示
5. `mouseReleased` 时调用 `mergeEdgesToPigment` 将边缘永久混入颜料场

## 总结

通过实现三层边缘结构，可以实现更细腻、更真实的水彩边缘效果：

1. **第一层**：提供全画布持久的形状轮廓，笔刷经过的区域才更新，其他区域保持不变
2. **第二层**：提供笔刷周围的高强度局部边缘效果，只在笔刷范围内出现
3. **第三层**：通过蒙版实现类似 ArtRage 的拖动深色效果，强边缘区域的深色会跟随笔刷移动

分离渲染和混合时机的策略，既能提供即时视觉反馈，又能保持更自然的水彩混合效果。第三层的蒙版机制可以有效模拟边缘深色的积累和拖动效果，使绘制出的水彩效果更加真实自然。

### 与现有代码的兼容性

这个实现设计充分考虑了现有代码结构：

1. **保持现有的数据结构和方法**：不破坏现有的`pigmentField`、`newPigmentField`等核心数据结构
2. **复用现有的 HSL 色彩处理**：继续使用现有的`RGB2HSL`和`HSL2RGB`函数进行色彩转换
3. **保持现有的区域计算方式**：使用现有的`getRegion`方法和`UpdateRadius`常量
4. **兼容现有的事件处理流程**：在现有的 mouse 事件处理基础上添加边缘处理逻辑
5. **渐进式修改**：可以分步骤实现，先添加新的数据结构，再逐步修改处理逻辑
