// ====================================================================
// Notification mock providers (PROD-9 / FASE E).
//
// Cada provider es MOCK: nunca contacta APIs externas. Su unica operacion
// (`preview`) describe que se enviaria, devolviendo siempre:
//   dryRun=true, provider='mock', wouldSend=true, sent=false.
// No hay ninguna primitiva de entrega real en este archivo.
// ====================================================================

import { deliverNotification } from './providers-deliver';
import { NotificationChannel, ProviderPreviewResult } from './types';

export interface NotificationMockProvider {
  channel: NotificationChannel;
  name: string;
  preview(renderedBody: string): ProviderPreviewResult;
  deliver?(renderedBody: string): ProviderPreviewResult;
}

const buildPreview = (
  channel: NotificationChannel,
  name: string,
  renderedBody: string,
  live = false,
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

const buildDeliver = (
  channel: NotificationChannel,
  name: string,
  renderedBody: string,
): ProviderPreviewResult => deliverNotification(channel, name, renderedBody);

export const WhatsAppMockProvider: NotificationMockProvider = {
  channel: 'WHATSAPP',
  name: 'WhatsAppMockProvider',
  preview: (body) => buildPreview('WHATSAPP', 'WhatsAppMockProvider', body),
  deliver: (body) => buildDeliver('WHATSAPP', 'WhatsAppMockProvider', body),
};

export const TelegramMockProvider: NotificationMockProvider = {
  channel: 'TELEGRAM',
  name: 'TelegramMockProvider',
  preview: (body) => buildPreview('TELEGRAM', 'TelegramMockProvider', body),
};

export const EmailMockProvider: NotificationMockProvider = {
  channel: 'EMAIL',
  name: 'EmailMockProvider',
  preview: (body) => buildPreview('EMAIL', 'EmailMockProvider', body),
};

export const PushMockProvider: NotificationMockProvider = {
  channel: 'PUSH',
  name: 'PushMockProvider',
  preview: (body) => buildPreview('PUSH', 'PushMockProvider', body),
};

export const InAppMockProvider: NotificationMockProvider = {
  channel: 'IN_APP',
  name: 'InAppMockProvider',
  preview: (body) => buildPreview('IN_APP', 'InAppMockProvider', body),
};

const REGISTRY: Record<NotificationChannel, NotificationMockProvider> = {
  WHATSAPP: WhatsAppMockProvider,
  TELEGRAM: TelegramMockProvider,
  EMAIL: EmailMockProvider,
  PUSH: PushMockProvider,
  IN_APP: InAppMockProvider,
};

export const providerForChannel = (channel: NotificationChannel): NotificationMockProvider =>
  REGISTRY[channel];

export const allProviders = (): NotificationMockProvider[] => Object.values(REGISTRY);
