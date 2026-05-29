// payments.js
// -----------------------------------------------------------------------------
// Accelerator inventory + Stripe-ish purchase flow. Static page, no backend —
// so this layer is "Stripe Payment Links + client-side grant on success
// redirect." For real production you'd add a webhook to your own backend to
// verify the purchase; this file is the front-end half.
//
// Wiring real Stripe:
//   window.STRIPE_LINKS = {
//     sunbeam:       "https://buy.stripe.com/test_xxx_sunbeam",
//     hatch_charm:   "https://buy.stripe.com/test_xxx_hatchcharm",
//     joy_spark:     "https://buy.stripe.com/test_xxx_joyspark",
//     solis_beacon:  "https://buy.stripe.com/test_xxx_solisbeacon",
//   };
// Each Stripe Payment Link's "After payment" should redirect to
// <your-page>?paid=<itemId>&qty=<n>. consumeRedirect() reads the URL on boot
// and grants the items, then clears the query so a refresh isn't double-grant.
//
// If no STRIPE_LINKS is set, openShop falls back to a mock dialog ("Stripe
// integration pending — pretend you paid") so the shop UI still works for
// demos / testing.

export const ACCELERATORS = [
  {
    id: "sunbeam",
    name: "Sunbeam",
    icon: "☀",
    blurb: "Push the sun forward — instantly advance one phase of day or night.",
    priceUsd: 0.99,
    qty: 5,
  },
  {
    id: "hatch_charm",
    name: "Hatch Charm",
    icon: "🥚",
    blurb: "An impatient blessing. Hatches one unhatched egg of your choosing right now.",
    priceUsd: 1.99,
    qty: 3,
  },
  {
    id: "joy_spark",
    name: "Joy Spark",
    icon: "✨",
    blurb: "A wave of warmth — every hatched soul's joy lifts by +30%.",
    priceUsd: 0.99,
    qty: 5,
  },
  {
    id: "solis_beacon",
    name: "First Egg Beacon",
    icon: "🌟",
    blurb: "Whisper-call to Solis. She emerges before the others have reached joy 0.7.",
    priceUsd: 4.99,
    qty: 1,
  },
];

export const ACCELERATOR_BY_ID = ACCELERATORS.reduce((m, a) => (m[a.id] = a, m), {});

// Read ?paid=<id>&qty=<n> from the URL after a successful Stripe redirect.
// Grants the items via the supplied world reference, then strips the query so
// a refresh isn't double-rewarded. Returns the granted item or null.
export function consumeRedirect(world) {
  if (typeof location === "undefined") return null;
  const params = new URLSearchParams(location.search);
  const id = params.get("paid");
  if (!id || !ACCELERATOR_BY_ID[id]) return null;
  const qty = parseInt(params.get("qty") || ACCELERATOR_BY_ID[id].qty, 10) || 1;
  world.accelerators[id] = (world.accelerators[id] || 0) + qty;
  world._persist && world._persist();
  // Clean the URL so re-visiting doesn't re-grant.
  const url = new URL(location.href);
  url.searchParams.delete("paid");
  url.searchParams.delete("qty");
  history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
  return { item: ACCELERATOR_BY_ID[id], qty };
}

// Begin a purchase. If a real Stripe Payment Link is configured, redirect to
// it. Otherwise show the mock confirmation modal so the demo flow still
// completes end-to-end without real keys.
export function beginPurchase(item) {
  const link = (typeof window !== "undefined" && window.STRIPE_LINKS && window.STRIPE_LINKS[item.id]) || null;
  if (link) {
    // Redirect to Stripe. After the user pays, Stripe sends them back to the
    // success URL configured on the Payment Link, which should be
    // <your-page>?paid=<item.id>&qty=<item.qty>.
    location.href = link;
    return "stripe";
  }
  // Fall back to a mock: shows a styled "you paid (pretend)" confirmation and
  // grants the qty client-side. Useful for demos and for the test mode.
  return "mock";
}

// Apply the effect of an accelerator. Decrements inventory, calls the
// appropriate world hook. Returns true if the spend was applied; false if the
// player had none or the effect didn't fire (e.g. instantHatch with no eggs).
export function applyAccelerator(world, id, options = {}) {
  if ((world.accelerators[id] || 0) <= 0) return false;
  let applied = false;
  switch (id) {
    case "sunbeam":      world.skipTimePhase(); applied = true; break;
    case "hatch_charm":  applied = world.instantHatch(options.charId || null) > 0; break;
    case "joy_spark":    world.joyBurst(0.3); applied = world.actors.length > 0; break;
    case "solis_beacon": applied = !!options.summonSolis && options.summonSolis(); break;
  }
  if (applied) {
    world.accelerators[id]--;
    world._persist && world._persist();
  }
  return applied;
}
