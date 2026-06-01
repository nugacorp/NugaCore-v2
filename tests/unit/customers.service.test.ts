import { describe, it, expect, beforeEach } from 'vitest';
import type { Client } from '../../src/types';
import type { ClientTimelineEvent } from '../../backend/state/store';
import {
  CustomersRepository,
  CustomerFilters,
} from '../../backend/domains/customers/repository';
import { CustomersService } from '../../backend/domains/customers/service';

// Repo falso en memoria para probar el service de forma aislada (sin Supabase).
class FakeRepo implements CustomersRepository {
  clients: Client[] = [];
  timeline: ClientTimelineEvent[] = [];
  private seq = 0;

  async list(filters: CustomerFilters): Promise<Client[]> {
    return this.clients.filter((c) => (!filters.status || c.status === filters.status));
  }
  async findById(id: string): Promise<Client | null> {
    return this.clients.find((c) => c.id === id) ?? null;
  }
  async create(client: Client): Promise<Client> {
    this.clients.push(client);
    return client;
  }
  async update(id: string, patch: Partial<Client>): Promise<Client | null> {
    const i = this.clients.findIndex((c) => c.id === id);
    if (i === -1) return null;
    this.clients[i] = { ...this.clients[i], ...patch };
    return this.clients[i];
  }
  async remove(id: string): Promise<boolean> {
    const before = this.clients.length;
    this.clients = this.clients.filter((c) => c.id !== id);
    this.timeline = this.timeline.filter((e) => e.clientId !== id);
    return this.clients.length < before;
  }
  async generateId(): Promise<string> {
    this.seq += 1;
    return `c-${this.seq}`;
  }
  async listTimeline(clientId: string): Promise<ClientTimelineEvent[]> {
    return this.timeline.filter((e) => e.clientId === clientId);
  }
  async addTimelineEvent(event: Omit<ClientTimelineEvent, 'id' | 'createdAt'>): Promise<void> {
    this.timeline.push({ ...event, id: `ct-${this.timeline.length + 1}`, createdAt: 'now' });
  }
}

const baseClient = (id: string): Client => ({
  id,
  name: 'Test',
  type: 'residential',
  status: 'active',
  email: 'a@b.com',
  phone: '555',
  address: 'calle',
  city: 'CDMX',
  lat: 0,
  lng: 0,
  planId: 'plan-basic',
  ip: '0.0.0.0',
});

describe('CustomersService (repo falso)', () => {
  let repo: FakeRepo;
  let service: CustomersService;

  beforeEach(() => {
    repo = new FakeRepo();
    service = new CustomersService(repo);
  });

  it('validateCreate acepta payload válido y devuelve el tipo', () => {
    const out = service.validateCreate({ name: 'A', type: 'residential', address: 'x', city: 'CDMX' });
    expect(out.type).toBe('residential');
  });

  it('validateCreate rechaza campos faltantes', () => {
    expect(() => service.validateCreate({ name: 'A', type: 'residential' })).toThrowError(/Missing required fields/);
  });

  it('validateCreate rechaza tipo inválido', () => {
    expect(() => service.validateCreate({ name: 'A', type: 'alien', address: 'x', city: 'CDMX' })).toThrowError(/Invalid client type/);
  });

  it('validateCreate rechaza email inválido', () => {
    expect(() => service.validateCreate({ name: 'A', type: 'residential', address: 'x', city: 'CDMX', email: 'no-es-email' })).toThrowError(/Invalid email/);
  });

  it('validateUpdate rechaza status inválido', () => {
    expect(() => service.validateUpdate({ status: 'zombie' })).toThrowError(/Invalid client status/);
  });

  it('create + getById + list delegan en el repo', async () => {
    await service.create(baseClient('c-1'));
    expect(await service.getById('c-1')).not.toBeNull();
    expect((await service.list({})).length).toBe(1);
  });

  it('update aplica el patch', async () => {
    await service.create(baseClient('c-1'));
    const updated = await service.update('c-1', { status: 'suspended' });
    expect(updated?.status).toBe('suspended');
  });

  it('remove elimina cliente y su timeline', async () => {
    await service.create(baseClient('c-1'));
    await service.addTimelineEvent({ clientId: 'c-1', eventType: 'created', summary: 's' });
    expect(await service.remove('c-1')).toBe(true);
    expect(await service.getById('c-1')).toBeNull();
    expect((await service.getHistory('c-1')).length).toBe(0);
  });

  it('generateClientId delega en el repo', async () => {
    expect(await service.generateClientId()).toBe('c-1');
    expect(await service.generateClientId()).toBe('c-2');
  });
});
