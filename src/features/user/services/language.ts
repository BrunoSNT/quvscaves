import { prisma } from '../../../core/prisma';
import { SupportedLanguage } from '../../../shared/i18n/types';
import { formatLanguageCode, getDefaultLanguage } from '../../../shared/i18n/language';
import { logger } from '../../../shared/logger';
import type { Prisma } from '@prisma/client';

export class LanguageService {
    async getUserLanguage(userId: string): Promise<SupportedLanguage> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    language: true
                }
            });

            if (!user?.language) {
                return getDefaultLanguage();
            }

            return formatLanguageCode(user.language);
        } catch (error) {
            logger.error('Error getting user language:', error);
            return getDefaultLanguage();
        }
    }

    async setUserLanguage(userId: string, language: string): Promise<void> {
        try {
            const formattedLanguage = formatLanguageCode(language);
            
            const updateData: Prisma.UserUpdateInput = {
                language: formattedLanguage
            };

            await prisma.user.update({
                where: { id: userId },
                data: updateData
            });

            logger.info(`Updated language for user ${userId} to ${formattedLanguage}`);
        } catch (error) {
            logger.error('Error setting user language:', error);
            throw error;
        }
    }
} 