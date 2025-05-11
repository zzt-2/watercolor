declare module "p5" {
  export default class p5 {
    constructor(sketch: (p: p5) => void, node?: HTMLElement | string);

    // p5实例属性
    width: number;
    height: number;
    mouseX: number;
    mouseY: number;

    // canvas方法
    createCanvas(width: number, height: number): p5.Renderer;
    resizeCanvas(width: number, height: number): void;
    background(color: number | string): void;
    pixelDensity(density: number): void;

    // 事件
    setup: () => void;
    draw: () => void;
    mousePressed: () => boolean | void;
    mouseDragged: () => boolean | void;
    mouseReleased: () => boolean | void;

    // 像素操作
    pixels: number[];
    loadPixels(): void;
    updatePixels(): void;

    // 其他方法
    save(filename: string): void;
    remove(): void;
  }

  namespace p5 {
    class Renderer {
      elt: HTMLCanvasElement;
      parent(node: HTMLElement | string): p5.Renderer;
    }
  }
}
