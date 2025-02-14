import winston from 'winston';
import { config } from '../../core/config';
import stripAnsi from 'strip-ansi';
import chalk from 'chalk';

const customFormat = winston.format.printf(({ level, message, timestamp }) => {
    const ts = new Date(timestamp).toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    let icon = '🔵';
    switch(level) {
        case 'error':
            icon = '🔴';
            break;
        case 'warn':
            icon = '🟡';
            break;
        case 'info':
            icon = '🟢';
            break;
        case 'debug':
            icon = '🔍';
            break;
    }
    
    return `${chalk.gray(ts)} ${icon} ${message}`;
});

export const logger = winston.createLogger({
    level: config.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        customFormat
    ),
    transports: [
        new winston.transports.Console()
    ]
});

// This function takes the raw log string, strips out ANSI escape codes,
// then tries to pretty-print any JSON contained in it.
export function prettyPrintLog(rawLog: string): string {
    const cleaned = stripAnsi(rawLog);
    
    try {
        // Try to parse as JSON first
        const parsed = JSON.parse(cleaned);
        return JSON.stringify(parsed, null, 2);
    } catch {
        // If it's not JSON, try to find JSON within the string
        const jsonMatch = cleaned.match(/{.*}/s);
        if (jsonMatch) {
            try {
                const json = JSON.parse(jsonMatch[0]);
                return JSON.stringify(json, null, 2);
            } catch {
                // If JSON parsing fails, return the cleaned string
                return cleaned;
            }
        }
        return cleaned;
    }
}