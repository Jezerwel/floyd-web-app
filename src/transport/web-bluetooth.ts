import {
  FLOYD_BLE_COMMAND,
  FLOYD_BLE_FEEDLOG,
  FLOYD_BLE_NOTIFICATION_CHARACTERISTICS,
  FLOYD_BLE_RESPONSE,
  FLOYD_BLE_SCHEDULES,
  FLOYD_BLE_SERVICE,
  FLOYD_BLE_STATUS,
  FLOYD_BLE_TELEMETRY,
  FLOYD_BLE_TIME,
  FLOYD_DEVICE_NAME_PREFIX,
  chipIdFromDeviceName,
  decodeScheduleChunk,
  decodeUtf8Json,
  encodeScheduleChunks,
  encodeTimeSync,
  isScheduleShape,
  joinScheduleChunks,
  parseDeviceMessage,
} from "@/protocol";
import type {
  CommandEnvelope,
  DeviceMessage,
  Schedule,
  ScheduleChunk,
} from "@/protocol";
import { normalizeTransportError, TransportError } from "./errors";
import type {
  BluetoothApiLike,
  BluetoothCharacteristicLike,
  BluetoothDeviceLike,
  BluetoothRequestDeviceOptions,
  FeederTransport,
  ConnectOptions,
  TransportSupport,
} from "./transport";

const CHARACTERISTIC_UUIDS = [
  FLOYD_BLE_COMMAND,
  FLOYD_BLE_RESPONSE,
  FLOYD_BLE_TELEMETRY,
  FLOYD_BLE_STATUS,
  FLOYD_BLE_SCHEDULES,
  FLOYD_BLE_TIME,
  FLOYD_BLE_FEEDLOG,
] as const;

type CharacteristicUuid = (typeof CHARACTERISTIC_UUIDS)[number];

type Listener<T> = (value: T) => void;
const SCHEDULE_CONFIRMATION_TIMEOUT_MS = 5_000;

export interface WebBluetoothTransportOptions {
  bluetooth?: BluetoothApiLike;
  secureContext?: boolean;
}

function browserBluetooth(): BluetoothApiLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  const candidate = (navigator as Navigator & { bluetooth?: BluetoothApiLike }).bluetooth;
  return candidate;
}

function browserSecureContext(): boolean {
  return typeof window === "undefined" || window.isSecureContext;
}

function supportFor(
  bluetooth: BluetoothApiLike | undefined,
  secureContext: boolean,
): TransportSupport {
  if (!bluetooth) {
    return {
      available: false,
      code: "unsupported",
      reason: "This browser does not support Web Bluetooth.",
    };
  }
  if (!secureContext) {
    return {
      available: false,
      code: "insecure_context",
      reason: "Bluetooth requires a secure HTTPS or localhost connection.",
    };
  }
  return { available: true };
}

function eventListener(listener: (event: Event) => void): EventListener {
  return listener;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export class WebBluetoothTransport implements FeederTransport {
  readonly kind = "bluetooth" as const;
  readonly support: TransportSupport;
  deviceName: string | null = null;
  chipId: string | null = null;

  private readonly bluetooth: BluetoothApiLike | undefined;
  private readonly messages = new Set<Listener<DeviceMessage>>();
  private readonly disconnects = new Set<Listener<string | null>>();
  private readonly characteristicListeners = new Map<
    BluetoothCharacteristicLike,
    EventListener
  >();
  private characteristics: Partial<Record<CharacteristicUuid, BluetoothCharacteristicLike>> = {};
  private device: BluetoothDeviceLike | null = null;
  private manuallyDisconnecting = false;
  private finishScheduleWrite: Listener<TransportError | null> | null = null;

  constructor(options: WebBluetoothTransportOptions = {}) {
    this.bluetooth = options.bluetooth ?? browserBluetooth();
    const secureContext = options.secureContext ?? browserSecureContext();
    this.support = supportFor(this.bluetooth, secureContext);
  }

  async connect(options: ConnectOptions = {}): Promise<void> {
    this.requireSupport();
    const preserveDevice = options.requestDevice === false;
    await this.clearConnection(false, preserveDevice);

    try {
      const device = await this.selectDevice(options);
      const gatt = device.gatt;
      if (!gatt) {
        throw new TransportError("connection_failed", "The selected device has no GATT server.");
      }
      this.device = device;
      const server = gatt.connect ? await gatt.connect() : gatt;
      const service = await server.getPrimaryService(FLOYD_BLE_SERVICE);
      const characteristics: Partial<Record<CharacteristicUuid, BluetoothCharacteristicLike>> = {};
      for (const uuid of CHARACTERISTIC_UUIDS) {
        characteristics[uuid] = await service.getCharacteristic(uuid);
      }

      this.characteristics = characteristics;
      this.deviceName = device.name ?? null;
      this.chipId = chipIdFromDeviceName(this.deviceName);
      this.attachDeviceDisconnect(device);
      await this.attachNotifications();
    } catch (error) {
      await this.clearConnection(true, preserveDevice);
      throw normalizeTransportError(error);
    }
  }

  async disconnect(): Promise<void> {
    this.manuallyDisconnecting = true;
    try {
      await this.clearConnection(true);
    } finally {
      this.manuallyDisconnecting = false;
    }
  }

  onMessage(listener: Listener<DeviceMessage>): () => void {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }

  onDisconnect(listener: Listener<string | null>): () => void {
    this.disconnects.add(listener);
    return () => this.disconnects.delete(listener);
  }

  async sendCommand(payload: CommandEnvelope): Promise<void> {
    const characteristic = this.requireCharacteristic(FLOYD_BLE_COMMAND);
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      await characteristic.writeValueWithResponse(toArrayBuffer(bytes));
    } catch (error) {
      throw normalizeTransportError(error, "connection_failed");
    }
  }

  async syncTime(seconds: number, utcOffsetMinutes?: number): Promise<void> {
    const characteristic = this.requireCharacteristic(FLOYD_BLE_TIME);
    try {
      await characteristic.writeValueWithResponse(
        toArrayBuffer(encodeTimeSync(seconds, utcOffsetMinutes)),
      );
    } catch (error) {
      throw normalizeTransportError(error, "connection_failed");
    }
  }

  async readSchedules(): Promise<Schedule[]> {
    const characteristic = this.requireCharacteristic(FLOYD_BLE_SCHEDULES);
    try {
      const parsed = decodeUtf8Json(await readScheduleBytes(characteristic));
      if (!Array.isArray(parsed) || !parsed.every(isScheduleShape)) {
        throw new TransportError(
          "invalid_response",
          "The feeder returned an invalid schedule list.",
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError(
        "invalid_response",
        "The feeder returned an invalid schedule response.",
        { cause: error },
      );
    }
  }

  async writeSchedules(schedules: Schedule[]): Promise<void> {
    const characteristic = this.requireCharacteristic(FLOYD_BLE_SCHEDULES);
    const chunks = encodeScheduleChunks(schedules);
    if (this.finishScheduleWrite) {
      throw new TransportError("command_failed", "A schedule save is already in progress.");
    }
    let finish!: Listener<TransportError | null>;
    const confirmation = new Promise<TransportError | null>((resolve) => { finish = resolve; });
    this.finishScheduleWrite = finish;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      for (const chunk of chunks) {
        if (this.finishScheduleWrite !== finish) {
          throw new TransportError("not_connected", "Connection lost while saving schedules.");
        }
        await characteristic.writeValueWithResponse(toArrayBuffer(chunk));
      }
      timeout = setTimeout(
        () => finish(new TransportError("timeout", "The feeder did not confirm the schedule save.")),
        SCHEDULE_CONFIRMATION_TIMEOUT_MS,
      );
      const error = await confirmation;
      if (error) throw error;
      if (this.finishScheduleWrite !== finish) {
        throw new TransportError("not_connected", "Connection lost while saving schedules.");
      }
      // A confirmation from a timed-out upload can arrive during a later upload.
      const saved = await this.readSchedules();
      if (JSON.stringify(saved) !== JSON.stringify(schedules)) {
        throw new TransportError("invalid_response", "The feeder's saved schedule list differs from this edit.");
      }
    } catch (error) {
      throw normalizeTransportError(error, "connection_failed");
    } finally {
      clearTimeout(timeout);
      if (this.finishScheduleWrite === finish) this.finishScheduleWrite = null;
    }
  }

  private requireSupport(): void {
    if (!this.support.available) {
      throw new TransportError(
        this.support.code ?? "unsupported",
        this.support.reason ?? "Bluetooth is unavailable.",
      );
    }
  }

  private requireCharacteristic(uuid: CharacteristicUuid): BluetoothCharacteristicLike {
    const characteristic = this.characteristics[uuid];
    if (!characteristic) {
      throw new TransportError("not_connected", "The feeder is not connected.");
    }
    return characteristic;
  }

  private async selectDevice(options: ConnectOptions): Promise<BluetoothDeviceLike> {
    if (options.requestDevice !== false) {
      const requestOptions: BluetoothRequestDeviceOptions = {
        filters: [{ namePrefix: FLOYD_DEVICE_NAME_PREFIX, services: [FLOYD_BLE_SERVICE] }],
        optionalServices: [FLOYD_BLE_SERVICE],
      };
      try {
        return await this.bluetooth!.requestDevice(requestOptions);
      } catch (error) {
        throw normalizeTransportError(error);
      }
    }

    const candidates: BluetoothDeviceLike[] = [];
    if (this.device) candidates.push(this.device);
    if (this.bluetooth?.getDevices) {
      candidates.push(...(await this.bluetooth.getDevices()));
    }
    const expectedChipId = options.chipId?.toUpperCase();
    const match = candidates.find((candidate) => {
      const candidateChipId = chipIdFromDeviceName(candidate.name)?.toUpperCase();
      return expectedChipId ? candidateChipId === expectedChipId : candidateChipId !== null;
    });
    if (!match) {
      throw new TransportError(
        "no_devices",
        "No previously permitted Floyd feeder is available for reconnect.",
      );
    }
    return match;
  }

  private attachDeviceDisconnect(device: BluetoothDeviceLike): void {
    device.addEventListener("gattserverdisconnected", this.handleDeviceDisconnect);
  }

  private readonly handleDeviceDisconnect = (): void => {
    const shouldNotify = !this.manuallyDisconnecting;
    void this.clearConnection(false, true);
    if (shouldNotify) {
      for (const listener of this.disconnects) listener(null);
    }
  };

  private async attachNotifications(): Promise<void> {
    for (const uuid of FLOYD_BLE_NOTIFICATION_CHARACTERISTICS) {
      const characteristic = this.requireCharacteristic(uuid);
      const listener = eventListener(this.handleCharacteristicValue);
      characteristic.addEventListener("characteristicvaluechanged", listener);
      this.characteristicListeners.set(characteristic, listener);
      await characteristic.startNotifications();
    }
  }

  private readonly handleCharacteristicValue = (event: Event): void => {
    const characteristic = event.target as BluetoothCharacteristicLike | null;
    const value = characteristic?.value;
    if (!value) return;
    const message = parseDeviceMessage(value);
    if (!message) return;
    if (characteristic === this.characteristics[FLOYD_BLE_RESPONSE] &&
      !Array.isArray(message.data) && message.data.action === "set_schedules") {
      if (message.type === "control_response" && message.data.success === true) {
        this.finishScheduleWrite?.(null);
      } else if (message.type === "error" || message.type === "control_response") {
        const reason = typeof message.data.message === "string"
          ? message.data.message
          : "The feeder rejected the schedule save.";
        this.finishScheduleWrite?.(new TransportError("command_failed", reason));
      }
    }
    for (const listener of this.messages) listener(message);
  };

  private async clearConnection(disconnectGatt: boolean, preserveDevice = false): Promise<void> {
    this.finishScheduleWrite?.(new TransportError("not_connected", "Connection lost while saving schedules."));
    this.finishScheduleWrite = null;
    const device = this.device;
    if (device) {
      device.removeEventListener("gattserverdisconnected", this.handleDeviceDisconnect);
    }
    for (const [characteristic, listener] of this.characteristicListeners) {
      characteristic.removeEventListener("characteristicvaluechanged", listener);
    }
    this.characteristicListeners.clear();
    this.characteristics = {};
    if (!preserveDevice) this.device = null;
    if (disconnectGatt && device?.gatt?.connected) {
      try {
        await device.gatt.disconnect?.();
      } catch {
        // A manual disconnect is complete even when the browser rejects the GATT call.
      }
    }
  }
}

const SCHEDULE_PAGE_LIMIT = 64;

function dataViewBytes(value: DataView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * Each READ returns the next page (uint16 LE index, uint16 LE total, JSON bytes) because
 * a BLE attribute holds at most 512 bytes. Firmware that returns the raw JSON list
 * (first byte "[") is still accepted.
 */
async function readScheduleBytes(characteristic: BluetoothCharacteristicLike): Promise<Uint8Array> {
  const first = dataViewBytes(await characteristic.readValue());
  if (first[0] === 0x5b) return first;

  const pages: ScheduleChunk[] = [];
  let page = decodeScheduleChunk(first);
  for (let reads = 1; page && reads <= SCHEDULE_PAGE_LIMIT; reads += 1) {
    if (page.index === pages.length && (pages.length === 0 || page.total === pages[0].total)) {
      pages.push(page);
      if (pages.length === page.total) return joinScheduleChunks(pages);
    } else if (page.index === 0) {
      pages.splice(0, pages.length, page);
      if (page.total === 1) return joinScheduleChunks(pages);
    } else {
      // Out-of-order page: wait for the firmware cursor to wrap to page 0.
      pages.length = 0;
    }
    page = decodeScheduleChunk(dataViewBytes(await characteristic.readValue()));
  }
  throw new TransportError("invalid_response", "The feeder returned an incomplete schedule list.");
}
