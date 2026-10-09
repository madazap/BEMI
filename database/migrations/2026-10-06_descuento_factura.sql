-- Los descuentos de la cotización (por línea y global) pasan a la factura como líneas aparte
-- con item_type='descuento' y unit_price negativo. Si el descuento es de una línea de magistral,
-- la línea de descuento conserva product_id para restarlo del margen del magistral.
ALTER TABLE invoice_items
  MODIFY item_type ENUM('sesion','magistral','descuento') NOT NULL;
