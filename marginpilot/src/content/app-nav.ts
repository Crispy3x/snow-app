/** Sidebar navigation for the signed-in app. Each feature area owns its routes. */
export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };

export const APP_NAV: NavGroup[] = [
  {
    label: "Store",
    items: [
      { href: "/app", label: "Dashboard" },
      { href: "/app/listings", label: "Listings" },
      { href: "/app/listings/new", label: "Add products" },
      { href: "/app/directory", label: "Supplier directory" },
      { href: "/app/monitor", label: "Price and stock" },
      { href: "/app/orders", label: "Orders" },
      { href: "/app/promotions", label: "Offers and promotions" },
      { href: "/app/cleanup", label: "Cleanup" },
      { href: "/app/activity", label: "Activity log" },
    ],
  },
  {
    label: "AI tools",
    items: [
      { href: "/app/ai/listing-writer", label: "Listing writer" },
      { href: "/app/ai/titles", label: "Title optimizer" },
      { href: "/app/ai/research", label: "Product research" },
      { href: "/app/ai/pricing", label: "Pricing advisor" },
      { href: "/app/ai/images", label: "Image cleaner" },
      { href: "/app/ai/photo-studio", label: "Photo studio" },
      { href: "/app/ai/messages", label: "Buyer messages" },
      { href: "/app/ai/audit", label: "Listing audit" },
      { href: "/app/ai/chat", label: "Store assistant" },
    ],
  },
  {
    label: "Learn",
    items: [
      { href: "/app/course", label: "Course" },
      { href: "/app/mentorship", label: "Mentorship" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/app/stores", label: "eBay stores" },
      { href: "/app/team", label: "Team" },
      { href: "/app/billing", label: "Billing and usage" },
      { href: "/app/settings", label: "Settings" },
      { href: "/app/testimonial", label: "Share your results" },
      { href: "/app/referrals", label: "Refer and earn" },
    ],
  },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users and plans" },
  { href: "/admin/proof", label: "Proof queue" },
  { href: "/admin/course", label: "Course content" },
  { href: "/admin/directory", label: "Supplier directory" },
  { href: "/admin/mentorship", label: "Mentorship" },
  { href: "/admin/referrals", label: "Referrals" },
  { href: "/admin/flags", label: "Feature flags" },
  { href: "/admin/ai-usage", label: "AI usage and cost" },
];
