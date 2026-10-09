// Norma colombiana: el consultorio no es farmacia y no puede vender medicamentos por nombre.
// Toda línea de magistral se muestra con esta leyenda en documentos para el paciente
// (PDF de cotización y factura/recibo). El nombre real solo se ve en las vistas internas.
const MAGISTRAL_LABEL = 'Continuidad terapéutica';

// Renovación de magistrales adquiridos: cada unidad facturada cubre MAGISTRAL_DAYS_PER_UNIT días;
// la alerta "Por renovar" se activa MAGISTRAL_ALERT_DAYS días antes de terminar la cobertura.
const MAGISTRAL_DAYS_PER_UNIT = 30;
const MAGISTRAL_ALERT_DAYS    = 5;

// Tipos de tratamiento (treatments.type) y de servicio de las tarifas (professional_rates.service_type).
// El orden es el de las listas en pantalla. Si se agrega uno, también va en el ENUM de la BD.
const TREATMENT_TYPES = {
  medicina_estetica:    'Medicina Estética',
  tricologia:           'Tricología',
  medicina_alternativa: 'Medicina Alternativa',
  medicina_integral:    'Medicina Integral',
  medicina_oncologica:  'Medicina Oncológica'
};

module.exports = { MAGISTRAL_LABEL, MAGISTRAL_DAYS_PER_UNIT, MAGISTRAL_ALERT_DAYS, TREATMENT_TYPES };
