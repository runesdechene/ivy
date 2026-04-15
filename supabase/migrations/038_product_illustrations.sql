-- Product illustration URLs synced from Shopify metaobjects
ALTER TABLE products ADD COLUMN IF NOT EXISTS illustration_url TEXT;

COMMENT ON COLUMN products.illustration_url IS
  'URL of the product illustration image, fetched from the Shopify metaobject referenced by the custom.illustration_produit metafield. NULL = not synced or no illustration set on Shopify.';
