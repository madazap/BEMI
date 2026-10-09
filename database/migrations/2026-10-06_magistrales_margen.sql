-- Magistrales en factura:
-- unit_cost      = precio de adquisición del magistral al momento de facturar (snapshot para el margen).
-- stock_shortage = cantidad facturada sin stock disponible (venta permitida sin stock, queda registrada).
ALTER TABLE invoice_items
  ADD COLUMN unit_cost      DECIMAL(12, 2) NULL AFTER unit_price,
  ADD COLUMN stock_shortage DECIMAL(10, 4) NOT NULL DEFAULT 0 AFTER unit_cost;
