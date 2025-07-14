// PERF_TIMER - 简单的性能计时工具，方便后期删除
// 使用方法：
// const timer = startTimer('functionName');
// // ... 代码执行 ...
// endTimer(timer);

interface Timer {
  name: string;
  startTime: number;
}

/**
 * 开始计时
 * @param name 计时名称
 * @returns Timer对象
 */
export function startTimer(name: string): Timer {
  return {
    name,
    startTime: performance.now()
  };
}

/**
 * 结束计时并输出结果
 * @param timer Timer对象
 */
export function endTimer(timer: Timer): void {
  const endTime = performance.now();
  const duration = endTime - timer.startTime;
  console.log(`[PERF] ${timer.name}: ${duration.toFixed(2)}ms`);
} 