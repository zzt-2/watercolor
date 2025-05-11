<template>
  <div class="app-container">
    <!-- <header class="app-header">
      <h1>水彩画模拟器</h1>
    </header> -->

    <main class="app-content">
      <WatercolorCanvas class="canvas-container" />
    </main>

    <!-- <footer class="app-footer">
      <p>水彩物理模拟 &copy; {{ new Date().getFullYear() }}</p>
    </footer> -->
  </div>
</template>

<script setup lang="ts">
import WatercolorCanvas from "./components/WatercolorCanvas.vue";
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  font-family: "Arial", sans-serif;
  background-color: #1e1e1e;
  color: white;
}

.app-header {
  background-color: #2d2d2d;
  padding: 1rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  text-align: center;
}

.app-header h1 {
  margin: 0;
  color: #fff;
  font-size: 1.8rem;
}

.app-content {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 0;
  background-color: #1e1e1e;
}

.canvas-container {
  width: 100%;
}

.app-footer {
  background-color: #2d2d2d;
  padding: 1rem;
  text-align: center;
  color: #aaa;
  font-size: 0.9rem;
}
</style>
