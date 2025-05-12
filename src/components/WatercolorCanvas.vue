<template>
  <div class="watercolor-app-container">
    <div class="canvas-area">
      <div ref="pixiCanvas" class="canvas-wrapper"></div>
    </div>
    <div class="controls-panel">
      <div class="color-picker">
        <h3>预设颜色</h3>
        <div class="color-swatches">
          <div
            v-for="color in availableColors"
            :key="color.name"
            :style="{ backgroundColor: `rgb(${color.rgb.join(',')})` }"
            class="color-swatch"
            :class="{ active: selectedColor.name === color.name }"
            @click="selectColor(color)"
            :title="color.name"
          ></div>
        </div>
      </div>

      <div class="color-adjust">
        <h3>颜色调节</h3>
        <div class="mode-toggle">
          <button
            @click="colorMode = 'rgb'"
            :class="{ active: colorMode === 'rgb' }"
          >
            RGB
          </button>
          <button
            @click="colorMode = 'hsl'"
            :class="{ active: colorMode === 'hsl' }"
          >
            HSL
          </button>
        </div>

        <div v-if="colorMode === 'rgb'" class="sliders">
          <div class="slider-group">
            <label>R: {{ customColor.r }}</label>
            <input
              type="range"
              min="0"
              max="255"
              v-model.number="customColor.r"
              @input="updateCustomColor"
            />
          </div>
          <div class="slider-group">
            <label>G: {{ customColor.g }}</label>
            <input
              type="range"
              min="0"
              max="255"
              v-model.number="customColor.g"
              @input="updateCustomColor"
            />
          </div>
          <div class="slider-group">
            <label>B: {{ customColor.b }}</label>
            <input
              type="range"
              min="0"
              max="255"
              v-model.number="customColor.b"
              @input="updateCustomColor"
            />
          </div>
        </div>

        <div v-else class="sliders">
          <div class="slider-group">
            <label>H: {{ Math.round(customColorHSL.h * 360) }}°</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              v-model.number="customColorHSL.h"
              @input="updateCustomColorFromHSL"
            />
          </div>
          <div class="slider-group">
            <label>S: {{ Math.round(customColorHSL.s * 100) }}%</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              v-model.number="customColorHSL.s"
              @input="updateCustomColorFromHSL"
            />
          </div>
          <div class="slider-group">
            <label>L: {{ Math.round(customColorHSL.l * 100) }}%</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              v-model.number="customColorHSL.l"
              @input="updateCustomColorFromHSL"
            />
          </div>
        </div>

        <div
          class="color-preview"
          :style="{
            backgroundColor: `rgb(${customColor.r},${customColor.g},${customColor.b})`,
          }"
        ></div>
        <button @click="applyCustomColor" class="apply-btn">应用颜色</button>
      </div>

      <div class="brush-size">
        <h3>笔刷大小</h3>
        <div class="size-control">
          <span class="size-value">{{ brushSize }}</span>
          <input type="range" min="5" max="30" v-model.number="brushSize" />
        </div>
      </div>

      <div class="actions">
        <button @click="clearCanvas" class="action-btn clear-btn">
          清除画布
        </button>
        <button @click="saveImage" class="action-btn save-btn">保存图片</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  reactive,
  Ref,
  watch,
  computed,
} from "vue";
import { WatercolorEngine } from "../composables/watercolorEngine";
import { RGB2HSL, HSL2RGB } from "../Utils/colorConvert";

// 画布尺寸和数据结构
interface CanvasData {
  width: number;
  height: number;
}

const canvas = ref<CanvasData>({ width: 960, height: 540 });
const pixiCanvas: Ref<HTMLCanvasElement | null> = ref(null);

// 水彩引擎实例
let watercolorEngine: WatercolorEngine | null = null;

// 颜色模式选择（RGB或HSL）
const colorMode = ref<"rgb" | "hsl">("rgb");

// 自定义颜色（RGB格式）
const customColor = reactive({
  r: 41,
  g: 128,
  b: 185,
});

// 自定义颜色的HSL表示
const customColorHSL = reactive({
  h: 0,
  s: 0,
  l: 0,
});

// 初始化p5和渲染器
onMounted(() => {
  if (pixiCanvas.value) {
    // 延迟执行以确保画布尺寸正确
    setTimeout(() => {
      // 创建水彩引擎
      watercolorEngine = new WatercolorEngine(
        pixiCanvas.value!,
        canvas.value.width,
        canvas.value.height
      );
      watercolorEngine.setBrushColor(availableColors[0].rgb);
      watercolorEngine.setBrushSize(brushSize.value);

      // 添加窗口大小调整事件监听器
      window.addEventListener("resize", handleResize);

      // 初始化HSL值
      const hsl = RGB2HSL(customColor.r, customColor.g, customColor.b);
      customColorHSL.h = hsl.h;
      customColorHSL.s = hsl.s;
      customColorHSL.l = hsl.l;
    }, 100);
  }
});

// 定义颜色选项
interface ColorOption {
  name: string;
  rgb: [number, number, number];
}

// 可用颜色集合
const availableColors = reactive<ColorOption[]>([
  { name: "蓝色", rgb: [41, 128, 185] },
  { name: "红色", rgb: [192, 57, 43] },
  { name: "绿色", rgb: [39, 174, 96] },
  { name: "紫色", rgb: [142, 68, 173] },
  { name: "黄色", rgb: [241, 196, 15] },
  { name: "白色", rgb: [255, 255, 255] },
  { name: "黑色", rgb: [0, 0, 0] },
]);

// 当前选中的颜色
const selectedColor = reactive<ColorOption>(availableColors[0]);

// 笔刷大小
const brushSize = ref(10);

// 选择颜色
function selectColor(color: ColorOption) {
  // 更新选中颜色，无论是否相同，确保能始终触发画笔颜色更新
  selectedColor.name = color.name;
  selectedColor.rgb = [...color.rgb];

  // 更新引擎
  if (watercolorEngine) {
    watercolorEngine.setBrushColor(color.rgb);
  }
}

function handleResize() {
  if (watercolorEngine) {
    watercolorEngine.resizeCanvas();
  }
}

// 清除画布
function clearCanvas() {
  if (watercolorEngine) {
    watercolorEngine.clearCanvas();
  }
}

// 保存图片
function saveImage() {
  if (watercolorEngine) {
    watercolorEngine.saveImage("我的水彩画");
  }
}

// 组件卸载时清理
onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
});

// 监听参数变化并更新引擎
watch(brushSize, (newSize: number) => {
  if (watercolorEngine) {
    watercolorEngine.setBrushSize(newSize);
  }
});

// 更新自定义RGB颜色
function updateCustomColor() {
  // 更新HSL值以保持同步
  const hsl = RGB2HSL(customColor.r, customColor.g, customColor.b);
  customColorHSL.h = hsl.h;
  customColorHSL.s = hsl.s;
  customColorHSL.l = hsl.l;
}

// 从HSL更新RGB颜色
function updateCustomColorFromHSL() {
  // 将HSL转换为RGB
  const rgb = HSL2RGB(customColorHSL.h, customColorHSL.s, customColorHSL.l);
  customColor.r = rgb.r;
  customColor.g = rgb.g;
  customColor.b = rgb.b;
}

// 应用自定义颜色
function applyCustomColor() {
  // 创建一个新的颜色选项
  const newColor: ColorOption = {
    name: "自定义",
    rgb: [customColor.r, customColor.g, customColor.b],
  };

  // 直接设置到引擎
  if (watercolorEngine) {
    watercolorEngine.setBrushColor([
      customColor.r,
      customColor.g,
      customColor.b,
    ]);
  }

  // 更新选中颜色状态
  selectedColor.name = newColor.name;
  selectedColor.rgb = [...newColor.rgb];
}
</script>

<style scoped>
.watercolor-app-container {
  display: flex;
  height: 100vh;
  background-color: #1e1e1e;
  color: white;
}

.canvas-area {
  flex: 3;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  min-width: 0; /* 防止flex子元素溢出 */
}

.canvas-wrapper {
  width: 100%;
  max-width: 960px;
  height: 540px;
  border: 1px solid #444;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  background-color: #fff;
}

.controls-panel {
  flex: 1;
  min-width: 280px;
  max-width: 320px;
  padding: 20px;
  background-color: #252525;
  border-left: 1px solid #333;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  font-weight: 500;
  color: #ccc;
  border-bottom: 1px solid #444;
  padding-bottom: 8px;
}

.color-picker {
  display: flex;
  flex-direction: column;
}

.color-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.color-swatch {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid #444;
  transition: all 0.2s;
}

.color-swatch:hover {
  transform: scale(1.05);
}

.color-swatch.active {
  border-color: #fff;
  transform: scale(1.1);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
}

.color-adjust {
  padding: 16px;
  background-color: #2c2c2c;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mode-toggle {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.mode-toggle button {
  flex: 1;
  padding: 6px 12px;
  background-color: #444;
  opacity: 0.7;
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  font-size: 14px;
}

.mode-toggle button.active {
  background-color: #3498db;
  opacity: 1;
}

.sliders {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slider-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.slider-group label {
  font-size: 14px;
  display: flex;
  justify-content: space-between;
}

.color-preview {
  width: 100%;
  height: 40px;
  border-radius: 4px;
  margin-top: 8px;
  border: 2px solid #444;
}

.apply-btn {
  margin-top: 8px;
  background-color: #27ae60;
  border: none;
  border-radius: 4px;
  color: white;
  padding: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.apply-btn:hover {
  background-color: #2ecc71;
}

.brush-size {
  padding: 16px;
  background-color: #2c2c2c;
  border-radius: 8px;
}

.size-control {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.size-value {
  font-size: 18px;
  font-weight: bold;
  text-align: center;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: auto;
}

.action-btn {
  flex: 1;
  padding: 10px 16px;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 15px;
}

.clear-btn {
  background-color: #c0392b;
}

.clear-btn:hover {
  background-color: #e74c3c;
}

.save-btn {
  background-color: #2980b9;
}

.save-btn:hover {
  background-color: #3498db;
}

@media (max-width: 900px) {
  .watercolor-app-container {
    flex-direction: column;
    height: auto;
  }

  .controls-panel {
    max-width: none;
    width: 100%;
    border-left: none;
    border-top: 1px solid #333;
  }
}
</style>
