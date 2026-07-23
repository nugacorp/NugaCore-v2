import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// T4 — UI multi-tenant WireGuard. Patrón *.ui.test.ts (contrato de fuente):
// verifica que los componentes expongan bloque del tenant, cuota, estados de
// apply del peer (pending/failed/active), reintento, solo-lectura de servidor
// y la IP sugerida del bloque en el wizard.
// ====================================================================

describe('WireguardManagerModule — multi-tenant UI', () => {
  const source = readFileSync('src/components/WireguardManagerModule.tsx', 'utf8');

  it('muestra el bloque /24 del tenant y el uso de cuota (n/max)', () => {
    expect(source).toContain('id="wg-tenant-block"');
    expect(source).toContain('Bloque asignado');
    expect(source).toContain('Uso de equipos');
    expect(source).toContain('tenantBlock.subnetCidr');
    expect(source).toContain('tenantBlock.used');
    expect(source).toContain('tenantBlock.maxPeers');
  });

  it('renderiza los estados de apply del peer: aplicando / falló / activo', () => {
    expect(source).toContain('pending_apply');
    expect(source).toContain('apply_failed');
    expect(source).toContain('aplicando');
    expect(source).toContain('falló apply');
    expect(source).toContain("applied: { label: 'activo'");
  });

  it('ofrece Reintentar sólo cuando el apply falló', () => {
    expect(source).toContain('id={`wg-retry-${p.id}`}');
    expect(source).toContain("p.applyState === 'apply_failed'");
    expect(source).toContain('Reintentar');
    expect(source).toContain('onRetryPeer');
  });

  it('servidor en solo lectura para roles no-plataforma en multi-tenant', () => {
    expect(source).toContain('canManageServers');
    expect(source).toContain("userRole === 'Super Admin'");
    expect(source).toContain('id="wg-server-readonly"');
    expect(source).toContain('solo lectura');
  });

  it('avisa cuando la config del peer aún no está activa', () => {
    expect(source).toContain('id="wg-config-not-active"');
    expect(source).toContain('aún no está activo');
    expect(source).toContain("secret.data.peer.applyState !== 'applied'");
  });

  it('bloquea el alta y muestra el límite comercial al agotar la cuota', () => {
    expect(source).toContain('quotaFull');
    expect(source).toContain('Límite de');
    expect(source).toContain('equipos del plan');
  });
});

describe('RouterEnrollmentWizard — paso Servidor WireGuard', () => {
  const source = readFileSync('src/components/RouterEnrollmentWizard.tsx', 'utf8');

  it('sugiere la IP del bloque del WISP y explica el servidor compartido', () => {
    expect(source).toContain('id="wg-suggested-ip"');
    expect(source).toContain('IP sugerida');
    expect(source).toContain('/api/wireguard/next-ip?serverId=');
    expect(source).toContain('recurso compartido de plataforma');
  });

  it('lista los servidores del catálogo (servidor global visible al WISP)', () => {
    // Con T3 el endpoint devuelve el singleton global; el wizard lo renderiza.
    expect(source).toContain("api.get('/api/wireguard/servers')");
    expect(source).toContain('servers.map((srv)');
  });
});
