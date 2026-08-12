/** Mirrors the seller's catalogue keys. Buyers only need the identifiers. */
const SKUS = [
  "usb-c-cable-2m",
  "mech-keyboard-tkl",
  "noise-cancel-headphones",
  "webcam-1080p",
  "ssd-1tb-nvme",
  "monitor-27-4k",
  "desk-lamp-led",
  "laptop-stand-alu",
  "wireless-mouse",
  "hub-7port",
];

export function randomSku(): string {
  return SKUS[Math.floor(Math.random() * SKUS.length)]!;
}
