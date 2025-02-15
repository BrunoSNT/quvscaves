import winston from 'winston';
import { config } from '../../core/config';
import stripAnsi from 'strip-ansi';
import chalk from 'chalk';

const customFormat = winston.format.printf(({ level, message, timestamp }) => {
    const ts = new Date(timestamp as Date).toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    let icon = '🔍';
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

    let text = `[${chalk.gray('DEBUG')}]`;
    switch(level) {
        case 'error':
            text = `[${chalk.red('ERROR')}]`;
            break;
        case 'warn':
            text = `[${chalk.yellow('WARN')}]`;
            break;
        case 'info':
            text = `[${chalk.blue('INFO')}]`;
            break;
        case 'debug':
            text = `[${chalk.gray('DEBUG')}]`;
            break;
    }
    
    return `${chalk.gray(ts)} ${text} ${icon} ${message}`;
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

interface GameOutput {
    narration?: string;
    atmosphere?: string;
    available_actions?: string[];
    narracao?: string;
    atmosfera?: string;
    acoes_disponiveis?: string[];
}

export function formatGameOutput(output: string): string {
    try {
        const gameOutput = JSON.parse(output) as GameOutput;
        const isEnglish = 'narration' in gameOutput;

        // Format sections
        const narration = isEnglish ? gameOutput.narration : gameOutput.narracao;
        const atmosphere = isEnglish ? gameOutput.atmosphere : gameOutput.atmosfera;
        const actions = isEnglish ? gameOutput.available_actions : gameOutput.acoes_disponiveis;

        // Build formatted output
        const sections = [
            narration ? `📖 ${chalk.cyan('Narration')}:\n${chalk.white(narration)}\n` : '',
            atmosphere ? `🌍 ${chalk.magenta('Atmosphere')}:\n${chalk.gray(atmosphere)}\n` : '',
            actions?.length ? `⚔️ ${chalk.yellow('Available Actions')}:\n${actions.map(a => `• ${chalk.green(a)}`).join('\n')}` : ''
        ].filter(Boolean);

        return sections.join('\n');
    } catch {
        return output;
    }
}

export function prettyPrintLog(rawLog: string): string {
    const cleaned = stripAnsi(rawLog);
    
    try {
        // Try to parse as JSON first
        const parsed = JSON.parse(cleaned);
        // If it looks like a game output, format it specially
        if ('narration' in parsed || 'narracao' in parsed) {
            return formatGameOutput(cleaned);
        }
        return JSON.stringify(parsed, null, 2);
    } catch {
        // If it's not JSON, try to find JSON within the string
        const jsonMatch = cleaned.match(/{.*}/s);
        if (jsonMatch) {
            try {
                const json = JSON.parse(jsonMatch[0]);
                // If it looks like a game output, format it specially
                if ('narration' in json || 'narracao' in json) {
                    return formatGameOutput(jsonMatch[0]);
                }
                return JSON.stringify(json, null, 2);
            } catch {
                // If JSON parsing fails, return the cleaned string
                return cleaned;
            }
        }
        return cleaned;
    }
}