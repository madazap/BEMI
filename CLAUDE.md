# Contexto del Proyecto — Sistema Administrativo Consultorio

## Descripción
Sistema web administrativo para un consultorio de tricología y estética. Reemplaza procesos manuales (Excel, papel) con una plataforma centralizada para gestión de inventario, pacientes, agenda, cotizaciones, pagos y métricas de rentabilidad.

## Stack
- **Frontend:** JavaScript, diseño responsivo (PC + móvil)
- **Backend:** Node.js / JavaScript
- **Base de datos:** MySQL
- **Hosting:** estándar (sin infraestructura costosa)

## Usuarios y Roles
- 3 roles: `admin`, `vendedor`, `bodeguero`
- Un usuario puede tener múltiples roles simultáneos
- El administrador controla qué módulos son visibles por rol
- Arrancar con un solo profesional médico

---

## Módulos

### 1. Usuarios y Roles
- CRUD usuarios, asignación de roles, autenticación con sesión (login/logout)
- Verificación en dos pasos (TOTP) opcional por usuario, auto-gestionada desde `/mi-cuenta/2fa`: código QR (librería `otplib` + `qrcode`, sin costo ni servicio externo), confirmación con el primer código antes de activarla. Si el usuario tiene 2FA activo, el login pasa por un segundo paso (`/login/2fa`) antes de crear la sesión. Un admin puede forzar la desactivación del 2FA de otro usuario (recuperación por pérdida de dispositivo) desde `/usuarios/:id/editar`.
- Tabla `module_permissions` controla acceso por rol a cada módulo

### 2. Inventario y Stock
- Catálogo de productos sin límite de SKUs (inicia ~150, diseñado para crecer)
- Campos por producto: SKU único, nombre genérico, nombre comercial, presentación, concentración, fabricante, registro sanitario
- Unidad de compra + unidad de consumo + factor de conversión (parametrizables por producto)
  - Stock siempre almacenado y gestionado en unidad de consumo
  - Al ingresar: `consumption_quantity = purchase_quantity × conversion_factor`
  - Si compra = consumo, factor = 1
- Registro de lotes por entrada: número de lote, fecha de vencimiento, fecha de ingreso, valor de compra unitario (en unidad de consumo)
- `total_cost` por entrada = `consumption_quantity × purchase_price` → se registra automáticamente como gasto del consultorio
- Salidas por sesión con trazabilidad FEFO (referencia al lote específico)
- Stock mínimo parametrizable por producto (en unidad de consumo)
- Alertas configurables: vencimiento (X días antes) y stock mínimo
- Medicamentos magistrales: flag `is_magistral = true`, tienen `sale_price` y `acquisition_price` propios
- CRUD proveedores

### 3. CRM de Pacientes
- Datos personales del paciente (no historia clínica — va en físico por regulación)
- Tratamientos con múltiples sesiones, tipos: `medicina_estetica`, `tricologia`, `medicina_alternativa`, `medicina_integral`, `medicina_oncologica` (etiquetas en `TREATMENT_TYPES`, `src/config/constants.js`)
- Por sesión: insumos consumidos → descuento automático del inventario por lote (FEFO). **El consumo ocurre únicamente al marcar la sesión como realizada** (`/sesiones/:id/realizar`): se precargan los insumos estándar del tratamiento (`treatment_products`), editables, y se pueden añadir productos adicionales (`session_products.is_extra = 1`). Si no alcanza el stock se permite registrar con advertencia; el faltante queda en `session_products` con `stock_entry_id = NULL`. Ni la cotización ni la factura consumen insumos de sesiones.
- Costo real de sesión = insumos consumidos + mano de obra profesional
- Al realizar sesión → snapshot de costos vigentes guardado (`session_margin_snapshots`)
- **Magistrales adquiridos** (ficha del paciente): se calculan desde la facturación (no hay recetas manuales; la antigua tabla `prescriptions` se eliminó). Historial de compras (fecha, cantidad, valor facturado, factura) y resumen por magistral con renovación: cada unidad cubre 30 días, cobertura encadenada entre compras; alerta "Por renovar" 5 días antes, "Vencida" después (constantes en `src/config/constants.js`). "No renovar" apaga la alerta (`magistral_renewal_dismissals`) hasta una nueva compra. Alertas en notificaciones y dashboard (`MagistralRenewal.pendingAlerts`).

### 4. Agenda y Citas
- Calendario del profesional (vista día/semana/mes)
- Toda cita se agenda exclusivamente desde una sesión de un plan de tratamiento asignado al paciente (`patient_treatments` → `sessions`). No existe creación de citas sueltas/libres.
- Estados: `agendada`, `confirmada`, `realizada`, `cancelada`
- Recordatorios de citas → dirigidos al médico
- Notificaciones de stock mínimo y vencimientos → todos los roles
- Campo `google_event_id` en `appointments` para sincronización Google Calendar (OAuth — deseable v1)
- Recordatorios por WhatsApp → FUTURO

### 5. Cotizaciones y Precios
- Lista de precios parametrizable por admin
- Cotización por paciente con líneas tipo `sesion` o `magistral`
- Descuentos por línea o sobre el total
- Exportar a PDF
- Flujo: borrador → enviada → revisión/modificación → aprobada → plan de tratamiento
- Al aprobar (con modal de confirmación) se crea un `patient_treatments` por cada línea `sesion` (`quotation_item_id`), con `treatments.total_sessions × quantity` sesiones en estado `pendiente`. Si el tratamiento tiene `requires_control = 1` se añade **una sola** sesión extra al final (`sessions.is_control = 1`, etiqueta "Control"), sin importar la cantidad. Una cotización aprobada ya no se puede reabrir ni rechazar.
- Historial de cotizaciones por paciente

### 5b. Catálogo de Tratamientos y Márgenes
- ~70 tratamientos con `sale_price` y `execution_cost` editables por admin
- `execution_cost` incluye: insumos + aplicación + otros costos asociados
- `margin` calculado automáticamente: `sale_price − execution_cost`
- Al realizar una sesión se guarda snapshot: `sale_price_at_time`, `execution_cost_at_time`, `margin_at_time`, `recorded_at`
- Sesiones pasadas conservan su snapshot; cambios futuros no las afectan
- **Sesión de control** (`treatments.requires_control`, checkbox en el formulario): el plan recibe una sesión final `is_control = 1`, incluida en el precio (no se cobra aparte). Al realizarla no se precargan insumos estándar (solo adicionales) y **no** genera `session_margin_snapshots`. El progreso en la ficha del paciente se muestra "N / M + control". Cambiar el flag solo afecta planes creados después.
- Dashboard usa snapshots para margen histórico por tratamiento y período

### 6. Facturación y Pagos
- Medios: `efectivo`, `transferencia`, `datafono`
- Planes: por sesión o por paquete completo
- Recibo de caja digital exportable a PDF
- Estado de cuenta por paciente (pagado / pendiente / parcial)
- Venta de magistrales genera ingreso + descuento de inventario (FEFO, `stock_exits.reason='venta'`, referenciando la línea de factura vía `invoice_item_id`)
- Por norma colombiana el consultorio no es farmacia y no puede vender medicamentos por nombre: los magistrales son apoyo a los tratamientos. Toda línea de factura con `item_type='magistral'` se guarda con `description = 'Continuidad terapéutica'` (constante `MAGISTRAL_LABEL` en `src/config/constants.js`), sin importar cuál magistral sea ni su origen. El PDF de la cotización también muestra 'Continuidad terapéutica' en esas líneas. El valor facturado/cotizado es el de la línea (por defecto `sale_price`). El `product_id` real se conserva para trazabilidad interna (visible solo en `/cotizaciones/:id`, `/facturas/:id` y el dashboard, nunca en PDF/recibo).
- Al facturar desde una cotización, sus descuentos (por línea y global) pasan a la factura como líneas aparte `item_type='descuento'` con `unit_price` negativo (`Invoice.linesFromQuotation`), de modo que el total facturado = total cotizado. Un descuento sobre una línea de magistral conserva `product_id` y se resta del margen de ese magistral.
- Se permite facturar magistrales sin stock suficiente: sale lo disponible (FEFO) y el faltante queda en `invoice_items.stock_shortage`, con advertencia al usuario.
- Faltantes pendientes (ventas de magistral con `stock_shortage > 0` y `session_products` sin lote) se saldan automáticamente al registrar un ingreso de ese producto (`Stock.createEntry`), del más antiguo al más reciente, creando los `stock_exits` ligados a la factura/sesión original. `/inventario/movimientos` muestra los faltantes aún pendientes.
- Al facturar un magistral se guarda `invoice_items.unit_cost = products.acquisition_price` vigente (snapshot) para calcular el margen en el dashboard.
- Facturación electrónica DIAN → FUTURO

### 7. Reportes y Métricas (Dashboard)
- Ingresos del mes
- Tratamientos vendidos y agendados por período
- Rentabilidad por tratamiento usando `session_margin_snapshots`
- Margen por magistral: `(invoice_items.unit_price − invoice_items.unit_cost) × quantity` de magistrales facturados (KPI del mes + tabla últimos 3 meses)
- Métricas de vencimientos próximos

### 7b. Gestión de Gastos del Consultorio
- Categorías de gastos fijos parametrizables: se añaden y quitan libremente (`expense_categories`)
- Cada categoría activa genera registro mensual con su valor (`fixed_expenses`)
- Gastos ocasionales: registro libre de gastos puntuales con título, descripción, monto y fecha (`occasional_expenses`) — no requieren categoría
- Compras de insumos = gasto automático desde `stock_entries.total_cost` (sin tabla extra)
- Gastos totales del período = gastos fijos + gastos ocasionales + `SUM(stock_entries.total_cost)` del período
- Margen neto mensual = ingresos − gastos fijos − gastos ocasionales − compras de insumos − mano de obra
- Informe de Ingresos y Egresos (`/gastos/informe`): filtrable por rango de fechas. Ingresos = pagos de facturas (tratamientos facturados). Egresos = gastos fijos + gastos ocasionales del período, con el detalle de cada movimiento.

---

## Modelo de Base de Datos MySQL

### Módulo 1 — Usuarios
```sql
users (id, name, email UNIQUE, password_hash, totp_secret, totp_enabled, is_active, created_at)
roles (id, name)  -- 'admin' | 'vendedor' | 'bodeguero'
user_roles (user_id FK, role_id FK)
module_permissions (id, role_id FK, module_name)
```

### Módulo 2 — Inventario
```sql
suppliers (id, name, contact_name, phone, email, is_active)

products (
  id, sku UNIQUE,
  generic_name, commercial_name, presentation, concentration,
  manufacturer, sanitary_registry,
  purchase_unit, consumption_unit, conversion_factor,
  min_stock,            -- en unidades de consumo
  expiry_alert_days,
  is_magistral BOOL, sale_price, acquisition_price,
  is_active
)

stock_entries (
  id, product_id FK, supplier_id FK,
  lot_number, expiry_date,
  purchase_quantity,     -- en unidad de compra
  consumption_quantity,  -- calculado: purchase_quantity × conversion_factor
  purchase_price,        -- por unidad de consumo
  total_cost,            -- consumption_quantity × purchase_price → gasto automático
  entry_date,
  registered_by FK users
)

stock_exits (
  id, product_id FK, stock_entry_id FK,  -- lote específico FEFO
  quantity,              -- en unidades de consumo
  exit_date,
  reason ENUM('sesion','vencimiento','ajuste','venta'),  -- 'venta' = magistral facturado (sin sesión)
  session_id FK nullable,
  invoice_item_id FK nullable,  -- línea de factura que originó la salida (ventas de magistral)
  registered_by FK users
)
```

### Módulo 3 — CRM
```sql
patients (
  id, document_type, document_number UNIQUE,
  full_name, birth_date, phone, email, address, created_at
)

treatments (
  id, name,
  type ENUM('medicina_estetica','tricologia','medicina_alternativa','medicina_integral','medicina_oncologica'),
  description, total_sessions,
  requires_control BOOL,  -- añade una sesión de control al final del plan
  sale_price,       -- editable
  execution_cost,   -- editable
  margin,           -- calculado: sale_price − execution_cost
  is_active
)

treatment_products (
  id, treatment_id FK, product_id FK,
  quantity   -- consumo estándar por sesión, usado para precargar insumos al ejecutar
)

patient_treatments (
  id, patient_id FK, treatment_id FK,
  payment_plan ENUM('por_sesion','paquete'),
  status ENUM('activo','completado','cancelado'),
  start_date, quotation_id FK nullable, quotation_item_id FK nullable, created_by FK users
)

sessions (
  id, patient_treatment_id FK, session_number,
  is_control BOOL,     -- 1 = sesión de control final (sin snapshot de margen)
  scheduled_date, performed_date,
  status ENUM('pendiente','realizada','cancelada'),
  professional_hours, notes, attended_by FK users
)

session_products (
  id, session_id FK, product_id FK,
  stock_entry_id FK nullable,   -- lote consumido (FEFO); NULL = faltante sin stock
  quantity,            -- en unidades de consumo
  is_extra BOOL        -- 1 = producto adicional, fuera del estándar del tratamiento
)

session_margin_snapshots (
  id, session_id FK, treatment_id FK,
  sale_price_at_time,
  execution_cost_at_time,
  margin_at_time,      -- sale_price_at_time − execution_cost_at_time
  recorded_at
)

magistral_renewal_dismissals (
  id, patient_id FK, product_id FK,
  dismissed_at,        -- "No renovar"; una compra posterior reactiva la alerta
  dismissed_by FK users,
  UNIQUE (patient_id, product_id)
)
```

### Módulo 4 — Agenda
```sql
appointments (
  id, patient_id FK, session_id FK (obligatorio — toda cita nace de una sesión), professional_id FK users,
  scheduled_at DATETIME, duration_minutes,
  status ENUM('agendada','confirmada','realizada','cancelada'),
  google_event_id,   -- sincronización Google Calendar
  notes, created_by FK users
)
```

### Módulo 5 — Cotizaciones
```sql
quotations (
  id, patient_id FK,
  status ENUM('borrador','enviada','aprobada','rechazada'),
  discount_type ENUM('porcentaje','valor_fijo') nullable,
  discount_value, notes, created_by FK users, created_at
)

quotation_items (
  id, quotation_id FK,
  item_type ENUM('sesion','magistral'),
  treatment_id FK nullable, product_id FK nullable,
  description, quantity, unit_price,
  discount_type nullable, discount_value
)
```

### Módulo 6 — Pagos
```sql
invoices (
  id, patient_id FK, patient_treatment_id FK nullable,
  total_amount,
  status ENUM('pendiente','pagado','parcial'),
  created_at
)

payments (
  id, invoice_id FK, amount,
  method ENUM('efectivo','transferencia','datafono'),
  paid_at, registered_by FK users
)

invoice_items (
  id, invoice_id FK,
  item_type ENUM('sesion','magistral','descuento'),   -- descuento: unit_price negativo
  session_id FK nullable, product_id FK nullable,
  description, quantity, unit_price,
  unit_cost,       -- magistral: acquisition_price al facturar (snapshot para margen)
  stock_shortage   -- magistral: cantidad facturada sin stock disponible
)
```

### Módulo 7 — Gastos y Tarifas
```sql
expense_categories (
  id, name, is_active, created_by FK users
)

fixed_expenses (
  id, category_id FK expense_categories,
  month VARCHAR(7),   -- formato YYYY-MM
  amount,
  registered_by FK users
)

occasional_expenses (
  id, title, description, amount,
  expense_date DATE,
  registered_by FK users, created_at
)

-- Gastos de insumos: no tabla propia
-- Se calculan con: SELECT SUM(total_cost) FROM stock_entries WHERE entry_date BETWEEN ...

professional_rates (
  id,
  service_type ENUM('medicina_estetica','tricologia','medicina_alternativa','medicina_integral','medicina_oncologica'),
  hourly_rate,
  effective_from DATE,
  effective_to DATE nullable   -- null = tarifa vigente actual
)
```

---

## Decisiones de diseño
- Stock siempre en unidad de consumo; conversión ocurre al ingresar
- `stock_entries.total_cost` es el gasto automático de compras, no requiere tabla extra
- `session_margin_snapshots` preserva costos históricos por sesión realizada
- `expense_categories` es libre y parametrizable, sin categorías hardcodeadas
- Magistrales en `products` con `is_magistral = true`
- `professional_rates` global con historial por `effective_from/to`
- Historia clínica no se almacena en el sistema (regulación — va en físico)

## Integraciones
- Google Calendar (OAuth) — deseable v1, campo `google_event_id` ya en BD
- WhatsApp recordatorios — FUTURO
- Facturación electrónica DIAN — FUTURO

## Orden de desarrollo
1. Scripts SQL de creación de BD
2. Módulo Usuarios y Roles
3. Módulo Inventario
4. Módulos CRM + Agenda (en paralelo)
5. Módulos Cotizaciones + Pagos
6. Dashboard de métricas
