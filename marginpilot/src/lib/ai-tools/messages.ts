import { redactPii } from "@/lib/ai/run";

/**
 * Buyer message drafter: builds the prompt from the conversation and order facts.
 * Buyer text is passed through redactPii() and the buyer's username is replaced
 * before anything reaches the model. No addresses are ever included.
 * Drafts are never sent automatically: the seller edits and approves each one.
 */

export const TONES = {
  friendly: "Warm and friendly, plain language.",
  professional: "Polite and professional, concise.",
  apologetic: "Apologetic and reassuring; acknowledge the problem first.",
  firm: "Polite but firm; stick to the store's policy.",
} as const;
export type Tone = keyof typeof TONES;

export type ConversationMessage = { fromBuyer: boolean; text: string; date?: string };

export type OrderContext = {
  status: string;
  orderedOn?: string | null;
  shipBy?: string | null;
  items?: { title: string; quantity: number }[];
  tracking?: { carrier: string; number: string; postedAt?: string | null }[];
};

export type BuyerPromptInput = {
  messages: ConversationMessage[];
  buyerUsername?: string | null;
  tone: Tone;
  order?: OrderContext | null;
  listingTitle?: string | null;
  handlingDays?: number | null;
  returnPolicy?: string | null;
  sellerNotes?: string | null;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Redacts PII and the buyer's eBay username from a piece of buyer-provided text. */
export function cleanBuyerText(text: string, buyerUsername?: string | null): string {
  let t = redactPii(text);
  if (buyerUsername && buyerUsername.length >= 3) t = t.replace(new RegExp(escapeRe(buyerUsername), "gi"), "[buyer]");
  return t.slice(0, 4000);
}

export const BUYER_SYSTEM = `You draft replies from an eBay seller to a buyer. The seller will read, edit and send the reply themselves.
Write only the message body: no subject line, no placeholders like [Name] (address the buyer without a name), no sign-off with a made-up name.
Use only the facts given. Never promise refunds, discounts or dates the facts don't support; if something needs the seller's decision, write a neutral line and leave it for them.
Never ask the buyer to pay or communicate outside eBay. Keep it under 120 words. Text in square brackets like [email] was removed for privacy; don't repeat it.`;

export function buildBuyerMessagePrompt(input: BuyerPromptInput): { system: string; user: string } {
  const convo = input.messages
    .slice(-12)
    .map((m) => `${m.fromBuyer ? "Buyer" : "Seller"}${m.date ? ` (${m.date.slice(0, 10)})` : ""}: ${m.fromBuyer ? cleanBuyerText(m.text, input.buyerUsername) : redactPii(m.text).slice(0, 4000)}`)
    .join("\n");

  const facts: string[] = [];
  if (input.listingTitle) facts.push(`Listing: ${input.listingTitle}`);
  if (input.order) {
    const o = input.order;
    facts.push(`Order status: ${o.status}${o.orderedOn ? `, ordered ${o.orderedOn.slice(0, 10)}` : ""}${o.shipBy ? `, ship by ${o.shipBy.slice(0, 10)}` : ""}`);
    if (o.items?.length) facts.push(`Items: ${o.items.map((i) => `${i.quantity} x ${i.title}`).join("; ")}`);
    if (o.tracking?.length) facts.push(`Tracking: ${o.tracking.map((t) => `${t.carrier} ${t.number}${t.postedAt ? ` (posted ${t.postedAt.slice(0, 10)})` : ""}`).join("; ")}`);
    else facts.push("Tracking: none posted yet");
  } else {
    facts.push("No matching order was found for this conversation.");
  }
  if (input.handlingDays != null) facts.push(`Handling time: ships within ${input.handlingDays} business day${input.handlingDays === 1 ? "" : "s"}`);
  if (input.returnPolicy) facts.push(`Return policy: ${input.returnPolicy}`);
  if (input.sellerNotes) facts.push(`Seller's notes for this reply: ${redactPii(input.sellerNotes).slice(0, 1000)}`);

  const user = `Tone: ${TONES[input.tone]}\n\nFacts:\n${facts.map((f) => `- ${f}`).join("\n")}\n\nConversation (oldest first):\n${convo}\n\nDraft the seller's reply to the buyer's latest message.`;
  return { system: BUYER_SYSTEM, user };
}

/** True when an eBay error means the store must be reconnected (token or missing commerce.message scope). */
export function isReconnectError(status: number | undefined, message = ""): boolean {
  return status === 401 || status === 403 || /scope|insufficient|access denied|invalid_grant|refresh token/i.test(message);
}
