import { invokeNative } from './native/transport.ts';

/** The device type and runtime a project's task Simulators are created from. */
export interface SimulatorBase {
  deviceType: string;
  runtime: string;
}

interface SimulatorRuntime {
  identifier: string;
  name: string;
  version: string;
  platform: string;
  /** Device type identifiers this runtime runs. */
  deviceTypes: string[];
}

interface SimulatorDeviceType {
  identifier: string;
  name: string;
  family: string;
}

export interface SimulatorCatalog {
  /** Why Simulators are unavailable here, such as no full Xcode. */
  issue: string | null;
  runtimes: SimulatorRuntime[];
  deviceTypes: SimulatorDeviceType[];
  default: SimulatorBase | null;
  /** Whether the project is an Xcode project that targets iOS. */
  iosProject: boolean;
}

export const simulatorCatalog = (path: string) =>
  invokeNative<SimulatorCatalog>('simulator_catalog', { path });
