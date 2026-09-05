declare module "loudness" {
  export function getVolume(): Promise<number>;
  export function setVolume(value: number): Promise<void>;
  export function getMuted(): Promise<boolean>;
  export function setMuted(value: boolean): Promise<void>;
}
