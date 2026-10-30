export interface Engine {
  readonly name: "direct" | "opencode";
  start(): Promise<void>;
  stop(): Promise<void>;
}
