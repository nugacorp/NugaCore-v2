import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CRM — eliminar cliente permanente', () => {
  const crm = readFileSync('src/components/CrmModule.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');

  it('expone botón de borrado permanente en la ficha', () => {
    expect(crm).toContain('id="delete-client-permanent"');
    expect(crm).toContain('Eliminar permanentemente');
    expect(crm).toContain('onDeleteClient');
    expect(crm).toContain('canDeleteClient');
  });

  it('App cablea DELETE /api/clients/:id para admin', () => {
    expect(app).toContain('handleDeleteClient');
    expect(app).toContain("method: 'DELETE'");
    expect(app).toContain('onDeleteClient={handleDeleteClient}');
    expect(app).toContain("canDeleteClient={['Super Admin', 'Administrador'].includes(userSession.role)}");
  });
});
