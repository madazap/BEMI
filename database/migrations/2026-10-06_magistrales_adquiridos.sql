-- Se elimina la función de recetas magistrales manuales (tabla prescriptions, sin datos).
-- La ficha del paciente ahora muestra los magistrales adquiridos a partir de la facturación,
-- con alerta de renovación (30 días por unidad, aviso 5 días antes).
-- magistral_renewal_dismissals guarda los magistrales marcados "No renovar" por paciente;
-- una compra posterior a dismissed_at reactiva la alerta automáticamente.
DROP TABLE IF EXISTS prescriptions;

CREATE TABLE IF NOT EXISTS magistral_renewal_dismissals (
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
