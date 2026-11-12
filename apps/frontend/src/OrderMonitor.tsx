import { useEffect, useState } from 'react';
import { Order, money } from './api';

const stageNames = ['Pedido recibido', 'Reserva de stock', 'Autorización de pago', 'Resolución de saga'];
const stageServices = ['ms-pedidos', 'ms-catalogo', 'Kafka · ms-pagos · pasarela', 'ms-pedidos · ms-catalogo'];
const stepNames: Record<string, string> = {
  reservando: 'Reservando existencias en Catálogo',
  esperando_pago: 'Esperando el resultado de Pagos por Kafka',
  consolidando: 'Consolidando la reserva aprobada',
  liberando: 'Liberando la reserva tras un rechazo',
  revirtiendo_pago: 'Solicitando reversión del cobro aprobado',
  reversion_pendiente: 'Reversión pendiente; Pagos reintentará',
  finalizado: 'Saga finalizada',
};

function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function OrderMonitor({ order, onRefresh, pollError }: { order: Order; onRefresh: () => void; pollError: string }) {
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const pending = order.status === 'pendiente';
  const startedAt = Date.parse(order.createdAt);
  const finishedAt = pending ? now : Date.parse(order.updatedAt);
  const elapsed = Number.isFinite(startedAt) && Number.isFinite(finishedAt) ? duration(finishedAt - startedAt) : '—';
  const stockRejected = order.status === 'rechazado' && order.items.length > 0 && order.items.every((item) => item.unitPriceCents == null);
  const paymentRejected = order.internalStatus === 'liberando' || (order.status === 'rechazado' && !stockRejected && !/revertido/i.test(order.rejectionReason ?? ''));
  const activeIndex = pending ? order.internalStatus === 'reservando' ? 1 : order.internalStatus === 'esperando_pago' ? 2 : 3 : 3;
  const currentStep = pending ? stepNames[order.internalStatus] ?? order.internalStatus : order.status === 'confirmado' ? 'Pago aprobado y stock consolidado' : stockRejected ? 'Sin stock; cobro no solicitado' : 'Pedido rechazado; consulta el motivo';

  useEffect(() => {
    setNow(Date.now());
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [order.id, pending]);

  async function copyId() {
    try { await navigator.clipboard.writeText(order.correlationId); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  }

  return <section className="card monitor">
    <div className="monitor-head">
      <div><p className="section-kicker">Seguimiento en tiempo real</p><h2>Trayecto del pedido</h2><p>Los pasos muestran el estado devuelto por <strong>ms-pedidos</strong>; el cronómetro mide tiempo real.</p></div>
      <div className="monitor-actions"><span className={`state-pill ${order.status}`} aria-live="polite">{pending && <i className="live-dot" />}{order.status}</span><button type="button" className="secondary" onClick={onRefresh}>Consultar ahora</button></div>
    </div>
    <div className="monitor-metrics">
      <div><span>Tiempo desde la creación</span><strong className="timer">{elapsed}</strong></div>
      <div><span>Etapa actual</span><strong>{currentStep}</strong></div>
      <div><span>Total calculado</span><strong>{order.items.some((item) => item.unitPriceCents != null) ? money(order.totalCents, order.currency) : 'Pendiente de reserva'}</strong></div>
    </div>
    <div className="flow-stages" aria-label="Etapas de la saga">
      {stageNames.map((name, index) => {
        const state = stockRejected && index === 2 ? 'skipped' : stockRejected && index === 1 ? 'failed' : paymentRejected && index === 2 ? 'failed' : index < activeIndex ? 'done' : index === activeIndex ? pending ? 'active' : 'done' : 'waiting';
        return <div className={`flow-stage ${state}`} key={name}>
          <span className="stage-number">{index + 1}</span><div><strong>{name}</strong><small>{stageServices[index]}</small></div>
        </div>;
      })}
    </div>
    <div className="monitor-detail">
      <div><span className="field-label">Pedido</span><code>{order.id}</code></div>
      <div><span className="field-label">Correlación para logs</span><code>{order.correlationId}</code><button type="button" className="text-action" onClick={() => void copyId()}>{copied ? 'Copiado' : 'Copiar ID'}</button></div>
    </div>
    {pollError && <p className="poll-warning" role="status">No se pudo actualizar el pedido: {pollError}. Se volverá a intentar automáticamente.</p>}
    {order.rejectionReason && <p className="rejection-reason"><strong>Motivo:</strong> {order.rejectionReason}</p>}
    <div className="history-head"><h3>Historial persistido</h3><span>{pending ? 'Consulta automática cada 0,8 s' : 'Estado final'}</span></div>
    <ol className="history-list">{order.history.map((entry, index) => <li key={`${entry.createdAt}-${index}`}><span className="history-marker" /><div><strong>{entry.toStatus}</strong><p>{entry.reason}</p></div><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('es-BO')}</time></li>)}</ol>
    <p className="monitor-note">Las etapas internas pueden cambiar sin crear una transición pública; el historial registra únicamente los cambios de estado del pedido.</p>
  </section>;
}
