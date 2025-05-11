declare module "mixbox" {
  function lerp(
    rgb1: string,
    rgb2: string,
    t: number
  ): [number, number, number];

  export default {
    lerp,
  };
}
