import type { AuthContext, AuthContextFailure } from '../common/auth-context';
import type { Logger } from '../common/logger';

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
      /** Denegación de tenant tipada; nunca representa autorización. */
      authContextFailure?: AuthContextFailure;
      /** Correlation ID por petición (entrante X-Request-Id o generado). */
      requestId?: string;
      /** Logger con el requestId adjunto. */
      log?: Logger;
    }
  }
}

export {};
