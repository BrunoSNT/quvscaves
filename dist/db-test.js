"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
});
async function main() {
    try {
        // Just try to connect
        const result = await prisma.$queryRaw `SELECT 1+1 as result`;
        console.log('Successfully connected to database:', result);
    }
    catch (error) {
        console.error('Database connection test failed:', error);
    }
}
main()
    .then(async () => {
    await prisma.$disconnect();
})
    .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
