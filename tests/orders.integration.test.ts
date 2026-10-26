import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  confirmManualPayment,
  createOrder,
  getOrderByNumber,
  trackOrder,
  updateOrderStatus,
} from "@/server/services/orders";

/**
 * Integration tests against the real PostgreSQL database.
 * These cover the money path: server-side pricing, stock reservation,
 * idempotency, overselling, cancellation and payment confirmation.
 */

const suffix = Date.now().toString(36);
let categoryId = "";
let productId = "";
let referenceProductId = "";
let deliveryAreaId = "";
const createdOrderIds: string[] = [];

let actor: { id: string; name: string; email: string } = { id: "", name: "Test Staff", email: "" };

/** Test-only helper: stock is consumed by earlier tests, so reset it per case. */
async function resetStock(units = 10) {
  await db.product.update({ where: { id: productId }, data: { stock: units } });
}

beforeAll(async () => {
  const category = await db.category.create({
    data: { name: `Test category ${suffix}`, slug: `test-category-${suffix}` },
  });
  categoryId = category.id;

  const product = await db.product.create({
    data: {
      name: `Test camera ${suffix}`,
      slug: `test-camera-${suffix}`,
      sku: `TEST-${suffix}`,
      categoryId,
      priceRwf: 100_000,
      stock: 5,
      lowStockThreshold: 1,
      dataStatus: "APPROVED",
      isPublished: true,
    },
  });
  productId = product.id;

  const reference = await db.product.create({
    data: {
      name: `Reference item ${suffix}`,
      slug: `reference-item-${suffix}`,
      sku: `REF-${suffix}`,
      categoryId,
      priceRwf: null,
      stock: 10,
      dataStatus: "REFERENCE",
      isPublished: true,
    },
  });
  referenceProductId = reference.id;

  const area = await db.deliveryArea.create({
    data: { name: `Test area ${suffix}`, feeRwf: 2_000, isActive: true },
  });
  deliveryAreaId = area.id;

  // Order events reference a real staff account (foreign key enforced).
  const staff = await db.user.create({
    data: {
      name: "Test Staff",
      email: `staff-${suffix}@test.local`,
      passwordHash: "not-used-in-tests",
      role: "STAFF",
    },
  });
  actor = { id: staff.id, name: staff.name, email: staff.email };
});

afterAll(async () => {
  await db.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await db.stockMovement.deleteMany({ where: { productId: { in: [productId, referenceProductId] } } });
  await db.product.deleteMany({ where: { id: { in: [productId, referenceProductId] } } });
  await db.deliveryArea.deleteMany({ where: { id: deliveryAreaId } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: actor.id } });
  await db.$disconnect();
});

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ productId, quantity: 2 }],
    customerName: "Test Customer",
    customerEmail: "customer@test.local",
    customerPhone: "0780551125",
    deliveryAreaId,
    deliveryAddress: "KG 11 Ave, Gisozi, Kigali",
    paymentMethod: "CASH_ON_DELIVERY" as const,
    idempotencyKey: `test-${suffix}-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  };
}

describe("order creation", () => {
  it("prices on the server, reserves stock and records a movement", async () => {
    const result = await createOrder(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdOrderIds.push(result.order.id);

    expect(result.order.subtotalRwf).toBe(200_000);
    expect(result.order.deliveryFeeRwf).toBe(2_000);
    expect(result.order.totalRwf).toBe(202_000);
    expect(result.order.status).toBe("PENDING_PAYMENT");
    expect(result.order.paymentStatus).toBe("UNPAID");

    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stock).toBe(3);

    const movements = await db.stockMovement.findMany({
      where: { orderId: result.order.id, reason: "ORDER_PLACED" },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(-2);
  });

  it("returns the original order for a repeated idempotency key without taking more stock", async () => {
    await resetStock(2);
    const key = `idem-${suffix}`;
    const first = await createOrder(baseInput({ idempotencyKey: key }));
    const second = await createOrder(baseInput({ idempotencyKey: key }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    createdOrderIds.push(first.order.id);

    expect(second.order.orderNumber).toBe(first.order.orderNumber);
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stock).toBe(0);
  });

  it("refuses to oversell", async () => {
    await resetStock(3);
    const result = await createOrder(baseInput({ items: [{ productId, quantity: 15 }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INSUFFICIENT_STOCK");
  });

  it("refuses reference listings without an approved price", async () => {
    const result = await createOrder(baseInput({ items: [{ productId: referenceProductId, quantity: 1 }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_PURCHASABLE");
  });

  it("refuses payment methods that are not configured", async () => {
    const result = await createOrder(baseInput({ paymentMethod: "MTN_MOMO_API" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
  });

  it("refuses inactive or unknown delivery areas", async () => {
    const result = await createOrder(baseInput({ deliveryAreaId: "not-a-real-area" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_DELIVERY_AREA");
  });
});

describe("order lifecycle", () => {
  it("confirms a manual payment and records an order event", async () => {
    await resetStock();
    const created = await createOrder(baseInput({ paymentMethod: "MANUAL_MOBILE_MONEY" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdOrderIds.push(created.order.id);
    expect(created.order.paymentStatus).toBe("PENDING");

    const confirmation = await confirmManualPayment({
      orderId: created.order.id,
      paymentReference: `MOMO-${suffix}`,
      note: "Verified in statement",
      actor,
    });
    expect(confirmation.ok).toBe(true);

    const refreshed = await getOrderByNumber(created.order.orderNumber);
    expect(refreshed?.paymentStatus).toBe("PAID");
    expect(refreshed?.status).toBe("PAID");
    expect(refreshed?.paymentReference).toBe(`MOMO-${suffix}`);
    expect(refreshed?.events.some((event) => event.type === "PAYMENT_CONFIRMED")).toBe(true);

    const again = await confirmManualPayment({
      orderId: created.order.id,
      paymentReference: "duplicate",
      actor,
    });
    expect(again.ok).toBe(false);
  });

  it("returns stock once when an order is cancelled and locks cancelled orders", async () => {
    await resetStock();
    const created = await createOrder(baseInput({ items: [{ productId, quantity: 1 }], idempotencyKey: `cancel-${suffix}` }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdOrderIds.push(created.order.id);

    const before = await db.product.findUniqueOrThrow({ where: { id: productId } });
    const cancel = await updateOrderStatus({
      orderId: created.order.id,
      status: "CANCELLED",
      actor,
      note: "Customer changed their mind",
    });
    expect(cancel.ok).toBe(true);

    const after = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(after.stock).toBe(before.stock + 1);

    const secondCancel = await updateOrderStatus({
      orderId: created.order.id,
      status: "CANCELLED",
      actor,
    });
    expect(secondCancel.ok).toBe(false);

    const third = await updateOrderStatus({ orderId: created.order.id, status: "PROCESSING", actor });
    expect(third.ok).toBe(false);
  });

  it("tracks an order only with the matching email or phone", async () => {
    await resetStock();
    const created = await createOrder(baseInput({ idempotencyKey: `track-${suffix}` }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdOrderIds.push(created.order.id);

    const byEmail = await trackOrder({
      orderNumber: created.order.orderNumber,
      contact: "CUSTOMER@test.local",
    });
    expect(byEmail?.id).toBe(created.order.id);

    const byPhone = await trackOrder({
      orderNumber: created.order.orderNumber,
      contact: "+250 780 551 125",
    });
    expect(byPhone?.id).toBe(created.order.id);

    const wrong = await trackOrder({
      orderNumber: created.order.orderNumber,
      contact: "someone-else@test.local",
    });
    expect(wrong).toBeNull();
  });
});
