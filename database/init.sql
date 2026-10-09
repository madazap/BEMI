-- ============================================================
-- Sistema Administrativo Consultorio
-- Script de inicialización de base de datos
-- ============================================================

CREATE DATABASE IF NOT EXISTS consultorio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE consultorio;

-- ============================================================
-- MÓDULO 1 — USUARIOS Y ROLES
-- ============================================================

CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  totp_secret   VARCHAR(64)  NULL,      -- secreto TOTP (base32), NULL si 2FA no está activo
  totp_enabled  TINYINT(1)   NOT NULL DEFAULT 0,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE roles (
  id   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE  -- 'admin' | 'vendedor' | 'bodeguero'
);

CREATE TABLE user_roles (
  user_id INT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id)  ON DELETE CASCADE
);

CREATE TABLE module_permissions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id     INT UNSIGNED NOT NULL,
  module_name VARCHAR(50)  NOT NULL,
  UNIQUE KEY uq_role_module (role_id, module_name),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- ============================================================
-- MÓDULO 2 — INVENTARIO Y STOCK
-- ============================================================

CREATE TABLE suppliers (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  contact_name VARCHAR(100),
  phone        VARCHAR(30),
  email        VARCHAR(150),
  is_active    TINYINT(1)   NOT NULL DEFAULT 1
);

CREATE TABLE products (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku               VARCHAR(50)      NOT NULL UNIQUE,
  generic_name      VARCHAR(150)     NOT NULL,
  commercial_name   VARCHAR(150),
  presentation      VARCHAR(100),
  concentration     VARCHAR(100),
  manufacturer      VARCHAR(150),
  sanitary_registry VARCHAR(100),
  purchase_unit     VARCHAR(50)      NOT NULL,
  consumption_unit  VARCHAR(50)      NOT NULL,
  conversion_factor DECIMAL(10, 4)   NOT NULL DEFAULT 1,
  min_stock         DECIMAL(10, 4)   NOT NULL DEFAULT 0,
  expiry_alert_days INT UNSIGNED     NOT NULL DEFAULT 30,
  is_magistral      TINYINT(1)       NOT NULL DEFAULT 0,
  sale_price        DECIMAL(12, 2)   NULL,
  acquisition_price DECIMAL(12, 2)   NULL,
  is_active         TINYINT(1)       NOT NULL DEFAULT 1
);

CREATE TABLE stock_entries (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id           INT UNSIGNED   NOT NULL,
  supplier_id          INT UNSIGNED   NULL,
  lot_number           VARCHAR(100),
  expiry_date          DATE           NULL,
  purchase_quantity    DECIMAL(10, 4) NOT NULL,
  consumption_quantity DECIMAL(10, 4) NOT NULL,  -- purchase_quantity × conversion_factor
  purchase_price       DECIMAL(12, 2) NOT NULL,  -- por unidad de consumo
  total_cost           DECIMAL(14, 2) NOT NULL,  -- consumption_quantity × purchase_price
  entry_date           DATE           NOT NULL,
  registered_by        INT UNSIGNED   NOT NULL,
  FOREIGN KEY (product_id)    REFERENCES products(id),
  FOREIGN KEY (supplier_id)   REFERENCES suppliers(id)  ON DELETE SET NULL,
  FOREIGN KEY (registered_by) REFERENCES users(id)
);

CREATE TABLE stock_exits (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id      INT UNSIGNED   NOT NULL,
  stock_entry_id  INT UNSIGNED   NOT NULL,
  quantity        DECIMAL(10, 4) NOT NULL,
  exit_date       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason          ENUM('sesion','vencimiento','ajuste','venta') NOT NULL,  -- 'venta' = magistral facturado sin sesión
  session_id      INT UNSIGNED   NULL,
  invoice_item_id INT UNSIGNED   NULL,  -- línea de factura que originó la salida (ventas de magistral)
  registered_by   INT UNSIGNED   NOT NULL,
  FOREIGN KEY (product_id)     REFERENCES products(id),
  FOREIGN KEY (stock_entry_id) REFERENCES stock_entries(id),
  FOREIGN KEY (registered_by)  REFERENCES users(id)
);

-- ============================================================
-- MÓDULO 3 — CRM DE PACIENTES
-- ============================================================

CREATE TABLE patients (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_type   VARCHAR(20)  NOT NULL,
  document_number VARCHAR(30)  NOT NULL UNIQUE,
  full_name       VARCHAR(150) NOT NULL,
  birth_date      DATE         NULL,
  phone           VARCHAR(30),
  email           VARCHAR(150),
  address         VARCHAR(255),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE treatments (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(150) NOT NULL,
  type           ENUM('medicina_estetica','tricologia','medicina_alternativa','medicina_integral','medicina_oncologica') NOT NULL,
  description    TEXT,
  total_sessions INT UNSIGNED NOT NULL DEFAULT 1,
  requires_control TINYINT(1)  NOT NULL DEFAULT 0,  -- añade una sesión de control al final del plan
  sale_price     DECIMAL(12, 2) NOT NULL DEFAULT 0,
  execution_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
  margin         DECIMAL(12, 2) GENERATED ALWAYS AS (sale_price - execution_cost) STORED,
  is_active      TINYINT(1)     NOT NULL DEFAULT 1
);

CREATE TABLE treatment_products (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  treatment_id INT UNSIGNED   NOT NULL,
  product_id   INT UNSIGNED   NOT NULL,
  quantity     DECIMAL(10, 4) NOT NULL,
  UNIQUE KEY uq_treatment_product (treatment_id, product_id),
  FOREIGN KEY (treatment_id) REFERENCES treatments(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)   REFERENCES products(id)
);

CREATE TABLE patient_treatments (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id        INT UNSIGNED NOT NULL,
  treatment_id      INT UNSIGNED NOT NULL,
  payment_plan      ENUM('por_sesion','paquete') NOT NULL,
  status            ENUM('activo','completado','cancelado') NOT NULL DEFAULT 'activo',
  start_date        DATE         NOT NULL,
  quotation_id      INT UNSIGNED NULL,
  quotation_item_id INT UNSIGNED NULL,
  created_by        INT UNSIGNED NOT NULL,
  FOREIGN KEY (patient_id)        REFERENCES patients(id),
  FOREIGN KEY (treatment_id)      REFERENCES treatments(id),
  FOREIGN KEY (created_by)        REFERENCES users(id)
);

CREATE TABLE sessions (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_treatment_id INT UNSIGNED    NOT NULL,
  session_number       INT UNSIGNED    NOT NULL,
  is_control           TINYINT(1)      NOT NULL DEFAULT 0,  -- sesión de control final (sin cobro ni snapshot)
  scheduled_date       DATETIME        NULL,
  performed_date       DATETIME        NULL,
  status               ENUM('pendiente','realizada','cancelada') NOT NULL DEFAULT 'pendiente',
  professional_hours   DECIMAL(5, 2)   NULL,
  notes                TEXT,
  attended_by          INT UNSIGNED    NULL,
  FOREIGN KEY (patient_treatment_id) REFERENCES patient_treatments(id),
  FOREIGN KEY (attended_by)          REFERENCES users(id)
);

CREATE TABLE session_products (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id     INT UNSIGNED   NOT NULL,
  product_id     INT UNSIGNED   NOT NULL,
  stock_entry_id INT UNSIGNED   NULL,              -- NULL = consumo sin lote disponible (faltante de stock)
  quantity       DECIMAL(10, 4) NOT NULL,
  is_extra       TINYINT(1)     NOT NULL DEFAULT 0, -- 1 = producto adicional, fuera del estándar del tratamiento
  FOREIGN KEY (session_id)     REFERENCES sessions(id),
  FOREIGN KEY (product_id)     REFERENCES products(id),
  FOREIGN KEY (stock_entry_id) REFERENCES stock_entries(id)
);

CREATE TABLE session_margin_snapshots (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id            INT UNSIGNED   NOT NULL UNIQUE,
  treatment_id          INT UNSIGNED   NOT NULL,
  sale_price_at_time    DECIMAL(12, 2) NOT NULL,
  execution_cost_at_time DECIMAL(12, 2) NOT NULL,
  margin_at_time        DECIMAL(12, 2) NOT NULL,
  recorded_at           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id)   REFERENCES sessions(id),
  FOREIGN KEY (treatment_id) REFERENCES treatments(id)
);

-- Magistrales marcados "No renovar" por paciente (alerta de renovación de magistrales adquiridos).
-- Una compra posterior a dismissed_at reactiva la alerta.
CREATE TABLE magistral_renewal_dismissals (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id    INT UNSIGNED NOT NULL,
  product_id    INT UNSIGNED NOT NULL,
  dismissed_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dismissed_by  INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_patient_product (patient_id, product_id),
  FOREIGN KEY (patient_id)   REFERENCES patients(id),
  FOREIGN KEY (product_id)   REFERENCES products(id),
  FOREIGN KEY (dismissed_by) REFERENCES users(id)
);

-- ============================================================
-- MÓDULO 4 — AGENDA
-- ============================================================

CREATE TABLE appointments (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id       INT UNSIGNED NOT NULL,
  session_id       INT UNSIGNED NOT NULL,
  professional_id  INT UNSIGNED NOT NULL,
  scheduled_at     DATETIME     NOT NULL,
  duration_minutes INT UNSIGNED NOT NULL DEFAULT 60,
  status           ENUM('agendada','confirmada','realizada','cancelada') NOT NULL DEFAULT 'agendada',
  google_event_id  VARCHAR(255) NULL,
  notes            TEXT,
  created_by       INT UNSIGNED NOT NULL,
  FOREIGN KEY (patient_id)      REFERENCES patients(id),
  FOREIGN KEY (session_id)      REFERENCES sessions(id)     ON DELETE CASCADE,
  FOREIGN KEY (professional_id) REFERENCES users(id),
  FOREIGN KEY (created_by)      REFERENCES users(id)
);

-- ============================================================
-- MÓDULO 5 — COTIZACIONES
-- ============================================================

CREATE TABLE quotations (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id     INT UNSIGNED NOT NULL,
  status         ENUM('borrador','enviada','aprobada','rechazada','facturada') NOT NULL DEFAULT 'borrador',
  invoice_id     INT UNSIGNED NULL,
  discount_type  ENUM('porcentaje','valor_fijo') NULL,
  discount_value DECIMAL(12, 2) NULL DEFAULT 0,
  notes          TEXT,
  created_by     INT UNSIGNED NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE quotation_items (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_id   INT UNSIGNED   NOT NULL,
  item_type      ENUM('sesion','magistral') NOT NULL,
  treatment_id   INT UNSIGNED   NULL,
  product_id     INT UNSIGNED   NULL,
  description    VARCHAR(255)   NOT NULL,
  quantity       DECIMAL(10, 2) NOT NULL DEFAULT 1,
  unit_price     DECIMAL(12, 2) NOT NULL,
  discount_type  ENUM('porcentaje','valor_fijo') NULL,
  discount_value DECIMAL(12, 2) NULL DEFAULT 0,
  FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
  FOREIGN KEY (treatment_id) REFERENCES treatments(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id)   REFERENCES products(id)   ON DELETE SET NULL
);

-- FK diferida: patient_treatments.quotation_id → quotations
ALTER TABLE patient_treatments
  ADD CONSTRAINT fk_pt_quotation
  FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE SET NULL;

-- FK diferida: patient_treatments.quotation_item_id → quotation_items
ALTER TABLE patient_treatments
  ADD CONSTRAINT fk_pt_quotation_item
  FOREIGN KEY (quotation_item_id) REFERENCES quotation_items(id) ON DELETE SET NULL;

-- ============================================================
-- MÓDULO 6 — FACTURACIÓN Y PAGOS
-- ============================================================

CREATE TABLE invoices (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id           INT UNSIGNED   NOT NULL,
  patient_treatment_id INT UNSIGNED   NULL,
  total_amount         DECIMAL(14, 2) NOT NULL,
  status               ENUM('pendiente','pagado','parcial') NOT NULL DEFAULT 'pendiente',
  created_at           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id)           REFERENCES patients(id),
  FOREIGN KEY (patient_treatment_id) REFERENCES patient_treatments(id) ON DELETE SET NULL
);

CREATE TABLE payments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id    INT UNSIGNED   NOT NULL,
  amount        DECIMAL(12, 2) NOT NULL,
  method        ENUM('efectivo','transferencia','datafono') NOT NULL,
  paid_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registered_by INT UNSIGNED   NOT NULL,
  FOREIGN KEY (invoice_id)    REFERENCES invoices(id),
  FOREIGN KEY (registered_by) REFERENCES users(id)
);

CREATE TABLE invoice_items (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id  INT UNSIGNED   NOT NULL,
  item_type   ENUM('sesion','magistral','descuento') NOT NULL, -- descuento: unit_price negativo
  session_id  INT UNSIGNED   NULL,
  product_id  INT UNSIGNED   NULL,
  description VARCHAR(255)   NOT NULL,
  quantity    DECIMAL(10, 2) NOT NULL DEFAULT 1,
  unit_price  DECIMAL(12, 2) NOT NULL,
  unit_cost      DECIMAL(12, 2) NULL,              -- magistral: precio de adquisición al facturar (margen)
  stock_shortage DECIMAL(10, 4) NOT NULL DEFAULT 0, -- magistral: cantidad facturada sin stock disponible
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)  ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id)  ON DELETE SET NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)  ON DELETE SET NULL
);

-- ============================================================
-- MÓDULO 7 — GASTOS Y TARIFAS
-- ============================================================

CREATE TABLE expense_categories (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE fixed_expenses (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id   INT UNSIGNED   NOT NULL,
  month         VARCHAR(7)     NOT NULL,  -- formato YYYY-MM
  amount        DECIMAL(12, 2) NOT NULL,
  registered_by INT UNSIGNED   NOT NULL,
  UNIQUE KEY uq_category_month (category_id, month),
  FOREIGN KEY (category_id)   REFERENCES expense_categories(id),
  FOREIGN KEY (registered_by) REFERENCES users(id)
);

CREATE TABLE occasional_expenses (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(150)   NOT NULL,
  description   TEXT           NULL,
  amount        DECIMAL(12, 2) NOT NULL,
  expense_date  DATE           NOT NULL,
  registered_by INT UNSIGNED   NOT NULL,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (registered_by) REFERENCES users(id)
);

CREATE TABLE professional_rates (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  service_type   ENUM('medicina_estetica','tricologia','medicina_alternativa','medicina_integral','medicina_oncologica') NOT NULL,
  hourly_rate    DECIMAL(12, 2) NOT NULL,
  effective_from DATE           NOT NULL,
  effective_to   DATE           NULL  -- NULL = tarifa vigente
);

-- ============================================================
-- FK diferida: stock_exits.session_id → sessions
-- ============================================================
ALTER TABLE stock_exits
  ADD CONSTRAINT fk_exit_session
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;

-- ============================================================
-- FK diferida: stock_exits.invoice_item_id → invoice_items
-- ============================================================
ALTER TABLE stock_exits
  ADD CONSTRAINT fk_exit_invoice_item
  FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id) ON DELETE SET NULL;

-- ============================================================
-- DATOS INICIALES
-- ============================================================

INSERT INTO roles (name) VALUES ('admin'), ('vendedor'), ('bodeguero');

-- Usuario admin por defecto (password: admin123 — cambiar en producción)
-- Hash bcrypt de 'admin123'
INSERT INTO users (name, email, password_hash)
VALUES ('Administrador', 'admin@consultorio.com', '$2a$12$n8jHxsIps9n3/Nq5JMgg9e.ezNaDDVSbkBdq5sAscyT1jK/VELfPa');

-- Asignar rol admin al usuario inicial
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.email = 'admin@consultorio.com' AND r.name = 'admin';

-- Permisos por defecto para admin (todos los módulos)
INSERT INTO module_permissions (role_id, module_name)
SELECT r.id, m.module_name
FROM roles r
CROSS JOIN (
  SELECT 'usuarios'    AS module_name UNION ALL
  SELECT 'inventario'  UNION ALL
  SELECT 'pacientes'   UNION ALL
  SELECT 'agenda'      UNION ALL
  SELECT 'cotizaciones' UNION ALL
  SELECT 'pagos'       UNION ALL
  SELECT 'reportes'    UNION ALL
  SELECT 'gastos'
) m
WHERE r.name = 'admin';
