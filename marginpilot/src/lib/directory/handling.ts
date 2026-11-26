/**
 * eBay handling-time hint. The store's handling time (store_rules.handling_days) is
 * what buyers are promised; if the supplier typically takes longer to ship, orders
 * will go out late and hurt the seller's late-shipment rate. Pure, unit tested.
 */

export type HandlingHint =
  | { level: "ok"; message: string }
  | { level: "warn"; message: string; shortBy: number }
  | { level: "unknown"; message: string };

const days = (n: number) => `${n} business ${n === 1 ? "day" : "days"}`;

export function handlingTimeHint(supplierHandlingDays: number | null, storeHandlingDays: number | null): HandlingHint {
  if (supplierHandlingDays === null || supplierHandlingDays === undefined) {
    return { level: "unknown", message: "This supplier's handling time isn't recorded. Ask them before listing so your eBay handling time is realistic." };
  }
  if (storeHandlingDays === null || storeHandlingDays === undefined) {
    return {
      level: "unknown",
      message: `This supplier usually ships within ${days(supplierHandlingDays)}. Connect a store and set its handling time in store rules to compare.`,
    };
  }
  if (supplierHandlingDays > storeHandlingDays) {
    const shortBy = supplierHandlingDays - storeHandlingDays;
    return {
      level: "warn",
      shortBy,
      message: `This supplier usually ships within ${days(supplierHandlingDays)}, but your store promises ${days(storeHandlingDays)}. Orders from them would ship late. Raise the handling time on these listings to at least ${days(supplierHandlingDays)}, or confirm faster handling with the supplier.`,
    };
  }
  return {
    level: "ok",
    message: `This supplier usually ships within ${days(supplierHandlingDays)}, inside your store's ${days(storeHandlingDays)} handling time.`,
  };
}
