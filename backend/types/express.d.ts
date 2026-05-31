import type { AuthContext } from '../common/auth-context';

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}

export {};
