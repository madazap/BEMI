-- Tratamientos con sesión de control al final: al crear el plan se añade una sesión extra
-- marcada is_control = 1. Solo afecta planes creados después del cambio.
ALTER TABLE treatments ADD COLUMN requires_control TINYINT(1) NOT NULL DEFAULT 0 AFTER total_sessions;
ALTER TABLE sessions   ADD COLUMN is_control       TINYINT(1) NOT NULL DEFAULT 0 AFTER session_number;
