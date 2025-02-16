import { PrismaClient, Prisma } from '../../prisma/client';
import { logger, prettyPrintLog } from '../shared/logger';

interface QueryEvent {
    timestamp: Date;
    query: string;
    params: string;
    duration: number;
    target: string;
}

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
    (prisma as any).$on('query', (e: Prisma.QueryEvent) => {
        logger.debug('RAG Query:' + prettyPrintLog(JSON.stringify({
            timestamp: e.timestamp,
            query: e.query,
            params: e.params,
            duration: e.duration,
            target: e.target
        })));
    });
}

(prisma as any).$on('error', (e: Error) => {
    logger.error('Database error:', {
        message: e.message,
        stack: e.stack
    });
}); 