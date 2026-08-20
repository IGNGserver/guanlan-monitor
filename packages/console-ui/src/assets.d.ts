type ConsoleImageSource = string | {
  src: string;
  width?: number;
  height?: number;
  blurDataURL?: string;
};

declare module "*.png" {
  const source: ConsoleImageSource;
  export default source;
}
