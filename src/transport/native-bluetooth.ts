import type { BleClient } from "@capacitor-community/bluetooth-le";
import { FLOYD_BLE_SERVICE, FLOYD_DEVICE_NAME_PREFIX } from "@/protocol";
import { TransportError } from "./errors";
import type {
  BluetoothApiLike,
  BluetoothCharacteristicLike,
  BluetoothDeviceLike,
  BluetoothRemoteGATTServerLike,
} from "./transport";

class NativeCharacteristic extends EventTarget implements BluetoothCharacteristicLike {
  value: DataView | null = null;

  constructor(
    private readonly client: typeof BleClient,
    private readonly deviceId: string,
    readonly uuid: string,
  ) {
    super();
  }

  async startNotifications(): Promise<this> {
    await this.client.startNotifications(this.deviceId, FLOYD_BLE_SERVICE, this.uuid, (value) => {
      this.value = value;
      this.dispatchEvent(new Event("characteristicvaluechanged"));
    });
    return this;
  }

  readValue(): Promise<DataView> {
    return this.client.read(this.deviceId, FLOYD_BLE_SERVICE, this.uuid);
  }

  writeValueWithResponse(value: BufferSource): Promise<void> {
    const bytes = value instanceof ArrayBuffer
      ? new DataView(value)
      : new DataView(value.buffer, value.byteOffset, value.byteLength);
    return this.client.write(this.deviceId, FLOYD_BLE_SERVICE, this.uuid, bytes, { timeout: 60_000 });
  }
}

class NativeDevice extends EventTarget implements BluetoothDeviceLike {
  readonly gatt: BluetoothRemoteGATTServerLike;

  constructor(client: typeof BleClient, readonly id: string, readonly name: string) {
    super();
    let connected = false;
    const onDisconnect = () => {
      connected = false;
      this.dispatchEvent(new Event("gattserverdisconnected"));
    };
    this.gatt = {
      get connected() { return connected; },
      async connect() {
        await client.connect(id, onDisconnect);
        connected = true;
        return this;
      },
      async disconnect() {
        try {
          await client.disconnect(id);
        } finally {
          connected = false;
        }
      },
      async getPrimaryService(uuid) {
        const service = (await client.getServices(id)).find((item) => item.uuid.toLowerCase() === uuid);
        if (!service) throw new TransportError("connection_failed", "The device does not expose the Floyd service.");
        return {
          async getCharacteristic(characteristicUuid) {
            if (!service.characteristics.some((item) => item.uuid.toLowerCase() === characteristicUuid)) {
              throw new TransportError("connection_failed", "The feeder firmware does not expose the required Bluetooth features.");
            }
            return new NativeCharacteristic(client, id, characteristicUuid);
          },
        };
      },
    };
  }
}

export const nativeBluetooth: BluetoothApiLike = {
  async requestDevice() {
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    await BleClient.initialize();
    const device = await BleClient.requestDevice({
      services: [FLOYD_BLE_SERVICE],
      namePrefix: FLOYD_DEVICE_NAME_PREFIX,
    }).catch((error: unknown) => {
      if (error instanceof Error && /cancelled/i.test(error.message)) {
        throw new TransportError("cancelled", "No feeder was selected.", { cause: error });
      }
      throw error;
    });
    if (!device.name?.startsWith(FLOYD_DEVICE_NAME_PREFIX)) {
      throw new TransportError("no_devices", "The selected Bluetooth device is not a Floyd feeder.");
    }
    return new NativeDevice(BleClient, device.deviceId, device.name);
  },
};
