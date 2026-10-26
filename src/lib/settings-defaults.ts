/**
 * Business settings defaults (pure module, safe to import from scripts).
 *
 * Only information supplied by the owner is pre-filled. Everything the owner
 * has not confirmed (email address, street address, opening hours, bank
 * details) stays empty and the UI hides it instead of inventing a value.
 */

import { isProduction } from "./env";

export type SiteSettings = {
  company: {
    name: string;
    phone: string;
    secondaryPhone: string;
    email: string;
    addressLine: string;
    city: string;
    country: string;
    whatsappPhone: string;
  };
  store: {
    currency: "RWF";
    /**
     * TRACKED enforces the stock column (orders are refused when stock is short).
     * ON_REQUEST lets customers order with stock confirmed by phone before
     * dispatch - used when no reliable inventory figure exists yet.
     */
    stockMode: "TRACKED" | "ON_REQUEST";
    showDemoProducts: boolean;
    catalogueNotice: string;
    orderNotice: string;
    deliveryNotice: string;
    freeDeliveryThreshold: number | null;
    maxQuantityPerItem: number;
  };
  payments: {
    cashOnDelivery: { enabled: boolean; instructions: string };
    manualMobileMoney: {
      enabled: boolean;
      mtnNumber: string;
      airtelNumber: string;
      instructions: string;
    };
    bankTransfer: {
      enabled: boolean;
      bankName: string;
      accountName: string;
      accountNumber: string;
      instructions: string;
    };
    mtnMomoApi: { enabled: boolean };
  };
  content: {
    heroEyebrow: string;
    heroHeadline: string;
    heroHighlight: string;
    heroSubheadline: string;
    announcement: string;
  };
};

export const SETTINGS_KEY = "site";

export const defaultSettings: SiteSettings = {
  company: {
    name: "Uthman IY",
    phone: "0780551125",
    // Confirmed by the owner on 2026-10-26 (+250 785 779 207).
    secondaryPhone: "0785779207",
    email: "uthumanyi@gmail.com",
    addressLine: "Gisozi",
    city: "Kigali",
    country: "Rwanda",
    // WhatsApp uses the second business line, confirmed by the owner on 2026-10-26.
    whatsappPhone: "0785779207",
  },
  store: {
    currency: "RWF",
    // No verified inventory figures exist yet, so availability is confirmed by
    // phone before dispatch. Switch to TRACKED once real stock is maintained.
    stockMode: "ON_REQUEST",
    // Demo listings are seeded only in non-production environments and are
    // always labelled. This flag lets the owner hide them entirely.
    showDemoProducts: !isProduction(),
    catalogueNotice:
      "All prices are in Rwandan francs (RWF) and were last reviewed on 26 October 2026. Delivery is available across Rwanda; the delivery fee is confirmed by phone before dispatch.",
    orderNotice:
      "Your order is confirmed by phone before dispatch. Payment instructions are shown on your order page.",
    deliveryNotice:
      "Delivery is arranged across Rwanda. The delivery fee depends on your location and is agreed with you by phone before dispatch; it is not charged online.",
    freeDeliveryThreshold: null,
    maxQuantityPerItem: 20,
  },
  payments: {
    cashOnDelivery: {
      // Owner confirmed mobile money as the payment route; cash on delivery is
      // available to re-enable in Admin -> Settings if the rider workflow allows it.
      enabled: false,
      instructions:
        "Pay the rider in cash when your order is delivered. Orders are confirmed by phone before dispatch.",
    },
    manualMobileMoney: {
      enabled: true,
      mtnNumber: "0780551125",
      airtelNumber: "",
      instructions:
        "Send the total to the Uthman IY mobile money number, then enter the transaction reference at checkout. Our team verifies the payment before dispatch.",
    },
    bankTransfer: {
      enabled: false,
      bankName: "",
      accountName: "",
      accountNumber: "",
      instructions:
        "Bank details will be published once the business account is confirmed. Until then, choose another payment method.",
    },
    mtnMomoApi: { enabled: false },
  },
  content: {
    heroEyebrow: "Technology company · Gisozi, Kigali",
    heroHeadline: "Technology that moves",
    heroHighlight: "your business forward.",
    heroSubheadline:
      "Uthman IY supplies technology products, builds software, and develops our own analytics and productivity tools for organisations in Rwanda.",
    announcement: "",
  },
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Merges stored overrides onto defaults, ignoring unknown keys and nulls. */
export function mergeSettings(base: SiteSettings, override: unknown): SiteSettings {
  if (!override || typeof override !== "object") return base;
  const result: SiteSettings = JSON.parse(JSON.stringify(base));
  for (const [section, values] of Object.entries(override as Record<string, unknown>)) {
    if (!(section in result) || !values || typeof values !== "object") continue;
    const target = (result as unknown as Record<string, Record<string, unknown>>)[section];
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (key in target && value !== undefined && value !== null) {
        target[key] = value;
      }
    }
  }
  return result;
}
