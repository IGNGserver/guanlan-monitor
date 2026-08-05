/**
 * Guanlan Spectrum Adaptive Renderer Integration Seam
 * Exports GuanlanApp and provides adapter bindings for Electron main/renderer entry.
 */

export { GuanlanApp } from "./GuanlanApp";
export { default } from "./GuanlanApp";
export { MockGuanlanDataAdapter } from "./services/mockAdapter";
export { BridgeGuanlanDataAdapter } from "./services/bridgeAdapter";
export type { IGuanlanDataAdapter } from "./services/adapter";
