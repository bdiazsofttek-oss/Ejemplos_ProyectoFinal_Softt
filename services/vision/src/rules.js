// Este evaluador es compartido por el adaptador demo y el futuro adaptador DINO/SAM.
// Recibe observaciones; no identifica personas ni ejecuta inferencia.
export function evaluateObservation({ guests, waiterPresent, dishDelivered, secondsSinceService }, thresholdSeconds) {
  if (!Number.isInteger(guests) || guests < 0 || !Number.isFinite(secondsSinceService) || secondsSinceService < 0) throw new Error('Observación inválida');
  return { unattended: guests > 0 && !waiterPresent && !dishDelivered && secondsSinceService >= thresholdSeconds, attended: Boolean(waiterPresent || dishDelivered) };
}
