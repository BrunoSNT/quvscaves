import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
    // Discord
    DISCORD_TOKEN: z.string(),
    
    // Voice
    ELEVENLABS_API_KEY: z.string().optional(),
    
    // Database
    DATABASE_URL: z.string(),
    
    // Optional configs
    LOG_LEVEL: z.string().default('info'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof configSchema>;

// Validate environment variables
const validateConfig = (): Config => {
    try {
        return configSchema.parse(process.env);
    } catch (error) {
        console.error('Invalid configuration:', error);
        process.exit(1);
    }
};

export const config = validateConfig(); 