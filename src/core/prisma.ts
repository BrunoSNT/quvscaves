import { PrismaClient } from '../../prisma/client';
import { logger } from '../shared/logger';

declare global {
    var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient({
    log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
    ],
});

if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

// Log queries in development
if (process.env.NODE_ENV === 'development') {
    prisma.$on('query', (e) => {
        logger.debug('Query:', e);
    });
}

prisma.$on('error', (e) => {
    logger.error('Database error:', e);
}); 