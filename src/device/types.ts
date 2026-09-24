/** A supported e-reader family. Volume-mounted vendors are detected by their
 * on-disk signatures; reMarkable never mounts and is reached over its USB web
 * interface instead (see remarkable.ts). */
export type DeviceKind = 'kindle' | 'kobo' | 'tolino' | 'remarkable';

export const DEVICE_DISPLAY_NAMES: Record<DeviceKind, string> = {
  kindle: 'Kindle',
  kobo: 'Kobo',
  tolino: 'tolino',
  remarkable: 'reMarkable',
};

export interface ConnectedDevice {
  kind: DeviceKind;
  name: string;
  /** Mounted volume root; null for reMarkable (network route). */
  volume: string | null;
}

export function deviceId(device: ConnectedDevice): string {
  return device.volume ?? device.kind;
}
