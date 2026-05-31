export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: string;
}

export const apiSuccess = <T>(data: T): ApiSuccess<T> => ({ ok: true, data });
export const apiFailure = (error: string): ApiFailure => ({ ok: false, error });
