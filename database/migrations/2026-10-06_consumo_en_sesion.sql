-- Consumo de insumos al realizar la sesión (no al facturar ni desde la cotización).
-- 1) stock_entry_id NULL = consumo registrado sin lote disponible (faltante de stock, se permite con advertencia).
-- 2) is_extra = producto adicional, ajeno al consumo estándar del tratamiento (treatment_products).
ALTER TABLE session_products
  MODIFY stock_entry_id INT UNSIGNED NULL,
  ADD COLUMN is_extra TINYINT(1) NOT NULL DEFAULT 0 AFTER quantity;
