import { randomUUID } from 'node:crypto';
import { evaluateObservation } from '../../vision/src/rules.js';
import { now, fail } from './platform-db.js';
import { table, restaurant, ensureVisit, queryAll } from './operations.js';

export function events(db, rid) { return queryAll(db, 'SELECT id, table_id AS tableId, event_type AS eventType, severity, source, payload_json AS payload, occurred_at AS occurredAt, acknowledged_at AS acknowledgedAt FROM vision_events WHERE restaurant_id = ? ORDER BY occurred_at DESC LIMIT 100', rid).map(e => ({ ...e, payload: JSON.parse(e.payload) })); }
export function ingestEvent(db, rid, input) {
  if (!['table_unattended', 'detection_summary'].includes(input.eventType)) fail('Tipo de evento inválido');
  if (input.tableId) table(db, rid, input.tableId);
  if (input.eventType === 'table_unattended' && !input.tableId) fail('Falta la mesa de la alerta');
  const id = randomUUID();
  if (input.eventType === 'table_unattended') {
    const prior = db.prepare('SELECT id FROM vision_events WHERE restaurant_id = ? AND table_id = ? AND event_type = ? AND acknowledged_at IS NULL').get(rid, input.tableId, input.eventType);
    if (prior) return events(db, rid).find(e => e.id === prior.id);
    if (table(db, rid, input.tableId).status === 'free') fail('No se puede alertar por una mesa libre');
    db.prepare("UPDATE restaurant_tables SET status = 'waiting' WHERE restaurant_id = ? AND id = ?").run(rid, input.tableId);
  }
  db.prepare('INSERT INTO vision_events (id, restaurant_id, table_id, event_type, severity, source, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, rid, input.tableId || null, input.eventType, input.severity || 'info', String(input.source || 'vision-adapter').slice(0, 100), JSON.stringify(input.payload || {}), now());
  return events(db, rid).find(e => e.id === id);
}
export function observeDemo(db, rid, input) {
  const t = table(db, rid, input.tableId); const config = restaurant(db, rid);
  if (!['arrive', 'wait', 'attend', 'dish'].includes(input.action)) fail('Escenario desconocido');
  if (input.action !== 'arrive' && t.status === 'free') fail('Primero ocupa la mesa o simula la llegada');
  ensureVisit(db, rid, t.id);
  const state = db.prepare('SELECT elapsed_seconds AS elapsedSeconds, guests FROM vision_state WHERE restaurant_id = ? AND table_id = ?').get(rid, t.id) || { elapsedSeconds: 0, guests: Math.min(t.seats, 2) };
  const elapsed = input.action === 'wait' ? state.elapsedSeconds + config.thresholdSeconds + 1 : 0;
  const observation = { guests: input.action === 'arrive' ? Math.min(t.seats, 2) : state.guests, waiterPresent: input.action === 'attend', dishDelivered: input.action === 'dish', secondsSinceService: elapsed };
  const result = evaluateObservation(observation, config.thresholdSeconds);
  db.prepare('INSERT INTO vision_state VALUES (?, ?, ?, ?) ON CONFLICT(restaurant_id, table_id) DO UPDATE SET elapsed_seconds = excluded.elapsed_seconds, guests = excluded.guests').run(rid, t.id, elapsed, observation.guests);
  const payload = { ...observation, inference: false, mode: 'guided-demo', frameIndex: Number.isInteger(input.frameIndex) ? input.frameIndex : 0, classes: { diners: observation.guests, waiters: observation.waiterPresent ? 1 : 0, tables: 1, dishes: observation.dishDelivered ? 1 : 0 } };
  if (result.attended) {
    db.prepare('UPDATE restaurant_tables SET last_service_at = ?, status = CASE WHEN status = ? THEN ? ELSE status END WHERE restaurant_id = ? AND id = ?').run(now(), 'waiting', 'occupied', rid, t.id);
    db.prepare('UPDATE table_visits SET first_service_at = COALESCE(first_service_at, ?) WHERE restaurant_id = ? AND table_id = ? AND closed_at IS NULL').run(now(), rid, t.id);
    db.prepare('UPDATE vision_events SET acknowledged_at = ? WHERE restaurant_id = ? AND table_id = ? AND acknowledged_at IS NULL').run(now(), rid, t.id);
  }
  const event = ingestEvent(db, rid, { tableId: t.id, eventType: result.unattended ? 'table_unattended' : 'detection_summary', severity: result.unattended ? 'warning' : 'info', source: 'simulacion.1/guided-demo', payload });
  return { observation, result, event, table: table(db, rid, t.id) };
}
