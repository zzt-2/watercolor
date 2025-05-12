/**
 * 将RGB颜色转换为HSL颜色空间
 * @param r 红色分量 (0-255)
 * @param g 绿色分量 (0-255)
 * @param b 蓝色分量 (0-255)
 * @returns HSL数组 [h, s, l]，其中h为0-1，s为0-1，l为0-1
 */
export function RGB2HSL(
  r: number,
  g: number,
  b: number
): { h: number; s: number; l: number } {
  // 确保输入值在有效范围内
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));

  // 归一化RGB值到0-1范围
  const normalizedR = r / 255;
  const normalizedG = g / 255;
  const normalizedB = b / 255;

  const max = Math.max(normalizedR, normalizedG, normalizedB);
  const min = Math.min(normalizedR, normalizedG, normalizedB);
  const delta = max - min;

  // 初始化HSL值
  let h = 0; // 色相
  let s = 0; // 饱和度
  const l = (max + min) / 2; // 亮度

  // 如果最大值等于最小值，则颜色是灰色的（无色相）
  if (delta !== 0) {
    // 计算饱和度
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    // 根据哪个颜色分量是最大值来计算色相
    if (max === normalizedR) {
      h =
        ((normalizedG - normalizedB) / delta +
          (normalizedG < normalizedB ? 6 : 0)) /
        6;
    } else if (max === normalizedG) {
      h = ((normalizedB - normalizedR) / delta + 2) / 6;
    } else {
      // max === normalizedB
      h = ((normalizedR - normalizedG) / delta + 4) / 6;
    }
  }

  // 确保返回值在有效范围内
  return {
    h: Math.max(0, Math.min(1, h)),
    s: Math.max(0, Math.min(1, s)),
    l: Math.max(0, Math.min(1, l)),
  };
}

/**
 * 将HSL颜色转换为RGB颜色空间
 * @param h 色相 (0-1)
 * @param s 饱和度 (0-1)
 * @param l 亮度 (0-1)
 * @returns RGB数组 [r, g, b]，每个分量为0-255
 */
export function HSL2RGB(
  h: number,
  s: number,
  l: number
): { r: number; g: number; b: number } {
  // 确保输入值在有效范围内
  h = Math.max(0, Math.min(1, h));
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));

  // 初始化RGB值
  let r = 0;
  let g = 0;
  let b = 0;

  // 如果饱和度为0，则颜色是灰色的
  if (s === 0) {
    r = g = b = l;
  } else {
    // 辅助函数，用于计算特定色相下的RGB值
    const hueToRgb = (p: number, q: number, t: number): number => {
      // 将t调整到0-1范围内
      if (t < 0) t += 1;
      if (t > 1) t -= 1;

      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  // 转换回0-255范围并确保值在有效范围内
  return {
    r: Math.max(0, Math.min(255, Math.round(r * 255))),
    g: Math.max(0, Math.min(255, Math.round(g * 255))),
    b: Math.max(0, Math.min(255, Math.round(b * 255))),
  };
}
