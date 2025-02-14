import { PrismaClient } from '@prisma/client';
import { logger } from '../shared/logger';

const prisma = new PrismaClient({
    log: [
        { emit: 'event', level: 'query' } as const,
        { emit: 'event', level: 'error' } as const,
        { emit: 'event', level: 'info' } as const,
        { emit: 'event', level: 'warn' } as const,
    ],
});

// Log queries in development
if (process.env.NODE_ENV === 'development') {
    prisma.$on('query', (e) => {
        logger.debug('Query:', e);
    });
}

prisma.$on('error', (e) => {
    logger.error('Database error:', e);
});

export { prisma }; 