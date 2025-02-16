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

        return sections.join('\n') + '\n';
    } catch {
        return output;
    }
}

/**
 * Pretty prints a raw log string.
 * - For SQL queries, extracts and returns a custom formatted SQL summary.
 * - For JSON logs, formats game output or key/value pairs.
 */
export function prettyPrintLog(rawLog: string): string {
    const cleaned = stripAnsi(rawLog);

    // Helper function to extract the table name from a SQL query.
    const extractTableName = (query: string): string => {
        const match = query.match(/FROM\s+"public"\."([^"]+)"/i);
        let tableName = match && match[1] ? match[1] : "Unknown";
        if (tableName.includes('_')) {
            tableName = tableName.split('_')[0];
        }
        return tableName;
    };

    // Helper function to extract the query type (first word) from a SQL query.
    const extractQueryType = (query: string): string => {
        const match = query.match(/^\s*(\w+)/);
        return match ? match[1].toUpperCase() : "QUERY";
    };

    // If the raw log is a JSON string with SQL info.
    try {
        const logObj = JSON.parse(cleaned);
        if (logObj && logObj.query) {
            const query: string = logObj.query;
            const queryType = extractQueryType(query);
            const tableName = extractTableName(query);
            const duration = logObj.duration ? String(logObj.duration) : "{Duration}";
            return chalk.white(
                `\n\n${chalk.grey('Query')} ${chalk.blue(queryType)} ${chalk.grey('on')} ${chalk.blue(tableName)}\n${chalk.grey('Duration:')} ${chalk.blue(duration + 'ms')}\n`
            );
        }
    } catch {}

    // Fallback: if the raw log represents JSON for game output or generic key/value data.
    try {
        const parsed = JSON.parse(cleaned);
        if ('narration' in parsed || 'narracao' in parsed) {
            return formatGameOutput(cleaned);
        }
        return formatGenericOutput(cleaned);
    } catch {}

    const jsonMatch = cleaned.match(/{.*}/s);
    if (jsonMatch) {
        try {
            const json = JSON.parse(jsonMatch[0]);
            if ('narration' in json || 'narracao' in json) {
                return formatGameOutput(jsonMatch[0]);
            }
            return formatGenericOutput(jsonMatch[0]);
        } catch {}
    }

    return cleaned;
}

/**
 * Formats generic JSON key/values as plain text.
 * Keys appear in grey and values in white, displayed line-by-line.
 */
function formatGenericOutput(rawJson: string): string {
    let parsed: any;
    try {
        parsed = JSON.parse(rawJson);
    } catch {
        return rawJson;
    }

    const outputLines: string[] = [];

    function traverse(obj: any, indent: number = 0): void {
        const indentation = ' '.repeat(indent);
        for (const key in obj) {
            const value = obj[key];
            if (typeof value === 'object' && value !== null) {
                outputLines.push(`${indentation}${chalk.grey(key)}:`);
                traverse(value, indent + 2);
            } else {
                outputLines.push(`${indentation}${chalk.grey(key)}: ${chalk.white(String(value))}`);
            }
        }
    }

    if (typeof parsed === 'object' && parsed !== null) {
        traverse(parsed, 0);
    } else {
        outputLines.push(chalk.white(String(parsed)));
    }

    return '\n' + outputLines.join('\n') + '\n';
}