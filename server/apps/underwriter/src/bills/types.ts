export type Cadence = "monthly" | "weekly";

export interface Bill {
  id: number;
  name: string;
  merchantId: string;
  mcc: string;
  amountMicro: bigint;
  cadence: Cadence;
  /** 1..28 for monthly, 0..6 for weekly (0 = Sunday). */
  dueDay: number;
  /** Lower funds first. */
  priority: number;
  /** Headroom over the bill amount, in basis points. Utilities vary. */
  toleranceBps: number;
  active: boolean;
}

export type NewBill = Omit<Bill, "id" | "active">;
