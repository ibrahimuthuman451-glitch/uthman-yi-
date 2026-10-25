import type { PaymentMethod } from "@prisma/client";
import type { SiteSettings } from "@/lib/settings";
import type { AppEnv } from "@/lib/env";

/**
 * Payment capability registry.
 *
 * A method is offered at checkout only when it is enabled in settings AND its
 * prerequisites exist. Nothing here simulates a successful payment: every
 * option either collects an explicit reference for manual verification or is
 * confirmed by the provider through the MTN MoMo API/webhook.
 */
export type PaymentOption = {
  method: PaymentMethod;
  label: string;
  description: string;
  instructions: string;
  /** Customer must eventually provide a transaction reference. */
  requiresReference: boolean;
  enabled: boolean;
  /** Short explanation shown in admin when the method cannot be offered. */
  unavailableReason?: string;
};

export function isMtnMomoConfigured(env: AppEnv): boolean {
  return Boolean(
    env.PAYMENTS_MTN_MOMO_ENABLED &&
      env.MTN_MOMO_SUBSCRIPTION_KEY &&
      env.MTN_MOMO_API_USER &&
      env.MTN_MOMO_API_KEY &&
      env.MTN_MOMO_CALLBACK_URL,
  );
}

export function buildPaymentOptions(
  settings: SiteSettings,
  env: AppEnv,
): PaymentOption[] {
  const { payments } = settings;
  const mtnConfigured = isMtnMomoConfigured(env);
  const momoNumber = payments.manualMobileMoney.mtnNumber ||
    payments.manualMobileMoney.airtelNumber;

  return [
    {
      method: "CASH_ON_DELIVERY",
      label: "Cash on delivery",
      description: "Pay the rider in cash when your order arrives.",
      instructions: payments.cashOnDelivery.instructions,
      requiresReference: false,
      enabled: payments.cashOnDelivery.enabled,
      unavailableReason: payments.cashOnDelivery.enabled
        ? undefined
        : "Cash on delivery is switched off in the business settings.",
    },
    {
      method: "MANUAL_MOBILE_MONEY",
      label: "MTN MoMo / Airtel Money (verify manually)",
      description:
        "Send the total by mobile money and submit your transaction reference for verification.",
      instructions: payments.manualMobileMoney.instructions,
      requiresReference: true,
      enabled: payments.manualMobileMoney.enabled && Boolean(momoNumber),
      unavailableReason:
        payments.manualMobileMoney.enabled && momoNumber
          ? undefined
          : "A merchant mobile money number has not been configured yet.",
    },
    {
      method: "BANK_TRANSFER",
      label: "Bank transfer",
      description: "Transfer the total to the Uthman IY business account.",
      instructions: payments.bankTransfer.instructions,
      requiresReference: true,
      enabled:
        payments.bankTransfer.enabled &&
        Boolean(payments.bankTransfer.accountNumber && payments.bankTransfer.bankName),
      unavailableReason:
        payments.bankTransfer.enabled &&
        payments.bankTransfer.accountNumber &&
        payments.bankTransfer.bankName
          ? undefined
          : "Bank account details have not been configured yet.",
    },
    {
      method: "MTN_MOMO_API",
      label: "MTN MoMo (online payment request)",
      description:
        "Approve the payment prompt on your phone. The order is confirmed only after MTN reports success.",
      instructions:
        "You will receive a payment prompt on your MTN number. The order stays pending until MTN confirms the transaction.",
      requiresReference: false,
      enabled: mtnConfigured && payments.mtnMomoApi.enabled,
      unavailableReason:
        mtnConfigured && payments.mtnMomoApi.enabled
          ? undefined
          : "The MTN MoMo API is not enabled: merchant credentials and a public callback URL are still required.",
    },
  ];
}

export function getEnabledPaymentOptions(
  settings: SiteSettings,
  env: AppEnv,
): PaymentOption[] {
  return buildPaymentOptions(settings, env).filter((option) => option.enabled);
}

/** Returns the option for a method, or null when it is not currently offered. */
export function getPaymentOption(
  method: PaymentMethod,
  settings: SiteSettings,
  env: AppEnv,
): PaymentOption | null {
  return (
    buildPaymentOptions(settings, env).find(
      (option) => option.method === method && option.enabled,
    ) ?? null
  );
}

/**
 * Payment methods that create an order awaiting confirmation. Cash on delivery
 * is also created as "awaiting payment" until a staff member confirms the
 * order, which keeps the fulfilment workflow identical for every method.
 */
export function isPrepaidMethod(method: PaymentMethod): boolean {
  return method !== "CASH_ON_DELIVERY";
}
