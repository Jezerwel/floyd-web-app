import type { DeviceMessage, Schedule, CommandEnvelope } from "@/protocol";
import type { TransportErrorCode } from "./errors";

export type TransportKind = "bluetooth" | "wifi";

export interface TransportSupport {
  available: boolean;
  code?: Extract<TransportErrorCode, "unsupported" | "insecure_context">;
  reason?: string;
}

export interface ConnectOptions {
  requestDevice?: boolean;
  chipId?: string | null;
}

export interface FeederTransport {
  readonly kind: TransportKind;
  readonly support: TransportSupport;
  readonly deviceName: string | null;
  readonly chipId: string | null;
  connect(options?: ConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(listener: (message: DeviceMessage) => void): () => void;
  onDisconnect(listener: (reason: string | null) => void): () => void;
  sendCommand(payload: CommandEnvelope): Promise<void>;
  syncTime(seconds: number): Promise<void>;
  readSchedules(): Promise<Schedule[]>;
  writeSchedules(schedules: Schedule[]): Promise<void>;
}

export interface BluetoothRequestFilter {
  namePrefix?: string;
  services?: string[];
}

export interface BluetoothRequestDeviceOptions {
  filters: BluetoothRequestFilter[];
  optionalServices: string[];
}

export interface BluetoothCharacteristicLike {
  readonly uuid?: string;
  readonly value?: DataView | null;
  startNotifications(): Promise<BluetoothCharacteristicLike>;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  readValue(): Promise<DataView>;
}

export interface BluetoothServiceLike {
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristicLike>;
}

export interface BluetoothRemoteGATTServerLike {
  readonly connected: boolean;
  connect?: () => Promise<BluetoothRemoteGATTServerLike>;
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
}

export interface BluetoothDeviceLike {
  readonly id?: string;
  readonly name?: string | null;
  readonly gatt?: BluetoothRemoteGATTServerLike;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

export interface BluetoothApiLike {
  requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDeviceLike>;
  getDevices?: () => Promise<BluetoothDeviceLike[]>;
}
