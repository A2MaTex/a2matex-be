-- Order: fold the single OrderItem line back into "Order".
-- Spec: specs/007-order (spec.md Assumptions, data-model.md).
--
-- Decisions encoded here:
--   * There is no cart in the MVP: a purchase is one Product bought from one offer, and
--     "exactly one line per Order" was kept by code, never by the database. Columns on
--     "Order" drop a join from every read and the OrderItem[0] assertions from the service.
--   * "unitPriceAmount" does not survive: it always equalled "totalAmount", and
--     "offerSnapshot" still carries the price the offer listed when the customer paid.
--   * UNIQUE ("orderId", "productId") disappears with the table; it guarded a duplicate
--     Product inside one Order, which one row cannot hold.
--   * "Entitlement.latestOrderItemId" becomes "latestOrderId". No endpoint ever resolved an
--     order item id; an Order id answers GET /orders/:orderId.
--   * Nothing is deleted. The columns are backfilled and then made NOT NULL, so an Order
--     without a line (impossible: both rows were written in one transaction) fails the
--     migration loudly instead of being dropped.

ALTER TABLE "Order"
    ADD COLUMN "productId"      UUID,
    ADD COLUMN "productOfferId" UUID,
    ADD COLUMN "offerSnapshot"  JSONB;

UPDATE "Order" o
SET "productId"      = i."productId",
    "productOfferId" = i."productOfferId",
    "offerSnapshot"  = i."offerSnapshot"
FROM "OrderItem" i
WHERE i."orderId" = o.id;

ALTER TABLE "Order"
    ALTER COLUMN "productId"      SET NOT NULL,
    ALTER COLUMN "productOfferId" SET NOT NULL,
    ALTER COLUMN "offerSnapshot"  SET NOT NULL;

ALTER TABLE "Order"
    ADD CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId")
        REFERENCES "Product" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    ADD CONSTRAINT "Order_productOfferId_fkey" FOREIGN KEY ("productOfferId")
        REFERENCES "ProductOffer" (id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    ADD CONSTRAINT "Order_offerSnapshot_object_check"
        CHECK (jsonb_typeof("offerSnapshot") = 'object');

-- Replaces "OrderItem_productId_idx": answers "what was bought of this Product".
CREATE INDEX "Order_productId_idx" ON "Order" ("productId");

-- The Entitlement follows the purchase, so it points at the Order the line belonged to.
ALTER TABLE "Entitlement" ADD COLUMN "latestOrderId" UUID;

UPDATE "Entitlement" e
SET "latestOrderId" = i."orderId"
FROM "OrderItem" i
WHERE i.id = e."latestOrderItemId";

ALTER TABLE "Entitlement"
    DROP CONSTRAINT "Entitlement_latestOrderItemId_fkey",
    DROP COLUMN "latestOrderItemId",
    ADD CONSTRAINT "Entitlement_latestOrderId_fkey" FOREIGN KEY ("latestOrderId")
        REFERENCES "Order" (id) ON DELETE NO ACTION ON UPDATE NO ACTION;

DROP TABLE "OrderItem";
