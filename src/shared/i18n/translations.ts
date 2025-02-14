import { SupportedLanguage } from "./types";

export const messages = {
    'en-US': {
        errors: {
            registerFirst: 'Please register first using `/register`',
            adventureNotFound: 'Adventure not found.',
            noPermission: 'You do not have permission to modify this adventure.',
            characterNotFound: 'Character not found. Please create a character first using `/create_character`',
            alreadyInAdventure: 'You are already in this adventure.',
            friendsOnly: 'You can only join adventures created by your friends.',
            needActiveAdventure: 'You need to be in an active adventure to perform actions! Use `/start_adventure` or `/join_adventure`',
            characterNotInAdventure: 'Could not find your character in this adventure.',
            genericError: 'Something went wrong. Please try again.'
        },
        success: {
            adventureStarted: '✨ Adventure started! Your adventure channels have been created!',
            adventureJoined: (adventureName: string, characterName: string) =>
                `Successfully joined the adventure "${adventureName}" with character ${characterName}!`,
            settingsUpdated: '✨ Adventure settings updated!',
            voiceUpdated: (type: string) => `Voice type set to: ${type}`,
            actionProcessed: '✨ Action processed!'
        },
        channels: {
            categoryName: (adventureName: string) => `🎲 ${adventureName}`,
            adventureLog: 'adventure-log',
            dice: 'dice'
        },
        welcome: {
            newPlayer: (characterName: string) => `🎉 ${characterName} has joined the adventure!`,
            initialMessage: (username: string) => `Welcome, ${username}!`
        },
        defaultScenes: {
            beginning: {
                name: 'Beginning',
                description: 'You stand at the threshold of your adventure...',
                summary: 'The beginning of a new adventure',
                location: 'The starting point of your journey'
            },
            fallback: {
                narration: (characterName: string, action: string) =>
                    `[Narration] As ${characterName} attempts to ${action}, the world around them shifts with possibility. The air tingles with magical potential, and the path ahead beckons with both danger and promise.`,
                dialogue: '[Dialogue] A mysterious voice echoes: "Your choices shape the story, brave adventurer. Choose wisely..."',
                atmosphere: '[Atmosphere] The environment seems to respond to your presence, shadows dancing at the edge of your vision.',
                choices: `[Suggested Choices]
- Press forward with determination
- Observe your surroundings more carefully
- Call out to any nearby allies
- Prepare yourself for what may come`,
                effects: '[Effects] Your actions have set events in motion...'
            }
        }
    },
    'pt-BR': {
        errors: {
            registerFirst: 'Por favor, registre-se primeiro usando `/register`',
            adventureNotFound: 'Aventura não encontrada.',
            noPermission: 'Você não tem permissão para modificar esta aventura.',
            characterNotFound: 'Personagem não encontrado. Crie um personagem primeiro usando `/create_character`',
            alreadyInAdventure: 'Você já está nesta aventura.',
            friendsOnly: 'Você só pode participar de aventuras criadas por seus amigos.',
            needActiveAdventure: 'Você precisa estar em uma aventura ativa para realizar ações! Use `/start_adventure` ou `/join_adventure`',
            characterNotInAdventure: 'Não foi possível encontrar seu personagem nesta aventura.',
            genericError: 'Algo deu errado. Por favor, tente novamente.'
        },
        success: {
            adventureStarted: '✨ Aventura iniciada! Seus canais de aventura foram criados!',
            adventureJoined: (adventureName: string, characterName: string) =>
                `Você entrou com sucesso na aventura "${adventureName}" com o personagem ${characterName}!`,
            settingsUpdated: '✨ Configurações da aventura atualizadas!',
            voiceUpdated: (type: string) => `Tipo de voz definido para: ${type}`,
            actionProcessed: '✨ Ação processada!'
        },
        channels: {
            categoryName: (adventureName: string) => `🎲 ${adventureName}`,
            adventureLog: 'registro-aventura',
            dice: 'dados'
        },
        welcome: {
            newPlayer: (characterName: string) => `🎉 ${characterName} entrou na aventura!`,
            initialMessage: (username: string) => `Bem-vindo, ${username}!`
        },
        defaultScenes: {
            beginning: {
                name: 'Início',
                description: 'Você está no limiar de sua aventura...',
                summary: 'O início de uma nova aventura',
                location: 'O ponto de partida da sua jornada'
            },
            fallback: {
                narration: (characterName: string, action: string) =>
                    `[Narração] Enquanto ${characterName} tenta ${action}, o mundo ao seu redor se transforma com possibilidades. O ar vibra com potencial mágico, e o caminho à frente acena com perigo e promessa.`,
                dialogue: '[Diálogo] Uma voz misteriosa ecoa: "Suas escolhas moldam a história, bravo aventureiro. Escolha com sabedoria..."',
                atmosphere: '[Atmosfera] O ambiente parece responder à sua presença, sombras dançando na borda de sua visão.',
                choices: `[Sugestões de Ação]
- Avançar com determinação
- Observar o ambiente com mais cuidado
- Chamar por aliados próximos
- Preparar-se para o que está por vir`,
                effects: '[Efeitos] Suas ações colocaram eventos em movimento...'
            }
        }
    }
};

export const translations = {
    'en-US': {
        commands: {
            help: 'Show all available commands and features',
            register: 'Register your account',
            createCharacter: 'Create a new RPG character',
            createAdventure: 'Create a new adventure',
            action: 'Perform an action in your adventure',
            listCharacters: 'List all your characters',
            listAdventures: 'List all your adventures',
            deleteCharacter: 'Delete a character',
            deleteAdventure: 'Delete an adventure',
            addFriend: 'Send a friend request',
            removeFriend: 'Remove a friend',
            acceptFriend: 'Accept a friend request',
            listFriends: 'List all your friends',
            linkWallet: 'Link your wallet'
        },
        responses: {
            characterCreated: 'Character created successfully!',
            adventureStarted: 'Adventure started!',
            friendRequestSent: 'Friend request sent!',
            friendRequestAccepted: 'Friend request accepted!',
            walletLinked: 'Wallet linked successfully!'
        },
        errors: {
            generic: 'An error occurred. Please try again.',
            notFound: 'Not found.',
            unauthorized: 'You are not authorized to perform this action.',
            invalidInput: 'Invalid input provided.'
        }
    },
    'pt-BR': {
        commands: {
            help: 'Mostrar todos os comandos e recursos disponíveis',
            register: 'Registrar sua conta',
            createCharacter: 'Criar um novo personagem RPG',
            createAdventure: 'Criar uma nova aventura',
            action: 'Realizar uma ação na sua aventura',
            listCharacters: 'Listar todos os seus personagens',
            listAdventures: 'Listar todas as suas aventuras',
            deleteCharacter: 'Deletar um personagem',
            deleteAdventure: 'Deletar uma aventura',
            addFriend: 'Enviar solicitação de amizade',
            removeFriend: 'Remover um amigo',
            acceptFriend: 'Aceitar solicitação de amizade',
            listFriends: 'Listar todos os seus amigos',
            linkWallet: 'Vincular sua carteira'
        },
        responses: {
            characterCreated: 'Personagem criado com sucesso!',
            adventureStarted: 'Aventura iniciada!',
            friendRequestSent: 'Solicitação de amizade enviada!',
            friendRequestAccepted: 'Solicitação de amizade aceita!',
            walletLinked: 'Carteira vinculada com sucesso!'
        },
        errors: {
            generic: 'Ocorreu um erro. Por favor, tente novamente.',
            notFound: 'Não encontrado.',
            unauthorized: 'Você não está autorizado a realizar esta ação.',
            invalidInput: 'Entrada inválida fornecida.'
        }
    }
};

type TranslationKeys = keyof typeof translations;
type TranslationStructure = typeof translations[TranslationKeys];

export function translate(key: string, language: SupportedLanguage = 'en-US'): string {
    const keys = key.split('.');
    let current = translations[language];
    
    try {
        for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
                current = (current as any)[k];
            } else {
                throw new Error('Invalid path');
            }
        }
        
        if (typeof current !== 'string') {
            throw new Error('Translation is not a string');
        }
        
        return current;
    } catch {
        // Fallback to English or the original key
        try {
            let fallback = translations['en-US'];
            for (const k of keys) {
                if (fallback && typeof fallback === 'object' && k in fallback) {
                    fallback = (fallback as any)[k];
                } else {
                    return key;
                }
            }
            return typeof fallback === 'string' ? fallback : key;
        } catch {
            return key;
        }
    }
} 

export function getMessages(language: SupportedLanguage) {
    return messages[language];
} 