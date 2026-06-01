// ====================================================================
// Base de la capa Service.
//
// Un Service concentra las REGLAS DE NEGOCIO de un dominio (validaciones,
// efectos colaterales, orquestación) y delega la persistencia al Repository.
// Las rutas (HTTP/RBAC) llaman al service; el service nunca conoce Express.
//
// Fase 0: base mínima. La lógica que hoy vive dentro de las rutas se moverá
// aquí en Fase 1 (ver backend/core/README.md).
// ====================================================================

import { Repository } from './repository';

export abstract class DomainService<T, ID = string> {
  protected constructor(protected readonly repo: Repository<T, ID>) {}
}
