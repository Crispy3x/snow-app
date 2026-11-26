import { Inngest } from "inngest";

/**
 * Background jobs run on Inngest (see docs/PLAN.md §2 for why).
 * Event names used across the app are listed here so senders and handlers agree.
 */
export const inngest = new Inngest({ id: "marginpilot" });

export const EVENTS = {
  bulkJobCreated: "listings/bulk.created", // { jobId }
  storeConnected: "ebay/store.connected", // { storeId }
  storeSyncRequested: "ebay/store.sync", // { storeId }
  monitorStore: "monitor/store.check", // { storeId }
  ordersSync: "orders/store.sync", // { storeId }
  cleanupStore: "cleanup/store.scan", // { storeId }
  ebayAccountDeleted: "ebay/account.deleted", // { ebayUserId, notificationId }
  auditRequested: "ai/audit.requested", // { storeId, requestedBy }
} as const;
