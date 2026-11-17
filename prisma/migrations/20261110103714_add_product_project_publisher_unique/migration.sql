-- Declare uniqueness on the exact columns of the Product-to-Project foreign key.
ALTER TABLE "Product"
    ADD CONSTRAINT "Product_projectId_publisherAccountId_key"
    UNIQUE ("projectId", "publisherAccountId");
