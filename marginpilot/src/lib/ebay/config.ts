/** eBay endpoints and OAuth scopes. Official REST APIs only. */

export const EBAY_ENV = (process.env.EBAY_ENV === "production" ? "production" : "sandbox") as "production" | "sandbox";

const HOSTS = {
  sandbox: {
    auth: "https://auth.sandbox.ebay.com",
    api: "https://api.sandbox.ebay.com",
    apiz: "https://apiz.sandbox.ebay.com",
  },
  production: {
    auth: "https://auth.ebay.com",
    api: "https://api.ebay.com",
    apiz: "https://apiz.ebay.com",
  },
} as const;

export const ebayHosts = HOSTS[EBAY_ENV];

/** Scopes requested at consent. Each maps to a feature in the spec. */
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory", // listings, offers, negotiation (offers to watchers)
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment", // orders, tracking
  "https://api.ebay.com/oauth/api_scope/sell.marketing", // sale events, promoted listings
  "https://api.ebay.com/oauth/api_scope/sell.account", // business policies, selling limits
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly", // traffic report (views)
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly", // eBay user id + username
  "https://api.ebay.com/oauth/api_scope/commerce.message", // buyer messages (drafts sent only after approval)
];

export function ebayConfigured(): boolean {
  return !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET && process.env.EBAY_RU_NAME);
}
