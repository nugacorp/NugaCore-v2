import { describe, expect, it } from 'vitest';
import {
  EmailMockProvider,
  InAppMockProvider,
  PushMockProvider,
  TelegramMockProvider,
  WhatsAppMockProvider,
  allProviders,
  providerForChannel,
} from '../../backend/domains/notifications/providers';

const ALL = [
  WhatsAppMockProvider,
  TelegramMockProvider,
  EmailMockProvider,
  PushMockProvider,
  InAppMockProvider,
];

describe('notifications mock providers (FASE E)', () => {
  it('los 5 providers mock devuelven dryRun/provider=mock/wouldSend/sent=false', () => {
    for (const provider of ALL) {
      const result = provider.preview('hola mundo');
      expect(result.provider).toBe('mock');
      expect(result.dryRun).toBe(true);
      expect(result.wouldSend).toBe(true);
      expect(result.sent).toBe(false);
      expect(result.renderedBody).toBe('hola mundo');
      expect(result.channel).toBe(provider.channel);
    }
  });

  it('allProviders expone exactamente 5 canales', () => {
    const channels = allProviders().map((p) => p.channel).sort();
    expect(channels).toEqual(['EMAIL', 'IN_APP', 'PUSH', 'TELEGRAM', 'WHATSAPP']);
  });

  it('providerForChannel resuelve el provider correcto', () => {
    expect(providerForChannel('WHATSAPP').name).toBe('WhatsAppMockProvider');
    expect(providerForChannel('TELEGRAM').name).toBe('TelegramMockProvider');
    expect(providerForChannel('EMAIL').name).toBe('EmailMockProvider');
    expect(providerForChannel('PUSH').name).toBe('PushMockProvider');
    expect(providerForChannel('IN_APP').name).toBe('InAppMockProvider');
  });

  it('ningún provider marca sent=true', () => {
    expect(allProviders().every((p) => p.preview('x').sent === false)).toBe(true);
  });
});
