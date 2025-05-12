import { WatercolorEngine } from "../watercolorEngine";
import mixbox from "mixbox";
import { RGB2HSL, HSL2RGB } from "../../Utils/colorConvert";

/**
 * 使用Sobel算子计算湿区的边缘强度
 */
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

      // 只在有颜料的区域计算梯度
      if (
        !engine.pigmentField[index].isOld &&
        !engine.newPigmentField[index].isNew
      ) {
        gradientMagnitude[index] = 0;
        continue;
      }

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

      // 只有当所有采样点都有效时，才计算梯度幅值
      gradientMagnitude[index] = validSamples
        ? Math.sqrt(gx * gx + gy * gy)
        : 0;
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

  // 将梯度归一化并应用到边缘强度场
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
          const normalizedGradient =
            gradientMagnitude[index] * normalizationFactor;
          // 无论梯度大小，都直接更新边缘强度，这样可以消除不再是边缘的区域
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

      // 获取数据并混合颜色
      const baseColor = engine.pigmentField[index].pigmentData.color;
      const edgeIntensity = engine.edgeIntensityField[index];
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

      // 处理边缘效果 - 只降低亮度，原亮度越高降低得越少
      if (edgeIntensity > 0.01) {
        const { h, s, l } = RGB2HSL(
          finalColor[0],
          finalColor[1],
          finalColor[2]
        );

        // 根据原亮度计算降低幅度
        const lightnessFactor = Math.pow(l, 0.5);
        const lightnessReduction =
          edgeIntensity * (0.4 - 0.3 * lightnessFactor);
        const newL = Math.max(0.2, l - lightnessReduction);

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
