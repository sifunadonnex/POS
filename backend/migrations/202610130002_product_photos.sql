-- Up Migration
CREATE TABLE catalogue_product_photo (
  product_id uuid PRIMARY KEY REFERENCES catalogue_product(id),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 524288),
  mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp'))
);

-- Down Migration
DROP TABLE catalogue_product_photo;
