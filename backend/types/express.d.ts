import type { AuthContext } from '../common/auth-context';
import type { Logger } from '../common/logger';

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
      /** Correlation ID por petición (entrante X-Request-Id o generado). */
      requestId?: string;
      /** Logger con el requestId adjunto. */
      log?: Logger;
    }
  }
}

export {};
