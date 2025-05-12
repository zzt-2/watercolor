import { createApp } from "vue";
import App from "./App.vue";
import "./styles/global.css";

// 创建 Vue 应用实例
const app = createApp(App);

// 挂载应用到 #app 元素
app.mount("#app");
