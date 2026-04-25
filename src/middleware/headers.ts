import { Request, Response, NextFunction } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const requireHeaders = (requiredHeaders: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.headers['x-request-id'] as string;

    for (const header of requiredHeaders) {
      const value = req.headers[header.toLowerCase()] as string;

      if (!value) {
        const code = header.toLowerCase() === 'authorization' ? 'unauthorized' : 'invalid_request';
        return res.status(code === 'unauthorized' ? 401 : 400).json({
          error: {
            code,
            message: `Missing required header: ${header}`,
            request_id: requestId || 'unknown'
          }
        });
      }

      // UUID Validation for specific headers
      if (['x-request-id', 'idempotency-key'].includes(header.toLowerCase())) {
        if (!UUID_REGEX.test(value)) {
          return res.status(400).json({
            error: {
              code: 'invalid_request',
              message: `Header ${header} must be a valid UUID`,
              request_id: requestId || 'unknown'
            }
          });
        }
      }

      // Authorization scheme validation
      if (header.toLowerCase() === 'authorization') {
        if (!value.startsWith('Bearer ')) {
          return res.status(401).json({
            error: {
              code: 'unauthorized',
              message: 'Authorization header must use Bearer scheme',
              request_id: requestId || 'unknown'
            }
          });
        }
      }
    }
    next();
  };
};
