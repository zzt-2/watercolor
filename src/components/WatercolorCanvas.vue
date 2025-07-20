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

      <div class="color-palette">
        <h3>调色盘</h3>
        
        <!-- 色相选择条 -->
        <div class="hue-selector">
          <div 
            class="hue-bar" 
            @click="onHueClick"
            @mousedown="startHueDrag"
            ref="hueBar"
          >
            <div 
              class="hue-indicator"
              :style="{ left: customColorHSL.h * 100 + '%' }"
            ></div>
          </div>
        </div>

        <!-- 饱和度-亮度选择区域 -->
        <div class="saturation-lightness-area">
          <div 
            class="sl-canvas"
            @click="onSLClick"
            @mousedown="startSLDrag"
            ref="slCanvas"
            :style="{ backgroundColor: `hsl(${customColorHSL.h * 360}, 100%, 50%)` }"
          >
            <div class="sl-overlay-white"></div>
            <div class="sl-overlay-black"></div>
            <div 
              class="sl-indicator"
              :style="{ 
                left: customColorHSL.s * 100 + '%',
                top: (1 - customColorHSL.l) * 100 + '%'
              }"
            ></div>
          </div>
        </div>

        <!-- 颜色预览和RGB值 -->
        <div class="color-preview-section">
          <div
            class="color-preview"
            :style="{
              backgroundColor: `rgb(${customColor.r},${customColor.g},${customColor.b})`,
            }"
          ></div>
          <div class="color-values">
            RGB({{ customColor.r }}, {{ customColor.g }}, {{ customColor.b }})
          </div>
          
          <!-- RGB输入框 -->
          <div class="rgb-inputs">
            <div class="rgb-input-group">
              <label>R:</label>
              <input 
                type="number" 
                min="0" 
                max="255" 
                v-model.number="customColor.r"
                @input="updateCustomColorFromRGB"
                class="rgb-input"
              />
            </div>
            <div class="rgb-input-group">
              <label>G:</label>
              <input 
                type="number" 
                min="0" 
                max="255" 
                v-model.number="customColor.g"
                @input="updateCustomColorFromRGB"
                class="rgb-input"
              />
            </div>
            <div class="rgb-input-group">
              <label>B:</label>
              <input 
                type="number" 
                min="0" 
                max="255" 
                v-model.number="customColor.b"
                @input="updateCustomColorFromRGB"
                class="rgb-input"
              />
            </div>
          </div>
          
          <button @click="applyCustomColor" class="apply-btn">应用颜色</button>
        </div>
      </div>

      <div class="brush-controls">
        <div class="brush-size">
          <h3>笔刷大小</h3>
          <div class="size-control">
            <span class="size-value">{{ brushSize }}</span>
            <input type="range" min="1" max="30" v-model.number="brushSize" />
          </div>
        </div>

        <div class="blend-ratio">
          <h3>融合比例</h3>
          <div class="size-control">
            <span class="size-value">{{ Math.round(blendRatio * 100) }}%</span>
            <input type="range" min="0" max="1" step="0.01" v-model.number="blendRatio" />
          </div>
        </div>

        <div class="pigment-concentration">
          <h3>颜料浓度</h3>
          <div class="size-control">
            <span class="size-value">{{ Math.round(pigmentConcentration * 100) }}%</span>
            <input type="range" min="0" max="1" step="0.01" v-model.number="pigmentConcentration" />
          </div>
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

const canvas = ref<CanvasData>({ width: 1200, height: 800 });
const pixiCanvas: Ref<HTMLCanvasElement | null> = ref(null);

// 水彩引擎实例
let watercolorEngine: WatercolorEngine | null = null;

// 自定义颜色（RGB格式）
const customColor = reactive({
  r: 74,
  g: 144,
  b: 226,
});

// 自定义颜色的HSL表示
const customColorHSL = reactive({
  h: 0.6,
  s: 0.7,
  l: 0.6,
});

// 调色盘交互状态
const isDraggingHue = ref(false);
const isDraggingSL = ref(false);
const hueBar = ref<HTMLElement | null>(null);
const slCanvas = ref<HTMLElement | null>(null);

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
      
      // 添加全局鼠标事件监听器
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);

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

// 可用颜色集合 - 提升亮度
const availableColors = reactive<ColorOption[]>([
  { name: "蓝色", rgb: [74, 144, 226] },
  { name: "红色", rgb: [231, 76, 60] },
  { name: "绿色", rgb: [46, 204, 113] },
  { name: "紫色", rgb: [155, 89, 182] },
  { name: "黄色", rgb: [241, 196, 15] },
  { name: "橙色", rgb: [230, 126, 34] },
  { name: "白色", rgb: [255, 255, 255] },
  { name: "深灰", rgb: [44, 62, 80] },
]);

// 当前选中的颜色
const selectedColor = reactive<ColorOption>(availableColors[0]);

// 笔刷大小
const brushSize = ref(10);

// 融合比例
const blendRatio = ref(0.5);

// 颜料浓度
const pigmentConcentration = ref(1);

// 色相选择交互
function onHueClick(event: MouseEvent) {
  if (!hueBar.value) return;
  const rect = hueBar.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const hue = Math.max(0, Math.min(1, x / rect.width));
  customColorHSL.h = hue;
  updateCustomColorFromHSL();
}

function startHueDrag(event: MouseEvent) {
  isDraggingHue.value = true;
  onHueClick(event);
}

// 饱和度-亮度选择交互
function onSLClick(event: MouseEvent) {
  if (!slCanvas.value) return;
  const rect = slCanvas.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const saturation = Math.max(0, Math.min(1, x / rect.width));
  const lightness = Math.max(0, Math.min(1, 1 - (y / rect.height)));
  customColorHSL.s = saturation;
  customColorHSL.l = lightness;
  updateCustomColorFromHSL();
}

function startSLDrag(event: MouseEvent) {
  isDraggingSL.value = true;
  onSLClick(event);
}

// 全局鼠标事件处理
function onMouseMove(event: MouseEvent) {
  if (isDraggingHue.value) {
    onHueClick(event);
  } else if (isDraggingSL.value) {
    onSLClick(event);
  }
}

function onMouseUp() {
  isDraggingHue.value = false;
  isDraggingSL.value = false;
}

// 选择颜色
function selectColor(color: ColorOption) {
  // 更新选中颜色，无论是否相同，确保能始终触发画笔颜色更新
  selectedColor.name = color.name;
  selectedColor.rgb = [...color.rgb];

  // 更新引擎
  if (watercolorEngine) {
    watercolorEngine.setBrushColor(color.rgb);
  }
  
  // 同步到自定义颜色
  customColor.r = color.rgb[0];
  customColor.g = color.rgb[1];
  customColor.b = color.rgb[2];
  
  // 更新HSL值
  const hsl = RGB2HSL(customColor.r, customColor.g, customColor.b);
  customColorHSL.h = hsl.h;
  customColorHSL.s = hsl.s;
  customColorHSL.l = hsl.l;
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
  document.removeEventListener("mousemove", onMouseMove);
  document.removeEventListener("mouseup", onMouseUp);
});

// 监听参数变化并更新引擎
watch(brushSize, (newSize: number) => {
  if (watercolorEngine) {
    watercolorEngine.setBrushSize(newSize);
  }
});

watch(blendRatio, (newRatio: number) => {
  if (watercolorEngine) {
    watercolorEngine.setBlendRatio(newRatio);
  }
});


watch(pigmentConcentration, (newConcentration: number) => {
  if (watercolorEngine) {
    watercolorEngine.setPigmentConcentration(newConcentration);
  }
});

// 从HSL更新RGB颜色
function updateCustomColorFromHSL() {
  // 将HSL转换为RGB
  const rgb = HSL2RGB(customColorHSL.h, customColorHSL.s, customColorHSL.l);
  customColor.r = rgb.r;
  customColor.g = rgb.g;
  customColor.b = rgb.b;
}

// 从RGB更新HSL颜色
function updateCustomColorFromRGB() {
  // 确保RGB值在有效范围内
  customColor.r = Math.max(0, Math.min(255, customColor.r || 0));
  customColor.g = Math.max(0, Math.min(255, customColor.g || 0));
  customColor.b = Math.max(0, Math.min(255, customColor.b || 0));
  
  // 将RGB转换为HSL
  const hsl = RGB2HSL(customColor.r, customColor.g, customColor.b);
  customColorHSL.h = hsl.h;
  customColorHSL.s = hsl.s;
  customColorHSL.l = hsl.l;
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
  max-width: 1200px;
  height: 800px;
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
  padding: 16px;
  background-color: #252525;
  border-left: 1px solid #333;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100vh;
}

h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 500;
  color: #ccc;
  border-bottom: 1px solid #444;
  padding-bottom: 6px;
}

.color-picker {
  display: flex;
  flex-direction: column;
}

.color-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.color-swatch {
  width: 32px;
  height: 32px;
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

.color-palette {
  padding: 12px;
  background-color: #2c2c2c;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hue-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hue-bar {
  height: 20px;
  border-radius: 10px;
  background: linear-gradient(to right, 
    hsl(0, 100%, 50%), 
    hsl(60, 100%, 50%), 
    hsl(120, 100%, 50%), 
    hsl(180, 100%, 50%), 
    hsl(240, 100%, 50%), 
    hsl(300, 100%, 50%), 
    hsl(360, 100%, 50%)
  );
  position: relative;
  cursor: pointer;
  border: 1px solid #444;
}

.hue-indicator {
  position: absolute;
  top: -2px;
  width: 4px;
  height: 24px;
  background-color: white;
  border: 1px solid #333;
  border-radius: 2px;
  transform: translateX(-50%);
  pointer-events: none;
}

.saturation-lightness-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sl-canvas {
  width: 100%;
  height: 120px;
  position: relative;
  cursor: crosshair;
  border-radius: 4px;
  border: 1px solid #444;
}

.sl-overlay-white {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(to right, white, transparent);
  border-radius: 3px;
}

.sl-overlay-black {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(to bottom, transparent, black);
  border-radius: 3px;
}

.sl-indicator {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid white;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.5);
}

.color-preview-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.color-preview {
  width: 100%;
  height: 32px;
  border-radius: 4px;
  border: 2px solid #444;
}

.color-values {
  font-size: 12px;
  text-align: center;
  color: #aaa;
}

.rgb-inputs {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.rgb-input-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1;
}

.rgb-input-group label {
  font-size: 12px;
  color: #aaa;
  font-weight: 500;
}

.rgb-input {
  width: 100%;
  height: 28px;
  padding: 4px 6px;
  border: 1px solid #444;
  border-radius: 4px;
  background-color: #333;
  color: white;
  font-size: 12px;
  text-align: center;
  transition: border-color 0.2s;
}

.rgb-input:focus {
  outline: none;
  border-color: #27ae60;
}

.rgb-input:hover {
  border-color: #555;
}

.apply-btn {
  background-color: #27ae60;
  border: none;
  border-radius: 4px;
  color: white;
  padding: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
  font-size: 12px;
}

.apply-btn:hover {
  background-color: #2ecc71;
}

.brush-size {
  padding: 12px;
  background-color: #2c2c2c;
  border-radius: 8px;
}

.size-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.size-value {
  font-size: 16px;
  font-weight: bold;
  text-align: center;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.action-btn {
  flex: 1;
  padding: 8px 12px;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
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
    height: auto;
  }
}
</style>
