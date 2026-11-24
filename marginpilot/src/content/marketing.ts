import type { icons } from "@/components/ui/icons";

type IconName = keyof typeof icons;

export const HOW_IT_WORKS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "plug",
    title: "Connect your store",
    body: "Sign in with eBay through its official consent screen. We never see or store your eBay password, and you can connect more than one store.",
  },
  {
    icon: "layers",
    title: "Add products in bulk",
    body: "Paste supplier links or upload a CSV. The AI writer drafts titles, descriptions and item specifics, and the margin guard blocks anything that would sell below your floor.",
  },
  {
    icon: "eye",
    title: "Let it watch the store",
    body: "Scheduled checks reprice, mark items out of stock, queue new orders and end listings that aren't working. Every change lands in an activity log you can undo.",
  },
];

export const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "list",
    title: "Bulk AI lister",
    body: "Turn a list of supplier links or a CSV into eBay drafts in one pass. Review, edit, then publish all at once or one at a time.",
  },
  {
    icon: "shield",
    title: "Margin guard",
    body: "Every price is checked net of final value fee, per-order fee, ad rate, sale discount and supplier cost. Nothing publishes below the floor you set.",
  },
  {
    icon: "refresh",
    title: "Price and stock sync",
    body: "Scheduled rechecks of your wholesale supplier's price and stock. Choose per rule whether to propose a new price for your approval, set quantity to zero, or flag the listing.",
  },
  {
    icon: "truck",
    title: "Order queue and tracking",
    body: "New orders arrive in one queue with the supplier link and ship-to address. Add tracking and it posts back to eBay.",
  },
  {
    icon: "tag",
    title: "Sales, offers and ads",
    body: "Send offers to watchers at a margin you choose, run one sale event per listing, and set promoted listing rates by price tier.",
  },
  {
    icon: "broom",
    title: "Store cleanup",
    body: "End listings with no views or sales after a set number of days and queue replacements, so the store keeps moving.",
  },
];

export const AI_TOOLS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "pen",
    title: "Listing writer",
    body: "Title, description and item specifics from a supplier page, written for eBay search, with a VeRO and brand-name warning check.",
  },
  {
    icon: "type",
    title: "Title optimizer",
    body: "Rewrites existing titles and shows the before and after side by side, so you choose which to keep.",
  },
  {
    icon: "search",
    title: "Product research assistant",
    body: "Give it a niche or keyword. It summarizes demand signals and suggests products, and shows the sources it used.",
  },
  {
    icon: "calculator",
    title: "Pricing advisor",
    body: "Recommends a price from your cost, fees, margin floor and the competitor prices you enter.",
  },
  {
    icon: "image",
    title: "Image cleaner",
    body: "Finds and removes supplier promo banners, coupons and watermarks, and flags images it can't fix cleanly.",
  },
  {
    icon: "message",
    title: "Buyer message assistant",
    body: "Drafts replies to buyer messages for you to edit and approve. It never sends anything on its own.",
  },
  {
    icon: "clipboard",
    title: "Listing audit",
    body: "Scans a store and ranks listings to fix, reprice or end, with the reason for each.",
  },
  {
    icon: "chat",
    title: "Store assistant chat",
    body: "Ask about your own store data, like which listings are under 25% margin, or about anything in the course.",
  },
];

export const COURSE_MODULES: { title: string; body: string }[] = [
  {
    title: "Account setup and selling limits",
    body: "Set up the account, business policies and payments correctly, and understand how selling limits work and grow.",
  },
  {
    title: "Finding products that already sell",
    body: "Use sold data and demand signals to choose products with proven buyers instead of guessing.",
  },
  {
    title: "Suppliers and eBay's sourcing rules",
    body: "Pick reliable suppliers and stay inside eBay's sourcing and drop shipping policy.",
  },
  {
    title: "Pricing and margin math",
    body: "Work out fees, ad spend, discounts and returns so every price leaves the margin you planned.",
  },
  {
    title: "Listings that get found",
    body: "Titles, item specifics, photos and descriptions that match how buyers search on eBay.",
  },
  {
    title: "Orders, returns and scaling to more stores",
    body: "Fulfil on time, handle returns and cases, and add stores without losing control of the work.",
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this an official eBay product?",
    a: "No. We are an independent company and not affiliated with eBay Inc. We connect to your store only through eBay's official APIs, using the consent screen eBay provides.",
  },
  {
    q: "Do you need my eBay password?",
    a: "No. You sign in on eBay's own page and approve access. We receive an access token, which we encrypt at rest. You can revoke it from your eBay account at any time.",
  },
  {
    q: "Will this make me money?",
    a: "We can't promise that. The software and course help you run a store with less manual work and clearer margins, but sales depend on your products, prices, suppliers, service and the market.",
  },
  {
    q: "Does it follow eBay's drop shipping rules?",
    a: "The tools are built around eBay's policy, which allows you to use a wholesale supplier who ships directly to your buyer, while you stay responsible for delivery and the buyer's satisfaction. Buying from another retailer or marketplace and having it shipped straight to your buyer is not allowed on eBay. The course covers this in detail.",
  },
  {
    q: "Does the AI publish or send anything by itself?",
    a: "No. AI output is shown as a draft for you to approve. Buyer replies are never sent automatically.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. Manage or cancel your subscription from the billing page at any time. See the Refund Policy for details on refunds.",
  },
  {
    q: "Which plan includes the course?",
    a: "Growth includes the full course. You can also buy the course on its own with a one-time payment.",
  },
];
