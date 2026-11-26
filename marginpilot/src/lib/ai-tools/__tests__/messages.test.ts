import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildBuyerMessagePrompt, cleanBuyerText, isReconnectError } = await import("../messages");

describe("buyer message drafter", () => {
  const messages = [
    { fromBuyer: true, text: "Hi, I'm jane_buyer99. Email me at jane.doe@example.com or call +1 (555) 123-4567.", date: "2026-11-20T10:00:00Z" },
    { fromBuyer: false, text: "Thanks, checking now." },
    { fromBuyer: true, text: "Please ship to 742 Evergreen Terrace Drive instead. Where is my order?" },
  ];

  it("redacts emails, phones, street addresses and the buyer's username before prompting", () => {
    const { user } = buildBuyerMessagePrompt({ messages, buyerUsername: "jane_buyer99", tone: "friendly" });
    expect(user).not.toContain("jane.doe@example.com");
    expect(user).not.toContain("555");
    expect(user).not.toContain("742 Evergreen");
    expect(user).not.toContain("jane_buyer99");
    expect(user).toContain("[email]");
    expect(user).toContain("[phone]");
    expect(user).toContain("[address]");
    expect(user).toContain("[buyer]");
    expect(user).toContain("Where is my order?");
  });

  it("includes order status and tracking but no address fields", () => {
    const { user, system } = buildBuyerMessagePrompt({
      messages,
      buyerUsername: "jane_buyer99",
      tone: "apologetic",
      order: { status: "shipped", orderedOn: "2026-11-18T00:00:00Z", items: [{ title: "Utensil set", quantity: 1 }], tracking: [{ carrier: "USPS", number: "9400100000000000000000" }] },
      handlingDays: 2,
      returnPolicy: "30 day returns",
      sellerNotes: "Offer to check with the carrier. My email is seller@example.com",
    });
    expect(user).toContain("Order status: shipped");
    expect(user).toContain("USPS 9400100000000000000000");
    expect(user).toContain("ships within 2 business days");
    expect(user).toContain("30 day returns");
    expect(user).toMatch(/Apologetic/);
    expect(user).not.toContain("seller@example.com");
    expect(system).toMatch(/seller will read, edit and send/);
  });

  it("says when no order matched", () => {
    const { user } = buildBuyerMessagePrompt({ messages, tone: "professional" });
    expect(user).toContain("No matching order");
  });

  it("cleanBuyerText ignores very short usernames and caps length", () => {
    expect(cleanBuyerText("hi ab", "ab")).toBe("hi ab");
    expect(cleanBuyerText("x".repeat(5000))).toHaveLength(4000);
  });

  it("detects errors that need a store reconnect", () => {
    expect(isReconnectError(403, "Insufficient permissions to fulfill the request.")).toBe(true);
    expect(isReconnectError(400, "The OAuth scope is not granted")).toBe(true);
    expect(isReconnectError(500, "Internal error")).toBe(false);
  });
});
