import chalk from "chalk";

export interface Logger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
}

class LoggerImpl implements Logger {
    private getTimestamp(): string {
        return new Date().toISOString();
    }

    private log(level: string, message: string, ...args: any[]): void {
        const timestamp = this.getTimestamp();
        const formattedArgs = args.length > 0 
            ? args.map(arg => 
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
            ).join(' ')
            : '';

        console.log(`${chalk.gray([timestamp])} ${ level === 'info' ? "[" + chalk.blue(level.toUpperCase()) + "]" : level === 'warn' ? chalk.bgYellow("[" + chalk.white(level.toUpperCase()) + "]") : "[" + chalk.black(level.toUpperCase()) + "]"} ${message}${formattedArgs ? ' ' + formattedArgs : ''}`);
    }

    info(message: string, ...args: any[]): void {
        this.log('info', message, ...args);
    }

    warn(message: string, ...args: any[]): void {
        this.log('warn', message, ...args);
    }

    error(message: string, ...args: any[]): void {
        this.log('error', message, ...args);
    }

    debug(message: string, ...args: any[]): void {
        // Show debug logs if DEBUG=true or NODE_ENV=development
        if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
            this.log('debug', message, ...args);
        }
    }
}

export const logger = new LoggerImpl(); 