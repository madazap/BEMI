-- Nuevos tipos de tratamiento / servicio. Los tratamientos existentes pasan todos a 'tricologia'.
-- professional_rates.service_type usa los mismos tipos (cálculo de mano de obra por tipo).
ALTER TABLE treatments         MODIFY type         ENUM('A_capilar','B_piel','C_implante','medicina_estetica','tricologia','medicina_alternativa','medicina_integral','medicina_oncologica') NOT NULL;
ALTER TABLE professional_rates MODIFY service_type ENUM('A_capilar','B_piel','C_implante','medicina_estetica','tricologia','medicina_alternativa','medicina_integral','medicina_oncologica') NOT NULL;

UPDATE treatments         SET type = 'tricologia'         WHERE type IN ('A_capilar','B_piel','C_implante');
UPDATE professional_rates SET service_type = 'tricologia' WHERE service_type IN ('A_capilar','B_piel','C_implante');

ALTER TABLE treatments         MODIFY type         ENUM('medicina_estetica','tricologia','medicina_alternativa','medicina_integral','medicina_oncologica') NOT NULL;
ALTER TABLE professional_rates MODIFY service_type ENUM('medicina_estetica','tricologia','medicina_alternativa','medicina_integral','medicina_oncologica') NOT NULL;
