# RPG Discord Bot

## English
A Discord bot for managing text-based RPG adventures with friends.

### Features
- Create and manage characters with different classes (Warrior, Mage, Rogue)
- Start adventures and invite friends to join
- Each character gets their private action channel
- Adventure log to track all events
- Friend system to manage who can join your adventures
- Voice narration support (Discord TTS and ElevenLabs)
- Multi-language support (English and Portuguese)

### Commands
- `/help` - Show all available commands
- `/register` - Create your account
- `/create_character` - Create a new character
- `/create_adventure` - Start a new adventure
- `/join_adventure` - Join an existing adventure
- `/action` - Perform an action in your adventure
- `/adventure_settings` - Change adventure settings (language, voice type)
- `/list_characters` - View your characters
- `/list_adventures` - View available adventures
- `/add_friend` - Send a friend request
- `/list_friends` - View your friends list
- `/accept_friend` - Accept a friend request

### Setup
1. Install dependencies: `npm install`
2. Create a `.env` file with:
   ```
   DISCORD_TOKEN=your_bot_token
   ELEVENLABS_API_KEY=your_elevenlabs_key (optional)
   ```
3. Run the bot: `npm start`