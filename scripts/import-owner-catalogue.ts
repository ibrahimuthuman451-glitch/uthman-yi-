/**
 * Imports the owner-approved catalogue prepared from the reference shop and
 * applies the matching store settings (stock on request, nationwide delivery,
 * mobile money payments).
 *
 * Usage: npx tsx scripts/import-owner-catalogue.ts [--remove-demo]
 *
 * Idempotent: products are matched by slug and updated, never duplicated.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { updateSiteSettings } from "@/lib/settings";
import { importCatalogue } from "@/server/services/catalogue-io";

const file = path.join(process.cwd(), "data/import/uthman-iy-catalogue-2026-10-26.json");
const payload = JSON.parse(readFileSync(file, "utf8")) as {
  products: { categorySlug: string }[];
};

const CATEGORY_NAMES: Record<string, string> = {
  "cctv-cameras": "CCTV Cameras",
  "cctv-kits": "CCTV Kits",
  "nvr-recorders": "NVR & Recorders",
  "power-accessories": "Power & Accessories",
  "alarm-systems": "Alarm Systems",
  "intercom-systems": "Intercom Systems",
  "starlink-kits-routers": "Starlink Kits & Routers",
  "starlink-accessories": "Starlink Accessories",
};

async function main() {
  // 1. Categories referenced by the import must exist before rows are applied.
  const needed = [...new Set(payload.products.map((product) => product.categorySlug))];
  let categoryCount = 0;
  for (const slug of needed) {
    const existing = await db.category.findUnique({ where: { slug } });
    if (existing) continue;
    await db.category.create({
      data: {
        slug,
        name: CATEGORY_NAMES[slug] ?? slug.replace(/-/g, " "),
        sortOrder: categoryCount + 10,
      },
    });
    categoryCount += 1;
  }
  console.log(`[cats] ${needed.length} categories required, ${categoryCount} created`);

  // 2. Store settings for this launch: no invented stock, nationwide delivery.
  await updateSiteSettings({
    store: {
      stockMode: "ON_REQUEST",
      showDemoProducts: false,
      maxQuantityPerItem: 20,
      catalogueNotice:
        "All prices are in Rwandan francs (RWF) and were last reviewed on 26 October 2026. Delivery is available across Rwanda; the delivery fee is confirmed by phone before dispatch.",
      orderNotice:
        "Your order is confirmed by phone before dispatch. Payment instructions are shown on your order page.",
      deliveryNotice:
        "Delivery is arranged across Rwanda. The delivery fee depends on your location and is agreed with you by phone before dispatch; it is not charged online.",
    },
    payments: {
      cashOnDelivery: { enabled: false },
      manualMobileMoney: {
        enabled: true,
        mtnNumber: "0780551125",
        airtelNumber: "",
        instructions:
          "Pay by MTN MoMo to 0780551125 (or call us for the Airtel Money number), then submit the transaction reference from your SMS. Our team verifies the payment before dispatch.",
      },
      bankTransfer: { enabled: false },
      mtnMomoApi: { enabled: false },
    },
  });
  console.log("[settings] stock mode ON_REQUEST, mobile money enabled, COD disabled");

  // 3. Nationwide delivery: one placeholder-free area with the fee agreed by phone.
  const areas = await db.deliveryArea.findMany();
  const nationwide = areas.find((area) => area.name.startsWith("Rwanda"));
  if (nationwide) {
    await db.deliveryArea.update({
      where: { id: nationwide.id },
      data: { isActive: true, feeRwf: 0, sortOrder: 0 },
    });
  } else {
    await db.deliveryArea.create({
      data: {
        name: "Rwanda - nationwide (fee confirmed by phone)",
        feeRwf: 0,
        isActive: true,
        sortOrder: 0,
        notes:
          "Delivery across Rwanda. The fee depends on the district and is agreed by phone before dispatch; it is not charged online.",
      },
    });
  }
  // Deactivate the old placeholder area so customers cannot pick it by mistake.
  await db.deliveryArea.updateMany({
    where: { name: { startsWith: "Kigali (fee pending" } },
    data: { isActive: false },
  });
  console.log("[delivery] nationwide area active");

  // 4. Import the approved catalogue (validated by the same service the admin UI uses).
  const summary = await importCatalogue(payload);
  console.log(
    `[catalogue] created ${summary.created}, updated ${summary.updated}, errors ${summary.errors.length}`,
  );
  for (const error of summary.errors.slice(0, 10)) {
    console.log(`  ! ${error.name}: ${error.message}`);
  }

  // 5. Optional cleanup of seeded demonstration listings.
  if (process.argv.includes("--remove-demo")) {
    const demos = await db.product.findMany({
      where: { dataStatus: "DEMO", sku: { startsWith: "DEMO-" } },
      select: { id: true, name: true },
    });
    const orderItems = await db.orderItem.count({
      where: { productId: { in: demos.map((demo) => demo.id) } },
    });
    if (orderItems > 0) {
      console.log(`[demo] ${demos.length} demo listings are referenced by orders - archiving instead of deleting`);
      await db.product.updateMany({
        where: { id: { in: demos.map((demo) => demo.id) } },
        data: { archivedAt: new Date(), isPublished: false },
      });
    } else {
      await db.product.deleteMany({ where: { id: { in: demos.map((demo) => demo.id) } } });
      console.log(`[demo] removed ${demos.length} demonstration listings`);
    }
  }

  const [products, published, approved] = await Promise.all([
    db.product.count(),
    db.product.count({ where: { isPublished: true, archivedAt: null } }),
    db.product.count({ where: { dataStatus: "APPROVED", archivedAt: null } }),
  ]);
  console.log(`[done] products ${products} (published ${published}, approved ${approved})`);
}

main()
  .catch((error) => {
    console.error("[import] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
