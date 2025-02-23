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
    world_context?: string;
    contexto_mundo?: string;
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

    // Check if it's an initial world generation log
    if (cleaned.includes('📖 Narration:') || cleaned.includes('🌍 Atmosphere:')) {
        return formatWorldGenerationLog(cleaned);
    }

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

function formatWorldGenerationLog(log: string): string {
    const sections = log.split('\n\n');
    let formatted = '\n';

    for (const section of sections) {
        if (section.startsWith('📖 Narration:')) {
            formatted += chalk.cyan('📖 Narration:') + '\n';
            formatted += chalk.white(section.replace('📖 Narration:', '').trim()) + '\n\n';
        } else if (section.startsWith('🌍 Atmosphere:')) {
            formatted += chalk.yellow('🌍 Atmosphere:') + '\n';
            formatted += chalk.white(section.replace('🌍 Atmosphere:', '').trim()) + '\n\n';
        } else if (section.includes('⚔️ Available Actions:')) {
            formatted += chalk.magenta('⚔️ Available Actions:') + '\n';
            const actions = section.split('\n').filter(line => line.startsWith('•'));
            formatted += actions.map(action => chalk.grey(action)).join('\n') + '\n';
        } else if (section.trim()) {
            formatted += chalk.white(section.trim()) + '\n\n';
        }
    }

    return formatted;
}

function formatGameOutput(jsonStr: string): string {
    try {
        const output = JSON.parse(jsonStr) as GameOutput;
        let formatted = '\n';

        // Format world context if present
        if (output.world_context || output.contexto_mundo) {
            formatted += chalk.cyan('🌍 World Context:') + '\n';
            formatted += chalk.white(output.world_context || output.contexto_mundo) + '\n\n';
        }

        // Format narration
        if (output.narration || output.narracao) {
            formatted += chalk.yellow('📖 Narration:') + '\n';
            formatted += chalk.white(output.narration || output.narracao) + '\n\n';
        }

        // Format atmosphere if present
        if (output.atmosphere || output.atmosfera) {
            formatted += chalk.magenta('🌅 Atmosphere:') + '\n';
            formatted += chalk.white(output.atmosphere || output.atmosfera) + '\n\n';
        }

        // Format available actions
        const actions = output.available_actions || output.acoes_disponiveis;
        if (actions && Array.isArray(actions)) {
            formatted += chalk.blue('⚔️ Available Actions:') + '\n';
            formatted += actions.map(action => chalk.grey(`• ${action}`)).join('\n') + '\n';
        }

        return formatted;
    } catch (error) {
        return jsonStr;
    }
}

function formatGenericOutput(jsonStr: string): string {
    try {
        const output = JSON.parse(jsonStr);
        return Object.entries(output)
            .map(([key, value]) => {
                const formattedKey = chalk.blue(key);
                const formattedValue = typeof value === 'object' 
                    ? JSON.stringify(value, null, 2)
                    : String(value);
                return `${formattedKey}: ${chalk.white(formattedValue)}`;
            })
            .join('\n');
    } catch (error) {
        return jsonStr;
    }
}