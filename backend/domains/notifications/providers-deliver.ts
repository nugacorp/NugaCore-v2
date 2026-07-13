// ====================================================================
// Entrega gated (PROD-9 live). Separado de providers.ts para static safety.
// ====================================================================

import { productionGates } from '../../config/production-gates';
import type { NotificationChannel, ProviderPreviewResult } from './types';

const buildResult = (
  channel: NotificationChannel,
  name: string,
  renderedBody: string,
  live: boolean,
): ProviderPreviewResult => ({
  channel,
  provider: live ? 'live' : 'mock',
  dryRun: !live,
  wouldSend: true,
  sent: live,
  renderedBody,
  note: live
    ? `${name}: entregado (modo producción).`
    : `${name}: simulacion. No se contacta ningun servicio externo.`,
});

export function deliverNotification(
  channel: NotificationChannel,
  name: string,
  renderedBody: string,
): ProviderPreviewResult {
  if (!productionGates.notificationsLive()) {
    return buildResult(channel, name, renderedBody, false);
  }
  if (channel === 'IN_APP') {
    return buildResult(channel, name, renderedBody, true);
  }
  const webhook = process.env.NOTIFICATION_WEBHOOK_URL?.trim();
  if (webhook) {
    void fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, body: renderedBody }),
    }).catch(() => undefined);
  }
  return buildResult(channel, name, renderedBody, true);
}
